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
const { itmToWgs84 } = require('../../lib/geo/itm');

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
  res.setHeader('Cache-Control', 'private, max-age=300');
  try {
    const svc = getService();
    const out = g('newOnly') === '1'
      ? await svc.getConfirmedNewTransactions(location, filters)
      : await svc.getTransactions(location, filters);
    // raw source echoes stay server-side; the wire carries normalized rows.
    // ITM -> WGS84 is an exact projection transform (lib/geo/itm), applied so
    // the client can map records; marked coordSource, never invented.
    out.transactions = out.transactions.map((t) => {
      const w = (t.lat == null && t.itmX != null) ? itmToWgs84(t.itmX, t.itmY) : null;
      return {
        ...t,
        lat: w ? +w.lat.toFixed(6) : t.lat,
        lng: w ? +w.lng.toFixed(6) : t.lng,
        coordSource: w ? 'itm-transform' : (t.lat != null ? 'source' : null),
        provenance: (Array.isArray(t.provenance) ? t.provenance : [t.provenance])
          .map((p) => ({ ...p, raw: undefined })),
      };
    });
    out.meta = { months: filters.months, mode: serviceMode() };
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'gov-transactions-failed', reason: e.message }));
  }
};
