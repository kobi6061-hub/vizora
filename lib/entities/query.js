// PROPX · Developers & Projects — read model and unified search (served by api/intel.js).
//
// Builds the registry (lib/entities/registry.js) from the bundled records — data/land/tenders.json and
// data/housing/lotteries.json — once per data stamp (the two meta files' mtimes), and answers:
//   developers  one sorted page of developer entities (filters: q, city, role, kind, period=all|recent)
//   developer   one entity: its activity per source, markets, sites, projects, construction evidence, aliases
//   projects    one sorted page of projects (MoCH lottery projects and ILA awarded residential lots, never joined)
//   project     one project with its stage evidence and provenance
//   signals     DEVELOPER MARKET ENTRY (derived, components shown)
//   search      one query → routed results: tender number / MichrazID, plan number, block / parcel, developer,
//               project, locality / street / address (lib/geo/registry.js). Exact keys first; names by substring —
//               a search hit is a route, never a merge.
// Every answer carries the coverage and the basis: OBSERVED PROPX ACTIVITY, not a land bank, not a total pipeline.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildRegistry, STAGES, BASIS, RECENT_MONTHS } = require('./registry');
const { searchKey, canonicalName, devId } = require('./names');

const ROOT = path.join(__dirname, '..', '..', 'data');
const LAND_DIR = process.env.LAND_DATA_DIR || path.join(ROOT, 'land');
const HOUSING_DIR = process.env.HOUSING_DATA_DIR || path.join(ROOT, 'housing');
const GEO_FILE = process.env.GEO_LOCALITIES_FILE || path.join(ROOT, 'geo', 'localities.json');
const IL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
const israelToday = (now = new Date()) => IL_DATE.format(now);

const SOURCES = {
  'rmi:michrazim': { publisher: 'רשות מקרקעי ישראל', publisherEn: 'Israel Land Authority', name: 'אתר המכרזים — מכרזים, מגרשים וזוכים', classification: 'OFFICIAL', role: 'tender wins, units, land sums, plan / parcel keys' },
  'datagov:moch:dira-behanacha-lotteries': { publisher: 'משרד הבינוי והשיכון', publisherEn: 'Ministry of Construction and Housing', name: 'נתונים תקופתיים — תכנית דירה בהנחה (data.gov.il)', classification: 'OFFICIAL', role: 'lottery projects, developer, units, ₪/m², permit and project stage' },
  'datagov:moch:construction-progress': { publisher: 'משרד הבינוי והשיכון', publisherEn: 'Ministry of Construction and Housing', name: 'דיווחי התקדמות הבניה (data.gov.il)', classification: 'OFFICIAL · STALE (2024-03-01)', role: 'construction stage dates, joined to awarded lots by exact block + parcel' },
};

/* ------------------------------------------------------------ loading */
let CACHE = null, CITY = null;
function cities() {
  if (CITY) return CITY;
  CITY = new Map();
  try { for (const l of JSON.parse(fs.readFileSync(GEO_FILE, 'utf8')).localities || []) CITY.set(l.code, l); } catch { /* registry not bundled */ }
  return CITY;
}
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function load({ landDir = LAND_DIR, housingDir = HOUSING_DIR, today = israelToday() } = {}) {
  const stamp = [landDir, housingDir, mtime(path.join(landDir, 'meta.json')), mtime(path.join(housingDir, 'meta.json')), today].join('|');
  if (CACHE && CACHE.stamp === stamp) return CACHE;
  const tenders = readJson(path.join(landDir, 'tenders.json'), []);
  const lotteries = readJson(path.join(housingDir, 'lotteries.json'), []);
  const landMeta = readJson(path.join(landDir, 'meta.json'), null), housingMeta = readJson(path.join(housingDir, 'meta.json'), null);
  const C = cities();
  const cityName = (code) => { const l = C.get(code); return l ? { he: l.he, en: l.en } : null; };
  const R = buildRegistry({ tenders, lotteries, cityName, today });
  const devById = new Map(R.developers.map((d) => [d.id, d]));
  const projById = new Map([...R.projects, ...R.sites].map((p) => [p.id, p]));
  /* the exact search keys of the tender records (a search routes to the land section; it never reads lots) */
  const tenderByName = new Map(), tenderById = new Map(), byPlan = new Map(), byParcel = new Map();
  for (const r of tenders) {
    if (r.inLatestSource === false) continue;
    const brief = { id: r.id, michrazId: r.michrazId, name: r.name || null, lifecycle: r.lifecycle || null, localityCode: r.localityCode || null, units: r.units ?? null, publishedDate: r.publishedDate || null };
    tenderById.set(String(r.michrazId), brief);
    if (r.name) tenderByName.set(String(r.name).replace(/\s+/g, ''), brief);
    for (const p of r.plans || []) { const k = planKey(p.plan); if (!k || p.join === 'not-a-plan-number') continue; if (!byPlan.has(k)) byPlan.set(k, { plan: p.plan, tenders: [] }); byPlan.get(k).tenders.push(brief); }
    for (const p of r.parcels || []) { if (!p.block) continue; const k = p.block + '/' + (p.parcel || ''); if (!byParcel.has(k)) byParcel.set(k, []); byParcel.get(k).push(brief); }
  }
  CACHE = { stamp, today, R, devById, projById, tenderByName, tenderById, byPlan, byParcel, landMeta, housingMeta };
  return CACHE;
}
const planKey = (p) => String(p || '').replace(/\s+/g, '').trim();

