// PROPX · UNPLACED TRANSACTION EVENTS — the GovMap layer's rows whose locality cannot be determined (closure P0, 20.10.2026).
//
// A row that names no usable settlement and that no strong signal places (lib/txevents/recover.js: POSSIBLE_LOCATION / UNPLACED) is still
// a reported transaction: it stays in the NATIONAL universe — Israel's transaction list, the completeness dashboard and this view — and
// is NEVER attributed to a locality, a street or a district. Every source field is kept; a POSSIBLE location lists its candidates (never
// chosen). Sources: data/txevents/national/unplaced.json (the stored window) + data/txevents/history/unplaced.json.gz (before it).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* literal paths, so the deployment's file tracing bundles them */
const FILES = {
  window: path.join(__dirname, '..', '..', 'data', 'txevents', 'national', 'unplaced.json'),
  history: path.join(__dirname, '..', '..', 'data', 'txevents', 'history', 'unplaced.json.gz'),
};
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
let MEMO = null;
function load() {
  const stamp = `${mtime(FILES.window)}|${mtime(FILES.history)}`;
  if (MEMO && MEMO.stamp === stamp) return MEMO.value;
  const read = (f, gz) => { try { const b = fs.readFileSync(f); return JSON.parse(gz ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8')); } catch { return null; } };
  const docs = [['over:govmap-national', read(FILES.window, false)], ['over:govmap-national', read(FILES.history, true)]];
  const rows = [];
  for (const [sourceId, d] of docs) {
    if (!d || !Array.isArray(d.rows)) continue;
    for (const r of d.rows) rows.push(Object.fromEntries(d.columns.map((c, i) => [c, r[i]])));
  }
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.oid - b.oid);
  const value = { rows, built: docs.some(([, d]) => d) };
  MEMO = { stamp, value };
  return value;
}

/** one unplaced row → a transaction event (the lib/txevents wire shape): real, dated, its price never used, its place unknown */
function event(r) {
  const kind = r.kind || 'TYPE_NOT_STATED';
  const notes = ['LOCALITY_NOT_RESOLVED', kind === 'NON_DWELLING' ? 'NOT_A_DWELLING' : kind === 'TYPE_NOT_STATED' ? 'TYPE_NOT_STATED' : null, 'SHARE_NOT_STATED'].filter(Boolean);
  return {
    id: 'gmu:' + r.oid, key: null, source: 'govmap', sourceId: 'over:govmap-national', cls: 'UNPLACED',
    date: r.date, price: r.amount, areaSqm: r.areaSqm, rooms: r.rooms, floor: r.floor, yearBuilt: null, propertyType: r.dealNature || r.propertyType || null, dealType: r.dealNature || r.propertyType || null,
    kind, propertyClass: kind === 'DWELLING' ? 'residential' : kind === 'TYPE_NOT_STATED' ? 'type-not-stated' : 'other',
    cityCode: null, city: r.settlement || null, street: r.street || null, houseNumber: r.house || null, block: r.block != null ? String(r.block) : null, parcel: r.parcel != null ? String(r.parcel) : null,
    subParcel: r.subParcel != null ? String(r.subParcel) : null, dealId: r.dealId || null, oid: r.oid, partialSale: null, portion: null, portionMissing: true, priced: false, pricePerSqm: null, newness: 'unknown',
    state: kind === 'DWELLING' ? 'LIMITED_SHARE_NOT_STATED' : 'RECORDED_EVENT', notes, geo: { match: 'UNPLACED', certain: false, reasons: [r.state, r.basis].filter(Boolean), candidates: r.candidates ? String(r.candidates).split(',').map(Number) : [] },
    inStatistics: false, evidence: [], conflict: false, conflictFields: [], unplaced: { state: r.state, basis: r.basis, settlementId: r.settlementId, polygon: r.polygon, neighborhood: r.neighborhood, streetCode: r.streetCode },
  };
}

/** the unplaced events dated in (from, to] (either may be null), newest first */
function events({ from = null, to = null } = {}) {
  return load().rows.filter((r) => r.date && (!to || r.date <= to) && (!from || r.date > from)).map(event);
}

/** the national view: counts by state and basis, the newest rows */
function summary({ limit = 200 } = {}) {
  const { rows, built } = load();
  const tally = (f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  return { built, rows: rows.length, byState: tally((r) => r.state), byBasis: tally((r) => r.basis), byKind: tally((r) => r.kind || 'TYPE_NOT_STATED'),
    byYear: tally((r) => String(r.date || '').slice(0, 4)), latest: rows[0] ? rows[0].date : null, newest: rows.slice(0, limit).map(event) };
}

module.exports = { FILES, load, event, events, summary };
