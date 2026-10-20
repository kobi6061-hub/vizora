// PROPX · TRANSACTION EVENTS — one chronological universe of every reported transaction PROPX can defend, from every source it
// reads (20.10.2026, P0 "freshest real transactions everywhere").
//
// THE FIRST QUESTION is "did a real transaction occur, and does PROPX hold a defensible record of it?" — answered here, for any
// locality, street, address (building) or block · parcel. The second question — which fields of it are safe for a statistic — is
// answered per event by its STATE, and never decides whether the event is shown.
//
// SOURCES (each kept apart, provenance never destroyed — `sources()` lists them with their coverage):
//   over:deals-register     the Tax Authority register, republished copy (over.org.il) — the stored 36-month sweep
//                           (lib/streets/evidence.js shards): every deal of every swept locality, all natures
//   over:govmap-recent      the GovMap deals layer, republished copy — the recent window (lib/recent): deals the register copy does
//                           not hold yet, shown only while reconciled against the register copy PROPX holds (its safety gate)
//   over:govmap-national    the same GovMap-layer copy, its whole published file (scripts/txevents-national.js): rows of the
//                           register's window the register copy does not hold (before the recent window — after it they are the
//                           recent layer's), under the recent layer's own reconciliation rules
//   register-live           the register copy read live by the transactions section (lib/gov/providers/overDeals.js) — older history
//                           and the republisher's own address link (merged by the API, deduplicated on the register's own key)
//
// ONE EVENT, MANY REPRESENTATIONS: a deal both copies hold is ONE event — the register's; the GovMap row is listed as its source
// evidence (with every field the two copies print differently: SOURCE CONFLICT, both values kept; the register's values are shown —
// PRECEDENCE below). A GovMap row the reconciliation calls a POSSIBLE duplicate is shown, flagged, and never counted.
//
// STATE (what the event may be used for — not whether it is shown):
//   PRICED_IN_STATISTICS       a register dwelling deal priced by the register's rules (whole property, ≥ ₪100,000, one unit) whose
//                              place in the scope is certain — what a median of this scope reads
//   VERIFIED_DWELLING          a register dwelling deal not priced (a partial share, below ₪100,000, several units for one
//                              consideration, no amount) or whose street link is not certain (a corner / multi-street parcel, a
//                              street recovered through the parcel)
//   RECORDED_EVENT             a reported transaction that is not a dwelling, or whose property type the source does not state
//   LIMITED_SHARE_NOT_STATED   a GovMap-layer dwelling deal the register copy does not hold: real, dated, priced as reported — the
//                              copy states no ownership share, so its price is never used in a statistic
//   CONFLICT                   the sources contradict each other on where the deal is (name vs parcel, address vs parcel)
//   POSSIBLE_DUPLICATE         maybe a second print of a deal already listed — shown, flagged, never counted
//
// GEOGRAPHY of an event in a street scope (`geo.match`): STREET (every address of the parcel on this street, or the published address
// and the parcel agreeing) · STREET_POSSIBLE (a corner / multi-street parcel; a loose spelling of the published address) ·
// STREET_VIA_PARCEL (the register's parcel had no address; the GovMap layer's addresses of the same parcel put it on this street) ·
// STREET_VIA_PARCEL_POSSIBLE · STREET_PUBLISHED_ADDRESS (the GovMap row's own address, resolved in the official directory) ·
// STREET_REPUBLISHER_LINK (the register copy's live search placed it here by the republisher's own address link).
//
// PRECEDENCE of displayed fields: the register (the Tax Authority's own register) over the GovMap layer (its map publication); the
// other source's values stay in `evidence`. Nothing is ever overwritten.
//
// The Street Value Model and the street statistics never read this module (they read lib/streets/evidence.js only).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const EV = require('../streets/evidence');
const FRESH = require('../gov/freshness');
const RECENT = require('../recent/read');
const { classifyPropertyType } = require('../gov/propertyType');

const ROOT = path.join(__dirname, '..', '..');
/* literal paths so the deployment's file tracing bundles them */
const FILES = {
  national: path.join(__dirname, '..', '..', 'data', 'txevents', 'national', 'govmap-only.json'),
  nationalMeta: path.join(__dirname, '..', '..', 'data', 'txevents', 'national', 'meta.json'),
  nationalParcels: path.join(__dirname, '..', '..', 'data', 'txevents', 'national', 'parcel-streets.json'),
  nationalRuns: path.join(__dirname, '..', '..', 'data', 'txevents', 'national', 'runs.jsonl'),
  extra: path.join(__dirname, '..', '..', 'data', 'txevents', 'recent-extra.json'),
  links: path.join(__dirname, '..', '..', 'data', 'txevents', 'links.json'),
  parcels: path.join(__dirname, '..', '..', 'data', 'txevents', 'parcel-streets.json'),
  latest: path.join(__dirname, '..', '..', 'data', 'txevents', 'latest.json'),
  completeness: path.join(__dirname, '..', '..', 'data', 'txevents', 'completeness.json'),
  regUnmapped: path.join(__dirname, '..', '..', 'data', 'txevents', 'history', 'register-unmapped.json'),
  evMeta: path.join(__dirname, '..', '..', 'data', 'streets', 'evidence', 'meta.json'),
  evRuns: path.join(__dirname, '..', '..', 'data', 'streets', 'evidence', 'sync-runs.jsonl'),
  monitor: path.join(__dirname, '..', '..', 'data', 'transactions', 'freshness.json'),
};
const ENGINE = 'propx-txevents-1';

const STATES = ['PRICED_IN_STATISTICS', 'VERIFIED_DWELLING', 'RECORDED_EVENT', 'LIMITED_SHARE_NOT_STATED', 'CONFLICT', 'POSSIBLE_DUPLICATE'];
const MATCHES = ['STREET', 'STREET_POSSIBLE', 'STREET_VIA_PARCEL', 'STREET_VIA_PARCEL_POSSIBLE', 'STREET_PUBLISHED_ADDRESS', 'STREET_REPUBLISHER_LINK', 'BUILDING', 'PARCEL', 'LOCALITY', 'AREA', 'UNPLACED'];
/* a disagreement between the two copies that is the GovMap layer's documented FORMAT, not a contradiction: its amounts are truncated to
   ₪1,000; a partial sale may be printed as the whole value. Every other difference is a SOURCE CONFLICT. */
