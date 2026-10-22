'use strict';
/* PROPX · DEAL DECISION LAB (lib/deal) — the gates.
 *
 *   ENGINE      golden cases computed independently (the annuity by its own schedule running to zero, a 0 % loan, no loan, yields,
 *               cash-on-cash, DSCR, the break-evens re-checked through the engine), missing inputs never defaulted, sensitivity
 *               monotone, scenarios only from shocks, the deal rules' thresholds.
 *   READ MODEL  real data (st:7900:213 הרצל, פתח תקווה · st:3000:612 יפו, ירושלים · st:5000:813 אנטיגונוס, תל אביב-יפו · st:3000:1941
 *               המהר"ל מפראג, ירושלים): no partial share, no non-dwelling, no future date, no several-units deal in a comparable; every
 *               comparable with its source and copy date; every level's counts add up; each transaction in one level; the street level
 *               equals the street evidence's own priced sample; wider levels only below the minimum, labelled.
 *   API         400 / 404 / the shape of every view through api/intel.js.
 *   REGISTRY    every term the lab cites exists with simple + example in both languages; every flag has a rule.
 *   PAGE        the module's strings in both languages, the storage key wrapped, the memo's disclaimer, the street-report hook.
 * Run: node test/deal-lab.test.js */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../lib/deal/engine');
const L = require('../lib/deal');
const EV = require('../lib/streets/evidence');
const X = require('../lib/explain/registry');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const pending = [];
const t = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === 'function') { pending.push(r.then(() => { passed++; console.log('  ✓ ' + name); }, (e) => { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); })); return; } passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); }
};
const near = (a, b, tol, what) => assert.ok(a != null && Math.abs(a - b) <= tol, `${what || ''} ${a} ≉ ${b} (±${tol})`);

/* the worked deal every registry example uses: ₪2,000,000, 70 % LTV at 4.5 % over 25 years, ₪100,000 of costs, ₪6,500 rent, 5 % vacancy,
   ₪200 / month maintenance, ₪1,200 / year insurance */
const DEAL = () => ({ price: 2000000, sqm: 80, costs: { tax: 0, legal: 10000, broker: 40000, renovation: 50000, other: 0 },
  financing: { mode: 'ltv', ltvPct: 70, ratePct: 4.5, years: 25 },
  rent: { monthly: 6500, vacancyPct: 5, maintenance: 200, managementPct: 0, insurance: 1200, otherOpex: 0 }, targetCocPct: 2 });

