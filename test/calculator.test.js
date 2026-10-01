// PROPX · investor calculator — offline tests.
// `node test/calculator.test.js`
//
// The calculator is the investor's own scenario. It must be visible and
// working, compute only from what the investor entered (an empty or invalid
// input makes every result that needs it UNAVAILABLE — never a default),
// assume no appreciation or rent growth by itself, and stay fully apart from
// the dormant capital model (scores, rankings, the approximate curve).

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
const ENGINE = block('/* @calc-engine:start', '/* @calc-engine:end */');
const UI = block('/* @calc-ui:start */', '/* @calc-ui:end */');
// a bare context: only the JavaScript built-ins. Any reach for the page
// (document, state, LOC, MKT, metricsOf …) throws a ReferenceError here.
const { calcEngine, calcIrr, CALC_IN, CALC_NEED } = vm.runInNewContext(ENGINE + '\n;({calcEngine,calcIrr,CALC_IN,CALC_NEED})', {});

let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
};
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

const FULL = { price: '2,000,000', equity: '800000', tax: '8', fees: '2', rate: '5', term: '25', rent: '6000',
  vac: '4', opex: '10', hold: '10', rentG: '2', app: '2', sell: '2' };
const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(String(v).replace(/,/g, ''))]));

/* an independent reference: month-by-month amortization instead of the
   closed-form balance, its own IRR search, its own loops */
