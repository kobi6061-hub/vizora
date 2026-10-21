// PROPX · PUBLIC-TRANSPORT ACCESS (21.10.2026, the master data directive §5/§11) — the Ministry of Transport's own open datasets on
// data.gov.il (keyless CKAN datastore, read whole, schema-guarded — lib/reference's reader):
//   bus-stops   the national public-transport stop registry (≈ 34k stops, WGS84, CBS locality code, stop type — incl. the stops the
//               registry types "רכבת ישראל" = Israel Railways stations); monthly
//   lrt         light-rail station ENTRANCES (ITM → WGS84), the line, the station name and the Ministry's STATUS verbatim
//               ("קיימת" existing · "מתוכננת" planned — never promoted)
//   rail        heavy-rail passenger stations — names + STATUS ("נוסעים" in passenger service · "בבניה" under construction); NO coordinates
//               through an accessible channel (the shapefile host aws-e.data.gov.il answers 403 to the runner — not bypassed)
//   metro       planned metro stations — names + line; NO coordinates (same refusal)
// Distances are DERIVED: straight-line metres from the street's nearest located point (the GovMap-layer file's parcel / building points)
// to a stop / entrance. Proximity is context — never a value, never a price effect, and a planned station is never an operating one.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const REF = require('../reference');
const { itmToWgs84 } = require('../geo/itm');

const DIR = process.env.TRANSPORT_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'transport');
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const txt = (v) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return s && s !== '<Null>' && s !== 'null' ? s : null; };
const inIsrael = (lat, lng) => lat > 29.3 && lat < 33.5 && lng > 34.2 && lng < 35.95;
const MOT = { publisher: 'משרד התחבורה והבטיחות בדרכים', publisherEn: 'Ministry of Transport and Road Safety' };

