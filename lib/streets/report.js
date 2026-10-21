// PROPX · STREET INVESTMENT INTELLIGENCE — the street report: a COMPOSITION LAYER over the read models PROPX already has. It creates no
// fact, ingests nothing, and never re-labels or re-thresholds what it reads:
//
//   identity · market evidence · freshness · counts      lib/streets/street.js (Street Intelligence, unchanged)
//   transaction events                                    lib/txevents (the union: register sweep + GovMap layer + parcel recovery)
//                                                          + the GovMap layer's stored history before the window (lib/txevents/history)
//   model                                                 lib/streets/value-read.js (Street Value Model — read only)
//   fair comparison                                       lib/streets/benchmarks.js (the same population at every level)
//   street geography                                      data/geo/street-geo (the GovMap file's own parcel / building points)
//   plans around the street                               data/planning/national (every Xplan plan + boundary)
//   Tel Aviv-Yafo permits / sites                          lib/streets/street.js links (exact address)
//
// RULES. Every section carries its basis (source · as-of · class) and a missing reason when it is empty. A locality / district figure is
// CONTEXT, never the street's. A neighbourhood is VERIFIED only through a verified street link; the name the source prints on the deals is
// a SOURCE LABEL (with its share of the street's rows) — never a boundary, never verified, never inferred. A spatial relation (a parcel of
// the street inside a plan boundary · its distance) is CONTEXT with its basis — never a join of records, never a value, never an
// attribution of a plan's units to the street. A proposed / approved plan is never an operating line or a built project. Nothing here
// predicts a price, assigns a probability or recommends a purchase.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const SD = require('./directory');
const EV = require('./evidence');
const ST = require('./street');
const B = require('./benchmarks');
const { topicOf } = require('../planning/topic');

const ENGINE = 'propx-street-report-1';
const ROOT = path.join(__dirname, '..', '..', 'data');
/* literal paths, so the deployment's file tracing bundles the directories */
const GEO_DIR = process.env.STREET_GEO_DIR || path.join(__dirname, '..', '..', 'data', 'geo', 'street-geo');
const PLAN_DIR = process.env.PLAN_BOUNDARIES_DIR || path.join(__dirname, '..', '..', 'data', 'planning', 'national');
const DISTRICTS = { 'd-jm': ['מחוז ירושלים', 'Jerusalem district'], 'd-north': ['מחוז הצפון', 'Northern district'], 'd-haifa': ['מחוז חיפה', 'Haifa district'],
  'd-center': ['מחוז המרכז', 'Central district'], 'd-ta': ['מחוז תל אביב', 'Tel Aviv district'], 'd-south': ['מחוז הדרום', 'Southern district'], 'js-area': ['יהודה ושומרון', 'Judea and Samaria Area'] };
/* distances (metres from the nearest located parcel of the street) */
const NEAR_M = 300, TRANSIT_M = 1000, AREA_STREET_M = 150, AREA_WIDE_DUNAM = 2000;
const SOURCE_LABEL_DOMINANT = 0.8, SOURCE_LABEL_MIN_ROWS = 5;

let TX = null, HIST = null, SVM;
const tx = () => TX || (TX = require('../txevents'));
const hist = () => HIST || (HIST = require('../txevents/history'));
const svm = () => { if (SVM === undefined) { try { SVM = require('./value-read'); if (!SVM.load().available) SVM = null; } catch { SVM = null; } } return SVM; };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readGz = (f) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch { return null; } };
const lru = (m, k, v, n) => { m.set(k, v); while (m.size > n) m.delete(m.keys().next().value); return v; };
const median = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (v, k) => (v == null ? null : Math.round(v / k) * k);
const pct = (a, b) => (a == null || b == null || !b ? null : Math.round((a / b - 1) * 1000) / 10);

/* ───────────────────────── geometry (local metres; a street spans a few km at most) ───────────────────────── */
const M_LAT = 110574, M_LNG = (lat) => 111320 * Math.cos(lat * Math.PI / 180);
function projector(lat0) { const kx = M_LNG(lat0); return ([lng, lat]) => [lng * kx, lat * M_LAT]; }
function inRings(rings, p) {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}
/** a polygon's area in dunam (1,000 m²), even-odd rings, from its generalized boundary */
function areaDunam(rings, P) {
  let a = 0;
  for (const r of rings) { const R = r.map(P); let s = 0; for (let i = 1; i < R.length; i++) s += R[i - 1][0] * R[i][1] - R[i][0] * R[i - 1][1]; a += Math.abs(s) / 2 * (a === 0 ? 1 : -1); }
  return Math.round(Math.abs(a) / 1000);
}
/** the relation of a polygon (WGS84 rings) to a set of points (WGS84): how many points lie inside, the nearest distance (m) */
function relation(rings, pts, P) {
  let inside = 0, best = Infinity, nearest = null;
  const R = rings.map((r) => r.map(P));
  for (const p of pts) {
    const q = P(p);
    if (inRings(R, q)) { inside++; best = 0; nearest = p; continue; }
    for (const r of R) for (let i = 1; i < r.length; i++) { const d = segDist(q, r[i - 1], r[i]); if (d < best) { best = d; nearest = p; } }
  }
  return { inside, distanceM: best === Infinity ? null : Math.round(best), nearest };
}

/* ───────────────────────── street geography (data/geo/street-geo) ───────────────────────── */
let GEO_META;
const geoMeta = () => { const f = path.join(GEO_DIR, 'meta.json'), m = mtime(f); if (!GEO_META || GEO_META.m !== m) GEO_META = { m, v: m ? readJson(f) : null }; return GEO_META.v; };
const GEO = new Map();
function geoOf(code) {
  const f = path.join(GEO_DIR, 'loc', `${Number(code)}.json.gz`), m = mtime(f);
  const k = `${code}|${m}`;
  if (GEO.has(k)) return GEO.get(k);
  return lru(GEO, k, m ? readGz(f) : null, 24);
}
/** the street's located parcels / buildings and the neighbourhood names the source prints on its rows */
function streetGeo(idn) {
  const meta = geoMeta();
  const base = { source: 'over:govmap-layer-file', cls: 'OBSERVED', method: meta ? meta.method : null, validation: meta ? meta.validation : null, builtAt: meta ? meta.builtAt || null : null,
    file: meta && meta.file ? { sha256: meta.file.sha256, bytes: meta.file.bytes } : null, notJoin: meta ? meta.notJoin : null };
  if (!meta) return { ...base, available: false, reason: 'street-geography-not-built' };
  const L = geoOf(idn.cityCode);
  const s = L && L.streets ? L.streets[String(idn.streetCode)] : null;
  if (!s || !s.pts.length) return { ...base, available: false, reason: L ? 'no-located-parcel-on-this-street' : 'locality-not-in-the-layer-file', localityNames: L ? Object.keys(L.nb || {}).length : 0 };
  const pts = s.pts.map((p) => ({ lng: p[0], lat: p[1], house: p[2], rows: p[3], first: p[4], last: p[5], block: p[6], parcel: p[7] }));
  const lngs = pts.map((p) => p.lng), lats = pts.map((p) => p.lat);
  const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  const c = [median(lngs), median(lats)];
  const P = projector(c[1]);
  const [x0, y0] = P([bbox[0], bbox[1]]), [x1, y1] = P([bbox[2], bbox[3]]);
  const rows = s.nb.reduce((a, x) => a + x[1], 0), total = pts.reduce((a, p) => a + p.rows, 0);
  return { ...base, available: true, points: pts, located: pts.length, rows: total, bbox, centroid: c, extentM: Math.round(Math.hypot(x1 - x0, y1 - y0)),
    sourceNeighbourhoods: s.nb.map(([name, n]) => ({ name, rows: n, sharePct: Math.round((n / Math.max(1, total)) * 100) })), labelledRows: rows };
}

/* ───────────────────────── hierarchy: district → city → neighbourhood → street → buildings ───────────────────────── */
function hierarchy(idn, s, g) {
  const d = DISTRICTS[idn.district] || null;
  const v = s.context.neighbourhood;
  const top = g.available && g.sourceNeighbourhoods.length ? g.sourceNeighbourhoods[0] : null;
  const dominant = top && g.labelledRows >= SOURCE_LABEL_MIN_ROWS && top.rows / g.labelledRows >= SOURCE_LABEL_DOMINANT;
  const state = v.resolved ? 'VERIFIED' : dominant ? 'SOURCE_LABEL' : top ? 'SOURCE_LABEL_MIXED' : 'UNRESOLVED';
  return {
    district: { id: idn.district, he: d ? d[0] : null, en: d ? d[1] : null },
    city: { code: idn.cityCode, he: idn.city, en: idn.cityEn, id: idn.cityId },
    neighbourhood: {
      state,
      verified: v.resolved ? { id: v.id, name: v.name, method: v.method, source: v.source, cls: 'VERIFIED' } : null,
      sourceLabel: top ? { name: top.name, rows: top.rows, sharePct: Math.round((top.rows / Math.max(1, g.labelledRows)) * 100), labelledRows: g.labelledRows,
        others: g.sourceNeighbourhoods.slice(1, 6), cls: 'SOURCE LABEL', basis: 'the neighbourhood name the GovMap-layer file prints on this street\'s deals — the source\'s label, not a verified boundary' } : null,
      reason: v.resolved ? null : top ? (dominant ? 'no verified street → neighbourhood link; the source labels the street\'s deals' : 'the source labels this street\'s deals with more than one neighbourhood name')
        : 'no verified street → neighbourhood link and no source label on this street\'s deals (PROPX never infers a neighbourhood)',
    },
    street: { id: idn.id, name: idn.name, kind: idn.kind, kindLabel: idn.kindLabel, status: idn.status, code: idn.streetCode, synonyms: idn.synonyms },
  };
}

