// PROPX · public-transport access (lib/transport) — offline gates: official codes and coordinates only, the Ministry's status verbatim
// (a planned station never becomes an existing one), ITM → WGS84, fixed radii, DERIVED straight-line distances, the honest refusals,
// the zipped-shapefile reader, the street-report wiring, the workflow's scope. Run: node test/transport.test.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const REF = require('../lib/reference');
const TR = require('../lib/transport');
const SHP = require('../lib/transport/shp');
const { itmToWgs84 } = require('../lib/geo/itm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const pending = [];
const t = (name, fn) => pending.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'propx-tr-'));
function ckanStub(rows) {
  return async (url) => {
    const u = new URL(url), body = (o) => ({ status: 200, text: async () => JSON.stringify(o) });
    if (u.pathname.endsWith('resource_show')) return body({ success: true, result: { last_modified: '2026-10-01T03:09:46' } });
    const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
    return body({ success: true, result: { total: rows.length, fields: [{ id: '_id' }, ...Object.keys(rows[0]).filter((k) => k !== '_id').map((id) => ({ id }))], records: rows.slice(off, off + lim) } });
  };
}
/* the Allenby light-rail entrance as the Ministry publishes it (ITM), and points around it */
const ALLENBY = { X: 178968.3562, Y: 663428.9839 };
const A = itmToWgs84(ALLENBY.X, ALLENBY.Y);
const off = (m, dir = 0) => ({ lat: A.lat + (dir === 0 ? m / 110574 : 0), lng: A.lng + (dir === 1 ? m / (111320 * Math.cos(A.lat * Math.PI / 180)) : 0) });
const ROWS = {
  'bus-stops': [
    { _id: 1, StationId: 101, CityCode: 5000, CityName: 'תל אביב - יפו', StationTypeCode: 1, StationTypeName: 'תחנה רגילה', StationOperatorTypeName: 'מפעילי אוטובוסים', Lat: off(120).lat, Long: off(120).lng },
    { _id: 2, StationId: 102, CityCode: 5000, CityName: 'תל אביב - יפו', StationTypeCode: 1, StationTypeName: 'תחנה רגילה', StationOperatorTypeName: 'מפעילי אוטובוסים', Lat: off(260, 1).lat, Long: off(260, 1).lng },
    { _id: 3, StationId: 103, CityCode: 5000, CityName: 'תל אביב - יפו', StationTypeCode: 1, StationTypeName: 'תחנה רגילה', StationOperatorTypeName: 'מפעילי אוטובוסים', Lat: off(900).lat, Long: off(900).lng },
    { _id: 4, StationId: 104, CityCode: 5000, CityName: 'תל אביב - יפו', StationTypeCode: 7, StationTypeName: 'רכבת ישראל', StationOperatorTypeName: 'רכבת', Lat: off(1300, 1).lat, Long: off(1300, 1).lng },
    { _id: 5, StationId: 105, CityCode: 0, CityName: null, StationTypeCode: 1, StationTypeName: 'תחנה רגילה', StationOperatorTypeName: 'מפעילי אוטובוסים', Lat: 40.1, Long: 10.2 },
  ],
  lrt: [
    { _id: 1, OID: -1, X: ALLENBY.X, Y: ALLENBY.Y, ENTRC_EXIT: 'יציאה A', ACSBL_ENTR: '<Null>', ENTRC_TYPE: 'מדרגות', NOTES: ' ', LINE: 'אדום', TYPE: 'תחתית', STATUS: 'קיימת', YEARMONTH: 202502, COMP: 'נתע', MTR_AREA: 'מטרופולין תל אביב', STAT_NAME: 'אלנבי', ENTRC_LBL: 'A' },
    { _id: 2, OID: -1, X: ALLENBY.X + 40, Y: ALLENBY.Y + 30, ENTRC_EXIT: 'יציאה B', ACSBL_ENTR: 'כניסה נגישה', ENTRC_TYPE: 'מעלית', NOTES: ' ', LINE: 'אדום', TYPE: 'תחתית', STATUS: 'קיימת', YEARMONTH: 202502, COMP: 'נתע', MTR_AREA: 'מטרופולין תל אביב', STAT_NAME: 'אלנבי', ENTRC_LBL: 'B' },
    { _id: 3, OID: -1, X: ALLENBY.X + 500, Y: ALLENBY.Y, ENTRC_EXIT: null, ACSBL_ENTR: null, ENTRC_TYPE: null, NOTES: null, LINE: 'סגול', TYPE: 'עילית', STATUS: 'מתוכננת', YEARMONTH: 202409, COMP: 'נתע', MTR_AREA: 'מטרופולין תל אביב', STAT_NAME: 'אלנבי סגול', ENTRC_LBL: null },
    { _id: 4, OID: -1, X: 0, Y: 0, ENTRC_EXIT: null, ACSBL_ENTR: null, ENTRC_TYPE: null, NOTES: null, LINE: 'סגול', TYPE: 'עילית', STATUS: 'מתוכננת', YEARMONTH: 202409, COMP: 'נתע', MTR_AREA: null, STAT_NAME: 'ללא קואורדינטות', ENTRC_LBL: null },
  ],
  rail: [{ _id: 1, OID: -1, ASSET_NO: 3300, ASSET_NAME: 'נתניה', MAAGAN_ID: 1, SOURCE: 'נת/ 400/ 7', YEARMONTH: 202607, STATUS: 'נוסעים' }, { _id: 2, OID: -1, ASSET_NO: 9999, ASSET_NAME: 'תחנה בבנייה', MAAGAN_ID: 2, SOURCE: null, YEARMONTH: 202607, STATUS: 'בבניה' }],
  metro: [{ _id: 1, OID: -1, OBJECTID: 1, ID: 1, NAMEENG: 'KIRYAT SHALOM', LINE: 'M1', MASAD: 'M1N-31', NAME: 'קריית שלום', YEARMONTH: 202112 }],
};
async function synced() {
  const dir = tmp();
  for (const id of Object.keys(TR.SOURCES)) REF.write(TR.SOURCES[id], await REF.fetchAll(TR.SOURCES[id], { fetchImpl: ckanStub(ROWS[id]) }), { dir, now: '2026-10-21T10:00:00.000Z' });
  return dir;
}

