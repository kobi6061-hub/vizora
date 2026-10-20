// PROPX · RECENT TRANSACTIONS LAYER — the read (20.10.2026).
//
// What the page and the API read of the reconciled GovMap-layer copy (lib/recent/reconcile.js → data/streets/recent/): the
// deals that copy publishes and the register copy does not hold yet (RECENT_NEW), for one street or one locality, with the copy
// they come from. A SEPARATE layer: never merged into the register's observed deals, never in a street median, a sample state, a
// change figure or the Street Value Model (lib/streets/evidence.js and the model never read this module).
//
// SAFETY GATE: the layer is shown only while the register copy it was reconciled against is the one PROPX holds now (same
// snapshot, same latest deal). A newer register copy may already hold these deals — until the reconciliation runs again the layer
// says so and lists nothing (a deal is never shown twice).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const FRESH = require('../gov/freshness');

const DIR = path.join(__dirname, '..', '..', 'data', 'streets', 'recent');
/* the stored files as literal paths, so the deployment's file tracing bundles them with every function that reads this module */
const FILES = {
  meta: path.join(__dirname, '..', '..', 'data', 'streets', 'recent', 'meta.json'),
  layer: path.join(__dirname, '..', '..', 'data', 'streets', 'recent', 'layer.json'),
  runs: path.join(__dirname, '..', '..', 'data', 'streets', 'recent', 'sync-runs.jsonl'),
};
const EV_META = path.join(__dirname, '..', '..', 'data', 'streets', 'evidence', 'meta.json');
const SOURCE_ID = 'over:govmap-recent';
const KINDS = ['DWELLING', 'TYPE_NOT_STATED', 'NON_DWELLING'];

