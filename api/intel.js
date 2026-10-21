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
//   view=group        SPONSOR X-RAY — DEVELOPER GROUP INTELLIGENCE (lib/group): developer=<dev-…> [company=<number, USER-PROVIDED key>&confirm=1]
//                     | company=<number> | project=<moch:…|ila:…> → the group behind it: identity graph (CORE · DOCUMENTED · SHARED ·
//                     POSSIBLE · AMBIGUOUS, every edge with match state · source · date · why), the observed portfolio (each project once,
//                     per universe), furthest-verified stages, observed execution load, execution history vs the national cohort, signals,
//                     geography, programme, land pipeline, financial view per legal entity, pipeline vs financial position, SPVs,
//                     corporate structure, legal / corporate timeline, group timeline, matrix, risk & gap brief, next best evidence
//   view=group (POST) the same read with the user's documents in the body { userDocs: [...] } — validated, used for this read only, never stored
//   view=street       STREET INTELLIGENCE (lib/streets/street.js): id=st:<locality code>:<street code> [limit ≤ 500] → the official street
//                     (identity, synonyms, kind, status), its register evidence (OBSERVED deals only, sample state, medians, the deal list;
//                     POSSIBLE deals apart), the locality / verified-neighbourhood CONTEXT apart, exact Tel Aviv permit / site links,
//                     what PROPX knows and does not know; 404 for an id the official directory does not hold
//   view=txFreshness     how fresh the transaction universe is: the copy's dates apart, its state, the daily monitor's answer
//   view=recentLayer     the RECENT layer (lib/recent/read.js): the newer GovMap-layer copy (over.org.il), the class of every row it
//                     read, the exact replay of the 2,293 late-reported deals; [city=<code> limit ≤ 500] → that locality's recent-only
//                     deals (never merged into the register's figures) + `transactionCounts` (RECORDED TRANSACTION EVENTS ·
//                     VERIFIED DWELLING TRANSACTIONS · PRICED TRANSACTIONS USED IN STATISTICS, lib/recent/counts.js); view=street carries
//                     the street's block as `recent` and the street's + locality's three counts as `transactionCounts`
//   view=streetCoverage  the coverage audit (lib/streets/coverage.js): official rows · canonical · searchable · synonyms · with transactions ·
//                     sample states — national / by district / by locality, reconciled
//   view=street → `model`: the PROPX STREET ESTIMATE (lib/streets/value-read.js, a separate MODEL layer — never the observed market):
//                     value per m² of the reference dwelling, model evidence tier, validation-based range, why summary, versions
//   view=streetModel  id=… [limit ≤ 300] → WHY THIS ESTIMATE + the comparables by level (recomputed from the locality's shard and checked
//                     against the stored build)
//   view=streetApartment  id=… sqm= [rooms= newness=existing|new built= type=flat|garden|roof|cottage|house] → the apartment estimate (MODEL)
//   view=streetModelValidation  the out-of-sample validation report of the street value model

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
let GROUP = null; try { GROUP = require('../lib/group'); } catch { /* Sponsor X-Ray ships separately */ }
let STREETS = null; try { STREETS = { street: require('../lib/streets/street').street, coverage: require('../lib/streets/coverage').coverage }; } catch { /* street intelligence ships separately */ }
let SVM = null; try { SVM = require('../lib/streets/value-read'); } catch { /* the street value model ships separately */ }
let SREPORT = null; try { SREPORT = require('../lib/streets/report'); } catch { /* the street report ships separately */ }
let STREET_COVERAGE = null;

const send = (res, code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };

/* the user's documents (USER DOCUMENT) travel ONLY in the body of POST view=dd — never stored server-side, never logged.
   The 256 KB limit is enforced in three places, none of which trusts the next: the Edge middleware refuses a declared length
   over 256 KB before the function runs; here, a declared length over 256 KB is refused BEFORE req.body is touched (on Vercel,
   reading req.body parses the platform-buffered request, whose own ceiling is 4.5 MB); a body without a length (chunked) is
   measured after parsing; and lib/dd/userdocs.js caps the normalized evidence at 256 KB in total. The local dev server hands
   the raw stream, which is cut at 256 KB while it is read. */
