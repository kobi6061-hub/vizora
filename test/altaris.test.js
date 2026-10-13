// ALTARIS · Capital Allocation Engine — calculation and isolation gates.
// `node test/altaris.test.js`
//
// The engine (altaris/engine.js) is pure: these tests run it directly. They pin
// the accounting identities (the BUY value bridge equals the cash-flow sum, MOIC
// = distributions ÷ invested, break-even and max-price solvers land on their
// targets), the FINANCE / HYBRID repayment waterfalls, scenario independence,
// explained risk and signal, and the module's isolation from PROPX.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../altaris/engine.js');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≉ ${b} (±${tol})`);
const TODAY = '2026-10-12';

const DEAL = () => ({
  name: 'בדיקה',
  info: { developer: 'יזם בדיקה', project: 'פרויקט בדיקה', city: 'חיפה', startDate: '2026-11-01', constructionStatus: 'construction', completionDate: '2027-06-01', developerRating: 'established' },
  units: [{ label: '1', rooms: 4, sqm: 96, supported: 3000000, proposed: 2250000 }, { label: '2', rooms: 3, sqm: 82, supported: 2550000, proposed: 1950000 }],
  value: { appraisal: { value: 5500000 }, chosen: 'units' },
});
const F0 = (deal) => A.facts(deal || DEAL(), TODAY);
const inp = (kind, deal) => A.resolve(kind, deal || DEAL(), F0(deal)).inputs;
const sumFlows = (r) => r.flows.reduce((s, f) => s + f.amount, 0);
const APP_SRC = fs.readFileSync(path.join(ROOT, 'altaris/app.js'), 'utf8');

