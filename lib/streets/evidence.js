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
// TRANSACTIONS. Identical rows count once; units of one date, amount and parcel on several sub-parcels (one consideration printed
// on every unit, or units sold at one price that day — indistinguishable) each count as observed and none is priced; a consideration under ₪100,000 is NOT MARKET (counted, never
// priced); an unknown portion is counted, never priced; a shard of an earlier window is stale (its locality reads NOT_SWEPT).
// SAMPLE STATES (distinct priced OBSERVED dwelling deals in the 36-month window — thresholds in SAMPLE, documented in README):
//   SUPPORTED   ≥ 10 → median price, P10–P90, rooms / size mix; median ₪/m² on its own count (≥ 10 plain, 5–9 limited);
//                       12-month change on ₪/m² only with ≥ 30 in each half, with a 95 % bootstrap band
//   LIMITED     5–9  → median shown with n and min–max, labelled LIMITED, no percentiles, no change
//   INSUFFICIENT 1–4 (or observed deals none of them priced) → the street price is "—"; the deals are listed
//   NONE        0 observed deals → "no observed transactions" — NOT a zero price
// CONTEXT (shown apart, "describes the surrounding market, not prices on this street"): the locality's dwelling deals in the
// same window (all address states — the locality is certain); a neighbourhood only through a VERIFIED street link.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SD = require('./directory');
const { classifyNewness } = require('../gov/classify');

