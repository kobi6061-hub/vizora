// PROPX · RECENT TRANSACTIONS LAYER — the deterministic reconciliation (20.10.2026).
//
// Input: the GovMap deals layer (lay=16) as republished by over.org.il, read VERBATIM for the recent window
// (scripts/street-recent-sync.js), and the stored register copy (lib/streets/evidence.js shards). Output: one class per GovMap
// row, never a merge that loses a value — the GovMap row is kept as published, the register deal stays the register's, and
// every disagreement between the two is recorded beside both values.
//
// THE CLASSES (each fetched row exactly one, in this order):
//   CONTEXT_BEFORE_WINDOW        dated before the window — read only as matching context, never shown
//   FUTURE_DATED                 dated after the copy's load day (the layer publishes dates up to 2048 "as published")
//   NO_SETTLEMENT                the source names no settlement and its block · parcel is in no single locality's register
//                                crosswalk — the row cannot be placed
//   UNMAPPED_SETTLEMENT          a settlement name no official locality code carries (or several do), and the block · parcel
//                                does not place it either — not placed
// Placement: the settlement name (the register's own spellings per code, the official locality name, and the documented
// GOVMAP_NAMES below); a row whose name places nothing is placed by its block · parcel when exactly one locality's register
// copy lists that parcel (an exact key, `placedBy: 'parcel'`).
//   DUPLICATE_IN_SOURCE          a row WITHOUT a property type that repeats a TYPED row of the copy (the copy's second deal-id
//                                series): same locality · block · parcel, the amount within ₪1,000 (the typed series truncates
//                                to ₪1,000; the untyped one prints the exact amount), the area within 5 % (the untyped series
//                                states its own area), rooms within half a room, dated the SAME day or ONE day earlier. Exactly
//                                one candidate twin → the typed row represents the deal and keeps the twin's sub-parcel, date and
//                                amount beside its own. Also (`via: register-amount`): an untyped row whose amount equals, to the
//                                shekel, a register deal of the same block · parcel within one day that another row already
//                                holds (a non-round amount, or a compatible area) — a twin found through the register; and
//                                (`via: register-share`, any row) the whole-property value of a held PARTIAL-sale register deal
//   AMBIGUOUS_DUPLICATE          such an untyped row with several candidate twins — none is chosen; the row is not shown
//   POSSIBLE_DUPLICATE_IN_SOURCE an untyped row with no twin but a typed row of the same parcel and amount (₪1,000) within three
//                                days, whatever the area and rooms — maybe the same deal: never shown as new
//   IN_REGISTER                  the register copy holds the deal: the same unit (block · parcel · sub-parcel, the row's or its
//                                twin's) within one day AND the amounts agreeing — the register's fields stand; the GovMap values
//                                are kept as conflicts
//   IN_REGISTER_OTHER_UNIT       the register holds it under another sub-parcel: same block · parcel, within one day, the amounts
//                                agreeing (₪1,000 truncation or a share, area to the metre; or equal to the shekel)
//   POSSIBLY_IN_REGISTER         maybe the same deal, never shown as new (a deal is never counted twice): the same unit within one
//                                day with another amount · the same parcel within one day, the amount within ₪1,000 either way or
//                                equal whatever the area · another parcel of the locality, within one day, the same amount ·
//                                area · rooms
//   RECENT_NEW                   placed, valid, recent, and not in the register copy — the only class the layer shows
//                                (dwelling / non-dwelling / type not stated, each labelled)
// The registers searched for a row: its own locality first, then every other locality whose register copy holds a deal on the
// same block · parcel. Two passes — every row's amount-agreeing match first, the weak ones after — so a "possibly" never takes a
// deal a sure match needs. A placeholder area (< 20 m², the register's MIN_AREA) is no area.
// A register deal absorbs at most one GovMap row; rows are processed in one canonical order (date newest first, then object
// id), so the result never depends on the order the source returned them in.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const W = require('./window');

