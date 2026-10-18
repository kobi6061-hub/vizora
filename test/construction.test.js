// PROPX · CBS construction — offline tests of the official-series lane (lib/construction).
// `node test/construction.test.js`
//
// No network: every request is answered from test/fixtures/cbs-construction-sample.json — a labelled TEST FIXTURE in the
// exact shape of the CBS series API (catalogue listings + data responses, synthetic values), never read by the product.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const S = require('../lib/construction/series');
const R = require('../lib/construction/resolve');
const { parseResponse, periodOf, SchemaError } = require('../lib/construction/parse');
const L = require('../lib/construction/ledger');
const MX = require('../lib/construction/metrics');
const { buildPayload, toJs } = require('../lib/construction/snapshot');
const { runSync, exitCodeOf, FILES } = require('../lib/construction/sync');

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };
const ta = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };

const ROOT = path.join(__dirname, '..');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cbs-construction-sample.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'propx-construction-'));
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/* the fake API: catalogue by id (a catalog/level page as "level:<level>:<subject>:<page>"), data by id window-filtered as the API
   would; `fail` = id → HTTP status; `mutate` edits a body */
function fetcherOf({ fail = {}, mutate = null } = {}) {
  return async (url) => {
    const u = new URL(url); let id = u.searchParams.get('id');
    if (u.pathname.endsWith('/catalog/level')) id = `level:${id}:${u.searchParams.get('subject')}:${u.searchParams.get('Page') || 1}`;
    if (fail[id]) { const e = new Error(`HTTP ${fail[id]} from ${url}`); e.status = fail[id]; throw e; }
    let body = null;
    if (u.pathname.endsWith('/catalog/path') || u.pathname.endsWith('/catalog/level')) body = FX.catalogue[id] ? clone(FX.catalogue[id]) : null;
    else if (u.pathname.endsWith('/data/path') && FX.data[id]) {
      body = clone(FX.data[id]);
      const [sm, sy] = u.searchParams.get('startperiod').split('-'), [em, ey] = u.searchParams.get('endperiod').split('-');
      for (const s of body.DataSet.Series) s.obs = s.obs.filter((o) => o.TimePeriod >= `${sy}-${sm}` && o.TimePeriod <= `${ey}-${em}`);
    }
    if (!body) { const e = new Error(`HTTP 404 from ${url}`); e.status = 404; throw e; }
    if (mutate) body = mutate(id, body, u) || body;
    const text = JSON.stringify(body);
    return { json: JSON.parse(text), text, status: 200 };
  };
}
const NOW = new Date('2026-10-17T12:00:00Z');
const req = (measure, geo) => { const M = S.MEASURES[measure], code = M.codes[geo]; const pathId = M.geoLevel === 'name_id' ? S.pathIdOf(measure, code) : S.pathIdOf(measure, code, 2); return { measure, geo, cbs: code, leaf: M.geoLevel === 'name_id' ? null : 2, pathId, url: S.urlFor(pathId, [2022, 2026]) }; };
const body = (measure, geo) => clone(FX.data[req(measure, geo).pathId]);
const original = (b, time) => b.DataSet.Series.find((s) => s.data.value === 1 && s.time.value === time);

(async () => {
console.log('fixture');
t('the fixture is labelled a TEST FIXTURE and is read by nothing in the product', () => {
  assert.match(FX._fixture, /TEST FIXTURE/); assert.match(FX._fixture, /NEVER read by the product/);
  const files = [...fs.readdirSync(path.join(ROOT, 'lib', 'construction')).filter((f) => f.endsWith('.js')).map((f) => path.join('lib', 'construction', f)), 'scripts/construction-sync.js', 'lib/trust/catalog.js', 'index.html'];
  for (const f of files) assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('cbs-construction-sample'), f + ' reads the fixture');
  assert.strictEqual(Object.keys(FX.data).length, 32); assert.strictEqual(Object.keys(FX.catalogue).length, 6, '4 branch listings + 2 level-4 pages');
  /* the real shapes the runner answered on 18.10.2026 */
  assert.strictEqual(FX.catalogue['44,11,2'].catalogs.catalog.find((n) => n.path[4] === 1).name, 'סך כולל');
  assert.strictEqual(FX.catalogue['44,2,3'].catalogs.catalog.length, 16); assert.ok(FX.catalogue['44,2,3'].catalogs.catalog.some((n) => n.path[4] === 4141 && /^-+$/.test(n.name)));
  assert.ok(FX.catalogue['44,2,3'].catalogs.catalog.every((n) => n.path.length === 5), 'no named level-4 node in the branch listing');
  assert.strictEqual(FX.catalogue['44,4,3'].catalogs.catalog.length, 8);
  assert.ok(FX.catalogue['level:4:44:1'].catalogs.paging.next_url && !FX.catalogue['level:4:44:2'].catalogs.paging.next_url, 'the level listing pages');
});

console.log('source definition');
t('four measures, each with CBS\'s semantics and kind; eight geographies by CBS code per branch — no locality', () => {
  assert.strictEqual(S.SOURCE.id, 'cbs:construction');
  assert.deepStrictEqual(S.MEASURE_IDS, ['permits', 'starts', 'completions', 'active']);
  assert.deepStrictEqual(S.MEASURE_IDS.map((m) => S.MEASURES[m].path), ['44,11,2', '44,2,3', '44,3,3', '44,4,3']);
  assert.deepStrictEqual(S.MEASURE_IDS.map((m) => S.MEASURES[m].kind), ['flow', 'flow', 'flow', 'stock']);
  assert.match(S.MEASURES.starts.semantics.en, /construction began/); assert.match(S.MEASURES.completions.semantics.en, /was completed/);
  assert.match(S.MEASURES.active.semantics.en, /under construction at the end of the period/); assert.match(S.MEASURES.permits.semantics.en, /building permits issued/);
  assert.match(S.SOURCE.definition.he, /התחלות בנייה = דירות שבנייתן החלה/);
  assert.deepStrictEqual(S.GEOS.map((g) => g.key), ['il', 'd-jm', 'd-north', 'd-haifa', 'd-center', 'd-ta', 'd-south', 'jsr']);
  assert.ok(S.GEOS.every((g) => g.level === 'national' || g.level === 'district'), 'a locality level appeared in the construction lane');
  assert.deepStrictEqual(S.LEVEL4_CODES, { il: 8, 'd-jm': 1, 'd-north': 2, 'd-haifa': 3, 'd-center': 4, 'd-ta': 5, 'd-south': 6, jsr: 7 });
  assert.deepStrictEqual(S.PERMIT_CODES, { il: 1, 'd-jm': 271, 'd-north': 272, 'd-haifa': 273, 'd-center': 274, 'd-ta': 275, 'd-south': 276, jsr: 277 });
  assert.strictEqual(S.pathIdOf('starts', 8, 2), '44,2,3,8,2'); assert.strictEqual(S.pathIdOf('permits', 275), '44,11,2,,275');
  assert.throws(() => S.pathIdOf('starts', 5), /needs the resolved leaf/);
  for (const m of S.MEASURE_IDS) for (const v of S.MEASURES[m].verified) assert.ok(v.startsWith(S.MEASURES[m].path + ','), `${m}: verified path ${v} is not on the branch`);
  assert.deepStrictEqual(S.TIME_KIND, { 3: 'M', 2: 'Q', 1: 'Y' }, 'only the kinds read on the runner: 3 month, 2 quarter ("רבע"), 1 year');
  assert.strictEqual(S.TIME_KIND[4], undefined, 'the discovery text\'s "4 quarter" was never seen in a response — not mapped');
  assert.ok(S.SOURCE.lagAssumption && S.SOURCE.lagAssumption.observed[0].days === 72 && /Assumption/.test(S.SOURCE.lagAssumption.en), 'the lag assumption is documented as an assumption');
  assert.strictEqual(S.SOURCE.discovery, 'cbs:series:construction-by-district');
});
t('the board districts are exactly the PROPX district rows (exact code mapping, no names)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const g of S.GEOS.filter((x) => x.level === 'district' && x.key !== 'jsr')) assert.ok(html.includes(`{id:"${g.key}",type:"district"`), 'no board district ' + g.key);
});
t('request windows ≤ 6 years from 2016; the plan requests only resolved geographies', () => {
  assert.deepStrictEqual(S.windows(NOW), [[2016, 2021], [2022, 2026]]);
  const res = { measures: { starts: { ok: true, geos: { il: { status: 'resolved', code: 8, leaf: 2, pathId: '44,2,3,8,2' }, 'd-jm': { status: 'mismatch', code: 2 }, 'd-ta': { status: 'unresolved' }, 'd-haifa': { status: 'pending', code: 3, leaf: 2, pathId: '44,2,3,3,2' } } } } };
  const P = S.plan(res, NOW);
  assert.strictEqual(P.length, 4, 'resolved and pending are requested; mismatch and unresolved never'); assert.ok(P.every((q) => (q.geo === 'il' && /id=44,2,3,8,2&/.test(q.url)) || (q.geo === 'd-haifa' && /id=44,2,3,3,2&/.test(q.url))));
  assert.ok(S.nameFits(S.GEO_BY_KEY.il, 'סך כולל') && S.nameFits(S.GEO_BY_KEY.il, 'סך הכל') && !S.nameFits(S.GEO_BY_KEY['d-jm'], 'סך הכל') && S.nameFits(S.GEO_BY_KEY.jsr, 'אזור יהודה והשומרון (עד 2005 כולל חבל עזה)') && !S.nameFits(S.GEO_BY_KEY['d-ta'], 'המרכז'));
  assert.ok(S.SEPARATOR.test('----------------------------------') && !S.SEPARATOR.test('סך הכל'));
  assert.match(S.levelUrl(4, 44, 2), /catalog\/level\?id=4&subject=44&.*Page=2&PageSize=100$/);
});

