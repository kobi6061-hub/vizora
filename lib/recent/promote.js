// PROPX · RECENT TRANSACTIONS LAYER — the PROMOTION state of every recent-only deal (20.10.2026).
//
// Which RECENT_NEW rows (lib/recent/reconcile.js) are reliable enough to take part in PROPX's factual market statistics and, later,
// the Street Value Model. Nothing here changes a statistic: the state and the eligibility flags are stored beside each row
// (data/streets/recent/promotion.json) so the set can be proven clean BEFORE anything reads it.
//
// THE STATES (the first rule a row meets decides):
//   RECENT_CONFLICT            two keys disagree: the settlement name places the row in one locality while every register copy that
//                              lists its block · parcel is another locality's · the published address names another street than the
//                              register's parcel crosswalk · the same-parcel audit calls it a POSSIBLE DUPLICATE of a register deal
//   RECENT_UNRESOLVED          something essential cannot be determined: no property type (the copy's second series) · a published
//                              address that resolves to no official street or to several · no block · parcel · an UNRESOLVED audit
//   RECENT_CONTEXT_ONLY        a valid observed deal that can only describe its surroundings: not a dwelling, or no street key at all
//                              (no address published and no single-street parcel in the register's crosswalk) — locality context
//   RECENT_OBSERVED_LIMITED    an observed dwelling deal on a street whose use is limited: the street rests on ONE key (the published
//                              address alone) or the price semantics are not established — the copy states no ownership share (every
//                              row: see SHARE below), a consideration below ₪100,000, or one consideration for several units
//   RECENT_OBSERVED_VERIFIED   every criterion: locality · street (two keys, or the register's own OBSERVED parcel rule) · date ·
//                              dwelling · price · area (when ₪/m² is used) · not a duplicate / possible duplicate / conflict ·
//                              whole-property sale stated · parcel coherent · provenance (the stored raw row and its hash)
//
// SHARE: the register states the share sold (portion); the GovMap-layer copy has no such field. Over the deals both copies hold, a
// partial sale is printed sometimes with the share's amount and sometimes with the whole property's value, with nothing in the row
// to tell them apart (`shareEvidence` in the build measures it) — so no recent-only row can show it is a whole-property sale, and none
// is VERIFIED while the copy states no share. The register counts partial sales in its observed deals; it never prices them.
//
// THE SAME-PARCEL AUDIT (each shown row with a register deal on its block · parcel within one day): the copies print one deal's amount
// the same way (typed series: truncated to ₪1,000; untyped: exact) and its area to the metre; the largest differences seen in deals
// both copies hold are below AMOUNT_TOL / AREA_TOL. Per register deal: amount fits its representation → POSSIBLE DUPLICATE (the
// register deal would then be printed twice) · amount differs > AMOUNT_TOL and area differs > AREA_TOL → CONFIRMED SEPARATE DEAL ·
// amount differs > AMOUNT_TOL, or area differs > AREA_TOL → LIKELY SEPARATE DEAL · amount within AMOUNT_TOL, area not shown to differ
// → POSSIBLE DUPLICATE, unless another row already prints that register deal (then LIKELY SEPARATE DEAL) · an amount missing →
// UNRESOLVED. A row takes its most cautious verdict over all such register deals.

'use strict';

const { MIN_MARKET, MIN_AREA, MIN_SQM } = require('../streets/evidence');

const STATES = ['RECENT_OBSERVED_VERIFIED', 'RECENT_OBSERVED_LIMITED', 'RECENT_CONTEXT_ONLY', 'RECENT_CONFLICT', 'RECENT_UNRESOLVED'];
const AUDIT = ['CONFIRMED_SEPARATE_DEAL', 'LIKELY_SEPARATE_DEAL', 'POSSIBLE_DUPLICATE', 'UNRESOLVED'];
const AMOUNT_TOL = 0.02, AREA_TOL = 0.02;
/* a field that would state the share sold — none exists in the copy today; read if it ever appears */
const SHARE_FIELDS = ['deal_part', 'part', 'portion', 'share', 'deal_portion'];
const STRONG_STREET = new Set(['address+parcel', 'parcel']);
const DAY = 864e5;
const dd = (a, b) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / DAY));
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
const near = (g, d) => g != null && d != null && (g === d || (g <= d && d - g < 1000));
const validArea = (a) => (a != null && a >= MIN_AREA ? a : null);

