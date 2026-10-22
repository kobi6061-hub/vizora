// PROPX · DEAL DECISION LAB — the read model (GET /api/intel?view=deal…, answered here: view(name, params) → { status, body }).
//
// A COMPOSITION over read models PROPX already has — it creates no fact, ingests nothing and never re-labels what it reads:
//
//   identity                 lib/streets/street.js identity (the official street directory)
//   comparables              lib/streets/evidence.js — the register copy's stored sweep (dealsOf: one transaction per deal, the
//                            sweep's own priced / partial / same-consideration flags), by LEVEL: STREET (OBSERVED deals of this
//                            street) → only while fewer than `min` comparables: BLOCKS (the cadastral blocks of parcels touching the
//                            street — location only) → NEIGHBOURHOOD (verified street links only) → LOCALITY. Each transaction sits in
//                            exactly one level; every exclusion is counted (universe = included + Σ excluded, per level).
//   model                    lib/streets/value-read.js — the Street Value Model's apartment estimate (MODEL), or its reason
//   official rates           lib/finance — Bank of Israel averages on new housing loans by track (OFFICIAL, national, with the period)
//   freshness · recency      lib/gov/freshness (the register copy's state) · lib/txevents (the street's newest event of every source)
//   street risks             lib/streets/report.js — the assessment (supports · against · could change · due diligence), planning,
//                            transport and surroundings summaries (view=dealStreet)
//
// Statistics per level, never pooled across levels: n · median ₪/m² · P25 / P75 (SUPPORTED only) · min–max (LIMITED) · the asking price's
// ₪/m² percentile (SUPPORTED only) — the street evidence's own thresholds (SUPPORTED ≥ 10 · LIMITED 5–9 · INSUFFICIENT 1–4 · NONE).
// Nothing here values a dwelling, predicts a price or recommends a purchase.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SD = require('../streets/directory');
const EV = require('../streets/evidence');
const ST = require('../streets/street');
const M = require('../streets/match');
const FRESH = require('../gov/freshness');
const E = require('./engine');

const ENGINE = 'propx-deal-lab-1';
const ROOT = path.join(__dirname, '..', '..', 'data');
const ID_RE = /^st:\d{1,5}:\d{1,5}$/;
const LEVELS = Object.freeze(['STREET', 'BLOCKS', 'NEIGHBOURHOOD', 'LOCALITY']);
const LEVEL_CLASS = Object.freeze({ STREET: 'OBSERVED', BLOCKS: 'LOCATION-LINKED', NEIGHBOURHOOD: 'VERIFIED-NEIGHBOURHOOD', LOCALITY: 'LOCALITY-CONTEXT' });
const LEVEL_BASIS = Object.freeze({
  STREET: 'OBSERVED register deals on this street — every address of the deal\'s parcel is on it',
  BLOCKS: 'register deals in the cadastral blocks (gush) of parcels that touch this street — a location link, not this street\'s observed deals',
  NEIGHBOURHOOD: 'OBSERVED register deals on the streets verified-linked to the same neighbourhood — context, not this street',
  LOCALITY: 'register deals anywhere in the locality — context, not this street',
});
/* the funnel: the first rule a transaction fails is the one it is counted under */
const EXCLUSIONS = Object.freeze(['NOT_OBSERVED_ON_STREET', 'NON_DWELLING', 'FUTURE_DATED', 'PARTIAL_SHARE', 'SHARE_NOT_STATED', 'SEVERAL_UNITS_ONE_PRICE',
  'BELOW_MARKET_OR_NO_AMOUNT', 'NOT_PRICED', 'NO_USABLE_AREA', 'OUTSIDE_PERIOD', 'SIZE_OUTSIDE', 'ROOMS_NOT_STATED', 'ROOMS_OUTSIDE']);
