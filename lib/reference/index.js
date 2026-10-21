// PROPX · OFFICIAL REFERENCE DATASETS (21.10.2026, the master data directive §5/§6): whole-resource reads of official open datasets that
// describe a PLACE (a locality, a statistical area, a station) rather than a market event — read whole from the publisher's own CKAN
// datastore (data.gov.il), complete or nothing, schema-guarded, normalized on official codes only (CBS locality code; never a name),
// stored with their source update time, PROPX's read time and an append-only history of every content change.
//
//   census-2022        CBS · Population and Housing Census 2022 — selected figures per locality and per statistical area (one observation:
//                      2022, published 2024). Population, households, ownership / rent shares, wages, age, education, vehicles.
//   residents          Population and Immigration Authority · registered residents per locality and age band (weekly; the resource is
//                      replaced in place — PROPX keeps its own dated history). REGISTERED residents ≠ CBS population estimates.
// A figure is CONTEXT for its own geography only: a locality's figure is never a street's, and a census figure is never "current".

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const DIR = process.env.REFERENCE_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'reference');
const CKAN = process.env.GOV_DATAGOV_BASE || 'https://data.gov.il/api/3/action';
const UA = 'PROPX-data-sync/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';

const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const code = (v) => { const n = num(v); return n !== null && Number.isInteger(n) && n > 0 ? n : null; };

/* ── the sources ── */
const SOURCES = Object.freeze({
  'census-2022': {
    id: 'census-2022', trustId: 'datagov:cbs:census-2022',
    title: 'מפקד האוכלוסין והדיור 2022 — נתונים נבחרים לפי יישובים ואזורים סטטיסטיים', titleEn: 'Population and Housing Census 2022 — selected figures by locality and statistical area',
    publisher: 'הלשכה המרכזית לסטטיסטיקה', publisherEn: 'Central Bureau of Statistics', package: '2022', resourceId: '9a9e085f-3bc8-41df-b15f-be0daaf99e30',
    page: 'https://data.gov.il/dataset/2022', licence: 'Other (Open) — data.gov.il terms of use', cadence: 'once per census (2022 observation, published 2024)',
    classification: 'OFFICIAL', period: 'census 2022', snapshot: false,
    required: ['LocalityCode', 'pop_approx'],
    normalize(r) {
      const loc = code(r.LocalityCode);
      const sa = code(r.StatArea);
      const level = loc === null ? (/כלל ארצי/.test(r.LocNameHeb || '') ? 'national' : null) : sa === null ? 'locality' : 'statArea';
      if (!level) return null;
      return { key: level === 'national' ? 'il' : level === 'locality' ? `loc:${loc}` : `sa:${loc}:${sa}`, level, locality: loc, statArea: sa, name: r.LocNameHeb || null,
        population: num(r.pop_approx), change2008Pct: num(r.change_pcnt), density: num(r.pop_density), ageMedian: num(r.age_median), households: num(r.hh_total_approx),
        householdSize: num(r.size_avg), ownPct: num(r.own_pcnt), rentPct: num(r.rent_pcnt), academicPct: num(r.AcadmCert_pcnt), employedPct: num(r.Empl_pcnt),
        employeeMedianWage: num(r.employeesAnnual_medWage), selfEmployedMedianWage: num(r.SelfEmployedAnnual_medWage), noVehiclePct: num(r.Vehicle0_pcnt),
        twoPlusVehiclesPct: num(r.Vehicle2up_pcnt), parkingPct: num(r.Parking_pcnt), religion: r.ReligionHeb || r.religion || null };
    },
  },
  residents: {
    id: 'residents', trustId: 'datagov:piba:residents-by-locality',
    title: 'תושבים בישראל לפי ישובים וקבוצות גיל — מתעדכן', titleEn: 'Registered residents by locality and age group (updated)',
    publisher: 'רשות האוכלוסין וההגירה', publisherEn: 'Population and Immigration Authority', package: 'residents_in_israel_by_communities_and_age_groups',
    resourceId: '64edd0ee-3d5d-43ce-8562-c336c24dbc1f', page: 'https://data.gov.il/dataset/residents_in_israel_by_communities_and_age_groups',
    licence: 'not stated by the publisher — data.gov.il terms of use', cadence: 'weekly (the resource is replaced in place)', classification: 'OFFICIAL', period: 'register snapshot', snapshot: true,
    required: ['סמל_ישוב', 'סהכ'],
    normalize(r) {
      const loc = code(r['סמל_ישוב']); if (loc === null) return null;
      return { key: `loc:${loc}`, level: 'locality', locality: loc, name: (r['שם_ישוב'] || '').trim() || null, subDistrict: (r['נפה'] || '').trim() || null,
        regionalCouncil: (r['מועצה_אזורית'] || '').trim() || null, residents: num(r['סהכ']),
        age: { '0-5': num(r['גיל_0_5']), '6-18': num(r['גיל_6_18']), '19-45': num(r['גיל_19_45']), '46-55': num(r['גיל_46_55']), '56-64': num(r['גיל_56_64']), '65+': num(r['גיל_65_פלוס']) } };
    },
  },
});

