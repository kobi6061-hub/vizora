// PROPX · STREET VALUE MODEL — out-of-sample validation (time-based, grouped).
//
// FOLDS. Each fold has a cutoff C: every parameter (ρ, hedonic coefficients, quarterly index, credibility constants, outlier
// flags) and every comparable come from transactions dated BEFORE C; the test set is the OBSERVED street deals of the following
// six months. Nothing dated on or after C is visible to a prediction — not a price, not a location link.
// GROUPED HOLDOUT. A test deal's own parcel and its development (same block + same build year, built within 10 years) are
// removed from every level — street, block, neighbourhood, locality — so the sales of one tower never validate each other.
// The test deal is priced as of C (no forward index: the future movement is unknown at C).
// BASELINES, under the same exclusions: the locality median ₪/m², the verified-neighbourhood median, the same-street median of
// the 12 months before C, and a simple recent-comparables median (the 20 latest locality deals of similar area and the same
// new / existing status).

'use strict';

const VM = require('./value-model');
const EV = require('./evidence');

const FOLDS = Object.freeze([{ id: 'A', cutoff: '2025-03-18', months: 6 }, { id: 'B', cutoff: '2025-09-18', months: 6 }, { id: 'C', cutoff: '2026-03-18', months: 6 }]);

const sorted = (xs) => xs.slice().sort((a, b) => a - b);
const med = (xs) => (xs.length ? EV.quantile(sorted(xs), 0.5) : null);

/**
 * Run one fold. `opt` switches model layers off for the ablation study ({hedonic:false, time:false, block:false, nb:false,
 * halfLife: months}). Returns one record per test deal.
 */
function runFold(L, fold, opt = {}) {
  const C = fold.cutoff, end = EV.minusMonths(C, -fold.months);
  const P = VM.fit(L.rows, C, { anchorQuarters: opt.anchorQuarters });
  if (opt.hedonic === false) P.noHedonic = true;
  if (opt.time === false) P.noTime = true;
  const train = L.rows.filter((r) => r.date < C);
  const ctx = VM.contextOf(train, P, { streetBlocks: opt.block === false ? new Map() : VM.streetBlocksOf(L.links, C), nbStreets: opt.nb === false ? null : L.nb, asOf: C, halfLife: opt.halfLife });
  const test = L.rows.filter((r) => r.date >= C && r.date < end && r.street != null);
  /* baseline indexes */
  const byCity = ctx.byCity;
  const cityPpsqm = new Map([...byCity].map(([c, rs]) => [c, sorted(rs.map((r) => r.ppsqm))]));
  const out = [];
  for (const t of test) {
    const ex = { parcel: t.parcel, project: t.project };
    const excl = VM.excluder(ex);
    const lev = VM.streetLevel(t.city, t.street, ctx, ex);
    const rec = { id: t.id, fold: fold.id, city: t.city, district: t.district, street: t.street, actual: t.ppsqm, date: t.date, newish: t.probNew || t.offPlan, probNew: t.probNew, offPlan: t.offPlan,
      areaSqm: t.areaSqm, unavailable: lev.unavailable || null };
    if (!lev.unavailable) {
      rec.pred = Math.exp(VM.priceOf(lev.value, t, P));
      rec.levels = Object.fromEntries(Object.entries(lev.levels).map(([k, v]) => [k, v ? { nEff: v.nEff, n: v.n, parcels: v.parcels, largestParcelShare: v.largestParcelShare, latest: v.latest } : null]));
      rec.weights = lev.weights;
      rec.tier = tierOf(rec, C, opt.caps ? opt.caps.get(t.city) : null);
    } else rec.tier = TIER.UNAVAILABLE;
    /* `pred` is the raw model value; it is PUBLISHED only when the tier is not UNAVAILABLE — accuracy is read on published ones */
    /* the street's OBSERVED state at the cutoff (its priced deals in the training rows) — Street Intelligence's thresholds */
    const obsN = (ctx.byStreet.get(t.city + ':' + t.street) || []).filter((r) => !excl(r)).length;
    rec.observedTier = obsN >= EV.SAMPLE.SUPPORTED ? 'SUPPORTED' : obsN >= EV.SAMPLE.LIMITED ? 'LIMITED' : obsN >= 1 ? 'INSUFFICIENT' : 'NONE';
    /* baselines */
    const locRows = byCity.get(t.city) || [];
    const exVals = locRows.filter(excl).map((r) => r.ppsqm);
    rec.bLocality = medianWithout(cityPpsqm.get(t.city) || [], exVals);
    const nbCodes = L.nb ? L.nb(t.city, t.street) : null;
    if (nbCodes) { const v = nbCodes.filter((c) => c !== t.street).flatMap((c) => ctx.byStreet.get(t.city + ':' + c) || []).filter((r) => !excl(r)).map((r) => r.ppsqm); rec.bNeighbourhood = med(v); }
    const yearAgo = EV.minusMonths(C, 12);
    const sv = (ctx.byStreet.get(t.city + ':' + t.street) || []).filter((r) => !excl(r) && r.date >= yearAgo).map((r) => r.ppsqm);
    rec.bStreet = med(sv); rec.bStreetN = sv.length;
    const similar = [];
    for (let i = locRows.length - 1; i >= 0 && similar.length < 20; i--) {
      const r = locRows[i]; if (excl(r)) continue;
      if ((r.probNew || r.offPlan) !== rec.newish) continue;
      if (Math.abs(Math.log(r.areaSqm / t.areaSqm)) > 0.25) continue;
      similar.push(r.ppsqm);
    }
    rec.bRecent = similar.length >= 5 ? med(similar) : null;
    out.push(rec);
  }
  return { fold, P, records: out, trainRows: train.length, testRows: test.length };
}

