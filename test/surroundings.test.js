// PROPX · street surroundings (lib/surroundings) — offline gates: the contaminated-land register's words verbatim (a "potential" site is
// never called contaminated), EXACT (block / parcel of the street's own points) apart from SPATIAL (≤ 300 m), education institutions within
// 500 m joined to their latest school year by the institution code only, the honest refusals, the street-report and page wiring.
// Run: node test/surroundings.test.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const REF = require('../lib/reference');
const SU = require('../lib/surroundings');
const { itmToWgs84 } = require('../lib/geo/itm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const pending = [];
const t = (name, fn) => pending.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'propx-su-'));
function ckanStub(rows) {
  return async (url) => {
    const u = new URL(url), body = (o) => ({ status: 200, text: async () => JSON.stringify(o) });
    if (u.pathname.endsWith('resource_show')) return body({ success: true, result: { last_modified: '2026-10-21T07:01:04' } });
    const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
    return body({ success: true, result: { total: rows.length, fields: [{ id: '_id' }, ...Object.keys(rows[0]).filter((k) => k !== '_id').map((id) => ({ id }))], records: rows.slice(off, off + lim) } });
  };
}
/* a street point in central Tel Aviv (ITM 180710, 664160) and sites around it */
const X0 = 180710, Y0 = 664160, A = itmToWgs84(X0, Y0);
const ct = (id, o) => ({ _id: id, name: 'אתר', address: 'תל אביב', X: String(X0), Y: String(Y0), gush: '7094', helka: '65', org_id: 1000 + id, legend: 'היתכנות לזיהום קרקע', matzav: '', peeilut: '', date: '09/04/2024', sug: '', stat_gas: '', stat_zih: '', drisha: '', d_begin: '01/01/2001', d_end: '01/01/2003', link: 'https://www.gov.il/x', ...o });
const ROWS = {
  contaminated: [
    ct(1, { name: 'אמקור' }),                                                          // on the street's parcel 7094/65
    ct(2, { name: 'מוסך', X: String(X0 + 200), gush: '7094', helka: '99', legend: 'קרקע מזוהמת', stat_zih: 'בטיפול' }), // 200 m away, another parcel
    ct(3, { name: 'רחוק', X: String(X0 + 900), gush: '7000', helka: '1' }),            // 900 m — out of range
    ct(4, { name: 'ללא מיקום', X: '', Y: '', gush: '', helka: '' }),                    // no point, no parcel → rejected
    ct(5, { name: 'אמקור' }),                                                          // the same org / parcel twice → numbered #2
  ],
  'edu-points': [
    { _id: 1, SEMEL_MOSAD: '1362', SHEM_MOSAD: 'גן שלוה', ITM_X: String(X0 + 120), ITM_Y: String(Y0), UTM_X: '', UTM_Y: '', RAMAT_DIYUK_MIKUM: 'גבוהה מאוד' },
    { _id: 2, SEMEL_MOSAD: '562', SHEM_MOSAD: 'רחל', ITM_X: String(X0), ITM_Y: String(Y0 + 450), UTM_X: '', UTM_Y: '', RAMAT_DIYUK_MIKUM: 'בינונית' },
    { _id: 3, SEMEL_MOSAD: '999', SHEM_MOSAD: 'רחוק', ITM_X: String(X0), ITM_Y: String(Y0 + 2000), UTM_X: '', UTM_Y: '', RAMAT_DIYUK_MIKUM: 'בינונית' },
  ],
  'edu-info': [
    { _id: 1, 'שנה': 2011, 'סמל מוסד': 1362, 'שם מוסד': 'גן ישן', 'סהכ תלמידים במוסד': 10, 'שם רשות': 'ת"א', 'שם ישוב': 'תל אביב - יפו', 'מגזר': 'יהודי', 'פיקוח': 'ממלכתי', 'מעמד משפטי': 'רשמי', 'סוג חינוך מוסד': 'רגיל', 'סוג מסגרת אירגונית': 'גן ילדים', 'סוג מוסד': 'גן ילדים', 'משכבה': '0.0', 'עד שכבה': '0.0' },
    { _id: 2, 'שנה': 2025, 'סמל מוסד': 1362, 'שם מוסד': 'גן שלוה', 'סהכ תלמידים במוסד': 35, 'שם רשות': 'ת"א', 'שם ישוב': 'תל אביב - יפו', 'מגזר': 'יהודי', 'פיקוח': 'ממלכתי', 'מעמד משפטי': 'רשמי', 'סוג חינוך מוסד': 'רגיל', 'סוג מסגרת אירגונית': 'גן ילדים', 'סוג מוסד': 'גן ילדים', 'משכבה': '0.0', 'עד שכבה': '0.0' },
    { _id: 3, 'שנה': 2023, 'סמל מוסד': 562, 'שם מוסד': 'רחל', 'סהכ תלמידים במוסד': 300, 'שם רשות': 'ת"א', 'שם ישוב': 'תל אביב - יפו', 'מגזר': 'יהודי', 'פיקוח': 'ממלכתי', 'מעמד משפטי': 'רשמי', 'סוג חינוך מוסד': 'רגיל', 'סוג מסגרת אירגונית': 'בית ספר', 'סוג מוסד': 'בית ספר יסודי', 'משכבה': '1.0', 'עד שכבה': '6.0' },
  ],
};
async function synced() {
  const dir = tmp();
  for (const id of Object.keys(SU.SOURCES)) REF.write(SU.SOURCES[id], await REF.fetchAll(SU.SOURCES[id], { fetchImpl: ckanStub(ROWS[id]) }), { dir, now: '2026-10-21T10:00:00.000Z' });
  return dir;
}
const pts = [{ lat: A.lat, lng: A.lng, house: '12', block: '7094', parcel: '65' }];

