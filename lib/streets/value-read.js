// PROPX · STREET VALUE MODEL — the request-time read (api/intel.js view=street / streetModel / streetApartment).
//
// Never fits anything: the estimate is the stored build (data/streets/model/estimates.json, written by
// scripts/street-model-build.js); WHY THIS ESTIMATE and the comparables are recomputed from ONE locality's shard with the stored
// parameters (model.json — full precision), and the recomputed level is checked against the stored one (a mismatch says so and
// the stored estimate stands). The apartment estimate re-prices the stored street level for a stated profile.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SD = require('./directory');
const EV = require('./evidence');
const VM = require('./value-model');

const DIR = process.env.STREET_MODEL_DIR || path.join(__dirname, '..', '..', 'data', 'streets', 'model');
let CACHE = null;

function load() {
  if (CACHE) return CACHE;
  let model = null, est = null;
  try { model = JSON.parse(fs.readFileSync(path.join(DIR, 'model.json'), 'utf8')); est = JSON.parse(fs.readFileSync(path.join(DIR, 'estimates.json'), 'utf8')); } catch { /* not built */ }
  if (!model || !est) { CACHE = { available: false }; return CACHE; }
  const P = paramsOf(model);
  const byId = new Map(est.rows.map((r) => [r[0], r]));
  /* the build's evidence copy vs the one stored now: after a new sweep and before the model is rebuilt the stored estimate stands
     (dated by its own as-of) but the comparables cannot be recomputed from the newer shards — said, never mixed */
  const S = EV.store(), b = (model.inputs || {}).evidence || {};
  const evidenceCurrent = !!(S.available && b.scrapedAt === S.meta.source.scrapedAt && JSON.stringify(b.window) === JSON.stringify(S.meta.window));
  CACHE = { available: true, model, est, P, byId, evidenceCurrent };
  return CACHE;
}
const reset = () => { CACHE = null; LOC.clear(); };

/* the fit, back from model.json (beta arrays in COLS order) */
function paramsOf(m) {
  const arr = (o) => VM.COLS.map((c) => o[c]);
  const byDistrict = {};
  for (const [d, F] of Object.entries(m.districts)) byDistrict[d] = { beta: arr(F.beta), qEffect: F.index, base: F.base, quarters: F.quarters, source: F.source };
  return { version: m.modelVersion, rho: m.rho, k: { street: { k: m.k.street }, block: { k: m.k.block }, neighbourhood: { k: m.k.neighbourhood } }, byDistrict,
    national: { beta: arr(m.national.beta), qEffect: m.national.index, base: m.national.base, quarters: m.national.quarters, source: 'national' },
    anchor: Object.fromEntries(Object.entries(m.districts).map(([d, F]) => [d, F.anchor])), ageRef: Object.fromEntries(Object.entries(m.districts).map(([d, F]) => [d, F.ageRef])),
    outlierKeys: new Set(m.outliers), subsidy: new Set(m.subsidyParcels), outliers: new Set() };
}

const lv = (x) => (x ? { nEff: x[0], n: x[1], parcels: x[2], largestParcelPct: x[3], latest: x[4] } : null);
/** the stored estimate of one street id, or null for an id the directory does not hold */
function estimate(id) {
  const C = load();
  if (!C.available) return { available: false, reason: 'model-not-built' };
  const r = C.byId.get(String(id));
  if (!r) return null;
  const m = C.model;
  return {
    available: true, id: r[0], value: r[1], tier: r[2], range: r[3] != null ? { lo: r[3], hi: r[4], basis: 'validation-80' } : null, reason: r[5],
    levels: { street: lv(r[6]), block: lv(r[7]), neighbourhood: lv(r[8]), locality: lv(r[9]) },
    weights: r[10] ? { street: r[10][0], block: r[10][1], neighbourhood: r[10][2], locality: r[10][3] } : null,
    why: r[12] ? { medianAgeMonths: r[12][0], largestParcelContributionPct: r[12][1], timeAdjustmentPct: r[12][2], streetSpecificSharePct: r[12][3] } : null,
    reference: m.reference, cls: 'MODEL',
    /* how this model did on unseen transactions — nationally, in this tier and (≥ 300 held-out deals) in this locality */
    validation: validationFor(r[2], SD.parseId(r[0]).cityCode),
    meta: { modelVersion: m.modelVersion, featureVersion: m.featureVersion, validationVersion: m.validationVersion, builtAt: m.builtAt, trainingCutoff: m.trainingCutoff,
      asOf: m.asOf, sourceVersions: m.inputs, tierRule: m.tierRule, marketCap: m.marketCaps[SD.parseId(r[0]).cityCode] || null, evidenceCurrent: C.evidenceCurrent },
  };
}

