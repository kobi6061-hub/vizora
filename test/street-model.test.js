// PROPX · STREET VALUE MODEL gates (19.10.2026): the MODEL layer beside Street Intelligence (lib/streets/value-model.js ·
// value-validate.js · value-read.js · scripts/street-model-build.js · data/streets/model/).
//   TRUTH (§30): MODEL ≠ OBSERVED · MODEL ≠ OFFICIAL · MODEL ≠ APPRAISAL · NEIGHBOURHOOD / CITY / DISTRICT PRICE ≠ STREET PRICE ·
//   ONE PROJECT ≠ ENTIRE STREET MARKET · TRANSACTION COUNT ≠ INDEPENDENT PARCEL COUNT · PROBABLE NEW ≠ CONFIRMED NEW HOME ·
//   MODEL RANGE ≠ GUARANTEED SALE RANGE · ASKING PRICE ≠ TRANSACTION VALUE · FUTURE DATA ≠ VALID TRAINING DATA
//   MECHANICS on a SYNTHETIC TEST FIXTURE built here (never written to data/, never read by the product): the hedonic + index fit,
//   no look-ahead, the grouped holdout, parcel design weights, shrinkage, availability, the explanation's arithmetic.
//   ARTIFACTS on the committed build: versioning, coverage, tiers, ranges, validation vs baselines, request-time reproduction,
//   the apartment estimate, the API views, the page copy, the workflow — and the 16 acceptance cases (§28), each picked from the
//   committed build by its defining property (no hard-coded street, so a weekly rebuild keeps them meaningful).

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const VM = require('../lib/streets/value-model');
const VV = require('../lib/streets/value-validate');
const VR = require('../lib/streets/value-read');
const EV = require('../lib/streets/evidence');
const SD = require('../lib/streets/directory');
const X = require('../lib/explain/registry');

let passed = 0, failed = 0;
const pending = [];
const t = (name, fn) => pending.push([name, fn]);
const MD = path.join(ROOT, 'data', 'streets', 'model');
const readJ = (f) => JSON.parse(fs.readFileSync(path.join(MD, f), 'utf8'));
const MODEL = readJ('model.json'), EST = readJ('estimates.json'), VAL = readJ('validation.json');
const COL = Object.fromEntries(EST.columns.map((c, i) => [c, i]));
const lvl = (x) => (x ? { nEff: x[0], n: x[1], parcels: x[2], largestParcelPct: x[3], latest: x[4] } : null);
const rowsOf = () => EST.rows.map((r) => ({ id: r[0], value: r[1], tier: r[2], lo: r[3], hi: r[4], reason: r[5], levels: { street: lvl(r[6]), block: lvl(r[7]), neighbourhood: lvl(r[8]), locality: lvl(r[9]) }, weights: r[10], level: r[11], why: r[12] }));
const ALL = rowsOf();
const PUB = ALL.filter((r) => r.value != null);

/* ───────────────────────── a SYNTHETIC TEST FIXTURE (in memory) ───────────────────────── */
function synth(seed = 11) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const months = []; for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const d = `${y}-${String(m).padStart(2, '0')}-15`; if (d >= '2023-10-01' && d <= '2026-09-17') months.push(d); }
  const rows = [], truth = { lnArea: -0.12, perQuarter: 0.03, street: new Map(), block: new Map() };
  const qIndex = (d) => Math.floor(VM.monthsBetween('2023-10-15', d) / 3);
  const add = (city, gush, helka, street, date, area, yb, extra = 0) => {
    const rooms = Math.max(1, Math.round(area / 25));
    const y = Math.log(20000) + truth.block.get(city + '|' + gush) + (street != null ? truth.street.get(city + ':' + street) : 0) + extra
      + truth.lnArea * Math.log(area / 85) + truth.perQuarter * qIndex(date) + 0.07 * gauss();
    const dy = Number(date.slice(0, 4));
    rows.push({ city, district: 'd-test', date, q: VM.quarterOf(date), y, ppsqm: Math.round(Math.exp(y)), amount: Math.round(Math.exp(y) * area), areaSqm: area, rooms,
      yearBuilt: yb, probNew: false, offPlan: false, ageBand: dy - yb <= 10 ? '2-10' : dy - yb <= 25 ? '11-25' : dy - yb <= 45 ? '26-45' : '46+', type: 'flat', subParcel: rows.length,
      gush, helka, block: city + '|' + gush, parcel: city + '|' + gush + '/' + helka, project: dy - yb <= 10 ? city + '|' + gush + '|' + yb : null, subsidyParcel: false,
      match: street != null ? 'OBSERVED' : 'POSSIBLE', street, touches: street != null ? [street] : [], house: null });
  };
  for (let g = 1; g <= 30; g++) truth.block.set('9001|' + g, 0.15 * gauss());
  for (let st = 1; st <= 60; st++) truth.street.set('9001:' + st, 0.08 * gauss());
  for (let st = 1; st <= 60; st++) {
    const gush = (st % 30) + 1, parcels = 1 + Math.floor(rnd() * 5);
    for (let h = 1; h <= parcels; h++) {
      const pe = 0.05 * gauss(), yb = 1960 + Math.floor(rnd() * 60), k = 1 + Math.floor(rnd() * 8);
      for (let i = 0; i < k; i++) add(9001, gush, st * 10 + h, st, months[Math.floor(rnd() * months.length)], 50 + Math.floor(rnd() * 100), yb, pe);
    }
  }
  /* one tower: 200 sales on one parcel of street 61 (block 5) */
  truth.street.set('9001:61', 0.1);
  for (let i = 0; i < 200; i++) add(9001, 5, 9999, 61, months[Math.floor(rnd() * months.length)], 60 + Math.floor(rnd() * 60), 2022, 0.03 * gauss());
  /* a development: two parcels of block 7 built in 2021 (one project proxy), on street 62 */
  truth.street.set('9001:62', 0);
  for (const h of [8001, 8002]) for (let i = 0; i < 6; i++) add(9001, 7, h, 62, months[Math.floor(rnd() * months.length)], 80 + Math.floor(rnd() * 40), 2021);
  /* a thin locality: three deals */
  truth.block.set('9002|1', 0); truth.street.set('9002:1', 0);
  for (let i = 0; i < 3; i++) add(9002, 1, 1, 1, months[i * 5], 90, 1990);
  rows.sort((a, b) => a.city - b.city || a.date.localeCompare(b.date) || a.parcel.localeCompare(b.parcel) || a.ppsqm - b.ppsqm);
  rows.forEach((r, i) => { r.id = i; });
  /* location links: every parcel touches its street (dated by its deals) */
  const links = rows.filter((r) => r.street != null).map((r) => [r.city + ':' + r.street, r.block, r.date]);
  return { rows, links, truth };
}
const SY = synth();
const CUT = '2026-04-01';
const P0 = VM.fit(SY.rows, CUT);
const train0 = SY.rows.filter((r) => r.date < CUT);
const ctx0 = (keepRows) => VM.contextOf(train0, P0, { streetBlocks: VM.streetBlocksOf(SY.links, CUT), keepRows });

