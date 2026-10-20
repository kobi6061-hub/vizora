#!/usr/bin/env node
// PROPX · STREET VALUE MODEL build (offline; lib/streets/value-model.js + value-validate.js) → data/streets/model/.
//
//   node scripts/street-model-build.js            validate (3 forward folds) + fit + estimate every searchable street; writes
//                                                 model.json · estimates.json · validation.json · audit.json · history.jsonl
//   node scripts/street-model-build.js --check    the stored artifacts against the current inputs: exit 0 when current
//   node scripts/street-model-build.js --if-stale rebuild only when a dependency the model READS moved since the stored build
//                                                 (lib/streets/model-deps.js: versions · code · evidence · directory rows ·
//                                                 neighbourhood links · subsidized-track parcels — never a whole data file)
//
// The build never touches the observed evidence (data/streets/evidence) and never rewrites a prior build's record: history.jsonl
// is append-only, and every street whose estimate moved materially is listed with the reason (DATA or MODEL change).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const VM = require('../lib/streets/value-model');
const VV = require('../lib/streets/value-validate');
const EV = require('../lib/streets/evidence');
const SD = require('../lib/streets/directory');

const DIR = process.env.STREET_MODEL_DIR || path.join(__dirname, '..', 'data', 'streets', 'model');
const args = process.argv.slice(2);
const has = (f) => args.includes('--' + f);
const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');   // file bytes as bytes
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const writeJson = (f, v, compact) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, f), (compact ? JSON.stringify(v) : JSON.stringify(v, null, 1)) + '\n'); };
const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);
const MATERIAL = 0.05;                 // an estimate that moved by ≥ 5 % (or changed tier / availability) is listed in history

/* @deps:begin — how the build records its inputs and when it is stale (lib/streets/model-deps.js). Excluded from the model's own
   code hash: changing how staleness is tracked is not a model change. */
const DEPS = require('../lib/streets/model-deps');
/** the inputs a build records: every dependency the model reads, as the projection it reads (deps), + the fields value-read.js
    compares at request time (evidence · directory content hash) */
function inputsNow() {
  const d = DEPS.current();
  const D = SD.load();
  return { modelVersion: VM.MODEL_VERSION, featureVersion: VM.FEATURE_VERSION, validationVersion: VM.VALIDATION_VERSION,
    evidence: d.evidence, directory: D.meta ? D.meta.contentHash : null, land: d.land.sha256, code: d.code.sha256, deps: d };
}
/* DATA = evidence / directory / neighbourhood links / subsidized parcels moved; MODEL = versions or code moved */
function reasonOf(prevModel, inputs) {
  if (!prevModel) return 'FIRST_BUILD';
  const prevDeps = DEPS.recorded(prevModel, readJson('dependencies.json'));
  const moved = DEPS.diff(prevDeps && prevDeps.deps, inputs.deps);
  const dataMoved = moved.some((k) => ['evidence', 'directory', 'neighbourhoods', 'land'].includes(k)), modelMoved = moved.some((k) => ['versions', 'code'].includes(k));
  return dataMoved && modelMoved ? 'DATA+MODEL' : modelMoved ? 'MODEL' : dataMoved ? 'DATA' : 'REBUILD';
}
/* @deps:end */

