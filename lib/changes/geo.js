// PROPX · What Changed Here? — the geography a change feed is asked about (21.10.2026).
//
//   street         st:<locality>:<street code>   an official street of the Population and Immigration Authority's directory
//   neighbourhood  nb:<id>                       a VERIFIED neighbourhood only — its streets are the verified street links,
//                                                 resolved exactly inside the locality (lib/streets/street.js's own rule)
//   locality       loc:<code> | <code>           an official locality (data/geo/localities.json)
//   district       d-… | js-area                 one of the seven districts (the localities that carry it)
//   Israel         il
//
// resolve(id) → { ok: true, geo } · { ok: false, status: 400 | 404, error }. Nothing here guesses: an unknown id is a 404, a
// malformed one a 400.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILES = {
  localities: path.join(__dirname, '..', '..', 'data', 'geo', 'localities.json'),
  neighbourhoods: path.join(__dirname, '..', '..', 'data', 'geo', 'neighborhoods.json'),
};
const DISTRICTS = Object.freeze({
  'd-jm': { he: 'מחוז ירושלים', en: 'Jerusalem District', cbs: 'd-jm' },
  'd-north': { he: 'מחוז הצפון', en: 'Northern District', cbs: 'd-north' },
  'd-haifa': { he: 'מחוז חיפה', en: 'Haifa District', cbs: 'd-haifa' },
  'd-center': { he: 'מחוז המרכז', en: 'Central District', cbs: 'd-center' },
  'd-ta': { he: 'מחוז תל אביב', en: 'Tel Aviv District', cbs: 'd-ta' },
  'd-south': { he: 'מחוז הדרום', en: 'Southern District', cbs: 'd-south' },
  'js-area': { he: 'יהודה ושומרון', en: 'Judea and Samaria Area', cbs: 'jsr' },
});
const ID_RE = /^(?:st:\d{1,6}:\d{1,6}|nb:[a-z0-9-]{1,60}|loc:\d{1,6}|\d{1,6}|d-[a-z]{2,8}|js-area|il)$/;

const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
let LOCS = null;
function localities() {
  const m = mtime(FILES.localities);
  if (LOCS && LOCS.m === m) return LOCS;
  let doc = null; try { doc = JSON.parse(fs.readFileSync(FILES.localities, 'utf8')); } catch { doc = null; }
  const byCode = new Map(), byDistrict = new Map();
  for (const l of (doc && doc.localities) || []) {
    byCode.set(Number(l.code), l);
    if (l.district) { if (!byDistrict.has(l.district)) byDistrict.set(l.district, []); byDistrict.get(l.district).push(Number(l.code)); }
  }
  LOCS = { m, byCode, byDistrict };
  return LOCS;
}
let NB = null;
function neighbourhoods() {
  const m = mtime(FILES.neighbourhoods);
  if (NB && NB.m === m) return NB;
  let doc = null; try { doc = JSON.parse(fs.readFileSync(FILES.neighbourhoods, 'utf8')); } catch { doc = null; }
  NB = { m, doc: doc || { neighborhoods: [], streetLinks: [] } };
  return NB;
}
let DIR = null;
const directory = () => { if (!DIR) DIR = require('../streets/directory').load(); return DIR; };