/* ------------------------------------------------------------ helpers */
const clampInt = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const str = (v, max = 120) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
function cityMatch(code, q) {
  if (!q) return true;
  if (/^\d+$/.test(q)) return String(code) === q;
  const l = cities().get(code); if (!l) return false;
  const k = searchKey(q);
  return [l.he, l.en, ...(l.aliases || [])].some((n) => n && searchKey(n) === k);
}
function freshness(c) {
  const L = c.landMeta || {}, H = c.housingMeta || {};
  return { store: 'git', builtFor: c.today, recentMonths: RECENT_MONTHS, recentFrom: c.R.coverage.recentFrom,
    land: { checkedAt: L.checkedAt || null, latestPublished: L.coverage ? L.coverage.publishedTo : null, normalizerVersion: L.normalizerVersion ?? null,
      detailCoverage: L.detailCoverage ? { retrieved: L.detailCoverage.retrieved ?? null, total: L.detailCoverage.total ?? L.inLatestSource ?? null } : null },
    housing: { checkedAt: H.checkedAt || null, sourceUpdatedAt: H.sourceUpdatedAt || null, lotteryDateTo: H.coverage ? H.coverage.lotteryDateTo : null },
    construction: { asOf: '2024-03-01', stale: true } };
}
const methodology = {
  basis: `${BASIS} — what PROPX's official sources show; never a land bank, a total pipeline, a market share or a complete developer list`,
  identity: 'one developer = one canonical name (typographic variants only: quote glyphs, whitespace). No similarity merge. An identical legal name (with a legal-form marker) in two sources is one entity — Israel\'s Registrar of Companies does not register two companies under one name. A cut string that is a strict prefix of exactly one other name is shown as a possible same entity, never merged.',
  listing: 'tender winners are listed only with a legal-form marker (בע"מ, Ltd, שותפות, אגודה, עמותה, public body); unmarked strings — usually private persons on self-build lots — are counted, never listed. A MoCH lottery developer is listed by its source role.',
  units: 'ILA units = the Authority\'s units of residential lots won (published lot capacity, not homes built); MoCH units = units offered in the project\'s first lottery. Never added across sources: they are often the same homes.',
  land: 'land totals = winning sums of competitive-bid lots only (VAT not stated by the source); ₪/m² bids (מחיר למשתכן) and fixed-price allocations are counted apart and never summed as land cost',
  construction: 'MoCH construction-progress rows (as of 2024-03-01, STALE) joined to an awarded lot by exact block AND parcel, for that lot only',
  projects: 'two kinds with their own official ids, never joined: moch:<ProjectID> (a lottery project) and ila:<MichrazID>:<lot file id> (an awarded residential lot won by a listed developer). Stage = the furthest stage with direct evidence.',
  recent: `recent = decided / lotteried within the ${RECENT_MONTHS} months before the build date (Israel time)`,
  entries: 'DEVELOPER MARKET ENTRY (DERIVED): a city whose first observed activity of a developer falls in the recent window, for a developer already active elsewhere before it',
};

