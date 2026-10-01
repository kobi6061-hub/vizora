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
//   node scripts/housing-discover.js --audit         source completeness of the lottery table
//   node scripts/housing-discover.js --audit-more    the audit's follow-ups (Land Authority, change log, stats page)
//   node scripts/housing-discover.js --search 'עסקאות נדלן|רשות המסים'   catalogue search for any terms
//   node scripts/housing-discover.js --locality 1061 --names 'נוף הגליל,נצרת עילית'   official registry rows of one locality
//   node scripts/housing-discover.js --deals-republished 'באר שבע'   the open republication of the deals register (over.org.il)
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

/* SOURCE-COMPLETENESS AUDIT (read-only): is 7c8255d0 still the authoritative
   structured source, where does its event horizon end and why, and is there
   any other official structured publication of later lotteries? */
const CORE = '7c8255d0-49ef-49db-8904-4cf917586031';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
async function audit() {
  const { createHash } = require('node:crypto');
  // 1 · the core resource and every sibling in its package, with every date CKAN keeps
  const res = await ck('resource_show', { id: CORE });
  const pkg = await ck('package_show', { id: res.package_id });
  out({ kind: 'auditPackage', name: pkg.name, title: pkg.title, org: pkg.organization && pkg.organization.title, orgName: pkg.organization && pkg.organization.name,
    metadata_created: pkg.metadata_created, metadata_modified: pkg.metadata_modified, notes: trim(pkg.notes, 900),
    extras: (pkg.extras || []).map((e) => `${e.key}=${trim(e.value, 120)}`), tags: (pkg.tags || []).map((t) => t.name) });
  for (const r of pkg.resources) {
    out({ kind: 'auditResource', id: r.id, name: r.name, format: r.format, datastore_active: r.datastore_active, created: r.created,
      last_modified: r.last_modified, metadata_modified: r.metadata_modified, size: r.size, hash: r.hash || null, url: trim(r.url, 220),
      description: trim(r.description, 400), url_type: r.url_type || null, mimetype: r.mimetype || null });
    if (!r.datastore_active || r.id === CORE) continue;
    try {
      const ds = await ck('datastore_search', { resource_id: r.id, limit: 1 });
      out({ kind: 'auditSibling', id: r.id, total: ds.total, fields: ds.fields.map((f) => f.id).slice(0, 60) });
    } catch (e) { out({ kind: 'auditSibling', id: r.id, error: e.message }); }
  }
  // 2 · the core table itself: event horizon by every date field, by programme, by marketing body, by year
  const { rows, total, fields } = await allRows(CORE);
  const dates = (f) => rows.map((r) => (DATE_RE.exec(String(r[f] || '')) || [])[0]).filter(Boolean).sort();
  const byYear = {}, byProgYear = {};
  for (const r of rows) {
    const y = (DATE_RE.exec(String(r.LotteryExecutionDate || '')) || [])[1] || 'none';
    byYear[y] = (byYear[y] || 0) + 1;
    const k = `${r.MarketingMethodDesc}|${r.MarketingRep}|${r.LotteryType}`;
    byProgYear[k] = byProgYear[k] || {}; byProgYear[k][y] = (byProgYear[k][y] || 0) + 1;
  }
  const exec = dates('LotteryExecutionDate'), signup = dates('LotteryEndSignupDate');
  out({ kind: 'auditCore', total, fetched: rows.length, fields: fields.map((f) => `${f.id}:${f.type}`),
    lotteryDate: { min: exec[0], max: exec[exec.length - 1], n: exec.length }, signupEnd: { min: signup[0], max: signup[signup.length - 1], n: signup.length },
    byYear, byProgrammeBodyType: byProgYear,
    maxLotteryId: Math.max(...rows.map((r) => Number(r.LotteryId) || 0)), maxRowId: Math.max(...rows.map((r) => Number(r._id) || 0)),
    newestByRowId: rows.slice().sort((a, b) => Number(b._id) - Number(a._id)).slice(0, 3).map((r) => ({ _id: r._id, LotteryId: r.LotteryId, LotteryExecutionDate: r.LotteryExecutionDate, LamasName: r.LamasName })),
    highestLotteryIds: rows.slice().sort((a, b) => Number(b.LotteryId) - Number(a.LotteryId)).slice(0, 5).map((r) => ({ LotteryId: r.LotteryId, LotteryExecutionDate: r.LotteryExecutionDate, LotteryStatusValue: r.LotteryStatusValue, LamasName: r.LamasName })) });
  // did the CONTENT change since PROPX's stored snapshot? (same hash rule as lib/housing/normalize.js)
  const hash = createHash('sha1').update(JSON.stringify(rows.map((r) => { const { _id, ...rest } = r; return rest; }).map((r) => JSON.stringify(r)).sort())).digest('hex');
  out({ kind: 'auditHash', hash, matchesPropxSnapshot: hash === (process.env.PROPX_SNAPSHOT_HASH || '') });
  // 3 · the original file behind the resource (the CKAN datastore is loaded from it): its own headers
  if (res.url) {
    try {
      const r = await fetch(res.url, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow' });
      out({ kind: 'auditFile', url: trim(res.url, 220), status: r.status, lastModified: r.headers.get('last-modified'), etag: r.headers.get('etag'),
        length: r.headers.get('content-length'), type: r.headers.get('content-type') });
    } catch (e) { out({ kind: 'auditFile', url: trim(res.url, 220), error: e.message }); }
  }
  // 4 · every dataset of the two publishing bodies (Ministry of Construction and Housing; Israel Land Authority)
  for (const q of [`organization:${pkg.organization && pkg.organization.name}`, 'organization:israel-land-authority', 'organization:rmi', 'organization:rami']) {
    try {
      const r = await ck('package_search', { fq: q, rows: 200 });
      out({ kind: 'auditOrg', fq: q, count: r.count, packages: r.results.map((p) => ({ name: p.name, title: p.title, modified: p.metadata_modified, resources: p.num_resources })) });
    } catch (e) { out({ kind: 'auditOrg', fq: q, error: e.message }); }
  }
  try {
    const orgs = await ck('organization_list', { all_fields: true, limit: 500 });
    out({ kind: 'auditOrgList', orgs: orgs.filter((o) => /בינוי|שיכון|מקרקעי|דיור|housing|land/i.test(`${o.title} ${o.name}`)).map((o) => ({ name: o.name, title: o.title, packages: o.package_count })) });
  } catch (e) { out({ kind: 'auditOrgList', error: e.message }); }
  // 5 · a wider catalogue search for a successor or parallel publication of later lotteries
  const seen = new Set();
  for (const q of ['הגרלה', 'הגרלות', 'הגרלות דירה בהנחה', 'דירה בהנחה', 'מחיר למשתכן', 'מחיר מטרה', 'דיור בהישג יד', 'דיור מוזל', 'זוכים בהגרלה',
    'מגרשים לבנייה עצמית', 'דירות בהנחה רמ"י', 'משרד הבינוי והשיכון הגרלות', 'lottery', 'dira behanacha', 'affordable housing', 'mechir lamishtaken']) {
    try {
      const r = await ck('package_search', { q, rows: 40 });
      const hits = r.results.filter((p) => !seen.has(p.name));
      hits.forEach((p) => seen.add(p.name));
      out({ kind: 'auditSearch', q, count: r.count, hits: hits.map((p) => ({ name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified,
        resources: (p.resources || []).map((x) => ({ id: x.id, name: x.name, ds: x.datastore_active, last_modified: x.last_modified })) })) });
    } catch (e) { out({ kind: 'auditSearch', q, error: e.message }); }
  }
  // 6 · the Ministry's lottery website (an official PAGE — recorded, not an open-data contract)
  for (const u of ['https://www.dira.moch.gov.il/', 'https://www.dira.moch.gov.il/ProjectsList']) {
    try {
      const r = await get(u, 'text/html');
      out({ kind: 'auditSite', url: u, status: r.status, type: r.type, bytes: r.text.length,
        scripts: [...r.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).slice(0, 10), title: (/<title>([^<]*)<\/title>/i.exec(r.text) || [])[1] || null });
    } catch (e) { out({ kind: 'auditSite', url: u, error: e.message }); }
  }
}

// --audit-more · the follow-ups of --audit: the Land Authority's own datasets, the dataset's
// change log (when the portal exposes it), every key CKAN keeps on the resource, a
// resource-level name search, and the weekly-statistics page the dataset itself links to.
async function auditMore() {
  const res = await ck('resource_show', { id: CORE });
  out({ kind: 'auditResourceKeys', keys: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, trim(v, 160)])) });
  for (const [action, params] of [['package_activity_list', { id: res.package_id, limit: 100 }], ['resource_view_list', { id: CORE }]]) {
    try {
      const r = await ck(action, params);
      out({ kind: 'auditActivity', action, n: Array.isArray(r) ? r.length : null,
        items: (Array.isArray(r) ? r : []).slice(0, 100).map((a) => ({ t: a.timestamp, type: a.activity_type || a.view_type,
          res: a.data && a.data.package && (a.data.package.resources || []).filter((x) => x.id === CORE).map((x) => ({ lm: x.last_modified, size: x.size }))[0] })) });
    } catch (e) { out({ kind: 'auditActivity', action, error: e.message }); }
  }
  try {
    const r = await ck('package_search', { fq: 'organization:the_israel_lands_administration', rows: 200 });
    out({ kind: 'auditOrgRmi', count: r.count, packages: r.results.map((p) => ({ name: p.name, title: p.title, modified: p.metadata_modified,
      resources: (p.resources || []).map((x) => ({ id: x.id, name: trim(x.name, 90), ds: x.datastore_active, lm: x.last_modified })) })) });
  } catch (e) { out({ kind: 'auditOrgRmi', error: e.message }); }
  for (const query of ['name:הגרל', 'name:זוכים', 'name:דירה בהנחה', 'name:מחיר למשתכן', 'name:משתכן', 'description:הגרלות']) {
    try {
      const r = await ck('resource_search', { query, limit: 50 });
      out({ kind: 'auditResourceSearch', query, count: r.count, hits: (r.results || []).map((x) => ({ id: x.id, name: trim(x.name, 90), pkg: x.package_id, ds: x.datastore_active, lm: x.last_modified })) });
    } catch (e) { out({ kind: 'auditResourceSearch', query, error: e.message }); }
  }
  for (const u of ['https://www.gov.il/he/Departments/publications/reports/mishtaken_statistics', 'https://www.gov.il/en/Departments/publications/reports/mishtaken_statistics']) {
    try {
      const r = await get(u, 'text/html');
      const links = [...r.text.matchAll(/href="([^"]+\.(?:xlsx?|csv|pdf|zip))"/gi)].map((m) => m[1]);
      out({ kind: 'auditStatsPage', url: u, status: r.status, type: r.type, bytes: r.text.length, title: (/<title>([^<]*)<\/title>/i.exec(r.text) || [])[1] || null,
        files: links.slice(0, 40), nFiles: links.length, dates: [...new Set((r.text.match(/\b\d{1,2}[./]\d{1,2}[./](?:20)?2[4-6]\b/g) || []))].slice(0, 40) });
    } catch (e) { out({ kind: 'auditStatsPage', url: u, error: e.message }); }
  }
}