console.log('catalogue resolution — the name verifies the code, the code keys the data');
let RES = null;
await ta('every geography of every measure resolves to the expected code and path: permits by the named leaves, the by-district branches by the level-4 listing', async () => {
  const bundle = [];
  RES = await R.resolveAll({ fetchJson: fetcherOf(), bundle, now: NOW });
  assert.strictEqual(RES.requests, 6, '2 pages of the level-4 listing + 4 branch listings'); assert.deepStrictEqual([RES.level4.ok, RES.level4.pages, RES.level4.count], [true, 2, 29]);
  for (const m of S.MEASURE_IDS) {
    const M = RES.measures[m]; assert.ok(M.ok, m);
    for (const g of S.GEOS) { const x = M.geos[g.key]; assert.strictEqual(x.status, 'resolved', `${m} ${g.key}: ${x.reason}`); assert.strictEqual(x.code, S.MEASURES[m].codes[g.key]); assert.strictEqual(x.nameSource, 'catalogue'); }
  }
  assert.deepStrictEqual([RES.measures.starts.nodes, RES.measures.starts.separators, RES.measures.completions.separators, RES.measures.active.nodes, RES.measures.active.separators], [16, 8, 8, 8, 0], 'the "----" leaves are listed and never resolved');
  assert.strictEqual(RES.measures.starts.geos['d-ta'].pathId, '44,2,3,5,2'); assert.strictEqual(RES.measures.starts.geos['d-ta'].name, 'תל אביב'); assert.strictEqual(RES.measures.starts.geos['d-ta'].leafName, 'סך הכל');
  assert.strictEqual(RES.measures.starts.geos.il.name, 'סך הכל'); assert.strictEqual(RES.measures.starts.geos.jsr.name, 'יו"ש');
  assert.strictEqual(RES.measures.permits.geos['d-ta'].pathId, '44,11,2,,275'); assert.strictEqual(RES.measures.permits.geos.jsr.name, 'אזור יהודה והשומרון (עד 2005 כולל חבל עזה)');
  assert.strictEqual(RES.measures.permits.geos.il.name, 'סך כולל', 'the permits total is "סך כולל"'); assert.strictEqual(RES.measures.permits.geos.il.pathId, '44,11,2,,1');
  assert.strictEqual(RES.measures.active.geos.il.pathId, '44,4,3,8,2');
  assert.ok(RES.measures.starts.listed.length === 16 && RES.measures.starts.listed.every((n) => n.pathDesc), 'the listing is kept as evidence, pathDesc included');
  const sum = R.summarize(RES);
  assert.deepStrictEqual([sum.starts.resolved, sum.starts.byCatalogue, sum.starts.byResponse, sum.starts.pending, sum.starts.mismatch, sum.starts.unresolved, sum.starts.separators], [8, 8, 0, [], [], [], 8]);
  assert.strictEqual(S.plan(RES, NOW).length, 4 * 8 * 2);
});
await ta('a district name found under another code is a MISMATCH — never requested, never re-keyed by the name (permits leaves, level-4 listing)', async () => {
  const mutate = (id, b) => {
    if (id === 'level:4:44:1') { const a = b.catalogs.catalog.find((n) => n.path[1] === 2 && n.path[2] === 3 && n.path[3] === 1), c = b.catalogs.catalog.find((n) => n.path[1] === 2 && n.path[2] === 3 && n.path[3] === 2); [a.name, c.name] = [c.name, a.name]; }
    if (id === '44,11,2') { const a = b.catalogs.catalog.find((n) => n.path[4] === 273), c = b.catalogs.catalog.find((n) => n.path[4] === 274); [a.name, c.name] = [c.name, a.name]; }
  };
  const res = await R.resolveAll({ fetchJson: fetcherOf({ mutate }), now: NOW });
  const st = res.measures.starts.geos;
  assert.strictEqual(st['d-jm'].status, 'mismatch'); assert.strictEqual(st['d-jm'].code, 1); assert.strictEqual(st['d-jm'].name, 'הצפון'); assert.match(st['d-jm'].reason, /is named "הצפון", not Jerusalem District; "ירושלים" is 44,2,3,2/);
  assert.strictEqual(st['d-north'].status, 'mismatch'); assert.strictEqual(st['d-haifa'].status, 'resolved');
  const pe = res.measures.permits.geos;
  assert.strictEqual(pe['d-haifa'].status, 'mismatch'); assert.strictEqual(pe['d-haifa'].code, 274); assert.match(pe['d-haifa'].reason, /differs from the expected 273/); assert.strictEqual(pe['d-center'].status, 'mismatch');
  assert.ok(!S.plan(res, NOW).some((q) => (q.measure === 'starts' && (q.geo === 'd-jm' || q.geo === 'd-north')) || (q.measure === 'permits' && (q.geo === 'd-haifa' || q.geo === 'd-center'))));
  assert.ok(res.measures.completions.geos['d-jm'].status === 'resolved', 'another branch is untouched');
});
await ta('without a catalogue name a by-district geography is PENDING (requested, applied only once a response names it); no leaf / no single total leaf / an ambiguous permits name is UNRESOLVED', async () => {
  const mutate = (id, b) => {
    if (id === 'level:4:44:2') b.catalogs.catalog = b.catalogs.catalog.filter((n) => !(n.path[1] === 4 && n.path[3] === 3));   /* active d-haifa unnamed */
    if (id === '44,11,2') b.catalogs.catalog.push({ path: [44, 11, 2, null, 999], name: 'חיפה', pathDesc: '' });
    if (id === '44,4,3') b.catalogs.catalog = b.catalogs.catalog.filter((n) => n.path[3] !== 6);
    if (id === '44,2,3') { b.catalogs.catalog.push({ path: [44, 2, 3, 5, 3], name: 'בניינים', pathDesc: '' }); b.catalogs.catalog.find((n) => n.path[3] === 4 && n.path[4] === 2).name = 'בניינים'; b.catalogs.catalog.push({ path: [44, 2, 3, 4, 3], name: 'דירות', pathDesc: '' }); }
  };
  const res = await R.resolveAll({ fetchJson: fetcherOf({ mutate }), now: NOW });
  const ah = res.measures.active.geos['d-haifa'];
  assert.strictEqual(ah.status, 'pending'); assert.strictEqual(ah.pathId, '44,4,3,3,2'); assert.strictEqual(ah.nameSource, null); assert.match(ah.reason, /no level-4 node 44,4,3,3 in the level listing .* the data response must name it/);
  assert.ok(S.plan(res, NOW).some((q) => q.measure === 'active' && q.geo === 'd-haifa'), 'a pending geography is requested');
  assert.strictEqual(res.measures.permits.geos['d-haifa'].status, 'unresolved'); assert.match(res.measures.permits.geos['d-haifa'].reason, /ambiguous/);
  assert.strictEqual(res.measures.active.geos['d-south'].status, 'unresolved'); assert.match(res.measures.active.geos['d-south'].reason, /no leaf 44,4,3,6,\* in the listing/);
  assert.strictEqual(res.measures.starts.geos['d-ta'].status, 'resolved'); assert.strictEqual(res.measures.starts.geos['d-ta'].leaf, 2, 'the total leaf wins among several');
  assert.strictEqual(res.measures.starts.geos['d-center'].status, 'unresolved'); assert.match(res.measures.starts.geos['d-center'].reason, /none is the total/);
  assert.strictEqual(res.measures.active.geos.il.status, 'resolved');
  /* the whole level-4 listing unavailable: every by-district geography pending, permits untouched */
  const r2 = await R.resolveAll({ fetchJson: fetcherOf({ fail: { 'level:4:44:1': 500 } }), now: NOW });
  assert.ok(!r2.level4.ok && /HTTP 500/.test(r2.level4.error));
  assert.ok(['starts', 'completions', 'active'].every((m) => Object.values(r2.measures[m].geos).every((x) => x.status === 'pending' && /level-4 listing failed/.test(x.reason))));
  assert.ok(Object.values(r2.measures.permits.geos).every((x) => x.status === 'resolved'));
  assert.strictEqual(S.plan(r2, NOW).length, 64);
});
await ta('a catalogue in an unrecognized shape, or refused, fails the measure — nothing requested for it', async () => {
  const res = await R.resolveAll({ fetchJson: fetcherOf({ mutate: (id, b) => (id === '44,11,2' ? { catalogs: { level: 5 } } : b), fail: { '44,2,3': 403 } }), now: NOW });
  assert.ok(!res.measures.permits.ok && res.measures.permits.errorKind === 'schema' && /unrecognized shape/.test(res.measures.permits.error));
  assert.ok(!res.measures.starts.ok && res.measures.starts.errorKind === 'refused');
  assert.ok(res.measures.completions.ok && res.measures.active.ok);
  assert.ok(!S.plan(res, NOW).some((q) => q.measure === 'permits' || q.measure === 'starts'));
  assert.throws(() => R.catalogNodes({ catalogs: { catalog: [{ path: 'a,b' }] } }), SchemaError);
  const n = R.catalogNodes({ catalogs: { level: 5, catalog: [{ path: '44,11,2,,271', name: 'מחוז ירושלים' }] } }).nodes[0];
  assert.deepStrictEqual([n.pathId, n.depth, n.path[3]], ['44,11,2,,271', 5, null], 'a string path with an empty level is read');
});
await ta('finalize: a response names a pending geography → resolved (by response); a response naming the code otherwise → mismatch, whatever another window said', async () => {
  const res = await R.resolveAll({ fetchJson: fetcherOf({ fail: { 'level:4:44:1': 500 } }), now: NOW });
  const named = { measure: 'starts', geo: 'd-jm', ok: true, parsed: { names: ['ירושלים'] } };
  const wrong = { measure: 'starts', geo: 'd-ta', ok: false, kind: 'geo-name', error: 'geography name mismatch: series 1 is named "המרכז", not Tel Aviv District' };
  const later = { measure: 'starts', geo: 'd-ta', ok: true, parsed: { names: ['תל אביב'] } };
  R.finalize(res, [named, wrong, later]);
  assert.deepStrictEqual([res.measures.starts.geos['d-jm'].status, res.measures.starts.geos['d-jm'].nameSource, res.measures.starts.geos['d-jm'].name], ['resolved', 'response', 'ירושלים']);
  assert.deepStrictEqual([res.measures.starts.geos['d-ta'].status, res.measures.starts.geos['d-ta'].nameSource], ['mismatch', 'response']);
  assert.strictEqual(res.measures.starts.geos['d-haifa'].status, 'pending'); assert.match(res.measures.starts.geos['d-haifa'].reason, /never named this geography/);
  const sum = R.summarize(res);
  assert.deepStrictEqual([sum.starts.resolved, sum.starts.byResponse, sum.starts.pending.length, sum.starts.mismatch.length], [1, 1, 6, 1]);
});