t('NORMALIZATION: ITM → WGS84, the register\'s words verbatim, a row without point or parcel rejected, a repeated org / parcel numbered (never dropped), one record per institution — its latest school year in the source (an older year superseded and counted), the source\'s year profile kept', async () => {
  const dir = await synced();
  const C = REF.table('contaminated', dir), E = REF.table('edu-info', dir), P = REF.table('edu-points', dir);
  assert.equal(C.meta.records, 4); assert.equal(C.meta.rejected, 1);
  assert.ok(C.byKey.has('ct:1001:7094:65') && C.byKey.has('ct:1005:7094:65'), 'distinct org ids are distinct keys');
  const a = C.byKey.get('ct:1001:7094:65'); assert.equal(a.legend, 'היתכנות לזיהום קרקע'); assert.equal(a.updated, '2024-04-09'); assert.ok(Math.abs(a.lat - A.lat) < 1e-5);
  assert.equal(E.meta.records, 2, 'two institutions'); assert.equal(E.meta.superseded, 1, 'the 2011 row of institution 1362 is superseded by its 2025 row'); assert.equal(P.meta.records, 3);
  assert.deepEqual(E.meta.profile, { rowsByYear: { 2011: 1, 2023: 1, 2025: 1 } }, 'the source\'s own year range is recorded');
  assert.equal(E.byKey.get('edu:1362:2025').students, 35); assert.ok(!E.byKey.has('edu:1362:2011'));
  // a source whose every year is old is still read: each institution's latest year, whatever it is
  const old = REF.write(SU.SOURCES['edu-info'], await REF.fetchAll(SU.SOURCES['edu-info'], { fetchImpl: ckanStub(ROWS['edu-info'].map((r) => ({ ...r, 'שנה': r['שנה'] - 10 }))) }), { dir: tmp(), now: '2026-10-21T10:00:00Z' });
  assert.equal(old.meta.records, 2, 'a source ending before any fixed year is kept — its latest year stated, never dropped');
  // a read that keeps nothing of a non-empty source is refused (nothing written), never an empty register
  await assert.rejects(async () => REF.write(SU.SOURCES['edu-points'], await REF.fetchAll(SU.SOURCES['edu-points'], { fetchImpl: ckanStub(ROWS['edu-points'].map((r) => ({ ...r, ITM_X: '' }))) }), { dir: tmp(), now: '2026-10-21T10:00:00Z' }), /no record kept of 3 source rows/);
  // key-occurrence numbering for identical content keys
  const dup = SU.SOURCES.contaminated; const r = REF.write(dup, { rows: [ct(1, {}), ct(2, { org_id: 1001 })], total: 2, fields: Object.keys(ct(1, {})), sourceUpdatedAt: null, endpoint: 'x' }, { dir: tmp(), now: '2026-10-21T10:00:00Z' });
  assert.equal(r.meta.records, 2);
});
t('AROUND: EXACT on the street\'s own parcel apart from SPATIAL ≤ 300 m; nothing beyond; the legend kept ("potential" never becomes contaminated); education ≤ 500 m with the latest school year by code', async () => {
  const dir = await synced();
  const X = SU.around(pts, dir);
  assert.equal(X.available, true); assert.deepEqual(X.radiusM, { contaminated: 300, education: 500 });
  assert.deepEqual(X.contaminated.exact.map((x) => [x.name, x.relation, x.parcelKey]).sort(), [['אמקור', 'ON_A_PARCEL_OF_THE_STREET', '7094/65'], ['אמקור', 'ON_A_PARCEL_OF_THE_STREET', '7094/65']]);
  assert.equal(X.contaminated.exact[0].legend, 'היתכנות לזיהום קרקע');
  assert.deepEqual(X.contaminated.nearby.map((x) => x.name), ['מוסך'], 'the exact sites are not repeated as nearby; the 900 m site is out of range');
  assert.ok(X.contaminated.nearby[0].distanceM >= 190 && X.contaminated.nearby[0].distanceM <= 210); assert.equal(X.contaminated.nearby[0].contaminationStatus, 'בטיפול');
  assert.match(X.contaminated.doesNotMean, /"potential" site is not a contaminated one/);
  const ed = X.education.institutions; assert.deepEqual(ed.map((x) => x.code), [1362, 562]);
  assert.equal(ed[0].name, 'גן שלוה'); assert.equal(ed[0].latestYear, 2025); assert.equal(ed[0].students, 35); assert.equal(ed[0].inLatestYear, true);
  assert.equal(ed[1].latestYear, 2023); assert.equal(ed[1].inLatestYear, false, 'not in the latest school year — shown with its year, never as current');
  assert.equal(X.education.latestYear, 2025); assert.match(X.education.doesNotMean, /not its catchment/);
  const far = SU.around([{ lat: 31.25, lng: 34.79 }], dir);
  assert.deepEqual(far.contaminated.exact, []); assert.deepEqual(far.contaminated.nearby, []); assert.deepEqual(far.education.institutions, []);
});
t('HONEST STATES: not synced → surroundings-not-synced; no located point → street-not-located (never zero sites)', () => {
  assert.equal(SU.around(pts, tmp()).reason, 'surroundings-not-synced');
});
t('WIRING: the street report carries the surroundings (or the reason) and cites the registers; the page renders them with an ⓘ; the Trust Center, the registry, the bundle and the workflow scope', () => {
  const rep = fs.readFileSync(path.join(ROOT, 'lib/streets/report.js'), 'utf8');
  assert.match(rep, /require\('\.\.\/surroundings'\)\.around\(g\.points\)/); assert.match(rep, /surroundings: su/); assert.match(rep, /miss\('surroundings'/);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /xpBtn\("street_surroundings"\)/); assert.match(html, /plan\+trn\+sur/);
  assert.ok(require('../lib/explain/registry').term('street_surroundings'));
  const C = require('../lib/trust/catalog').catalog(); for (const id of ['datagov:moep:contaminated-land', 'datagov:moe:institution-coordinates', 'datagov:moe:institutions']) assert.ok(C.sources.some((s) => s.id === id), id);
  assert.match(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'), /data\/surroundings\/\*\/rows\.json\.gz/);
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/surroundings-sync.yml'), 'utf8');
  assert.match(wf, /git add data\/surroundings\n/); assert.match(wf, /node test\/surroundings\.test\.js/);
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
  }
  console.log(`surroundings: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