function reference(raw) {
  const i = num(raw);
  const cost = i.price * (1 + (i.tax + i.fees) / 100);
  const loan = Math.max(0, cost - i.equity), inv = cost - loan;
  const r = i.rate / 100 / 12, n = i.term * 12;
  const pmt = loan === 0 ? 0 : r === 0 ? loan / n : loan * r / (1 - (1 + r) ** -n);
  let bal = loan;
  for (let m = 1; m <= Math.min(i.hold * 12, n); m++) bal += bal * r - pmt;
  if (Math.abs(bal) < 1e-6) bal = 0;
  const noi = i.rent * 12 * (1 - (i.vac + i.opex) / 100);
  const flows = [-inv];
  let cum = 0;
  for (let y = 1; y <= i.hold; y++) {
    const cf = noi * (1 + i.rentG / 100) ** (y - 1) - (y <= i.term ? pmt * 12 : 0);
    cum += cf; flows.push(cf);
  }
  const exitV = i.price * (1 + i.app / 100) ** i.hold;
  const exitEq = exitV * (1 - i.sell / 100) - bal;
  flows[flows.length - 1] += exitEq;
  const npv = (k) => flows.reduce((a, c, y) => a + c / (1 + k) ** y, 0);
  let lo = -0.95, hi = 2;
  for (let k = 0; k < 400; k++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return { cost, loan, ltv: loan / i.price * 100, pmt, gross: i.rent * 12 / i.price * 100, noi, net: noi / cost * 100,
    cf: noi / 12 - pmt, coc: (noi - pmt * 12) / inv * 100, exitV, debtRem: bal, exitEq, cumCf: cum,
    profit: exitEq + cum - inv, irr: (lo + hi) / 2 * 100 };
}

console.log('engine — isolation');
t('the engine runs with nothing but JavaScript built-ins (no page, board or model access)', () => {
  assert.equal(typeof calcEngine, 'function');
  assert.equal(CALC_IN.length, 13);
});
t('engine and UI reference no capital model, score, ranking or curve', () => {
  const banned = /\bci[A-Z]\w*|\bCI_[A-Z_]+|NATIONAL_CURVE|localCurve|rankable|\bscore|ciOppOf|seriesFor/;
  for (const [name, src] of [['engine', ENGINE], ['ui', UI]]) {
    const hit = banned.exec(src);
    assert.ok(!hit, `${name} references ${hit && hit[0]}`);
  }
  assert.ok(!/\b(document|window|state|LOC|MKT|metricsOf)\b/.test(ENGINE), 'engine reaches into the page');
});

console.log('engine — arithmetic');
t('a full scenario matches the independent reference on every result', () => {
  const r = calcEngine(FULL), ref = reference(FULL);
  for (const k of Object.keys(CALC_NEED)) {
    assert.ok(r.out[k].ok, k + ' unavailable with every input present');
    const tol = ['ltv', 'gross', 'net', 'coc', 'irr'].includes(k) ? 1e-6 : 1e-4 * Math.max(1, Math.abs(ref[k]));
    near(r.out[k].v, ref[k], tol, k);
  }
  near(r.out.cost.v, 2200000, 1e-6, 'cost');
  near(r.out.loan.v, 1400000, 1e-6, 'loan');
  near(r.out.pmt.v, 8184.26, 0.005, 'pmt');   // ₪1.4M, 5%, 25 years — the standard annuity figure
});
t('zero interest repays the loan in equal instalments', () => {
  const r = calcEngine({ ...FULL, rate: '0' });
  near(r.out.pmt.v, 1400000 / 300, 1e-9, 'pmt');
  near(r.out.debtRem.v, 1400000 * (1 - 120 / 300), 1e-6, 'balance');
});
t('equity at or above the total cost means no mortgage, and the surplus is reported', () => {
  const r = calcEngine({ ...FULL, equity: '2500000' });
  assert.equal(r.out.loan.v, 0); assert.equal(r.out.pmt.v, 0); assert.equal(r.out.ltv.v, 0);
  near(r.surplus, 300000, 1e-6, 'surplus');
  near(r.out.coc.v, 61920 / 2200000 * 100, 1e-9, 'cash-on-cash on the cost actually invested');
});
t('no equity invested: cash-on-cash and IRR are UNAVAILABLE with a reason, not a number', () => {
  const r = calcEngine({ ...FULL, equity: '0' });
  assert.equal(r.out.coc.ok, false); assert.equal(r.out.coc.why, 'zeroEq');
  assert.equal(r.out.irr.ok, false); assert.equal(r.out.irr.why, 'zeroEq');
  assert.ok(r.out.loan.ok && r.out.cf.ok, 'other results still computed');
});
t('cash flows with no single IRR say so instead of returning a number', () => {
  const r = calcEngine({ ...FULL, opex: '100', app: '-50', sell: '20' });
  assert.equal(r.out.irr.ok, false); assert.equal(r.out.irr.why, 'noIrr');
});

console.log('engine — missing inputs are UNAVAILABLE, never defaulted');
t('an empty calculator shows every result UNAVAILABLE and names each missing input', () => {
  for (const raw of [{}, undefined, null, Object.fromEntries(CALC_IN.map((f) => [f.id, '']))]) {
    const r = calcEngine(raw);
    for (const [k, need] of Object.entries(CALC_NEED)) {
      assert.equal(r.out[k].ok, false, k + ' computed from nothing');
      assert.ok(!('v' in r.out[k]), k + ' carries a value');
      assert.deepEqual([...r.out[k].missing].sort(), [...need].sort(), k + ' missing list');
    }
  }
});
t('removing any single input a result needs makes exactly that result UNAVAILABLE', () => {
  for (const [k, need] of Object.entries(CALC_NEED)) {
    for (const id of need) {
      const r = calcEngine({ ...FULL, [id]: '' });
      assert.equal(r.out[k].ok, false, `${k} computed without ${id}`);
      assert.deepEqual(r.out[k].missing, [id], `${k} without ${id}`);
    }
    // and an input it does not need never blocks it
    for (const f of CALC_IN.filter((x) => !need.includes(x.id))) {
      assert.ok(calcEngine({ ...FULL, [f.id]: '' }).out[k].ok, `${k} blocked by unrelated ${f.id}`);
    }
  }
});
t('no silent appreciation: the exit needs an explicit appreciation input (0% included)', () => {
  const noApp = calcEngine({ ...FULL, app: '' });
  for (const k of ['exitV', 'exitEq', 'profit', 'irr']) {
    assert.equal(noApp.out[k].ok, false, k + ' computed with no appreciation entered');
    assert.ok(noApp.out[k].missing.includes('app'));
  }
  const zero = calcEngine({ ...FULL, app: '0' });
  assert.equal(zero.out.exitV.v, 2000000, '0% entered → the exit value is the price, exactly');
});
t('no silent rent growth: multi-year cash flow needs an explicit rent-growth input', () => {
  const r = calcEngine({ ...FULL, rentG: '' });
  for (const k of ['cumCf', 'profit', 'irr']) assert.equal(r.out[k].ok, false, k);
  assert.ok(r.out.noi.ok && r.out.cf.ok, 'year-1 results do not need rent growth');
});
t('invalid values are reported as invalid — not dropped silently, not replaced', () => {
  const cases = { term: '0', hold: '2.5', vac: '120', price: '-5', rate: 'abc', tax: '25', app: '-80' };
  for (const [id, bad] of Object.entries(cases)) {
    const r = calcEngine({ ...FULL, [id]: bad });
    assert.deepEqual(r.invalid, [id], id + ' not flagged');
    for (const [k, need] of Object.entries(CALC_NEED)) {
      if (!need.includes(id)) continue;
      assert.equal(r.out[k].ok, false, `${k} computed from invalid ${id}`);
      assert.deepEqual(r.out[k].invalid, [id]);
    }
  }
});
t('the reported IRR is calcIrr of the yearly flows the engine exposes', () => {
  const r = calcEngine(FULL), ref = reference(FULL);
  assert.equal(r.flows.length, 11, 'year 0 + 10 holding years');
  near(r.flows[0], -800000, 1e-6, 'year-0 flow = equity invested');
  near(r.flows.reduce((a, c) => a + c, 0), r.out.profit.v, 1e-6, 'flows add up to the profit');
  assert.equal(calcIrr(r.flows), r.out.irr.v);
  near(r.out.irr.v, ref.irr, 1e-6, 'irr');
  assert.equal(calcEngine({ ...FULL, app: '' }).flows, null, 'no flows without every IRR input');
  assert.equal(calcIrr([-100, -5, -5]), 'noIrr');
});
t('every computed result is a finite number across a fixed grid of scenarios', () => {
  for (const rate of ['0', '3.5', '9']) for (const term of ['1', '30']) for (const hold of ['1', '5', '40'])
    for (const equity of ['0', '600000', '3000000']) for (const app of ['-10', '0', '7']) {
      const r = calcEngine({ ...FULL, rate, term, hold, equity, app });
      for (const [k, o] of Object.entries(r.out)) if (o.ok) assert.ok(Number.isFinite(o.v), `${k} = ${o.v}`);
    }
});

console.log('page — visible, wired, independent');
t('the calculator section and its rail link are visible in the markup', () => {
  assert.match(INDEX, /<section class="blk" id="calc">/);
  assert.ok(!/<section class="blk" id="calc"[^>]*\bhidden\b/.test(INDEX), 'calculator section hidden');
  assert.match(INDEX, /<a href="#calc" class="ri" data-sec="calc" id="railCalc">/);
});
t('it renders and initialises on every load — not behind CI_ENABLED or CI_EXTERNAL', () => {
  // first, unconditionally, before the capital model (whose render is guarded so an error there can never blank it)
  assert.match(INDEX, /renderConfidence\(\);renderCalc\(\);renderTx\(\);txFetch\(false\);\n\s*if\(CI_ENABLED\)\{try\{renderCapital\(\)\}catch\(e\)\{/);
  assert.match(INDEX, /\ninitCalc\(\);\nif\(CI_ENABLED\)\{initCapital\(\)/);
  assert.match(INDEX, /const CI_ENABLED=(true|false);/);
});
t('it starts empty: no default value in any field', () => {
  assert.match(UI, /const calcState=\{v:\{\},src:\{\}\};/);
  assert.match(UI, /value="\$\{calcEsc\(calcState\.v\[id\]\?\?""\)\}"/);
  assert.ok(!/placeholder=/.test(UI), 'a placeholder could read as a default');
});
t('a board price is offered only when DERIVED, and is labelled when used', () => {
  assert.match(UI, /vcOf\(l,"price"\)==="der"\?metricsOf\(l\.id\)\.price:null/);
  assert.match(UI, /calcState\.src\.price=\{loc:/);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