/* the similarity filter's starting values (each adjustable by a parameter; the page shows them as the user's filter) */
const FILTER = Object.freeze({ sizeTolPct: 25, roomsTol: 1, months: EV.WINDOW_MONTHS, minComps: EV.SAMPLE.SUPPORTED });
const SAMPLE = EV.SAMPLE;
const FINANCE_TRACKS = Object.freeze(['rateFixedUnindexed', 'rateFixedCpi', 'rateCpi', 'variableUnindexedAnchor', 'variableUnindexedMargin', 'variableCpiAnchor', 'variableCpiMargin', 'pti']);
const TERMS = Object.freeze(['deal_lab', 'deal_comparables', 'deal_comps_level', 'deal_comps_exclusions', 'deal_comps_percentile', 'deal_model_estimate', 'deal_official_rate',
  'deal_user_assumption', 'deal_monthly_payment', 'deal_total_interest', 'deal_purchase_costs', 'deal_equity', 'deal_noi', 'deal_cash_flow', 'deal_gross_yield', 'deal_net_yield',
  'deal_cash_on_cash', 'deal_dscr', 'deal_break_even_rent', 'deal_break_even_price', 'deal_ltv_limit', 'deal_sensitivity', 'deal_scenarios', 'deal_rules', 'deal_memo']);

let SVM, SREPORT, TX, FIN;
const svm = () => { if (SVM === undefined) { try { SVM = require('../streets/value-read'); } catch { SVM = null; } } return SVM; };
const sreport = () => { if (SREPORT === undefined) { try { SREPORT = require('../streets/report'); } catch { SREPORT = null; } } return SREPORT; };
const tx = () => { if (TX === undefined) { try { TX = require('../txevents'); } catch { TX = null; } } return TX; };
const fin = () => { if (FIN === undefined) { try { FIN = require('../finance'); } catch { FIN = null; } } return FIN; };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const round = (x, k) => (x == null ? null : Math.round(x / k) * k);
const today0 = () => new Date().toISOString().slice(0, 10);

/* ── memo per data stamp (every file a view reads; the day — a copy's state ages with it) ── */
const STAMP_FILES = [
  path.join(__dirname, '..', '..', 'data', 'streets', 'evidence', 'meta.json'), path.join(__dirname, '..', '..', 'data', 'streets', 'evidence', 'summary.json'),
  path.join(__dirname, '..', '..', 'data', 'streets', 'model', 'estimates.json'), path.join(__dirname, '..', '..', 'data', 'finance', 'latest.json'),
  path.join(__dirname, '..', '..', 'data', 'txevents', 'national', 'meta.json'), path.join(__dirname, '..', '..', 'data', 'streets', 'recent', 'meta.json'),
  path.join(__dirname, '..', '..', 'data', 'transactions', 'freshness.json'), path.join(__dirname, '..', '..', 'data', 'geo', 'street-geo', 'meta.json'),
  path.join(__dirname, '..', '..', 'data', 'planning', 'national', 'meta.json'), path.join(__dirname, '..', '..', 'data', 'geo', 'neighborhoods.json'),
];
const stamp = () => STAMP_FILES.map(mtime).join('|') + '|' + today0();
const MEMO = new Map();
function memo(key, fn) {
  const k = key + '#' + stamp();
  if (MEMO.has(k)) { const v = MEMO.get(k); MEMO.delete(k); MEMO.set(k, v); return v; }
  const v = fn();
  MEMO.set(k, v);
  while (MEMO.size > 64) MEMO.delete(MEMO.keys().next().value);
  return v;
}
const reset = () => MEMO.clear();

