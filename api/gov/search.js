// GET /api/gov/search?q=…            — free-text location search (registries)
// GET /api/gov/search?city=…&street=…&house=… — canonical address resolution
// Backed by the official data.gov.il registries via GovDataService.

'use strict';

const { getService } = require('./_service');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }
  const url = new URL(req.url, 'http://x');
  const q = url.searchParams.get('q');
  const city = url.searchParams.get('city');
  const street = url.searchParams.get('street');
  const house = url.searchParams.get('house');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=300');
  try {
    const svc = getService();
    const out = city
      ? await svc.resolveAddress(city, street, house === null ? null : Number(house))
      : await svc.searchLocation(q || '');
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'gov-search-failed', reason: e.message }));
  }
};
