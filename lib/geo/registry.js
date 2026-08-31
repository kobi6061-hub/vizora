// PROPX · national geography search — serves the canonical Israel registry
// (data/geo/, built by scripts/build-geo-registry.py) with normalized Hebrew
// matching. Identity is canonical ids (loc:<code> / st:<cityCode>:<code>,
// provisional locp:/stp: until the next code-bearing refresh) — display
// names are never keys. The module is product-agnostic: it does not know
// which localities have rich market rows; the client decides routing.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { aliasKeys, queryKeys } = require('./aliases');
const { resolveNeighborhood } = require('./neighborhoods');

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
  CACHE = { localities, byName, byCode, streets, streetsByCity, meta: loc.meta, index: null };
  return CACHE;
}

/* Inverted alias index — every official name is expanded once into its
   normalized search keys, so a query never scans 63k rows and every spelling
   variant resolves to the SAME canonical record. Built lazily, cached for
   the life of the process. */
function buildIndex(G) {
  if (G.index) return G.index;
  const exact = new Map();                 // key -> [{t:'l'|'s', i}]
  const push = (k, e) => {
    if (!k || k.length < 2) return;
    const a = exact.get(k); if (a) { a.push(e); } else { exact.set(k, [e]); }
  };
  G.localities.forEach((l, i) => { for (const k of aliasKeys(l.he)) push(k, { t: 'l', i }); });
  G.streets.forEach((s2, i) => { for (const k of aliasKeys(s2.street)) push(k, { t: 's', i }); });
  const sorted = [...exact.keys()].sort();
  G.index = { exact, sorted };
  return G.index;
}

/** lower-bound binary search for prefix lookups */
function prefixHits(idx, q, cap) {
  const { sorted, exact } = idx;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < q) lo = m + 1; else hi = m; }
  const out = [];
  for (let i = lo; i < sorted.length && sorted[i].startsWith(q) && out.length < cap; i++) {
    for (const e of exact.get(sorted[i])) { out.push({ e, key: sorted[i] }); if (out.length >= cap) break; }
  }
  return out;
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
  // a street is never withheld for want of a neighborhood — the field simply
  // states whether one could be resolved, and by what method
  const nb = resolveNeighborhood(s.city, s.street);
  return { kind: 'street', id: stId(s), he: s.street, city: s.city,
    cityCode: s.cityCode, streetCode: s.streetCode,
    cityId: cityLoc ? locId(cityLoc) : null,
    district: cityLoc ? cityLoc.district : null,
    lat: cityLoc ? cityLoc.lat : null, lng: cityLoc ? cityLoc.lng : null,
    neighborhood: nb.resolved ? nb.name : null,
    neighborhoodStatus: nb.resolved ? nb.method : 'unresolved',
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
  const idx = buildIndex(G);
  const seen = new Set();
  const addLoc = (i) => { const l = G.localities[i]; const o = locOut(l, G);
    if (!seen.has(o.id)) { seen.add(o.id); out.push(o); } };
  const addSt = (i) => { const st = G.streets[i]; const o = stOut(st, G);
    if (!seen.has(o.id)) { seen.add(o.id); out.push(o); } };

  // 1 · exact alias hits (any spelling variant of an official name)
  const qk = queryKeys(q);
  const locFirst = [], stFirst = [];
  for (const k of qk) for (const e of (idx.exact.get(k) || [])) (e.t === 'l' ? locFirst : stFirst).push(e.i);
  locFirst.slice(0, 5).forEach(addLoc);

  // 2 · compound "street city" / "city street" — the city side narrows,
  //     so an identical street name in another locality can never win
  const words = qNoPrefix.split(' ');
  const compound = [];
  if (words.length >= 2) {
    for (let i = 1; i < words.length; i++) {
      for (const [stPart, ctPart] of [
        [words.slice(0, i).join(' '), words.slice(i).join(' ')],
        [words.slice(i).join(' '), words.slice(0, i).join(' ')],
      ]) {
        const ctAliased = normHe(CITY_ALIASES[ctPart] || ctPart);
        const cities = [];
        for (const [nc] of G.streetsByCity) {
          if (nc === ctAliased || (ctAliased.length >= 3 && nc.startsWith(ctAliased))) cities.push(nc);
          if (cities.length > 6) break;
        }
        if (!cities.length) continue;
        const sk = queryKeys(stPart);
        for (const nc of cities) {
          for (const st of G.streetsByCity.get(nc)) {
            let r = -1;
            for (const k of sk) { const rr = rank(st.n, k); if (rr >= 0 && (r < 0 || rr < r)) r = rr; }
            if (r >= 0) compound.push([r, st]);
          }
        }
      }
    }
  }
  compound.sort((a, b) => a[0] - b[0] || a[1].n.length - b[1].n.length);
  for (const [, st] of compound.slice(0, limit)) {
    const o = stOut(st, G); if (!seen.has(o.id)) { seen.add(o.id); out.push(o); }
  }

  // 3 · indexed prefix matches (localities first, then streets) — no scan
  if (out.length < limit) {
    for (const k of qk) {
      for (const { e } of prefixHits(idx, k, 400)) {
        if (out.length >= limit + 6) break;
        if (e.t === 'l') addLoc(e.i);
      }
    }
    stFirst.forEach((i) => { if (out.length < limit + 6) addSt(i); });
    for (const k of qk) {
      for (const { e } of prefixHits(idx, k, 400)) {
        if (out.length >= limit + 6) break;
        if (e.t === 's') addSt(e.i);
      }
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