/* ── parameters: strict — a malformed value is a 400, never silently replaced ── */
const PARAMS = Object.freeze({
  sqm: { min: 15, max: 1000 }, rooms: { min: 1, max: 15, step: 0.5 }, months: { min: 1, max: EV.WINDOW_MONTHS, int: true },
  sizeTol: { min: 0, max: 100 }, roomsTol: { min: 0, max: 5, step: 0.5 }, min: { min: 1, max: 50, int: true }, ask: { min: 1, max: E.LIMITS.amount },
  built: { min: 1800, max: 2100, int: true }, limit: { min: 1, max: 500, int: true },
});
const ENUMS = Object.freeze({ newness: ['existing', 'new'], type: ['flat', 'garden', 'roof', 'cottage', 'house'] });
class ParamError extends Error { constructor(param, rule) { super(`invalid ${param}`); this.param = param; this.rule = rule; } }
function parse(p) {
  const out = {};
  for (const [k, r] of Object.entries(PARAMS)) {
    const raw = p[k];
    if (raw == null || String(raw).trim() === '') { out[k] = null; continue; }
    const s = String(raw).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new ParamError(k, 'a number');
    const v = Number(s);
    if (!(v >= r.min && v <= r.max)) throw new ParamError(k, `${r.min}–${r.max}`);
    if (r.int && !Number.isInteger(v)) throw new ParamError(k, 'a whole number');
    if (r.step && Math.abs(v / r.step - Math.round(v / r.step)) > 1e-9) throw new ParamError(k, `a multiple of ${r.step}`);
    out[k] = v;
  }
  for (const [k, vals] of Object.entries(ENUMS)) {
    const raw = p[k];
    if (raw == null || String(raw).trim() === '') { out[k] = null; continue; }
    if (!vals.includes(String(raw))) throw new ParamError(k, vals.join(' | '));
    out[k] = String(raw);
  }
  return out;
}
/** the similarity filter in force: the parameters, else the stated starting values (each named in `filter`) */
function filterOf(q) {
  return { sqm: q.sqm, rooms: q.rooms, sizeTolPct: q.sizeTol != null ? q.sizeTol : FILTER.sizeTolPct, roomsTol: q.roomsTol != null ? q.roomsTol : FILTER.roomsTol,
    months: q.months != null ? q.months : FILTER.months, minComps: q.min != null ? q.min : FILTER.minComps, ask: q.ask,
    sizeApplied: q.sqm != null, roomsApplied: q.rooms != null };
}

/* ── the comparables ── */
function sampleState(n) { return n >= SAMPLE.SUPPORTED ? 'SUPPORTED' : n >= SAMPLE.LIMITED ? 'LIMITED' : n > 0 ? 'INSUFFICIENT' : 'NONE'; }
/** the statistics of one level's comparables (₪/m²; never pooled with another level) */
function statsOf(rows, f) {
  const xs = rows.map((r) => r.pricePerSqm).sort((a, b) => a - b);
  const n = xs.length, state = sampleState(n);
  const showMedian = state === 'SUPPORTED' || state === 'LIMITED';
  const price = rows.map((r) => r.price).sort((a, b) => a - b), area = rows.map((r) => r.areaSqm).sort((a, b) => a - b);
  const askPpsqm = f.ask != null && f.sqm != null ? f.ask / f.sqm : null;
  const median = showMedian ? EV.quantile(xs, 0.5) : null;
  const dates = rows.map((r) => r.date).sort();
  return { n, state, medianPpsqm: round(median, 10), p25: state === 'SUPPORTED' ? round(EV.quantile(xs, 0.25), 10) : null, p75: state === 'SUPPORTED' ? round(EV.quantile(xs, 0.75), 10) : null,
    min: state === 'LIMITED' ? xs[0] : null, max: state === 'LIMITED' ? xs[n - 1] : null,
    medianPrice: showMedian ? round(EV.quantile(price, 0.5), 1000) : null, medianArea: showMedian ? round(EV.quantile(area, 0.5), 1) : null,
    askPpsqm: askPpsqm != null ? Math.round(askPpsqm) : null,
    askPercentile: askPpsqm != null && state === 'SUPPORTED' ? E.percentile(xs, askPpsqm) : null,
    askVsMedianPct: askPpsqm != null && median != null ? Math.round((askPpsqm / median - 1) * 1000) / 10 : null,
    from: dates[0] || null, to: dates[n - 1] || null,
    rule: 'SUPPORTED ≥ 10 → median, P25–P75, the asking percentile · LIMITED 5–9 → median with min–max, no percentiles · INSUFFICIENT 1–4 → no ₪/m² figure · NONE' };
}
/** the reason a transaction is not a comparable (the first rule it fails), or null */
function exclusionOf(d, level, f, ctx) {
  if (level === 'STREET' && d.match !== 'OBSERVED') return 'NOT_OBSERVED_ON_STREET';
  if (!d.dwelling) return 'NON_DWELLING';
  if (d.date && (d.date > ctx.snapshot || d.date > ctx.today)) return 'FUTURE_DATED';
  if (d.partialSale) return 'PARTIAL_SHARE';
  if (d.portionMissing) return 'SHARE_NOT_STATED';
  if (d.sameConsideration > 1) return 'SEVERAL_UNITS_ONE_PRICE';
  if (d.amount == null || d.notMarket) return 'BELOW_MARKET_OR_NO_AMOUNT';
  if (!d.priced) return 'NOT_PRICED';
  if (d.pricePerSqm == null) return 'NO_USABLE_AREA';
  if (!(d.date > ctx.cutoff)) return 'OUTSIDE_PERIOD';
  if (f.sizeApplied && Math.abs(d.areaSqm - f.sqm) / f.sqm > f.sizeTolPct / 100 + 1e-9) return 'SIZE_OUTSIDE';
  if (f.roomsApplied && d.rooms == null) return 'ROOMS_NOT_STATED';
  if (f.roomsApplied && Math.abs(d.rooms - f.rooms) > f.roomsTol + 1e-9) return 'ROOMS_OUTSIDE';
  return null;
}
/* the streets of the verified neighbourhood of this street (lib/geo/neighborhoods — verified links only, resolved exactly) */
function neighbourhoodStreets(idn, D) {
  const { resolveNeighborhood } = require('../geo/neighborhoods');
  const nb = resolveNeighborhood(idn.city || '', idn.name);
  if (!(nb.resolved && nb.method === 'verified-street-link')) return { resolved: false, codes: [], name: null };
  const doc = readJson(path.join(ROOT, 'geo', 'neighborhoods.json'));
  const LI = M.localityIndex(D, idn.cityCode);
  const codes = doc ? [...new Set(doc.streetLinks.filter((x) => x.neighborhoodId === nb.id).map((x) => M.resolveStreet(LI, x.street)).filter((r) => r && r.id).map((r) => SD.parseId(r.id).streetCode))] : [];
  return { resolved: true, id: nb.id, name: nb.name, codes: codes.filter((c) => c !== idn.streetCode) };
}

