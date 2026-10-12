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
  assert.equal((idx.match(/class="ri[^"]*" data-sec=/g) || []).length, 13, 'the scroll-spy set of 13 PROPX items changed');
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
  assert.deepEqual(Object.keys(v.functions).sort(), ['api/gov/transactions.js', 'api/housing.js', 'api/jobs/tx-refresh.js', 'api/land.js']);
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
const ALL_AX = ['altaris/app.js', 'altaris/engine.js', 'altaris/charts.js', 'altaris/export.js', 'altaris/index.html', 'altaris/altaris.css'].map((f) => [f, SRC(f)]);
t('ALTARIS only reads PROPX: GET requests to the known endpoints, nothing else', () => {
  assert.ok(!/method\s*:/.test(APP), 'a request with an explicit method');
  assert.equal((APP.match(/\bfetch\(/g) || []).length, 1, 'fetch used outside getJSON');
  const urls = [...APP.matchAll(/getJSON\(\s*[`'"]([^`'"$?]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(urls)].sort(), ['/api/geo/search', '/api/gov/transactions', '/api/housing', '/api/land']);
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
  assert.ok(!/chosen\s*[:=]\s*'developer'/.test(APP + SRC('altaris/engine.js')));
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
  for (const s of ['/data/market/latest.js', '/altaris/engine.js', '/altaris/charts.js', '/altaris/export.js', '/altaris/app.js']) assert.ok(html.includes(`<script src="${s}" defer></script>`), s);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
