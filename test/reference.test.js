// PROPX · official reference datasets (lib/reference) — offline gates: a complete read or an error, the schema guard, official codes
// only (never a name), content-addressed history, the missing reasons, the workflow's scope. Run: node test/reference.test.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const REF = require('../lib/reference');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const pending = [];
const t = (name, fn) => pending.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'propx-ref-'));

/* a CKAN stub: resource_show + datastore_search over `rows` (paged by `limit` / `offset`); `total` may lie to simulate a short read */
function ckanStub(rows, { total = rows.length, fields = null, lastModified = '2026-10-19T08:00:00', fail = null } = {}) {
  const calls = [];
  const fn = async (url) => {
    const u = new URL(url); calls.push(u.pathname.split('/').pop() + '?' + u.searchParams.toString());
    const body = (o) => ({ status: 200, text: async () => JSON.stringify(o) });
    if (fail === 'html') return { status: 403, text: async () => '<html>blocked</html>' };
    if (u.pathname.endsWith('resource_show')) return body({ success: true, result: { id: u.searchParams.get('id'), last_modified: lastModified } });
    const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
    if (fail === 'error') return body({ success: false, error: { message: 'Not found' } });
    const f = fields || Object.keys(rows[0] || {}).map((id) => ({ id }));
    return body({ success: true, result: { total, fields: [{ id: '_id' }, ...f.map((x) => (typeof x === 'string' ? { id: x } : x))], records: rows.slice(off, off + lim) } });
  };
  fn.calls = calls;
  return fn;
}
const census = (n) => {
  const rows = [{ _id: 1, LocNameHeb: 'כלל ארצי', LocalityCode: null, StatArea: null, pop_approx: 9601720, hh_total_approx: 3053450, own_pcnt: 59.3, rent_pcnt: 31.6, employeesAnnual_medWage: 104300 }];
  for (let i = 0; i < n; i++) rows.push({ _id: rows.length + 1, LocNameHeb: 'יישוב ' + i, LocalityCode: String(100 + i), StatArea: null, pop_approx: 1000 + i, hh_total_approx: 300, own_pcnt: 60, rent_pcnt: 30, employeesAnnual_medWage: 90000 },
    { _id: rows.length + 2, LocNameHeb: 'יישוב ' + i, LocalityCode: String(100 + i), StatArea: '1', pop_approx: 500, hh_total_approx: 150, own_pcnt: 61, rent_pcnt: 29 });
  rows.push({ _id: rows.length + 1, LocNameHeb: 'ללא סמל', LocalityCode: null, StatArea: null, pop_approx: 12 });   // no official code, not the national row
  return rows;
};
const residents = () => [
  { _id: 1, 'סמל_ישוב': '0', 'שם_ישוב': 'לא רשום', 'סהכ': 5000 },
  { _id: 2, 'סמל_ישוב': '100', 'שם_ישוב': 'יישוב 0 ', 'נפה': 'אשקלון', 'מועצה_אזורית': '', 'סהכ': '1,234', 'גיל_0_5': 100, 'גיל_6_18': 200, 'גיל_19_45': 400, 'גיל_46_55': 200, 'גיל_56_64': 134, 'גיל_65_פלוס': 200 },
  { _id: 3, 'סמל_ישוב': '101', 'שם_ישוב': 'יישוב 1', 'סהכ': 900 },
];

t('a read is COMPLETE or an error: every page in a stable order; a short read, a non-JSON answer or success:false fails the run', async () => {
  const rows = census(1600);   // 3,202 rows → 4 pages of 1,000
  const f = ckanStub(rows);
  const r = await REF.fetchAll(REF.SOURCES['census-2022'], { fetchImpl: f });
  assert.equal(r.rows.length, rows.length); assert.equal(r.total, rows.length);
  assert.equal(f.calls.filter((c) => c.startsWith('datastore_search')).length, 4);
  assert.ok(f.calls.every((c) => !c.startsWith('datastore_search') || /sort=_id\+asc/.test(c)), 'a stable order');
  assert.equal(r.sourceUpdatedAt, '2026-10-19T08:00:00Z', 'the source update time, as UTC');
  await assert.rejects(REF.fetchAll(REF.SOURCES['census-2022'], { fetchImpl: ckanStub(rows, { total: rows.length + 5 }) }), /incomplete read/);
  await assert.rejects(REF.fetchAll(REF.SOURCES.residents, { fetchImpl: ckanStub(residents(), { fail: 'html' }) }), /not JSON/);
  await assert.rejects(REF.fetchAll(REF.SOURCES.residents, { fetchImpl: ckanStub(residents(), { fail: 'error' }) }), /Not found/);
});

