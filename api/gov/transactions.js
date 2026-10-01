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
  const filters = { limit: Math.min(200, num('limit') || 100), months: num('months') || 24, radiusM: num('radius') || undefined,
    offset: offset || 0, level: g('level') || undefined };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  try {
    const svc = getService();
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
      months: filters.months, mode: serviceMode(), byPropertyClass: cls,
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
    delete out.diagnostics;
    delete out.answered;
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'gov-transactions-failed', reason: e.message }));
  }
};
