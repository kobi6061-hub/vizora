// PROPX · VATMAL DECLARED COMPLEXES (21.10.2026, the master data directive M5 / §6.6) — the Planning Administration's layer of complexes
// DECLARED for the National Committee for Preferred Housing Areas (ותמ"ל — PlanningPublic/vatmal_mitchamim_muchrazim/MapServer/0, 203
// polygons on 21.10.2026): the tamal number, the complex's name, the locality NAME(S) as printed, the district, the submitter, the declared
// area, the declared housing units and the declaration / update dates — read whole (complete or nothing is written) by scripts/vatmal-sync.js.
//
// A declaration is a planning-track designation: never an approved plan, never a permit, never construction — the units are the
// declaration's, never the street's. The locality is printed as text (sometimes several, e.g. "קרית אונו ורמת גן, שטח גלילי") and is never
// mapped to a locality code; a complex reaches a street only through a SPATIAL relation (a located point inside / within 300 m).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const LAYER = 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/vatmal_mitchamim_muchrazim/MapServer/0';
const FIELDS = ['OBJECTID', 'tamal_numb', 'mitham', 'yeshuv', 'mahoz', 'megish', 'area_plan', 'dunam_gis', 'yehidot', 'date_', 'update_dat1', 'update_dat2', 'update_dat3', 'tama_deviation'];
const DIR = process.env.VATMAL_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'planning', 'vatmal');
const SOURCE = Object.freeze({ id: 'iplan:vatmal', publisher: 'מינהל התכנון', publisherEn: 'Planning Administration', layer: LAYER, classification: 'OFFICIAL',
  page: 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/vatmal_mitchamim_muchrazim/MapServer', licence: 'Planning Administration open data (CC BY, as the Xplan services on data.gov.il)',
  title: 'ותמ"ל — מתחמים מוכרזים', titleEn: 'VATMAL — declared preferred-housing complexes' });

const txt = (v) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return s && s !== 'Null' ? s : null; };
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const day = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null);

/** one ArcGIS feature (outSR 4326) → a complex, or null with no geometry / no tamal number */
function normalize(f) {
  const a = (f && f.attributes) || {}, g = (f && f.geometry) || {};
  const rings = Array.isArray(g.rings) ? g.rings.filter((r) => Array.isArray(r) && r.length >= 4).map((r) => r.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])) : [];
  const tamal = txt(a.tamal_numb);
  if (!rings.length || !tamal) return null;
  const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
  return { oid: num(a.OBJECTID), tamal, name: txt(a.mitham), localityText: txt(a.yeshuv), district: txt(a.mahoz), submitter: txt(a.megish),
    declaredDunam: num(a.area_plan), gisDunam: num(a.dunam_gis) != null ? Math.round(num(a.dunam_gis)) : null, units: num(a.yehidot),
    declared: day(a.date_), updates: [a.update_dat1, a.update_dat2, a.update_dat3].map(day).filter(Boolean), tamaDeviationApproved: day(a.tama_deviation),
    rings, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

let CACHE = null;
function load(dir = DIR) {
  const mf = path.join(dir, 'meta.json');
  let m; try { m = fs.statSync(mf).mtimeMs; } catch { return null; }
  if (CACHE && CACHE.dir === dir && CACHE.m === m) return CACHE.v;
  const meta = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const complexes = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'complexes.json.gz'))).toString('utf8'));
  CACHE = { dir, m, v: { meta, complexes } };
  return CACHE.v;
}

module.exports = { LAYER, FIELDS, DIR, SOURCE, normalize, load };
