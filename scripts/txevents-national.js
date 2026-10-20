#!/usr/bin/env node
// PROPX · THE NATIONAL MISSED-DEAL DETECTOR over the GovMap-layer copy (20.10.2026).
//
// The recent layer (lib/recent) reads the GovMap deals layer as republished by over.org.il for 75 days before the register copy's
// latest deal. This job reads the WHOLE published file of the layer's latest version (the GeoPackage the publisher lists with every
// dataset version — one GET of a public file) and asks, for every row dated inside the register copy's 36-month window: does the
// register copy PROPX holds have this deal? The rules are the recent layer's own (lib/recent/reconcile.js `reconcile`, unchanged) —
// so a deal is never counted twice and every row ends in exactly one class. Nothing in the register, the recent layer, the street
// statistics or the Street Value Model changes.
//
//   node scripts/txevents-national.js --check                    the two copies' latest versions vs the stored build → changed?
//   node scripts/txevents-national.js --download --out <file>    the latest GovMap-layer file (GeoPackage), sha256 + size
//   node scripts/txevents-national.js --build --extract <dir>    reconcile the extract (scripts/txevents-gpkg.py) → data/txevents/national/
//          [--file-sha <sha256> --file-url <url> --file-bytes <n>]
//
// Outputs (data/txevents/national/, bot-written):
//   meta.json            version · file · validation against the stored API window · classes per period · diff vs the last build
//   govmap-only.json     every row of the register's window the register copy does NOT hold (RECENT_NEW under the recent rules),
//                        and every possible duplicate (shown flagged, never counted) — columnar, indexed by locality and street;
//                        rows inside the recent layer's own window stay the recent layer's (read there)
//   accounting.json      every row of the file in the window → one class, per period, per locality — the exact reconciliation
//   parcel-streets.json  register parcels with no street link (NO_ADDRESS / UNRESOLVED) whose GovMap rows carry an address: the
//                        layer's addresses run through the register's own street-matching rule (lib/streets/match.js matchDeal)
//   rowhash.json.gz      object id → row hash of the window (the next build's new / changed / removed)
//   runs.jsonl           one line per check / build (append-only)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'txevents', 'national');
const OVER = 'https://www.over.org.il';
const GOVMAP_DS = '4174aac2-c8b2-443e-9425-3773ce47c8da', REGISTER_DS = 'fd06f5ae-8a4f-4120-b275-8a514ad23499';
const UA = 'PROPX-txevents-national/1.0 (+https://github.com/kobi6061-hub/vizora; read-only)';
const ENGINE = 'propx-txevents-national-1';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const tally = (xs) => xs.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
const appendRun = (o) => { fs.mkdirSync(OUT, { recursive: true }); fs.appendFileSync(path.join(OUT, 'runs.jsonl'), JSON.stringify(o) + '\n'); };
const setOutput = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  const j = await r.json();
  await new Promise((ok) => setTimeout(ok, 1000));
  return j;
}
const versionOf = (v) => {
  let change = null; try { change = JSON.parse(v.change_summary || 'null'); } catch { /* text */ }
  return { id: v.id, n: v.version_number, detectedAt: v.detected_at, modified: v.metadata_modified, rows: change && change.total_rows != null ? change.total_rows : null,
    resources: (v.resources || []).map((x) => ({ name: x.name, format: x.format, url: x.download_url })) };
};
async function versions() {
  const g = await getJson(`${OVER}/api/v1/datasets/${GOVMAP_DS}/versions`);
  const r = await getJson(`${OVER}/api/v1/datasets/${REGISTER_DS}/versions`);
  return { govmap: Array.isArray(g) && g[0] ? versionOf(g[0]) : null, register: Array.isArray(r) && r[0] ? versionOf(r[0]) : null, govmapCount: Array.isArray(g) ? g.length : 0, registerCount: Array.isArray(r) ? r.length : 0 };
}