const FORMAT_ONLY = new Set(['amount:truncated', 'amount:share']);
const SOURCES = Object.freeze({
  'over:deals-register': { id: 'over:deals-register', label: 'Tax Authority register — republished copy (over.org.il)', labelHe: 'מאגר העסקאות של רשות המסים — עותק שפורסם מחדש (over.org.il)', kind: 'THIRD-PARTY REPUBLICATION OF OFFICIAL DATA', precedence: 1 },
  'over:govmap-recent': { id: 'over:govmap-recent', label: 'GovMap deals layer — republished copy, recent window', labelHe: 'שכבת העסקאות של GovMap — עותק שפורסם מחדש, חלון אחרון', kind: 'THIRD-PARTY REPUBLICATION OF OFFICIAL MAP / GIS LAYER', precedence: 2 },
  'over:govmap-national': { id: 'over:govmap-national', label: 'GovMap deals layer — the published file of the same copy', labelHe: 'שכבת העסקאות של GovMap — הקובץ המלא של אותו עותק', kind: 'THIRD-PARTY REPUBLICATION OF OFFICIAL MAP / GIS LAYER', precedence: 2 },
  'register-live': { id: 'register-live', label: 'Tax Authority register — republished copy, live search', labelHe: 'מאגר רשות המסים — עותק שפורסם מחדש, חיפוש חי', kind: 'THIRD-PARTY REPUBLICATION OF OFFICIAL DATA', precedence: 1 },
});
const NOTE = 'PROPX combines multiple transaction sources. Some recent transactions may appear before all pricing details are fully verified.';
const NOTE_HE = 'PROPX משלב כמה מקורות של עסקאות. חלק מהעסקאות האחרונות עשויות להופיע לפני שכל פרטי המחיר שלהן אומתו.';

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const readLines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const DAY = 864e5;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const minusDays = (d, k) => isoDay(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') - k * DAY);
const plusDays = (d, k) => minusDays(d, -k);
const today0 = () => isoDay(Date.now());

/* ── the stores, memoised per file stamp ── */
let MEMO = null;
function stores() {
  const stamp = Object.values(FILES).map(mtime).join('|');
  if (MEMO && MEMO.stamp === stamp) return MEMO.value;
  const evMeta = readJson(FILES.evMeta);
  const nationalMeta = readJson(FILES.nationalMeta);
  /* the national rows count only while built against the register copy PROPX holds now (the same safety rule as the recent layer) */
  const natOk = !!(nationalMeta && evMeta && evMeta.source && nationalMeta.register && nationalMeta.register.scrapedAt === evMeta.source.scrapedAt && nationalMeta.register.lastDeal === evMeta.source.lastDeal);
  const national = natOk ? readJson(FILES.national) : null;
  const extra = readJson(FILES.extra);
  const extraOk = !!(extra && evMeta && evMeta.source && extra.register && extra.register.scrapedAt === evMeta.source.scrapedAt);
  const links = readJson(FILES.links);
  const linksOk = !!(links && evMeta && evMeta.source && links.register && links.register.scrapedAt === evMeta.source.scrapedAt);
  /* the parcel → street recovery: the national file's (the whole layer) over the recent rows' — merged, the national first */
  const pr = new Map();
  const addParcels = (doc, src) => { if (!doc || !doc.byCode) return; for (const [code, m] of Object.entries(doc.byCode)) for (const [k, v] of Object.entries(m)) { const key = `${code}|${k}`; if (!pr.has(key)) pr.set(key, { state: v[0], streets: v[1], reasons: v[2] || [], rows: v[3] || null, last: v[4] || null, source: src }); } };
  if (natOk) addParcels(readJson(FILES.nationalParcels), 'over:govmap-national');
  const localParcels = readJson(FILES.parcels);
  if (localParcels && evMeta && evMeta.source && localParcels.register && localParcels.register.scrapedAt === evMeta.source.scrapedAt) addParcels(localParcels, 'over:govmap-recent');
  /* the register's deals under unmapped settlement names, placed by parcel — only while read from the register copy PROPX holds */
  const ru = readJson(FILES.regUnmapped);
  const regUnmapped = ru && evMeta && evMeta.source && ru.scrapedAt === evMeta.source.scrapedAt ? ru : null;
  const value = { evMeta, nationalMeta, natOk, national, extra: extraOk ? extra : null, extraOk, links: linksOk ? links : null, parcels: pr, regUnmapped,
    nationalRuns: readLines(FILES.nationalRuns), evRuns: readLines(FILES.evRuns), monitor: readJson(FILES.monitor), latest: readJson(FILES.latest), completeness: readJson(FILES.completeness) };
  MEMO = { stamp, value };
  return value;
}

/* ── register events of one locality (its stored sweep shard) ── */
const unitKey = (code, date, gush, helka, sub, amount) => `${code}|${date}|${num(gush)}/${num(helka)}/${num(sub) == null ? '—' : num(sub)}|${amount}`;
const REG_CACHE = new WeakMap();
function registerEvents(sh, S) {
  if (REG_CACHE.has(sh)) return REG_CACHE.get(sh);
  const code = sh.cityCode;
  const src = (S.evMeta && S.evMeta.source) || {};
  const snapshotDate = FRESH.isoDay(FRESH.ts(src.scrapedAt));
  const seen = new Map();
  const out = EV.dealsOf(sh).map((x) => {
    const d = x.deal;
    const base = unitKey(code, d.date, d.gush, d.helka, d.subParcel, d.amount);
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const pt = classifyPropertyType(d.nature);
    return {
      id: `reg:${base}${n > 1 ? '#' + n : ''}`, key: base, source: 'register', sourceId: 'over:deals-register',
      date: d.date, price: d.amount, areaSqm: d.areaSqm, rooms: d.rooms, floor: null, yearBuilt: d.yearBuilt,
      propertyType: d.nature, dealType: d.nature, kind: d.dwelling ? 'DWELLING' : 'NON_DWELLING', propertyClass: d.dwelling ? 'residential' : pt.propertyClass === 'residential' ? 'unknown' : pt.propertyClass,
      cityCode: code, city: d.settlement, block: d.gush != null ? String(d.gush) : null, parcel: d.helka != null ? String(d.helka) : null, subParcel: d.subParcel != null ? String(d.subParcel) : null,
      partialSale: d.partialSale, portion: d.portionFraction != null ? { fraction: d.portionFraction, text: String(d.portionFraction) } : null, portionMissing: d.portionMissing,
      notMarket: d.notMarket, sameConsideration: d.sameConsideration || null, priced: d.priced, pricePerSqm: d.pricePerSqm, copies: d.copies || 1,
      newness: d.probableNew ? 'probable_new' : d.yearBuilt ? 'second_hand' : 'unknown', buildYearAfterDeal: d.buildYearAfterDeal,
      parcelState: d.match, parcelAddresses: d.parcelAddresses, parcelAddressesTotal: d.parcelAddressesTotal, parcelReasons: d.reasons, streets: x.streets,
      snapshotDate, declaredAmount: d.declaredAmount,
    };
  });
  REG_CACHE.set(sh, out);
  return out;
}

/* ── the register's deals under a settlement name no official locality carries, placed in this locality by their PARCEL
      (scripts/txevents-register-unmapped.js, lib/txevents/recover.js — RESOLVED states only): register events whose locality is PROPX's
      placement, never the register's statement — never priced ── */
const UNM_CACHE = new Map();
function unmappedRegisterEvents(code, S) {
  const doc = S.regUnmapped;
  if (!doc) return [];
  const k = `${code}|${doc.readAt}`;
  if (UNM_CACHE.has(k)) return UNM_CACHE.get(k);
  const C = doc.columns, I = Object.fromEntries(C.map((c, i) => [c, i]));
  const snapshotDate = FRESH.isoDay(FRESH.ts(doc.scrapedAt));
  const seen = new Map(), out = [];
  for (const r of doc.rows) {
    if (r[I.code] !== Number(code) || !/^RESOLVED/.test(r[I.state])) continue;
    const base = unitKey(code, r[I.date], r[I.block], r[I.parcel], r[I.subParcel], r[I.amount]);
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const nature = r[I.nature], nk = EV.natureKey(nature), dwelling = EV.DWELLING_NATURES.has(nk);
    const portion = r[I.portion], partialSale = portion != null && portion < 1;
    const m = r[I.streets];
    out.push({ id: `regx:${base}${n > 1 ? '#' + n : ''}`, key: base, source: 'register', sourceId: 'over:deals-register', date: r[I.date], price: r[I.amount], areaSqm: r[I.areaSqm], rooms: r[I.rooms],
      floor: null, yearBuilt: r[I.yearBuilt], propertyType: nature, dealType: nature, kind: dwelling ? 'DWELLING' : 'NON_DWELLING', propertyClass: dwelling ? 'residential' : classifyPropertyType(nature).propertyClass,
      cityCode: Number(code), city: r[I.settlement], block: r[I.block] != null ? String(r[I.block]) : null, parcel: r[I.parcel] != null ? String(r[I.parcel]) : null, subParcel: r[I.subParcel],
      partialSale, portion: portion != null ? { fraction: portion, text: String(portion) } : null, portionMissing: portion == null, notMarket: r[I.amount] != null && r[I.amount] < EV.MIN_MARKET,
      priced: false, pricePerSqm: null, newness: 'unknown', parcelState: m ? m[0] : null, parcelAddresses: r[I.addresses] || [], parcelAddressesTotal: r[I.addressesTotal] || 0, parcelReasons: [],
      streets: m ? m[1].map(([c, via, houses]) => ({ code: c, via, houses })) : [], snapshotDate, recoveredLocality: { from: r[I.settlement], state: r[I.state], basis: r[I.basis] } });
  }
  if (UNM_CACHE.size > 64) UNM_CACHE.delete(UNM_CACHE.keys().next().value);
  UNM_CACHE.set(k, out);
  return out;
}

/**
 * A locality's GovMap-layer events with the rows that repeat a register deal filed under an unmapped settlement name (placed here by
 * parcel) folded into it — the layer's rows were reconciled against the swept register only. Locality-level; a scope places them after.
 * @returns { events, evidence: [[registerEventId, evidence]] }
 */
const LAYER_CACHE = new Map();
function layerEventsOf(code, S) {
  const gm = govmapEvents(code, S);
  const unm = unmappedRegisterEvents(code, S);
  if (!unm.length || !gm.length) return { events: gm, evidence: [] };
  const k = `${code}|${MEMO && MEMO.stamp}`;
  if (LAYER_CACHE.has(k)) return LAYER_CACHE.get(k);
  const F = require('./history').fold(gm.filter((e) => e.state !== 'POSSIBLE_DUPLICATE'), unm);
  const folded = new Set(F.folded.map((f) => f.g.id));
  const possible = new Map(F.shown.filter((e) => e.state === 'POSSIBLE_DUPLICATE').map((e) => [e.id, e]));
  const out = { events: gm.filter((e) => !folded.has(e.id)).map((e) => possible.get(e.id) || e),
    evidence: F.folded.map((f) => [f.r.id, { sourceId: f.g.sourceId, oid: f.g.oid, dealId: f.g.dealId, date: f.g.date, amount: f.g.price, cls: f.g.cls, differences: f.differences, kinds: f.differences }]) };
  if (LAYER_CACHE.size > 64) LAYER_CACHE.delete(LAYER_CACHE.keys().next().value);
  LAYER_CACHE.set(k, out);
  return out;
}

/* a live register row of an unmapped settlement name → the locality its parcel was RESOLVED to (the same deal in the stored file) */
let UNM_KEYS = null;
function unmappedCodeOf(t, S) {
  const doc = S.regUnmapped;
  if (!doc) return null;
  if (!UNM_KEYS || UNM_KEYS.at !== doc.readAt) {
    const C = doc.columns, I = Object.fromEntries(C.map((c, i) => [c, i])), m = new Map();
    for (const r of doc.rows) if (/^RESOLVED/.test(r[I.state])) m.set(`${r[I.date]}|${num(r[I.block])}/${num(r[I.parcel])}/${num(r[I.subParcel])}|${r[I.amount]}`, r[I.code]);
    UNM_KEYS = { at: doc.readAt, m };
  }
  return UNM_KEYS.m.get(`${t.date}|${num(t.block)}/${num(t.parcel)}/${num(t.subParcel)}|${t.price}`) || null;
}

/* ── GovMap-layer events of one locality: the recent layer (gated), the recent window's possible duplicates, the national rows ── */
const rowObj = (cols, r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]));
const GM_CACHE = new Map();
function govmapEvents(code, S) {
  const L = RECENT.load();
  const g = RECENT.gate(L);
  const stamp = `${code}|${MEMO && MEMO.stamp}|${L.meta && L.meta.builtAt}|${g.ok}`;
  if (GM_CACHE.has(stamp)) return GM_CACHE.get(stamp);
  const out = [];
  const recentSnap = L.meta && L.meta.source ? String(L.meta.source.loadedAt || '').slice(0, 10) : null;
  if (g.ok) {
    const cols = L.layer.columns;
    for (const i of L.layer.byCode[String(code)] || []) out.push(gmEvent(rowObj(cols, L.layer.rows[i]), 'over:govmap-recent', recentSnap));
  }
  if (S.extra && g.ok) {
    const cols = S.extra.columns;
    for (const i of (S.extra.byCode || {})[String(code)] || []) out.push(gmEvent(rowObj(cols, S.extra.rows[i]), 'over:govmap-recent', recentSnap));
  }
  if (S.national) {
    const cols = S.national.columns, snap = S.nationalMeta && S.nationalMeta.version ? String(S.nationalMeta.version.detectedAt || '').slice(0, 10) : null;
    for (const i of (S.national.byCode || {})[String(code)] || []) out.push(gmEvent(rowObj(cols, S.national.rows[i]), 'over:govmap-national', snap));
  }
  if (GM_CACHE.size > 64) GM_CACHE.delete(GM_CACHE.keys().next().value);
  GM_CACHE.set(stamp, out);
  return out;
}
const POSSIBLE_CLASSES = new Set(['POSSIBLE_DUPLICATE_IN_SOURCE', 'AMBIGUOUS_DUPLICATE', 'POSSIBLY_IN_REGISTER']);
function gmEvent(r, sourceId, snapshotDate) {
  const kind = r.kind || 'TYPE_NOT_STATED';
  const cls = r.class || 'RECENT_NEW';
  const reasons = Array.isArray(r.reasons) ? r.reasons : [];
  let state, notes = [];
  if (POSSIBLE_CLASSES.has(cls) || reasons.includes('possible-duplicate-of-register-deal')) { state = 'POSSIBLE_DUPLICATE'; notes.push(cls === 'POSSIBLY_IN_REGISTER' || reasons.includes('possible-duplicate-of-register-deal') ? 'MAYBE_A_REGISTER_DEAL' : 'MAYBE_A_SECOND_PRINT_IN_THE_LAYER'); }
  else if (r.state === 'RECENT_CONFLICT') { state = 'CONFLICT'; notes.push(...reasons.map((x) => x.toUpperCase().replace(/-/g, '_'))); }
  else if (r.state === 'RECENT_OBSERVED_VERIFIED') state = 'VERIFIED_DWELLING';
  else if (kind === 'NON_DWELLING') { state = 'RECORDED_EVENT'; notes.push('NOT_A_DWELLING'); }
  else if (kind === 'TYPE_NOT_STATED') { state = 'RECORDED_EVENT'; notes.push('TYPE_NOT_STATED'); }
  else state = 'LIMITED_SHARE_NOT_STATED';
  if (state !== 'POSSIBLE_DUPLICATE' && state !== 'VERIFIED_DWELLING') notes.push('SHARE_NOT_STATED');
  if (r.amount != null && r.amount < EV.MIN_MARKET) notes.push('BELOW_MARKET_AMOUNT');
  const pt = classifyPropertyType(r.dealNature || r.propertyType);
  return {
    id: `gm:${r.dealId || 'o' + r.oid}`, key: null, source: 'govmap', sourceId, cls,
    date: r.date, price: r.amount, areaSqm: r.areaSqm, rooms: r.rooms, floor: r.floor, yearBuilt: null,
    propertyType: r.dealNature || r.propertyType || null, dealType: r.dealNature || r.propertyType || null, kind,
    propertyClass: kind === 'DWELLING' ? 'residential' : kind === 'TYPE_NOT_STATED' ? 'type-not-stated' : pt.propertyClass === 'residential' ? 'unknown' : pt.propertyClass,
    cityCode: r.cityCode, city: r.settlement, street: r.street, houseNumber: r.house, block: r.block != null ? String(r.block) : null, parcel: r.parcel != null ? String(r.parcel) : null,
    subParcel: r.subParcel != null ? String(r.subParcel) : null, streetCode: r.streetCode, streetBasis: r.streetBasis, dealId: r.dealId, oid: r.oid, series: r.series,
    partialSale: null, portion: null, portionMissing: true, priced: false, pricePerSqm: null, newness: 'unknown',
    state, notes, promotionState: r.state || null, promotionReasons: reasons, twinOid: r.twinOid || null,
    registerRef: r.register || null, conflictsText: r.conflicts || null, snapshotDate, firstReadAt: r.firstReadAt || null,
  };
}

