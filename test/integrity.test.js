// PROPX · P0 data-integrity gates — offline, static.
// `node test/integrity.test.js`
//
// The dashboard may show only what a source supports: OFFICIAL (stored
// provenance), STATIC (hand-transcribed from a cited, dated publication),
// DERIVED (a stated formula over cited figures), MODELLED (badged as an
// estimate) or UNAVAILABLE (nothing shown). These gates fail the build if a
// removed fabrication path comes back into index.html or its standalone build:
// generated street transactions, generated price history, invented medians,
// sample-size "confidence", undated "last 12 months" labels, hardcoded
// coverage, a score that reads the approximate appreciation curve, an
// "official" class without stored provenance, a ranking over non-official
// values outside the capital section's labelled MODEL RANKING — or a
// credential embedded in the public standalone build.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const STANDALONE = fs.readdirSync(path.join(ROOT, 'standalone')).map((f) => 'standalone/' + f);
const FILES = ['index.html', ...STANDALONE]
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
/* the object/array literal opened by the last character of `anchor` ("{" or "["), brace-matched */
const literalAfter = (src, anchor) => {
  const i = src.indexOf(anchor);
  assert.ok(i >= 0, 'missing ' + anchor);
  const open = i + anchor.length - 1;
  const close = { '{': '}', '[': ']' }[src[open]];
  assert.ok(close, 'anchor must end with { or [: ' + anchor);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === src[open]) depth++;
    else if (src[k] === close && --depth === 0) return src.slice(open, k + 1);
  }
  throw new Error('unbalanced literal after ' + anchor);
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
  t('no client-side password gate or embedded credential', () => absent(src, [
    /\bvar\s+PASS\s*=/, 'id="gatePass"', 'id="gate"', /\bPASSWORD\s*=\s*["']/, /SITE_PASSWORD\s*=\s*["'][^"']+["']/,
    /SESSION_SECRET\s*=\s*["'][^"']+["']/], f));
}