const SOURCES = Object.freeze({
  'bus-stops': { id: 'bus-stops', trustId: 'datagov:mot:bus-stops', ...MOT, title: 'תחנות תחבורה ציבורית', titleEn: 'Public-transport stops (the national stop registry)',
    package: 'bus_stops', resourceId: 'e873e6a2-66c1-494f-a677-f5e77348edb0', page: 'https://data.gov.il/dataset/bus_stops', licence: 'Other (Open)', cadence: 'monthly (resource replaced in place)',
    classification: 'OFFICIAL', period: 'registry snapshot', required: ['StationId', 'CityCode', 'StationTypeName', 'Lat', 'Long'],
    normalize(r) {
      const id = num(r.StationId), lat = num(r.Lat), lng = num(r.Long);
      if (id === null || lat === null || lng === null || !inIsrael(lat, lng)) return null;
      return { key: 'stop:' + id, level: 'stop', id, city: num(r.CityCode), cityName: txt(r.CityName), type: num(r.StationTypeCode), typeName: txt(r.StationTypeName), operator: txt(r.StationOperatorTypeName), lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    } },
  lrt: { id: 'lrt', trustId: 'datagov:mot:lrt-stations', ...MOT, title: 'תחנות רכבת קלה', titleEn: 'Light-rail stations (station entrances)',
    package: 'lrt_stat', resourceId: 'b2ca8ac5-d7ea-41a5-8119-a30e98cf71e0', page: 'https://data.gov.il/dataset/lrt_stat', licence: 'Creative Commons Attribution', cadence: 'as the Ministry updates (YEARMONTH per row)',
    classification: 'OFFICIAL', period: 'layer snapshot', required: ['X', 'Y', 'STATUS', 'LINE', 'STAT_NAME'],
    normalize(r) {
      const x = num(r.X), y = num(r.Y); if (x === null || y === null || x < 100000 || x > 300000 || y < 350000 || y > 850000) return null;
      const { lat, lng } = itmToWgs84(x, y); if (!inIsrael(lat, lng)) return null;
      const status = txt(r.STATUS), name = txt(r.STAT_NAME), line = txt(r.LINE), lbl = txt(r.ENTRC_LBL);
      return { key: `lrt:${r._id}`, level: 'entrance', station: name, line, status, statusClass: status === 'קיימת' ? 'EXISTING' : status === 'מתוכננת' ? 'PLANNED' : 'OTHER',
        type: txt(r.TYPE), company: txt(r.COMP), metro: txt(r.MTR_AREA), entrance: lbl, exit: txt(r.ENTRC_EXIT), accessible: txt(r.ACSBL_ENTR), yearMonth: num(r.YEARMONTH),
        lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    } },
  rail: { id: 'rail', trustId: 'datagov:mot:rail-stations', ...MOT, title: 'רכבת כבדה — תחנות נוסעים', titleEn: 'Heavy rail — passenger stations (names and status; no coordinates)',
    package: 'rail_stat', resourceId: 'b6685ecf-2f87-4602-823e-af9790fd6aba', page: 'https://data.gov.il/dataset/rail_stat', licence: 'Creative Commons Attribution', cadence: 'as the Ministry updates (YEARMONTH per row)',
    classification: 'OFFICIAL', period: 'layer snapshot', required: ['ASSET_NO', 'ASSET_NAME', 'STATUS'],
    normalize(r) { const a = num(r.ASSET_NO), n = txt(r.ASSET_NAME); if (a === null || !n) return null; const st = txt(r.STATUS);
      return { key: 'rail:' + a, level: 'station', asset: a, name: n, status: st, statusClass: st === 'נוסעים' ? 'IN_SERVICE' : st === 'בבניה' ? 'UNDER_CONSTRUCTION' : 'OTHER', plan: txt(r.SOURCE), yearMonth: num(r.YEARMONTH) }; } },
  metro: { id: 'metro', trustId: 'datagov:mot:metro-stations', ...MOT, title: 'תחנות מטרו', titleEn: 'Metro stations — planned (names; no coordinates)',
    package: 'metro_stat', resourceId: 'aaea25c0-1478-4ae6-9c61-1cce3cff5ae7', page: 'https://data.gov.il/dataset/metro_stat', licence: 'Creative Commons Attribution', cadence: 'as the Ministry updates (YEARMONTH per row)',
    classification: 'OFFICIAL', period: 'layer snapshot', required: ['NAME', 'LINE', 'MASAD'],
    normalize(r) { const m = txt(r.MASAD), n = txt(r.NAME); if (!m || !n) return null;
      return { key: 'metro:' + m, level: 'station', code: m, name: n, nameEn: txt(r.NAMEENG), line: txt(r.LINE), statusClass: 'PLANNED', yearMonth: num(r.YEARMONTH) }; } },
});

/* ── the read model: a grid over the points, memoised per content hash ── */
const CELL = 0.01;   // ≈ 1.1 km × 0.95 km
let CACHE = null;
function load(dir = DIR) {
  const metas = Object.keys(SOURCES).map((id) => REF.readMeta(id, dir));
  const stamp = dir + '|' + metas.map((m) => (m ? m.contentHash : '-')).join('|');
  if (CACHE && CACHE.stamp === stamp) return CACHE;
  const T = Object.fromEntries(Object.keys(SOURCES).map((id) => [id, REF.table(id, dir)]));
  const grid = (rows) => { const g = new Map(); for (const r of rows) { const k = `${Math.floor(r.lat / CELL)}:${Math.floor(r.lng / CELL)}`; const a = g.get(k); if (a) a.push(r); else g.set(k, [r]); } return g; };
  const rowsOf = (id) => (T[id] ? [...T[id].byKey.values()] : []);
  const stops = rowsOf('bus-stops'), lrt = rowsOf('lrt');
  CACHE = { stamp, T, metas: Object.fromEntries(Object.keys(SOURCES).map((id, i) => [id, metas[i]])), stops: grid(stops), lrt: grid(lrt), railStops: grid(stops.filter((s) => s.typeName === 'רכבת ישראל')),
    counts: { stops: stops.length, railStops: stops.filter((s) => s.typeName === 'רכבת ישראל').length, lrtEntrances: lrt.length, lrtStations: new Set(lrt.map((r) => r.station + '|' + r.line)).size, rail: rowsOf('rail').length, metro: rowsOf('metro').length } };
  return CACHE;
}
const R = 6371008.8, rad = Math.PI / 180;
function haversine(lat1, lng1, lat2, lng2) { const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); }
/** the rows of a grid within `m` metres of any of the points: [{ row, distanceM, from: the street point }] (nearest point per row) */
function within(g, pts, m) {
  const out = new Map(), dc = Math.ceil(m / 950) + 1;
  for (const p of pts) {
    const ci = Math.floor(p.lat / CELL), cj = Math.floor(p.lng / CELL);
    for (let i = ci - dc; i <= ci + dc; i++) for (let j = cj - dc; j <= cj + dc; j++) for (const r of g.get(`${i}:${j}`) || []) {
      const d = haversine(p.lat, p.lng, r.lat, r.lng); if (d > m) continue;
      const k = r.key, prev = out.get(k); if (!prev || d < prev.distanceM) out.set(k, { row: r, distanceM: Math.round(d), from: p });
    }
  }
  return [...out.values()].sort((a, b) => a.distanceM - b.distanceM);
}
const RADIUS = Object.freeze({ busStops: 300, lrt: 1000, rail: 1500 });

/**
 * the street's public-transport access from its located points ({ lat, lng, house? }[]):
 *   busStops — distinct registry stops within 300 m (count + nearest); lrt — stations (entrances grouped by station + line) within 1,000 m,
 *   each with the Ministry's status verbatim; rail — registry stops typed "רכבת ישראל" within 1,500 m; the national rail / metro station
 *   lists (no coordinates) are named in `notLocated`.
 */
function access(points, dir = DIR) {
  const C = load(dir);
  const src = (id) => (C.metas[id] ? { id: SOURCES[id].trustId, title: SOURCES[id].title, titleEn: SOURCES[id].titleEn, sourceUpdatedAt: C.metas[id].sourceUpdatedAt, readAt: C.metas[id].readAt, checkedAt: C.metas[id].checkedAt } : null);
  if (!C.metas['bus-stops'] && !C.metas.lrt) return { available: false, reason: 'transport-not-synced' };
  const pts = (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return { available: false, reason: 'street-not-located' };
  const stops = within(C.stops, pts, RADIUS.busStops);
  const lrtE = within(C.lrt, pts, RADIUS.lrt);
  const byStation = new Map();
  for (const e of lrtE) { const k = e.row.station + '|' + e.row.line + '|' + e.row.statusClass; const p = byStation.get(k); if (!p || e.distanceM < p.distanceM) byStation.set(k, { station: e.row.station, line: e.row.line, status: e.row.status, statusClass: e.row.statusClass, type: e.row.type, metro: e.row.metro, distanceM: e.distanceM, entrance: e.row.entrance, nearestHouse: e.from.house || null }); }
  const lrt = [...byStation.values()].sort((a, b) => a.distanceM - b.distanceM);
  const rail = within(C.railStops, pts, RADIUS.rail).map((x) => ({ stopId: x.row.id, name: x.row.cityName, typeName: x.row.typeName, distanceM: x.distanceM, nearestHouse: x.from.house || null }));
  return {
    available: true, radiusM: RADIUS, basis: 'straight-line metres from the street\'s nearest located parcel / building point (the GovMap-layer file\'s own points) — DERIVED',
    busStops: { count: stops.length, nearestM: stops.length ? stops[0].distanceM : null, types: stops.reduce((m, s) => ((m[s.row.typeName || '—'] = (m[s.row.typeName || '—'] || 0) + 1), m), {}), source: src('bus-stops') },
    lrt: { stations: lrt, existingNearestM: (lrt.find((s) => s.statusClass === 'EXISTING') || {}).distanceM ?? null, plannedNearestM: (lrt.find((s) => s.statusClass === 'PLANNED') || {}).distanceM ?? null, source: src('lrt') },
    rail: { stops: rail, nearestM: rail.length ? rail[0].distanceM : null, basis: 'stops the national stop registry types "רכבת ישראל" — operating station stops; the Ministry\'s station layer has no accessible coordinates', source: src('bus-stops') },
    notLocated: { rail: C.counts.rail, metro: C.counts.metro, reason: 'the Ministry\'s rail and metro station layers carry no coordinates in their table; the shapefiles (aws-e.data.gov.il) refuse the runner (HTTP 403) — not bypassed' },
    doesNotMean: 'proximity is context: a stop or station near the street is never a value, never a price effect; a PLANNED station is not an operating one; a distance is straight-line, not walking',
  };
}
function status(dir = DIR) { const C = load(dir); return { counts: C.counts, sources: Object.keys(SOURCES).map((id) => (C.metas[id] ? { id, trustId: SOURCES[id].trustId, records: C.metas[id].records, sourceUpdatedAt: C.metas[id].sourceUpdatedAt, readAt: C.metas[id].readAt, checkedAt: C.metas[id].checkedAt } : { id, trustId: SOURCES[id].trustId, missing: 'transport-not-synced' })) }; }

module.exports = { SOURCES, DIR, RADIUS, load, access, status, within, haversine };
