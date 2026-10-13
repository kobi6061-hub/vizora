/* ALTARIS · Capital Allocation Engine — calculation core.
 *
 * Pure functions, no DOM, no network, no randomness. Loaded by the ALTARIS page
 * (window.AltarisEngine) and by Node tests (require('./altaris/engine.js')).
 *
 * Conventions
 *   - inputs carry percentages as percent units (8 = 8%); results carry rates as
 *     fractions (0.152 = 15.2%) and money in NIS;
 *   - every strategy is a dated monthly cash-flow series seen from ALTARIS
 *     (negative = capital out, positive = cash returned), month 0 = the deal's
 *     funding date; IRR = XIRR over those dates (Actual/365);
 *   - MOIC = total distributions / total invested capital (sum of outflows);
 *   - capital required = the peak cumulative outflow;
 *   - market value, purchase price, basis, capital invested, debt, profit and
 *     cash returned are separate quantities and are never substituted;
 *   - taxes are editable assumptions; headline returns are before profit taxes;
 *   - a default is an assumption: every resolved input reports whether it was
 *     defaulted, so the page can label it until the user edits it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AltarisEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 2;   // 2: the independent review of 13.10.2026 (IRR root selection, committed-capital basis, default month, option rule)
  const STRATS = ['buy', 'finance', 'hybrid'];
  const LABEL = {
    buy: { en: 'BUY', he: 'רכישה' },
    finance: { en: 'FINANCE', he: 'מימון מובטח' },
    hybrid: { en: 'HYBRID', he: 'מבנה משולב' },
  };

  /* ------------------------------------------------------------ utilities */
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₪%\s]/g, ''));
    return isFinite(n) ? n : null;
  };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
  const round = (x, d = 0) => { const k = Math.pow(10, d); return Math.round(x * k) / k; };

  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  /** add whole months to an ISO date; the day is kept, clamped to the month's length */
  function addMonths(isoDate, n) {
    const t = parseISO(isoDate);
    if (t == null) return null;
    const d = new Date(t);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + Math.round(n), day = d.getUTCDate();
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return iso(Date.UTC(y, mo, Math.min(day, last)));
  }
  const daysBetween = (a, b) => (parseISO(b) - parseISO(a)) / 86400000;

  /** piecewise-linear map over [[x, y], …] (x ascending), flat beyond the ends */
  function interp(x, pts) {
    if (!isNum(x)) return null;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return pts[pts.length - 1][1];
  }

  /**
   * XIRR over dated flows [{date:'YYYY-MM-DD', amount}] — the annual rate r with
   * Σ amount / (1+r)^(days/365) = 0, searched over r > −99.99%.
   *   - one sign change in the series (in date order) → exactly one root: Newton steps inside a
   *     sign-change bracket (bisection whenever Newton leaves it); the bracket widens until it holds
   *     the root, however short and profitable the series;
   *   - several sign changes → NPV can have several roots: NPV is scanned on a grid over ln(1+r),
   *     every bracket is solved, and the root nearest 0% on that scale is reported (a late run of
   *     small negative months must not turn a profitable series into a root near −100%).
   * null when there is no root: no sign change in the series, a root below −99.99%, or NPV keeping
   * one sign at every rate (metricsOf / irrOf label what is shown instead).
   */
  const XIRR_LO = -0.9999;
  function xirr(flows) {
    const pts = flows.filter((f) => isNum(f.amount) && Math.abs(f.amount) > 1e-9 && parseISO(f.date) != null);
    if (!pts.some((f) => f.amount > 0) || !pts.some((f) => f.amount < 0)) return null;
    const d0 = pts[0].date;
    const ts = pts.map((f) => daysBetween(d0, f.date) / 365);
    const scale = Math.max(...pts.map((f) => Math.abs(f.amount)));
    const f = (r) => { let s = 0; for (let i = 0; i < pts.length; i++) s += pts[i].amount / Math.pow(1 + r, ts[i]); return s; };
    const df = (r) => { let s = 0; for (let i = 0; i < pts.length; i++) s -= ts[i] * pts[i].amount / Math.pow(1 + r, ts[i] + 1); return s; };
    /* Newton inside [lo, hi] (f(lo) and f(hi) of opposite sign) */
    const solve = (lo, hi, flo) => {
      let r = 0.1 > lo && 0.1 < hi ? 0.1 : (lo + hi) / 2;
      for (let i = 0; i < 300; i++) {
        const v = f(r);
        if (Math.abs(v) < 1e-9 * scale) return r;
        if ((v > 0) === (flo > 0)) { lo = r; flo = v; } else { hi = r; }
        let nr = r - v / df(r);
        if (!isNum(nr) || nr <= lo || nr >= hi) nr = hi - lo > 10 ? Math.expm1((Math.log1p(lo) + Math.log1p(hi)) / 2) : (lo + hi) / 2;   // a very wide bracket halves on ln(1+r)
        if (Math.abs(nr - r) < 1e-13) return nr;
        r = nr;
      }
      return r;
    };
    const order = ts.map((t, i) => i).sort((a, b) => ts[a] - ts[b]);
    let changes = 0;
    for (let j = 1; j < order.length; j++) if ((pts[order[j]].amount > 0) !== (pts[order[j - 1]].amount > 0)) changes++;
    let lo = XIRR_LO, hi = 1, flo = f(lo), fhi = f(hi);
    for (let k = 0; flo * fhi > 0 && k < 40; k++) { hi = hi * 2 + 1; fhi = f(hi); }
    if (changes === 1) {
      for (let k = 0; flo * fhi > 0 && k < 300 && isNum(fhi); k++) { hi = hi * 10; fhi = f(hi); }   // a very short, very profitable series
      return flo * fhi <= 0 ? solve(lo, hi, flo) : null;
    }
    const first = flo * fhi <= 0 ? solve(lo, hi, flo) : null;
    /* several sign changes: NPV's sign on a grid over x = ln(1+r), scaled so no term overflows */
    const tMax = Math.max(...ts);
    const g = (x) => { let s = 0; for (let i = 0; i < pts.length; i++) s += pts[i].amount * Math.exp(x < 0 ? x * (tMax - ts[i]) : -x * ts[i]); return s; };
    const grid = [0];
    for (let x = 0.002; x < 60; x *= 1.06) grid.push(x);
    for (let x = 0.002, lx = Math.log1p(XIRR_LO); x < -lx; x *= 1.06) grid.unshift(-x);
    grid.unshift(Math.log1p(XIRR_LO));
    let best = null;
    for (let j = 1; j < grid.length; j++) {
      let a = grid[j - 1], b = grid[j], ga = g(a), gb = g(b);
      if (ga === 0) { if (best == null || Math.abs(a) < Math.abs(best[0])) best = [a, a]; continue; }
      if (ga * gb > 0) continue;
      const near = Math.min(Math.abs(a), Math.abs(b));
      if (best != null && near >= Math.min(Math.abs(best[0]), Math.abs(best[1]))) continue;
      best = [a, b];
    }
    if (!best) return first;
    let [a, b] = best;
    if (first != null && Math.log1p(first) >= a - 1e-12 && Math.log1p(first) <= b + 1e-12) return first;   // the bracketed search already found this root
    const ra = Math.expm1(a), rb = Math.expm1(b), fa = f(ra);
    if (isNum(fa) && isNum(f(rb)) && fa * f(rb) <= 0 && a !== b) return solve(ra, rb, fa);
    for (let i = 0; i < 200 && b - a > 1e-15; i++) { const m = (a + b) / 2; if ((g(m) > 0) === (g(a) > 0)) a = m; else b = m; }
    return Math.expm1((a + b) / 2);
  }

  /** the metrics every strategy shares, from its monthly series */
  function metricsOf(flows, t0) {
    const dated = flows.map((f) => ({ date: addMonths(t0, f.m), amount: f.amount }));
    let invested = 0, distributions = 0, cum = 0, minCum = 0, firstIn = null;
    for (const f of flows) {
      if (f.amount < 0) invested -= f.amount; else distributions += f.amount;
      cum += f.amount; if (cum < minCum) minCum = cum;
      if (f.amount > 0 && firstIn == null) firstIn = f.m;
    }
    const last = flows.length ? flows[flows.length - 1].m : 0;   // every model ends its series at the final event (exit, repayment, recovery, resale)
    const profit = distributions - invested;
    let irr = xirr(dated);
    if (irr == null && invested > 0 && distributions <= 1e-9) irr = -1;   // nothing comes back: a total loss
    const roi = invested > 0 ? profit / invested : null;
    const annualized = roi != null && roi > -1 && last > 0 ? Math.pow(1 + roi, 12 / last) - 1 : (roi === -1 ? -1 : null);
    const final = flows.find((f) => f.m === last);
    return {
      invested, distributions, profit, irr, roi, annualized,
      moic: invested > 0 ? distributions / invested : null,
      peakCapital: -minCum, months: last, exitDate: addMonths(t0, last),
      finalShare: distributions > 0 && final && final.amount > 0 ? final.amount / distributions : (distributions > 0 ? 0 : null),
      firstInflowMonth: firstIn, dated,
    };
  }

  /* ---------------------------------------------------------- deal facts */
  const VALUE_SOURCES = ['propx', 'appraisal', 'developer', 'comparables', 'ppsqm', 'units', 'manual'];

  function facts(deal, today) {
    deal = deal || {};
    const info = deal.info || {};
    const rows = (deal.units || []).filter((u) => u && (num(u.sqm) || num(u.supported) || num(u.proposed) || num(u.rooms)));
    const sqmSum = sum(rows.map((u) => num(u.sqm)));
    const supSum = sum(rows.map((u) => num(u.supported)));
    const propSum = sum(rows.map((u) => num(u.proposed)));
    const unitsCount = num(info.unitsCount) ?? (rows.length || null);
    const sqm = num(info.totalSqm) ?? (sqmSum || null);
    const priceTotal = num(deal.price && deal.price.total);
    const allProposed = rows.length > 0 && rows.every((u) => num(u.proposed) > 0);
    const basis = priceTotal ?? (allProposed ? propSum : null);
    const basisFrom = priceTotal != null ? 'total' : allProposed ? 'units' : null;
    const V = deal.value || {};
    const psm = num(V.ppsqm && V.ppsqm.psm);
    const derived = (o) => (o && o.auto !== false && num(o.psm) > 0 && sqm ? num(o.psm) * sqm : num(o && o.value));
    const sources = {
      propx: derived(V.propx),
      appraisal: num(V.appraisal && V.appraisal.value),
      developer: num(V.developer && V.developer.value),
      comparables: derived(V.comparables),
      ppsqm: psm && sqm ? psm * sqm : null,
      units: rows.length > 0 && rows.every((u) => num(u.supported) > 0) ? supSum : null,
      manual: num(V.manual && V.manual.value),
    };
    const chosen = V.chosen && VALUE_SOURCES.includes(V.chosen) && sources[V.chosen] > 0 ? V.chosen : null;
    const smv = chosen ? sources[chosen] : null;
    const vals = VALUE_SOURCES.filter((k) => sources[k] > 0 && k !== 'developer').map((k) => sources[k]);
    const independent = VALUE_SOURCES.filter((k) => sources[k] > 0 && k !== 'developer');
    const spread = vals.length >= 2 ? (Math.max(...vals) - Math.min(...vals)) / Math.min(...vals) : null;
    const t0 = parseISO(info.startDate) != null ? info.startDate : (today || iso(Date.UTC(2026, 0, 1)));
    return {
      smv, chosen, sources, independent, spread, basis, basisFrom,
      diff: smv != null && basis != null ? smv - basis : null,
      discount: smv && basis != null ? (smv - basis) / smv : null,
      sqm, unitsCount, rows: rows.length, unitSupportedSum: supSum || null, unitProposedSum: propSum || null,
      t0, status: info.constructionStatus || null, completionDate: info.completionDate || null,
      developer: (info.developer || '').trim(), project: (info.project || '').trim(), city: (info.city || '').trim(),
      developerRating: info.developerRating || 'unassessed',
    };
  }

  /* ------------------------------------------------- inputs and defaults */
  /* Every default is an underwriting ASSUMPTION (the page labels it until edited). */
  const r1000 = (x) => (isNum(x) ? Math.round(x / 1000) * 1000 : null);
  const HYB_PRESET = {
    'pref':               { couponPct: 0, prefPct: 14, participationPct: 20, seniority: 'other',  optionOn: false, backstopOn: false, capitalK: 0.35 },
    'secured-upside':     { couponPct: 9, prefPct: 0,  participationPct: 20, seniority: 'first',  optionOn: false, backstopOn: false, capitalK: 0.6 },
    'finance-option':     { couponPct: 9, prefPct: 0,  participationPct: 0,  seniority: 'first',  optionOn: true,  backstopOn: false, capitalK: 0.6 },
    'backstop':           { couponPct: 0, prefPct: 0,  participationPct: 0,  seniority: 'other',  optionOn: false, backstopOn: true,  capitalK: 0, feePct: 2 },
    'min-return-share':   { couponPct: 0, prefPct: 10, participationPct: 30, seniority: 'first',  optionOn: false, backstopOn: false, capitalK: 0.5 },
    'inventory-option':   { couponPct: 0, prefPct: 0,  participationPct: 0,  seniority: 'other',  optionOn: true,  backstopOn: false, capitalK: 0.1 },
    'inventory-facility': { couponPct: 10, prefPct: 0, participationPct: 0,  seniority: 'first',  optionOn: false, backstopOn: false, capitalK: 0.6, spread: 12 },
  };
  const HYB_STRUCTURES = Object.keys(HYB_PRESET);
  const P = (i, k, d) => { const p = HYB_PRESET[i.structure] || HYB_PRESET['secured-upside']; return p[k] !== undefined ? p[k] : d; };

  const DEF = {
    buy: {
      price: (F) => F.basis,
      taxPct: () => 8, legalPct: () => 0.5, dd: () => 0, brokeragePct: () => 0, registration: () => 0,
      capex: () => 0, renovation: () => 0, marketing: () => 0, otherAcq: () => 0,
      exitMonth: () => 18,
      mgmt: () => 0, municipal: () => 0, insurance: () => 0, maintenance: () => 0, otherOpex: () => 0,
      rentOn: () => false, rent: () => 0, occupancy: () => 95, collection: () => 98, rentOpexPct: () => 10,
      debtMode: () => 'ltv', ltvPct: () => 0, debtAmount: () => 0, ratePct: () => 6.5, feePct: () => 1,
      loanTermMonths: () => null, interestMode: () => 'current',
      exitMode: () => 'haircut', haircutPct: () => 5, targetPrice: () => null,
      sellBrokeragePct: () => 1.5, sellLegalPct: () => 0.5, sellOther: () => 0,
      vatPct: () => 0, profitTaxPct: () => 0, otherTax: () => 0,
      exitPrimary: () => 'unit-sales', exitSecondary: () => 'bulk-sale',
    },
    finance: {
      amount: (F) => (F.smv ? r1000(F.smv * 0.6) : null),
      collateralValue: (F) => F.smv,
      collateralUnits: (F) => F.unitsCount,
      haircutPct: () => 15, priorLiens: () => 0, seniority: () => 'first',
      borrowerEquity: () => null, projectCost: () => null,
      ratePct: () => 11, interestMode: () => 'current', feePct: () => 1.5, exitFeePct: () => 0.5,
      termMonths: () => 12, graceMonths: () => 0, repayment: () => 'bullet',
      extMonths: () => 6, extRatePct: (F, i) => (isNum(i.ratePct) ? i.ratePct : 11) + 2, extFeePct: () => 0.5,
      legal: () => 0, monitoring: () => 0, saleCostPct: () => 3,
      enforcementMonths: () => 12, enforcementCostPct: () => 7,
      sourcePrimary: () => 'apartment-sales', sourceSecondary: () => 'bank-refinancing',
    },
    hybrid: {
      structure: () => 'secured-upside',
      capital: (F, i) => (F.smv ? r1000(F.smv * P(i, 'capitalK', 0.6)) : null),
      optionOn: (F, i) => P(i, 'optionOn', false),
      optionPrice: (F) => F.basis,
      optionSharePct: () => 100,
      backstopOn: (F, i) => P(i, 'backstopOn', false),
      backstopPrice: (F) => (F.smv ? r1000(F.smv * 0.75) : null),
      backstopUnsoldPct: () => 0,
      maxCommitment: (F, i) => (i.backstopOn ? n0(i.capital) + n0(i.backstopPrice) : i.capital),
      feePct: (F, i) => P(i, 'feePct', 1.5),
      couponPct: (F, i) => P(i, 'couponPct', 9),
      prefPct: (F, i) => P(i, 'prefPct', 0),
      participationPct: (F, i) => P(i, 'participationPct', 20),
      threshold: (F) => F.basis ?? F.smv,
      realizationValue: (F) => F.smv,
      termMonths: () => 18,
      salesSpreadMonths: (F, i) => P(i, 'spread', 0),
      collateralValue: (F) => F.smv,
      haircutPct: () => 15, priorLiens: () => 0,
      seniority: (F, i) => P(i, 'seniority', 'first'),
      saleCostPct: () => 3, resaleMonths: () => 6, resaleCostPct: () => 3, resaleHaircutPct: () => 5,
      legal: () => 0, monitoring: () => 0,
      enforcementMonths: () => 12, enforcementCostPct: () => 7,
      sourcePrimary: () => 'apartment-sales', sourceSecondary: () => 'project-refinancing',
      triggerNote: () => '', exitConditions: () => '',
    },
  };
  /* scenario deltas: base is the deal as entered; downside/upside change assumptions independently */
  const SCEN_KEYS = ['valueShock', 'haircutAdd', 'delay', 'rateAdd', 'rentChg', 'opexChg', 'collateralShock', 'default', 'defaultMonth', 'enforcementMonths', 'enforcementCostPct', 'backstopUnsoldPct'];
  const SCEN_DEF = {
    downside: { valueShock: -15, haircutAdd: 0, delay: 6, rateAdd: 1, rentChg: -10, opexChg: 10, collateralShock: null, default: true, defaultMonth: null, enforcementMonths: null, enforcementCostPct: null, backstopUnsoldPct: 50 },
    base:     { valueShock: 0, haircutAdd: 0, delay: 0, rateAdd: 0, rentChg: 0, opexChg: 0, collateralShock: null, default: false, defaultMonth: null, enforcementMonths: null, enforcementCostPct: null, backstopUnsoldPct: null },
    upside:   { valueShock: 5, haircutAdd: 0, delay: -3, rateAdd: -0.5, rentChg: 5, opexChg: 0, collateralShock: null, default: false, defaultMonth: null, enforcementMonths: null, enforcementCostPct: null, backstopUnsoldPct: null },
  };
  const STRESS = [
    { id: 'v5', group: 'value', valueShock: -5 }, { id: 'v10', group: 'value', valueShock: -10 },
    { id: 'v15', group: 'value', valueShock: -15 }, { id: 'v20', group: 'value', valueShock: -20 },
    { id: 'd6', group: 'delay', delay: 6 }, { id: 'd12', group: 'delay', delay: 12 },
    { id: 'r1', group: 'rate', rateAdd: 1 }, { id: 'r2', group: 'rate', rateAdd: 2 },
  ];
  const SETTINGS_DEF = {
    minIrr: 15, minMoic: 1.1, minDiscount: 15, minCoverage: 1.3, maxLtv: 70, maxDuration: 24,
    maxDevExposure: 20, maxProjectExposure: 12, maxGeoExposure: 35, minMos: 10,
    fundSize: 250000000, fundLifeYears: 5, redeployLagMonths: 2, downsideWeight: 50,
    weights: { entry: 1, collateral: 1, liquidity: 1, duration: 1, developer: 1, project: 1, concentration: 1, protection: 1 },
  };

  const TEXT_KEYS = new Set(['debtMode', 'interestMode', 'exitMode', 'exitPrimary', 'exitSecondary', 'seniority', 'repayment',
    'sourcePrimary', 'sourceSecondary', 'structure', 'triggerNote', 'exitConditions']);
  const BOOL_KEYS = new Set(['rentOn', 'optionOn', 'backstopOn']);
  const typed = (k, v) => (TEXT_KEYS.has(k) ? String(v) : BOOL_KEYS.has(k) ? v === true || v === 'true' || v === 1 : num(v));
  function resolve(kind, deal, F) {
    const src = (deal && deal[kind]) || {};
    const spec = DEF[kind], out = {}, defaulted = [];
    for (const k of Object.keys(spec)) {
      const v = src[k];
      const t = v === undefined || v === null || v === '' ? null : typed(k, v);
      if (t === null) { out[k] = spec[k](F, out); defaulted.push(k); }
      else out[k] = t;
    }
    return { inputs: out, defaulted };
  }
  function scenario(deal, name) {
    const s = Object.assign({}, SCEN_DEF[name] || SCEN_DEF.base);
    const user = (deal && deal.scen && deal.scen[name]) || {};
    for (const k of SCEN_KEYS) if (user[k] !== undefined && user[k] !== null && user[k] !== '') s[k] = k === 'default' ? user[k] === true || user[k] === 'true' || user[k] === 1 : user[k];
    s.name = name;
    return s;
  }
  function settingsOf(user) {
    const s = Object.assign({}, SETTINGS_DEF, user || {});
    s.weights = Object.assign({}, SETTINGS_DEF.weights, (user && user.weights) || {});
    return s;
  }
  const n0 = (x) => (isNum(+x) ? +x : 0);

  /* ================================================================ BUY */
  function buyModel(F, i, sc) {
    sc = sc || SCEN_DEF.base;
    const missing = [];
    if (!(F.smv > 0)) missing.push('smv');
    if (!(num(i.price) > 0)) missing.push('buy.price');
    if (!(num(i.exitMonth) >= 1)) missing.push('buy.exitMonth');
    if (i.exitMode === 'target' && !(num(i.targetPrice) > 0)) missing.push('buy.targetPrice');
    if (missing.length) return { ok: false, strategy: 'buy', missing };
    const H = Math.max(1, Math.round(+i.exitMonth + n0(sc.delay)));
    const price = +i.price;
    const tax = price * n0(i.taxPct) / 100;
    const acq = price * n0(i.legalPct) / 100 + n0(i.dd) + price * n0(i.brokeragePct) / 100 + n0(i.registration) + n0(i.otherAcq);
    const improve = n0(i.capex) + n0(i.renovation);
    const marketing = n0(i.marketing);
    const debtIn = Math.max(0, i.debtMode === 'amount' ? n0(i.debtAmount) : price * n0(i.ltvPct) / 100);
    const debt = Math.min(debtIn, price);   // acquisition debt is capped at the purchase price (LTV ≤ 100%)
    const fee = debt * n0(i.feePct) / 100;
    const rate = Math.max(0, n0(i.ratePct) + n0(sc.rateAdd)) / 100 / 12;
    const term = Math.max(1, Math.round(n0(i.loanTermMonths) || H));
    const opexM = (n0(i.mgmt) + n0(i.municipal) + n0(i.insurance) + n0(i.maintenance) + n0(i.otherOpex)) * (1 + n0(sc.opexChg) / 100);
    const rentM = i.rentOn ? n0(i.rent) * (1 + n0(sc.rentChg) / 100) * n0(i.occupancy) / 100 * n0(i.collection) / 100 * (1 - n0(i.rentOpexPct) / 100) : 0;
    const flows = [{ m: 0, amount: -(price + tax + acq + improve + marketing + fee) + debt,
      parts: { price: -price, tax: -tax, acq: -acq, improve: -improve, marketing: -marketing, fee: -fee, debt } }];
    let bal = debt, interest = 0, interestPaid = 0, opexTotal = 0, rentTotal = 0, earlyRepay = 0;
    for (let m = 1; m <= H; m++) {
      const p = {}; let a = 0;
      if (bal > 0) {
        const it = bal * rate; interest += it;
        if (i.interestMode === 'accrued') bal += it; else { a -= it; p.interest = -it; interestPaid += it; }
      }
      a -= opexM; if (opexM) p.opex = -opexM; opexTotal += opexM;
      if (rentM) { a += rentM; p.rent = rentM; rentTotal += rentM; }
      if (bal > 0 && m === term && term < H) { a -= bal; p.debtRepay = -bal; earlyRepay = bal; bal = 0; }
      flows.push({ m, amount: a, parts: p });
    }
    const ref = i.exitMode === 'target' ? +i.targetPrice : F.smv;
    const hc = (i.exitMode === 'target' ? 0 : n0(i.haircutPct)) + n0(sc.haircutAdd);
    const exitGross = ref * (1 + n0(sc.valueShock) / 100) * (1 - hc / 100);
    const sellPct = (n0(i.sellBrokeragePct) + n0(i.sellLegalPct)) / 100;
    const vatShare = n0(i.vatPct) > 0 ? n0(i.vatPct) / (100 + n0(i.vatPct)) : 0;
    const sellCosts = exitGross * sellPct + n0(i.sellOther);
    const vat = exitGross * vatShare;
    const L = flows[H];
    L.amount += exitGross - sellCosts - vat - bal;
    Object.assign(L.parts, { exit: exitGross, sellCosts: -sellCosts, vat: -vat });
    if (bal) L.parts.debtRepay = (L.parts.debtRepay || 0) - bal;
    const repaidAtExit = bal; bal = 0;
    const M = metricsOf(flows, F.t0);
    M.atRisk = M.peakCapital;
    const profitTax = Math.max(0, M.profit) * n0(i.profitTaxPct) / 100 + n0(i.otherTax);
    const after = flows.map((f) => ({ m: f.m, amount: f.amount - (f.m === H ? profitTax : 0) }));
    const MA = profitTax > 0 ? metricsOf(after, F.t0) : M;
    const costs = acq + improve + marketing;
    const financing = interest + fee;
    const bridge = [
      { k: 'smv', v: F.smv, total: true },
      { k: 'haircut', v: -(F.smv - exitGross) },
      { k: 'exit', v: exitGross, total: true },
      { k: 'price', v: -price }, { k: 'tax', v: -tax }, { k: 'costs', v: -costs },
      { k: 'financing', v: -financing }, { k: 'holding', v: -opexTotal }, { k: 'rent', v: rentTotal },
      { k: 'exitCosts', v: -(sellCosts + vat) },
      { k: 'profit', v: M.profit, total: true },
    ];
    if (profitTax > 0) bridge.push({ k: 'profitTax', v: -profitTax }, { k: 'profitAfterTax', v: M.profit - profitTax, total: true });
    const check = F.smv - (F.smv - exitGross) - price - tax - costs - financing - opexTotal + rentTotal - (sellCosts + vat);
    const carry = Math.max(0, interestPaid + opexTotal - rentTotal);
    const usesTotal = price + tax + costs + fee + carry + earlyRepay;   // a loan maturing before the exit is repaid from equity
    const slope = 1 - sellPct - vatShare;
    const breakEvenExit = slope > 0 ? exitGross - M.profit / slope : null;
    const allIn = price + tax + costs + financing + opexTotal - rentTotal;
    return {
      ok: true, strategy: 'buy', scenario: sc.name || null, flows, months: H, ...M,
      afterTax: { profitTax, profit: M.profit - profitTax, irr: MA.irr, moic: MA.moic },
      price, tax, acqCosts: acq, improvements: improve, marketing, costs, debt, fee, interest, financing,
      holding: opexTotal, rentCarry: rentTotal, exitGross, exitHaircut: F.smv - exitGross, sellCosts, vat,
      netProceeds: exitGross - sellCosts - vat, debtRepaid: repaidAtExit + earlyRepay, earlyRepay,
      loanTerm: term, loanMaturesBeforeExit: debt > 0 && term < H, debtCapped: debtIn > debt + 0.5,
      bridge, bridgeCheck: check,
      sourcesUses: {
        uses: [{ k: 'price', v: price }, { k: 'tax', v: tax }, { k: 'costs', v: costs }, { k: 'fee', v: fee }, { k: 'carry', v: carry }].concat(earlyRepay > 0 ? [{ k: 'earlyRepay', v: earlyRepay }] : []),
        sources: [{ k: 'debt', v: Math.min(debt, usesTotal) }, { k: 'equity', v: Math.max(0, usesTotal - debt) }],
        total: usesTotal,
      },
      allInBasis: allIn,
      breakEvenExit, breakEvenPsm: breakEvenExit != null && F.sqm ? breakEvenExit / F.sqm : null,
      maxHaircut: breakEvenExit != null ? 1 - breakEvenExit / F.smv : null,           // max decline from supported value before loss
      marginOfSafety: breakEvenExit != null && exitGross > 0 ? (exitGross - breakEvenExit) / exitGross : null,  // vs the expected exit
      cushion: breakEvenExit != null ? exitGross - breakEvenExit : null,
      valueToBasis: allIn > 0 ? F.smv / allIn : null,
      ltv: price > 0 ? debt / price : null,
    };
  }

  /* ============================================================= FINANCE */
  function financeModel(F, i, sc, inner) {
    sc = sc || SCEN_DEF.base;
    const missing = [];
    if (!(num(i.amount) > 0)) missing.push('finance.amount');
    if (!(num(i.collateralValue) > 0)) missing.push('finance.collateralValue');
    if (!(num(i.termMonths) >= 1)) missing.push('finance.termMonths');
    if (missing.length) return { ok: false, strategy: 'finance', missing };
    const amount = +i.amount, T0 = Math.max(1, Math.round(+i.termMonths));
    let T = Math.max(1, T0 + Math.round(n0(sc.delay)));
    const r = n0(i.ratePct) / 100 / 12, rExt = (num(i.extRatePct) ?? n0(i.ratePct) + 2) / 100 / 12;
    const grace = clamp(Math.round(n0(i.graceMonths)), 0, T0);
    const fee = amount * n0(i.feePct) / 100, exitFee = amount * n0(i.exitFeePct) / 100;
    const prior = n0(i.priorLiens);
    const V = +i.collateralValue;
    const cShock = sc.collateralShock != null && sc.collateralShock !== '' ? n0(sc.collateralShock) : n0(sc.valueShock);
    const Vc = V * (1 + cShock / 100);
    const h = n0(i.haircutPct) / 100;
    const eCost = (sc.enforcementCostPct != null && sc.enforcementCostPct !== '' ? n0(sc.enforcementCostPct) : n0(i.enforcementCostPct)) / 100;
    const E = Math.max(0, Math.round(sc.enforcementMonths != null && sc.enforcementMonths !== '' ? n0(sc.enforcementMonths) : n0(i.enforcementMonths)));
    const inst = i.repayment === 'amortizing' ? amount / Math.max(1, T0 - grace) : 0;
    const def = !!sc.default;
    /* default month (when not set): the first month a principal payment falls due — a bullet loan's maturity in the
       scenario (term + delay), an amortizing loan's first instalment */
    const D = def ? clamp(Math.round(sc.defaultMonth != null && sc.defaultMonth !== '' ? n0(sc.defaultMonth) : inst ? grace + 1 : T), 1, T) : null;
    const flows = [{ m: 0, amount: -amount + fee - n0(i.legal), parts: { advance: -amount, fee, legal: -n0(i.legal) } }];
    let bal = amount, acc = 0, interest = 0, extFee = 0, balMonths = 0, walNum = 0, repaid = 0;
    let end = def ? D : T;
    for (let m = 1; m <= end; m++) {
      if (!def && m === T0 + 1 && bal + acc + exitFee <= 1e-9) { T = end = T0; break; }   // fully repaid at maturity: nothing left to delay
      const p = {}; let a = 0;
      const rate = m > T0 ? rExt : r;
      const it = (bal + acc) * rate;   // capitalised (grace / accrued) interest is part of the claim and earns interest
      interest += it; balMonths += bal;
      const missed = def && m === D;
      if (i.interestMode === 'accrued' || m <= grace || missed) acc += it; else { a += it; p.interest = it; }
      if (!missed && inst && m > grace && m <= T0 && bal > 0) { const x = Math.min(inst, bal); a += x; p.principal = x; bal -= x; walNum += x * m; repaid += x; }
      if (n0(i.monitoring)) { a -= n0(i.monitoring); p.monitoring = -n0(i.monitoring); }
      /* the extension fee is charged on the principal still outstanding at maturity (all of it for a bullet loan) */
      if (!def && m === T0 + 1 && T > T0 && n0(i.extMonths) > 0 && bal > 0) { extFee = bal * n0(i.extFeePct) / 100; a += extFee; p.extFee = extFee; }
      flows.push({ m, amount: a, parts: p });
    }
    let paid = 0, claim, shortfall = 0, recovery = null, proceeds;
    if (!def) {
      claim = bal + acc + exitFee;
      proceeds = Math.max(0, Vc * (1 - n0(i.saleCostPct) / 100) - prior);
      paid = Math.min(claim, proceeds); shortfall = claim - paid;
      const L = flows[T]; L.amount += paid; L.parts.repayment = paid;
      walNum += Math.min(bal, paid) * T; repaid += Math.min(bal, paid);
    } else {
      const claimD = bal + acc + exitFee;
      claim = claimD * Math.pow(1 + r, E);                // the claim keeps accruing at the contract rate until recovery
      proceeds = Math.max(0, Vc * (1 - h) * (1 - eCost) - prior);
      paid = Math.min(claim, proceeds); shortfall = claim - paid;
      for (let m = D + 1; m <= D + E; m++) flows.push({ m, amount: 0, parts: {} });
      const L = flows[D + E]; L.amount += paid; L.parts.recovery = paid;
      recovery = { defaultMonth: D, recoveryMonth: D + E, claimAtDefault: claimD, claim, proceeds, recovered: paid, rate: claim > 0 ? paid / claim : null, loss: shortfall, principalLoss: Math.max(0, bal - paid) };
      walNum += Math.min(bal, paid) * (D + E); repaid += Math.min(bal, paid);
    }
    const M = metricsOf(flows, F.t0);
    M.atRisk = M.peakCapital;
    const exposure = amount + acc + exitFee;   // peak claim: principal + capitalized interest + exit fee
    const expBase = def ? recovery.claimAtDefault : exposure;
    const conservative = V * (1 - h);
    const den = (1 - h) * (1 - eCost);
    const beP = den > 0 ? (prior + amount) / den : null;
    /* full claim = the claim a default carries at recovery (unpaid interest of the default month and the enforcement accrual
       included) — on this scenario's default path, or on the default path a default in this scenario would take */
    const claimRec = def ? recovery.claim : inner ? null : (financeModel(F, i, Object.assign({}, sc, { default: true }), true).recovery || {}).claim;
    const beFull = den > 0 && claimRec != null ? (prior + claimRec) / den : null;
    return {
      ok: true, strategy: 'finance', scenario: sc.name || null, flows, months: M.months, ...M,
      amount, term: T0, termEffective: T, fee, exitFee, extFee, interest, feeIncome: fee + exitFee + extFee,
      costs: n0(i.legal) + n0(i.monitoring) * end,
      income: M.profit,
      simpleYield: balMonths > 0 ? M.profit / (balMonths / 12) : null,
      wal: repaid > 0 ? walNum / repaid : null,   // principal-weighted over the principal actually repaid; none repaid → no WAL
      claim, paid, shortfall, proceeds, recovery, defaulted: def,
      collateral: V, collateralStressed: Vc, haircut: h, conservative, priorLiens: prior, exposure: expBase,
      ltv: V > 0 ? (prior + amount) / V : null,
      ltvStressed: Vc > 0 ? (prior + amount) / Vc : null,
      ltc: num(i.projectCost) > 0 ? (prior + amount) / num(i.projectCost) : null,
      coverage: expBase > 0 ? (conservative - prior) / expBase : null,
      coverageStressed: expBase > 0 ? (Vc * (1 - h) - prior) / expBase : null,
      coverageGross: expBase + prior > 0 ? V / (prior + expBase) : null,
      equityCushion: V - prior - expBase,
      conservativeCushion: conservative - prior - expBase,
      borrowerEquity: num(i.borrowerEquity),
      breakEvenCollateral: beP, breakEvenCollateralFull: beFull,
      maxDecline: beP != null ? 1 - beP / V : null,
      delayBeyondExtension: !def && T - T0 > n0(i.extMonths),
      extended: !def && T > T0,
      marginOfSafety: beP != null ? 1 - beP / V : null,
    };
  }

  /* ============================================================== HYBRID */
  /* ex: the option decision when it is being compared (true / false); undefined = decide here */
  function hybridModel(F, i, sc, ex) {
    sc = sc || SCEN_DEF.base;
    const missing = [];
    const capital = n0(i.capital);
    if (!(num(i.realizationValue) > 0)) missing.push('hybrid.realizationValue');
    if (n0(i.participationPct) > 0 && num(i.threshold) == null) missing.push('hybrid.threshold');   // participation above an unknown threshold is not 0
    if (!(num(i.termMonths) >= 1)) missing.push('hybrid.termMonths');
    if (!(capital > 0 || i.backstopOn || i.optionOn)) missing.push('hybrid.capital');
    if (i.optionOn && !(num(i.optionPrice) > 0)) missing.push('hybrid.optionPrice');
    if (i.backstopOn && !(num(i.backstopPrice) > 0)) missing.push('hybrid.backstopPrice');
    if (missing.length) return { ok: false, strategy: 'hybrid', missing };
    const T0 = Math.max(1, Math.round(+i.termMonths));
    const T = Math.max(1, T0 + Math.round(n0(sc.delay)));
    const V = +i.realizationValue * (1 + n0(sc.valueShock) / 100);
    const Vcoll = n0(i.collateralValue || i.realizationValue);
    const cShock = sc.collateralShock != null && sc.collateralShock !== '' ? n0(sc.collateralShock) : n0(sc.valueShock);
    const Vc = Vcoll * (1 + cShock / 100);
    const prior = n0(i.priorLiens), h = n0(i.haircutPct) / 100;
    const eCost = (sc.enforcementCostPct != null && sc.enforcementCostPct !== '' ? n0(sc.enforcementCostPct) : n0(i.enforcementCostPct)) / 100;
    const E = Math.max(0, Math.round(sc.enforcementMonths != null && sc.enforcementMonths !== '' ? n0(sc.enforcementMonths) : n0(i.enforcementMonths)));
    const commit = Math.max(capital, n0(i.maxCommitment));
    const fee = commit * n0(i.feePct) / 100;
    const cpn = n0(i.couponPct) / 100 / 12, pr = n0(i.prefPct) / 100 / 12;
    const def = !!sc.default && capital > 0;
    /* realization window: the last k months up to the realization date */
    const k = clamp(Math.round(n0(i.salesSpreadMonths)), 0, T);
    const realize = k > 0 ? new Set(Array.from({ length: k }, (_, j) => T - k + 1 + j)) : new Set([T]);
    /* default month (when not set): the first month a repayment from realization falls due — the start of the window */
    const D = def ? clamp(Math.round(sc.defaultMonth != null && sc.defaultMonth !== '' ? n0(sc.defaultMonth) : T - Math.max(1, k) + 1), 1, T) : null;
    const sale = n0(i.saleCostPct) / 100, rsCost = n0(i.resaleCostPct) / 100, rsHc = n0(i.resaleHaircutPct) / 100;
    const RS = Math.max(0, Math.round(n0(i.resaleMonths)));
    /* option / backstop: decided at the realization date on the scenario's value. The option is exercised when doing so
       raises ALTARIS' profit: the price ALTARIS pays enters the developer's waterfall, and the share it buys leaves it. */
    const share = i.optionOn ? clamp(n0(i.optionSharePct) / 100, 0, 1) : 0;
    let optEx = false, optPay = 0, optRecv = 0;
    if (!def && i.optionOn && n0(i.optionPrice) > 0) {
      if (ex === undefined) {
        const yes = hybridModel(F, i, sc, true), no = hybridModel(F, i, sc, false);
        return yes.profit > no.profit ? yes : no;
      }
      if (ex) { optEx = true; optPay = n0(i.optionPrice); optRecv = V * share * (1 - rsHc) * (1 - rsCost); }
    }
    const uRaw = sc.backstopUnsoldPct != null && sc.backstopUnsoldPct !== '' ? n0(sc.backstopUnsoldPct) : n0(i.backstopUnsoldPct);
    const u = i.backstopOn && !def ? clamp(uRaw / 100, 0, 1) : 0;
    const remain = 1 - (optEx ? share : 0);   // inventory ALTARIS bought through the option is no longer the developer's to sell or backstop
    const bsPay = u * n0(i.backstopPrice) * remain, bsRecv = u * V * remain * (1 - rsHc) * (1 - rsCost);
    /* the developer's realization, net of prior liens: the waterfall ALTARIS' claim is paid from. Sales proceeds arrive
       evenly over the window; the option / backstop price ALTARIS pays arrives in the month it is paid (the realization date). */
    const devSold = V * remain * (1 - u);
    const salesNet = Math.max(0, devSold * (1 - sale) - prior);
    const N = Math.max(0, devSold * (1 - sale) + optPay + bsPay - prior);
    const flows = [{ m: 0, amount: -capital + fee - n0(i.legal), parts: { capital: -capital, fee, legal: -n0(i.legal) } }];
    let bal = capital, pa = 0, coupons = 0, prefPaid = 0, principalBack = 0, pool = 0, participation = 0;
    const end = def ? D : T;
    for (let m = 1; m <= end; m++) {
      const p = {}; let a = 0;
      const missed = def && m === D;
      pa += (bal + pa) * pr;
      if (bal > 0 && cpn) { const c = bal * cpn; if (missed) pa += c; else { a += c; p.coupon = c; coupons += c; } }
      if (n0(i.monitoring)) { a -= n0(i.monitoring); p.monitoring = -n0(i.monitoring); }
      if (realize.has(m) && (!def || m < D)) {   // on default, payments stop in the default month
        let avail = salesNet / realize.size + (m === T ? N - salesNet : 0);
        const x = Math.min(avail, pa); pa -= x; prefPaid += x; avail -= x;
        const y = Math.min(avail, bal); bal -= y; principalBack += y; avail -= y;
        pool += avail; a += x + y; if (x + y) p.claim = x + y;
      }
      if (!def && m === T) {
        participation = Math.min(pool, n0(i.participationPct) / 100 * Math.max(0, V - n0(i.threshold)));
        a += participation; if (participation) p.participation = participation;
        if (optEx) { a -= optPay; p.optionExercise = -optPay; }
        if (bsPay) { a -= bsPay; p.backstopPurchase = -bsPay; }
      }
      flows.push({ m, amount: a, parts: p });
    }
    if (!def && (optEx || bsPay)) {
      for (let m = T + 1; m <= T + RS; m++) flows.push({ m, amount: 0, parts: {} });
      const L = flows[T + RS];
      L.amount += optRecv + bsRecv; if (optRecv) L.parts.optionResale = optRecv; if (bsRecv) L.parts.backstopResale = bsRecv;
    }
    let recovery = null, shortfall = def ? 0 : bal + pa;
    if (def) {
      const claimD = bal + pa;
      const claim = claimD * Math.pow(1 + cpn + pr, E);
      /* units sold in the window before the default are no longer collateral; the prior liens they repaid are gone too */
      const left = [...realize].filter((m) => m >= D).length / realize.size;
      const salesGross = devSold * (1 - sale);
      const priorLeft = salesGross >= prior ? prior * left : prior - (1 - left) * salesGross;
      const proceeds = Math.max(0, Vc * left * (1 - h) * (1 - eCost) - priorLeft);
      const rec = Math.min(claim, proceeds);
      for (let m = D + 1; m <= D + E; m++) flows.push({ m, amount: 0, parts: {} });
      const L = flows[D + E]; L.amount += rec; L.parts.recovery = rec;
      recovery = { defaultMonth: D, recoveryMonth: D + E, claimAtDefault: claimD, claim, proceeds, recovered: rec, rate: claim > 0 ? rec / claim : null, loss: claim - rec, principalLoss: Math.max(0, bal - rec), collateralLeft: left };
      shortfall = claim - rec;
    }
    const M = metricsOf(flows, F.t0);
    /* claim at the realization date on the contractual path (for coverage) */
    const claimT = capital * Math.pow(1 + pr, T0) + (i.backstopOn ? n0(i.backstopPrice) : 0);   // contractual claim + backstop obligation
    const conservative = Vcoll * (1 - h);
    const maxAtRisk = Math.max(commit, capital + (i.backstopOn ? n0(i.backstopPrice) : 0) + (i.optionOn ? n0(i.optionPrice) : 0), M.peakCapital);
    M.atRisk = maxAtRisk;
    /* the return on the capital committed instead of on the flows:
       - nothing funded in this scenario (a backstop that is not called — legal and monitoring costs are not capital):
         IRR and MOIC on the commitment;
       - capital funded but the flows have no IRR (a fee received before the capital goes out, then repaid with a profit:
         NPV is positive at every rate): IRR on the commitment, MOIC on the capital invested. */
    const funded = capital + optPay + bsPay;
    const horizon = Math.max(1, M.months || T);
    const noIrr = M.irr == null && M.invested > 0 && M.profit > 0;
    const onCommit = maxAtRisk > 0 && (funded <= 1e-9 || noIrr);
    const irrCommit = onCommit ? Math.pow(Math.max(0, 1 + M.profit / maxAtRisk), 12 / horizon) - 1 : null;
    const moicCommit = onCommit && funded <= 1e-9 ? 1 + M.profit / maxAtRisk : null;
    if (funded <= 1e-9) { M.irr = null; M.moic = null; M.roi = null; M.annualized = null; }
    return {
      ok: true, strategy: 'hybrid', scenario: sc.name || null, flows, months: M.months, ...M,
      structure: i.structure, capital, commitment: commit, fee, coupons, prefPaid, principalBack, participation,
      contractual: coupons + prefPaid + fee,
      optionExercised: optEx, optionPaid: optPay, optionResale: optRecv, backstopPaid: bsPay, backstopResale: bsRecv,
      upside: participation + (optRecv - optPay) + (bsRecv - bsPay),
      realization: V, developerNet: N, shortfall, recovery, defaulted: def,
      maxAtRisk, irrCommit, moicCommit, irrBasis: onCommit ? (funded <= 1e-9 ? 'commitment' : 'commitment-no-irr') : null, funded, collateral: Vcoll, collateralStressed: Vc, conservative, priorLiens: prior,
      exposure: claimT,
      coverage: claimT > 0 ? (conservative - prior) / claimT : null,
      ltv: Vcoll > 0 ? (prior + capital + (i.backstopOn ? n0(i.backstopPrice) : 0)) / Vcoll : null,
      equityCushion: Vcoll - prior - claimT,
    };
  }

  const MODEL = { buy: (F, i, sc) => buyModel(F, i, sc), finance: (F, i, sc) => financeModel(F, i, sc), hybrid: (F, i, sc) => hybridModel(F, i, sc) };
  /* the return and capital a result is judged on: IRR / MOIC on invested capital, or — when nothing is funded in that
     scenario (a fee-only commitment), or the funded flows have no IRR — on the capital committed; capital at risk = peak
     outflow, or the larger commitment. irrBasisOf names the basis:
       xirr               the cash-flow IRR
       commitment         HYBRID, nothing funded: (1 + profit ÷ capital at risk)^(12 ÷ months) − 1
       commitment-no-irr  HYBRID, funded, but NPV is positive at every rate: the same formula
       no-irr             any other profitable series without an IRR: the same formula on capital at risk
       total-loss         nothing comes back: −100%
       below-range        a loss whose IRR lies below −99.99% (or NPV negative at every rate): −100% */
  function irrBasisOf(r) {
    if (!r || !r.ok) return null;
    if (r.irr != null) return r.irr === -1 && !(r.distributions > 1e-9) ? 'total-loss' : 'xirr';
    if (r.irrCommit != null) return r.irrBasis || 'commitment';
    if (!(r.invested > 0)) return null;
    return r.profit > 0 && capOf(r) > 0 && r.months > 0 ? 'no-irr' : 'below-range';
  }
  function irrOf(r) {
    const b = irrBasisOf(r);
    if (b === 'xirr' || b === 'total-loss') return r.irr;
    if (b === 'commitment' || b === 'commitment-no-irr') return r.irrCommit;
    if (b === 'no-irr') return Math.pow(1 + r.profit / capOf(r), 12 / r.months) - 1;
    return b === 'below-range' ? -1 : null;
  }
  const moicOf = (r) => (!r || !r.ok ? null : r.moic != null ? r.moic : r.moicCommit != null ? r.moicCommit : null);
  const capOf = (r) => (!r || !r.ok ? null : r.atRisk != null ? r.atRisk : r.peakCapital);

  /* ------------------------------------------------------ solvers */
  function bisect(fn, lo, hi, target, iters = 80) {
    let flo = fn(lo) - target, fhi = fn(hi) - target;
    if (!isNum(flo) || !isNum(fhi) || flo * fhi > 0) return null;
    for (let k = 0; k < iters; k++) {
      const mid = (lo + hi) / 2, fm = fn(mid) - target;
      if (!isNum(fm)) return null;
      if (Math.abs(hi - lo) < 1) return mid;
      if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
    }
    return (lo + hi) / 2;
  }
  /** BUY: the highest purchase price that still meets the IRR hurdle, and the price at zero profit */
  function buyPriceLimits(F, i, minIrr, base) {
    if (!(F.smv > 0) || !(num(i.price) > 0)) return { maxPrice: null, zeroProfitPrice: null };
    const at = (p) => {
      const j = Object.assign({}, i, { price: p });
      if (j.debtMode === 'amount') j.debtAmount = Math.min(n0(i.debtAmount), p);
      return buyModel(F, j, base || SCEN_DEF.base);
    };
    const irrAt = (p) => { const r = at(p); return r.ok ? irrOf(r) ?? -1 : NaN; };   // the IRR the hurdle tests
    const lo = F.smv * 0.05, hi = F.smv * 2;
    const maxPrice = bisect(irrAt, lo, hi, minIrr / 100);
    const zeroProfitPrice = bisect((p) => { const r = at(p); return r.ok ? r.profit : NaN; }, lo, hi, 0);
    return { maxPrice, zeroProfitPrice, requiredDiscount: maxPrice != null ? 1 - maxPrice / F.smv : null };
  }
  /** HYBRID: the realization value at which ALTARIS' profit is zero, and where its capital is first impaired */
  function hybridBreakEven(F, i, unsold, base) {
    const V0 = num(i.realizationValue);
    if (!(V0 > 0)) return { breakEvenValue: null, impairmentValue: null };
    const sc = Object.assign({}, base || SCEN_DEF.base, { backstopUnsoldPct: i.backstopOn ? unsold : null });
    const at = (v) => hybridModel(F, Object.assign({}, i, { realizationValue: v, collateralValue: n0(i.collateralValue || V0) }), sc);
    const pf = (v) => { const r = at(v); return r.ok ? r.profit : NaN; };
    const be = pf(1) >= 0 ? 0 : bisect(pf, 1, V0 * 3, 0);
    /* capital is impaired while the waterfall returns less than the principal */
    const whole = (v) => { const r = at(v); return r.ok ? (r.principalBack >= r.capital - 0.5 ? 1 : -1) : NaN; };
    let impV = null;
    if (n0(i.capital) > 0) impV = whole(1) > 0 ? 0 : bisect(whole, 1, V0 * 3, 0);
    return {
      breakEvenValue: be, impairmentValue: impV,
      maxDeclineBeforeLoss: be != null ? 1 - be / V0 : null,
      maxDeclineBeforeImpairment: impV != null ? 1 - impV / V0 : null,
    };
  }

  /* ---------------------------------------- downside attribution (waterfall) */
  const ATTR_STEPS = {
    buy: [['valueShock'], ['haircutAdd'], ['delay'], ['rateAdd'], ['rentChg'], ['opexChg']],
    finance: [['collateralShock', 'valueShock'], ['delay'], ['default', 'defaultMonth', 'enforcementMonths', 'enforcementCostPct']],
    hybrid: [['valueShock', 'collateralShock'], ['delay'], ['backstopUnsoldPct'], ['default', 'defaultMonth', 'enforcementMonths', 'enforcementCostPct']],
  };
  function attribution(kind, F, inputs, down, start) {
    const steps = [];
    let cur = Object.assign({}, start || SCEN_DEF.base, { name: 'base' });
    const base = MODEL[kind](F, inputs, cur);
    if (!base.ok) return null;
    const irrA = (r) => { const x = irrOf(r); return x == null ? -1 : x; };
    let prev = base.profit, prevIrr = irrA(base);
    for (const keys of ATTR_STEPS[kind]) {
      const next = Object.assign({}, cur);
      let changed = false;
      for (const k of keys) if (down[k] !== undefined && down[k] !== null && down[k] !== '' && down[k] !== cur[k]) { next[k] = down[k]; changed = true; }
      if (!changed) continue;
      const r = MODEL[kind](F, inputs, next);
      if (!r.ok) continue;
      steps.push({ k: keys[0], v: r.profit - prev, dIrr: irrA(r) - prevIrr });
      prev = r.profit; prevIrr = irrA(r); cur = next;
    }
    return { base: base.profit, baseIrr: irrA(base), steps, downside: prev, downsideIrr: prevIrr };
  }

  /* -------------------------------------------------------- risk score */
  const STATUS_LIQ = { completed: 85, construction: 65, permit: 50, planning: 35 };
  const STATUS_PROJ = { completed: 85, construction: 65, permit: 50, planning: 30 };
  const DEV_RATING = { tier1: 90, established: 75, mid: 60, new: 40, unassessed: 45 };
  const SENIORITY = { first: 85, second: 60, other: 40 };
  const STATUS_HE = { planning: 'תכנון', permit: 'היתר בנייה', construction: 'בבנייה', completed: 'גמור' };
  const RATING_HE = { tier1: 'יזם מוביל', established: 'יזם מבוסס', mid: 'יזם בינוני', new: 'יזם חדש', unassessed: 'טרם הוערך' };
  const SENIORITY_HE = { first: 'שעבוד ראשון', second: 'שעבוד שני', other: 'ללא שעבוד ראשון' };
  const ENTRY_DISC = [[0, 10], [0.1, 50], [0.2, 75], [0.3, 95]];
  const ENTRY_LTV = [[0.4, 95], [0.5, 85], [0.6, 70], [0.7, 50], [0.8, 30], [0.9, 10]];
  const COVERAGE = [[0.8, 10], [1, 40], [1.25, 65], [1.5, 85], [2, 95]];
  const VALUE_BASIS = [[1, 30], [1.15, 60], [1.3, 80], [1.5, 95]];
  const DURATION = [[6, 95], [12, 85], [18, 75], [24, 60], [36, 40], [48, 20]];
  const pct = (x, d = 1) => (isNum(x) ? (x * 100).toFixed(d) + '%' : '—');
  const nis = (x) => (isNum(x) ? (x < 0 ? '−' : '') + '₪' + Math.round(Math.abs(x)).toLocaleString('en-US') : '—');
  const nisM = (x) => (isNum(x) ? (x < 0 ? '−' : '') + '₪' + (Math.abs(x) >= 1e6 ? (Math.abs(x) / 1e6).toFixed(Math.abs(x) >= 1e8 ? 0 : Math.abs(x) >= 1e7 ? 1 : 2) + 'M' : Math.round(Math.abs(x) / 1000) + 'K') : '—');
  const mult = (x) => (isNum(x) ? x.toFixed(2) + 'x' : '—');

  function exposureOf(ctx, F, capital, settings) {
    const others = (ctx && ctx.portfolio) || [];
    const fund = n0(settings.fundSize);
    const same = (k, v) => (v ? others.filter((o) => (o[k] || '').trim() && (o[k] || '').trim() === v).reduce((s, o) => s + n0(o.capital), 0) : 0);
    const dev = same('developer', F.developer) + capital, proj = same('project', F.project) + capital, geo = same('city', F.city) + capital;
    return {
      fund, developer: fund ? dev / fund : null, project: fund ? proj / fund : null, city: fund ? geo / fund : null,
      developerNIS: dev, projectNIS: proj, cityNIS: geo,
    };
  }

  function riskOf(kind, R, F, settings, ctx) {
    const base = R.base;
    if (!base || !base.ok) return null;
    const C = [];
    const add = (k, score, why) => C.push({ k, score: Math.round(clamp(score, 0, 100)), why });
    /* 1 entry basis */
    if (kind === 'buy') {
      const d = F.smv && base.price ? 1 - base.price / F.smv : null;
      add('entry', interp(d, ENTRY_DISC) ?? 10, `הנחת כניסה ${pct(d)} לשווי הנתמך (0%→10 · 10%→50 · 20%→75 · 30%+→95)`);
    } else {
      add('entry', interp(base.ltv, ENTRY_LTV) ?? 10, `נקודת כניסה (LTV כולל שעבודים קודמים) ${pct(base.ltv)} (40%→95 · 50%→85 · 60%→70 · 70%→50 · 80%→30)`);
    }
    /* 2 collateral */
    if (kind === 'buy') add('collateral', interp(base.valueToBasis, VALUE_BASIS) ?? 30, `ALTARIS מחזיקה בנכס: שווי נתמך ÷ בסיס כולל ${mult(base.valueToBasis)} (1.0x→30 · 1.15x→60 · 1.3x→80 · 1.5x+→95)`);
    else add('collateral', interp(base.coverage, COVERAGE) ?? 10, `כיסוי בטוחות שמרני ${mult(base.coverage)} — שווי אחרי מקדם ביטחון פחות שעבודים קודמים ÷ החשיפה (1.0x→40 · 1.25x→65 · 1.5x→85 · 2x+→95)`);
    /* 3 exit liquidity */
    {
      const st = STATUS_LIQ[F.status];
      let s = st ?? 50; const why = [st != null ? `סטטוס ${STATUS_HE[F.status]} → ${st}` : 'סטטוס בנייה לא הוזן → 50'];
      if (F.unitsCount === 1) { s += 5; why.push('יחידה בודדת: +5'); }
      else if (F.unitsCount > 60) { s -= 15; why.push('מעל 60 יחידות (קצב ספיגה): −15'); }
      else if (F.unitsCount > 30) { s -= 10; why.push('מעל 30 יחידות (קצב ספיגה): −10'); }
      const depth = ctx && ctx.marketDepth;
      if (depth && isNum(depth.deals)) {
        /* an observed count always carries its period */
        const dmy = (d) => String(d).slice(0, 10).split('-').reverse().join('.');
        const per = depth.from && depth.to ? ` (${dmy(depth.from)}–${dmy(depth.to)})` : '';
        if (depth.deals >= 150) { s += 5; why.push(`${depth.deals} עסקאות מגורים בדגימת PROPX${per}: +5`); }
        else if (depth.deals < 30) { s -= 10; why.push(`רק ${depth.deals} עסקאות מגורים בדגימת PROPX${per}: −10`); }
        else why.push(`${depth.deals} עסקאות מגורים בדגימת PROPX${per}: 0`);
      } else why.push('עומק שוק מקומי לא נבדק: 0');
      if (kind !== 'buy') {
        const inp = R.inputs || {};
        if (inp.sourcePrimary && inp.sourceSecondary && inp.sourcePrimary !== inp.sourceSecondary) { s += 5; why.push('שני מקורות פירעון שונים: +5'); }
      }
      add('liquidity', s, why.join(' · '));
    }
    /* 4 duration */
    add('duration', interp(base.months, DURATION) ?? 20, `משך צפוי ${base.months} חודשים (6→95 · 12→85 · 18→75 · 24→60 · 36→40 · 48+→20)`);
    /* 5 developer */
    add('developer', DEV_RATING[F.developerRating] ?? 45, F.developerRating === 'unassessed' || !DEV_RATING[F.developerRating]
      ? 'דירוג היזם לא הוערך על ידי האנליסט → 45' : `הערכת אנליסט: ${RATING_HE[F.developerRating]} → ${DEV_RATING[F.developerRating]}`);
    /* 6 project */
    {
      let s = STATUS_PROJ[F.status] ?? 45; const why = [STATUS_PROJ[F.status] != null ? `סטטוס ${STATUS_HE[F.status]} → ${STATUS_PROJ[F.status]}` : 'סטטוס לא הוזן → 45'];
      if (F.status === 'construction' && F.completionDate) {
        const months = daysBetween(F.t0, F.completionDate) / 30.44;
        if (isNum(months) && months <= 12) { s += 5; why.push('אכלוס צפוי בתוך 12 חודשים: +5'); }
        else if (isNum(months) && months > 30) { s -= 10; why.push('אכלוס בעוד יותר מ-30 חודשים: −10'); }
      }
      add('project', s, why.join(' · '));
    }
    /* 7 concentration */
    {
      const ex = exposureOf(ctx, F, capOf(base), settings);
      const parts = [['developer', settings.maxDevExposure, 'יזם'], ['project', settings.maxProjectExposure, 'פרויקט'], ['city', settings.maxGeoExposure, 'יישוב']]
        .map(([k, lim, he]) => ({ k, he, use: ex[k], lim: lim / 100 }));
      let worst = 0; const why = [];
      for (const p of parts) {
        if (!isNum(p.use) || !(p.lim > 0)) continue;
        const ratio = p.use / p.lim; worst = Math.max(worst, ratio);
        why.push(`${p.he} ${pct(p.use)} מהקרן (תקרה ${pct(p.lim, 0)})`);
      }
      const s = worst > 1 ? 20 : 100 - worst * 60;
      add('concentration', s, (why.join(' · ') || 'גודל קרן לא הוגדר') + (worst > 1 ? ' — חריגה מתקרה → 20' : ' — 100 − 60 × ניצול התקרה הגבוה'));
    }
    /* 8 structure protection */
    if (kind === 'buy') {
      const mh = base.maxHaircut;
      add('protection', 40 + Math.min(40, Math.max(0, (mh || 0) * 160)), `ללא הגנה חוזית — 40 + מרווח עד הפסד ${pct(mh)} × 160 (תקרה +40)`);
    } else {
      const inp = R.inputs || {};
      let s = SENIORITY[inp.seniority] ?? 40; const why = [`${SENIORITY_HE[inp.seniority] || 'דרגת בטוחה לא ידועה'} → ${s}`];
      if (kind === 'finance' && inp.repayment === 'amortizing') { s += 5; why.push('פירעון שוטף: +5'); }
      if (kind === 'hybrid' && inp.optionOn) { s += 5; why.push('אופציית רכישה: +5'); }
      if (kind === 'hybrid' && inp.backstopOn) { s -= 10; why.push('התחייבות גיבוי (backstop): −10'); }
      add('protection', s, why.join(' · '));
    }
    const w = settings.weights || {};
    let tw = 0, ts = 0;
    for (const c of C) { const wt = n0(w[c.k] ?? 1); c.weight = wt; tw += wt; ts += wt * c.score; }
    return { components: C, overall: tw > 0 ? Math.round(ts / tw) : null };
  }

  /* ------------------------------------------------- hurdles and signal */
  function hurdlesOf(kind, R, F, settings, ctx) {
    const b = R.base; if (!b || !b.ok) return [];
    const H = [];
    const chk = (k, value, limit, pass, fmt) => H.push({ k, value, limit, pass: !!pass, fmt });
    const bi = irrOf(b), bm = moicOf(b);
    chk('irr', bi, settings.minIrr / 100, bi != null && bi >= settings.minIrr / 100, 'pct');
    chk('moic', bm, settings.minMoic, bm != null && bm >= settings.minMoic, 'x');
    if (kind === 'buy') { const disc = F.smv ? 1 - b.price / F.smv : null; chk('discount', disc, settings.minDiscount / 100, disc != null && disc >= settings.minDiscount / 100, 'pct'); }
    else {
      chk('ltv', b.ltv, settings.maxLtv / 100, b.ltv != null && b.ltv <= settings.maxLtv / 100, 'pct');
      chk('coverage', b.coverage, settings.minCoverage, b.coverage != null && b.coverage >= settings.minCoverage, 'x');
    }
    chk('duration', b.months, settings.maxDuration, b.months <= settings.maxDuration, 'months');
    const mos = R.mos;
    chk('mos', mos, settings.minMos / 100, mos != null && mos >= settings.minMos / 100, 'pct');
    const ex = exposureOf(ctx, F, capOf(b), settings);
    if (ex.fund) {
      chk('devExposure', ex.developer, settings.maxDevExposure / 100, ex.developer <= settings.maxDevExposure / 100, 'pct');
      chk('projectExposure', ex.project, settings.maxProjectExposure / 100, ex.project <= settings.maxProjectExposure / 100, 'pct');
      chk('geoExposure', ex.city, settings.maxGeoExposure / 100, ex.city <= settings.maxGeoExposure / 100, 'pct');
    }
    return H;
  }
  const HURDLE_HE = {
    irr: 'IRR מינימלי', moic: 'MOIC מינימלי', discount: 'הנחת כניסה מינימלית', ltv: 'LTV מקסימלי', coverage: 'כיסוי בטוחות מינימלי',
    duration: 'משך מקסימלי', mos: 'מרווח ביטחון מינימלי', devExposure: 'חשיפה ליזם', projectExposure: 'חשיפה לפרויקט', geoExposure: 'חשיפה גיאוגרפית',
  };
  const fmtH = (h, v) => (h.fmt === 'pct' ? pct(v) : h.fmt === 'x' ? mult(v) : h.fmt === 'months' ? (isNum(v) ? v + ' ח׳' : '—') : String(v));

  function signalOf(S, settings) {
    const w = clamp(n0(settings.downsideWeight), 0, 100) / 100;
    const rows = STRATS.filter((k) => S[k] && S[k].base && S[k].base.ok).map((k) => {
      const s = S[k], b = s.base, d = s.downside && s.downside.ok ? s.downside : null;
      const dIrr = d ? (irrOf(d) ?? -1) : null;
      const bIrr = irrOf(b) ?? -1;
      const ra = dIrr == null ? bIrr : (1 - w) * bIrr + w * dIrr;
      const fails = s.hurdles.filter((h) => !h.pass);
      return { k, ra, bIrr, dIrr, fails, risk: s.risk ? s.risk.overall : null, capital: capOf(b), profit: b.profit, coverage: b.coverage, months: b.months, dProfit: d ? d.profit : null };
    });
    if (!rows.length) return { code: 'INCOMPLETE', strategy: null, why: ['חסרים נתונים לחישוב: בחרו שווי לצורך חיתום והזינו את תנאי המבנה.'], ranking: [] };
    const eligible = rows.filter((r) => !r.fails.length).sort((a, b) => b.ra - a.ra || (b.risk || 0) - (a.risk || 0));
    const ranking = rows.slice().sort((a, b) => b.ra - a.ra);
    const why = [];
    const nm = (k) => LABEL[k].en;
    const wTxt = `תשואה מותאמת-סיכון = ${Math.round((1 - w) * 100)}% IRR בסיס + ${Math.round(w * 100)}% IRR בתרחיש השלילי`;
    const failTxt = (r) => r.fails.map((f) => `${HURDLE_HE[f.k]} (${fmtH(f, f.value)} מול ${fmtH(f, f.limit)})`).join(', ');
    if (eligible.length) {
      const best = eligible[0];
      const code = best.k === 'buy' ? 'STRONG BUY' : best.k === 'finance' ? 'PREFER FINANCE' : 'PREFER HYBRID';
      const others = ranking.filter((r) => r.k !== best.k);
      why.push(`${nm(best.k)} הוא המבנה החזק ביותר בהתאמה לסיכון מבין המבנים שעומדים בכל ספי הקרן: תשואה מותאמת-סיכון ${pct(best.ra)} (${wTxt}).`);
      for (const o of others) {
        const bits = [];
        if (isNum(o.capital) && o.capital > 0 && isNum(best.capital)) {
          const dc = (best.capital - o.capital) / o.capital;
          if (Math.abs(dc) >= 0.05) bits.push(dc < 0 ? `${nm(best.k)} דורש ${pct(-dc, 0)} פחות הון` : `${nm(best.k)} דורש ${pct(dc, 0)} יותר הון`);
        }
        if (Math.abs(best.bIrr - o.bIrr) <= 0.02) bits.push(`IRR בסיס דומה (${pct(best.bIrr)} לעומת ${pct(o.bIrr)})`);
        else bits.push(`IRR בסיס ${pct(best.bIrr)} לעומת ${pct(o.bIrr)}`);
        if (best.dIrr != null && o.dIrr != null) bits.push(`בתרחיש השלילי ${pct(best.dIrr)} לעומת ${pct(o.dIrr)}`);
        if (o.fails.length) bits.push(`${nm(o.k)} אינו עומד ב-${failTxt(o)}${o.ra > best.ra ? ` — אף שתשואתו המותאמת-סיכון (${pct(o.ra)}) גבוהה יותר` : ''}`);
        else bits.push(`תשואה מותאמת-סיכון של ${nm(o.k)}: ${pct(o.ra)}`);
        why.push(`לעומת ${nm(o.k)}: ` + bits.join('; ') + '.');
      }
      if (best.k !== 'buy' && isNum(best.coverage)) why.push(`כיסוי הבטוחות השמרני של ${nm(best.k)} הוא ${mult(best.coverage)}.`);
      why.push(`עומד בכל ${S[best.k].hurdles.length} ספי הקרן שהוגדרו.`);
      return { code, strategy: best.k, why, ranking, weight: w };
    }
    const closest = rows.slice().sort((a, b) => a.fails.length - b.fails.length || b.ra - a.ra)[0];
    const anyProfit = rows.some((r) => r.profit > 0);
    if (!anyProfit || closest.fails.length > 2 || closest.bIrr < 0) {
      why.push(`אף מבנה אינו עומד בספי הקרן. הקרוב ביותר הוא ${nm(closest.k)}, שנכשל ב-${closest.fails.length} ספים: ${failTxt(closest)}.`);
      if (!anyProfit) why.push('אף מבנה אינו מניב רווח בתרחיש הבסיס.');
      return { code: 'DO NOT PROCEED', strategy: null, why, ranking, closest: closest.k, weight: w };
    }
    why.push(`${nm(closest.k)} קרוב לעמידה בספי הקרן אך נכשל ב: ${failTxt(closest)}. נדרש דיון בוועדה או שינוי תנאים.`);
    why.push(`תשואה מותאמת-סיכון: ${ranking.map((r) => `${nm(r.k)} ${pct(r.ra)}`).join(' · ')} (${wTxt}).`);
    return { code: 'REVIEW', strategy: closest.k, why, ranking, closest: closest.k, weight: w };
  }

  /* ------------------------------------------------------ capital velocity */
  function velocityOf(b, settings) {
    if (!b || !b.ok || !(b.months > 0)) return null;
    const lifeM = Math.round(n0(settings.fundLifeYears) * 12), lag = Math.max(0, Math.round(n0(settings.redeployLagMonths)));
    const cycleM = b.months + lag;
    const cycles = lifeM > 0 ? Math.max(1, Math.floor((lifeM + lag) / cycleM)) : 1;
    const cap = capOf(b), moic = moicOf(b) ?? 1;
    const schedule = [];
    let value = cap;
    for (let n = 0; n < cycles; n++) {
      const start = n * cycleM, endM = start + b.months;
      schedule.push({ n: n + 1, startMonth: start, endMonth: endM, deployed: value, returned: value * moic });
      value = value * moic;
    }
    return {
      capital: cap, months: b.months, returnDate: b.exitDate, turnsPerYear: 12 / b.months, irr: irrOf(b),
      cycles, cumulativeDeployed: sum(schedule.map((s) => s.deployed)), aumHeld: cap, endValue: value,
      cumulativeFlat: cap * cycles, schedule, lifeMonths: lifeM, lagMonths: lag,
    };
  }

  /* --------------------------------------------------------------- run */
  function runStrategy(kind, deal, F, settings, ctx) {
    const { inputs, defaulted } = resolve(kind, deal, F);
    const model = MODEL[kind];
    /* the deal's own base scenario (as entered) is the starting point of every derived result: stresses add to it */
    const B = scenario(deal, 'base');
    const base = model(F, inputs, B);
    const out = { kind, inputs, defaulted, base };
    if (!base.ok) return out;
    out.downside = model(F, inputs, scenario(deal, 'downside'));
    out.upside = model(F, inputs, scenario(deal, 'upside'));
    out.stress = {};
    for (const s of STRESS) {
      const sc = Object.assign({}, B, { name: s.id });
      for (const k of ['valueShock', 'delay', 'rateAdd']) if (s[k] != null) sc[k] = n0(B[k]) + s[k];
      if (s.valueShock != null) sc.collateralShock = sc.valueShock;
      out.stress[s.id] = model(F, inputs, sc);
    }
    if (kind === 'buy') {
      out.limits = buyPriceLimits(F, inputs, settings.minIrr, B);
      out.mos = base.maxHaircut;
    } else if (kind === 'finance') {
      out.extension = model(F, inputs, Object.assign({}, B, { name: 'extension', delay: n0(B.delay) + n0(inputs.extMonths) }));
      out.recoveryCase = out.downside && out.downside.defaulted ? out.downside
        : model(F, inputs, Object.assign({}, scenario(deal, 'downside'), { default: true, name: 'recovery' }));
      out.mos = base.maxDecline;
    } else {
      out.breakEven = hybridBreakEven(F, inputs, scenario(deal, 'downside').backstopUnsoldPct, B);
      out.recoveryCase = out.downside && out.downside.defaulted ? out.downside
        : model(F, inputs, Object.assign({}, scenario(deal, 'downside'), { default: true, name: 'recovery' }));
      out.mos = out.breakEven.maxDeclineBeforeImpairment ?? out.breakEven.maxDeclineBeforeLoss;
    }
    out.attribution = attribution(kind, F, inputs, scenario(deal, 'downside'), B);
    out.velocity = velocityOf(base, settings);
    return out;
  }

  function run(deal, userSettings, ctx) {
    ctx = ctx || {};
    const settings = settingsOf(userSettings);
    const F = facts(deal, ctx.today);
    const S = {};
    for (const k of STRATS) {
      S[k] = runStrategy(k, deal, F, settings, ctx);
      S[k].risk = riskOf(k, S[k], F, settings, ctx);
      S[k].hurdles = hurdlesOf(k, S[k], F, settings, ctx);
    }
    const signal = signalOf(S, settings);
    const compare = compareRows(S, F);
    const ic = icOf(S, F, signal, deal, settings);
    return { version: VERSION, facts: F, settings, strategies: S, signal, compare, ic, ready: !!F.smv };
  }

  /* ------------------------------------------------------- compare table */
  function compareRows(S, F) {
    const col = (k) => {
      const s = S[k], b = s.base;
      if (!b || !b.ok) return { ok: false, missing: b ? b.missing : [] };
      const d = s.downside && s.downside.ok ? s.downside : null, u = s.upside && s.upside.ok ? s.upside : null;
      const exitDep = b.finalShare;
      return {
        ok: true, capital: capOf(b), peak: b.peakCapital, months: b.months, profit: b.profit, irr: irrOf(b), irrDown: irrOf(d), irrUp: irrOf(u),
        irrBasis: irrBasisOf(b),
        moic: moicOf(b), mos: s.mos, coverage: k === 'buy' ? b.valueToBasis : b.coverage, coverageKind: k === 'buy' ? 'value-to-basis' : 'collateral',
        downProfit: d ? d.profit : null, recoveryRate: d && d.recovery ? d.recovery.rate : null,
        turns: s.velocity ? s.velocity.turnsPerYear : null, exitDependency: exitDep,
        exitDependencyLevel: exitDep == null ? null : exitDep >= 0.85 ? 'high' : exitDep >= 0.6 ? 'medium' : 'low',
        liquidity: b.months <= 12 ? 'high' : b.months <= 24 ? 'medium' : 'low',
        risk: s.risk ? s.risk.overall : null,
        hurdlesPassed: s.hurdles.filter((h) => h.pass).length, hurdlesTotal: s.hurdles.length,
        ltv: b.ltv,
      };
    };
    return { buy: col('buy'), finance: col('finance'), hybrid: col('hybrid') };
  }

  /* ------------------------------------------------ investment committee */
  const SOURCE_HE = {
    'apartment-sales': 'מכירת דירות', 'bank-refinancing': 'מחזור בנקאי', 'project-refinancing': 'מחזור ליווי פרויקט',
    'developer-equity': 'הון עצמי של היזם', 'asset-sale': 'מכירת הנכס', 'unit-sales': 'מכירת יחידות בשוק', 'bulk-sale': 'מכירה במקשה אחת',
    'rental-hold': 'השכרה והמשך החזקה', 'other': 'אחר',
  };
  function icOf(S, F, signal, deal, settings) {
    const k = (deal && deal.selected && S[deal.selected] && S[deal.selected].base.ok) ? deal.selected
      : signal.strategy || (STRATS.find((x) => S[x].base && S[x].base.ok) || null);
    if (!k) return { strategy: null, why: [], risks: ['חסרים נתונים לחישוב.'] };
    const s = S[k], b = s.base, d = s.downside && s.downside.ok ? s.downside : null;
    const pos = [];
    if (F.discount != null && F.discount > 0) pos.push({ w: F.discount * 3, t: `+ הנחת כניסה של ${pct(F.discount)} לשווי הנתמך` });
    const levels = [20, 15, 10, 5];
    const holds = levels.find((v) => { const r = s.stress['v' + v]; return r && r.ok && r.profit >= 0; });
    if (holds) pos.push({ w: holds / 20, t: k === 'buy' ? `+ נשאר רווחי גם בירידת שווי יציאה של ${holds}%` : `+ נשאר רווחי גם בירידת שווי בטוחות של ${holds}%` });
    if (k === 'buy' && isNum(b.cushion) && b.cushion > 0) pos.push({ w: 0.6, t: `+ כרית ביטחון מוערכת של ${nisM(b.cushion)} מעל נקודת האיזון` });
    if (k !== 'buy' && isNum(b.equityCushion) && b.equityCushion > 0) pos.push({ w: 0.6, t: `+ כרית הון של היזם ${nisM(b.equityCushion)} מתחת לחשיפת ALTARIS` });
    if (k !== 'buy' && isNum(b.coverage) && b.coverage >= settings.minCoverage) pos.push({ w: b.coverage / 2, t: `+ כיסוי בטוחות שמרני של ${mult(b.coverage)}` });
    if (b.months <= settings.maxDuration) pos.push({ w: 0.5, t: `+ משך הון צפוי של ${b.months} חודשים` });
    if (irrOf(b) != null && irrOf(b) >= settings.minIrr / 100) pos.push({ w: 0.7, t: `+ IRR בסיס ${pct(irrOf(b))} מעל רף הקרן (${settings.minIrr}%)` });
    const inp = s.inputs;
    const exits = k === 'buy' ? [inp.exitPrimary, inp.exitSecondary] : [inp.sourcePrimary, inp.sourceSecondary];
    if (exits[0] && exits[1] && exits[0] !== exits[1]) pos.push({ w: 0.4, t: `+ שתי חלופות יציאה: ${SOURCE_HE[exits[0]] || exits[0]} / ${SOURCE_HE[exits[1]] || exits[1]}` });
    if (d && d.profit >= 0) pos.push({ w: 0.9, t: `+ רווחי גם בתרחיש השלילי (${nisM(d.profit)})` });
    const why = pos.sort((a, b) => b.w - a.w).slice(0, 5).map((p) => p.t);
    const risks = [];
    if (F.chosen === 'developer') risks.push('מחיר המחירון של היזם נבחר כשווי לצורך חיתום — אינו שווי שוק בלתי תלוי.');
    if (!F.sources.appraisal) risks.push('לא הוזנה שומה בלתי תלויה.');
    if (F.spread != null && F.spread > 0.1) risks.push(`פער של ${pct(F.spread, 0)} בין מקורות השווי.`);
    if (d && d.profit < 0) risks.push(`הפסד של ${nisM(-d.profit)} בתרחיש השלילי (IRR ${pct(irrOf(d))}).`);
    if (d && d.recovery && d.recovery.principalLoss > 0) risks.push(`פגיעה בקרן של ${nisM(d.recovery.principalLoss)} בתרחיש מימוש בטוחות.`);
    if (k === 'buy' && b.loanMaturesBeforeExit) risks.push('ההלוואה לרכישה נפרעת לפני מועד היציאה — נדרש מחזור או הון נוסף.');
    for (const h of s.hurdles.filter((x) => !x.pass)) risks.push(`${HURDLE_HE[h.k]}: ${fmtH(h, h.value)} מול סף ${fmtH(h, h.limit)}.`);
    if (b.finalShare != null && b.finalShare >= 0.9) risks.push(`תלות גבוהה באירוע היציאה: ${pct(b.finalShare, 0)} מהתקבולים מגיעים במועד אחד.`);
    if (F.status === 'planning' || F.status === 'permit') risks.push('הפרויקט טרם בבנייה — סיכון ביצוע והשלמה.');
    if (!F.status) risks.push('סטטוס הבנייה לא הוזן.');
    if (F.developerRating === 'unassessed') risks.push('היזם טרם הוערך על ידי האנליסט.');
    if (k === 'buy' && inp.rentOn) risks.push('התשואה כוללת הכנסות שכירות — הנחה שיש לאמת.');
    if (k === 'buy' && !(n0(inp.profitTaxPct) || n0(inp.vatPct) || n0(inp.otherTax))) risks.push('הנחות מס על הרווח לא הוזנו — התשואות לפני מס.');
    if (k === 'buy' && b.debtCapped) risks.push('סכום החוב שהוזן גבוה ממחיר הרכישה — החוב הוגבל למחיר.');
    /* every memo names what the return depends on, and how that source fares in the downside */
    if (exits[0]) risks.push(`התשואה תלויה ב${SOURCE_HE[exits[0]] || exits[0]}${d ? ` — בתרחיש השלילי: IRR ${pct(irrOf(d))}, רווח ${nisM(d.profit)}${d.recovery ? `, גבייה ${pct(d.recovery.rate, 0)} מהתביעה` : ''}` : ''}.`);
    const main = (s.risk && s.risk.components.slice().sort((a, b) => a.score - b.score)[0]) || null;
    const prot = (s.risk && s.risk.components.slice().sort((a, b) => b.score - a.score)[0]) || null;
    return {
      strategy: k, why, risks,
      primaryExit: exits[0] || null, secondaryExit: exits[1] || null,
      mainRisk: risks[0] || (main ? main.why : null), mainRiskComponent: main ? main.k : null,
      mainProtection: why[0] || (prot ? prot.why : null), mainProtectionComponent: prot ? prot.k : null,
    };
  }

  /* ----------------------------------------------------------- portfolio */
  /**
   * portfolio(items, settings, ctx) — items: [{id, deal, status, archived}].
   * Each deal runs with its own selected structure (or the signal's), against the
   * other deals as its concentration context.
   */
  function portfolio(items, userSettings, ctx) {
    ctx = ctx || {};
    const settings = settingsOf(userSettings);
    const live = (items || []).filter((x) => x && x.deal && !x.archived && x.status !== 'declined' && x.status !== 'exited');
    const pick = (x, r) => (x.deal.selected && r.strategies[x.deal.selected] && r.strategies[x.deal.selected].base.ok ? x.deal.selected : r.signal.strategy || r.ic.strategy);
    /* pass 1: each deal's capital at risk on its own; then each deal judged with the others as its concentration context —
       repeated while a deal's structure or capital still changes under that context (at most 5 passes), so no deal is
       judged against capital the others no longer hold */
    const capIn = ({ r, k }) => (k ? capOf(r.strategies[k].base) : 0);
    let pre = live.map((x) => { const r = run(x.deal, settings, { today: ctx.today }); const k = pick(x, r); return { x, r, k }; });
    for (let pass = 0; pass < 5; pass++) {
      const others = pre.map((p) => ({ id: p.x.id, developer: p.r.facts.developer, project: p.r.facts.project, city: p.r.facts.city, capital: capIn(p) }));
      const next = pre.map(({ x }) => {
        const r = run(x.deal, settings, { today: ctx.today, portfolio: others.filter((o) => o.id !== x.id) });
        return { x, r, k: pick(x, r) };
      });
      const stable = next.every((n, j) => n.k === pre[j].k && capIn(n) === capIn(pre[j]));
      pre = next;
      if (stable) break;
    }
    const rows = pre.map(({ x, r, k }) => {
      const s = k ? r.strategies[k] : null, b = s && s.base.ok ? s.base : null;
      return {
        id: x.id, name: x.deal.name || (x.deal.info && x.deal.info.name) || '—', status: x.status || 'draft',
        developer: r.facts.developer, project: r.facts.project, city: r.facts.city, strategy: k,
        capital: b ? capOf(b) : null, smv: r.facts.smv, ltv: b ? b.ltv : null, irr: b ? irrOf(b) : null, moic: b ? moicOf(b) : null,
        months: b ? b.months : null, exitDate: b ? b.exitDate : null, risk: s && s.risk ? s.risk.overall : null,
        signal: r.signal.code, flows: b ? b.dated : [],
      };
    });
    const ok = rows.filter((r) => isNum(r.capital) && r.capital > 0);
    const cap = sum(ok.map((r) => r.capital));
    const wavg = (f) => { const v = ok.filter((r) => isNum(r[f])); const c = sum(v.map((r) => r.capital)); return c > 0 ? sum(v.map((r) => r[f] * r.capital)) / c : null; };
    /* deals without a developer / city name are not one counterparty: they stay out of the concentration lists */
    const by = (f) => {
      const m = new Map();
      for (const r of ok) { const key = r[f]; if (key) m.set(key, (m.get(key) || 0) + r.capital); }
      return [...m.entries()].map(([key, v]) => ({ key, capital: v, share: cap > 0 ? v / cap : null, ofFund: settings.fundSize ? v / settings.fundSize : null })).sort((a, b) => b.capital - a.capital);
    };
    const today = ctx.today || iso(Date.now());
    const within = (months) => {
      const lim = addMonths(today, months);
      let s = 0;
      for (const r of ok) for (const f of r.flows) if (f.amount > 0 && f.date >= today && f.date <= lim) s += f.amount;
      return s;
    };
    const calendar = new Map();
    for (const r of ok) for (const f of r.flows) if (f.amount > 0 && f.date >= today) {
      const d = new Date(parseISO(f.date)); const q = d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
      calendar.set(q, (calendar.get(q) || 0) + f.amount);
    }
    return {
      rows, settings,
      summary: {
        deals: rows.length, capital: cap, smv: sum(ok.map((r) => r.smv || 0)),
        irr: wavg('irr'), moic: wavg('moic'), months: wavg('months'),
        byStrategy: by('strategy'), byDeveloper: by('developer'), byCity: by('city'),
        topDeveloperShare: by('developer')[0] ? by('developer')[0].share : null,
        topCityShare: by('city')[0] ? by('city')[0].share : null,
        unnamed: { developer: sum(ok.filter((r) => !r.developer).map((r) => r.capital)), city: sum(ok.filter((r) => !r.city).map((r) => r.capital)) },
        upcoming: ok.filter((r) => r.exitDate && r.exitDate >= today).sort((a, b) => (a.exitDate < b.exitDate ? -1 : 1)).slice(0, 6)
          .map((r) => ({ id: r.id, name: r.name, exitDate: r.exitDate, strategy: r.strategy, capital: r.capital })),
        liquidity: { m3: within(3), m6: within(6), m12: within(12) },
        calendar: [...calendar.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([q, v]) => ({ q, v })),
        fundUse: settings.fundSize ? cap / settings.fundSize : null,
      },
    };
  }

  return {
    VERSION, STRATS, LABEL, DEF, SCEN_DEF, SCEN_KEYS, STRESS, SETTINGS_DEF, HYB_PRESET, HYB_STRUCTURES, VALUE_SOURCES, SOURCE_HE, HURDLE_HE,
    num, clamp, interp, xirr, addMonths, daysBetween, metricsOf, irrOf, irrBasisOf, moicOf, capOf,
    facts, resolve, scenario, settingsOf,
    buyModel, financeModel, hybridModel, buyPriceLimits, hybridBreakEven, attribution,
    riskOf, hurdlesOf, signalOf, velocityOf, compareRows, icOf, run, portfolio,
    fmt: { pct, nis, nisM, mult },
    TABLES: { ENTRY_DISC, ENTRY_LTV, COVERAGE, VALUE_BASIS, DURATION, STATUS_LIQ, STATUS_PROJ, DEV_RATING, SENIORITY },
  };
});
