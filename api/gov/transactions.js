// GET /api/gov/transactions?city=…&street=…&house=…&lat=…&lng=…&newOnly=1
//     [&offset=N&level=building|street|locality]   a later page of the same scope
// Normalized government transactions through the progressive geographic
// fallback ladder (building → street → 250m → 500m → 1000m). The response
// always carries `scope` (what the numbers actually describe), the
// newness partitions, and `unavailable` (why any rung could not serve) —
// including the current no-authorized-connector state of the Tax Authority
// registry, in which the endpoint degrades to an explained empty result,
// never an invented one.
//
// meta says who DELIVERED the rows (GovMap, or the register's independent
// republication by over.org.il — never presented as a government channel),
// when that copy was taken, and `syncedAt` only when a source actually
// answered: a refused or failed source is an attempt (`attemptedAt`), never
// a sync.

'use strict';

const { getService, serviceMode } = require('./_service');
const FRESH = require('../../lib/gov/freshness');
const TX = require('../../lib/txevents');
const EV = require('../../lib/streets/evidence');

const HIST = require('../../lib/txevents/history');

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`no answer within ${ms} ms`)), ms))]);
const minusDays = (d, k) => new Date(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') - k * 864e5).toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/* a history cursor: the page's upper day; `g` = the register held no older row (every one was shown), the GovMap layer's rows continue */
const CURSOR = /^(\d{4}-\d{2}-\d{2})(g?)$/;
const GCAP = 500;   // the layer's rows of a page past the register's oldest row: whole days, about this many
const okRows = (x) => (x && !x.error && Array.isArray(x.transactions) ? x.transactions : []);
/* a register read that did not answer (an error, or no source answered): never taken for "no older deals"
   — except the register copy's own answer that it lists no settlement for the place (a real zero: its settlement list holds none) */
const NO_SETTLEMENT = /^no settlement ".*" in the republished register$/;
const unanswered = (x) => {
  if (!x) return 'no answer';
  if (x.error) return x.error;
  if (x.answered !== false) return null;
  const over = (x.unavailable || []).filter((u) => /over/i.test(String(u.provider || '')));
  if (over.length && over.every((u) => NO_SETTLEMENT.test(String(u.reason || '')))) return null;
  return 'the register copy did not answer' + (over[0] && over[0].reason ? ': ' + over[0].reason : '');
};

/**
 * ONE PAGE OF A PLACE'S HISTORY, newest first (lib/txevents/history.js): the register copy's live search for the place, paged by DATE
 * (the search's offset stops at 100,000 rows — a date never does), and the GovMap layer's rows of the same place and dates, each folded
 * into the register deal it repeats. The page shows the register's rows dated in (L, C] and the layer's in (L + 1, C + 1]; two reference
 * days above C are read so a layer row is compared with every register row it could repeat. A page that cannot advance past one day
 * (more than a page of deals on day C) reads that day whole.
 * @param o { svc, location, scope, C (YYYY-MM-DD, inclusive), first (the page directly under the stored window — its reference is the
 *            stored window itself), dateFrom? (a period's first day), area? { codes, unplaced } }
 */
async function historyPage(o) {
  const { svc, location, scope, C, first } = o;
  const S = TX.stores();
  const level = scope.kind === 'area' ? 'national' : scope.kind === 'parcel' ? 'parcel' : scope.kind === 'building' ? 'building' : scope.kind === 'street' ? 'street' : 'locality';
  const ask = (f) => withTimeout(scope.kind === 'area' ? svc.getWideTransactions('national', {}, f) : scope.kind === 'parcel' ? svc.getWideTransactions('parcel', { block: String(scope.block), parcel: String(scope.parcel) }, f)
    : svc.getTransactions(location, { ...f, level }), 9000).catch((e) => ({ error: e.message }));
  const base = { offset: 0, limit: 200, months: null, days: null, dateFrom: o.dateFrom || undefined };
  const lvl = level;
  const winFrom = (EV.store().meta || {}).window ? EV.store().meta.window.from : null;
  const where = scope.kind === 'area' ? { codes: scope.codes || null } : scope.kind === 'parcel' ? { code: scope.code, block: scope.block, parcel: scope.parcel } : { code: scope.code };
  const snap = S.nationalMeta && S.nationalMeta.version ? String(S.nationalMeta.version.detectedAt || '').slice(0, 10) : null;
  const layerRows = (from, to) => {
    const G = [];
    for (const r of HIST.rows(where, from, winFrom && to >= winFrom ? minusDays(winFrom, 1) : to)) {
      const e = TX.gmEvent(HIST.asLayerRow(r), 'over:govmap-national', snap);
      const pl = scope.kind === 'area' ? { match: 'AREA', certain: true } : TX.placeEvent(e, scope, S);
      if (!pl) continue;
      G.push({ ...e, id: 'gmh:' + r.oid, geo: pl, inStatistics: false, evidence: [], conflict: false, conflictFields: [], history: true, recovery: r.recovery || null, sourceStreetBasis: r.streetBasis });
    }
    return G;
  };
  /* whole days of the layer's rows, newest first, about GCAP of them: the rows kept and the next cursor (null = none left) */
  const cut = (G) => {
    if (G.length <= GCAP) return { keep: G, next: null };
    const s = [...G].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const d = s[GCAP - 1].date;
    const keep = s.filter((e) => e.date >= d);
    return keep.length < s.length ? { keep, next: minusDays(d, 1) + 'g' } : { keep, next: null };
  };
  const extraOf = (lo, hi) => (o.extraLayer ? o.extraLayer(lo, hi) : []);

  if (o.gOnly) {
    /* past the register's oldest row: every register row was shown on an earlier page — read again (≤ C + 1) only as the fold's reference */
    const live = await ask({ ...base, dateTo: HIST.addDays(C, 1) });
    if (unanswered(live)) return { error: unanswered(live), events: [], more: true, next: C + 'g', live };
    const refs = TX.liveEvents(okRows(live), scope, lvl);
    const { keep, next } = cut(layerRows(o.dateFrom || null, C));
    const F = HIST.fold(keep, refs);
    const lo = next ? minusDays(CURSOR.exec(next)[1], 0) : (o.dateFrom ? minusDays(o.dateFrom, 1) : null);
    const extraLayer = extraOf(lo, C);
    return { events: [...F.shown, ...extraLayer], more: !!next, next, folded: F.folded.length, gmShown: F.shown.length + extraLayer.length, regShown: 0, live };
  }

  const top = first ? C : HIST.addDays(C, 2);
  const live = await ask({ ...base, dateTo: top });
  if (unanswered(live)) return { error: unanswered(live), events: [], more: true, next: C, live };
  let rows = okRows(live);
  const dg = live && live.diagnostics ? live.diagnostics : {};
  const more = !!dg.more;
  let sp = HIST.span(C, rows, more, dg.floors || []);
  if (more && sp.L != null && sp.L >= C) {
    /* a day holding more deals than a page: read the page's day (and the reference days) whole */
    const day = async (d) => { const out = []; for (let off = 0; off < 5000; off += 200) { const r = await ask({ ...base, dateFrom: d, dateTo: d, offset: off }); if (unanswered(r)) throw new Error(unanswered(r)); const x = okRows(r); out.push(...x); if (!(r.diagnostics && r.diagnostics.more) || !x.length) break; } return out; };
    try { rows = [...await day(C), ...(first ? [] : [...await day(HIST.addDays(C, 1)), ...await day(HIST.addDays(C, 2))])]; }
    catch (e) { return { error: e.message, events: [], more: true, next: C, live }; }
    sp = { L: minusDays(C, 1), last: false };
  }
  const show = (t) => t.date && t.date <= C && (sp.last || sp.L == null || t.date > sp.L);
  const reg = TX.liveEvents(rows.filter(show), scope, lvl).map((e) => ({ ...e, history: true }));
  const ref = TX.liveEvents(rows.filter((t) => t.date && t.date > C), scope, lvl);
  /* the register's deals under unmapped settlement names placed in this locality (listed with the stored events): fold references too */
  if (scope.code != null) for (const e of TX.unmappedRegisterEvents(scope.code, S)) if (e.date <= HIST.addDays(C, 2) && (sp.last || sp.L == null || e.date >= sp.L)) ref.push(e);
  /* the GovMap layer's history rows of the place in (L + 1, C + 1]; on the register's last page, its rows below too — a page of whole days */
  const gmTo = HIST.addDays(C, 1), gmFrom = sp.last || sp.L == null ? (o.dateFrom || null) : HIST.addDays(sp.L, 2);
  let G = layerRows(gmFrom, gmTo), gNext = null;
  if (sp.last) ({ keep: G, next: gNext } = cut(G));
  /* events shown beside the history without folding (an area: the stored window's GovMap events — already reconciled — and, for
     Israel, the unplaced events), in the register's own range (L, C] */
  const lo = sp.last || sp.L == null ? (gNext ? CURSOR.exec(gNext)[1] : o.dateFrom ? minusDays(o.dateFrom, 1) : null) : sp.L;
  const extraLayer = extraOf(lo, C);
  const F = HIST.fold(G, [...reg, ...ref]);
  const byKey = new Map(reg.map((e) => [e, e]));
  for (const f of F.folded) {
    if (!byKey.has(f.r)) continue;                                  // a reference row (shown on the page above)
    const kinds = f.differences.map((d) => (d.includes(':') ? d : d + ':differs'));
    f.r.evidence = (f.r.evidence || []).concat([{ sourceId: 'over:govmap-national', oid: f.g.oid, dealId: null, date: f.g.date, amount: f.g.price, cls: 'HISTORY', differences: f.differences, kinds }]);
    const conflictFields = kinds.filter((k) => !TX.FORMAT_ONLY.has(k)).map((k) => k.split(':')[0]);
    if (conflictFields.length) { f.r.conflict = true; f.r.conflictFields = [...new Set((f.r.conflictFields || []).concat(conflictFields))]; }
  }
  const next = sp.last ? gNext : sp.L;
  return { events: [...reg, ...F.shown, ...extraLayer], more: !!next, next, folded: F.folded.length, gmShown: F.shown.length + extraLayer.length, regShown: reg.length, live };
}

/**
 * A DISTRICT OR ISRAEL, any period, page by page (`area=il|d-…`): the register copy's national search (date-paged, its rows of the
 * district's localities), the GovMap layer's events of the same days (the stored window's, already reconciled; the history's, folded) and —
 * Israel only — the UNPLACED events (no locality can be determined: never attributed to a district). The period's exact count is the
 * stored union's per-day tally (data/txevents/latest.json); a page lists rows, never a statistic of the area.
 */
async function areaRead(svc, filters, area, g) {
  const now = new Date().toISOString();
  const D = require('../../lib/streets/directory').load();
  const codes = area === 'il' ? null : new Set([...D.localities.values()].filter((l) => l.district === area).map((l) => l.code));
  if (codes && !codes.size) return { error: 'unknown-area', transactions: [] };
  const scope = { kind: 'area', resolved: true, area, codes, how: 'area' };
  const all = g('all') === '1' || (!filters.days && Number(filters.months) >= 240);
  const P0 = TX.periodOf({ days: filters.days, months: all ? null : filters.months, all });
  const cm = CURSOR.exec(g('older') || '');
  const cursor = cm ? cm[1] : null, gOnly = !!(cm && cm[2]);
  const dateFrom = P0.from ? HIST.addDays(P0.from, 1) : undefined;
  const S = TX.stores();
  const U = require('../../lib/txevents/unplaced');
  const layerCodes = () => { const set = new Set(); const RL = require('../../lib/recent/read').load(); for (const m of [RL.layer && RL.layer.byCode, S.national && S.national.byCode, S.extra && S.extra.byCode]) for (const k of Object.keys(m || {})) set.add(Number(k)); return [...set].filter((c) => !codes || codes.has(c)); };
  const extraLayer = (lo, hi) => {
    const out = [];
    for (const c of layerCodes()) for (const e of TX.layerEventsOf(c, S).events) if (e.date && e.date <= hi && (lo == null || e.date > lo)) out.push({ ...e, geo: { match: 'AREA', certain: true }, inStatistics: false, evidence: [], conflict: e.state === 'CONFLICT', conflictFields: e.state === 'CONFLICT' ? e.notes : [] });
    if (!codes) for (const e of U.events({ from: lo, to: hi })) out.push(e);
    return out;
  };
  const C = cursor || P0.to;
  const P = await historyPage({ svc, location: {}, scope, C, first: !cursor, dateFrom, extraLayer, gOnly });
  const rows = P.events.filter((e) => TX.inPeriod(e.date, P0)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(a.id).localeCompare(String(b.id)));
  const L = S.latest;
  const perDay = L ? (codes ? (L.districts[area] || {}).perDay : L.national.perDay) || {} : {};
  const inWindow = Object.entries(perDay).reduce((a, [k, v]) => a + (TX.inPeriod(k, P0) ? v : 0), 0);
  const cov = TX.coverageOf(5000, S).map((c) => ({ ...c, read: c.id === 'over:deals-register' ? true : c.read }));
  const rec = TX.recencyOf(rows.length ? rows : (codes ? (L && L.districts[area] ? L.districts[area].top : []) : (L ? L.national.top : [])), cov);
  const st = TX.statementOf(rows.length || inWindow, P0, rec, cov, { resolved: true });
  st.text = TX.STATEMENT_TEXT[st.kind] || null;
  const R = require('../../lib/txevents/history').meta();
  return {
    transactions: rows.map(TX.wire), scope: { level: 'area', area, description: area === 'il' ? 'Israel' : area, code: null },
    unavailable: P.live && P.live.unavailable ? P.live.unavailable : [],
    meta: { unified: true, area: true, engine: TX.ENGINE, period: P0, statement: st, recency: rec, coverage: cov, attemptedAt: now, deliveredVia: 'over.org.il', sourceFamily: 'OFFICIAL_GOVERNMENT',
      counts: { events: rows.filter((e) => e.state !== 'POSSIBLE_DUPLICATE').length, windowEventsInPeriod: inWindow, bySourceEvents: rows.reduce((m, e) => ((m[e.sourceId] = (m[e.sourceId] || 0) + 1), m), {}) },
      sourceCoverage: { kind: cursor ? 'unified-older' : 'unified', offset: 0, limit: rows.length, total: rows.length, more: false, olderMore: !!(P.more || P.error), olderNext: P.error ? C + (gOnly ? 'g' : '') : P.next, olderError: P.error || null,
        folded: P.folded || 0, areaWindowTotal: inWindow, history: all && R ? { govmapRows: codes ? Object.entries(R.localities || {}).reduce((a, [c, x]) => a + (codes.has(Number(c)) ? x.rows : 0), 0) : R.shown, before: R.period && R.period.to } : null },
      note: TX.NOTE, noteHe: TX.NOTE_HE },
  };
}

/**
 * THE UNIFIED READ (lib/txevents, 20.10.2026): every transaction event PROPX holds for the place — the register sweep, the GovMap-layer
 * copy (recent window + the national detector), the parcel recovery — merged with the register copy's live search (the republisher's
 * own address link, and history older than the stored window), one event per deal, newest first, each with its source and state.
 * Used whenever the place resolves to an official locality; period ALL reaches back to the first deal either copy holds (1998), page by
 * page by date (`older=<YYYY-MM-DD>`, historyPage).
 */

async function unifiedRead(svc, location, filters, scope, g) {
  const now = new Date().toISOString();
  /* ALL is every deal either copy holds for the place — no lower date (the register reaches back to 1998): the months value the page
     sends for ALL (≥ 240) is a name for "all", never a 20-year bound */
  const all = g('all') === '1' || (!filters.days && Number(filters.months) >= 240);
  const winFrom = (EV.store().meta || {}).window ? EV.store().meta.window.from : null;
  const cm = CURSOR.exec(g('older') || '');
  const cursor = cm ? cm[1] : g('older') != null && winFrom ? minusDays(winFrom, 1) : null, gOnly = !!(cm && cm[2]);
  /* the live register search: for the period (the republisher's address link) */
  const liveCall = (f) => (scope.kind === 'parcel' ? Promise.resolve(null) : withTimeout(svc.getTransactions(location, f), 9000).catch((e) => ({ error: e.message })));
  const periodF = { ...filters, offset: 0, limit: 200, level: undefined, months: all ? 36 : filters.months };
  const lvl = (x) => (x && x.scope ? x.scope.level : null);
  if (cursor) {
    /* a later page of the history (period ALL): the register's live rows and the GovMap layer's, one date span */
    const P = winFrom ? await historyPage({ svc, location, scope, C: cursor, first: cursor === minusDays(winFrom, 1) && !gOnly, gOnly }) : { events: [], more: false, next: null };
    const rows = P.events.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(a.id).localeCompare(String(b.id))).map(TX.wire);
    return { transactions: rows, scope: scopeOut(scope, location), unavailable: P.live && P.live.unavailable ? P.live.unavailable : [],
      meta: { unified: true, engine: TX.ENGINE, sourceCoverage: { kind: 'unified-older', olderMore: !!(P.more || P.error), olderNext: P.error ? cursor + (gOnly ? 'g' : '') : P.next, olderError: P.error || null,
        folded: P.folded || 0, govmapHistoryShown: P.gmShown || 0, registerShown: P.regShown || 0 }, attemptedAt: now } };
  }
  /* period ALL: the first page of the history (directly under the stored window) comes with the stored events */
  const [live, older] = await Promise.all([liveCall(periodF), all && winFrom ? historyPage({ svc, location, scope, C: minusDays(winFrom, 1), first: true }) : Promise.resolve(null)]);
  const extra = [...TX.liveEvents(okRows(live), scope, lvl(live)), ...(older ? older.events : [])];
  const olderMore = !!(older && older.more && !older.error);
  const olderCov = older && older.live && older.live.diagnostics ? older.live.diagnostics : null;
  const U = TX.query({ code: scope.code, streetId: scope.streetId, house: scope.house, block: scope.block, parcel: scope.parcel,
    days: filters.days, months: filters.days ? null : filters.months, all, offset: filters.offset, limit: filters.limit, extraEvents: extra });
  const liveAnswered = !!(live && !live.error && live.answered !== false);
  const regSrc = (EV.store().meta || {}).source || {};
  const rec = U.recency;
  const coverage = U.coverage.concat([{ id: 'register-live', ...TX.SOURCES['register-live'], read: liveAnswered, reason: liveAnswered ? null : (live && (live.error || 'no answer')) || 'not asked',
    snapshotDate: FRESH.isoDay(FRESH.ts(regSrc.scrapedAt)), coveredFrom: '1998-01-01', coveredThrough: regSrc.lastDeal || null, checkedAt: liveAnswered ? now : null, level: lvl(live), added: extra.length }]);
  const freshest = rec.freshestSourceSnapshot;
  const freshSrc = freshest ? coverage.find((c) => c.id === freshest.sourceId) : null;
  return {
    transactions: U.events.map(TX.wire),
    scope: scopeOut(scope, location),
    unavailable: [...(live && live.unavailable ? live.unavailable : []), ...(live && live.error ? [{ provider: 'over.org.il', capability: 'live-search', reason: live.error }] : [])],
    meta: {
      unified: true, engine: TX.ENGINE, months: filters.days ? null : filters.months, days: filters.days || null, all, mode: serviceMode(),
      sourceFamily: 'OFFICIAL_GOVERNMENT', sourceAuthority: 'רשות המסים', deliveredVia: 'over.org.il', channel: 'independent-republication',
      attemptedAt: now, sourceAnswered: true, syncedAt: liveAnswered ? now : null,   // a sync only when the live search answered
      snapshotAt: regSrc.scrapedAt || null, latestInRegister: regSrc.lastDeal || null,
      latestTransactionDate: rec.latestKnownEvent ? rec.latestKnownEvent.date : null,
      recordsRetrieved: U.events.length,
      sourceCoverage: { kind: 'unified', offset: U.offset, limit: U.limit, total: U.total, more: U.more, olderMore: all && (olderMore || !!(older && older.error)),
        olderNext: all && older ? (older.error ? minusDays(winFrom, 1) : older.next) : null, olderError: older && older.error ? older.error : null,
        olderTotal: olderCov ? olderCov.totalReported : null, olderTotalCapped: olderCov ? !!olderCov.totalCapped : null,
        olderFolded: older ? older.folded || 0 : null, olderGovmapShown: older ? older.gmShown || 0 : null, olderRegisterShown: older ? older.regShown || 0 : null,
        history: all ? historyCounts(scope) : null },
      recency: rec, coverage, counts: U.counts, statement: U.statement, period: U.period, note: U.note, noteHe: U.noteHe,
      live: { answered: liveAnswered, level: lvl(live), added: extra.length, error: live && live.error ? live.error : null },
      /* the union's freshness, in the contract the page's freshness strip reads: the freshest copy read, the latest date the evidence
         reaches, when the sources were checked */
      freshness: FRESH.live({ snapshotAt: freshSrc && freshSrc.id === 'over:govmap-recent' ? (require('../../lib/recent/read').load().meta || { source: {} }).source.loadedAt : regSrc.scrapedAt,
        lastDeal: rec.evidenceCheckedThrough, checkedAt: rec.sourcesCheckedAt, dates: U.events.filter((e) => e.state !== 'POSSIBLE_DUPLICATE').map((e) => e.date),
        sourceId: 'propx:transaction-events', sourceClass: 'UNION · Tax Authority register copy + GovMap-layer copy (both republished by over.org.il)' }),
    },
  };
}
/* what the history holds for the place before the stored window (exact counts from the builds; the register's by its own count) */
function historyCounts(scope) {
  const H = HIST.meta();
  if (!H) return { govmap: null, reason: 'not-built' };
  const L = scope.code != null ? (H.localities || {})[scope.code] : null;
  const st = scope.streetCode != null ? (H.streets || {})[`${scope.code}|${scope.streetCode}`] || 0 : null;
  return { before: H.period ? H.period.to : null, govmapRows: scope.kind === 'street' || scope.kind === 'building' ? st : L ? L.rows : 0, govmapEarliest: L ? L.earliest : null,
    folding: 'each GovMap row is folded into the register deal it repeats as the pages load' };
}
const scopeOut = (scope, location) => ({
  level: scope.kind, code: scope.code, streetId: scope.streetId || null, house: scope.house || null, block: scope.block || null, parcel: scope.parcel || null,
  description: scope.kind === 'parcel' ? `${scope.block}/${scope.parcel}, ${location.city || ''}` : scope.kind === 'building' ? `${scope.streetName} ${scope.house}, ${location.city}`
    : scope.kind === 'street' ? `${scope.streetName}, ${location.city}` : `${location.city || ''}`,
  sampleSize: null, how: scope.how,
});

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }
  const url = new URL(req.url, 'http://x');
  const g = (k) => url.searchParams.get(k);
  const num = (k) => (g(k) === null || g(k) === '' ? null : Number(g(k)));
  const location = {
    city: g('city'), street: g('street'), houseNumber: num('house'),
    lat: num('lat'), lng: num('lng'), block: g('block'), parcel: g('parcel'),
  };
  const LEVELS = ['building', 'street', 'neighborhood', 'locality'];
  const offset = num('offset');
  if (offset !== null && !(Number.isInteger(offset) && offset >= 0 && offset <= 100000)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'bad-offset' }));
  }
  if (g('level') !== null && !LEVELS.includes(g('level'))) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'bad-level' }));
  }
  const filters = { limit: Math.min(200, num('limit') || 100), months: num('months') || 24, days: num('days') || undefined, radiusM: num('radius') || undefined,
    offset: offset || 0, level: g('level') || undefined };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  try {
    const svc = getService();
    if (g('area')) return res.end(JSON.stringify(await areaRead(svc, filters, String(g('area')), g)));
    /* the unified read whenever the place resolves to a swept locality (never for the confirmed-new guard) */
    if (g('newOnly') !== '1' && g('unified') !== '0') {
      const scope = TX.resolveScope({ city: location.city, street: location.street, house: location.houseNumber, block: g('block'), parcel: g('parcel'), streetId: g('sid') });
      /* every place that resolves to an official locality — swept, reached only by the GovMap layer, or holding only older deals */
      if (scope.resolved && scope.kind !== 'unresolved') return res.end(JSON.stringify(await unifiedRead(svc, location, filters, scope, g)));
    }
    const out = g('newOnly') === '1'
      ? await svc.getConfirmedNewTransactions(location, filters)
      : await svc.getTransactions(location, filters);
    // raw source echoes stay server-side; the wire carries normalized rows.
    // Coordinates were converted from the source CRS in the provider and are
    // bounds-checked there — a point that fails the check stays null.
    out.transactions = out.transactions.map((t) => ({
      ...t,
      provenance: (Array.isArray(t.provenance) ? t.provenance : [t.provenance])
        .map((p) => ({ ...p, raw: undefined })),
    }));
    const cls = out.transactions.reduce((a, t) => {
      a[t.propertyClass || 'unknown'] = (a[t.propertyClass || 'unknown'] || 0) + 1; return a;
    }, {});
    // PURITY GATE at the wire: only official government rows may leave here.
    const impure = out.transactions.filter((t) => t.sourceFamily !== 'OFFICIAL_GOVERNMENT');
    out.transactions = out.transactions.filter((t) => t.sourceFamily === 'OFFICIAL_GOVERNMENT');
    out.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const dates = out.transactions.map((t) => t.date).filter(Boolean);
    const now = new Date().toISOString();
    const cov = out.diagnostics || null;
    // the channel the rows actually came through — the register's republication is never called official
    const via = out.transactions.some((t) => t.deliveredVia === 'over.org.il') ? 'over.org.il'
      : out.transactions.length ? 'GovMap' : null;
    out.meta = {
      months: filters.days ? null : filters.months, days: filters.days || null, mode: serviceMode(), byPropertyClass: cls,
      sourceFamily: 'OFFICIAL_GOVERNMENT',
      sourceAuthority: 'רשות המסים', deliveredVia: via,
      channel: via === 'over.org.il' ? 'independent-republication' : via ? 'government' : null,
      attemptedAt: now,
      // a sync is claimed only when a source answered; a refusal is an attempt, not a sync
      sourceAnswered: out.answered !== false,
      syncedAt: out.answered !== false ? now : null,
      // when the republished copy of the register was taken (its deals reported later are not in it)
      snapshotAt: cov && cov.snapshotAt ? cov.snapshotAt : null,
      latestInRegister: cov && cov.latestInRegister ? cov.latestInRegister : null,
      latestTransactionDate: dates.length ? dates[0] : null,
      recordsRetrieved: out.transactions.length,
      impureRowsDropped: impure.length,
      // what the source itself said was available vs what we pulled, so an
      // under-fetch is visible instead of silently looking like "no data"
      sourceCoverage: cov,
      withStreetName: out.transactions.filter((t) => t.street).length,
    };
    /* how fresh the universe behind these rows is (lib/gov/freshness.js) — the copy's dates apart, its state, the newest row,
       what an empty 30 / 90 days means; for the register copy only (GovMap rows carry their own sync) */
    out.meta.freshness = via === 'over.org.il' || (cov && cov.snapshotAt)
      ? FRESH.live({ snapshotAt: out.meta.snapshotAt, lastDeal: out.meta.latestInRegister, checkedAt: out.meta.syncedAt, dates })
      : null;
    delete out.diagnostics;
    delete out.answered;
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'gov-transactions-failed', reason: e.message }));
  }
};