/* ── one locality's model context (rows + parameters), cached per shard ── */
const LOC = new Map();
function localityContext(city) {
  const C = load(); if (!C.available) return null;
  const sh = EV.shardOf(city); if (!sh) return null;
  const hit = LOC.get(city); if (hit && hit.sh === sh) return hit.ctx;
  const D = SD.load();
  const district = (D.localities.get(city) || {}).district || null;
  const rows = [], links = [];
  for (const x of EV.dealsOf(sh)) {
    const r = VM.rowOf(x.deal, city, district, x.streets, null, C.P.subsidy);
    if (x.deal.match === 'OBSERVED' || x.deal.match === 'POSSIBLE') for (const s of x.streets) links.push([city + ':' + s.code, city + '|' + x.deal.gush, x.deal.date]);
    if (r) rows.push(r);
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.parcel.localeCompare(b.parcel) || a.ppsqm - b.ppsqm);
  rows.forEach((r, i) => { r.id = i; });
  const P = { ...C.P, outliers: new Set(rows.filter((r) => C.P.outlierKeys.has(VM.rowKey(r))).map((r) => r.id)) };
  const ctx = VM.contextOf(rows, P, { streetBlocks: VM.streetBlocksOf(links, C.model.trainingCutoff), nbStreets: VM.neighbourhoodIndex(D), keepRows: true });
  LOC.set(city, { sh, ctx });
  if (LOC.size > 12) LOC.delete(LOC.keys().next().value);
  return ctx;
}

const LEVEL_CLASS = { street: 'OBSERVED', block: 'LOCATION-LINKED', neighbourhood: 'VERIFIED-NEIGHBOURHOOD', locality: 'LOCALITY-CONTEXT' };
const WHY_SELECTED = {
  street: 'an OBSERVED deal on this street (every address of its parcel is on it)',
  block: 'a deal in a cadastral block (gush) of a parcel that touches this street',
  neighbourhood: 'a deal on a street verified-linked to the same neighbourhood',
  locality: 'a priced dwelling deal in the locality (the anchor every level is pulled toward)',
};

/**
 * WHY THIS ESTIMATE + the comparables (deep dive).
 * @param {string} id
 * @param {object} [opt] {limit: comparables listed per level (default 60, max 300)}
 */
