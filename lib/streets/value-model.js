// PROPX · STREET VALUE MODEL — a MODEL layer on top of Street Intelligence (lib/streets/evidence.js). It never replaces, re-labels
// or re-thresholds the OBSERVED street market: the observed median stays what the register shows on the street; this module
// estimates what a reference dwelling on the street is worth per m² from comparable evidence, and says MODEL UNAVAILABLE when the
// evidence does not support a street-level estimate.
//
// TARGET. log(₪ per m²) of one transaction. The street estimate is the value per m² of a REFERENCE DWELLING (an existing flat in a
// multi-unit building, 85 m², of the district's typical age) on the street, as of the evidence date (the copy's latest deal). An
// apartment estimate re-prices the same street level for a stated profile (area · rooms · build year / new).
//
// LAYERS (every one fitted only on transactions dated before the estimate's cutoff — the validation re-fits per fold):
//   1. CLEANING — the Street Intelligence rules, unchanged: dwelling natures, whole-property sales of at least ₪100,000, an area of
//      at least 20 m², ₪/m² ≥ ₪2,000, identical rows once, same-consideration units unpriced (`priced && pricePerSqm`).
//   2. HEDONIC + TIME INDEX per district — weighted least squares of log ₪/m² on: log area, PROBABLE NEW (the shared build-year
//      rule), build year after the deal year (off-plan), age band, dwelling type, and one effect per calendar quarter, with a fixed
//      effect per cadastral BLOCK (gush) absorbed by within-block demeaning — so the index compares dwellings in the same block,
//      not a changing mix of places. Rows more than 4 robust SD from their fitted value are flagged outliers and refitted without.
//      A district with too few rows takes the national fit (labelled).
//   3. REFERENCE VALUE OF EACH COMPARABLE — z = log ₪/m² − β·(features − reference) − quarter effect: what that sale implies
//      for the reference dwelling as of the index's last quarter. Original date, factor, rule and source are kept per comparable.
//   4. LEVELS — the weighted mean of z over: the STREET (its OBSERVED deals), its cadastral BLOCKS (other deals in the blocks of
//      the parcels that touch the street — OBSERVED or POSSIBLE parcels give the location, never a price on the street), the
//      VERIFIED NEIGHBOURHOOD (deals on its linked streets) and the LOCALITY (every priced dwelling deal, any address state).
//      Weights: one parcel's n deals count as n / (1 + (n − 1)·ρ) — ρ, the within-parcel correlation, is estimated — so a tower
//      with 200 sales is about 1 / ρ independent observations, never 200.
//   5. SHRINKAGE (credibility) — locality → neighbourhood → block → street, each level pulled toward its parent with weight
//      n_eff / (n_eff + k); k = within variance / between variance of that level, estimated by method of moments.
//   6. A STREET ESTIMATE NEEDS STREET-SPECIFIC LOCATION EVIDENCE — its own deals, its blocks or a verified neighbourhood. A
//      locality (or district) level alone is never published as a street's value: MODEL UNAVAILABLE.
// Nothing here is an appraisal, an official value or an asking price.

'use strict';

const SD = require('./directory');
const EV = require('./evidence');

const MODEL_VERSION = 'psvm-1.0.0';
const FEATURE_VERSION = 'psvm-features-1';
const VALIDATION_VERSION = 'psvm-validation-1';

/* the reference dwelling the street ₪/m² describes */
const REFERENCE = Object.freeze({ areaSqm: 85, nature: 'flat', newness: 'existing' });
const TYPE_OF = { "דירה בבית קומות": 'flat', 'דירת גן': 'garden', 'דירת גג': 'roof', "קוטג' חד משפחתי": 'cottage', "קוטג' דו משפחתי": 'cottage', "קוטג' טורי": 'cottage', 'בית בודד': 'house' };
const AGE_BANDS = ['2-10', '11-25', '26-45', '46+', 'unknown'];
/* the hedonic design: a column per feature; the reference has 0 in every column except the age mix (centred per district) */
const COLS = ['lnArea', 'probNew', 'offPlan', 'age2_10', 'age11_25', 'age46', 'ageUnknown', 'garden', 'roof', 'cottage', 'house', 'subsidyParcel',
  'lnSqmPerRoom', 'roomsMissing'];