// --locality <code> [--names a,b] · identity evidence for the geography registry: the rows of
// every official data.gov.il registry that carries a locality-code column (locality list, street
// registry …) for one CBS code and for its names (current and former). Read-only.
async function locality(code, names) {
  const cands = new Map();
  for (const q of ['רשימת ישובים', 'ישובים', 'יישובים', 'רחובות', 'סמל ישוב']) {
    try {
      const r = await ck('package_search', { q, rows: 20 });
      for (const p of r.results) for (const x of p.resources || []) if (x.datastore_active && !cands.has(x.id))
        cands.set(x.id, { pkg: p.name, title: p.title, org: p.organization && p.organization.title, name: x.name, lm: x.last_modified });
    } catch (e) { out({ kind: 'localitySearch', q, error: e.message }); }
  }
  const row = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== '_id' && k !== 'rank').map(([k, v]) => [k, trim(v, 60)]));
  for (const [id, c] of [...cands].slice(0, 40)) {
    let ds;
    try { ds = await ck('datastore_search', { resource_id: id, limit: 0 }); } catch { continue; }
    const codeF = ds.fields.map((f) => f.id).find((f) => /סמל.?ישוב|semel.?yeshuv|semel.?yishuv|city.?code|city.?symbol/i.test(f));
    if (!codeF) continue;
    const hit = {};
    for (const [k, params] of [['byCode', { filters: { [codeF]: Number(code) } }], ['byCodeText', { filters: { [codeF]: String(code) } }], ...names.map((n) => ['q:' + n, { q: n }])]) {
      try { const r = await ck('datastore_search', { resource_id: id, limit: 3, ...params }); hit[k] = { total: r.total, rows: r.records.map(row) }; }
      catch (e) { hit[k] = { error: trim(e.message, 140) }; }
    }
    out({ kind: 'locality', resource: id, ...c, total: ds.total, codeField: codeF, fields: ds.fields.map((f) => f.id).slice(0, 25), hit });
  }
}