const DIR = process.env.STREET_EVIDENCE_DIR || path.join(__dirname, '..', '..', 'data', 'streets', 'evidence');
const WINDOW_MONTHS = 36;
const SHARD_SCHEMA = 1;
const META_SCHEMA = 1;
const ROW_COLUMNS = Object.freeze(['date', 'amount', 'nature', 'areaSqm', 'rooms', 'yearBuilt', 'portionFraction', 'subParcel', 'parcel', 'declaredAmount', 'settlement']);
const PARCEL_COLUMNS = Object.freeze(['gush', 'helka', 'addressesTotal', 'addresses', 'state', 'streets', 'reasons']);
const R = Object.fromEntries(ROW_COLUMNS.map((c, i) => [c, i]));
const P = Object.fromEntries(PARCEL_COLUMNS.map((c, i) => [c, i]));
const DWELLING_NATURES = Object.freeze(new Set(["דירה בבית קומות", 'דירת גן', 'דירת גג', "קוטג' חד משפחתי", "קוטג' דו משפחתי", "קוטג' טורי", 'בית בודד']));
/* named exclusions: the publisher notes most "מגורים" / "ד. מגורים" rows are land or rights, not dwellings (no rooms, no area) */
const EXCLUDED_NATURES = Object.freeze(new Set(['מגורים', 'ד. מגורים']));
/* the register's apostrophes vary (' ׳ ’ `); a nature is compared on one spelling */
const natureKey = (n) => (n == null ? null : String(n).replace(/[׳’‘`]/g, "'").replace(/\s+/g, ' ').trim());
/* SAMPLE: priced deals for SUPPORTED / LIMITED; ₪/m² has its own count; the change needs CHANGE_HALF deals with ₪/m² in EACH half */
const SAMPLE = Object.freeze({ SUPPORTED: 10, LIMITED: 5, CHANGE_HALF: 30 });
/* a reported consideration below MIN_MARKET (or a ₪/m² below MIN_SQM) is not a market sale of a dwelling: counted and listed,
   never priced (gifts, family transfers, symbolic amounts) */
const MIN_MARKET = 100000, MIN_SQM = 2000;
const STATE = Object.freeze({ SUPPORTED: 'SUPPORTED', LIMITED: 'LIMITED', INSUFFICIENT: 'INSUFFICIENT', NONE: 'NONE', NOT_SWEPT: 'NOT_SWEPT' });

const readJson = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };

/* ── calendar arithmetic (ISO days, UTC) — the same rule as the sweep window ── */
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** the ISO date k calendar months before iso (the day clamped to the month's length) */
function minusMonths(iso, k) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  let mm = m - k, yy = y; while (mm < 1) { mm += 12; yy--; }
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, daysIn(yy, mm))).padStart(2, '0')}`;
}

/* ── statistics (pure) ── */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const median = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? quantile(s, 0.5) : null; };
const mean = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
const round = (x, to = 1) => (x == null ? null : Math.round(x / to) * to);
/* a seeded generator: the same inputs give the same interval on every read */
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** 95 % percentile-bootstrap interval of median(a) / median(b) − 1 (1,000 resamples, seeded by the data) */
function ratioInterval(a, b) {
  const r = rng(a.length * 7919 + b.length * 104729 + Math.round(median(a) + median(b)));
  const res = (xs) => { const o = new Array(xs.length); for (let i = 0; i < xs.length; i++) o[i] = xs[Math.floor(r() * xs.length)]; return median(o); };
  const out = []; for (let i = 0; i < 1000; i++) out.push(res(a) / res(b) - 1);
  out.sort((x, y) => x - y);
  return [quantile(out, 0.025), quantile(out, 0.975)];
}

/** a stored row → a deal object */
function dealOf(shard, row) {
  const par = shard.parcels[row[R.parcel]];
  const nature = shard.natures[row[R.nature]] || null;
  const date = row[R.date];
  const yb = row[R.yearBuilt] != null && row[R.yearBuilt] > 1800 ? row[R.yearBuilt] : null;
  const dy = date ? Number(date.slice(0, 4)) : null;
  const portion = row[R.portionFraction];
  const amount = row[R.amount] != null && row[R.amount] > 0 ? row[R.amount] : null;
  const area = row[R.areaSqm] != null && row[R.areaSqm] > 0 ? row[R.areaSqm] : null;
  const notMarket = amount != null && amount < MIN_MARKET;
  const priced = portion === 1 && amount != null && !notMarket;
  const ppsqm = priced && area ? Math.round(amount / area) : null;
  /* PROBABLE NEW by the product's one rule (lib/gov/classify.js): build year = deal year or deal year − 1; a build year after the
     deal year is not classified — the register has no new / second-hand flag, so never CONFIRMED */
  const cls = classifyNewness({ dealNature: null, yearBuilt: yb, dealYear: dy });
  return {
    date, amount, nature, dwelling: DWELLING_NATURES.has(natureKey(nature)), areaSqm: area, rooms: row[R.rooms] != null && row[R.rooms] > 0 ? row[R.rooms] : null,
    yearBuilt: yb, portionFraction: portion, partialSale: portion != null && portion < 1, portionMissing: portion == null,
    notMarket, priced, pricePerSqm: ppsqm != null && ppsqm >= MIN_SQM ? ppsqm : null, sqmImplausible: ppsqm != null && ppsqm < MIN_SQM,
    probableNew: cls.newness === 'probable_new', buildYearAfterDeal: yb != null && dy != null && yb > dy,
    gush: par ? par[P.gush] : null, helka: par ? par[P.helka] : null, subParcel: row[R.subParcel],
    declaredAmount: row[R.declaredAmount], settlement: shard.settlements[row[R.settlement]] || null,
    match: par ? par[P.state] : null, parcelAddresses: par ? par[P.addresses] : [], parcelAddressesTotal: par ? par[P.addressesTotal] : 0,
    reasons: par ? par[P.reasons] : [],
  };
}

/** a street's statistics from its OBSERVED dwelling deals (pure; `asOf` = the window's end; deals are distinct transactions) */
function stats(deals, asOf, opt = {}) {
  const priced = deals.filter((d) => d.priced);
  const withSqm = priced.filter((d) => d.pricePerSqm != null);
  const n = priced.length;
  const state = !deals.length ? STATE.NONE : n >= SAMPLE.SUPPORTED ? STATE.SUPPORTED : n >= SAMPLE.LIMITED ? STATE.LIMITED : STATE.INSUFFICIENT;
  const showMedian = state === STATE.SUPPORTED || state === STATE.LIMITED;
  /* calendar windows: "the last 12 months" = after the date 12 months before the window's end */
  const cut = (k) => (asOf ? minusMonths(asOf, k) : null);
  const within = (k) => (asOf ? deals.filter((d) => d.date && d.date > cut(k) && d.date <= asOf).length : null);
  const prices = priced.map((d) => d.amount).sort((a, b) => a - b);
  const sqm = withSqm.map((d) => d.pricePerSqm).sort((a, b) => a - b);
  const bucket = (xs, edges, label) => { const out = Object.fromEntries(label.map((l) => [l, 0])); out.unknown = 0;
    for (const x of xs) { if (x == null) { out.unknown++; continue; } const i = edges.findIndex((e) => x < e); out[label[i < 0 ? label.length - 1 : i]]++; } return out; };
  /* change: median ₪/m² of the latest 12 months vs the 12 before, each half ≥ CHANGE_HALF deals with ₪/m²; a 95 % bootstrap
     interval beside it — a change whose interval spans 0 is "not distinguishable from no change"; each half's median area and
     probably-new share are printed (a mix shift reads as a price change) */
  let change;
  if (opt.change === false) change = { pct: null, reason: 'not computed for a context figure' };
  else if (state !== STATE.SUPPORTED || !asOf) change = { pct: null, reason: 'the street sample does not support a change over time' };
  else {
    const a = withSqm.filter((d) => d.date > cut(12)), b = withSqm.filter((d) => d.date > cut(24) && d.date <= cut(12));
    if (a.length < SAMPLE.CHANGE_HALF || b.length < SAMPLE.CHANGE_HALF) change = { pct: null, recentN: a.length, priorN: b.length, reason: 'each 12-month half needs ≥ ' + SAMPLE.CHANGE_HALF + ' deals with a price per m²' };
    else {
      const av = a.map((d) => d.pricePerSqm), bv = b.map((d) => d.pricePerSqm);
      const [lo, hi] = ratioInterval(av, bv);
      const share = (xs) => Math.round((xs.filter((d) => d.probableNew).length / xs.length) * 100);
      change = { basis: 'median price per m², latest 12 months vs the 12 months before', recentN: a.length, priorN: b.length,
        recentMedianPerSqm: round(median(av), 10), priorMedianPerSqm: round(median(bv), 10), pct: Math.round((median(av) / median(bv) - 1) * 1000) / 10,
        interval95: [Math.round(lo * 1000) / 10, Math.round(hi * 1000) / 10], distinguishable: lo > 0 || hi < 0,
        recentMedianArea: round(median(a.map((d) => d.areaSqm)), 1), priorMedianArea: round(median(b.map((d) => d.areaSqm)), 1),
        recentProbableNewPct: share(a), priorProbableNewPct: share(b) };
    }
  }
  const latest = deals.slice().sort((x, y) => (y.date || '').localeCompare(x.date || ''))[0] || null;
  return {
    state, observed: deals.length, priced: n, withSqm: withSqm.length,
    partial: deals.filter((d) => d.partialSale).length, portionMissing: deals.filter((d) => d.portionMissing).length,
    notMarket: deals.filter((d) => d.notMarket).length, bulk: deals.filter((d) => d.sameConsideration > 1).length,
    declaredDiffers: deals.filter((d) => d.declaredAmount != null).length, probableNew: deals.filter((d) => d.probableNew).length,
    buildYearAfterDeal: deals.filter((d) => d.buildYearAfterDeal).length,
    last12: within(12), last24: within(24), last36: within(36),
    latest: latest ? { date: latest.date, amount: latest.priced ? latest.amount : null, rooms: latest.rooms, areaSqm: latest.areaSqm } : null,
    medianPrice: showMedian ? round(median(prices), 1000) : null,
    priceMinMax: state === STATE.LIMITED ? { min: prices[0], max: prices[prices.length - 1] } : null,
    meanPrice: state === STATE.SUPPORTED ? round(mean(prices), 1000) : null,
    /* ₪/m² on its own count: ≥ 10 plain, 5–9 labelled limited */
    medianPricePerSqm: showMedian && withSqm.length >= SAMPLE.LIMITED ? round(median(sqm), 10) : null,
    sqmLimited: showMedian && withSqm.length >= SAMPLE.LIMITED && withSqm.length < SAMPLE.SUPPORTED,
    priceRange: state === STATE.SUPPORTED ? { p10: round(quantile(prices, 0.1), 1000), p25: round(quantile(prices, 0.25), 1000), p75: round(quantile(prices, 0.75), 1000), p90: round(quantile(prices, 0.9), 1000) } : null,
    sqmRange: state === STATE.SUPPORTED && withSqm.length >= SAMPLE.SUPPORTED ? { p10: round(quantile(sqm, 0.1), 10), p90: round(quantile(sqm, 0.9), 10) } : null,
    rooms: state === STATE.SUPPORTED ? bucket(priced.map((d) => d.rooms), [3, 4, 5, 6], ['≤2.5', '3–3.5', '4–4.5', '5–5.5', '6+']) : null,
    size: state === STATE.SUPPORTED ? bucket(priced.map((d) => d.areaSqm), [60, 90, 120, 160], ['<60', '60–89', '90–119', '120–159', '160+']) : null,
    change,
  };
}

/* ── the stored sweep ── */
function store(dir = DIR) {
  const meta = readJson(dir, 'meta.json');
  const summary = readJson(dir, 'summary.json');
  return { dir, meta, summary, available: !!(meta && summary && meta.window) };
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
const sameWindow = (a, b) => !!(a && b && a.from === b.from && a.to === b.to);
/** the shard of a locality for the stored window: {shard} · {stale} (an earlier window) · {none: true} (no deal in the window) · {} */
/* why a locality has no usable shard: a stale shard (another window), a locality the sweep has not finished / failed / not yet
   reached, or one the register copy lists no settlement name for (a complete sweep without it) */
function notSweptReason(code, S, f) {
  if (f.stale) return 'stale-shard';
  const m = S.meta || {}, sw = m.sweep || {}, st = m.settlements || {};
  if (sw.status !== 'COMPLETE' || (sw.failed || []).some((x) => x.code === Number(code)) || (st.awaitingSweep || []).includes(Number(code))) return 'sweep-pending';
  return 'not-in-register-copy';
}
function shardFor(code, S) {
  const sh = shard(code, S.dir);
  if (sh && sameWindow(sh.window, S.meta.window)) return { shard: sh };
  if (S.meta.settlements && (S.meta.settlements.noDealsInWindow || []).includes(Number(code))) return { none: true };
  return sh ? { stale: true } : {};
}

/**
 * Every transaction of a locality's shard with the streets it touches: [{deal, streets:[{code, via, houses}]}].
 * IDENTICAL rows (every column equal) are one transaction (`copies`). Rows of one date, one amount and one parcel on several
 * sub-parcels are SAME-CONSIDERATION units: the register may print one total on every unit of a multi-unit deal, or several
 * units may have sold at one price the same day — the two cannot be told apart, so each unit counts as observed and NONE is
 * priced (`sameConsideration` = the number of units). A row without an amount is never grouped.
 */
const DEALS = new WeakMap();   // shard → its transactions (a shard object is immutable once read; the LRU keeps it)
function dealsOf(sh) {
  if (DEALS.has(sh)) return DEALS.get(sh);
  const seen = new Map(), groups = new Map();
  const out = [];
  sh.rows.forEach((row) => {
    const full = JSON.stringify(row);
    if (seen.has(full)) { seen.get(full).deal.copies = (seen.get(full).deal.copies || 1) + 1; return; }
    const d = dealOf(sh, row);
    const par = sh.parcels[row[R.parcel]];
    const x = { deal: d, streets: (par ? par[P.streets] : []).map(([code, via, houses]) => ({ code, via, houses })) };
    seen.set(full, x); out.push(x);
    if (d.amount != null) { const k = [row[R.date], row[R.amount], row[R.parcel]].join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([x, row[R.subParcel]]); }
  });
  for (const g of groups.values()) {
    const subs = new Set(g.map(([, sub]) => sub));
    if (g.length > 1 && subs.size > 1) for (const [x] of g) { x.deal.sameConsideration = subs.size; x.deal.priced = false; x.deal.pricePerSqm = null; }
  }
  DEALS.set(sh, out);
  return out;
}
/* street code → its transactions, per shard */
const BY_STREET = new WeakMap();
function byStreetOf(sh) {
  if (BY_STREET.has(sh)) return BY_STREET.get(sh);
  const m = new Map();
  for (const x of dealsOf(sh)) for (const s of x.streets) { if (!m.has(s.code)) m.set(s.code, []); m.get(s.code).push(x); }
  BY_STREET.set(sh, m);
  return m;
}
const LOCALITY = new WeakMap();   // shard → the locality's context read

/**
 * The street-level evidence of one official street id.
 * @returns {null when the sweep is not stored | {swept:false} when its locality was not swept | the evidence}
 */
function street(id, opt = {}) {
  const ref = SD.parseId(id);
  if (!ref) return null;
  const S = store(opt.dir || DIR);
  if (!S.available) return null;
  const window = S.meta.window;
  const f = shardFor(ref.cityCode, S);
  if (f.stale || (!f.shard && !f.none)) return { swept: false, state: STATE.NOT_SWEPT, stale: !!f.stale, reason: notSweptReason(ref.cityCode, S, f), window, source: sourceOf(S.meta) };
  const mine = f.shard ? byStreetOf(f.shard).get(ref.streetCode) || [] : [];
  const observed = mine.filter((x) => x.deal.match === 'OBSERVED' && x.deal.dwelling);
  const possible = mine.filter((x) => x.deal.match === 'POSSIBLE' && x.deal.dwelling);
  const nonDwelling = mine.filter((x) => !x.deal.dwelling);
  const house = (x) => { const s = x.streets.find((y) => y.code === ref.streetCode); return s ? s.houses : []; };
  const via = (x) => { const s = x.streets.find((y) => y.code === ref.streetCode); return s ? s.via : null; };
  const st = stats(observed.map((x) => x.deal), window.to);
  /* concentration: the parcel holding most of the priced deals — a street sample dominated by one parcel (one building /
     project) describes that parcel; stated beside the median, never hidden or re-weighted */
  const pricedObs = observed.filter((x) => x.deal.priced);
  let concentration = null;
  if (pricedObs.length >= SAMPLE.LIMITED) {
    const byParcel = new Map();
    for (const x of pricedObs) { const k = x.deal.gush + '/' + x.deal.helka; if (!byParcel.has(k)) byParcel.set(k, []); byParcel.get(k).push(x); }
    const [k, xs] = [...byParcel].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
    const share = xs.length / pricedObs.length;
    if (share >= 0.5) concentration = { parcel: k, houses: [...new Set(xs.flatMap(house))].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)), n: xs.length, of: pricedObs.length,
      share: Math.round(share * 100), buildYearAfterDeal: xs.filter((x) => x.deal.buildYearAfterDeal).length };
  }
  const list = (xs, extra) => xs.map((x) => ({ ...x.deal, houses: house(x), via: via(x), ...(extra ? extra(x) : {}) }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return {
    swept: true, id, window, source: sourceOf(S.meta, f.shard), stats: st, concentration, noDealsInLocality: !!f.none,
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
  const f = shardFor(code, S);
  if (f.stale || (!f.shard && !f.none)) return { swept: false, state: STATE.NOT_SWEPT, stale: !!f.stale, reason: notSweptReason(code, S, f), window: S.meta.window };
  if (f.shard && LOCALITY.has(f.shard)) return LOCALITY.get(f.shard);
  const all = f.shard ? dealsOf(f.shard).map((x) => x.deal) : [];
  const dw = all.filter((d) => d.dwelling);
  /* a context figure: no change over time is computed (the street page prints none for the locality) */
  const st = stats(dw, S.meta.window.to, { change: false });
  const out = { swept: true, cityCode: Number(code), window: S.meta.window, source: sourceOf(S.meta, f.shard), stats: st,
    addressStates: tally(dw.map((d) => d.match)), dwelling: dw.length, all: all.length };
  if (f.shard) LOCALITY.set(f.shard, out);
  return out;
}

/** a neighbourhood's observed dwelling deals — ONLY through verified street → neighbourhood links (lib/geo/neighborhoods) */
function neighbourhood(code, streetCodes, opt = {}) {
  const S = store(opt.dir || DIR);
  if (!S.available || !streetCodes || !streetCodes.length) return null;
  const f = shardFor(code, S);
  if (!f.shard) return null;
  const set = new Set(streetCodes);
  const deals = dealsOf(f.shard).filter((x) => x.deal.dwelling && x.deal.match === 'OBSERVED' && x.streets.some((s) => set.has(s.code))).map((x) => x.deal);
  return { streets: streetCodes.length, stats: stats(deals, S.meta.window.to, { change: false }) };
}

function sourceOf(meta, sh) {
  return { name: meta.source.name, channel: meta.source.channel, scrapedAt: meta.source.scrapedAt, lastDeal: meta.source.lastDeal,
    registerUrl: meta.source.registerUrl, checkedAt: (sh && sh.fetchedAt) || (meta.sweep && meta.sweep.updatedAt) || null,
    sweep: meta.sweep ? meta.sweep.status : null, settlements: sh ? sh.settlements : undefined };
}

/**
 * The national summary (written by the sync; also used by the coverage audit): per street [observed, priced, withSqm,
 * latest, possible] for every street with any deal (distinct transactions); per locality the address-state counts. Only shards
 * of the stored window count; a shard of an earlier window is stale (its locality reads NOT_SWEPT until it is swept again).
 */
function summarize(dir, D, meta) {
  const window = meta ? meta.window : null;
  const streets = {}, localities = {};
  const counts = { localities: 0, staleShards: 0, rows: 0, transactions: 0, dwelling: 0, byState: {}, priced: 0, notMarket: 0, bulk: 0, streetsWithObserved: 0, streetsWithPossibleOnly: 0, duplicatesCollapsed: 0 };
  for (const f of fs.readdirSync(dir).filter((x) => /^\d+\.json$/.test(x)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
    const sh = readJson(dir, f); if (!sh || !Array.isArray(sh.rows)) continue;
    if (window && !sameWindow(sh.window, window)) { counts.staleShards++; continue; }
    counts.localities++; counts.rows += sh.rows.length; counts.duplicatesCollapsed += sh.duplicatesCollapsed || 0;
    const L = { rows: sh.rows.length, transactions: 0, dwelling: 0, OBSERVED: 0, POSSIBLE: 0, UNRESOLVED: 0, NO_ADDRESS: 0, priced: 0 };
    for (const x of dealsOf(sh)) {
      const d = x.deal;
      L.transactions++;
      if (!d.dwelling) continue;
      L.dwelling++; L[d.match] = (L[d.match] || 0) + 1; if (d.priced) L.priced++;
      if (d.notMarket) counts.notMarket++; if (d.sameConsideration > 1) counts.bulk++;
      for (const s of x.streets) {
        const k = sh.cityCode + ':' + s.code;
        const e = streets[k] || (streets[k] = [0, 0, 0, null, 0]);
        if (d.match === 'OBSERVED') { e[0]++; if (d.priced) e[1]++; if (d.pricePerSqm != null) e[2]++; if (!e[3] || d.date > e[3]) e[3] = d.date; }
        else if (d.match === 'POSSIBLE') e[4]++;
      }
    }
    localities[sh.cityCode] = L;
    counts.transactions += L.transactions; counts.dwelling += L.dwelling; counts.priced += L.priced;
    for (const k of ['OBSERVED', 'POSSIBLE', 'UNRESOLVED', 'NO_ADDRESS']) counts.byState[k] = (counts.byState[k] || 0) + (L[k] || 0);
  }
  for (const e of Object.values(streets)) { if (e[0]) counts.streetsWithObserved++; else if (e[4]) counts.streetsWithPossibleOnly++; }
  const noDealsInWindow = meta && meta.settlements ? (meta.settlements.noDealsInWindow || []).filter((c) => !localities[c]) : [];
  return { schema: 2, window, columns: ['observed', 'priced', 'withSqm', 'latest', 'possible'], directory: D ? D.fileHash : null, counts, localities, noDealsInWindow, streets };
}

/** the sample state of a street from the summary alone (coverage audit, search badges) */
function stateOf(summary, cityCode, streetCode) {
  if (!summary) return null;
  if (!summary.localities[cityCode]) return (summary.noDealsInWindow || []).includes(Number(cityCode)) ? STATE.NONE : STATE.NOT_SWEPT;
  const e = summary.streets[cityCode + ':' + streetCode];
  if (!e || !e[0]) return STATE.NONE;
  return e[1] >= SAMPLE.SUPPORTED ? STATE.SUPPORTED : e[1] >= SAMPLE.LIMITED ? STATE.LIMITED : STATE.INSUFFICIENT;
}

module.exports = { DIR, WINDOW_MONTHS, SHARD_SCHEMA, META_SCHEMA, ROW_COLUMNS, PARCEL_COLUMNS, DWELLING_NATURES, EXCLUDED_NATURES, SAMPLE, STATE, MIN_MARKET, MIN_SQM,
  quantile, median, minusMonths, natureKey, stats, dealOf, dealsOf, store, shard, street, locality, neighbourhood, summarize, stateOf, reset };
