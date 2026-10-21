// GET /api/geo/search?q=…[&near=<locality code | loc:id | name>][&limit=…] — national autocomplete over the canonical
// Israel geography: every official locality and every official street / address area / site of the Population and
// Immigration Authority's street registry (+ its official synonyms; lib/geo/registry.js, lib/streets/). `near` is the
// selected locality: its streets rank first. Session-gated by the site middleware. The directory + prebuilt index load
// once per warm instance; responses are cacheable per query.

'use strict';

const { searchGeo, loadGeo } = require('../../lib/geo/registry');
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
  /* an error is never cached (a retry must reach the function again); only a real answer is */
  const fail = (status, error, e) => {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error, code: (e && e.code) || null }));
  };
  const t0 = Date.now();
  /* the official directory + its prebuilt index: when they cannot be loaded, say so (503) — the page then reports that the
     registry is unavailable, never "no results" */
  try { loadGeo(); } catch (e) { return fail(503, 'geo-index-unavailable', e); }
  try {
    const near = (url.searchParams.get('near') || '').slice(0, 80) || null;
    const out = searchGeo(q.slice(0, 120), Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 12)), { near });
    out.meta.tookMs = Date.now() - t0;
    out.meta.neighborhoodLayer = coverage();
    res.setHeader('Cache-Control', 'private, max-age=3600');  // registry is slow-moving
    res.end(JSON.stringify(out));
  } catch (e) {
    fail(500, 'geo-search-failed', e);
  }
};