const locName = (l) => ({ he: l.he, en: l.en ? String(l.en).toLowerCase().replace(/(^|[\s\-'(])(\p{Ll})/gu, (x, a, c) => a + c.toUpperCase()) : l.he });

/** a locality's own record → the geography's `locality` block */
function localityOf(code) {
  const l = localities().byCode.get(Number(code));
  return l ? { code: Number(l.code), name: locName(l), district: l.district || null } : null;
}

function streetGeo(id) {
  const D = directory();
  const s = D.byId.get(id);
  if (!s || s.kind === 'locality') return { ok: false, status: 404, error: 'unknown-street' };
  const loc = localityOf(s.cityCode) || { code: s.cityCode, name: { he: (D.localities.get(s.cityCode) || {}).he || String(s.cityCode), en: String(s.cityCode) }, district: (D.localities.get(s.cityCode) || {}).district || null };
  return { ok: true, geo: { kind: 'street', id: s.id, name: { he: s.name, en: s.name }, streetKind: s.kind, status: s.status, locality: loc, district: loc.district,
    streets: [{ id: s.id, cityCode: s.cityCode, code: s.code, name: s.name }] } };
}

function neighbourhoodGeo(id) {
  const { doc } = neighbourhoods();
  const n = (doc.neighborhoods || []).find((x) => x.id === id);
  if (!n) return { ok: false, status: 404, error: 'unknown-neighbourhood' };
  const TX = require('../txevents');
  const l = TX.localityByName(n.localityHe);
  if (!l) return { ok: false, status: 404, error: 'neighbourhood-locality-not-resolved' };
  const D = directory(), M = require('../streets/match'), SD = require('../streets/directory');
  const LI = M.localityIndex(D, l.code);
  const streets = [];
  for (const link of doc.streetLinks || []) {
    if (link.neighborhoodId !== id) continue;
    const r = M.resolveStreet(LI, link.street);
    if (!r || !r.id || r.ambiguous) continue;
    const p = SD.parseId(r.id), s = D.byId.get(r.id);
    if (s && !streets.some((x) => x.id === s.id)) streets.push({ id: s.id, cityCode: p.cityCode, code: p.streetCode, name: s.name, linkedAs: link.street });
  }
  const loc = localityOf(l.code);
  return { ok: true, geo: { kind: 'neighbourhood', id, name: { he: n.he, en: n.en || n.he }, verified: true, source: n.source || null, locality: loc, district: loc ? loc.district : null, streets } };
}

function localityGeo(code) {
  const loc = localityOf(code);
  if (!loc) return { ok: false, status: 404, error: 'unknown-locality' };
  return { ok: true, geo: { kind: 'locality', id: 'loc:' + loc.code, name: loc.name, locality: loc, district: loc.district, streets: [] } };
}

function districtGeo(id) {
  const d = DISTRICTS[id];
  if (!d) return { ok: false, status: 404, error: 'unknown-district' };
  const codes = localities().byDistrict.get(id) || [];
  return { ok: true, geo: { kind: 'district', id, name: { he: d.he, en: d.en }, district: id, cbsGeo: d.cbs, localityCodes: codes.slice().sort((a, b) => a - b), streets: [] } };
}

/**
 * @param raw the `geo` parameter (or its aliases already folded in by the caller)
 */
function resolve(raw) {
  const id = String(raw == null || raw === '' ? 'il' : raw).trim();
  if (!ID_RE.test(id)) return { ok: false, status: 400, error: 'bad-geo', detail: 'geo must be il · d-<district> · js-area · loc:<code> · nb:<id> · st:<locality>:<street>' };
  if (id === 'il') return { ok: true, geo: { kind: 'il', id: 'il', name: { he: 'ישראל', en: 'Israel' }, district: null, streets: [] } };
  if (id.startsWith('st:')) return streetGeo(id);
  if (id.startsWith('nb:')) return neighbourhoodGeo(id);
  if (/^loc:\d+$/.test(id) || /^\d+$/.test(id)) return localityGeo(id.replace(/^loc:/, ''));
  return districtGeo(id);
}

/** the locality codes a geography covers (a street / neighbourhood → its locality; a district → its localities; Israel → null = all) */
function localityCodesOf(geo) {
  if (geo.kind === 'il') return null;
  if (geo.kind === 'district') return new Set(geo.localityCodes);
  return new Set(geo.locality ? [geo.locality.code] : []);
}

function districtsList() { return Object.entries(DISTRICTS).map(([id, d]) => ({ id, he: d.he, en: d.en })); }
/** the VERIFIED neighbourhoods (data/geo/neighborhoods.json) with the locality each resolves to — only those whose locality resolves */
function neighbourhoodsList() {
  const { doc } = neighbourhoods(); const TX = require('../txevents');
  const linked = new Set((doc.streetLinks || []).map((l) => l.neighborhoodId));
  return (doc.neighborhoods || []).map((n) => { const l = TX.localityByName(n.localityHe); return l ? { id: n.id, he: n.he, en: n.en || n.he, localityCode: Number(l.code), localityHe: n.localityHe, streetLinks: linked.has(n.id) } : null; }).filter(Boolean);
}

module.exports = { resolve, localityOf, localityCodesOf, localities, DISTRICTS, districtsList, neighbourhoodsList, ID_RE, FILES };