/* ------------------------------------------------------------ views */
const DEV_SORTS = { units: (e, P) => P(e).residentialUnits || 0, lots: (e, P) => P(e).lots, projects: (e, P, L) => L(e).projects, cities: (e) => e.cities, last: (e) => e.lastActivity || '', name: null };
function developers(params = {}, opt = {}) {
  const c = load(opt), recent = params.period === 'recent';
  const P = (e) => (recent ? e.tendersRecent : e.tenders), L = (e) => (recent ? e.lotteriesRecent : e.lotteries);
  const q = str(params.q), role = str(params.role), kind = str(params.kind), city = str(params.city);
  const qk = q ? searchKey(q) : null;
  let rows = c.R.developers.filter((e) => (!qk || e.search.includes(qk)) && (!role || e.roles.includes(role)) && (!kind || e.kind === kind)
    && (!city || e.markets.some((m) => cityMatch(m.localityCode, city))) && (!recent || P(e).lots || L(e).lotteries));
  const sort = Object.prototype.hasOwnProperty.call(DEV_SORTS, params.sort) ? params.sort : 'units', dir = params.order === 'asc' ? 1 : -1;
  const key = DEV_SORTS[sort];
  rows = rows.slice().sort((a, b) => (key ? (key(a, P, L) > key(b, P, L) ? dir : key(a, P, L) < key(b, P, L) ? -dir : 0) : 0) || a.name.localeCompare(b.name, 'he'));
  const size = clampInt(params.size, 25, 1, 100), pages = Math.max(1, Math.ceil(rows.length / size)), page = clampInt(params.page, 1, 1, pages);
  const brief = (e) => ({ id: e.id, name: e.name, kind: e.kind, joint: e.joint, roles: e.roles, tenders: P(e), lotteries: L(e), cities: e.cities,
    construction: e.construction ? { lots: e.construction.lots, buildings: e.construction.buildings, started: e.construction.started, completed: e.construction.completed, asOf: e.construction.asOf } : null,
    firstActivity: e.firstActivity, lastActivity: e.lastActivity, active: e.active, possibleSame: e.possibleSame.length });
  return { basis: BASIS, period: recent ? 'recent' : 'all', sort, order: dir === 1 ? 'asc' : 'desc', total: rows.length, page, pages, size,
    rows: rows.slice((page - 1) * size, page * size).map(brief), coverage: c.R.coverage, freshness: freshness(c), methodology };
}
/** one developer by its source name (canonicalized — typographic variants only), for links from a tender's winner */
const idOfName = (name) => devId(canonicalName(name));
function developer(id, opt = {}) {
  const c = load(opt), e = c.devById.get(String(id || ''));
  if (!e) return null;
  const sites = e.sites.map((x) => c.projById.get(x)).filter(Boolean).sort((a, b) => String(b.decisionDate || '').localeCompare(String(a.decisionDate || '')));
  const projects = e.projects.map((x) => c.projById.get(x)).filter(Boolean).sort((a, b) => String(b.lastLotteryDate || '').localeCompare(String(a.lastLotteryDate || '')));
  const { search, ...out } = e;
  return { ...out, sites: sites.slice(0, 200).map(siteBrief), sitesTotal: sites.length, projects: projects.slice(0, 200).map(projectBrief), projectsTotal: projects.length,
    entries: c.R.entries.filter((x) => x.developerId === e.id), sources: e.roles.map((r) => (r === 'ila-tender-winner' ? 'rmi:michrazim' : 'datagov:moch:dira-behanacha-lotteries'))
      .concat(e.construction ? ['datagov:moch:construction-progress'] : []).map((id) => ({ id, ...SOURCES[id] })),
    coverage: c.R.coverage, freshness: freshness(c), methodology };
}
const siteBrief = (s) => ({ id: s.id, kind: s.kind, tenderId: s.tenderId, tender: s.tender, lotId: s.lotId, developerId: s.developerId, developerName: s.developerName, city: s.city, cityEn: s.cityEn,
  localityCode: s.localityCode, neighborhood: s.neighborhood, track: s.track, units: s.units, priceBasis: s.priceBasis, landPrice: s.landPrice, landPerUnit: s.landPerUnit, bidPerSqm: s.bidPerSqm,
  decisionDate: s.decisionDate, stage: s.stage.furthest, construction: s.construction ? { buildings: s.construction.buildings, started: s.construction.started, completed: s.construction.completed, asOf: s.construction.asOf } : null });