/* the reference dwelling's area per room: 25 m² (85 m² ≈ 3.5 rooms) — the rooms term is 0 there */
const REF_SQM_PER_ROOM = 25;
const MIN_DISTRICT_ROWS = 3000;      // fewer → the national fit is used for that district (labelled)
const OUTLIER_SD = 4;                // |residual| above this many robust SD → flagged, refitted without
const MIN_LOCALITY_NEFF = 8;         // a locality parent with less effective evidence cannot anchor an estimate

/* ── calendar ── */
const quarterOf = (iso) => `${iso.slice(0, 4)}Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));

/** the model's view of one deal: null when it is not a valid modelling row (the Street Intelligence cleaning rules) */
function rowOf(deal, cityCode, district, streets, parcelIndex, subsidy) {
  if (!deal.dwelling || !deal.priced || deal.pricePerSqm == null || !deal.date) return null;
  const dy = Number(deal.date.slice(0, 4));
  const yb = deal.yearBuilt;
  const offPlan = !!deal.buildYearAfterDeal;
  const probNew = !!deal.probableNew;
  const age = yb != null && !offPlan && !probNew ? dy - yb : null;
  const ageBand = probNew || offPlan ? null : age == null ? 'unknown' : age <= 10 ? '2-10' : age <= 25 ? '11-25' : age <= 45 ? '26-45' : '46+';
  const type = TYPE_OF[EV.natureKey(deal.nature)] || 'flat';
  return {
    city: cityCode, district, date: deal.date, q: quarterOf(deal.date), y: Math.log(deal.pricePerSqm), ppsqm: deal.pricePerSqm, amount: deal.amount,
    areaSqm: deal.areaSqm, rooms: deal.rooms, yearBuilt: yb, probNew, offPlan, ageBand, type, subParcel: deal.subParcel,
    gush: deal.gush, helka: deal.helka, block: cityCode + '|' + deal.gush, parcel: cityCode + '|' + deal.gush + '/' + deal.helka,
    /* a development proxy for leakage control: one block, one build year, built within 10 years of the deal */
    project: yb != null && dy - yb <= 10 ? cityCode + '|' + deal.gush + '|' + yb : null,
    /* the parcel of an Israel Land Authority tender marketed in a subsidized / lottery track (exact block + parcel): such projects
       sell many units at a capped price — a feature with its own coefficient, never a guess that a given sale was subsidized */
    subsidyParcel: !!(subsidy && subsidy.has(deal.gush + '/' + deal.helka)),
    match: deal.match, street: deal.match === 'OBSERVED' && streets.length === 1 ? streets[0].code : null,
    touches: streets.map((s) => s.code), house: streets.length ? (streets[0].houses || [])[0] || null : null, idx: parcelIndex,
  };
}

/** block/parcel keys of Israel Land Authority tenders in a subsidized or residential-lottery track (data/land: tender + lot parcels) */
function subsidizedParcels(landDir) {
  const fs = require('node:fs'), path = require('node:path');
  const dir = landDir || path.join(__dirname, '..', '..', 'data', 'land');
  const out = new Set(); out.source = 'rmi:michrazim';
  let T = []; try { T = JSON.parse(fs.readFileSync(path.join(dir, 'tenders.json'), 'utf8')); } catch { return out; }
  const lots = {};
  for (const f of fs.readdirSync(dir).filter((x) => /^lots-\d+\.json$/.test(x))) { try { Object.assign(lots, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* a shard unread */ } }
  for (const t of T) {
    if (t.track !== 'subsidized' && t.track !== 'residential-lottery') continue;
    for (const l of lots[t.id] || []) for (const p of l.parcels || []) if (p.block && p.parcel) out.add(p.block + '/' + p.parcel);
    for (const p of t.parcels || []) if (p.block && p.parcel) out.add(p.block + '/' + p.parcel);
  }
  return out;
}

/** every modelling row of every stored locality shard (+ the per-street parcel blocks, for location linkage) */
function loadRows(opt = {}) {
  const S = EV.store(opt.dir);
  if (!S.available) return null;
  const D = opt.D || SD.load();
  const rows = [];
  const links = [];                      // [city:street, block, date] — a parcel touching the street (OBSERVED or POSSIBLE)
  const subsidy = opt.subsidy === false ? null : subsidizedParcels(opt.landDir);
  for (const code of Object.keys(S.summary.localities).map(Number)) {
    const f = EV.shardOf(code, opt.dir);
    if (!f) continue;
    const loc = D.localities.get(code) || {};
    const district = loc.district || null;
    for (const x of EV.dealsOf(f)) {
      const r = rowOf(x.deal, code, district, x.streets, null, subsidy);
      if (x.deal.match === 'OBSERVED' || x.deal.match === 'POSSIBLE') for (const s of x.streets) links.push([code + ':' + s.code, code + '|' + x.deal.gush, x.deal.date]);
      if (r) rows.push(r);
    }
  }
  rows.sort((a, b) => a.city - b.city || a.date.localeCompare(b.date) || a.parcel.localeCompare(b.parcel) || a.ppsqm - b.ppsqm);
  rows.forEach((r, i) => { r.id = i; });
  return { rows, links, meta: S.meta, summary: S.summary, D, subsidy: subsidy ? { parcels: subsidy.size, source: subsidy.source } : null };
}

/* ── linear algebra: weighted least squares with absorbed block effects ── */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}
const featureVector = (r) => [Math.log(r.areaSqm / REFERENCE.areaSqm), r.probNew ? 1 : 0, r.offPlan ? 1 : 0,
  r.ageBand === '2-10' ? 1 : 0, r.ageBand === '11-25' ? 1 : 0, r.ageBand === '46+' ? 1 : 0, r.ageBand === 'unknown' ? 1 : 0,
  r.type === 'garden' ? 1 : 0, r.type === 'roof' ? 1 : 0, r.type === 'cottage' ? 1 : 0, r.type === 'house' ? 1 : 0, r.subsidyParcel ? 1 : 0,
  r.rooms ? Math.log(r.areaSqm / r.rooms / REF_SQM_PER_ROOM) : 0, r.rooms ? 0 : 1];

/** design weight of a row: its parcel's n rows count n / (1 + (n − 1)ρ) in total */
const designWeight = (n, rho) => 1 / (1 + (n - 1) * rho);
/** a row's stable key (date · amount · parcel · sub-parcel · area) — outlier flags travel by it, never by a row index */
const rowKey = (r) => `${r.city}|${r.date}|${r.amount}|${r.gush}/${r.helka}|${r.subParcel}|${r.areaSqm}`;

/**
 * Fit the hedonic coefficients and the quarterly index of one row set (one district, or the nation) with block fixed effects.
 * @returns {beta, quarters:[q], qEffect:{q: effect relative to the last quarter}, n, blocks, outliers:Set(id), scale}
 */
function fitHedonic(rows, rho) {
  const quarters = [...new Set(rows.map((r) => r.q))].sort();
  const base = quarters[quarters.length - 1];               // effects are relative to the latest quarter (= 0)
  const qCols = quarters.filter((q) => q !== base);
  const nf = COLS.length;
  const width = nf + qCols.length;
  const xOf = (r) => { const v = featureVector(r); for (const q of qCols) v.push(r.q === q ? 1 : 0); return v; };
  const parcelN = new Map(); for (const r of rows) parcelN.set(r.parcel, (parcelN.get(r.parcel) || 0) + 1);
  let active = rows.slice(), outliers = new Set(), beta = null, scale = null;
  for (let pass = 0; pass < 2; pass++) {
    /* within-block (weighted) demeaning */
    const byBlock = new Map();
    for (const r of active) { if (!byBlock.has(r.block)) byBlock.set(r.block, []); byBlock.get(r.block).push(r); }
    const XtX = Array.from({ length: width }, () => new Array(width).fill(0)), Xty = new Array(width).fill(0);
    const demeaned = [];
    for (const g of byBlock.values()) {
      if (g.length < 2) continue;
      const w = g.map((r) => designWeight(parcelN.get(r.parcel), rho)); const W = w.reduce((a, b) => a + b, 0);
      const xs = g.map(xOf);
      const mx = new Array(width).fill(0); let my = 0;
      g.forEach((r, i) => { my += w[i] * r.y; for (let k = 0; k < width; k++) mx[k] += w[i] * xs[i][k]; });
      my /= W; for (let k = 0; k < width; k++) mx[k] /= W;
      g.forEach((r, i) => {
        const x = xs[i].map((v, k) => v - mx[k]), y = r.y - my;
        for (let a = 0; a < width; a++) { if (!x[a]) continue; Xty[a] += w[i] * x[a] * y; for (let b = 0; b < width; b++) XtX[a][b] += w[i] * x[a] * x[b]; }
        demeaned.push([r, x, y]);
      });
    }
    for (let k = 0; k < width; k++) XtX[k][k] += 1e-6;      // a column without variation in this district (e.g. no roof flats)
    beta = solve(XtX, Xty);
    if (!beta) return null;
    const res = demeaned.map(([r, x, y]) => [r, y - x.reduce((s, v, k) => s + v * beta[k], 0)]);
    const abs = res.map(([, e]) => Math.abs(e)).sort((a, b) => a - b);
    scale = 1.4826 * abs[Math.floor(abs.length / 2)];
    if (pass === 0) { outliers = new Set(res.filter(([, e]) => Math.abs(e) > OUTLIER_SD * scale).map(([r]) => r.id)); active = rows.filter((r) => !outliers.has(r.id)); }
  }
  const qEffect = { [base]: 0 }; qCols.forEach((q, i) => { qEffect[q] = beta[nf + i]; });
  return { beta: beta.slice(0, nf), quarters, base, qEffect, n: active.length, blocks: new Set(active.map((r) => r.block)).size, outliers, scale };
}

/** the within-parcel correlation of block-demeaned log ₪/m² (one-way ANOVA estimator over parcels with ≥ 2 rows) */
function estimateRho(rows) {
  const byBlock = new Map(); for (const r of rows) { if (!byBlock.has(r.block)) byBlock.set(r.block, []); byBlock.get(r.block).push(r); }
  const resid = new Map();
  for (const g of byBlock.values()) { if (g.length < 2) continue; const m = g.reduce((s, r) => s + r.y, 0) / g.length; for (const r of g) resid.set(r.id, r.y - m); }
  const byParcel = new Map(); for (const r of rows) if (resid.has(r.id)) { if (!byParcel.has(r.parcel)) byParcel.set(r.parcel, []); byParcel.get(r.parcel).push(resid.get(r.id)); }
  let ssw = 0, dfw = 0, ssb = 0, dfb = 0, N = 0, sumN2 = 0; const all = [];
  for (const g of byParcel.values()) { if (g.length < 2) continue; const m = g.reduce((a, b) => a + b, 0) / g.length; for (const e of g) { ssw += (e - m) ** 2; all.push(e); } dfw += g.length - 1; N += g.length; sumN2 += g.length ** 2; }
  const grand = all.reduce((a, b) => a + b, 0) / all.length;
  for (const g of byParcel.values()) { if (g.length < 2) continue; const m = g.reduce((a, b) => a + b, 0) / g.length; ssb += g.length * (m - grand) ** 2; dfb++; }
  dfb -= 1;
  const msw = ssw / dfw, msb = ssb / dfb, n0 = (N - sumN2 / N) / dfb;
  const s2b = Math.max(0, (msb - msw) / n0);
  return { rho: s2b / (s2b + msw), parcels: byParcel.size, rows: N };
}

/**
 * Fit every global parameter on the rows dated before `cutoff`: ρ, the hedonic coefficients + quarterly index per district
 * (national fallback), the age-mix centring, and the credibility constants of each level.
 */
function fit(rows, cutoff, opt = {}) {
  const train = rows.filter((r) => r.date < cutoff);
  const { rho } = estimateRho(train);
  const national = fitHedonic(train, rho);
  const byDistrict = {};
  const districts = [...new Set(train.map((r) => r.district).filter(Boolean))].sort();
  for (const d of districts) {
    const dr = train.filter((r) => r.district === d);
    const f = dr.length >= MIN_DISTRICT_ROWS ? fitHedonic(dr, rho) : null;
    byDistrict[d] = f ? { ...f, source: 'district' } : { ...national, source: 'national-fallback', fallbackRows: dr.length };
  }
  /* the reference age: the district's existing-home age mix (so "existing home" means its typical existing home) */
  const ageRef = {};
  for (const d of districts) {
    const ex = train.filter((r) => r.district === d && r.ageBand);
    const share = (b) => ex.filter((r) => r.ageBand === b).length / Math.max(1, ex.length);
    const B = byDistrict[d].beta;
    ageRef[d] = share('2-10') * B[3] + share('11-25') * B[4] + share('46+') * B[5] + share('unknown') * B[6];
  }
  const outliers = new Set(); for (const d of districts) for (const id of byDistrict[d].outliers) outliers.add(id);
  const P = { version: MODEL_VERSION, cutoff, rho, byDistrict, ageRef, outliers, national };
  P.asOfQuarter = Object.fromEntries(districts.map((d) => [d, byDistrict[d].base]));
  P.anchorQuarters = opt.anchorQuarters || 1;
  P.anchor = Object.fromEntries(districts.map((d) => { const F = byDistrict[d]; const qs = F.quarters.slice(-P.anchorQuarters); return [d, qs.reduce((a, q) => a + F.qEffect[q], 0) / qs.length]; }));
  P.k = credibility(train.filter((r) => !outliers.has(r.id)), P, opt);
  return P;
}

/* the reference value implied by one row, as of its district index's latest quarter */
function zOf(r, P) {
  const F = P.byDistrict[r.district] || P.national;
  const x = featureVector(r);
  const ageTerm = x[3] * F.beta[3] + x[4] * F.beta[4] + x[5] * F.beta[5] + x[6] * F.beta[6];
  const hed = x[0] * F.beta[0] + x[1] * F.beta[1] + x[2] * F.beta[2] + x[7] * F.beta[7] + x[8] * F.beta[8] + x[9] * F.beta[9] + x[10] * F.beta[10]
    + (P.noSubsidy ? 0 : x[11] * F.beta[11]) + x[12] * F.beta[12] + x[13] * F.beta[13] + (r.ageBand ? ageTerm - (P.ageRef[r.district] || 0) : 0);
  const qe = F.qEffect[r.q];
  /* moved to the index's ANCHOR: the mean effect of its last `anchorQuarters` quarters (the latest quarter alone is partial and noisy) */
  const anchor = (P.anchor && P.anchor[r.district]) || 0;
  const timeAdj = qe == null || P.noTime ? 0 : anchor - qe;  // a quarter after the index (validation targets) is not adjusted
  const h = P.noHedonic ? 0 : hed;
  return { z: r.y - h + timeAdj, hed: h, timeAdj, quarter: r.q, base: F.base, source: F.source };
}
/** the log ₪/m² the model gives a dwelling of profile `r` from a reference level */
function priceOf(level, r, P) {
  if (P.noHedonic) return level;
  const F = P.byDistrict[r.district] || P.national;
  const x = featureVector(r);
  const ageTerm = x[3] * F.beta[3] + x[4] * F.beta[4] + x[5] * F.beta[5] + x[6] * F.beta[6];
  return level + x[0] * F.beta[0] + x[1] * F.beta[1] + x[2] * F.beta[2] + x[7] * F.beta[7] + x[8] * F.beta[8] + x[9] * F.beta[9] + x[10] * F.beta[10]
    + (P.noSubsidy ? 0 : x[11] * F.beta[11]) + x[12] * F.beta[12] + x[13] * F.beta[13] + (r.ageBand ? ageTerm - (P.ageRef[r.district] || 0) : 0);
}

/* ── levels ── */
/** weighted mean of z over a row set with parcel design weights; n_eff = Σ_parcel n/(1+(n−1)ρ) */
function levelOf(rs, P, zs, extraW) {
  if (!rs.length) return null;
  const parcelN = new Map(); for (const r of rs) parcelN.set(r.parcel, (parcelN.get(r.parcel) || 0) + 1);
  let W = 0, S = 0, S2 = 0;
  const w = rs.map((r) => designWeight(parcelN.get(r.parcel), P.rho) * (extraW ? extraW(r) : 1));
  rs.forEach((r, i) => { const z = zs.get(r.id); W += w[i]; S += w[i] * z; S2 += w[i] * z * z; });
  const m = S / W;
  const largest = Math.max(...parcelN.values());
  return { mean: m, var: Math.max(0, S2 / W - m * m), nEff: W, n: rs.length, parcels: parcelN.size, largestParcelShare: largest / rs.length,
    latest: rs.reduce((a, r) => (r.date > a ? r.date : a), ''), weights: w };
}
const cred = (lv, k, parent) => { const w = lv.nEff / (lv.nEff + k); return { value: w * lv.mean + (1 - w) * parent, w }; };

/** method-of-moments credibility constants k = σ²_within / τ²_between for the street, block and neighbourhood levels */
function credibility(train, P) {
  const zs = new Map(train.map((r) => [r.id, zOf(r, P).z]));
  const groupBy = (key) => { const m = new Map(); for (const r of train) { const k = key(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const locality = new Map([...groupBy((r) => r.city)].map(([k, rs]) => [k, levelOf(rs, P, zs)]));
  const momentK = (groups, parentOf) => {
    let num = 0, den = 0, within = 0, cnt = 0;
    for (const rs of groups.values()) {
      const lv = levelOf(rs, P, zs); if (lv.nEff < 2) continue;
      const parent = parentOf(rs[0]); if (parent == null) continue;
      num += (lv.mean - parent) ** 2; den++; within += lv.var / lv.nEff; cnt++;
    }
    const sigma2 = [...groups.values()].reduce((a, rs) => { const lv = levelOf(rs, P, zs); return lv.nEff >= 2 ? a + lv.var : a; }, 0) / Math.max(1, cnt);
    const tau2 = Math.max(1e-4, num / Math.max(1, den) - within / Math.max(1, cnt));
    return { k: sigma2 / tau2, sigma2, tau2, groups: cnt };
  };
  const blocks = groupBy((r) => r.block);
  const kB = momentK(blocks, (r) => locality.get(r.city).mean);
  const blockMean = new Map([...blocks].map(([k, rs]) => [k, levelOf(rs, P, zs).mean]));
  const kS = momentK(groupBy((r) => (r.street != null ? r.city + ':' + r.street : null)), (r) => blockMean.get(r.block));
  return { street: kS, block: kB, neighbourhood: { k: kB.k, note: 'the block constant (too few verified neighbourhoods to estimate their own)' } };
}

/**
 * The model's street level from the training rows, without the held-out `ex` = {parcel, project} (validation's grouped holdout).
 * @param {object} ctx {byCity: Map(city → rows), byStreet, byBlock, zs, P, nbStreets(city, street) → [street codes] | null, streetBlocks}
 */
function streetLevel(city, street, ctx, ex = null) {
  const { P, zs } = ctx;
  const exclude = excluder(ex);
  const keep = (rs) => (rs || []).filter((r) => !exclude(r) && !P.outliers.has(r.id));
  const L = localityLevel(city, ctx, ex);
  const out = { city, street, levels: {}, weights: {}, reasons: [] };
  if (!L || L.nEff < MIN_LOCALITY_NEFF) { out.unavailable = 'locality-evidence-thin'; out.levels.locality = L; return out; }
  out.levels.locality = L;
  let parent = L.mean; const chain = [['locality', L, 1]];
  /* verified neighbourhood (deals on its linked streets, this street's own deals excluded) */
  const nbCodes = ctx.nbStreets ? ctx.nbStreets(city, street) : null;
  if (nbCodes && nbCodes.length) {
    const nr = keep(nbCodes.filter((c) => c !== street).flatMap((c) => ctx.byStreet.get(city + ':' + c) || []));
    const N = levelOf(nr, P, zs, ctx.recency);
    if (N) { const c = cred(N, P.k.neighbourhood.k, parent); out.levels.neighbourhood = N; parent = c.value; chain.push(['neighbourhood', N, c.w]); }
  }
  /* the cadastral blocks of the parcels touching the street (this street's own deals excluded — they are the street level) */
  const blocks = ctx.streetBlocks.get(city + ':' + street);
  if (blocks && blocks.size) {
    const br = keep([...blocks].flatMap((b) => ctx.byBlock.get(b) || []).filter((r) => r.street !== street || r.city !== city));
    const B = levelOf(br, P, zs, ctx.recency);
    if (B) { const c = cred(B, P.k.block.k, parent); out.levels.block = B; parent = c.value; chain.push(['block', B, c.w]); }
  }
  const sr = keep(ctx.byStreet.get(city + ':' + street));
  const S = levelOf(sr, P, zs, ctx.recency);
  let value = parent;
  if (S) { const c = cred(S, P.k.street.k, parent); out.levels.street = S; value = c.value; chain.push(['street', S, c.w]); }
  if (!S && !out.levels.block && !out.levels.neighbourhood) { out.unavailable = 'no-street-specific-evidence'; return out; }
  /* the share of the final value each level carries: the last level keeps w, the one before (1 − w)·w′, … */
  let rest = 1;
  for (let i = chain.length - 1; i >= 0; i--) { const [name, , w] = chain[i]; const share = i === 0 ? rest : rest * w; out.weights[name] = share; rest -= share; }
  out.value = value;
  if (ctx.keepRows) out.rows = { street: sr, block: out.levels.block ? keep([...blocks].flatMap((b) => ctx.byBlock.get(b) || []).filter((r) => r.street !== street || r.city !== city)) : [],
    neighbourhood: out.levels.neighbourhood ? keep((nbCodes || []).filter((c) => c !== street).flatMap((c) => ctx.byStreet.get(city + ':' + c) || [])) : [], locality: keep(ctx.byCity.get(city)) };
  return out;
}

/** street → the cadastral blocks of the parcels touching it, from location links dated before `cutoff` */
function streetBlocksOf(links, cutoff) {
  const m = new Map();
  for (const [k, b, d] of links) { if (d >= cutoff) continue; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(b); }
  return m;
}
/** verified neighbourhoods: (city, street code) → the street codes linked to the same neighbourhood, or null (lib/geo/neighborhoods) */
function neighbourhoodIndex(D) {
  const fs = require('node:fs'), path = require('node:path');
  const M = require('./match');
  let doc = null; try { doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'geo', 'neighborhoods.json'), 'utf8')); } catch { /* none */ }
  const byStreet = new Map(), byNb = new Map();
  if (doc) {
    const nbCity = new Map(doc.neighborhoods.map((n) => [n.id, n.localityHe]));
    const cityCode = new Map([...D.localities].map(([c, l]) => [SD.normName(l.he), c]));
    for (const x of doc.streetLinks) {
      const code = cityCode.get(SD.normName(nbCity.get(x.neighborhoodId) || '')); if (code == null) continue;
      const r = M.resolveStreet(M.localityIndex(D, code), x.street); if (!r || !r.id) continue;
      const sc = SD.parseId(r.id).streetCode, k = code + ':' + sc;
      byStreet.set(k, x.neighborhoodId);
      if (!byNb.has(x.neighborhoodId)) byNb.set(x.neighborhoodId, new Set()); byNb.get(x.neighborhoodId).add(sc);
    }
  }
  const fn = (city, street) => { const id = byStreet.get(city + ':' + street); return id ? [...byNb.get(id)] : null; };
  fn.idOf = (city, street) => byStreet.get(city + ':' + street) || null;
  fn.size = byStreet.size;
  return fn;
}

/**
 * WHY THIS ESTIMATE — every comparable's contribution to a street level: its level's share of the final value × its weight inside
 * the level (parcel design weight; one parcel's rows share it). Needs a context built with keepRows. Returns the rows with their
 * contribution, the implied reference value (exp z), the time and dwelling adjustments, and the summary the page prints.
 */
function explainLevel(lev, ctx, asOf, opt = {}) {
  if (!lev || lev.unavailable || !lev.rows) return null;
  const { P, zs } = ctx;
  const out = [];
  /* summaryOnly (the build): the locality's thousands of rows are skipped — each carries a negligible share, so the largest parcel
     and the comparable age come from the street-specific levels, where they are decided */
  for (const level of opt.summaryOnly ? ['street', 'block', 'neighbourhood'] : ['street', 'block', 'neighbourhood', 'locality']) {
    const rs = lev.rows[level] || [], share = lev.weights[level] || 0;
    if (!rs.length || !share) continue;
    const parcelN = new Map(); for (const r of rs) parcelN.set(r.parcel, (parcelN.get(r.parcel) || 0) + 1);
    const w = rs.map((r) => designWeight(parcelN.get(r.parcel), P.rho) * (ctx.recency ? ctx.recency(r) : 1));
    const W = w.reduce((a, b) => a + b, 0);
    rs.forEach((r, i) => { const z = zOf(r, P); out.push({ level, row: r, contribution: share * w[i] / W, implied: Math.exp(zs.get(r.id)), timeAdj: z.timeAdj, hed: z.hed }); });
  }
  const byParcel = new Map(); for (const c of out) byParcel.set(c.row.parcel, (byParcel.get(c.row.parcel) || 0) + c.contribution);
  const [lp, lpShare] = [...byParcel].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  /* the comparable age and the time adjustment, weighted by contribution, over the street-specific levels (the locality is context) */
  const specific = out.filter((c) => c.level !== 'locality');
  const wMedian = (xs) => { const s2 = xs.slice().sort((a, b) => a[0] - b[0]); const tot = s2.reduce((a, x) => a + x[1], 0); let acc = 0; for (const [v, ww] of s2) { acc += ww; if (acc >= tot / 2) return v; } return null; };
  const specW = specific.reduce((a, c) => a + c.contribution, 0);
  return {
    contributions: out,
    summary: { medianAgeMonths: specific.length ? wMedian(specific.map((c) => [monthsBetween(c.row.date, asOf), c.contribution])) : null,
      largestParcel: lp, largestParcelPct: Math.round(lpShare * 1000) / 10,
      timeAdjPct: specW ? Math.round((specific.reduce((a, c) => a + c.contribution * (Math.exp(c.timeAdj) - 1), 0) / specW) * 1000) / 10 : null,
      specificShare: Math.round(specW * 1000) / 10 },
  };
}

/** indexes over a row set (training rows only) */
function contextOf(rows, P, extra = {}) {
  const idx = (key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  /* recency (ablation): a comparable's weight halves every `halfLife` months before the estimate's date */
  const recency = extra.halfLife && extra.asOf ? (r) => Math.pow(0.5, monthsBetween(r.date, extra.asOf) / extra.halfLife) : null;
  const ctx = { P, zs: new Map(rows.map((r) => [r.id, zOf(r, P).z])), byCity: idx((r) => r.city), byBlock: idx((r) => r.block),
    byStreet: idx((r) => (r.street != null ? r.city + ':' + r.street : null)), streetBlocks: extra.streetBlocks || new Map(), nbStreets: extra.nbStreets || null,
    recency, keepRows: !!extra.keepRows, locCache: new Map() };
  /* the locality level's parcel aggregates (a held-out parcel / development is removed from them, never recomputed from scratch) */
  for (const [city, rs] of ctx.byCity) {
    const kept = rs.filter((r) => !P.outliers.has(r.id));
    const parcels = new Map(); for (const r of kept) { if (!parcels.has(r.parcel)) parcels.set(r.parcel, []); parcels.get(r.parcel).push(r); }
    const agg = new Map(); let W = 0, S = 0, S2 = 0, n = 0, latest = '';
    for (const [p, prs] of parcels) {
      const a = parcelAgg(prs, ctx); agg.set(p, a); W += a.W; S += a.S; S2 += a.S2; n += a.n; if (a.latest > latest) latest = a.latest;
    }
    const projects = new Map(); for (const r of kept) if (r.project) { if (!projects.has(r.project)) projects.set(r.project, new Set()); projects.get(r.project).add(r.parcel); }
    ctx.locCache.set(city, { parcels, agg, W, S, S2, n, latest, projects, largest: Math.max(0, ...[...parcels.values()].map((x) => x.length)) });
  }
  return ctx;
}
function parcelAgg(prs, ctx) {
  const w0 = designWeight(prs.length, ctx.P.rho); let W = 0, S = 0, S2 = 0, latest = '';
  for (const r of prs) { const w = w0 * (ctx.recency ? ctx.recency(r) : 1), z = ctx.zs.get(r.id); W += w; S += w * z; S2 += w * z * z; if (r.date > latest) latest = r.date; }
  return { W, S, S2, n: prs.length, latest };
}
/** a held-out parcel and its development: {parcel, project} → a row predicate */
const excluder = (ex) => (ex ? (r) => r.parcel === ex.parcel || (ex.project != null && r.project === ex.project) : () => false);
/** the locality level with a held-out parcel and its development removed */
function localityLevel(city, ctx, ex) {
  const c = ctx.locCache.get(city);
  if (!c || !c.n) return null;
  let { W, S, S2, n } = c; let parcels = c.parcels.size; let largest = 0;
  const exclude = excluder(ex);
  const touched = new Set();
  if (ex) { if (c.parcels.has(ex.parcel)) touched.add(ex.parcel); if (ex.project != null) for (const p of c.projects.get(ex.project) || []) touched.add(p); }
  for (const p of touched) {
    const a = c.agg.get(p); W -= a.W; S -= a.S; S2 -= a.S2; n -= a.n; parcels--;
    const rest = c.parcels.get(p).filter((r) => !exclude(r));
    if (rest.length) { const b = parcelAgg(rest, ctx); W += b.W; S += b.S; S2 += b.S2; n += b.n; parcels++; }
  }
  if (W <= 0 || !n) return null;
  if (!touched.size) largest = c.largest; else for (const [p, prs] of c.parcels) if (!touched.has(p) && prs.length > largest) largest = prs.length;
  const m = S / W;
  return { mean: m, var: Math.max(0, S2 / W - m * m), nEff: W, n, parcels, largestParcelShare: largest / n, latest: c.latest };
}

module.exports = { MODEL_VERSION, FEATURE_VERSION, VALIDATION_VERSION, REFERENCE, COLS, AGE_BANDS, TYPE_OF, MIN_DISTRICT_ROWS, OUTLIER_SD, MIN_LOCALITY_NEFF,
  quarterOf, monthsBetween, rowOf, loadRows, featureVector, designWeight, fitHedonic, estimateRho, fit, zOf, priceOf, levelOf, cred, credibility, streetLevel, contextOf,
  streetBlocksOf, neighbourhoodIndex, localityLevel, excluder, subsidizedParcels, REF_SQM_PER_ROOM, rowKey, explainLevel };