console.log('ingestion — the period kind is the series\' own, never assumed');
t('parse: original monthly, quarterly and annual read; SA / trend (first in the response) kept out', () => {
  const r = parseResponse(body('starts', 'd-ta'), req('starts', 'd-ta'));
  assert.deepStrictEqual(r.freqs, ['M', 'Q', 'Y']);
  assert.strictEqual(r.series.length, 5); assert.strictEqual(r.series[0].kind, 'sa', 'the SA series comes first in the response');
  assert.ok(r.obs.every((o) => o.dataKind === 'original' && o.update === '2026-09-10' && o.geo === 'd-ta' && o.cbs === 5 && o.nameId === 2 && o.pathId === '44,2,3,5,2' && o.kind === 'flow'));
  const q = r.obs.filter((o) => o.freq === 'Q').sort((a, b) => (a.period < b.period ? -1 : 1));
  assert.deepStrictEqual([q[q.length - 1].period, q[q.length - 1].sourcePeriod], ['2026-Q2', '2026-06'], 'a quarter is dated by its quarter, the source string kept');
  const m = r.obs.filter((o) => o.freq === 'M'); assert.strictEqual(m.length, 30); assert.ok(m.every((o) => /^\d{4}-\d{2}$/.test(o.period)));
  const y = r.obs.filter((o) => o.freq === 'Y').map((o) => o.period).sort(); assert.deepStrictEqual(y, ['2024', '2025']);
  const qSum = q.find((o) => o.period === '2026-Q2').value, mSum = m.filter((o) => ['2026-04', '2026-05', '2026-06'].includes(o.period)).reduce((a, o) => a + o.value, 0);
  assert.strictEqual(qSum, mSum, 'CBS\'s own quarterly figure beside the months (the fixture is consistent)');
  assert.strictEqual(r.series.find((s) => s.freq === 'Q').quarterConvention, 'end-month', 'the series says how it writes its quarters');
  assert.ok(r.series.find((s) => s.freq === 'Q').id && FX.data['44,2,3,5,2'].DataSet.Series.find((s) => s.time.value === 2).time.name === 'רבע', 'quarterly = time.value 2 "רבע", as the runner printed');
  assert.strictEqual(r.obs.find((o) => o.freq === 'M' && o.period === '2026-06').geoName, 'תל אביב', 'the name travels as a label only');
  assert.deepStrictEqual(r.names, ['תל אביב'], 'the names the response carried — the verification evidence');
});
t('parse: the geography NAME in the series path must say it is the district asked — a code alone never suffices (GeoNameError, not a shape error)', () => {
  const a = body('starts', 'd-ta'); a.DataSet.Series.forEach((s) => { s.path.level4.name = 'המרכז'; });
  assert.throws(() => parseResponse(a, req('starts', 'd-ta')), (e) => e.name === 'GeoNameError' && /is named "המרכז", not Tel Aviv District/.test(e.message) && !/unrecognized shape/.test(e.message));
  const b = body('starts', 'il'); b.DataSet.Series.forEach((s) => { s.path.level4.name = 'ירושלים'; });
  assert.throws(() => parseResponse(b, req('starts', 'il')), /GeoNameError|name mismatch/);
  const c = body('permits', 'jsr'); c.DataSet.Series.forEach((s) => { s.path.name_id.name = ''; });
  assert.throws(() => parseResponse(c, req('permits', 'jsr')), /carries no geography name/);
  const d = body('starts', 'd-jm'); d.DataSet.Series.forEach((s) => { s.path.level4.name = 'סך הכל'; });
  assert.throws(() => parseResponse(d, req('starts', 'd-jm')), /name mismatch/, 'a total node is never a district');
  assert.strictEqual(parseResponse(body('permits', 'il'), req('permits', 'il')).names[0], 'סך כולל');
  assert.strictEqual(parseResponse(body('permits', 'jsr'), req('permits', 'jsr')).names[0], 'אזור יהודה והשומרון (עד 2005 כולל חבל עזה)');
});
t('parse: the permits 9538xx series is the quarterly original (time 2 "רבע") and is read as quarters; a series of a kind PROPX does not map is SKIPPED and listed with its raw kind — never applied', () => {
  const r = parseResponse(body('permits', 'd-ta'), req('permits', 'd-ta'));
  assert.deepStrictEqual(r.freqs, ['M', 'Q', 'Y']); assert.strictEqual(r.series.length, 4); assert.ok(!r.series.some((s) => s.skipped));
  const q = r.obs.filter((o) => o.seriesId === 953875); assert.strictEqual(q.length, 10); assert.ok(q.every((o) => o.freq === 'Q' && /^\d{4}-Q[1-4]$/.test(o.period)));
  const b = body('permits', 'd-ta'); b.DataSet.Series.find((s) => s.id === 953875).time = { value: 9, name: 'לא ידוע' };
  const r2 = parseResponse(b, req('permits', 'd-ta'));
  const sk = r2.series.filter((s) => s.skipped);
  assert.strictEqual(sk.length, 1); assert.strictEqual(sk[0].id, 953875); assert.strictEqual(sk[0].skipped, 'time 9 "לא ידוע" / data 1 "נתונים מקוריים"'); assert.strictEqual(sk[0].n, 10);
  assert.ok(!r2.obs.some((o) => o.seriesId === 953875), 'nothing of the skipped series is applied'); assert.deepStrictEqual(r2.freqs, ['M', 'Y']);
});
t('parse: a measure answered only in quarters (+ annual) is stored as quarters (active construction) — never shown as months; quarterly SA / trend ignored', () => {
  const r = parseResponse(body('active', 'il'), req('active', 'il'));
  assert.deepStrictEqual(r.freqs, ['Q', 'Y']); assert.ok(r.obs.every((o) => o.kind === 'stock' && (o.freq === 'Y' ? /^\d{4}$/ : /^\d{4}-Q[1-4]$/).test(o.period)));
  assert.strictEqual(r.series.filter((s) => s.freq === 'Q' && (s.kind === 'sa' || s.kind === 'trend')).length, 2, 'the national row carries quarterly SA and trend series');
  assert.ok(r.obs.every((o) => o.dataKind === 'original'), 'none of their values is applied');
  assert.strictEqual(r.obs.filter((o) => o.freq === 'Q').length, 10); assert.deepStrictEqual(r.obs.filter((o) => o.freq === 'Y').map((o) => o.period).sort(), ['2024', '2025']);
  assert.strictEqual(periodOf('M', '2026-13'), null); assert.strictEqual(periodOf('Y', '2025-01'), '2025'); assert.strictEqual(periodOf('Y', '2025'), '2025');
});
t('quarterly periods are parsed defensively per series: explicit forms, quarter-end months (the evidenced convention), quarter numbers only when the series proves it — anything else is a schema change naming the string', () => {
  const { quarterConvention, explicitQuarter } = require('../lib/construction/parse');
  assert.strictEqual(quarterConvention(['2026-Q1', '2026 Q2', 'Q3/2026', 'Q4 2025', '2026-4', '2026Q1']), 'explicit');
  assert.deepStrictEqual(['2026-Q1', '2026 Q2', 'Q3/2026', 'Q4 2025', '2026-4', '2026Q1', '2026-04'].map(explicitQuarter), ['2026-Q1', '2026-Q2', '2026-Q3', '2025-Q4', '2026-Q4', '2026-Q1', null]);
  assert.strictEqual(quarterConvention(['2026-06', '2026-03', '2025-12', '2025-09']), 'end-month');
  assert.strictEqual(quarterConvention(['2026-03']), 'end-month', 'a lone "-03" reads as the quarter-end month — the convention the discovery\'s reads showed');
  assert.strictEqual(quarterConvention(['2026-01', '2026-02', '2026-03', '2026-04', '2025-04']), 'quarter-number');
  assert.strictEqual(quarterConvention([]), 'explicit');
  assert.throws(() => quarterConvention(['2026-01', '2026-06']), (e) => e.name === 'SchemaError' && /mix or use months 01\/06/.test(e.message));
  assert.throws(() => quarterConvention(['2026-05', '2026-08']), (e) => e.name === 'SchemaError' && /"2026-05", "2026-08"/.test(e.message));
  assert.throws(() => quarterConvention(['2026/2', '2026/3']), (e) => e.name === 'SchemaError' && /"2026\/2"/.test(e.message) && /not a form PROPX reads/.test(e.message));
  assert.throws(() => quarterConvention(['2026-Q1', '2026-06']), SchemaError, 'a mix of explicit quarters and months is undecidable');
  assert.deepStrictEqual([periodOf('Q', '2026-09', 'end-month'), periodOf('Q', '2026-05', 'end-month'), periodOf('Q', '2026-02', 'quarter-number'), periodOf('Q', '2026-06', 'quarter-number'), periodOf('Q', 'Q4/2025', 'explicit'), periodOf('Q', '2025-12', 'explicit')], ['2026-Q3', null, '2026-Q2', null, '2025-Q4', null]);
  /* at the parser: a quarterly series in the quarter-number form is read as quarters; a lone odd month fails the whole series, naming it */
  const qn = body('active', 'd-jm'); const s = original(qn, 2); s.obs = [{ TimePeriod: '2026-02', Value: 10 }, { TimePeriod: '2026-01', Value: 9 }, { TimePeriod: '2025-04', Value: 8 }];
  assert.deepStrictEqual(parseResponse(qn, req('active', 'd-jm')).obs.filter((o) => o.freq === 'Q').map((o) => [o.period, o.sourcePeriod]).sort(), [['2025-Q4', '2025-04'], ['2026-Q1', '2026-01'], ['2026-Q2', '2026-02']]);
  const bad = body('active', 'd-jm'); original(bad, 2).obs.push({ TimePeriod: '2026-05', Value: 1 });
  assert.throws(() => parseResponse(bad, req('active', 'd-jm')), (e) => e.name === 'SchemaError' && /"2026-05"/.test(e.message) && /unrecognized shape/.test(e.message));
});
t('parse: permits by name_id with no level 4; a series of another geography, leaf, level or branch is a schema change', () => {
  const r = parseResponse(body('permits', 'd-ta'), req('permits', 'd-ta'));
  assert.ok(r.obs.length && r.obs.every((o) => o.cbs === 275 && o.nameId === 275 && o.pathId === '44,11,2,,275' && o.geoName === 'תל אביב'));
  const a = body('starts', 'd-ta'); a.DataSet.Series.forEach((s) => { s.path.level4.value = 4; });
  assert.throws(() => parseResponse(a, req('starts', 'd-ta')), /geography 4, asked 5/);
  const b = body('starts', 'd-ta'); b.DataSet.Series.forEach((s) => { s.path.name_id.value = 3; });
  assert.throws(() => parseResponse(b, req('starts', 'd-ta')), /leaf 3, asked 2/);
  const c = body('permits', 'd-ta'); c.DataSet.Series.forEach((s) => { s.path.level4 = { value: 1, name: '' }; });
  assert.throws(() => parseResponse(c, req('permits', 'd-ta')), /carries a level 4/);
  const d = body('permits', 'd-ta'); d.DataSet.Series.forEach((s) => { s.path.name_id.value = 274; });
  assert.throws(() => parseResponse(d, req('permits', 'd-ta')), SchemaError);
  const e = body('completions', 'il'); e.DataSet.Series.forEach((s) => { s.path.level2.value = 2; });
  assert.throws(() => parseResponse(e, req('completions', 'il')), /not branch 44,3,3/);
  assert.throws(() => parseResponse({ DataSet: {} }, req('starts', 'il')), /unrecognized shape/);
  const f = body('active', 'il'); original(f, 2).obs[0].TimePeriod = '2026-05';
  assert.throws(() => parseResponse(f, req('active', 'il')), /"2026-05"/);
  const g = body('starts', 'il'); original(g, 3).obs[0].Value = -1;
  assert.throws(() => parseResponse(g, req('starts', 'il')), SchemaError);
});
t('zero vs missing: a published 0 is kept; an unpublished period is absent, never 0; an empty answer is no data', () => {
  const b = body('completions', 'jsr'); const o = original(b, 3).obs;
  o.find((x) => x.TimePeriod === '2026-06').Value = 0; o.find((x) => x.TimePeriod === '2026-05').Value = null;
  const m = Object.fromEntries(parseResponse(b, req('completions', 'jsr')).obs.filter((x) => x.freq === 'M').map((x) => [x.period, x.value]));
  assert.strictEqual(m['2026-06'], 0); assert.ok(!('2026-05' in m)); assert.ok(typeof m['2026-04'] === 'number');
  assert.deepStrictEqual(parseResponse({ DataSet: { Series: [] } }, req('starts', 'il')).obs, []);
});

