// PROPX · government (subsidized) housing — read model.
//
// Pure functions over the stored records (data/housing/, written by
// scripts/housing-sync.js), served by the session-gated api/housing.js.
//
//   · Only housing LOTTERIES are aggregated. The source also lists a national
//     grants program (recordType ≠ 'lottery', see normalize.js): it is never a
//     lottery, a project, units, winners or a locality — it is disclosed apart.
//   · Each quantity keeps the source's meaning and is reported on its own:
//       units in FIRST lotteries · units RE-OFFERED in continuation lotteries
//       (the same units can be re-offered several times) · units at signup
//       (marketed) · registrations (applicants summed over lotteries — not
//       people) · winners (not buyers).
//     Nothing here is a signed sale or available inventory (the source has
//     neither: those stay null → "—").
//   · A period the source does not cover is null ("—"), never 0: the newest
//     lottery date in the source bounds every window (meta.coverage). Inside
//     the covered range a month without lotteries is a real 0.
//   · Counts and sums over official rows are DERIVED; a row's own values are
//     OFFICIAL; nothing is modelled or filled in.
//   · Data maturity: a lottery with no winners recorded yet, or held within
//     MATURITY_DAYS, may still change → "updating". Status texts are shown
//     verbatim and are not read as "pending".
//   · "Today" is the date in Israel (Asia/Jerusalem).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { recordTypeOf } = require('./normalize');

const DATA_DIR = process.env.HOUSING_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'housing');
const MATURITY_DAYS = Number(process.env.HOUSING_MATURITY_DAYS) || 90;
const PERIODS = { '6m': 6, '12m': 12, '24m': 24 };
const SORTS = ['lotteryDate', 'city', 'projectName', 'developer', 'unitsInLottery', 'winners', 'applicants', 'pricePerSqm'];
const isLottery = (r) => (r.recordType || recordTypeOf(r)) === 'lottery';

/* ------------------------------------------------------------ loading */
let CACHE = null;
function load(dir = DATA_DIR) {
  let stamp;
  try { stamp = fs.statSync(path.join(dir, 'meta.json')).mtimeMs; } catch { stamp = null; }
  if (CACHE && CACHE.dir === dir && CACHE.stamp === stamp) return CACHE;
  let records = [], meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { /* not synced yet */ }
  try { records = JSON.parse(fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8')); } catch { records = []; }
  CACHE = { dir, stamp, meta, records, lotteries: records.filter(isLottery), others: records.filter((r) => !isLottery(r)),
    byId: new Map(records.map((r) => [r.id, r])), history: null };
  return CACHE;
}
function historyFor(ids, dir = DATA_DIR) {
  const C = load(dir);
  if (!C.history) {
    C.history = new Map();
    let text = '';
    try { text = fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'); } catch { /* none yet */ }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { const h = JSON.parse(line); if (!C.history.has(h.id)) C.history.set(h.id, []); C.history.get(h.id).push(h); } catch { /* skip a torn line */ }
    }
  }
  /* a project-level value (permit, stage) repeats on every lottery row of the project: one change, listed once */
  const groups = new Map();
  for (const h of ids.flatMap((id) => C.history.get(id) || [])) {
    const k = [h.field, JSON.stringify(h.from), JSON.stringify(h.to), h.observedAt].join('|');
    if (!groups.has(k)) groups.set(k, { field: h.field, from: h.from, to: h.to, observedAt: h.observedAt, ids: [] });
    groups.get(k).ids.push(h.id);
  }
  return [...groups.values()].sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0));
}

/* ------------------------------------------------------------ filters */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v) => {
  if (!v || !ISO.test(v)) return null;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
};
const day = (d) => d.toISOString().slice(0, 10);
const IL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
const israelToday = (now = new Date()) => IL_DATE.format(now);   // YYYY-MM-DD in Israel
function monthsBefore(today, n) {
  const d = new Date(today + 'T00:00:00Z');
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return day(target);                                // same calendar day n months earlier (clamped to month end)
}

