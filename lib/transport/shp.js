// PROPX · a minimal, dependency-free reader for the zipped shapefiles the Ministry of Transport publishes on data.gov.il
// (21.10.2026): ZIP central directory (stored / deflate entries) → .shp (Point, MultiPoint, PolyLine, Polygon — first part's
// vertices kept for lines) + .dbf (dBase III fields, any code page decoded as declared or UTF-8 / Windows-1255 fallback) + .prj
// text. Coordinates are returned as published (no reprojection here); the caller states and checks the projection.

'use strict';

const zlib = require('node:zlib');

/** the entries of a ZIP buffer: [{ name, data: Buffer }] (stored / deflate only; anything else throws) */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a ZIP file (no end-of-central-directory record)');
  const n = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0, p = cdOff; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const lnl = buf.readUInt16LE(lho + 26), lxl = buf.readUInt16LE(lho + 28), start = lho + 30 + lnl + lxl;
    const raw = buf.slice(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`ZIP entry ${name}: compression method ${method} not supported`);
    out.push({ name, data });
  }
  return out;
}

const SHAPE = { 0: 'Null', 1: 'Point', 3: 'PolyLine', 5: 'Polygon', 8: 'MultiPoint', 11: 'PointZ', 13: 'PolyLineZ', 15: 'PolygonZ', 18: 'MultiPointZ', 21: 'PointM', 23: 'PolyLineM', 25: 'PolygonM', 28: 'MultiPointM' };
/** .shp → { type, bbox, records: [{ type, x, y } | { type, points: [[x, y] …], parts }] } */
function readShp(buf) {
  if (buf.readInt32BE(0) !== 9994) throw new Error('not a shapefile (.shp file code ≠ 9994)');
  const type = SHAPE[buf.readInt32LE(32)] || String(buf.readInt32LE(32));
  const bbox = [buf.readDoubleLE(36), buf.readDoubleLE(44), buf.readDoubleLE(52), buf.readDoubleLE(60)];
  const records = [];
  for (let p = 100; p + 8 <= buf.length;) {
    const len = buf.readInt32BE(p + 4) * 2, c = p + 8, st = buf.readInt32LE(c);
    const t = SHAPE[st] || String(st);
    if (st === 0) records.push({ type: 'Null' });
    else if (st === 1 || st === 11 || st === 21) records.push({ type: 'Point', x: buf.readDoubleLE(c + 4), y: buf.readDoubleLE(c + 12) });
    else if (st === 8 || st === 18 || st === 28) { const np = buf.readInt32LE(c + 36), pts = []; for (let i = 0; i < np; i++) pts.push([buf.readDoubleLE(c + 40 + i * 16), buf.readDoubleLE(c + 48 + i * 16)]); records.push({ type: 'MultiPoint', points: pts }); }
    else { const nparts = buf.readInt32LE(c + 36), np = buf.readInt32LE(c + 40), parts = []; for (let i = 0; i < nparts; i++) parts.push(buf.readInt32LE(c + 44 + i * 4));
      const base = c + 44 + nparts * 4, pts = []; for (let i = 0; i < np; i++) pts.push([buf.readDoubleLE(base + i * 16), buf.readDoubleLE(base + 8 + i * 16)]); records.push({ type: t.replace(/[ZM]$/, ''), points: pts, parts }); }
    p = c + len;
  }
  return { type, bbox, records };
}

/** .dbf → { fields: [{ name, type, length }], rows: [ {name: value} ] } — text decoded from the declared code page, else UTF-8, else Windows-1255 */
function readDbf(buf, cpg) {
  const n = buf.readUInt32LE(4), hlen = buf.readUInt16LE(8), rlen = buf.readUInt16LE(10), ldid = buf[29];
  const fields = [];
  for (let p = 32; p < hlen - 1 && buf[p] !== 0x0d; p += 32) fields.push({ name: buf.slice(p, p + 11).toString('latin1').replace(/\0.*$/, '').trim(), type: String.fromCharCode(buf[p + 11]), length: buf[p + 16], decimals: buf[p + 17] });
  const label = cpg && /1255/.test(cpg) ? 'windows-1255' : cpg && /utf/i.test(cpg) ? 'utf-8' : ldid === 0x7d ? 'windows-1255' : null;
  const dec = (b) => { if (label) return new TextDecoder(label).decode(b); const u = new TextDecoder('utf-8', { fatal: true }); try { return u.decode(b); } catch { return new TextDecoder('windows-1255').decode(b); } };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const p = hlen + i * rlen; if (p + rlen > buf.length) break;
    if (buf[p] === 0x2a) continue;   // deleted record
    const row = {}; let o = p + 1;
    for (const f of fields) {
      const s = dec(buf.slice(o, o + f.length)).replace(/\0/g, '').trim(); o += f.length;
      row[f.name] = f.type === 'N' || f.type === 'F' ? (s === '' ? null : Number(s)) : f.type === 'D' ? (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null) : s === '' ? null : s;
    }
    rows.push(row);
  }
  return { fields, rows, codePage: label || 'detected' };
}

/** one zipped layer → { name, prj, shapeType, bbox, features: [{ attributes, geometry }] } (the first .shp in the ZIP, or `layer`) */
function readZippedLayer(buf, { layer = null } = {}) {
  const entries = unzip(buf);
  const shps = entries.filter((e) => /\.shp$/i.test(e.name));
  const shp = layer ? shps.find((e) => e.name.toLowerCase().includes(layer.toLowerCase())) : shps[0];
  if (!shp) throw new Error('no .shp in the ZIP (entries: ' + entries.map((e) => e.name).join(', ') + ')');
  const base = shp.name.replace(/\.shp$/i, '');
  const get = (ext) => entries.find((e) => e.name.toLowerCase() === (base + ext).toLowerCase());
  const dbf = get('.dbf'), prj = get('.prj'), cpg = get('.cpg');
  const S = readShp(shp.data), D = dbf ? readDbf(dbf.data, cpg ? cpg.data.toString('latin1') : null) : { fields: [], rows: [] };
  if (dbf && D.rows.length !== S.records.length) throw new Error(`the .dbf holds ${D.rows.length} rows, the .shp ${S.records.length} shapes`);
  return { name: base, entries: entries.map((e) => e.name), prj: prj ? prj.data.toString('latin1') : null, shapeType: S.type, bbox: S.bbox, fields: D.fields, codePage: D.codePage,
    features: S.records.map((g, i) => ({ attributes: D.rows[i] || {}, geometry: g })) };
}

/** the projection a .prj names, as far as PROPX needs to know it */
function projectionOf(prj) {
  const s = String(prj || '');
  if (/Israel_TM_Grid|Israeli_TM|ITM|2039/i.test(s)) return 'ITM';
  if (/GCS_WGS_1984|WGS_1984/.test(s) && !/PROJCS/.test(s)) return 'WGS84';
  if (/Web_Mercator|Auxiliary_Sphere|3857/i.test(s)) return 'WEB_MERCATOR';
  return s ? 'UNKNOWN' : 'NONE';
}

module.exports = { unzip, readShp, readDbf, readZippedLayer, projectionOf };