/* ── per-scope geography and state ── */
let DIRECTORY = null;
const directory = () => { if (!DIRECTORY) DIRECTORY = require('../streets/directory').load(); return DIRECTORY; };
function resolveText(code, text) {
  if (!text) return null;
  const M = require('../streets/match');
  const r = M.resolveStreet(M.localityIndex(directory(), code), text);
  return r && r.id ? { code: Number(String(r.id).split(':')[2]), via: r.via } : null;
}

/** where an event stands in the scope → { match, certain, reasons } or null (not in the scope) */
function placeEvent(e, scope, S) {
  if (scope.kind === 'locality') return { match: 'LOCALITY', certain: true };
  if (scope.kind === 'parcel') {
    if (num(e.block) !== num(scope.block) || num(e.parcel) !== num(scope.parcel)) return null;
    return { match: 'PARCEL', certain: true };
  }
  const sc = scope.streetCode, house = scope.house != null ? String(scope.house).trim() : null;
  const houseOk = (houses) => house == null || (houses || []).map(String).includes(house);
  if (e.source === 'register') {
    const on = (e.streets || []).find((s) => s.code === sc);
    if (on) {
      if (!houseOk(on.houses)) return null;
      return e.parcelState === 'OBSERVED' ? { match: house ? 'BUILDING' : 'STREET', certain: true } : { match: 'STREET_POSSIBLE', certain: false, reasons: e.parcelReasons };
    }
    if ((e.streets || []).length) return null;
    /* the register's parcel has no street: the GovMap layer's own addresses of the same parcel */
    const rec = S.parcels.get(`${e.cityCode}|${num(e.block)}|${num(e.parcel)}`);
    if (!rec) return null;
    const hit = rec.streets.find((s) => s[0] === sc);
    if (!hit || !houseOk(hit[2])) return null;
    return { match: rec.state === 'OBSERVED' ? 'STREET_VIA_PARCEL' : 'STREET_VIA_PARCEL_POSSIBLE', certain: false, reasons: rec.reasons, recoveredFrom: rec.source, recoveredAddresses: hit[2] };
  }
  if (e.streetCode === sc) {
    if (house != null && String(e.houseNumber || '').trim() !== house) return null;
    return e.streetBasis === 'address+parcel' ? { match: house ? 'BUILDING' : 'STREET', certain: false }
      : e.streetBasis === 'parcel' ? { match: 'STREET_VIA_PARCEL', certain: false } : { match: 'STREET_PUBLISHED_ADDRESS', certain: false };
  }
  if (e.streetCode == null && e.street) {
    /* a published address the reconciliation did not attach strongly (a loose spelling, or the parcel disagreeing): shown as a
       POSSIBLE match on the street it spells — a spelling difference never hides the deal */
    const r = resolveText(e.cityCode, e.street);
    if (r && r.code === sc && (house == null || String(e.houseNumber || '').trim() === house)) return { match: 'STREET_POSSIBLE', certain: false, reasons: ['published-address-' + (r.via || 'loose')] };
  }
  /* a GovMap row without a usable address, on a register parcel of this street */
  if (e.streetCode == null && !e.street && e.block != null) {
    const rec = S.parcels.get(`${e.cityCode}|${num(e.block)}|${num(e.parcel)}`);
    if (rec && rec.streets.some((s) => s[0] === sc && houseOk(s[2]))) return { match: rec.state === 'OBSERVED' ? 'STREET_VIA_PARCEL' : 'STREET_VIA_PARCEL_POSSIBLE', certain: false, recoveredFrom: rec.source };
  }
  return null;
}

