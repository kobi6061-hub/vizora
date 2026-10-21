'use strict';
/* PROPX · OVERNIGHT QA (workstream F, 21.10.2026) — an independent verification of the Deal Decision Lab (lib/deal) and What Changed
 * Here? (lib/changes), written apart from their own gates (test/deal-lab.test.js · test/changes.test.js).
 *
 *   A  FORMULAS   the engine against REFERENCE implementations written here (closed forms — never lib/deal/engine.js for an expected
 *                 value) over a grid of prices · rates incl. 0 % · terms 5–30 years · LTV / down payment / cash · rents · vacancy ·
 *                 management; the sensitivity cells, the rent × rate grid and the scenarios re-derived; the purchase-tax bracket fill
 *                 against the page's own NH_TAX table (index.html) and the page's nhPurchaseTax; edge cases (missing rent → null with
 *                 the rent named, never 0; no non-finite value on any grid cell). Regressions: a tiny positive rate (1 + r rounded to
 *                 1 → an Infinity payment) and a term under half a month (a silent null).
 *   B  DATA       real data: Deal Lab comparables re-derived per exclusion rule on streets of four cities (none of them the lab's own
 *                 gate streets), levels never pooled, the thresholds = lib/streets/evidence.js, the model = view=streetApartment, the
 *                 official rate = data/finance/latest.json; What Changed Here — every item dated twice, sourced, classed, scoped,
 *                 newness recomputed, CBS / source-state figures never on a street scope, the anchor = the newest stored observation,
 *                 transaction counts = the transaction-events union (street · locality) and the events index (district · Israel) for
 *                 30 / 90 / 365 days. Regressions: POSSIBLE DUPLICATE counts per SELECTED period; no phantom locality code 0.
 *   C  SECURITY   hostile parameters (injection-ish, huge, negative, unicode, long, traversal) → 400 / 404, never 500, no stack trace
 *                 or path in a body, GET only, the offline build carries neither feature.
 * Run: node test/overnight-qa.test.js */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const E = require('../lib/deal/engine');
const L = require('../lib/deal');
const C = require('../lib/changes');
const EV = require('../lib/streets/evidence');
const FRESH = require('../lib/gov/freshness');
const TX = require('../lib/txevents');
const h = require('../api/intel.js');