/** one register deal against one shown row → { verdict, why } */
function judge(r, d) {
  const keys = [r, r.twin].filter(Boolean);
  if (r.amount == null || d.amount == null) return { verdict: 'UNRESOLVED', why: 'amount missing' };
  const whole = d.portionFraction > 0 && d.portionFraction < 1 ? d.amount / d.portionFraction : null;
  /* the representation of the register deal in the copy: typed = the amount truncated to ₪1,000, untyped = the exact amount; a partial
     sale also as its whole-property value */
  const fits = keys.some((k) => (k.typed ? near(k.amount, d.amount) : k.amount === d.amount) || (whole != null && Math.abs(k.amount - whole) <= Math.max(1000, 0.005 * k.amount)));
  if (fits) return { verdict: 'POSSIBLE_DUPLICATE', why: 'the amount fits this register deal' };
  const ra = Math.min(...keys.map((k) => rel(k.amount, d.amount)), ...(whole != null ? keys.map((k) => rel(k.amount, whole)) : []));
  const aR = r.typed ? validArea(r.areaM) : null, aD = validArea(d.areaSqm);
  const rA = aR != null && aD != null ? rel(aR, aD) : null;
  const pct = (x) => `${(x * 100).toFixed(1)} %`;
  if (ra > AMOUNT_TOL && rA != null && rA > AREA_TOL) return { verdict: 'CONFIRMED_SEPARATE_DEAL', why: `amount ${pct(ra)} and area ${pct(rA)} apart` };
  if (ra > AMOUNT_TOL) return { verdict: 'LIKELY_SEPARATE_DEAL', why: `amount ${pct(ra)} apart${rA == null ? ' (area not comparable)' : `, area ${pct(rA)}`}` };
  if (rA != null && rA > AREA_TOL) return { verdict: 'LIKELY_SEPARATE_DEAL', why: `area ${pct(rA)} apart, amount ${pct(ra)}` };
  return { verdict: 'POSSIBLE_DUPLICATE', why: `amount ${pct(ra)} apart${rA == null ? ' (area not comparable)' : `, area ${pct(rA)}`}` };
}

/** the same-parcel audit of one shown row: every register deal on its block · parcel within one day of the row (or its twin) */
function parcelAudit(r, res) {
  const { consumed, registersOf } = res;
  const keys = [r, r.twin].filter(Boolean);
  const cases = [];
  for (const R of registersOf(r)) for (const d of R.byParcel.get(`${r.gush}|${r.parcel}`) || []) {
    if (!keys.some((k) => dd(k.date, d.date) <= 1)) continue;
    const holder = consumed.get(R.code + ':' + d.i);
    let j = judge(r, d);
    /* a register deal another row already prints (its representation fits that row): this row is a second print of it only when its
       amount fits the same representation — a near amount that does not fit is another deal (the copies print one deal one way) */
    if (holder != null && j.verdict === 'POSSIBLE_DUPLICATE' && j.why !== 'the amount fits this register deal') j = { verdict: 'LIKELY_SEPARATE_DEAL', why: `${j.why}; that register deal is printed by row ${holder}` };
    cases.push({ code: R.code, date: d.date, unit: `${d.gushN}/${d.helkaN}/${d.subN == null ? '—' : d.subN}`, amount: d.amount, areaSqm: d.areaSqm, rooms: d.rooms,
      portion: d.portionFraction, heldBy: holder == null ? null : holder, ...j });
  }
  if (!cases.length) return null;
  const worst = cases.reduce((w, c) => (AUDIT.indexOf(c.verdict) > AUDIT.indexOf(w) ? c.verdict : w), AUDIT[0]);
  return { verdict: worst, freeRegisterDeal: cases.some((c) => c.heldBy == null), cases };
}