const MAX_BODY = 256 * 1024;
function declaredTooLarge(req) { const n = Number(req.headers && req.headers['content-length']); return Number.isFinite(n) && n > MAX_BODY; }
function readBody(req) {
  if (declaredTooLarge(req)) return Promise.resolve({ tooLarge: true });
  if (req.body !== undefined) {
    const b = req.body, size = typeof b === 'string' ? Buffer.byteLength(b) : Buffer.isBuffer(b) ? b.length : Buffer.byteLength(JSON.stringify(b == null ? null : b) || '');
    if (size > MAX_BODY) return Promise.resolve({ tooLarge: true });
    return Promise.resolve(typeof b === 'string' ? (() => { try { return JSON.parse(b); } catch { return null; } })() : Buffer.isBuffer(b) ? (() => { try { return JSON.parse(b.toString('utf8')); } catch { return null; } })() : b);
  }
  return new Promise((resolve) => { let n = 0; const chunks = []; req.on('data', (c) => { n += c.length; if (n <= MAX_BODY) chunks.push(c); }); req.on('end', () => { if (n > MAX_BODY) return resolve({ tooLarge: true }); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { resolve(null); } }); req.on('error', () => resolve(null)); });
}


/* ── transaction events (lib/txevents) ── */
function txEventsOf(q) {
  const TX = require('../lib/txevents');
  const r = TX.query(q);
  return { ...r, events: (r.events || []).map(TX.wire), sources: undefined, states: TX.STATES };
}
function txCompleteness() {
  const TX = require('../lib/txevents');
  const S = TX.stores();
  return { completeness: S.completeness, national: S.nationalMeta ? { version: S.nationalMeta.version, builtAt: S.nationalMeta.builtAt, file: S.nationalMeta.file && { sha256: S.nationalMeta.file.sha256, bytes: S.nationalMeta.file.bytes, rowsTotal: S.nationalMeta.file.rowsTotal },
    validation: S.nationalMeta.validation && { pass: S.nationalMeta.validation.pass, same: S.nationalMeta.validation.same, differs: S.nationalMeta.validation.differs, missing: S.nationalMeta.validation.missing }, totals: S.nationalMeta.totals, classes: S.nationalMeta.classes,
    shown: S.nationalMeta.shown, parcelRecovery: S.nationalMeta.parcelRecovery, diff: S.nationalMeta.diff } : null,
    checks: S.nationalRuns.slice(-14), sources: TX.SOURCES, audit: completenessAudit() };
}
/* the full-universe accounting (scripts/txevents-completeness.js): every source row in one bucket, reachability, recovery, streets,
   parcels, latest-date parity — the long mismatch lists cut to their first rows */
