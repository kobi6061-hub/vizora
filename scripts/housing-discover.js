#!/usr/bin/env node
// PROPX · official source discovery for government (subsidized) housing.
//
// Read-only. Prints what the official sources actually expose — datasets,
// resources, update times, field names/types, row counts and a few sample
// rows — so the ingestion contract is written from evidence, not from page
// wording. Runs where gov.il is reachable (the GitHub Actions runner via
// .github/workflows/housing-discover.yml); the Claude sandbox
// cannot reach gov.il.
//
//   node scripts/housing-discover.js                 everything below
//   node scripts/housing-discover.js --resource <id> one CKAN resource in depth
//
// Nothing is written anywhere.

'use strict';

const CKAN = process.env.GOV_DATAGOV_BASE || 'https://data.gov.il/api/3/action';
const UA = 'PROPX-data-sync/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };

/* a lead from public references — verified here, never assumed */
const LEADS = ['7c8255d0-49ef-49db-8904-4cf917586031'];
const QUERIES = [
  'דירה בהנחה', 'מחיר למשתכן', 'מחיר מטרה', 'הגרלות דירות', 'דיור מוזל', 'משרד הבינוי והשיכון',
  'היתרי בנייה', 'התחלות בנייה', 'גמר בנייה', 'טופס 4', 'מכרזי רשות מקרקעי ישראל', 'מכרזים רמ"י',
  'דירות שלא נמכרו', 'מלאי דירות חדשות', 'פרויקטים למגורים',
];
const trim = (v, n = 140) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
const out = (o) => console.log(JSON.stringify(o));

async function get(url, accept = 'application/json') {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
  const text = await r.text();
  return { status: r.status, type: r.headers.get('content-type') || '', text };
}
async function ck(action, params = {}) {
  const u = new URL(CKAN + '/' + action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await get(u.toString());
  let j;
  try { j = JSON.parse(r.text); } catch { throw new Error(`${action} HTTP ${r.status} non-JSON: ${r.text.slice(0, 160)}`); }
  if (!j.success) throw new Error(`${action} HTTP ${r.status}: ${trim(j.error, 300)}`);
  return j.result;
}
const resSummary = (r) => ({ id: r.id, name: r.name, format: r.format, datastore_active: r.datastore_active,
  last_modified: r.last_modified, created: r.created, size: r.size, url: trim(r.url, 200) });

async function describeResource(id, samples = 3) {
  const res = await ck('resource_show', { id });
  const pkg = await ck('package_show', { id: res.package_id });
  out({ kind: 'resource', id, name: res.name, format: res.format, datastore_active: res.datastore_active,
    resource_last_modified: res.last_modified, resource_created: res.created,
    package: { name: pkg.name, title: pkg.title, organization: pkg.organization && pkg.organization.title,
      metadata_modified: pkg.metadata_modified, frequency: pkg.frequency || pkg.extras && pkg.extras.find((e) => /freq|update/i.test(e.key)),
      license: pkg.license_title, url: `https://data.gov.il/dataset/${pkg.name}` },
    sibling_resources: pkg.resources.map(resSummary) });
  if (!res.datastore_active) return;
  const ds = await ck('datastore_search', { resource_id: id, limit: samples });
  out({ kind: 'schema', id, total: ds.total, fields: ds.fields.map((f) => `${f.id}:${f.type}`) });
  for (const rec of ds.records) out({ kind: 'sample', id, record: Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, trim(v)])) });
  // newest rows by every date-looking field, to see the actual freshness
  for (const f of ds.fields.filter((x) => /date|תאריך|time|זמן|_dt$/i.test(x.id) || x.type === 'timestamp').slice(0, 4)) {
    try {
      const top = await ck('datastore_search', { resource_id: id, limit: 2, sort: `${f.id} desc` });
      out({ kind: 'newest', id, field: f.id, values: top.records.map((r) => r[f.id]) });
    } catch (e) { out({ kind: 'newest', id, field: f.id, error: e.message }); }
  }
}

/* every row of a datastore resource (paged) */
async function allRows(id) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await ck('datastore_search', { resource_id: id, limit: 1000, offset });
    rows.push(...r.records);
    if (r.records.length < 1000 || rows.length >= r.total) return { rows, total: r.total, fields: r.fields };
  }
}
const isBlank = (v) => v == null || String(v).trim() === '' || String(v).trim() === '-';

/* the whole table: date ranges, vocabularies, blanks, one city's rows */
async function profile(id) {
  const { rows, total, fields } = await allRows(id);
  out({ kind: 'profile', id, total, fetched: rows.length });
  for (const f of fields.map((x) => x.id).filter((k) => k !== '_id')) {
    const vals = rows.map((r) => r[f]);
    const blank = vals.filter(isBlank).length;
    const distinct = new Set(vals.filter((v) => !isBlank(v)).map(String));
    const shapes = {};
    for (const v of vals) if (!isBlank(v)) { const s = String(v).replace(/[0-9]/g, '9').replace(/[א-ת]+/g, 'א').slice(0, 24); shapes[s] = (shapes[s] || 0) + 1; }
    const top = Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sorted = [...distinct].sort();
    out({ kind: 'field', id, field: f, blank, distinct: distinct.size, min: trim(sorted[0], 40), max: trim(sorted[sorted.length - 1], 40), shapes: top });
    if (distinct.size <= 40) {
      const counts = {};
      for (const v of vals) { const k = isBlank(v) ? '∅' : String(v); counts[k] = (counts[k] || 0) + 1; }
      out({ kind: 'vocab', id, field: f, values: Object.entries(counts).sort((a, b) => b[1] - a[1]) });
    }
  }
  const city = argVal('city');
  if (city) for (const r of rows.filter((x) => String(x.LamasCode) === city || x.LamasName === city)) out({ kind: 'cityRow', id, record: r });
  // identity checks
  const ids = rows.map((r) => r.LotteryId).filter((v) => !isBlank(v));
  out({ kind: 'identity', id, rows: rows.length, lotteryIds: ids.length, distinctLotteryIds: new Set(ids.map(String)).size,
    distinctProjectIds: new Set(rows.map((r) => r.ProjectId).filter((v) => !isBlank(v)).map(String)).size });
}

