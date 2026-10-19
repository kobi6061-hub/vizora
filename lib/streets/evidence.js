// PROPX · STREET MARKET EVIDENCE — the read model over the stored sweep (scripts/street-evidence-sync.js →
// data/streets/evidence/). The STREET DIRECTORY (lib/streets/directory.js) says a street exists; this module says what the
// register shows on it. The two never stand in for each other: a street with no observed deal is a street, and its price is
// "—", never 0, never the city's.
//
// UNIVERSE. Dwelling deals only: the register natures in DWELLING_NATURES (a flat in a building, a garden / roof flat, the
// cottage types, a detached house — the publisher's own advice for "flats"); "מגורים" / "ד. מגורים" are excluded (the
// publisher notes most are land or rights, not dwellings). A deal is PRICED when the whole property changed hands
// (portion_fraction = 1) for a positive amount; it has a ₪/m² only when its area is positive as well. Medians are primary
// (one sale of a whole building moves a mean by millions); the mean is shown beside it, labelled.
//
// STREET ↔ DEAL. Only OBSERVED deals (lib/streets/match.js: every address of the parcel resolves to this one street, the list
// complete) enter a street's statistics. POSSIBLE deals (corner parcel · truncated address list · an unresolved address)
// are listed apart and never aggregated.
//
// SAMPLE STATES (priced OBSERVED dwelling deals in the 36-month window — thresholds in SAMPLE, documented in README):
//   SUPPORTED   ≥ 10 → median price + median ₪/m² (each with its own count ≥ 10), P10–P90, rooms / size mix, 12-month change
//                       when each 12-month half holds ≥ 10
//   LIMITED     5–9  → median shown, labelled LIMITED, no percentiles, no change
//   INSUFFICIENT 1–4 (or observed deals none of them priced) → the street price is "—"; the deals are listed
//   NONE        0 observed deals → "no observed transactions" — NOT a zero price
// CONTEXT (shown apart, "describes the surrounding market, not prices on this street"): the locality's dwelling deals in the
// same window (all address states — the locality is certain); a neighbourhood only through a VERIFIED street link.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SD = require('./directory');

const DIR = process.env.STREET_EVIDENCE_DIR || path.join(__dirname, '..', '..', 'data', 'streets', 'evidence');
const WINDOW_MONTHS = 36;
const SHARD_SCHEMA = 1;
const META_SCHEMA = 1;
const ROW_COLUMNS = Object.freeze(['date', 'amount', 'nature', 'areaSqm', 'rooms', 'yearBuilt', 'portionFraction', 'subParcel', 'parcel', 'declaredAmount', 'settlement']);
const PARCEL_COLUMNS = Object.freeze(['gush', 'helka', 'addressesTotal', 'addresses', 'state', 'streets', 'reasons']);
const R = Object.fromEntries(ROW_COLUMNS.map((c, i) => [c, i]));
const P = Object.fromEntries(PARCEL_COLUMNS.map((c, i) => [c, i]));
const DWELLING_NATURES = Object.freeze(new Set(["דירה בבית קומות", 'דירת גן', 'דירת גג', "קוטג' חד משפחתי", "קוטג' דו משפחתי", "קוטג' טורי", 'בית בודד']));
const SAMPLE = Object.freeze({ SUPPORTED: 10, LIMITED: 5, CHANGE_HALF: 10 });
const STATE = Object.freeze({ SUPPORTED: 'SUPPORTED', LIMITED: 'LIMITED', INSUFFICIENT: 'INSUFFICIENT', NONE: 'NONE', NOT_SWEPT: 'NOT_SWEPT' });

const readJson = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };

/* ── statistics (pure) ── */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const median = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? quantile(s, 0.5) : null; };
const mean = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
const round = (x, to = 1) => (x == null ? null : Math.round(x / to) * to);

