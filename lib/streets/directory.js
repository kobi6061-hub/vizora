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

let CACHE = null;
/**
 * The stored directory (data/geo/streets/, bot-written by scripts/street-sync.js).
 * @returns {{meta, localities:Map<code,{code,he,region,regionName,district}>, streets:Array, byId:Map, byCity:Map<code,Array>,
 *            synonyms:Array<{cityCode,code,name,officialCode}>, synByStreet:Map<id,Array>}}
 */
function load(opt = {}) {
  const dir = opt.dir || DIR;
  if (CACHE && CACHE.dir === dir) return CACHE;
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const d = read('directory.json');
  const s = read('synonyms.json');
  const localities = new Map(d.localities.map((r) => { const [code, he, region, regionName] = r; return [code, { code, he, region, regionName, district: districtOfRegion(region) }]; }));
  const col = Object.fromEntries(d.columns.map((c, i) => [c, i]));
  const streets = d.rows.map((r) => {
    const cityCode = r[col.cityCode], code = r[col.streetCode];
    return { id: streetId(cityCode, code), cityCode, code, name: r[col.name], kind: r[col.kind], status: r[col.status] || 'current',
      firstSeen: r[col.firstSeen] || null, retiredAt: r[col.retiredAt] || null, n: normName(r[col.name]) };
  });
  const byId = new Map(streets.map((x) => [x.id, x]));
  const byCity = new Map();
  for (const x of streets) { if (!byCity.has(x.cityCode)) byCity.set(x.cityCode, []); byCity.get(x.cityCode).push(x); }
  const scol = Object.fromEntries(s.columns.map((c, i) => [c, i]));
  const synonyms = s.rows.map((r) => ({ cityCode: r[scol.cityCode], code: r[scol.code], name: r[scol.name], officialCode: r[scol.officialCode], n: normName(r[scol.name]) }));
  const synByStreet = new Map();
  for (const y of synonyms) { const id = streetId(y.cityCode, y.officialCode); if (!synByStreet.has(id)) synByStreet.set(id, []); synByStreet.get(id).push(y); }
  CACHE = { dir, meta: d.meta, synMeta: s.meta, localities, streets, byId, byCity, synonyms, synByStreet };
  return CACHE;
}
const reset = () => { CACHE = null; };

module.exports = { SOURCES, KIND, kindOf, districtOfRegion, DISTRICT_OF_REGION, streetId, parseId, normName, load, reset, DIR };
