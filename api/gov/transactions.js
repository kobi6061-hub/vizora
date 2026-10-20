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

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`no answer within ${ms} ms`)), ms))]);
const minusDays = (d, k) => new Date(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') - k * 864e5).toISOString().slice(0, 10);

/**
 * THE UNIFIED READ (lib/txevents, 20.10.2026): every transaction event PROPX holds for the place — the register sweep, the GovMap-layer
 * copy (recent window + the national detector), the parcel recovery — merged with the register copy's live search (the republisher's
 * own address link, and history older than the stored window), one event per deal, newest first, each with its source and state.
 * Used whenever the place resolves to a swept locality; otherwise the live search alone answers, as before.
 */
async function unifiedRead(svc, location, filters, scope, g) {
  const now = new Date().toISOString();
  const all = !filters.days && Number(filters.months) >= 240;
  const winFrom = (EV.store().meta || {}).window ? EV.store().meta.window.from : null;
  const olderOffset = g('older') != null ? Math.max(0, Number(g('older')) || 0) : null;
  /* the live register search: for the period (the republisher's address link), and — period ALL — its history before the stored window */
  const liveCall = (f) => (scope.kind === 'parcel' ? Promise.resolve(null) : withTimeout(svc.getTransactions(location, f), 9000).catch((e) => ({ error: e.message })));
  const periodF = { ...filters, offset: 0, limit: 200, level: undefined, months: all ? 36 : filters.months };
  const olderF = all && winFrom ? { ...filters, months: 240, dateTo: minusDays(winFrom, 1), offset: olderOffset || 0, limit: 200, level: undefined } : null;
  const [live, older] = await Promise.all([olderOffset != null ? Promise.resolve(null) : liveCall(periodF), olderF ? liveCall(olderF) : Promise.resolve(null)]);
  const lvl = (x) => (x && x.scope ? x.scope.level : null);
  const okRows = (x) => (x && !x.error && Array.isArray(x.transactions) ? x.transactions : []);
  const extra = [...TX.liveEvents(okRows(live), scope, lvl(live)),
    /* older history: only rows dated before the stored window (a source that ignores date_to repeats the window — never twice) */
    ...TX.liveEvents(okRows(older).filter((t) => winFrom && t.date && t.date < winFrom), scope, lvl(older))];
  const olderCov = older && !older.error && older.diagnostics ? older.diagnostics : null;
  const olderMore = !!(olderCov && olderCov.more);
  if (olderOffset != null) {
    /* a later page of the older history alone */
    const U = TX.query({ code: scope.code, streetId: scope.streetId, house: scope.house, block: scope.block, parcel: scope.parcel, all: true, offset: 0, limit: 500, extraEvents: extra });
    const rows = U.events.filter((e) => e.live && winFrom && e.date < winFrom).map(TX.wire);
    return { transactions: rows, scope: scopeOut(scope, location), unavailable: older && older.unavailable ? older.unavailable : [],
      meta: { unified: true, engine: TX.ENGINE, sourceCoverage: { kind: 'unified-older', olderOffset, olderNext: olderOffset + 200, olderMore, olderTotal: olderCov ? olderCov.totalReported : null }, attemptedAt: now } };
  }
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
      sourceCoverage: { kind: 'unified', offset: U.offset, limit: U.limit, total: U.total, more: U.more, olderMore: all && olderMore, olderNext: all ? 200 : null, olderTotal: olderCov ? olderCov.totalReported : null },
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
    /* the unified read whenever the place resolves to a swept locality (never for the confirmed-new guard) */
    if (g('newOnly') !== '1' && g('unified') !== '0') {
      const scope = TX.resolveScope({ city: location.city, street: location.street, house: location.houseNumber, block: g('block'), parcel: g('parcel'), streetId: g('sid') });
      if (scope.resolved && scope.kind !== 'unresolved' && EV.shardOf(scope.code)) return res.end(JSON.stringify(await unifiedRead(svc, location, filters, scope, g)));
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
