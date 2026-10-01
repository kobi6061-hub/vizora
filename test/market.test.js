// PROPX · official market indicators — offline test suite.
// `node test/market.test.js`
//
// Every response below is SYNTHETIC: it follows the shapes of the Bank of
// Israel PublicApi and the CBS index API (catalog shapes as observed from the
// live API on 01.10.2026), but its codes and values are invented for the test
// and appear nowhere in the product.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const { fetchBoiRate, discoverCbsSeries, fetchCbsIndex, parseCbsPoints, isoDay } = require('../lib/market/sources');
const { mergeSnapshot, dataPayload, toJs } = require('../lib/market/snapshot');
const { FileStore } = require('../lib/gov/store');

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(
  () => { passed++; console.log('  ✓', name); },
  (e) => { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; },
);
const fakeFetch = (routes) => async (url) => {
  const u = String(url);
  for (const [frag, body, status = 200] of routes) {
    if (u.includes(frag)) return { ok: status < 400, status, json: async () => body };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const NOW = new Date('2026-10-01T04:00:00Z');
const BOI = { currentInterest: 3.25, nextInterestDate: '2026-10-21T00:00:00Z', lastPublishedDate: '2026-09-01T00:00:00Z' };
const CATALOG = { chapters: [
  { chapterId: 'a', chapterName: 'מדד המחירים לצרכן', chapterOrder: 1, mainCode: 990010, subject: null },
  { chapterId: 'aa', chapterName: 'מדד מחירי דירות', chapterOrder: 2, mainCode: 90010, subject: null },
] };
const CHAPTER_A = { chapterId: 'a', chapterName: null, chapterOrder: null, mainCode: null,
  subject: [{ subjectId: 37, subjectName: 'מדד המחירים לצרכן, לפי קבוצות צריכה', code: null }] };
const CHAPTER_AA = { chapterId: 'aa', chapterName: null, chapterOrder: null, mainCode: null, subject: [
  { subjectId: 45, subjectName: 'מדד מחירי דירות', code: null },
  { subjectId: 166, subjectName: 'מדד מחירי דירות לפי מחוזות', code: null },
  { subjectId: 167, subjectName: 'מדד מחירי דירות חדשות', code: null }] };
const SUBJECT = (id, name, codes) => ({ subjectId: id, subjectName: name, code: codes.map(([c, n]) => ({ codeId: c, codeName: n })) });
const CBS_ROUTES = [
  ['catalog/catalog', CATALOG],
  ['catalog/chapter?id=aa&', CHAPTER_AA],
  ['catalog/chapter?id=a&', CHAPTER_A],
  ['subject?id=45&', SUBJECT(45, 'מדד מחירי דירות', [[90010, 'מדד מחירי דירות']])],
  ['subject?id=166&', SUBJECT(166, 'מדד מחירי דירות לפי מחוזות', [[90020, 'מדד מחירי דירות - מחוז ירושלים'], [90030, 'מדד מחירי דירות - מחוז תל אביב']])],
  ['subject?id=167&', SUBJECT(167, 'מדד מחירי דירות חדשות', [[90050, 'מדד מחירי דירות חדשות'],
    [90051, 'מדד מחירי דירות חדשות ללא עסקאות דירה בהנחה'], [90060, 'מדד מחירי דירות יד שנייה']])],
];
const series = (code, name, pts) => ({ month: [{ code, name, date: pts.map(([y, m, v, p, py]) => (
  { year: y, month: m, percent: p, percentYear: py, currBase: { baseDesc: 'ממוצע 2024=100', value: v } })) }] });
const NH = series(90050, 'מדד מחירי דירות חדשות', [[2026, 7, 98.7, 0.4, -1.4], [2026, 6, 98.3, 0.2, -1.9]]);
const DW = series(90010, 'מדד מחירי דירות', [[2026, 7, 101.2, -0.3, -1.2], [2026, 6, 101.5, -0.4, -1.5]]);
const ROUTES = [['PublicApi/GetInterest', BOI], ...CBS_ROUTES, ['price?id=90050&', NH], ['price?id=90010&', DW]];

(async () => {
  console.log('Bank of Israel connector');
  await t('reads the current rate and the next decision date', async () => {
    const r = await fetchBoiRate({ fetchImpl: fakeFetch(ROUTES), now: NOW });
    assert.equal(r.value, 3.25);
    assert.equal(r.nextDecision, '2026-10-21');
    assert.equal(r.source.url, 'https://www.boi.org.il/PublicApi/GetInterest');
  });
  await t('an implausible or missing rate is refused, never passed through', async () => {
    for (const bad of [{}, { currentInterest: 'x' }, { currentInterest: 45 }]) {
      await assert.rejects(fetchBoiRate({ fetchImpl: fakeFetch([['GetInterest', bad]]), now: NOW }));
    }
  });
  await t('a past "next decision" date is dropped, not shown as upcoming', async () => {
    const r = await fetchBoiRate({ fetchImpl: fakeFetch([['GetInterest', { ...BOI, nextInterestDate: '2026-09-01' }]]), now: NOW });
    assert.equal(r.nextDecision, null);
  });
  await t('HTTP failure surfaces as an error with the reason', async () => {
    await assert.rejects(fetchBoiRate({ fetchImpl: fakeFetch([['GetInterest', {}, 503]]), now: NOW }), /HTTP 503/);
  });
  await t('isoDay normalizes the date shapes the API may use', () => {
    assert.equal(isoDay('2026-10-21T00:00:00Z'), '2026-10-21');
    assert.equal(isoDay('21/10/2026'), '2026-10-21');
    assert.equal(isoDay('soon'), null);
  });

  console.log('CBS discovery & series');
  await t('discovery picks the plain national series, never a district / subsidized / second-hand variant', async () => {
    const d = await discoverCbsSeries({ fetchImpl: fakeFetch(ROUTES) });
    assert.equal(d.picks.newHomesIndex.code, '90050');
    assert.equal(d.picks.dwellingsIndex.code, '90010');
  });
  await t('discovery walks catalog → chapters → housing subjects → series, expanding only housing subjects', async () => {
    const seen = [];
    const f = fakeFetch(ROUTES);
    const d = await discoverCbsSeries({ fetchImpl: async (u, i) => { seen.push(String(u)); return f(u, i); } });
    assert.ok(d.tried.some((x) => /housing subjects: 45 מדד מחירי דירות \| 166 .* \| 167 /.test(x)), d.tried.join(' / '));
    assert.ok(seen.some((u) => u.includes('subject?id=167&')) && !seen.some((u) => u.includes('subject?id=37&')));
  });
  await t('a catalog subject id is never taken for a series code', async () => {
    const d = await discoverCbsSeries({ fetchImpl: fakeFetch([
      ['catalog/catalog', { chapters: [{ chapterId: 'aa', chapterName: 'x', mainCode: null }] }],
      ['catalog/chapter?id=aa&', CHAPTER_AA],
      ['subject?id=', { subjectId: 167, subjectName: 'מדד מחירי דירות חדשות', code: null }],
    ]) });
    assert.equal(d.picks.newHomesIndex, null);
  });
  await t('series are recognised under codeId/codeName and other key casings', async () => {
    const d = await discoverCbsSeries({ fetchImpl: fakeFetch([
      ['catalog/catalog', { chapters: [{ chapterId: 'aa', chapterName: 'x', mainCode: null }] }],
      ['catalog/chapter?id=aa&', CHAPTER_AA],
      ['subject?id=45&', { subjectId: 45, subjectName: 'מדד מחירי דירות', code: [{ CODE: '90010', NAME: 'מדד מחירי דירות' }] }],
      ['subject?id=167&', { subjectId: 167, subjectName: 'n', code: [{ CodeID: '90050', CODENAME: 'מדד מחירי דירות חדשות' }] }],
      ['subject?id=', { code: [] }],
    ]) });
    assert.equal(d.picks.newHomesIndex.code, '90050');
    assert.equal(d.picks.dwellingsIndex.code, '90010');
  });
  await t('a non-JSON body is reported with its type and opening text', async () => {
    const htmlRes = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => '<html>maintenance</html>' });
    await assert.rejects(fetchBoiRate({ fetchImpl: htmlRes, now: NOW }), /not JSON \(text\/html\).*maintenance/);
  });
  await t('series parse: latest period, CBS-published y/y and m/m', async () => {
    const r = await fetchCbsIndex('newHomesIndex', { code: '90050', name: 'מדד מחירי דירות חדשות' }, { fetchImpl: fakeFetch(ROUTES), now: NOW });
    assert.deepEqual(r.period, { year: 2026, month: 7 });
    assert.equal(r.yoy, -1.4);
    assert.equal(r.mom, 0.4);
    assert.equal(r.periodKind, 'bimonthly-first-month');
    assert.ok(r.source.url.startsWith('https://api.cbs.gov.il/'));
  });
  await t('y/y is computed from same-base levels only when CBS omits it', async () => {
    const body = series(1, 'x', [[2026, 7, 103, null, null], [2025, 7, 100, null, null]]);
    const r = await fetchCbsIndex('newHomesIndex', { code: '1', name: 'x' }, { fetchImpl: fakeFetch([['price?id=1&', body]]), now: NOW });
    assert.equal(r.yoy, 3);
  });
  await t('a dead series (no current point) is refused', async () => {
    const body = series(1, 'x', [[2025, 6, 100, 0.1, 1.0]]);
    await assert.rejects(fetchCbsIndex('newHomesIndex', { code: '1', name: 'x' }, { fetchImpl: fakeFetch([['price?id=1&', body]]), now: NOW }), /not current/);
  });
  await t('an implausible annual change is refused', async () => {
    const body = series(1, 'x', [[2026, 7, 100, 0.1, 75]]);
    await assert.rejects(fetchCbsIndex('newHomesIndex', { code: '1', name: 'x' }, { fetchImpl: fakeFetch([['price?id=1&', body]]), now: NOW }), /implausible/);
  });
  await t('a missing series is a clear failure, not a different series', async () => {
    await assert.rejects(fetchCbsIndex('newHomesIndex', null, { fetchImpl: fakeFetch(ROUTES), now: NOW }), /not found/);
  });
  await t('parser accepts "YYYY-MM" date strings too', () => {
    const p = parseCbsPoints({ data: [{ date: '2026-07', value: 99.1 }] });
    assert.deepEqual([p[0].year, p[0].month, p[0].value], [2026, 7, 99.1]);
  });

  console.log('snapshot merge — what the site is allowed to show');
  const fresh = {
    boiRate: { ok: true, data: { value: 3.25, nextDecision: '2026-10-21', source: { url: 'u' } } },
    newHomesIndex: { ok: true, data: { yoy: -1.4, period: { year: 2026, month: 7 }, series: { code: '90050' }, source: { url: 'u' } } },
    dwellingsIndex: { ok: true, data: { yoy: -1.2, period: { year: 2026, month: 7 }, series: { code: '90010' }, source: { url: 'u' } } },
  };
  const s1 = mergeSnapshot(null, fresh, NOW);
  await t('fresh values carry checkedAt=now and are not stale', () => {
    assert.equal(s1.ok, true);
    assert.equal(s1.indicators.boiRate.checkedAt, NOW.toISOString());
    assert.equal(s1.indicators.newHomesIndex.stale, false);
  });
  await t('a failed source keeps its LAST GOOD value, marked stale with the reason', () => {
    const later = new Date('2026-10-02T04:00:00Z');
    const s2 = mergeSnapshot(s1, { ...fresh, boiRate: { ok: false, error: 'HTTP 503' } }, later);
    assert.equal(s2.ok, false);
    assert.equal(s2.indicators.boiRate.value, 3.25);
    assert.equal(s2.indicators.boiRate.stale, true);
    assert.equal(s2.indicators.boiRate.checkedAt, NOW.toISOString(), 'checkedAt must stay at the last success');
    assert.match(s2.indicators.boiRate.lastError, /503/);
  });
  await t('a failed source with no previous value is absent (UI keeps its dated figure)', () => {
    const s = mergeSnapshot(null, { ...fresh, newHomesIndex: { ok: false, error: 'x' } }, NOW);
    assert.equal(s.indicators.newHomesIndex, undefined);
  });
  await t('an index period never moves backwards', () => {
    const back = { ...fresh, newHomesIndex: { ok: true, data: { ...fresh.newHomesIndex.data, period: { year: 2026, month: 5 } } } };
    const s = mergeSnapshot(s1, back, new Date('2026-10-02T04:00:00Z'));
    assert.equal(s.indicators.newHomesIndex.period.month, 7);
    assert.equal(s.indicators.newHomesIndex.stale, true);
    assert.match(s.indicators.newHomesIndex.lastError, /backwards/);
  });
  await t('a series switch is recorded, not hidden', () => {
    const sw = { ...fresh, newHomesIndex: { ok: true, data: { ...fresh.newHomesIndex.data, series: { code: '90099' } } } };
    assert.equal(mergeSnapshot(s1, sw, NOW).indicators.newHomesIndex.seriesChangedFrom, '90050');
  });
  await t('history appends only when DATA changes, not on every daily check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    const store = new FileStore(dir);
    assert.equal(store.snapshot('indicators', dataPayload(s1)).changed, true);
    const sameDataNextDay = mergeSnapshot(s1, fresh, new Date('2026-10-02T04:00:00Z'));
    assert.equal(store.snapshot('indicators', dataPayload(sameDataNextDay)).changed, false);
    const moved = mergeSnapshot(s1, { ...fresh, boiRate: { ok: true, data: { ...fresh.boiRate.data, value: 3.0 } } }, NOW);
    assert.equal(store.snapshot('indicators', dataPayload(moved)).changed, true);
  });
  await t('latest.js evaluates to exactly the snapshot and contains no raw "<"', () => {
    const odd = { ...s1, note: '</script><b>' };
    const js = toJs(odd);
    assert.ok(!js.includes('<'));
    const ctx = { window: {} };
    vm.runInNewContext(js, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.PROPX_MARKET)), JSON.parse(JSON.stringify(odd)));
  });

  console.log('CLI end to end (stubbed network)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-cli-'));
  const stub = path.join(tmp, 'routes.json');
  const run = (routes) => {
    fs.writeFileSync(stub, JSON.stringify(routes));
    return spawnSync(process.execPath, ['-r', path.join(__dirname, 'helpers', 'market-fetch-stub.js'),
      path.join(__dirname, '..', 'scripts', 'market-sync.js'), '--out', tmp, '--summary-file', path.join(tmp, 'sum.txt')],
    { env: { ...process.env, MARKET_STUB: stub, GITHUB_STEP_SUMMARY: '' }, encoding: 'utf8' });
  };
  // the stubbed CBS points must be "current" relative to the real clock
  const d = new Date(); const y = d.getUTCFullYear(); const m = d.getUTCMonth() + 1;
  const pm = m > 2 ? [y, m - 2] : [y - 1, m + 10];
  const live = [['PublicApi/GetInterest', BOI], ...CBS_ROUTES,
    ['price?id=90050&', series(90050, 'מדד מחירי דירות חדשות', [[pm[0], pm[1], 98.7, 0.4, -1.4]])],
    ['price?id=90010&', series(90010, 'מדד מחירי דירות', [[pm[0], pm[1], 101.2, -0.3, -1.2]])]];
  await t('all sources OK → exit 0, latest.json + latest.js + history written', () => {
    const r = run(live);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const snap = JSON.parse(fs.readFileSync(path.join(tmp, 'latest.json'), 'utf8'));
    assert.equal(snap.indicators.boiRate.value, 3.25);
    assert.equal(snap.indicators.newHomesIndex.yoy, -1.4);
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(tmp, 'latest.js'), 'utf8'), ctx);
    assert.equal(ctx.window.PROPX_MARKET.indicators.dwellingsIndex.yoy, -1.2);
    assert.ok(fs.readdirSync(path.join(tmp, 'snapshots', 'indicators')).length === 2); // one entry + latest.json
    assert.match(fs.readFileSync(path.join(tmp, 'sum.txt'), 'utf8'), /BoI 3\.25%/);
  });
  await t('one source down → exit 2, its last good value kept and marked stale', () => {
    const r = run([['PublicApi/GetInterest', {}, 503], ...live.slice(1)]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const snap = JSON.parse(fs.readFileSync(path.join(tmp, 'latest.json'), 'utf8'));
    assert.equal(snap.indicators.boiRate.value, 3.25);
    assert.equal(snap.indicators.boiRate.stale, true);
    assert.equal(snap.indicators.newHomesIndex.stale, false);
  });
  await t('everything down with nothing usable → exit 1, nothing written', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-none-'));
    fs.writeFileSync(stub, JSON.stringify([]));
    const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'helpers', 'market-fetch-stub.js'),
      path.join(__dirname, '..', 'scripts', 'market-sync.js'), '--out', empty],
    { env: { ...process.env, MARKET_STUB: stub, GITHUB_STEP_SUMMARY: '' }, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(fs.existsSync(path.join(empty, 'latest.json')), false);
  });

  console.log('HARD BUILD GATE — committed snapshot purity');
  await t('data/market/latest.json only carries official-source values', () => {
    const f = path.join(__dirname, '..', 'data', 'market', 'latest.json');
    const snap = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(snap.schema, 1);
    for (const [k, v] of Object.entries(snap.indicators || {})) {
      assert.ok(v.source && /^https:\/\/(www\.boi\.org\.il|api\.cbs\.gov\.il)\//.test(v.source.url), `${k}: non-official source ${v.source && v.source.url}`);
      assert.ok(v.checkedAt, `${k}: no checkedAt`);
    }
  });

  await new Promise((r) => setImmediate(r));
  console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
})();
