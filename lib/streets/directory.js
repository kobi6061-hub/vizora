// PROPX · STREET DIRECTORY — the official Israel street registry as PROPX stores it.
//
// Source (Population and Immigration Authority, data.gov.il, read by scripts/street-sync.js on a GitHub runner):
//   · streets   — "רשימת רחובות בישראל - מתעדכן"            resource 9ad3862c-8391-4b2f-84a4-2d4c68625f4b
//                  fields סמל_ישוב · שם_ישוב · סמל_רחוב · שם_רחוב (one row per locality × street code)
//   · synonyms  — "רשימת רחובות בישראל - קובץ עם סינונימיים"  resource bf185c7f-1a4e-4662-88c5-fa118a244bda
//                  fields region_code · region_name · city_code · city_name · street_code · street_name ·
//                  street_name_status ("official" | "synonym of <code>") · official_code
//
// IDENTITY. A street is `st:<locality code>:<official street code>` — never a name. The same name in two localities is
// two streets; a synonym is a second NAME of one street (it resolves to the official code), never a second street.
//
// ROW KINDS (audited 19.10.2026 over the whole registry — scripts/street-discover.js --profile; documented in
// lib/streets/README.md). The registry is an ADDRESS registry, so not every row is a physical named street:
//   · street   codes 100–5999 and 9001–9999 — named streets, alleys, numbered streets ("רח 200"), squares
//   · area     codes 6000–6999 — neighbourhoods / address areas used as an address without a street ("שכ הכנסייה",
//              "אזור תעשייה", "גבעת רימון"): searchable, labelled ADDRESS AREA, never presented as a street
//   · site     codes 7000–8999 — named sites / institutions used as an address ("בסיס חצרים", "מכללת אריאל",
//              "מרינה הרצליה"): searchable, labelled SITE
//   · locality code 9000 — the locality-name placeholder (an address that is the locality itself, one per
//              locality): kept in the directory, NOT offered as a street in autocomplete — the locality is
//              already searchable as a locality, and a deal addressed to it is a locality-level record
// Nothing is dropped: every official row is stored with its kind, and the coverage audit reconciles the counts.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { baseNorm } = require('../geo/aliases');

const DIR = process.env.STREETS_DIR || path.join(__dirname, '..', '..', 'data', 'geo', 'streets');
const SOURCES = Object.freeze({
  streets: { id: '9ad3862c-8391-4b2f-84a4-2d4c68625f4b', package: '321', name: 'רשימת רחובות בישראל - מתעדכן',
    publisher: 'רשות האוכלוסין וההגירה', publisherEn: 'Population and Immigration Authority' },
  synonyms: { id: 'bf185c7f-1a4e-4662-88c5-fa118a244bda', package: 'israel-streets-synom', name: 'רשימת רחובות בישראל - קובץ עם סינונימיים - מתעדכן',
    publisher: 'רשות האוכלוסין וההגירה', publisherEn: 'Population and Immigration Authority' },
});

const KIND = Object.freeze({ STREET: 'street', AREA: 'area', SITE: 'site', LOCALITY: 'locality' });
/** the row kind from the official street code (see the header) */
function kindOf(code) {
  const c = Number(code);
  if (c === 9000) return KIND.LOCALITY;
  if (c >= 6000 && c <= 6999) return KIND.AREA;
  if (c >= 7000 && c <= 8999) return KIND.SITE;
  return KIND.STREET;
}
/* the synonyms registry's region_code is the CBS natural region / sub-district (נפה); its first digit is the district */
const DISTRICT_OF_REGION = { 1: 'd-jm', 2: 'd-north', 3: 'd-haifa', 4: 'd-center', 5: 'd-ta', 6: 'd-south', 7: 'js-area' };
const districtOfRegion = (r) => (r == null || r === '' ? null : DISTRICT_OF_REGION[String(r).trim()[0]] || null);