/** the field audit over every swept deal: availability, coverage, interpretation and the modelling decision (README § value model) */
function audit(L) {
  const deals = [];
  for (const code of Object.keys(L.summary.localities).map(Number)) { const sh = EV.shardOf(code); if (!sh) continue; for (const x of EV.dealsOf(sh)) deals.push(x.deal); }
  const dw = deals.filter((d) => d.dwelling), pr = dw.filter((d) => d.priced);
  const cov = (xs, f) => pct(xs.filter(f).length / Math.max(1, xs.length));
  const F = (name, f, source, interpretation, decision) => ({ field: name, allDeals: cov(deals, f), dwelling: cov(dw, f), pricedDwelling: cov(pr, f), source, interpretation, decision });
  return { builtAt: new Date().toISOString(), population: { deals: deals.length, dwelling: dw.length, pricedDwelling: pr.length, modelRows: L.rows.length },
    fields: [
      F('transaction date', (d) => !!d.date, 'register', 'the deal date', 'USED — calendar quarter of the time index'),
      F('transaction price', (d) => d.amount != null, 'register (declared amount where stated)', 'whole-property consideration (portion = 1, ≥ ₪100,000)', 'USED — the target (₪ per m²)'),
      F('area (m²)', (d) => d.areaSqm != null && d.areaSqm >= EV.MIN_AREA, 'register', 'the dwelling area; < 20 m² is a placeholder (≈ 750 deals at 1 m²)', 'USED — log area; the target\'s denominator'),
      F('rooms', (d) => d.rooms != null, 'register', 'room count', 'USED — area per room (adopted after validation: MdAPE 10.0 → 9.7 %)'),
      F('street', (d) => d.match === 'OBSERVED', 'PROPX match (lib/streets/match.js)', 'OBSERVED = every address of the parcel on one street', 'USED — the street level (POSSIBLE / UNRESOLVED never)'),
      F('street number', (d) => (d.parcelAddresses || []).some((a) => /\d/.test(a)), 'the publisher\'s parcel crosswalk', 'house numbers of the parcel', 'REJECTED as a feature — the parcel already identifies the building'),
      F('locality', () => true, 'register settlement → CBS code', 'the locality', 'USED — the locality level'),
      F('parcel (block / parcel)', (d) => d.gush != null && d.helka != null, 'register', 'cadastral block (gush) and parcel (helka)', 'USED — block level, parcel design weights, grouped holdout'),
      F('build year', (d) => d.yearBuilt != null, 'register', 'the year the building was / will be completed', 'USED — age band, PROBABLE NEW, built after the deal (off-plan)'),
      F('probable new', (d) => d.probableNew, 'lib/gov/classify.js (build year = deal year or year before)', 'PROBABLE NEW — never confirmed', 'USED — premium term'),
      F('property nature', (d) => !!d.nature, 'register', 'dwelling type', 'USED — flat / garden / roof / cottage / house'),
      { field: 'floor', allDeals: 0, dwelling: 0, pricedDwelling: 0, source: 'not in the register copy', interpretation: '—', decision: 'UNAVAILABLE — not used; the apartment profile does not ask for it' },
      { field: 'coordinates', allDeals: 0, dwelling: 0, pricedDwelling: 0, source: 'not in the register copy (localities have a centroid only)', interpretation: '—', decision: 'UNAVAILABLE — no distance feature; location comes from the cadastral block' },
      { field: 'verified neighbourhood', allDeals: null, dwelling: null, pricedDwelling: null, source: 'PROPX verified street links (72 links, 7 cities)', interpretation: 'a street → neighbourhood link checked by hand', decision: 'USED — neighbourhood level where linked (no measurable effect in validation)' },
      { field: 'verified project', allDeals: 0, dwelling: 0, pricedDwelling: 0, source: 'no project id in the register', interpretation: '—', decision: 'UNAVAILABLE — a development proxy (block + build year, built within 10 years) is used for leakage control only' },
      F('subsidized-programme parcel', (d) => L.subsidyKeys.has(d.gush + '/' + d.helka), 'Israel Land Authority tenders (subsidized / lottery track, exact block + parcel)', 'a parcel marketed under a subsidized programme — many units at a capped price', 'USED — its own coefficient (never a claim that a sale was subsidized)'),
    ] };
}

function metricsOut(m) {
  return m.n ? { n: m.n, mdape: pct(m.mdape), p50ape: pct(m.mdape), p80ape: pct(m.p80ape), p90ape: pct(m.p90ape), mdaeSqm: Math.round(m.mdaeSqm), p80aeSqm: Math.round(m.p80aeSqm),
    p90aeSqm: Math.round(m.p90aeSqm), mdaeTotal: Math.round(m.mdaeTotal), p80aeTotal: Math.round(m.p80aeTotal), p90aeTotal: Math.round(m.p90aeTotal), medianBiasPct: pct(Math.exp(m.medianLogBias) - 1),
    within10: pct(m.within10), within20: pct(m.within20) } : { n: 0 };
}
const groupMetrics = (recs, keyFn, minN = 1) => { const g = {}; for (const r of recs) { const k = keyFn(r); if (k == null) continue; (g[k] = g[k] || []).push(r); } return Object.fromEntries(Object.entries(g).filter(([, xs]) => xs.length >= minN).map(([k, xs]) => [k, metricsOut(VV.metrics(xs))])); };

