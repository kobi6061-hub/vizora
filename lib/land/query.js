// PROPX · Land & Tender — read model.
//
// Pure functions over the stored tender records (data/land/, written by
// scripts/land-sync.js), served by the session-gated api/land.js.
//
//   · Every figure is DERIVED from the Authority's own values; nothing is
//     modelled or filled in. A quantity the records do not carry is null ("—"),
//     never 0 — except a count over a scope that really has no tender.
//   · Lifecycle counts are the status codes: published ≠ open ≠ closed ≠
//     decided ≠ awarded ≠ cancelled. "Awarded units" are the units of lots
//     with a recorded winner, not the tender's published units.
//   · Economics keep their basis: land per unit is Σ winning sums ÷ Σ units
//     over the SAME awarded lots, competitive / fixed-price basis only; ₪/m²
//     bids (מחיר למשתכן) are reported apart and never divided into units.
//     VAT: not stated by the source.
//   · Developers are "observed public tender wins" (lots won on this site),
//     never a land bank; names are the Authority's strings, grouped by exact
//     string only.
//   · Positions: the Authority's polygon centroid when published; otherwise
//     the tender is counted at its locality (registry coordinates) — never a
//     synthetic pin.
//   · The planning pipeline is the RMI inventory (STATE LAND ONLY, dated
//     2022-02-17) and the xplan plans the tenders reference (exact plan
//     number) — labelled so, never "nationwide land".
//   · Periods filter by the published date by default (dateField=published|
//     close|committee). "Today" is the date in Israel.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LIFECYCLE, PRICE_BASES, decorate, planKey } = require('./normalize');
const { shardYear } = require('./store');
const { TENDER_TYPES, PURPOSES, REGIONS, STATUSES } = require('./codes');
const { byId: SOURCES } = require('./sources');

const DATA_DIR = process.env.LAND_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'land');
const GEO_FILE = process.env.GEO_LOCALITIES_FILE || path.join(__dirname, '..', '..', 'data', 'geo', 'localities.json');
const PERIODS = { '6m': 6, '12m': 12, '24m': 24, '5y': 60 };
const DATE_FIELDS = { published: 'publishedDate', close: 'closeDate', committee: 'committeeDate' };
const TRACKS = ['open-market', 'subsidized', 'rental', 'special-population', 'residential-lottery', 'lottery', 'mixed-use', 'commercial-other', 'unknown'];
const RESIDENTIAL = new Set(['open-market', 'subsidized', 'rental', 'special-population', 'residential-lottery', 'lottery', 'mixed-use']);
const SORTS = ['publishedDate', 'closeDate', 'committeeDate', 'units', 'awardedUnits', 'landPerUnit', 'awardedLandTotal', 'city', 'lifecycle', 'michrazId'];

/* ------------------------------------------------------------ loading */
let CACHE = null, GEO = null;
function geo() {
  if (GEO) return GEO;
  const by = new Map();
  try { for (const l of JSON.parse(fs.readFileSync(GEO_FILE, 'utf8')).localities || []) by.set(l.code, l); } catch { /* registry not bundled */ }
  GEO = by; return GEO;
}
function load(dir = DATA_DIR) {
  let stamp; try { stamp = fs.statSync(path.join(dir, 'meta.json')).mtimeMs; } catch { stamp = null; }
  if (CACHE && CACHE.dir === dir && CACHE.stamp === stamp) return CACHE;
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };
  const records = read('tenders.json', []), plans = read('plans.json', { xplan: [], inventory: [] }), reference = read('reference.json', null);
  const G = geo();
  for (const r of records) { const l = G.get(r.localityCode); r.city = l ? l.he : null; r.cityEn = l ? l.en : null; }
  CACHE = { dir, stamp, meta: read('meta.json', null), records, live: records.filter((r) => r.inLatestSource !== false), byId: new Map(records.map((r) => [r.id, r])),
    plans, planByKey: new Map((plans.xplan || []).map((p) => [p.planKey, p])), inventory: plans.inventory || [], reference, history: null };
  return CACHE;
}
/* the lots of one tender, from its year's shard (cached per shard, invalidated with the data stamp) */
const SHARDS = new Map();
function lotsOf(r, dir = DATA_DIR) {
  const C = load(dir), y = shardYear(r), key = dir + '|' + y + '|' + C.stamp;
  if (!SHARDS.has(key)) { SHARDS.clear(); try { SHARDS.set(key, JSON.parse(fs.readFileSync(path.join(dir, `lots-${y}.json`), 'utf8'))); } catch { SHARDS.set(key, {}); } }
  return SHARDS.get(key)[r.id] || null;
}
function historyFor(id, dir = DATA_DIR) {
  const C = load(dir);
  if (!C.history) {
    C.history = new Map(); let text = '';
    try { text = fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'); } catch { /* none */ }
    for (const line of text.split('\n')) { if (!line.trim()) continue; try { const h = JSON.parse(line); if (!C.history.has(h.id)) C.history.set(h.id, []); C.history.get(h.id).push(h); } catch { /* torn line */ } }
  }
  return (C.history.get(id) || []).slice().sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1));
}

