// GET /api/gov/trends?city=… — the official CBS new-homes price-index series
// (discovered from the CBS catalog at runtime). The response's `scope` states
// what the index actually covers (national); the requested location is echoed
// back separately and is never presented as the scope of the numbers.

'use strict';

const { getService } = require('./_service');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  try {
    const out = await getService().getMarketTrends(url.searchParams.get('city') || null);
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'gov-trends-failed', reason: e.message }));
  }
};