/** query parameters → validated filter object (unknown values are ignored, never guessed) */
function parseFilters(params, now = new Date()) {
  const g = (k) => { const v = params.get(k); return v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, 120); };
  const today = israelToday(now);
  let period = g('period');
  if (!['6m', '12m', '24m', 'all', 'custom'].includes(period)) period = 'all';
  let from = null, to = null, error = null;
  if (PERIODS[period]) { from = monthsBefore(today, PERIODS[period]); to = today; }
  if (period === 'custom') {
    from = isoDate(g('from')); to = isoDate(g('to'));
    if (!from || !to) error = 'custom period needs from and to as YYYY-MM-DD';
    else if (from > to) error = 'from is after to';
  }
  const f = {
    period, from, to, today,
    city: g('city'),                 // CBS locality code (digits) or the exact official city name
    neighborhood: g('neighborhood'), // exact, as published
    project: g('project'),           // official ProjectId (digits) or a project-name fragment
    developer: g('developer'),       // exact, as published
    program: g('program'),           // mechir-lamishtaken | mechir-matara | dira-behanacha | other
    status: g('status'),             // the ministry's project status (verbatim)
    permit: g('permit'),             // permit status (verbatim)
    lotteryStatus: g('lotteryStatus'),
    type: ['first', 'continuation'].includes(g('type')) ? g('type') : null,
    q: g('q'),                       // free text over project / developer / neighborhood / city
  };
  return { filters: f, error };
}