const projectBrief = (p) => ({ id: p.id, kind: p.kind, projectId: p.projectId, name: p.name, developerName: p.developerName, developerIds: p.developerIds, city: p.city, cityEn: p.cityEn,
  localityCode: p.localityCode, neighborhood: p.neighborhood, programHe: p.programHe, unitsFirstLottery: p.unitsFirstLottery, lotteries: p.lotteries.length, firstLotteryDate: p.firstLotteryDate,
  lastLotteryDate: p.lastLotteryDate, pricePerSqm: p.pricePerSqm, permitStatusHe: p.permitStatusHe, projectStatusHe: p.projectStatusHe, stage: p.stage.furthest, applicantsPerUnit: p.demand.applicantsPerUnit });

const PROJ_SORTS = { date: (p) => p.lastLotteryDate || p.decisionDate || '', units: (p) => (p.kind === 'ila-awarded-lot' ? p.units : p.unitsFirstLottery) || 0, name: null };
function projects(params = {}, opt = {}) {
  const c = load(opt);
  const kind = params.kind === 'moch' ? 'moch-lottery-project' : params.kind === 'ila' ? 'ila-awarded-lot' : null;
  const q = str(params.q), city = str(params.city), stage = STAGES.includes(params.stage) ? params.stage : null, dev = str(params.developer);
  const tokens = q ? searchKey(q).split(' ').filter(Boolean) : [];
  const hay = (p) => searchKey([p.name, p.tender, p.developerName, p.city, p.neighborhood].filter(Boolean).join(' '));
  let rows = [...(kind !== 'ila-awarded-lot' ? c.R.projects : []), ...(kind !== 'moch-lottery-project' ? c.R.sites : [])]
    .filter((p) => (!city || cityMatch(p.localityCode, city)) && (!stage || p.stage.furthest === stage) && (!dev || p.developerId === dev || (p.developerIds || []).includes(dev))
      && (!tokens.length || (() => { const h = hay(p); return tokens.every((t) => h.includes(t)); })()));
  const sort = Object.prototype.hasOwnProperty.call(PROJ_SORTS, params.sort) ? params.sort : 'date', dir = params.order === 'asc' ? 1 : -1, key = PROJ_SORTS[sort];
  rows = rows.slice().sort((a, b) => (key ? (key(a) > key(b) ? dir : key(a) < key(b) ? -dir : 0) : 0) || String(a.name || a.tender || '').localeCompare(String(b.name || b.tender || ''), 'he'));
  const size = clampInt(params.size, 25, 1, 100), pages = Math.max(1, Math.ceil(rows.length / size)), page = clampInt(params.page, 1, 1, pages);
  const stageCounts = {};
  for (const p of rows) { const s = p.stage.furthest || 'none'; stageCounts[s] = (stageCounts[s] || 0) + 1; }
  return { basis: BASIS, kind: kind || 'all', sort, order: dir === 1 ? 'asc' : 'desc', total: rows.length, page, pages, size, stageCounts,
    rows: rows.slice((page - 1) * size, page * size).map((p) => (p.kind === 'ila-awarded-lot' ? siteBrief(p) : projectBrief(p))),
    coverage: c.R.coverage, freshness: freshness(c), methodology };
}
function project(id, opt = {}) {
  const c = load(opt), p = c.projById.get(String(id || ''));
  if (!p) return null;
  const devs = (p.developerIds || [p.developerId]).map((d) => c.devById.get(d)).filter(Boolean).map((e) => ({ id: e.id, name: e.name, roles: e.roles }));
  const src = p.kind === 'ila-awarded-lot' ? ['rmi:michrazim'].concat(p.construction ? ['datagov:moch:construction-progress'] : []) : ['datagov:moch:dira-behanacha-lotteries'];
  return { ...p, developers: devs, sources: src.map((id) => ({ id, ...SOURCES[id] })),
    joins: p.kind === 'ila-awarded-lot' ? { lotteryProject: null, note: 'no shared official key with the MoCH lottery records — not joined' } : { tenderLot: null, note: 'the lottery record carries no tender, plan or parcel — not joined to a tender lot' },
    freshness: freshness(c), methodology };
}
function signals(params = {}, opt = {}) {
  const c = load(opt), city = str(params.city);
  const rows = c.R.entries.filter((x) => !city || cityMatch(x.localityCode, city));
  return { basis: 'DERIVED from ' + BASIS, signal: 'developer-market-entry', definition: methodology.entries, total: rows.length, rows: rows.slice(0, clampInt(params.limit, 60, 1, 300)),
    freshness: freshness(c) };
}