/* ------------------------------------------------------------ filters */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v) => (v && ISO.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v ? v : null);
const IL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
const israelToday = (now = new Date()) => IL_DATE.format(now);
function monthsBefore(today, n) {
  const d = new Date(today + 'T00:00:00Z'), target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last)); return target.toISOString().slice(0, 10);
}
const norm = (s) => String(s || '').normalize('NFKC').replace(/[׳'`’‘״"“”]/g, '').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

/** query parameters → validated filters (unknown values ignored, never guessed) */
function parseFilters(params, now = new Date()) {
  const g = (k) => { const v = params.get(k); return v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, 160); };
  const today = israelToday(now);
  let period = g('period'); if (!['6m', '12m', '24m', '5y', 'all', 'custom'].includes(period)) period = 'all';
  let from = null, to = null, error = null;
  if (PERIODS[period]) { from = monthsBefore(today, PERIODS[period]); to = today; }
  if (period === 'custom') { from = isoDate(g('from')); to = isoDate(g('to')); if (!from || !to) error = 'custom period needs from and to as YYYY-MM-DD'; else if (from > to) error = 'from is after to'; }
  const list = (k, allowed) => { const v = g(k); if (!v) return null; const xs = v.split(',').map((x) => x.trim()).filter((x) => !allowed || allowed.includes(x)); return xs.length ? xs : null; };
  const f = { period, from, to, today, dateField: DATE_FIELDS[g('dateField')] ? g('dateField') : 'published',
    city: g('city'), region: g('region'), track: list('track', TRACKS), lifecycle: list('lifecycle', Object.keys(LIFECYCLE)),
    type: g('type'), purpose: g('purpose'), basis: Object.keys(PRICE_BASES).includes(g('basis')) ? g('basis') : null,
    winner: g('winner'), plan: g('plan'), residential: g('residential') === '1' || g('residential') === 'true',
    awarded: g('awarded') === '1' || g('awarded') === 'true', q: g('q') };
  return { filters: f, error };
}
function matchFacets(r, f) {
  if (f.city && !(/^\d+$/.test(f.city) ? r.localityCode === Number(f.city) : norm(r.city) === norm(f.city) || norm(r.cityEn) === norm(f.city))) return false;
  if (f.region && String(r.regionCode) !== String(f.region)) return false;
  if (f.track && !f.track.includes(r.track)) return false;
  if (f.lifecycle && !f.lifecycle.includes(r.lifecycle)) return false;
  if (f.type && String(r.typeCode) !== String(f.type)) return false;
  if (f.purpose && String(r.purposeCode) !== String(f.purpose)) return false;
  if (f.basis && r.priceBasis !== f.basis) return false;
  if (f.winner && !(r.winners || []).some((w) => w.name === f.winner)) return false;
  if (f.plan && !(r.plans || []).some((p) => planKey(p.plan) === f.plan.replace(/\s+/g, ''))) return false;
  if (f.residential && !RESIDENTIAL.has(r.track)) return false;
  if (f.awarded && r.lifecycle !== 'awarded') return false;
  if (f.q) { const q = norm(f.q); if (![r.name, r.city, r.cityEn, r.neighborhood, ...(r.winners || []).map((w) => w.name), ...(r.plans || []).map((p) => p.plan)].some((x) => norm(x).includes(q))) return false; }
  return true;
}
const dateOf = (r, f) => r[DATE_FIELDS[f.dateField]];
const inWindow = (r, f) => !f.from || (dateOf(r, f) != null && dateOf(r, f) >= f.from && dateOf(r, f) <= f.to);
/* coverage of the selected window by the source's own date range for the chosen date field (published / close / committee) */
function windowCoverage(f, meta) {
  const cov = (meta && meta.coverage) || {}, k = f.dateField || 'published';
  const lo = cov[k + 'From'] || cov.publishedFrom || null, hi = cov[k + 'To'] || cov.publishedTo || null;
  if (!f.from) return { state: hi ? 'within' : 'none', coveredFrom: lo, coveredTo: hi, basis: f.dateField };
  if (!hi || f.from > hi || (lo && f.to < lo)) return { state: 'none', coveredFrom: lo, coveredTo: hi, basis: f.dateField };
  return { state: f.to > hi || (lo && f.from < lo) ? 'partial' : 'within', coveredFrom: lo, coveredTo: hi, basis: f.dateField };
}

/* ------------------------------------------------------------ aggregation */
const sumOrNull = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
/* the awarded lots as the slim record carries them: one winner entry per lot, with the lot's units */
const awardedLots = (r) => r.winners || [];
/** Σ winning sums ÷ Σ units over the same awarded lots — competitive bids only (never a ₪/m² bid, never a fixed-price lottery allocation),
 *  and open-market tenders only unless the caller restricted the track (state-discounted מחיר מטרה land is not averaged with open-market land) */
function landPerUnitOver(rows, f = {}) {
  const scope = rows.filter((r) => r.priceBasis === 'competitive-bid' && (f.track ? true : r.track === 'open-market'));
  const lots = scope.flatMap(awardedLots).filter((l) => l.units && l.amount != null);
  const units = lots.reduce((s, l) => s + l.units, 0), total = lots.reduce((s, l) => s + l.amount, 0);
  return { lots: lots.length, units: units || null, total: lots.length ? total : null, perUnit: units ? Math.round(total / units) : null,
    tracks: f.track ? f.track : ['open-market'], basis: 'competitive-bid' };
}
function kpis(rows, f = {}) {
  const lc = (k) => rows.filter((r) => r.lifecycle === k).length;
  const res = rows.filter((r) => RESIDENTIAL.has(r.track));
  const lp = landPerUnitOver(rows, f);
  const psm = rows.filter((r) => r.priceBasis === 'price-per-sqm-bid').flatMap(awardedLots).map((l) => l.amount);
  const withBids = rows.filter((r) => r.economics && r.economics.bidsReceived != null);
  return {
    tenders: rows.length, residentialTenders: res.length, cities: new Set(rows.map((r) => r.localityCode).filter(Boolean)).size,
    published: lc('published'), open: lc('open'), closed: lc('closed'), lotteryPending: lc('lottery-pending'), decided: lc('decided') + lc('decided-no-award'),
    awarded: lc('awarded'), frozen: lc('frozen'), cancelled: lc('cancelled'),
    unitsPublished: rows.length ? sumOrNull(rows.map((r) => r.units)) : null,                     // the Authority's YechidotDiur, every tender in scope
    unitsResidential: res.length ? sumOrNull(res.map((r) => r.units)) : null,
    unitsOpen: sumOrNull(rows.filter((r) => r.lifecycle === 'open' || r.lifecycle === 'published').map((r) => r.units)),
    unitsAwarded: sumOrNull(rows.filter((r) => r.lifecycle === 'awarded').map((r) => r.economics && r.economics.awardedUnits)),
    lots: sumOrNull(rows.map((r) => r.lotsCount)), awardedLotCount: rows.reduce((s, r) => s + awardedLots(r).length, 0),
    winners: new Set(rows.flatMap((r) => (r.winners || []).map((w) => w.name))).size,
    awardedLandTotal: lp.total, landPerUnit: lp.perUnit, landPerUnitLots: lp.lots, landPerUnitUnits: lp.units, landPerUnitTracks: lp.tracks, landPerUnitBasis: lp.basis,
    decidedWithoutDetail: rows.filter((r) => r.lifecycle === 'decided').length, fixedPriceLots: rows.filter((r) => r.priceBasis === 'fixed-price-allocation').reduce((s, r) => s + awardedLots(r).length, 0),
    namedWithoutSum: rows.reduce((s, r) => s + (r.namedWithoutSum || 0), 0),
    pricePerSqmLots: psm.length, pricePerSqmMin: psm.length ? Math.min(...psm) : null, pricePerSqmMax: psm.length ? Math.max(...psm) : null,
    bidsReceived: withBids.length ? withBids.reduce((s, r) => s + r.economics.bidsReceived, 0) : null, tendersWithBids: withBids.length,
    withDetail: rows.filter((r) => r.lotsCount != null).length, withGeometry: rows.filter((r) => r.geometry).length,
    withPlanJoin: rows.filter((r) => r.planning && r.planning.joined).length, withConstructionLink: rows.filter((r) => r.construction && r.construction.links && r.construction.links.length).length,
    vat: 'not-stated-by-source',
    /* not published by these sources — "—" in the product */
    contracted: null, permits: null, constructionStarts: null,
  };
}
const endOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
function series(rows, f, cov, bucket) {
  if (cov.state === 'none') return { bucket, points: [] };
  const lo = f.from ? (cov.coveredFrom && f.from < cov.coveredFrom ? cov.coveredFrom : f.from) : cov.coveredFrom;
  const hi = f.to ? (cov.coveredTo && f.to > cov.coveredTo ? cov.coveredTo : f.to) : cov.coveredTo;
  if (!lo || !hi || lo > hi) return { bucket, points: [] };
  const keys = [];
  if (bucket === 'year') for (let y = +lo.slice(0, 4); y <= +hi.slice(0, 4); y++) keys.push(String(y));
  else { let y = +lo.slice(0, 4), m = +lo.slice(5, 7); const Y = +hi.slice(0, 4), M = +hi.slice(5, 7); while (y < Y || (y === Y && m <= M)) { keys.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } } }
  const by = new Map(keys.map((k) => [k, []]));
  for (const r of rows) { const d = dateOf(r, f); if (d && by.has(bucket === 'year' ? d.slice(0, 4) : d.slice(0, 7))) by.get(bucket === 'year' ? d.slice(0, 4) : d.slice(0, 7)).push(r); }
  return { bucket, dateField: f.dateField, points: keys.map((k) => { const rs = by.get(k); return { period: k, tenders: rs.length, units: rs.reduce((s, r) => s + (r.units || 0), 0),
    awarded: rs.filter((r) => r.lifecycle === 'awarded').length, unitsAwarded: rs.reduce((s, r) => s + ((r.economics && r.economics.awardedUnits) || 0), 0), cancelled: rs.filter((r) => r.lifecycle === 'cancelled').length,
    partial: lo > (k.length === 4 ? k + '-01-01' : k + '-01') || hi < (k.length === 4 ? k + '-12-31' : endOfMonth(k)) }; }) };
}
/** cities ranked by published units (the Authority's own unit counts, residential tracks) */
function cities(rows, { limit = 60, f = {} } = {}) {
  const groups = new Map();
  for (const r of rows) { if (!r.localityCode) continue; if (!groups.has(r.localityCode)) groups.set(r.localityCode, []); groups.get(r.localityCode).push(r); }
  return [...groups.entries()].map(([code, rs]) => { const K = kpis(rs, f); const res = rs.filter((r) => RESIDENTIAL.has(r.track));
    return { localityCode: code, city: rs[0].city, cityEn: rs[0].cityEn, tenders: rs.length, residentialTenders: res.length, open: K.open + K.published, awarded: K.awarded, cancelled: K.cancelled,
      units: K.unitsResidential, unitsOpen: sumOrNull(res.filter((r) => r.lifecycle === 'open' || r.lifecycle === 'published').map((r) => r.units)), unitsAwarded: K.unitsAwarded,
      awardedLandTotal: K.awardedLandTotal, landPerUnit: K.landPerUnit, landPerUnitLots: K.landPerUnitLots, winners: K.winners,
      lastPublished: rs.map((r) => r.publishedDate).filter(Boolean).sort().pop() || null, withConstructionLink: K.withConstructionLink }; })
    .sort((a, b) => (b.units || 0) - (a.units || 0) || b.tenders - a.tenders).slice(0, limit);
}
/** developers = observed public tender wins on this site (lots with a recorded winner), grouped by the exact winner string */
function developers(rows, { limit = 60 } = {}) {
  const by = new Map();
  for (const r of rows) for (const l of awardedLots(r)) {
    const e = by.get(l.name) || { name: l.name, lotsWon: 0, tenders: new Set(), cities: new Set(), units: 0, unitsKnown: 0, landTotal: 0, landLots: 0, landUnits: 0, perSqmLots: 0, firstWin: null, lastWin: null };
    e.lotsWon++; e.tenders.add(r.id); if (r.localityCode) e.cities.add(r.localityCode);
    if (l.units) { e.units += l.units; e.unitsKnown++; }
    if (r.priceBasis === 'competitive-bid' && l.amount != null) { e.landTotal += l.amount; e.landLots++; if (l.units) e.landUnits += l.units; }
    else if (r.priceBasis === 'price-per-sqm-bid') e.perSqmLots++; else if (r.priceBasis === 'fixed-price-allocation') e.fixedLots = (e.fixedLots || 0) + 1;
    const d = r.committeeDate || r.closeDate; if (d) { if (!e.firstWin || d < e.firstWin) e.firstWin = d; if (!e.lastWin || d > e.lastWin) e.lastWin = d; }
    by.set(l.name, e);
  }
  return [...by.values()].map((e) => ({ name: e.name, lotsWon: e.lotsWon, tendersWon: e.tenders.size, cities: e.cities.size, unitsInLotsWon: e.unitsKnown ? e.units : null, unitsKnownLots: e.unitsKnown,
    landTotalCompetitive: e.landLots ? e.landTotal : null, landLots: e.landLots, landPerUnit: e.landUnits ? Math.round(e.landTotal / e.landUnits) : null, perSqmLots: e.perSqmLots, fixedLots: e.fixedLots || 0,
    firstWin: e.firstWin, lastWin: e.lastWin, basis: 'observed-public-tender-wins' }))
    .sort((a, b) => (b.unitsInLotsWon || 0) - (a.unitsInLotsWon || 0) || b.lotsWon - a.lotsWon).slice(0, limit);
}
function facets(all, f, cov) {
  const counted = (rows, valueOf) => { const m = new Map();
    for (const r of rows) { const v = valueOf(r); if (v == null) continue; const e = m.get(v) || { all: 0, n: 0, r }; e.all++; if (cov.state !== 'none' && inWindow(r, f)) e.n++; m.set(v, e); }
    return [...m.entries()].sort((a, b) => b[1].all - a[1].all).map(([value, e]) => ({ value, n: cov.state === 'none' ? null : e.n, r: e.r })); };
  const without = (k) => all.filter((r) => matchFacets(r, { ...f, [k]: null }));
  return {
    city: counted(without('city'), (r) => r.localityCode).slice(0, 400).map(({ value, n, r }) => ({ value: String(value), label: r.city, labelEn: r.cityEn, n })),
    region: counted(without('region'), (r) => r.regionCode).map(({ value, n }) => ({ value: String(value), label: REGIONS[value] || String(value), n })),
    track: counted(without('track'), (r) => r.track).map(({ value, n }) => ({ value, n })),
    lifecycle: counted(without('lifecycle'), (r) => r.lifecycle).map(({ value, n }) => ({ value, label: LIFECYCLE[value] ? LIFECYCLE[value].he : value, n })),
    type: counted(without('type'), (r) => r.typeCode).map(({ value, n }) => ({ value: String(value), label: TENDER_TYPES[value] || String(value), n })),
    purpose: counted(without('purpose'), (r) => r.purposeCode).map(({ value, n }) => ({ value: String(value), label: PURPOSES[value] ? PURPOSES[value].he : String(value), n })),
    winner: counted(all.filter((r) => matchFacets(r, { ...f, winner: null })).flatMap((r) => (r.winners || []).map((w) => ({ ...r, _w: w.name }))), (r) => r._w).slice(0, 300).map(({ value, n }) => ({ value, n })),
  };
}