t('the SCHEMA guard: a resource that lost a required field fails — never a silent null column', async () => {
  const rows = residents().map(({ ['סהכ']: _, ...r }) => r);
  await assert.rejects(REF.fetchAll(REF.SOURCES.residents, { fetchImpl: ckanStub(rows) }), /schema changed — missing field\(s\): סהכ/);
});

t('OFFICIAL CODES only: national / locality / statistical-area keys from the CBS code; a row without a code is rejected (counted), never placed by its name', async () => {
  const dir = tmp();
  const read = await REF.fetchAll(REF.SOURCES['census-2022'], { fetchImpl: ckanStub(census(2)) });
  const { meta, changed, rejected } = REF.write(REF.SOURCES['census-2022'], read, { now: '2026-10-21T10:00:00.000Z', dir });
  assert.equal(changed, true); assert.equal(rejected.length, 1, 'the codeless row');
  assert.deepEqual(meta.byLevel, { national: 1, locality: 2, statArea: 2 });
  const T = REF.table('census-2022', dir);
  assert.equal(T.byKey.get('il').population, 9601720); assert.equal(T.byKey.get('loc:100').population, 1000); assert.equal(T.byKey.get('sa:100:1').statArea, 1);
  assert.ok(![...T.byKey.keys()].some((k) => /[א-ת]/.test(k)), 'no key is a name');
  const rr = await REF.fetchAll(REF.SOURCES.residents, { fetchImpl: ckanStub(residents()) });
  const w = REF.write(REF.SOURCES.residents, rr, { now: '2026-10-21T10:00:00.000Z', dir });
  assert.equal(w.rejected.length, 1, '"לא רשום" (code 0) is no locality');
  const R = REF.table('residents', dir).byKey.get('loc:100');
  assert.equal(R.residents, 1234, 'a thousands separator is read'); assert.equal(R.name, 'יישוב 0'); assert.equal(R.regionalCouncil, null, 'an empty field is null, never ""'); assert.equal(R.age['65+'], 200);
});

t('HISTORY: content-addressed — an unchanged read writes no new copy and keeps the read time; a changed one adds a dated copy; duplicate keys fail', async () => {
  const dir = tmp(), src = REF.SOURCES.residents;
  const a = await REF.fetchAll(src, { fetchImpl: ckanStub(residents()) });
  const w1 = REF.write(src, a, { now: '2026-10-19T04:00:00.000Z', dir });
  const w2 = REF.write(src, a, { now: '2026-10-26T04:00:00.000Z', dir });
  assert.equal(w2.changed, false); assert.equal(w2.meta.readAt, '2026-10-19T04:00:00.000Z', 'read time = the last content change'); assert.equal(w2.meta.checkedAt, '2026-10-26T04:00:00.000Z');
  assert.equal(w2.meta.history.length, 1);
  const b = await REF.fetchAll(src, { fetchImpl: ckanStub(residents().map((r) => (r['סמל_ישוב'] === '101' ? { ...r, 'סהכ': 950 } : r))) });
  const w3 = REF.write(src, b, { now: '2026-11-02T04:00:00.000Z', dir });
  assert.equal(w3.changed, true); assert.equal(w3.meta.history.length, 2); assert.ok(w3.meta.history[1].startsWith('2026-11-02-'));
  assert.notEqual(w1.meta.contentHash, w3.meta.contentHash);
  const dup = await REF.fetchAll(src, { fetchImpl: ckanStub([...residents(), { _id: 4, 'סמל_ישוב': '101', 'שם_ישוב': 'כפול', 'סהכ': 1 }]) });
  assert.throws(() => REF.write(src, dup, { dir }), /duplicate keys: 1/);
  REF.logRun('residents', { id: 'x', status: 'failed', error: 'test' }, dir);
  assert.equal(fs.readFileSync(path.join(dir, 'residents', 'runs.jsonl'), 'utf8').trim().split('\n').length, 1);
});