/** the median of a sorted array with the values in `ex` (a multiset) removed */
function medianWithout(arr, ex) {
  if (!ex.length) return arr.length ? EV.quantile(arr, 0.5) : null;
  const rm = new Map(); for (const v of ex) rm.set(v, (rm.get(v) || 0) + 1);
  const kept = []; for (const v of arr) { const c = rm.get(v); if (c) { rm.set(v, c - 1); continue; } kept.push(v); }
  return kept.length ? EV.quantile(kept, 0.5) : null;
}

/* ── MODEL EVIDENCE TIERS (deterministic; thresholds documented in lib/streets/README.md § value model) ── */
const TIER = Object.freeze({ STRONG: 'STRONG', STANDARD: 'STANDARD', LIMITED: 'LIMITED', UNAVAILABLE: 'UNAVAILABLE' });
/* calibrated on the held-out errors (README § value model): the street's own evidence, its blocks, the locality's depth, and
   the locality's own validated error. n_eff = parcel-weighted effective observations (a tower ≈ 1 / ρ, never its sale count). */
const TIER_RULE = Object.freeze({
  strongStreetNEff: 1.5, strongStreetParcels: 2, strongRecentMonths: 18, strongLocalityNEff: 300,   // STRONG: own street evidence from ≥ 2 parcels, recent, in a deep locality market
  standardStreetNEff: 1.5, standardBlockNEff: 20,                           // STANDARD: own street evidence elsewhere, or ≥ 20 in its blocks
  limitedBlockNEff: 5,                                                      // LIMITED: thinner own / block evidence (≥ 5 in the blocks, or some own deals)
  // below: MODEL UNAVAILABLE (street 0 and blocks < 5 and no verified neighbourhood) — not street-specific enough
  capMinTest: 50, capLimitedMdape: 0.15, capLimitedP80: 0.30, capUnavailableMdape: 0.25,   // a locality's own validated error caps its tiers
});
function tierOf(x, asOf, cap) {
  if (x.unavailable) return TIER.UNAVAILABLE;
  const S = x.levels.street, B = x.levels.block, N = x.levels.neighbourhood, Lc = x.levels.locality;
  const sN = S ? S.nEff : 0, bN = B ? B.nEff : 0;
  let tier;
  /* one parcel (one building / project) is never STRONG evidence of a street's market, however many units it sold */
  if (sN >= TIER_RULE.strongStreetNEff && S.parcels >= TIER_RULE.strongStreetParcels && VM.monthsBetween(S.latest, asOf) <= TIER_RULE.strongRecentMonths && Lc && Lc.nEff >= TIER_RULE.strongLocalityNEff) tier = TIER.STRONG;
  else if (sN >= TIER_RULE.standardStreetNEff || bN >= TIER_RULE.standardBlockNEff) tier = TIER.STANDARD;
  else if (sN > 0 || bN >= TIER_RULE.limitedBlockNEff || (N && N.nEff > 0)) tier = TIER.LIMITED;
  else return TIER.UNAVAILABLE;
  if (cap === TIER.UNAVAILABLE) return TIER.UNAVAILABLE;
  if (cap === TIER.LIMITED && (tier === TIER.STRONG || tier === TIER.STANDARD)) return TIER.LIMITED;
  return tier;
}
/** a locality's own held-out error → its tier cap (only with ≥ capMinTest held-out deals) */
function marketCaps(records) {
  const by = new Map(); for (const r of published(records)) { if (!by.has(r.city)) by.set(r.city, []); by.get(r.city).push(r); }
  const caps = new Map(), detail = {};
  for (const [c, xs] of by) {
    if (xs.length < TIER_RULE.capMinTest) continue;
    const m = metrics(xs);
    const cap = m.mdape > TIER_RULE.capUnavailableMdape ? TIER.UNAVAILABLE : m.mdape > TIER_RULE.capLimitedMdape || m.p80ape > TIER_RULE.capLimitedP80 ? TIER.LIMITED : null;
    detail[c] = { n: m.n, mdape: m.mdape, p80ape: m.p80ape, cap };
    if (cap) caps.set(c, cap);
  }
  return { caps, detail };
}
/** the validation-based range per tier: the 10th and 90th percentile of log(actual / predicted) */
function rangesOf(records) {
  const out = {};
  for (const t of [TIER.STRONG, TIER.STANDARD, TIER.LIMITED]) {
    const e = records.filter((r) => r.pred != null && r.tier === t).map((r) => Math.log(r.actual / r.pred)).sort((a, b) => a - b);
    if (e.length < 200) continue;           // too few held-out deals to state a range
    out[t] = { lo: EV.quantile(e, 0.1), hi: EV.quantile(e, 0.9), n: e.length };
  }
  return out;
}
/** re-tier stored records under a cap set (calibration on some folds, evaluation on another) */
const retier = (records, caps, cutoffs) => records.map((r) => (!r.levels ? r : { ...r, tier: tierOf(r, cutoffs[r.fold], caps.get(r.city)) }));
const published = (records) => records.filter((r) => r.pred != null && r.tier !== TIER.UNAVAILABLE);

