// PROPX · new-home tools (#nhTools in #calc) — offline tests.
// `node test/newhome.test.js`
//
// Six calculators for buying from a developer. Same rules as the deal calculator: every input is the user's own
// (or the cited, dated STATIC purchase-tax table, which the user can override); an empty or invalid input leaves every
// result that needs it UNAVAILABLE — never a default; no index path, rate, price or margin is assumed; projections
// are labelled MODEL.

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
const ENGINE = block('/* @newhome-engine:start', '/* @newhome-engine:end */');
const UI = block('/* @newhome-ui:start */', '/* @newhome-ui:end */');
const E = vm.runInNewContext(ENGINE + '\n;({nhRun,nhPurchaseTax,nhSolveRate,NH_TAX,NH_IN,NH_NEED})', {});

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const ok = (r, k) => { assert.ok(r.out[k] && r.out[k].ok, `${k} unavailable: ${JSON.stringify(r.out[k])}`); return r.out[k].v; };

console.log('new-home tools: engine');
t('the engine runs with nothing but JavaScript built-ins', () => {
  assert.equal(typeof E.nhRun, 'function');
  assert.doesNotMatch(ENGINE, /document\.|window\.|state\.|LOC\[|MKT\.|metricsOf|vcOf|fetch\(/);
});
t('purchase-tax brackets are the Tax Authority\'s published table for 16.01.2025–15.01.2028, cited and dated', () => {
  assert.deepEqual(E.NH_TAX.single.map(([h, r]) => [h, r]), [[1978745, 0], [2347040, 3.5], [6055070, 5], [20183565, 8], [Infinity, 10]]);
  assert.deepEqual(E.NH_TAX.additional.map(([h, r]) => [h, r]), [[6055070, 8], [Infinity, 10]]);
  assert.equal(E.NH_TAX.from, '2025-01-16'); assert.equal(E.NH_TAX.to, '2028-01-15'); assert.match(E.NH_TAX.source, /^https:\/\/www\.gov\.il\//);
  near(E.nhPurchaseTax(3000000, 'single').tax, (2347040 - 1978745) * 0.035 + (3000000 - 2347040) * 0.05, 1e-6, 'single 3M');
  assert.equal(E.nhPurchaseTax(3000000, 'additional').tax, 240000);
  assert.equal(E.nhPurchaseTax(1978745, 'single').tax, 0);
  near(E.nhPurchaseTax(25000000, 'single').tax, 368295 * 0.035 + 3708030 * 0.05 + 14128495 * 0.08 + 4816435 * 0.1, 1e-6, 'single 25M (every bracket)');
  near(E.nhPurchaseTax(7000000, 'additional').tax, 6055070 * 0.08 + 944930 * 0.1, 1e-6, 'additional above the threshold');
  assert.equal(E.nhPurchaseTax(1000000, 'nobody'), null);
});
t('an empty tool shows every result UNAVAILABLE and names each missing input — no defaults', () => {
  for (const tool of Object.keys(E.NH_IN)) {
    const r = E.nhRun(tool, {});
    for (const [k, need] of Object.entries(E.NH_NEED[tool])) {
      assert.equal(r.out[k].ok, false, `${tool}.${k}`);
      for (const i of need) assert.ok(r.out[k].missing.includes(i), `${tool}.${k} names ${i}`);
    }
  }
});
t('total cost = price + tax + legal + upgrades + closing + financing fees + indexation; manual tax needs its value', () => {
  const raw = { price: '3,000,000', buyer: 'single', legal: '0.5', upgrades: '50000', closing: '10000', mortFees: '5000', indexation: '60000', area: '100' };
  const r = E.nhRun('cost', raw), tax = E.nhPurchaseTax(3000000, 'single').tax;
  near(ok(r, 'total'), 3000000 + tax + 15000 + 50000 + 10000 + 5000 + 60000, 1e-6, 'total');
  near(ok(r, 'overPrice'), (ok(r, 'total') / 3000000 - 1) * 100, 1e-9, 'above price');
  near(ok(r, 'totalPerSqm'), ok(r, 'total') / 100, 1e-9, 'per m²'); assert.equal(r.taxBasis, 'static');
  assert.ok(r.rows.slices.length === 3 && r.rows.slices.every((s) => s.amount >= 0));
  const m = E.nhRun('cost', { ...raw, buyer: 'manual' });
  assert.equal(m.out.tax.ok, false); assert.deepEqual(m.out.tax.missing, ['taxManual']); assert.equal(m.out.total.ok, false);
  const m2 = E.nhRun('cost', { ...raw, buyer: 'manual', taxManual: '12345' });
  assert.equal(ok(m2, 'tax'), 12345); assert.equal(m2.taxBasis, 'user');
  const z = E.nhRun('cost', { ...raw, upgrades: '0' }); assert.ok(z.out.total.ok, 'an explicit 0 is a value, not missing');
  const bad = E.nhRun('cost', { ...raw, legal: '50' }); assert.deepEqual(bad.out.total.invalid, ['legal']); assert.ok(bad.invalid.includes('legal'));
});
t('deferred payment: present value, effective discount and the implied rate against the cash price', () => {
  const base = { offer: '3000000', cash: '2850000', up: '20', mid: '0', midM: '0', endM: '30', linked: '0', idx: '0' };
  const zero = E.nhRun('deferred', { ...base, disc: '0' });
  near(ok(zero, 'pv'), 3000000, 1e-6, 'no discounting'); near(ok(zero, 'effDisc'), 0, 1e-9, 'no discount');
  const r = E.nhRun('deferred', { ...base, disc: '5' });
  near(ok(r, 'pv'), 600000 + 2400000 / Math.pow(1.05, 2.5), 1e-6, 'pv');
  near(ok(r, 'implied'), (Math.pow(2400000 / 2250000, 1 / 2.5) - 1) * 100, 1e-6, 'implied rate (closed form)');
  near(ok(r, 'vsCash'), 2850000 - ok(r, 'pv'), 1e-6, 'vs cash');
  const idx = E.nhRun('deferred', { ...base, disc: '5', linked: '50', idx: '4' });
  near(ok(idx, 'indexAdds'), 2400000 * 0.5 * (Math.pow(1.04, 2.5) - 1), 1e-6, 'half the deferred payment linked');
  assert.equal(E.nhRun('deferred', { ...base, disc: '5', up: '60', mid: '50', midM: '10' }).out.pv.why, 'sched');
  assert.equal(E.nhRun('deferred', { ...base, disc: '5', mid: '10', midM: '40' }).out.pv.why, 'order');
  assert.equal(E.nhRun('deferred', { ...base, cash: '1' }).out.implied.why, 'noRate');
  assert.equal(E.nhRun('deferred', { ...base }).out.pv.ok, false, 'no discount rate: no present value');
  assert.ok(E.nhRun('deferred', { ...base }).out.implied.ok, 'the implied rate needs no discount rate');
});
t('indexation: only the linked share of each payment, compounded to its month; payments must add to 100%', () => {
  const raw = { price: '3000000', linked: '50', p1: '20', m1: '0', p2: '30', m2: '12', p3: '50', m3: '30', idx: '4' };
  const r = E.nhRun('index', raw);
  near(ok(r, 'total'), 900000 * 0.5 * 0.04 + 1500000 * 0.5 * (Math.pow(1.04, 2.5) - 1), 1e-6, 'indexation');
  near(ok(r, 'finalPrice'), 3000000 + ok(r, 'total'), 1e-9, 'final'); assert.equal(r.rows.pays.length, 3);
  assert.equal(ok(E.nhRun('index', { ...raw, linked: '0' }), 'total'), 0);
  assert.equal(E.nhRun('index', { ...raw, p3: '40' }).out.total.why, 'sum100');
});
t('bulk discount and the land → end-value bridge (a model: the residual at the target margin returns that margin)', () => {
  const b = E.nhRun('bulk', { list: '2000000', units: '5', disc: '8', market: '1900000' });
  assert.equal(ok(b, 'listTotal'), 10000000); near(ok(b, 'saving'), 800000, 1e-6, 'saving'); near(ok(b, 'vsMarket'), (1840000 / 1900000 - 1) * 100, 1e-9, 'vs market');
  const raw = { land: '600000', dev: '150000', sqm: '120', build: '7000', soft: '12', fin: '6', sale: '3200000', vat: '18', target: '15' };
  const r = E.nhRun('bridge', raw);
  near(ok(r, 'cost'), (600000 + 150000 + 840000 * 1.12) * 1.06, 1e-6, 'cost'); near(ok(r, 'net'), 3200000 / 1.18, 1e-6, 'net of VAT');
  const back = E.nhRun('bridge', { ...raw, land: String(ok(r, 'residual')) });
  near(ok(back, 'marginPct'), 15, 1e-9, 'the residual land value earns exactly the target margin');
  near(ok(r, 'breakeven') / 1.18, ok(r, 'cost'), 1e-6, 'break-even net = cost');
});
t('new vs second-hand: the same tax table on both sides, waiting priced at the rent entered, the difference explicit', () => {
  const raw = { buyer: 'single', rent: '6000', nPrice: '3000000', nArea: '100', nDelay: '30', nIndex: '60000', nUpgrade: '40000', sPrice: '2800000', sArea: '100', sDelay: '4', sRenov: '250000' };
  const r = E.nhRun('compare', raw);
  near(ok(r, 'nTax'), E.nhPurchaseTax(3000000, 'single').tax, 1e-9, 'new tax'); near(ok(r, 'sTax'), E.nhPurchaseTax(2800000, 'single').tax, 1e-9, 'second-hand tax');
  assert.equal(ok(r, 'nWait'), 180000); near(ok(r, 'diff'), ok(r, 'nEff') - ok(r, 'sEff'), 1e-9, 'difference');
  assert.equal(E.nhRun('compare', { ...raw, rent: '' }).out.diff.ok, false, 'no rent entered: no waiting cost, no difference');
});
t('every computed result is a finite number over a grid of inputs', () => {
  for (const p of [500000, 2000000, 9000000]) for (const d of [0, 3, 12]) {
    const r = E.nhRun('deferred', { offer: String(p), cash: String(p * 0.95), up: '10', mid: '20', midM: '12', endM: '36', disc: String(d), linked: '50', idx: String(d) });
    for (const [k, o] of Object.entries(r.out)) if (o.ok) assert.ok(Number.isFinite(o.v), k);
  }
});

console.log('new-home tools: page');
t('the tools sit in the calculator section, render and initialise on every load, and start empty', () => {
  assert.match(INDEX, /<section class="blk" id="calc">[\s\S]*?<div class="card nh-card" id="nhTools"><\/div>\s*<\/section>/);
  assert.match(INDEX, /\ninitNewHome\(\);\n/); assert.match(INDEX, /renderIntel\(\);renderTrust\(\);renderNewHome\(\);/);
  assert.match(UI, /const nhState=\{tool:"cost",v:\{cost:\{\},deferred:\{\},index:\{\},bulk:\{\},bridge:\{\},compare:\{\}\},sent:false\};/);
});
t('labels: the tax table is STATIC with its source, the bridge is MODEL, the Bank of Israel rate is a reference only', () => {
  assert.match(UI, /r\.taxBasis==="static"\?vcTag\("static"\)/); assert.match(UI, /NH_TAX\.source/);
  assert.match(UI, /const NH_MODEL=new Set\(\["bridge"\]\)/);
  assert.match(UI, /MKT\.boi\?` \$\{vcTag\("raw"\)\} \$\{n\.boiRef/);
  assert.doesNotMatch(UI, /nhState\.v\.deferred\.disc\s*=|v\.disc=|MKT\.boi\.value/, 'the BoI rate is never written into an input');
});
t('no capital model, score, ranking or curve in the tools', () => {
  assert.doesNotMatch(ENGINE + UI, /CI_|ciPortfolio|NATIONAL_CURVE|rankable|score/i);
});
t('the deal-calculator handoff sends the user\'s own price and side costs, as user values', () => {
  assert.match(UI, /calcState\.v\.price=String\(p\);calcState\.v\.tax=pct\(r\.out\.tax\.v\);/);
  assert.match(UI, /delete calcState\.src\.price;delete calcState\.src\.tax;delete calcState\.src\.fees;/);
});

console.log(`\nnew-home tools: ${passed} passed`);