/** a stored row → a deal object */
function dealOf(shard, row) {
  const par = shard.parcels[row[R.parcel]];
  const nature = shard.natures[row[R.nature]] || null;
  const date = row[R.date];
  const yb = row[R.yearBuilt] != null && row[R.yearBuilt] > 1800 ? row[R.yearBuilt] : null;
  const dy = date ? Number(date.slice(0, 4)) : null;
  const full = row[R.portionFraction] === 1;
  const amount = row[R.amount] != null && row[R.amount] > 0 ? row[R.amount] : null;
  const area = row[R.areaSqm] != null && row[R.areaSqm] > 0 ? row[R.areaSqm] : null;
  const priced = full && amount != null;
  return {
    date, amount, nature, dwelling: DWELLING_NATURES.has(nature), areaSqm: area, rooms: row[R.rooms] != null && row[R.rooms] > 0 ? row[R.rooms] : null,
    yearBuilt: yb, portionFraction: row[R.portionFraction], partialSale: row[R.portionFraction] != null && row[R.portionFraction] < 1,
    priced, pricePerSqm: priced && area ? Math.round(amount / area) : null,
    /* PROBABLE NEW from the building year only (≥ deal year − 1): the register has no new / second-hand flag — never CONFIRMED */
    probableNew: yb != null && dy != null && yb >= dy - 1,
    gush: par ? par[P.gush] : null, helka: par ? par[P.helka] : null, subParcel: row[R.subParcel],
    declaredAmount: row[R.declaredAmount], settlement: shard.settlements[row[R.settlement]] || null,
    match: par ? par[P.state] : null, parcelAddresses: par ? par[P.addresses] : [], parcelAddressesTotal: par ? par[P.addressesTotal] : 0,
    reasons: par ? par[P.reasons] : [],
  };
}

/** a street's statistics from its OBSERVED dwelling deals (pure; `asOf` = the window's end) */
function stats(deals, asOf) {
  const priced = deals.filter((d) => d.priced);
  const withSqm = priced.filter((d) => d.pricePerSqm != null);
  const n = priced.length;
  const state = !deals.length ? STATE.NONE : n >= SAMPLE.SUPPORTED ? STATE.SUPPORTED : n >= SAMPLE.LIMITED ? STATE.LIMITED : STATE.INSUFFICIENT;
  const showMedian = state === STATE.SUPPORTED || state === STATE.LIMITED;
  const end = asOf ? Date.parse(asOf + 'T00:00:00Z') : null;
  const monthsAgo = (d) => (end ? (end - Date.parse(d.date + 'T00:00:00Z')) / (30.4375 * 86400e3) : null);
  const within = (m) => deals.filter((d) => d.date && monthsAgo(d) < m).length;
  const prices = priced.map((d) => d.amount).sort((a, b) => a - b);
  const sqm = withSqm.map((d) => d.pricePerSqm).sort((a, b) => a - b);
  const bucket = (xs, edges, label) => { const out = Object.fromEntries(label.map((l) => [l, 0])); out.unknown = 0;
    for (const x of xs) { if (x == null) { out.unknown++; continue; } const i = edges.findIndex((e) => x < e); out[label[i < 0 ? label.length - 1 : i]]++; } return out; };
  /* change: the latest 12 months vs the 12 before, each with ≥ CHANGE_HALF priced deals (same street, same universe) */
  const a = priced.filter((d) => monthsAgo(d) < 12), b = priced.filter((d) => monthsAgo(d) >= 12 && monthsAgo(d) < 24);
  const change = a.length >= SAMPLE.CHANGE_HALF && b.length >= SAMPLE.CHANGE_HALF
    ? { recentMedian: round(median(a.map((d) => d.amount)), 1000), priorMedian: round(median(b.map((d) => d.amount)), 1000), recentN: a.length, priorN: b.length,
      pct: Math.round((median(a.map((d) => d.amount)) / median(b.map((d) => d.amount)) - 1) * 1000) / 10, basis: 'median price, latest 12 months vs the 12 months before' }
    : { pct: null, recentN: a.length, priorN: b.length, reason: 'each 12-month half needs ≥ ' + SAMPLE.CHANGE_HALF + ' priced deals' };
  const latest = deals.slice().sort((x, y) => (y.date || '').localeCompare(x.date || ''))[0] || null;
  return {
    state, observed: deals.length, priced: n, withSqm: withSqm.length,
    partial: deals.filter((d) => d.partialSale).length, probableNew: deals.filter((d) => d.probableNew).length,
    last12: within(12), last24: within(24), last36: within(36),
    latest: latest ? { date: latest.date, amount: latest.priced ? latest.amount : null, rooms: latest.rooms, areaSqm: latest.areaSqm } : null,
    medianPrice: showMedian ? round(median(prices), 1000) : null,
    meanPrice: state === STATE.SUPPORTED ? round(mean(prices), 1000) : null,
    medianPricePerSqm: showMedian && (withSqm.length >= (state === STATE.SUPPORTED ? SAMPLE.SUPPORTED : SAMPLE.LIMITED)) ? round(median(sqm), 10) : null,
    priceRange: state === STATE.SUPPORTED ? { p10: round(quantile(prices, 0.1), 1000), p25: round(quantile(prices, 0.25), 1000), p75: round(quantile(prices, 0.75), 1000), p90: round(quantile(prices, 0.9), 1000) } : null,
    sqmRange: state === STATE.SUPPORTED && withSqm.length >= SAMPLE.SUPPORTED ? { p10: round(quantile(sqm, 0.1), 10), p90: round(quantile(sqm, 0.9), 10) } : null,
    rooms: state === STATE.SUPPORTED ? bucket(priced.map((d) => d.rooms), [3, 4, 5, 6], ['≤2.5', '3–3.5', '4–4.5', '5–5.5', '6+']) : null,
    size: state === STATE.SUPPORTED ? bucket(priced.map((d) => d.areaSqm), [60, 90, 120, 160], ['<60', '60–89', '90–119', '120–159', '160+']) : null,
    change: state === STATE.SUPPORTED ? change : { pct: null, reason: 'the street sample does not support a change over time' },
  };
}