/* ------------------------------------------------------------ views */
function freshness(meta, C = {}) {
  if (!meta) return { synced: false, store: 'git' };
  return { synced: true, store: 'git', source: meta.source, checkedAt: meta.checkedAt, snapshotFetchedAt: meta.snapshotFetchedAt, rows: meta.rows, records: meta.records,
    inLatestSource: meta.inLatestSource, notInLatestSource: meta.notInLatestSource, coverage: meta.coverage, detail: meta.detail, plans: meta.plans, construction: meta.construction,
    latestPublished: meta.coverage && meta.coverage.publishedTo, cadence: 'daily (GitHub Actions land-sync.yml) · detail re-read on a budget', classification: SOURCES['rmi:michrazim'].classification };
}
function summary(f, opt = {}) {
  const C = load(opt.dataDir);
  const scoped = C.live.filter((r) => matchFacets(r, f));
  const cov = windowCoverage(f, C.meta);
  const rows = cov.state === 'none' ? [] : scoped.filter((r) => inWindow(r, f));
  const bucket = opt.bucket === 'month' || opt.bucket === 'year' ? opt.bucket : (!f.from || (Date.parse(f.to) - Date.parse(f.from)) / 864e5 > 800 ? 'year' : 'month');
  return { freshness: freshness(C.meta, C), filters: f, coverage: cov, kpis: cov.state === 'none' ? null : kpis(rows, f), series: series(rows, f, cov, bucket),
    cities: cities(rows, { limit: opt.limit || 40, f }), developers: developers(rows, { limit: opt.limit || 40 }), facets: facets(C.live, f, cov),
    delisted: C.records.length - C.live.length, scopeHasRecords: scoped.length > 0,
    methodology: { landPerUnit: 'Σ winning sums ÷ Σ units over the same awarded lots; competitive bids only (never ₪/m² bids, never fixed-price lottery allocations); open-market track only unless a track is selected', vat: 'not-stated-by-source',
      developers: 'observed public tender wins on this site, exact winner string — not a land bank', units: "the Authority's published YechidotDiur; awarded units = units of lots with a recorded winner",
      lifecycle: 'the Authority\'s status code; awarded only with a winner name and an award sum or winning bid (a lottery allocation names its allottee); "decided" = the committee decided and the detail has not been read yet; contract / permit / construction not in this source',
      construction: 'MoCH progress rows joined by exact block AND parcel, awarded tenders only, contract year not before the award; not-checked when the source did not answer' } };
}
const ROW_FIELDS = ['id', 'michrazId', 'name', 'page', 'lifecycle', 'lifecycleHe', 'lifecycleEn', 'statusCode', 'status', 'awardScope', 'track', 'typeCode', 'type', 'purposeCode', 'purpose', 'regionCode', 'region',
  'localityCode', 'city', 'cityEn', 'neighborhood', 'units', 'publishedDate', 'openDate', 'closeDate', 'committeeDate', 'lotteryDate', 'priceBasis', 'priceBasisHe', 'priceBasisEn', 'winners', 'detailLevel', 'geoBasis', 'inLatestSource'];
