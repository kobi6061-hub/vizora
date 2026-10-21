// PROPX · STREET SURROUNDINGS (21.10.2026, the master data directive M5 / §6.9) — official open registers of what lies around a street,
// read whole from data.gov.il's keyless CKAN datastore (lib/reference's reader and store: complete or the source fails, schema-guarded):
//   contaminated   the Ministry of Environmental Protection's national register of contaminated / suspected land (block / parcel,
//                  ITM point, the register's own LEGEND and status words kept VERBATIM — a "potential" site is never called contaminated)
//   edu-points     the Ministry of Education's institution entrance coordinates (ITM, the source's own accuracy grade) — published 04.2022
//   edu-info       the Ministry of Education's institution characteristics by school year (type, level, sector, supervision, students) —
//                  ONE record per institution: its latest school year in the source (whatever year that is — the source's own year range
//                  is recorded in meta.profile and stated beside every figure), joined to a point ONLY by the institution code (סמל מוסד)
// A relation to a street is either EXACT (the register's block / parcel equals a parcel of the street's own located points) or SPATIAL
// (straight-line metres from the street's nearest located point) — never a value, never a price effect, never a health statement.

'use strict';

const path = require('node:path');
const REF = require('../reference');
const { itmToWgs84 } = require('../geo/itm');

const DIR = process.env.SURROUNDINGS_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'surroundings');
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const txt = (v) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return s && s !== '<Null>' && s !== 'null' ? s : null; };
const inIsrael = (lat, lng) => lat > 29.3 && lat < 33.5 && lng > 34.2 && lng < 35.95;
const dmy = (v) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(txt(v) || ''); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const itm = (x, y) => { x = num(x); y = num(y); if (x === null || y === null || x < 100000 || x > 300000 || y < 350000 || y > 850000) return null; const p = itmToWgs84(x, y); return inIsrael(p.lat, p.lng) ? { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 } : null; };

const SOURCES = Object.freeze({
  contaminated: { id: 'contaminated', trustId: 'datagov:moep:contaminated-land', publisher: 'המשרד להגנת הסביבה', publisherEn: 'Ministry of Environmental Protection',
    title: 'קרקעות מזוהמות — המאגר הלאומי', titleEn: 'Contaminated land — the national register', package: 'contaminatedterrains', resourceId: 'cbb2ed28-310d-4389-a1ec-64bb538fc090',
    page: 'https://data.gov.il/dataset/contaminatedterrains', licence: 'Other (Open)', cadence: 'updated several times a week (resource replaced in place)', classification: 'OFFICIAL', period: 'register snapshot',
    required: ['name', 'X', 'Y', 'gush', 'helka', 'legend'], keyOccurrence: true,
    normalize(r) {
      const p = itm(r.X, r.Y), gush = num(r.gush), helka = num(r.helka);
      if (!p && !(gush && helka)) return null;
      return { key: `ct:${num(r.org_id) ?? '-'}:${gush ?? '-'}:${helka ?? '-'}`, level: 'site', name: txt(r.name), address: txt(r.address), block: gush, parcel: helka, legend: txt(r.legend), state: txt(r.matzav),
        activity: txt(r.peeilut), kind: txt(r.sug), gasStatus: txt(r.stat_gas), contaminationStatus: txt(r.stat_zih), requirement: txt(r.drisha), activityFrom: dmy(r.d_begin), activityTo: dmy(r.d_end),
        updated: dmy(r.date), link: txt(r.link), ...(p || {}) };
    } },
  'edu-points': { id: 'edu-points', trustId: 'datagov:moe:institution-coordinates', publisher: 'משרד החינוך', publisherEn: 'Ministry of Education',
    title: 'קואורדינטות מוסדות החינוך', titleEn: 'Education institutions — entrance coordinates', package: 'coordinates', resourceId: '5c5d6bb0-755d-470d-84b6-d7dd3135ba9c',
    page: 'https://data.gov.il/dataset/coordinates', licence: 'Other (Open)', cadence: 'not updated since 04.2022 (the resource date)', classification: 'OFFICIAL', period: 'published 2022-04',
    required: ['SEMEL_MOSAD', 'SHEM_MOSAD', 'ITM_X', 'ITM_Y', 'RAMAT_DIYUK_MIKUM'], keyOccurrence: true,
    normalize(r) { const code = num(r.SEMEL_MOSAD), p = itm(r.ITM_X, r.ITM_Y); if (code === null || !p) return null;
      return { key: 'edu:' + code, level: 'point', code, name: txt(r.SHEM_MOSAD), accuracy: txt(r.RAMAT_DIYUK_MIKUM), ...p }; } },
  'edu-info': { id: 'edu-info', trustId: 'datagov:moe:institutions', publisher: 'משרד החינוך', publisherEn: 'Ministry of Education',
    title: 'מאפייני מוסדות חינוך בפיקוח משרד החינוך', titleEn: 'Education institutions supervised by the Ministry — characteristics by school year', package: 'mosdot', resourceId: '5548fd63-5868-4053-ad81-98caddc5e232',
    page: 'https://data.gov.il/dataset/mosdot', licence: 'Other (Open)', cadence: 'yearly (resource updated 2026-05)', classification: 'OFFICIAL', period: 'each institution\'s latest school year in the source',
    required: ['שנה', 'סמל מוסד', 'שם מוסד', 'סוג מוסד', 'מגזר', 'פיקוח'],
    /* the source's rows per school year (the evidence of its year range) */
    profile(rows) { const y = {}; for (const r of rows) { const k = num(r['שנה']); y[k === null ? 'none' : k] = (y[k === null ? 'none' : k] || 0) + 1; } return { rowsByYear: y }; },
    /* one record per institution code: its latest school year (an older year of the same institution is superseded, counted in meta) */
    select(recs) { const best = new Map(); for (const r of recs) { const p = best.get(r.code); if (!p || r.year > p.year) best.set(r.code, r); } return [...best.values()]; },
    normalize(r) { const year = num(r['שנה']), code = num(r['סמל מוסד']); if (year === null || code === null) return null;
      return { key: `edu:${code}:${year}`, level: 'year', code, year, name: txt(r['שם מוסד']), type: txt(r['סוג מוסד']), frame: txt(r['סוג מסגרת אירגונית']), sector: txt(r['מגזר']), supervision: txt(r['פיקוח']),
        legal: txt(r['מעמד משפטי']), education: txt(r['סוג חינוך מוסד']), fromGrade: num(r['משכבה']), toGrade: num(r['עד שכבה']), students: num(r['סהכ תלמידים במוסד']), locality: txt(r['שם ישוב']) }; } },
});