/** the address an event shows in a scope: on a street scope the address on THAT street (the parcel's, or the layer's for a recovered
 *  parcel); elsewhere the parcel's first linked address (register) or the published address (GovMap) */
const splitAddr = (a) => { const m = /^(.*\S)\s+(\d+\s*[א-ת]?)$/.exec(String(a || '').trim()); return m ? { street: m[1], house: m[2].replace(/\s+/g, '') } : { street: String(a || '').trim() || null, house: null }; };
function displayOf(e, scope, pl) {
  if (e.source === 'govmap') return { street: e.street || null, houseNumber: e.houseNumber || null, addressBasis: e.street ? 'published-address' : null };
  if (scope.streetCode != null) {
    const on = (e.streets || []).find((s) => s.code === scope.streetCode);
    if (on) return { street: scope.streetName, houseNumber: (on.houses || []).join(', ') || null, addressBasis: 'parcel-crosswalk', addressCandidates: e.parcelAddresses, addressesTotal: e.parcelAddressesTotal };
    if (pl && pl.recoveredAddresses) return { street: scope.streetName, houseNumber: pl.recoveredAddresses.join(', ') || null, addressBasis: 'parcel-recovered-from-govmap-layer', addressCandidates: [], addressesTotal: 0 };
  }
  const a = (e.parcelAddresses || [])[0];
  if (!a) return { street: null, houseNumber: null, addressBasis: null };
  const x = splitAddr(a);
  return { street: x.street, houseNumber: x.house, addressBasis: 'parcel-crosswalk', addressCandidates: e.parcelAddresses, addressesTotal: e.parcelAddressesTotal };
}