/* ── the stored sweep ── */
function store(dir = DIR) {
  const meta = readJson(dir, 'meta.json');
  const summary = readJson(dir, 'summary.json');
  return { dir, meta, summary, available: !!(meta && summary) };
}
const SHARDS = new Map();
function shard(code, dir = DIR) {
  const k = dir + '|' + Number(code);
  if (SHARDS.has(k)) { const v = SHARDS.get(k); SHARDS.delete(k); SHARDS.set(k, v); return v; }
  const s = readJson(dir, Number(code) + '.json');
  SHARDS.set(k, s);
  if (SHARDS.size > 24) SHARDS.delete(SHARDS.keys().next().value);
  return s;
}
const reset = () => SHARDS.clear();

/** every deal of a locality's shard with the streets it touches: [{deal, streets:[{code, via, houses}]}] */
function dealsOf(sh) {
  return sh.rows.map((row) => { const d = dealOf(sh, row); const par = sh.parcels[row[R.parcel]];
    return { deal: d, streets: (par ? par[P.streets] : []).map(([code, via, houses]) => ({ code, via, houses })) }; });
}

/**
 * The street-level evidence of one official street id.
 * @returns {null when the sweep is not stored | {swept:false} when its locality was not swept | the evidence}
 */
function street(id, opt = {}) {
  const ref = SD.parseId(id);
  if (!ref) return null;
  const S = store(opt.dir || DIR);
  if (!S.available) return null;
  const sh = shard(ref.cityCode, opt.dir || DIR);
  const window = S.meta.window;
  if (!sh) return { swept: false, state: STATE.NOT_SWEPT, window, source: sourceOf(S.meta) };
  const all = dealsOf(sh);
  const mine = all.filter((x) => x.streets.some((s) => s.code === ref.streetCode));
  const observed = mine.filter((x) => x.deal.match === 'OBSERVED' && x.deal.dwelling);
  const possible = mine.filter((x) => x.deal.match === 'POSSIBLE' && x.deal.dwelling);
  const nonDwelling = mine.filter((x) => !x.deal.dwelling);
  const house = (x) => { const s = x.streets.find((y) => y.code === ref.streetCode); return s ? s.houses : []; };
  const via = (x) => { const s = x.streets.find((y) => y.code === ref.streetCode); return s ? s.via : null; };
  const st = stats(observed.map((x) => x.deal), window.to);
  const list = (xs, extra) => xs.map((x) => ({ ...x.deal, houses: house(x), via: via(x), ...(extra ? extra(x) : {}) }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return {
    swept: true, id, window, source: sourceOf(S.meta, sh), stats: st,
    deals: list(observed),
    possible: list(possible, (x) => ({ otherStreets: x.streets.filter((s) => s.code !== ref.streetCode).map((s) => SD.streetId(ref.cityCode, s.code)) })),
    nonDwelling: { count: nonDwelling.length, natures: tally(nonDwelling.map((x) => x.deal.nature)) },
    matchRungs: tally(observed.map(via)),
  };
}
const tally = (xs) => xs.reduce((a, x) => ((a[x || '—'] = (a[x || '—'] || 0) + 1), a), {});

/** the locality's dwelling market in the same window (every address state — the locality is certain) */
function locality(code, opt = {}) {
  const S = store(opt.dir || DIR);
  if (!S.available) return null;
  const sh = shard(code, opt.dir || DIR);
  if (!sh) return { swept: false, state: STATE.NOT_SWEPT, window: S.meta.window };
  const all = dealsOf(sh).map((x) => x.deal);
  const dw = all.filter((d) => d.dwelling);
  const st = stats(dw, S.meta.window.to);
  return { swept: true, cityCode: Number(code), window: S.meta.window, source: sourceOf(S.meta, sh), stats: st,
    addressStates: tally(dw.map((d) => d.match)), dwelling: dw.length, all: all.length };
}

/** a neighbourhood's observed dwelling deals — ONLY through verified street → neighbourhood links (lib/geo/neighborhoods) */
function neighbourhood(code, streetCodes, opt = {}) {
  const S = store(opt.dir || DIR);
  if (!S.available || !streetCodes || !streetCodes.length) return null;
  const sh = shard(code, opt.dir || DIR);
  if (!sh) return null;
  const set = new Set(streetCodes);
  const deals = dealsOf(sh).filter((x) => x.deal.dwelling && x.deal.match === 'OBSERVED' && x.streets.some((s) => set.has(s.code))).map((x) => x.deal);
  return { streets: streetCodes.length, stats: stats(deals, S.meta.window.to) };
}

function sourceOf(meta, sh) {
  return { name: meta.source.name, channel: meta.source.channel, scrapedAt: meta.source.scrapedAt, lastDeal: meta.source.lastDeal,
    registerUrl: meta.source.registerUrl, checkedAt: (sh && sh.fetchedAt) || (meta.sweep && meta.sweep.updatedAt) || null,
    sweep: meta.sweep ? meta.sweep.status : null, settlements: sh ? sh.settlements : undefined };
}

/**
 * The national summary (written by the sync; also used by the coverage audit): per street [observed, priced, withSqm,
 * latest, possible] for every street with any deal; per locality the address-state counts.
 */
function summarize(dir, D) {
  const streets = {}, localities = {};
  const counts = { localities: 0, rows: 0, dwelling: 0, byState: {}, priced: 0, streetsWithObserved: 0, streetsWithPossibleOnly: 0, duplicatesCollapsed: 0 };
  for (const f of fs.readdirSync(dir).filter((x) => /^\d+\.json$/.test(x)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
    const sh = readJson(dir, f); if (!sh || !Array.isArray(sh.rows)) continue;
    counts.localities++; counts.rows += sh.rows.length; counts.duplicatesCollapsed += sh.duplicatesCollapsed || 0;
    const L = { rows: sh.rows.length, dwelling: 0, OBSERVED: 0, POSSIBLE: 0, UNRESOLVED: 0, NO_ADDRESS: 0, priced: 0 };
    for (const x of dealsOf(sh)) {
      const d = x.deal;
      if (!d.dwelling) continue;
      L.dwelling++; L[d.match] = (L[d.match] || 0) + 1; if (d.priced) L.priced++;
      for (const s of x.streets) {
        const k = sh.cityCode + ':' + s.code;
        const e = streets[k] || (streets[k] = [0, 0, 0, null, 0]);
        if (d.match === 'OBSERVED') { e[0]++; if (d.priced) e[1]++; if (d.pricePerSqm != null) e[2]++; if (!e[3] || d.date > e[3]) e[3] = d.date; }
        else if (d.match === 'POSSIBLE') e[4]++;
      }
    }
    localities[sh.cityCode] = L;
    counts.dwelling += L.dwelling; counts.priced += L.priced;
    for (const k of ['OBSERVED', 'POSSIBLE', 'UNRESOLVED', 'NO_ADDRESS']) counts.byState[k] = (counts.byState[k] || 0) + (L[k] || 0);
  }
  for (const e of Object.values(streets)) { if (e[0]) counts.streetsWithObserved++; else if (e[4]) counts.streetsWithPossibleOnly++; }
  return { schema: 1, columns: ['observed', 'priced', 'withSqm', 'latest', 'possible'], directory: D ? D.fileHash : null, counts, localities, streets };
}

/** the sample state of a street from the summary alone (coverage audit, search badges) */
function stateOf(summary, cityCode, streetCode) {
  if (!summary) return null;
  if (!summary.localities[cityCode]) return STATE.NOT_SWEPT;
  const e = summary.streets[cityCode + ':' + streetCode];
  if (!e || !e[0]) return STATE.NONE;
  return e[1] >= SAMPLE.SUPPORTED ? STATE.SUPPORTED : e[1] >= SAMPLE.LIMITED ? STATE.LIMITED : STATE.INSUFFICIENT;
}

module.exports = { DIR, WINDOW_MONTHS, SHARD_SCHEMA, META_SCHEMA, ROW_COLUMNS, PARCEL_COLUMNS, DWELLING_NATURES, SAMPLE, STATE,
  quantile, median, stats, dealOf, store, shard, street, locality, neighbourhood, summarize, stateOf, reset };
