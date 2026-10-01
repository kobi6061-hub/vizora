// PROPX · P0 data-integrity gates — offline, static.
// `node test/integrity.test.js`
//
// The dashboard may show only what a source supports: RAW (as published),
// DERIVED (a stated formula over published figures), MODELLED (badged as an
// estimate) or UNAVAILABLE (nothing shown). These gates fail the build if a
// removed fabrication path comes back into index.html or its standalone build:
// generated street transactions, generated price history, invented medians,
// sample-size "confidence" claims, undated "last 12 months" labels, hardcoded
// coverage — or a score that reads the approximate appreciation curve.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['index.html', 'standalone/israel-new-homes-v2.html']
  .map((f) => ({ f, src: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
const INDEX = FILES[0].src;

let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
};
const absent = (src, needles, where) => {
  for (const n of needles) {
    const hit = n instanceof RegExp ? n.test(src) : src.includes(n);
    assert.ok(!hit, `${where}: found ${n}`);
  }
};
/* body of a top-level `function name(...){...}` (brace-matched) */
const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  let j = src.indexOf('{', i), depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(j, k + 1);
  }
  throw new Error('unbalanced ' + name);
};

for (const { f, src } of FILES) {
  console.log(f);
  t('no synthetic street layer (engine, section, search entries)', () => absent(src, [
    'STREET_DB', 'stTxAll', 'stProfile(', 'stSearch(', 'selectStreet(', 'renderStreet(', 'initStreet(',
    'stTopStreets(', 'id="street"', 'data-gost', 'stTxShort'], f));
  t('no generated price/rent history on any display path', () => absent(src, [
    'seriesFor(', 'seriesSlice(', 'sparkSVG(', 'renderChart(', 'renderChartTools(', 'CHART_METRICS',
    'id="chartSvg"', 'kpi-spark', 'ap-spark'], f));
  t('no pseudo-random generator anywhere in the page', () => absent(src, [
    /function\s+rng\s*\(/, /function\s+seedOf\s*\(/, /Math\.random\s*\(/], f));
  t('no invented medians or sample-size confidence', () => absent(src, [
    /median:Math\.round\(price/, /rentMedian:Math\.round/, /confidence:tx>=/, 'confBasedOn', 'm.confidence', '.confidence]'], f));
  t('no undated or mislabelled periods', () => absent(src, [
    'לעומת התקופה הקודמת', '12 החודשים האחרונים', 'vs. previous period', 'trailing 12 months',
    'over the last 12 months', 's:"12M"', '· 12M', 'עודכן מול המקורות', 'מדדים רשמיים עודכנו'], f));
  t('no hardcoded coverage percentage', () => absent(src, ['covScore', /geoCovT/], f));
}

console.log('index.html — structure');
t('KPI medians render as UNAVAILABLE, never as a number', () => {
  const body = fnBody(INDEX, 'renderKPIs');
  assert.match(body, /\{k:"median",l:t\.medPrice,na:t\.naMedianWhy\}/);
  assert.match(body, /\{k:"rentMedian",l:t\.medRent,na:t\.naMedianWhy\}/);
  const ret = fnBody(INDEX, 'metricsOf');
  assert.ok(!/\bmedian\b|rentMedian|confidence/.test(ret), 'metricsOf still returns median/confidence');
});
t('every KPI/profile/table/geo/map value is classed from row metadata (vcOf)', () => {
  for (const fn of ['renderKPIs', 'renderProfile', 'renderTable', 'renderGeoView', 'renderSVR', 'renderConfidence']) {
    assert.ok(fnBody(INDEX, fn).includes('vcOf('), fn + ' does not class its values');
  }
  const vc = fnBody(INDEX, 'vcOf');
  assert.ok(/l\.e/.test(vc) && /includes\("t"\)/.test(vc) && /includes\("l"\)/.test(vc), 'vcOf must read the o/e flags');
});
t('data-basis card claims no sample size', () => {
  const body = fnBody(INDEX, 'renderConfidence');
  // it may name fields (labels) and their class/period, but never read a value
  assert.ok(!/metricsOf\(|fmtInt\(|fmtNIS\(|\.base\b/.test(body), 'renderConfidence reads a figure');
});
t('locality scope says it is a sample; coverage is always stated', () => {
  assert.match(INDEX, /txScopeLoc:\(d,n\)=>`מדגם מרכז היישוב:/);
  assert.match(INDEX, /txScopeLoc:\(d,n\)=>`Locality-centre sample:/);
  const body = fnBody(INDEX, 'renderTx');
  assert.ok(!/dealsCountReported>cov\.rowsRetrieved\s*\?/.test(body), 'coverage is conditional again');
  assert.ok(/const covTxt=cov\s*\?/.test(body), 'coverage line not built from the source coverage');
});
t('registry street suggestions are never filtered by a non-registry list', () => {
  const body = fnBody(INDEX, 'geoSug');
  assert.match(INDEX, /function geoSug\(q\)\{/);
  assert.ok(/g\.kind==="street"\|\|!coveredIdByName\(g\.he\)/.test(body), 'registry streets filtered');
  assert.ok(!/\bdup\b/.test(body), 'a de-duplication filter is back in geoSug');
  const open = fnBody(INDEX, 'openGeoView');
  assert.ok(!/\bst[A-Z]\w*\(/.test(open), 'openGeoView redirects to a street layer');
});

console.log('index.html — capital model gate');
t('capital model is switched off while it reads the approximate curve', () => {
  const m = /const CI_ENABLED=(true|false);/.exec(INDEX);
  assert.ok(m, 'CI_ENABLED switch missing');
  if (m[1] === 'true') {
    assert.ok(!INDEX.includes('NATIONAL_CURVE') && !INDEX.includes('localCurve('),
      'CI_ENABLED=true while the capital model still reads NATIONAL_CURVE/localCurve — replace it with official history first');
  }
  assert.ok(INDEX.indexOf('const CI_ENABLED=') < INDEX.indexOf('const MAP_METRICS='), 'CI_ENABLED must be declared before MAP_METRICS');
});
t('every entry into the capital model outside its own block is gated by CI_ENABLED', () => {
  const lines = INDEX.split('\n');
  const start = lines.findIndex((l) => l.includes('CAPITAL INTELLIGENCE — investment engine + UI'));
  const end = lines.findIndex((l) => l.includes('national geography (canonical registry)'));
  assert.ok(start > 0 && end > start, 'capital block markers moved');
  const entry = /\b(ciEval|ciRank|ciOppOf|ciApp|ciFactors|ciPortfolio|ciExit|ciReturnTarget|ciRefresh|renderCITeaser|renderCapital|initCapital)\(/;
  const bad = [];
  lines.forEach((l, i) => {
    if (i >= start && i <= end) return;
    if (/^\s*function\s/.test(l)) return;
    if (entry.test(l) && !l.includes('CI_ENABLED')) bad.push(`${i + 1}: ${l.trim().slice(0, 100)}`);
  });
  assert.deepEqual(bad, []);
  assert.ok(!/NATIONAL_CURVE|localCurve\(/.test(lines.slice(0, start).concat(lines.slice(end)).join('\n')
    .replace(/const NATIONAL_CURVE=[^\n]*\n|function localCurve\(l\)\{[\s\S]*?\n\}\n|\/\*[\s\S]*?\*\//g, '')),
  'NATIONAL_CURVE/localCurve read outside the dormant capital model');
});
t('capital surfaces are hidden in the markup', () => {
  assert.match(INDEX, /<section class="blk" id="capital" hidden>/);
  assert.match(INDEX, /<div id="ciTeaserBlk" hidden>/);
  assert.match(INDEX, /data-sec="capital" id="railCap" hidden>/);
  assert.match(INDEX, /\.cap-signal\[hidden\],\.ri\[hidden\],#capital\[hidden\],#ciTeaserBlk\[hidden\]\{display:none!important\}/);
});
t('standalone build matches index.html', () => {
  const sa = FILES[1].src;
  for (const marker of ['const CI_ENABLED=false;', 'function vcOf(', 'מדגם מרכז היישוב', '<meta name="propx-build"']) {
    assert.ok(sa.includes(marker), 'standalone missing ' + marker + ' — run scripts/build-standalone.py');
  }
  const b = (s) => (/<meta name="propx-build" content="([^"]+)"/.exec(s) || [])[1];
  assert.equal(b(sa), b(INDEX), 'standalone build stamp differs — rebuild it');
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
