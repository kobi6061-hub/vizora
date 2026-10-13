// PROPX · sales-metric truth gates (audit 13.10.2026) — offline.
// `node test/sales-metrics.test.js`
//
// Every sales figure on the board says what it is: an OBSERVED count (exact count, date range, source), a
// DERIVED figure (source population + formula + period) or a MODEL rate (never shown as a plain count). The
// board's annual new-home sales figure is shown only where its basis is written down (TX_BASIS); everywhere
// else, and under any filter, it is "—". Observed deals call a row "new" only as far as the source supports,
// and mark small samples. These gates run the page's own code (index.html) — not a copy of it.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
/* a brace-matched block starting at `anchor` */
const block = (anchor) => {
  const i = INDEX.indexOf(anchor);
  assert.ok(i >= 0, 'missing ' + anchor);
  const open = INDEX.indexOf(anchor.endsWith('[') ? '[' : '{', i + anchor.length - 1);
  const close = { '{': '}', '[': ']' }[INDEX[open]];
  let d = 0;
  for (let k = open; k < INDEX.length; k++) {
    if (INDEX[k] === INDEX[open]) d++;
    else if (INDEX[k] === close && --d === 0) return INDEX.slice(i, k + 1);
  }
  throw new Error('unbalanced ' + anchor);
};
const line = (re) => { const m = re.exec(INDEX); assert.ok(m, 'missing ' + re); return m[0]; };
const fnBody = (name) => block('function ' + name + '(');

