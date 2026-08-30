// PROPX · national geography search — serves the canonical Israel registry
// (data/geo/, built by scripts/build-geo-registry.py) with normalized Hebrew
// matching. Identity is canonical ids (loc:<code> / st:<cityCode>:<code>,
// provisional locp:/stp: until the next code-bearing refresh) — display
// names are never keys. The module is product-agnostic: it does not know
// which localities have rich market rows; the client decides routing.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GEO_DIR = path.join(__dirname, '..', '..', 'data', 'geo');

// city-name aliases (curated; the official synonyms dataset plugs into the
// same map on the next refresh — see registry-meta.json sources.synonyms)
const CITY_ALIASES = {
  'תא': 'תל אביב-יפו', 'ת"א': 'תל אביב-יפו', 'תל אביב': 'תל אביב-יפו',
  'ראשלצ': 'ראשון לציון', 'ראשל"צ': 'ראשון לציון',
  'ב"ש': 'באר שבע', 'בש': 'באר שבע',
  'פ"ת': 'פתח תקווה', 'פת': 'פתח תקווה', 'פתח תקוה': 'פתח תקווה',
  'י-ם': 'ירושלים', 'כ"ס': 'כפר סבא', 'ק. גת': 'קרית גת',
};
const STREET_PREFIX = /^(רחוב|רח'|רח|שדרות|שד'|שד|דרך|סמטת|סמ')\s+/;

function normHe(s) {
  if (!s) return '';
  let t = String(s).normalize('NFKC');
  t = t.replace(/[׳'`’‘]/g, '').replace(/[״"“”]/g, '');
  t = t.replace(/[־–]/g, '-').replace(/\./g, ' ');
  t = t.replace(/\s*-\s*/g, '-').replace(/[()]/g, ' ');
  t = t.replace(/יי/g, 'י'); // spelling variants: קריית/קרית, בניין/בנין …
  return t.replace(/\s+/g, ' ').trim();
}

let CACHE = null;
function loadGeo() {
  if (CACHE) return CACHE;
  const loc = JSON.parse(fs.readFileSync(path.join(GEO_DIR, 'localities.json'), 'utf8'));
  const st = JSON.parse(fs.readFileSync(path.join(GEO_DIR, 'streets-index.json'), 'utf8'));
  const localities = loc.localities.map((l) => ({ ...l, n: normHe(l.he) }));
  const byName = new Map(localities.map((l) => [l.n, l]));
  const byCode = new Map(localities.filter((l) => l.code).map((l) => [l.code, l]));
  // streets: [cityCode|null, streetCode|null, street, city]
  const streets = st.streets.map((r) => ({
    cityCode: r[0], streetCode: r[1], street: r[2], city: r[3],
    n: normHe(r[2]), nc: normHe(r[3]),
  }));
  const streetsByCity = new Map();
  for (const s of streets) {
    if (!streetsByCity.has(s.nc)) streetsByCity.set(s.nc, []);
    streetsByCity.get(s.nc).push(s);
  }
  CACHE = { localities, byName, byCode, streets, streetsByCity, meta: loc.meta };
  return CACHE;
}

const locId = (l) => l.code ? 'loc:' + l.code : 'locp:' + l.n.replace(/\s/g, '_');
const stId = (s) => (s.cityCode && s.streetCode) ? `st:${s.cityCode}:${s.streetCode}`
  : `stp:${s.cityCode || normHe(s.city).replace(/\s/g, '_')}:${s.n.replace(/\s/g, '_')}`;

function locOut(l, G) {
  return { kind: 'locality', id: locId(l), he: l.he, en: l.en, code: l.code,
    district: l.district, lat: l.lat, lng: l.lng, moatza: l.moatza,
    streetsCount: G ? (G.streetsByCity.get(l.n) || []).length : undefined,
    pendingCode: !l.code || undefined };
}
function stOut(s, G) {
  const cityLoc = G.byName.get(s.nc);
  return { kind: 'street', id: stId(s), he: s.street, city: s.city,
    cityCode: s.cityCode, streetCode: s.streetCode,
    cityId: cityLoc ? locId(cityLoc) : null,
    district: cityLoc ? cityLoc.district : null,
    lat: cityLoc ? cityLoc.lat : null, lng: cityLoc ? cityLoc.lng : null,
    pendingCode: !s.streetCode || undefined };
}

/** rank: exact 0, startsWith 1, wordStart 2, includes 3, none -1 */
function rank(n, q) {
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(' ' + q) || n.includes('-' + q)) return 2;
  if (n.includes(q)) return 3;
  return -1;
}

/**
 * National search. Understands "street city" / "city street" compound
 * queries, curated aliases and street prefixes (רחוב/שד'/דרך…).
 * @returns {matches:[…], meta:{indexBuiltAt}}
 */
function searchGeo(query, limit = 12) {
  const G = loadGeo();
  let q = normHe(query);
  if (!q || q.length < 2) return { matches: [], meta: { indexBuiltAt: G.meta.builtAt } };
  const aliased = CITY_ALIASES[q];
  if (aliased) q = normHe(aliased);
  const qNoPrefix = normHe(q.replace(STREET_PREFIX, ''));

  const out = [];

  // 1 · locality matches
  const locHits = [];
  for (const l of G.localities) {
    const r = rank(l.n, q);
    if (r >= 0) locHits.push([r, l]);
  }
  locHits.sort((a, b) => a[0] - b[0] || a[1].n.length - b[1].n.length);
  for (const [, l] of locHits.slice(0, 5)) out.push(locOut(l, G));

  // 2 · compound "street city": try every split point, city side aliased
  const words = qNoPrefix.split(' ');
  const compound = [];
  if (words.length >= 2) {
    for (let i = 1; i < words.length; i++) {
      for (const [stPart, ctPart] of [
        [words.slice(0, i).join(' '), words.slice(i).join(' ')],
        [words.slice(i).join(' '), words.slice(0, i).join(' ')],
      ]) {
        const ctAliased = normHe(CITY_ALIASES[ctPart] || ctPart);
        for (const [nc, list] of G.streetsByCity) {
          if (nc === ctAliased || (ctAliased.length >= 3 && nc.startsWith(ctAliased))) {
            for (const s of list) {
              const r = rank(s.n, stPart);
              if (r >= 0) compound.push([r, s]);
            }
          }
        }
      }
    }
  }
  compound.sort((a, b) => a[0] - b[0] || a[1].n.length - b[1].n.length);
  for (const [, s] of compound.slice(0, limit)) out.push(stOut(s, G));

  // 3 · plain street-name matches across the country (collision-safe:
  //     every row is city-qualified; identical names appear per city)
  if (out.length < limit) {
    const stHits = [];
    for (const s of G.streets) {
      const r = rank(s.n, qNoPrefix);
      if (r >= 0) { stHits.push([r, s]); if (stHits.length > 400) break; }
    }
    stHits.sort((a, b) => a[0] - b[0] || a[1].n.length - b[1].n.length);
    for (const [, s] of stHits) {
      if (out.length >= limit + 5) break;
      if (!out.some((o) => o.id === stId(s))) out.push(stOut(s, G));
    }
  }

  return { matches: out.slice(0, limit), meta: { indexBuiltAt: G.meta.builtAt } };
}

/** Resolve a canonical id back to its record (for QA + deep links). */
function resolveGeoId(id) {
  const G = loadGeo();
  if (id.startsWith('loc:')) {
    const l = G.byCode.get(Number(id.slice(4)));
    return l ? locOut(l, G) : null;
  }
  const m = id.match(/^st:(\d+):(\d+)$/);
  if (m) {
    const s = G.streets.find((x) => x.cityCode === Number(m[1]) && x.streetCode === Number(m[2]));
    return s ? stOut(s, G) : null;
  }
  return null;
}

module.exports = { searchGeo, resolveGeoId, normHe, loadGeo, CITY_ALIASES };