console.log('ledger — immutable raw observations and revisions');
const ctx0 = { fetchedAt: '2026-10-17T12:00:00Z', snapshot: 'aaaa' };
const obsOf = (measure, geo, edit) => { const b = body(measure, geo); if (edit) edit(b); return parseResponse(b, req(measure, geo)).obs; };
t('first read: every value is revision 0 with the construction fields (path, leaf, name label, source period, kind)', () => {
  const m = L.merge([], obsOf('active', 'd-jm'), ctx0);
  assert.strictEqual(m.added, 12, '10 quarters + 2 annual levels'); assert.strictEqual(m.revised, 0);
  for (const r of m.append) { assert.strictEqual(r.revision, 0); assert.deepStrictEqual([r.pathId, r.nameId, r.geoName, r.kind], ['44,4,3,1,2', 2, 'ירושלים', 'stock']); assert.ok(['Q', 'Y'].includes(r.freq) && r.sourcePeriod && r.snapshot === 'aaaa' && r.sourceUpdate === '2026-09-10' && r.cbs === 1 && r.geo === 'd-jm'); }
  assert.strictEqual(L.keyOf(m.append[0]), `active|1|${m.append[0].freq}|${m.append[0].period}`);
});
t('historical revision: a changed value appends revision 1 and keeps the old one; an unchanged re-read appends nothing', () => {
  const a = L.merge([], obsOf('starts', 'il'), ctx0).append;
  const b = L.merge(a, obsOf('starts', 'il', (x) => { original(x, 3).obs.find((o) => o.TimePeriod === '2026-06').Value = 4800; }), { fetchedAt: '2026-11-20T12:00:00Z', snapshot: 'bbbb' });
  assert.strictEqual(b.revised, 1); assert.strictEqual(b.added, 0); assert.strictEqual(b.unchanged, a.length - 1);
  const rev = b.append[0];
  assert.deepStrictEqual([rev.key, rev.revision, rev.value, rev.replaces], ['starts|8|M|2026-06', 1, 4800, 4720]);
  const all = a.concat(b.append);
  assert.deepStrictEqual(L.historyOf(all, 'starts|8|M|2026-06').map((r) => r.value), [4720, 4800]);
  assert.strictEqual(L.currentOf(all).get('starts|8|M|2026-06').value, 4800);
  assert.strictEqual(all.length, a.length + 1, 'nothing overwritten or deleted');
  assert.strictEqual(L.merge(all, obsOf('starts', 'il', (x) => { original(x, 3).obs.find((o) => o.TimePeriod === '2026-06').Value = 4800; }), ctx0).append.length, 0);
});
t('a period the source stops returning is reported and kept, never deleted or zeroed', () => {
  const a = L.merge([], obsOf('permits', 'il'), ctx0).append;
  const b = L.merge(a, obsOf('permits', 'il', (x) => { original(x, 3).obs = original(x, 3).obs.filter((o) => o.TimePeriod !== '2026-05'); }), { ...ctx0, answered: new Set(['permits|1']) });
  assert.deepStrictEqual(b.missingInSource, ['permits|1|M|2026-05']);
  assert.ok(typeof L.currentOf(a.concat(b.append)).get('permits|1|M|2026-05').value === 'number');
});