function completenessAudit() {
  const fs = require('node:fs');
  const path = require('node:path');
  let A = null;
  try { A = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'txevents', 'completeness-audit.json'), 'utf8')); } catch { return null; }
  const L = A.latest || {};
  return { builtAt: A.builtAt, universe: A.universe, buckets: A.buckets, notSurfaced: A.defensibleKnownSourceEventsNotSurfaced, reachability: A.reachability,
    recovery: A.recovery, streets: A.streets && { total: A.streets.total, register: A.streets.register && { distinctStrings: A.streets.register.distinctStrings, stringsByVia: A.streets.register.stringsByVia },
      govmapWindow: A.streets.govmapWindow && { distinctStrings: A.streets.govmapWindow.distinctStrings, stringsByVia: A.streets.govmapWindow.stringsByVia },
      govmapHistory: A.streets.govmapHistory && { distinctStrings: A.streets.govmapHistory.distinctStrings, stringsByVia: A.streets.govmapHistory.stringsByVia }, vias: A.streets.vias },
    parcels: A.parcels, latest: { rule: L.rule, israel: L.israel, districts: L.districts,
      localities: L.localities && { ...L.localities, mismatches: (L.localities.mismatches || []).slice(0, 20) }, streets: L.streets && { ...L.streets, mismatches: (L.streets.mismatches || []).slice(0, 20) } },
    liveCheck: A.liveCheck };
}
/* UNPLACED TRANSACTION EVENTS — the national list of rows no locality can be determined for (lib/txevents/unplaced.js), newest first */
function txUnplaced(p) {
  const TX = require('../lib/txevents');
  const U = require('../lib/txevents/unplaced');
  const { built } = U.load();
  const every = U.all();
  const sel = every.filter((e) => (!p.state || e.unplaced.state === p.state) && (!p.source || e.source === p.source));
  const offset = Math.max(0, Number(p.offset) || 0), limit = Math.min(200, Math.max(1, Number(p.limit) || 100));
  const sm = U.summary({ limit: 0 });
  return { built, total: sel.length, offset, limit, more: offset + limit < sel.length, byState: sm.byState, byBasis: sm.byBasis, byKind: sm.byKind, byYear: sm.byYear, latest: sm.latest,
    register: sm.register, events: sel.slice(offset, offset + limit).map(TX.wire) };
}
function txLatest(p) {
  const TX = require('../lib/txevents');
  const L = TX.stores().latest;
  if (!L) return { available: false, reason: 'not-built' };
  const d = p.district ? L.districts[p.district] : null;
  const S = TX.stores();
  const top = d ? d.top : L.national.top;
  /* an area is every swept locality: the register copy is read for it (coverageOf of any swept code gives the copies' own dates) */
  const coverage = TX.coverageOf(5000, S).map((c) => ({ ...c, read: c.id === 'over:deals-register' ? true : c.read }));
  const recency = TX.recencyOf(top.map((e) => ({ ...e, state: e.state })), coverage);
  const perDay = d ? d.perDay : L.national.perDay;
  const period = TX.periodOf({ days: p.days, months: p.months, all: p.all === '1' });
  const n = Object.entries(perDay || {}).reduce((a, [k, v]) => a + (TX.inPeriod(k, period) ? v : 0), 0);
  const st = TX.statementOf(n, period, recency, coverage, { resolved: true });
  const statement = { ...st, text: st.kind === 'EVENTS' ? null : TX.STATEMENT_TEXT[st.kind] };
  return { available: true, builtAt: L.builtAt, recency, coverage, perDay, period, statement,
    national: { latest: L.national.latest, events: L.national.events, top: p.district ? undefined : L.national.top.slice(0, Math.min(500, Number(p.limit) || 100)) },
    districts: Object.fromEntries(Object.entries(L.districts).map(([k, v]) => [k, { latest: v.latest, events: v.events }])),
    district: d ? { id: p.district, latest: d.latest, events: d.events, top: d.top.slice(0, Math.min(300, Number(p.limit) || 100)) } : null,
    localities: p.localities ? L.localities : undefined };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = Object.fromEntries(url.searchParams.entries());
  const view = p.view || 'status';
  const post = req.method === 'POST' && (view === 'dd' || view === 'group');
  if (req.method !== 'GET' && !post) { res.statusCode = 405; res.setHeader('Allow', view === 'dd' || view === 'group' ? 'GET, POST' : 'GET'); return res.end('Method Not Allowed'); }
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
      const opt = { since, companyNumber: p.company != null && String(p.company).trim() !== '' ? String(p.company).trim().slice(0, 12) : undefined, confirmedCandidate: p.confirm === '1', userDocs: body && Array.isArray(body.userDocs) ? body.userDocs : [], projectId: p.project ? String(p.project) : null };
      const ready = await DD.prepare(opt);
      if (p.developer) { const out = DD.developer(String(p.developer), ready); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
      if (p.project) { const out = DD.project(String(p.project), ready); return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' }); }
      return send(res, 400, { error: 'developer or project required' });
    }
    if (view === 'group') {
      if (!GROUP || !DD) return send(res, 404, { error: 'group read model not available' });
      if (!p.developer && !p.company && !p.project) return send(res, 400, { error: 'developer, company or project required' });
      const key = p.developer && p.company != null && String(p.company).trim() !== '' ? String(p.company).trim().slice(0, 12) : undefined;
      const opt = { companyNumber: key, confirmedCandidate: p.confirm === '1', userDocs: body && Array.isArray(body.userDocs) ? body.userDocs : [], projectId: p.project ? String(p.project) : null };
      const ready = await DD.prepare(opt);
      const out = GROUP.group({ developer: p.developer || null, company: p.developer ? null : (p.company || null), project: p.developer ? null : (p.project || null) }, ready);
      return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' });
    }
    /* how fresh the transaction universe is (lib/gov/freshness.js + the daily monitor's latest answer) — never a deal */
    if (view === 'txFreshness') {
      const FRESH = require('../lib/gov/freshness');
      let monitor = null; try { monitor = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'transactions', 'freshness.json'), 'utf8')); } catch { /* not run yet */ }
      return send(res, 200, { freshness: FRESH.fromDisk(), monitor, states: FRESH.STATES, thresholds: FRESH.THRESHOLDS, basis: FRESH.BASIS });
    }
    /* the RECENT layer (lib/recent/read.js): the newer GovMap-layer copy reconciled against the register copy — the copy, the class
       of every fetched row, the exact 2,293 audit; city= → that locality's recent-only deals (DWELLING · TYPE NOT STATED ·
       NON-DWELLING apart) */
    if (view === 'recentLayer') {
      const RR = require('../lib/recent/read');
      if (p.city != null && p.city !== '') {
        if (!/^\d{1,5}$/.test(String(p.city))) return send(res, 400, { error: 'city must be an official locality code' });
        /* the locality's three transaction counts beside its recent-only deals (lib/recent/counts.js) — never one number */
        return send(res, 200, { ...RR.forLocality(p.city, { limit: p.limit || 100 }), transactionCounts: require('../lib/recent/counts').forLocality(p.city) });
      }
      return send(res, 200, RR.summary());
    }
    /* TRANSACTION EVENTS (lib/txevents): any locality (code) · street (sid) · building (sid + house) · block / parcel, a period
       (days | months | all), paged; the completeness dashboard; the latest events per district / nationally */
    if (view === 'txEvents') {
      const q = { code: p.code, streetId: p.sid, house: p.house, block: p.block, parcel: p.parcel, days: p.days, months: p.months, all: p.all === '1' || p.all === 'true', offset: p.offset, limit: p.limit };
      if (q.code != null && q.code !== '' && !/^\d{1,5}$/.test(String(q.code))) return send(res, 400, { error: 'code must be an official locality code' });
      if (q.streetId && !/^st:\d{1,5}:\d{1,5}$/.test(String(q.streetId))) return send(res, 400, { error: 'sid must be st:<locality code>:<street code>' });
      return send(res, 200, txEventsOf(q));
    }
    if (view === 'txCompleteness') return send(res, 200, txCompleteness());
    if (view === 'txUnplaced') return send(res, 200, txUnplaced(p));
    if (view === 'txLatest') return send(res, 200, txLatest(p));
    if (view === 'street' || view === 'streetCoverage') {
      if (!STREETS) return send(res, 404, { error: 'street intelligence not available' });
      if (view === 'streetCoverage') { STREET_COVERAGE = STREET_COVERAGE || STREETS.coverage(); return send(res, 200, STREET_COVERAGE); }
      if (!/^st:\d{1,5}:\d{1,5}$/.test(String(p.id || ''))) return send(res, 400, { error: 'id must be st:<locality code>:<street code>' });
      const obs = STREETS.street(p.id, { limit: p.limit });
      /* the MODEL layer travels beside the observed read under its own key — the observed object is never changed; the street's
         TRANSACTION EVENTS (lib/txevents: every source, one event per deal, newest first) travel under `events` */
      const out = obs && { ...obs, model: (SVM && SVM.estimate(obs.id)) || { available: false, reason: SVM ? 'street-not-in-model-build' : 'model-not-built' },
        events: txEventsOf({ streetId: p.id, all: true, limit: Math.min(200, Number(p.elimit) || 60) }) };
      return out ? send(res, 200, out) : send(res, 404, { error: 'not an official street' });
    }
    /* STREET INVESTMENT INTELLIGENCE (lib/streets/report.js — a composition layer over the read models above; additive views):
       streetReport (part=core for the first paint) · streetTx (the street's full transaction table: filters, sort, paging, format=csv) ·
       streetProperty (the user's property and assumptions — nothing is stored) */
    if (view === 'streetReport' || view === 'streetTx' || view === 'streetProperty') {
      if (!SREPORT) return send(res, 404, { error: 'street report not available' });
      if (!/^st:\d{1,5}:\d{1,5}$/.test(String(p.id || ''))) return send(res, 400, { error: 'id must be st:<locality code>:<street code>' });
      if (view === 'streetTx' && p.format === 'csv') {
        const csv = SREPORT.transactionsCsv(p.id, p);
        if (!csv) return send(res, 404, { error: 'not an official street' });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="propx-street-${String(p.id).replace(/[^0-9]+/g, '-').replace(/^-|-$/g, '')}-transactions.csv"`);
        res.statusCode = 200; return res.end(csv);
      }
      const out = view === 'streetReport' ? SREPORT.report(p.id, { part: p.part === 'core' ? 'core' : 'full', limit: p.limit })
        : view === 'streetTx' ? SREPORT.transactions(p.id, p) : SREPORT.property(p.id, p);
      return out ? send(res, 200, out) : send(res, 404, { error: 'not an official street' });
    }
    if (view === 'streetModel' || view === 'streetApartment' || view === 'streetModelValidation') {
      if (!SVM) return send(res, 404, { error: 'street value model not available' });
      if (view === 'streetModelValidation') { const v = SVM.validation(); return v ? send(res, 200, v) : send(res, 404, { error: 'model-not-built' }); }
      if (!/^st:\d{1,5}:\d{1,5}$/.test(String(p.id || ''))) return send(res, 400, { error: 'id must be st:<locality code>:<street code>' });
      const out = view === 'streetModel' ? SVM.explain(p.id, { limit: p.limit })
        : SVM.apartment(p.id, { sqm: p.sqm, rooms: p.rooms, newness: p.newness, built: p.built, type: p.type });
      return out ? send(res, 200, out) : send(res, 404, { error: 'not an official street' });
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