function explain(id, opt = {}) {
  const e = estimate(id);
  if (!e || !e.available || e.value == null) return e && { ...e, comparables: null };
  const ref = SD.parseId(id);
  if (!load().evidenceCurrent) return { ...e, comparables: null, note: 'evidence-changed-since-build' };
  const ctx = localityContext(ref.cityCode);
  if (!ctx) return { ...e, comparables: null, note: 'locality-shard-unavailable' };
  const lev = VM.streetLevel(ref.cityCode, ref.streetCode, ctx, null);
  const C = load();
  const stored = C.byId.get(String(id))[11];
  const consistent = lev.value != null && stored != null && Math.abs(lev.value - stored) < 1e-9;
  const ex = VM.explainLevel(lev, ctx, C.model.asOf);
  const D = SD.load();
  const nameOf = (code) => { const s = D.byId.get(SD.streetId(ref.cityCode, code)); return s ? s.name : null; };
  const limit = Math.max(1, Math.min(300, Number(opt.limit) || 60));
  const byLevel = {};
  for (const c of (ex ? ex.contributions : [])) (byLevel[c.level] = byLevel[c.level] || []).push(c);
  const comparables = {};
  for (const [level, cs] of Object.entries(byLevel)) {
    cs.sort((a, b) => b.contribution - a.contribution || b.row.date.localeCompare(a.row.date));
    comparables[level] = { total: cs.length, contributionPct: Math.round(cs.reduce((a, c) => a + c.contribution, 0) * 1000) / 10, cls: LEVEL_CLASS[level], why: WHY_SELECTED[level],
      rows: cs.slice(0, level === 'locality' ? Math.min(limit, 20) : limit).map((c) => ({
        street: c.row.street != null ? nameOf(c.row.street) : null, touches: c.row.touches.length > 1 ? c.row.touches.map(nameOf).filter(Boolean) : undefined, house: c.row.house, date: c.row.date,
        amount: c.row.amount, areaSqm: c.row.areaSqm, ppsqm: c.row.ppsqm, rooms: c.row.rooms, yearBuilt: c.row.yearBuilt, probableNew: c.row.probNew, buildYearAfterDeal: c.row.offPlan,
        subsidyParcel: c.row.subsidyParcel, type: c.row.type, parcel: c.row.gush + '/' + c.row.helka, match: c.row.match,
        timeAdjustmentPct: Math.round((Math.exp(c.timeAdj) - 1) * 1000) / 10, dwellingAdjustmentPct: Math.round((Math.exp(-c.hed) - 1) * 1000) / 10,
        impliedReferencePpsqm: Math.round(c.implied), contributionPct: Math.round(c.contribution * 10000) / 100 })) };
  }
  return { ...e, consistent, comparables, summary: ex ? ex.summary : null, outliersExcluded: ctx.P.outliers.size,
    timeAdjustment: { source: 'PROPX district index — within-block hedonic regression on the register\'s deals (DERIVED); not a CBS series and not a city trend',
      anchor: 'the mean effect of the index\'s latest quarter', district: (D.localities.get(ref.cityCode) || {}).district || null,
      index: (C.model.districts[(D.localities.get(ref.cityCode) || {}).district] || {}).index || null } };
}

/* ── the apartment estimate: the stored street level re-priced for a stated profile ── */
const PROFILE_LIMITS = { sqm: [20, 600], rooms: [1, 12], built: [1900, 2040] };
/**
 * @param {string} id
 * @param {object} p {sqm (required), rooms?, newness: 'existing' | 'new', built?, type?: flat|garden|roof|cottage|house}
 */