console.log('metrics — flows summed on their own period kind, stocks never summed');
const flatM = (from, to, v) => { const o = {}; for (let i = MX.idx(from); i <= MX.idx(to); i++) { const p = `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`; o[p] = typeof v === 'function' ? v(p) : v; } return o; };
const flatQ = (from, to, v) => { const o = {}; for (let i = MX.qIdx(from); i <= MX.qIdx(to); i++) { const p = `${Math.floor(i / 4)}-Q${(i % 4) + 1}`; o[p] = typeof v === 'function' ? v(p) : v; } return o; };
t('monthly flow: T3 / T12, YTD and prior-year YTD, change — with their periods', () => {
  const m = MX.metricsFor('flow', { M: flatM('2024-01', '2026-06', (p) => (p >= '2026-01' ? 120 : 100)), Y: { 2025: 1200 } });
  assert.deepStrictEqual([m.freq, m.kind, m.latest, m.latestValue], ['M', 'flow', '2026-06', 120]);
  assert.deepStrictEqual([m.t3.value, m.t3.from, m.t12.value, m.t12.from, m.t12.to], [360, '2026-04', 1320, '2025-07', '2026-06']);
  assert.deepStrictEqual([m.ytd.value, m.ytd.months, m.prevYtd.value, m.prevYtd.from, m.prevYtd.to], [720, 6, 600, '2025-01', '2025-06']);
  assert.strictEqual(m.change.ytd.pct, 20); assert.strictEqual(m.change.t12.pct, 10);
  assert.strictEqual(m.t12.label.he, 'יולי 2025–יוני 2026'); assert.strictEqual(m.ytd.label.en, 'Jan–Jun 2026');
  assert.deepStrictEqual(m.lastYear, { year: '2025', annual: 1200, sumOfMonths: 1200 });
  assert.ok(!('quarterly' in m) && !('t4' in m));
});
t('quarterly flow: T4, YTD (Q1 → latest) and prior YTD over quarters, labelled as quarters', () => {
  const m = MX.metricsFor('flow', { Q: flatQ('2024-Q1', '2026-Q2', (p) => (p >= '2026-Q1' ? 1100 : 1000)) });
  assert.deepStrictEqual([m.freq, m.latest, m.latestValue], ['Q', '2026-Q2', 1100]);
  assert.deepStrictEqual([m.t4.value, m.t4.from, m.t4.to, m.t4.quarters], [4200, '2025-Q3', '2026-Q2', 4]);
  assert.deepStrictEqual([m.ytd.value, m.ytd.from, m.prevYtd.value, m.prevYtd.from, m.prevYtd.to], [2200, '2026-Q1', 2000, '2025-Q1', '2025-Q2']);
  assert.strictEqual(m.change.ytd.pct, 10); assert.strictEqual(m.change.t4.pct, 5);
  assert.strictEqual(m.t4.label.en, 'Q3 2025–Q2 2026'); assert.strictEqual(m.t4.label.he, 'רבעון 3 2025–רבעון 2 2026'); assert.strictEqual(m.ytd.label.he, 'רבעונים 1–2 2026');
  assert.ok(!('t12' in m) && !('t3' in m), 'no monthly window over quarters');
});
t('a missing period makes every window that needs it unavailable — named, never filled; a monthly series beside a quarterly one', () => {
  const mon = flatM('2024-01', '2026-06', 100); delete mon['2026-02'];
  const m = MX.metricsFor('flow', { M: mon });
  assert.ok(m.t3.ok, 'T3 (Apr–Jun) does not need February');
  assert.ok(!m.t12.ok && m.t12.missing === '2026-02' && /פברואר 2026/.test(m.t12.why.he) && !m.ytd.ok);
  const q = flatQ('2024-Q1', '2026-Q2', 1000); delete q['2025-Q4'];
  const mq = MX.metricsFor('flow', { Q: q });
  assert.ok(!mq.t4.ok && mq.t4.missing === '2025-Q4' && mq.t4.why.en === 'Q4 2025 missing' && mq.ytd.ok);
  const both = MX.metricsFor('flow', { M: flatM('2024-01', '2026-06', 100), Q: flatQ('2024-Q1', '2026-Q2', 300) });
  assert.strictEqual(both.freq, 'M'); assert.strictEqual(both.quarterly.t4.value, 1200);
});
t('a stock (active construction): the latest level vs the previous period and a year earlier — no trailing sum exists', () => {
  const m = MX.metricsFor('stock', { Q: flatQ('2024-Q1', '2026-Q2', (p) => 200000 + MX.qIdx(p) - MX.qIdx('2024-Q1')) });
  assert.deepStrictEqual([m.kind, m.freq, m.latest, m.latestValue], ['stock', 'Q', '2026-Q2', 200009]);
  assert.deepStrictEqual([m.vsPrevious.period, m.vsPrevious.abs, m.vsYearEarlier.period, m.vsYearEarlier.abs], ['2026-Q1', 1, '2025-Q2', 4]);
  for (const k of ['t3', 't4', 't12', 'ytd', 'prevYtd', 'change']) assert.ok(!(k in m), `a stock carries ${k}`);
  assert.match(m.note.en, /never summed/);
  const gap = flatQ('2024-Q1', '2026-Q2', 5); delete gap['2026-Q1'];
  assert.ok(!MX.metricsFor('stock', { Q: gap }).vsPrevious.ok, 'a missing previous quarter is unavailable, not 0');
  assert.deepStrictEqual(MX.metricsFor('flow', {}), { ok: false, why: { he: 'אין תצפיות', en: 'no observations' } });
});

console.log('freshness — quarter-based, on the documented lag assumption');
t('CURRENT shortly after the next quarter ends; EXPECTED REPORTING LAG while its release is due; STALE well after', () => {
  assert.strictEqual(MX.freshness('2026-06', 'M', Date.parse('2026-10-17T12:00:00Z')).state, 'CURRENT');
  assert.strictEqual(MX.freshness('2026-Q2', 'Q', Date.parse('2026-10-17T12:00:00Z')).state, 'CURRENT');
  assert.strictEqual(MX.freshness('2026-06', 'M', Date.parse('2026-11-29T12:00:00Z')).state, 'CURRENT');
  assert.strictEqual(MX.freshness('2026-06', 'M', Date.parse('2026-12-15T12:00:00Z')).state, 'EXPECTED_REPORTING_LAG', 'Q3 is due about 10 weeks after 30.09 — a normal delay, not stale');
  assert.strictEqual(MX.freshness('2026-Q2', 'Q', Date.parse('2027-02-05T12:00:00Z')).state, 'STALE');
  assert.strictEqual(MX.freshness('2025', 'Y', Date.parse('2026-10-17T12:00:00Z')).state, 'STALE');
  const f = MX.freshness('2026-06', 'M', Date.parse('2026-10-17T12:00:00Z'));
  assert.deepStrictEqual([f.latestQuarter, f.nextQuarter, f.nextQuarterEnds, f.nextDueFrom, f.staleAfter], ['2026-Q2', '2026-Q3', '2026-09-30', '2026-11-29', '2027-01-28']);
  assert.ok(f.assumption && /not an official release calendar/.test(f.assumption.en) && f.thresholds.currentDays === 60 && f.thresholds.staleDays === 120);
  assert.strictEqual(MX.freshness(null).state, 'STALE');
});