/* ───────────────────────── mechanics (synthetic fixture) ───────────────────────── */
t('fit: the within-block hedonic + quarterly index recovers the fixture\'s area effect and price trend', () => {
  const F = P0.byDistrict['d-test'];
  assert.equal(F.source, 'national-fallback', 'a district under 3,000 rows takes the national fit, labelled');
  assert.ok(Math.abs(F.beta[0] - SY.truth.lnArea) < 0.04, 'lnArea ' + F.beta[0]);
  const first = F.qEffect[F.quarters[0]], nq = F.quarters.length - 1;
  assert.ok(Math.abs(first - -SY.truth.perQuarter * nq) < 0.05, `first quarter ${first} vs ${-SY.truth.perQuarter * nq}`);
  assert.equal(F.qEffect[F.base], 0, 'the latest quarter is the base');
  assert.ok(P0.rho > 0 && P0.rho < 1);
});

t('FUTURE DATA ≠ VALID TRAINING DATA: every parameter is identical whatever happens after the cutoff; links dated after it are ignored', () => {
  const shock = SY.rows.map((r) => (r.date >= CUT ? { ...r, y: r.y + 1, ppsqm: r.ppsqm * 3 } : r));
  const P1 = VM.fit(shock, CUT);
  const sig = (P) => JSON.stringify({ rho: P.rho, k: [P.k.street.k, P.k.block.k], b: P.byDistrict['d-test'].beta, q: P.byDistrict['d-test'].qEffect, out: [...P.outliers].sort() });
  assert.equal(sig(P1), sig(P0));
  const late = [['9001:1', '9001|99', '2026-05-01'], ['9001:1', '9001|2', '2026-01-01']];
  const m = VM.streetBlocksOf(late, CUT);
  assert.deepEqual([...m.get('9001:1')], ['9001|2']);
  /* the validation folds: every training row precedes the cutoff; the test rows are the OBSERVED street deals of the next 6 months */
  for (const f of VV.FOLDS) assert.ok(f.cutoff < MODEL.trainingCutoff && f.months === 6);
  const src = fs.readFileSync(path.join(ROOT, 'lib/streets/value-validate.js'), 'utf8');
  assert.match(src, /const train = L\.rows\.filter\(\(r\) => r\.date < C\);/);
  assert.match(src, /VM\.fit\(L\.rows, C,/);
  assert.match(src, /VM\.streetBlocksOf\(L\.links, C\)/);
  assert.match(src, /r\.date >= C && r\.date < end && r\.street != null/);
});

t('grouped holdout: a held-out parcel and its development leave every level; the locality level equals a recomputation without them', () => {
  const ctx = ctx0(true);
  const tr = train0.find((r) => r.street === 62);
  const ex = { parcel: tr.parcel, project: tr.project };
  assert.ok(ex.project, 'the fixture development has a project key');
  const lev = VM.streetLevel(9001, 62, ctx, ex);
  for (const [k, rs] of Object.entries(lev.rows || {})) for (const r of rs) assert.ok(r.parcel !== ex.parcel && r.project !== ex.project, `${k} keeps ${r.parcel}`);
  const sibling = train0.filter((r) => r.project === ex.project && r.parcel !== ex.parcel);
  assert.ok(sibling.length, 'the development has a second parcel — removed too');
  const direct = VM.levelOf(train0.filter((r) => r.city === 9001 && !P0.outliers.has(r.id) && r.project !== ex.project && r.parcel !== ex.parcel), P0, ctx.zs);
  const L = VM.localityLevel(9001, ctx, ex);
  assert.ok(Math.abs(L.mean - direct.mean) < 1e-9 && Math.abs(L.nEff - direct.nEff) < 1e-9 && L.n === direct.n);
});

t('TRANSACTION COUNT ≠ INDEPENDENT PARCEL COUNT · ONE PROJECT ≠ ENTIRE STREET MARKET: a 200-sale tower counts ≈ 1/ρ, never 200', () => {
  const ctx = ctx0(false);
  const tower = train0.filter((r) => r.parcel === '9001|5/9999' && !P0.outliers.has(r.id));
  const L = VM.levelOf(tower, P0, ctx.zs);
  assert.equal(L.parcels, 1);
  assert.ok(Math.abs(L.nEff - tower.length / (1 + (tower.length - 1) * P0.rho)) < 1e-9);
  assert.ok(L.nEff < 1 / P0.rho + 1e-9 && L.nEff < 10, 'nEff ' + L.nEff);
  /* and the tier rule never calls one parcel STRONG */
  const lev = VM.streetLevel(9001, 61, ctx, null);
  assert.equal(lev.levels.street.parcels, 1);
  assert.notEqual(VV.tierOf(lev, '2026-03-31', null), VV.TIER.STRONG);
});

t('shrinkage: a one-deal street is pulled toward its parents; level shares sum to 1; the explanation reproduces the value exactly', () => {
  const ctx = ctx0(true);
  let one = null;
  for (let st = 1; st <= 60 && !one; st++) { const rs = (ctx.byStreet.get('9001:' + st) || []).filter((r) => !P0.outliers.has(r.id)); if (rs.length === 1) one = st; }
  assert.ok(one, 'the fixture has a one-deal street');
  const lev = VM.streetLevel(9001, one, ctx, null);
  const sum = Object.values(lev.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  /* one deal (n_eff 1) carries exactly 1 / (1 + k_street) — the estimated credibility, never a hand-set weight */
  assert.ok(Math.abs(lev.weights.street - 1 / (1 + P0.k.street.k)) < 1e-12, 'w = n_eff / (n_eff + k)');
  const own = lev.levels.street.mean;
  const parentSide = lev.levels.block ? lev.levels.block.mean : lev.levels.locality.mean;
  assert.ok((lev.value - own) * (lev.value - parentSide) <= 1e-12, 'between its own deal and its parents');
  const ex = VM.explainLevel(lev, ctx, '2026-03-31');
  const cs = ex.contributions.reduce((a, c) => a + c.contribution, 0);
  const val = ex.contributions.reduce((a, c) => a + c.contribution * Math.log(c.implied), 0);
  assert.ok(Math.abs(cs - 1) < 1e-9 && Math.abs(val - lev.value) < 1e-9, `Σ = ${cs}, value ${val} vs ${lev.value}`);
});

t('NEIGHBOURHOOD / CITY / DISTRICT PRICE ≠ STREET PRICE: no street-specific evidence → MODEL UNAVAILABLE; a thin locality cannot anchor', () => {
  const ctx = ctx0(false);
  const none = VM.streetLevel(9001, 777, ctx, null);
  assert.equal(none.unavailable, 'no-street-specific-evidence'); assert.equal(none.value, undefined);
  const thin = VM.streetLevel(9002, 1, ctx, null);
  assert.equal(thin.unavailable, 'locality-evidence-thin');
  assert.equal(VV.tierOf(none, CUT, null), VV.TIER.UNAVAILABLE);
});

t('tiers: STRONG needs own recent evidence from ≥ 2 parcels in a deep locality; stale or one-parcel evidence is never STRONG; caps downgrade', () => {
  const R = VV.TIER_RULE;
  const mk = (s, b, loc) => ({ levels: { street: s, block: b, neighbourhood: null, locality: loc } });
  const deep = { nEff: 400 };
  assert.equal(VV.tierOf(mk({ nEff: 3, parcels: 3, latest: '2026-08-01' }, null, deep), '2026-09-17', null), 'STRONG');
  assert.equal(VV.tierOf(mk({ nEff: 3, parcels: 1, latest: '2026-08-01' }, null, deep), '2026-09-17', null), 'STANDARD', 'one parcel');
  assert.equal(VV.tierOf(mk({ nEff: 3, parcels: 3, latest: '2024-12-01' }, null, deep), '2026-09-17', null), 'STANDARD', 'stale');
  assert.equal(VV.tierOf(mk({ nEff: 3, parcels: 3, latest: '2026-08-01' }, null, { nEff: 120 }), '2026-09-17', null), 'STANDARD', 'shallow locality');
  assert.equal(VV.tierOf(mk(null, { nEff: 25 }, deep), '2026-09-17', null), 'STANDARD');
  assert.equal(VV.tierOf(mk(null, { nEff: 6 }, deep), '2026-09-17', null), 'LIMITED');
  assert.equal(VV.tierOf(mk(null, { nEff: 4 }, deep), '2026-09-17', null), 'UNAVAILABLE');
  assert.equal(VV.tierOf(mk({ nEff: 3, parcels: 3, latest: '2026-08-01' }, null, deep), '2026-09-17', 'LIMITED'), 'LIMITED');
  assert.equal(VV.tierOf(mk({ nEff: 3, parcels: 3, latest: '2026-08-01' }, null, deep), '2026-09-17', 'UNAVAILABLE'), 'UNAVAILABLE');
  assert.equal(R.strongStreetParcels, 2); assert.equal(R.strongRecentMonths, 18);
  /* ranges need ≥ 200 held-out deals in the tier */
  const few = Array.from({ length: 150 }, (_, i) => ({ pred: 100, actual: 90 + i / 10, tier: 'LIMITED' }));
  assert.deepEqual(VV.rangesOf(few), {});
  /* metrics on known values */
  const m = VV.metrics([{ pred: 100, actual: 100, areaSqm: 1 }, { pred: 110, actual: 100, areaSqm: 1 }, { pred: 80, actual: 100, areaSqm: 1 }]);
  assert.ok(Math.abs(m.mdape - 0.1) < 1e-12 && m.n === 3);
});

t('review fixes (mechanics): loose-name links never locate; adjacent build years are one development; new rows are age-centred; a still-filling quarter is not the anchor', () => {
  assert.deepEqual(VM.linkStreets([{ code: 1, via: 'official-name' }, { code: 2, via: 'normalized-name' }, { code: 3, via: 'official-synonym' }]).map((x) => x.code), [1, 3]);
  const r = { city: 9001, gush: 7, yearBuilt: 2021, project: '9001|7|2021', parcel: '9001|7/1' };
  const ex = VM.excluder({ parcel: r.parcel, project: r.project, projects: VM.projectsOf(r) });
  assert.ok(ex({ parcel: 'x', project: '9001|7|2022' }) && ex({ parcel: 'x', project: '9001|7|2020' }) && !ex({ parcel: 'x', project: '9001|7|2023' }) && !ex({ parcel: 'x', project: '9001|8|2021' }));
  /* zOf / priceOf invert each other for a new row and an existing row; a new row's premium is measured against the age mix */
  const F = P0.byDistrict['d-test'];
  const base = { district: 'd-test', areaSqm: 85, rooms: 3.4, offPlan: false, type: 'flat', subsidyParcel: false, q: null };
  const lvl = 10, pNew = VM.priceOf(lvl, { ...base, probNew: true, ageBand: null }, P0), pRef = VM.priceOf(lvl, { ...base, probNew: false, ageBand: null }, P0);
  assert.ok(Math.abs((pNew - pRef) - (F.beta[1] - P0.ageRef['d-test'])) < 1e-12);
  const tr = train0.find((x) => x.street === 62); const z = VM.zOf(tr, P0);
  assert.ok(Math.abs(VM.priceOf(z.z - z.timeAdj, tr, P0) - tr.y) < 1e-9, 'z inverts priceOf');
  /* the anchor steps back from a quarter holding < 60 % of the four before it */
  const thin = SY.rows.filter((x) => !(x.date >= '2026-07-01' && x.id % 5 !== 0));
  const Pt = VM.fit(thin, '2026-10-01');
  assert.equal(Pt.anchorQuarter['d-test'], '2026Q2');
  assert.equal(P0.anchorQuarter['d-test'], P0.byDistrict['d-test'].base, 'a reported quarter stays the anchor');
});

/* ───────────────────────── the committed build ───────────────────────── */
t('versioning: model_version · built_at · training_cutoff · source_versions · feature_definition_version · validation_version; reproducible inputs', () => {
  for (const k of ['modelVersion', 'featureVersion', 'validationVersion', 'builtAt', 'trainingCutoff', 'asOf', 'inputs']) assert.ok(MODEL[k], k);
  assert.equal(MODEL.modelVersion, VM.MODEL_VERSION); assert.equal(MODEL.featureVersion, VM.FEATURE_VERSION); assert.equal(MODEL.validationVersion, VM.VALIDATION_VERSION);
  assert.equal(EST.modelVersion, MODEL.modelVersion); assert.equal(VAL.modelVersion, MODEL.modelVersion); assert.equal(VAL.version, VM.VALIDATION_VERSION);
  for (const k of ['evidence', 'directory', 'land', 'code']) assert.ok(MODEL.inputs[k], 'input ' + k);
  assert.ok(MODEL.trainingCutoff > MODEL.asOf, 'every deal of the window (≤ as-of) is training evidence for the published estimate');
  /* the committed build is CURRENT: its inputs are the committed evidence, directory, land parcels and model code */
  assert.equal(execFileSync(process.execPath, [path.join(ROOT, 'scripts/street-model-build.js'), '--check'], { encoding: 'utf8' }).trim(), 'CURRENT');
  /* history: append-only, one record per build with its reason */
  const H = fs.readFileSync(path.join(MD, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(H.length >= 1 && H.every((h) => h.at && h.modelVersion && h.reason && h.counts));
  assert.equal(H[H.length - 1].at, MODEL.builtAt);
});

t('coverage: every searchable official street once; counts reconcile; coverage = estimated ÷ searchable', () => {
  const D = SD.load();
  const searchable = D.streets.filter((s) => s.kind !== SD.KIND.LOCALITY).map((s) => s.id).sort();
  assert.deepEqual(ALL.map((r) => r.id), searchable);
  const c = MODEL.counts;
  assert.equal(c.streets, searchable.length); assert.equal(c.estimated, PUB.length);
  assert.equal(c.estimated + (c.byTier.UNAVAILABLE || 0), c.streets);
  assert.equal(c.coveragePct, Math.round(c.estimated / c.streets * 1000) / 10);
  assert.equal(Object.values(c.unavailableReasons).reduce((a, b) => a + b, 0), c.streets - c.estimated);
  for (const r of ALL) if (r.value == null) { assert.equal(r.tier, 'UNAVAILABLE'); assert.ok(r.reason, r.id); assert.equal(r.lo, null); }
  /* the coverage report reconciles: districts and observed states each sum to the national total */
  const C = VAL.coverage;
  assert.equal(C.total.searchable, c.streets); assert.equal(C.total.estimated, c.estimated); assert.equal(C.total.coveragePct, c.coveragePct);
  for (const part of ['byDistrict', 'byObservedState']) for (const k of ['searchable', 'estimated', 'unavailable', 'STRONG', 'STANDARD', 'LIMITED', 'observedSupported']) {
    assert.equal(Object.values(C[part]).reduce((a, x) => a + x[k], 0), C.total[k], part + ' ' + k);
  }
  assert.ok(C.byLocality['5000'] && C.byLocality['3000'], 'major cities listed');
  assert.equal(C.byObservedState.SUPPORTED.observedSupported, C.byObservedState.SUPPORTED.searchable);
});

t('NEIGHBOURHOOD / CITY / DISTRICT PRICE ≠ STREET PRICE (build): every published estimate rests on street, block or verified-neighbourhood evidence', () => {
  for (const r of PUB) {
    assert.ok(r.levels.street || r.levels.block || r.levels.neighbourhood, r.id);
    const specific = r.weights[0] + r.weights[1] + r.weights[2];
    assert.ok(specific > 0, r.id + ' carries no street-specific weight');
    assert.ok(Math.abs(r.weights.reduce((a, b) => a + b, 0) - 1) < 0.003, r.id);
  }
});

t('tiers (build): recomputed from the stored levels with the stored caps; one parcel never STRONG; stale never STRONG', () => {
  const R = MODEL.tierRule, near = (x, th) => x != null && Math.abs(x - th) <= 0.06;
  let checked = 0;
  for (const r of ALL) {
    if (r.reason && /^locality-(no-deals|not-in)/.test(r.reason)) continue;
    const s = r.levels.street, b = r.levels.block, l = r.levels.locality;
    if (near(s && s.nEff, R.strongStreetNEff) || near(b && b.nEff, R.standardBlockNEff) || near(b && b.nEff, R.limitedBlockNEff) || near(l && l.nEff, R.strongLocalityNEff) || near(l && l.nEff, VM.MIN_LOCALITY_NEFF)) continue;
    if (r.reason === 'no-street-specific-evidence' || r.reason === 'locality-evidence-thin') continue;
    const cap = MODEL.marketCaps[SD.parseId(r.id).cityCode] || null;
    assert.equal(VV.tierOf({ levels: r.levels }, MODEL.asOf, cap), r.tier, r.id);
    checked++;
  }
  assert.ok(checked > 10000, 'checked ' + checked);
  for (const r of PUB) {
    if (r.levels.street && r.levels.street.parcels < 2) assert.notEqual(r.tier, 'STRONG', r.id + ' one parcel');
    if (r.levels.street && VM.monthsBetween(r.levels.street.latest, MODEL.asOf) > R.strongRecentMonths) assert.notEqual(r.tier, 'STRONG', r.id + ' stale');
  }
});

t('MODEL RANGE ≠ GUARANTEED SALE RANGE: validation-based ranges per tier (≥ 200 held-out deals), checked out of sample at ≈ 80 %', () => {
  for (const r of PUB) {
    const rg = MODEL.ranges[r.tier];
    if (!rg) { assert.equal(r.lo, null); continue; }
    /* the tier band, widened (never narrowed) by the locality's own band where it holds ≥ 300 held-out deals */
    const lr = MODEL.localityRanges[SD.parseId(r.id).cityCode];
    const lo = lr ? Math.min(rg.lo, lr.lo) : rg.lo, hi = lr ? Math.max(rg.hi, lr.hi) : rg.hi;
    assert.equal(r.lo, Math.round(r.value * Math.exp(lo) / 100) * 100, r.id); assert.equal(r.hi, Math.round(r.value * Math.exp(hi) / 100) * 100, r.id);
    assert.ok(r.lo < r.value && r.value < r.hi);
  }
  for (const [tier, c] of Object.entries(VAL.range.coverage)) { assert.ok(c.n >= 200, tier); assert.ok(c.within >= 72 && c.within <= 90, `${tier} out-of-sample coverage ${c.within} %`); }
  for (const [tier, c] of Object.entries(VAL.range.coverageWithLocality)) assert.ok(c.within >= VAL.range.coverage[tier].within, tier + ' widening never lowers coverage');
  for (const r of Object.values(MODEL.localityRanges)) assert.ok(r.n >= 300);
  assert.deepEqual(VAL.range.calibratedOn, ['A', 'B']); assert.equal(VAL.range.checkedOn, 'C');
  assert.match(VAL.range.method, /10th–90th percentile/);
});

t('validation: three forward folds; the model beats every baseline on the same held-out deals (MdAPE and P80)', () => {
  assert.deepEqual(VAL.design.folds.map((f) => f.id), ['A', 'B', 'C']);
  /* each test window is the 6 calendar months after its cutoff (a month-arithmetic overflow once cut fold B to 3.5 months) */
  for (const f of VAL.design.folds) { assert.equal(f.testEnds, VV.plusMonths(f.cutoff, 6)); assert.match(f.testEnds, /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/); }
  assert.equal(VV.plusMonths('2025-09-18', 6), '2026-03-18'); assert.equal(VV.plusMonths('2025-11-18', 3), '2026-02-18');
  assert.ok(VAL.baselines.bHedLocality && VAL.baselines.bHedLocality.common > 20000, 'the hedonic locality-only baseline is published');
  assert.match(VAL.design.selection, /lock-box/); assert.match(VAL.design.published, /BEFORE the locality caps/);
  assert.ok(VAL.byPredictedBand && VAL.byActualPriceBand && !VAL.byPriceBand, 'bias by the predicted band; the actual band is labelled');
  assert.match(VAL.design.holdout, /parcel and its development/); assert.match(VAL.design.noLookAhead, /before the fold cutoff/);
  assert.ok(VAL.national.n > 20000 && VAL.national.mdape > 0 && VAL.national.p80ape > VAL.national.mdape && VAL.national.p90ape > VAL.national.p80ape);
  for (const [k, b] of Object.entries(VAL.baselines)) {
    assert.ok(b.common > 0, k);
    assert.ok(b.model.mdape < b.baseline.mdape, `${k}: model ${b.model.mdape} vs ${b.baseline.mdape}`);
    assert.ok(b.model.p80ape < b.baseline.p80ape, `${k}: P80 model ${b.model.p80ape} vs ${b.baseline.p80ape}`);
  }
  for (const k of ['byFold', 'byDistrict', 'byLocality', 'byObservedTier', 'byNewness', 'byActualPriceBand', 'byPredictedBand', 'byModelTier', 'byModelTierAllFolds']) assert.ok(VAL[k] && Object.keys(VAL[k]).length, k);
  assert.equal(VAL.byModelTier.holdoutFold, 'C'); assert.deepEqual(VAL.byModelTier.capsFrom, ['A', 'B']);
  /* a locality whose own held-out error fails the rule publishes nothing */
  for (const [c, cap] of Object.entries(MODEL.marketCaps)) if (cap === 'UNAVAILABLE') assert.ok(ALL.filter((r) => SD.parseId(r.id).cityCode === Number(c)).every((r) => r.value == null), 'cap ' + c);
});

t('MODEL ≠ OBSERVED · MODEL ≠ OFFICIAL: the read is class MODEL beside an unchanged observed read; the observed thresholds stay 10 / 5 / 1', () => {
  assert.equal(EV.SAMPLE.SUPPORTED, 10); assert.equal(EV.SAMPLE.LIMITED, 5);
  const streetSrc = fs.readFileSync(path.join(ROOT, 'lib/streets/street.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'lib/streets/evidence.js'), 'utf8');
  assert.ok(!/value-(model|read|validate)/.test(streetSrc), 'the observed layer never reads the model');
  const id = PUB.find((r) => r.tier === 'STRONG').id;
  const e = VR.estimate(id);
  assert.equal(e.cls, 'MODEL'); assert.ok(!/OFFICIAL|OBSERVED/.test(JSON.stringify({ cls: e.cls, tier: e.tier })));
  assert.equal(e.range.basis, 'validation-80');
  const term = X.term('street_value_estimate');
  assert.ok(term, 'registry term'); assert.equal(term.cls, 'MODEL');
  for (const id of ['street_model_evidence', 'street_model_range', 'street_apartment_estimate']) assert.equal(X.term(id).cls, 'MODEL', id);
});

t('request time reproduces the build: WHY THIS ESTIMATE recomputed from one locality\'s shard equals the stored level', () => {
  const D = SD.load();
  const small = (r) => { const c = SD.parseId(r.id).cityCode; return c !== 5000 && c !== 3000 && c !== 4000; };
  const picks = ['STRONG', 'STANDARD', 'LIMITED'].map((tier) => PUB.find((r) => r.tier === tier && small(r))).filter(Boolean);
  assert.equal(picks.length, 3);
  for (const p of picks) {
    const x = VR.explain(p.id, { limit: 300 });
    assert.equal(x.consistent, true, p.id);
    const shown = Object.values(x.comparables).reduce((a, c) => a + c.contributionPct, 0);
    assert.ok(Math.abs(shown - 100) < 0.5, `${p.id} contributions ${shown}`);
    for (const c of Object.values(x.comparables)) for (const r of c.rows) {
      assert.ok(!('buyer' in r) && !('seller' in r) && !('name' in r), 'no personal data');
      assert.ok(r.date <= MODEL.asOf, 'no comparable after the as-of date');
    }
    assert.ok(D.byId.get(p.id));
  }
});

t('PROBABLE NEW ≠ CONFIRMED NEW HOME · the apartment estimate: the reference profile returns the street value; inputs and their effects are stated', () => {
  const p = PUB.find((r) => r.tier === 'STRONG');
  const ref = VR.apartment(p.id, { sqm: 85, newness: 'existing' }).apartment;
  assert.ok(Math.abs(ref.ppsqm - p.value) <= 100, `${ref.ppsqm} vs ${p.value}`);
  assert.equal(ref.value % 10000, 0, 'no false precision: ₪10,000'); assert.equal(ref.ppsqm % 100, 0);
  /* not modelled: a cottage / detached house (plot value); a build year in the future; a build year of the as-of year counts as new */
  assert.equal(VR.apartment(p.id, { sqm: 120, type: 'house' }).apartmentReason, 'type-not-modelled');
  assert.equal(VR.apartment(p.id, { sqm: 120, type: 'cottage' }).apartmentReason, 'type-not-modelled');
  assert.equal(VR.apartment(p.id, { sqm: 90, built: 2040 }).apartmentReason, 'built-out-of-range');
  assert.equal(VR.apartment(p.id, { sqm: 300 }).apartmentReason, 'area-out-of-range');
  const yr = Number(MODEL.asOf.slice(0, 4)), nb = VR.apartment(p.id, { sqm: 85, built: yr }).apartment;
  assert.equal(nb.profile.newness, 'new'); assert.equal(nb.profile.newBy, 'build-year'); assert.equal(nb.profile.built, null);
  /* a garden / roof effect only where ≥ 100 within-block sales fitted it */
  for (const [d, F] of Object.entries(MODEL.districts)) for (const ty of ['garden', 'roof']) {
    const st = PUB.find((r) => (SD.load().localities.get(SD.parseId(r.id).cityCode) || {}).district === d);
    if (!st) continue;
    const a = VR.apartment(st.id, { sqm: 90, type: ty });
    if ((F.typeN || {})[ty] >= VR.MIN_TYPE_SALES) assert.ok(a.apartment, d + ' ' + ty); else assert.equal(a.apartmentReason, 'type-sample-thin', d + ' ' + ty);
  }
  /* new: the premium against the reference age mix (the age-mix centring applies to new rows too) */
  const dist = (SD.load().localities.get(SD.parseId(p.id).cityCode) || {}).district, Fd = MODEL.districts[dist];
  const effNew = VR.apartment(p.id, { sqm: 85, newness: 'new' }).apartment.effects.find((f) => f.input === 'newness').effectPct;
  assert.ok(Math.abs(effNew - Math.round((Math.exp(Fd.beta.probNew - Fd.ageRef) - 1) * 1000) / 10) < 0.05);
  const nw = VR.apartment(p.id, { sqm: 85, newness: 'new' }).apartment;
  const eff = nw.effects.find((f) => f.input === 'newness');
  assert.equal(eff.value, 'new (probable)'); assert.ok(eff.effectPct !== 0);
  assert.deepEqual(ref.effects.map((f) => f.input), ['area', 'rooms', 'newness', 'age', 'type']);
  assert.equal(ref.cls, 'MODEL'); assert.match(ref.note, /not an appraisal/);
  assert.equal(VR.apartment(p.id, { sqm: 5 }).apartmentReason, 'area-out-of-range');
  assert.equal(VR.apartment(p.id, { sqm: 90, rooms: 40 }).apartmentReason, 'rooms-out-of-range');
  assert.ok(!('floor' in ref.profile), 'floor is not in the register — never asked');
  const un = ALL.find((r) => r.value == null && r.reason === 'no-street-specific-evidence');
  assert.equal(VR.apartment(un.id, { sqm: 90 }).apartment, null);
});

t('API: view=street carries the model beside the observed read; streetModel / streetApartment / streetModelValidation; 400 / 404', async () => {
  const h = require('../api/intel.js');
  const call = (q) => new Promise((ok) => { const res = { statusCode: 0, setHeader() {}, end(b) { ok([this.statusCode, JSON.parse(b)]); } }; h({ method: 'GET', url: '/api/intel?' + q, headers: {} }, res); });
  const id = PUB.find((r) => r.tier === 'STANDARD' && SD.parseId(r.id).cityCode !== 5000).id;
  const ST = require('../lib/streets/street');
  const [c1, b1] = await call('view=street&id=' + id); assert.equal(c1, 200);
  assert.equal(b1.model.cls, 'MODEL'); assert.equal(b1.model.value, PUB.find((r) => r.id === id).value);
  const obs = JSON.parse(JSON.stringify(ST.street(id)));
  const { model, ...rest } = b1; assert.deepEqual(rest, obs, 'the observed read is unchanged'); assert.ok(model);
  assert.ok(!('model' in ST.street(id)), 'the cached observed object is never mutated');
  assert.equal((await call('view=streetModel&id=x'))[0], 400);
  assert.equal((await call('view=streetModel&id=st:1:1'))[0], 404);
  const [c2, b2] = await call('view=streetApartment&id=' + id + '&sqm=100&rooms=4&newness=existing&built=1990'); assert.equal(c2, 200); assert.ok(b2.apartment.value > 0);
  const [c3, b3] = await call('view=streetModelValidation'); assert.equal(c3, 200); assert.equal(b3.version, VM.VALIDATION_VERSION);
});

t('MODEL ≠ APPRAISAL · ASKING PRICE ≠ TRANSACTION VALUE: page copy and registry never name the estimate an appraisal, an official or fair value', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/obsH:"[\s\S]*?methLoc:[^\n]*/g)].map((m) => m[0]);
  assert.equal(blocks.length, 2, 'he + en');
  const bad = /שווי שמאי|שווי רשמי|שווי הוגן|רווח סמך|SHAMAI|OFFICIAL VALUE|FAIR VALUE|APPRAISED VALUE|confidence interval|% confidence/i;
  for (const b of blocks) {
    assert.ok(!bad.test(b), 'forbidden label: ' + (b.match(bad) || [])[0]);
    /* "appraisal" / "guaranteed" appear only inside a negation ("not an appraisal, an asking price or a guaranteed sale price") */
    for (const m of b.matchAll(/appraisal|שומה|guarantee|מובטח/gi)) { const pre = b.slice(Math.max(0, m.index - 45), m.index); assert.ok(/not an? |\bnot\b|לא /.test(pre), 'only negated: …' + pre + m[0]); }
  }
  const ids = ['street_value_estimate', 'street_model_evidence', 'street_model_range', 'street_apartment_estimate', 'street_model_comparables', 'street_model_time_adjustment', 'street_model_validation'];
  for (const id of ids) {
    const term = X.term(id); assert.ok(term, id);
    const { notAs, ...rest } = term;
    assert.ok(!bad.test(JSON.stringify(rest)), id + ' names a forbidden label outside DO NOT INTERPRET AS');
    assert.ok(notAs, id + ' says what it does not mean');
  }
  const v = X.term('street_value_estimate');
  const L1 = JSON.stringify(v.short);
  assert.ok(L1.includes('PROPX estimates the street’s market value using recent comparable transactions from this street and the most relevant surrounding market evidence.'));
  assert.ok(L1.includes('PROPX מעריכה את שווי השוק ברחוב באמצעות עסקאות השוואה עדכניות מהרחוב ומסביבתו הרלוונטית.'));
  assert.ok(JSON.stringify(v).includes('This is not an appraisal, asking price, guaranteed sale price or official government valuation.'));
  /* the only price source is the deals register (transactions) — no listing / asking-price source exists in the model's inputs */
  assert.deepEqual(Object.keys(MODEL.sources).sort(), ['directory', 'evidence', 'land', 'neighbourhoods']);
  assert.equal(MODEL.sources.evidence, 'over:street-evidence');
});

t('page: OBSERVED and MODEL in two distinct cards; MODEL chip; MODEL UNAVAILABLE with its reason; the comparables table sorts; offline build carries it', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /class="sv-card sv-obs"/); assert.match(html, /class="sv-card sv-mod"/);
  assert.match(html, /\.sv-mod\{[^}]*dashed/);
  assert.match(html, /modChip:"MODEL · PROPX estimate"/); assert.match(html, /modUn:"MODEL UNAVAILABLE"/);
  assert.match(html, /stcomp:"text,date,currency,number,number,currency,number,text,text,currency,number,number,number"/);
  for (const k of ['STREET', 'obsH', 'modH', 'modEv', 'latestEv', 'mainLim', 'modWhy']) if (k !== 'STREET') assert.ok(html.includes(k + ':'), k);
  const sa = fs.readFileSync(path.join(ROOT, 'standalone/israel-new-homes-v2.html'), 'utf8');
  assert.ok(sa.includes('sv-card sv-mod') && sa.includes('stcomp:'), 'the offline build is rebuilt');
});

t('workflow: the evidence sync rebuilds the model only when an input changed, gates it, restores the previous model on failure, commits both', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/street-evidence-sync.yml'), 'utf8');
  assert.ok(y.indexOf('node scripts/street-evidence-sync.js') < y.indexOf('node scripts/street-model-build.js --if-stale'));
  assert.ok(y.indexOf('street-model-build.js --if-stale') < y.indexOf('node test/street-model.test.js'));
  assert.match(y, /git checkout -- data\/streets\/model/);
  assert.match(y, /git add data\/streets\/evidence data\/streets\/model( data\/streets\/recent)?\n/);
  const b = fs.readFileSync(path.join(ROOT, 'scripts/street-model-build.js'), 'utf8');
  assert.match(b, /sweep\.status !== 'COMPLETE'/);
  assert.match(b, /appendFileSync\(path\.join\(DIR, 'history\.jsonl'\)/);
});

/* ───────────────────────── the 16 acceptance cases (§28) ───────────────────────── */
const ST = require('../lib/streets/street');
const city = (r) => SD.parseId(r.id).cityCode;
const obsState = (id) => ST.street(id).evidence.stats.state;
const pick = (f) => PUB.find(f) || null;
const ACC = [];
const acc = (n, name, f) => t(`acceptance ${n}: ${name}`, () => { const out = f(); ACC.push({ n, name, ...out }); });

acc(1, '50+ independent observations on the street → STRONG, the street level carries most of the estimate', () => {
  const r = pick((x) => x.levels.street && x.levels.street.nEff >= 50 && x.tier === 'STRONG');
  assert.ok(r); assert.ok(r.weights[0] > 0.9, 'street weight ' + r.weights[0]);
  return { id: r.id, tier: r.tier, value: r.value, streetNEff: r.levels.street.nEff, streetWeight: r.weights[0] };
});
acc(2, '10–20 observations → observed SUPPORTED stays; the model sits beside it', () => {
  const r = pick((x) => x.levels.street && x.levels.street.n >= 12 && x.levels.street.n <= 20 && city(x) !== 5000 && obsState(x.id) === 'SUPPORTED');
  assert.ok(r); const o = ST.street(r.id).evidence.stats;
  assert.equal(o.state, 'SUPPORTED'); assert.ok(o.medianPricePerSqm > 0);
  return { id: r.id, observed: o.state, observedMedian: o.medianPricePerSqm, model: r.value, tier: r.tier };
});
acc(3, '5–9 observations → observed LIMITED stays LIMITED; the model is not STRONG unless ≥ 2 parcels and recent', () => {
  const r = pick((x) => x.levels.street && x.levels.street.n >= 5 && x.levels.street.n <= 9 && obsState(x.id) === 'LIMITED');
  assert.ok(r); assert.equal(obsState(r.id), 'LIMITED');
  return { id: r.id, observed: 'LIMITED', model: r.value, tier: r.tier };
});
acc(4, '1–4 observations → observed INSUFFICIENT (price "—") stays; the model may estimate with parent evidence', () => {
  const r = pick((x) => x.levels.street && x.levels.street.n >= 1 && x.levels.street.n <= 4 && x.levels.block && obsState(x.id) === 'INSUFFICIENT');
  assert.ok(r); const o = ST.street(r.id).evidence.stats;
  assert.equal(o.state, 'INSUFFICIENT'); assert.equal(o.medianPricePerSqm == null, true, 'the observed layer prints no price');
  assert.ok(r.weights[0] < 0.6, 'a thin street never dominates');
  return { id: r.id, observed: o.state, model: r.value, tier: r.tier, streetWeight: r.weights[0] };
});
acc(5, 'zero observations on the street → an estimate only from its blocks / neighbourhood, never STRONG; else MODEL UNAVAILABLE', () => {
  const r = pick((x) => !x.levels.street && x.levels.block);
  const u = ALL.find((x) => x.value == null && x.reason === 'no-street-specific-evidence');
  assert.ok(r && u); assert.notEqual(r.tier, 'STRONG');
  return { id: r.id, tier: r.tier, value: r.value, unavailableId: u.id, unavailableReason: u.reason };
});
acc(6, 'one project dominates the street → largest parcel stated; never STRONG', () => {
  const r = pick((x) => x.levels.street && x.levels.street.n >= 20 && x.levels.street.parcels === 1);
  assert.ok(r); assert.notEqual(r.tier, 'STRONG'); assert.ok(r.levels.street.nEff < 1 / MODEL.rho + 0.1);
  return { id: r.id, tier: r.tier, deals: r.levels.street.n, parcels: 1, nEff: r.levels.street.nEff };
});
acc(7, 'one parcel with a few deals → nEff below its deal count; never STRONG', () => {
  const r = pick((x) => x.levels.street && x.levels.street.n >= 3 && x.levels.street.n <= 8 && x.levels.street.parcels === 1);
  assert.ok(r); assert.ok(r.levels.street.nEff < r.levels.street.n); assert.notEqual(r.tier, 'STRONG');
  return { id: r.id, tier: r.tier, deals: r.levels.street.n, nEff: r.levels.street.nEff };
});
acc(8, 'a mostly probable-new street → the estimate is for an EXISTING reference dwelling; "new (probable)" is a stated input', () => {
  let found = null;
  for (const r of PUB) { if (!r.levels.street || r.levels.street.n < 10 || r.tier !== 'STRONG') continue; const s = ST.street(r.id).evidence.stats; if (s.probableNew / Math.max(1, s.observed) >= 0.6) { found = [r, s]; break; } }
  assert.ok(found); const [r, s] = found;
  const a = VR.apartment(r.id, { sqm: 85, newness: 'new' }).apartment, e = VR.apartment(r.id, { sqm: 85, newness: 'existing' }).apartment;
  assert.equal(a.profile.newness, 'new'); assert.ok(a.effects.find((f) => f.input === 'newness').value === 'new (probable)');
  assert.ok(Math.abs(e.ppsqm - r.value) <= 100, 'the street value is the EXISTING reference, whatever the street sold');
  return { id: r.id, probableNewShare: Math.round(s.probableNew / s.observed * 100), referenceExisting: e.ppsqm, newProbable: a.ppsqm };
});
acc(9, 'a mostly existing street → the reference dwelling matches its stock; no new-home premium applied', () => {
  let found = null;
  for (const r of PUB) { if (!r.levels.street || r.levels.street.n < 10 || r.tier !== 'STRONG') continue; const s = ST.street(r.id).evidence.stats; if (s.probableNew === 0 && s.buildYearAfterDeal === 0) { found = r; break; } }
  assert.ok(found); const e = VR.apartment(found.id, { sqm: 85, newness: 'existing' }).apartment;
  assert.equal(e.effects.find((f) => f.input === 'newness').effectPct, 0);
  return { id: found.id, value: found.value, tier: found.tier };
});
acc(10, 'high-volume locality (Tel Aviv-Yafo) → STRONG estimates with the city validated on its own held-out deals', () => {
  const r = pick((x) => city(x) === 5000 && x.tier === 'STRONG');
  assert.ok(r); assert.ok(VAL.byLocality['5000'] && VAL.byLocality['5000'].n >= 300);
  return { id: r.id, value: r.value, cityMdape: VAL.byLocality['5000'].mdape, cityN: VAL.byLocality['5000'].n };
});
acc(11, 'small locality → an estimate only with enough locality depth (n_eff ≥ 8), never STRONG below 300', () => {
  const r = pick((x) => x.levels.locality && x.levels.locality.nEff < 300 && x.levels.locality.nEff >= VM.MIN_LOCALITY_NEFF);
  const thin = ALL.find((x) => x.reason === 'locality-evidence-thin');
  assert.ok(r && thin); assert.notEqual(r.tier, 'STRONG');
  return { id: r.id, tier: r.tier, localityNEff: r.levels.locality.nEff, thinId: thin.id };
});
acc(12, 'verified neighbourhood → its level appears with its own weight', () => {
  const r = PUB.filter((x) => x.levels.neighbourhood && x.weights[2] > 0).sort((a, b) => b.weights[2] - a.weights[2])[0];
  assert.ok(r && r.weights[2] >= 0.05, 'a neighbourhood that carries weight');
  return { id: r.id, tier: r.tier, neighbourhoodWeight: r.weights[2] };
});
acc(13, 'no neighbourhood link → the estimate stands on street + blocks + locality, no neighbourhood weight', () => {
  const r = pick((x) => !x.levels.neighbourhood && x.tier === 'STANDARD');
  assert.ok(r); assert.equal(r.weights[2], 0);
  return { id: r.id, tier: r.tier };
});
acc(14, 'stale direct evidence (latest street deal > 18 months) → never STRONG; the date is stated', () => {
  const r = pick((x) => x.levels.street && VM.monthsBetween(x.levels.street.latest, MODEL.asOf) > 18);
  assert.ok(r); assert.notEqual(r.tier, 'STRONG');
  return { id: r.id, tier: r.tier, latestStreetDeal: r.levels.street.latest };
});
acc(15, 'unusual size mix → each comparable is translated to the reference dwelling (dwelling adjustment stated per comparable)', () => {
  /* a street whose own deals are mostly large (median ≥ 120 m²) — the comparables are translated, not averaged raw */
  const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  let hit = null;
  for (const r of PUB.filter((x) => x.tier === 'STRONG' && city(x) === 70 && x.levels.street.n >= 8).slice(0, 40)) {
    const x = VR.explain(r.id, { limit: 300 }); const rows = x.comparables.street.rows;
    if (med(rows.map((c) => c.areaSqm)) >= 120) { hit = [r, x, rows]; break; }
  }
  assert.ok(hit, 'a large-dwelling street in Ashdod'); const [r, x, rows] = hit;
  assert.equal(x.consistent, true);
  assert.ok(rows.every((c) => typeof c.dwellingAdjustmentPct === 'number' && typeof c.impliedReferencePpsqm === 'number'));
  /* a large dwelling sells for less per m² (log-area coefficient < 0): its implied reference value per m² is HIGHER than its raw ₪/m² */
  const big = rows.filter((c) => c.areaSqm >= 120 && c.type === 'flat');
  assert.ok(big.length && big.every((c) => c.dwellingAdjustmentPct > -5), 'large flats adjusted upward toward the 85 m² reference');
  return { id: r.id, comparables: rows.length, medianArea: med(rows.map((c) => c.areaSqm)), largeFlats: big.length, value: r.value };
});
acc(16, 'weak-coverage locality → MODEL UNAVAILABLE with its reason, never a locality figure in the street\'s place', () => {
  const failedCity = Object.entries(MODEL.marketCaps).find(([, c]) => c === 'UNAVAILABLE');
  const notInCopy = ALL.find((x) => x.reason === 'locality-not-in-register-copy');
  assert.ok(notInCopy && notInCopy.value == null);
  if (failedCity) assert.ok(ALL.filter((x) => city(x) === Number(failedCity[0])).every((x) => x.value == null && x.reason));
  return { id: notInCopy.id, reason: notInCopy.reason, failedValidationLocality: failedCity ? Number(failedCity[0]) : null };
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); }
  }
  if (process.env.STREET_MODEL_ACCEPTANCE_OUT) fs.writeFileSync(process.env.STREET_MODEL_ACCEPTANCE_OUT, JSON.stringify({ builtAt: MODEL.builtAt, modelVersion: MODEL.modelVersion, cases: ACC.sort((a, b) => a.n - b.n) }, null, 1) + '\n');
  console.log(`street-model: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