/* ── the read model: grids over the points (memoised per content hash) ── */
const CELL = 0.01;
let CACHE = null;
function load(dir = DIR) {
  const metas = Object.keys(SOURCES).map((id) => REF.readMeta(id, dir));
  const stamp = dir + '|' + metas.map((m) => (m ? m.contentHash : '-')).join('|');
  if (CACHE && CACHE.stamp === stamp) return CACHE;
  const T = Object.fromEntries(Object.keys(SOURCES).map((id) => [id, REF.table(id, dir)]));
  const rowsOf = (id) => (T[id] ? [...T[id].byKey.values()] : []);
  const grid = (rows) => { const g = new Map(); for (const r of rows) { if (!Number.isFinite(r.lat)) continue; const k = `${Math.floor(r.lat / CELL)}:${Math.floor(r.lng / CELL)}`; const a = g.get(k); if (a) a.push(r); else g.set(k, [r]); } return g; };
  const ct = rowsOf('contaminated');
  const byParcel = new Map(); for (const r of ct) if (r.block && r.parcel) { const k = `${r.block}/${r.parcel}`; const a = byParcel.get(k); if (a) a.push(r); else byParcel.set(k, [r]); }
  /* the institution's latest school year (the characteristics joined to a point by its code only) */
  const latest = new Map(); for (const r of rowsOf('edu-info')) { const p = latest.get(r.code); if (!p || r.year > p.year) latest.set(r.code, r); }
  const eduYears = [...new Set(rowsOf('edu-info').map((r) => r.year))].sort();
  /* the SOURCE's own school-year span (its rows per year, recorded at sync) — stated beside every characteristic */
  const prof = metas[Object.keys(SOURCES).indexOf('edu-info')], py = prof && prof.profile ? Object.keys(prof.profile.rowsByYear || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [];
  const sourceYears = py.length ? [py[0], py[py.length - 1]] : null;
  CACHE = { stamp, T, metas: Object.fromEntries(Object.keys(SOURCES).map((id, i) => [id, metas[i]])), ct: grid(ct), byParcel, edu: grid(rowsOf('edu-points')), latest, latestYear: eduYears[eduYears.length - 1] || null, sourceYears,
    counts: { contaminated: ct.length, contaminatedWithPoint: ct.filter((r) => Number.isFinite(r.lat)).length, eduPoints: rowsOf('edu-points').length, eduInstitutions: latest.size, eduYears } };
  return CACHE;
}
const R = 6371008.8, rad = Math.PI / 180;
function haversine(lat1, lng1, lat2, lng2) { const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); }
function within(g, pts, m) {
  const out = new Map(), dc = Math.ceil(m / 950) + 1;
  for (const p of pts) { const ci = Math.floor(p.lat / CELL), cj = Math.floor(p.lng / CELL);
    for (let i = ci - dc; i <= ci + dc; i++) for (let j = cj - dc; j <= cj + dc; j++) for (const r of g.get(`${i}:${j}`) || []) {
      const d = haversine(p.lat, p.lng, r.lat, r.lng); if (d > m) continue; const prev = out.get(r.key); if (!prev || d < prev.distanceM) out.set(r.key, { row: r, distanceM: Math.round(d), from: p }); } }
  return [...out.values()].sort((a, b) => a.distanceM - b.distanceM);
}
const RADIUS = Object.freeze({ contaminated: 300, education: 500 });