function apartment(id, p = {}) {
  const e = estimate(id);
  if (!e || !e.available) return e;
  if (e.value == null) return { ...e, apartment: null, apartmentReason: 'no-street-estimate' };
  const sqm = Number(p.sqm);
  if (!(sqm >= PROFILE_LIMITS.sqm[0] && sqm <= PROFILE_LIMITS.sqm[1])) return { ...e, apartment: null, apartmentReason: 'area-out-of-range' };
  const rooms = p.rooms != null && p.rooms !== '' ? Number(p.rooms) : null;
  if (rooms != null && !(rooms >= PROFILE_LIMITS.rooms[0] && rooms <= PROFILE_LIMITS.rooms[1])) return { ...e, apartment: null, apartmentReason: 'rooms-out-of-range' };
  const built = p.built != null && p.built !== '' ? Number(p.built) : null;
  const C = load();
  const ref = SD.parseId(id);
  const D = SD.load();
  const district = (D.localities.get(ref.cityCode) || {}).district;
  const asOfYear = Number(C.model.asOf.slice(0, 4));
  const isNew = p.newness === 'new';
  const age = !isNew && built != null ? asOfYear - built : null;
  const ageBand = isNew ? null : age == null ? null : age <= 10 ? '2-10' : age <= 25 ? '11-25' : age <= 45 ? '26-45' : '46+';
  const type = ['flat', 'garden', 'roof', 'cottage', 'house'].includes(p.type) ? p.type : 'flat';
  /* rooms not stated → the reference area per room (no rooms effect), never the "rooms missing" coefficient of the register */
  const row = { district, areaSqm: sqm, rooms: rooms || sqm / VM.REF_SQM_PER_ROOM, probNew: isNew, offPlan: false, ageBand, type, subsidyParcel: false, q: null };
  const level = C.byId.get(String(id))[11];
  const logPpsqm = VM.priceOf(level, row, C.P);
  const ppsqm = Math.exp(logPpsqm);
  const value = Math.round(ppsqm * sqm / 1000) * 1000;
  const rg = C.model.ranges[e.tier];
  /* what each input changed, against the reference dwelling */
  const F = C.P.byDistrict[district] || C.P.national, B = Object.fromEntries(VM.COLS.map((c, i) => [c, F.beta[i]]));
  const effect = (x) => Math.round((Math.exp(x) - 1) * 1000) / 10;
  const effects = [
    { input: 'area', value: sqm, effectPct: effect(B.lnArea * Math.log(sqm / VM.REFERENCE.areaSqm)), note: `vs the reference ${VM.REFERENCE.areaSqm} m²` },
    { input: 'rooms', value: rooms, effectPct: rooms ? effect(B.lnSqmPerRoom * Math.log(sqm / rooms / VM.REF_SQM_PER_ROOM)) : 0, note: rooms ? `area per room vs ${VM.REF_SQM_PER_ROOM} m²` : `not stated — the reference ${VM.REF_SQM_PER_ROOM} m² per room` },
    { input: 'newness', value: isNew ? 'new (probable)' : 'existing', effectPct: isNew ? effect(B.probNew) : 0, note: isNew ? 'the premium of deals the build-year rule calls probably new' : 'reference' },
    { input: 'age', value: built, effectPct: ageBand ? effect(({ '2-10': B.age2_10, '11-25': B.age11_25, '26-45': 0, '46+': B.age46 })[ageBand] - (C.P.ageRef[district] || 0)) : 0, note: ageBand ? `built ${built} (${ageBand} years)` : 'the district\'s typical existing-home age' },
    { input: 'type', value: type, effectPct: type === 'flat' ? 0 : effect(B[type]), note: type === 'flat' ? 'reference' : 'vs a flat in a building' },
  ];
  return { ...e, apartment: { profile: { sqm, rooms, newness: isNew ? 'new' : 'existing', built, type }, ppsqm: Math.round(ppsqm / 10) * 10, value,
    range: rg ? { lo: Math.round(value * Math.exp(rg.lo) / 1000) * 1000, hi: Math.round(value * Math.exp(rg.hi) / 1000) * 1000, basis: 'validation-80' } : null,
    effects, cls: 'MODEL', note: 'A PROPX model estimate for the stated profile on this street — not an appraisal, an asking price or a guaranteed sale price.' } };
}

function validationFor(tier, city) {
  const v = validation(); if (!v) return null;
  const pick = (x) => (x ? { n: x.n, mdape: x.mdape, p80ape: x.p80ape, p90ape: x.p90ape, mdaeSqm: x.mdaeSqm } : null);
  return { national: pick(v.national), tier: pick(v.byModelTierAllFolds && v.byModelTierAllFolds[tier]), locality: pick(v.byLocality && v.byLocality[city]),
    marketCheck: v.marketCaps && v.marketCaps[city] ? { n: v.marketCaps[city].n, mdape: v.marketCaps[city].mdape, p80ape: v.marketCaps[city].p80ape, cap: v.marketCaps[city].cap } : null };
}
let VALIDATION;
/** the stored validation report (data/streets/model/validation.json) */
function validation() { if (VALIDATION === undefined) { try { VALIDATION = JSON.parse(fs.readFileSync(path.join(DIR, 'validation.json'), 'utf8')); } catch { VALIDATION = null; } } return VALIDATION; }

module.exports = { load, reset, estimate, explain, apartment, validation, localityContext, PROFILE_LIMITS, LEVEL_CLASS };