/* ── the read: every row of the resource, in a stable order, complete or an error ── */
async function ckan(action, params, fetchImpl) {
  const u = new URL(CKAN + '/' + action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetchImpl(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`${action}: HTTP ${r.status}, not JSON`); }
  if (!j.success) throw new Error(`${action}: HTTP ${r.status}, ${JSON.stringify(j.error).slice(0, 200)}`);
  return j.result;
}
async function fetchAll(src, { fetchImpl = globalThis.fetch } = {}) {
  const meta = await ckan('resource_show', { id: src.resourceId }, fetchImpl);
  const rows = []; let total = null, fields = null;
  for (let offset = 0; ;) {
    const r = await ckan('datastore_search', { resource_id: src.resourceId, limit: 1000, offset, sort: '_id asc' }, fetchImpl);
    total = r.total; fields = fields || r.fields.map((f) => f.id);
    rows.push(...r.records); offset += r.records.length;
    if (!r.records.length || rows.length >= total) break;
  }
  const ids = new Set(rows.map((x) => x._id));
  if (rows.length !== total || ids.size !== total) throw new Error(`incomplete read: ${rows.length} rows (${ids.size} distinct) of ${total}`);
  const lost = src.required.filter((c) => !fields.includes(c));
  if (lost.length) throw new Error('schema changed — missing field(s): ' + lost.join(', '));
  const lm = meta.last_modified || meta.metadata_modified || null;
  return { rows, total, fields, sourceUpdatedAt: lm ? lm + (/[zZ]|[+-]\d\d:?\d\d$/.test(lm) ? '' : 'Z') : null, endpoint: `${CKAN}/datastore_search?resource_id=${src.resourceId}` };
}