const streetId = (cityCode, streetCode) => `st:${Number(cityCode)}:${Number(streetCode)}`;
const parseId = (id) => { const m = /^st:(\d+):(\d+)$/.exec(String(id || '')); return m ? { cityCode: Number(m[1]), streetCode: Number(m[2]) } : null; };
/** the join / match normalization (display names are stored verbatim): quotes, dashes, dots, doubled yud, spaces */
const normName = (s) => baseNorm(s);

/** a directory row; `n` (the normalized name) is computed on first use — 150k names need not be normalized to load */
class StreetRow {
  constructor(cityCode, code, name, kind, status, firstSeen, retiredAt) {
    this.id = streetId(cityCode, code); this.cityCode = cityCode; this.code = code; this.name = name; this.kind = kind;
    this.status = status || 'current'; this.firstSeen = firstSeen || null; this.retiredAt = retiredAt || null;
  }
  get n() { if (this._n === undefined) Object.defineProperty(this, '_n', { value: normName(this.name), enumerable: false }); return this._n; }
}
class SynonymRow {
  constructor(cityCode, code, name, officialCode) { this.cityCode = cityCode; this.code = code; this.name = name; this.officialCode = officialCode; }
  get n() { if (this._n === undefined) Object.defineProperty(this, '_n', { value: normName(this.name), enumerable: false }); return this._n; }
}
/* a lookup built on first use (not every reader needs every map) */
const lazy = (o, name, fn) => Object.defineProperty(o, name, { configurable: true, enumerable: true, get() { const v = fn(); Object.defineProperty(o, name, { value: v, enumerable: true }); return v; } });

let CACHE = null;
/**
 * The stored directory (data/geo/streets/, bot-written by scripts/street-sync.js).
 * @returns {{fileHash:{directory,synonyms}, meta, localities:Map<code,{code,he,region,regionName,district}>, streets:Array, byId:Map, byCity:Map<code,Array>,
 *            synonyms:Array<{cityCode,code,name,officialCode}>, synByStreet:Map<id,Array>}}
 */
function load(opt = {}) {
  const dir = opt.dir || DIR;
  if (CACHE && CACHE.dir === dir) return CACHE;
  /* the files' sha256 identifies this exact directory (the prebuilt search index records the pair it was built from) */
  const fileHash = {};
  const read = (f, key) => { const b = fs.readFileSync(path.join(dir, f)); fileHash[key] = crypto.createHash('sha256').update(b).digest('hex'); return JSON.parse(b.toString('utf8')); };
  const d = read('directory.json', 'directory');
  const s = read('synonyms.json', 'synonyms');
  const localities = new Map(d.localities.map((r) => { const [code, he, region, regionName] = r; return [code, { code, he, region, regionName, district: districtOfRegion(region) }]; }));
  const c = Object.fromEntries(d.columns.map((x, i) => [x, i]));
  const streets = d.rows.map((r) => new StreetRow(r[c.cityCode], r[c.streetCode], r[c.name], r[c.kind], r[c.status], r[c.firstSeen], r[c.retiredAt]));
  const y = Object.fromEntries(s.columns.map((x, i) => [x, i]));
  const synonyms = s.rows.map((r) => new SynonymRow(r[y.cityCode], r[y.code], r[y.name], r[y.officialCode]));
  CACHE = { dir, fileHash, meta: d.meta, synMeta: s.meta, localities, streets, synonyms };
  lazy(CACHE, 'byId', () => new Map(streets.map((x) => [x.id, x])));
  lazy(CACHE, 'byCity', () => { const m = new Map(); for (const x of streets) { if (!m.has(x.cityCode)) m.set(x.cityCode, []); m.get(x.cityCode).push(x); } return m; });
  lazy(CACHE, 'synByStreet', () => { const m = new Map(); for (const x of synonyms) { const id = streetId(x.cityCode, x.officialCode); if (!m.has(id)) m.set(id, []); m.get(id).push(x); } return m; });
  return CACHE;
}
const reset = () => { CACHE = null; };

module.exports = { SOURCES, KIND, kindOf, districtOfRegion, DISTRICT_OF_REGION, streetId, parseId, normName, load, reset, DIR };