/* ───────────────────────── the transaction table (every event PROPX holds for the street) ───────────────────────── */
const CATEGORY = Object.freeze({ STREET: 'STREET', POSSIBLE: 'POSSIBLE', AREA: 'AREA' });
/* RELIABLE street match = lib/txevents' STREET / BUILDING placement: the register deal's parcel has every address on this street, or the
   GovMap layer's own official street code with its parcel agreeing; every other placement (a corner parcel, a published address only, a
   parcel placed through the other copy, the republisher's link) is a POSSIBLE match — shown apart, never in a statistic */
const categoryOf = (geo) => (geo && (geo.match === 'STREET' || geo.match === 'BUILDING') ? CATEGORY.STREET : CATEGORY.POSSIBLE);
const ROWS = new Map();
function stamp() {
  const S = EV.store();
  return [S.available ? S.meta.source.scrapedAt : '-', mtime(path.join(ROOT, 'txevents', 'national', 'meta.json')), mtime(path.join(ROOT, 'streets', 'recent', 'meta.json')),
    mtime(path.join(ROOT, 'txevents', 'history', 'meta.json'))].join('|');
}
/** the street's events: the stored union (window) + the GovMap layer's stored history before the window; each with its category */
function streetEvents(id) {
  const k = `${id}|${stamp()}`;
  if (ROWS.has(k)) return ROWS.get(k);
  const T = tx(), H = hist();
  const U = T.query({ streetId: id, all: true, unlimited: true });
  const scope = U.scope;
  const winFrom = (EV.store().meta || {}).window ? EV.store().meta.window.from : null;
  const S = T.stores();
  const seen = new Set(U.events.map((e) => (e.source === 'govmap' && e.oid != null ? 'o' + e.oid : e.id)));
  const out = U.events.map((e) => ({ ...e, category: categoryOf(e.geo), history: false }));
  let historyRows = 0;
  if (scope.resolved && winFrom && H.meta()) {
    const snap = S.nationalMeta && S.nationalMeta.version ? String(S.nationalMeta.version.detectedAt || '').slice(0, 10) : null;
    for (const r of H.rows({ code: scope.code, streetCode: scope.streetCode }, null, H.addDays(winFrom, -1))) {
      if (seen.has('o' + r.oid)) continue;
      const e = T.gmEvent(H.asLayerRow(r), 'over:govmap-national', snap);
      const pl = T.placeEvent(e, scope, S);
      if (!pl) continue;
      seen.add('o' + r.oid); historyRows++;
      out.push({ ...e, ...T.displayOf(e, scope, pl), id: 'gmh:' + r.oid, geo: pl, inStatistics: false, evidence: [], conflict: false, conflictFields: [], history: true,
        recovery: r.recovery || null, category: categoryOf(pl) });
    }
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(a.id).localeCompare(String(b.id)));
  const v = { scope, events: out, recency: U.recency, coverage: U.coverage, window: winFrom, historyRows, note: U.note, noteHe: U.noteHe };
  return lru(ROWS, k, v, 32);
}
/** events on OTHER streets whose located parcels lie within AREA_STREET_M of this street's (the surrounding area — never this street) */
function areaEvents(idn, g) {
  if (!g.available) return { available: false, reason: g.reason, events: [], streets: [] };
  const L = geoOf(idn.cityCode); const P = projector(g.centroid[1]);
  const mine = g.points.map((p) => P([p.lng, p.lat]));
  const near = [];
  for (const [code, s] of Object.entries(L.streets || {})) {
    if (Number(code) === idn.streetCode) continue;
    let best = Infinity;
    for (const q of s.pts) { const [x, y] = P([q[0], q[1]]); for (const m of mine) { const d = Math.hypot(x - m[0], y - m[1]); if (d < best) best = d; } if (best === 0) break; }
    if (best <= AREA_STREET_M) near.push({ code: Number(code), distanceM: Math.round(best) });
  }
  near.sort((a, b) => a.distanceM - b.distanceM || a.code - b.code);
  const D = SD.load();
  const use = near.slice(0, 25);
  const events = [];
  for (const n of use) {
    const sid = SD.streetId(idn.cityCode, n.code);
    const row = D.byId.get(sid); if (!row) continue;
    n.id = sid; n.name = row.name;
    const U = tx().query({ streetId: sid, all: true, unlimited: true });
    for (const e of U.events) if (categoryOf(e.geo) === CATEGORY.STREET) events.push({ ...e, category: CATEGORY.AREA, history: false, areaStreet: { id: sid, name: row.name, distanceM: n.distanceM } });
  }
  events.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(a.id).localeCompare(String(b.id)));
  return { available: true, radiusM: AREA_STREET_M, streets: use.filter((n) => n.id), streetsWithin: near.length, events,
    basis: `other official streets with a located parcel within ${AREA_STREET_M} m of a located parcel of this street (GovMap-layer points) — their reliable-street events only; never this street's market` };
}

const SORTS = { date: (e) => e.date, price: (e) => e.price, ppsqm: (e) => e.pricePerSqm, area: (e) => e.areaSqm, rooms: (e) => e.rooms, floor: (e) => e.floorNo };
/* the floor as the source prints it (free text, often several floors: "קרקע וראשונה", "קומה ‎3‏", "שתים עשרה", "עשרים ואחת") → the FIRST
   floor it names as a number, for sorting only; the printed text is always shown beside it; a text it cannot read → null (sorted last) */
const ORD = { 'קרקע': 0, 'עמודים': 0, 'מרתף': -1, 'ראשונה': 1, 'ראשנה': 1, 'שניה': 2, 'שנייה': 2, 'שלישית': 3, 'רביעית': 4, 'חמישית': 5, 'שישית': 6, 'שביעית': 7, 'שמינית': 8, 'תשיעית': 9, 'עשירית': 10 };
const UNIT = { 'אחת': 1, 'אחד': 1, 'שתיים': 2, 'שתים': 2, 'שניים': 2, 'שלוש': 3, 'ארבע': 4, 'חמש': 5, 'שש': 6, 'שבע': 7, 'שמונה': 8, 'תשע': 9 };
const TENS = { 'עשרים': 20, 'שלושים': 30, 'ארבעים': 40, 'חמישים': 50, 'שישים': 60 };
function floorNo(f) {
  if (f == null || f === '') return null;
  const s = String(f).replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
  let m;
  if ((m = /^-?\d+/.exec(s))) return Number(m[0]);
  if ((m = /^(?:קומה|מרתף)\s*(-?\d+)/.exec(s))) return Number(m[1]);
  if ((m = /^(עשרים|שלושים|ארבעים|חמישים|שישים)(?:\s+ו(אחת|אחד|שתיים|שתים|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע))?/.exec(s))) return TENS[m[1]] + (m[2] ? UNIT[m[2]] : 0);
  if ((m = /^(אחת|אחד|שתיים|שתים|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע)\s+עשרה?/.exec(s))) return 10 + UNIT[m[1]];
  if (/^עשר(ה)?(?![א-ת])/.test(s)) return 10;
  const first = s.split(/[,+]|\s+ו(?=[א-ת])|\s+/)[0];
  return Object.prototype.hasOwnProperty.call(ORD, first) ? ORD[first] : null;
}
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
function filterOf(q) {
  const cats = String(q.cat || 'STREET,POSSIBLE').split(',').map((x) => x.trim().toUpperCase()).filter((x) => CATEGORY[x]);
  return { cats: new Set(cats.length ? cats : ['STREET', 'POSSIBLE']), kind: q.kind ? String(q.kind).toUpperCase() : null,
    roomsMin: num(q.roomsMin), roomsMax: num(q.roomsMax), areaMin: num(q.areaMin), areaMax: num(q.areaMax), priceMin: num(q.priceMin), priceMax: num(q.priceMax),
    from: /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : null, to: /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : null,
    days: num(q.days), months: num(q.months), house: q.house != null && q.house !== '' ? String(q.house).trim() : null,
    source: q.source || null, state: q.state || null, history: q.history === '0' ? false : true, statsOnly: q.statsOnly === '1' };
}
function applyFilter(evs, f, today) {
  const from = f.from || (f.days ? new Date(Date.parse(today) - f.days * 864e5).toISOString().slice(0, 10) : f.months ? (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - f.months); return d.toISOString().slice(0, 10); })() : null);
  return evs.filter((e) => {
    if (!f.cats.has(e.category)) return false;
    if (!f.history && e.history) return false;
    if (f.kind && e.kind !== f.kind) return false;
    if (f.roomsMin != null && !(e.rooms != null && e.rooms >= f.roomsMin)) return false;
    if (f.roomsMax != null && !(e.rooms != null && e.rooms <= f.roomsMax)) return false;
    if (f.areaMin != null && !(e.areaSqm != null && e.areaSqm >= f.areaMin)) return false;
    if (f.areaMax != null && !(e.areaSqm != null && e.areaSqm <= f.areaMax)) return false;
    if (f.priceMin != null && !(e.price != null && e.price >= f.priceMin)) return false;
    if (f.priceMax != null && !(e.price != null && e.price <= f.priceMax)) return false;
    if (from && !(e.date && e.date >= from)) return false;
    if (f.to && !(e.date && e.date <= f.to)) return false;
    if (f.house && !String(e.houseNumber || '').split(/,\s*/).includes(f.house)) return false;
    if (f.source && e.sourceId !== f.source) return false;
    if (f.state && e.state !== f.state) return false;
    if (f.statsOnly && !e.inStatistics) return false;
    return true;
  });
}
function rowOut(e) {
  const w = tx().wire(e);
  return { ...w, category: e.category, history: !!e.history, floorText: e.floor || null, floorNo: floorNo(e.floor), areaStreet: e.areaStreet || null, recovery: e.recovery || null };
}
const COVERED = { floor: (e) => e.floor != null && e.floor !== '', rooms: (e) => e.rooms != null, areaSqm: (e) => e.areaSqm != null, price: (e) => e.price != null,
  pricePerSqm: (e) => e.source === 'register' && e.priced && e.pricePerSqm != null, houseNumber: (e) => !!e.houseNumber, parcel: (e) => e.block != null && e.parcel != null,
  subParcel: (e) => e.subParcel != null, yearBuilt: (e) => e.yearBuilt != null, propertyType: (e) => !!e.propertyType };