/* ── --check: has either copy published a new version since the stored build? ── */
async function check() {
  const at = new Date().toISOString();
  try {
    const v = await versions();
    const meta = readJson(path.join(OUT, 'meta.json'));
    const ev = readJson(path.join(ROOT, 'data', 'streets', 'evidence', 'meta.json'));
    const govmapChanged = !meta || !meta.version || !v.govmap || meta.version.id !== v.govmap.id;
    /* the register: the sweep's copy is dated by scraped_at; a version detected after it is a newer copy */
    const regSwept = ev && ev.source ? String(ev.source.scrapedAt || '') : '';
    const registerChanged = !!(v.register && regSwept && Date.parse(v.register.detectedAt) > Date.parse(regSwept.replace(' ', 'T').replace(/\+00$/, 'Z')) + 3600e3);
    const line = { kind: 'check', at, engine: ENGINE, govmap: v.govmap && { id: v.govmap.id, n: v.govmap.n, detectedAt: v.govmap.detectedAt, rows: v.govmap.rows }, govmapVersions: v.govmapCount,
      register: v.register && { id: v.register.id, n: v.register.n, detectedAt: v.register.detectedAt }, registerVersions: v.registerCount,
      stored: meta && meta.version ? { id: meta.version.id, n: meta.version.n } : null, registerSwept: regSwept || null, govmapChanged, registerChanged, status: govmapChanged || registerChanged ? 'NEW_VERSION' : 'UNCHANGED' };
    appendRun(line);
    console.log(JSON.stringify(line));
    setOutput('govmap_changed', govmapChanged); setOutput('register_changed', registerChanged);
    const res = v.govmap && (v.govmap.resources.find((x) => /gpkg/i.test(x.format || x.url)) || v.govmap.resources.find((x) => /parquet/i.test(x.format || x.url)));
    setOutput('file_url', res ? res.url : '');
  } catch (e) {
    appendRun({ kind: 'check', at, engine: ENGINE, status: 'FAILED', error: e.message });
    console.error(e.message); setOutput('govmap_changed', false); setOutput('register_changed', false); process.exitCode = 1;
  }
}