/* ── the store: data/reference/<id>/{rows.json.gz, meta.json, runs.jsonl, history/<date>-<hash8>.json.gz} ── */
const hashOf = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function write(src, read, { now = new Date().toISOString(), dir = DIR } = {}) {
  const d = path.join(dir, src.id); fs.mkdirSync(path.join(d, 'history'), { recursive: true });
  const rejected = [];
  const recs = [];
  for (const r of read.rows) { const n = src.normalize(r); if (n) recs.push(n); else rejected.push(r._id); }
  recs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const keys = new Set(recs.map((r) => r.key));
  if (keys.size !== recs.length) throw new Error(`duplicate keys: ${recs.length - keys.size}`);
  const contentHash = hashOf(recs);
  const prev = readMeta(src.id, dir);
  const changed = !prev || prev.contentHash !== contentHash;
  if (changed) {
    const gz = zlib.gzipSync(JSON.stringify(recs));
    fs.writeFileSync(path.join(d, 'rows.json.gz'), gz);
    fs.writeFileSync(path.join(d, 'history', `${now.slice(0, 10)}-${contentHash.slice(0, 8)}.json.gz`), gz);
  }
  const meta = { schema: 1, id: src.id, trustId: src.trustId, title: src.title, titleEn: src.titleEn, publisher: src.publisher, publisherEn: src.publisherEn,
    resourceId: src.resourceId, page: src.page, endpoint: read.endpoint, licence: src.licence, cadence: src.cadence, period: src.period, classification: src.classification,
    sourceUpdatedAt: read.sourceUpdatedAt, checkedAt: now, readAt: changed ? now : prev.readAt, contentHash, sourceRows: read.total, records: recs.length, rejected: rejected.length,
    byLevel: recs.reduce((a, r) => ((a[r.level] = (a[r.level] || 0) + 1), a), {}), fields: read.fields, history: fs.readdirSync(path.join(d, 'history')).sort() };
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(meta, null, 1));
  return { meta, changed, rejected };
}
function logRun(id, run, dir = DIR) { const d = path.join(dir, id); fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(path.join(d, 'runs.jsonl'), JSON.stringify(run) + '\n'); }
function readMeta(id, dir = DIR) { try { return JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')); } catch { return null; } }

/* ── the read model (memoised per content hash) ── */
const CACHE = new Map();
function table(id, dir = DIR) {
  const meta = readMeta(id, dir);
  if (!meta) return null;
  const k = dir + '|' + id + '|' + meta.contentHash;
  if (CACHE.has(k)) return CACHE.get(k);
  let rows = [];
  try { rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, id, 'rows.json.gz')))); } catch { return null; }
  const t = { meta, byKey: new Map(rows.map((r) => [r.key, r])), byLocality: rows.reduce((m, r) => { if (r.level === 'statArea') { const l = m.get(r.locality) || []; l.push(r); m.set(r.locality, l); } return m; }, new Map()) };
  CACHE.set(k, t);
  return t;
}
const provenance = (m) => ({ id: m.id, trustId: m.trustId, title: m.title, titleEn: m.titleEn, publisher: m.publisher, publisherEn: m.publisherEn, page: m.page, licence: m.licence,
  period: m.period, sourceUpdatedAt: m.sourceUpdatedAt, readAt: m.readAt, checkedAt: m.checkedAt, classification: m.classification });

/** a locality's official context: census 2022 (+ its statistical areas, listed, never placed on a street) and the registered residents */
function locality(cityCode, dir = DIR) {
  const c = table('census-2022', dir), r = table('residents', dir), n = Number(cityCode);
  const census = c ? c.byKey.get(`loc:${n}`) || null : null, res = r ? r.byKey.get(`loc:${n}`) || null : null;
  return {
    census: census ? { ...census, statAreas: (c.byLocality.get(n) || []).length, source: provenance(c.meta) } : null,
    censusMissing: !c ? 'reference-not-synced' : census ? null : 'locality-not-in-census-table',
    residents: res ? { ...res, source: provenance(r.meta) } : null,
    residentsMissing: !r ? 'reference-not-synced' : res ? null : 'locality-not-in-register-table',
    national: c && c.byKey.get('il') ? { population: c.byKey.get('il').population, households: c.byKey.get('il').households, ownPct: c.byKey.get('il').ownPct, rentPct: c.byKey.get('il').rentPct, employeeMedianWage: c.byKey.get('il').employeeMedianWage } : null,
    note: 'Census 2022 is one observation (2022, published 2024), never current; registered residents are the population register (weekly), not CBS population estimates — two universes, never mixed. A locality figure describes the locality, never one street.',
  };
}
function status(dir = DIR) { return Object.keys(SOURCES).map((id) => { const m = readMeta(id, dir); return m ? { id, ...provenance(m), records: m.records, byLevel: m.byLevel } : { id, missing: 'reference-not-synced' }; }); }

module.exports = { SOURCES, fetchAll, write, logRun, readMeta, table, locality, status, DIR };