/**
 * The street's transaction table: filtered, sorted, paged (or every row for an export).
 * @param id st:<locality>:<street>
 * @param q { cat: STREET,POSSIBLE,AREA · kind · roomsMin/Max · areaMin/Max · priceMin/Max · from/to · days | months · house · source · state ·
 *            history (0 = the stored window only) · statsOnly · sort (date|price|ppsqm|area|rooms|floor) · dir (asc|desc) · offset · limit · all }
 */
function transactions(id, q = {}) {
  const D = SD.load();
  const idn = ST.identity(id, D);
  if (!idn) return null;
  const t0 = Date.now();
  const base = streetEvents(idn.id);
  const f = filterOf(q);
  let evs = base.events;
  let area = null;
  if (f.cats.has('AREA')) { area = areaEvents(idn, streetGeo(idn)); evs = evs.concat(area.events); }
  const today = q.today || new Date().toISOString().slice(0, 10);
  const rows = applyFilter(evs, f, today);
  const key = SORTS[q.sort] ? q.sort : 'date', dir = q.dir === 'asc' ? 1 : -1;
  if (key !== 'date' || dir !== -1) {
    const val = key === 'floor' ? (e) => floorNo(e.floor) : key === 'ppsqm' ? (e) => (e.source === 'register' && e.priced ? e.pricePerSqm : null) : SORTS[key];
    /* missing values always last (never 0), ties newest first */
    rows.sort((a, b) => { const x = val(a), y = val(b); if (x == null && y == null) return (b.date || '').localeCompare(a.date || ''); if (x == null) return 1; if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (b.date || '').localeCompare(a.date || ''); });
  }
  const tally = (xs, fn) => xs.reduce((m, x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const counted = (xs) => xs.filter((e) => e.state !== 'POSSIBLE_DUPLICATE');
  const offset = Math.max(0, Number(q.offset) || 0), limit = q.all ? Infinity : Math.max(1, Math.min(500, Number(q.limit) || 50));
  const cover = Object.fromEntries(Object.entries(COVERED).map(([k, fn]) => [k, rows.length ? Math.round((rows.filter(fn).length / rows.length) * 100) : null]));
  const latestAll = counted(base.events)[0] || null;
  return {
    engine: ENGINE, id: idn.id, scope: base.scope, filters: { ...f, cats: [...f.cats] }, sort: { key, dir: dir === 1 ? 'asc' : 'desc' },
    total: rows.length, counted: counted(rows).length, offset, limit: limit === Infinity ? null : limit, more: offset + (limit === Infinity ? rows.length : limit) < rows.length,
    rows: rows.slice(offset, limit === Infinity ? undefined : offset + limit).map(rowOut),
    facets: { category: tally(evs, (e) => e.category), categoryCounted: tally(counted(evs), (e) => e.category), source: tally(rows, (e) => e.sourceId), state: tally(rows, (e) => e.state),
      kind: tally(rows, (e) => e.kind), history: tally(rows, (e) => (e.history ? 'history' : 'window')) },
    fieldCoverage: cover,
    latest: latestAll ? rowOut(latestAll) : null,
    recency: base.recency, window: { from: base.window }, historyRows: base.historyRows,
    area: area ? { available: area.available, reason: area.reason || null, radiusM: area.radiusM || null, streets: area.streets || [], streetsWithin: area.streetsWithin || 0, basis: area.basis || null } : null,
    categories: {
      STREET: 'reliable street match — the register deal\'s parcel has every address on this street, or the GovMap layer\'s own official street code with its parcel agreeing',
      POSSIBLE: 'possible match — a corner / several-street parcel, a published address only, or a parcel placed through the other copy; shown apart, never in a statistic',
      AREA: 'surrounding area — another official street within ' + AREA_STREET_M + ' m (GovMap-layer parcel points); context, never this street',
    },
    note: base.note, noteHe: base.noteHe, ms: Date.now() - t0,
  };
}
const CSV_COLS = [['date', 'date'], ['category', 'category'], ['street', 'street'], ['houseNumber', 'house'], ['price', 'price_ils'], ['inStatistics', 'price_used_in_statistics'],
  ['pricePerSqm', 'price_per_sqm_ils'], ['propertyType', 'property_type'], ['kind', 'kind'], ['rooms', 'rooms'], ['floorText', 'floor'], ['areaSqm', 'area_sqm'], ['yearBuilt', 'year_built'],
  ['block', 'block'], ['parcel', 'parcel'], ['subParcel', 'sub_parcel'], ['state', 'propx_state'], ['notes', 'notes'], ['sourceId', 'source'], ['snapshotDate', 'source_copy_date'],
  ['history', 'before_stored_window'], ['geoMatch', 'street_match'], ['txId', 'propx_event_id']];
/** the filtered table as CSV (UTF-8 with BOM; a cell that a spreadsheet would read as a formula is prefixed with ') */
function transactionsCsv(id, q = {}) {
  const T = transactions(id, { ...q, all: true, offset: 0 });
  if (!T) return null;
  const cell = (v) => { if (v == null) return ''; let s = Array.isArray(v) ? v.join(' | ') : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [CSV_COLS.map((c) => c[1]).join(',')];
  for (const r of T.rows) lines.push(CSV_COLS.map(([k]) => cell(k === 'geoMatch' ? (r.geo && r.geo.match) : r[k])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/* ───────────────────────── fair comparison: street ↔ neighbourhood ↔ city ↔ district (the same population) ───────────────────────── */
function sourceLabelDeals(idn, label) {
  /* the register deals on the streets the source places in the label (a street belongs to the label when ≥ 80 % of its labelled rows carry
     it and ≥ 5 rows are labelled) — whole streets, OBSERVED deals; SOURCE LABEL basis, never a verified neighbourhood */
  const L = geoOf(idn.cityCode); if (!L || !L.nb || !L.nb[label]) return null;
  const streets = [];
  for (const [code, s] of Object.entries(L.streets || {})) {
    const tot = s.nb.reduce((a, x) => a + x[1], 0), hit = (s.nb.find((x) => x[0] === label) || [null, 0])[1];
    if (tot >= SOURCE_LABEL_MIN_ROWS && hit / tot >= SOURCE_LABEL_DOMINANT) streets.push(Number(code));
  }
  if (!streets.length) return null;
  const sh = EV.shardOf(idn.cityCode); if (!sh) return null;
  const set = new Set(streets);
  const deals = EV.dealsOf(sh).filter((x) => x.deal.dwelling && x.deal.match === 'OBSERVED' && x.streets.some((s) => set.has(s.code))).map((x) => x.deal);
  return { streets: streets.length, deals };
}
function comparison(idn, s, g, hier) {
  const BM = B.load();
  const ev = s.evidence && s.evidence.swept ? s.evidence : null;
  const window = ev ? ev.window : (EV.store().meta || {}).window || null;
  const streetDeals = ev ? (EV.street(idn.id) || { deals: [] }).deals : [];
  const rows = [];
  const add = (level, label, stats, extra) => rows.push({ level, label, ...stats.all, bands: stats.bands, ...extra });
  add('STREET', idn.name, B.segmentStats(streetDeals), { population: 'OBSERVED priced dwelling deals on this street', cls: 'OBSERVED', state: ev ? ev.stats.state : 'NOT_SWEPT' });
  const nb = s.context.neighbourhood;
  if (nb.resolved) {
    const LI = require('./match').localityIndex(SD.load(), idn.cityCode);
    const doc = readJson(path.join(ROOT, 'geo', 'neighborhoods.json'));
    const codes = doc ? [...new Set(doc.streetLinks.filter((x) => x.neighborhoodId === nb.id).map((x) => require('./match').resolveStreet(LI, x.street)).filter((r) => r && r.id).map((r) => SD.parseId(r.id).streetCode))] : [];
    const sh = EV.shardOf(idn.cityCode), set = new Set(codes);
    const deals = sh ? EV.dealsOf(sh).filter((x) => x.deal.dwelling && x.deal.match === 'OBSERVED' && x.streets.some((y) => set.has(y.code))).map((x) => x.deal) : [];
    add('NEIGHBOURHOOD_VERIFIED', nb.name, B.segmentStats(deals), { population: `OBSERVED priced dwelling deals on the ${codes.length} verified-linked streets (whole streets)`, cls: 'DERIVED', streets: codes.length });
  }
  const lab = hier.neighbourhood.sourceLabel;
  if (!nb.resolved && lab && hier.neighbourhood.state === 'SOURCE_LABEL') {
    const x = sourceLabelDeals(idn, lab.name);
    if (x) add('NEIGHBOURHOOD_SOURCE_LABEL', lab.name, B.segmentStats(x.deals), { population: `OBSERVED priced dwelling deals on the ${x.streets} streets whose deals the source labels "${lab.name}" (≥ 80 % of their labelled rows) — a SOURCE LABEL, not a verified boundary`, cls: 'DERIVED', streets: x.streets });
  }
  const cur = BM && BM.current;
  if (BM && cur && BM.localities[idn.cityCode]) add('CITY', idn.city, BM.localities[idn.cityCode], { population: 'priced dwelling deals in the locality (every address state)', cls: 'DERIVED' });
  else rows.push({ level: 'CITY', label: idn.city, state: null, reason: BM ? (cur ? 'locality-not-swept' : 'benchmark-built-from-another-copy') : 'benchmarks-not-built' });
  if (BM && cur && BM.districts[idn.district]) add('DISTRICT', (DISTRICTS[idn.district] || [idn.district])[0], BM.districts[idn.district], { population: `priced dwelling deals of the district's ${BM.districts[idn.district].localities} swept localities, pooled (never an average of medians)`, cls: 'DERIVED', localities: BM.districts[idn.district].localities });
  else rows.push({ level: 'DISTRICT', label: idn.district, state: null, reason: BM ? (cur ? 'district-not-in-benchmarks' : 'benchmark-built-from-another-copy') : 'benchmarks-not-built' });
  /* the street against each wider level — ₪/m² only, only where BOTH sides are SUPPORTED with ≥ 10 deals with ₪/m² (DERIVED; a mix of sizes
     and ages still differs: the medians' area and probably-new share are printed beside it) */
  const st = rows[0];
  const ok = (r) => r && r.state === 'SUPPORTED' && r.withSqm >= EV.SAMPLE.SUPPORTED && r.medianPricePerSqm != null;
  for (const r of rows.slice(1)) r.streetVsLevelPct = ok(st) && ok(r) ? pct(st.medianPricePerSqm, r.medianPricePerSqm) : null;
  const segmentRows = B.BANDS.map((b) => ({ band: b, ...Object.fromEntries(rows.filter((r) => r.bands).map((r) => [r.level, r.bands[b] ? { priced: r.bands[b].priced, state: r.bands[b].state, medianPricePerSqm: r.bands[b].medianPricePerSqm, medianPrice: r.bands[b].medianPrice } : null])) }));
  return { window, rows, segments: { by: 'rooms', bands: B.BANDS, rows: segmentRows }, benchmark: BM ? { builtAt: BM.builtAt, current: BM.current, evidence: BM.evidence } : null,
    rule: 'the same population at every level: priced dwelling deals of the register copy (whole property, ≥ ₪100,000) in the same 36-month window; a median only at SUPPORTED (≥ 10) or LIMITED (5–9); street ↔ level difference only where both are SUPPORTED with ≥ 10 deals with ₪/m²',
    doesNotMean: 'a difference between medians describes the observed samples (their mix of sizes, ages and buildings), not the value of a specific dwelling' };
}

/* ───────────────────────── planning & infrastructure around the street ───────────────────────── */
let PLAN_META;
const planMeta = () => { const f = path.join(PLAN_DIR, 'meta.json'), m = mtime(f); if (!PLAN_META || PLAN_META.m !== m) PLAN_META = { m, v: m ? readJson(f) : null }; return PLAN_META.v; };
const TILES = new Map();
function tile(k) { const f = path.join(PLAN_DIR, 'tiles', k + '.json.gz'), m = mtime(f); const kk = `${k}|${m}`; if (TILES.has(kk)) return TILES.get(kk); return lru(TILES, kk, m ? (readGz(f) || { plans: [] }).plans : [], 64); }
let LARGE;
function large() { const f = path.join(PLAN_DIR, 'large.json.gz'), m = mtime(f); if (!LARGE || LARGE.m !== m) LARGE = { m, v: m ? (readGz(f) || { plans: [] }).plans : [] }; return LARGE.v; }
let RENEWAL;
function renewalByPlanKey() {
  const f = path.join(ROOT, 'renewal', 'complexes.json'), m = mtime(f);
  if (RENEWAL && RENEWAL.m === m) return RENEWAL.v;
  const doc = readJson(f) || [];
  const arr = Array.isArray(doc) ? doc : Object.values(doc);
  const v = new Map();
  for (const c of arr) if (c && c.planKey && c.inLatestSource !== false) { const k = String(c.planKey).replace(/\s+/g, ''); if (!v.has(k)) v.set(k, []); v.get(k).push({ id: c.id, complexId: c.complexId, name: c.name, city: c.city, localityCode: c.localityCode, statusHe: c.statusHe, stage: c.stage, proposedUnits: c.proposedUnits, existingUnits: c.existingUnits, additionalUnits: c.additionalUnits, declaration: c.declaration }); }
  RENEWAL = { m, v };
  return v;
}
const STAGE_HE = { PREPARATION: 'בהכנה', SUBMITTED: 'הוגשה / בבדיקה', PRE_DEPOSIT: 'לקראת הפקדה', DEPOSITED: 'הופקדה', OBJECTIONS: 'התנגדויות', APPROVAL_PROCESS: 'בהליך אישור', APPROVED: 'אושרה', EFFECTIVE: 'בתוקף (פורסמה ברשומות)', REJECTED: 'נדחתה', OTHER: 'אחר', UNKNOWN: 'לא ידוע' };
const PENDING = new Set(['PREPARATION', 'SUBMITTED', 'PRE_DEPOSIT', 'DEPOSITED', 'OBJECTIONS', 'APPROVAL_PROCESS']);
function planning(idn, g, links) {
  const meta = planMeta();
  const permits = { coverage: links.coverage, permits: links.totals.permits, sites: links.totals.sites, relation: 'ON_THE_STREET', basis: 'the municipal record names this street in its own address (exact)' };
  const base = { source: meta ? meta.source : { id: 'iplan:xplan' }, fetchedAt: meta ? meta.fetchedAt : null, layerCount: meta ? meta.layerCount : null, complete: meta ? !!meta.complete : false,
    relations: { ON_THE_STREET: 'a record that names this street in its own address', INTERSECTS: 'a located parcel of the street lies inside the plan boundary',
      NEARBY: `the plan boundary lies within ${NEAR_M} m of a located parcel of the street (transport plans: ${TRANSIT_M} m)`, AREA_WIDE: `an area-wide plan (≥ ${AREA_WIDE_DUNAM.toLocaleString('en')} dunam) whose boundary includes the street — not specific to it`,
      CITY_CONTEXT: 'a record of the same locality by its official code, with no spatial relation computed' },
    distanceBasis: 'metres from the nearest located parcel / building point of the street (the GovMap-layer file\'s own points) to the plan boundary (generalized ~10 m)',
    notJoin: 'a spatial relation is context — it never joins a record, never attributes a plan\'s housing units to the street, never values a dwelling',
    doesNotMean: 'an approved or deposited plan is a statutory stage — not a permit, not construction, not an operating line, and never a guaranteed price change', municipal: permits };
  if (!meta) return { ...base, available: false, reason: 'plan-boundaries-not-built', plans: [], transit: [] };
  if (!g.available) return { ...base, available: false, reason: g.reason === 'no-located-parcel-on-this-street' ? 'street-not-located' : g.reason, plans: [], transit: [] };
  const P = projector(g.centroid[1]);
  const pts = g.points.map((p) => [p.lng, p.lat]);
  const buf = TRANSIT_M / M_LAT, bufx = TRANSIT_M / M_LNG(g.centroid[1]);
  const [x0, y0, x1, y1] = [g.bbox[0] - bufx, g.bbox[1] - buf, g.bbox[2] + bufx, g.bbox[3] + buf];
  const T = meta.tileSize;
  const cand = new Map();
  for (let tx0 = Math.floor(x0 / T); tx0 <= Math.floor(x1 / T); tx0++) for (let ty = Math.floor(y0 / T); ty <= Math.floor(y1 / T); ty++) for (const p of tile(`${tx0}_${ty}`)) cand.set(p.oid, p);
  for (const p of large()) cand.set(p.oid, p);
  const RN = renewalByPlanKey();
  const out = [];
  for (const p of cand.values()) {
    if (p.bbox[2] < x0 || p.bbox[0] > x1 || p.bbox[3] < y0 || p.bbox[1] > y1) continue;
    const topic = topicOf(p);
    const transit = topic === 'RAIL_TRANSIT';
    const r = relation(p.rings, pts, P);
    const lim = transit ? TRANSIT_M : NEAR_M;
    if (r.distanceM == null || r.distanceM > lim) continue;
    /* the plan's own stated area, else its boundary's — a plan of ≥ 2,000 dunam covers a whole quarter / city: AREA-WIDE, never "on" the street */
    const area = p.areaDunam != null ? p.areaDunam : areaDunam(p.rings, P);
    const areaWide = r.inside > 0 && area >= AREA_WIDE_DUNAM;
    const rel = r.inside ? (areaWide ? 'AREA_WIDE' : 'INTERSECTS') : 'NEARBY';
    const rk = String(p.planNumber || '').replace(/\s+/g, '');
    out.push({ oid: p.oid, mpId: p.mpId, planNumber: p.planNumber, name: p.name, topic, kind: p.kind, stage: p.stage, stageHe: STAGE_HE[p.stage] || null, station: p.station, event: p.event,
      permitPower: p.permitPower, areaDunam: area, areaStated: p.areaDunam != null, existingAuthorisedUnits: p.existingAuthorisedUnits, planUnitDelta: p.planUnitDelta, landUse: p.landUse, objectives: p.objectives,
      dates: p.dates, lastUpdate: p.lastUpdate, url: p.url, relation: rel, distanceM: r.distanceM, streetPointsInside: r.inside,
      /* the boundary for the report's map (an area-wide plan's is not drawn — it covers the whole view) */
      rings: rel === 'AREA_WIDE' ? null : p.rings.map((ring) => (ring.length > 150 ? ring.filter((_, i) => i % Math.ceil(ring.length / 150) === 0 || i === ring.length - 1) : ring)),
      nearestHouse: r.nearest ? (g.points.find((q) => q.lng === r.nearest[0] && q.lat === r.nearest[1]) || {}).house || null : null,
      renewal: RN.get(rk) || null, cls: 'OFFICIAL', relationCls: 'DERIVED' });
  }
  const order = { INTERSECTS: 0, NEARBY: 1, AREA_WIDE: 2 };
  out.sort((a, b) => order[a.relation] - order[b.relation] || a.distanceM - b.distanceM || (b.planUnitDelta || 0) - (a.planUnitDelta || 0) || a.oid - b.oid);
  const transitPlans = out.filter((p) => p.topic === 'RAIL_TRANSIT');
  /* an area-wide transit plan (a metro master plan covering the metropolis) is listed, never "the nearest line" */
  const transitNear = transitPlans.filter((p) => p.relation !== 'AREA_WIDE');
  const plans = out.filter((p) => p.topic !== 'RAIL_TRANSIT');
  const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
  const housing = plans.filter((p) => p.relation !== 'AREA_WIDE' && (p.planUnitDelta || 0) > 0);
  return { ...base, available: true, plans, transit: transitPlans,
    summary: { intersects: plans.filter((p) => p.relation === 'INTERSECTS').length, nearby: plans.filter((p) => p.relation === 'NEARBY').length, areaWide: out.filter((p) => p.relation === 'AREA_WIDE').length,
      pending: plans.filter((p) => p.relation !== 'AREA_WIDE' && PENDING.has(p.stage)).length, transit: transitNear.length, transitAreaWide: transitPlans.length - transitNear.length,
      transitNearestM: transitNear.length ? Math.min(...transitNear.map((p) => p.distanceM)) : null,
      housingPlans: housing.length, housingUnitDelta: sum(housing, (p) => p.planUnitDelta), renewalPlans: out.filter((p) => p.renewal).length,
      unitsNote: 'the sum of the plans\' own unit changes (quantity_delta_120) within the radius — each plan\'s units are the plan\'s, never the street\'s; plans overlap in time and may revise each other' } };
}

/* ───────────────────────── Level 1 street assessment (deterministic rules; no score) ───────────────────────── */
const T2 = (he, en) => ({ he, en });
const fmtN = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
function assessment(idn, s, cmp, pl, model, txs, fresh) {
  const supports = [], against = [], change = [], dd = [];
  const ev = s.evidence && s.evidence.swept ? s.evidence : null;
  const st = ev ? ev.stats : null;
  const fact = (list, rule, text, cls, source) => list.push({ kind: 'FACT', rule, ...text, cls, source });
  const interp = (list, rule, text, basis) => list.push({ kind: 'INTERPRETATION', rule, ...text, basis });
  if (!ev) fact(against, 'SA-NOT-SWEPT', T2('הרשם לא נסרק ליישוב זה — אין ראיות שוק לרחוב.', 'The locality\'s register copy was not swept — no street market evidence.'), 'MISSING', 'over:street-evidence');
  else if (st.state === 'SUPPORTED') fact(supports, 'SA-SAMPLE', T2(`מדגם נצפה מספק: ${st.priced} עסקאות מגורים מתומחרות ב-36 חודשים.`, `A SUPPORTED observed sample: ${st.priced} priced dwelling deals in 36 months.`), 'OBSERVED', 'over:street-evidence');
  else fact(against, 'SA-SAMPLE', T2(`מדגם הרחוב ${st.state === 'LIMITED' ? 'מוגבל' : st.state === 'INSUFFICIENT' ? 'אינו מספיק' : 'ריק'} (${st.priced} עסקאות מתומחרות) — כל השוואה חלשה.`, `The street sample is ${st.state} (${st.priced} priced deals) — any comparison is weak.`), 'OBSERVED', 'over:street-evidence');
  if (ev && ev.concentration) fact(against, 'SA-CONCENTRATION', T2(`חלקה אחת (${ev.concentration.parcel}) מחזיקה ${ev.concentration.share}% מהעסקאות המתומחרות — החציון מתאר בעיקר אותה.`, `One parcel (${ev.concentration.parcel}) holds ${ev.concentration.share}% of the priced deals — the median mostly describes it.`), 'OBSERVED', 'over:street-evidence');
  const city = cmp.rows.find((r) => r.level === 'CITY');
  if (city && city.streetVsLevelPct != null) {
    const v = city.streetVsLevelPct;
    fact(Math.abs(v) < 5 ? change : v < 0 ? supports : against, 'SA-VS-CITY', T2(`חציון ₪/מ"ר ברחוב ${v > 0 ? 'גבוה' : 'נמוך'} ב-${Math.abs(v)}% מחציון היישוב (אותה אוכלוסייה).`, `The street's median ₪/m² is ${Math.abs(v)}% ${v > 0 ? 'above' : 'below'} the locality's (same population).`), 'DERIVED', 'propx:street-benchmarks');
    interp(v < 0 ? supports : against, 'SA-VS-CITY-I', T2(v < 0 ? 'פער מתחת ליישוב יכול לשקף מחיר כניסה נמוך — או מבנים ותמהיל שונים; יש לבדוק את הבניינים.' : 'פרמיה מעל היישוב מעידה על ביקוש או על תמהיל חדש יותר; היא מגבילה מרווח.',
      v < 0 ? 'A gap below the locality may reflect a lower entry price — or different buildings and mix; check the buildings.' : 'A premium over the locality reflects demand or a newer mix; it limits headroom.'), 'a difference between two observed medians, not a valuation');
  }
  if (st && st.change && st.change.pct != null) fact(st.change.distinguishable ? (st.change.pct > 0 ? supports : against) : change, 'SA-CHANGE', T2(`שינוי ₪/מ"ר ב-12 החודשים האחרונים: ${st.change.pct}% (רווח 95%: ${st.change.interval95[0]}–${st.change.interval95[1]}%)${st.change.distinguishable ? '' : ' — לא ניתן להבחין משינוי אפס'}.`, `12-month ₪/m² change: ${st.change.pct}% (95 % interval ${st.change.interval95[0]}–${st.change.interval95[1]} %)${st.change.distinguishable ? '' : ' — not distinguishable from no change'}.`), 'DERIVED', 'over:street-evidence');
  if (model && model.available && model.value != null) fact(model.tier === 'STRONG' || model.tier === 'STANDARD' ? supports : change, 'SA-MODEL', T2(`הערכת מודל PROPX: ₪${fmtN(model.value)}/מ"ר לדירת ייחוס (רמת ראיות ${model.tier}).`, `PROPX model: ₪${fmtN(model.value)}/m² for the reference dwelling (evidence tier ${model.tier}).`), 'MODEL', 'propx:street-model');
  else fact(against, 'SA-MODEL', T2('אין הערכת מודל לרחוב (אין ראיות ספציפיות מספיקות).', 'No model estimate for this street (not enough street-specific evidence).'), 'MISSING', 'propx:street-model');
  if (pl.available) {
    const S = pl.summary;
    if (S.intersects) fact(change, 'SA-PLANS-ON', T2(`${S.intersects} תכניות שגבולן כולל חלקה ברחוב (${S.pending} עדיין בהליך).`, `${S.intersects} plans whose boundary includes a parcel of the street (${S.pending} still in process).`), 'OFFICIAL', 'iplan:xplan');
    if (S.housingUnitDelta > 0) { fact(change, 'SA-SUPPLY', T2(`תכניות בטווח ${NEAR_M} מ' מוסיפות יחד ${fmtN(S.housingUnitDelta)} יח"ד (שינוי התכניות עצמן).`, `Plans within ${NEAR_M} m add ${fmtN(S.housingUnitDelta)} housing units in total (the plans' own change).`), 'OFFICIAL', 'iplan:xplan');
      interp(against, 'SA-SUPPLY-I', T2('היצע מתוכנן קרוב יכול להתחרות בדירות קיימות — ולהביא שדרוג סביבתי; התזמון לא ידוע.', 'Nearby planned supply may compete with existing flats — and may upgrade the area; timing is unknown.'), 'a statutory plan is not a permit or construction'); }
    if (S.transit) { fact(change, 'SA-TRANSIT', T2(`${S.transit} תכניות תחבורה מסילתית (רק"ל / מטרו / רכבת) בטווח ${TRANSIT_M} מ' — הקרובה ${S.transitNearestM} מ'.`, `${S.transit} rail-transit plans (light rail / metro / rail) within ${TRANSIT_M} m — nearest ${S.transitNearestM} m.`), 'OFFICIAL', 'iplan:xplan');
      interp(supports, 'SA-TRANSIT-I', T2('תכנית מסילתית מאושרת היא סטטוטורית — לא קו פעיל; השפעה על מחירים, אם תהיה, אינה מובטחת ותלויה בביצוע.', 'An approved rail plan is statutory — not an operating line; any price effect is not guaranteed and depends on delivery.'), 'statutory status only'); }
  } else if (!pl.deferred) fact(against, 'SA-PLANS', T2('תכניות סביב הרחוב לא חושבו: ' + (pl.reason || ''), 'Plans around the street were not computed: ' + (pl.reason || '')), 'MISSING', 'iplan:xplan');
  if (fresh && /STALE/.test(fresh.state || '')) fact(against, 'SA-STALE', T2('עותק העסקאות ישן — עסקאות אחרונות עלולות לחסור.', 'The transaction copy is stale — recent deals may be missing.'), 'DERIVED', 'propx:tx-freshness');
  if (s.links.totals.sites) fact(change, 'SA-SITES', T2(`${s.links.totals.sites} אתרי בנייה עירוניים רשומים בכתובות הרחוב (תל אביב-יפו).`, `${s.links.totals.sites} municipal construction sites recorded at the street's addresses (Tel Aviv-Yafo).`), 'OFFICIAL', 'tlv:iview2:permits-772');
  /* due diligence: what a buyer must verify that PROPX cannot */
  const D = (rule, he, en) => dd.push({ rule, he, en });
  D('DD-TITLE', 'נסח טאבו / רמ"י: בעלות, שעבודים, הערות אזהרה, חלק בנכס.', 'Land-registry extract: ownership, charges, caveats, the share being sold.');
  D('DD-PERMIT', 'תיק בניין ברשות המקומית: היתרים, חריגות, טופס 4 / תעודת גמר.', 'The municipal building file: permits, deviations, occupancy / completion certificate.');
  if (pl.available && (pl.summary.intersects || pl.summary.nearby)) D('DD-PLANS', 'הוראות ותשריטי התכניות שגבולן כולל את החלקה (קישורי מבא"ת) — זכויות, הפקעות, ייעוד.', 'The instructions and maps of the plans covering the parcel (Mavat links) — rights, expropriations, land use.');
  else D('DD-PLANS', 'מידע תכנוני לחלקה (מבא"ת / הוועדה המקומית) — PROPX לא איתר תכניות סביב הרחוב.', 'Planning information for the parcel (Mavat / the local committee) — PROPX found no plans around the street.');
  if (!st || st.state !== 'SUPPORTED') D('DD-COMPS', 'עסקאות השוואה ברחובות סמוכים ובאותו בניין — המדגם ברחוב חלש.', 'Comparables on nearby streets and in the same building — the street sample is weak.');
  D('DD-CONDITION', 'מצב פיזי, ליקויים, מעלית, חניה, ממ"ד — אינם במקורות של PROPX.', 'Physical condition, defects, lift, parking, safe room — not in PROPX\'s sources.');
  if (txs && txs.facets && txs.facets.state && (txs.facets.state.LIMITED_SHARE_NOT_STATED || txs.facets.state.POSSIBLE_DUPLICATE)) D('DD-SHARE', 'בעסקאות מהעותק החדש החלק הנמכר אינו מצוין — יש לאמת מול הרשם לפני השוואה.', 'Deals from the newer copy do not state the share sold — verify against the register before comparing.');
  return { supports, against, couldChange: change, dueDiligence: dd, rule: 'deterministic rules over the report\'s own facts (SA-* / DD-*); FACT and INTERPRETATION apart; no score, no probability, no recommendation' };
}

/* ───────────────────────── "Understanding this street" — a grounded narrative (no model call) ───────────────────────── */
function narrative(idn, hier, s, cmp, pl, model, latest) {
  const out = [];
  const S = (kind, he, en, cls, refs) => out.push({ kind, he, en, cls, refs: refs || [] });
  const nb = hier.neighbourhood;
  S('FACT', `${idn.name} הוא ${idn.kind === 'street' ? 'רחוב רשמי' : 'אזור כתובות / אתר רשמי'} ב${idn.city || ''}${hier.district.he ? ', ' + hier.district.he : ''} (קוד ${idn.streetCode}).`,
    `${idn.name} is an official ${idn.kind === 'street' ? 'street' : 'address area / site'} in ${idn.cityEn || idn.city}${hier.district.en ? ', ' + hier.district.en : ''} (code ${idn.streetCode}).`, 'OFFICIAL', ['datagov:streets']);
  if (nb.state === 'VERIFIED') S('FACT', `שכונה מאומתת: ${nb.verified.name}.`, `Verified neighbourhood: ${nb.verified.name}.`, 'VERIFIED', ['propx:neighbourhoods']);
  else if (nb.sourceLabel) S('FACT', `אין קישור שכונה מאומת; המקור מסמן ${nb.sourceLabel.sharePct}% מהעסקאות ברחוב בשם "${nb.sourceLabel.name}" (תווית מקור, לא גבול).`,
    `No verified neighbourhood link; the source labels ${nb.sourceLabel.sharePct}% of the street's deals "${nb.sourceLabel.name}" (a source label, not a boundary).`, 'SOURCE LABEL', ['over:govmap-layer-file']);
  else S('FACT', 'השכונה אינה מזוהה — PROPX אינו מסיק שכונה.', 'The neighbourhood is unresolved — PROPX does not infer one.', 'MISSING', []);
  const ev = s.evidence && s.evidence.swept ? s.evidence : null;
  if (ev) {
    const st = ev.stats, c = cmp.rows.find((r) => r.level === 'CITY');
    S('FACT', `ב-36 החודשים עד ${ev.window.to} נרשמו ${st.observed} עסקאות מגורים נצפות ברחוב (${st.priced} מתומחרות, מצב ${st.state})${st.medianPricePerSqm != null ? `; חציון ₪${fmtN(st.medianPricePerSqm)}/מ"ר` : ''}${c && c.medianPricePerSqm != null ? ` מול ₪${fmtN(c.medianPricePerSqm)}/מ"ר ביישוב` : ''}.`,
      `In the 36 months to ${ev.window.to} the register holds ${st.observed} observed dwelling deals on the street (${st.priced} priced, ${st.state})${st.medianPricePerSqm != null ? `; median ₪${fmtN(st.medianPricePerSqm)}/m²` : ''}${c && c.medianPricePerSqm != null ? ` vs ₪${fmtN(c.medianPricePerSqm)}/m² in the locality` : ''}.`, 'OBSERVED', ['over:street-evidence']);
  }
  if (latest) S('FACT', `העסקה האחרונה ש-PROPX מחזיק לרחוב: ${latest.date} (${latest.sourceId === 'over:deals-register' ? 'הרשם' : 'שכבת GovMap'}${latest.inStatistics ? '' : ', מחיר לא בסטטיסטיקה'}).`,
    `The newest transaction event PROPX holds for the street: ${latest.date} (${latest.sourceId === 'over:deals-register' ? 'register' : 'GovMap layer'}${latest.inStatistics ? '' : ', price not used in statistics'}).`, 'OBSERVED', [latest.sourceId]);
  if (model && model.available && model.value != null) S('MODEL', `מודל PROPX מעריך ₪${fmtN(model.value)}/מ"ר לדירת ייחוס (85 מ"ר, קיימת), רמת ראיות ${model.tier}${model.range ? `; טווח אימות ₪${fmtN(model.range.lo)}–${fmtN(model.range.hi)}` : ''} — לא שומה.`,
    `PROPX's model estimates ₪${fmtN(model.value)}/m² for a reference dwelling (85 m², existing), evidence tier ${model.tier}${model.range ? `; validation range ₪${fmtN(model.range.lo)}–${fmtN(model.range.hi)}` : ''} — not an appraisal.`, 'MODEL', ['propx:street-model']);
  if (pl.available) {
    const P = pl.summary;
    S('FACT', `${P.intersects} תכניות שגבולן כולל חלקה ברחוב, ${P.nearby} בטווח ${NEAR_M} מ'${P.transit ? `, ו-${P.transit} תכניות תחבורה מסילתית בטווח ${TRANSIT_M} מ' (סטטוס סטטוטורי, לא קו פעיל)` : ''}.`,
      `${P.intersects} plans include a parcel of the street, ${P.nearby} lie within ${NEAR_M} m${P.transit ? `, and ${P.transit} rail-transit plans within ${TRANSIT_M} m (statutory status, not an operating line)` : ''}.`, 'DERIVED', ['iplan:xplan', 'over:govmap-layer-file']);
  }
  const city = cmp.rows.find((r) => r.level === 'CITY');
  if (city && city.streetVsLevelPct != null) S('INTERPRETATION', `הרחוב נסחר ${city.streetVsLevelPct < 0 ? 'מתחת' : 'מעל'} לחציון היישוב לכל מ"ר על אותה אוכלוסייה — תיאור של המדגם הנצפה, לא שווי של דירה מסוימת.`,
    `The street trades ${city.streetVsLevelPct < 0 ? 'below' : 'above'} the locality's median per m² on the same population — a description of the observed sample, not the value of a specific dwelling.`, 'INTERPRETATION', ['propx:street-benchmarks']);
  return out;
}

/* the stored window's union only (no history decode): the newest event and the recency, for the first paint */
function coreTx(id) {
  const U = tx().query({ streetId: id, all: true, limit: 1 });
  const first = U.events.find((e) => e.state !== 'POSSIBLE_DUPLICATE') || null;
  return { engine: ENGINE, id, partial: true, latest: first ? rowOut({ ...first, category: categoryOf(first.geo), history: false }) : null, recency: U.recency, total: null, facets: null, rows: [] };
}

/* ───────────────────────── the report ───────────────────────── */
/**
 * The street report (everything but the table's rows beyond its first page).
 * @param id st:<locality>:<street>
 */
function report(id, opt = {}) {
  const t0 = Date.now(), ms = {};
  const D = SD.load();
  const idn = ST.identity(id, D);
  if (!idn) return null;
  let t = Date.now();
  const s = ST.street(idn.id, { limit: 1 });                ms.street = Date.now() - t; t = Date.now();
  const g = streetGeo(idn);                                  ms.geo = Date.now() - t; t = Date.now();
  const hier = hierarchy(idn, s, g);
  const V = svm(); const model = V ? V.estimate(idn.id) : { available: false, reason: 'model-not-built' }; ms.model = Date.now() - t; t = Date.now();
  /* PROGRESSIVE: part=core answers with what is fast (no history decode, no plan tiles) — the page renders it at once and asks for the
     full report beside it; the table pages through view=streetTx */
  const core = opt.part === 'core';
  const txs = core ? coreTx(idn.id) : transactions(idn.id, { limit: Math.min(100, Number(opt.limit) || 25) }); ms.transactions = Date.now() - t; t = Date.now();
  const cmp = comparison(idn, s, g, hier);                    ms.comparison = Date.now() - t; t = Date.now();
  const pl = core ? { available: false, deferred: true, reason: 'loading', municipal: { coverage: s.links.coverage, permits: s.links.totals.permits, sites: s.links.totals.sites } } : planning(idn, g, s.links); ms.planning = Date.now() - t; t = Date.now();
  const fresh = s.freshness || null;
  const A = assessment(idn, s, cmp, pl, model, txs, fresh);
  const N = narrative(idn, hier, s, cmp, pl, model, txs.latest);
  const buildings = (() => {
    const by = new Map();
    for (const e of streetEvents(idn.id).events) if (e.category === 'STREET' && e.houseNumber) for (const h of String(e.houseNumber).split(/,\s*/)) {
      if (!h) continue; const b = by.get(h) || { house: h, events: 0, latest: null, parcels: new Set() }; b.events++; if (!b.latest || e.date > b.latest) b.latest = e.date; if (e.block) b.parcels.add(e.block + '/' + e.parcel); by.set(h, b);
    }
    return [...by.values()].map((b) => ({ ...b, parcels: [...b.parcels].slice(0, 6) })).sort((a, b) => (parseInt(a.house, 10) || 0) - (parseInt(b.house, 10) || 0) || a.house.localeCompare(b.house));
  })();
  const sources = [
    { id: 'datagov:streets', name: 'Official street directory (Population and Immigration Authority, data.gov.il)', cls: 'OFFICIAL', asOf: s.directory.registryUpdated, checkedAt: s.directory.checkedAt },
    { id: 'over:street-evidence', name: 'Tax Authority deals register as republished by over.org.il (register copy)', cls: 'OBSERVED', asOf: s.evidence && s.evidence.source ? s.evidence.source.scrapedAt : null, window: s.evidence ? s.evidence.window : null },
    { id: 'propx:transaction-events', name: 'Transaction events union (register copy + GovMap-layer copy + parcel recovery + stored GovMap history)', cls: 'OBSERVED', asOf: txs.recency ? txs.recency.evidenceCheckedThrough : null },
    { id: 'over:govmap-layer-file', name: 'GovMap-layer file (parcel / building points, neighbourhood labels)', cls: 'OBSERVED', asOf: g.builtAt || null },
    { id: 'iplan:xplan', name: 'Planning Administration — Xplan online plans (statuses + boundaries)', cls: 'OFFICIAL', asOf: pl.fetchedAt },
    { id: 'propx:street-model', name: 'PROPX Street Value Model', cls: 'MODEL', asOf: model && model.meta ? model.meta.asOf : null },
    { id: 'propx:street-benchmarks', name: 'PROPX comparison benchmarks (same population)', cls: 'DERIVED', asOf: cmp.benchmark ? cmp.benchmark.builtAt : null },
  ].concat(s.links.coverage === 'TLV_MUNICIPAL' ? [{ id: 'tlv:iview2:permits-772', name: 'Tel Aviv-Yafo building permits + construction sites (IView2)', cls: 'OFFICIAL', asOf: s.links.fetchedAt }] : []);
  const missing = [];
  const miss = (section, reason, unlock) => missing.push({ section, reason, unlock });
  if (!g.available) miss('map', g.reason, 'a deal on the street in the GovMap-layer file with its official street code');
  if (!pl.available && !pl.deferred) miss('planning', pl.reason, pl.reason === 'plan-boundaries-not-built' ? 'the national plan-boundaries sync' : 'located parcels of the street');
  if (hier.neighbourhood.state !== 'VERIFIED') miss('neighbourhood', hier.neighbourhood.reason, 'a verified street → neighbourhood link');
  if (!(model && model.available && model.value != null)) miss('model', (model && (model.reason || 'not-estimated')) || 'not-estimated', 'street-specific evidence (own deals, ≥ 5 effective in its blocks, or a verified neighbourhood)');
  miss('asking-prices', 'no licensed listings source', 'a licensed listings feed (not integrated — requires founder approval)');
  miss('rents', 'no street-level rent source', 'a licensed rent source (CBS publishes no street rents)');
  miss('transit-stations', 'station points (MOT data.gov.il, CC-BY / other-open) not integrated — the statutory transit plans are shown instead', 'an ingestion of the MOT station layers (shapefiles) with freshness gates');
  return {
    engine: ENGINE, id: idn.id, part: core ? 'core' : 'full', generatedAt: new Date().toISOString(), identity: idn, hierarchy: hier,
    overview: {
      latest: txs.latest, freshness: fresh, counts: s.transactionCounts, evidenceState: s.evidence ? s.evidence.state || (s.evidence.stats && s.evidence.stats.state) : null,
      stats: s.evidence && s.evidence.stats ? { observed: s.evidence.stats.observed, priced: s.evidence.stats.priced, state: s.evidence.stats.state, medianPrice: s.evidence.stats.medianPrice,
        medianPricePerSqm: s.evidence.stats.medianPricePerSqm, last12: s.evidence.stats.last12, change: s.evidence.stats.change } : null,
      model: model && model.available ? { value: model.value, tier: model.tier, range: model.range, reason: model.reason, asOf: model.meta && model.meta.asOf, priceLevelQuarter: model.meta && model.meta.priceLevelQuarter } : { available: false, reason: model ? model.reason : 'model-not-built' },
      narrative: N,
    },
    transactions: txs, comparison: cmp, planning: pl,
    map: g.available ? { available: true, points: g.points.map((p) => [p.lng, p.lat, p.house, p.rows, p.last]), bbox: g.bbox, centroid: g.centroid, extentM: g.extentM, located: g.located,
      validation: g.validation, basis: 'one point per parcel / building polygon the GovMap-layer file places this street\'s deals in (its own coordinates)' } : { available: false, reason: g.reason },
    buildings, assessment: A, sources, missing,
    links: { permits: s.links.permits.slice(0, 20), sites: s.links.sites.slice(0, 20), totals: s.links.totals, coverage: s.links.coverage },
    knows: s.knows, doesNotKnow: s.doesNotKnow,
    terms: ['street_report', 'street_report_relation', 'street_report_source_label', 'street_report_fair_comparison', 'street_report_assessment', 'street_report_property_assessment'],
    timings: { ...ms, totalMs: Date.now() - t0 },
  };
}

/* ───────────────────────── Level 2 property assessment (the user's property and assumptions) ───────────────────────── */
/**
 * @param id st:<locality>:<street>
 * @param p { askingPrice, sqm, rooms?, floor?, built?, newness?: existing|new, type?: flat|garden|roof, rentMonthly?, holdYears?,
 *            bull?, base?, bear? (annual price change %, USER ASSUMPTIONS), costsPct? (purchase + transaction costs, % of price, USER ASSUMPTION) }
 */
function property(id, p = {}) {
  const D = SD.load();
  const idn = ST.identity(id, D);
  if (!idn) return null;
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const ask = n(p.askingPrice), sqm = n(p.sqm), rooms = n(p.rooms), rent = n(p.rentMonthly), hold = n(p.holdYears), costs = n(p.costsPct);
  const inputs = { askingPrice: ask, sqm, rooms, floor: p.floor || null, built: n(p.built), newness: p.newness === 'new' ? 'new' : 'existing', type: ['flat', 'garden', 'roof'].includes(p.type) ? p.type : 'flat',
    rentMonthly: rent, holdYears: hold, costsPct: costs, bull: n(p.bull), base: n(p.base), bear: n(p.bear) };
  const missingInputs = [];
  if (ask == null || ask < 100000) missingInputs.push('askingPrice');
  if (sqm == null || sqm < 20 || sqm > 400) missingInputs.push('sqm');
  const out = { engine: ENGINE, id: idn.id, inputs, cls: 'USER ASSUMPTION + DERIVED', missingInputs };
  if (missingInputs.length) return { ...out, available: false, reason: 'inputs-required', note: 'An asking price and an area are required; PROPX never fills them.' };
  const askSqm = Math.round(ask / sqm);
  /* the model's estimate for the stated profile (the Street Value Model's own apartment read — unchanged) */
  const V = svm();
  const A = V ? V.apartment(idn.id, { sqm, rooms, newness: inputs.newness, built: inputs.built, type: inputs.type }) : null;
  const apt = A && A.apartment ? A.apartment : null;
  const modelVs = apt ? { value: apt.value, ppsqm: apt.ppsqm, range: apt.range, askVsModelPct: pct(ask, apt.value),
    position: apt.range ? (ask < apt.range.lo ? 'BELOW_RANGE' : ask > apt.range.hi ? 'ABOVE_RANGE' : 'WITHIN_RANGE') : null, cls: 'MODEL', note: apt.note } : { available: false, reason: A ? (A.apartmentReason || A.reason || 'not-estimated') : 'model-not-built' };
  /* the street's own priced deals: where the asking ₪/m² sits among them (OBSERVED) + similar deals (±20 % area, the same rooms band) */
  const ev = EV.street(idn.id);
  const priced = ev && ev.swept ? ev.deals.filter((d) => d.priced && d.pricePerSqm != null) : [];
  const sqms = priced.map((d) => d.pricePerSqm).sort((a, b) => a - b);
  const rank = sqms.length >= EV.SAMPLE.SUPPORTED ? Math.round((sqms.filter((x) => x <= askSqm).length / sqms.length) * 100) : null;
  const band = B.bandOf(rooms);
  const similar = priced.filter((d) => d.areaSqm != null && Math.abs(d.areaSqm - sqm) / sqm <= 0.2 && (band == null || B.bandOf(d.rooms) === band))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 12)
    .map((d) => ({ date: d.date, amount: d.amount, areaSqm: d.areaSqm, rooms: d.rooms, pricePerSqm: d.pricePerSqm, yearBuilt: d.yearBuilt, probableNew: d.probableNew, houses: d.houses, parcel: d.gush + '/' + d.helka }));
  const street = { priced: sqms.length, state: ev && ev.swept ? ev.stats.state : 'NOT_SWEPT', medianPricePerSqm: ev && ev.swept ? ev.stats.medianPricePerSqm : null,
    askVsStreetMedianPct: ev && ev.swept && ev.stats.medianPricePerSqm != null && ev.stats.state === 'SUPPORTED' ? pct(askSqm, ev.stats.medianPricePerSqm) : null,
    askPercentile: rank, similar, similarRule: `OBSERVED priced deals on this street within ±20 % of ${sqm} m²${band ? ` and ${band} rooms` : ''}`, cls: 'OBSERVED' };
  /* scenarios — computed ONLY from the user's own annual change assumptions; none entered → none computed (never a default) */
  const scen = {};
  for (const k of ['bull', 'base', 'bear']) {
    const g = inputs[k];
    if (g == null || hold == null || hold <= 0) { scen[k] = null; continue; }
    const value = Math.round(ask * Math.pow(1 + g / 100, hold) / 1000) * 1000;
    const cost = costs != null ? Math.round(ask * costs / 100) : null;
    const rentTotal = rent != null ? rent * 12 * hold : null;
    scen[k] = { annualChangePct: g, years: hold, endValue: value, priceGain: value - ask, costs: cost, rentTotal,
      totalReturnPct: Math.round(((value - ask - (cost || 0) + (rentTotal || 0)) / (ask + (cost || 0))) * 1000) / 10, cls: 'DERIVED from USER ASSUMPTIONS' };
  }
  const income = rent != null ? { grossYieldPct: Math.round((rent * 12 / ask) * 1000) / 10, basis: 'the monthly rent you entered × 12 ÷ the asking price (gross; before vacancy, maintenance, tax)', cls: 'DERIVED from USER ASSUMPTION' } : { available: false, reason: 'enter a monthly rent to compute a gross yield — PROPX holds no street rents' };
  return { ...out, available: true, askPricePerSqm: askSqm, model: modelVs, street, income, scenarios: scen,
    scenarioRule: 'bull / base / bear are the annual price changes YOU entered, compounded over YOUR holding period — PROPX does not forecast prices; none entered → none computed',
    doesNotMean: 'not an appraisal, not a forecast, not a recommendation: the model estimate and the street\'s observed deals are reference points for your own judgment' };
}

module.exports = { ENGINE, report, transactions, transactionsCsv, property, streetGeo, planning, comparison, hierarchy, relation, floorNo, CATEGORY, NEAR_M, TRANSIT_M, AREA_STREET_M, AREA_WIDE_DUNAM };