console.log('deal-lab: the engine');
t('the annuity: ₪1,000,000 at 4.5 % over 25 years = ₪5,558.32 a month — and that payment runs its own schedule to zero in 300 months', () => {
  const p = E.annuity(1000000, 4.5, 25);
  near(p, 5558.32, 0.005, 'payment');
  let bal = 1000000; const r = 0.045 / 12;
  for (let m = 0; m < 300; m++) bal = bal * (1 + r) - p;
  near(bal, 0, 0.01, 'balance after 300 payments');
  const A = E.amortization(1000000, 4.5, 25);
  assert.equal(A.months, 300); assert.equal(A.byYear.length, 25);
  near(A.totalInterest, p * 300 - 1000000, 0.01, 'total interest = 300 × PMT − P');
  near(A.totalInterest, 667497.43, 0.01, 'total interest');
  near(A.byYear[0].interest, 44546.80, 0.01, 'year-1 interest'); near(A.byYear[0].principal, 22153.10, 0.01, 'year-1 principal');
  assert.equal(A.byYear[24].closing, 0, 'the last payment closes the balance exactly');
  near(A.byYear.reduce((a, y) => a + y.principal, 0), 1000000, 1e-6, 'Σ principal = the loan');
});
t('a 0 % loan: payment = principal ÷ months, no interest; a zero principal pays nothing; invalid terms are null, never a default', () => {
  assert.equal(E.annuity(1200000, 0, 20), 5000);
  const A = E.amortization(1200000, 0, 20); assert.equal(A.totalInterest, 0); assert.equal(A.byYear[19].closing, 0);
  assert.equal(E.annuity(0, 4, 20), 0);
  for (const bad of [[1000, -1, 10], [1000, 4, 0], [null, 4, 10], [1000, null, 10], ['', 4, 10]]) assert.equal(E.annuity(...bad), null, JSON.stringify(bad));
});
t('the worked deal: loan · equity · NOI · cash flow · yields · cash-on-cash · DSCR, each against hand arithmetic', () => {
  const r = E.analyze(DEAL()), v = r.values;
  assert.deepEqual(r.missing, {}); assert.deepEqual(r.invalid, []);
  assert.equal(v.loan, 1400000); assert.equal(v.downPayment, 600000); assert.equal(v.ltvPct, 70);
  const pmt = 1.4 * 5558.324779619954;                      // the annuity is linear in the principal
  near(v.monthlyPayment, pmt, 1e-6, 'payment'); near(v.annualDebtService, 12 * pmt, 1e-6, 'debt service');
  assert.equal(v.purchaseCosts, 100000); assert.equal(v.totalCost, 2100000); assert.equal(v.equity, 700000);
  assert.equal(v.grossRentAnnual, 78000); assert.equal(v.vacancyLoss, 3900); assert.equal(v.effectiveIncome, 74100);
  assert.equal(v.opexAnnual, 3600); assert.equal(v.noi, 70500);
  near(v.grossYieldPct, 3.9, 1e-9, 'gross yield = 78,000 ÷ 2,000,000');
  near(v.netYieldPct, 70500 / 2100000 * 100, 1e-9, 'net yield = NOI ÷ (price + costs)');
  near(v.cashFlowAnnual, 70500 - 12 * pmt, 1e-6, 'cash flow'); near(v.cashFlowMonthly, (70500 - 12 * pmt) / 12, 1e-6);
  near(v.cashOnCashPct, (70500 - 12 * pmt) / 700000 * 100, 1e-9, 'cash-on-cash = cash flow ÷ equity');
  near(v.dscr, 70500 / (12 * pmt), 1e-9, 'DSCR = NOI ÷ debt service');
  near(v.pricePerSqm, 25000, 1e-9);
  near(r.firstYear.interest + r.firstYear.principal, 12 * pmt, 1e-6, 'year-1 interest + principal = debt service');
});
t('management is a % of the rent collected; maintenance / other are ₪ a month, insurance ₪ a year', () => {
  const d = DEAL(); d.rent.managementPct = 8; d.rent.otherOpex = 100;
  const r = E.analyze(d);
  near(r.opex.management, 74100 * 0.08, 1e-9); assert.equal(r.opex.maintenance, 2400); assert.equal(r.opex.other, 1200); assert.equal(r.opex.insurance, 1200);
  near(r.values.noi, 74100 - 74100 * 0.08 - 2400 - 1200 - 1200, 1e-9);
});
t('no loan (cash): payment 0, DSCR not applicable (never infinite), cash-on-cash = NOI ÷ (price + costs); a down payment equal to the price is the same', () => {
  const d = DEAL(); d.financing = { mode: 'cash' };
  const r = E.analyze(d), v = r.values;
  assert.equal(v.loan, 0); assert.equal(v.monthlyPayment, 0); assert.equal(v.totalInterest, 0); assert.equal(v.dscr, null); assert.equal(r.notApplicable.dscr, 'no-debt');
  assert.equal(r.amortization, null); assert.equal(r.notApplicable.amortization, 'no-loan');
  near(v.cashOnCashPct, 70500 / 2100000 * 100, 1e-9); near(v.cashOnCashPct, v.netYieldPct, 1e-9, 'unlevered: CoC = net yield');
  const d2 = DEAL(); d2.financing = { mode: 'down', downPayment: 2000000, ratePct: 4.5, years: 25 };
  assert.equal(E.analyze(d2).values.loan, 0); assert.equal(E.analyze(d2).values.dscr, null);
  const s = E.sensitivity(d); assert.ok(s.rate.every((x) => x.values === null && x.reason === 'no-loan'));
});
t('break-even rent: at that rent the cash flow is 0 (re-run through the engine); it needs no entered rent', () => {
  const r = E.analyze(DEAL());
  near(r.values.breakEvenRentMonthly, (2400 + 1200 + r.values.annualDebtService) / (12 * 0.95), 1e-9, 'closed form');
  const d = DEAL(); d.rent.monthly = r.values.breakEvenRentMonthly; near(E.analyze(d).values.cashFlowAnnual, 0, 1e-6, 'cash flow at the break-even rent');
  const d2 = DEAL(); d2.rent.managementPct = 10; const r2 = E.analyze(d2); d2.rent.monthly = r2.values.breakEvenRentMonthly; near(E.analyze(d2).values.cashFlowAnnual, 0, 1e-6, 'with management %');
  const d3 = DEAL(); d3.rent.monthly = null; const r3 = E.analyze(d3); assert.ok(r3.values.breakEvenRentMonthly > 0); assert.equal(r3.values.noi, null);
});
t('break-even price for a target cash-on-cash: CoC(P*) = target and CoC(P* + ₪1,000) < target; unreachable → null with a reason', () => {
  const r = E.analyze(DEAL()), P = r.values.breakEvenPrice;
  near(P, 1300000, 2000, 'the registry example (≈ ₪1,300,000)');
  const at = (p) => { const d = DEAL(); d.price = p; return E.analyze(d).values.cashOnCashPct; };
  near(at(P), 2, 0.005, 'CoC at P*'); assert.ok(at(P + 1000) < 2);
  const d = DEAL(); d.rent.monthly = 100; const u = E.analyze(d);   /* a negative NOI: no price reaches a positive target */
  assert.equal(u.values.breakEvenPrice, null); assert.ok(u.notApplicable.breakEvenPrice, 'a stated reason');
  const d2 = DEAL(); d2.targetCocPct = null; assert.deepEqual(E.analyze(d2).missing.breakEvenPrice, ['targetCocPct']);
  const d3 = DEAL(); d3.financing = { mode: 'down', downPayment: 700000, ratePct: 4.5, years: 25 };
  const P3 = E.analyze(d3).values.breakEvenPrice; const d4 = { ...d3, price: P3 }; near(E.analyze(d4).values.cashOnCashPct, 2, 0.005, 'down-payment mode');
});
t('missing rent → every rental metric MISSING with the rent named (never computed on a default); the financing still computes', () => {
  const d = DEAL(); d.rent = { vacancyPct: 5, maintenance: 200, managementPct: 0, insurance: 1200, otherOpex: 0 };
  const r = E.analyze(d), v = r.values;
  for (const k of ['grossRentAnnual', 'noi', 'cashFlowMonthly', 'cashFlowAnnual', 'grossYieldPct', 'netYieldPct', 'cashOnCashPct', 'dscr']) {
    assert.equal(v[k], null, k); assert.ok((r.missing[k] || []).includes('rentMonthly'), k + ' names the rent');
  }
  assert.ok(v.monthlyPayment > 0 && v.equity === 700000, 'financing is independent of the rent');
  const s = E.sensitivity(d); assert.ok(s.rent.every((x) => x.values === null && x.reason === 'rentMonthly')); assert.equal(s.grid, null);
  const sc = E.scenarios(d, { downside: { rentPct: -10 } }); assert.equal(sc.downside.values.cashFlowMonthly, null);
});
t('blank is never 0: an empty cost blocks the totals and is named; an explicit 0 is a value; invalid values are refused and named', () => {
  const d = DEAL(); d.costs.broker = ''; const r = E.analyze(d);
  assert.equal(r.values.purchaseCosts, null); assert.deepEqual(r.missing.purchaseCosts, ['broker']); assert.ok(r.missing.cashOnCashPct.includes('broker'));
  const d0 = DEAL(); d0.costs.broker = 0; assert.equal(E.analyze(d0).values.purchaseCosts, 60000);
  const bad = DEAL(); bad.financing = { mode: 'down', downPayment: 2500000, ratePct: 4.5, years: 25 }; const rb = E.analyze(bad);
  assert.ok(rb.invalid.includes('downPayment')); assert.equal(rb.values.loan, null);
  const bad2 = DEAL(); bad2.financing.ltvPct = 120; assert.ok(E.analyze(bad2).invalid.includes('ltvPct'));
  const bad3 = DEAL(); bad3.rent.vacancyPct = 100; assert.ok(E.analyze(bad3).invalid.includes('vacancyPct'));
  const none = E.analyze({}); assert.ok(Object.values(none.values).every((x) => x === null), 'an empty deal computes nothing');
  assert.deepEqual(none.missing.loan, ['price', 'financingMode']);
});
t('sensitivity: rent ±10/20 %, rate ±1/2 pp, price ±5/10 % — monotone in every driver, the 0 step equals the base, the grid agrees', () => {
  const s = E.sensitivity(DEAL()), cf = (xs) => xs.map((x) => x.values.cashFlowMonthly);
  assert.deepEqual(s.steps, { rent: [-20, -10, 0, 10, 20], rate: [-2, -1, 0, 1, 2], price: [-10, -5, 0, 5, 10] });
  const up = (a) => a.every((x, i) => i === 0 || x > a[i - 1]), down = (a) => a.every((x, i) => i === 0 || x < a[i - 1]);
  assert.ok(up(cf(s.rent)), 'cash flow rises with the rent'); assert.ok(down(cf(s.rate)), 'cash flow falls as the rate rises'); assert.ok(down(cf(s.price)), 'cash flow falls as the price rises');
  assert.ok(up(s.rent.map((x) => x.values.dscr))); assert.ok(down(s.rate.map((x) => x.values.dscr)));
  assert.ok(down(s.price.map((x) => x.values.netYieldPct)), 'net yield falls with the price');
  assert.ok(s.rate.every((x) => x.values.netYieldPct === s.base.netYieldPct), 'the rate never moves the net yield (unlevered)');
  for (const k of ['rent', 'rate', 'price']) assert.equal(s[k][2].values.cashFlowMonthly, s.base.cashFlowMonthly, k + ' 0 step');
  for (let i = 0; i < 5; i++) { assert.ok(down(s.grid.cells[i]), 'grid row falls with the rate'); assert.ok(up(s.grid.cells.map((row) => row[i])), 'grid column rises with the rent'); }
  assert.equal(s.grid.cells[2][2], s.base.cashFlowMonthly);
  const low = DEAL(); low.financing.ratePct = 1.5; const sl = E.sensitivity(low);
  assert.equal(sl.rate[0].values, null); assert.equal(sl.rate[0].reason, 'rate-below-zero'); assert.ok(sl.rate[1].values, '−1 pp from 1.5 % is 0.5 %');
});
t('scenarios: base = the inputs; a scenario without a shock is not computed; downside below base below upside on the shocked drivers', () => {
  const none = E.scenarios(DEAL(), {});
  assert.equal(none.downside.values, null); assert.equal(none.downside.reason, 'no-shock-entered'); assert.equal(none.upside.values, null);
  assert.equal(none.base.values.cashFlowMonthly, E.analyze(DEAL()).values.cashFlowMonthly);
  const s = E.scenarios(DEAL(), { downside: { rentPct: -10, vacancyPp: 5, ratePp: 1, opexPct: 10 }, upside: { rentPct: 5, ratePp: -0.5 } });
  assert.ok(s.downside.values.cashFlowMonthly < s.base.values.cashFlowMonthly && s.base.values.cashFlowMonthly < s.upside.values.cashFlowMonthly);
  /* the downside by hand: rent 5,850 · vacancy 10 % · rate 5.5 % · costs × 1.1 */
  const d = DEAL(); d.rent.monthly = 5850; d.rent.vacancyPct = 10; d.financing.ratePct = 5.5; d.rent.maintenance = 220; d.rent.insurance = 1320;
  near(s.downside.values.cashFlowMonthly, E.analyze(d).values.cashFlowMonthly, 1e-6, 'downside = the base with the four shocks');
  assert.equal(s.upside.shocks.vacancyPp, null, 'a blank shock stays blank (the driver as in the base)');
});
t('purchase tax: bracketTax applies the table the caller passes (cumulative slices); the engine carries no table of its own', () => {
  const tbl = [[100, 0], [200, 10], [null, 20]];
  assert.equal(E.bracketTax(250, tbl).tax, 20); assert.equal(E.bracketTax(100, tbl).tax, 0); assert.equal(E.bracketTax(150, tbl).tax, 5);
  assert.equal(E.bracketTax(150, null), null); assert.equal(E.bracketTax(-1, tbl), null);
  const src = fs.readFileSync(path.join(ROOT, 'lib/deal/engine.js'), 'utf8');
  assert.ok(!/1978745|2347040|6055070/.test(src), 'no tax table in the engine'); assert.ok(!/fetch\(|XMLHttpRequest|Math\.random|localStorage/.test(src), 'pure');
});
t('the deal rules: each fires on its threshold with value · threshold · source · class, and only then — never a score', () => {
  const ids = (r, c) => E.flags(r, c).map((f) => f.id);
  const r = E.analyze(DEAL());
  const base = ids(r, {});
  assert.ok(base.includes('DL-NEGATIVE-CASHFLOW') && base.includes('DL-DSCR-BELOW-1') && !base.includes('DL-DSCR-BELOW-1-2'));
  const f = E.flags(r, {}).find((x) => x.id === 'DL-DSCR-BELOW-1'); assert.equal(f.threshold, 1); assert.equal(f.kind, 'risk'); assert.equal(f.cls, 'DERIVED'); assert.ok(f.source && f.term);
  const ok = DEAL(); ok.rent.monthly = 9300; const r2 = E.analyze(ok); near(r2.values.dscr, 102420 / r2.values.annualDebtService, 1e-9); assert.ok(r2.values.dscr > 1 && r2.values.dscr < 1.2);
  assert.deepEqual(ids(r2, {}), ['DL-DSCR-BELOW-1-2']);
  /* LTV: 70 % is above the additional-home 50 %, not above the single-home 75 %; equal to the limit does not fire */
  assert.ok(ids(r, { buyer: 'additional' }).includes('DL-LTV-ABOVE-LIMIT')); assert.ok(!ids(r, { buyer: 'single' }).includes('DL-LTV-ABOVE-LIMIT'));
  const at = DEAL(); at.financing.ltvPct = 75; assert.ok(!ids(E.analyze(at), { buyer: 'single' }).includes('DL-LTV-ABOVE-LIMIT'));
  at.financing.ltvPct = 76; assert.ok(ids(E.analyze(at), { buyer: 'single' }).includes('DL-LTV-ABOVE-LIMIT'));
  assert.deepEqual([E.RULES.ltv.single, E.RULES.ltv.replacement, E.RULES.ltv.additional], [75, 70, 50]); assert.match(E.RULES.ltv.source, /Directive 329/); assert.match(E.RULES.ltv.basis, /check the directive/);
  /* comparables: asking ₪25,000/m² vs a SUPPORTED P75 of ₪24,000 fires; a LIMITED level never carries percentiles */
  const pc = { level: 'STREET', state: 'SUPPORTED', p25: 20000, p75: 24000, n: 12 };
  const fa = E.flags(r, { comps: { percentile: pc } }).find((x) => x.id === 'DL-ASK-ABOVE-P75'); assert.equal(fa.value, 25000); assert.equal(fa.threshold, 24000); assert.equal(fa.level, 'STREET');
  assert.ok(!ids(r, { comps: { percentile: { ...pc, state: 'LIMITED' } } }).includes('DL-ASK-ABOVE-P75'));
  assert.ok(ids(r, { comps: { street: { state: 'INSUFFICIENT', n: 3 } } }).includes('DL-COMPS-THIN')); assert.ok(!ids(r, { comps: { street: { state: 'LIMITED', n: 6 } } }).includes('DL-COMPS-THIN'));
  assert.ok(ids(r, { freshness: { state: 'STALE' } }).includes('DL-EVIDENCE-STALE')); assert.ok(!ids(r, { freshness: { state: 'CURRENT' } }).includes('DL-EVIDENCE-STALE'));
  assert.ok(ids(r, { model: { available: false, reason: 'type-not-modelled' } }).includes('DL-MODEL-UNAVAILABLE'));
  assert.ok(ids(r, { model: { available: true, tier: 'LIMITED', value: 1 } }).includes('DL-MODEL-LIMITED'));
  assert.ok(ids(r, { model: { available: true, tier: 'STRONG', value: 1800000, range: { lo: 1500000, hi: 1900000 } } }).includes('DL-ASK-ABOVE-MODEL-RANGE'));
  assert.ok(ids(r, { officialRate: { value: 6.0 } }).includes('DL-RATE-VS-OFFICIAL')); assert.ok(!ids(r, { officialRate: { value: 4.62 } }).includes('DL-RATE-VS-OFFICIAL'));
  for (const fl of E.flags(r, { buyer: 'additional', freshness: { state: 'STALE' }, comps: { percentile: pc, street: { state: 'NONE', n: 0 } }, officialRate: { value: 6 }, concentration: { share: 60 } })) {
    assert.ok(['risk', 'watch', 'info'].includes(fl.kind)); assert.ok(!('score' in fl) && !('probability' in fl)); assert.ok(X.SIGNAL_RULES[fl.id], 'a registry rule for ' + fl.id); assert.ok(X.term(fl.term), fl.term);
  }
  assert.equal(E.percentile([10, 20, 30, 40], 25), 50); assert.equal(E.percentile([], 25), null);
});

console.log('deal-lab: the read model (real data)');
const STREETS = ['st:7900:213', 'st:3000:612', 'st:5000:813'];
const SNAP = (() => { const S = EV.store(); return require('../lib/gov/freshness').isoDay(require('../lib/gov/freshness').ts(S.meta.source.scrapedAt)); })();
const today = new Date().toISOString().slice(0, 10);
/* every comparable is a whole-property priced dwelling deal of the register copy, dated, sourced, within the filter */
function checkRows(C, f) {
  const shard = EV.shardOf(Number(C.id.split(':')[1]));
  const byKey = new Map();
  for (const x of EV.dealsOf(shard)) { const d = x.deal; byKey.set(`${C.id.split(':')[1]}|${d.date}|${d.gush}/${d.helka}/${d.subParcel == null ? '—' : d.subParcel}|${d.amount}`, d); }
  for (const r of C.rows) {
    const d = byKey.get(r.key); assert.ok(d, 'the comparable is a register deal ' + r.key);
    assert.ok(d.dwelling && EV.DWELLING_NATURES.has(EV.natureKey(r.nature)), 'a dwelling ' + r.nature);
    assert.equal(d.portionFraction, 1, 'never a partial share'); assert.ok(!d.partialSale && !d.portionMissing);
    assert.ok(!(d.sameConsideration > 1), 'never several units for one consideration');
    assert.ok(r.date && r.date <= SNAP && r.date <= today, 'never future-dated');
    assert.ok(r.price >= 100000 && r.pricePerSqm != null && r.areaSqm >= 20, 'priced, with a usable area');
    assert.equal(r.source, 'over:deals-register'); assert.equal(r.snapshotDate, SNAP); assert.equal(r.cls, 'OBSERVED'); assert.ok(L.LEVELS.includes(r.level));
    assert.equal(r.floor, null, 'the register carries no floor');
    if (f && f.sqm) assert.ok(Math.abs(r.areaSqm - f.sqm) / f.sqm <= f.sizeTol / 100 + 1e-9, 'within the size band');
    if (f && f.rooms) assert.ok(r.rooms != null && Math.abs(r.rooms - f.rooms) <= f.roomsTol + 1e-9, 'within the rooms band');
  }
}
function checkCounts(C) {
  for (const l of C.levels) {
    if (!l.used) { assert.ok(l.reason, l.level + ' unused with a reason'); continue; }
    assert.equal(l.universe, l.included + Object.values(l.excluded).reduce((a, b) => a + b, 0), `${C.id} ${l.level}: universe = included + Σ excluded`);
    assert.equal(l.excludedTotal, l.universe - l.included);
    assert.equal(l.stats.n, l.included); assert.equal(l.stats.state, L.sampleState(l.included));
    assert.equal(C.rows.filter((r) => r.level === l.level).length, Math.min(l.included, l.rowsShown));
    if (l.stats.state === 'SUPPORTED') assert.ok(l.stats.p25 <= l.stats.medianPpsqm && l.stats.medianPpsqm <= l.stats.p75);
    else { assert.equal(l.stats.p25, null); assert.equal(l.stats.askPercentile, null, 'no percentile below SUPPORTED'); }
    if (l.stats.state === 'INSUFFICIENT' || l.stats.state === 'NONE') assert.equal(l.stats.medianPpsqm, null, 'no ₪/m² figure below LIMITED');
  }
  /* each transaction of the locality in exactly one level */
  assert.equal(C.levels.reduce((a, l) => a + (l.universe || 0), 0), C.totals.transactions);
  assert.equal(Object.values(C.totals.byLevel).reduce((a, b) => a + b, 0), C.totals.transactions);
}
t('st:7900:213 (הרצל, פתח תקווה): the unfiltered street level IS the street evidence\'s own priced sample; its universe = observed + possible + non-dwelling', () => {
  const C = L.comps('st:7900:213', {}), ev = EV.street('st:7900:213');
  assert.ok(C.available); const s = C.levels[0];
  assert.equal(s.level, 'STREET'); assert.equal(s.included, ev.stats.withSqm, 'the priced deals with a ₪/m²');
  assert.equal(s.universe, ev.deals.length + ev.possible.length + ev.nonDwelling.count);
  /* every POSSIBLE deal is excluded (never a comparable); a non-dwelling is counted once, under the first rule it fails */
  assert.ok(s.excluded.NOT_OBSERVED_ON_STREET >= ev.possible.length);
  assert.equal(s.excluded.NOT_OBSERVED_ON_STREET + s.excluded.NON_DWELLING, ev.possible.length + ev.nonDwelling.count);
  assert.equal(s.excluded.PARTIAL_SHARE, ev.deals.filter((d) => d.partialSale).length);
  assert.equal(s.excluded.SEVERAL_UNITS_ONE_PRICE, ev.deals.filter((d) => !d.partialSale && !d.portionMissing && d.sameConsideration > 1).length);
  assert.equal(s.excluded.FUTURE_DATED, 0);
  checkCounts(C); checkRows(C);
  assert.ok(C.levels.slice(1).every((l) => !l.used && l.reason), 'a SUPPORTED street needs no wider level');
});
t('the similarity filter on three streets of different sizes: every comparable inside the bands, the counts add up, states on the street thresholds', () => {
  const f = { sqm: 85, rooms: 3.5, sizeTol: 25, roomsTol: 1 };
  const seen = {};
  for (const id of STREETS) {
    const C = L.comps(id, f); assert.ok(C.available, id);
    checkCounts(C); checkRows(C, f);
    seen[id] = C.levels[0].stats.state;
    assert.ok(C.rows.every((r, i) => i === 0 || r.level !== C.rows[i - 1].level || r.date <= C.rows[i - 1].date), 'newest first within a level');
  }
  assert.ok(new Set(Object.values(seen)).size >= 2, 'the three streets differ in size: ' + JSON.stringify(seen));
  const C = L.comps('st:7900:213', { ...f, ask: 2100000 });
  assert.equal(C.primary.level, 'STREET'); assert.equal(C.primary.askPpsqm, Math.round(2100000 / 85));
  assert.ok(C.primary.askPercentile >= 0 && C.primary.askPercentile <= 100);
});
t('wider levels only below the minimum, each labelled and apart: a thin street (st:3000:1941 המהר"ל מפראג) widens to the blocks touching it', () => {
  const C = L.comps('st:3000:1941', { sqm: 80, rooms: 3 });
  const st = C.levels.find((l) => l.level === 'STREET'), bl = C.levels.find((l) => l.level === 'BLOCKS');
  assert.ok(st.included < L.FILTER.minComps); assert.ok(bl.used, 'the blocks level is used'); assert.equal(bl.cls, 'LOCATION-LINKED'); assert.ok(bl.blocks.length >= 1);
  assert.match(bl.basis, /not this street/);
  assert.ok(C.rows.filter((r) => r.level === 'BLOCKS').every((r) => r.levelCls === 'LOCATION-LINKED' && !(r.streets || []).includes('המהר"ל מפראג')));
  checkCounts(C); checkRows(C, { sqm: 80, rooms: 3, sizeTol: 25, roomsTol: 1 });
  assert.equal(C.street.state, st.stats.state, 'the street\'s own state travels apart from the wider level');
  if (st.stats.state === 'INSUFFICIENT' || st.stats.state === 'NONE') { assert.ok(C.primary && C.primary.level === 'BLOCKS', 'the price check names the wider level'); assert.equal(C.primary.cls, 'LOCATION-LINKED'); }
  const big = L.comps('st:3000:1941', { sqm: 80, rooms: 3, min: 1 });
  assert.ok(big.levels.filter((l) => l.level !== 'STREET').every((l) => !l.used), 'with a minimum the street meets, nothing widens');
  const nb = L.comps('st:5000:813', {}); assert.equal(nb.levels.find((l) => l.level === 'NEIGHBOURHOOD').reason, 'no-verified-neighbourhood');
});
t('the period filter cuts at the copy\'s latest deal; a stricter filter never adds a comparable', () => {
  const a = L.comps('st:3000:612', {}), b = L.comps('st:3000:612', { months: 12 }), c = L.comps('st:3000:612', { months: 12, sqm: 70, rooms: 3 });
  const from = EV.minusMonths(EV.store().meta.window.to, 12);
  assert.ok(b.rows.filter((r) => r.level === 'STREET').every((r) => r.date > from));
  assert.ok(b.levels[0].included <= a.levels[0].included && c.levels[0].included <= b.levels[0].included);
  assert.equal(b.levels[0].excluded.OUTSIDE_PERIOD + b.levels[0].included, a.levels[0].included + a.levels[0].excluded.OUTSIDE_PERIOD);
});
t('the model, the official rates, the freshness and the recency: classes and periods as the read models state them', () => {
  const m = L.modelOf('st:7900:213', { sqm: 85, rooms: 3.5 });
  assert.equal(m.cls, 'MODEL'); assert.ok(m.available && m.apartment && m.apartment.value > 0 && m.apartment.range.lo < m.apartment.range.hi); assert.ok(m.tier);
  assert.equal(L.modelOf('st:7900:213', { sqm: 85, type: 'cottage' }).apartmentReason, 'type-not-modelled');
  assert.equal(L.modelOf('st:7900:213', {}).apartmentReason, 'area-not-entered');
  const F = L.financeOf();
  if (F.available) { assert.equal(F.cls, 'OFFICIAL'); const r = F.tracks.find((x) => x.id === 'rateFixedUnindexed'); assert.ok(r.value > 0 && /^\d{4}-\d{2}$/.test(r.period)); assert.equal(F.reference, 'rateFixedUnindexed');
    assert.ok(F.tracks.filter((x) => x.value == null).every((x) => x.cls === 'MISSING' && x.missing), 'an unpublished track is MISSING, never 0'); }
  const fr = L.freshnessOf(); assert.ok(['CURRENT', 'RECENT', 'STALE', 'VERY_STALE', 'SOURCE_LAG_UNKNOWN'].includes(fr.state));
  const rc = L.recencyOf('st:7900:213'); assert.ok(rc.available); assert.ok(rc.notInRegister.every((e) => e.priceUsed === false && e.sourceId !== 'over:deals-register'));
});

console.log('deal-lab: the API (api/intel.js → lib/deal)');
const h = require('../api/intel.js');
const call = (q) => new Promise((r) => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { r({ code: this.statusCode, body: (() => { try { return JSON.parse(b); } catch { return b; } })() }); } }; h({ url: '/api/intel?' + q, method: 'GET', headers: {} }, res); });
t('400 for a malformed id or parameter (never silently replaced); 404 for a street the directory does not hold', async () => {
  for (const [q, param] of [['view=dealLab', 'id'], ['view=dealLab&id=7900:213', 'id'], ['view=dealLab&id=st:7900:213&sqm=abc', 'sqm'], ['view=dealLab&id=st:7900:213&sqm=5', 'sqm'],
    ['view=dealLab&id=st:7900:213&rooms=3.3', 'rooms'], ['view=dealLab&id=st:7900:213&months=40', 'months'], ['view=dealComps&id=st:7900:213&newness=old', 'newness'],
    ['view=dealLab&id=st:7900:213&min=2.5', 'min'], ['view=dealStreet&id=st:7900:213&built=19x', 'built']]) {
    const r = await call(q); assert.equal(r.code, 400, q); assert.equal(r.body.error, 'invalid-param'); assert.equal(r.body.param, param, q);
  }
  const nf = await call('view=dealLab&id=st:1:1'); assert.equal(nf.code, 404);
  const un = await call('view=dealNope&id=st:7900:213'); assert.equal(un.code, 400);
});
t('the shape: dealContext · dealLab · dealComps · dealStreet', async () => {
  const c = await call('view=dealContext'); assert.equal(c.code, 200); assert.ok(c.body.finance && c.body.freshness && c.body.rules.ltv && c.body.filter.sizeTolPct === 25 && c.body.filter.roomsTol === 1 && c.body.filter.months === 36);
  const r = await call('view=dealLab&id=st:7900:213&sqm=85&rooms=3.5&ask=2100000');
  assert.equal(r.code, 200); const b = r.body;
  for (const k of ['identity', 'comps', 'model', 'finance', 'freshness', 'recency', 'rules', 'terms', 'doesNotMean']) assert.ok(b[k] != null, k);
  assert.equal(b.identity.name, 'הרצל'); assert.equal(b.identity.cityCode, 7900); assert.equal(b.identity.cls, 'OFFICIAL');
  assert.ok(b.comps.available && b.comps.rows.length && b.comps.source.snapshotDate && b.comps.fieldNotes.floor);
  assert.match(b.doesNotMean, /not an appraisal, not investment advice/);
  for (const id of b.terms) assert.ok(X.term(id), 'term ' + id);
  const cc = await call('view=dealComps&id=st:5000:813&sqm=70'); assert.equal(cc.code, 200); assert.ok(cc.body.comps.levels.length === 4);
  const s = await call('view=dealStreet&id=st:7900:213'); assert.equal(s.code, 200);
  assert.ok(s.body.available && Array.isArray(s.body.assessment.dueDiligence) && s.body.assessment.dueDiligence.length >= 3);
  assert.ok(s.body.assessment.dueDiligence.every((d) => d.rule && d.he && d.en));
});

