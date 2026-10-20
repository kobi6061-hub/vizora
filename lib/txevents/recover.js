// PROPX · LOCALITY RECOVERY of transaction rows that name no usable settlement (closure P0, 20.10.2026).
//
// The GovMap-layer copy prints ≈ 84,000 deals with no settlement name (its own caveat: "found by block and parcel") and some with a
// settlement name no single official locality carries (a merged council, a spelling shared by two places). The reconciliation
// (lib/recent/reconcile.js) places such a row only when exactly one locality's REGISTER copy holds its block · parcel. This module
// goes further, deterministically, with every identity signal the two copies carry — and never guesses:
//
//   RESOLVED_EXACTLY    the row's own settlement code is an official locality code (the layer's settlementId)
//   RESOLVED_STRONGLY   the row's parcel polygon (the layer's polygonId) or its block · parcel is filed under exactly ONE locality by every
//                       other row of the layer (all years) and by the register copy PROPX holds — and the two signals do not disagree;
//                       a settlement name shared by several localities picks the one candidate the parcel names
//   POSSIBLE_LOCATION   only the block points to one locality, or the signals disagree, or the parcel is filed under several
//                       localities — listed with its candidates, NEVER entered into a locality, street, district or price
//   UNPLACED            no signal at all — an UNPLACED TRANSACTION EVENT of the national universe
//
// Only RESOLVED_EXACTLY / RESOLVED_STRONGLY rows enter geography-specific results. Coordinates are not used: PROPX holds no official
// locality boundary to test a point against (the map's boundaries are districts, at 1:10m).

'use strict';

const STATES = Object.freeze(['RESOLVED_EXACTLY', 'RESOLVED_STRONGLY', 'POSSIBLE_LOCATION', 'UNPLACED']);
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const bump = (m, k, code, n = 1) => { if (k == null) return; let x = m.get(k); if (!x) m.set(k, (x = new Map())); x.set(code, (x.get(code) || 0) + n); };
const codesOf = (m, k) => (k == null ? null : m.get(k) || null);

/**
 * The knowledge base: which locality every parcel polygon, block · parcel and block is filed under.
 * @param o.D           lib/streets/directory load()
 * @param o.place       (settlementName) → { code } | { code: null, why, codes? }   — the reconciliation's settlement index
 * @param o.parcelRows  the layer's parcel aggregate rows [settlement, gush, parcel, street, house, n, first, last, settlementId, streetCode]
 * @param o.polygonRows the layer's polygon aggregate rows [polygonId, settlement, settlementId, n]
 * @param o.registerParcels iterable of [code, gush, parcel, deals] — the register copy's parcels (its sweep shards)
 */
function knowledge({ D, place, parcelRows = [], polygonRows = [], registerParcels = [] }) {
  const official = (sid) => { const c = num(sid); return c != null && D.localities.has(c) ? c : null; };
  /* a named row's locality: its own official code, else its name — never a name shared by several localities */
  const codeOf = (settlement, sid) => { const c = official(sid); if (c != null) return c; if (!settlement) return null; const p = place(settlement); return p && p.code != null ? p.code : null; };
  const poly = new Map(), parcel = new Map(), block = new Map();
  let idAgree = 0, idDisagree = 0;
  for (const [settlement, gush, par, , , n, , , sid] of parcelRows) {
    const c = codeOf(settlement, sid);
    if (official(sid) != null && settlement) { const p = place(settlement); if (p && p.code != null) { if (p.code === official(sid)) idAgree += n || 1; else idDisagree += n || 1; } }
    if (c == null || num(gush) == null) continue;
    if (num(par) != null) bump(parcel, `${num(gush)}|${num(par)}`, c, n || 1);
    bump(block, String(num(gush)), c, n || 1);
  }
  for (const [pid, settlement, sid, n] of polygonRows) { const c = codeOf(settlement, sid); if (c != null && pid != null && pid !== '') bump(poly, String(pid), c, n || 1); }
  for (const [code, gush, par, n] of registerParcels) {
    if (num(gush) == null) continue;
    if (num(par) != null) bump(parcel, `${num(gush)}|${num(par)}`, code, n || 1);
    bump(block, String(num(gush)), code, n || 1);
  }
  return { official, codeOf, poly, parcel, block, settlementIdAgreement: { agree: idAgree, disagree: idDisagree } };
}

const list = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([code, rows]) => ({ code, rows }));

/**
 * One row with no usable settlement → its recovery.
 * @param K   knowledge(...)
 * @param r   { settlement, settlementId, polygon, gush, parcel }
 * @param candidates  the official codes a shared settlement name points to (the reconciliation's `ambiguous` codes), if any
 * @returns { state, code, basis, candidates }
 */
function recover(K, r, candidates = null) {
  const sid = K.official(r.settlementId);
  if (sid != null) return { state: 'RESOLVED_EXACTLY', code: sid, basis: 'settlement-code', candidates: null };
  const g = num(r.gush), p = num(r.parcel);
  const P = codesOf(K.poly, r.polygon != null && r.polygon !== '' ? String(r.polygon) : null);
  const Q = g != null && p != null ? codesOf(K.parcel, `${g}|${p}`) : null;
  const B = g != null ? codesOf(K.block, String(g)) : null;
  const allowed = (m) => (m && candidates && candidates.length ? new Map([...m].filter(([c]) => candidates.includes(c))) : m);
  const P1 = allowed(P), Q1 = allowed(Q), B1 = allowed(B);
  const one = (m) => (m && m.size === 1 ? [...m.keys()][0] : null);
  const p1 = one(P1), q1 = one(Q1);
  /* the parcel itself: its polygon and its block · parcel, filed under one locality, the two never disagreeing */
  if (p1 != null && (Q1 == null || Q1.size === 0 || (q1 === p1)))
    return { state: 'RESOLVED_STRONGLY', code: p1, basis: q1 === p1 ? 'parcel-polygon+block-parcel' : 'parcel-polygon', candidates: null };
  if (q1 != null && (P1 == null || P1.size === 0))
    return { state: 'RESOLVED_STRONGLY', code: q1, basis: 'block-parcel', candidates: null };
  /* weaker: disagreeing parcel signals, a parcel filed under several localities, or the block alone */
  const cand = new Map();
  for (const m of [P1, Q1]) if (m) for (const [c, n] of m) cand.set(c, (cand.get(c) || 0) + n);
  if (cand.size) return { state: 'POSSIBLE_LOCATION', code: null, basis: p1 != null && q1 != null && p1 !== q1 ? 'parcel-signals-disagree' : 'parcel-in-several-localities', candidates: list(cand).slice(0, 5) };
  if (B1 && B1.size) return { state: 'POSSIBLE_LOCATION', code: null, basis: B1.size === 1 ? 'block-only' : 'block-in-several-localities', candidates: list(B1).slice(0, 5) };
  if (candidates && candidates.length) return { state: 'POSSIBLE_LOCATION', code: null, basis: 'settlement-name-shared', candidates: candidates.map((code) => ({ code, rows: null })) };
  return { state: 'UNPLACED', code: null, basis: g == null ? 'no-block' : 'block-unknown-to-both-copies', candidates: null };
}

module.exports = { STATES, knowledge, recover };