t('the READ MODEL: a locality gets its census figures (+ how many statistical areas, never placed on a street) and its registered residents — or the reason each is missing', async () => {
  const empty = tmp();
  const none = REF.locality(100, empty);
  assert.equal(none.census, null); assert.equal(none.censusMissing, 'reference-not-synced'); assert.equal(none.residentsMissing, 'reference-not-synced');
  const dir = tmp();
  REF.write(REF.SOURCES['census-2022'], await REF.fetchAll(REF.SOURCES['census-2022'], { fetchImpl: ckanStub(census(2)) }), { dir });
  REF.write(REF.SOURCES.residents, await REF.fetchAll(REF.SOURCES.residents, { fetchImpl: ckanStub(residents()) }), { dir });
  const L = REF.locality(100, dir);
  assert.equal(L.census.population, 1000); assert.equal(L.census.statAreas, 1); assert.equal(L.census.source.classification, 'OFFICIAL'); assert.equal(L.census.source.period, 'census 2022');
  assert.equal(L.residents.residents, 1234); assert.equal(L.residents.source.publisherEn, 'Population and Immigration Authority');
  assert.equal(L.national.population, 9601720);
  assert.match(L.note, /never current/); assert.match(L.note, /two universes, never mixed/); assert.match(L.note, /never one street/);
  const M = REF.locality(999, dir);
  assert.equal(M.censusMissing, 'locality-not-in-census-table'); assert.equal(M.residentsMissing, 'locality-not-in-register-table');
  assert.deepEqual(REF.status(dir).map((s) => s.id), ['census-2022', 'residents']);
});

t('the WORKFLOW reads GET-only, tests before it writes and commits only data/reference; the sources are official data.gov.il resources', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/reference-sync.yml'), 'utf8');
  assert.ok(wf.indexOf('node test/reference.test.js') < wf.indexOf('node scripts/reference-sync.js'));
  assert.match(wf, /git add data\/reference\n/); assert.ok(!/git add (?!data\/reference)/.test(wf), 'nothing else is committed');
  const lib = fs.readFileSync(path.join(ROOT, 'lib/reference/index.js'), 'utf8');
  assert.ok(!/method:\s*['"](POST|PUT|DELETE)/.test(lib), 'GET only');
  for (const s of Object.values(REF.SOURCES)) { assert.match(s.resourceId, /^[0-9a-f-]{36}$/); assert.equal(s.classification, 'OFFICIAL'); assert.ok(s.trustId.startsWith('datagov:')); }
});

t('WIRING: the dossier shows a locality its OWN census + register rows (two universes apart), Israel the census national row, a district nothing summed; the API, page, registry and deployed bundle read them', () => {
  const DQ = require('../lib/dossier/query');
  const synced = REF.readMeta('census-2022') && REF.readMeta('residents');
  const L = DQ.dossier({ level: 'locality', code: '7900' }).sections.context;
  if (synced) {
    assert.equal(L.census.locality, 7900); assert.equal(L.residents.locality, 7900); assert.match(L.scope.en, /never a street/);
    assert.notEqual(L.census.population, L.residents.residents, 'census population and registered residents are different universes, both shown');
    const I = DQ.dossier({ level: 'il' }).sections.context; assert.equal(I.census.level, 'national'); assert.equal(I.residents, null, 'no national sum of the register');
  }
  const ix = DQ.index(); const dcode = ix.districts[0].code; const Dd = DQ.dossier({ level: 'district', code: dcode });
  assert.equal(Dd.sections.context, undefined, 'a district is never summed from its localities');
  const api = fs.readFileSync(path.join(ROOT, 'api/intel.js'), 'utf8'); assert.match(api, /view === 'localityContext'/);
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); assert.match(page, /function dsContextHTML\(D\)/); assert.match(page, /\$\{dsContextHTML\(D\)\}/);
  for (const x of ['census_2022_locality', 'registered_residents']) { assert.ok(page.includes(`"${x}"`)); assert.ok(require('../lib/explain/registry').term(x)); }
  const vc = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')); assert.ok(['census-2022', 'residents'].every((id) => ['meta.json', 'rows.json.gz'].every((f) => require('./helpers/vercel-include').matches(vc.functions['api/intel.js'].includeFiles, `data/reference/${id}/${f}`))));
  const C = require('../lib/trust/catalog').catalog(); for (const id of ['datagov:cbs:census-2022', 'datagov:piba:residents-by-locality']) assert.ok(C.sources.some((s) => s.id === id), id);
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
  }
  console.log(`reference: ${passed} passed${failed ? ', ' + failed + ' FAILED' : ''}`);
  process.exit(failed ? 1 : 0);
})();