console.log('index.html — structure');
t('KPI medians render as UNAVAILABLE, never as a number', () => {
  const body = fnBody(INDEX, 'renderKPIs');
  assert.match(body, /\{k:"median",l:t\.medPrice,na:t\.naMedianWhy\}/);
  assert.match(body, /\{k:"rentMedian",l:t\.medRent,na:t\.naMedianWhy\}/);
  const ret = fnBody(INDEX, 'metricsOf');
  assert.ok(!/\bmedian\b|rentMedian|confidence/.test(ret), 'metricsOf still returns median/confidence');
});
t('every KPI/profile/table/geo/map value is classed (vcOf)', () => {
  for (const fn of ['renderKPIs', 'renderProfile', 'renderTable', 'renderGeoView', 'renderSVR', 'renderConfidence']) {
    assert.ok(fnBody(INDEX, fn).includes('vcOf('), fn + ' does not class its values');
  }
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

console.log('index.html — official classification');
t('OFFICIAL only from the live snapshot (stored provenance), never from a flag', () => {
  const vc = fnBody(INDEX, 'vcOf');
  const raw = vc.split('\n').filter((l) => l.includes('"raw"'));
  assert.ok(raw.length >= 1, 'no RAW path at all');
  for (const l of raw) assert.ok(/MKT\.\w+/.test(l), 'RAW returned without the live snapshot: ' + l.trim());
  for (const fn of ['vcOf', 'vcPer']) {
    assert.ok(!/\bl\.o\b|\.o\|\||includes\("[tl]"\)/.test(fnBody(INDEX, fn)), fn + ' reads the historical o-flags');
  }
});
t('every STATIC label sits on the exact figure it cites', () => {
  const v = vm.runInNewContext('(' + literalAfter(INDEX, 'const STATIC_SRC={') + ')').v;   // data-only literal
  const a = INDEX.indexOf('const LOCATIONS = ['), b = INDEX.indexOf('];', a);
  const rows = {};
  for (const m of INDEX.slice(a, b).matchAll(/\{id:"([^"]+)"[\s\S]*?base:\{([^}]*)\}\}/g)) {
    rows[m[1]] = Object.fromEntries(m[2].split(',').map((kv) => kv.split(':')).map(([k, x]) => [k.trim(), Number(x)]));
  }
  let n = 0;
  for (const [id, fields] of Object.entries(v)) {
    assert.ok(rows[id], 'STATIC_SRC names an unknown place ' + id);
    for (const [f, cited] of Object.entries(fields)) {
      assert.strictEqual(rows[id][f], cited, `${id}.${f}: stored ${rows[id][f]} ≠ cited ${cited}`);
      n++;
    }
  }
  assert.ok(n >= 17, 'STATIC_SRC lost entries (' + n + ')');
  assert.ok(/const isStatic=\(l,f\)=>\{[^}]*l\.base\[f\]===s\[f\]/.test(INDEX), 'STATIC label no longer requires value equality');
});
t('the "official · observed" deals badge is never shown over fixture rows', () => {
  assert.match(fnBody(INDEX, 'renderTx'), /meta\.mode==="dev-fixture"\?t\.txModeFixture:t\.txOfficialBadge/);
});

console.log('index.html — rankings');
t('a ranking needs every ranked value to be OFFICIAL', () => {
  const r = fnBody(INDEX, 'rankable');
  assert.match(r, /locs\.length>1&&locs\.every\(l=>vcOf\(l,field\)==="raw"\)/);
});
t('every ranking surface goes through rankable()', () => {
  assert.match(fnBody(INDEX, 'renderRankings'), /const tabs=RANK_TABS\.filter\(x=>rankable\(x\.f,pool\)\)/);
  assert.match(fnBody(INDEX, 'renderMap'), /if\(rankable\(mm\.f,ctx\.items\)\)\{/);
  assert.match(fnBody(INDEX, 'renderTable'), /const canSort=c=>c\.key==="name"\|\|rankable\(c\.f,rows\)/);
  assert.match(fnBody(INDEX, 'renderTable'), /const sortable=canSort\(c\);/);
  assert.match(fnBody(INDEX, 'renderCompare'), /rankable\(cm\.f,items\.map\(it=>LOC\[it\.id\]\)\)\?Math\.max/);
  // rank numbers (01, 02 …) are painted only by the two gated renderers, or by
  // the dormant capital block (never rendered while CI_ENABLED=false)
  const lines = INDEX.split('\n');
  const ciA = lines.findIndex((l) => l.includes('CAPITAL INTELLIGENCE — investment engine + UI'));
  const ciB = lines.findIndex((l) => l.includes('national geography (canonical registry)'));
  const gated = fnBody(INDEX, 'renderMap') + fnBody(INDEX, 'renderRankings');
  const outside = lines.map((l, i) => [l, i]).filter(([l, i]) => /padStart\(2,"0"\)/.test(l)
    && !(i > ciA && i < ciB) && !gated.includes(l.trim())).map(([l, i]) => `${i + 1}: ${l.trim()}`);
  assert.deepEqual(outside, [], 'rank numbers painted outside the gated renderers');
});
t('every ranked metric names the field it ranks', () => {
  for (const name of ['const MAP_METRICS=[', 'const RANK_TABS=[', 'const CMP_METRICS=[']) {
    const lit = literalAfter(INDEX, name);
    const entries = lit.match(/\{(?:id|f|label):/g) || [];
    const withF = lit.match(/\bf:"[a-zA-Z0-9]+"/g) || [];
    assert.ok(entries.length && withF.length >= entries.length, name + ' has entries without f:');
  }
});
t('the areas table opens in name order', () => {
  assert.match(INDEX, /sort:\{key:"name",dir:1\},/);
  assert.match(fnBody(INDEX, 'setMode'), /state\.sort=\{key:"name",dir:1\};/);
});

console.log('index.html — capital model');
t('the capital model reads no approximate curve, no generated history and no o-flag', () => {
  assert.ok(!/NATIONAL_CURVE|localCurve|seriesFor\(/.test(INDEX), 'the approximate curve or generated history is back');
  const m = /const CI_ENABLED=(true|false);/.exec(INDEX);
  assert.ok(m, 'CI_ENABLED switch missing');
  assert.ok(INDEX.indexOf('const CI_ENABLED=') < INDEX.indexOf('const MAP_METRICS='), 'CI_ENABLED must be declared before MAP_METRICS');
  const a = INDEX.indexOf('CAPITAL INTELLIGENCE — investment engine + UI'), b = INDEX.indexOf('national geography (canonical registry)');
  assert.ok(a > 0 && b > a, 'capital block markers moved');
  const cap = INDEX.slice(a, b);
  assert.ok(!/\bl\.o\b|\.o\|\||\boffT\b|\boffL\b|\bciConf\b|conf\.pct|minConf/.test(cap), 'o-flags or the old confidence % are back');
  assert.match(fnBody(INDEX, 'ciBasis'), /vcOf\(l,k,true\)/);   // data basis = value classes of the unfiltered inputs
});
t('its rankings stay inside the section and say they are a model', () => {
  assert.match(INDEX, /const CI_EXTERNAL=false;/);
  assert.match(INDEX, /ciRankBadge:"דירוג מודל"/);
  assert.match(INDEX, /ciRankBadge:"MODEL RANKING"/);
  assert.match(fnBody(INDEX, 'ciRankNoteHTML'), /t\.ciRankBadge/);
  assert.match(fnBody(INDEX, 'ciBody'), /el\("ciRankNote"\)\.innerHTML=ciRankNoteHTML\(\);\s*el\("ciList"\)\.innerHTML=/);
  // every entry outside the block: the section by CI_ENABLED, every outside surface by CI_EXTERNAL
  const lines = INDEX.split('\n');
  const start = lines.findIndex((l) => l.includes('CAPITAL INTELLIGENCE — investment engine + UI'));
  const end = lines.findIndex((l) => l.includes('national geography (canonical registry)'));
  const entry = /\b(ciEval|ciRank|ciOppOf|ciFactors|ciPortfolio|ciInvest|ciDeal|ciScen|ciReturnTarget|ciRefresh|renderCITeaser|renderCapital|initCapital)\(/g;
  const bad = [];
  lines.forEach((l, i) => {
    if (i >= start && i <= end) return;
    if (/^\s*function\s/.test(l)) return;
    for (const m of l.matchAll(entry)) {
      const want = /^(renderCapital|initCapital)$/.test(m[1]) ? 'CI_ENABLED' : 'CI_EXTERNAL';
      const gates = [...l.slice(0, m.index).matchAll(/CI_(ENABLED|EXTERNAL)/g)];
      if (!gates.length || gates[gates.length - 1][0] !== want) bad.push(`${i + 1}: ${m[1]} not behind ${want}`);
    }
  });
  assert.deepEqual(bad, []);
  // the command-bar signal is rendered inside the block: it stays off with CI_EXTERNAL
  assert.match(fnBody(INDEX, 'renderCmd'), /if\(!CI_EXTERNAL\)\{sig\.hidden=true;return\}/);
});
t('the section is shown by CI_ENABLED; the outside surfaces stay hidden', () => {
  assert.match(INDEX, /<section class="blk" id="capital" hidden>/);
  assert.match(INDEX, /if\(CI_ENABLED\)\{initCapital\(\);\["capital","railCap"\]\.forEach\(id=>\{el\(id\)\.hidden=false\}\)\}/);
  assert.match(INDEX, /<div id="ciTeaserBlk" hidden>/);
  assert.match(INDEX, /<button class="cap-signal" id="capSignal" type="button" hidden><\/button>/);
  assert.match(INDEX, /\nif\(CI_EXTERNAL\)el\("ciTeaserBlk"\)\.hidden=false;/);
  assert.match(INDEX, /\.cap-signal\[hidden\],\.ri\[hidden\],#capital\[hidden\],#ciTeaserBlk\[hidden\]\{display:none!important\}/);
});
t('capital returns are true IRRs from the deal calculator engine — no "model IRR", no confidence %', () => {
  const a = INDEX.indexOf('/* @ci-engine:start'), b = INDEX.indexOf('/* @ci-engine:end */');
  const eng = INDEX.slice(a, b);
  assert.ok(/calcEngine\(/.test(eng) && /calcIrr\(/.test(eng), 'capital returns no longer come from the calculator engine');
  assert.ok(!/IRR מודל|model IRR|ודאות מינ|Minimum confidence/i.test(INDEX), 'an old misleading label is back');
  // capital is equity: leverage and purchase tax/costs are in the equity per unit
  assert.match(eng, /const ciEqK=lv=>1-\(lv\?\?state\.ci\.ltv\)\/100\+\(CI_ASSUME\.tax\+CI_ASSUME\.fees\)\/100;/);
  assert.match(fnBody(INDEX, 'ciPortfolio'), /const f=r\.ev\.f,eqU=f\.price\*k;/);
});

console.log('standalone build');
t('standalone/ holds only the generated build', () => {
  assert.deepEqual(STANDALONE, ['standalone/israel-new-homes-v2.html'], 'unexpected file in standalone/: ' + STANDALONE.join(', '));
});
t('the build script embeds no password and refuses one', () => {
  const py = fs.readFileSync(path.join(ROOT, 'scripts', 'build-standalone.py'), 'utf8');
  assert.ok(!/PASSWORD\s*=|GATE_JS|var PASS=/.test(py), 'build-standalone.py defines a password or gate');
  assert.match(py, /if len\(sys\.argv\) > 1:\s*\n\s*sys\.exit\(/);
});
t('standalone build matches index.html', () => {
  const sa = FILES.find((x) => x.f === 'standalone/israel-new-homes-v2.html').src;
  for (const marker of ['const CI_EXTERNAL=false;', 'function ciPortfolio(', 'function vcOf(', 'function rankable(', 'function calcEngine(', 'מדגם מרכז היישוב', '<meta name="propx-build"']) {
    assert.ok(sa.includes(marker), 'standalone missing ' + marker + ' — run scripts/build-standalone.py');
  }
  const b = (s) => (/<meta name="propx-build" content="([^"]+)"/.exec(s) || [])[1];
  assert.equal(b(sa), b(INDEX), 'standalone build stamp differs — rebuild it');
  // the build records the sha256 of the index.html it came from: any later edit fails here
  const built = (/<meta name="propx-source-sha256" content="([0-9a-f]{64})">/.exec(sa) || [])[1];
  const now = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  assert.equal(built, now, 'standalone was built from a different index.html — run python3 scripts/build-standalone.py');
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
