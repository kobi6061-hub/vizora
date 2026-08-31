// GET /api/geo/search?q=… — national autocomplete over the canonical Israel
// geography registry (every official locality + street; see lib/geo).
// Session-gated by the site middleware. The registry loads once per warm
// instance; responses are cacheable per query.

'use strict';

const { searchGeo } = require('../../lib/geo/registry');
const { coverage } = require('../../lib/geo/neighborhoods');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }
  const url = new URL(req.url, 'http://x');
  const q = url.searchParams.get('q') || '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=3600');  // registry is slow-moving
  try {
    const t0 = Date.now();
    const out = searchGeo(q, Math.min(20, Number(url.searchParams.get('limit')) || 12));
    out.meta.tookMs = Date.now() - t0;
    out.meta.neighborhoodLayer = coverage();
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'geo-search-failed', reason: e.message }));
  }
};
