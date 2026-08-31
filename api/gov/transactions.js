// GET /api/gov/transactions?city=…&street=…&house=…&lat=…&lng=…&newOnly=1
// Normalized government transactions through the progressive geographic
// fallback ladder (building → street → 250m → 500m → 1000m). The response
// always carries `scope` (what the numbers actually describe), the
// newness partitions, and `unavailable` (why any rung could not serve) —
// including the current no-authorized-connector state of the Tax Authority
// registry, in which the endpoint degrades to an explained empty result,
// never an invented one.

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
  const filters = { limit: num('limit') || 100, months: num('months') || 24, radiusM: num('radius') || undefined };
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
    out.meta = {
      months: filters.months, mode: serviceMode(), byPropertyClass: cls,
      sourceFamily: 'OFFICIAL_GOVERNMENT',
      sourceAuthority: 'רשות המסים', deliveredVia: 'GovMap',
      syncedAt: new Date().toISOString(),
      latestTransactionDate: dates.length ? dates[0] : null,
      recordsRetrieved: out.transactions.length,
      impureRowsDropped: impure.length,
    };
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'gov-transactions-failed', reason: e.message }));
  }
};