/**
 * The comparables of one street for a described dwelling.
 * @param id st:<locality>:<street>
 * @param q  parse(params): { sqm, rooms, sizeTol, roomsTol, months, min, ask, limit }
 * @returns null for an id the directory does not hold
 */
function comps(id, q = {}) {
  const D = SD.load();
  const idn = ST.identity(id, D);
  if (!idn) return null;
  const f = filterOf(q);
  const limit = q.limit || 200;
  const S = EV.store();
  const base = { id: idn.id, filter: f, levels: [], primary: null, percentileLevel: null, rows: [], levelBasis: LEVEL_BASIS, levelClass: LEVEL_CLASS, exclusionIds: EXCLUSIONS,
    fieldNotes: { floor: 'the register copy carries no floor — shown "—" for every comparable (the GovMap layer\'s floor text is never joined onto a register deal)' } };
  if (!S.available) return { ...base, available: false, reason: 'evidence-not-loaded' };
  const sh = EV.shardOf(idn.cityCode);
  const window = S.meta.window, snapshot = FRESH.isoDay(FRESH.ts(S.meta.source.scrapedAt));
  const source = { id: 'over:street-evidence', name: S.meta.source.name, channel: S.meta.source.channel, snapshotDate: snapshot, lastDeal: S.meta.source.lastDeal, window, cls: 'OBSERVED' };
  if (!sh) { const ev = EV.street(idn.id); return { ...base, available: false, reason: (ev && ev.reason) || 'locality-not-swept', source }; }
  const ctx = { snapshot, today: today0(), cutoff: EV.minusMonths(window.to, f.months) };
  const all = EV.dealsOf(sh);
  const sc = idn.streetCode;
  /* the blocks of the parcels that touch the street (the model's own location link: OBSERVED / POSSIBLE parcels, never a loose name) */
  const blocks = new Set();
  for (const x of all) if ((x.deal.match === 'OBSERVED' || x.deal.match === 'POSSIBLE') && x.streets.some((s) => s.code === sc && s.via !== 'normalized-name')) blocks.add(String(x.deal.gush));
  const nb = neighbourhoodStreets(idn, D);
  const nbSet = new Set(nb.codes);
  /* each transaction in exactly one level — the narrowest that holds it */
  const byLevel = { STREET: [], BLOCKS: [], NEIGHBOURHOOD: [], LOCALITY: [] };
  for (const x of all) {
    const on = x.streets.some((s) => s.code === sc);
    const lv = on ? 'STREET' : blocks.has(String(x.deal.gush)) ? 'BLOCKS' : nb.resolved && x.deal.match === 'OBSERVED' && x.streets.some((s) => nbSet.has(s.code)) ? 'NEIGHBOURHOOD' : 'LOCALITY';
    byLevel[lv].push(x);
  }
  const nameOf = (code) => { const s = D.byId.get(SD.streetId(idn.cityCode, code)); return s ? s.name : null; };
  let cumulative = 0;
  for (const lv of LEVELS) {
    if (lv === 'NEIGHBOURHOOD' && !nb.resolved) { base.levels.push({ level: lv, used: false, reason: 'no-verified-neighbourhood', universe: null }); continue; }
    if (lv !== 'STREET' && cumulative >= f.minComps) { base.levels.push({ level: lv, used: false, reason: 'narrower-levels-reached-min', universe: byLevel[lv].length }); continue; }
    const excluded = Object.fromEntries(EXCLUSIONS.map((k) => [k, 0]));
    const rows = [];
    for (const x of byLevel[lv]) {
      const d = x.deal;
      const why = exclusionOf(d, lv, f, ctx);
      if (why) { excluded[why]++; continue; }
      const on = x.streets.find((s) => s.code === sc);
      rows.push({ level: lv, date: d.date, price: d.amount, areaSqm: d.areaSqm, pricePerSqm: d.pricePerSqm, rooms: d.rooms, floor: null, yearBuilt: d.yearBuilt,
        probableNew: d.probableNew, buildYearAfterDeal: d.buildYearAfterDeal, nature: d.nature, block: d.gush != null ? String(d.gush) : null, parcel: d.helka != null ? String(d.helka) : null,
        subParcel: d.subParcel != null ? String(d.subParcel) : null, houses: on ? on.houses : [], streets: on ? [idn.name] : x.streets.map((s) => nameOf(s.code)).filter(Boolean).slice(0, 3),
        match: d.match, source: 'over:deals-register', snapshotDate: snapshot, cls: 'OBSERVED', levelCls: LEVEL_CLASS[lv],
        key: `${idn.cityCode}|${d.date}|${d.gush}/${d.helka}/${d.subParcel == null ? '—' : d.subParcel}|${d.amount}` });
    }
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.key.localeCompare(b.key));
    const nExcluded = Object.values(excluded).reduce((a, b) => a + b, 0);
    const st = statsOf(rows, f);
    base.levels.push({ level: lv, used: true, cls: LEVEL_CLASS[lv], basis: LEVEL_BASIS[lv], universe: byLevel[lv].length, included: rows.length, excluded, excludedTotal: nExcluded, stats: st,
      ...(lv === 'BLOCKS' ? { blocks: [...blocks].sort((a, b) => Number(a) - Number(b)) } : {}), ...(lv === 'NEIGHBOURHOOD' ? { neighbourhood: { id: nb.id, name: nb.name, streets: nb.codes.length } } : {}),
      rowsTotal: rows.length, rowsShown: Math.min(rows.length, limit) });
    base.rows.push(...rows.slice(0, limit));
    cumulative += rows.length;
  }
  const used = base.levels.filter((l) => l.used);
  const prim = used.find((l) => l.stats.state === 'SUPPORTED' || l.stats.state === 'LIMITED') || null;
  const pct = used.find((l) => l.stats.state === 'SUPPORTED') || null;
  base.primary = prim ? { level: prim.level, cls: prim.cls, ...prim.stats } : null;
  base.percentileLevel = pct ? { level: pct.level, cls: pct.cls, n: pct.stats.n, state: pct.stats.state, p25: pct.stats.p25, p75: pct.stats.p75, askPercentile: pct.stats.askPercentile, medianPpsqm: pct.stats.medianPpsqm } : null;
  const street = used.find((l) => l.level === 'STREET');
  base.street = street ? { n: street.stats.n, state: street.stats.state } : null;
  /* a street sample dominated by one parcel describes that parcel (the street evidence's own statement) */
  const ev = EV.street(idn.id);
  base.concentration = ev && ev.swept && ev.concentration ? ev.concentration : null;
  return { ...base, available: true, source, window, totals: { transactions: all.length, byLevel: Object.fromEntries(LEVELS.map((l) => [l, byLevel[l].length])) } };
}

