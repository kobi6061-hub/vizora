// PROPX · capital module — offline behavioural tests.
// `node test/capital.test.js`
//
// The capital model ("where should I deploy my capital?") runs here on the
// real board data, outside the page: its engine block plus the pieces of the
// page it reads (LOCATIONS, LOC, cityOf, childrenOf, vcOf) and the deal
// calculator's engine. The gates: capital is EQUITY (leverage, debt, purchase
// tax and costs accounted for), every return is a true IRR from calcEngine /
// calcIrr, appreciation is the investor's explicit assumption (no curve, no
// history), rankings ignore capital size, data basis comes from the value
// classes (never the old o-flags), and no policy constant is hidden.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const block = (a, b) => {
  const i = INDEX.indexOf(a), j = INDEX.indexOf(b);
  assert.ok(i >= 0 && j > i, `markers ${a} … ${b} missing`);
  return INDEX.slice(INDEX.indexOf('\n', i) + 1, j);
};
/* a brace-matched literal or function body starting at the last char of `anchor` */
const matched = (anchor, from = 0) => {
  const i = INDEX.indexOf(anchor, from);
  assert.ok(i >= 0, 'missing ' + anchor);
  const open = INDEX.indexOf(anchor.endsWith('[') ? '[' : '{', i + anchor.length - 1);
  const close = { '{': '}', '[': ']' }[INDEX[open]];
  let depth = 0;
  for (let k = open; k < INDEX.length; k++) {
    if (INDEX[k] === INDEX[open]) depth++;
    else if (INDEX[k] === close && --depth === 0) return INDEX.slice(i, k + 1);
  }
  throw new Error('unbalanced ' + anchor);
};
const line = (re) => { const m = re.exec(INDEX); assert.ok(m, 'missing ' + re); return m[0]; };