function build() {
  const t0 = Date.now();
  const inputs = inputsNow();
  const L = VM.loadRows(); if (!L) throw new Error('the street evidence store is not available');
  if (!L.meta.sweep || L.meta.sweep.status !== 'COMPLETE') throw new Error('the street evidence sweep is not complete — the model is built only on a complete sweep');
  /* outlier flags travel by row key to the request-time read: a key shared by two rows would flag the wrong one */
  { const seen = new Set(); for (const r of L.rows) { const k = VM.rowKey(r); if (seen.has(k)) throw new Error('row key collision: ' + k); seen.add(k); } }
  L.subsidyKeys = VM.subsidizedParcels();
  L.nb = VM.neighbourhoodIndex(L.D);
  const window = L.meta.window;

  /* ── 1 · validation: three forward folds, grouped holdout, baselines ── */
  const cutoffs = Object.fromEntries(VV.FOLDS.map((f) => [f.id, f.cutoff]));
  const folds = VV.FOLDS.map((f) => VV.runFold(L, f, {}));
  const all = folds.flatMap((f) => f.records);
  const lastFold = VV.FOLDS[VV.FOLDS.length - 1].id;
  const earlier = all.filter((r) => r.fold !== lastFold), holdout = all.filter((r) => r.fold === lastFold);
  const capsEarly = VV.marketCaps(earlier);
  const holdoutTiered = VV.retier(holdout, capsEarly.caps, cutoffs);
  const rangesEarly = VV.rangesOf(VV.retier(earlier, capsEarly.caps, cutoffs));
  const coverage = {};
  for (const [t, rg] of Object.entries(rangesEarly)) {
    const xs = VV.published(holdoutTiered).filter((r) => r.tier === t);
    coverage[t] = { n: xs.length, within: pct(xs.filter((r) => { const e = Math.log(r.actual / r.pred); return e >= rg.lo && e <= rg.hi; }).length / Math.max(1, xs.length)), nominal: 80 };
  }
  const capsAll = VV.marketCaps(all);
  const rangesAll = VV.rangesOf(VV.retier(all, capsAll.caps, cutoffs));
  /* a locality with ≥ 300 held-out deals whose own 10th–90th percentile band is wider than its tier's widens the range (never narrows
     it): the national tier band under-covers the big cities. Checked on fold C with A + B calibration like the tier bands. */
  const locRangesOf = (recs) => { const by = new Map(); for (const r of VV.published(recs)) { if (!by.has(r.city)) by.set(r.city, []); by.get(r.city).push(Math.log(r.actual / r.pred)); }
    const out = {}; for (const [c, e] of by) { if (e.length < 300) continue; e.sort((x, y) => x - y); out[c] = { lo: EV.quantile(e, 0.1), hi: EV.quantile(e, 0.9), n: e.length }; } return out; };
  const widen = (rg, lr) => (!rg ? null : !lr ? { lo: rg.lo, hi: rg.hi, basis: 'tier' } : { lo: Math.min(rg.lo, lr.lo), hi: Math.max(rg.hi, lr.hi), basis: lr.lo < rg.lo || lr.hi > rg.hi ? 'tier+locality' : 'tier' });
  const locRangesEarly = locRangesOf(VV.retier(earlier, capsEarly.caps, cutoffs));
  const coverageCombined = {};
  for (const [t, rg] of Object.entries(rangesEarly)) {
    const xs = VV.published(holdoutTiered).filter((r) => r.tier === t);
    coverageCombined[t] = { n: xs.length, within: pct(xs.filter((r) => { const w = widen(rg, locRangesEarly[r.city]); const e = Math.log(r.actual / r.pred); return e >= w.lo && e <= w.hi; }).length / Math.max(1, xs.length)), nominal: 80 };
  }
  const locRangesAll = locRangesOf(VV.retier(all, capsAll.caps, cutoffs));
  const pub = VV.published(all);                         // structural tiers (no market cap) — the national figure
  const baselines = {};
  for (const [k, label] of [['bLocality', 'locality median'], ['bNeighbourhood', 'verified-neighbourhood median'], ['bStreet', 'same-street median, 12 months'], ['bRecent', 'recent similar comparables (20 latest, ±25 % area, same new/existing)'],
    ['bHedLocality', 'the same hedonic translation + index with the locality level only (what the street / block / neighbourhood structure adds)']]) {
    const common = pub.filter((r) => r[k] != null);
    baselines[k] = { label, common: common.length, baseline: metricsOut(VV.metrics(common, k)), model: metricsOut(VV.metrics(common)) };
  }
  const price = (r) => (r.actual < 12000 ? '<12k' : r.actual < 20000 ? '12–20k' : r.actual < 30000 ? '20–30k' : r.actual < 45000 ? '30–45k' : '≥45k');
  const locName = (c) => (L.D.localities.get(c) || {}).he || String(c);
  const validation = {
    version: VM.VALIDATION_VERSION, modelVersion: VM.MODEL_VERSION, builtAt: new Date().toISOString(),
    design: { folds: VV.FOLDS.map((f) => ({ ...f, testEnds: VV.plusMonths(f.cutoff, f.months) })), holdout: 'grouped: the test deal\'s parcel and its development (same block, build year within ± 1 year, built within 10 years of the deal) are removed from every level and every baseline',
      noLookAhead: 'every parameter, comparable and location link is dated before the fold cutoff', test: 'OBSERVED street deals of the 6 months after the cutoff, priced as of the cutoff (no forward index)',
      selection: 'the tier rule, the caps, the rooms feature and the anchor rule were chosen with folds A–C in view: only the fold-C range check (caps and bands from A + B) is a held-out check of those choices; the next register copy\'s six months are the lock-box test',
      published: 'the national figures count every test deal the structural tiers would publish, BEFORE the locality caps (a capped locality — e.g. Katzrin — stays in the headline: conservative)',
      asOfData: 'subsidy-track parcels, OBSERVED matches and the verified neighbourhood links are read from the current data, not as of each cutoff' },
    population: { test: all.length, published: pub.length, unavailable: all.length - pub.length, unavailableReasons: all.filter((r) => !r.pred || r.tier === 'UNAVAILABLE').reduce((o, r) => { const k = r.unavailable || 'street-specific-evidence-thin'; o[k] = (o[k] || 0) + 1; return o; }, {}) },
    national: metricsOut(VV.metrics(pub)),
    byFold: groupMetrics(pub, (r) => r.fold),
    baselines,
    byDistrict: groupMetrics(pub, (r) => r.district),
    byLocality: Object.fromEntries(Object.entries(groupMetrics(pub, (r) => r.city, 300)).map(([c, m]) => [c, { name: locName(Number(c)), ...m }])),
    byObservedTier: groupMetrics(pub, (r) => r.observedTier),
    byNewness: groupMetrics(pub, (r) => (r.offPlan ? 'off-plan (build year after the deal)' : r.probNew ? 'probable new' : 'existing / unknown')),
    /* banded by the ACTUAL price: regression to the mean by construction (the cheapest deals look over-estimated, the dearest under-) */
    byActualPriceBand: groupMetrics(pub, price),
    /* banded by the MODEL's value (what a reader sees) — banding by the actual price builds regression to the mean into the bias */
    byPredictedBand: groupMetrics(pub, (r) => price({ actual: r.pred })),
    byModelTier: { holdoutFold: lastFold, capsFrom: VV.FOLDS.filter((f) => f.id !== lastFold).map((f) => f.id), ...groupMetrics(VV.published(holdoutTiered), (r) => r.tier) },
    byModelTierAllFolds: groupMetrics(VV.published(VV.retier(all, capsAll.caps, cutoffs)), (r) => r.tier),
    range: { method: 'the 10th–90th percentile of log(actual / model) of held-out deals in the tier (an 80 % validation-based range for one transaction)',
      calibratedOn: VV.FOLDS.filter((f) => f.id !== lastFold).map((f) => f.id), checkedOn: lastFold, coverage, coverageWithLocality: coverageCombined,
      localityWidening: 'a locality with ≥ 300 held-out deals whose own 10th–90th percentile band is wider than its tier band widens the range',
      localities: Object.fromEntries(Object.entries(locRangesAll).map(([c, r]) => [c, { name: locName(Number(c)), loPct: pct(Math.exp(r.lo) - 1), hiPct: pct(Math.exp(r.hi) - 1), n: r.n }])), published: Object.fromEntries(Object.entries(rangesAll).map(([t, r]) => [t, { loPct: pct(Math.exp(r.lo) - 1), hiPct: pct(Math.exp(r.hi) - 1), n: r.n }])) },
    marketCaps: Object.fromEntries(Object.entries(capsAll.detail).map(([c, d]) => [c, { name: locName(Number(c)), n: d.n, mdape: pct(d.mdape), p80ape: pct(d.p80ape), cap: d.cap }])),
  };

  /* ── 2 · production fit on every transaction (as of the window's end) ── */
  const cutoff = dayAfter(window.to);   // every transaction of the window is training evidence for the published estimate
  const P = VM.fit(L.rows, cutoff);
  const ctx = VM.contextOf(L.rows, P, { streetBlocks: VM.streetBlocksOf(L.links, cutoff), nbStreets: L.nb, keepRows: true });
  const ranges = rangesAll;
  const estimates = [];
  const D = L.D;
  const S = EV.store();
  const noDeals = new Set((S.meta.settlements && S.meta.settlements.noDealsInWindow) || []);
  for (const s of D.streets) {
    if (s.kind === SD.KIND.LOCALITY) continue;
    const swept = !!S.summary.localities[s.cityCode];
    let row;
    if (!swept) row = [s.id, null, 'UNAVAILABLE', null, null, noDeals.has(s.cityCode) ? 'locality-no-deals-in-window' : 'locality-not-in-register-copy'];
    else {
      const lev = VM.streetLevel(s.cityCode, s.code, ctx, null);
      const levels = lev.levels || {};
      const tier = lev.unavailable ? VV.TIER.UNAVAILABLE : VV.tierOf(lev, window.to, capsAll.caps.get(s.cityCode));
      const reason = lev.unavailable || (tier === VV.TIER.UNAVAILABLE ? (capsAll.caps.get(s.cityCode) === VV.TIER.UNAVAILABLE ? 'market-validation-failed' : 'street-specific-evidence-thin') : null);
      const value = tier === VV.TIER.UNAVAILABLE ? null : Math.round(Math.exp(lev.value) / 100) * 100;   // ₪100: no false precision
      const rg = value != null ? widen(ranges[tier], locRangesAll[s.cityCode]) : null;
      const lv = (x) => (x ? [Math.round(x.nEff * 10) / 10, x.n, x.parcels, Math.round(x.largestParcelShare * 100), x.latest] : null);
      const ex = value != null ? VM.explainLevel(lev, ctx, window.to, { summaryOnly: true }) : null;
      row = [s.id, value, tier, rg ? Math.round(value * Math.exp(rg.lo) / 100) * 100 : null, rg ? Math.round(value * Math.exp(rg.hi) / 100) * 100 : null, reason,
        lv(levels.street), lv(levels.block), lv(levels.neighbourhood), lv(levels.locality),
        lev.weights ? ['street', 'block', 'neighbourhood', 'locality'].map((k) => Math.round((lev.weights[k] || 0) * 1000) / 1000) : null,
        lev.value != null ? lev.value : null,
        ex ? [ex.summary.medianAgeMonths, ex.summary.largestParcelPct, ex.summary.timeAdjPct, ex.summary.specificShare,
          ex.street ? ex.street.medianArea : null, ex.street ? ex.street.newShare : null, ex.street ? ex.street.subsidyShare : null, ex.street ? ex.street.dwellingAdjPct : null] : null,
        rg ? rg.basis : null];
    }
    estimates.push(row);
  }
  estimates.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  /* ── 3 · artifacts ── */
  const counts = { streets: estimates.length, estimated: estimates.filter((e) => e[1] != null).length, byTier: estimates.reduce((o, e) => ((o[e[2]] = (o[e[2]] || 0) + 1), o), {}),
    unavailableReasons: estimates.filter((e) => e[1] == null).reduce((o, e) => ((o[e[5]] = (o[e[5]] || 0) + 1), o), {}) };
  counts.coveragePct = pct(counts.estimated / counts.streets);
  /* the coverage report: searchable streets · observed SUPPORTED · receiving an estimate (by tier) · unavailable — nationally, by
     district, by locality (≥ 100 searchable streets), by the street's OBSERVED state and by model tier */
  const blankC = () => ({ searchable: 0, observedSupported: 0, estimated: 0, unavailable: 0, STRONG: 0, STANDARD: 0, LIMITED: 0 });
  const cov = { total: blankC(), byDistrict: {}, byLocality: {}, byObservedState: {}, byKind: {}, byModelTier: counts.byTier };
  for (const e of estimates) {
    const ref = SD.parseId(e[0]), loc = D.localities.get(ref.cityCode) || {};
    const obs = EV.stateOf(S.summary, ref.cityCode, ref.streetCode) || 'UNKNOWN';
    const bump = (c) => { c.searchable++; if (obs === 'SUPPORTED') c.observedSupported++; if (e[1] != null) { c.estimated++; c[e[2]]++; } else c.unavailable++; };
    bump(cov.total);
    bump(cov.byDistrict[loc.district || 'unknown'] = cov.byDistrict[loc.district || 'unknown'] || blankC());
    bump(cov.byLocality[ref.cityCode] = cov.byLocality[ref.cityCode] || { name: loc.he || null, district: loc.district || null, ...blankC() });
    bump(cov.byObservedState[obs] = cov.byObservedState[obs] || blankC());
    { const row = D.byId.get(e[0]) || {}; const kind = row.status === 'historical' ? 'historical' : row.kind || 'street'; bump(cov.byKind[kind] = cov.byKind[kind] || blankC()); }
  }
  for (const [c, x] of Object.entries(cov.byLocality)) if (x.searchable < 100) delete cov.byLocality[c];
  for (const c of [cov.total, ...Object.values(cov.byDistrict), ...Object.values(cov.byLocality), ...Object.values(cov.byObservedState), ...Object.values(cov.byKind)]) c.coveragePct = pct(c.estimated / Math.max(1, c.searchable));
  validation.coverage = cov;
  const model = {
    modelVersion: VM.MODEL_VERSION, featureVersion: VM.FEATURE_VERSION, validationVersion: VM.VALIDATION_VERSION, builtAt: new Date().toISOString(),
    trainingCutoff: cutoff, asOf: window.to, window, inputs,
    target: 'log ₪ per m² of one transaction; the street estimate = the value per m² of the REFERENCE DWELLING on the street',
    reference: { ...VM.REFERENCE, sqmPerRoom: VM.REF_SQM_PER_ROOM, age: 'the district\'s existing-home age mix' },
    features: VM.COLS, rho: P.rho, k: { street: P.k.street.k, block: P.k.block.k, neighbourhood: P.k.neighbourhood.k, detail: P.k },
    anchorQuarters: P.anchorQuarters, anchorRule: 'the latest quarter with ≥ 60 % of the mean count of the four quarters before it (a still-filling quarter is not the anchor)',
    districts: Object.fromEntries(Object.entries(P.byDistrict).map(([d, F]) => [d, { source: F.source, n: F.n, blocks: F.blocks, beta: Object.fromEntries(VM.COLS.map((c, i) => [c, F.beta[i]])),
      quarters: F.quarters, base: F.base, index: F.qEffect, quarterRows: F.qN, anchorQuarter: P.anchorQuarter[d], anchor: P.anchor[d], ageRef: P.ageRef[d], fallbackRows: F.fallbackRows, typeN: F.typeN }])),
    national: { beta: Object.fromEntries(VM.COLS.map((c, i) => [c, P.national.beta[i]])), index: P.national.qEffect, base: P.national.base, quarters: P.national.quarters, n: P.national.n },
    tierRule: VV.TIER_RULE, ranges: Object.fromEntries(Object.entries(ranges).map(([t, r]) => [t, { lo: r.lo, hi: r.hi, n: r.n }])), localityRanges: locRangesAll,
    marketCaps: Object.fromEntries([...capsAll.caps].map(([c, cap]) => [c, cap])),
    outliers: [...P.outliers].map((id) => VM.rowKey(L.rows[id])).sort(),
    subsidyParcels: [...VM.subsidizedParcels()].sort(),
    population: { rows: L.rows.length, outliers: P.outliers.size, subsidyRows: L.rows.filter((r) => r.subsidyParcel).length },
    counts, sources: { evidence: 'over:street-evidence', directory: 'datagov:streets', land: 'rmi:michrazim', neighbourhoods: 'PROPX verified street links (data/geo/neighborhoods.json)' },
  };
  const prev = readJson('estimates.json');
  const prevModel = readJson('model.json');
  writeJson('model.json', model);
  /* @deps:begin */ writeJson('dependencies.json', { schema: 1, forBuild: model.builtAt, recordedBy: 'build', deps: inputs.deps, graph: DEPS.GRAPH }); /* @deps:end */
  writeJson('estimates.json', { modelVersion: VM.MODEL_VERSION, builtAt: model.builtAt, asOf: window.to,
    columns: ['id', 'value', 'tier', 'lo', 'hi', 'reason', 'street', 'block', 'neighbourhood', 'locality', 'weights', 'level', 'why', 'rangeBasis'],
    whyColumns: ['medianAgeMonths', 'largestParcelContributionPct', 'timeAdjustmentPct', 'streetSpecificSharePct', 'streetMedianArea', 'streetNewSharePct', 'streetSubsidySharePct', 'streetDwellingAdjustmentPct'],
    levelColumns: ['nEff', 'n', 'parcels', 'largestParcelPct', 'latest'], rows: estimates }, true);
  writeJson('validation.json', validation);
  writeJson('audit.json', audit(L));
  /* history: one record per build + every material change against the previous build, with its reason */
  const changes = [];
  /* @deps:begin */ const reason = reasonOf(prevModel, inputs); /* @deps:end */
  if (prev && prev.rows) {
    const old = new Map(prev.rows.map((r) => [r[0], r]));
    for (const e of estimates) {
      const o = old.get(e[0]); if (!o) continue;
      const moved = o[1] != null && e[1] != null ? Math.abs(e[1] / o[1] - 1) >= MATERIAL : (o[1] == null) !== (e[1] == null);
      if (moved || o[2] !== e[2]) changes.push({ id: e[0], before: { value: o[1], tier: o[2] }, after: { value: e[1], tier: e[2] }, reason });
    }
  }
  fs.appendFileSync(path.join(DIR, 'history.jsonl'), JSON.stringify({ at: model.builtAt, modelVersion: VM.MODEL_VERSION, previousModelVersion: prevModel ? prevModel.modelVersion : null,
    reason, inputs, counts, national: validation.national, materialChanges: changes.length, changes: changes.slice(0, 2000), truncated: changes.length > 2000 || undefined }) + '\n');
  console.log(JSON.stringify({ ms: Date.now() - t0, counts, national: validation.national, baselines: Object.fromEntries(Object.entries(baselines).map(([k, b]) => [k, { n: b.common, base: b.baseline.mdape, model: b.model.mdape }])), byModelTier: validation.byModelTier, coverage }, null, 1));
}
function dayAfter(iso) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

/* @deps:begin — the stored build against what the model reads now (lib/streets/model-deps.js): --check prints CURRENT / STALE (and
   which dependency moved); --if-stale rebuilds only then, and only on a COMPLETE sweep */
if (has('check') || has('if-stale')) {
  const c = DEPS.check({ modelDir: DIR });
  if (has('check')) { console.log(c.stale ? `STALE (${c.moved.join(', ')})` : 'CURRENT'); process.exit(c.stale ? 1 : 0); }
  if (!c.stale) { console.log('street model current — no dependency it reads moved'); process.exit(0); }
  console.log(`street model stale — moved: ${c.moved.join(', ')}`);
  const S = EV.store();
  if (!S.available || !S.meta.sweep || S.meta.sweep.status !== 'COMPLETE') { console.log('street evidence sweep not complete — the stored model is kept'); process.exit(0); }
}
/* @deps:end */
build();
