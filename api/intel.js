// GET /api/intel?view=…
//
// Developers & Projects intelligence, unified search and the Data & Trust Center — read-only views over records
// PROPX already stores (data/land, data/housing, data/market, data/transactions, data/geo). Session-gated like every
// route (middleware.js). Nothing is fetched from a source here.
//
//   view=developers   one sorted page of developer entities — OBSERVED PROPX ACTIVITY (q, city, role, kind, period=all|recent, sort, order, page, size ≤ 100)
//   view=developer    one entity (id=dev-… or name=<the source string>): activity per source, markets, sites, projects, construction evidence, aliases, possible same entities
//   view=projects     one sorted page of projects (kind=moch|ila, q, city, stage, developer, sort, order, page, size ≤ 100)
//   view=project      one project (id=moch:<ProjectID> | ila:<MichrazID>:<lot>) with stage evidence and provenance
//   view=signals      DEVELOPER MARKET ENTRY (derived; city, limit)
//   view=search       q → routed results (tender / plan / parcel / address / developer / project / locality / street)
//   view=status       registry coverage, freshness, methodology
//   view=sources      the Data & Trust Center catalogue (lib/trust/catalog.js)

'use strict';

const Q = require('../lib/entities/query');
const { catalog } = require('../lib/trust/catalog');

const send = (res, code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end('Method Not Allowed'); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const url = new URL(req.url, 'http://x');
  const p = Object.fromEntries(url.searchParams.entries());
  const view = p.view || 'status';
  try {
    if (view === 'sources') return send(res, 200, catalog());
    if (view === 'status') return send(res, 200, Q.status());
    if (view === 'developers') return send(res, 200, Q.developers(p));
    if (view === 'projects') return send(res, 200, Q.projects(p));
    if (view === 'signals') return send(res, 200, Q.signals(p));
    if (view === 'search') return send(res, 200, Q.search(p.q));
    if (view === 'developer') { const out = Q.developer(p.id || (p.name ? Q.idOfName(p.name) : null)); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
    if (view === 'project') { const out = Q.project(p.id); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
    return send(res, 400, { error: 'unknown view' });
  } catch (e) {
    console.error('intel api:', e.message);
    return send(res, 500, { error: 'intel-query-failed' });
  }
};
