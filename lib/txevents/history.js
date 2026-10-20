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

/* one year file → rows (objects), newest first; the last few years read are kept */
const YEARS = new Map();
function year(y) {
  const f = path.join(DIR, `gm-${y}.json.gz`), m = mtime(f);
  if (!m) return [];
  const k = `${y}|${m}`;
  if (YEARS.has(k)) { const v = YEARS.get(k); YEARS.delete(k); YEARS.set(k, v); return v; }
  const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
  const C = doc.columns, n = doc.rows, dict = doc.dict || {};
  const rows = new Array(n);
  let d = 0;
  const di = C.indexOf('date');
  for (let j = 0; j < n; j++) {
    const o = {};
    for (let i = 0; i < C.length; i++) {
      let v = doc.cols[i][j];
      if (i === di) { d = j ? d - v : v; v = isoDay(d * DAY); }
      else if (dict[C[i]] && v != null) v = dict[C[i]][v];
      o[C[i]] = v;
    }
    rows[j] = o;
  }
  YEARS.set(k, rows);
  if (YEARS.size > 6) YEARS.delete(YEARS.keys().next().value);
  return rows;
}

/**
 * The history rows of a place, dated within [from, to] (either may be null), newest first.
 * @param where { code?, codes?: Set, streetCode?, block?, parcel? }   (a street's rows also carry `streetCode`; a parcel matches by block · parcel)
 */
function rows(where, from, to) {
  const M = meta();
  if (!M || !Array.isArray(M.files)) return [];
  const ys = M.files.map((f) => f.year).filter((y) => (!from || y >= Number(String(from).slice(0, 4))) && (!to || y <= Number(String(to).slice(0, 4)))).sort((a, b) => b - a);
  const out = [];
  for (const y of ys) {
    for (const r of year(y)) {
      if (from && r.date < from) continue;
      if (to && r.date > to) continue;
      if (where.code != null && r.cityCode !== where.code) continue;
      if (where.codes && !where.codes.has(r.cityCode)) continue;
      if (where.block != null && (num(r.block) !== num(where.block) || num(r.parcel) !== num(where.parcel))) continue;
      out.push(r);
    }
  }
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

module.exports = { DIR, meta, year, rows, asLayerRow, fold, span, addDays, dayNo };