console.log('the sync, end to end on the fixture — files, states, preservation');
let DIR1 = null, PAY1 = null;
await ta('first run: SUCCESS; ledger, raw bundle (catalogue + data), latest.json, geo-resolution.json and the run log written', async () => {
  DIR1 = tmp();
  const out = await runSync({ dir: DIR1, fetchJson: fetcherOf(), now: NOW });
  assert.strictEqual(out.status, 'SUCCESS'); assert.strictEqual(exitCodeOf(out.status), 0);
  assert.match(out.summary, /^CBS construction: SUCCESS — permits M 2026-06 · starts M 2026-06 · completions M 2026-06 · active Q 2026-Q2 · 64\/64 requests · \+\d+ new · 0 revised$/);
  for (const f of [FILES.ledger, FILES.runs, FILES.latest, FILES.resolution]) assert.ok(fs.existsSync(path.join(DIR1, f)), f);
  const raw = fs.readdirSync(path.join(DIR1, 'raw')); assert.strictEqual(raw.length, 1);
  const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR1, 'raw', raw[0]))));
  assert.strictEqual(bundle.responses.length, 6 + 64, 'the catalogue responses (level-4 pages + branch listings) are evidence too');
  const run = readLines(path.join(DIR1, FILES.runs))[0];
  assert.deepStrictEqual([run.state, run.status, run.requests, run.catalogueRequests, run.dataRequests, run.answered, run.applied, run.failed, run.revised], ['SUCCESS', 'success', 70, 6, 64, 64, 64, 0, 0]);
  assert.deepStrictEqual(run.latest, { permits: { freq: 'M', period: '2026-06' }, starts: { freq: 'M', period: '2026-06' }, completions: { freq: 'M', period: '2026-06' }, active: { freq: 'Q', period: '2026-Q2' } });
  assert.strictEqual(run.resolution.permits.paths['d-ta'], '44,11,2,,275'); assert.deepStrictEqual([run.resolution.level4.ok, run.resolution.level4.pages, run.resolution.starts.byCatalogue, run.resolution.starts.separators], [true, 2, 8, 8]);
  const res = JSON.parse(fs.readFileSync(path.join(DIR1, FILES.resolution), 'utf8'));
  assert.ok(res.measures.starts.listed.length === 16 && res.measures.starts.geos['d-jm'].name === 'ירושלים' && res.measures.starts.geos['d-jm'].nameSource === 'catalogue');
  PAY1 = out.payload;
  const recs = readLines(path.join(DIR1, FILES.ledger));
  assert.strictEqual(recs.length, PAY1.records.observations); assert.ok(recs.every((r) => r.revision === 0 && r.pathId && r.freq));
});
t('the payload: four measures on their own period kinds, eight geographies, OFFICIAL latest + DERIVED metrics, nothing allocated to a city', () => {
  const p = PAY1;
  assert.strictEqual(p.schema, 1); assert.strictEqual(p.source.id, 'cbs:construction'); assert.strictEqual(p.sourceUpdate, '2026-09-10');
  assert.deepStrictEqual(Object.keys(p.measures), S.MEASURE_IDS);
  assert.deepStrictEqual(S.MEASURE_IDS.map((m) => [p.measures[m].state, p.measures[m].freq, p.measures[m].kind]), [['OK', 'M', 'flow'], ['OK', 'M', 'flow'], ['OK', 'M', 'flow'], ['OK', 'Q', 'stock']]);
  for (const m of S.MEASURE_IDS) {
    const keys = Object.keys(p.measures[m].geos);
    assert.deepStrictEqual(keys, S.GEOS.map((g) => g.key), m + ': the keys are the 8 geographies and nothing else');
    for (const k of keys) { const g = p.measures[m].geos[k]; assert.ok(g.level === 'national' || g.level === 'district'); assert.ok(g.latest && typeof g.latest.value === 'number' && g.latest.label.he && g.cbs === S.MEASURES[m].codes[k]); }
  }
  assert.ok(!/locality|"city"|yishuv/i.test(JSON.stringify(p.measures)), 'a locality key appeared in the construction payload');
  const il = p.measures.starts.geos.il;
  assert.deepStrictEqual([il.latest.period, il.freq, il.metrics.t12.ok, il.metrics.quarterly.freq, il.series.M.length, il.series.Q.length], ['2026-06', 'M', true, 'Q', 30, 10]);
  assert.deepStrictEqual(Object.keys(il.series.Y), ['2024', '2025']);
  assert.strictEqual(il.metrics.lastYear.annual, il.metrics.lastYear.sumOfMonths, 'the fixture\'s annual figure equals its months');
  const act = p.measures.active.geos.il;
  assert.ok(act.metrics.kind === 'stock' && act.metrics.vsPrevious.ok && !('t4' in act.metrics) && act.series.M.length === 0 && act.freq === 'Q');
  assert.deepStrictEqual(Object.keys(act.series.Y), ['2024', '2025'], 'the annual level beside the quarters');
  assert.ok(p.measures.permits.geos.il.metrics.quarterly && p.measures.permits.geos.il.metrics.quarterly.t4.ok, 'permits: CBS\'s own quarterly series (9538xx) beside the months');
  assert.deepStrictEqual(p.freshness.state, 'CURRENT'); assert.deepStrictEqual(Object.keys(p.freshness.byMeasure), S.MEASURE_IDS); assert.ok(p.freshness.assumption);
  assert.strictEqual(p.missing.length, 0); assert.match(p.notes.geography.en, /never allocated to a locality/); assert.match(p.notes.universes.en, /never summed/);
  const js = toJs({ ...p, x: '</script>' });
  assert.ok(!js.includes('</script>') && js.startsWith('/* generated') && /window\.PROPX_CBS_CONSTRUCTION=/.test(js));
});
t('reconciliation: national vs the sum of 7 districts, per period; the residual is reported, never forced; a stock only at the latest period', () => {
  const r = PAY1.measures.permits.reconciliation;
  assert.strictEqual(r.rows.length, 12); assert.strictEqual(r.freq, 'M');
  assert.ok(r.window && r.window.residual === r.window.national - r.window.districtSum && r.window.residual === 144, 'the fixture\'s +12 a month residual stays as published');
  assert.ok(r.rows.every((x) => x.residual === 12));
  assert.strictEqual(PAY1.measures.starts.reconciliation.window.residual, 0);
  const a = PAY1.measures.active.reconciliation;
  assert.strictEqual(a.rows.length, 4); assert.strictEqual(a.kind, 'stock'); assert.strictEqual(a.window.period, '2026-Q2'); assert.match(a.window.basis, /not summed/); assert.ok(!('from' in a.window));
  assert.match(r.note.en, /never forced/);
});
await ta('second run with nothing new: UNCHANGED, nothing appended, no second raw bundle', async () => {
  const before = readLines(path.join(DIR1, FILES.ledger)).length;
  const out = await runSync({ dir: DIR1, fetchJson: fetcherOf(), now: new Date('2026-10-18T12:00:00Z') });
  assert.strictEqual(out.status, 'UNCHANGED');
  assert.strictEqual(readLines(path.join(DIR1, FILES.ledger)).length, before);
  assert.strictEqual(fs.readdirSync(path.join(DIR1, 'raw')).length, 1);
  assert.strictEqual(readLines(path.join(DIR1, FILES.runs)).length, 2);
});
await ta('a revised value: SUCCESS, revision 1 appended with the old value kept; the payload shows the latest', async () => {
  const mutate = (id, b) => { if (id === '44,2,3,8,2') { const s = original(b, 3); const o = s.obs.find((x) => x.TimePeriod === '2026-06'); if (o) o.Value = 4800; } };
  const out = await runSync({ dir: DIR1, fetchJson: fetcherOf({ mutate }), now: new Date('2026-11-20T12:00:00Z') });
  assert.strictEqual(out.status, 'SUCCESS'); assert.strictEqual(out.runEntry.revised, 1); assert.strictEqual(out.runEntry.added, 0);
  const hist = L.historyOf(readLines(path.join(DIR1, FILES.ledger)), 'starts|8|M|2026-06');
  assert.deepStrictEqual(hist.map((r) => [r.revision, r.value, r.replaces ?? null]), [[0, 4720, null], [1, 4800, 4720]]);
  assert.strictEqual(out.payload.measures.starts.geos.il.latest.value, 4800); assert.strictEqual(out.payload.records.revisions, 1);
  assert.strictEqual(fs.readdirSync(path.join(DIR1, 'raw')).length, 2, 'a changed response is a new bundle');
});
await ta('a failed district request: PARTIAL — its last payload kept, marked stale with the error; everything else read; exit 2', async () => {
  const out = await runSync({ dir: DIR1, fetchJson: fetcherOf({ fail: { '44,2,3,5,2': 503 } }), now: new Date('2026-11-21T12:00:00Z') });
  assert.strictEqual(out.status, 'PARTIAL'); assert.strictEqual(exitCodeOf(out.status), 2);
  const g = out.payload.measures.starts.geos['d-ta'];
  assert.ok(g.stale && /HTTP 503/.test(g.lastError) && g.latest && g.latest.value > 0 && g.metrics.t12.ok, 'last data kept, marked');
  assert.ok(!out.payload.measures.starts.geos['d-center'].stale && !out.payload.measures.permits.geos['d-ta'].stale);
  assert.match(readLines(path.join(DIR1, FILES.runs)).pop().error, /starts\|d-ta: HTTP 503/);
  assert.ok(out.payload.measures.starts.reconciliation.rows.length === 12, 'the reconciliation is recomputed from the stored series');
});
await ta('a measure whose catalogue cannot be read on the first sync is MISSING with the reason — never 0; the others are read', async () => {
  const dir = tmp();
  const out = await runSync({ dir, fetchJson: fetcherOf({ fail: { '44,3,3': 500 } }), now: NOW });
  assert.strictEqual(out.status, 'PARTIAL');
  const c = out.payload.measures.completions;
  assert.strictEqual(c.state, 'MISSING'); assert.strictEqual(c.reason.kind, 'catalogue'); assert.match(c.reason.en, /HTTP 500/);
  assert.deepStrictEqual(c.geos, {}); assert.strictEqual(c.reconciliation, null); assert.strictEqual(c.freshness, null);
  assert.ok(!JSON.stringify(c).includes('"value":0'), 'a missing measure printed a 0');
  assert.strictEqual(out.payload.missing.filter((m) => m.measure === 'completions').length, 8);
  assert.strictEqual(out.payload.freshness.byMeasure.completions.state, 'MISSING'); assert.strictEqual(out.payload.freshness.state, 'CURRENT');
  assert.ok(out.payload.measures.starts.state === 'OK' && out.payload.measures.active.state === 'OK');
  /* a mismatched code on a first sync: the geography is listed missing with the mismatch reason, nothing re-keyed */
  const dir2 = tmp();
  const swap = (id, b) => { if (id === '44,11,2') { const a = b.catalogs.catalog.find((n) => n.path[4] === 271), c = b.catalogs.catalog.find((n) => n.path[4] === 272); [a.name, c.name] = [c.name, a.name]; } };
  const o2 = await runSync({ dir: dir2, fetchJson: fetcherOf({ mutate: swap }), now: NOW });
  assert.strictEqual(o2.status, 'PARTIAL');
  const miss = o2.payload.missing.find((m) => m.measure === 'permits' && m.geo === 'd-jm');
  assert.ok(miss && miss.reason.kind === 'mismatch' && /differs from the expected 271/.test(miss.reason.en));
  assert.ok(!('d-jm' in o2.payload.measures.permits.geos) && 'd-haifa' in o2.payload.measures.permits.geos);
  assert.deepStrictEqual(o2.runEntry.resolution.permits.mismatch.length, 2);
});
await ta('the level-4 listing unavailable: every by-district geography is named by its data response (resolved by response) and applied; one the response names otherwise is a MISMATCH, never applied; one never named stays pending, listed missing', async () => {
  const dir = tmp();
  const out = await runSync({ dir, fetchJson: fetcherOf({ fail: { 'level:4:44:1': 503 } }), now: NOW });
  assert.strictEqual(out.status, 'SUCCESS', 'every geography was verified by a name — from the responses');
  const st = out.runEntry.resolution.starts;
  assert.deepStrictEqual([st.resolved, st.byCatalogue, st.byResponse, st.pending], [8, 0, 8, []]); assert.ok(!out.runEntry.resolution.level4.ok);
  assert.strictEqual(out.payload.measures.starts.geos['d-jm'].sourceName, 'ירושלים'); assert.strictEqual(out.payload.missing.length, 0);
  const res = JSON.parse(fs.readFileSync(path.join(dir, FILES.resolution), 'utf8'));
  assert.strictEqual(res.measures.active.geos['d-ta'].nameSource, 'response');
  /* a response that names code 5 "המרכז": the geography is a mismatch — nothing of it applied, even from the window that was fine */
  const dir2 = tmp();
  const wrong = (id, b, u) => { if (id === '44,2,3,5,2' && /startperiod=01-2022/.test(u.href)) for (const s of b.DataSet.Series) s.path.level4.name = 'המרכז'; };
  const o2 = await runSync({ dir: dir2, fetchJson: fetcherOf({ mutate: wrong }), now: NOW });
  assert.strictEqual(o2.status, 'PARTIAL');
  const x = o2.resolution.measures.starts.geos['d-ta'];
  assert.deepStrictEqual([x.status, x.nameSource], ['mismatch', 'response']); assert.match(x.reason, /is named "המרכז", not Tel Aviv District/);
  assert.ok(!('d-ta' in o2.payload.measures.starts.geos), 'nothing applied for the mismatched geography');
  const miss = o2.payload.missing.find((m) => m.measure === 'starts' && m.geo === 'd-ta'); assert.ok(miss && miss.reason.kind === 'mismatch');
  assert.ok(!readLines(path.join(dir2, FILES.ledger)).some((r) => r.measure === 'starts' && r.geo === 'd-ta'), 'not in the ledger either');
  assert.ok(o2.payload.measures.starts.geos['d-center'].latest.value > 0, 'the district the name belongs to is untouched');
  assert.match(readLines(path.join(dir2, FILES.runs)).pop().error, /starts\|d-ta: geography name mismatch/);
  /* never named: the level listing is down and the response carries no series for the geography */
  const dir3 = tmp();
  const o3 = await runSync({ dir: dir3, fetchJson: fetcherOf({ fail: { 'level:4:44:1': 503 }, mutate: (id, b) => { if (id === '44,4,3,3,2') b.DataSet.Series = []; } }), now: NOW });
  assert.strictEqual(o3.status, 'PARTIAL');
  const p = o3.resolution.measures.active.geos['d-haifa'];
  assert.strictEqual(p.status, 'pending'); assert.match(p.reason, /never named this geography/);
  const m3 = o3.payload.missing.find((m) => m.measure === 'active' && m.geo === 'd-haifa'); assert.ok(m3 && m3.reason.kind === 'pending');
  assert.deepStrictEqual(o3.runEntry.resolution.active.pending, ['d-haifa']);
});
await ta('REFUSED / SCHEMA_CHANGED / FAILED when nothing is read: only the run log is written, the last valid data untouched', async () => {
  const dir = tmp();
  const refused = await runSync({ dir, fetchJson: fetcherOf({ fail: Object.fromEntries(Object.keys(FX.catalogue).map((id) => [id, 403])) }), now: NOW });
  assert.strictEqual(refused.status, 'REFUSED'); assert.strictEqual(exitCodeOf(refused.status), 1);
  assert.deepStrictEqual(fs.readdirSync(dir), [FILES.runs]);
  const schema = await runSync({ dir, fetchJson: fetcherOf({ mutate: () => ({ catalogs: { level: 4 } }) }), now: NOW });
  assert.strictEqual(schema.status, 'SCHEMA_CHANGED'); assert.match(schema.runEntry.error, /unrecognized shape/);
  const failed = await runSync({ dir, fetchJson: fetcherOf({ fail: Object.fromEntries(Object.keys(FX.catalogue).map((id) => [id, 500])) }), now: NOW });
  assert.strictEqual(failed.status, 'FAILED');
  assert.deepStrictEqual(fs.readdirSync(dir), [FILES.runs]); assert.strictEqual(readLines(path.join(dir, FILES.runs)).length, 3);
  /* with data already stored: the same refusal leaves latest.json byte for byte */
  const before = fs.readFileSync(path.join(DIR1, FILES.latest), 'utf8');
  const again = await runSync({ dir: DIR1, fetchJson: fetcherOf({ fail: Object.fromEntries(Object.keys(FX.catalogue).map((id) => [id, 429])) }), now: new Date('2026-11-22T12:00:00Z') });
  assert.strictEqual(again.status, 'REFUSED'); assert.strictEqual(fs.readFileSync(path.join(DIR1, FILES.latest), 'utf8'), before);
  /* the Trust Center reads these states from the log */
  const TC = require('../lib/trust/catalog');
  const runs = readLines(path.join(dir, FILES.runs));
  assert.deepStrictEqual(runs.map((r) => TC.stateOfRun(r)), ['REFUSED', 'SCHEMA_CHANGED', 'FAILED']);
  const dry = tmp();
  const d = await runSync({ dir: dry, fetchJson: fetcherOf(), now: NOW, dryRun: true });
  assert.strictEqual(d.status, 'SUCCESS'); assert.deepStrictEqual(fs.readdirSync(dry), [], 'a dry run writes nothing');
});

