// GET /api/gov/transactions?city=…&street=…&house=…&lat=…&lng=…&newOnly=1
// Normalized government transactions through the progressive geographic
// fallback ladder (building → street → 250m → 500m → 1000m). The response
// always carries `scope` (what the numbers actually describe), the
// newness partitions, and `unavailable` (why any rung could not serve) —
// including the current no-authorized-connector state of the Tax Authority
// registry, in which the endpoint degrades to an explained empty result,
// never an invented one.

'use strict';

const { getService } = require('./_service');

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
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=300');
  try {
    const svc = getService();
    const out = g('newOnly') === '1'
      ? await svc.getConfirmedNewTransactions(location, { limit: num('limit') || 100 })
      : await svc.getTransactions(location, { limit: num('limit') || 100 });
    // raw source echoes stay server-side; the wire carries normalized rows
    out.transactions = out.transactions.map((t) => ({
      ...t,
      provenance: (Array.isArray(t.provenance) ? t.provenance : [t.provenance])
        .map((p) => ({ ...p, raw: undefined })),
    }));
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'gov-transactions-failed', reason: e.message }));
  }
};
