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
//                     + `narrative` — "Why this market?": ordered deterministic sentences, each with class · source · period · scope · term (lib/dossier/narrative.js)
//   view=dossierIndex the geographies the page can ask for (districts + localities with ILA tenders)
//                     (+ verb=NEW|ADVANCED|CHANGED|REVISED|STALE|RECOVERED|CONFLICT — the "what changed" verb of every event, lib/radar/verbs.js)
//   view=dossierHistory  DOSSIER HISTORY / time machine — what changed for one geography between two PROPX reads (city= | district= | none = national; since=YYYY-MM-DD[, until=]): per fact NEW · CHANGED · REMOVED · STATE with class · source · period, signals added / removed, the Radar 2.0 state; NO_SNAPSHOT without a baseline, never a fabricated one (lib/dossier/history.js)
//   view=dossierSnapshots the days an append-only snapshot exists (data/dossier/snapshots/) with their counts and the fact registry (class · source · kind · label · period meaning · levels)
//   view=scan         OPPORTUNITY RADAR / RISK RADAR — the dossier signals over every geography (kind=opportunity|risk, level, city, district, m, limit; lib/radar/scan.js) — never a recommendation
//   view=scanGeo      the opportunity / risk items of one geography (city= | district= | none = national)
//   view=revisions    REVISION INTELLIGENCE — official CBS figures revised, old value beside new, by release (window=30d|90d|365d|all, material=1, measure, geo; lib/radar/revisions.js)
//   view=supply       SUPPLY PIPELINE — parallel universes of housing supply for one geography, never summed (city= | district= | none; lib/supply/pipeline.js)
//   view=pulse        MARKET PULSE — what changed in the Israeli new-home market: official sales, inventory, land, developers, planning, rental, macro, source health
//   view=renewal      urban-renewal complexes (MoCH) + their exact XPlan planning join: summary (incl. planning coverage, pipeline by
//                     XPlan stage, cities, MoCH ↔ XPlan discrepancies, DERIVED counts) + one page (city, stage, track, declaration, q,
//                     pstage=<XPlan stage>|none, match=exact|ambiguous|not-found|no-identifier|not-checked, flag=discrepancy|stale|no-evidence|shared,
//                     sort=declared|proposed|city|name|maturity, page, size)
//   view=renewalComplex  one complex (id=renewal:<complex number>) with its history and its planning: match + diagnostics, the XPlan plan,
//                     MoCH ↔ XPlan pairs, DERIVED metrics, complexes on the same plan, the plan boundary, the plan's observed history
//   view=graph        KNOWLEDGE GRAPH — one entity (entity=<id>: il | d-… | loc:<code> | dev-… | moch:… | ila:<MichrazID>:<lot> | rmi:<MichrazID> |
//                     plan:<key> | parcel:<block>/<parcel> | renewal:<n> | rental:<MichrazID> | source:<id>) → { node, edges, neighbours } — every edge
//                     with the exact key it rests on (relation=<RELATION> filter, limit= default 200 max 1000; 404 for an unknown id; lib/graph)
//   view=graphStats   the graph's counts per type / relation, join coverage, unmatched counts, conflicts, basis + the vocabulary
//   view=dd           INSTITUTIONAL DUE DILIGENCE (lib/dd) — developer=<dev-…> | project=<moch:…|ila:…> [company=<9-digit number, USER-PROVIDED
//                     key>&confirm=1] [since=YYYY-MM-DD]: legal identity with an explicit match state, corporate record (registry status,
//                     charges as filing events, Official Receiver cases), financial-data coverage class, contractor registration and
//                     active sites, Tel Aviv permits / sites, the verified dated timeline and stage ladder (coverage per rung), the
//                     execution gap rule, RISK & GAP BRIEF (six categories), NEXT BEST EVIDENCE, the WATCH contract, the evidence graph
//   view=ddCompany    one LEGAL COMPANY (number=<company number> | kablan=<contractor number>): registry facts, the developers resolving to
//                     it by match state, contractor registration, sites, filings, proceedings
//   view=ddCoverage   the municipal permit connectors (state per municipality) + the execution coverage map of a locality (city=<code>)
//   view=dd (POST)    the same read with the user's documents in the body { userDocs: [...] } — validated, used for this read only, never stored
//   view=ddPermit     one Tel Aviv permit record (id=<request or permit number>) with its site, parcel and the ILA lots on that parcel
//   view=ddStatus     coverage, freshness and the sync state of the due-diligence sources

