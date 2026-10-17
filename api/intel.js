// GET /api/intel?view=…
//
// Developers & Projects intelligence, unified search and the Data & Trust Center — read-only views over records
// PROPX already stores (data/land, data/housing, data/market, data/transactions, data/geo). Session-gated like every
// route (middleware.js). Nothing is fetched from a source here.
//
//   view=developers   one sorted page of developer entities — OBSERVED PROPX ACTIVITY (q, city, role, kind, period=all|recent, sort, order, page, size ≤ 100)
//                     every table view sorts and column-filters (f_<column>=, lib/table/core.js) over its whole filtered set, missing last
//   view=developer    one entity (id=dev-… or name=<the source string>): activity per source, markets, sites, projects, construction evidence, aliases, possible same entities
//   view=projects     one sorted page of projects (kind=moch|ila, q, city, stage, developer, sort, order, page, size ≤ 100)
//   view=project      one project (id=moch:<ProjectID> | ila:<MichrazID>:<lot>) with stage evidence and provenance
//   view=signals      DEVELOPER MARKET ENTRY (derived; city, limit — or sort, order, page, size like the other tables)
//   view=search       q → routed results (tender / plan / parcel / address / developer / project / locality / street)
//   view=status       registry coverage, freshness, methodology
//   view=sources      the Data & Trust Center catalogue (lib/trust/catalog.js)
//   view=radar        MARKET RADAR — the deterministic "what changed" feed (window=today|7d|30d|90d|all, group, kind, city, district, q, m, page, size; lib/radar)
//   view=dossier      MARKET DOSSIER — one geography (city=<locality code> | district=<d-…> | none = national): official sales (district / national),
//                     inventory (national), ILA tenders, lotteries, renewal + XPlan, rental, developers, macro, recent changes, signals, freshness, evidence quality
//   view=dossierIndex the geographies the page can ask for (districts + localities with ILA tenders)
//   view=pulse        MARKET PULSE — what changed in the Israeli new-home market: official sales, inventory, land, developers, planning, rental, macro, source health
//   view=renewal      urban-renewal complexes (MoCH) + their exact XPlan planning join: summary (incl. planning coverage, pipeline by
//                     XPlan stage, cities, MoCH ↔ XPlan discrepancies, DERIVED counts) + one page (city, stage, track, declaration, q,
//                     pstage=<XPlan stage>|none, match=exact|ambiguous|not-found|no-identifier|not-checked, flag=discrepancy|stale|no-evidence|shared,
//                     sort=declared|proposed|city|name|maturity, page, size)
//   view=renewalComplex  one complex (id=renewal:<complex number>) with its history and its planning: match + diagnostics, the XPlan plan,
//                     MoCH ↔ XPlan pairs, DERIVED metrics, complexes on the same plan, the plan boundary, the plan's observed history

'use strict';

const Q = require('../lib/entities/query');
const { catalog } = require('../lib/trust/catalog');
const RN = require('../lib/renewal/query');
const RADAR = require('../lib/radar/query');
const DOSSIER = require('../lib/dossier/query');

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
    if (view === 'radar') return send(res, 200, RADAR.feed(p));
    if (view === 'pulse') return send(res, 200, RADAR.pulse());
    if (view === 'dossier') { const level = p.city ? 'locality' : p.district ? 'district' : 'il'; const out = DOSSIER.dossier({ level, code: p.city || p.district || null }); return out ? send(res, 200, out) : send(res, 404, { error: 'unknown geography' }); }
    if (view === 'dossierIndex') return send(res, 200, DOSSIER.index());
    if (view === 'status') return send(res, 200, Q.status());
    if (view === 'developers') return send(res, 200, Q.developers(p));
    if (view === 'projects') return send(res, 200, Q.projects(p));
    if (view === 'signals') return send(res, 200, Q.signals(p));
    if (view === 'search') return send(res, 200, Q.search(p.q));
    if (view === 'renewal') return send(res, 200, { summary: RN.summary(p), page: RN.records(p) });
    if (view === 'renewalComplex') { const out = RN.record(p.id); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
    if (view === 'developer') { const out = Q.developer(p.id || (p.name ? Q.idOfName(p.name) : null)); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
    if (view === 'project') { const out = Q.project(p.id); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
    return send(res, 400, { error: 'unknown view' });
  } catch (e) {
    console.error('intel api:', e.message);
    return send(res, 500, { error: 'intel-query-failed' });
  }
};