console.log('snapshot — preservation without a resolution');
t('buildPayload keeps a previous payload\'s geography when the ledger has nothing for it, marked stale; a first build with nothing is MISSING for every measure', () => {
  const empty = buildPayload([], { at: '2026-10-17T12:00:00Z', status: 'FAILED' }, null, null);
  assert.ok(S.MEASURE_IDS.every((m) => empty.measures[m].state === 'MISSING' && empty.measures[m].reason.kind === 'no-run'));
  assert.strictEqual(empty.freshness.state, 'MISSING'); assert.strictEqual(empty.missing.length, 32);
  assert.ok(!JSON.stringify(empty.measures).includes('"value":0'));
  const recs = L.merge([], obsOf('starts', 'il'), ctx0).append;
  const p = buildPayload(recs, { at: '2026-10-18T12:00:00Z', status: 'PARTIAL', failed: new Set(['starts|d-ta']), errors: { 'starts|d-ta': 'HTTP 503' } }, PAY1, null);
  assert.ok(p.measures.starts.geos['d-ta'].stale && p.measures.starts.geos['d-ta'].lastError === 'HTTP 503');
  assert.deepStrictEqual(p.measures.starts.geos['d-ta'].series, PAY1.measures.starts.geos['d-ta'].series);
  assert.ok(p.measures.active.state === 'OK' && p.measures.active.stale !== true && p.measures.active.geos.il.stale === true, 'a whole previous measure is carried, its geographies marked');
});