/* ── the model's estimate for the described dwelling (lib/streets/value-read.js — read only) ── */
function modelOf(id, q) {
  const V = svm();
  if (!V) return { available: false, reason: 'model-not-built', cls: 'MODEL' };
  const est = V.estimate(id);
  if (!est) return { available: false, reason: 'not-an-official-street', cls: 'MODEL' };
  if (!est.available) return { available: false, reason: est.reason || 'model-not-built', cls: 'MODEL' };
  const meta = est.meta || {};
  const out = { available: est.value != null, cls: 'MODEL', tier: est.tier, reason: est.value == null ? est.reason || 'no-street-estimate' : null,
    street: est.value != null ? { ppsqm: est.value, range: est.range, reference: est.reference } : null, apartment: null, apartmentReason: null,
    asOf: meta.asOf || null, priceLevelQuarter: meta.priceLevelQuarter || null, modelVersion: meta.modelVersion || null, builtAt: meta.builtAt || null,
    validation: est.validation ? { national: est.validation.national, tier: est.validation.tier, locality: est.validation.locality } : null,
    note: 'A PROPX model estimate — not an appraisal, an asking price or a guaranteed sale price; the validation range is the tier\'s 10th–90th percentile of held-out errors, never a confidence interval.' };
  if (est.value != null && q.sqm != null) {
    const A = V.apartment(id, { sqm: q.sqm, rooms: q.rooms, newness: q.newness || undefined, built: q.built, type: q.type || undefined });
    if (A && A.apartment) out.apartment = { value: A.apartment.value, ppsqm: A.apartment.ppsqm, range: A.apartment.range, profile: A.apartment.profile, effects: A.apartment.effects };
    else out.apartmentReason = (A && (A.apartmentReason || A.reason)) || 'not-estimated';
  } else if (q.sqm == null) out.apartmentReason = 'area-not-entered';
  return out;
}