/** several units for one consideration in the copy: typed rows of one parcel, one date, one amount, more than one sub-parcel */
function multiUnitIndex(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r.typed || r.code == null || r.amount == null) continue;
    const k = `${r.code}|${r.gush}|${r.parcel}|${r.date}|${r.amount}`;
    if (!m.has(k)) m.set(k, new Set()); m.get(k).add(r.sub);
  }
  return (r) => { const s = m.get(`${r.code}|${r.gush}|${r.parcel}|${r.date}|${r.amount}`); return s ? s.size : 0; };
}

/**
 * The promotion of every RECENT_NEW row.
 * @param res  the reconciliation result (rows, out, consumed, registersOf, parcelCodes)
 * @param ctx  { raw: Map oid → the verbatim row, window: { from }, lastDeal, snapshotSha }
 */
function promote(res, ctx) {
  const { rows, out, parcelCodes } = res;
  const units = multiUnitIndex(rows);
  const result = new Map();
  for (const r of rows) {
    const o = out.get(r.oid);
    if (!o || o.cls !== 'RECENT_NEW') continue;
    const reasons = [];
    const g = ctx.raw.get(r.oid) || {};
    /* identity */
    const listed = r.gush != null && r.parcel != null ? parcelCodes.get(`${r.gush}|${r.parcel}`) : null;
    const localityConflict = r.placedBy === 'settlement' && listed && listed.length && !listed.includes(r.code);
    const audit = parcelAudit(r, res);
    const st = o.street || {};
    /* price semantics */
    const shareStated = SHARE_FIELDS.some((f) => g[f] != null && Number(g[f]) === 1);
    const multi = units(r) > 1;
    const priced = r.amount != null && r.amount >= MIN_MARKET && !multi;
    const ppsqm = priced && validArea(r.area) != null ? Math.round(r.amount / r.area) : null;
    const sqmValid = ppsqm != null && ppsqm >= MIN_SQM;
    const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date >= ctx.window.from && r.date <= ctx.lastDeal;
    const provenance = !!(ctx.snapshotSha && g.objectid != null && Number(g.objectid) === r.oid);
    let state;
    if (localityConflict) reasons.push('locality-name-vs-parcel');
    if (st.basis === 'conflict') reasons.push('address-vs-parcel-street');
    if (audit && audit.verdict === 'POSSIBLE_DUPLICATE') reasons.push('possible-duplicate-of-register-deal');
    if (reasons.length) state = 'RECENT_CONFLICT';
    else {
      if (o.kind === 'TYPE_NOT_STATED') reasons.push('property-type-not-stated');
      if (['unresolved', 'ambiguous', 'possible'].includes(st.basis)) reasons.push('street-' + st.basis);
      if (r.gush == null || r.parcel == null) reasons.push('no-block-parcel');
      if (audit && audit.verdict === 'UNRESOLVED') reasons.push('same-parcel-audit-unresolved');
      if (!dateValid) reasons.push('date-invalid');
      if (!provenance) reasons.push('provenance-missing');
      if (reasons.length) state = 'RECENT_UNRESOLVED';
      else {
        if (o.kind !== 'DWELLING') reasons.push('not-a-dwelling');
        if (st.code == null) reasons.push('no-street-key');
        if (reasons.length) state = 'RECENT_CONTEXT_ONLY';
        else {
          if (!STRONG_STREET.has(st.basis)) reasons.push('street-single-key');
          if (!shareStated) reasons.push('share-not-stated');
          if (r.amount == null || r.amount < MIN_MARKET) reasons.push('below-market-amount');
          if (multi) reasons.push('several-units-one-consideration');
          state = reasons.length ? 'RECENT_OBSERVED_LIMITED' : 'RECENT_OBSERVED_VERIFIED';
        }
      }
    }
    const verified = state === 'RECENT_OBSERVED_VERIFIED';
    /* what each use needs: the street COUNT counts observed dwelling deals (the register's own count includes unpriced and partial
       sales); a median / ₪ per m² needs a whole-property market price; the 12-month change compares two windows of ONE universe — the
       recent layer covers only its own window, so it never enters it; the model needs a priced row with its build year (the age, PROBABLE
       NEW and off-plan features) — the copy states none */
    const identityOnlyLimits = state === 'RECENT_OBSERVED_LIMITED' && reasons.every((x) => ['share-not-stated', 'below-market-amount', 'several-units-one-consideration'].includes(x));
    result.set(r.oid, {
      state, reasons, audit,
      priced, pricePerSqm: sqmValid ? ppsqm : null, shareStated, multiUnit: multi,
      eligible: {
        count: verified, median: verified && priced, pricePerSqm: verified && sqmValid, change: false, model: false,
        countUnderRegisterSemantics: verified || identityOnlyLimits,
      },
    });
  }
  return result;
}