const norm = (s) => String(s || '').normalize('NFKC').replace(/[׳'`’‘״"“”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function matchFacets(r, f) {
  if (f.city && !(/^\d+$/.test(f.city) ? r.localityCode === Number(f.city) : norm(r.city) === norm(f.city))) return false;
  if (f.neighborhood && norm(r.neighborhood) !== norm(f.neighborhood)) return false;
  if (f.project && !(/^\d+$/.test(f.project) ? r.projectId === Number(f.project) : norm(r.projectName).includes(norm(f.project)))) return false;
  if (f.developer && norm(r.developer) !== norm(f.developer)) return false;
  if (f.program && r.program !== f.program) return false;
  if (f.status && r.projectStatusHe !== f.status) return false;
  if (f.permit && r.permitStatusHe !== f.permit) return false;
  if (f.lotteryStatus && r.lotteryStatus !== f.lotteryStatus) return false;
  if (f.type && r.lotteryType !== f.type) return false;
  if (f.q) { const q = norm(f.q); if (![r.projectName, r.developer, r.neighborhood, r.city].some((x) => norm(x).includes(q))) return false; }
  return true;
}
const inWindow = (r, f) => !f.from || (r.lotteryDate != null && r.lotteryDate >= f.from && r.lotteryDate <= f.to);

/* coverage of the selected window by the source (meta.coverage) */
function windowCoverage(f, meta) {
  const cov = (meta && meta.coverage) || {};
  const to = cov.lotteryDateTo || null, fromC = cov.lotteryDateFrom || null;
  if (!f.from) return { state: to ? 'full' : 'none', coveredFrom: fromC, coveredTo: to };
  if (!to || f.from > to || (fromC && f.to < fromC)) return { state: 'none', coveredFrom: fromC, coveredTo: to };
  return { state: f.to > to || (fromC && f.from < fromC) ? 'partial' : 'full', coveredFrom: fromC, coveredTo: to };
}

/* ------------------------------------------------------------ aggregation */
const sumOrNull = (rows, k) => { const v = rows.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
function median(xs) {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const maturityOf = (r, today) => {
  if (r.winners == null || !r.lotteryDate) return 'updating';       // no result recorded / not placed in time
  const days = (Date.parse(today) - Date.parse(r.lotteryDate)) / 864e5;
  return days < MATURITY_DAYS ? 'updating' : 'settled';
};

/** KPIs over a set of official lottery rows (all DERIVED; null = "—") */
function kpis(rows) {
  if (!rows.length) return null;
  const first = rows.filter((r) => r.lotteryType === 'first');
  const cont = rows.filter((r) => r.lotteryType === 'continuation');
  const priced = first.filter((r) => r.pricePerSqm != null);
  const ratio = first.filter((r) => r.applicants != null && r.unitsInLottery > 0);
  return {
    lotteries: rows.length,
    firstLotteries: first.length,
    continuationLotteries: cont.length,
    projects: new Set(rows.map((r) => r.projectId)).size,
    cities: new Set(rows.map((r) => r.localityCode)).size,
    /* no lottery of a kind in scope is a real 0; lotteries whose value is blank are "—" */
    unitsFirst: first.length ? sumOrNull(first, 'unitsInLottery') : 0,          // lottery units, first lotteries only
    unitsReoffered: cont.length ? sumOrNull(cont, 'unitsInLottery') : 0,        // unit RE-OFFERS — the same units can recur
    unitsAtSignupFirst: first.length ? sumOrNull(first, 'unitsAtSignup') : 0,   // marketed at signup, first lotteries
    applicants: sumOrNull(rows, 'applicants'),                // registrations summed over lotteries — not people
    winners: sumOrNull(rows, 'winners'),
    medianPricePerSqm: median(priced.map((r) => r.pricePerSqm)),
    pricedLotteries: priced.length,
    applicantsPerUnit: ratio.length ? +(ratio.reduce((a, r) => a + r.applicants, 0) / ratio.reduce((a, r) => a + r.unitsInLottery, 0)).toFixed(2) : null,
    pendingResults: rows.filter((r) => r.winners == null).length,     // no winners recorded yet
    /* not published by this source — "—" in the product */
    programUnits: null,
    signedSales: null,
    availableInventory: null,
    subsidizedShareOfUnsold: null,
  };
}

const endOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return day(new Date(Date.UTC(y, m, 0))); };
const startOf = (k) => (k.length === 4 ? k + '-01-01' : k + '-01');
const endOf = (k) => (k.length === 4 ? k + '-12-31' : endOfMonth(k));

/** month or year buckets across the covered part of the window; zeros only inside coverage.
 *  A bucket only partly inside the window or the coverage is flagged `partial`. */
function series(rows, f, cov, bucket) {
  if (cov.state === 'none') return { bucket, points: [] };
  const lo = f.from && cov.coveredFrom ? (f.from > cov.coveredFrom ? f.from : cov.coveredFrom) : f.from || cov.coveredFrom;
  const hi = f.to && cov.coveredTo ? (f.to < cov.coveredTo ? f.to : cov.coveredTo) : f.to || cov.coveredTo;
  if (!lo || !hi || lo > hi) return { bucket, points: [] };
  const key = (d) => (bucket === 'year' ? d.slice(0, 4) : d.slice(0, 7));
  const keys = [];
  if (bucket === 'year') for (let y = +lo.slice(0, 4); y <= +hi.slice(0, 4); y++) keys.push(String(y));
  else {
    let y = +lo.slice(0, 4), m = +lo.slice(5, 7);
    const Y = +hi.slice(0, 4), M = +hi.slice(5, 7);
    while (y < Y || (y === Y && m <= M)) { keys.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  }
  const by = new Map(keys.map((k) => [k, []]));
  for (const r of rows) if (r.lotteryDate && by.has(key(r.lotteryDate))) by.get(key(r.lotteryDate)).push(r);
  return {
    bucket,
    points: keys.map((k) => {
      const rs = by.get(k), first = rs.filter((r) => r.lotteryType === 'first');
      return { period: k, lotteries: rs.length, projects: new Set(rs.map((r) => r.projectId)).size,
        unitsFirst: first.reduce((a, r) => a + (r.unitsInLottery || 0), 0),
        unitsAtSignupFirst: first.reduce((a, r) => a + (r.unitsAtSignup || 0), 0),
        unitsReoffered: rs.filter((r) => r.lotteryType === 'continuation').reduce((a, r) => a + (r.unitsInLottery || 0), 0),
        winners: rs.reduce((a, r) => a + (r.winners || 0), 0),
        partial: lo > startOf(k) || hi < endOf(k) };
    }),
  };
}

/* national → city → neighborhood → project (official geography only; no coordinates exist in this source) */
function breakdown(rows, f) {
  const level = f.neighborhood ? 'project' : f.city ? 'neighborhood' : 'city';
  const keyOf = level === 'city' ? (r) => String(r.localityCode) : level === 'neighborhood' ? (r) => r.neighborhood || '' : (r) => String(r.projectId);
  const groups = new Map();
  for (const r of rows) { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const out = [...groups.entries()].map(([k, rs]) => {
    const K = kpis(rs);
    const label = level === 'city' ? rs[0].city : level === 'neighborhood' ? (k || null) : rs[0].projectName;
    return { level, key: k, label, localityCode: rs[0].localityCode, lotteries: K.lotteries, projects: K.projects,
      unitsFirst: K.unitsFirst, unitsReoffered: K.unitsReoffered, winners: K.winners, medianPricePerSqm: K.medianPricePerSqm,
      lastLotteryDate: rs.map((r) => r.lotteryDate).filter(Boolean).sort().pop() || null };
  });
  out.sort((a, b) => (b.unitsFirst || 0) - (a.unitsFirst || 0) || b.lotteries - a.lotteries);
  return { level, rows: out };
}

/* the filter choices in the scope of the OTHER filters. Every value of any
   period stays selectable (a city in a period the source does not cover then
   shows "—"); the count `n` is for the SELECTED period — null when the source
   does not cover it. */
function facets(all, f, cov) {
  const counted = (rows, valueOf) => {
    const m = new Map();
    for (const r of rows) { const v = valueOf(r); if (v == null) continue; const e = m.get(v) || { all: 0, n: 0, r }; e.all++; if (cov.state !== 'none' && inWindow(r, f)) e.n++; m.set(v, e); }
    return [...m.entries()].sort((a, b) => b[1].all - a[1].all).map(([value, e]) => ({ value, n: cov.state === 'none' ? null : e.n, r: e.r }));
  };
  const without = (k) => all.filter((r) => matchFacets(r, { ...f, [k]: null }));
  const plain = (k, field) => counted(without(k), (r) => r[field]).map(({ value, n }) => ({ value, n }));
  return {
    city: counted(without('city'), (r) => r.localityCode).map(({ value, n, r }) => ({ value: String(value), label: r.city, n })),
    neighborhood: f.city ? plain('neighborhood', 'neighborhood') : [],
    developer: plain('developer', 'developer').slice(0, 300),
    program: plain('program', 'program'),
    status: plain('status', 'projectStatusHe'),
    permit: plain('permit', 'permitStatusHe'),
    lotteryStatus: plain('lotteryStatus', 'lotteryStatus'),
  };
}

/* ------------------------------------------------------------ views */
function freshness(meta) {
  if (!meta) return { synced: false };
  return { synced: true, source: meta.source, sourceUpdatedAt: meta.sourceUpdatedAt, checkedAt: meta.checkedAt,
    snapshotFetchedAt: meta.snapshotFetchedAt, rows: meta.rows, records: meta.records, coverage: meta.coverage,
    notInLatestSource: meta.notInLatestSource, maturityDays: MATURITY_DAYS };
}

function summary(f, opt = {}) {
  const C = load(opt.dataDir);
  const scoped = C.lotteries.filter((r) => matchFacets(r, f));
  const cov = windowCoverage(f, C.meta);
  const rows = cov.state === 'none' ? [] : scoped.filter((r) => inWindow(r, f));
  const bucket = opt.bucket === 'month' || opt.bucket === 'year' ? opt.bucket : (!f.from || (Date.parse(f.to) - Date.parse(f.from)) / 864e5 > 800 ? 'year' : 'month');
  /* official rows that are not housing lotteries, inside the same filters and period: disclosed, not counted */
  const excluded = (cov.state === 'none' ? [] : C.others.filter((r) => matchFacets(r, f) && inWindow(r, f)))
    .map((r) => ({ id: r.id, lotteryId: r.lotteryId, recordType: r.recordType || recordTypeOf(r), projectName: r.projectName, city: r.city, lotteryDate: r.lotteryDate }));
  return {
    freshness: freshness(C.meta),
    filters: f,
    coverage: cov,
    kpis: cov.state === 'none' ? null : kpis(rows) || (scoped.length || C.lotteries.length ? emptyKpis() : null),
    maturity: cov.state === 'none' ? null : { updating: rows.filter((r) => maturityOf(r, f.today) === 'updating').length, of: rows.length,
      coverage: cov.state, days: MATURITY_DAYS },
    series: series(rows, f, cov, bucket),
    undated: rows.filter((r) => !r.lotteryDate).length,            // counted in the KPIs (all history), not placed in the series
    delisted: rows.filter((r) => r.inLatestSource === false).length, // kept and counted; the source no longer lists them
    excluded,
    breakdown: breakdown(rows, f),
    facets: facets(C.lotteries, f, cov),
    scopeHasRecords: scoped.length > 0,
  };
}
/* inside the covered range with no matching lottery: a real zero for counts, "—" for values */
const emptyKpis = () => ({ lotteries: 0, firstLotteries: 0, continuationLotteries: 0, projects: 0, cities: 0, unitsFirst: 0, unitsReoffered: 0,
  unitsAtSignupFirst: 0, applicants: 0, winners: 0, medianPricePerSqm: null, pricedLotteries: 0, applicantsPerUnit: null, pendingResults: 0,
  programUnits: null, signedSales: null, availableInventory: null, subsidizedShareOfUnsold: null });

const ROW_FIELDS = ['id', 'lotteryId', 'projectId', 'lotteryDate', 'signupEndDate', 'city', 'localityCode', 'neighborhood', 'projectName',
  'developer', 'program', 'programHe', 'lotteryType', 'lotteryTypeHe', 'marketingBodyHe', 'unitsInLottery', 'unitsAtSignup', 'applicants',
  'winners', 'pricePerSqm', 'lotteryStatus', 'projectStatusHe', 'permitStatusHe', 'inLatestSource'];
const pick = (r, today) => Object.assign(Object.fromEntries(ROW_FIELDS.map((k) => [k, r[k] ?? null])), { maturity: maturityOf(r, today) });

function records(f, opt = {}) {
  const C = load(opt.dataDir);
  const cov = windowCoverage(f, C.meta);
  const rows = cov.state === 'none' ? [] : C.lotteries.filter((r) => matchFacets(r, f) && inWindow(r, f));
  const sort = SORTS.includes(opt.sort) ? opt.sort : 'lotteryDate';
  const dir = opt.order === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const x = a[sort], y = b[sort];
    if (x == null && y == null) return b.lotteryId - a.lotteryId;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir || b.lotteryId - a.lotteryId;
  });
  const size = Math.min(100, Math.max(5, Number(opt.size) || 25));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, Number(opt.page) || 1));
  return { coverage: cov, total: cov.state === 'none' ? null : rows.length, page, pages, size, sort, order: dir === 1 ? 'asc' : 'desc',
    rows: rows.slice((page - 1) * size, page * size).map((r) => pick(r, f.today)) };
}