// --search "q1|q2|…" · catalogue search for arbitrary terms: every matching dataset with its
// publisher and resources (format, datastore, dates) — to find official open data. Read-only.
async function search(terms) {
  for (const q of terms) {
    try {
      const r = await ck('package_search', { q, rows: 20 });
      out({ kind: 'search', q, count: r.count, hits: r.results.map((p) => ({ name: p.name, title: trim(p.title, 90), org: p.organization && p.organization.title,
        modified: p.metadata_modified, resources: (p.resources || []).map((x) => ({ id: x.id, name: trim(x.name, 70), format: x.format, ds: x.datastore_active, lm: x.last_modified })) })) });
    } catch (e) { out({ kind: 'search', q, error: e.message }); }
  }
}

// --deals-republished [city] · the open republication of the Tax Authority's deals register by
// גרסאות לעם (over.org.il): its documentation, licence and project pages (text near the relevant
// words), the deals API's answer for one city, and any machine-readable spec. Read-only, a dozen
// sequential requests — to decide on evidence whether and how PROPX may use it.
async function dealsRepublished(city = 'באר שבע') {
  const BASE = 'https://www.over.org.il';
  const plain = (s) => String(s).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const near = (txt, re, w = 220, max = 12) => { const hits = []; let m; const g = new RegExp(re.source, 'gi');
    while ((m = g.exec(txt)) && hits.length < max) { hits.push(txt.slice(Math.max(0, m.index - w), m.index + w)); g.lastIndex = m.index + w; } return hits; };
  for (const p of ['/api', '/projects/deals', '/about']) {
    try {
      const r = await get(BASE + p, 'text/html');
      const txt = plain(r.text);
      out({ kind: 'republishedPage', url: BASE + p, status: r.status, type: r.type, chars: txt.length,
        links: [...new Set((r.text.match(/["'(](\/api\/[^"' )<>]{1,120})/g) || []).map((x) => x.slice(1)))].slice(0, 80),
        deals: near(txt, /deals|עסקא|עסקת/), licence: near(txt, /רישיון|רשיון|licen[cs]e|creative commons|CC[ -]BY|תנאי שימוש|terms/, 260, 8),
        freshness: near(txt, /עודכן|עדכון|updated|נכון ל|1998|2026|מיליון/, 200, 8) });
    } catch (e) { out({ kind: 'republishedPage', url: BASE + p, error: e.message }); }
  }
  const q = encodeURIComponent(city);
  for (const p of ['/api/deals', '/api/deals/search', `/api/deals/search?city=${q}&limit=3`, `/api/deals/search?settlement=${q}&limit=3`,
    `/api/deals/search?q=${q}&limit=3`, '/api/openapi.json', '/api/deals/openapi.json', '/openapi.json', '/api/docs']) {
    try {
      const r = await get(BASE + p);
      let j = null; try { j = JSON.parse(r.text); } catch { /* not JSON */ }
      const first = j && (Array.isArray(j) ? j[0] : (j.results || j.data || j.deals || j.items || [])[0]);
      out({ kind: 'republishedApi', url: BASE + p, status: r.status, type: r.type,
        keys: j && !Array.isArray(j) ? Object.keys(j).slice(0, 40) : null, total: j && (j.total ?? j.count ?? j.totalCount ?? null),
        first: first ? trim(first, 900) : null, excerpt: j ? trim(j, 700) : trim(plain(r.text), 400) });
    } catch (e) { out({ kind: 'republishedApi', url: BASE + p, error: e.message }); }
  }
}

async function main() {
  const one = argVal('resource');
  if (process.argv.includes('--deals-republished')) return dealsRepublished(argVal('deals-republished') || undefined);
  if (process.argv.includes('--search')) return search((argVal('search') || '').split('|').map((x) => x.trim()).filter(Boolean));
  if (process.argv.includes('--locality')) return locality(argVal('locality'), (argVal('names') || '').split(',').map((x) => x.trim()).filter(Boolean));
  if (process.argv.includes('--audit-more')) return auditMore();
  if (process.argv.includes('--audit')) return audit();
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