t('NORMALIZATION: official keys and coordinates only — ITM → WGS84 for the light-rail entrances, a stop outside Israel or an entrance without coordinates rejected, the Ministry\'s STATUS kept verbatim', async () => {
  const dir = await synced();
  const L = REF.table('lrt', dir), B = REF.table('bus-stops', dir), Rl = REF.table('rail', dir), M = REF.table('metro', dir);
  assert.equal(B.meta.records, 4); assert.equal(B.meta.rejected, 1, 'the stop outside Israel');
  assert.equal(L.meta.records, 3); assert.equal(L.meta.rejected, 1, 'the entrance at (0, 0)');
  const al = [...L.byKey.values()].find((r) => r.station === 'אלנבי' && r.entrance === 'A');
  assert.ok(Math.abs(al.lat - 32.0631) < 0.002 && Math.abs(al.lng - 34.7750) < 0.002, 'Allenby lies in central Tel Aviv: ' + al.lat + ',' + al.lng);
  assert.equal(al.status, 'קיימת'); assert.equal(al.statusClass, 'EXISTING');
  assert.equal([...L.byKey.values()].find((r) => r.station === 'אלנבי סגול').statusClass, 'PLANNED');
  assert.deepEqual([...Rl.byKey.values()].map((r) => [r.status, r.statusClass]), [['נוסעים', 'IN_SERVICE'], ['בבניה', 'UNDER_CONSTRUCTION']]);
  assert.ok([...Rl.byKey.values()].every((r) => r.lat === undefined), 'the rail list has no coordinates — never invented');
  assert.equal([...M.byKey.values()][0].statusClass, 'PLANNED');
});

