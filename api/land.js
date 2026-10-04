// GET /api/land?view=summary|tenders|tender|pipeline|map|status&…
//
// Land & Tender Intelligence — the read side of the Israel Land Authority
// tender records that scripts/land-sync.js ingests daily (data/land/,
// bundled with the deployment). Session-gated like every route
// (middleware.js). The browser never receives the national dataset: it asks
// for a summary, one page of rows, one tender, the planning pipeline or the
// map points, already filtered here.
//
//   view=summary   KPIs · lifecycle counts · series · cities · developers (observed wins) · facets · methodology
//   view=tenders   one sorted page of rows (sort, order, page, size ≤ 100)
//   view=tender    one tender (id=rmi:<MichrazID> or the number) with lots, bids, winners, plans, construction evidence, history, provenance
//   view=pipeline  RMI planning inventory (STATE LAND ONLY, dated) · plans the tenders reference · the tender funnel · MoCH development costs by locality
//   view=map       tender polygon centroids + locality-level counts for tenders without a published polygon
//   view=status    freshness, the latest sync runs, the source registry
// Filters: period=6m|12m|24m|5y|all|custom (&from&to=YYYY-MM-DD) over dateField=published|close|committee,
// city (CBS code or official name), region, track (comma list), lifecycle (comma list), type, purpose, basis,
// winner (exact string), plan (plan number), residential=1, awarded=1, q.

'use strict';

const Q = require('../lib/land/query');

const send = (res, code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end('Method Not Allowed'); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const url = new URL(req.url, 'http://x');
  const g = (k) => url.searchParams.get(k);
  const view = g('view') || 'summary';
  try {
    if (view === 'status') return send(res, 200, Q.status());
    if (view === 'tender') { const out = g('id') ? Q.record(g('id')) : null; return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
    const { filters, error } = Q.parseFilters(url.searchParams);
    if (error) return send(res, 400, { error });
    const lim = (d, max) => Math.max(1, Math.min(max, Math.floor(Number(g('limit'))) || d));
    if (view === 'summary') return send(res, 200, Q.summary(filters, { bucket: g('bucket'), limit: lim(40, 100) }));
    if (view === 'tenders') return send(res, 200, Q.records(filters, { sort: g('sort'), order: g('order'), page: g('page'), size: g('size') }));
    if (view === 'pipeline') return send(res, 200, Q.pipeline(filters, { limit: lim(30, 100) }));
    if (view === 'map') return send(res, 200, Q.mapPoints(filters, { limit: lim(3000, 5000) }));
    return send(res, 400, { error: 'unknown view' });
  } catch (e) {
    console.error('land api:', e.message);
    return send(res, 500, { error: 'land-query-failed' });
  }
};
