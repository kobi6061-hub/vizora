// PROPX · national geography search — serves the OFFICIAL Israel street directory (data/geo/streets/, synced from the
// Population and Immigration Authority's registry by scripts/street-sync.js; lib/streets/directory.js) and the locality
// layer (data/geo/localities.json). Every official street is searchable whether or not PROPX holds a transaction, a
// project or a permit on it — the directory and the market evidence are separate layers.
//
// Identity is canonical: `loc:<code>` (`locp:<slug>` while a locality's code is pending) and `st:<locality>:<street>`.
// A display name is never a key; the same name in two localities is two streets; an official SYNONYM resolves to its
// street (never a second street); fuzzy matching finds candidates and never changes an identity.
//
// Ranking (the request of 19.10.2026); inside a tier the typed full name before a variant key of it, then the selected locality,
// the larger locality (by its number of official named streets), the shorter name:
//   1 exact official name in the selected locality      4 exact official name elsewhere
//   2 exact official synonym in the selected locality   5 exact official synonym elsewhere
//   3 prefix of an official name in the selected        6 normalized matches (prefix elsewhere · a word of the name ·
//     locality (or of a synonym there)                    contained) — discovery only
// "Selected locality" = the `near` argument (the page sends the locality in view) or a locality named inside the query
// ("הרצל פתח תקווה"). Row kinds: street · area (address area, codes 6000–6999) · site (7000–8999); the locality
// placeholder (9000) is the locality itself and is never offered as a street. Historical streets (no longer in the
// registry) stay resolvable and searchable, ranked after the current ones of the same tier and labelled.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { aliasKeys, queryKeys, foldFinals } = require('./aliases');
const { spellKey } = require('../streets/match');
const { resolveNeighborhood } = require('./neighborhoods');
const SD = require('../streets/directory');
const SI = require('../streets/search-index');

const GEO_DIR = path.join(__dirname, '..', '..', 'data', 'geo');