/* a GIS layer published as a zipped shapefile: files, fields, CRS, a few features */
async function gis(id) {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const res = await ck('resource_show', { id });
  const r = await fetch(res.url, { headers: { 'User-Agent': UA } });
  const buf = Buffer.from(await r.arrayBuffer());
  out({ kind: 'gis', id, name: res.name, url: res.url, status: r.status, bytes: buf.length, last_modified: res.last_modified });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gis-'));
  fs.writeFileSync(path.join(dir, 'layer.zip'), buf);
  execFileSync('unzip', ['-o', '-q', path.join(dir, 'layer.zip'), '-d', path.join(dir, 'x')]);
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } })(path.join(dir, 'x'));
  out({ kind: 'gisFiles', id, files: files.map((f) => `${path.relative(dir, f)} (${fs.statSync(f).size})`) });
  for (const shp of files.filter((f) => /\.shp$/i.test(f))) {
    const base = shp.slice(0, -4), b = fs.readFileSync(shp);
    const prj = files.find((f) => f.toLowerCase() === (base + '.prj').toLowerCase());
    const cpg = files.find((f) => f.toLowerCase() === (base + '.cpg').toLowerCase());
    out({ kind: 'shp', layer: path.basename(base), shapeType: b.readInt32LE(32),
      bbox: [b.readDoubleLE(36), b.readDoubleLE(44), b.readDoubleLE(52), b.readDoubleLE(60)].map((x) => Math.round(x)),
      prj: prj ? trim(fs.readFileSync(prj, 'utf8'), 300) : null, cpg: cpg ? fs.readFileSync(cpg, 'utf8').trim() : null });
    const dbfPath = files.find((f) => f.toLowerCase() === (base + '.dbf').toLowerCase());
    if (!dbfPath) continue;
    const d = fs.readFileSync(dbfPath), n = d.readUInt32LE(4), hlen = d.readUInt16LE(8), rlen = d.readUInt16LE(10);
    const flds = [];
    for (let o = 32; d[o] !== 0x0d && o < hlen; o += 32) flds.push({ name: d.toString('latin1', o, o + 11).replace(/\0.*$/, ''), type: String.fromCharCode(d[o + 11]), len: d[o + 16] });
    const enc = cpg && /utf-?8/i.test(fs.readFileSync(cpg, 'utf8')) ? 'utf-8' : 'windows-1255';
    const dec = new TextDecoder(enc);
    out({ kind: 'dbf', layer: path.basename(base), records: n, encoding: enc, fields: flds.map((f) => `${f.name}:${f.type}${f.len}`) });
    for (let i = 0; i < Math.min(4, n); i++) {
      let o = hlen + i * rlen + 1; const rec = {};
      for (const f of flds) { rec[f.name] = dec.decode(d.subarray(o, o + f.len)).trim(); o += f.len; }
      out({ kind: 'dbfRow', layer: path.basename(base), record: rec });
    }
  }
}

async function main() {
  const one = argVal('resource');
  if (process.argv.includes('--profile')) return profile(one);
  if (process.argv.includes('--gis')) return gis(one);
  if (one) return describeResource(one, 5);

  // 1 · catalogue search
  const seen = new Map();
  for (const q of QUERIES) {
    try {
      const r = await ck('package_search', { q, rows: 15 });
      out({ kind: 'search', q, count: r.count, hits: r.results.map((p) => ({ name: p.name, title: p.title,
        org: p.organization && p.organization.title, modified: p.metadata_modified, resources: p.num_resources })) });
      for (const p of r.results) seen.set(p.name, p);
    } catch (e) { out({ kind: 'search', q, error: e.message }); }
  }
  // 2 · every housing-ministry / land-authority / planning package found: its resources
  const relevant = [...seen.values()].filter((p) => /בינוי|שיכון|מקרקעי|תכנון|housing|construction|land/i.test(
    `${p.organization && p.organization.title} ${p.organization && p.organization.name} ${p.title}`));
  for (const p of relevant) out({ kind: 'package', name: p.name, title: p.title, org: p.organization && p.organization.title,
    modified: p.metadata_modified, resources: (p.resources || []).map(resSummary) });
  // 3 · the lead resource(s) and every datastore resource of the relevant packages, in depth
  const ids = new Set(LEADS);
  for (const p of relevant) for (const r of p.resources || []) if (r.datastore_active) ids.add(r.id);
  for (const id of [...ids].slice(0, 25)) {
    try { await describeResource(id); } catch (e) { out({ kind: 'resource', id, error: e.message }); }
  }
  // 4 · the lottery website itself (not an open-data contract — recorded, not relied on)
  for (const u of ['https://www.dira.moch.gov.il/ProjectsList', 'https://dira.moch.gov.il/ProjectsList']) {
    try { const r = await get(u, 'text/html'); out({ kind: 'site', url: u, status: r.status, type: r.type, bytes: r.text.length }); }
    catch (e) { out({ kind: 'site', url: u, error: e.message }); }
  }
}

main().catch((e) => { console.error('discover failed:', e.message); process.exitCode = 1; });