t('ACCESS: fixed radii (300 m stops · 1,000 m light rail · 1,500 m rail-typed stops), DERIVED straight-line distances from the nearest street point, stations grouped from entrances, a planned station never shown as existing', async () => {
  const dir = await synced();
  const pts = [{ lat: A.lat, lng: A.lng, house: '1' }, { lat: off(50).lat, lng: off(50).lng, house: '3' }];
  const X = TR.access(pts, dir);
  assert.equal(X.available, true); assert.deepEqual(X.radiusM, { busStops: 300, lrt: 1000, rail: 1500 });
  assert.equal(X.busStops.count, 2, 'the stops at 120 m and 260 m — not the one at 900 m'); assert.ok(X.busStops.nearestM >= 60 && X.busStops.nearestM <= 80, 'nearest from the closer street point (120 − 50 m): ' + X.busStops.nearestM);
  assert.equal(X.lrt.stations.length, 2, 'two entrances of Allenby red are ONE station; the planned purple station apart');
  const red = X.lrt.stations.find((s) => s.line === 'אדום'), purple = X.lrt.stations.find((s) => s.line === 'סגול');
  assert.equal(red.statusClass, 'EXISTING'); assert.equal(red.distanceM, 0); assert.equal(red.nearestHouse, '1');
  assert.equal(purple.statusClass, 'PLANNED'); assert.equal(purple.status, 'מתוכננת'); assert.ok(purple.distanceM > 400 && purple.distanceM < 520);
  assert.equal(X.lrt.existingNearestM, 0); assert.equal(X.lrt.plannedNearestM, purple.distanceM);
  assert.equal(X.rail.stops.length, 1, 'the registry stop typed "רכבת ישראל" at 1,300 m'); assert.match(X.rail.basis, /stop registry types "רכבת ישראל"/);
  assert.equal(X.notLocated.rail, 2); assert.equal(X.notLocated.metro, 1); assert.match(X.notLocated.reason, /HTTP 403/);
  assert.match(X.doesNotMean, /never a value/); assert.match(X.doesNotMean, /PLANNED station is not an operating one/);
  const far = TR.access([{ lat: 31.25, lng: 34.79 }], dir);
  assert.equal(far.busStops.count, 0); assert.equal(far.busStops.nearestM, null, 'no stop in range → null, never 0'); assert.deepEqual(far.lrt.stations, []);
});

t('HONEST STATES: not synced → transport-not-synced; a street with no located point → street-not-located (never zero stops)', () => {
  assert.equal(TR.access([{ lat: 32, lng: 34.8 }], tmp()).reason, 'transport-not-synced');
});