function registerState(e, certain) {
  const notes = [];
  if (e.kind !== 'DWELLING') return { state: 'RECORDED_EVENT', notes: ['NOT_A_DWELLING'] };
  if (e.partialSale) notes.push('PARTIAL_SHARE');
  if (e.portionMissing) notes.push('SHARE_NOT_STATED');
  if (e.notMarket) notes.push('BELOW_MARKET_AMOUNT');
  if (e.sameConsideration) notes.push('SEVERAL_UNITS_ONE_CONSIDERATION');
  if (e.price == null) notes.push('NO_AMOUNT');
  if (e.priced && certain) return { state: 'PRICED_IN_STATISTICS', notes };
  if (e.priced) notes.push('PLACE_NOT_CERTAIN');
  return { state: 'VERIFIED_DWELLING', notes };
}

/* the GovMap layer's representations of a register deal (lib/recent reconciliation → data/txevents/links.json) */
function evidenceOf(e, S) {
  const L = S.links && S.links.byKey ? S.links.byKey[e.key] : null;
  if (!L) return { evidence: [], conflict: false, conflictFields: [] };
  const evidence = L.map((x) => ({ sourceId: x[0], oid: x[1], dealId: x[2], date: x[3], amount: x[4], cls: x[5], differences: x[6] ? String(x[6]).split(' · ') : [], kinds: x[7] || [] }));
  /* every difference except the layer's documented format (amount truncated to ₪1,000, a share printed as the whole value) */
  const fields = new Set();
  for (const x of evidence) for (const k of x.kinds) if (!FORMAT_ONLY.has(k)) fields.add(k.split(':')[0]);
  return { evidence, conflict: fields.size > 0, conflictFields: [...fields] };
}