const pick = (raw) => { const r = decorate(raw); return Object.assign(Object.fromEntries(ROW_FIELDS.map((k) => [k, r[k] ?? null])), {
  lots: r.lotsCount ?? null, awardedLots: r.economics ? r.economics.awardedLots : null, awardedUnits: r.economics ? r.economics.awardedUnits ?? null : null,
  awardedLandTotal: r.economics ? r.economics.awardedLandTotal ?? null : null, landPerUnit: r.economics ? r.economics.landPerUnit ?? null : null,
  pricePerSqmMin: r.economics ? r.economics.pricePerSqmMin ?? null : null, pricePerSqmMax: r.economics ? r.economics.pricePerSqmMax ?? null : null,
  bidsReceived: r.economics ? r.economics.bidsReceived : null, perUnitScope: r.economics ? r.economics.perUnitScope ?? null : null, basisEvidence: r.basisEvidence ?? null, namedWithoutSum: r.namedWithoutSum ?? null,
  plans: (r.plans || []).filter((p) => p.via === 'lot').map((p) => p.plan), plansChecked: (r.plans || []).filter((p) => p.via === 'lot' && p.xplanStatus && p.xplanStatus !== 'not-checked').length,
  approvedUnitsInPlans: r.planning ? r.planning.approvedUnitsInPlans : null, constructionLinks: r.construction && r.construction.links ? r.construction.links.length : 0,
  lat: r.geometry ? r.geometry.lat : null, lng: r.geometry ? r.geometry.lng : null, detailFetchedAt: r.provenance && r.provenance.detail ? r.provenance.detail.fetchedAt : null }); };