/* ── the official mortgage-rate context (lib/finance: Bank of Israel, national, by track) ── */
function financeOf() {
  const F = fin();
  const L = F ? F.read() : null;
  if (!L) return { available: false, reason: 'finance-not-synced', cls: 'OFFICIAL', ltvRule: E.RULES.ltv };
  const tracks = FINANCE_TRACKS.map((k) => { const m = L.measures[k]; if (!m) return { id: k, missing: 'not-defined' };
    return m.latest ? { id: k, he: m.he, en: m.en, kind: m.kind, value: m.latest.value, period: m.latest.period, previous: m.latest.previous, yearEarlier: m.latest.yearEarlier, changeYear: m.latest.changeYear, cls: 'OFFICIAL' }
      : { id: k, he: m.he, en: m.en, kind: m.kind, value: null, missing: m.missing || 'series-not-published', cls: 'MISSING' }; });
  const s = L.source || {};
  return { available: true, cls: 'OFFICIAL', scope: 'national — the whole banking system (new housing loans issued in the month)', checkedAt: L.checkedAt, freshness: L.freshness,
    source: { id: s.id, publisher: s.publisher, publisherEn: s.publisherEn, dataset: s.dataset, datasetEn: s.datasetEn, page: s.page }, tracks, note: L.note,
    reference: 'rateFixedUnindexed', referenceWhy: 'the engine models a fixed, unindexed rate — the same track\'s official average is the comparable context',
    ltvRule: E.RULES.ltv };
}