const CALC = block('/* @calc-engine:start', '/* @calc-engine:end */');
const CI = block('/* @ci-engine:start', '/* @ci-engine:end */');
const SRC = [
  matched('const LOCATIONS = [') + ';',
  'const LOC = Object.fromEntries(LOCATIONS.map(l=>[l.id,l]));',
  line(/const childrenOf=id=>[^\n]*\n/),
  line(/const cityOf=l=>\{[^\n]*\n/),
  matched('const STATIC_SRC={') + ';',
  line(/const isStatic=\(l,f\)=>\{[^\n]*\n/),
  matched('function vcOf('),
  CALC, CI,
  ';({ciRank,ciEval,ciPortfolio,ciInvest,ciReturnTarget,ciScen,ciDeal,ciDealIn,ciAppRates,ciEqK,ciBasis,ciUniverse,' +
  'ciCapacityUnits,CI_INV,CI_ASSUME,CI_CAPS,CI_STRATS,CI_H,CI_LIM,calcEngine,calcIrr,LOC,LOCATIONS,cityOf,' +
  'reset:()=>{CI_FCACHE=null}})',
].join('\n');
const DEFAULT_CI = { h: '5', strat: 'bal', ltv: 60, rate: 4.9, term: 25, cap: 25e6, sel: null, w: null, app: 2, appDn: 2, appUp: 2 };
const ctx = { state: { ci: { ...DEFAULT_CI } }, MKT: { nh: null, boi: null }, filtersActive: () => false };
const M = vm.runInNewContext(SRC, ctx);
const ci = ctx.state.ci;
const resetState = () => { Object.assign(ci, DEFAULT_CI); M.reset(); };
const POLICY0 = JSON.stringify(M.CI_INV), ASSUME0 = JSON.stringify(M.CI_ASSUME);
const resetPolicy = () => {
  Object.assign(M.CI_INV, JSON.parse(POLICY0));
  Object.assign(M.CI_ASSUME, JSON.parse(ASSUME0));
  M.reset();
};

let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
  finally { resetState(); resetPolicy(); }
};
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const STRATS = ['cash', 'bal', 'va', 'growth', 'cons'], HORIZONS = ['3', '5', '10'], LTVS = [0, 50, 60, 70];

console.log('model — sources');
t('no approximate curve, no generated history, no historical o-flag in the capital model', () => {
  assert.ok(!/NATIONAL_CURVE|localCurve|seriesFor|cagr10|natCagr/.test(INDEX), 'the approximate curve is back in the page');
  const cap = block('CAPITAL INTELLIGENCE — investment engine + UI', 'national geography (canonical registry)');
  assert.ok(!/\bl\.o\b|\.o\|\||\boffT\b|\boffL\b|\bciConf\b|conf\.pct|minConf/.test(cap), 'o-flags or the old confidence are back');
});
t('data basis is the value classes of the unfiltered inputs (vcOf), not a statistic', () => {
  for (const l of M.ciUniverse()) {
    const b = M.ciBasis(l);
    assert.equal(b.n, 8);
    if (l.type === 'nbhd' || l.type === 'sub') { assert.equal(b.src, 0, l.id + ' neighbourhood claims a source'); assert.equal(b.lvl, 'l'); }
    if (l.type === 'city' && !l.e) assert.ok(b.src >= 5, l.id + ' derived city with a thin basis');
    assert.equal(b.cls.rent, 'mod', 'rent is a model (×1.08 premium)');
  }
  // an estimate city keeps its historical o-flag but gains nothing from it
  const ofakim = M.LOC.ofakim;
  assert.ok(ofakim.e && /t/.test(ofakim.o || ''), 'fixture assumption: Ofakim is an estimate row with an o-flag');
  assert.equal(M.ciBasis(ofakim).cls.price, 'mod');
  assert.equal(M.ciBasis(ofakim).cls.tx, 'mod');
});

console.log('model — ranking');
t('the ranking ignores capital size and the appreciation assumption', () => {
  const order = () => M.ciRank('5', 'bal').map((r) => r.id).join();
  const base = order();
  for (const cap of M.CI_CAPS) { ci.cap = cap; assert.equal(order(), base, 'changed with capital ' + cap); }
  ci.cap = 25e6;
  for (const app of [-5, 0, 6]) { ci.app = app; assert.equal(order(), base, 'changed with appreciation ' + app); }
});
t('scores stay in 0–100 and follow the strategy weights', () => {
  for (const s of STRATS) for (const h of HORIZONS) {
    for (const r of M.ciRank(h, s)) {
      assert.ok(r.ev.score >= 0 && r.ev.score <= 100, `${r.id} ${s}/${h} = ${r.ev.score}`);
      for (const [k, v] of Object.entries(r.ev.sub)) assert.ok(v >= 0 && v <= 100, `${r.id}.${k} = ${v}`);
    }
  }
  ci.w = { cf: 50, ap: 0, va: 0, lq: 0, dm: 0, rk: 0 };   // cash flow only
  const top = M.ciRank('5', 'bal')[0].ev;
  assert.ok(top.sub.cf >= 90, 'a cash-flow-only weighting must put a top-yield area first');
});

console.log('model — appreciation is the investor\'s explicit assumption');
t('conservative / base / upside = base − spread / base / base + spread', () => {
  Object.assign(ci, { app: 1.5, appDn: 2.5, appUp: 1 });
  assert.deepEqual({ ...M.ciAppRates() }, { cons: -1, base: 1.5, up: 2.5 });
});
t('the exit value grows at exactly the assumed rate — and 0% means no growth', () => {
  const f = M.ciEval('beer-sheva', '5', 'bal').f;
  ci.app = 0; ci.appDn = 0; ci.appUp = 0;
  assert.equal(M.ciDeal(f, { scen: 'base' }).out.exitV.v, f.price);
  ci.app = 3;
  near(M.ciDeal(f, { scen: 'base' }).out.exitV.v, f.price * 1.03 ** 5, 1e-6, 'exit value');
  ci.appDn = 2; ci.appUp = 2;
  const S = M.ciScen(f);
  assert.ok(S.cons.irr < S.base.irr && S.base.irr < S.up.irr, 'IRR not ordered by scenario');
});

console.log('model — returns are true IRRs from the deal calculator engine');
t('a unit\'s deal is calcEngine on the area\'s inputs at the selected leverage', () => {
  const f = M.ciEval('rehovot', '5', 'bal').f, A = M.CI_ASSUME;
  const cost = f.price * (1 + (A.tax + A.fees) / 100);
  const hand = M.calcEngine({ price: f.price, equity: cost - f.price * 0.6, tax: A.tax, fees: A.fees, rate: 4.9, term: 25,
    rent: f.rent, vac: A.vac, opex: A.opex + A.capex, hold: 5, rentG: f.rentG, app: 2, sell: A.sell });
  const deal = M.ciDeal(f, { scen: 'base' });
  for (const k of ['loan', 'pmt', 'cf', 'exitEq', 'profit', 'irr']) near(deal.out[k].v, hand.out[k].v, 1e-9, k);
  near(deal.out.loan.v, f.price * 0.6, 1e-6, 'loan = price × LTV');
  near(M.calcIrr(deal.flows), deal.out.irr.v, 1e-12, 'flows → IRR');
});
t('the required-return price is where the levered IRR meets the policy (exit anchored to the board price)', () => {
  for (const id of ['beer-sheva', 'ashkelon', 'tlv', 'jerusalem']) {
    const f = M.ciEval(id, '5', 'bal').f, rt = M.ciReturnTarget(f);
    const exitAt = f.price * Math.pow(1 + M.ciAppRates().base / 100, 5);
    const irrAt = (P) => M.ciDeal(f, { price: P, app: (Math.pow(exitAt / P, 1 / 5) - 1) * 100 }).out.irr.v;
    near(rt.atMkt, M.ciDeal(f, { scen: 'base' }).out.irr.v, 1e-9, id + ' IRR at the board price');
    if (rt.p == null || rt.above) continue;
    assert.ok(irrAt(rt.p) >= M.CI_INV.reqIRR - 1e-9, `${id}: IRR at ${rt.p} below the requirement`);
    assert.ok(irrAt(rt.p + 1000) < M.CI_INV.reqIRR, `${id}: a higher price still meets it`);
  }
});

console.log('portfolio — equity accounting');
t('equity used + unused + reserve = the capital; used = value − debt + tax and costs', () => {
  for (const cap of M.CI_CAPS) for (const ltv of LTVS) for (const s of STRATS) for (const h of HORIZONS) {
    Object.assign(ci, { cap, ltv, strat: s, h });
    const P = M.ciPortfolio(h, s), tag = `${cap / 1e6}M/${ltv}%/${s}/${h}y`;
    const k = M.ciEqK(), costR = (M.CI_ASSUME.tax + M.CI_ASSUME.fees) / 100;
    near(P.reserve, cap * M.CI_INV.reserve[s] / 100, 1e-6, tag + ' reserve');
    assert.ok(P.used <= P.target + 1e-6, tag + ' over-deployed');
    near(P.used + P.unused + P.reserve, cap, 1e-3, tag + ' capital does not add up');
    near(P.pos.reduce((a, p) => a + p.eq, 0), P.used, 1e-3, tag + ' positions vs equity used');
    near(P.value - P.debt + P.costs, P.used, 1e-3, tag + ' value − debt + costs ≠ equity');
    near(P.debt, P.value * ltv / 100, 1e-3, tag + ' debt');
    near(P.costs, P.value * costR, 1e-3, tag + ' costs');
    for (const p of P.pos) {
      assert.ok(Number.isInteger(p.units) && p.units >= 1, tag + ' fractional unit');
      near(p.eq, p.units * p.f.price * k, 1e-3, tag + ' equity per unit');
      assert.ok(p.units <= M.ciCapacityUnits(p.f), tag + ' over capacity in ' + p.id);
      assert.ok(p.ev.basis.src >= M.CI_INV.minBasis, tag + ' allocated to a thin-basis area ' + p.id);
    }
    assert.ok(P.pos.length <= M.CI_INV.pool, tag + ' more areas than the pool');
    if (P.pos.length) near(-P.flows.base[0], P.used, 1e-3, tag + ' year-0 flow ≠ equity used');
  }
});
t('diversification caps hold (a first unit may exceed a cap only when one unit is larger than it)', () => {
  for (const cap of M.CI_CAPS) for (const ltv of LTVS) for (const s of STRATS) {
    Object.assign(ci, { cap, ltv, strat: s });
    const P = M.ciPortfolio('5', s), tag = `${cap / 1e6}M/${ltv}%/${s}`;
    for (const [cid, eq] of Object.entries(P.byCity)) {
      const biggest = Math.max(...P.pos.filter((p) => p.cid === cid).map((p) => p.eq / p.units));
      assert.ok(eq <= Math.max(cap * M.CI_INV.capCity / 100, biggest) + 1e-3, `${tag}: city ${cid} at ${eq}`);
    }
    for (const p of P.pos.filter((x) => x.f.l.type !== 'city')) {
      assert.ok(p.eq <= Math.max(cap * M.CI_INV.capLoc / 100, p.eq / p.units) + 1e-3, `${tag}: area ${p.id} at ${p.eq}`);
    }
  }
});
t('leverage buys more property with the same equity; no leverage means no debt', () => {
  const at = (ltv) => { ci.ltv = ltv; return M.ciPortfolio('5', 'bal'); };
  const none = at(0), lev = at(60);
  assert.equal(none.debt, 0);
  near(none.used, none.value * (1 + (M.CI_ASSUME.tax + M.CI_ASSUME.fees) / 100), 1e-3, 'all-cash equity = value + costs');
  assert.ok(lev.value > none.value * 1.5, `60% LTV acquires ${lev.value} vs ${none.value} unlevered`);
});
t('the portfolio IRR is the IRR of the summed yearly flows, between the positions\' IRRs', () => {
  for (const cap of [5e6, 25e6, 100e6]) for (const h of HORIZONS) {
    Object.assign(ci, { cap, h });
    const P = M.ciPortfolio(h, 'bal');
    for (const s of ['cons', 'base', 'up']) {
      near(P.irr[s], M.calcIrr(P.flows[s]), 1e-12, `${cap}/${h}/${s}`);
      const own = P.pos.map((p) => M.ciDeal(p.f, { scen: s, hold: +h }).out.irr.v);
      assert.ok(P.irr[s] >= Math.min(...own) - 1e-6 && P.irr[s] <= Math.max(...own) + 1e-6, `${cap}/${h}/${s} outside its positions`);
    }
    assert.ok(P.irr.cons < P.irr.base && P.irr.base < P.irr.up);
  }
});
t('policy is live: the minimum data basis, reserve and caps change the allocation', () => {
  M.CI_INV.minBasis = 8;                                     // no area has 8 sourced inputs
  let P = M.ciPortfolio('5', 'bal');
  assert.equal(P.pos.length, 0); assert.equal(P.used, 0); near(P.unused, P.target, 1e-6, 'all deployable equity unused');
  M.CI_INV.minBasis = 0; M.CI_INV.pool = 30;                 // estimates allowed in
  P = M.ciPortfolio('5', 'bal');
  assert.ok(P.pos.some((p) => p.ev.basis.src === 0), 'a model-only area should now be eligible');
  resetPolicy();
  M.CI_INV.reserve.bal = 30;
  near(M.ciPortfolio('5', 'bal').reserve, 25e6 * 0.3, 1e-6, 'reserve edit');
});
t('eligible units that fit are always allocated — the first-unit cap exception holds in both passes', () => {
  for (const cap of M.CI_CAPS) for (const ltv of LTVS) for (const s of STRATS) for (const h of HORIZONS) {
    Object.assign(ci, { cap, ltv, strat: s, h });
    const P = M.ciPortfolio(h, s), tag = `${cap / 1e6}M/${ltv}%/${s}/${h}y`;
    if (P.pool > 0) assert.ok(P.pos.length >= 1, tag + ': eligible units fit, yet nothing was allocated');
    assert.equal(P.blocked, P.pos.length ? null : P.pool ? 'caps' : 'pool', tag + ' blocking rule');
  }
  Object.assign(ci, { cap: 5e6, ltv: 0 });
  assert.ok(M.ciPortfolio('5', 'bal').pos.length >= 1, '₪5M without leverage allocates nothing');
});
t('rent growth is an explicit assumption: empty = each area\'s own last 1-year change, a number = that rate everywhere', () => {
  const f = M.ciRank('5', 'bal').find((r) => r.ev.f.rentG > 0).ev.f;
  assert.equal(M.CI_ASSUME.rentG, null, 'the preset keeps the board behaviour');
  assert.equal(M.ciDealIn(f, {}).rentG, f.rentG);
  const board = M.ciDeal(f, { scen: 'base' }).out.irr.v;
  M.CI_ASSUME.rentG = 0;
  assert.equal(M.ciDealIn(f, {}).rentG, 0);
  assert.ok(M.ciDeal(f, { scen: 'base' }).out.irr.v < board, 'no rent growth must lower the IRR of a growing area');
  assert.deepEqual(M.CI_LIM.rentG.slice(0, 2), [-10, 15]);
});
t('purchase tax and fees are part of the equity per unit', () => {
  const k0 = M.ciEqK();
  M.CI_ASSUME.tax = 10;
  near(M.ciEqK() - k0, 0.02, 1e-12, 'two more points of tax');
});

console.log('page — no hidden constants, rankings labelled, outside surfaces off');
t('every policy rule and assumption has an input in the section', () => {
  const ui = block('/* @ci-engine:end */', 'national geography (canonical registry)');
  for (const k of Object.keys(M.CI_INV)) assert.ok(new RegExp(`"${k}"`).test(ui), 'no input for policy ' + k);
  for (const k of Object.keys(M.CI_ASSUME)) assert.ok(new RegExp(`"${k}"`).test(ui), 'no input for assumption ' + k);
  for (const id of ['ciAppB', 'ciAppDn', 'ciAppUp', 'ciRate', 'ciTerm']) assert.ok(ui.includes(`"${id}"`), 'no deck input ' + id);
  for (const k of Object.keys(M.CI_INV)) assert.ok(M.CI_LIM[k], 'no accepted range for ' + k);
});
t('the ranking carries the MODEL RANKING label in both languages', () => {
  assert.match(INDEX, /ciRankBadge:"דירוג מודל"/);
  assert.match(INDEX, /ciRankBadge:"MODEL RANKING"/);
  assert.match(INDEX, /<span class="ci-rankb">\$\{t\.ciRankBadge\}<\/span>/);
  assert.match(INDEX, /<div class="ci-rank-note" id="ciRankNote"><\/div>\s*<div id="ciList"><\/div>/);
});
t('no "model IRR" label and no confidence percentage anywhere', () => {
  assert.ok(!/IRR מודל|model IRR|ודאות מינ|Minimum confidence|confidence %/i.test(INDEX), 'an old label is back');
});
t('the deal calculator stays independent: capital calls it, never the reverse', () => {
  const calcUi = block('/* @calc-ui:start */', '/* @calc-ui:end */');
  assert.ok(!/\bci[A-Z]\w*|\bCI_[A-Z]+/.test(CALC + calcUi), 'the calculator reaches into the capital model');
  assert.ok(/calcEngine\(/.test(CI) && /calcIrr\(/.test(CI), 'the capital model no longer uses the calculator engine');
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