/* ── --download: one GET of the public file the publisher lists for the version ── */
async function download(url, file) {
  if (!/^https:\/\/pub-[0-9a-f]+\.r2\.dev\/datasets\/4174aac2-c8b2-443e-9425-3773ce47c8da\//.test(url)) throw new Error('not the GovMap-layer dataset file: ' + url);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  const h = crypto.createHash('sha256');
  let bytes = 0;
  const tap = new (require('node:stream').Transform)({ transform(c, _e, cb) { h.update(c); bytes += c.length; cb(null, c); } });
  await pipeline(Readable.fromWeb(r.body), tap, fs.createWriteStream(file));
  const out = { url, file, bytes, sha256: h.digest('hex') };
  console.log(JSON.stringify(out));
  setOutput('file_sha', out.sha256); setOutput('file_bytes', bytes);
}

/* ── --build ── */
const FIELDS = ['deal_id', 'deal_date', 'deal_amount', 'settlement', 'street', 'house_num', 'gush', 'parcel', 'sub_parcel', 'asset_area', 'rooms', 'property_type', 'deal_nature'];
const lowerKeys = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
/** a file row → the API's field names (the file may name the object id differently) */
function apiRow(o0) {
  const o = lowerKeys(o0);
  if (o.objectid == null) o.objectid = o.fid != null ? o.fid : o.ogc_fid != null ? o.ogc_fid : o.id;
  if (o.deal_date != null) o.deal_date = String(o.deal_date).slice(0, 10);
  return o;
}
const norm = (v) => (v == null || v === '' ? null : typeof v === 'number' ? v : /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : String(v).trim());
const rowHash = (g) => crypto.createHash('sha1').update(JSON.stringify(FIELDS.map((k) => norm(g[k])))).digest('hex').slice(0, 10);
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function build() {
  const dir = opt('--extract');
  if (!dir) throw new Error('--extract <dir> is required');
  const schema = readJson(path.join(dir, 'schema.json'));
  if (!schema) throw new Error('no schema.json in the extract');
  const EV = require('../lib/streets/evidence'), SD = require('../lib/streets/directory'), M = require('../lib/streets/match');
  const REC = require('../lib/recent/reconcile'), W = require('../lib/recent/window');
  const S = EV.store();
  if (!S.available) throw new Error('no stored register copy');
  const regWin = S.meta.window, regLast = S.meta.source.lastDeal;
  const recentWin = W.windowOf(regLast);
  const checks = fs.existsSync(path.join(OUT, 'runs.jsonl')) ? fs.readFileSync(path.join(OUT, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const lastCheck = checks.filter((c) => c.kind === 'check' && c.govmap).pop() || null;
  const version = lastCheck ? lastCheck.govmap : null;
  const loadDay = version && version.detectedAt ? String(version.detectedAt).slice(0, 10) : schema.dates.max;
  const raw = readGz(path.join(dir, 'window.jsonl.gz')).map(apiRow);

  /* 1 · VALIDATE: the file is the copy the API serves — every row the recent sync read through the API (same version) is in the file
     with the same values, and the file holds no row of that window the API did not return */
  const idx = readJson(path.join(ROOT, 'data', 'streets', 'recent', 'raw', 'index.json'));
  const snap = idx && idx.snapshots.filter((x) => x.kind === 'window').pop();
  let validation = { checked: false, reason: 'no stored API window' };
  if (snap) {
    const api = readGz(path.join(ROOT, 'data', 'streets', 'recent', 'raw', snap.file));
    const byOid = new Map(raw.map((g) => [Number(g.objectid), g]));
    const from = snap.window.contextFrom || snap.window.from;
    const apiOids = new Set(api.map((g) => Number(g.objectid)));
    let same = 0, differs = 0, missing = 0; const diffs = [];
    for (const a of api) {
      const f = byOid.get(Number(a.objectid));
      if (!f) { missing++; continue; }
      if (rowHash(a) === rowHash(f)) same++; else { differs++; if (diffs.length < 8) diffs.push({ oid: a.objectid, api: FIELDS.map((k) => a[k]), file: FIELDS.map((k) => f[k]) }); }
    }
    const fileOnly = raw.filter((g) => g.deal_date >= from && g.deal_date <= String(snap.copy.loadedAt).slice(0, 10) && !apiOids.has(Number(g.objectid))).length;
    const sameVersion = !!(version && snap.copy && Number(snap.copy.version) === Number(version.n));
    validation = { checked: true, apiSnapshot: snap.sha256, apiCopyVersion: snap.copy.version, fileVersion: version ? version.n : null, sameVersion, apiRows: api.length, same, differs, missing, fileOnlyInApiWindow: fileOnly, examples: diffs,
      pass: sameVersion ? differs + missing + fileOnly <= Math.max(5, 0.002 * api.length) : true };
    if (!validation.pass) throw new Error('the file does not reproduce the API window: ' + JSON.stringify({ same, differs, missing, fileOnly, columns: schema.columns, examples: diffs.slice(0, 3) }));
  }

  /* 2 · RECONCILE every row from a week before the register's window to the copy's load day — the recent layer's own rules */
  const ctxFrom = W.minusDays(regWin.from, 7);
  const rows = raw.filter((g) => String(g.deal_date) >= ctxFrom);
  const D = SD.load();
  const rec = REC.reconcile(rows, { window: { from: regWin.from }, loadDay, EV, D, M });
  const out = rec.out;
  const periodOf = (d) => (d > loadDay ? 'future' : d < regWin.from ? 'before-window' : d < recentWin.from ? 'register-window' : d <= regLast ? 'recent-overlap' : 'after-register');
  const cls = (r) => out.get(r.oid).cls;
  const acc = {};
  const byCode = {};
  for (const r of rec.rows) {
    const p = periodOf(r.date), c = cls(r);
    (acc[p] = acc[p] || {})[c] = (acc[p][c] || 0) + 1;
    if (r.code != null && p !== 'future') { const L = (byCode[r.code] = byCode[r.code] || {}); L[c] = (L[c] || 0) + 1; }
  }
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const totals = Object.fromEntries(Object.entries(acc).map(([p, o]) => [p, sum(o)]));
  if (sum(totals) !== rec.rows.length) throw new Error('accounting does not add up');

  /* 3 · the rows PROPX does not hold in the register's window (before the recent layer's own window — those are the layer's): shown as
     events; and every possible duplicate, shown flagged — never counted */
  const SHOW = new Set(['RECENT_NEW', 'POSSIBLE_DUPLICATE_IN_SOURCE', 'AMBIGUOUS_DUPLICATE', 'POSSIBLY_IN_REGISTER']);
  const keep = rec.rows.filter((r) => SHOW.has(cls(r)) && r.date >= regWin.from && r.date < recentWin.from);
  const COLS = ['oid', 'dealId', 'series', 'date', 'amount', 'areaSqm', 'rooms', 'floor', 'propertyType', 'dealNature', 'kind', 'cityCode', 'settlement', 'street', 'house',
    'streetCode', 'streetBasis', 'block', 'parcel', 'subParcel', 'priced', 'pricePerSqm', 'twinOid', 'placedBy', 'class', 'register', 'conflicts'];
  const rowsOut = keep.map((r) => {
    const o = out.get(r.oid);
    const kind = o.kind || rec.kindOf(r);
    const st = o.street || rec.streetOf(r);
    const priced = r.amount != null && r.amount >= EV.MIN_MARKET;
    return [r.oid, r.dealId, r.series, r.date, r.amount, r.area, r.rooms, r.floor, r.type, r.nature, kind, r.code, r.settlement, r.street, r.house,
      st.code, st.basis, r.gush, r.parcel, r.sub, priced, priced && r.area != null && r.area >= EV.MIN_AREA ? Math.round(r.amount / r.area) : null, r.twin ? r.twin.oid : null, r.placedBy, o.cls,
      o.register ? `${o.register.date} ${o.register.unit} ${o.register.amount}` : null, (o.conflicts || []).map((c) => `${c.field}:${c.govmap}→${c.register}`).join(' · ') || null];
  });
  const idxCode = {}, idxStreet = {};
  rowsOut.forEach((x, i) => { (idxCode[x[11]] = idxCode[x[11]] || []).push(i); if (x[15] != null) (idxStreet[`st:${x[11]}:${x[15]}`] = idxStreet[`st:${x[11]}:${x[15]}`] || []).push(i); });

  /* 4 · the parcel → street recovery: the layer's own addresses of a register parcel the register's crosswalk left without a street */
  const LIs = new Map(); const LI = (c) => { if (!LIs.has(c)) LIs.set(c, M.localityIndex(D, c)); return LIs.get(c); };
  const want = new Map();                                   // "code|gush|parcel" → register state
  for (const f of fs.readdirSync(EV.DIR).filter((x) => /^\d+\.json$/.test(x))) {
    const sh = EV.shardOf(Number(f.replace('.json', ''))); if (!sh) continue;
    for (const p of sh.parcels) if (p[4] === 'NO_ADDRESS' || p[4] === 'UNRESOLVED') want.set(`${sh.cityCode}|${Number(p[0])}|${Number(p[1])}`, p[4]);
  }
  const place = (() => { const names = new Map(); for (const f of fs.readdirSync(EV.DIR).filter((x) => /^\d+\.json$/.test(x))) { const sh = EV.shardOf(Number(f.replace('.json', ''))); if (sh) for (const n of sh.settlements || []) { const k = REC.normCity(n); if (!names.has(k)) names.set(k, new Set()); names.get(k).add(sh.cityCode); } }
    for (const l of D.localities.values()) { const k = REC.normCity(l.he); if (!names.has(k)) names.set(k, new Set()); names.get(k).add(l.code); }
    return (n) => { const s = names.get(REC.normCity(n)); return s && s.size === 1 ? [...s][0] : null; }; })();
  const addrs = new Map();                                  // key → {addresses:Set, rows, last}
  const parcelFile = path.join(dir, 'parcels.jsonl.gz');
  let parcelKeys = 0, placedKeys = 0;
  if (fs.existsSync(parcelFile)) {
    for (const [settlement, gush, parcel, street, house, n, , last] of readGz(parcelFile)) {
      parcelKeys++;
      if (!street) continue;
      const code = settlement ? place(settlement) : null;
      if (code == null) continue;
      const k = `${code}|${Number(gush)}|${Number(parcel)}`;
      if (!want.has(k)) continue;
      placedKeys++;
      const a = addrs.get(k) || { addresses: new Set(), rows: 0, last: null };
      a.addresses.add(`${String(street).trim()}${house != null && house !== '' ? ' ' + String(house).trim() : ''}`);
      a.rows += n; if (last && (!a.last || last > a.last)) a.last = last;
      addrs.set(k, a);
    }
  }
  const parcelStreets = {};
  const recTally = {};
  for (const [k, a] of addrs) {
    const [code, gush, parcel] = k.split('|');
    const m = M.matchDeal(LI(Number(code)), [...a.addresses], a.addresses.size);
    recTally[m.state] = (recTally[m.state] || 0) + 1;
    if (!m.streets.length) continue;
    (parcelStreets[code] = parcelStreets[code] || {})[`${gush}|${parcel}`] = [m.state, m.streets.map((s) => [Number(String(s.id).split(':')[2]), s.via, s.houses]), m.reasons, a.rows, a.last];
  }

  /* 5 · new / changed / removed against the last build (object id → row hash over the window) */
  const hashes = {};
  for (const r of raw) if (String(r.deal_date) >= regWin.from) hashes[r.objectid] = rowHash(r);
  const prevFile = path.join(OUT, 'rowhash.json.gz');
  const prev = fs.existsSync(prevFile) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(prevFile)).toString('utf8')) : null;
  let diff = { previous: null };
  if (prev && prev.rows) {
    let added = 0, changed = 0, removed = 0;
    for (const [o, h] of Object.entries(hashes)) { if (!(o in prev.rows)) added++; else if (prev.rows[o] !== h) changed++; }
    for (const o of Object.keys(prev.rows)) if (!(o in hashes)) removed++;
    diff = { previous: prev.version || null, added, changed, removed };
  }

  const builtAt = new Date().toISOString();
  const code = crypto.createHash('sha256').update(fs.readFileSync(__filename)).update(fs.readFileSync(require.resolve('../lib/recent/reconcile'))).update(fs.readFileSync(path.join(__dirname, 'txevents-gpkg.py'))).digest('hex').slice(0, 16);
  const shownKinds = tally(rowsOut.filter((x) => x[24] === 'RECENT_NEW').map((x) => x[10]));
  const meta = {
    schema: 1, engine: ENGINE, builtAt, code,
    source: { id: 'over:govmap-national', name: 'GovMap deals layer (lay=16) — the published file of the republished copy (over.org.il)', datasetId: GOVMAP_DS, channel: 'independent-republication' },
    version, file: { url: opt('--file-url') || null, sha256: opt('--file-sha') || null, bytes: opt('--file-bytes') ? Number(opt('--file-bytes')) : null, table: schema.table, columns: schema.columns, rowsTotal: schema.total, rowsRead: schema.read, dates: schema.dates, years: schema.years },
    register: { scrapedAt: S.meta.source.scrapedAt, lastDeal: regLast, window: regWin }, recentWindow: { from: recentWin.from, to: loadDay }, loadDay,
    windowRows: raw.length, reconciledRows: rec.rows.length, validation,
    classes: acc, totals,
    shown: { govmapOnly: rowsOut.filter((x) => x[24] === 'RECENT_NEW').length, possibleDuplicates: rowsOut.filter((x) => x[24] !== 'RECENT_NEW').length, kinds: shownKinds,
      latest: rowsOut.filter((x) => x[24] === 'RECENT_NEW').map((x) => x[3]).sort().pop() || null, localities: Object.keys(idxCode).length, streets: Object.keys(idxStreet).length },
    parcelRecovery: { registerParcelsWithoutStreet: want.size, layerAddressKeys: parcelKeys, keysOnThoseParcels: placedKeys, parcelsWithLayerAddress: addrs.size, states: recTally,
      recovered: Object.values(parcelStreets).reduce((a, o) => a + Object.keys(o).length, 0) },
    diff,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'govmap-only.json'), JSON.stringify({ schema: 1, builtAt, version: version && version.id, columns: COLS, rows: rowsOut, byCode: idxCode, byStreet: idxStreet }) + '\n');
  fs.writeFileSync(path.join(OUT, 'accounting.json'), JSON.stringify({ schema: 1, builtAt, version: version && version.id, periods: { before: `< ${regWin.from}`, registerWindow: `${regWin.from} … ${W.minusDays(recentWin.from, 1)}`, recentOverlap: `${recentWin.from} … ${regLast}`, afterRegister: `> ${regLast} … ${loadDay}`, future: `> ${loadDay}` }, classes: acc, totals, byCode }, null, 0) + '\n');
  fs.writeFileSync(path.join(OUT, 'parcel-streets.json'), JSON.stringify({ schema: 1, builtAt, version: version && version.id, columns: ['state', 'streets', 'reasons', 'layerRows', 'layerLastDate'], byCode: parcelStreets }) + '\n');
  fs.writeFileSync(prevFile, zlib.gzipSync(JSON.stringify({ version: version && version.id, rows: hashes })));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
  appendRun({ kind: 'build', at: builtAt, engine: ENGINE, version: version && { id: version.id, n: version.n }, status: 'SUCCESS', windowRows: raw.length, shown: meta.shown, diff, validation: { pass: validation.pass, same: validation.same, differs: validation.differs, missing: validation.missing } });
  console.log(JSON.stringify({ ok: true, totals, shown: meta.shown, parcelRecovery: meta.parcelRecovery, validation: { pass: validation.pass, same: validation.same, differs: validation.differs, missing: validation.missing, fileOnly: validation.fileOnlyInApiWindow }, diff }));
}

(async () => {
  try {
    if (args.includes('--check')) await check();
    else if (args.includes('--download')) await download(opt('--url') || process.env.FILE_URL, opt('--out'));
    else if (args.includes('--build')) build();
    else { console.error('usage: --check | --download --url <u> --out <file> | --build --extract <dir>'); process.exit(2); }
  } catch (e) { console.error('txevents-national: ' + e.message); appendRun({ kind: args.includes('--build') ? 'build' : 'other', at: new Date().toISOString(), engine: ENGINE, status: 'FAILED', error: e.message }); process.exit(1); }
})();
