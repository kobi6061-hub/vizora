// PROPX · THE HISTORY OF THE TRANSACTION EVENTS — every deal before the register copy's stored window (closure P0, 20.10.2026).
//
// The stored window (36 months, lib/streets/evidence.js) is an optimization boundary, never the meaning of ALL. Before it:
//   the REGISTER copy        read live, page by page, newest first (lib/gov/providers/overDeals.js — the copy's own search, no lower
//                            date bound, paged by DATE so its 100,000-row offset cap never truncates a locality)
//   the GOVMAP-LAYER copy    the whole published file, classified offline a year at a time (scripts/txevents-history.js →
//                            data/txevents/history/gm-<year>.json.gz): in-source duplicates removed, every row placed (its settlement,
//                            or the recovery in recover.js), its street from the layer's own official street code and the published name
// A GovMap row and the register deal it repeats are ONE event: `fold` applies the reconciliation's rules (the same unit or the same block
// · parcel, within one day, the amounts agreeing — equal, the layer's ₪1,000 truncation, or a share of the property) between the rows of
// the two copies a page shows; a row that may be the register's deal is shown flagged POSSIBLE DUPLICATE and never counted; a row the
// register does not hold is an event of its own (the layer states no ownership share: its price is never used in a statistic).
//
// PAGING (`span`): a page shows the register's rows dated in (L, C] and the layer's rows dated in (L + 1, C + 1] — a layer row is shown
// only on the page that holds every register row it could repeat (one day either side), so a deal is never shown twice and never
// skipped. The next page starts at C' = L.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* a literal path, so the deployment's file tracing bundles the directory */
const DIR = process.env.TXEVENTS_HISTORY_DIR || path.join(__dirname, '..', '..', 'data', 'txevents', 'history');
const DAY = 864e5;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const dayNo = (d) => Math.round(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / DAY);
const addDays = (d, k) => isoDay(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') + k * DAY);
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

let META = null;
/** data/txevents/history/meta.json (memoised per file stamp), or null before the first build */
function meta() {
  const f = path.join(DIR, 'meta.json'), m = mtime(f);
  if (META && META.m === m) return META.v;
  let v = null; try { v = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { v = null; }
  META = { m, v };
  return v;
}

/* a partition file (a year of every locality, or one locality of every year) kept COLUMNAR: its dates as day numbers (newest first),
   a row decoded only when a read selects it; the last few partitions read are kept */
const PARTS = new Map();
function part(f, keep) {
  const m = mtime(f);
  if (!m) return null;
  const k = `${f}|${m}`;
  if (PARTS.has(k)) { const v = PARTS.get(k); PARTS.delete(k); PARTS.set(k, v); return v; }
  const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
  const C = doc.columns, n = doc.rows, di = C.indexOf('date');
  const days = new Int32Array(n);
  let d = 0;
  for (let j = 0; j < n; j++) { d = j ? d - doc.cols[di][j] : doc.cols[di][j]; days[j] = d; }
  const v = { n, C, cols: doc.cols, dict: doc.dict || {}, days, di, ci: C.indexOf('cityCode'), bi: C.indexOf('block'), pi: C.indexOf('parcel'), si: C.indexOf('streetCode') };
  PARTS.set(k, v);
  while (PARTS.size > keep) PARTS.delete(PARTS.keys().next().value);
  return v;
}
function decode(P, j) {
  const o = {};
  for (let i = 0; i < P.C.length; i++) {
    let v = i === P.di ? isoDay(P.days[j] * DAY) : P.cols[i][j];
    if (i !== P.di && P.dict[P.C[i]] && v != null) v = P.dict[P.C[i]][v];
    o[P.C[i]] = v;
  }
  return o;
}
/* the first index whose day is ≤ `toN` (rows newest first) */
function firstAtOrBelow(P, toN) { let lo = 0, hi = P.n; while (lo < hi) { const mid = (lo + hi) >> 1; if (P.days[mid] > toN) lo = mid + 1; else hi = mid; } return lo; }
const locFile = (code) => path.join(DIR, 'loc', `${Number(code)}.json.gz`);
/* the per-locality partitions are read only while they were derived from the year files meta.json lists (else the year files are) */
let LOCOK = null;
function locReady(M) {
  const f = path.join(DIR, 'loc', 'index.json'), m = mtime(f);
  const stamp = `${m}|${M.builtAt}|${M.files.length}`;
  if (LOCOK && LOCOK.stamp === stamp) return LOCOK.ok;
  let ok = false;
  try {
    const ix = JSON.parse(fs.readFileSync(f, 'utf8'));
    const want = new Map(M.files.map((x) => [x.file, x.sha256]));
    ok = Array.isArray(ix.derivedFrom) && ix.derivedFrom.length === want.size && ix.derivedFrom.every((x) => want.get(x.file) === x.sha256);
  } catch { ok = false; }
  LOCOK = { stamp, ok };
  return ok;
}
/** one year of every locality, as row objects (newest first) */
function year(y) { const P = part(path.join(DIR, `gm-${y}.json.gz`), 8); if (!P) return []; const out = new Array(P.n); for (let j = 0; j < P.n; j++) out[j] = decode(P, j); return out; }

/**
 * The history rows of a place, dated within [from, to] (either may be null), newest first.
 * @param where { code?, codes?: Set, block?, parcel?, streetCode? }   a locality (and a parcel / a street in it) reads the locality's own partition; an area
 *              (codes, or none = Israel) reads the year partitions
 */
function rows(where, from, to) {
  const M = meta();
  if (!M || !Array.isArray(M.files)) return [];
  const fromN = from ? dayNo(from) : -Infinity, toN = to ? dayNo(to) : Infinity;
  const take = (P, out) => {
    for (let j = firstAtOrBelow(P, toN); j < P.n && P.days[j] >= fromN; j++) {
      if (where.code != null && P.cols[P.ci][j] !== where.code) continue;
      if (where.codes && !where.codes.has(P.cols[P.ci][j])) continue;
      if (where.block != null && (num(P.cols[P.bi][j]) !== num(where.block) || num(P.cols[P.pi][j]) !== num(where.parcel))) continue;
      /* a street read (the street report): a row whose official street code names ANOTHER street is never this street's — skipped before
         it is decoded; a row with no code is decoded (its published address or parcel may place it — lib/txevents placeEvent decides) */
      if (where.streetCode != null && P.si >= 0 && P.cols[P.si][j] != null && P.cols[P.si][j] !== where.streetCode) continue;
      out.push(decode(P, j));
    }
    return out;
  };
  if (where.code != null && locReady(M)) {
    const P = part(locFile(where.code), 16);
    return P ? take(P, []) : [];
  }
  const ys = M.files.map((f) => f.year).filter((y) => (!from || y >= Number(String(from).slice(0, 4))) && (!to || y <= Number(String(to).slice(0, 4)))).sort((a, b) => b - a);
  const out = [];
  for (const y of ys) { const P = part(path.join(DIR, `gm-${y}.json.gz`), 8); if (P) take(P, out); }
  return out;
}

/** a history row → the shape lib/txevents `gmEvent` reads (the layer's own fields, nothing added) */
const asLayerRow = (r) => ({ oid: r.oid, dealId: null, date: r.date, amount: r.amount, areaSqm: r.areaSqm, rooms: r.rooms, floor: r.floor, propertyType: r.propertyType,
  dealNature: r.dealNature, kind: r.kind, cityCode: r.cityCode, settlement: r.settlement, street: r.street, house: r.house, streetCode: r.streetCode,
  streetBasis: r.streetBasis === 'street-code+name' || r.streetBasis === 'address+parcel' ? 'address+parcel' : r.streetBasis === 'parcel' ? 'parcel' : 'address',
  block: r.block, parcel: r.parcel, subParcel: r.subParcel, class: r.class === 'RECENT_NEW' ? 'RECENT_NEW' : r.class, recovery: r.recovery, sourceStreetBasis: r.streetBasis });

/* ── the fold: a layer row and the register deal it repeats are one event (the reconciliation's own rules) ── */
const near = (g, d) => g != null && d != null && (g === d || (g <= d && d - g < 1000));
function agree(g, d) {
  if (g.price == null || d.price == null) return false;
  const share = d.portion && d.portion.fraction != null && d.portion.fraction < 1;
  const ga = g.areaSqm != null && g.areaSqm >= 10 ? g.areaSqm : null, da = d.areaSqm != null && d.areaSqm >= 10 ? d.areaSqm : null;
  const area1 = ga == null || da == null || Math.abs(ga - da) <= 1;
  const area5 = ga == null || da == null || Math.abs(ga - da) <= Math.max(1, 0.05 * Math.max(ga, da));
  if (g.price === d.price && (g.price % 1000 !== 0 || area5)) return true;
  return (near(g.price, d.price) || share) && area1;
}
/**
 * @param G  layer events (lib/txevents gmEvent shape) shown in the span
 * @param R  register events of the same place and dates (live)
 * @returns { shown: layer events not folded (a possible duplicate flagged), folded: [{g, r, via, differences}] }
 */
function fold(G, R) {
  const unit = (e) => `${num(e.block)}|${num(e.parcel)}|${num(e.subParcel) || 0}`, parcel = (e) => `${num(e.block)}|${num(e.parcel)}`;
  const byUnit = new Map(), byParcel = new Map();
  const add = (m, k, e) => { if (!m.has(k)) m.set(k, []); m.get(k).push(e); };
  for (const r of R) { add(byUnit, unit(r), r); add(byParcel, parcel(r), r); }
  const used = new Set(), out = [], folded = [];
  const within = (a, b) => Math.abs(dayNo(a.date) - dayNo(b.date)) <= 1;
  const pending = [...G].sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(a.id).localeCompare(String(b.id)));
  const take = (g, r, via) => { used.add(r); const differences = []; if (g.date !== r.date) differences.push('date'); if (`${num(g.subParcel) || 0}` !== `${num(r.subParcel) || 0}`) differences.push('sub-parcel');
    if (g.price !== r.price) differences.push(near(g.price, r.price) ? 'amount:truncated' : 'amount:share'); if (g.rooms != null && r.rooms != null && g.rooms !== r.rooms) differences.push('rooms');
    folded.push({ g, r, via, differences }); };
  const rest = [];
  /* PASS 1 — the same deal: the same unit, then the same block · parcel, within one day, the amounts agreeing */
  for (const g of pending) {
    let hit = (byUnit.get(unit(g)) || []).filter((r) => !used.has(r) && within(g, r) && agree(g, r));
    if (hit.length) { take(g, hit.find((r) => r.date === g.date) || hit[0], 'unit'); continue; }
    hit = (byParcel.get(parcel(g)) || []).filter((r) => !used.has(r) && within(g, r) && agree(g, r));
    if (hit.length) { take(g, hit.find((r) => r.date === g.date) || hit[0], 'parcel'); continue; }
    rest.push(g);
  }
  /* PASS 2 — maybe the same deal: the same unit within one day with another amount, or the same block · parcel within one day with the
     amount within ₪1,000 — shown, flagged, never counted */
  for (const g of rest) {
    const maybe = (byUnit.get(unit(g)) || []).some((r) => !used.has(r) && within(g, r))
      || (byParcel.get(parcel(g)) || []).some((r) => !used.has(r) && within(g, r) && g.price != null && r.price != null && Math.abs(g.price - r.price) < 1000);
    out.push(maybe ? { ...g, state: 'POSSIBLE_DUPLICATE', notes: ['MAYBE_A_REGISTER_DEAL'], inStatistics: false } : g);
  }
  return { shown: out, folded };
}

/**
 * The page span of a register answer: the register rows newest first, `more` when the source holds older rows.
 * @param C       the page's upper day (inclusive) — the register rows dated ≤ C not shown yet
 * @param rows    the register rows fetched (dated ≤ C + 2: two reference days above the page)
 * @param more    the source has rows below the fetched ones
 * @param floors  per settlement spelling, the lowest date it returned while it still had more (the page cannot reach below them)
 * @returns { L, regFrom, regTo, gmFrom, gmTo, last }   register rows shown in (L, C]; layer rows in (L + 1, C + 1]; L null = the last page
 */
function span(C, rows, more, floors = []) {
  if (!more) return { L: null, last: true, regTo: C, gmTo: addDays(C, 1) };
  const fl = floors.filter(Boolean).sort();
  const L = fl.length ? fl[fl.length - 1] : rows.map((r) => r.date).filter(Boolean).sort()[0] || null;
  return { L, last: false, regTo: C, gmTo: addDays(C, 1), regAbove: L, gmAbove: L ? addDays(L, 1) : null };
}

module.exports = { DIR, meta, year, rows, locReady, asLayerRow, fold, span, addDays, dayNo };