'use strict';

const Q = require('../lib/entities/query');
const { catalog } = require('../lib/trust/catalog');
const RN = require('../lib/renewal/query');
const RADAR = require('../lib/radar/query');
const DOSSIER = require('../lib/dossier/query');
let NARR = null; try { NARR = require('../lib/dossier/narrative'); } catch { /* the narrative ships separately */ }
let HIST = null; try { HIST = require('../lib/dossier/history'); } catch { /* the dossier history ships separately */ }
const SCAN = require('../lib/radar/scan');
const REV = require('../lib/radar/revisions');
let SUPPLY = null; try { SUPPLY = require('../lib/supply/pipeline'); } catch { /* the supply read model ships separately */ }
let GRAPH = null; try { GRAPH = require('../lib/graph'); } catch { /* the knowledge graph ships separately */ }
let DD = null; try { DD = require('../lib/dd'); } catch { /* the due-diligence layer ships separately */ }

const send = (res, code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };

/* the user's documents (USER DOCUMENT) travel ONLY in the body of POST view=dd — never stored server-side, never logged;
   Vercel parses a JSON body into req.body, the local dev server hands the raw stream */
const MAX_BODY = 256 * 1024;
function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body);
  return new Promise((resolve) => { let n = 0; const chunks = []; req.on('data', (c) => { n += c.length; if (n <= MAX_BODY) chunks.push(c); }); req.on('end', () => { if (n > MAX_BODY) return resolve({ tooLarge: true }); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { resolve(null); } }); req.on('error', () => resolve(null)); });
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = Object.fromEntries(url.searchParams.entries());
  const view = p.view || 'status';
  const post = req.method === 'POST' && view === 'dd';
  if (req.method !== 'GET' && !post) { res.statusCode = 405; res.setHeader('Allow', view === 'dd' ? 'GET, POST' : 'GET'); return res.end('Method Not Allowed'); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  let body = null;
  if (post) { body = await readBody(req); if (body && body.tooLarge) return send(res, 413, { error: 'body too large' }); }
  try {
    if (view === 'sources') return send(res, 200, catalog());
    if (view === 'radar') return send(res, 200, RADAR.feed(p));
    if (view === 'pulse') return send(res, 200, RADAR.pulse());
    if (view === 'dossier') { const level = p.city ? 'locality' : p.district ? 'district' : 'il'; const out = DOSSIER.dossier({ level, code: p.city || p.district || null }); if (!out) return send(res, 404, { error: 'unknown geography' });
      if (NARR) { let scan = null, supply = null; try { scan = SCAN.forGeo({ level, code: p.city || p.district || 'il' }); } catch { /* scan unavailable */ } try { supply = SUPPLY ? SUPPLY.supply({ level, code: p.city || p.district || null }) : null; } catch { /* supply unavailable */ } out.narrative = NARR.narrative(out, { scan, supply }); }
      return send(res, 200, out); }
    if (view === 'dossierIndex') return send(res, 200, DOSSIER.index());
    if (view === 'dossierHistory') { if (!HIST) return send(res, 404, { error: 'dossier history not available' }); const level = p.city ? 'locality' : p.district ? 'district' : 'il'; const out = HIST.diff({ level, code: p.city || p.district || 'il', since: p.since, until: p.until }); return out ? send(res, 200, out) : send(res, 404, { error: 'unknown geography' }); }
    if (view === 'dossierSnapshots') { if (!HIST) return send(res, 404, { error: 'dossier history not available' }); return send(res, 200, HIST.snapshots()); }
    if (view === 'scan') return send(res, 200, SCAN.scan(p));
    if (view === 'scanGeo') { const level = p.city ? 'locality' : p.district ? 'district' : 'il'; const out = SCAN.forGeo({ level, code: p.city || p.district || 'il' }); return out ? send(res, 200, out) : send(res, 404, { error: 'unknown geography' }); }
    if (view === 'revisions') return send(res, 200, REV.revisions(p));
    if (view === 'supply') { if (!SUPPLY) return send(res, 404, { error: 'supply read model not available' }); const level = p.city ? 'locality' : p.district ? 'district' : 'il'; const out = SUPPLY.supply({ level, code: p.city || p.district || null }); return out ? send(res, 200, out) : send(res, 404, { error: 'unknown geography' }); }
    if (view === 'graph') {
      if (!GRAPH) return send(res, 404, { error: 'graph read model not available' });
      const id = String(p.entity || '').trim(); if (!id) return send(res, 400, { error: 'entity required' });
      if (p.relation && !GRAPH.RELATIONS[p.relation]) return send(res, 400, { error: 'unknown relation', relations: Object.keys(GRAPH.RELATIONS) });
      const node = GRAPH.node(id); if (!node) return send(res, 404, { error: 'unknown entity' });
      const q = { relation: p.relation || null, limit: p.limit };
      const edges = GRAPH.edges(id, q);
      return send(res, 200, { node, edges, edgesTotal: GRAPH.degree(id, q), neighbours: GRAPH.neighbours(id, q), relation: q.relation, limit: edges.length, basis: GRAPH.BASIS });
    }
    if (view === 'graphStats') { if (!GRAPH) return send(res, 404, { error: 'graph read model not available' }); return send(res, 200, { ...GRAPH.stats(), vocabulary: GRAPH.vocabulary() }); }
    if (view === 'dd' || view === 'ddCompany' || view === 'ddPermit' || view === 'ddStatus' || view === 'ddCoverage') {
      if (!DD) return send(res, 404, { error: 'due-diligence read model not available' });
      if (view === 'ddStatus') return send(res, 200, DD.status());
      if (view === 'ddCoverage') return send(res, 200, DD.coverage(/^\d{1,5}$/.test(String(p.city || '')) ? Number(p.city) : null));
      const since = /^\d{4}-\d{2}-\d{2}$/.test(String(p.since || '')) ? p.since : null;
      if (view === 'ddCompany') {
        let out = DD.company(p.number || null, { kablan: p.kablan || null, since });
        /* a valid number outside the kept rows: one live, exact-number lookup (labelled LIVE READ; nothing stored) */
        if (out && out.kind === 'company' && out.inCoverage === false) { const ready = await DD.prepare({ companyNumber: out.number }); if (ready.live && ready.live.size) { const again = DD.company(out.number, { since, live: ready.live }); if (again) out = { ...again, live: [...ready.live.values()].map((r) => ({ number: r.number, checkedAt: r.checkedAt, found: !!r.company, answered: r.answered })) }; } }
        return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
      if (view === 'ddPermit') { const out = DD.permit(p.id); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
      const opt = { since, companyNumber: p.company != null && String(p.company).trim() !== '' ? String(p.company).trim().slice(0, 12) : undefined, confirmedCandidate: p.confirm === '1', userDocs: body && Array.isArray(body.userDocs) ? body.userDocs : [] };
      const ready = await DD.prepare(opt);
      if (p.developer) { const out = DD.developer(String(p.developer), ready); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
      if (p.project) { const out = DD.project(String(p.project), ready); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
      return send(res, 400, { error: 'developer or project required' });
    }
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