console.log('altaris: primitives');
t('XIRR matches the Excel reference and returns null without a sign change', () => {
  const x = A.xirr([{ date: '2008-01-01', amount: -10000 }, { date: '2008-03-01', amount: 2750 }, { date: '2008-10-30', amount: 4250 }, { date: '2009-02-15', amount: 3250 }, { date: '2009-04-01', amount: 2750 }]);
  near(x, 0.373362535, 1e-7, 'xirr');
  near(A.xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]), 0.1, 1e-9);
  assert.equal(A.xirr([{ date: '2025-01-01', amount: 1000 }, { date: '2026-01-01', amount: 1100 }]), null);
});
t('month arithmetic keeps the day and clamps to the month end', () => {
  assert.equal(A.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(A.addMonths('2026-11-01', 18), '2028-05-01');
});

console.log('altaris: supported value');
t('the underwriting value is an explicit choice — never the developer price by default', () => {
  const d = DEAL(); d.value = { developer: { value: 6000000 } }; d.units.forEach((u) => delete u.supported);
  const F = A.facts(d, TODAY);
  assert.equal(F.smv, null); assert.equal(F.chosen, null);
  const R = A.run(d, {}, { today: TODAY });
  assert.equal(R.ready, false); assert.equal(R.signal.code, 'INCOMPLETE');
  assert.ok(!R.strategies.buy.base.ok && R.strategies.buy.base.missing.includes('smv'));
});
t('choosing the developer price is allowed but always flagged as a key risk', () => {
  const d = DEAL(); d.value = { developer: { value: 5550000 }, chosen: 'developer' };
  const R = A.run(d, {}, { today: TODAY });
  assert.equal(R.facts.smv, 5550000);
  assert.ok(R.ic.risks.some((x) => x.includes('מחיר המחירון של היזם')));
});
t('value, price, difference and entry discount are separate fields', () => {
  const F = F0();
  assert.equal(F.smv, 5550000); assert.equal(F.basis, 4200000); assert.equal(F.diff, 1350000);
  near(F.discount, 1350000 / 5550000, 1e-12); assert.equal(F.sqm, 178); assert.equal(F.unitsCount, 2);
});

console.log('altaris: BUY');
t('the value bridge is the true underwriting result and equals the cash-flow sum', () => {
  const d = DEAL();
  d.buy = { ltvPct: 50, ratePct: 7, mgmt: 2000, municipal: 1500, insurance: 500, rentOn: true, rent: 14000, capex: 120000, marketing: 30000, dd: 15000, vatPct: 0, profitTaxPct: 23 };
  const r = A.buyModel(F0(d), A.resolve('buy', d, F0(d)).inputs, A.SCEN_DEF.base);
  const steps = r.bridge.filter((x) => !x.total && !['profitTax'].includes(x.k));
  near(r.bridge[0].v + steps.reduce((s, x) => s + x.v, 0), r.profit, 0.01, 'bridge');
  near(r.bridgeCheck, r.profit, 0.01); near(sumFlows(r), r.profit, 0.01, 'flows');
  near(r.afterTax.profit, r.profit - r.profit * 0.23, 0.01);
  assert.ok(r.profit < r.bridge[0].v - r.price, 'profit is not "value − price"');
});
t('MOIC = distributions ÷ invested; capital required = the peak outflow', () => {
  const r = A.buyModel(F0(), inp('buy'), A.SCEN_DEF.base);
  const inv = r.flows.filter((f) => f.amount < 0).reduce((s, f) => s - f.amount, 0);
  const dis = r.flows.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  near(r.moic, dis / inv, 1e-12); near(r.peakCapital, 4200000 * 1.085, 0.01);
  near(r.irr, Math.pow(dis / inv, 12 / 18) - 1, 2e-3, 'two-flow IRR');
});
t('purchase tax and every tax is an editable input (defaults are labelled assumptions)', () => {
  const d = DEAL();
  const { defaulted } = A.resolve('buy', d, F0(d));
  for (const k of ['taxPct', 'vatPct', 'profitTaxPct', 'otherTax']) assert.ok(defaulted.includes(k), k + ' not reported as defaulted');
  d.buy = { taxPct: 0 }; const a = A.buyModel(F0(d), A.resolve('buy', d, F0(d)).inputs);
  d.buy = { taxPct: 5 }; const b = A.buyModel(F0(d), A.resolve('buy', d, F0(d)).inputs);
  near(a.profit - b.profit, 4200000 * 0.05, 0.01); assert.ok(!A.resolve('buy', d, F0(d)).defaulted.includes('taxPct'));
});
t('break-even exit zeroes the profit; the max price meets the IRR hurdle', () => {
  const d = DEAL(); d.buy = { ltvPct: 40 };
  const F = F0(d), i = A.resolve('buy', d, F).inputs;
  const r = A.buyModel(F, i);
  const be = A.buyModel(F, Object.assign({}, i, { exitMode: 'target', targetPrice: r.breakEvenExit }));
  near(be.profit, 0, 1, 'profit at break-even');
  near(r.maxHaircut, 1 - r.breakEvenExit / F.smv, 1e-12);
  const L = A.buyPriceLimits(F, i, 15);
  near(A.buyModel(F, Object.assign({}, i, { price: L.maxPrice })).irr, 0.15, 1e-4, 'irr at max price');
  near(A.buyModel(F, Object.assign({}, i, { price: L.zeroProfitPrice })).profit, 0, 50, 'profit at zero-profit price');
});
t('a loan that matures before the exit is repaid from equity and flagged', () => {
  const d = DEAL(); d.buy = { ltvPct: 50, loanTermMonths: 12, exitMonth: 18 };
  const r = A.buyModel(F0(d), A.resolve('buy', d, F0(d)).inputs);
  assert.ok(r.loanMaturesBeforeExit); assert.ok(r.flows[12].parts.debtRepay < 0);
  near(sumFlows(r), r.profit, 0.01);
});

console.log('altaris: FINANCE');
t('contractual income: interest, fees, MOIC and IRR from the cash flows', () => {
  const d = DEAL(); d.finance = { amount: 3000000, ratePct: 12, feePct: 1, exitFeePct: 0.5, termMonths: 12 };
  const r = A.financeModel(F0(d), A.resolve('finance', d, F0(d)).inputs);
  near(r.interest, 3000000 * 0.12, 0.01); near(r.feeIncome, 30000 + 15000, 0.01);
  near(r.profit, 360000 + 45000, 0.01);
  near(r.moic, (3000000 + 360000 + 15000) / (3000000 - 30000), 1e-12);
  assert.ok(r.irr > 0.12 && r.irr < 0.15);
});
t('LTV, coverage, equity cushion and break-even collateral follow their stated formulas', () => {
  const d = DEAL(); d.finance = { amount: 3000000, priorLiens: 500000, haircutPct: 20, enforcementCostPct: 5, exitFeePct: 0 };
  const r = A.financeModel(F0(d), A.resolve('finance', d, F0(d)).inputs);
  const V = 5550000;
  near(r.ltv, 3500000 / V, 1e-12);
  near(r.coverage, (V * 0.8 - 500000) / 3000000, 1e-12);
  near(r.equityCushion, V - 500000 - 3000000, 0.01);
  near(r.breakEvenCollateral, 3500000 / (0.8 * 0.95), 0.01);
  near(r.maxDecline, 1 - r.breakEvenCollateral / V, 1e-12);
});
t('a performing loan is repaid in full until the collateral cannot cover the claim', () => {
  const d = DEAL(); d.finance = { amount: 3000000, exitFeePct: 0, saleCostPct: 0 };
  const F = F0(d), i = A.resolve('finance', d, F).inputs;
  const ok = A.financeModel(F, i, Object.assign({}, A.SCEN_DEF.base, { valueShock: -20 }));
  assert.equal(ok.shortfall, 0);
  const bad = A.financeModel(F, i, Object.assign({}, A.SCEN_DEF.base, { valueShock: -50 }));
  near(bad.shortfall, 3000000 - 5550000 * 0.5, 0.01, 'shortfall = claim − proceeds');
});
t('default: recovery = min(claim grown to recovery, V·(1−haircut)·(1−costs) − prior liens) after enforcement', () => {
  const d = DEAL(); d.finance = { amount: 3000000, ratePct: 12, termMonths: 12, haircutPct: 15, enforcementCostPct: 7, enforcementMonths: 12, exitFeePct: 0 };
  const F = F0(d), i = A.resolve('finance', d, F).inputs;
  const r = A.financeModel(F, i, Object.assign({}, A.SCEN_DEF.base, { default: true, valueShock: -30 }));
  const claimD = 3000000 + 3000000 * 0.01;   // the defaulted month's interest is missed
  near(r.recovery.claimAtDefault, claimD, 0.01);
  near(r.recovery.claim, claimD * Math.pow(1.01, 12), 0.01);
  near(r.recovery.proceeds, 5550000 * 0.7 * 0.85 * 0.93, 0.01);
  near(r.recovery.recovered, Math.min(r.recovery.claim, r.recovery.proceeds), 0.01);
  assert.equal(r.months, 24);
});
t('a debt-cost stress leaves the fixed contractual coupon unchanged', () => {
  const R = A.run(DEAL(), {}, { today: TODAY });
  const f = R.strategies.finance;
  near(f.stress.r2.irr, f.base.irr, 1e-12);
});

console.log('altaris: HYBRID');
t('waterfall: claim first, then participation above the threshold, limited by what remains', () => {
  const d = DEAL(); d.hybrid = { structure: 'secured-upside', capital: 3000000, couponPct: 0, prefPct: 10, participationPct: 25, threshold: 4200000, feePct: 0, termMonths: 12, saleCostPct: 0 };
  const F = F0(d), i = A.resolve('hybrid', d, F).inputs;
  const r = A.hybridModel(F, i);
  near(r.prefPaid, 3000000 * (Math.pow(1 + 0.1 / 12, 12) - 1), 0.01);
  near(r.participation, 0.25 * (5550000 - 4200000), 0.01);
  const low = A.hybridModel(F, i, Object.assign({}, A.SCEN_DEF.base, { valueShock: -30 }));
  assert.equal(low.participation, 0);
  const impaired = A.hybridModel(F, i, Object.assign({}, A.SCEN_DEF.base, { valueShock: -50 }));
  near(impaired.principalBack + impaired.prefPaid, 5550000 * 0.5, 0.01); assert.ok(impaired.shortfall > 0);
});
t('a purchase option is exercised only when the resale beats the option price', () => {
  const d = DEAL(); d.hybrid = { structure: 'finance-option', capital: 3000000, optionPrice: 4200000, resaleHaircutPct: 0, resaleCostPct: 0 };
  const F = F0(d), i = A.resolve('hybrid', d, F).inputs;
  const up = A.hybridModel(F, i); assert.ok(up.optionExercised); near(up.optionResale - up.optionPaid, 1350000, 0.01);
  const dn = A.hybridModel(F, i, Object.assign({}, A.SCEN_DEF.base, { valueShock: -30 })); assert.ok(!dn.optionExercised);
});
t('a backstop earns its fee when inventory sells, and buys the unsold share when it does not', () => {
  const d = DEAL(); d.hybrid = { structure: 'backstop', backstopPrice: 4000000, feePct: 2 };
  const F = F0(d), i = A.resolve('hybrid', d, F).inputs;
  const base = A.hybridModel(F, i);
  near(base.profit, 4000000 * 0.02, 0.01); assert.equal(base.backstopPaid, 0);
  const dn = A.hybridModel(F, i, Object.assign({}, A.SCEN_DEF.base, { backstopUnsoldPct: 50 }));
  near(dn.backstopPaid, 2000000, 0.01); assert.ok(dn.backstopResale > 0);
  assert.equal(base.maxAtRisk, 4000000);
});

console.log('altaris: scenarios, risk, signal');
const R0 = A.run(DEAL(), {}, { today: TODAY });
t('scenarios change assumptions independently; the base is the deal as entered', () => {
  const d = DEAL(); d.scen = { downside: { valueShock: -40 } };
  const R = A.run(d, {}, { today: TODAY });
  near(R.strategies.buy.base.profit, R0.strategies.buy.base.profit, 1e-9);
  assert.ok(R.strategies.buy.downside.profit < R0.strategies.buy.downside.profit);
  near(R.strategies.buy.upside.profit, R0.strategies.buy.upside.profit, 1e-9);
});
t('stress presets: deeper exit-value shocks never improve the BUY return', () => {
  const s = R0.strategies.buy.stress;
  assert.ok(s.v5.irr >= s.v10.irr && s.v10.irr >= s.v15.irr && s.v15.irr >= s.v20.irr);
  assert.ok(s.d12.irr <= s.d6.irr && s.d6.irr <= R0.strategies.buy.base.irr);
});
t('downside attribution walks from the base to the downside result', () => {
  for (const k of A.STRATS) {
    const a = R0.strategies[k].attribution;
    near(a.base + a.steps.reduce((s, x) => s + x.v, 0), R0.strategies[k].downside.profit, 0.01, k);
  }
});
t('risk score: eight explained components, overall = their weighted mean', () => {
  for (const k of A.STRATS) {
    const r = R0.strategies[k].risk;
    assert.deepEqual(r.components.map((c) => c.k), ['entry', 'collateral', 'liquidity', 'duration', 'developer', 'project', 'concentration', 'protection']);
    for (const c of r.components) { assert.ok(c.why && c.why.length > 8, k + '.' + c.k + ' has no explanation'); assert.ok(c.score >= 0 && c.score <= 100); }
    near(r.overall, Math.round(r.components.reduce((s, c) => s + c.score, 0) / 8), 0.5);
  }
  const R = A.run(DEAL(), { weights: { entry: 5 } }, { today: TODAY });
  const c = R.strategies.buy.risk.components;
  near(R.strategies.buy.risk.overall, Math.round(c.reduce((s, x) => s + x.score * (x.k === 'entry' ? 5 : 1), 0) / 12), 0.5);
});
t('hurdles come from the fund settings', () => {
  const lo = A.run(DEAL(), { minIrr: 1 }, { today: TODAY }), hi = A.run(DEAL(), { minIrr: 60 }, { today: TODAY });
  assert.ok(lo.strategies.buy.hurdles.find((h) => h.k === 'irr').pass);
  assert.ok(!hi.strategies.buy.hurdles.find((h) => h.k === 'irr').pass);
});
t('the structure signal is one of five codes and always explains why', () => {
  const codes = ['STRONG BUY', 'PREFER FINANCE', 'PREFER HYBRID', 'REVIEW', 'DO NOT PROCEED'];
  for (const s of [{}, { minIrr: 60 }, { minIrr: 1, minMoic: 1, minDiscount: 0, minMos: 0, minCoverage: 0 }, { minIrr: 14 }]) {
    const R = A.run(DEAL(), s, { today: TODAY });
    assert.ok(codes.includes(R.signal.code), R.signal.code);
    assert.ok(R.signal.why.length >= 2 && R.signal.why.every((w) => w.length > 20));
    if (R.signal.code.startsWith('PREFER') || R.signal.code === 'STRONG BUY') {
      assert.ok(R.signal.why[0].includes(A.LABEL[R.signal.strategy].en));
      assert.ok(R.strategies[R.signal.strategy].hurdles.every((h) => h.pass), 'a preferred structure passes every hurdle');
    }
  }
  assert.equal(A.run(DEAL(), { minIrr: 60 }, { today: TODAY }).signal.code === 'DO NOT PROCEED' || A.run(DEAL(), { minIrr: 60 }, { today: TODAY }).signal.code === 'REVIEW', true);
});
t('IC snapshot: 3–5 reasons drawn from the calculations, and the key risks', () => {
  assert.ok(R0.ic.why.length >= 3 && R0.ic.why.length <= 5);
  assert.ok(R0.ic.why.every((w) => w.startsWith('+ ')));
  assert.ok(R0.ic.risks.length >= 1);
});
t('capital velocity: cycles over the fund life, AUM held vs cumulative deployed', () => {
  const v = R0.strategies.finance.velocity;
  assert.equal(v.cycles, Math.floor((60 + 2) / (12 + 2)));
  near(v.cumulativeFlat, v.capital * v.cycles, 0.01); near(v.turnsPerYear, 1, 1e-12);
});

console.log('altaris: review regressions');
const base0 = (o) => Object.assign({}, A.SCEN_DEF.base, o || {});
t('BUY debt is capped at the price, so IRR and profit never disagree in sign', () => {
  const d = DEAL(); d.buy = { debtMode: 'amount', debtAmount: 6e6 };
  const F = F0(d), i = A.resolve('buy', d, F).inputs;
  for (const sc of [base0(), A.scenario(d, 'downside'), A.scenario(d, 'upside')]) {
    const r = A.buyModel(F, i, sc);
    assert.ok(r.flows[0].amount <= 0, 'month 0 is an outflow'); assert.equal(r.debt, 4200000); assert.ok(r.debtCapped);
    assert.ok(Math.sign(r.profit) === Math.sign(r.irr) || Math.abs(r.profit) < 1, `profit ${r.profit} vs IRR ${r.irr}`);
  }
});
t('FINANCE: interest capitalised in the grace period keeps earning interest', () => {
  const d = DEAL(); d.finance = { amount: 3e6, ratePct: 12, termMonths: 12, graceMonths: 6, feePct: 0, exitFeePct: 0 };
  const r = A.financeModel(F0(d), A.resolve('finance', d, F0(d)).inputs);
  let acc = 0; for (let m = 1; m <= 6; m++) acc += (3e6 + acc) * 0.01;
  near(r.interest, acc + 6 * (3e6 + acc) * 0.01, 0.01);
  near(r.profit, r.interest, 0.01);
});
t('a default with nothing recovered still ends at the recovery month', () => {
  const d = DEAL(); d.finance = { amount: 3e6, priorLiens: 6e6 };
  const r = A.financeModel(F0(d), A.resolve('finance', d, F0(d)).inputs, base0({ default: true }));
  assert.equal(r.recovery.recovered, 0); assert.equal(r.months, r.recovery.recoveryMonth);
  near(r.distributions, r.interest - 3e6 * 0.11 / 12, 0.01, 'only the interest paid before the default comes back');
  assert.ok(r.irr < -0.9, 'near-total loss');
});
t('an extension rate of 0% is applied as 0%', () => {
  const d = DEAL(); d.finance = { amount: 3e6, ratePct: 12, termMonths: 12, extRatePct: 0, extMonths: 6, extFeePct: 0, exitFeePct: 0, feePct: 0 };
  const F = F0(d), i = A.resolve('finance', d, F).inputs;
  near(A.financeModel(F, i, base0({ delay: 6 })).interest, A.financeModel(F, i).interest, 0.01);
});
t('HYBRID: option and backstop never resell the same inventory twice', () => {
  const d = DEAL(); d.hybrid = { structure: 'finance-option', capital: 3e6, optionPrice: 2.5e6, optionSharePct: 60, backstopOn: true, backstopPrice: 3e6, resaleHaircutPct: 0, resaleCostPct: 0 };
  const F = F0(d), i = A.resolve('hybrid', d, F).inputs;
  const r = A.hybridModel(F, i, base0({ backstopUnsoldPct: 50 }));
  assert.ok(r.optionExercised);
  near(r.optionResale, 5550000 * 0.6, 0.01); near(r.backstopResale, 5550000 * 0.4 * 0.5, 0.01);
  near(r.backstopPaid, 3e6 * 0.4 * 0.5, 0.01);
  assert.ok(r.optionResale + r.backstopResale <= 5550000 + 0.01, 'more inventory resold than exists');
});
t('HYBRID capital at risk includes the option price, the backstop and the actual peak', () => {
  const d = DEAL(); d.hybrid = { structure: 'inventory-option' };
  const F = F0(d), i = A.resolve('hybrid', d, F).inputs, r = A.hybridModel(F, i);
  assert.ok(r.maxAtRisk >= r.peakCapital - 0.01 && r.maxAtRisk >= i.capital + i.optionPrice - 0.01, `${r.maxAtRisk} vs peak ${r.peakCapital}`);
  assert.equal(A.capOf(r), r.maxAtRisk);
});
t('a fee-only backstop is measured on its commitment: no −100% IRR, exposure counts the commitment', () => {
  const d = DEAL(); d.hybrid = { structure: 'backstop', backstopPrice: 4e6 };
  const R = A.run(d, { fundSize: 1e7 }, { today: TODAY }), h = R.strategies.hybrid, b = h.base;
  assert.equal(b.irr, null); assert.ok(b.irrCommit > 0 && A.irrOf(b) === b.irrCommit);
  near(A.moicOf(b), 1 + b.profit / b.maxAtRisk, 1e-12);
  assert.ok(R.signal.ranking.find((x) => x.k === 'hybrid').bIrr > 0, 'ranked as a loss');
  near(h.hurdles.find((x) => x.k === 'devExposure').value, 4e6 / 1e7, 1e-9);
  const P = A.portfolio([{ id: 'x', deal: Object.assign(d, { selected: 'hybrid' }), status: 'active' }], { fundSize: 1e7 }, { today: TODAY });
  assert.equal(P.rows[0].capital, b.maxAtRisk);
});
t('PROPX-derived values follow the current area until the user overrides them', () => {
  const d = DEAL(); d.value = { propx: { psm: 20000, auto: true, value: 1 }, comparables: { psm: 21000, auto: false, value: 3.3e6 }, chosen: 'propx' };
  near(A.facts(d, TODAY).sources.propx, 20000 * 178, 1e-6);
  d.units[0].sqm = 106;
  near(A.facts(d, TODAY).sources.propx, 20000 * 188, 1e-6);
  assert.equal(A.facts(d, TODAY).sources.comparables, 3.3e6, 'an edited value stays as edited');
});
t('portfolio rows are judged with the other deals as concentration context, like the deal page', () => {
  const st = { minIrr: 5, minMoic: 1, minDiscount: 0, minMos: 0, minCoverage: 0, maxLtv: 100, fundSize: 3e7 };
  const a = DEAL(), b = DEAL();
  const P = A.portfolio([{ id: 'a', deal: a, status: 'active' }, { id: 'b', deal: b, status: 'active' }], st, { today: TODAY });
  const other = P.rows.find((r) => r.id === 'b');
  const page = A.run(a, st, { today: TODAY, portfolio: [{ id: 'b', developer: other.developer, project: other.project, city: other.city, capital: other.capital }] });
  assert.equal(P.rows.find((r) => r.id === 'a').signal, page.signal.code);
});
t('the tax note is a BUY risk only; every memo names its exit dependency', () => {
  const R = A.run(DEAL(), {}, { today: TODAY });
  for (const k of ['finance', 'hybrid']) {
    const ic = A.icOf(R.strategies, R.facts, R.signal, Object.assign(DEAL(), { selected: k }), R.settings);
    assert.ok(!ic.risks.some((x) => x.includes('הנחות מס')), k + ' lists a tax note'); assert.ok(ic.risks.some((x) => x.startsWith('התשואה תלויה ב')));
  }
});
t('page: the structure to execute survives reload / open / import; a late market reply never lands in another deal', () => {
  assert.match(APP_SRC, /if \(k === 'selected'\) continue;/);
  assert.match(APP_SRC, /if \(!E\.STRATS\.includes\(d\.selected\)\) d\.selected = null;/);
  assert.match(APP_SRC, /const target = S\.deal;[\s\S]*?if \(S\.deal !== target\)/);
  assert.match(APP_SRC, /note: 'עותק העבודה מהקובץ'/);
});

console.log('altaris: portfolio');
t('capital-weighted IRR, exposures and expected liquidity', () => {
  const a = DEAL(), b = DEAL(); b.info = Object.assign({}, b.info, { developer: 'יזם אחר', city: 'באר שבע' }); b.selected = 'finance'; a.selected = 'buy';
  const P = A.portfolio([{ id: 'a', deal: a, status: 'active' }, { id: 'b', deal: b, status: 'active' }, { id: 'c', deal: DEAL(), archived: true }], {}, { today: TODAY });
  assert.equal(P.rows.length, 2);
  const [ra, rb] = P.rows;
  near(P.summary.capital, ra.capital + rb.capital, 0.01);
  near(P.summary.irr, (ra.irr * ra.capital + rb.irr * rb.capital) / (ra.capital + rb.capital), 1e-12);
  near(P.summary.byStrategy.reduce((s, x) => s + x.share, 0), 1, 1e-12);
  assert.ok(P.summary.liquidity.m12 >= P.summary.liquidity.m6 && P.summary.liquidity.m6 >= P.summary.liquidity.m3);
});

console.log('altaris: isolation from PROPX');
const SRC = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
t('the engine is pure: no randomness, network, DOM or storage', () => {
  const s = SRC('altaris/engine.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hit = /Math\.random|fetch\(|document\.|window\.|localStorage|XMLHttpRequest/.exec(s.replace(/root\.AltarisEngine/g, ''));
  assert.ok(!hit, 'engine touches ' + (hit && hit[0]));
});

t('index.html gains exactly one ALTARIS rail link — after Land, before Guide, outside the scroll-spy and i18n', () => {
  const idx = SRC('index.html'), L = idx.split('\n');
  const hits = L.map((l, i) => [l, i]).filter(([l]) => /altaris/i.test(l));
  assert.equal(hits.length, 1, 'ALTARIS appears on more than one line of index.html');
  const [line, i] = hits[0];
  assert.match(line, /^\s*<a href="\/altaris" class="ri" id="railAltaris"[^>]*>/);
  assert.ok(!/data-sec=|data-i=|onclick|<script/.test(line), 'the link must not join the scroll-spy, the i18n map or carry script');
  assert.match(L[i - 1], /href="#land" class="ri" data-sec="land"/); assert.match(L[i + 1], /href="#guide" class="ri" data-sec="guide"/);
  /* 14 PROPX items since the Developers & Projects section (#intel) — ALTARIS is never one of them */
  assert.equal((idx.match(/class="ri[^"]*" data-sec=/g) || []).length, 14, 'the scroll-spy set of 14 PROPX items changed');
});
t('the offline build hides the link (an offline file has no /altaris route)', () => {
  const py = SRC('scripts/build-standalone.py'), sa = SRC('standalone/israel-new-homes-v2.html');
  assert.ok(py.includes('.rail a[href="/altaris"]{display:none!important}'));
  assert.ok(sa.includes('.rail a[href="/altaris"]{display:none!important}'), 'standalone not rebuilt');
});
t('vercel.json: one rewrite for /altaris; framework and PROPX functions unchanged', () => {
  const v = JSON.parse(SRC('vercel.json'));
  assert.deepEqual(v.rewrites, [{ source: '/altaris', destination: '/altaris/index.html' }]);
  assert.equal(v.framework, null);
  /* PROPX's own functions (api/intel.js: the developer & project registry); ALTARIS adds none */
  assert.deepEqual(Object.keys(v.functions).sort(), ['api/gov/transactions.js', 'api/housing.js', 'api/intel.js', 'api/jobs/tx-refresh.js', 'api/land.js']);
  assert.ok(!Object.keys(v.functions).some((k) => /altaris/i.test(k)));
  assert.ok(v.headers.some((h) => h.source === '/altaris' && /no-store/.test(h.headers[0].value)));
});
t('the PROPX session gate covers /altaris and its assets (middleware unchanged)', () => {
  const mw = SRC('middleware.js');
  assert.ok(!/altaris/i.test(mw), 'middleware.js mentions ALTARIS');
  const raw = /matcher:\s*\['([^']+)'\]/.exec(mw)[1];
  const re = new RegExp('^' + JSON.parse('"' + raw + '"') + '$');
  for (const pth of ['/altaris', '/altaris/', '/altaris/index.html', '/altaris/app.js', '/altaris/engine.js']) assert.ok(re.test(pth), pth + ' is not gated');
  assert.ok(!re.test('/login.html'));
});
t('the local dev server mirrors the rewrite', () => {
  assert.match(SRC('scripts/kobix-dev-server.mjs'), /p === '\/altaris' \|\| p === '\/altaris\/' \? '\/altaris\/index\.html'/);
});
const APP = SRC('altaris/app.js');
const ALL_AX = ['altaris/app.js', 'altaris/engine.js', 'altaris/methodology.js', 'altaris/cases.js', 'altaris/charts.js', 'altaris/export.js', 'altaris/index.html', 'altaris/altaris.css'].map((f) => [f, SRC(f)]);
t('ALTARIS only reads PROPX: GET requests to the known endpoints, nothing else', () => {
  assert.ok(!/method\s*:/.test(APP), 'a request with an explicit method');
  assert.equal((APP.match(/\bfetch\(/g) || []).length, 1, 'fetch used outside getJSON');
  const urls = [...APP.matchAll(/getJSON\(\s*[`'"]([^`'"$?]+)/g)].map((m) => m[1]);
  /* /api/intel: the developer & project registry (GET, read-only context — never written into an assumption) */
  assert.deepEqual([...new Set(urls)].sort(), ['/api/geo/search', '/api/gov/transactions', '/api/housing', '/api/intel', '/api/land']);
  for (const [f, src] of ALL_AX) assert.ok(!/XMLHttpRequest|sendBeacon|navigator\.sendBeacon|new WebSocket/.test(src), f);
});
t('ALTARIS stores only its own keys (plus the shared theme preference) and never clears PROPX state', () => {
  const keys = [...APP.matchAll(/'((?:altaris|kobix):[a-z]+(?::v\d)?)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['altaris:deals:v1', 'altaris:draft:v1', 'altaris:settings:v1', 'altaris:ui:v1', 'kobix:theme']);
  for (const [f, src] of ALL_AX) assert.ok(!/localStorage\.(removeItem|clear)|sessionStorage|document\.cookie/.test(src), f + ' touches other browser state');
});
t('no randomness, no credential, no secret in any ALTARIS file', () => {
  for (const [f, src] of ALL_AX) {
    assert.ok(!/Math\.random\s*\(/.test(src), f + ' uses Math.random');
    assert.ok(!/SITE_PASSWORD|SESSION_SECRET|SUPABASE|service_role|eyJ[A-Za-z0-9_-]{20,}/.test(src), f + ' names a secret');
  }
});
t('the developer price is never chosen automatically; a choice comes from the user (or the labelled example)', () => {
  assert.ok(!/chosen\s*[:=]\s*'developer'/.test(APP + SRC('altaris/engine.js') + SRC('altaris/cases.js')));
  const sets = [...APP.matchAll(/\.chosen\s*=(?!=)\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(sets, ['el.value'], 'value.chosen is set somewhere other than the user radio');
  assert.match(APP, /chosen: 'units' \};\n\s*return d;/, 'the example deal chooses its unit-level values');
});
t('tax assumptions carry the disclaimer; defaults are labelled as assumptions; results explain themselves', () => {
  assert.ok(APP.includes('הנחות המס הן לצורך ניתוח השקעה בלבד ויש לאשרן מול המבנה המשפטי הסופי'));
  assert.match(APP, /<span class="ax-asm">הנחה<\/span>/);
  assert.ok((APP.match(/\bhow: /g) || []).length >= 60, 'too few "how is this calculated" explanations');
  assert.match(APP, /aria-label="איך זה מחושב\?"/);
});
t('the page is native to PROPX: same tokens, theme key and session-gated shell', () => {
  const css = SRC('altaris/altaris.css'), html = SRC('altaris/index.html'), idx = SRC('index.html');
  for (const tok of ['--paper:#f3f5f9', '--ink:#101b30', '--navy:#12294f', '--brass:#a4791c', '--paper:#0b1322', '--panel:#121d34']) {
    assert.ok(css.includes(tok) && idx.includes(tok.replace(':', ':')), tok);
  }
  assert.match(html, /localStorage\.getItem\("kobix:theme"\)/);
  for (const s of ['/data/market/latest.js', '/altaris/engine.js', '/altaris/methodology.js', '/altaris/cases.js', '/altaris/charts.js', '/altaris/export.js', '/altaris/app.js']) assert.ok(html.includes(`<script src="${s}" defer></script>`), s);
  assert.ok(html.indexOf('/altaris/methodology.js') < html.indexOf('/altaris/app.js'), 'the methodology loads before the page controller');
});

/* ------------------------------------------------------------------------------------------------
 * Metric conventions (altaris/methodology.js): the explanation layer documents the engine — it never
 * computes. These gates prove every explained metric exists in the real engine for exactly the
 * structures it names, that the definitions match the engine's own rules, that every metric has an
 * inline entry point in the page, and that adding the layer moved no number (zero drift).
 * ---------------------------------------------------------------------------------------------- */
console.log('altaris: metric conventions');
const MD = require('../altaris/methodology.js');
const FX = JSON.parse(SRC('test/fixtures/altaris-baseline.json'));
const sha256 = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex');
const FXR = Object.fromEntries(Object.entries(FX.runs).map(([k, r]) => [k, A.run(FX.deals[r.deal], FX.settings[r.settings], { today: FX.generatedWith.today })]));
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const bi = (v) => v && typeof v.he === 'string' && v.he.trim() && typeof v.en === 'string' && v.en.trim();

t('ZERO numeric drift: every frozen engine output (6 deals × 2 fund settings + a portfolio) is reproduced bit for bit', () => {
  assert.equal(Object.keys(FX.runs).length, 12);
  for (const [k, r] of Object.entries(FX.runs)) {
    const R = FXR[k];
    assert.equal(sha256(JSON.stringify(R)), r.sha256, `${k}: the engine output changed (headline then: ${JSON.stringify(r.headline.buy.base)})`);
    assert.equal(R.signal.code, r.headline.signal, k);
    for (const s of A.STRATS) if (r.headline[s].base) assert.equal(R.strategies[s].base.irr, r.headline[s].base.irr, `${k} ${s} irr`);
  }
  const names = Object.keys(FX.deals);
  const P = A.portfolio(names.map((k, i) => ({ id: k, deal: Object.assign({}, FX.deals[k], { selected: FX.portfolio.selected[i % 3] }), status: 'active' })), FX.settings[FX.portfolio.settings], { today: FX.generatedWith.today });
  assert.equal(sha256(JSON.stringify(P)), FX.portfolio.sha256, 'the portfolio output changed');
});
t('the methodology is versioned and pinned to this engine revision (an engine change fails here until the methodology is reviewed)', () => {
  assert.equal(MD.VERSION.id, 'altaris-metric-methodology-v1');
  assert.equal(MD.VERSION.label.en, 'ALTARIS Metric Methodology v1');
  assert.ok(Object.isFrozen(MD.VERSION));
  assert.equal(MD.VERSION.engine.version, A.VERSION);
  assert.equal(MD.VERSION.engine.sha256, sha256(fs.readFileSync(path.join(ROOT, 'altaris/engine.js'))), 'altaris/engine.js changed since the methodology was written');
});
t('every entry is complete and bilingual; ids unique; six groups A–F; expert-first titles', () => {
  assert.deepEqual(MD.GROUPS.map((g) => g.code).join(''), 'ABCDEF');
  const ids = MD.METRICS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 30, ids.length);
  for (const m of MD.METRICS) {
    assert.ok(MD.GROUPS.some((g) => g.id === m.group), m.id + ' group');
    for (const f of ['name', 'title', 'short', 'measures', 'basis', 'interpretation']) assert.ok(bi(m[f]), `${m.id}.${f} must exist in Hebrew and English`);
    if (m.convention) assert.ok(bi(m.convention), m.id + '.convention');
    assert.ok(m.usedIn.length && m.usedIn.every((k) => A.STRATS.includes(k)), m.id + ' usedIn');
    assert.ok(m.data.length && m.data.every((c) => MD.CLASSES[c]), m.id + ' data classes');
    assert.match(m.title.en, / — /, m.id + ': titles read "<metric> — <aspect>"');
    for (const k of Object.keys(m.perStructure || {})) { assert.ok(m.usedIn.includes(k), `${m.id}: a per-structure text for ${k}, which it is not used in`); assert.ok(bi(m.perStructure[k]), `${m.id}.perStructure.${k}`); }
  }
  for (const g of MD.GROUPS) assert.ok(bi(g) && MD.METRICS.some((m) => m.group === g.id), g.id);
  for (const c of Object.values(MD.CLASSES)) assert.ok(c.he && c.en && bi(c.d));
  for (const f of Object.values(MD.FIELDS)) assert.ok(bi(f));
  assert.deepEqual(Object.keys(MD.CLASSES), ['official', 'propx', 'model', 'user', 'override']);
});
t('the required metrics are all documented', () => {
  for (const id of ['irr', 'moic', 'capitalAtRisk', 'hurdles', 'riskScore', 'supportedValue', 'entryDiscount', 'invested', 'profit', 'ltv', 'coverage', 'breakEven', 'mos', 'velocity', 'wal',
    'debt', 'contingent', 'committed', 'peakCapital', 'recovery', 'scenarios', 'stress', 'exitValue', 'extension', 'signal']) assert.ok(MD.byId[id], id);
  assert.match(MD.byId.coverage.convention.en, /does not compute DSCR/, 'collateral coverage is not mislabelled as DSCR');
});
t('every explained metric exists in the real engine output, for exactly the structures listed', () => {
  for (const [k, R] of Object.entries(FXR)) {
    for (const m of MD.METRICS) {
      const e = m.engine || {};
      for (const s of A.STRATS) {
        const S = R.strategies[s]; if (!S.base.ok) continue;
        const inUse = m.usedIn.includes(s), alt = (e.alt || {})[s];
        if (inUse) {
          for (const key of alt || e.base || []) assert.notStrictEqual(S.base[key], undefined, `${k} ${m.id}: base.${key} missing in ${s}`);
          for (const p of Array.isArray(e.strategy) ? e.strategy : ((e.strategy || {})[s] || [])) {
            if (/^recoveryCase\.recovery\./.test(p) && S.recoveryCase && S.recoveryCase.recovery == null) {   // the documented exception: no capital funded → no claim, no default path
              assert.ok(s === 'hybrid' && S.base.capital === 0 && /no capital funded/.test(m.perStructure.hybrid.en), `${k} ${m.id}: no recovery outside the documented case`);
              continue;
            }
            assert.ok(getPath(S, p) !== undefined, `${k} ${m.id}: ${p} missing in ${s}`);
          }
        } else if (e.exclusive) for (const key of e.base) assert.strictEqual(S.base[key], undefined, `${k} ${m.id}: ${key} exists in ${s}, which the methodology says it is not used in`);
      }
      for (const p of e.facts || []) assert.notStrictEqual(R.facts[p], undefined, `${m.id}: facts.${p}`);
      for (const p of e.run || []) assert.notStrictEqual(getPath(R, p), undefined, `${m.id}: ${p}`);
    }
  }
  const P = A.portfolio([{ id: 'a', deal: FX.deals.example, status: 'active' }], {}, { today: TODAY });
  for (const m of MD.METRICS) for (const p of (m.engine || {}).portfolio || []) assert.notStrictEqual(P.summary[p], undefined, `${m.id}: portfolio.${p}`);
});
t('capital at risk is explained exactly as the engine computes it (peak; HYBRID max of commitment, capital + backstop + option, peak)', () => {
  let hybridAbovePeak = 0;
  for (const [k, R] of Object.entries(FXR)) for (const s of A.STRATS) for (const sc of ['base', 'downside', 'upside']) {
    const r = R.strategies[s][sc]; if (!r || !r.ok) continue;
    if (s !== 'hybrid') { assert.equal(r.atRisk, r.peakCapital, `${k} ${s} ${sc}`); continue; }
    const i = R.strategies.hybrid.inputs, extra = (i.backstopOn ? A.num(i.backstopPrice) || 0 : 0) + (i.optionOn ? A.num(i.optionPrice) || 0 : 0);
    assert.equal(r.atRisk, Math.max(r.commitment, r.capital + extra, r.peakCapital), `${k} hybrid ${sc}`);
    assert.equal(A.capOf(r), r.atRisk);
    if (r.atRisk > r.peakCapital + 1) hybridAbovePeak++;
  }
  assert.ok(hybridAbovePeak > 0, 'the fixtures exercise a HYBRID exposure above its peak deployment');
  const c = MD.byId.capitalAtRisk;
  assert.match(c.formula, /max\(commitment, capital \+ backstop \+ option, peak\)/);
  for (const w of ['peak', 'option', 'backstop', 'commitment', 'fee-only']) assert.ok((c.perStructure.hybrid.en + c.convention.en + c.short.en).toLowerCase().includes(w), w);
  // a backstop that is not called invests nothing: IRR / MOIC are stated on committed capital — the case the convention names
  const b = FXR['backstop#0'].strategies.hybrid.base;
  assert.ok(b.invested <= 1e-9 && b.irr == null && b.irrCommit != null && A.irrOf(b) === b.irrCommit);
});
t('fund hurdles: the documented list, test direction and fund-size rule match the engine pass/fail logic', () => {
  const spec = MD.byId.hurdles.hurdles, byK = Object.fromEntries(spec.map((h) => [h.k, h]));
  for (const h of spec) assert.equal(h.name.he, A.HURDLE_HE[h.k], h.k + ' name');
  for (const [k, R] of Object.entries(FXR)) {
    const st = A.settingsOf(FX.settings[FX.runs[k].settings]);
    for (const s of A.STRATS) {
      const H = R.strategies[s].hurdles; if (!R.strategies[s].base.ok) { assert.equal(H.length, 0); continue; }
      const expect = spec.filter((h) => h.usedIn.includes(s) && (!h.fund || st.fundSize > 0)).map((h) => h.k);
      assert.deepEqual(H.map((h) => h.k), expect, `${k} ${s}: hurdle set`);
      for (const h of H) {
        const sp = byK[h.k];
        assert.equal(h.limit, ['minMoic', 'minCoverage', 'maxDuration'].includes(sp.setting) ? st[sp.setting] : st[sp.setting] / 100, `${k} ${s} ${h.k} threshold`);
        const want = h.value != null && (sp.dir === 'min' ? h.value >= h.limit : h.value <= h.limit);
        assert.equal(h.pass, want, `${k} ${s} ${h.k}: pass ≠ ${sp.dir} test`);
      }
    }
  }
  assert.match(MD.byId.hurdles.basis.en, /BUY is tested on 8 hurdles, FINANCE and HYBRID on 9/);
  assert.equal(spec.filter((h) => h.usedIn.includes('buy')).length, 8);
  assert.equal(spec.filter((h) => h.usedIn.includes('finance')).length, 9);
});
t('the risk score is documented as a MODEL score — not a probability — with the engine components and weighted mean', () => {
  const r = MD.byId.riskScore;
  assert.match(r.title.en, /MODEL/); assert.match(r.short.en, /Not a probability/); assert.match(r.short.he, /אינו הסתברות/);
  assert.match(r.short.en, /higher = lower assessed risk/);
  assert.equal(r.formula, 'Score = Σ wᵢ × sᵢ ÷ Σ wᵢ');
  for (const [k, R] of Object.entries(FXR)) for (const s of A.STRATS) {
    const rk = R.strategies[s].risk; if (!rk) continue;
    assert.deepEqual(rk.components.map((c) => c.k), r.components.map((c) => c.k), `${k} ${s} components`);
    const tw = rk.components.reduce((a, c) => a + c.weight, 0), ts = rk.components.reduce((a, c) => a + c.weight * c.score, 0);
    assert.equal(rk.overall, Math.round(ts / tw), `${k} ${s}: overall = weighted mean`);
    assert.ok(rk.overall >= 0 && rk.overall <= 100 && rk.components.every((c) => c.score >= 0 && c.score <= 100));
  }
  assert.ok(!/F\.pct\([^)]*risk/.test(APP_SRC), 'the risk score is never formatted as a percentage');
});
t('BUY / FINANCE / HYBRID differences: taxes, debt, exit value only in BUY; commitment and contingent exposure only in HYBRID', () => {
  assert.deepEqual(MD.byId.taxes.usedIn, ['buy']); assert.deepEqual(MD.byId.debt.usedIn, ['buy']); assert.deepEqual(MD.byId.exitValue.usedIn, ['buy']);
  assert.deepEqual(MD.byId.committed.usedIn, ['hybrid']); assert.deepEqual(MD.byId.contingent.usedIn, ['hybrid']);
  assert.deepEqual(MD.byId.extension.usedIn, ['finance']); assert.deepEqual(MD.byId.recovery.usedIn, ['finance', 'hybrid']);
  const R = FXR['levered#0'];
  assert.ok(R.strategies.buy.base.afterTax && R.strategies.finance.base.afterTax === undefined && R.strategies.hybrid.base.afterTax === undefined);
});
t('supported value: never automatically the asking price, market, appraisal, PROPX or exit value; origin shown as PROPX-DERIVED / USER ASSUMPTION / USER OVERRIDE', () => {
  const v = MD.byId.supportedValue;
  assert.match(v.short.en, /not automatically the asking price, market value, appraisal, PROPX value or exit value/);
  assert.deepEqual(v.data, ['propx', 'user', 'override']);
  assert.match(APP_SRC, /const valueOrigin = \(k, src\) => \(k === 'propx' \|\| k === 'comparables' \? \(src && src\.auto === false \? 'override' : 'propx'\) : k === 'manual' \? 'override' : 'user'\);/);
  assert.ok((APP_SRC.match(/clsTag\(valueOrigin\(/g) || []).length >= 2, 'the origin tag sits on the value strip and the ledger');
  assert.match(v.convention.en, /over\.org\.il/); assert.ok(!/official source/i.test(v.convention.en));
});
const UI_IDS = (() => {
  const ids = new Set();
  for (const m of APP_SRC.matchAll(/\bmi\('([A-Za-z]+)'/g)) ids.add(m[1]);
  for (const m of APP_SRC.matchAll(/\bm: '([A-Za-z]+)'/g)) ids.add(m[1]);
  for (const blk of APP_SRC.matchAll(/const (?:CMP_M|IC_M) = \{([\s\S]*?)\};/g)) for (const m of blk[1].matchAll(/: '([A-Za-z]+)'/g)) ids.add(m[1]);
  return ids;
})();
t('documented details hold in the engine: VAT base, net proceeds, funded-HYBRID default path, default commitment, velocity floor', () => {
  const lb = FXR['levered#0'].strategies.buy.base, i = FXR['levered#0'].strategies.buy.inputs;
  near(lb.vat, lb.exitGross * i.vatPct / (100 + i.vatPct), 1e-6, 'VAT on the gross exit price');
  assert.match(MD.byId.taxes.basis.en, /gross exit price × rate ÷ \(100 \+ rate\)/);
  near(lb.netProceeds, lb.exitGross - lb.sellCosts - lb.vat, 1e-6, 'net proceeds exclude the debt');
  assert.ok(lb.debtRepaid > 0 && /debt balance is then repaid from them/.test(MD.byId.exitValue.basis.en));
  const od = FXR['option#0'].strategies.hybrid.downside;   // funded capital + backstop + option: the downside defaults
  assert.ok(od.defaulted && od.backstopPaid === 0 && !od.optionExercised, 'a funded HYBRID downside takes the default path');
  assert.match(MD.byId.contingent.interpretation.en, /structure with funded capital takes the default path \(no backstop call, no option exercise\)/);
  const bd = FXR['backstop#0'].strategies.hybrid.downside;   // nothing funded: the backstop is called on the unsold share
  assert.ok(!bd.defaulted && bd.backstopPaid > 0);
  for (const [k, R] of Object.entries(FXR)) {
    const h = R.strategies.hybrid, b = h.base; if (!b.ok) continue;
    if (!h.inputs.backstopOn && !(FX.deals[FX.runs[k].deal].hybrid || {}).maxCommitment) assert.equal(b.commitment, b.capital, `${k}: without a backstop the default commitment is the capital`);
    for (const s of A.STRATS) if (R.strategies[s].velocity) assert.ok(R.strategies[s].velocity.cycles >= 1);
  }
  assert.match(MD.byId.velocity.short.en, /max\(1, ⌊/);
});
t('every metric has an inline entry point in the page, and every entry point names a documented metric', () => {
  for (const id of UI_IDS) assert.ok(MD.byId[id], `the page references an undocumented metric "${id}"`);
  for (const m of MD.METRICS) assert.ok(UI_IDS.has(m.id), `${m.id} has no info mark in the page`);
});
t('level 1 — a subtle info mark, never a large question mark; the comparison cards carry IRR, capital at risk, MOIC, risk score (MODEL) and the hurdle breakdown', () => {
  assert.ok(!/aria-label="איך זה מחושב\?">\?<\/button>/.test(APP_SRC), 'the "?" mark is gone');
  assert.match(APP_SRC, /const INFO_I = '<svg viewBox="0 0 16 16"/);
  const cards = APP_SRC.slice(APP_SRC.indexOf('function paintCards()'), APP_SRC.indexOf('function renderStratInputs()'));
  for (const s of ["mi('irr'", "mi('capitalAtRisk'", "mi('moic'", "mi('riskScore')", 'modelTag()', 'data-hurdles=', '${pass}/${tot}', 'לא עומד', 'כולם מתקיימים']) assert.ok(cards.includes(s), s);
  assert.ok(!/<button[^>]*class="ax-card"[^>]*data-strat/.test(cards), 'a card is no longer a button wrapping buttons');
});
t('level 2 — popover: hover/click on desktop, tap → bottom sheet on a phone, Escape and focus return, link to the calculation basis', () => {
  for (const s of ["matchMedia('(hover: none), (max-width: 640px)')", "e.pointerType === 'mouse'", "el.classList.toggle('sheet', sheet)", "if (e.key === 'Escape') { if (POP.trigger) { closePop(true); return; }",
    "t.focus({ preventScroll: true })", "href=\"#method/${m.id}\" data-mgo=", "'View calculation basis ›'", "'בסיס החישוב המלא ›'", 'aria-haspopup="dialog"', "e.target.id === 'axPopBd'"]) assert.ok(APP_SRC.includes(s), s);
  const html = SRC('altaris/index.html');
  assert.match(html, /<div class="ax-pop" id="axPop" role="dialog" tabindex="-1" hidden><\/div>/);
  assert.match(html, /id="axMethodBtn" type="button" data-view="method"/);
});
t('level 3 — Metric Conventions view: route, Hebrew RTL / English LTR, bidi isolation, formulas left-to-right', () => {
  assert.match(APP_SRC, /const VIEWS = \['deal', 'compare', 'portfolio', 'saved', 'settings', 'method'\];/);
  for (const s of ["h: 'מתודולוגיית מדדים', sub: 'בסיס חישוב והגדרות השקעה'", "h: 'Metric Conventions', sub: 'Calculation Basis & Investment Definitions'", 'dir="${dir}" lang="${L}"', '<code class="ax-fx" dir="ltr">']) assert.ok(APP_SRC.includes(s), s);
  // the bidi helper, run on real methodology text
  const re = new RegExp(/he: (\/\(\?<!.*?\/g), en: (\/.*?\/g) \};/.exec(APP_SRC)[1].slice(1, -2), 'g');
  const latin = [...MD.byId.irr.short.he.matchAll(re)].map((m) => m[0]);
  assert.ok(latin.includes('XIRR'), latin.join('|'));
  assert.deepEqual([...'IRR ומ-MOIC; LTV 1.10x'.matchAll(re)].map((m) => m[0]), ['IRR', 'MOIC', 'LTV'], 'a unit after a number is not isolated away from it');
});
t('exports: the IC page is unchanged plus a one-line footer; the appendix is optional; Excel gains a "Metric Conventions" sheet; JSON and saved versions carry the version id', () => {
  assert.match(APP_SRC, /function printIC\(\) \{ X\.printHTML\(`<div class="ax-pp">\$\{icHTML\(true\)\}\$\{printFoot\(\)\}<\/div>\$\{appendix\(\)\}`/);
  assert.match(APP_SRC, /'Metrics follow ALTARIS calculation conventions\. See methodology appendix\.'/);
  assert.match(APP_SRC, /html \+= appendix\(\);\n\s*X\.printHTML\(html, fileBase\(\) \+ '-underwriting'\);/);
  assert.match(APP_SRC, /const appendix = \(\) => \(S\.mAppendix !== false \? methodPrintHTML\(\) : ''\);/);
  assert.match(APP_SRC, /\.concat\(\[\{ name: 'Metric Conventions', rows: methodRows\(\)/);
  assert.match(APP_SRC, /\.concat\(\[\{ title: 'Metric Conventions', rows: methodRows\(\) \}\]\)/);
  assert.match(APP_SRC, /kind: 'altaris-deal', schema: 1, methodology: MD\.VERSION\.id,/);
  assert.match(APP_SRC, /strategy: S\.R\.ic\.strategy, methodology: MD\.VERSION\.id \}\);/);
  // the existing calculation sheets are untouched: same sheet list, same metric rows
  const metricRows = [...APP_SRC.matchAll(/metric\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(metricRows, ['הון בסיכון', 'שיא פריסת הון', 'סך הון שהושקע', 'סך תקבולים', 'רווח לפני מס', 'IRR (על הון מחויב כשלא הושקע הון)', 'MOIC', 'ROI', 'תשואה שנתית', 'משך (חודשים)']);
  const sheets = [...APP_SRC.slice(APP_SRC.indexOf('function exportXLSX()')).matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(sheets.slice(0, 8), ['סיכום', 'עסקה', 'שווי נתמך', 'הנחות', 'תוצאות', 'מבחני לחץ', 'סיכון', 'תזרים ']);
  assert.equal(sheets[sheets.length - 1], 'Metric Conventions');
  // a left-to-right sheet only when asked; existing sheets stay right-to-left
  const X = SRC('altaris/export.js');
  assert.match(X, /rightToLeft="\$\{ltr \? 0 : 1\}"/);
});
t('the methodology module is pure data: no DOM, storage, network or calculation', () => {
  const m = SRC('altaris/methodology.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest|Math\./.test(m.replace(/root\.AltarisMethodology/g, '')));
  assert.ok(!/require\(/.test(m), 'the methodology does not import the engine');
});

/* ------------------------------------------------------------------------------------------------
 * Investment cases (altaris/cases.js): five illustrative, synthetic institutional deals. They are
 * inputs only — every figure comes from the ordinary engine — and they never enter saved deals,
 * the portfolio or any PROPX dataset unless the user creates a working copy.
 * ---------------------------------------------------------------------------------------------- */
console.log('altaris: investment cases');
const CSX = require('../altaris/cases.js');
const CASE_SRC = SRC('altaris/cases.js');
const runCase = (c, settings) => A.run(JSON.parse(JSON.stringify(c.deal)), settings || {}, { today: TODAY, portfolio: [] });
const CASE_R = Object.fromEntries(CSX.CASES.map((c) => [c.id, runCase(c)]));
const fnBody = (name) => { const i = APP.indexOf('function ' + name + '('); assert.ok(i >= 0, name); const j = APP.indexOf('\n  }\n', i); return APP.slice(i, j); };

t('exactly five illustrative case templates, frozen, with the notice wording', () => {
  assert.equal(CSX.CASES.length, 5);
  assert.deepEqual(CSX.CASES.map((c) => c.id), ['park-18', 'hanassi-42', 'ganei-hapark', 'hagefen-renewal', 'coastal-portfolio-i']);
  assert.ok(Object.isFrozen(CSX.CASES) && CSX.CASES.every((c) => Object.isFrozen(c) && Object.isFrozen(c.deal) && Object.isFrozen(c.deal.units)));
  assert.equal(CSX.NOTICE.he, 'מקרה השקעה להמחשה · הנתונים סינתטיים ונבנו לצורך הדגמת מודל החיתום.');
  assert.equal(CSX.NOTICE.en, 'Illustrative investment case · Synthetic data created to demonstrate the underwriting model.');
  assert.match(CSX.EXPORT_MARK, /^ILLUSTRATIVE CASE · מקרה השקעה להמחשה/);
});
t('every template is complete: bilingual card + IC memo, deal details, varied unit rows, an explicit value, terms for all three structures, scenarios', () => {
  const geo = JSON.parse(SRC('data/geo/localities.json'));
  const locs = Array.isArray(geo) ? geo : geo.localities || geo.items || Object.values(geo)[0];
  for (const c of CSX.CASES) {
    for (const f of ['title', 'category', 'location', 'scale', 'thesis']) assert.ok(bi(c[f]), `${c.id}.${f}`);
    for (const f of ['thesis', 'whyNow', 'risks', 'protection', 'exit']) assert.ok(bi(c.memo[f]) && c.memo[f].he.length > 60, `${c.id}.memo.${f}`);
    assert.ok(A.STRATS.includes(c.primary));
    const d = c.deal, i = d.info;
    for (const f of ['name', 'developer', 'project', 'city', 'cityCode', 'neighborhood', 'address', 'unitTypes', 'constructionStatus', 'completionDate', 'startDate', 'source', 'owner', 'developerRating', 'notes']) assert.ok(String(i[f] || '').trim(), `${c.id}.info.${f}`);
    assert.ok(locs.some((l) => String(l.code) === i.cityCode && l.he === i.city), `${c.id}: ${i.city} is the official locality ${i.cityCode}`);
    assert.match(i.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d.units.length >= 5 && d.units.every((u) => u.label && u.rooms >= 3 && u.sqm > 60 && u.supported > u.proposed && u.proposed > 0), `${c.id}: unit rows`);
    assert.ok(new Set(d.units.map((u) => u.sqm)).size >= 0.6 * d.units.length && new Set(d.units.map((u) => u.supported)).size >= 0.8 * d.units.length && new Set(d.units.map((u) => u.rooms)).size >= 3, `${c.id}: units are not identical copies`);
    assert.ok(A.VALUE_SOURCES.includes(d.value.chosen) && d.value.chosen !== 'developer' && !d.value.propx && !d.value.comparables, `${c.id}: the value is an explicit scenario choice, never PROPX data`);
    for (const k of Object.keys(d.value)) if (d.value[k] && d.value[k].note) assert.match(d.value[k].note, /הנחת תרחיש \(סינתטית\)/, `${c.id}: ${k} labelled a scenario assumption`);
    for (const k of A.STRATS) assert.ok(Object.keys(d[k]).length >= 15, `${c.id}: ${k} terms entered`);
    assert.ok(d.scen.downside && d.scen.upside, `${c.id}: scenarios`);
    assert.equal(d.selected, null, `${c.id}: no structure is chosen in advance`);
  }
});
t('cases are inputs only: no calculation path of their own, no predetermined winner, no "fake / demo / dummy" wording, never OFFICIAL', () => {
  const code = CASE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
  assert.ok(!/Math\.|\.irr|xirr|run\(|metricsOf|fetch\(|localStorage|document\.|window\./.test(code.replace(/root\.AltarisCases/g, '')), 'cases.js computes or touches the page');
  assert.ok(!/STRONG BUY|PREFER (FINANCE|HYBRID)|DO NOT PROCEED|winner|preferred structure/i.test(CASE_SRC.replace(/no case names a preferred structure/, '')), 'a case names an outcome');
  assert.ok(!/\b(fake|dummy|demo)\b|(^|[^\u0590-\u05FF])(דמה|דמו)(?![\u0590-\u05FF])/i.test(CASE_SRC));
  assert.ok(!/OFFICIAL|רשמי|PROPX-DERIVED|נגזר · PROPX/.test(CASE_SRC.replace(/\/\*[\s\S]*?\*\//g, '')));
  // the page computes a case with the ordinary engine, through the ordinary recompute
  assert.equal((APP.match(/S\.R = E\.run\(/g) || []).length, 1);
  assert.match(fnBody('openCase'), /S\.deal = normalizeDeal\(clone\(c\.deal\)\); S\.deal\.case = \{ id: c\.id, v: CS\.VERSION \};/);
  assert.match(APP, /portfolio: isCase\(S\.deal\) \? \[\] : portfolioCtx\(\)/);
});
t('each case runs through the normal engine: all three structures compute, no NaN / undefined / Infinity', () => {
  const finite = (v, msg) => assert.ok(typeof v === 'number' && isFinite(v), msg + ' = ' + v);
  for (const c of CSX.CASES) {
    const R = CASE_R[c.id];
    assert.ok(R.ready && R.signal && R.signal.code && R.signal.why.length >= 1, c.id);
    for (const k of A.STRATS) {
      const s = R.strategies[k];
      for (const sc of ['base', 'downside', 'upside']) {
        const r = s[sc]; assert.ok(r && r.ok, `${c.id} ${k} ${sc}`);
        for (const f of ['profit', 'invested', 'distributions', 'peakCapital', 'atRisk', 'months']) finite(r[f], `${c.id} ${k} ${sc} ${f}`);
        finite(A.irrOf(r), `${c.id} ${k} ${sc} irr`); finite(A.moicOf(r), `${c.id} ${k} ${sc} moic`);
      }
      finite(s.mos, `${c.id} ${k} mos`); finite(s.risk.overall, `${c.id} ${k} risk`);
      for (const x of A.STRESS) assert.ok(s.stress[x.id].ok && isFinite(A.irrOf(s.stress[x.id])), `${c.id} ${k} stress ${x.id}`);
      assert.ok(s.attribution && s.velocity, `${c.id} ${k} attribution / velocity`);
    }
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(R, (key, v) => (typeof v === 'number' && !isFinite(v) ? 'NaN' : v))), c.id);
  }
});
t('accounting reconciles for every case, structure and scenario (bridge, cash flows, MOIC, peak, IRR root, capital at risk)', () => {
  for (const c of CSX.CASES) {
    const R = CASE_R[c.id];
    for (const k of A.STRATS) for (const sc of ['base', 'downside', 'upside']) {
      const r = R.strategies[k][sc], tag = `${c.id} ${k} ${sc}`;
      const byM = new Map(); for (const f of r.flows) byM.set(f.m, (byM.get(f.m) || 0) + f.amount);
      const net = [...byM.values()], tol = 1e-6 * Math.max(1, r.invested);
      near(net.reduce((a, x) => a + x, 0), r.profit, tol, tag + ' profit = Σ flows');
      near(net.filter((x) => x < 0).reduce((a, x) => a - x, 0), r.invested, tol, tag + ' invested');
      near(net.filter((x) => x > 0).reduce((a, x) => a + x, 0), r.distributions, tol, tag + ' distributions');
      if (r.moic != null) near(r.moic, r.distributions / r.invested, 1e-9, tag + ' MOIC');
      let cum = 0, mn = 0; for (const m of [...byM.keys()].sort((a, b) => a - b)) { cum += byM.get(m); mn = Math.min(mn, cum); }
      near(r.peakCapital, -mn, tol, tag + ' peak');
      if (r.irr != null) {
        const t0 = R.facts.t0, npv = [...byM.entries()].reduce((a, [m, x]) => a + x / Math.pow(1 + r.irr, A.daysBetween(t0, A.addMonths(t0, m)) / 365), 0);
        near(npv, 0, 1e-4 * r.invested, tag + ' NPV at the IRR');
      }
      if (k === 'buy') near(r.bridgeCheck, r.profit, 1, tag + ' BUY value bridge');
      if (k !== 'hybrid') assert.equal(r.atRisk, r.peakCapital, tag);
      else { const i = R.strategies.hybrid.inputs; assert.equal(r.atRisk, Math.max(r.commitment, r.capital + (i.backstopOn ? +i.backstopPrice : 0) + (i.optionOn ? +i.optionPrice : 0), r.peakCapital), tag); }
    }
  }
});
t('the five cases differ materially: geography, scale, structure, duration, leverage, liquidity, counterparty', () => {
  const F = (c) => CASE_R[c.id].facts, cs = CSX.CASES;
  assert.equal(new Set(cs.map((c) => c.deal.info.city)).size, 5, 'cities');
  assert.ok(new Set(cs.map((c) => c.primary)).size === 3, 'primary structures cover BUY, FINANCE and HYBRID');
  assert.ok(new Set(cs.map((c) => c.deal.hybrid.structure)).size >= 4, 'hybrid structures');
  assert.equal(new Set(cs.map((c) => JSON.stringify([c.deal.hybrid.structure, c.deal.hybrid.optionOn, c.deal.hybrid.backstopOn, c.deal.hybrid.prefPct, c.deal.hybrid.couponPct]))).size, 5, 'a different hybrid term set in every case');
  const smv = cs.map((c) => F(c).smv); assert.ok(Math.min(...smv) < 25e6 && Math.max(...smv) > 80e6, 'scale ' + smv);
  const months = cs.map((c) => CASE_R[c.id].strategies[c.primary].base.months); assert.ok(Math.max(...months) >= 2.5 * Math.min(...months), 'duration ' + months);
  assert.ok(new Set(cs.map((c) => c.deal.buy.ltvPct)).size === 5, 'leverage');
  assert.ok(new Set(cs.map((c) => c.deal.info.constructionStatus)).size >= 3, 'project stage');
  assert.equal(new Set(cs.map((c) => c.deal.info.developer)).size, 5, 'counterparties');
  assert.ok(cs.some((c) => c.deal.buy.rentOn) && cs.some((c) => c.deal.hybrid.backstopOn) && cs.some((c) => c.deal.hybrid.optionOn) && cs.some((c) => c.deal.finance.seniority === 'first') && cs.some((c) => c.deal.finance.seniority === 'second'));
  const disc = cs.map((c) => F(c).discount); assert.ok(Math.max(...disc) - Math.min(...disc) > 0.1, 'entry discounts ' + disc);
});
t('case data never enters PROPX datasets or pages: the names exist only in the ALTARIS case file', () => {
  const names = CSX.CASES.flatMap((c) => [c.deal.info.project, c.deal.info.developer]);
  const walk = (dir, out) => { for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(js|json|html|sql|csv|md)$/.test(e.name)) out.push(p); } return out; };
  const files = ['index.html'].concat(...['data', 'lib', 'api', 'standalone', 'supabase'].filter((d) => fs.existsSync(path.join(ROOT, d))).map((d) => walk(d, [])));
  for (const f of files) { const txt = SRC(f); for (const n of names) assert.ok(!txt.includes(n), `${n} appears in ${f}`); }
  assert.ok(!/cases\.js/.test(SRC('index.html')) && !/AltarisCases/.test(SRC('index.html')));
  assert.equal((SRC('altaris/index.html').match(/cases\.js/g) || []).length, 1);
});
t('opening a case never touches saved deals or the portfolio; saving is replaced by "create working copy"', () => {
  const open = fnBody('openCase');
  assert.ok(!/S\.deals|persistDeals|KEY\.deals/.test(open), 'openCase writes saved deals');
  assert.match(fnBody('saveDeal'), /if \(isCase\(S\.deal\)\) \{ toast\('מקרה להמחשה אינו נשמר בעסקאות — צרו עותק עבודה'\); return; \}/);
  assert.match(APP, /const footHTML = \(\) => \(isCase\(S\.deal\) \? `<div class="ax-ldg-f"><button class="ax-btn pri" type="button" data-act="case-copy">יצירת עותק עבודה<\/button>/);
  assert.match(APP, /CS\.NOTICE\.he/);
});
t('working copy: a user deal tagged with its origin; an imported case file becomes a working copy; the template stays intact', () => {
  const cp = fnBody('caseCopy');
  assert.match(cp, /const d = clone\(S\.deal\); delete d\.case;/);
  assert.match(cp, /d\.origin = \{ kind: 'illustrative-case', id: c\.id, v: CS\.VERSION, copiedAt: TODAY \};/);
  assert.match(cp, /saveDeal\(\);/); assert.match(cp, /rec\.origin = 'illustrative-case'/);
  assert.match(APP, /const deCase = \(d\) => \{ if \(d && d\.case\) \{ d\.origin = \{ kind: 'illustrative-case'/);
  const before = JSON.stringify(CSX.CASES);
  for (const c of CSX.CASES) { const d = JSON.parse(JSON.stringify(c.deal)); d.buy.haircutPct = 99; d.units.pop(); }
  assert.equal(JSON.stringify(CSX.CASES), before);
});
t('reset: leaving a case gives a clean blank deal; blank and example deals carry no case state', () => {
  assert.match(APP, /case 'case-exit': newDeal\(false\); break;/);
  const bd = /const blankDeal = \(\) => (\(\{[^\n]+\}\));/.exec(APP)[1];
  assert.ok(!/case|origin/.test(bd), 'the blank deal mentions case state');
  assert.ok(!/\.case\b|origin/.test(fnBody('exampleDeal')));
});
t('exports of a case (and of a working copy) are marked illustrative on every page / sheet; ordinary deals are untouched', () => {
  assert.match(APP, /if \(illusKind\(\)\) \{ const mark = \[\{ v: illusMark\(\), b: true \}\]; meta\.unshift\(mark\); summary\.unshift\(mark, \[''\]\); \}/);
  assert.match(APP, /if \(illusKind\(\)\) sheets\.forEach\(\(sh, i\) => \{ if \(i > 0\) sh\.rows = \[\[\{ v: illusMark\(\), b: true \}\], \[''\]\]\.concat\(sh\.rows\); \}\);/);
  assert.match(APP, /'ALTARIS-' \+ \(illusKind\(\) \? 'ILLUSTRATIVE-' : ''\)/);
  assert.match(APP, /illustrative: illusKind\(\) \? illusMark\(\) : undefined/);
  assert.match(APP, /return `<div class="ax-ic">\$\{illusBanner\(\)\}/);
  assert.match(APP, /if \(illusKind\(\)\) \{ const pp = html\.split\('<div class="ax-pp">'\);/);
  assert.match(APP, /const illusKind = \(\) => \(isCase\(S\.deal\) \? 'case' : fromCase\(S\.deal\) \? 'copy' : null\);/);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