const normCity = (s) => String(s || '').replace(/["'״׳\s\-–]/g, '').replace(/וו/g, 'ו').replace(/יי/g, 'י');
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const DAY = 864e5;
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const { MIN_MARKET, MIN_AREA } = require('../streets/evidence');     // the register's own pricing rules
/* areas: the register and the typed series agree to the metre (±1); the untyped series states its own area a few m² apart, so an
   area is "compatible" within 5 % (at least 1 m²) — read only where the amount already agrees (a twin, or an amount equal to the shekel) */
const AREA_TOL = 0.05;
const areaOk = (a, b) => a == null || b == null || Math.abs(a - b) <= Math.max(1, AREA_TOL * Math.max(a, b));
const area1 = (a, b) => a == null || b == null || Math.abs(a - b) <= 1;

const CLASSES = ['CONTEXT_BEFORE_WINDOW', 'FUTURE_DATED', 'NO_SETTLEMENT', 'UNMAPPED_SETTLEMENT', 'DUPLICATE_IN_SOURCE', 'AMBIGUOUS_DUPLICATE',
  'POSSIBLE_DUPLICATE_IN_SOURCE', 'IN_REGISTER', 'IN_REGISTER_OTHER_UNIT', 'POSSIBLY_IN_REGISTER', 'RECENT_NEW'];
/* GovMap spellings no register spelling or official name carries, each verified against the official locality directory: a
   spelling variant or the official rename. A merged-council name (two localities) is never listed — it stays unplaced. */
const GOVMAP_NAMES = Object.freeze({ 'יוקנעם עילית': 240, 'זיכרון יעקב': 9300, "ג'יסר א-זרקא": 541, 'נצרת עילית': 1061 });

/** one GovMap row → the fields the reconciliation reads (the verbatim row is kept beside it) */
function normalize(g) {
  const typed = !!(g.property_type || g.deal_nature);
  const id = String(g.deal_id == null ? '' : g.deal_id);
  return { oid: Number(g.objectid), dealId: id, series: id.length === 11 && id.startsWith('1136') ? '1136' : 'std', date: String(g.deal_date || '').slice(0, 10),
    amount: num(g.deal_amount), area: num(g.asset_area), areaM: num(g.asset_area) != null && num(g.asset_area) >= MIN_AREA ? num(g.asset_area) : null, rooms: num(g.rooms), floor: g.floor || null, type: g.property_type || null, nature: g.deal_nature || null, typed,
    settlement: g.settlement || null, street: g.street || null, house: g.house_num == null ? null : String(g.house_num),
    gush: num(g.gush), parcel: num(g.parcel), sub: num(g.sub_parcel), polygon: g.polygon_id || null, lon: num(g.lon), lat: num(g.lat) };
}

/* ── amounts: GovMap prints ₪1,000 steps; a register row of a sold SHARE prints the share's amount ── */
const near = (g, d) => g != null && d != null && (g === d || (g <= d && d - g < 1000));
function amountRel(g, deal) {
  const d = deal.amount;
  if (g == null || d == null) return 'missing';
  if (g === d) return 'equal';
  if (g <= d && d - g < 1000) return 'truncated';
  if (deal.portionFraction != null && deal.portionFraction < 1) return 'share';
  return 'differs';
}

/* ── the register copy: per locality code, its deals (all natures) and its parcel → street crosswalk ── */
function registerOf(EV, code, shardOf = EV.shardOf) {
  const sh = shardOf(code);
  if (!sh) return null;
  const deals = EV.dealsOf(sh).map((x, i) => ({ ...x.deal, i, gushN: num(x.deal.gush), helkaN: num(x.deal.helka), subN: num(x.deal.subParcel) }));
  const byUnit = new Map(), byParcel = new Map(), byDate = new Map();
  const add = (m, k, d) => { if (!m.has(k)) m.set(k, []); m.get(k).push(d); };
  for (const d of deals) { add(byUnit, `${d.gushN}|${d.helkaN}|${d.subN || 0}`, d); add(byParcel, `${d.gushN}|${d.helkaN}`, d); add(byDate, d.date, d); }
  /* the parcel crosswalk: a parcel whose every stored entry is OBSERVED on one and the same street */
  const pStreets = new Map();
  for (const p of sh.parcels) {
    const k = `${num(p[0])}|${num(p[1])}`;
    const one = p[4] === 'OBSERVED' && p[5].length === 1 ? p[5][0][0] : null;
    if (!pStreets.has(k)) pStreets.set(k, new Set());
    pStreets.get(k).add(one == null ? 'x' : one);
  }
  return { code, deals, byUnit, byParcel, byDate, pStreets, settlements: sh.settlements, scrapedAt: sh.scrapedAt };
}
const regRef = (d) => ({ date: d.date, unit: `${d.gushN}/${d.helkaN}/${d.subN == null ? '—' : d.subN}`, amount: d.amount, areaSqm: d.areaSqm, rooms: d.rooms, nature: d.nature, portion: d.portionFraction });

/* ── settlement name → official locality code: the register's own names per code + the official locality name ── */
function settlementIndex(D, shardNames) {
  const m = new Map();
  const add = (name, code) => { const k = normCity(name); if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(code); };
  for (const [code, names] of shardNames) for (const n of names || []) add(n, code);
  for (const l of D.localities.values()) add(l.he, l.code);
  for (const [n, code] of Object.entries(GOVMAP_NAMES)) if (D.localities.has(code)) add(n, code);
  return (name) => { const s = m.get(normCity(name)); return !s ? { code: null, why: 'unmapped' } : s.size > 1 ? { code: null, why: 'ambiguous', codes: [...s] } : { code: [...s][0] }; };
}

/**
 * The reconciliation of one fetched copy (pure apart from the stores it is handed).
 * @param {object[]} raw     GovMap rows, verbatim
 * @param {object}   ctx     { window:{from}, loadDay, EV, D, M (lib/streets/match) }
 */
function reconcile(raw, ctx) {
  const { window: win, loadDay, EV, D, M } = ctx;
  const rows = raw.map(normalize);
  /* rows the lifecycle carries from an EARLIER GovMap-layer copy (deals still awaiting confirmation that the copy read last no longer
     holds): reconciled like any row so a newer register copy can confirm them, never shown — a synthetic negative id keeps them apart
     from the current copy's object ids */
  (ctx.carried || []).forEach((g, i) => { const r = normalize(g); r.oid = -(i + 1); r.carried = true; rows.push(r); });
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.oid - b.oid);           // the canonical order
  const out = new Map();                                                        // oid → result
  const set = (r, cls, extra = {}) => out.set(r.oid, { oid: r.oid, cls, ...extra });
  /* the register copy read once: a locality's shard counts only when it holds the stored window (EV.shardOf's own rule — read here
     without re-reading the store per call); the settlement index needs every swept locality's register names */
  const S = EV.store();
  const shardOf = (code) => { const sh = S.available ? EV.shard(code) : null; return sh && sh.window && sh.window.from === S.meta.window.from && sh.window.to === S.meta.window.to ? sh : null; };
  const shardNames = new Map(), parcelCodes = new Map();
  for (const f of fs.readdirSync(EV.DIR || path.join(__dirname, '..', '..', 'data', 'streets', 'evidence')).filter((x) => /^\d+\.json$/.test(x))) {
    const sh = shardOf(Number(f.replace('.json', ''))); if (!sh) continue;
    shardNames.set(sh.cityCode, sh.settlements);
    /* block · parcel → every locality whose register copy holds a deal on it (the shard's parcel table lists exactly the parcels its
       deals stand on) */
    for (const p of sh.parcels) { const k = `${num(p[0])}|${num(p[1])}`; if (!parcelCodes.has(k)) parcelCodes.set(k, []); const a = parcelCodes.get(k); if (a[a.length - 1] !== sh.cityCode) a.push(sh.cityCode); }
  }
  const place = settlementIndex(D, shardNames);
  const regs = new Map();
  const reg = (code) => { if (!regs.has(code)) regs.set(code, registerOf(EV, code, shardOf)); return regs.get(code); };
  /* placement by block · parcel: exactly one locality's register copy lists it */
  const parcelPlace = (r) => {
    if (r.gush == null || r.parcel == null) return null;
    const s = parcelCodes.get(`${r.gush}|${r.parcel}`);
    return s && s.length === 1 ? s[0] : null;
  };
  /* 1 · the row-level exclusions */
  const live = [];
  for (const r of rows) {
    if (r.date > loadDay) { set(r, 'FUTURE_DATED'); continue; }
    const p = r.settlement ? place(r.settlement) : { code: null, why: 'no-settlement' };
    if (p.code == null) {
      const byParcel = parcelPlace(r);
      if (byParcel == null) { set(r, r.date < win.from ? 'CONTEXT_BEFORE_WINDOW' : r.settlement ? 'UNMAPPED_SETTLEMENT' : 'NO_SETTLEMENT', { why: p.why }); continue; }
      r.code = byParcel; r.placedBy = 'parcel';
    } else { r.code = p.code; r.placedBy = 'settlement'; }
    live.push(r);
  }
  /* 2 · in-source duplicates: an untyped row and a typed row of the same deal (context rows take part — a twin may sit across the
     window's edge). The untyped series states its own floor area (a few m² apart: 103 ↔ 101, 125 ↔ 122) and half rooms (4 ↔ 3.5),
     so a twin is the same locality · block · parcel, the amount within ₪1,000, the area within AREA_TOL, rooms within half a room */
  const typedByParcel = new Map();
  const pkey = (r) => `${r.code}|${r.gush}|${r.parcel}`;
  for (const r of live) if (r.typed && r.amount != null) { const k = pkey(r); if (!typedByParcel.has(k)) typedByParcel.set(k, []); typedByParcel.get(k).push(r); }
  const amountTwin = (t, u) => Math.abs(t.amount - u.amount) < 1000;
  const roomsOk = (t, u) => t.rooms == null || u.rooms == null || Math.abs(t.rooms - u.rooms) <= 0.5;
  const paired = new Set(), twinOf = new Map();
  for (const u of live) {
    if (u.typed || u.amount == null) continue;
    const sameAmount = (typedByParcel.get(pkey(u)) || []).filter((t) => amountTwin(t, u));
    const near = u.areaM == null ? [] : sameAmount.filter((t) => t.areaM != null && areaOk(t.areaM, u.areaM) && roomsOk(t, u));
    const cands = near.filter((t) => !paired.has(t.oid) && [0, 1].includes(dayDiff(t.date, u.date)));
    if (cands.length === 1) { paired.add(cands[0].oid); twinOf.set(u.oid, cands[0]); u.twinOf = cands[0].oid; cands[0].twin = u; }
    else if (cands.length > 1) u.ambiguousTwins = cands.map((t) => t.oid);
    else {
      /* maybe the same deal: a typed row of the same parcel with the amount within ₪1,000 within three days, WHATEVER the area and rooms
         (the untyped series' own) — never shown as new, so a deal is never listed twice */
      const maybe = sameAmount.filter((t) => Math.abs(dayDiff(t.date, u.date)) <= 3);
      if (maybe.length) u.possibleTwins = maybe.map((t) => t.oid);
    }
  }
  /* 3 · the register: every placed, non-duplicate row (window and context alike — context rows consume their register deals
     too, so a window row never takes a register deal that belongs to an older row). Two passes, so a weak match never takes a
     deal a strong one needs: PASS 1 (the same deal) — the same unit, or the same block · parcel, within one day, the amounts
     agreeing; PASS 2 (maybe the same deal, never shown as new) — the same unit within one day with another amount (the copy's own
     sub-parcel numbering makes a bare unit coincidence weak), or another parcel of the locality within one day with the same
     amount · area · rooms. The registers searched: the row's own locality first, then every other locality whose register copy
     holds a deal on the same block · parcel (a parcel on a municipal border, a settlement the register files under its neighbour) */
  const consumed = new Map();                                                    // register deal → the row that holds it
  const take = (code, d, r) => consumed.set(code + ':' + d.i, r.oid);
  const free = (code, d) => !consumed.has(code + ':' + d.i);
  const pending = [], possibles = [];
  /* a context row keeps what it would be inside the window (`asWindow`) — the lifecycle reads it when the window has moved past a
     deal it tracks; the context class itself is unchanged */
  const ctxSet = (r, cls, extra) => (r.date < win.from ? set(r, 'CONTEXT_BEFORE_WINDOW', { asWindow: { cls, ...extra } }) : set(r, cls, extra));
  for (const r of live) {
    if (r.twinOf != null) { ctxSet(r, 'DUPLICATE_IN_SOURCE', { twinOf: r.twinOf, dayGap: dayDiff(twinOf.get(r.oid).date, r.date) }); continue; }
    if (r.ambiguousTwins) { ctxSet(r, 'AMBIGUOUS_DUPLICATE', { candidates: r.ambiguousTwins }); continue; }
    if (r.possibleTwins) { possibles.push(r); continue; }                // never matched to the register itself; a twin through the register is still looked for
    pending.push(r);
  }
  const registersOf = (r) => [reg(r.code), ...(parcelCodes.get(`${r.gush}|${r.parcel}`) || []).filter((c) => c !== r.code).sort((x, y) => x - y).map(reg)].filter(Boolean);
  const keysOf = (r) => [r, r.twin].filter(Boolean);
  const within = (k, d) => Math.abs(dayDiff(k.date, d.date)) <= 1;
  /* the amounts agree: within ₪1,000 (or a share of the property) with the area to the metre; equal to the shekel with the area
     compatible; equal to the shekel and not a round thousand (a recorded consideration such as ₪1,388,560 — the area then decides
     nothing). A placeholder area (< MIN_AREA) is no area. */
  const agree = (k, d) => {
    const ka = k.areaM, da = d.areaSqm != null && d.areaSqm >= MIN_AREA ? d.areaSqm : null;
    if (k.amount == null || d.amount == null) return false;
    if (k.amount === d.amount && (k.amount % 1000 !== 0 || areaOk(ka, da))) return true;
    return (near(k.amount, d.amount) || amountRel(k.amount, d) === 'share') && area1(ka, da);
  };
  const strong = (r) => {
    const Rs = registersOf(r), keys = keysOf(r);
    for (const R of Rs) for (const k of keys) {
      const ps = (R.byUnit.get(`${k.gush}|${k.parcel}|${k.sub || 0}`) || []).filter((d) => free(R.code, d) && within(k, d) && keys.some((q) => agree(q, d)));
      if (ps.length) return { at: R, hit: ps.find((x) => x.date === k.date) || ps[0], via: k === r ? 'unit' : 'twin-unit' };
    }
    for (const R of Rs) {
      const hit = (R.byParcel.get(`${r.gush}|${r.parcel}`) || []).find((d) => free(R.code, d) && keys.some((k) => within(k, d) && agree(k, d)));
      if (hit) return { at: R, hit, via: 'parcel' };
    }
    return null;
  };
  const weak = (r) => {
    const Rs = registersOf(r), keys = keysOf(r);
    for (const R of Rs) for (const k of keys) {
      const hit = (R.byUnit.get(`${k.gush}|${k.parcel}|${k.sub || 0}`) || []).find((d) => free(R.code, d) && within(k, d));
      if (hit) return { at: R, hit, via: 'unit-other-amount' };
    }
    /* the same block · parcel within one day: the amount within ₪1,000 either way (a rounded amount) with a compatible area, or the
       same amount whatever the area */
    for (const R of Rs) {
      const hit = (R.byParcel.get(`${r.gush}|${r.parcel}`) || []).find((d) => free(R.code, d) && keys.some((k) => within(k, d) && k.amount != null && d.amount != null
        && (k.amount === d.amount || Math.abs(k.amount - d.amount) < 1000 && areaOk(k.areaM, d.areaSqm))));
      if (hit) return { at: R, hit, via: 'parcel-near' };
    }
    const own = reg(r.code);
    if (!own) return null;
    const hit = [-1, 0, 1].flatMap((k) => own.byDate.get(W.isoDay(Date.parse(r.date) + k * DAY)) || []).find((d) => free(own.code, d) && near(r.amount, d.amount) && area1(r.areaM, d.areaSqm) && (r.rooms == null || d.rooms == null || r.rooms === d.rooms));
    return hit ? { at: own, hit, via: 'possible' } : null;
  };
  /* an untyped row the strong pass left whose amount equals, to the shekel, a register deal on the same block · parcel within one
     day that another row of the copy already holds — the untyped series' area and rooms are not reliable (placeholders, 149 ↔ 79 m²),
     its amount is the register's: the row is a second representation of that deal (a twin found through the register) */
  /* … and (`via: register-share`, any row): a register deal of a PARTIAL sale (portion p < 1) that another row already holds, whose
     whole-property value (amount ÷ p) is this row's amount within ₪1,000 or 0.5 % — the copy prints a partial sale twice, once with
     the share's amount and once with the whole property's value (17 such rows on 20.10.2026) */
  const wholeOf = (x) => (x.amount != null && x.portionFraction > 0 && x.portionFraction < 1 ? x.amount / x.portionFraction : null);
  const viaRegister = (r) => {
    if (r.amount == null) return null;
    for (const R of registersOf(r)) {
      const held = (R.byParcel.get(`${r.gush}|${r.parcel}`) || []).filter((x) => !free(R.code, x) && within(r, x));
      const d = !r.typed && held.find((x) => x.amount === r.amount && (r.amount % 1000 !== 0 || areaOk(r.areaM, x.areaSqm)));
      if (d) return { holder: consumed.get(R.code + ':' + d.i), at: R, hit: d, via: 'register-amount' };
      const w = held.find((x) => wholeOf(x) != null && Math.abs(wholeOf(x) - r.amount) <= Math.max(1000, 0.005 * r.amount));
      if (w) return { holder: consumed.get(R.code + ':' + w.i), at: R, hit: w, via: 'register-share' };
    }
    return null;
  };
  const matched = new Map(), regTwins = new Map();
  const pass = (fn) => { for (const r of pending) { if (matched.has(r.oid) || regTwins.has(r.oid)) continue; const m = fn(r); if (m) { take(m.at.code, m.hit, r); matched.set(r.oid, m); } } };
  pass(strong);
  for (const r of [...pending, ...possibles]) if (!matched.has(r.oid)) { const t = viaRegister(r); if (t) regTwins.set(r.oid, t); }
  pass(weak);
  for (const r of possibles) {
    const t = regTwins.get(r.oid);
    if (t) ctxSet(r, 'DUPLICATE_IN_SOURCE', { twinOf: t.holder, via: t.via, register: { ...regRef(t.hit), code: t.at.code } });
    else ctxSet(r, 'POSSIBLE_DUPLICATE_IN_SOURCE', { candidates: r.possibleTwins });
  }
  for (const r of pending) {
    const m = matched.get(r.oid), t = regTwins.get(r.oid);
    if (t) { ctxSet(r, 'DUPLICATE_IN_SOURCE', { twinOf: t.holder, via: t.via, register: { ...regRef(t.hit), code: t.at.code } }); continue; }
    if (!m) { ctxSet(r, 'RECENT_NEW', { twin: r.twin ? r.twin.oid : null, placedBy: r.placedBy }); continue; }
    const { at, hit, via } = m;
    const conflicts = [];
    if (at.code !== r.code) conflicts.push({ field: 'locality', govmap: r.code, register: at.code });
    const ar = amountRel(r.amount, hit);
    if (ar !== 'equal') conflicts.push({ field: 'amount', govmap: r.amount, register: hit.amount, kind: ar, ...(r.twin ? { twinAmount: r.twin.amount } : {}) });
    const dk = via === 'twin-unit' ? r.twin : r;
    if (dk.date !== hit.date) conflicts.push({ field: 'date', govmap: r.date, register: hit.date, ...(r.twin ? { twinDate: r.twin.date } : {}) });
    if (`${r.gush}/${r.parcel}/${r.sub || 0}` !== `${hit.gushN}/${hit.helkaN}/${hit.subN || 0}`) conflicts.push({ field: `${r.gush}/${r.parcel}` === `${hit.gushN}/${hit.helkaN}` ? 'sub-parcel' : 'parcel', govmap: `${r.gush}/${r.parcel}/${r.sub}`, register: `${hit.gushN}/${hit.helkaN}/${hit.subN}`, ...(r.twin ? { twinUnit: `${r.twin.gush}/${r.twin.parcel}/${r.twin.sub}` } : {}) });
    if (r.areaM != null && hit.areaSqm != null && Math.abs(r.areaM - hit.areaSqm) > 1) conflicts.push({ field: 'area', govmap: r.area, register: hit.areaSqm });
    if (r.rooms != null && hit.rooms != null && r.rooms !== hit.rooms) conflicts.push({ field: 'rooms', govmap: r.rooms, register: hit.rooms });
    ctxSet(r, via === 'unit-other-amount' || via === 'parcel-near' || via === 'possible' ? 'POSSIBLY_IN_REGISTER' : via === 'parcel' ? 'IN_REGISTER_OTHER_UNIT' : 'IN_REGISTER',
      { via, register: { ...regRef(hit), code: at.code }, conflicts, twin: r.twin ? r.twin.oid : null });
  }
  /* 4 · the shown rows: nature, pricing and the street (the address as published, the register's parcel crosswalk, or both) */
  const LIs = new Map();
  const LI = (code) => { if (!LIs.has(code)) LIs.set(code, M.localityIndex(D, code)); return LIs.get(code); };
  const DW = EV.DWELLING_NATURES, EX = EV.EXCLUDED_NATURES;
  const kindOf = (r) => { const nk = EV.natureKey(r.nature); return !r.typed ? 'TYPE_NOT_STATED' : nk && DW.has(nk) ? 'DWELLING' : nk && EX.has(nk) ? 'NON_DWELLING' : r.type === 'דירה' && !nk ? 'TYPE_NOT_STATED' : 'NON_DWELLING'; };
  /* the street: the address as published (resolved in the official directory) and the register's parcel crosswalk */
  const streetOf = (r) => {
    if (r.code == null) return { code: null, basis: 'no-locality' };
    const R = reg(r.code);
    const ps = R ? R.pStreets.get(`${r.gush}|${r.parcel}`) : null;
    const parcelStreet = ps && ps.size === 1 && !ps.has('x') ? [...ps][0] : null;
    const res = r.street ? M.resolveStreet(LI(r.code), r.street) : null;
    const addr = res && res.id ? { code: Number(String(res.id).split(':')[2]), via: res.via } : null;
    const strongAddr = addr && addr.via !== M.VIA.ALIAS;
    if (strongAddr && (parcelStreet == null || parcelStreet === addr.code)) return { code: addr.code, basis: parcelStreet != null ? 'address+parcel' : 'address', via: addr.via };
    if (addr && !strongAddr && parcelStreet === addr.code) return { code: addr.code, basis: 'address+parcel', via: addr.via };
    if (!addr && parcelStreet != null && !(res && res.ambiguous)) return { code: parcelStreet, basis: 'parcel', via: 'parcel-crosswalk' };
    return { code: null, basis: addr && parcelStreet != null ? 'conflict' : addr ? 'possible' : res && res.ambiguous ? 'ambiguous' : r.street ? 'unresolved' : 'no-address',
      address: addr ? addr.code : null, parcel: parcelStreet };
  };
  for (const r of live) {
    const o = out.get(r.oid);
    if (!o || o.cls !== 'RECENT_NEW') continue;
    o.kind = kindOf(r);
    o.priced = r.amount != null && r.amount >= MIN_MARKET;
    o.pricePerSqm = o.priced && r.area != null && r.area >= MIN_AREA ? Math.round(r.amount / r.area) : null;
    o.street = streetOf(r);
  }
  return { rows, out, regs, consumed, registersOf, parcelCodes, streetOf, kindOf };
}

/* ── the replay of the 19.10.2026 comparison (scripts/tx-freshness-discover.js --compare, run 39329664397) — its classifier,
   verbatim, over its own input: the reconciliation must reproduce its 2,293 "reported late" deals EXACTLY ── */
const AUDIT = Object.freeze({ today: '2026-10-19', from: '2025-09-18', copyEnd: '2026-09-17', lateDays: 75,
  late: { 'פתח תקווה': 251, 'תל אביב-יפו': 334, 'ירושלים': 311, 'חיפה': 420, 'באר שבע': 351, 'ראשון לציון': 200, 'נתניה': 211, 'אשדוד': 215 } });
const AUDIT_CODES = { 'תל אביב-יפו': 5000, 'ירושלים': 3000, 'פתח תקווה': 7900, 'חיפה': 4000, 'באר שבע': 9000, 'ראשון לציון': 8300, 'נתניה': 7400, 'אשדוד': 70 };
function auditClassify(Gin, EV, code) {
  const { today, from, copyEnd } = AUDIT;
  const lateFrom = W.minusDays(copyEnd, AUDIT.lateDays);
  const G = Gin.filter((g) => String(g.deal_date).slice(0, 10) >= from).map((g) => ({ oid: Number(g.objectid), sub: num(g.sub_parcel), gush: num(g.gush), parcel: num(g.parcel), amount: num(g.deal_amount), area: num(g.asset_area), rooms: num(g.rooms), date: String(g.deal_date).slice(0, 10) }));
  const sh = EV.shardOf(code);
  const P = sh ? EV.dealsOf(sh).map((x) => ({ ...x.deal, gushN: num(x.deal.gush), helkaN: num(x.deal.helka), subN: num(x.deal.subParcel) })).filter((d) => d.date >= from) : [];
  const unit = (gush, parcel, sub) => `${gush}|${parcel}|${sub || 0}`;
  const pByUnit = new Map(); for (const d of P) { const k = unit(d.gushN, d.helkaN, d.subN); if (!pByUnit.has(k)) pByUnit.set(k, []); pByUnit.get(k).push(d); }
  const pByParcel = new Map(); for (const d of P) { const k = `${d.gushN}|${d.helkaN}`; if (!pByParcel.has(k)) pByParcel.set(k, []); pByParcel.get(k).push(d); }
  const pByDate = new Map(); for (const d of P) { if (!pByDate.has(d.date)) pByDate.set(d.date, []); pByDate.get(d.date).push(d); }
  const matched = new Set();
  const res = [];
  for (const g of G) {
    if (g.date > today) { res.push([g.oid, 'FUTURE_DATED_AT_SOURCE']); continue; }
    const ps = (pByUnit.get(unit(g.gush, g.parcel, g.sub)) || []).filter((d) => !matched.has(d) && Math.abs(dayDiff(g.date, d.date)) <= 1);
    if (ps.length) {
      const d = ps.find((x) => x.date === g.date && x.amount === g.amount) || ps.find((x) => near(g.amount, x.amount)) || ps.find((x) => x.date === g.date) || ps[0];
      matched.add(d); res.push([g.oid, 'MATCHED']); continue;
    }
    const sameArea = (d) => g.area == null || d.areaSqm == null || Math.abs(g.area - d.areaSqm) <= 1;
    const sameParcel = (pByParcel.get(`${g.gush}|${g.parcel}`) || []).find((d) => !matched.has(d) && Math.abs(dayDiff(g.date, d.date)) <= 1 && (near(g.amount, d.amount) || amountRel(g.amount, d) === 'share') && sameArea(d));
    if (sameParcel) { matched.add(sameParcel); res.push([g.oid, 'MATCHED']); continue; }
    const sameDay = [-1, 0, 1].flatMap((k) => pByDate.get(W.isoDay(Date.parse(g.date) + k * DAY)) || []).find((d) => !matched.has(d) && near(g.amount, d.amount) && sameArea(d) && (g.rooms == null || d.rooms == null || g.rooms === d.rooms));
    if (sameDay) { matched.add(sameDay); res.push([g.oid, 'POSSIBLY_SAME']); continue; }
    res.push([g.oid, g.date >= lateFrom ? 'MISSING_IN_PROPX_REPORTED_LATE' : 'MISSING_IN_PROPX_OLDER']);
  }
  return res;
}

/* ── the build: raw rows (latest window snapshot) × the register copy → the layer, the per-row reconciliation, the audit replay ── */
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readGzLines = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ROW_COLUMNS = ['oid', 'dealId', 'series', 'date', 'amount', 'areaSqm', 'rooms', 'floor', 'propertyType', 'dealNature', 'kind', 'cityCode', 'settlement', 'street', 'house',
  'streetCode', 'streetBasis', 'block', 'parcel', 'subParcel', 'priced', 'pricePerSqm', 'twinOid', 'twinDate', 'twinSubParcel', 'twinAmount', 'placedBy', 'state',
  'reasons', 'event', 'semantics', 'firstReadAt'];

/* what a build depends on: the stored window snapshot, the register copy, the audit replay and this engine's code — a build with
   the same inputs writes nothing (the daily job commits only a real change) */
function inputsOf(snap, S, rp) {
  const code = crypto.createHash('sha256').update(fs.readFileSync(__filename)).update(fs.readFileSync(path.join(__dirname, 'window.js'))).update(fs.readFileSync(path.join(__dirname, 'promote.js'))).update(fs.readFileSync(path.join(__dirname, 'lifecycle.js'))).digest('hex').slice(0, 16);
  return { snapshot: snap.sha256, register: { scrapedAt: S.meta.source.scrapedAt, lastDeal: S.meta.source.lastDeal, window: S.meta.window || null }, replay: rp ? rp.sha256 : null, code };
}

function build({ root = path.join(__dirname, '..', '..'), write = true, force = false } = {}) {
  const EV = require('../streets/evidence'), SD = require('../streets/directory'), M = require('../streets/match');
  const dir = path.join(root, 'data', 'streets', 'recent');
  const idx = readJson(path.join(dir, 'raw', 'index.json'));
  const snap = idx && idx.snapshots.filter((x) => x.kind === 'window').pop();
  if (!snap) return { ok: false, error: 'no stored window snapshot' };
  const raw = readGzLines(path.join(dir, 'raw', snap.file));
  const body = raw.map((g) => JSON.stringify(g)).join('\n') + '\n';
  if (crypto.createHash('sha256').update(body).digest('hex') !== snap.sha256) return { ok: false, error: 'the stored snapshot does not match its hash' };
  const S = EV.store();
  if (!S.available) return { ok: false, error: 'no stored register copy' };
  const win = W.windowOf(S.meta.source.lastDeal);
  if (win.from < snap.window.from) return { ok: false, error: `the stored snapshot starts ${snap.window.from}, after the window (${win.from}) — fetch again` };
  const loadDay = String(snap.copy.loadedAt).slice(0, 10);
  const rp0 = readJson(path.join(dir, 'audit', `replay-v${snap.copy.version}.meta.json`));
  const inputs = inputsOf(snap, S, rp0);
  const prev = readJson(path.join(dir, 'meta.json'));
  if (write && !force && prev && JSON.stringify(prev.inputs) === JSON.stringify(inputs)) return { ok: true, unchanged: true, meta: prev, audit: prev.audit ? { replayedTotal: prev.audit.replayedTotal, exact: prev.audit.exact } : null };
  const D = SD.load();
  const builtAt = new Date().toISOString();
  /* the lifecycle ledger (lib/recent/lifecycle.js, append-only) — and the deals it still waits on that this copy no longer holds:
     carried from the copy that first showed them, so a newer register copy can still confirm them (never shown, never counted) */
  const LC = require('./lifecycle');
  const ledgerEvents = LC.read(dir);
  const ledger = LC.fold(ledgerEvents);
  const inSnap = new Set(raw.map((g) => 'govmap:' + String(g.deal_id)));
  const carried = [], byFile = new Map();
  for (const c of ledger.values()) {
    if (c.closed || inSnap.has(c.key) || !c.observation || !c.observation.snapshotFile) continue;
    const f = c.observation.snapshotFile;
    if (!byFile.has(f)) { const fp = path.join(dir, 'raw', f); byFile.set(f, fs.existsSync(fp) ? new Map(readGzLines(fp).map((g) => ['govmap:' + String(g.deal_id), g])) : new Map()); }
    const g = byFile.get(f).get(c.key);
    if (g) carried.push(g);
  }
  const rec = reconcile(raw, { window: win, loadDay, EV, D, M, carried });
  const { out } = rec;
  const rows = rec.rows.filter((r) => !r.carried);                              // the current copy's rows — every figure below reads these
  const recNow = { ...rec, rows };
  /* the promotion of every shown row (lib/recent/promote.js) — stored beside it; no statistic reads it yet */
  const P = require('./promote');
  const rawMap = new Map(raw.map((g) => [Number(g.objectid), g]));
  carried.forEach((g, i) => rawMap.set(-(i + 1), g));
  const prom = P.promote(rec, { raw: rawMap, window: win, lastDeal: snap.copy.lastDeal, snapshotSha: snap.sha256 });
  /* the lifecycle step: new events only where the state changed (a rebuild with the same inputs appends nothing) */
  const newEvents = LC.step(ledger, { rows: rec.rows, out, prom, regs: rec.regs, streetOf: rec.streetOf, kindOf: rec.kindOf, raw: rawMap,
    snapshot: { sha256: snap.sha256, file: snap.file, fetchedAt: snap.fetchedAt, copy: snap.copy }, register: { scrapedAt: S.meta.source.scrapedAt, lastDeal: S.meta.source.lastDeal }, at: builtAt });
  const allEvents = [...ledgerEvents, ...newEvents];
  const lifeNow = LC.fold(allEvents);
  const byOid = new Map(rows.map((r) => [r.oid, r]));
  /* the layer: RECENT_NEW rows only, columnar */
  const shown = rows.filter((r) => out.get(r.oid).cls === 'RECENT_NEW');
  const layerRows = shown.map((r) => { const o = out.get(r.oid), t = r.twin;
    return [r.oid, r.dealId, r.series, r.date, r.amount, r.area, r.rooms, r.floor, r.type, r.nature, o.kind, r.code, r.settlement, r.street, r.house,
      o.street.code, o.street.basis, r.gush, r.parcel, r.sub, o.priced, o.pricePerSqm, t ? t.oid : null, t ? t.date : null, t ? t.sub : null, t ? t.amount : null, r.placedBy, prom.get(r.oid).state,
      prom.get(r.oid).reasons, prom.get(r.oid).eligible.event, prom.get(r.oid).semantics, ((lifeNow.get(LC.keyOf(r)) || {}).observation || {}).firstReadAt || snap.fetchedAt]; });
  const byStreet = {}, byCode = {};
  layerRows.forEach((x, i) => { const sc = x[15], cc = x[11]; if (sc != null) (byStreet[`st:${cc}:${sc}`] = byStreet[`st:${cc}:${sc}`] || []).push(i); (byCode[cc] = byCode[cc] || []).push(i); });
  const tally = (xs) => xs.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
  const classes = tally(rows.map((r) => out.get(r.oid).cls));
  const conflictFields = tally(rows.flatMap((r) => (out.get(r.oid).conflicts || []).map((c) => c.field + (c.kind ? ':' + c.kind : ''))));
  /* the copy's dates against the register's, per series, over the deals both hold (register date − GovMap date) — the basis of the
     date note on an untyped row */
  const offsets = {};
  for (const r of rows) { const o = out.get(r.oid); if (!o.register || !['IN_REGISTER', 'IN_REGISTER_OTHER_UNIT'].includes(o.cls)) continue;
    const k = r.typed ? 'typed' : 'untyped'; const dd = dayDiff(o.register.date, r.date); offsets[k] = offsets[k] || {}; offsets[k][dd] = (offsets[k][dd] || 0) + 1; }
  const register = { id: 'over:deals-register', datasetId: S.meta.source.datasetId, scrapedAt: S.meta.source.scrapedAt, lastDeal: S.meta.source.lastDeal };
  const meta = {
    schema: 1, builtAt, engine: 'propx-recent-1', inputs,
    source: { id: 'over:govmap-recent', name: 'GovMap deals layer (lay=16) — republished copy (over.org.il)', channel: 'independent-republication', ...snap.copy,
      snapshot: { sha256: snap.sha256, file: snap.file, fetchedAt: snap.fetchedAt, proof: snap.proof, rows: raw.length } },
    register, window: { ...win, to: loadDay, contextFrom: snap.window.contextFrom },
    classes, conflictFields, dateOffsets: offsets,
    shown: { rows: shown.length, kinds: tally(shown.map((r) => out.get(r.oid).kind)), street: tally(shown.map((r) => out.get(r.oid).street.basis)),
      latest: shown.map((r) => r.date).sort().pop() || null, localities: new Set(shown.map((r) => r.code)).size, streets: Object.keys(byStreet).length },
    rules: CLASSES,
  };
  /* the promotion: states, reasons, the same-parcel audit, what each use may read — and the evidence the rules rest on */
  const pr = shown.map((r) => [r, prom.get(r.oid)]);
  const audited = pr.filter(([, p]) => p.audit);
  const E = (k) => pr.filter(([, p]) => p.eligible[k]).length;
  meta.promotion = { engine: 'propx-recent-promotion-1', states: P.STATES, byState: Object.fromEntries(P.STATES.map((s) => [s, pr.filter(([, p]) => p.state === s).length])),
    byStateKind: tally(pr.map(([r, p]) => p.state + ':' + out.get(r.oid).kind)), reasons: tally(pr.flatMap(([, p]) => p.reasons)),
    eligible: { event: E('event'), count: E('count'), median: E('median'), pricePerSqm: E('pricePerSqm'), change: E('change'), model: E('model') },
    eventGatesFailed: tally(pr.flatMap(([, p]) => p.eligible.eventFailed)), semantics: tally(pr.map(([, p]) => p.semantics)),
    sameParcelAudit: { rows: audited.length, verdicts: tally(audited.map(([, p]) => p.audit.verdict)),
      withFreeRegisterDeal: audited.filter(([, p]) => p.audit.freeRegisterDeal).length, freeVerdicts: tally(audited.filter(([, p]) => p.audit.freeRegisterDeal).map(([, p]) => p.audit.verdict)) },
    calibration: P.calibration(recNow), shareEvidence: P.shareEvidence(recNow), thresholds: { amountTolPct: P.AMOUNT_TOL * 100, areaTolPct: P.AREA_TOL * 100, minMarket: MIN_MARKET, minArea: MIN_AREA } };
  const promotion = { columns: ['oid', 'state', 'reasons', 'audit', 'freeRegisterDeal', 'priced', 'pricePerSqm', 'event', 'eventFailed', 'count', 'median', 'pricePerSqmEligible', 'change', 'model', 'semantics'],
    rows: pr.map(([r, p]) => [r.oid, p.state, p.reasons, p.audit ? p.audit.verdict : null, p.audit ? p.audit.freeRegisterDeal : null, p.priced, p.pricePerSqm,
      p.eligible.event, p.eligible.eventFailed, p.eligible.count, p.eligible.median, p.eligible.pricePerSqm, p.eligible.change, p.eligible.model, p.semantics]),
    audits: Object.fromEntries(audited.map(([r, p]) => [r.oid, p.audit.cases])) };
  /* the lifecycle: the ledger's current state, its transitions and confirmations, and what this build appended */
  meta.lifecycle = { ...LC.summary(allEvents), carried: carried.length, thisBuild: { events: newEvents.length, byEvent: tally(newEvents.map((e) => e.event)) } };
  /* the per-row reconciliation (every fetched row, one class) */
  const recRows = rows.map((r) => { const o = out.get(r.oid); return [r.oid, o.cls, r.date, r.code ?? null, o.twinOf ?? o.twin ?? null, o.via || null, o.register ? `${o.register.date} ${o.register.unit} ${o.register.amount}` : null,
    (o.conflicts || []).map((c) => `${c.field}:${c.govmap}→${c.register}`).join(' · ') || null]; });
  /* the audit replay → the exact 2,293 */
  let audit = null;
  const rp = readJson(path.join(dir, 'audit', `replay-v${snap.copy.version}.meta.json`));
  if (rp) {
    const lines = readGzLines(path.join(dir, 'audit', `replay-v${snap.copy.version}.jsonl.gz`));
    const perCity = {};
    const lateRows = [];
    for (const city of Object.keys(AUDIT.late)) {
      const G = lines.filter((x) => x.city === city).map((x) => x.row);   // spelling by spelling, newest first: the comparison's order
      const res = auditClassify(G, EV, AUDIT_CODES[city]);
      const late = res.filter(([, c]) => c === 'MISSING_IN_PROPX_REPORTED_LATE').map(([oid]) => oid);
      perCity[city] = { expected: AUDIT.late[city], replayed: late.length };
      for (const oid of late) lateRows.push({ oid, city });
    }
    /* why a deal the comparison called missing is in the register here: the register files it under a neighbouring locality · the
       comparison's one pass let another row's weaker match take the deal first (the row alone meets the comparison's own rule) ·
       the in-source twin's unit or exact amount · a rounded amount */
    const why = (o, r) => {
      if (!o || !o.register || !/REGISTER/.test(o.cls)) return null;
      if ((o.conflicts || []).some((c) => c.field === 'locality')) return 'REGISTER_UNDER_NEIGHBOUR_LOCALITY';
      const d = o.register, sameUnit = d.unit === `${r.gush}/${r.parcel}/${r.sub == null ? '—' : r.sub}`, dd = Math.abs(dayDiff(d.date, r.date));
      const alone = dd <= 1 && (sameUnit || d.unit.startsWith(`${r.gush}/${r.parcel}/`) && (near(r.amount, d.amount) || amountRel(r.amount, { amount: d.amount, portionFraction: d.portion }) === 'share') && area1(r.area, d.areaSqm));
      if (alone) return 'TAKEN_FIRST_BY_ANOTHER_ROW_IN_THE_COMPARISON';
      if (o.twin != null) return 'MATCHED_THROUGH_IN_SOURCE_TWIN';
      return o.via === 'parcel-near' ? 'ROUNDED_AMOUNT' : 'EXACT_AMOUNT';
    };
    const mapped = lateRows.map(({ oid, city }) => {
      const o = out.get(oid), r = byOid.get(oid);
      return { oid, city, cls: o ? o.cls : 'NOT_IN_WINDOW_SNAPSHOT', kind: o && o.kind || null, twinOf: o && (o.twinOf ?? null), register: o && o.register ? o.register : null, date: r ? r.date : null, why: r ? why(o, r) : null };
    });
    audit = { replay: { sha256: rp.sha256, rows: rp.rows, fetchedAt: rp.fetchedAt, copy: rp.copy }, expectedTotal: Object.values(AUDIT.late).reduce((a, b) => a + b, 0),
      replayedTotal: lateRows.length, perCity, exact: Object.values(perCity).every((x) => x.expected === x.replayed),
      newClasses: tally(mapped.map((x) => x.cls + (x.kind ? ':' + x.kind : ''))), inRegisterWhy: tally(mapped.filter((x) => x.why).map((x) => x.why)),
      columns: ['oid', 'city', 'class', 'kind', 'twinOf', 'date', 'inRegisterWhy'], rows: mapped.map((x) => [x.oid, x.city, x.cls, x.kind, x.twinOf, x.date, x.why]) };
  }
  const res = { ok: true, newEvents, meta, layer: { columns: ROW_COLUMNS, rows: layerRows, byStreet, byCode }, reconciliation: { columns: ['oid', 'class', 'date', 'cityCode', 'twin', 'via', 'register', 'conflicts'], rows: recRows }, audit, promotion };
  if (write) {
    const w = (f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o) + '\n');
    w('meta.json', { ...meta, audit: audit ? { expectedTotal: audit.expectedTotal, replayedTotal: audit.replayedTotal, exact: audit.exact, perCity: audit.perCity, newClasses: audit.newClasses, inRegisterWhy: audit.inRegisterWhy } : null });
    w('layer.json', { schema: 1, builtAt: meta.builtAt, source: meta.source.id, copyLoadedAt: meta.source.loadedAt, register: register.scrapedAt, window: meta.window, ...res.layer });
    w('reconciliation.json', { schema: 1, builtAt: meta.builtAt, ...res.reconciliation });
    if (audit) w('audit-2293.json', { schema: 1, builtAt: meta.builtAt, ...audit });
    w('promotion.json', { schema: 1, builtAt: meta.builtAt, engine: meta.promotion.engine, summary: meta.promotion, ...promotion });
    if (newEvents.length) fs.appendFileSync(path.join(dir, LC.FILE), newEvents.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.appendFileSync(path.join(dir, 'sync-runs.jsonl'), JSON.stringify({ id: 'recent-reconcile-' + meta.builtAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: 'over:govmap-recent', status: 'rebuilt',
      startedAt: meta.builtAt, finishedAt: new Date().toISOString(), requests: 0, retrievalMethod: 'none', shown: shown.length, classes, audit: audit ? { replayed: audit.replayedTotal, exact: audit.exact } : null }) + '\n');
  }
  return res;
}
const summaryLine = (res) => (!res.ok ? `recent reconcile FAILED: ${res.error}` : res.unchanged ? `recent layer unchanged (same copy, register copy, replay and engine) — ${res.meta.shown.rows} new recent deals shown` : `recent layer: ${res.meta.shown.rows} new recent deals shown (${JSON.stringify(res.meta.shown.kinds)}) · classes ${JSON.stringify(res.meta.classes)}${res.audit ? ` · audit 2,293 replay ${res.audit.replayedTotal} (${res.audit.exact ? 'EXACT' : 'MISMATCH'})` : ''}`);

module.exports = { CLASSES, AUDIT, AUDIT_CODES, ROW_COLUMNS, normCity, normalize, reconcile, auditClassify, build, summaryLine, amountRel, near, settlementIndex, GOVMAP_NAMES };