/* ── how fresh the evidence is (the register copy) and the street's newest event of every source (lib/txevents) ── */
function freshnessOf() {
  const F = FRESH.fromDisk();
  if (!F) return { available: false, state: 'SOURCE_LAG_UNKNOWN' };
  const nw = (F.newerCopies || [])[0] || null;
  return { available: true, sourceId: F.sourceId, state: F.state, snapshotDate: F.snapshotDate, latestTransactionDate: F.latestTransactionDate, checkedAt: F.checkedAt, ageDays: F.ageDays,
    stale: F.stale, thresholds: F.thresholds, reportingLag: F.reportingLag, newerCopy: nw ? { id: nw.id, name: nw.name, snapshotAt: nw.snapshotAt, latestTransactionDate: nw.latestTransactionDate, readByPropx: nw.readByPropx } : null };
}
function recencyOf(id) {
  const T = tx();
  if (!T) return { available: false, reason: 'transaction-events-not-available' };
  const U = T.query({ streetId: id, all: true, limit: 500 });
  /* deals the GovMap-layer copy prints that the register copy does not hold (late-reported or newer): listed apart — real, dated; the copy
     states no ownership share, so their price never enters a comparable */
  const gm = (U.events || []).filter((e) => e.source === 'govmap' && e.state !== 'POSSIBLE_DUPLICATE');
  const notInRegister = gm.slice(0, 10).map((e) => ({ date: e.date, price: e.price, areaSqm: e.areaSqm, rooms: e.rooms, floor: e.floor || null, houseNumber: e.houseNumber || null,
    propertyType: e.propertyType || null, kind: e.kind, state: e.state, sourceId: e.sourceId, snapshotDate: e.snapshotDate || null, match: e.geo ? e.geo.match : null, priceUsed: false }));
  return { available: true, recency: U.recency, counts: U.counts ? { events: U.counts.events, inStatistics: U.counts.inStatistics, bySource: U.counts.bySourceEvents, byState: U.counts.byState } : null,
    notInRegister, notInRegisterTotal: gm.length,
    notInRegisterRule: 'events on this street from the GovMap-layer copy that the register copy does not hold: real, dated — the copy states no ownership share, so the price is never a comparable' };
}

/* ── the street's risks and due diligence (lib/streets/report.js — the street report's own assessment) ── */
function streetOf(id) {
  const R = sreport();
  if (!R) return { available: false, reason: 'street-report-not-available' };
  const r = R.report(id, { limit: 1 });
  if (!r) return null;
  const P = r.planning || {};
  const plans = (P.plans || []).filter((p) => p.relation === 'INTERSECTS').slice(0, 8).map((p) => ({ planNumber: p.planNumber, name: p.name, stage: p.stage, stageHe: p.stageHe, relation: p.relation,
    distanceM: p.distanceM, planUnitDelta: p.planUnitDelta, url: p.url, lastUpdate: p.lastUpdate }));
  const tr = r.transport && r.transport.available ? { available: true, busStops: r.transport.busStops ? r.transport.busStops.count : null, busNearestM: r.transport.busStops ? r.transport.busStops.nearestM : null,
    lrtStations: r.transport.lrt ? r.transport.lrt.stations.length : null } : { available: false, reason: r.transport ? r.transport.reason : null };
  const su = r.surroundings && r.surroundings.available ? { available: true, contaminatedExact: r.surroundings.contaminated ? r.surroundings.contaminated.exact.length : null,
    contaminatedNearby: r.surroundings.contaminated ? r.surroundings.contaminated.nearby.length : null, education: r.surroundings.education ? r.surroundings.education.institutions.length : null }
    : { available: false, reason: r.surroundings ? r.surroundings.reason : null };
  return { available: true, id: r.id, engine: r.engine, generatedAt: r.generatedAt, assessment: r.assessment, neighbourhood: r.hierarchy ? r.hierarchy.neighbourhood.state : null,
    planning: P.available ? { available: true, summary: P.summary, intersects: plans, fetchedAt: P.fetchedAt, doesNotMean: P.doesNotMean } : { available: false, reason: P.reason || null },
    transport: tr, surroundings: su, sources: r.sources, missing: r.missing };
}

