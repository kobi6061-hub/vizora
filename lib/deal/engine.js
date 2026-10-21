/* PROPX · DEAL DECISION LAB — the engine (pure, UMD: Node require('lib/deal/engine') · the page window.PropxDealEngine).
 *
 * Arithmetic over the user's own inputs — nothing here reads data, fetches, defaults or guesses:
 *
 *   FINANCING   loan = price × LTV, or price − down payment, or none (cash); the payment is the standard annuity
 *               P·r / (1 − (1 + r)^−n) with r = the nominal annual rate ÷ 12 and n = years × 12 (r = 0 → P ÷ n); a fixed, unindexed
 *               rate — a CPI-indexed or variable track is not modelled (its payments move). Total interest = payment × n − P; the
 *               amortisation summed by year.
 *   PURCHASE    purchase tax · legal · broker · renovation · other — each a ₪ amount the user enters (0 is a value; blank is not).
 *               bracketTax() applies a bracket table the CALLER passes (the page passes its own cited STATIC table) — this file
 *               carries no tax table.
 *   RENT        gross monthly rent − vacancy % = effective income; − maintenance (₪/month) − management (% of collected rent)
 *               − insurance (₪/year) − other (₪/month) = NOI; − debt service = pre-tax cash flow.
 *   METRICS     gross yield = annual rent ÷ price · net yield = NOI ÷ (price + purchase costs) · cash-on-cash = annual pre-tax cash
 *               flow ÷ equity invested (down payment + purchase costs) · DSCR = NOI ÷ annual debt service · break-even rent (cash
 *               flow = 0) · break-even price for a target cash-on-cash (every other input held as entered).
 *   SENSITIVITY rent ±10 / 20 %, rate ±1 / 2 pp, price ±5 / 10 % (one driver at a time) + a rent × rate grid of the monthly cash flow.
 *   SCENARIOS   base = the inputs; downside / upside = the base with the user's explicit shocks (rent %, vacancy pp, rate pp,
 *               operating costs %); a scenario without a shock is not computed.
 *   RULES       deterministic deal flags (trigger · value · threshold · source · class) — never a score, a probability or a
 *               recommendation.
 *
 * A result that needs an input the user did not enter is null, with the inputs it needs listed in `missing` — never a default.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PropxDealEngine = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENGINE = 'propx-deal-engine-1';
  /* the deal rules' thresholds — constants, each with its basis (the registry's SIGNAL_RULES carry the bilingual rule text) */
  const RULES = Object.freeze({
    /* Bank of Israel, Proper Conduct of Banking Business Directive 329 ("Limitations on issuing housing loans"): the maximum
       loan-to-value of a housing loan by the borrower's situation. PROPX states the limits as a rule the user checks against the
       directive in force — they are not read from a synced source. */
    ltv: Object.freeze({ single: 75, replacement: 70, additional: 50,
      source: 'Bank of Israel — Proper Conduct of Banking Business Directive 329 (limitations on issuing housing loans)',
      sourceHe: 'בנק ישראל — הוראת ניהול בנקאי תקין 329 (מגבלות למתן הלוואות לדיור)', url: 'https://www.boi.org.il/',
      basis: 'a rule PROPX states, not a synced source — check the directive in force with the lender' }),
    dscr: Object.freeze({ risk: 1.0, watch: 1.2 }),
    /* the comparables' sample states — the street evidence's own thresholds (lib/streets/evidence.js SAMPLE) */
    sample: Object.freeze({ SUPPORTED: 10, LIMITED: 5 }),
    /* the official-rate comparison: a user rate this far (pp) from the latest Bank of Israel average of the same track is flagged */
    rateGapPp: 1,
  });
  const SENS = Object.freeze({ rent: [-20, -10, 0, 10, 20], rate: [-2, -1, 0, 1, 2], price: [-10, -5, 0, 5, 10] });

  /* ── numbers ── */
  /** a user number: null when blank / not finite (never 0 by default) */
  function num(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).replace(/[,\s₪%]/g, '').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

  /** the monthly annuity payment of `principal` over `years` at a nominal annual rate (percent); 0 % → principal ÷ n */
  function annuity(principal, ratePct, years) {
    const P = num(principal), R = num(ratePct), Y = num(years);
    if (P == null || R == null || Y == null || P < 0 || R < 0 || !(Y > 0)) return null;
    const n = Math.round(Y * 12);
    if (!(n > 0)) return null;
    if (P === 0) return 0;
    const r = R / 100 / 12;
    if (r === 0) return P / n;
    return (P * r) / (1 - Math.pow(1 + r, -n));
  }

  /** the loan's schedule, summed by year: { monthly, months, totalPaid, totalInterest, byYear: [{ year, payments, interest, principal, opening, closing }] } */
  function amortization(principal, ratePct, years) {
    const P = num(principal), R = num(ratePct), Y = num(years);
    const pay = annuity(P, R, Y);
    if (pay == null) return null;
    const n = Math.round(Y * 12), r = R / 100 / 12;
    const byYear = [];
    let bal = P, row = null;
    for (let m = 1; m <= n; m++) {
      if ((m - 1) % 12 === 0) { row = { year: Math.ceil(m / 12), payments: 0, interest: 0, principal: 0, opening: bal, closing: bal }; byYear.push(row); }
      const interest = bal * r;
      /* the last payment closes the balance exactly (the schedule never leaves a rounding residue) */
      const princ = m === n ? bal : pay - interest;
      row.payments += m === n ? interest + princ : pay;
      row.interest += interest; row.principal += princ;
      bal -= princ; row.closing = Math.abs(bal) < 1e-6 ? 0 : bal;
    }
    const totalPaid = byYear.reduce((a, y) => a + y.payments, 0);
    return { monthly: pay, months: n, totalPaid, totalInterest: totalPaid - P, byYear };
  }

  /** purchase tax from a bracket table [[upper bound ₪, rate %], …] the caller supplies (cumulative slices) */
  function bracketTax(price, brackets) {
    const p = num(price);
    if (p == null || p < 0 || !Array.isArray(brackets) || !brackets.length) return null;
    let lo = 0, tax = 0; const slices = [];
    for (const [hiRaw, rate] of brackets) {
      const hi = hiRaw == null ? Infinity : hiRaw;
      const part = Math.max(0, Math.min(p, hi) - lo);
      if (part > 0) { slices.push({ from: lo, to: Math.min(p, hi), rate, amount: (part * rate) / 100 }); tax += (part * rate) / 100; }
      lo = hi; if (p <= hi) break;
    }
    return { tax, slices };
  }

  /* ── the inputs ── */
  const COSTS = ['tax', 'legal', 'broker', 'renovation', 'other'];
  const OPEX = ['vacancyPct', 'maintenance', 'managementPct', 'insurance', 'otherOpex'];
  const MODES = ['down', 'ltv', 'cash'];
  /** the normalized inputs + the invalid ones (a negative amount, a down payment above the price, an LTV above 100 % …) */
  function normalize(inp) {
    const i = inp || {};
    const f = i.financing || {}, c = i.costs || {}, r = i.rent || {};
    const n = {
      price: num(i.price), sqm: num(i.sqm),
      costs: Object.fromEntries(COSTS.map((k) => [k, num(c[k])])),
      financing: { mode: MODES.includes(f.mode) ? f.mode : null, downPayment: num(f.downPayment), ltvPct: num(f.ltvPct), ratePct: num(f.ratePct), years: num(f.years) },
      rent: { monthly: num(r.monthly), vacancyPct: num(r.vacancyPct), maintenance: num(r.maintenance), managementPct: num(r.managementPct), insurance: num(r.insurance), otherOpex: num(r.otherOpex) },
      targetCocPct: num(i.targetCocPct),
    };
    const invalid = [];
    const bad = (cond, k) => { if (cond) invalid.push(k); };
    bad(n.price != null && !(n.price > 0), 'price');
    bad(n.sqm != null && !(n.sqm > 0), 'sqm');
    for (const k of COSTS) bad(n.costs[k] != null && n.costs[k] < 0, k);
    const F = n.financing;
    bad(F.downPayment != null && (F.downPayment < 0 || (n.price != null && F.downPayment > n.price)), 'downPayment');
    bad(F.ltvPct != null && (F.ltvPct < 0 || F.ltvPct > 100), 'ltvPct');
    bad(F.ratePct != null && (F.ratePct < 0 || F.ratePct > 30), 'ratePct');
    bad(F.years != null && !(F.years > 0 && F.years <= 40), 'years');
    const R = n.rent;
    bad(R.monthly != null && R.monthly < 0, 'rentMonthly');
    bad(R.vacancyPct != null && (R.vacancyPct < 0 || R.vacancyPct >= 100), 'vacancyPct');
    bad(R.managementPct != null && (R.managementPct < 0 || R.managementPct >= 100), 'managementPct');
    for (const k of ['maintenance', 'insurance', 'otherOpex']) bad(R[k] != null && R[k] < 0, k);
    for (const k of invalid) {
      if (k === 'price') n.price = null; else if (k === 'sqm') n.sqm = null; else if (COSTS.includes(k)) n.costs[k] = null;
      else if (k in F) F[k] = null; else if (k === 'rentMonthly') R.monthly = null; else if (k in R) R[k] = null;
    }
    return { n, invalid };
  }

  /**
   * The deal's arithmetic.
   * @param inp { price, sqm?, costs: {tax, legal, broker, renovation, other}, financing: {mode: down|ltv|cash, downPayment, ltvPct, ratePct, years},
   *              rent: {monthly, vacancyPct, maintenance (₪/month), managementPct (% of collected rent), insurance (₪/year), otherOpex (₪/month)}, targetCocPct? }
   * @returns { engine, inputs, invalid, values: {…}, missing: { key: [input ids] }, notApplicable: { key: reason }, amortization, cashFlow, opex }
   */
  function analyze(inp, opt) {
    const { n, invalid } = normalize(inp);
    const F = n.financing, R = n.rent, C = n.costs;
    const v = {}, missing = {}, na = {};
    const need = (key, ids) => { const m = ids.filter((x) => x.missing); if (m.length) { missing[key] = [...new Set(m.map((x) => x.id))]; return false; } return true; };
    const M = (id, val) => ({ id, missing: val == null });
    const dep = (id, key) => ({ id, missing: v[key] == null, from: key });
    const inheritMissing = (key, keys, own) => {   /* the union of the inputs each upstream result needs */
      const ids = new Set(own || []);
      for (const k of keys) if (v[k] == null && missing[k]) for (const x of missing[k]) ids.add(x);
      if (ids.size) missing[key] = [...ids];
    };

    v.pricePerSqm = n.price != null && n.sqm != null ? n.price / n.sqm : null;
    if (v.pricePerSqm == null) need('pricePerSqm', [M('price', n.price), M('sqm', n.sqm)]);

    /* purchase costs */
    v.purchaseCosts = COSTS.every((k) => C[k] != null) ? COSTS.reduce((a, k) => a + C[k], 0) : null;
    if (v.purchaseCosts == null) need('purchaseCosts', COSTS.map((k) => M(k, C[k])));
    v.totalCost = n.price != null && v.purchaseCosts != null ? n.price + v.purchaseCosts : null;
    if (v.totalCost == null) inheritMissing('totalCost', ['purchaseCosts'], n.price == null ? ['price'] : []);

    /* financing */
    if (n.price == null || F.mode == null) { v.loan = null; missing.loan = [...(n.price == null ? ['price'] : []), ...(F.mode == null ? ['financingMode'] : [])]; }
    else if (F.mode === 'cash') v.loan = 0;
    else if (F.mode === 'ltv') { v.loan = F.ltvPct != null ? (n.price * F.ltvPct) / 100 : null; if (v.loan == null) missing.loan = ['ltvPct']; }
    else { v.loan = F.downPayment != null ? n.price - F.downPayment : null; if (v.loan == null) missing.loan = ['downPayment']; }
    v.downPayment = v.loan != null ? n.price - v.loan : null;
    if (v.downPayment == null) inheritMissing('downPayment', ['loan']);
    v.ltvPct = v.loan != null ? (v.loan / n.price) * 100 : null;
    if (v.ltvPct == null) inheritMissing('ltvPct', ['loan']);
    let am = null;
    if (v.loan == null) { v.monthlyPayment = null; inheritMissing('monthlyPayment', ['loan']); }
    else if (v.loan === 0) { v.monthlyPayment = 0; am = null; na.amortization = 'no-loan'; }
    else {
      am = amortization(v.loan, F.ratePct, F.years);
      v.monthlyPayment = am ? am.monthly : null;
      if (!am) need('monthlyPayment', [M('ratePct', F.ratePct), M('years', F.years)]);
    }
    v.annualDebtService = v.monthlyPayment != null ? v.monthlyPayment * 12 : null;
    if (v.annualDebtService == null) inheritMissing('annualDebtService', ['monthlyPayment']);
    v.totalInterest = v.loan === 0 ? 0 : am ? am.totalInterest : null;
    if (v.totalInterest == null) inheritMissing('totalInterest', ['monthlyPayment']);
    v.totalPaid = v.loan === 0 ? 0 : am ? am.totalPaid : null;
    if (v.totalPaid == null) inheritMissing('totalPaid', ['monthlyPayment']);
    v.equity = v.downPayment != null && v.purchaseCosts != null ? v.downPayment + v.purchaseCosts : null;
    if (v.equity == null) inheritMissing('equity', ['downPayment', 'purchaseCosts']);

    /* rent → NOI → cash flow */
    const rentIn = R.monthly != null;
    v.grossRentAnnual = rentIn ? R.monthly * 12 : null;
    if (!rentIn) missing.grossRentAnnual = ['rentMonthly'];
    const opexIn = OPEX.every((k) => R[k] != null);
    v.vacancyLoss = rentIn && R.vacancyPct != null ? (v.grossRentAnnual * R.vacancyPct) / 100 : null;
    if (v.vacancyLoss == null) need('vacancyLoss', [M('rentMonthly', R.monthly), M('vacancyPct', R.vacancyPct)]);
    v.effectiveIncome = v.vacancyLoss != null ? v.grossRentAnnual - v.vacancyLoss : null;
    if (v.effectiveIncome == null) inheritMissing('effectiveIncome', ['vacancyLoss']);
    const opex = rentIn && opexIn ? { maintenance: R.maintenance * 12, management: (v.effectiveIncome * R.managementPct) / 100, insurance: R.insurance, other: R.otherOpex * 12 } : null;
    if (opex) opex.total = opex.maintenance + opex.management + opex.insurance + opex.other;
    v.opexAnnual = opex ? opex.total : null;
    if (v.opexAnnual == null) need('opexAnnual', [M('rentMonthly', R.monthly), ...OPEX.map((k) => M(k, R[k]))]);
    v.noi = v.opexAnnual != null ? v.effectiveIncome - v.opexAnnual : null;
    if (v.noi == null) inheritMissing('noi', ['opexAnnual']);
    v.cashFlowAnnual = v.noi != null && v.annualDebtService != null ? v.noi - v.annualDebtService : null;
    if (v.cashFlowAnnual == null) inheritMissing('cashFlowAnnual', ['noi', 'annualDebtService']);
    v.cashFlowMonthly = v.cashFlowAnnual != null ? v.cashFlowAnnual / 12 : null;
    if (v.cashFlowMonthly == null) inheritMissing('cashFlowMonthly', ['cashFlowAnnual']);

    /* metrics */
    v.grossYieldPct = rentIn && n.price != null ? (v.grossRentAnnual / n.price) * 100 : null;
    if (v.grossYieldPct == null) need('grossYieldPct', [M('rentMonthly', R.monthly), M('price', n.price)]);
    v.netYieldPct = v.noi != null && v.totalCost != null ? (v.noi / v.totalCost) * 100 : null;
    if (v.netYieldPct == null) inheritMissing('netYieldPct', ['noi', 'totalCost']);
    if (v.cashFlowAnnual != null && v.equity != null) {
      if (v.equity > 0) v.cashOnCashPct = (v.cashFlowAnnual / v.equity) * 100;
      else { v.cashOnCashPct = null; na.cashOnCashPct = 'no-equity'; }
    } else { v.cashOnCashPct = null; inheritMissing('cashOnCashPct', ['cashFlowAnnual', 'equity']); }
    if (v.noi != null && v.annualDebtService != null) {
      if (v.annualDebtService > 0) v.dscr = v.noi / v.annualDebtService;
      else { v.dscr = null; na.dscr = 'no-debt'; }
    } else { v.dscr = null; inheritMissing('dscr', ['noi', 'annualDebtService']); }
    /* break-even rent: 12·R·(1 − v)·(1 − m) − fixed − debt service = 0 */
    if (opexIn && v.annualDebtService != null) {
      const keep = (1 - R.vacancyPct / 100) * (1 - R.managementPct / 100);
      const fixed = R.maintenance * 12 + R.insurance + R.otherOpex * 12;
      v.breakEvenRentMonthly = keep > 0 ? (fixed + v.annualDebtService) / (12 * keep) : null;
    } else { v.breakEvenRentMonthly = null; need('breakEvenRentMonthly', [...OPEX.map((k) => M(k, R[k]))]); inheritMissing('breakEvenRentMonthly', ['annualDebtService'], missing.breakEvenRentMonthly); }

    /* break-even price for a target cash-on-cash (bisection on the engine itself; everything else held as entered) */
    v.breakEvenPrice = null;
    if (!(opt && opt.inner)) {
      if (n.targetCocPct == null || v.cashOnCashPct == null) {
        inheritMissing('breakEvenPrice', ['cashOnCashPct'], n.targetCocPct == null ? ['targetCocPct'] : []);
        if (!missing.breakEvenPrice && na.cashOnCashPct) na.breakEvenPrice = na.cashOnCashPct;
      }
      else { const be = breakEvenPrice(inp, n.targetCocPct); v.breakEvenPrice = be.price; if (be.price == null) na.breakEvenPrice = be.reason; }
    }

    return {
      engine: ENGINE, inputs: n, invalid, values: v, missing, notApplicable: na,
      amortization: am ? { months: am.months, monthly: am.monthly, totalPaid: am.totalPaid, totalInterest: am.totalInterest, byYear: am.byYear } : null,
      opex,
      firstYear: am && am.byYear[0] ? { interest: am.byYear[0].interest, principal: am.byYear[0].principal } : v.loan === 0 ? { interest: 0, principal: 0 } : null,
    };
  }

  /* a copy of the inputs with one change (deep enough for the four groups) */
  function withInputs(inp, fn) {
    const c = JSON.parse(JSON.stringify(inp || {}));
    c.financing = c.financing || {}; c.rent = c.rent || {}; c.costs = c.costs || {};
    fn(c); return c;
  }

  /**
   * The highest price at which the cash-on-cash still reaches `targetPct` — every other input held as entered (₪ costs fixed; the
   * same LTV %, or the same down-payment amount). Bisection on the engine; null when no price in (0, 10 × price] reaches it.
   */
  function breakEvenPrice(inp, targetPct) {
    const T = num(targetPct), P0 = num((inp || {}).price);
    if (T == null || P0 == null || !(P0 > 0)) return { price: null, reason: 'inputs' };
    const coc = (p) => { const r = analyze(withInputs(inp, (c) => { c.price = p; }), { inner: true }); return r.values.cashOnCashPct; };
    /* in down-payment mode the loan is price − down payment: below the down payment there is no loan to size */
    const mode = ((inp || {}).financing || {}).mode;
    const lo0 = mode === 'down' ? Math.max(1, num(inp.financing.downPayment) || 1) : 1;
    let lo = lo0, hi = P0 * 10;
    const fLo = coc(lo), fHi = coc(hi);
    if (fLo == null) return { price: null, reason: 'not-computable' };
    if (fLo < T) return { price: null, reason: 'target-not-reachable' };
    if (fHi != null && fHi >= T) return { price: null, reason: 'above-search-range' };
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2, f = coc(mid);
      if (f != null && f >= T) lo = mid; else hi = mid;
      if (hi - lo < 1) break;
    }
    return { price: lo, reason: null };
  }

  const PICK = ['cashFlowMonthly', 'cashOnCashPct', 'dscr', 'netYieldPct', 'grossYieldPct', 'monthlyPayment', 'noi'];
  const pick = (r) => Object.fromEntries(PICK.map((k) => [k, r.values[k]]));
  /**
   * One-way sensitivity: rent ±10 / 20 %, rate ±1 / 2 pp, price ±5 / 10 % — each cell the engine re-run on a copy; + the rent × rate grid
   * of the monthly cash flow. A rate below 0 % is not computed (null, `reason`).
   */
  function sensitivity(inp) {
    const base = analyze(inp, { inner: true });
    const out = { steps: SENS, base: pick(base), rent: [], rate: [], price: [], grid: null };
    const R0 = num(((inp || {}).rent || {}).monthly), I0 = num(((inp || {}).financing || {}).ratePct), P0 = num((inp || {}).price);
    for (const d of SENS.rent) out.rent.push({ delta: d, ...(R0 == null ? { values: null, reason: 'rentMonthly' } : { values: pick(analyze(withInputs(inp, (c) => { c.rent.monthly = R0 * (1 + d / 100); }), { inner: true })) }) });
    const loanless = base.values.loan === 0;
    for (const d of SENS.rate) {
      if (loanless) { out.rate.push({ delta: d, values: null, reason: 'no-loan' }); continue; }
      if (I0 == null) { out.rate.push({ delta: d, values: null, reason: 'ratePct' }); continue; }
      if (I0 + d < 0) { out.rate.push({ delta: d, values: null, reason: 'rate-below-zero' }); continue; }
      out.rate.push({ delta: d, values: pick(analyze(withInputs(inp, (c) => { c.financing.ratePct = I0 + d; }), { inner: true })) });
    }
    for (const d of SENS.price) {
      if (P0 == null) { out.price.push({ delta: d, values: null, reason: 'price' }); continue; }
      const r = analyze(withInputs(inp, (c) => { c.price = P0 * (1 + d / 100); }), { inner: true });
      out.price.push({ delta: d, values: r.invalid.includes('downPayment') ? null : pick(r), reason: r.invalid.includes('downPayment') ? 'down-payment-above-price' : undefined });
    }
    if (R0 != null && I0 != null && !loanless) {
      out.grid = { rows: SENS.rent, cols: SENS.rate, cells: SENS.rent.map((dr) => SENS.rate.map((di) => {
        if (I0 + di < 0) return null;
        return analyze(withInputs(inp, (c) => { c.rent.monthly = R0 * (1 + dr / 100); c.financing.ratePct = I0 + di; }), { inner: true }).values.cashFlowMonthly;
      })) };
    }
    return out;
  }

  const SHOCKS = ['rentPct', 'vacancyPp', 'ratePp', 'opexPct'];
  /** the inputs a scenario's shocks produce (rent × (1 + %), vacancy + pp, rate + pp, every operating cost × (1 + %)) */
  function shocked(inp, s) {
    return withInputs(inp, (c) => {
      const R = c.rent, F = c.financing;
      if (s.rentPct != null && num(R.monthly) != null) R.monthly = num(R.monthly) * (1 + s.rentPct / 100);
      if (s.vacancyPp != null && num(R.vacancyPct) != null) R.vacancyPct = Math.min(99.9, Math.max(0, num(R.vacancyPct) + s.vacancyPp));
      if (s.ratePp != null && num(F.ratePct) != null) F.ratePct = Math.max(0, num(F.ratePct) + s.ratePp);
      if (s.opexPct != null) for (const k of ['maintenance', 'insurance', 'otherOpex']) if (num(R[k]) != null) R[k] = num(R[k]) * (1 + s.opexPct / 100);
    });
  }
  /**
   * base · downside · upside. A scenario is computed only from the shocks the user entered (at least one); a blank shock leaves that
   * driver as in the base case. @param shocks { downside: {rentPct, vacancyPp, ratePp, opexPct}, upside: {…} }
   */
  function scenarios(inp, shocks) {
    const out = { base: { shocks: null, values: pick(analyze(inp, { inner: true })) } };
    for (const k of ['downside', 'upside']) {
      const raw = (shocks || {})[k] || {};
      const s = Object.fromEntries(SHOCKS.map((x) => [x, num(raw[x])]));
      if (SHOCKS.every((x) => s[x] == null)) { out[k] = { shocks: s, values: null, reason: 'no-shock-entered' }; continue; }
      out[k] = { shocks: s, values: pick(analyze(shocked(inp, s), { inner: true })) };
    }
    return out;
  }

  /**
   * The deal rules — deterministic flags over the result and the read model's context. Each: { id, kind: risk | watch | info, value,
   * threshold, source, cls, term }. Never a score, a probability or a recommendation.
   * @param r   analyze(...)
   * @param ctx { buyer: single|replacement|additional,
   *              comps: { percentile: { level, state, p25, p75, n } (the narrowest SUPPORTED level) | null, street: { state, n } | null },
   *              model: { available, tier, reason, value, range }, freshness: { state }, officialRate: { value, period, track }, concentration: { share } }
   *   A flag carries `level` when it rests on a comparables level (STREET · BLOCKS · NEIGHBOURHOOD · LOCALITY — never relabelled as the street).
   */
  function flags(r, ctx) {
    const c = ctx || {}, v = (r && r.values) || {}, out = [];
    const add = (id, kind, value, threshold, source, cls, term, extra) => out.push({ id, kind, value, threshold, source, cls, term, ...(extra || {}) });
    const pc = c.comps && c.comps.percentile ? c.comps.percentile : null, sc = c.comps && c.comps.street ? c.comps.street : null;
    if (v.pricePerSqm != null && pc && pc.state === 'SUPPORTED' && pc.p75 != null && v.pricePerSqm > pc.p75)
      add('DL-ASK-ABOVE-P75', 'watch', Math.round(v.pricePerSqm), Math.round(pc.p75), 'over:street-evidence', 'DERIVED', 'deal_comps_percentile', { level: pc.level, n: pc.n });
    if (v.pricePerSqm != null && pc && pc.state === 'SUPPORTED' && pc.p25 != null && v.pricePerSqm < pc.p25)
      add('DL-ASK-BELOW-P25', 'info', Math.round(v.pricePerSqm), Math.round(pc.p25), 'over:street-evidence', 'DERIVED', 'deal_comps_percentile', { level: pc.level, n: pc.n });
    if (sc && (sc.state === 'INSUFFICIENT' || sc.state === 'NONE'))
      add('DL-COMPS-THIN', 'watch', sc.n, RULES.sample.LIMITED, 'over:street-evidence', 'OBSERVED', 'deal_comparables', { level: 'STREET' });
    if (v.cashFlowMonthly != null && v.cashFlowMonthly < 0)
      add('DL-NEGATIVE-CASHFLOW', 'risk', Math.round(v.cashFlowMonthly), 0, 'propx:deal-lab', 'DERIVED', 'deal_cash_flow');
    if (v.dscr != null && v.dscr < RULES.dscr.risk) add('DL-DSCR-BELOW-1', 'risk', r2(v.dscr), RULES.dscr.risk, 'propx:deal-lab', 'DERIVED', 'deal_dscr');
    else if (v.dscr != null && v.dscr < RULES.dscr.watch) add('DL-DSCR-BELOW-1-2', 'watch', r2(v.dscr), RULES.dscr.watch, 'propx:deal-lab', 'DERIVED', 'deal_dscr');
    const lim = c.buyer && RULES.ltv[c.buyer] != null ? RULES.ltv[c.buyer] : null;
    if (v.ltvPct != null && lim != null && v.ltvPct > lim + 1e-9) add('DL-LTV-ABOVE-LIMIT', 'risk', r2(v.ltvPct), lim, 'propx:deal-lab', 'DERIVED', 'deal_ltv_limit');
    const f = c.freshness || null;
    if (f && ['STALE', 'VERY_STALE', 'SOURCE_LAG_UNKNOWN'].includes(f.state)) add('DL-EVIDENCE-STALE', 'watch', f.state, 'CURRENT ≤ 7 d · RECENT ≤ 21 d', 'propx:tx-freshness', 'DERIVED', 'transaction_freshness');
    const m = c.model || null;
    if (m && (!m.available || m.value == null)) add('DL-MODEL-UNAVAILABLE', 'watch', m.reason || 'UNAVAILABLE', null, 'propx:street-model', 'MODEL', 'deal_model_estimate');
    else if (m && m.tier === 'LIMITED') add('DL-MODEL-LIMITED', 'watch', m.tier, 'STRONG / STANDARD', 'propx:street-model', 'MODEL', 'deal_model_estimate');
    if (m && m.value != null && m.range && num((r.inputs || {}).price) != null && r.inputs.price > m.range.hi)
      add('DL-ASK-ABOVE-MODEL-RANGE', 'info', Math.round(r.inputs.price), Math.round(m.range.hi), 'propx:street-model', 'MODEL', 'deal_model_estimate');
    const o = c.officialRate || null, ur = r && r.inputs ? r.inputs.financing.ratePct : null;
    if (o && o.value != null && ur != null && v.loan > 0 && Math.abs(ur - o.value) >= RULES.rateGapPp)
      add('DL-RATE-VS-OFFICIAL', 'info', r2(ur - o.value), RULES.rateGapPp, 'boi:housing-finance', 'OFFICIAL', 'deal_official_rate');
    if (c.concentration && c.concentration.share >= 50) add('DL-CONCENTRATION', 'info', c.concentration.share, 50, 'over:street-evidence', 'OBSERVED', 'deal_comparables');
    return out;
  }

  /** the ₪/m² percentile of `value` within `sorted` (share of comparables at or below it, 0–100); null for an empty list */
  function percentile(sorted, value) {
    const x = num(value);
    if (x == null || !Array.isArray(sorted) || !sorted.length) return null;
    return Math.round((sorted.filter((s) => s <= x).length / sorted.length) * 100);
  }

  return Object.freeze({ ENGINE, RULES, SENS, SHOCKS, COSTS, OPEX, num, annuity, amortization, bracketTax, normalize, analyze, breakEvenPrice, sensitivity, scenarios, flags, percentile });
}));