// city-name aliases (curated; the official former names come from localities.json `aliases`)
const CITY_ALIASES = {
  'תא': 'תל אביב-יפו', 'ת"א': 'תל אביב-יפו', 'תל אביב': 'תל אביב-יפו',
  'ראשלצ': 'ראשון לציון', 'ראשל"צ': 'ראשון לציון',
  'ב"ש': 'באר שבע', 'בש': 'באר שבע',
  'פ"ת': 'פתח תקווה', 'פת': 'פתח תקווה', 'פתח תקוה': 'פתח תקווה',
  'י-ם': 'ירושלים', 'כ"ס': 'כפר סבא', 'ק. גת': 'קרית גת',
};
const STREET_PREFIX = /^(רחוב|רח'|רח|שדרות|שד'|שד|דרך|סמטת|סמ'|שכונת|שכונה)\s+/;

function normHe(s) {
  if (!s) return '';
  let t = String(s).normalize('NFKC');
  /* niqqud / cantillation (not the maqaf) and bidi marks pasted with a name; list separators are spaces */
  t = t.replace(/[\u0591-\u05BD\u05BF-\u05C7\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
  t = t.replace(/[׳'`’‘]/g, '').replace(/[״"“”]/g, '');
  t = t.replace(/[־–—]/g, '-').replace(/\./g, ' ').replace(/[,;/\\|]/g, ' ');
  t = t.replace(/\s*-\s*/g, '-').replace(/[()]/g, ' ');
  t = t.replace(/יי/g, 'י'); // spelling variants: קריית/קרית, בניין/בנין …
  return t.replace(/\s+/g, ' ').trim();
}

/* a searchable directory row with the legacy field names (street / city / streetCode); `n` is computed on first use */
class StreetRow {
  constructor(s, c) { this.id = s.id; this.cityCode = s.cityCode; this.streetCode = s.code; this.street = s.name; this.city = c.he; this.kind = s.kind; this.status = s.status; this.nc = c.n; this.row = s; }
  get n() { return this.row.n; }
}

/* a searchable synonym row: `n` (normalized) is the directory row's own lazy value — not computed for 86k rows at load */
class SynRow {
  constructor(y, i) { this.name = y.name; this.i = i; this.row = y; }
  get n() { return this.row.n; }
}

let CACHE = null;
/**
 * The geography in memory: localities (localities.json merged with the directory's own locality codes) and every
 * official directory row of kind street / area / site, plus the synonyms that name them.
 */
function loadGeo() {
  if (CACHE) return CACHE;
  const loc = JSON.parse(fs.readFileSync(path.join(GEO_DIR, 'localities.json'), 'utf8'));
  const D = SD.load();
  const fromFile = loc.localities.map((l) => ({ ...l, n: normHe(l.he) }));
  const fileByCode = new Map(fromFile.filter((l) => l.code).map((l) => [l.code, l]));
  const pendingByName = new Map(fromFile.filter((l) => !l.code).map((l) => [l.n, l]));
  const localities = [];
  const seenCodes = new Set();
  for (const [code, d] of D.localities) {
    const f = fileByCode.get(code) || pendingByName.get(normHe(d.he));
    /* a locality the file listed without a code takes the directory's official code — same locality, same name */
    localities.push(f ? { ...f, code, id: 'loc:' + code, n: normHe(f.he), district: f.district || d.district, region: d.region }
      : { id: 'loc:' + code, code, he: d.he, en: null, lat: null, lng: null, napa: d.region != null ? String(d.region) : null, district: d.district, moatza: null, n: normHe(d.he), region: d.region });
    seenCodes.add(code);
    if (f && !f.code) pendingByName.delete(f.n);
  }
  for (const l of fromFile) if ((l.code && !seenCodes.has(l.code)) || (!l.code && pendingByName.has(l.n))) localities.push(l);   // listed, never dropped
  const byName = new Map(localities.map((l) => [l.n, l]));
  const cityByAlias = new Map();
  for (const l of localities) for (const a of l.aliases || []) if (!byName.has(normHe(a))) cityByAlias.set(normHe(a), l.n);
  const byCode = new Map(localities.filter((l) => l.code).map((l) => [l.code, l]));

  /* streets: every directory row except the locality placeholder; legacy field names (street / city / streetCode) kept */
  const streets = [];
  const placeholders = new Map();
  const cityOf = new Map();
  for (const s of D.streets) {
    if (s.kind === SD.KIND.LOCALITY) { placeholders.set(s.cityCode, s); continue; }
    let c = cityOf.get(s.cityCode);
    if (!c) { const l = byCode.get(s.cityCode); const he = l ? l.he : (D.localities.get(s.cityCode) || {}).he || String(s.cityCode); c = { he, n: normHe(he) }; cityOf.set(s.cityCode, c); }
    streets.push(new StreetRow(s, c));
  }
  const streetIdx = new Map(streets.map((s, i) => [s.id, i]));
  const streetByRef = new Map(streets.map((s, i) => [SI.refOf(s.cityCode, s.streetCode), i]));
  const streetsByCity = new Map();
  const streetsByCode = new Map();
  for (const s of streets) {
    if (!streetsByCity.has(s.nc)) streetsByCity.set(s.nc, []); streetsByCity.get(s.nc).push(s);
    if (!streetsByCode.has(s.cityCode)) streetsByCode.set(s.cityCode, []); streetsByCode.get(s.cityCode).push(s);
  }
  /* a locality's size for ranking = its number of current official named streets (an objective proxy from the same registry) */
  const sizeByCode = new Map([...streetsByCode].map(([c, l]) => [c, l.filter((s) => s.kind === SD.KIND.STREET && s.status === 'current').length]));
  /* synonyms: an alternative official name of a street / area / site; a synonym of the locality placeholder (9000) names a
     place inside the locality, not a street — counted, not offered */
  const synonyms = []; let placeholderSynonyms = 0;
  const synByRef = new Map();
  const synCount = new Uint16Array(streets.length);
  for (const y of D.synonyms) {
    const i = streetByRef.get(SI.refOf(y.cityCode, y.officialCode));
    if (i == null) { if (y.officialCode === 9000) placeholderSynonyms++; continue; }
    synByRef.set(SI.refOf(y.cityCode, y.code), synonyms.length);
    synonyms.push(new SynRow(y, i));
    synCount[i]++;
  }
  const synByCity = new Map();
  for (const y of synonyms) { const c = streets[y.i].cityCode; if (!synByCity.has(c)) synByCity.set(c, []); synByCity.get(c).push(y); }
  CACHE = { localities, byName, byCode, cityByAlias, streets, streetIdx, streetByRef, streetsByCity, streetsByCode, sizeByCode, synonyms, synByRef, synCount, synByCity,
    placeholders, placeholderSynonyms, fileHash: D.fileHash,
    meta: { builtAt: D.meta && D.meta.fetchedAt ? String(D.meta.fetchedAt).slice(0, 10) : (loc.meta && loc.meta.builtAt), directory: D.meta, localitiesFile: loc.meta }, index: null };
  return CACHE;
}

/* The street index is the prebuilt one (lib/streets/search-index.js — written by the sync from the same directory files,
   checked by their sha256); when it is absent or stale it is built in memory from the directory (same function, same
   keys — slower cold start, same answers). Localities have their own small index built here. */
function buildIndex(G) {
  if (G.index) return G.index;
  const t0 = Date.now();
  let x = SI.read(SD.DIR, G.fileHash), source = 'prebuilt';
  if (!x) { x = SI.build(SD.load()); source = 'built-in-memory (prebuilt index absent or stale)'; }
  const entries = x.entries;   // [key, posting …], sorted by key — looked up by binary search (no 165k-entry map to build)
  const locExact = new Map();
  const add = (k, i) => { const a = locExact.get(k); if (!a) locExact.set(k, [i]); else if (!a.includes(i)) a.push(i); };
  G.localities.forEach((l, i) => { for (const nm of [l.he, ...(l.aliases || [])]) for (const k of aliasKeys(nm)) add(k, i); });
  G.index = { entries, locExact, locSorted: [...locExact.keys()].sort(), source, loadMs: Date.now() - t0, counts: x.counts };
  return G.index;
}

/** the first position in a sorted list at which q could start (`at` reads the key of an item) */
function lowerBound(list, q, at = (x) => x) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (at(list[m]) < q) lo = m + 1; else hi = m; }
  return lo;
}
const keyOf = (e) => e[0];
/** the index entry [key, posting …] of exactly k, or null */
function entryOf(idx, k) { const j = lowerBound(idx.entries, k, keyOf); return j < idx.entries.length && idx.entries[j][0] === k ? idx.entries[j] : null; }
/** the street postings of the keys that start with q (excluding q itself); at most `cap` */
function prefixPostings(idx, q, cap) {
  const out = [], E = idx.entries;
  for (let j = lowerBound(E, q, keyOf); j < E.length && E[j][0].startsWith(q) && out.length < cap; j++) {
    if (E[j][0] === q) continue;
    for (let k = 1; k < E[j].length && out.length < cap; k++) out.push(E[j][k]);
  }
  return out;
}

const locId = (l) => l.code ? 'loc:' + l.code : 'locp:' + l.n.replace(/\s/g, '_');
const stId = (s) => s.id;

function locOut(l, G) {
  return { kind: 'locality', id: locId(l), he: l.he, en: l.en, code: l.code, formerNames: l.aliases && l.aliases.length ? l.aliases : undefined,
    district: l.district, lat: l.lat, lng: l.lng, moatza: l.moatza,
    streetsCount: G ? (l.code ? G.sizeByCode.get(l.code) || 0 : (G.streetsByCity.get(l.n) || []).filter((s) => s.kind === 'street' && s.status === 'current').length) : undefined,
    pendingCode: !l.code || undefined };
}
function stOut(s, G, hit = {}) {
  const cityLoc = G.byCode.get(s.cityCode) || G.byName.get(s.nc);
  // a street is never withheld for want of a neighborhood — the field simply states whether one could be resolved, and by what method
  const nb = resolveNeighborhood(s.city, s.street);
  const syns = G.synCount[G.streetIdx.get(s.id)];
  return { kind: 'street', streetKind: s.kind, id: stId(s), he: s.street, city: s.city, cityEn: cityLoc ? cityLoc.en || undefined : undefined,
    cityCode: s.cityCode, streetCode: s.streetCode, status: s.status,
    cityId: cityLoc ? locId(cityLoc) : 'loc:' + s.cityCode,
    district: cityLoc ? cityLoc.district : null,
    lat: cityLoc ? cityLoc.lat : null, lng: cityLoc ? cityLoc.lng : null,
    neighborhood: nb.resolved ? nb.name : null,
    neighborhoodStatus: nb.resolved ? nb.method : 'unresolved',
    synonymsCount: syns || undefined,
    matchedName: hit.synonym || undefined, via: hit.via || undefined, tier: hit.tier || undefined, inSelectedLocality: hit.scoped || undefined };
}

/** the locality a `near` argument names: a CBS code, a loc: id or a name (official or former) */
function nearLocality(G, near) {
  if (near == null || near === '') return null;
  const s = String(near).trim();
  const code = /^loc:(\d+)$/.exec(s) ? Number(s.slice(4)) : /^\d+$/.test(s) ? Number(s) : null;
  if (code != null) return G.byCode.get(code) || null;
  const n = normHe(CITY_ALIASES[s] || s);
  return G.byName.get(n) || G.byName.get(G.cityByAlias.get(n)) || null;
}
/** a locality named exactly (official name, former name, curated short form) */
function exactLocality(G, t) {
  const n = normHe(CITY_ALIASES[t] || t);
  return G.byName.get(n) || G.byName.get(G.cityByAlias.get(n)) || null;
}
/* inside an exact tier, the typed full name before a variant key of it ("שדרות הפרחים" before "הפרחים" elsewhere); a historical
   row adds 0.5 — both stay inside their tier */
const ALIAS_STEP = 0.25;
/* the official name with its street-type word / honorific removed ("שד ירושלים" → "ירושלים") — for prefix matching only */
const stripName = (n) => { const a = n.replace(STRIP_PREFIX, '').replace(HONORIFIC, ''); return a === n ? null : a; };
const STRIP_PREFIX = /^(רחוב|רח|שדרות|שד|דרך|סמטת|סמטה|סמ|משעול|כיכר|ככר|נתיב|שביל|מעלה|טיילת|שכונת|שכונה|שכ)\s+/;
const HONORIFIC = /^(הרב|רבי|ר|דר|פרופ|האלוף|אלוף|הנשיא|השופט|עש|מרן|האדמור)\s+/;
/* a split part that is only a street-type word or an honorific names no street ("רחוב פתח תקווה" is not a street "רחוב") —
   unless the locality has an official street of exactly that name */
const TYPE_ONLY = /^(רחוב|רח|שדרות|שד|דרך|סמטת|סמטה|סמ|משעול|כיכר|ככר|נתיב|שביל|מעלה|טיילת|שכונת|שכונה|שכ|הרב|רבי|ר|דר|פרופ|האלוף|אלוף|הנשיא|השופט|עש|מרן|האדמור)$/;
/* a house number typed with the street ("הרצל 12", "הרצל 12א פתח תקווה") */
const HOUSE = /(^|\s)\d{1,4}[א-ת]?(?=\s|$)/g;
/* exact: the typed name, the same name with the type word spelled another way ("שד רוטשילד" = "שדרות רוטשילד"), the typed name
   without its street-type word
   — graded inside the tier: the typed name · its type word spelled another way · the name without its type word · any other
   variant key (ALIAS_STEP) */
const exactStep = (n, full, bare) => (n === full ? 0 : spellKey(n) === spellKey(full) ? ALIAS_STEP / 4 : bare && n === bare ? ALIAS_STEP / 2 : ALIAS_STEP);
/* the query ends in a non-final letter and the name in a final one ("הגנ" while typing "הגנים"): only the folded key can have
   met the name, and the user is likely mid-word — a discovery match (tier 6), never exact */
const foldOnly = (n, full) => /[מנצפכ]$/.test(full) && /[םןץףך]$/.test(n);

/**
 * National search over every locality and every official street / address area / site.
 * @param {string} query
 * @param {number} limit
 * @param {object} [opt] {near: locality code | loc:id | name — the locality in view (its streets rank first)}
 * @returns {matches:[…], meta:{indexBuiltAt, near, scopes, streetCandidates, moreStreets, exactStreetLocalities}}
 */
function searchGeo(query, limit = 12, opt = {}) {
  const r = searchOnce(query, limit, opt);
  /* a house number names no street: when the query carries one and no street matched it exactly, the query is read again
     without it (the number is reported back, never used to pick a street) */
  const q = normHe(query);
  if (/\d/.test(q) && !r.matches.some((m) => m.kind === 'street' && m.tier && m.tier < 6)) {
    const bare = q.replace(HOUSE, ' ').replace(/\s+/g, ' ').trim();
    if (bare.length >= 2 && bare !== q) {
      const r2 = searchOnce(bare, limit, opt);
      if (r2.matches.some((m) => m.kind === 'street')) { r2.meta.houseNumber = (q.match(HOUSE) || []).map((x) => x.trim()).join(' '); r2.meta.queryRead = bare; return r2; }
    }
  }
  return r;
}

function searchOnce(query, limit = 12, opt = {}) {
  const G = loadGeo();
  let q = normHe(query);
  const near = nearLocality(G, opt.near);
  const meta = { indexBuiltAt: G.meta.builtAt, near: near ? locId(near) : null };
  if (!q || q.length < 2) return { matches: [], meta };
  const idx = buildIndex(G);
  meta.index = idx.source;
  /* a curated short form of a locality ("תא", "פת") names that locality — and stays a street query too (a street named
     "תל אביב" in ראש פינה is found with it) */
  const aliased = CITY_ALIASES[q] ? normHe(CITY_ALIASES[q]) : null;
  const qNoPrefix = normHe(q.replace(STREET_PREFIX, ''));
  const keys = [...new Set([...queryKeys(q), ...queryKeys(qNoPrefix)])];
  const posting = (k) => entryOf(idx, k);

  /* ── localities: exact (official / former / curated short name) and name prefixes. The query's locality keys are its
     spelling variants only — never the street-type / honorific stripping ("סמ הרב רמת השרון" is not the locality רמת השרון) ── */
  const lk = new Set(aliased ? [q, aliased] : [q]);
  for (const v of [...lk]) { lk.add(foldFinals(v)); lk.add(v.replace(/-/g, ' ')); lk.add(v.replace(/ /g, '-')); lk.add(v.replace(/וו/g, 'ו')); }
  const exactLoc = [];
  for (const k of lk) for (const i of idx.locExact.get(k) || []) if (!exactLoc.includes(i)) exactLoc.push(i);
  const prefLoc = [];
  for (const k of lk) for (let j = lowerBound(idx.locSorted, k); j < idx.locSorted.length && idx.locSorted[j].startsWith(k); j++)
    for (const i of idx.locExact.get(idx.locSorted[j])) if (!exactLoc.includes(i) && !prefLoc.includes(i)) prefLoc.push(i);
  const locSize = (l) => (l.code ? G.sizeByCode.get(l.code) || 0 : 0);
  prefLoc.sort((a, b) => locSize(G.localities[b]) - locSize(G.localities[a]) || G.localities[a].n.length - G.localities[b].n.length);

  /* ── candidates: street index → {tier, via, synonym, scoped} (tier + 0.5 for a historical street) ── */
  const best = new Map();
  const offer = (i, tier, via, synonym, scoped) => {
    const s = G.streets[i]; const t = tier + (s.status === 'historical' ? 0.5 : 0); const b = best.get(i);
    if (!b || t < b.tier || (t === b.tier && via === 'official' && b.via !== 'official')) best.set(i, { tier: t, via, synonym, scoped: scoped || (b && b.scoped) || null });
    else if (scoped && (!b.scoped || (scoped === 'near' && b.scoped === 'named'))) b.scoped = scoped;
  };

  /* ── the selected locality: `near`, or a locality named inside the query ("הרצל פתח תקווה" / "פתח תקווה הרצל"). A locality
     named EXACTLY scopes the rest of the query; the trailing words may also be the start of a locality name while the user
     is still typing ("הרצל פתח ת") — such a scope ranks its exact hits as prefixes (tier 3), never as exact. When the whole
     query is itself a locality name ("גן יבנה"), it is not split. ── */
  const scopes = [];
  if (near) scopes.push({ loc: near, keys, floor: 1, full: q, bare: qNoPrefix });
  /* the whole query is itself an official street name somewhere ("מנחם ירושלים", "סמ הר כרכום") → that street leads; the split
     reading (a street of the named locality) follows right after it, before variant-key matches elsewhere */
  const wholeStreet = (() => { const e = posting(q); if (!e) return false; for (let j = 1; j < e.length; j++) { if (SI.typeOf(e[j]) !== SI.TYPE.OFFICIAL) continue; const i = G.streetByRef.get(SI.refOfPosting(e[j])); if (i != null && G.streets[i].n === q) return true; } return false; })();
  const words = q.split(' ');
  if (words.length >= 2 && !exactLoc.length) {
    for (let i = 1; i < words.length; i++) {
      const head = words.slice(0, i).join(' '), tail = words.slice(i).join(' ');
      for (const [stPart, ctPart, trailing] of [[head, tail, true], [tail, head, false]]) {
        if (stPart.length < 2) continue;
        const exact = exactLocality(G, ctPart);
        let ls = exact ? [exact] : [], byPrefix = false;
        if (!exact && trailing && ctPart.length >= 3) {
          /* still typing the locality: its three largest completions are scoped (as prefixes, tier 3) */
          const cand = G.localities.filter((x) => x.code && x.n.startsWith(ctPart) && G.sizeByCode.get(x.code));
          cand.sort((a, b) => locSize(b) - locSize(a));
          if (cand.length) { ls = cand.slice(0, 3); byPrefix = true; }
        }
        /* a type word / honorific alone is a street only where the locality has an official street of exactly that name
           ("הנשיא", "נתיב") */
        if (TYPE_ONLY.test(stPart)) ls = ls.filter((l) => (G.streetsByCode.get(l.code) || []).some((x) => x.n === stPart));
        for (const l of ls) if (!scopes.some((sc) => sc.loc === l && sc.stPart === stPart)) scopes.push({ loc: l, keys: [...new Set([...queryKeys(stPart), ...queryKeys(normHe(stPart.replace(STREET_PREFIX, '')))])], floor: wholeStreet ? 4 + ALIAS_STEP / 2 : byPrefix ? 3 : 1, named: true, byPrefix, stPart, full: normHe(stPart), bare: normHe(stPart.replace(STREET_PREFIX, '')) });
      }
    }
  }
  for (const sc of scopes) {
    const code = sc.loc.code, tag = sc.named ? 'named' : 'near';
    const tierOf = (t) => Math.max(t, sc.floor);
    /* exact official names and synonyms in the locality: the index postings of the query keys, filtered by locality code */
    for (const k of sc.keys) {
      const e = posting(k); if (!e) continue;
      for (let j = 1; j < e.length; j++) {
        const p = e[j], ref = SI.refOfPosting(p);
        if (SI.cityOfRef(ref) !== code) continue;
        const t = SI.typeOf(p);
        if (t === SI.TYPE.OFFICIAL) { const i = G.streetByRef.get(ref), n = G.streets[i].n; offer(i, foldOnly(n, sc.full) ? 6 : tierOf(1) + exactStep(n, sc.full, sc.bare), 'official', null, tag); }
        else if (t === SI.TYPE.SYNONYM) { const y = G.synonyms[G.synByRef.get(ref)]; if (y) offer(y.i, foldOnly(y.n, sc.full) ? 6 : tierOf(2) + exactStep(y.n, sc.full, sc.bare), 'synonym', y.name, tag); }
        else offer(G.streetByRef.get(ref), 6, 'word', null, tag);
      }
    }
    /* prefixes of the official name (or of the name without its street-type word) and of a synonym in the locality: tier 3;
       a word inside the name: tier 6 (still listed before the same tier elsewhere) */
    for (const s of G.streetsByCode.get(code) || []) {
      const sn = stripName(s.n);
      let hit = -1;
      for (const k of sc.keys) {
        if (s.n.startsWith(k) || (sn && sn.startsWith(k))) { hit = 3; break; }
        if (hit < 0 && (s.n.includes(' ' + k) || s.n.includes('-' + k))) hit = 6;
      }
      /* a scope whose exact hits rank after an exact street elsewhere (floor > 3) keeps its prefixes in discovery (tier 6) */
      if (hit > 0) offer(G.streetIdx.get(s.id), sc.floor > 3 ? 6 : Math.max(hit, sc.floor), 'official', null, tag);
    }
    for (const y of G.synByCity.get(code) || []) if (sc.keys.some((k) => y.n.startsWith(k))) offer(y.i, sc.floor > 3 ? 6 : Math.max(3, sc.floor), 'synonym', y.name, tag);
  }

  /* ── everywhere: exact official names (tier 4) and synonyms (tier 5); prefixes and later words (tier 6) ── */
  for (const k of keys) {
    const e = posting(k);
    if (e) for (let j = 1; j < e.length; j++) {
      const p = e[j], ref = SI.refOfPosting(p), t = SI.typeOf(p);
      if (t === SI.TYPE.OFFICIAL) { const i = G.streetByRef.get(ref), n = G.streets[i].n; offer(i, foldOnly(n, q) ? 6 : 4 + exactStep(n, q, qNoPrefix), 'official'); }
      else if (t === SI.TYPE.SYNONYM) { const y = G.synonyms[G.synByRef.get(ref)]; if (y) offer(y.i, foldOnly(y.n, q) ? 6 : 5 + exactStep(y.n, q, qNoPrefix), 'synonym', y.name); }
      else offer(G.streetByRef.get(ref), 6, 'word');
    }
    for (const p of prefixPostings(idx, k, 800)) {
      const ref = SI.refOfPosting(p), t = SI.typeOf(p);
      if (t === SI.TYPE.SYNONYM) { const y = G.synonyms[G.synByRef.get(ref)]; if (y) offer(y.i, 6, 'synonym', y.name); }
      else offer(G.streetByRef.get(ref), 6, t === SI.TYPE.OFFICIAL ? 'official' : 'word');
    }
  }

  /* order: tier · in the selected locality first · (discovery) a name that starts with the query first · larger locality
     first · shorter name · locality code · street code */
  const starts = (s) => (s.n.startsWith(q) || (stripName(s.n) || '').startsWith(qNoPrefix) ? 1 : 0);
  const ranked = [...best.entries()].sort((a, b) => {
    const A = a[1], B = b[1], sa = G.streets[a[0]], sb = G.streets[b[0]];
    return A.tier - B.tier || (B.scoped ? 1 : 0) - (A.scoped ? 1 : 0) || (A.tier >= 6 ? starts(sb) - starts(sa) : 0)
      || (G.sizeByCode.get(sb.cityCode) || 0) - (G.sizeByCode.get(sa.cityCode) || 0)
      || sa.n.length - sb.n.length || sa.cityCode - sb.cityCode || sa.streetCode - sb.streetCode;
  });
  const hitOf = ([i, h]) => stOut(G.streets[i], G, { tier: Math.floor(h.tier), via: h.via, synonym: h.synonym, scoped: h.scoped });
  const tierIs = (lo, hi) => ranked.filter(([, h]) => h.tier >= lo && h.tier < hi);

  /* exact locality → streets of the selected locality (tiers 1–3) → locality-name prefixes (3) → exact names elsewhere
     (4–5) → discovery (6) → the remaining locality prefixes */
  const out = [];
  for (const i of exactLoc.slice(0, 3)) out.push(locOut(G.localities[i], G));
  for (const r of tierIs(1, 4)) out.push(hitOf(r));
  for (const i of prefLoc.slice(0, 3)) out.push(locOut(G.localities[i], G));
  for (const r of tierIs(4, 7)) { if (out.length >= limit) break; out.push(hitOf(r)); }
  for (const i of prefLoc.slice(3)) { if (out.length >= limit) break; out.push(locOut(G.localities[i], G)); }
  const matches = out.slice(0, limit);
  const shown = matches.filter((m) => m.kind === 'street').length;
  meta.scopes = scopes.map((sc) => ({ locality: locId(sc.loc), named: !!sc.named, byPrefix: sc.byPrefix || undefined }));
  meta.streetCandidates = best.size;
  meta.moreStreets = Math.max(0, best.size - shown);
  meta.exactStreetLocalities = new Set(ranked.filter(([, h]) => h.tier < 6).map(([i]) => G.streets[i].cityCode)).size;
  return { matches, meta };
}

let LEGACY = null;
/** Resolve a canonical id back to its record (QA + deep links). A legacy provisional id (stp:…) maps to its official id. */
function resolveGeoId(id) {
  const G = loadGeo();
  const s = String(id || '');
  if (s.startsWith('loc:')) { const l = G.byCode.get(Number(s.slice(4))); return l ? locOut(l, G) : null; }
  if (s.startsWith('locp:')) { const l = G.byName.get(s.slice(5).replace(/_/g, ' ')); return l ? locOut(l, G) : null; }
  if (s.startsWith('stp:')) {
    if (LEGACY === null) { try { LEGACY = JSON.parse(fs.readFileSync(path.join(SD.DIR, 'legacy-ids.json'), 'utf8')).map || {}; } catch { LEGACY = {}; } }
    const to = LEGACY[s];
    const r = to ? resolveGeoId(to) : null;
    return r ? { ...r, legacyId: s } : null;
  }
  const i = G.streetIdx.get(s);
  return i != null ? stOut(G.streets[i], G) : null;
}

module.exports = { searchGeo, resolveGeoId, normHe, loadGeo, CITY_ALIASES, nearLocality };