/* ── the views ── */
function identityOf(id) {
  const D = SD.load();
  const idn = ST.identity(id, D);
  return idn ? { id: idn.id, name: idn.name, kind: idn.kind, kindLabel: idn.kindLabel, status: idn.status, city: idn.city, cityEn: idn.cityEn, cityCode: idn.cityCode, streetCode: idn.streetCode, district: idn.district, cls: 'OFFICIAL' } : null;
}
function context() {
  return { engine: ENGINE, dealEngine: E.ENGINE, finance: financeOf(), freshness: freshnessOf(), rules: E.RULES, limits: E.LIMITS, filter: FILTER, sample: { SUPPORTED: SAMPLE.SUPPORTED, LIMITED: SAMPLE.LIMITED }, terms: TERMS };
}
function lab(id, q) {
  const idn = identityOf(id);
  if (!idn) return null;
  const t0 = Date.now();
  const C = comps(id, q);
  return { engine: ENGINE, dealEngine: E.ENGINE, generatedAt: new Date().toISOString(), id: idn.id, identity: idn, comps: C, model: modelOf(id, q), finance: financeOf(), freshness: freshnessOf(),
    recency: recencyOf(id), rules: E.RULES, terms: TERMS,
    doesNotMean: 'not an appraisal, not investment advice: comparables are observed deals (each with its level), the model is a MODEL, every input is the user\'s assumption',
    ms: Date.now() - t0 };
}

const bad = (param, rule) => ({ status: 400, body: { error: 'invalid-param', param, rule } });
/**
 * GET /api/intel?view=deal… → { status, body }
 *   dealContext                        the official rate context, the evidence freshness, the rules' thresholds, the filter's starting values
 *   dealLab      id=st:…[&sqm&rooms&sizeTol&roomsTol&months&min&ask&newness&built&type&limit]   identity · comparables · model · rates · freshness · recency
 *   dealComps    the same parameters                       the comparables only
 *   dealStreet   id=st:…                                    the street report's assessment, planning / transport / surroundings summaries, sources, missing
 */
function view(name, params) {
  const p = params || {};
  try {
    if (name === 'dealContext') return { status: 200, body: memo('ctx', context) };
    if (!['dealLab', 'dealComps', 'dealStreet'].includes(name)) return { status: 400, body: { error: 'unknown view', views: ['dealContext', 'dealLab', 'dealComps', 'dealStreet'] } };
    const id = String(p.id || '').trim();
    if (!ID_RE.test(id)) return bad('id', 'st:<locality code>:<street code>');
    let q;
    try { q = parse(p); } catch (e) { if (e instanceof ParamError) return bad(e.param, e.rule); throw e; }
    if (!identityOf(id)) return { status: 404, body: { error: 'not an official street', id } };
    const key = name + '|' + id + '|' + JSON.stringify(q);
    if (name === 'dealStreet') { const out = memo(key, () => streetOf(id)); return out ? { status: 200, body: out } : { status: 404, body: { error: 'not an official street', id } }; }
    if (name === 'dealComps') { const out = memo(key, () => comps(id, q)); return { status: 200, body: { engine: ENGINE, id, comps: out } }; }
    return { status: 200, body: memo(key, () => lab(id, q)) };
  } catch (e) {
    return { status: 500, body: { error: 'deal-lab-failed' } };
  }
}

module.exports = { ENGINE, LEVELS, LEVEL_CLASS, LEVEL_BASIS, EXCLUSIONS, FILTER, PARAMS, TERMS, view, parse, comps, modelOf, financeOf, freshnessOf, recencyOf, streetOf, identityOf, context, lab, statsOf, exclusionOf, sampleState, reset };