/* ── scope resolution ── */
let LOCALITIES = null;
function localityByName(name) {
  if (!LOCALITIES) {
    LOCALITIES = [];
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'geo', 'localities.json'), 'utf8'));
      const { normHe } = require('../geo/registry');
      LOCALITIES = (doc.localities || []).map((l) => ({ code: l.code, he: l.he, district: l.district || null, names: [l.he, ...(l.aliases || [])].map(normHe) }));
    } catch { LOCALITIES = []; }
  }
  const { normHe } = require('../geo/registry');
  /* a spelling of the same name: quotes, geresh, hyphens and spaces dropped, doubled vav / yod single (the reconciliation's own rule) */
  const compact = (x) => String(x || '').replace(/["'״׳\s\-–]/g, '').replace(/וו/g, 'ו').replace(/יי/g, 'י');
  const k = normHe(name), c = compact(name);
  return LOCALITIES.find((l) => l.names.includes(k)) || LOCALITIES.find((l) => l.names.some((n) => compact(n) === c)) || null;
}

/**
 * The scope of a query → { kind: locality | street | building | parcel, code, streetCode?, house?, block?, parcel?, resolved, how }
 * @param q { code?, city?, streetId?, street?, house?, block?, parcel? }
 */
function resolveScope(q) {
  let code = q.code != null && q.code !== '' ? Number(q.code) : null;
  let how = code != null ? 'code' : null;
  if (code == null && q.streetId) { const m = /^st:(\d+):(\d+)$/.exec(q.streetId); if (m) { code = Number(m[1]); how = 'street-id'; } }
  if (code == null && q.city) { const l = localityByName(q.city); if (l) { code = l.code; how = 'locality-name'; } }
  if (code == null) return { kind: 'unresolved', resolved: false, reason: q.city ? 'locality-not-found' : 'no-locality' };
  if (q.block != null && q.block !== '' && q.parcel != null && q.parcel !== '') return { kind: 'parcel', code, block: num(q.block), parcel: num(q.parcel), resolved: true, how };
  let streetCode = null, via = null;
  if (q.streetId) { const m = /^st:(\d+):(\d+)$/.exec(q.streetId); if (m && Number(m[1]) === code) { streetCode = Number(m[2]); via = 'street-id'; } }
  if (streetCode == null && q.street) {
    const r = resolveText(code, String(q.street));
    if (r) { streetCode = r.code; via = r.via; }
    else return { kind: 'street', code, streetCode: null, house: q.house || null, resolved: false, reason: 'street-not-in-official-directory', streetText: q.street, how };
  }
  if (streetCode == null) return { kind: 'locality', code, resolved: true, how };
  const D = directory();
  const row = D.byId ? D.byId.get(`st:${code}:${streetCode}`) : null;
  return { kind: q.house != null && q.house !== '' ? 'building' : 'street', code, streetCode, streetId: `st:${code}:${streetCode}`, streetName: row ? row.name : q.street || null, house: q.house != null && q.house !== '' ? String(q.house).trim() : null, resolved: true, how: how + '+' + via };
}

/* ── periods ── */
function periodOf({ days, months, all, today }) {
  const t = today || today0();
  if (all) return { id: 'all', from: null, to: t, days: null };
  if (days) return { id: 'd' + days, from: minusDays(t, Number(days)), to: t, days: Number(days) };
  const m = Number(months) || 24;
  return { id: 'm' + m, from: isoDay(Date.parse(t + 'T00:00:00Z') - m * 30.44 * DAY), to: t, days: Math.round(m * 30.44), months: m };
}
const inPeriod = (d, p) => !!d && d <= p.to && (p.from == null || d > p.from);

/* ── the sources' coverage for one locality ── */
function coverageOf(code, S, today) {
  const t = today || today0();
  const src = (S.evMeta && S.evMeta.source) || {};
  const reg = FRESH.fromDisk({ today: t });
  /* a locality the register copy lists with no deal in the stored window was read too: its register answer for the window is empty */
  const noneInWindow = !!(S.evMeta && S.evMeta.settlements && (S.evMeta.settlements.noDealsInWindow || []).includes(Number(code)));
  const swept = !!EV.shardOf(code) || noneInWindow;
  const L = RECENT.load(), g = RECENT.gate(L);
  const rs = L.meta ? RECENT.summary({ today: t }).source : null;
  const nm = S.nationalMeta;
  const natCheck = S.nationalRuns.filter((r) => r.kind === 'check' && r.status !== 'FAILED').map((r) => r.at).sort().pop() || null;
  return [
    { id: 'over:deals-register', ...SOURCES['over:deals-register'], read: swept, reason: swept ? (noneInWindow ? 'no-deal-in-window' : null) : 'locality-not-swept', snapshotDate: reg ? reg.snapshotDate : FRESH.isoDay(FRESH.ts(src.scrapedAt)),
      coveredFrom: S.evMeta && S.evMeta.window ? S.evMeta.window.from : null, coveredThrough: src.lastDeal || null, checkedAt: reg ? reg.checkedAt : null, state: reg ? reg.state : 'SOURCE_LAG_UNKNOWN', stateReason: reg ? reg.stateReason : null },
    { id: 'over:govmap-recent', ...SOURCES['over:govmap-recent'], read: g.ok, reason: g.ok ? null : g.reason, snapshotDate: rs ? rs.snapshotDate : null,
      coveredFrom: L.meta && L.meta.window ? L.meta.window.from : null, coveredThrough: rs ? rs.latestTransactionDate : null, checkedAt: [rs && rs.checkedAt, natCheck].filter(Boolean).sort().pop() || null,
      state: rs ? rs.state : 'SOURCE_LAG_UNKNOWN', stateReason: rs ? rs.stateReason : null, version: rs ? rs.version : null },
    { id: 'over:govmap-national', ...SOURCES['over:govmap-national'], read: S.natOk, reason: S.natOk ? null : nm ? 'built-against-another-register-copy' : 'not-built',
      snapshotDate: nm && nm.version ? String(nm.version.detectedAt || '').slice(0, 10) : null, coveredFrom: nm && nm.register ? nm.register.window.from : null,
      coveredThrough: nm && nm.recentWindow ? minusDays(nm.recentWindow.from, 1) : null, checkedAt: natCheck, version: nm && nm.version ? nm.version.n : null, builtAt: nm ? nm.builtAt : null,
      state: nm && nm.version ? FRESH.stateOf({ snapshotAt: nm.version.detectedAt, checkedAt: natCheck, today: t }).state : 'SOURCE_LAG_UNKNOWN' },
  ];
}

/** the recency summary of a scope: the union's latest event, the freshest copy, the primary copy, when the sources were checked */
function recencyOf(events, cov) {
  const read = cov.filter((c) => c.read);
  const counted = events.filter((e) => e.state !== 'POSSIBLE_DUPLICATE');
  const latest = counted.reduce((m, e) => (!m || e.date > m.date ? e : m), null);
  const through = read.map((c) => c.coveredThrough).filter(Boolean).sort().pop() || null;
  const freshest = read.map((c) => c.snapshotDate).filter(Boolean).sort().pop() || null;
  const freshestSrc = read.filter((c) => c.snapshotDate === freshest).sort((a, b) => (b.coveredThrough || '').localeCompare(a.coveredThrough || ''))[0] || null;
  const reg = cov.find((c) => c.id === 'over:deals-register');
  return {
    latestKnownEvent: latest ? { date: latest.date, sourceId: latest.sourceId, state: latest.state } : null,
    evidenceCheckedThrough: through,
    freshestSourceSnapshot: freshest ? { date: freshest, sourceId: freshestSrc ? freshestSrc.id : null, state: freshestSrc ? freshestSrc.state : null } : null,
    primaryRegisterSnapshot: reg ? { date: reg.snapshotDate, coveredThrough: reg.coveredThrough, state: reg.state } : null,
    sourcesCheckedAt: read.map((c) => c.checkedAt).filter(Boolean).sort().pop() || null,
    state: freshestSrc ? freshestSrc.state : 'SOURCE_LAG_UNKNOWN',
    note: NOTE, noteHe: NOTE_HE,
  };
}

/**
 * What an empty or partly covered period means — never interchangeable:
 *   EVENTS                         n > 0 (with the uncovered tail when the period runs past the evidence)
 *   NONE_IN_PERIOD                 0 · the freshest copy CURRENT / RECENT, checked, covering at least half of the period:
 *                                  "NO RECORDED TRANSACTIONS FOUND IN THIS PERIOD"
 *   NOT_IN_AVAILABLE_COVERAGE      0 · the period is covered by the copies PROPX holds, but those copies are not current:
 *                                  "NO TRANSACTION FOUND IN CURRENTLY AVAILABLE COVERAGE"
 *   COVERAGE_INCOMPLETE            0 · the copies do not reach at least half of the period, or a source could not be read:
 *                                  "RECENT TRANSACTION COVERAGE INCOMPLETE"
 *   GEOGRAPHY_NOT_RESOLVED         the place could not be resolved — nothing can be said about it
 */
function statementOf(n, p, rec, cov, scope) {
  const through = rec.evidenceCheckedThrough;
  const tail = through && p.to > through ? { from: plusDays(through, 1), to: p.to, days: FRESH.daysBetween(through, p.to) } : null;
  if (!scope.resolved) return { kind: 'GEOGRAPHY_NOT_RESOLVED', n: null, reason: scope.reason };
  if (n > 0) return { kind: 'EVENTS', n, uncoveredTail: tail };
  const unread = cov.filter((c) => !c.read && c.id !== 'over:govmap-national').map((c) => c.id);
  if (!cov.find((c) => c.id === 'over:deals-register').read) return { kind: 'COVERAGE_INCOMPLETE', n: 0, reason: 'the register copy holds no sweep of this locality', unread, uncoveredTail: tail };
  const len = p.days || (p.from ? FRESH.daysBetween(p.from, p.to) : null);
  const covered = through && len ? Math.max(0, Math.min(len, p.from ? FRESH.daysBetween(p.from, through) : len)) : 0;
  if (unread.length || !len || covered < len / 2) return { kind: 'COVERAGE_INCOMPLETE', n: 0, reason: unread.length ? `not read: ${unread.join(', ')}` : `the evidence reaches ${through}: it covers ${covered} of the period's ${len} days`, coveredDays: covered, uncoveredTail: tail };
  if (rec.state !== 'CURRENT' && rec.state !== 'RECENT') return { kind: 'NOT_IN_AVAILABLE_COVERAGE', n: 0, reason: `the freshest copy is ${rec.state}`, coveredDays: covered, uncoveredTail: tail };
  return { kind: 'NONE_IN_PERIOD', n: 0, coveredDays: covered, uncoveredTail: tail };
}
const STATEMENT_TEXT = {
  NONE_IN_PERIOD: ['NO RECORDED TRANSACTIONS FOUND IN THIS PERIOD', 'לא נמצאו עסקאות רשומות בתקופה זו'],
  NOT_IN_AVAILABLE_COVERAGE: ['NO TRANSACTION FOUND IN CURRENTLY AVAILABLE COVERAGE', 'לא נמצאה עסקה בכיסוי הזמין כרגע'],
  COVERAGE_INCOMPLETE: ['RECENT TRANSACTION COVERAGE INCOMPLETE', 'כיסוי העסקאות האחרונות חלקי'],
  GEOGRAPHY_NOT_RESOLVED: ['THE PLACE COULD NOT BE RESOLVED', 'לא ניתן לזהות את המקום'],
};

/**
 * The unified, newest-first transaction events of one scope and period.
 * @param q { code?|city?, streetId?|street?, house?, block?, parcel?, days?|months?|all?, offset?, limit?, today? }
 */
function query(q = {}) {
  const S = stores();
  const scope = resolveScope(q);
  const p = periodOf({ days: q.days, months: q.months, all: q.all, today: q.today });
  const base = { engine: ENGINE, scope, period: p, sources: SOURCES, states: STATES };
  if (!scope.resolved && scope.kind === 'unresolved') return { ...base, available: false, events: [], total: 0, statement: { kind: 'GEOGRAPHY_NOT_RESOLVED', reason: scope.reason, text: STATEMENT_TEXT.GEOGRAPHY_NOT_RESOLVED } };
  const cov = coverageOf(scope.code, S, q.today);
  const sh = EV.shardOf(scope.code);
  const all = [];
  if (scope.resolved) {
    if (sh) for (const e of registerEvents(sh, S)) {
      const pl = placeEvent(e, scope, S); if (!pl) continue;
      const st = registerState(e, pl.certain);
      const ev = evidenceOf(e, S);
      all.push({ ...e, ...displayOf(e, scope, pl), geo: pl, state: st.state, notes: st.notes, inStatistics: st.state === 'PRICED_IN_STATISTICS', evidence: ev.evidence, conflict: ev.conflict, conflictFields: ev.conflictFields });
    }
    /* the register's deals filed under a settlement name no official locality carries, placed here by parcel */
    const unm = [];
    for (const e of unmappedRegisterEvents(scope.code, S)) {
      const pl = placeEvent(e, scope, S); if (!pl) continue;
      const st = registerState(e, false);
      unm.push({ ...e, ...displayOf(e, scope, pl), geo: { ...pl, certain: false, reasons: (pl.reasons || []).concat(['locality-placed-by-parcel']) }, state: st.state, notes: st.notes.concat(['FILED_UNDER_ANOTHER_SETTLEMENT_NAME']), inStatistics: false, evidence: [], conflict: false, conflictFields: [] });
    }
    all.push(...unm);
    const L = layerEventsOf(scope.code, S);
    const ev = new Map(unm.map((e) => [e.id, e]));
    for (const [rid, x] of L.evidence) if (ev.has(rid)) ev.get(rid).evidence = ev.get(rid).evidence.concat([x]);
    for (const e of L.events) {
      const pl = placeEvent(e, scope, S); if (!pl) continue;
      all.push({ ...e, ...displayOf(e, scope, pl), geo: pl, inStatistics: false, evidence: [], conflict: e.state === 'CONFLICT', conflictFields: e.state === 'CONFLICT' ? e.notes : [] });
    }
  }
  /* events another reader adds (the API's live register search): already placed and stated by the caller */
  for (const e of q.extraEvents || []) all.push(e);
  /* the canonical order: newest transaction first; one day's events by source precedence, then id — never by price or ingestion */
  all.sort((a, b) => (b.date || '').localeCompare(a.date || '') || SOURCES[a.sourceId].precedence - SOURCES[b.sourceId].precedence || String(a.id).localeCompare(String(b.id)));
  const rec = recencyOf(all, cov);
  const inP = all.filter((e) => inPeriod(e.date, p));
  const counted = inP.filter((e) => e.state !== 'POSSIBLE_DUPLICATE');
  const tally = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const counts = {
    events: counted.length, possibleDuplicates: inP.length - counted.length, rows: inP.length,
    byState: tally(inP, (e) => e.state), bySource: tally(inP, (e) => e.sourceId), bySourceEvents: tally(counted, (e) => e.sourceId), byKind: tally(counted, (e) => e.kind), byMatch: tally(inP, (e) => e.geo.match),
    conflicts: inP.filter((e) => e.conflict).length, recovered: inP.filter((e) => /VIA_PARCEL/.test(e.geo.match)).length,
    inStatistics: inP.filter((e) => e.inStatistics).length, govmapOnly: counted.filter((e) => e.source === 'govmap').length,
    latestInPeriod: counted.length ? counted[0].date : null,
  };
  const st = statementOf(counted.length, p, rec, cov, scope);
  st.text = STATEMENT_TEXT[st.kind] || null;
  const offset = Math.max(0, Number(q.offset) || 0), limit = q.unlimited ? Infinity : Math.max(1, Math.min(500, Number(q.limit) || 120));
  return { ...base, available: true, coverage: cov, recency: rec, counts, statement: st, total: inP.length, offset, limit, more: offset + limit < inP.length,
    events: inP.slice(offset, offset + limit), swept: !!sh, note: NOTE, noteHe: NOTE_HE };
}

/**
 * The live register search's rows (lib/gov/providers/overDeals.js, the same register copy) → extra events for `query`: a row whose
 * register key PROPX already placed in the scope adds nothing (one deal, one event); a row the stored sweep holds but placed elsewhere
 * (the republisher's own address link put it on this street) is added — STREET_REPUBLISHER_LINK, never certain; a row the sweep does
 * not hold (older than its window) is added as the register's. A live answer from a WIDER rung than the scope asked (the ladder fell
 * back) adds nothing.
 * @param rows      normalized live rows (makeTransaction shape)
 * @param scope     TX.resolveScope(...)
 * @param liveLevel the rung the live answer came from (building | street | locality)
 */
function liveEvents(rows, scope, liveLevel) {
  const want = scope.kind === 'building' ? 'building' : scope.kind === 'street' ? 'street' : scope.kind === 'locality' ? 'locality' : scope.kind === 'parcel' ? 'parcel' : scope.kind === 'area' ? 'national' : null;
  if (!want || liveLevel !== want || !Array.isArray(rows) || !rows.length) return [];
  const S = stores();
  const sh = EV.shardOf(scope.code);
  const stored = new Map(), storedCount = new Map();
  if (sh) for (const e of registerEvents(sh, S)) { if (!stored.has(e.key)) stored.set(e.key, e); storedCount.set(e.key, (storedCount.get(e.key) || 0) + 1); }
  /* the register repeats some rows field for field: each is a row of its own (the stored sweep keeps them as `#2`, `#3` …) — a live row is
     skipped only as many times as the stored sweep already placed its key in the scope */
  const placed = new Map();
  if (sh) for (const e of registerEvents(sh, S)) if (placeEvent(e, scope, S)) placed.set(e.key, (placed.get(e.key) || 0) + 1);
  const out = [], seen = new Map();
  const regSnap = S.evMeta && S.evMeta.source ? FRESH.isoDay(FRESH.ts(S.evMeta.source.scrapedAt)) : null;
  for (const t of rows) {
    const code = t.cityCode != null && t.cityCode !== '' ? Number(t.cityCode) : scope.kind === 'area' ? (t.city ? (localityByName(t.city) || {}).code || unmappedCodeOf(t, S) : unmappedCodeOf(t, S)) : scope.code;
    if (scope.kind === 'area' && scope.codes && !scope.codes.has(code)) continue;      /* a district reads the national search's rows of its own localities */
    const key = unitKey(code, t.date, t.block, t.parcel, t.subParcel, t.price);
    const occ = (seen.get(key) || 0) + 1;
    seen.set(key, occ);
    if (occ <= (placed.get(key) || 0)) continue;
    /* a key the stored sweep holds: never more copies than the sweep counted (a repeat beyond them is the reading, not the register) */
    if (storedCount.has(key) && occ > storedCount.get(key)) continue;
    const geo = want === 'locality' ? { match: 'LOCALITY', certain: true, reasons: [] } : want === 'parcel' ? { match: 'PARCEL', certain: true, reasons: [] }
      : want === 'national' ? (code == null ? { match: 'UNPLACED', certain: false, reasons: ['register-row-names-no-locality'] } : { match: 'AREA', certain: true, reasons: [] })
      : { match: 'STREET_REPUBLISHER_LINK', certain: false, reasons: ['republisher-address-link'] };
    const base = occ === 1 ? stored.get(key) : null;
    const e = base ? { ...base } : {
      id: `live:${key}${occ > 1 ? '#' + occ : ''}`, key, source: 'register', sourceId: 'register-live', date: t.date, price: t.price, areaSqm: t.areaSqm && typeof t.areaSqm === 'object' ? t.areaSqm.value : t.areaSqm,
      rooms: t.rooms && typeof t.rooms === 'object' ? t.rooms.value : t.rooms, floor: null, yearBuilt: t.yearBuilt || null, propertyType: t.dealType, dealType: t.dealType,
      kind: EV.DWELLING_NATURES.has(EV.natureKey(t.dealType)) ? 'DWELLING' : 'NON_DWELLING', propertyClass: t.propertyClass, cityCode: code, city: t.city,
      block: t.block, parcel: t.parcel, subParcel: t.subParcel, partialSale: !!t.partialSale, portion: t.portion || null, portionMissing: false,
      notMarket: t.price != null && t.price < EV.MIN_MARKET, priced: !t.partialSale && t.price != null && t.price >= EV.MIN_MARKET, pricePerSqm: null, newness: t.newness || 'unknown',
      parcelAddresses: t.addressCandidates || [], parcelAddressesTotal: t.addressesTotal || 0, streets: [], snapshotDate: regSnap };
    if (!base && e.priced && e.areaSqm && e.areaSqm >= EV.MIN_AREA) { const p = Math.round(e.price / e.areaSqm); e.pricePerSqm = p >= EV.MIN_SQM ? p : null; }
    if (e.kind === 'DWELLING' && base == null && !EV.DWELLING_NATURES.has(EV.natureKey(t.dealType))) e.kind = 'NON_DWELLING';
    const st = registerState(e, geo.certain);
    out.push({ ...e, street: t.street || null, houseNumber: t.houseNumber || null, addressBasis: 'republisher-address-link', addressCandidates: t.addressCandidates || [], addressesTotal: t.addressesTotal || 0,
      geo, state: st.state, notes: base ? st.notes.concat(['PLACED_BY_THE_REPUBLISHER_ADDRESS_LINK']) : st.notes, inStatistics: st.state === 'PRICED_IN_STATISTICS', evidence: [], conflict: false, conflictFields: [], live: true });
  }
  return out;
}

/** one event in the transactions section's row shape (the page's existing fields + the event's own) */
function wire(e) {
  const psm = e.source === 'register' && e.priced && e.pricePerSqm ? e.pricePerSqm : null;
  return {
    txId: e.id, id: e.id, date: e.date, price: e.price, areaSqm: e.areaSqm, rooms: e.rooms, floor: e.floor || null, yearBuilt: e.yearBuilt || null,
    city: e.city, cityCode: e.cityCode, street: e.street || null, houseNumber: e.houseNumber || null, neighborhood: null,
    block: e.block, parcel: e.parcel, subParcel: e.subParcel, propertyClass: e.propertyClass, propertyType: e.propertyType, dealType: e.dealType, kind: e.kind,
    newness: e.newness || 'unknown', partialSale: !!e.partialSale, portion: e.partialSale && e.portion ? e.portion : null,
    pricePerSqm: psm, psmShown: psm != null,
    sourceFamily: 'OFFICIAL_GOVERNMENT', deliveredVia: 'over.org.il', channel: 'independent-republication', source: e.source, sourceId: e.sourceId,
    snapshotDate: e.snapshotDate || null, firstReadAt: e.firstReadAt || null, state: e.state, notes: e.notes || [], geo: e.geo, inStatistics: !!e.inStatistics,
    evidence: e.evidence || [], conflict: !!e.conflict, conflictFields: e.conflictFields || [], addressBasis: e.addressBasis || null,
    addressCandidates: e.addressCandidates || [], addressesTotal: e.addressesTotal || 0, dealId: e.dealId || null, series: e.series || null, cls: e.cls || null,
    registerRef: e.registerRef || null, conflictsText: e.conflictsText || null, copies: e.copies || 1, unplaced: e.unplaced || null,
  };
}

/** does PROPX hold any stored event for a locality (its register sweep, the GovMap-layer rows, the layer's history)? */
function hasEvents(code) {
  const S = stores();
  if (EV.shardOf(code)) return true;
  if (govmapEvents(code, S).length) return true;
  const H = require('./history').meta();
  return !!(H && H.localities && H.localities[code]);
}

module.exports = { unmappedRegisterEvents, layerEventsOf, liveEvents, wire, displayOf, splitAddr, ENGINE, STATES, MATCHES, SOURCES, NOTE, NOTE_HE, STATEMENT_TEXT, FORMAT_ONLY, FILES, stores, resolveScope, periodOf, inPeriod, coverageOf, recencyOf, statementOf, query, unitKey, registerEvents, govmapEvents, gmEvent, placeEvent, registerState, evidenceOf, hasEvents, localityByName };