/** one record with its project (every lottery sharing the official ProjectId), history and provenance */
function record(id, opt = {}) {
  const C = load(opt.dataDir);
  const r = C.byId.get(id) || (/^\d+$/.test(String(id)) ? C.byId.get('lottery:' + id) : null);
  if (!r) return null;
  const today = opt.today || israelToday();
  const lot = isLottery(r);
  const sib = (lot ? C.lotteries.filter((x) => x.projectId === r.projectId) : [r])
    .sort((a, b) => String(a.lotteryDate).localeCompare(String(b.lotteryDate)) || a.lotteryId - b.lotteryId);
  const K = kpis(sib);
  return {
    /* a listed record was observed at the latest check; lastSeenAt is stored only once the source stops listing it */
    record: { ...r, recordType: r.recordType || recordTypeOf(r),
      lastSeenAt: r.inLatestSource === false ? r.lastSeenAt || null : (C.meta && C.meta.checkedAt) || null, maturity: maturityOf(r, today) },
    project: { projectId: r.projectId, projectName: r.projectName, city: r.city, localityCode: r.localityCode, neighborhood: r.neighborhood,
      developer: r.developer, lotteries: sib.map((x) => pick(x, today)), unitsFirst: K.unitsFirst, unitsReoffered: K.unitsReoffered,
      winners: K.winners, applicants: K.applicants,
      firstLotteryDate: sib.map((x) => x.lotteryDate).filter(Boolean)[0] || null,
      lastLotteryDate: sib.map((x) => x.lotteryDate).filter(Boolean).pop() || null },
    /* lifecycle: explicit official evidence only; everything else is "—" */
    lifecycle: {
      permit: r.permitStatusHe ? { value: r.permitStatusHe, stage: r.permitStage, evidence: 'ConstructionPermitName' } : null,
      projectStage: r.projectStatusHe ? { value: r.projectStatusHe, stage: r.projectStage, evidence: 'ProjectStatus' } : null,
      constructionStarted: null,
      completed: null,
      occupied: r.lifecycle && r.lifecycle.occupancyEvidenced ? { value: r.projectStatusHe, evidence: 'ProjectStatus' } : null,
    },
    history: historyFor(sib.map((x) => x.id), opt.dataDir),
    freshness: freshness(C.meta),
  };
}

function status(opt = {}) {
  const C = load(opt.dataDir);
  let runs = [];
  try {
    runs = fs.readFileSync(path.join(opt.dataDir || DATA_DIR, 'sync-runs.jsonl'), 'utf8').trim().split('\n').filter(Boolean).slice(-10)
      .map((l) => { try { const r = JSON.parse(l); delete r.rejectedSample; return r; } catch { return null; } }).filter(Boolean).reverse();
  } catch { /* no runs yet */ }
  return { freshness: freshness(C.meta), records: C.records.length, lotteries: C.lotteries.length, runs };
}

module.exports = { parseFilters, summary, records, record, status, kpis, windowCoverage, maturityOf, monthsBefore, israelToday, load,
  MATURITY_DAYS, DATA_DIR };