/* ── metrics ── */
function metrics(recs, predKey = 'pred') {
  const v = recs.filter((r) => r[predKey] != null);
  if (!v.length) return { n: 0 };
  const ape = sorted(v.map((r) => Math.abs(r[predKey] - r.actual) / r.actual));
  const ae = sorted(v.map((r) => Math.abs(r[predKey] - r.actual)));
  const aeTotal = sorted(v.map((r) => Math.abs(r[predKey] - r.actual) * r.areaSqm));
  const logErr = v.map((r) => Math.log(r.actual / r[predKey]));
  const bias = med(logErr);
  const q = (a, p) => EV.quantile(a, p);
  return { n: v.length, mdape: q(ape, 0.5), p80ape: q(ape, 0.8), p90ape: q(ape, 0.9), mdaeSqm: q(ae, 0.5), p80aeSqm: q(ae, 0.8), p90aeSqm: q(ae, 0.9),
    mdaeTotal: q(aeTotal, 0.5), p80aeTotal: q(aeTotal, 0.8), p90aeTotal: q(aeTotal, 0.9), medianLogBias: bias, within10: v.filter((r) => Math.abs(r[predKey] - r.actual) / r.actual <= 0.1).length / v.length,
    within20: v.filter((r) => Math.abs(r[predKey] - r.actual) / r.actual <= 0.2).length / v.length };
}

module.exports = { FOLDS, TIER, TIER_RULE, runFold, tierOf, metrics, medianWithout, marketCaps, rangesOf, retier, published };