console.log('workflow, README, CLAUDE.md');
t('the workflow runs on working days and on dispatch, runs the sync and both test files, rebuilds the radar, commits only data/construction + data/radar', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'construction-sync.yml'), 'utf8');
  assert.match(y, /cron: '\d+ \d+ \* \* 0-4'/); assert.match(y, /workflow_dispatch:/); assert.match(y, /options: \[sync, dry-run\]/);
  assert.match(y, /node scripts\/construction-sync\.js --summary-file/); assert.match(y, /node scripts\/construction-sync\.js --dry-run/);
  assert.match(y, /node test\/construction\.test\.js/); assert.match(y, /node test\/integrity\.test\.js/);
  const adds = [...y.matchAll(/git add (\S+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(adds, ['data/construction', 'data/radar']); assert.match(y, /node scripts\/radar-build\.js --quiet/);
  assert.match(y, /git commit -q -F "\$RUNNER_TEMP\/summary\.txt"/);
  assert.ok(/radar-build/.test(y), 'the radar rules cbs-construction-published / -revised exist since 18.10.2026 (lib/radar/events.js) — the workflow rebuilds the radar before committing');
});
t('the CLI exists with the lane\'s User-Agent and no credential; the README states the semantics, the lag assumption and the hook', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'scripts', 'construction-sync.js'), 'utf8');
  assert.match(cli, /require\('\.\.\/lib\/construction\/sync'\)/); assert.ok(!/SUPABASE|PASSWORD|SECRET/.test(cli));
  assert.strictEqual(S.UA, 'PROPX-cbs-construction-sync/1.0 (+https://propx.live)');
  const md = fs.readFileSync(path.join(ROOT, 'lib', 'construction', 'README.md'), 'utf8');
  for (const s of ['dwellings whose construction began', 'dwellings whose construction was completed', 'under construction at the END of the period', 'no locality (city) series', 'never allocated to a city', 'ASSUMPTION', '60 days', '120 days', 'data/construction/latest.json', 'never summed']) assert.ok(md.includes(s), 'README lacks: ' + s);
  const cl = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.ok(cl.includes('`lib/construction/`') && cl.includes('construction-sync.yml') && cl.includes('cbs:construction'));
});

console.log('Trust Center');
t('cbs:construction is listed — NO_RUN until the first sync, then the run state, latest observation, update date, freshness, coverage, limitations', () => {
  const TC = require('../lib/trust/catalog');
  const dir = tmp();
  const c0 = TC.catalog({ dataDir: dir, now: Date.parse('2026-10-17T13:00:00Z') });
  const x0 = c0.sources.find((s) => s.id === 'cbs:construction');
  assert.ok(x0 && x0.inProduct !== false && x0.channel === 'official');
  assert.strictEqual(x0.sync.state, 'NO_RUN'); assert.match(x0.sync.note, /NO_RUN until the first/); assert.strictEqual(x0.latestObservation, null); assert.strictEqual(x0.coverage, null);
  assert.strictEqual(x0.publisherEn, 'Central Bureau of Statistics'); assert.match(x0.name, /building permits, construction starts, completions and active construction/);
  assert.ok(/quarterly release/.test(x0.cadence) && /working day/.test(x0.cadence));
  assert.ok(x0.limitations.some((l) => /never shown or allocated as a city/.test(l)) && x0.limitations.some((l) => /four universes, never summed/.test(l)) && x0.limitations.some((l) => /lag assumption/.test(l)));
  assert.strictEqual(x0.discovery.integrates, 'discovery:cbs:series:construction-by-district');
  assert.ok(c0.sources.find((s) => s.id === 'discovery:cbs:series:construction-by-district'), 'the audited candidate stays listed');
  assert.ok(c0.sources.find((s) => s.id === 'cbs:new-home-sales'), 'the sales entry is unchanged');
  /* after the first sync */
  fs.mkdirSync(path.join(dir, 'construction'));
  fs.copyFileSync(path.join(DIR1, FILES.latest), path.join(dir, 'construction', FILES.latest));
  fs.writeFileSync(path.join(dir, 'construction', FILES.runs), JSON.stringify({ id: 'construction:a', startedAt: '2026-10-17T12:00:00Z', finishedAt: '2026-10-17T12:01:00Z', status: 'success', contentChanged: true }) + '\n');
  const x = TC.catalog({ dataDir: dir, now: Date.parse('2026-10-17T13:00:00Z') }).sources.find((s) => s.id === 'cbs:construction');
  assert.strictEqual(x.sync.state, 'SUCCESS'); assert.strictEqual(x.sync.lastCheckAt, '2026-10-17T12:01:00Z');
  assert.strictEqual(x.latestObservation, '2026-06'); assert.strictEqual(x.sourceUpdatedAt, '2026-09-10');
  assert.deepStrictEqual(x.coverage, { geographies: 8, measures: 4, cities: 0 });
  assert.strictEqual(x.freshness.state, 'CURRENT'); assert.match(x.history, /4\/4 measures · 8 geographies/);
  fs.appendFileSync(path.join(dir, 'construction', FILES.runs), JSON.stringify({ id: 'construction:b', startedAt: '2026-10-18T12:00:00Z', finishedAt: '2026-10-18T12:00:20Z', status: 'refused', error: 'HTTP 403 from https://apis.cbs.gov.il/…' }) + '\n');
  const f = TC.catalog({ dataDir: dir, now: Date.parse('2026-10-18T13:00:00Z') }).sources.find((s) => s.id === 'cbs:construction');
  assert.strictEqual(f.sync.runState, 'REFUSED'); assert.strictEqual(f.latestObservation, '2026-06', 'the last valid data stays');
  const st = TC.catalog({ dataDir: dir, now: Date.parse('2026-10-25T13:00:00Z') }).sources.find((s) => s.id === 'cbs:construction');
  assert.strictEqual(st.sync.state, 'STALE');
});

console.log('stored data (data/construction — written by the sync on the runner)');
t('the stored payload, when present, is valid and derived from the stored ledger', () => {
  const dir = path.join(ROOT, 'data', 'construction');
  if (!fs.existsSync(path.join(dir, FILES.latest))) { console.log('    (no stored data yet)'); return; }
  const p = JSON.parse(fs.readFileSync(path.join(dir, FILES.latest), 'utf8'));
  const recs = readLines(path.join(dir, FILES.ledger));
  assert.strictEqual(p.schema, 1); assert.strictEqual(p.source.id, 'cbs:construction');
  assert.ok(recs.length >= p.records.current && p.records.observations === recs.length);
  const cur = L.currentOf(recs);
  for (const m of S.MEASURE_IDS) {
    const M = p.measures[m]; if (M.state !== 'OK') { assert.ok(M.reason && M.reason.en, m + ' MISSING without a reason'); continue; }
    for (const [k, g] of Object.entries(M.geos)) {
      assert.ok(S.GEO_BY_KEY[k], `${m}: unknown geography ${k}`);
      if (g.stale) continue;
      for (const f of ['M', 'Q']) for (const [per, v] of g.series[f]) assert.strictEqual(cur.get(`${m}|${g.cbs}|${f}|${per}`).value, v, `${m} ${k} ${f} ${per} differs from the ledger`);
    }
  }
  assert.ok(!/locality|"city"/i.test(JSON.stringify(p.measures)));
  const runs = readLines(path.join(dir, FILES.runs));
  assert.ok(runs.length && runs.every((r) => ['SUCCESS', 'UNCHANGED', 'PARTIAL', 'FAILED', 'REFUSED', 'SCHEMA_CHANGED'].includes(r.state)));
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