/* ------------------------------------------------------------ search */
const YEAR = (y) => { const n = Number(y); if (y.length === 2) return 2000 + n; return n; };
function search(qRaw, opt = {}) {
  const q = str(qRaw, 80);
  const out = { query: q, results: [], basis: 'a hit routes to an entity; names match by substring and are never merged', freshness: null };
  if (!q || q.length < 2) return out;
  const c = load(opt); out.freshness = freshness(c);
  const push = (r) => { if (!out.results.some((x) => x.type === r.type && x.id === r.id)) out.results.push(r); };
  const cityLabel = (code) => { const l = cities().get(code); return l ? l.he : null; };
  const tenderHit = (t, via) => push({ type: 'tender', id: t.id, label: `מכרז ${t.name || t.michrazId}`, sub: [cityLabel(t.localityCode), t.lifecycle, t.publishedDate].filter(Boolean).join(' · '),
    meta: { name: t.name || String(t.michrazId), city: cityLabel(t.localityCode), lifecycle: t.lifecycle, publishedDate: t.publishedDate }, route: { section: 'land', tender: t.id }, via });
  /* 1 · exact keys */
  const qq = q.replace(/^(מכרז|michraz|tender)\s*/i, '').replace(/\s+/g, '');
  let m = /^(\d{1,4})\/(\d{2}|\d{4})$/.exec(qq);
  if (m && YEAR(m[2]) >= 1990 && YEAR(m[2]) <= 2040) { const t = c.tenderByName.get(`${Number(m[1])}/${YEAR(m[2])}`) || c.tenderByName.get(`${m[1]}/${YEAR(m[2])}`); if (t) tenderHit(t, 'exact-tender-number'); }
  if (/^\d{8}$/.test(qq) && c.tenderById.has(qq)) tenderHit(c.tenderById.get(qq), 'exact-michraz-id');
  const planQ = planKey(q.replace(/^(תכנית|תוכנית|תב"ע|תב״ע|plan)\s*/i, ''));
  if (/\d/.test(planQ) && /[\/\-]/.test(planQ) && c.byPlan.has(planQ)) {
    const P = c.byPlan.get(planQ);
    push({ type: 'plan', id: 'plan:' + planQ, label: `תכנית ${P.plan}`, sub: `${P.tenders.length} מכרזים מפנים לתכנית`, meta: { plan: P.plan, tenders: P.tenders.length }, route: { section: 'land', plan: P.plan }, via: 'exact-plan-number', tenders: P.tenders.slice(0, 10) });
  }
  m = /(?:גוש\s*)(\d{3,6})(?:\s*(?:חלקה|ח')\s*(\d{1,5}))?/.exec(q) || (/^(\d{3,6})\s*\/\s*(\d{1,5})$/.test(q.trim()) && !(Number(q.trim().split('/')[1]) >= 1990 && Number(q.trim().split('/')[1]) <= 2040) ? /^(\d{3,6})\s*\/\s*(\d{1,5})$/.exec(q.trim()) : null);
  if (m) {
    const keys = m[2] ? [m[1] + '/' + m[2]] : [...c.byParcel.keys()].filter((k) => k.startsWith(m[1] + '/'));
    const ts = [...new Map(keys.flatMap((k) => c.byParcel.get(k) || []).map((t) => [t.id, t])).values()];
    if (ts.length) push({ type: 'parcel', id: 'parcel:' + (m[2] ? m[1] + '/' + m[2] : m[1]), label: m[2] ? `גוש ${m[1]} חלקה ${m[2]}` : `גוש ${m[1]}`, sub: `${ts.length} מכרזים על הגוש/חלקה`,
      meta: { block: m[1], parcel: m[2] || null, tenders: ts.length }, route: { section: 'land', q: m[1] }, via: 'exact-block-parcel', tenders: ts.slice(0, 10) });
  }
  /* 2 · developers and projects by name (substring, all tokens) */
  const tokens = searchKey(q).split(' ').filter((t) => t.length > 1);
  if (tokens.length) {
    const devs = c.R.developers.filter((e) => tokens.every((t) => e.search.includes(t)))
      .sort((a, b) => (b.search.startsWith(tokens[0]) - a.search.startsWith(tokens[0])) || (b.tenders.lots + b.lotteries.projects) - (a.tenders.lots + a.lotteries.projects));
    for (const e of devs.slice(0, 8)) push({ type: 'developer', id: e.id, label: e.name, sub: `${e.tenders.lots} מגרשים · ${e.lotteries.projects} פרויקטי הגרלה · ${e.cities} ערים`,
      meta: { lots: e.tenders.lots, projects: e.lotteries.projects, cities: e.cities }, route: { section: 'intel', developer: e.id }, via: 'name-substring' });
    const hay = (p) => searchKey([p.name, p.developerName, p.city, p.neighborhood].filter(Boolean).join(' '));
    const projs = c.R.projects.filter((p) => { const h = hay(p); return tokens.every((t) => h.includes(t)); }).sort((a, b) => String(b.lastLotteryDate || '').localeCompare(String(a.lastLotteryDate || '')));
    for (const p of projs.slice(0, 8)) push({ type: 'project', id: p.id, label: p.name || `פרויקט ${p.projectId}`, sub: [p.city, p.developerName, p.programHe].filter(Boolean).join(' · '), route: { section: 'intel', project: p.id }, via: 'name-substring' });
  }
  /* 3 · geography: locality / street; a house number makes it an address (the transactions section) */
  try {
    const { searchGeo } = require('../geo/registry');
    const house = /(?:^|\s)(\d{1,4}[א-ת]?)(?=\s|$)/.exec(q);
    const geoQ = house ? q.replace(house[0], ' ').replace(/\s+/g, ' ').trim() : q;
    if (geoQ.length >= 2 && !/^\d/.test(geoQ)) {
      for (const g of (searchGeo(geoQ, 6).matches || [])) {
        if (g.kind === 'street' && house) push({ type: 'address', id: `${g.id}:${house[1]}`, label: `${g.he} ${house[1]}, ${g.city}`, sub: 'כתובת · עסקאות', route: { section: 'txSection', city: g.city, street: g.he, house: house[1], geo: g.id }, geo: g, via: 'geo-registry' });
        else push({ type: g.kind === 'street' ? 'street' : 'locality', id: g.id, label: g.kind === 'street' ? `${g.he}, ${g.city}` : g.he, sub: g.kind === 'street' ? 'רחוב' : 'יישוב', route: { section: 'geo', geo: g.id }, geo: g, via: 'geo-registry' });
      }
    }
  } catch { /* geography registry not bundled */ }
  /* exact keys first; a locality whose official name IS the query comes before names that merely contain it */
  const exactPlace = (r) => r.type === 'locality' && searchKey(r.label) === searchKey(q);
  const ORDER = ['tender', 'plan', 'parcel', 'exact-locality', 'address', 'developer', 'project', 'locality', 'street'];
  const rank = (r) => ORDER.indexOf(exactPlace(r) ? 'exact-locality' : r.type);
  out.results.sort((a, b) => rank(a) - rank(b));
  out.results = out.results.slice(0, 24);
  return out;
}

function status(opt = {}) {
  const c = load(opt);
  return { basis: BASIS, coverage: c.R.coverage, freshness: freshness(c), sources: Object.entries(SOURCES).map(([id, s]) => ({ id, ...s })), methodology };
}

module.exports = { load, developers, developer, idOfName, projects, project, signals, search, status, SOURCES, israelToday };