function records(f, opt = {}) {
  const C = load(opt.dataDir), cov = windowCoverage(f, C.meta);
  const rows = cov.state === 'none' ? [] : C.live.filter((r) => matchFacets(r, f) && inWindow(r, f)).map(pick);
  const sort = SORTS.includes(opt.sort) ? opt.sort : 'publishedDate', dir = opt.order === 'asc' ? 1 : -1;
  rows.sort((a, b) => { const x = a[sort], y = b[sort]; if (x == null && y == null) return b.michrazId - a.michrazId; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * dir || b.michrazId - a.michrazId; });
  const size = Math.min(100, Math.max(5, Number(opt.size) || 25)), pages = Math.max(1, Math.ceil(rows.length / size)), page = Math.min(pages, Math.max(1, Number(opt.page) || 1));
  return { coverage: cov, total: cov.state === 'none' ? null : rows.length, page, pages, size, sort, order: dir === 1 ? 'asc' : 'desc', rows: rows.slice((page - 1) * size, page * size) };
}
/** one tender with its lots, bids, winners, plans (joined), construction evidence, history and provenance */
function record(id, opt = {}) {
  const C = load(opt.dataDir);
  const raw = C.byId.get(id) || (/^\d+$/.test(String(id)) ? C.byId.get('rmi:' + id) : null);
  if (!raw) return null;
  const r = decorate(raw), loc = geo().get(r.localityCode) || null;
  const lots = r.lotsCount != null ? lotsOf(r, opt.dataDir) : null;
  return { record: { ...r, lots, lastSeenAt: r.inLatestSource === false ? r.lastSeenAt || null : (C.meta && C.meta.checkedAt) || null },
    locality: loc ? { code: loc.code, he: loc.he, en: loc.en, lat: loc.lat, lng: loc.lng, district: loc.district } : null,
    plans: (r.plans || []).map((p) => ({ ...p, full: p.via === 'lot' ? C.planByKey.get(p.planKey) || null : null })),
    lifecycle: { stage: r.lifecycle, order: r.lifecycle ? LIFECYCLE[r.lifecycle].order : null, evidence: r.lifecycle ? `StatusMichraz ${r.statusCode} (${STATUSES[r.statusCode] ? STATUSES[r.statusCode].he : '?'})` : null,
      awarded: r.lifecycle === 'awarded' ? { lots: (r.winners || []).length, evidence: (lots || []).filter((l) => l.winner).map((l) => l.winner.evidence) } : null,
      contracted: null, permit: null, constructionStart: r.construction && r.construction.checked ? r.construction.start : null, constructionEvidence: r.construction ? r.construction.evidence : null },
    history: historyFor(r.id, opt.dataDir), freshness: freshness(C.meta, C) };
}
/** the planning pipeline: RMI inventory (STATE LAND ONLY, dated), xplan plans the tenders reference, and the tender funnel — by locality when filtered */
function pipeline(f, opt = {}) {
  const C = load(opt.dataDir);
  const cityCode = f.city && /^\d+$/.test(f.city) ? Number(f.city) : f.city ? (C.live.find((r) => norm(r.city) === norm(f.city) || norm(r.cityEn) === norm(f.city)) || {}).localityCode || -1 : null;
  const inv = C.inventory.filter((p) => cityCode == null || p.localityCode === cityCode);
  const stages = new Map();
  for (const p of inv) { const e = stages.get(p.stage) || { stage: p.stage, plans: 0, potentialUnits: 0, unitsKnown: 0 }; e.plans++; if (p.potentialUnits != null) { e.potentialUnits += p.potentialUnits; e.unitsKnown++; } stages.set(p.stage, e); }
  const rows = C.live.filter((r) => matchFacets(r, f));
  const refPlans = new Map(), planStatus = { found: 0, 'not-found': 0, 'not-checked': 0 };
  for (const r of rows) for (const p of (r.plans || [])) if (p.via === 'lot') { planStatus[p.xplanStatus || 'not-checked']++; if (p.xplan) { const k = planKey(p.plan); refPlans.set(k, { plan: p.plan, ...p.xplan, tenders: (refPlans.get(k) || { tenders: 0 }).tenders + 1 }); } }
  const byCity = new Map();
  for (const p of inv) { if (!p.localityCode) continue; const e = byCity.get(p.localityCode) || { localityCode: p.localityCode, locality: p.locality, plans: 0, potentialUnits: 0 }; e.plans++; e.potentialUnits += p.potentialUnits || 0; byCity.set(p.localityCode, e); }
  const K = kpis(rows, f);
  const invMeta = C.plans.inventoryMeta || null;
  return { freshness: freshness(C.meta, C), filters: f,
    inventory: { label: 'POTENTIAL UNITS FOR MARKETING — STATE LAND ONLY', source: 'datagov:rmi:planning-inventory', asOf: invMeta ? invMeta.sourceUpdatedAt : null, stale: true, plans: inv.length,
      potentialUnits: inv.length ? inv.reduce((s, p) => s + (p.potentialUnits || 0), 0) : null, plansWithUnits: inv.filter((p) => p.potentialUnits != null).length, byStage: [...stages.values()].sort((a, b) => b.potentialUnits - a.potentialUnits),
      topCities: [...byCity.values()].sort((a, b) => b.potentialUnits - a.potentialUnits).slice(0, opt.limit || 30),
      rows: cityCode != null ? inv.slice(0, 200) : undefined },
    referencedPlans: { label: 'plans the tenders in scope reference (exact plan number, Planning Administration)', count: refPlans.size, planNumbers: planStatus,
      approvedUnits: refPlans.size ? [...refPlans.values()].reduce((s, p) => s + (p.approvedUnits || 0), 0) : null, byStation: countBy([...refPlans.values()], (p) => p.station),
      sample: [...refPlans.values()].sort((a, b) => (b.approvedUnits || 0) - (a.approvedUnits || 0)).slice(0, 25) },
    funnel: { published: K.published, open: K.open, closed: K.closed, lotteryPending: K.lotteryPending, decided: K.decided, decidedWithoutDetail: K.decidedWithoutDetail, awarded: K.awarded, cancelled: K.cancelled, frozen: K.frozen,
      unitsPublished: K.unitsResidential, unitsOpen: K.unitsOpen, unitsAwarded: K.unitsAwarded, withConstructionLink: K.withConstructionLink, contracted: null, permits: null, constructionStarts: null,
      note: 'each stage is the Authority\'s status code; contract, permit and construction start are not published by these sources (construction links: exact block/parcel joins to MoCH progress reports, dated)' },
    developmentCosts: C.reference && C.reference.developmentCosts ? refDevCosts(C.reference.developmentCosts, cityCode) : null };
}
const countBy = (arr, k) => { const m = new Map(); for (const x of arr) { const v = k(x); m.set(v, (m.get(v) || 0) + 1); } return [...m.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n); };
function refDevCosts(dc, cityCode) {
  const rows = dc.rows.filter((r) => cityCode == null || r.localityCode === cityCode);
  return { source: dc.source, sourceUpdatedAt: dc.sourceUpdatedAt, basis: dc.basis, projects: rows.length, units: rows.reduce((s, r) => s + (r.units || 0), 0), rows: cityCode != null ? rows.slice(0, 100) : undefined };
}
/** map points: tenders with a published polygon centroid, and locality-level counts for the rest (registry coordinates, never a synthetic pin) */
function mapPoints(f, opt = {}) {
  const C = load(opt.dataDir), cov = windowCoverage(f, C.meta);
  const rows = cov.state === 'none' ? [] : C.live.filter((r) => matchFacets(r, f) && inWindow(r, f));
  const points = rows.filter((r) => r.geometry).slice(0, opt.limit || 3000).map((r) => ({ id: r.id, name: r.name, lat: r.geometry.lat, lng: r.geometry.lng, lifecycle: r.lifecycle, track: r.track, units: r.units, city: r.city, basis: 'tender-polygon-centroid' }));
  const byLoc = new Map();
  for (const r of rows) { if (r.geometry || !r.localityCode) continue; const l = geo().get(r.localityCode); if (!l || l.lat == null) continue;
    const e = byLoc.get(r.localityCode) || { localityCode: r.localityCode, city: l.he, cityEn: l.en, lat: l.lat, lng: l.lng, tenders: 0, units: 0, open: 0, awarded: 0, basis: 'locality' };
    e.tenders++; e.units += r.units || 0; if (r.lifecycle === 'open' || r.lifecycle === 'published') e.open++; if (r.lifecycle === 'awarded') e.awarded++; byLoc.set(r.localityCode, e); }
  return { coverage: cov, points, localities: [...byLoc.values()], withoutPosition: rows.filter((r) => !r.geometry && !(geo().get(r.localityCode) || {}).lat).length };
}
function status(opt = {}) {
  const C = load(opt.dataDir); let runs = [];
  try { runs = fs.readFileSync(path.join(opt.dataDir || DATA_DIR, 'sync-runs.jsonl'), 'utf8').trim().split('\n').filter(Boolean).slice(-10).map((l) => { try { const r = JSON.parse(l); delete r.rejectedSample; delete r.errorSample; return r; } catch { return null; } }).filter(Boolean).reverse(); } catch { /* none */ }
  return { freshness: freshness(C.meta, C), records: C.records.length, live: C.live.length, plans: { xplan: C.plans.xplan ? C.plans.xplan.length : 0, inventory: C.inventory.length }, runs,
    sources: Object.values(SOURCES).map((s) => ({ id: s.id, publisher: s.publisher, name: s.name, classification: s.classification, productionEligible: s.productionEligible, lastPropxCheck: s.lastPropxCheck, latestSourceUpdate: s.latestSourceUpdate, limitations: s.limitations })) };
}

module.exports = { parseFilters, summary, records, record, pipeline, mapPoints, status, kpis, landPerUnitOver, developers, cities, windowCoverage, israelToday, monthsBefore, load, DATA_DIR, RESIDENTIAL };