/**
 * the street's surroundings from its located points ({ lat, lng, house?, block?, parcel? }[]):
 *   contaminated — EXACT: register rows on a block / parcel of the street's own points; SPATIAL: register points within 300 m (each with
 *                  the register's legend and status words verbatim); education — institutions with a published entrance point within 500 m,
 *                  their characteristics of the latest school year joined by the institution code
 */
function around(points, dir = DIR) {
  const C = load(dir);
  const src = (id) => (C.metas[id] ? { id: SOURCES[id].trustId, title: SOURCES[id].title, titleEn: SOURCES[id].titleEn, sourceUpdatedAt: C.metas[id].sourceUpdatedAt, readAt: C.metas[id].readAt, checkedAt: C.metas[id].checkedAt } : null);
  if (!C.metas.contaminated && !C.metas['edu-points']) return { available: false, reason: 'surroundings-not-synced' };
  const pts = (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return { available: false, reason: 'street-not-located' };
  const site = (r, extra) => ({ name: r.name, address: r.address, block: r.block, parcel: r.parcel, legend: r.legend, state: r.state, contaminationStatus: r.contaminationStatus, gasStatus: r.gasStatus, requirement: r.requirement, updated: r.updated, ...extra });
  /* exact: the street's own parcels (from its located points) */
  const parcels = new Set(pts.filter((p) => p.block && p.parcel).map((p) => `${Number(p.block)}/${Number(p.parcel)}`));
  const exact = []; for (const k of parcels) for (const r of C.byParcel.get(k) || []) exact.push(site(r, { relation: 'ON_A_PARCEL_OF_THE_STREET', parcelKey: k }));
  const exactKeys = new Set(exact.map((x) => x.parcelKey + '|' + x.name));
  const near = within(C.ct, pts, RADIUS.contaminated).filter((x) => !exactKeys.has(`${x.row.block}/${x.row.parcel}|${x.row.name}`)).map((x) => site(x.row, { relation: 'NEARBY', distanceM: x.distanceM, nearestHouse: x.from.house || null }));
  const edu = C.metas['edu-points'] ? within(C.edu, pts, RADIUS.education).map((x) => { const L = C.latest.get(x.row.code) || null;
    return { code: x.row.code, name: (L && L.name) || x.row.name, distanceM: x.distanceM, accuracy: x.row.accuracy, nearestHouse: x.from.house || null,
      latestYear: L ? L.year : null, type: L ? L.type : null, frame: L ? L.frame : null, sector: L ? L.sector : null, supervision: L ? L.supervision : null, students: L ? L.students : null, fromGrade: L ? L.fromGrade : null, toGrade: L ? L.toGrade : null,
      inLatestYear: !!(L && L.year === C.latestYear) }; }) : null;
  return {
    available: true, radiusM: RADIUS, basis: 'EXACT = the register\'s block / parcel equals a parcel of the street\'s own located points; SPATIAL = straight-line metres from the street\'s nearest located point — DERIVED',
    contaminated: C.metas.contaminated ? { exact, nearby: near, parcelsChecked: parcels.size, source: src('contaminated'),
      doesNotMean: 'the register\'s own legend and status words, verbatim: a "potential" site is not a contaminated one, a listed site is not a health finding, a nearby site says nothing about this street\'s soil' } : null,
    education: edu ? { institutions: edu, inLatestYear: edu.filter((x) => x.inLatestYear).length, latestYear: C.latestYear, sourceYears: C.sourceYears, pointsPublished: (C.metas['edu-points'] || {}).sourceUpdatedAt || null,
      source: src('edu-points'), info: src('edu-info'), basis: 'the Ministry\'s entrance points (published 2022) — an institution opened later has no point; characteristics of each institution\'s latest school year IN THE SOURCE (sourceYears = the school years the source holds — 2011–2015 at the 21.10.2026 read) by the institution code only',
      doesNotMean: 'a nearby institution is not its catchment / registration zone, not a quality grade, and not a value' } : null,
  };
}
function status(dir = DIR) { const C = load(dir); return { counts: C.counts, sources: Object.keys(SOURCES).map((id) => (C.metas[id] ? { id, trustId: SOURCES[id].trustId, records: C.metas[id].records, sourceUpdatedAt: C.metas[id].sourceUpdatedAt, readAt: C.metas[id].readAt, checkedAt: C.metas[id].checkedAt } : { id, trustId: SOURCES[id].trustId, missing: 'surroundings-not-synced' })) }; }

module.exports = { SOURCES, DIR, RADIUS, load, around, status, within, haversine };
