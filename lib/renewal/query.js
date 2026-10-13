// PROPX · Urban renewal — read model (served by api/intel.js: view=renewal, view=renewalComplex).
//
// Pure functions over data/renewal/ (written by scripts/renewal-sync.js). Every figure is the Ministry's own value or
// a labelled count / sum over it; a unit total is summed only over the complexes that publish that column and says how
// many those are. A declared complex is not construction; the status is the Ministry's, verbatim.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { STAGES } = require('./normalize');
const { SOURCE } = require('./source');

const DIR = process.env.RENEWAL_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'renewal');
let CACHE = null;
function load(dir = DIR) {
  let stamp; try { stamp = fs.statSync(path.join(dir, 'meta.json')).mtimeMs; } catch { stamp = null; }
  if (CACHE && CACHE.dir === dir && CACHE.stamp === stamp) return CACHE;
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };
  const records = read('complexes.json', []);
  /* records stored by normalizer v1 carry no declaration field: derived from the same two source columns, the same rule */
  for (const r of records) if (!r.declaration) r.declaration = r.declarationDate ? 'declared' : r.track === 'טרם הוכרז' ? 'not-yet-declared' : 'not-stated';
  CACHE = { dir, stamp, meta: read('meta.json', null), records, live: records.filter((r) => r.inLatestSource !== false), byId: new Map(records.map((r) => [r.id, r])) };
  return CACHE;
}
const key = (s) => String(s || '').normalize('NFKC').replace(/[׳'`’‘״"“”.,\-()]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const str = (v, max = 120) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const clampInt = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const sumOf = (rows, k) => { const v = rows.map((r) => r[k]).filter((x) => x != null); return { sum: v.length ? v.reduce((a, b) => a + b, 0) : null, of: v.length }; };

function filtered(C, p) {
  const city = str(p.city), stage = str(p.stage), track = str(p.track), q = str(p.q), decl = str(p.declaration);
  const qk = q ? key(q) : null;
  return C.live.filter((r) => (!city || (/^\d+$/.test(city) ? String(r.localityCode) === city : key(r.city) === key(city)))
    && (!stage || r.stage === stage) && (!track || r.track === track) && (!decl || r.declaration === decl)
    && (!qk || key([r.name, r.city, r.planNumber, r.complexId].join(' ')).includes(qk)));
}
function freshness(C) {
  const M = C.meta || {};
  return { synced: !!C.meta, store: 'git', checkedAt: M.checkedAt || null, sourceUpdatedAt: M.sourceUpdatedAt || null, snapshotFetchedAt: M.snapshotFetchedAt || null,
    coverage: M.coverage || null, records: M.inLatestSource ?? null, cadence: 'daily (renewal-sync.yml)' };
}
const methodology = {
  scope: SOURCE.scope,
  status: "the Ministry's status, verbatim; the stage is mapped only from the five exact statuses observed — anything else is 'unknown'",
  declaration: "declared only with a declaration date; 'not yet declared' where the Ministry writes טרם הוכרז; otherwise 'not stated'",
  units: 'existing / additional / proposed housing units as the Ministry publishes them (the additional column is not net new units: it equals proposed − existing in only part of the rows); a total sums only the complexes that publish that column (counted); whether proposed = existing + additional is stated per complex, never forced',
  construction: 'a declared complex is not construction: no stage here says construction started or completed',
};
function summary(p = {}, opt = {}) {
  const C = load(opt.dir), rows = filtered(C, p);
  const stages = STAGES.concat(['unknown']).map((s) => { const rs = rows.filter((r) => r.stage === s); return { stage: s, complexes: rs.length, existingUnits: sumOf(rs, 'existingUnits'), additionalUnits: sumOf(rs, 'additionalUnits'), proposedUnits: sumOf(rs, 'proposedUnits') }; }).filter((x) => x.complexes);
  const statuses = {}; for (const r of rows) { const k = r.statusHe || '—'; statuses[k] = (statuses[k] || 0) + 1; }
  const tracks = {}; for (const r of rows) { const k = r.track || '—'; tracks[k] = (tracks[k] || 0) + 1; }
  const declaration = { declared: 0, 'not-yet-declared': 0, 'not-stated': 0 }; for (const r of rows) declaration[r.declaration] = (declaration[r.declaration] || 0) + 1;
  const cities = new Map(); for (const r of rows) { const k = r.localityCode || r.city; if (!cities.has(k)) cities.set(k, { localityCode: r.localityCode, city: r.city, complexes: 0, proposedUnits: 0, proposedOf: 0 }); const c = cities.get(k); c.complexes++; if (r.proposedUnits != null) { c.proposedUnits += r.proposedUnits; c.proposedOf++; } }
  return { basis: 'OFFICIAL (Ministry of Construction and Housing) · counts and sums DERIVED', freshness: freshness(C), filters: { city: str(p.city), stage: str(p.stage), track: str(p.track), q: str(p.q) },
    kpis: { complexes: rows.length, existingUnits: sumOf(rows, 'existingUnits'), additionalUnits: sumOf(rows, 'additionalUnits'), proposedUnits: sumOf(rows, 'proposedUnits'),
      unitsAddUp: { yes: rows.filter((r) => r.unitsAddUp === true).length, no: rows.filter((r) => r.unitsAddUp === false).length } },
    stages, statuses, tracks, declaration, cities: [...cities.values()].sort((a, b) => b.complexes - a.complexes).slice(0, 40), methodology, source: SOURCE };
}
const SORTS = { declared: (r) => r.declarationDate || '', proposed: (r) => r.proposedUnits ?? -1, city: (r) => r.city || '', name: (r) => r.name || '' };
function records(p = {}, opt = {}) {
  const C = load(opt.dir); let rows = filtered(C, p);
  const sort = Object.prototype.hasOwnProperty.call(SORTS, p.sort) ? p.sort : 'declared', dir = p.order === 'asc' ? 1 : -1, k = SORTS[sort];
  rows = rows.slice().sort((a, b) => (k(a) > k(b) ? dir : k(a) < k(b) ? -dir : 0) || a.complexId - b.complexId);
  const size = clampInt(p.size, 25, 1, 100), pages = Math.max(1, Math.ceil(rows.length / size)), page = clampInt(p.page, 1, 1, pages);
  const pick = (r) => ({ id: r.id, complexId: r.complexId, name: r.name, city: r.city, localityCode: r.localityCode, track: r.track, declaration: r.declaration, statusHe: r.statusHe, stage: r.stage,
    existingUnits: r.existingUnits, additionalUnits: r.additionalUnits, proposedUnits: r.proposedUnits, unitsAddUp: r.unitsAddUp, declarationDate: r.declarationDate, planNumber: r.planNumber, approvalYear: r.approvalYear });
  return { total: rows.length, page, pages, size, sort, order: dir === 1 ? 'asc' : 'desc', rows: rows.slice((page - 1) * size, page * size).map(pick), freshness: freshness(C) };
}
function record(id, opt = {}) {
  const C = load(opt.dir), r = C.byId.get(String(id || ''));
  if (!r) return null;
  let history = [];
  try { history = fs.readFileSync(path.join(C.dir, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((h) => h && h.id === r.id).slice(-30); } catch { /* none */ }
  return { record: r, history, source: SOURCE, freshness: freshness(C), methodology };
}
/** search hits: complex name / plan number / complex number (substring of the normalized text) — a route, never a merge */
function searchHits(q, opt = {}) {
  const C = load(opt.dir), qk = key(q); if (!qk || qk.length < 2) return [];
  const tokens = qk.split(' ').filter((x) => x.length > 1);
  return C.live.filter((r) => { const h = key([r.name, r.city, r.planNumber, r.complexId].join(' ')); return tokens.every((x) => h.includes(x)); })
    .slice(0, 6).map((r) => ({ type: 'renewal', id: r.id, label: r.name || `מתחם ${r.complexId}`, sub: [r.city, r.statusHe].filter(Boolean).join(' · '), meta: { city: r.city, status: r.statusHe, proposedUnits: r.proposedUnits }, route: { section: 'intel', renewal: r.id }, via: 'name-substring' }));
}
module.exports = { load, summary, records, record, searchHits, methodology };