console.log('deal-lab: the registry and the page');
t('every term the lab cites exists, in the dealLab group, with simple + example in both languages; the section and the rules are there', () => {
  const terms = new Set([...L.TERMS, ...X.TERMS.filter((x) => x.group === 'dealLab').map((x) => x.id)]);
  assert.ok(terms.size >= 25);
  const bi = (v) => v && typeof v.he === 'string' && typeof v.en === 'string' && v.he.trim() && v.en.trim() && /[֐-׿]/.test(v.he);
  for (const id of terms) { const T = X.term(id); assert.ok(T, id); assert.equal(T.group, 'dealLab', id); assert.ok(bi(T.simple), id + '.simple'); assert.ok(bi(T.example), id + '.example'); }
  assert.ok(X.section('dealLab', 'en').what); assert.ok(X.missing('rentMonthly', 'en')); assert.ok(X.missing('no-shock-entered', 'he'));
  const ui = fs.readFileSync(path.join(ROOT, 'lib/deal/ui.js'), 'utf8');
  for (const m of ui.matchAll(/xp\('([a-z0-9_]+)'\)/g)) assert.ok(X.term(m[1]), 'the page cites ' + m[1]);
  for (const m of ui.matchAll(/xm\('([a-z0-9-]+)'\)/g)) assert.ok(X.missing(m[1]), 'a missing reason for ' + m[1]);
});
t('the registry passes its own gates (test/explain.test.js)', () => {
  const r = require('node:child_process').spawnSync(process.execPath, [path.join(ROOT, 'test/explain.test.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout.split('\n').filter((l) => /✗/.test(l)).join('\n'));
});
t('the page module: he / en parity, the storage key wrapped, the disclaimer, ALTARIS, print, the street-report hook (live build only)', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'lib/deal/ui.js'), 'utf8');
  global.window = {}; global.document = { getElementById: () => null };   /* the module returns early without #dlRoot */
  require('../lib/deal/ui.js'); delete global.window; delete global.document;
  /* the strings object, evaluated on its own: every key (nested) in both languages, every Hebrew string Hebrew */
  const a = ui.indexOf('const STR = {'), b = ui.indexOf('\n  };\n', a);
  const STR = require('node:vm').runInNewContext('(' + ui.slice(a + 'const STR = '.length, b + 4) + ')');
  const walk = (x, y, at) => { for (const k of Object.keys(x)) { assert.ok(k in y, 'english lacks ' + at + k); if (x[k] && typeof x[k] === 'object') walk(x[k], y[k], at + k + '.'); else assert.equal(typeof x[k], typeof y[k], at + k); } };
  walk(STR.he, STR.en, ''); walk(STR.en, STR.he, '');
  const heText = (x) => Object.values(x).flatMap((v) => (v && typeof v === 'object' ? heText(v) : typeof v === 'string' ? [v] : []));
  assert.ok(heText(STR.he).filter((v) => /[A-Za-z]{4,}/.test(v) && !/[\u0590-\u05FF]/.test(v)).every((v) => /^(STRONG|DSCR|NOI|P25–P75|L3 · |—)/.test(v)), 'a Hebrew string in English');
  assert.match(ui, /const KEY = 'propx:deallab:v1'/); assert.match(ui, /try \{ const v = JSON\.parse\(localStorage\.getItem\(KEY\)/); assert.match(ui, /try \{ localStorage\.setItem\(KEY/);
  assert.match(ui, /not an appraisal and not investment advice/i); assert.match(ui, /לא שומה ולא ייעוץ השקעות/);
  assert.match(ui, /href="\/altaris"/); assert.match(ui, /window\.print\(\)/); assert.match(ui, /@media print/); assert.match(ui, /text\/html;charset=utf-8/);
  assert.match(ui, /addEventListener\('propx:lang'/); assert.match(ui, /addEventListener\('propx:geo'/); assert.match(ui, /\/api\/geo\/search/);
  assert.ok(!/score|probability|recommend/i.test(ui.replace(/not a score[^']*|לא ציון[^']*|not a recommendation[^']*|no-score/gi, '')), 'no score / probability / recommendation wording');
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sr = page.slice(page.indexOf('function srHTML(g){'), page.indexOf('function srSummaryText(R){'));
  assert.match(sr, /el\("dealLab"\)\?`<p><button type="button" class="chip" data-srdeal="\$\{ldE\(I\.id\)\}"/); assert.match(sr, /Analyse this deal in the Deal Lab/);
  assert.match(page, /<!-- live:begin --><script src="\/lib\/deal\/ui\.js"><\/script>/);
  const off = fs.readFileSync(path.join(ROOT, 'standalone/israel-new-homes-v2.html'), 'utf8');
  assert.ok(!off.includes('/lib/deal/') && !off.includes('id="dealLab"'), 'the offline build carries no Deal Lab');
});

Promise.all(pending).then(() => {
  console.log(`deal-lab: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
});