/** how the copy prints a partial sale, over the deals both copies hold (the evidence behind SHARE) */
function shareEvidence(res) {
  const { rows, out } = res;
  const DW = require('../streets/evidence').DWELLING_NATURES, natureKey = require('../streets/evidence').natureKey;
  const t = { pairs: 0, partial: 0, printedShare: 0, printedWhole: 0, printedOther: 0 };
  for (const r of rows) {
    const o = out.get(r.oid);
    if (!o || !['IN_REGISTER', 'IN_REGISTER_OTHER_UNIT'].includes(o.cls) || !r.typed || !DW.has(natureKey(r.nature))) continue;
    t.pairs++;
    const d = o.register;
    if (!(d.portion != null && d.portion < 1)) continue;
    t.partial++;
    if (near(r.amount, d.amount)) t.printedShare++;
    else if (d.portion > 0 && Math.abs(r.amount - d.amount / d.portion) <= Math.max(1000, 0.01 * r.amount)) t.printedWhole++;
    else t.printedOther++;
  }
  t.partialPct = t.pairs ? Math.round((1000 * t.partial) / t.pairs) / 10 : null;
  return t;
}

/** the largest amount / area difference between the two copies over the deals both hold (whole-property sales) — the audit's basis */
function calibration(res) {
  const { rows, out } = res;
  const c = { typed: { pairs: 0, maxAmountPct: 0, maxAreaPct: 0, overTol: 0 }, untyped: { pairs: 0, maxAmountPct: 0, maxAreaPct: 0, overTol: 0 } };
  for (const r of rows) {
    const o = out.get(r.oid);
    if (!o || !['IN_REGISTER', 'IN_REGISTER_OTHER_UNIT'].includes(o.cls)) continue;
    const d = o.register;
    if (d.portion == null || d.portion < 1 || r.amount == null || d.amount == null) continue;
    const k = r.typed ? c.typed : c.untyped; k.pairs++;
    const a = rel(r.amount, d.amount), ar = validArea(r.areaM) != null && validArea(d.areaSqm) != null ? rel(r.areaM, d.areaSqm) : 0;
    k.maxAmountPct = Math.max(k.maxAmountPct, Math.round(a * 10000) / 100); k.maxAreaPct = Math.max(k.maxAreaPct, Math.round(ar * 10000) / 100);
    if (a > AMOUNT_TOL || (r.typed && ar > AREA_TOL)) k.overTol++;
  }
  return { amountTolPct: AMOUNT_TOL * 100, areaTolPct: AREA_TOL * 100, ...c };
}

module.exports = { STATES, AUDIT, AMOUNT_TOL, AREA_TOL, SHARE_FIELDS, judge, parcelAudit, promote, shareEvidence, calibration };