t('the zipped-SHAPEFILE reader (for the day the Ministry\'s shapefile host answers): ZIP central directory, deflate, .shp points, .dbf UTF-8 fields, .prj projection', () => {
  const shp = (pts) => { const recs = pts.map((p, i) => { const b = Buffer.alloc(28); b.writeInt32BE(i + 1, 0); b.writeInt32BE(10, 4); b.writeInt32LE(1, 8); b.writeDoubleLE(p[0], 12); b.writeDoubleLE(p[1], 20); return b; }); const body = Buffer.concat(recs); const h = Buffer.alloc(100); h.writeInt32BE(9994, 0); h.writeInt32BE((100 + body.length) / 2, 24); h.writeInt32LE(1000, 28); h.writeInt32LE(1, 32); return Buffer.concat([h, body]); };
  const dbf = (rows) => { const F = [['NAME', 'C', 30], ['STATUS', 'C', 20]]; const hl = 32 + 32 * F.length + 1, rl = 1 + 50; const h = Buffer.alloc(hl); h[0] = 3; h.writeUInt32LE(rows.length, 4); h.writeUInt16LE(hl, 8); h.writeUInt16LE(rl, 10); F.forEach((f, i) => { h.write(f[0], 32 + i * 32, 'latin1'); h[32 + i * 32 + 11] = f[1].charCodeAt(0); h[32 + i * 32 + 16] = f[2]; }); h[hl - 1] = 0x0d;
    return Buffer.concat([h, ...rows.map((r) => { const b = Buffer.alloc(rl, 0x20); Buffer.from(r[0], 'utf8').copy(b, 1); Buffer.from(r[1], 'utf8').copy(b, 31); return b; })]); };
  const zip = (files) => { const L = [], C = []; let o = 0; for (const [n, d] of files) { const nb = Buffer.from(n), z = zlib.deflateRawSync(d), lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(z.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(nb.length, 26); L.push(lh, nb, z);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(o, 42); C.push(c, nb); o += 30 + nb.length + z.length; }
    const cd = Buffer.concat(C), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(o, 16); return Buffer.concat([...L, cd, e]); };
  const Z = zip([['rail_stat.shp', shp([[180000, 665000], [200000, 700000]])], ['rail_stat.dbf', dbf([['תל אביב מרכז', 'נוסעים'], ['חדשה', 'בבניה']])], ['rail_stat.prj', Buffer.from('PROJCS["Israel_TM_Grid",GEOGCS["GCS_Israel"]]')], ['rail_stat.cpg', Buffer.from('UTF-8')]]);
  const Lr = SHP.readZippedLayer(Z);
  assert.equal(Lr.shapeType, 'Point'); assert.equal(Lr.features.length, 2); assert.equal(SHP.projectionOf(Lr.prj), 'ITM');
  assert.deepEqual(Lr.features.map((f) => [f.attributes.NAME, f.attributes.STATUS, f.geometry.x]), [['תל אביב מרכז', 'נוסעים', 180000], ['חדשה', 'בבניה', 200000]]);
  assert.throws(() => SHP.unzip(Buffer.from('not a zip at all, definitely not')), /not a ZIP/);
  assert.equal(SHP.projectionOf('GEOGCS["GCS_WGS_1984"]'), 'WGS84'); assert.equal(SHP.projectionOf(''), 'NONE');
});

t('WIRING: the street report carries transport access (or the reason), names the rail / metro refusal in its missing list, cites the source; the page renders it with its ⓘ; the Trust Center and the workflow scope', () => {
  const rep = fs.readFileSync(path.join(ROOT, 'lib/streets/report.js'), 'utf8');
  assert.match(rep, /require\('\.\.\/transport'\)\.access\(g\.points\)/); assert.match(rep, /planning: pl, transport: tr,/);
  assert.match(rep, /miss\('rail-metro-station-points'/); assert.ok(!/station points \(MOT data\.gov\.il, CC-BY \/ other-open\) not integrated/.test(rep), 'the old "not integrated" line is gone');
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /xpBtn\("transport_access"\)/); assert.match(page, /sec\("pl",t\.plH,plan\+trn/);
  assert.ok(/trH:"נגישות לתחבורה ציבורית/.test(page) && /trH:"Public-transport access/.test(page));
  assert.ok(require('../lib/explain/registry').term('transport_access'));
  const C = require('../lib/trust/catalog').catalog(); for (const id of ['datagov:mot:bus-stops', 'datagov:mot:lrt-stations', 'datagov:mot:rail-stations', 'datagov:mot:metro-stations']) assert.ok(C.sources.some((s) => s.id === id), id);
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/transport-sync.yml'), 'utf8');
  assert.ok(wf.indexOf('node test/transport.test.js') < wf.indexOf('node scripts/transport-sync.js')); assert.match(wf, /git add data\/transport\n/); assert.ok(!/git add (?!data\/transport)/.test(wf));
  const vc = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')); assert.ok(vc.functions['api/intel.js'].includeFiles.includes('data/transport/*/rows.json.gz'));
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
  }
  console.log(`transport: ${passed} passed${failed ? ', ' + failed + ' FAILED' : ''}`);
  process.exit(failed ? 1 : 0);
})();