let MEMO = null;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const fileOf = (dir, k) => (dir === DIR ? FILES[k] : path.join(dir, { meta: 'meta.json', layer: 'layer.json', runs: 'sync-runs.jsonl' }[k]));
const runsOf = (dir) => { try { return fs.readFileSync(fileOf(dir, 'runs'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

/** the stored layer (memoised per file stamp) */
function load(dir = DIR) {
  const stamp = `${dir}|${mtime(fileOf(dir, 'meta'))}|${mtime(fileOf(dir, 'layer'))}|${mtime(fileOf(dir, 'runs'))}|${mtime(EV_META)}`;
  if (MEMO && MEMO.stamp === stamp) return MEMO.value;
  const meta = readJson(fileOf(dir, 'meta'));
  const layer = meta ? readJson(fileOf(dir, 'layer')) : null;
  const ev = readJson(EV_META);
  const value = { meta, layer, runs: runsOf(dir), register: ev && ev.source ? ev.source : null };
  MEMO = { stamp, value };
  return value;
}

/** is the layer reconciled against the register copy PROPX holds now? */
function gate(L) {
  if (!L.meta || !L.layer) return { ok: false, reason: 'not-built' };
  if (!L.register) return { ok: false, reason: 'no-register-copy' };
  const a = L.meta.register || {};
  if (a.scrapedAt !== L.register.scrapedAt || a.lastDeal !== L.register.lastDeal) return { ok: false, reason: 'register-copy-changed' };
  return { ok: true };
}

/** the latest run that reached the GovMap-layer copy (a fetch with requests — `rebuilt` reconciliations are never a check) */
const lastCheckOf = (runs) => runs.filter((r) => Number(r.requests) > 0 && (r.status === 'ok' || r.status === 'unchanged')).map((r) => r.finishedAt || r.startedAt).filter(Boolean).sort().pop() || null;

/** the source block: the copy, its dates apart, its state */
function sourceOf(L, today) {
  const m = L.meta, s = m.source || {};
  const checkedAt = lastCheckOf(L.runs);
  const st = FRESH.stateOf({ snapshotAt: s.loadedAt, checkedAt, today });
  return {
    id: SOURCE_ID, name: s.name, channel: s.channel, cls: 'REPUBLISHED · GovMap deals layer (independent republication, over.org.il) — not a government channel',
    datasetId: s.datasetId || null, version: s.version ?? null, upstream: s.sourceUrl || null,
    snapshotAt: s.loadedAt || null, snapshotDate: s.loadedAt ? String(s.loadedAt).slice(0, 10) : null, latestTransactionDate: s.lastDeal || null,
    fetchedAt: s.snapshot ? s.snapshot.fetchedAt : null, checkedAt, rows: s.snapshot ? s.snapshot.rows : null, sha256: s.snapshot ? s.snapshot.sha256 : null,
    proof: s.snapshot ? s.snapshot.proof : null, publicationDate: null, publicationNote: 'the copy does not state when a deal was published',
    state: st.state, ageDays: st.ageDays, checkAgeDays: st.checkAgeDays, stateReason: st.reason, stale: FRESH.isStale(st.state),
  };
}

const today0 = () => new Date().toISOString().slice(0, 10);

/** the layer's summary: the copy, the window, the classes of every fetched row, the 2,293 audit, the date offsets */
function summary({ dir = DIR, today } = {}) {
  const L = load(dir);
  if (!L.meta) return { available: false, reason: 'not-built' };
  const g = gate(L), m = L.meta;
  return {
    available: g.ok, reason: g.ok ? null : g.reason, builtAt: m.builtAt, engine: m.engine,
    source: sourceOf(L, today || today0()),
    register: m.register, registerNow: L.register ? { scrapedAt: L.register.scrapedAt, lastDeal: L.register.lastDeal } : null,
    window: m.window, classes: m.classes, rules: m.rules, conflictFields: m.conflictFields, dateOffsets: m.dateOffsets,
    shown: g.ok ? m.shown : { rows: 0, reason: g.reason }, audit: m.audit, promotion: m.promotion || null,
    note: 'Deals the GovMap-layer copy publishes that the register copy does not hold yet — listed apart, never in the register figures, a street median or the PROPX street estimate.',
    lifecycle: m.lifecycle || null,
    terms: ['recent_transaction_layer', 'recent_transaction_type_not_stated', 'recent_promotion_state', 'recorded_transaction_events', 'recent_promotion_lifecycle'],
  };
}

const rowObj = (cols, r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]));
/* the untyped series' date: in every deal the register also holds, the register dated it one day later (meta.dateOffsets) */
const untypedDateNote = (m) => {
  const u = (m.dateOffsets || {}).untyped || {};
  const n = Object.values(u).reduce((a, b) => a + b, 0), one = u[1] || 0;
  return n ? { verified: n, oneDayLater: one, text: `In ${one} of ${n} deals both copies hold, the register dates this series' deal one day later.` } : null;
};

function rowsFor(L, idx, limit) {
  const cols = L.layer.columns;
  const all = idx.map((i) => rowObj(cols, L.layer.rows[i])).sort((a, b) => b.date.localeCompare(a.date) || a.oid - b.oid);
  const by = Object.fromEntries(KINDS.map((k) => [k, all.filter((r) => r.kind === k)]));
  const counts = Object.fromEntries(KINDS.map((k) => [k, by[k].length]));
  const latest = by.DWELLING.length ? by.DWELLING[0].date : null;
  const priced = by.DWELLING.filter((r) => r.priced).length;
  /* the promotion state of every row (lib/recent/promote.js) — none of them enters a price figure; RECORDED TRANSACTION EVENTS are
     the rows that pass every event gate (counted as transactions, their price never used) */
  const states = all.reduce((m, r) => ((m[r.state] = (m[r.state] || 0) + 1), m), {});
  const events = all.filter((r) => r.event === true).length;
  return { counts, total: all.length, latestDwelling: latest, pricedDwelling: priced, states, events,
    dwelling: by.DWELLING.slice(0, limit), typeNotStated: by.TYPE_NOT_STATED.slice(0, limit), nonDwelling: by.NON_DWELLING.slice(0, limit) };
}

/**
 * The recent-only deals on one official street (st:<locality>:<street>): the RECENT_NEW rows whose street the layer attached
 * (the address as published resolved strongly, the register's own parcel crosswalk, or both agreeing).
 */
function forStreet(id, { dir = DIR, limit = 60, today } = {}) {
  const L = load(dir);
  if (!L.meta) return { available: false, reason: 'not-built' };
  const g = gate(L);
  const base = { id, source: sourceOf(L, today || today0()), window: L.meta.window, register: L.meta.register,
    note: 'Newer deals — not yet in the register copy PROPX reads. Listed apart: never in the street median, the sample state or the PROPX street estimate.',
    dateNote: untypedDateNote(L.meta) };
  if (!g.ok) return { available: false, reason: g.reason, ...base };
  const idx = L.layer.byStreet[id] || [];
  return { available: true, ...base, ...rowsFor(L, idx, Math.max(1, Math.min(500, Number(limit) || 60))) };
}

/** the recent-only deals of one locality (every row placed in it, with or without a street) */
function forLocality(code, { dir = DIR, limit = 0, today } = {}) {
  const L = load(dir);
  if (!L.meta) return { available: false, reason: 'not-built' };
  const g = gate(L);
  const base = { cityCode: Number(code), source: sourceOf(L, today || today0()), window: L.meta.window };
  if (!g.ok) return { available: false, reason: g.reason, ...base };
  const idx = L.layer.byCode[String(Number(code))] || [];
  const r = rowsFor(L, idx, Math.max(0, Math.min(500, Number(limit) || 0)));
  const cols = L.layer.columns, sc = cols.indexOf('streetCode');
  return { available: true, ...base, ...r, onStreets: idx.filter((i) => L.layer.rows[i][sc] != null).length };
}

/** every stored row of one street (`street`: st:<locality>:<street>) or one locality (`code`) — unsliced, for the counts */
function allRows({ street, code } = {}, { dir = DIR } = {}) {
  const L = load(dir);
  if (!L.meta) return { available: false, reason: 'not-built', rows: [] };
  const g = gate(L);
  if (!g.ok) return { available: false, reason: g.reason, rows: [], window: L.meta.window };
  const idx = street ? L.layer.byStreet[street] || [] : L.layer.byCode[String(Number(code))] || [];
  return { available: true, rows: idx.map((i) => rowObj(L.layer.columns, L.layer.rows[i])), window: L.meta.window, latest: L.meta.source && L.meta.source.lastDeal,
    copy: { loadedAt: L.meta.source && L.meta.source.loadedAt, lastDeal: L.meta.source && L.meta.source.lastDeal }, register: L.meta.register };
}

/** is the GovMap-layer copy a monitor sees the copy this layer read? (the freshness strip's "newer copy" note) */
function readsCopy(snapshotAt, { dir = DIR } = {}) {
  const L = load(dir);
  return !!(L.meta && L.meta.source && snapshotAt && String(L.meta.source.loadedAt) === String(snapshotAt) && gate(L).ok);
}

module.exports = { DIR, SOURCE_ID, KINDS, load, gate, summary, forStreet, forLocality, allRows, readsCopy, lastCheckOf };