/* the page's data + the display gate, run as the page runs them */
const SRC = [
  block('const LOCATIONS = [') + ';',
  'const LOC = Object.fromEntries(LOCATIONS.map(l=>[l.id,l]));',
  block('const STATIC_SRC={') + ';',
  line(/const isStatic=\(l,f\)=>\{[^\n]*\n/),
  line(/const M_ROOMS=\{[^\n]*\n/), line(/const M_TYPE=\{[^\n]*\n/), line(/const M_AREA=\{[^\n]*\n/), line(/const M_COND=\{[^\n]*\n/),
  line(/function filtersActive\(\)\{[^\n]*\n/),
  'const nf=new Intl.NumberFormat("he-IL");const fmtInt=n=>nf.format(Math.round(n));',
  block('const TX_BASIS={') + ';',
  line(/const ltr=x=>[^\n]*\n/), line(/const txShownVal=[^\n]*\n/), fnBody('txShown'), fnBody('txEvidence'), fnBody('metricsOf'),
  line(/const STALE_DAYS=[^\n]*\n/), line(/const staleSince=[^\n]*\n/), line(/const BLT4_ASOF=[^\n]*\n/),
  line(/const TX_SMALL_N=[^\n]*\n/),
  ';({LOCATIONS,LOC,STATIC_SRC,TX_BASIS,txShown,txEvidence,metricsOf,staleSince,BLT4_ASOF,TX_SMALL_N,STALE_DAYS})',
].join('\n');
const ctx = { state: { lang: 'he', filters: { rooms: 'all', type: 'all', area: 'all', cond: 'all' } }, Date, Intl };
const P = vm.runInNewContext(SRC, ctx);
const setF = (f) => Object.assign(ctx.state.filters, { rooms: 'all', type: 'all', area: 'all', cond: 'all' }, f || {});
const plain = (x) => String(x).replace(/[\u2066-\u2069]/g, '');   // the left-to-right isolates are display-only
const he = (fn) => { ctx.state.lang = 'he'; return fn(); };
const en = (fn) => { ctx.state.lang = 'en'; try { return fn(); } finally { ctx.state.lang = 'he'; } };

console.log('sales metrics — the board figure');
t('the page compiles (every inline script)', () => {
  for (const m of INDEX.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});
t('a sales figure is shown only where its basis is written down (TX_BASIS); every other place shows —', () => {
  setF();
  const shown = P.LOCATIONS.filter((l) => P.txShown(l).show).map((l) => l.id).sort();
  assert.deepEqual(shown, Object.keys(P.TX_BASIS).sort());
  assert.deepEqual(shown, ['il', 'tlv'], 'national (2025 total) and Tel Aviv (annualised CBS half-year) only');
  for (const l of P.LOCATIONS) {
    const x = P.txShown(l);
    if (!x.show) { assert.equal(x.cls, 'na'); assert.ok(x.why && x.why.length > 10, l.id + ' must say why it is missing'); }
  }
});
t('every shown sales figure carries a period, a source and a value class', () => {
  setF();
  for (const id of Object.keys(P.TX_BASIS)) {
    for (const run of [he, en]) {
      const x = run(() => P.txShown(P.LOC[id]));
      assert.ok(x.per && /20\d\d/.test(x.per), id + ' period must name its year: ' + x.per);
      assert.ok(x.src && x.src.length > 10, id + ' source');
      assert.ok(['static', 'der', 'mod'].includes(x.cls), id + ' class ' + x.cls);
    }
  }
});
t('a MODEL rate never renders as a plain count: "~N לשנה" with the formula in its period', () => {
  setF();
  for (const l of P.LOCATIONS) {
    const x = P.txShown(l);
    if (!x.show) continue;
    assert.match(plain(x.text), /^~[\d,]+/, l.id + ' must read as an approximation: ' + x.text);
    if (x.cls === 'mod') {
      assert.match(plain(x.text), /לשנה$/, l.id + ' a model rate is per year: ' + x.text);
      assert.match(plain(x.per), /^אומדן: [\d,]+ × 12 ÷ \d+ · .*20\d\d$/, l.id + ' the annualisation is stated: ' + x.per);
      assert.match(plain(en(() => P.txShown(l)).text), /a year$/);
    }
  }
});
t('the annualisation is correct: stored pace = count × 12 ÷ months (to the nearest hundred)', () => {
  for (const [id, B] of Object.entries(P.TX_BASIS)) {
    const annual = B.n * 12 / B.months;
    assert.equal(Math.round(annual / 100) * 100, P.LOC[id].base.tx, `${id}: ${B.n} × 12 ÷ ${B.months} = ${annual} vs stored ${P.LOC[id].base.tx}`);
    if (B.months < 12) assert.equal(B.cls, 'mod', id + ' an annualised part-year is an estimate (MODEL)');
    else assert.ok(['static', 'der'].includes(B.cls), id + ' a full-year count is not a model');
  }
  assert.match(plain(P.txEvidence(P.LOC.tlv).der), /^2,056 × 12 ÷ 6 = 4,112 → 4,100$/);
});
t('OBSERVED / STATIC values come from the cited record — the national figure equals its citation', () => {
  assert.equal(P.TX_BASIS.il.n, P.STATIC_SRC.v.il.tx);
  assert.equal(P.LOC.il.base.tx, P.STATIC_SRC.v.il.tx);
  assert.equal(P.TX_BASIS.il.cls, 'static');
  assert.match(P.STATIC_SRC.cite.tx.per.he, /2025/);
});
t('no place receives another geography\'s count; no national value is presented as city-level', () => {
  setF();
  for (const [id, B] of Object.entries(P.TX_BASIS)) {
    const l = P.LOC[id];
    if (l.type === 'country') assert.equal(B.geo.he, 'ארצי');
    else assert.equal(B.geo.he, l.he, id + ' basis geography must be the place itself');
  }
  for (const l of P.LOCATIONS.filter((x) => x.type !== 'country')) {
    const x = P.txShown(l);
    if (x.show) assert.notEqual(x.v, P.LOC.il.base.tx, l.id + ' shows the national figure');
    if (x.show) assert.ok(P.TX_BASIS[l.id], l.id + ' shows a figure without its own basis');
  }
  /* the geo panel reads the anchor's own gate and names its level */
  const g = fnBody('renderGeoView');
  assert.match(g, /const tx=txShown\(a\)/);
  assert.ok(!/fmtInt\(m\.tx\)/.test(g), 'the geo panel must not print the raw pace');
  assert.match(g, /ms\?t\.msFormula\(tx\.B\.per\[he\?"he":"en"\]\):tx\.why/, 'months of supply names the sales period it divides by');
  assert.match(INDEX, /msFormula:p=>`מודל: מלאי סוף יוני 2026 ÷ קצב המכירות החודשי \(לפי \$\{p\}\)`/);
});
t('a filter never splits sales: no figure, no floor of 3, metricsOf().tx is null', () => {
  const R = Object.keys(vm.runInNewContext('(' + line(/const M_ROOMS=(\{[^\n]*\});/).replace(/^const M_ROOMS=/, '').replace(/;\s*$/, '') + ')'));
  let n = 0;
  for (const l of P.LOCATIONS) for (const f of [{ rooms: '6' }, { type: 'ph' }, { cond: 'ready' }, { area: '60' }, { rooms: R[2], type: 'garden' }]) {
    setF(f);
    const x = P.txShown(l);
    assert.equal(x.show, false, `${l.id} ${JSON.stringify(f)}`); assert.ok(x.filtered);
    assert.equal(P.metricsOf(l.id).tx, null);
    n++;
  }
  setF();
  assert.ok(n >= 500);
  assert.ok(!/Math\.max\(3,/.test(INDEX), 'the floor of 3 is gone');
  assert.equal(P.metricsOf('ofakim').tx, P.LOC.ofakim.base.tx, 'unfiltered, metricsOf keeps the model input for the capital model');
});
t('missing renders — on every board surface, and each surface goes through the gate', () => {
  setF();
  const kpi = fnBody('renderKPIs');
  assert.match(kpi, /\(x=>x\.show\?\{k:"tx"[^]*?:\{k:"tx",l:t\.tx,na:x\.why\}\)\(txShown\(l\)\)/);
  assert.match(kpi, /c\.na\?`<span class="na-v">\$\{t\.naShort\}<\/span>`/);
  assert.match(INDEX, /naShort:"—"/);
  assert.match(fnBody('renderProfile'), /\$\{x\.show\?x\.text:"—"\}[^]*\(txShown\(l\)\)/);
  assert.match(fnBody('renderTable'), /\(x=>x\.show\?x\.text:"—"\)\(txShown\(r\.loc\)\)/);
  assert.match(INDEX, /\{f:"tx",label:\(\)=>T\(\)\.thTx,get:\(m,id\)=>\{const x=txShown\(LOC\[id\]\);return x\.show\?x\.v:null\}/);
  assert.match(fnBody('renderMap'), /\$\{x\.show\?x\.text:"—"\}[^]*\(txShown\(ll\)\)/);
  assert.match(fnBody('renderConfidence'), /f==="tx"\?txShown\(l\)\.cls:vcOf\(l,f\)/);
  assert.match(fnBody('renderProfile'), /r\.f==="tx"\?\(x=>[^]*\(txShown\(l\)\)/);
  for (const bad of [/fmtInt\(m\.tx\)/, /fmtInt\(lm\.tx\)/, /fmtInt\(state\.mode==="sale"\?r\.m\.tx/]) assert.ok(!bad.test(INDEX), 'raw pace printed: ' + bad);
});
t('the evidence view (RAW · DERIVED · DISPLAY) states what the figure rests on', () => {
  setF();
  const o = P.txEvidence(P.LOC.ofakim);
  assert.match(o.raw, /0 תצפיות/); assert.equal(o.der, '—'); assert.match(o.disp, /^— \(/);
  assert.match(o.model, /קלט מודל ההון בלבד: 800 לשנה — מחקר ידני 30\.08\.2026/);
  const n = P.txEvidence(P.LOC.il);
  assert.match(n.raw, /^34,000 מכירות דירות חדשות מקבלן · שנת 2025 · רשות המסים \/ הכלכלן הראשי/);
  assert.equal(n.model, '');
  setF({ type: 'garden' });
  assert.match(P.txEvidence(P.LOC.florentin).disp, /אין מקור שמפצל מכירות/);
  setF();
});

console.log('sales metrics — labels, periods, staleness');
t('the board never labels a figure "מכירות מקבלן N" without its basis — label names the population', () => {
  assert.match(INDEX, /tx:"מכירות דירות חדשות", y3:/);
  assert.match(INDEX, /tx:"New-home sales", y3:/);
  assert.ok(!/perTxEst|perTxH1|TX_H1_2026/.test(INDEX), 'the old undated "estimated annual pace" label is gone');
});
t('a stale static statement is marked stale and loses its trend arrow', () => {
  const asOf = P.BLT4_ASOF;
  assert.equal(asOf, '2026-05-31'); assert.equal(P.STALE_DAYS, 90);
  const at = (iso) => vm.runInNewContext(line(/const STALE_DAYS=[^\n]*\n/) + line(/const staleSince=[^\n]*\n/) + `;staleSince("${asOf}")`, { Date: { now: () => Date.parse(iso), parse: Date.parse } });
  assert.equal(at('2026-06-20'), false); assert.equal(at('2026-10-13'), true);
  assert.match(INDEX, /blt4vStale:"התאוששות", blt4sStale:"ישן — לא עודכן מאז מאי 2026 · /);
  assert.match(INDEX, /blt4vStale:"Recovery", blt4sStale:"Stale — not updated since May 2026 · /);
  assert.match(INDEX, /const stale4=staleSince\(BLT4_ASOF\);[^]*?const key=stale4&&\(node\.dataset\.i==="blt4v"\|\|node\.dataset\.i==="blt4s"\)\?node\.dataset\.i\+"Stale":node\.dataset\.i;/);
});
t('the sources panel no longer calls the deals register "developer sales"', () => {
  assert.ok(!/srcB1b:"מכירות קבלנים שנחתמו/.test(INDEX));
  assert.match(INDEX, /srcB1b:"עסקאות שנחתמו ודווחו למאגר רשות המסים — כל השוק \(חדשות ויד שנייה\); המאגר אינו מסמן מכירה מקבלן"/);
  assert.match(INDEX, /בשאר המחוזות, הערים והשכונות אין ב-PROPX מקור מכירות — מוצג —/);
});

console.log('sales metrics — observed deals');
t('new-home classification is source-supported: the register has no developer flag → "new" only by build year', () => {
  const { OverDealsProvider } = require('../lib/gov/providers/overDeals.js');
  const p = new OverDealsProvider({ fetch: async () => { throw new Error('offline'); } });
  const r = p.normalizeDeal({ date: '2026-03-01', amount: 2500000, nature: 'דירה בבית קומות', year_built: 2026, settlement: 'אופקים', area_sqm: 100, rooms: 4 }, {});
  assert.equal(r.sourceClassification, null);
  assert.equal(r.newness, 'probable_new', 'never confirmed without a source flag');
  const tx = fnBody('renderTx');
  assert.match(tx, /tabBtn\("new",nNew&&nConf===nNew\?t\.txTabNew:t\.txTabNewProb,nNew\)/);
  assert.match(INDEX, /txTabNewProb:"חדשות \(לפי שנת בנייה\)"/);
  assert.match(INDEX, /מתוכן \$\{nNew\} חדשות לפי שנת בנייה \(המאגר אינו מסמן מכירה מקבלן\)/);
});
t('every observed count has a period and the date range of the rows shown', () => {
  const tx = fnBody('renderTx');
  assert.match(tx, /\[t\.txSumNObs\(perLbl\),fmtInt\(statRows\.length\)/);
  assert.match(tx, /\[t\.txSumRange,first\?/);
  assert.match(INDEX, /txSumNObs:p=>`עסקאות שנצפו · \$\{p\}`/);
  assert.match(INDEX, /txSumNObs:p=>`Observed deals · \$\{p\}`/);
});
t('small samples: below 10 observed deals the count is marked and medians are de-emphasised', () => {
  assert.equal(P.TX_SMALL_N, 10);
  /* the documented reason, checked: a distribution-free 95% interval for a median (order statistics, Binomial(n,½))
     does not exist below n = 6, spans the whole sample at n = 6–8 and runs 2nd..2nd-last at n = 9–11 */
  const C = (n, k) => { let c = 1; for (let i = 1; i <= k; i++) c = c * (n - k + i) / i; return c; };
  const cdf = (n, k) => { let s = 0; for (let i = 0; i <= k; i++) s += C(n, i); return s / 2 ** n; };
  const lowRank = (n) => { let best = null; for (let r = 1; r <= n / 2; r++) if (1 - 2 * cdf(n, r - 1) >= 0.95) best = r; return best; };
  for (let n = 1; n <= 5; n++) assert.equal(lowRank(n), null, 'no 95% interval at n=' + n);
  for (const n of [6, 7, 8]) assert.equal(lowRank(n), 1, 'whole sample at n=' + n);
  for (const n of [9, 10, 11]) assert.equal(lowRank(n), 2, '2nd..2nd-last at n=' + n);
  const tx = fnBody('renderTx');
  assert.match(tx, /const small=prices\.length<TX_SMALL_N/);
  assert.match(tx, /small\?` <span class="tx-chip">\$\{t\.txSmallTag\}<\/span>`:""/);
  assert.match(tx, /else if\(small&&prices\.length\)el\("txWarn"\)\.textContent=t\.txSmall\(prices\.length\)/);
});
t('ALTARIS: an observed deal count in the risk score carries its period', () => {
  const E = require('../altaris/engine.js');
  const deal = { info: { startDate: '2026-11-01', constructionStatus: 'construction' }, value: { chosen: 'manual', manual: { value: 1e7 } }, buy: { price: 8e6 } };
  const R = E.run(deal, {}, { today: '2026-10-13', marketDepth: { deals: 40, from: '2025-10-01', to: '2026-09-15' } });
  const liq = R.strategies.buy.risk.components.find((c) => c.k === 'liquidity');
  assert.match(liq.why, /40 עסקאות מגורים בדגימת PROPX \(01\.10\.2025–15\.09\.2026\): 0/);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