let passed = 0, failed = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);
const near = (a, b, tol, what) => assert.ok(a != null && Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what || ''} ${a} ≉ ${b}`);
const call = (q, method = 'GET') => new Promise((r) => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { r({ code: this.statusCode, raw: String(b == null ? '' : b), body: (() => { try { return JSON.parse(b); } catch { return b; } })() }); } }; h({ url: '/api/intel?' + q, method, headers: {} }, res); });

/* ───────────────────────── A · the reference implementations (closed forms, written here) ───────────────────────── */
const R = {
  pmt(P, ratePct, years) { const n = Math.round(years * 12), r = ratePct / 1200; if (P === 0) return 0; if (r === 0) return P / n; return P * r / (1 - Math.pow(1 + r, -n)); },
  /* the balance after k payments, by the closed form (never by running the engine's schedule) */
  balance(P, ratePct, years, k) { const r = ratePct / 1200, p = R.pmt(P, ratePct, years); return r === 0 ? P - p * k : P * Math.pow(1 + r, k) - p * (Math.pow(1 + r, k) - 1) / r; },
  deal(d) {
    const price = d.price, costs = Object.values(d.costs).reduce((a, b) => a + b, 0), f = d.financing, n = Math.round(f.years * 12);
    const loan = f.mode === 'cash' ? 0 : f.mode === 'ltv' ? price * f.ltvPct / 100 : price - f.downPayment;
    const pay = loan > 0 ? R.pmt(loan, f.ratePct, f.years) : 0, ds = 12 * pay;
    const Rn = d.rent, egi = 12 * Rn.monthly * (1 - Rn.vacancyPct / 100);
    const noi = egi - (12 * Rn.maintenance + egi * Rn.managementPct / 100 + Rn.insurance + 12 * Rn.otherOpex), cf = noi - ds, eq = price - loan + costs;
    return { loan, pay, ds, noi, cf, cfm: cf / 12, costs, eq, totalInterest: loan > 0 ? pay * n - loan : 0, gross: 12 * Rn.monthly / price * 100, net: noi / (price + costs) * 100,
      coc: eq > 0 ? cf / eq * 100 : null, dscr: ds > 0 ? noi / ds : null, ltv: loan / price * 100,
      beRent: (12 * Rn.maintenance + Rn.insurance + 12 * Rn.otherOpex + ds) / (12 * (1 - Rn.vacancyPct / 100) * (1 - Rn.managementPct / 100)) };
  },
  /* the break-even price for a target cash-on-cash T — CLOSED FORMS (NOI does not depend on the price; costs are ₪ amounts held):
       cash  NOI / (p + C) = t                       → p = NOI / t − C
       LTV   (NOI − k·L·p) / ((1 − L)·p + C) = t     → p = (NOI − t·C) / (k·L + t·(1 − L))     k = 12 × the payment per ₪1 of loan
       down  (NOI − k·(p − D)) / (D + C) = t         → p = D + (NOI − t·(D + C)) / k */
  breakEven(d, T) {
    const x = R.deal(d), t = T / 100, f = d.financing, k = 12 * R.pmt(1, f.ratePct, f.years);
    if (f.mode === 'cash') return x.noi / t - x.costs;
    if (f.mode === 'ltv') { const Lv = f.ltvPct / 100; return (x.noi - t * x.costs) / (k * Lv + t * (1 - Lv)); }
    return f.downPayment + (x.noi - t * (f.downPayment + x.costs)) / k;
  },
  /* the purchase tax: each slice of the price inside a bracket at that bracket's rate */
  tax(price, brackets) { let lo = 0, tax = 0; for (const [hi, rate] of brackets) { const top = Math.min(price, hi); if (top > lo) tax += (top - lo) * rate / 100; lo = hi; } return tax; },
};
const mkDeal = (o) => ({ price: o.price, sqm: 85, costs: { tax: Math.round(o.price * 0.025), legal: 9000, broker: 25000, renovation: 0, other: 1200 },
  financing: o.fin, rent: { monthly: o.rent, vacancyPct: o.vac, maintenance: 320, managementPct: o.mg, insurance: 1600, otherOpex: 90 }, targetCocPct: o.T });
function grid() {
  const out = []; let i = 0;
  for (const price of [480000, 1850000, 4200000, 11500000]) for (const rate of [0, 0.75, 4.62, 7.5]) for (const years of [5, 12, 25, 30])
    for (const fin of [{ mode: 'ltv', ltvPct: 50 }, { mode: 'ltv', ltvPct: 75 }, { mode: 'down', frac: 0.3 }, { mode: 'cash' }]) for (const rent of [3200, 9800]) for (const vac of [0, 6]) {
      const f = fin.mode === 'down' ? { mode: 'down', downPayment: Math.round(price * fin.frac), ratePct: rate, years } : fin.mode === 'ltv' ? { ...fin, ratePct: rate, years } : { mode: 'cash', ratePct: rate, years };
      out.push(mkDeal({ price, fin: f, rent, vac, mg: i % 3 === 0 ? 7 : 0, T: [-2, 1, 3.5][i++ % 3] }));
    }
  return out;
}

t('A1 · annuity, total interest and the schedule closing at 0 — the engine against the closed forms, rates 0 – 12 %, terms 5 – 30 years', () => {
  let n = 0;
  for (const P of [150000, 1000000, 2735000, 9000000]) for (const rate of [0, 0.01, 1.5, 4.5, 4.62, 6.25, 12]) for (const years of [5, 7.5, 10, 15, 20, 25, 30]) {
    const p = E.annuity(P, rate, years), ref = R.pmt(P, rate, years);
    near(p, ref, 1e-10, `PMT ${P} ${rate}% ${years}y`);
    const A = E.amortization(P, rate, years), months = Math.round(years * 12);
    assert.equal(A.months, months);
    /* PMT × n − P cancels: the tolerance scales with the amounts paid, not with the (small) interest */
    assert.ok(Math.abs(A.totalInterest - (ref * months - P)) <= 1e-9 * P * months / 12, 'total interest = PMT × n − P');
    assert.equal(A.byYear[A.byYear.length - 1].closing, 0, 'the schedule closes at 0');
    assert.ok(Math.abs(R.balance(P, rate, years, months)) < 1e-4 * P, 'the closed-form balance after n payments is 0');
    /* the engine's balance at the end of each year = the closed-form balance after 12·y payments */
    A.byYear.slice(0, -1).forEach((y, i) => near(y.closing, R.balance(P, rate, years, Math.min(12 * (i + 1), months)), 1e-7, `balance y${i + 1}`));
    n++;
  }
  assert.equal(n, 196);
  near(E.annuity(1000000, 4.5, 25), 5558.32, 1e-6, 'the documented case');
});

t('A2 · loan · NOI · cash flow · gross / net yield · cash-on-cash · DSCR · break-even rent · break-even price — 1,024 deals against the closed forms', () => {
  let n = 0;
  for (const d of grid()) {
    const r = E.analyze(d), v = r.values, x = R.deal(d);
    assert.deepEqual(r.invalid, []);
    for (const [k, ref] of [['loan', x.loan], ['monthlyPayment', x.pay], ['annualDebtService', x.ds], ['noi', x.noi], ['cashFlowMonthly', x.cfm], ['grossYieldPct', x.gross], ['netYieldPct', x.net],
      ['ltvPct', x.ltv], ['breakEvenRentMonthly', x.beRent], ['equity', x.eq]]) near(v[k], ref, 1e-9, k + ' ' + JSON.stringify(d.financing));
    assert.ok(Math.abs(v.totalInterest - x.totalInterest) <= 1e-9 * d.price * 30, 'total interest');
    if (x.coc == null) assert.equal(v.cashOnCashPct, null); else near(v.cashOnCashPct, x.coc, 1e-9, 'CoC');
    if (x.dscr == null) { assert.equal(v.dscr, null); assert.equal(r.notApplicable.dscr, 'no-debt', 'no loan → DSCR not applicable, never ∞'); } else near(v.dscr, x.dscr, 1e-9, 'DSCR');
    /* the break-even price: the engine's bisection within ₪2 of the closed form, or null exactly where the closed form is out of reach */
    const be = R.breakEven(d, d.targetCocPct), lo = d.financing.mode === 'down' ? d.financing.downPayment : 1;
    if (v.breakEvenPrice != null) assert.ok(Math.abs(v.breakEvenPrice - be) <= 2, `break-even ${v.breakEvenPrice} vs ${be}`);
    else assert.ok(!Number.isFinite(be) || be < lo || be > 10 * d.price, `break-even null but the closed form gives ${be} (${r.notApplicable.breakEvenPrice})`);
    n++;
  }
  assert.equal(n, 1024);
});

t('A3 · sensitivity (rent ±10/20 %, rate ±1/2 pp, price ±5/10 %) and the rent × rate grid — every cell re-derived; the scenarios = the base with the shocks', () => {
  let cells = 0;
  for (const d of grid().filter((_, i) => i % 7 === 0)) {
    const s = E.sensitivity(d);
    for (const step of s.rent) { const x = R.deal({ ...d, rent: { ...d.rent, monthly: d.rent.monthly * (1 + step.delta / 100) } }); near(step.values.cashFlowMonthly, x.cfm, 1e-9, 'rent cell'); if (x.dscr != null) near(step.values.dscr, x.dscr, 1e-9); cells++; }
    for (const step of s.rate) {
      if (d.financing.mode === 'cash') { assert.equal(step.values, null); assert.equal(step.reason, 'no-loan'); continue; }
      if (d.financing.ratePct + step.delta < 0) { assert.equal(step.values, null); assert.equal(step.reason, 'rate-below-zero'); continue; }
      near(step.values.cashFlowMonthly, R.deal({ ...d, financing: { ...d.financing, ratePct: d.financing.ratePct + step.delta } }).cfm, 1e-9, 'rate cell'); cells++;
    }
    for (const step of s.price) {
      /* the same LTV, or the same down-payment amount; costs held at their ₪ amounts (stated by the engine) */
      const x = R.deal({ ...d, price: d.price * (1 + step.delta / 100) });
      near(step.values.cashFlowMonthly, x.cfm, 1e-9, 'price cell'); near(step.values.netYieldPct, x.net, 1e-9, 'price cell net yield'); cells++;
    }
    if (s.grid) s.grid.rows.forEach((dr, i) => s.grid.cols.forEach((di, j) => {
      const c = s.grid.cells[i][j];
      if (d.financing.ratePct + di < 0) { assert.equal(c, null); return; }
      near(c, R.deal({ ...d, rent: { ...d.rent, monthly: d.rent.monthly * (1 + dr / 100) }, financing: { ...d.financing, ratePct: d.financing.ratePct + di } }).cfm, 1e-9, 'grid cell'); cells++;
    }));
    const sc = E.scenarios(d, { downside: { rentPct: -12, vacancyPp: 3, ratePp: 1.25, opexPct: 15 }, upside: { rentPct: 6 } });
    const dn = { ...d, rent: { ...d.rent, monthly: d.rent.monthly * 0.88, vacancyPct: d.rent.vacancyPct + 3, maintenance: d.rent.maintenance * 1.15, insurance: d.rent.insurance * 1.15, otherOpex: d.rent.otherOpex * 1.15 },
      financing: { ...d.financing, ratePct: d.financing.ratePct + 1.25 } };
    near(sc.downside.values.cashFlowMonthly, R.deal(dn).cfm, 1e-9, 'downside');
    near(sc.upside.values.cashFlowMonthly, R.deal({ ...d, rent: { ...d.rent, monthly: d.rent.monthly * 1.06 } }).cfm, 1e-9, 'upside (only the rent shocked)');
    near(sc.base.values.cashFlowMonthly, R.deal(d).cfm, 1e-9, 'base');
  }
  assert.ok(cells > 1500, cells + ' cells');
});

t('A4 · purchase tax: the engine\'s bracketTax and the page\'s nhPurchaseTax with the page\'s own NH_TAX = the slice-by-slice reference; worked cases by hand', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = page.indexOf('const NH_TAX='), b = page.indexOf('const NH_IN=');
  assert.ok(a > 0 && b > a, 'NH_TAX + nhPurchaseTax in index.html');
  const ctx = {}; vm.runInNewContext(page.slice(a, b) + '\nthis.NH_TAX = NH_TAX; this.nhPurchaseTax = nhPurchaseTax;', ctx);
  const T = ctx.NH_TAX;
  assert.deepEqual(T.single.map((x) => x[0]).slice(0, 4), [1978745, 2347040, 6055070, 20183565], 'the single-home brackets (16.01.2025 – 15.01.2028)');
  assert.deepEqual(T.single.map((x) => x[1]), [0, 3.5, 5, 8, 10]); assert.deepEqual(T.additional.map((x) => x[1]), [8, 10]);
  for (const kind of ['single', 'additional']) for (let p = 0; p <= 30000000; p += 7919) {
    const ref = R.tax(p, T[kind]);
    near(E.bracketTax(p, T[kind]).tax, ref, 1e-9, `engine ${kind} ${p}`); near(ctx.nhPurchaseTax(p, kind).tax, ref, 1e-9, `page ${kind} ${p}`);
  }
  /* by hand: ₪2,100,000 single = 121,255 × 3.5 % = 4,243.93; ₪3,150,000 single = 368,295 × 3.5 % + 802,960 × 5 % = 53,038.33;
     ₪25,000,000 single = 12,890.33 + 185,401.50 + 1,130,279.60 + 481,643.50 = 1,810,214.93; ₪5,000,000 additional = 400,000 */
  near(E.bracketTax(2100000, T.single).tax, 4243.925, 1e-9); near(E.bracketTax(3150000, T.single).tax, 53038.325, 1e-9);
  near(E.bracketTax(25000000, T.single).tax, 1810214.925, 1e-9); near(E.bracketTax(5000000, T.additional).tax, 400000, 1e-9);
  assert.equal(E.bracketTax(1978745, T.single).tax, 0, 'the first bracket is exempt up to its bound');
});

t('A5 · edge cases: missing rent → null with the rent named (never 0); blank ≠ 0; no NaN / ±Infinity anywhere on the grid or its sensitivity / scenarios', () => {
  const d = mkDeal({ price: 2000000, fin: { mode: 'ltv', ltvPct: 60, ratePct: 4.5, years: 25 }, rent: 7000, vac: 5, mg: 0, T: 2 });
  for (const blank of [null, '', undefined, 'abc', 'NaN', 'Infinity', '1e400']) {
    const r = E.analyze({ ...d, rent: { ...d.rent, monthly: blank } });
    for (const k of ['noi', 'cashFlowMonthly', 'grossYieldPct', 'netYieldPct', 'cashOnCashPct', 'dscr']) { assert.equal(r.values[k], null, `${k} with rent ${blank}`); assert.ok(r.missing[k].includes('rentMonthly'), k + ' names the rent'); }
    assert.ok(r.values.monthlyPayment > 0 && r.values.breakEvenRentMonthly > 0, 'financing and the break-even rent need no rent');
  }
  assert.equal(E.analyze({ ...d, rent: { ...d.rent, monthly: 0 } }).values.grossYieldPct, 0, 'an explicit 0 is a value');
  const bad = [];
  const scan = (o, at) => { if (o == null) return; if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(at); return; } if (typeof o === 'object') for (const [k, v] of Object.entries(o)) scan(v, at + '.' + k); };
  for (const g of grid()) { const r = E.analyze(g); scan(r.values, 'values'); scan(E.sensitivity(g), 'sens'); scan(E.scenarios(g, { downside: { rentPct: -20, ratePp: 2 }, upside: { vacancyPp: -5 } }), 'scen'); }
  assert.deepEqual(bad.slice(0, 5), [], 'non-finite values');
});

t('A6 · regression: a tiny positive rate no longer rounds 1 + r to 1 (an Infinity payment); the payment → principal ÷ n continuously', () => {
  for (const rate of [1e-300, 1e-16, 1e-12, 1e-9]) {
    const p = E.annuity(1400000, rate, 25);
    assert.ok(Number.isFinite(p), `rate ${rate}: ${p}`); near(p, 1400000 / 300, 1e-6, `rate ${rate} ≈ the 0 % payment`);
    const r = E.analyze(mkDeal({ price: 2000000, fin: { mode: 'ltv', ltvPct: 70, ratePct: rate, years: 25 }, rent: 7000, vac: 5, mg: 0, T: 2 }));
    assert.ok(Number.isFinite(r.values.cashFlowMonthly) && Number.isFinite(r.values.dscr), 'cash flow and DSCR finite');
  }
  /* the stable form equals the textbook one wherever the textbook one is well conditioned */
  for (const rate of [0.1, 1, 4.5, 12, 30]) near(E.annuity(1000000, rate, 30), R.pmt(1000000, rate, 30), 1e-10, 'rate ' + rate);
});

t('A7 · regression: a term shorter than half a month (0 payments) is refused and named — never a silent "—"', () => {
  const r = E.analyze(mkDeal({ price: 2000000, fin: { mode: 'ltv', ltvPct: 70, ratePct: 4.5, years: 0.04 }, rent: 7000, vac: 5, mg: 0, T: 2 }));
  assert.ok(r.invalid.includes('years'), 'years invalid'); assert.equal(r.values.monthlyPayment, null);
  assert.ok((r.missing.monthlyPayment || []).includes('years'), 'the payment names the term');
  const ok = E.analyze(mkDeal({ price: 2000000, fin: { mode: 'ltv', ltvPct: 70, ratePct: 4.5, years: 1 / 12 }, rent: 7000, vac: 5, mg: 0, T: 2 }));
  assert.deepEqual(ok.invalid, []); near(ok.values.monthlyPayment, 1400000 * (0.045 / 12) / (1 - Math.pow(1 + 0.045 / 12, -1)), 1e-9, 'one payment');
});

/* ───────────────────────── B · data truth on real data ───────────────────────── */
const STREETS = [['st:4000:228', { sqm: 100, rooms: 4 }], ['st:9000:633', { sqm: 110, rooms: 4.5 }], ['st:70:138', { sqm: 90, rooms: 4 }], ['st:7400:609', {}], ['st:3000:1941', { sqm: 80, rooms: 3 }]];
const SNAP = FRESH.isoDay(FRESH.ts(EV.store().meta.source.scrapedAt));
const TODAY = new Date().toISOString().slice(0, 10);

t('B1 · Deal Lab comparables: the STREET funnel re-derived rule by rule; every row a whole-property priced dwelling deal; levels apart; thresholds = the street evidence\'s', () => {
  assert.deepEqual([L.sampleState(10), L.sampleState(9), L.sampleState(5), L.sampleState(4), L.sampleState(1), L.sampleState(0)], ['SUPPORTED', 'LIMITED', 'LIMITED', 'INSUFFICIENT', 'INSUFFICIENT', 'NONE']);
  assert.deepEqual([E.RULES.sample.SUPPORTED, E.RULES.sample.LIMITED], [EV.SAMPLE.SUPPORTED, EV.SAMPLE.LIMITED]);
  for (const [id, f] of STREETS) {
    const Cm = L.comps(id, f), code = Number(id.split(':')[1]), sc = Number(id.split(':')[2]);
    assert.ok(Cm.available, id);
    const byKey = new Map();
    for (const x of EV.dealsOf(EV.shardOf(code))) { const d = x.deal; byKey.set(`${code}|${d.date}|${d.gush}/${d.helka}/${d.subParcel == null ? '—' : d.subParcel}|${d.amount}`, x); }
    /* the funnel, written here */
    const cutoff = EV.minusMonths(Cm.window.to, 36), mine = Object.fromEntries(L.EXCLUSIONS.map((k) => [k, 0])); let incl = 0;
    for (const x of byKey.values()) {
      if (!x.streets.some((s) => s.code === sc)) continue;
      const d = x.deal;
      const why = d.match !== 'OBSERVED' ? 'NOT_OBSERVED_ON_STREET' : !d.dwelling ? 'NON_DWELLING' : d.date > SNAP || d.date > TODAY ? 'FUTURE_DATED' : d.partialSale ? 'PARTIAL_SHARE'
        : d.portionMissing ? 'SHARE_NOT_STATED' : d.sameConsideration > 1 ? 'SEVERAL_UNITS_ONE_PRICE' : d.amount == null || d.notMarket ? 'BELOW_MARKET_OR_NO_AMOUNT' : !d.priced ? 'NOT_PRICED'
        : d.pricePerSqm == null ? 'NO_USABLE_AREA' : !(d.date > cutoff) ? 'OUTSIDE_PERIOD' : f.sqm && Math.abs(d.areaSqm - f.sqm) / f.sqm > 0.25 + 1e-9 ? 'SIZE_OUTSIDE'
        : f.rooms && d.rooms == null ? 'ROOMS_NOT_STATED' : f.rooms && Math.abs(d.rooms - f.rooms) > 1 + 1e-9 ? 'ROOMS_OUTSIDE' : null;
      if (why) mine[why]++; else incl++;
    }
    const S0 = Cm.levels[0];
    assert.equal(S0.included, incl, id + ' included'); assert.deepEqual(S0.excluded, mine, id + ' excluded per rule');
    for (const row of Cm.rows) {
      const x = byKey.get(row.key); assert.ok(x, 'a register deal ' + row.key); const d = x.deal;
      assert.ok(d.dwelling && d.portionFraction === 1 && !(d.sameConsideration > 1) && d.priced && d.amount >= 100000 && row.date <= SNAP && row.date <= TODAY, 'a whole-property priced dwelling deal, not future-dated ' + row.key);
      assert.equal(row.level !== 'STREET', !x.streets.some((s) => s.code === sc), 'a street deal never at a wider level');
    }
    let narrower = 0;
    for (const lv of Cm.levels) {
      if (!lv.used) continue;
      if (lv.level !== 'STREET') assert.ok(narrower < Cm.filter.minComps, lv.level + ' read only below the minimum');
      assert.equal(lv.universe, lv.included + Object.values(lv.excluded).reduce((a, b) => a + b, 0));
      assert.equal(lv.stats.state, L.sampleState(lv.included));
      const xs = Cm.rows.filter((r) => r.level === lv.level).map((r) => r.pricePerSqm).sort((a, b) => a - b);
      if (xs.length === lv.included && (lv.stats.state === 'SUPPORTED' || lv.stats.state === 'LIMITED')) assert.equal(lv.stats.medianPpsqm, Math.round(EV.quantile(xs, 0.5) / 10) * 10, lv.level + ' median from its own rows only');
      if (lv.stats.state !== 'SUPPORTED') assert.equal(lv.stats.askPercentile, null);
      narrower += lv.included;
    }
  }
});

t('B2 · the model = view=streetApartment for the same apartment; the official rate = data/finance/latest.json (every track)', async () => {
  const FIN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/finance/latest.json'), 'utf8'));
  for (const [id, q] of [['st:4000:228', 'sqm=100&rooms=4'], ['st:9000:633', 'sqm=140&rooms=5&type=garden'], ['st:3000:612', 'sqm=95&rooms=4&newness=new'], ['st:5000:813', 'sqm=60&rooms=2&type=roof'], ['st:4000:228', 'sqm=85&type=cottage']]) {
    const a = await call(`view=dealLab&id=${id}&${q}`), b = await call(`view=streetApartment&id=${id}&${q}`);
    assert.equal(a.code, 200); assert.equal(b.code, 200);
    const m = a.body.model;
    assert.equal(m.apartment ? m.apartment.value : null, b.body.apartment ? b.body.apartment.value : null, `${id} ${q}`);
    if (m.apartment) assert.deepEqual(m.apartment.range, b.body.apartment.range);
    else assert.equal(m.apartmentReason, b.body.apartmentReason || b.body.reason, 'the same reason');
    for (const tr of a.body.finance.tracks) { const x = FIN.measures[tr.id]; if (x && x.latest) { assert.equal(tr.value, x.latest.value, tr.id); assert.equal(tr.period, x.latest.period, tr.id); } }
  }
});

const feed = (p) => { const r = C.view('changes', p); assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200)); return r.body; };
function every(p) { const out = []; let off = 0; for (;;) { const b = feed({ ...p, limit: '200', offset: String(off) }); out.push(...b.items); if (!b.more || out.length > 4000) return { head: b, items: out }; off += 200; } }
const GEOS = ['st:4000:228', 'st:9000:633', 'st:70:138', 'st:7400:609', 'st:5000:813', 'loc:4000', 'loc:5000', 'loc:3000', 'd-haifa', 'd-center'];

t('B3 · What Changed Here: every item dated twice, sourced, classed, scoped; newness recomputed from its own dates; no wider figure on a street scope', () => {
  const SC = ['EXACT_STREET', 'NEAR_STREET', 'LOCALITY', 'DISTRICT', 'DISTRICT_CONTEXT', 'NATIONAL', 'NATIONAL_CONTEXT'];
  let n = 0;
  for (const geo of GEOS) for (const period of ['30', '365']) {
    const { head, items } = every({ geo, period });
    const A = head.anchor.day, from = head.period.from, street = geo.startsWith('st:');
    for (const it of items) {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(it.eventDate || (it.eventDateRange && it.eventDateRange.from)), 'eventDate ' + it.id);
      assert.ok(Number.isFinite(Date.parse(it.observedAt)), 'observedAt ' + it.id);
      assert.ok(it.source && it.source.id && it.source.label, 'source ' + it.id); assert.ok(['OFFICIAL', 'OBSERVED', 'DERIVED'].includes(it.cls)); assert.ok(SC.includes(it.scope));
      const obs = it.observedAt.slice(0, 10);
      const want = it.newness === 'REVISION' || it.newness === 'STATE_CHANGE' ? (obs > from && obs <= A ? it.newness : 'OUT')
        : it.rule === 'chg-tx-batch' ? (obs > from && obs <= A && it.eventDateRange.to <= from ? 'NEWLY_OBSERVED_OLDER_EVENT' : 'OUT')
          : it.eventDate > from && it.eventDate <= A ? 'NEW_EVENT' : !it.baseline && obs > from && obs <= A ? 'NEWLY_OBSERVED_OLDER_EVENT' : 'OUT';
      assert.equal(it.newness, want, `${geo} p${period} ${it.id}`);
      assert.ok(!(it.values && it.values.state === 'POSSIBLE_DUPLICATE'), 'a POSSIBLE DUPLICATE is never listed');
      if (['SALES', 'SOURCE_REVISION'].includes(it.kind) || it.rule === 'chg-cbs-construction-period') assert.equal(it.scope, geo.startsWith('d-') ? 'DISTRICT' : 'DISTRICT_CONTEXT', 'CBS series scope ' + it.id);
      if (it.kind === 'SOURCE_STATE') assert.equal(it.scope, 'NATIONAL_CONTEXT');
      if (!street) assert.ok(!/STREET/.test(it.scope), 'a street scope on ' + geo);
      if (street && it.scope === 'EXACT_STREET') assert.ok(['TRANSACTION', 'PLANNING', 'LAND_TENDER', 'URBAN_RENEWAL', 'RENTAL'].includes(it.kind) || /^chg-tlv-/.test(it.rule), 'EXACT_STREET only on a street-keyed record ' + it.id);
      n++;
    }
  }
  assert.ok(n > 8000, n + ' items');
});

t('B4 · the anchor = the newest PROPX observation stored in the files the feed reads (recomputed here from every run log / meta timestamp)', () => {
  const S = require('../lib/changes/stores');
  const KEYS = new Set(['at', 'finishedAt', 'startedAt', 'checkedAt', 'fetchedAt', 'builtAt', 'generatedAt']);
  let best = '';
  const scan = (o, depth) => { if (!o || typeof o !== 'object' || depth > 3) return; for (const [k, v] of Object.entries(o)) { if (KEYS.has(k) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) { if (v > best) best = v; } else if (v && typeof v === 'object' && !Array.isArray(v)) scan(v, depth + 1); } };
  for (const f of Object.values(S.FILES)) { if (f === S.FILES.planTiles) continue; if (f.endsWith('.jsonl')) S.readLines(f).forEach((r) => scan(r, 0)); else if (f.endsWith('.json')) scan(S.readJson(f), 0); }
  const A = C.anchor();
  assert.equal(new Date(Date.parse(A.at)).toISOString(), new Date(Date.parse(best)).toISOString(), 'the anchor is the newest stored observation');
  assert.equal(feed({ geo: 'il', period: '30' }).period.to, best.slice(0, 10));
});

t('B5 · transaction counts reconcile: street / locality = the transaction-events union, district / Israel = the events index — 30 / 90 / 365 days', async () => {
  for (const geo of GEOS.concat('il')) for (const period of [30, 90, 365]) {
    const b = feed({ geo, period: String(period), limit: '1' }), A = b.anchor.day;
    if (geo.startsWith('st:') || geo.startsWith('loc:')) {
      const q = geo.startsWith('st:') ? TX.query({ streetId: geo, days: period, today: A }) : TX.query({ code: Number(geo.slice(4)), days: period, today: A });
      assert.equal(b.kinds.TRANSACTION.counts.NEW_EVENT, q.counts.events, `${geo} ${period}d NEW_EVENT`);
      assert.equal(b.counts.possibleDuplicatesExcluded, q.counts.possibleDuplicates, `${geo} ${period}d possible duplicates of THIS period (regression: it stated the 365-day count)`);
    } else {
      const r = await call(`view=txLatest${geo === 'il' ? '' : '&district=' + geo}&days=${period}&limit=1`);
      const n = Object.entries(r.body.perDay || {}).reduce((a, [d, v]) => a + (d > b.period.from && d <= A ? v : 0), 0);
      assert.equal(b.kinds.TRANSACTION.counts.NEW_EVENT, n, `${geo} ${period}d`);
    }
  }
});

t('B6 · regression: a provisional locality without an official code is no locality — geo=0 / loc:0 → 404, and no plan is placed in "locality 0"', () => {
  for (const g of ['0', 'loc:0']) assert.equal(C.view('changes', { geo: g }).status, 404, g);
  assert.equal(C.view('changes', { city: '0' }).status, 404);
  const P = require('../lib/changes/stores').plans();
  assert.equal((P.byLoc.get(0) || []).length, 0, 'plans pooled under code 0');
  assert.ok(![...P.byLoc.keys()].some((k) => !(k > 0)), 'every plan locality is an official (positive) code');
});

/* ───────────────────────── C · security of the new views ───────────────────────── */
t('C1 · hostile parameters → 400 / 404, never 500; no stack trace or file path in a body; responses bounded', async () => {
  const NASTY = ["'", "' OR 1=1--", '"><script>alert(1)</script>', '../../etc/passwd', '..%2f..%2f', '\u0000', '${7*7}', '__proto__', 'constructor', '-1', '1e400', '9'.repeat(400), 'NaN', 'Infinity', '0x10',
    '٣', '８５', 'רחוב', '🙂', 'a'.repeat(5000), 'st:../../x', 'st:5000:-1', 'loc:../../', 'd-../../', 'nb:../../../etc', 'nb:' + 'a'.repeat(61), 'il‮'];
  const qs = [];
  for (const v of NASTY) { const e = encodeURIComponent(v); qs.push(`view=dealLab&id=${e}`, `view=dealStreet&id=${e}`, `view=dealComps&id=st:5000:813&sqm=${e}`, `view=dealLab&id=st:5000:813&type=${e}`, `view=changes&geo=${e}`, `view=changes&geo=il&period=${e}`, `view=changes&geo=il&kinds=${e}`, `view=changes&geo=il&offset=${e}`, `view=changes&street=${e}`); }
  qs.push('view=dealXyz&id=st:5000:813', 'view=changesXyz', 'view=dealLab&id=st:5000:813&limit=501', 'view=changes&geo=il&limit=201');
  const seen = {};
  for (const q of qs) {
    const r = await call(q);
    seen[r.code] = (seen[r.code] || 0) + 1;
    assert.ok(r.code < 500, `${q.slice(0, 120)} → ${r.code}`);
    assert.ok(!/\bat [\w.<>]+ \(|\/home\/|\/var\/task|node:internal|\.js:\d+/.test(r.raw), 'no stack / path: ' + q.slice(0, 80));
    assert.ok(r.raw.length < 3e6, 'bounded');
  }
  assert.ok(seen[400] > 200 && !seen[500], JSON.stringify(seen));
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) for (const q of ['view=dealLab&id=st:5000:813', 'view=changes&geo=il', 'view=dealContext', 'view=changesMeta']) assert.equal((await call(q, m)).code, 405, m + ' ' + q);
});

t('C2 · the offline build carries neither feature (no section, no module, no API read); the session gate keeps the views behind it', () => {
  const off = fs.readFileSync(path.join(ROOT, 'standalone/israel-new-homes-v2.html'), 'utf8');
  for (const s of ['id="dealLab"', 'id="changes"', 'id="dlRoot"', 'id="chRoot"', 'src="/lib/deal', 'src="/lib/changes', 'PropxDealEngine', 'PropxChanges', 'view=dealContext', 'view=changesMeta', "getJSON('view=deal"]) assert.ok(!off.includes(s), 'offline build carries ' + s);
  /* the two street-report / dossier links that name the sections are rendered only when the section exists (el(...) guard) */
  for (const m of off.matchAll(/href="#changes"/g)) assert.match(off.slice(Math.max(0, m.index - 220), m.index), /el\("chRoot"\)/);
  const gate = fs.readFileSync(path.join(ROOT, 'lib/identity/gate.mjs'), 'utf8');
  assert.ok(!/['"]\/api\/intel['"]/.test(gate.slice(gate.indexOf('PUBLIC_PATHS'), gate.indexOf('PUBLIC_PATHS') + 400)), '/api/intel is not a public path');
});

(async () => {
  for (const [name, fn] of queue) {
    const t0 = Date.now();
    try { await fn(); passed++; console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')}`); }
  }
  console.log(`overnight-qa: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
