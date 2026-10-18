// PROPX · INSTITUTIONAL DUE DILIGENCE — the orchestrator (18.10.2026). One call per entity composes the read models:
//   developer(id, opt)   → { kind:'developer', dd (lib/dd/developer.js), brief, nextBest, watch, evidence, status }
//   project(id, opt)     → { kind:'project',   dd (lib/dd/project.js) + the developer's DD, brief, nextBest, watch, evidence, status }
//   company(number, opt) → the LEGAL COMPANY read: registry facts, the developers resolving to it (by match state), contractor
//                          registration, sites, filings, proceedings, Tel Aviv permit-holder sites
//   permit(id, opt)      → one Tel Aviv permit record with its site, parcel and the ILA lots on that parcel (TEL AVIV MUNICIPAL)
//   searchHits(q)        → LEGAL COMPANY / CONTRACTOR / PERMIT hits for the unified search (exact keys first; names by substring;
//                          every hit typed — never a silent pick)
//   status()             → coverage, freshness and the sync state of every due-diligence source
// opt: { now, companyNumber, confirmedCandidate, since, dataDir } — companyNumber is a USER-PROVIDED key (labelled as such).
'use strict';

const Q = require('../entities/query');
const R = require('../entities/resolve');
const D = require('./data');
const DEV = require('./developer');
const PRJ = require('./project');
const BR = require('./brief');
const W = require('./watch');
const EV = require('./evidence');
const UD = require('./userdocs');
const FIN = require('./financial');
const STR = require('./structure');
const PCO = require('./projectco');
const LEG = require('./legal');
const SAL = require('./sales');
const COV = require('./coverage');
const SUM = require('./summary');
const PC = require('../permits/connectors');
const LIVE = require('./live');

const bi = (he, en) => ({ he, en });
const VERSION = { id: 'propx-dd-v1', effective: '2026-10-18' };

/* a per-read overlay of LIVE registry rows (lib/dd/live.js) for numbers outside the kept rows — the memoised cache is never
   mutated: the maps that gain rows are copied for this read only; live rows are reachable by NUMBER only, never by name */
function overlay(c, live) {
  if (!live || !live.size) return c;
  const O = { ...c, idx: { ...c.idx, companies: { ...c.idx.companies, byNumber: new Map(c.idx.companies.byNumber) } }, filingsByNum: new Map(c.filingsByNum), liquidationByNum: new Map(c.liquidationByNum), voluntaryByNum: new Map(c.voluntaryByNum), strikeOffByNum: new Map(c.strikeOffByNum || []), live };
  for (const [num, rec] of live) {
    if (rec.company) O.idx.companies.byNumber.set(num, rec.company);
    if (rec.answered.filings) O.filingsByNum.set(num, rec.filings.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))));
    if (rec.answered.liquidation) O.liquidationByNum.set(num, rec.liquidation);
    if (rec.answered.voluntaryFast) O.voluntaryByNum.set(num, rec.voluntaryFast);
    if (rec.strikeOff) O.strikeOffByNum.set(num, rec.strikeOff);
  }
  return O;
}
/** before a read: the company numbers the user supplied (typed or in a document) that the kept rows do not hold → a live lookup */
async function prepare(opt = {}) {
  if (opt.liveLookup === false) return opt;
  const c = D.load(opt.dataDir ? { dataDir: opt.dataDir } : {});
  if (!c.synced) return opt;
  const nums = new Set(); if (opt.companyNumber && /^\d{8,9}$/.test(String(opt.companyNumber).trim())) nums.add(String(opt.companyNumber).trim());
  for (const d of UD.normalizeAll(opt.userDocs || []).docs) for (const x of UD.numbersOf(d)) nums.add(x);
  const missing = [...nums].filter((x) => !c.idx.companies.byNumber.has(x) && !c.idx.partnerships.byNumber.has(x));
  if (!missing.length) return opt;
  let live = new Map(); try { live = await LIVE.lookup(missing, { fetchJson: opt.liveFetchJson, now: opt.now }); } catch { live = new Map(); }
  return { ...opt, live };
}
function ctx(opt = {}) {
  const L = Q.load();
  const c = overlay(D.load(opt.dataDir ? { dataDir: opt.dataDir } : {}), opt.live);
  const lotIdx = D.lotIndex(L.landById.values(), L.stamp);
  return { L, c, lotIdx, now: opt.now || new Date().toISOString() };
}
const lotsOf = (L, devId) => [...L.projById.values()].filter((p) => p.kind === 'ila-awarded-lot' && p.developerId === devId);
const light = (res) => ({ identity: { resolution: { state: res.state, chosen: res.chosen ? R.companyFacts(res.chosen) : null } } });

/* the reference distribution for execution velocity: the same rule over every awarded lot (registry stage evidence; Tel Aviv
   lots also through their STRONG site / permit links) — memoised per data stamp */
let VEL_MEMO = null;
function velocityReference(K) {
  const key = `${K.L.stamp}|${K.c.stamp}`; if (VEL_MEMO && VEL_MEMO.key === key) return VEL_MEMO.v;
  const months = [];
  const resCache = new Map();
  for (const p of K.L.projById.values()) {
    if (p.kind !== 'ila-awarded-lot' || !p.decisionDate) continue;
    let ladder;
    if (String(p.localityCode) === '5000') { let lt = resCache.get(p.developerId); if (!lt) { const dv = K.L.devById.get(p.developerId); lt = light(dv ? R.resolveCompany({ id: dv.id, canonical: dv.canonical, kind: dv.kind, joint: dv.joint }, K.c.idx) : { state: 'UNRESOLVED', chosen: null }); resCache.set(p.developerId, lt); } ladder = PRJ.ladderOf(p, PRJ.sitesOf(p, K.c, { devDD: lt, lotIdx: K.lotIdx })); }
    else ladder = { rungs: PRJ.baseLadderOf(p).rungs };
    const r = ladder.rungs.find((x) => x.stage === 'construction-started'); if (!r || !r.date) continue;
    const m = DEV.monthsBetween(p.decisionDate, r.date); if (m != null) months.push(m);
  }
  months.sort((a, b) => a - b);
  const n = months.length, med = n ? (n % 2 ? months[(n - 1) / 2] : Math.round(((months[n / 2 - 1] + months[n / 2]) / 2) * 10) / 10) : null;
  VEL_MEMO = { key, v: { n, medianMonths: med } }; return VEL_MEMO.v;
}
function developerRead(d, K, opt = {}) {
  const res = R.resolveCompany({ id: d.id, canonical: d.canonical || d.name, kind: d.kind, joint: d.joint, companyId: d.companyId }, K.c.idx, { companyNumber: opt.companyNumber, confirmedCandidate: opt.confirmedCandidate });
  const lt = light(res);
  const ladderOf = (s) => { const p = K.L.projById.get(s.id) || s; const S = PRJ.sitesOf(p, K.c, { devDD: lt, lotIdx: K.lotIdx }); return { sites: S, ladder: PRJ.ladderOf(p, S) }; };
  return DEV.developerDD(d, K.c, { now: K.now, companyNumber: opt.companyNumber, confirmedCandidate: opt.confirmedCandidate, lots: lotsOf(K.L, d.id), ladderOf, velocityReference: velocityReference(K) });
}
function status(opt = {}) {
  const c = D.load(opt.dataDir ? { dataDir: opt.dataDir } : {});
  return { version: VERSION, synced: c.synced, generatedAt: c.stamp, run: c.latest ? c.latest.run : null, freshness: c.freshness,
    counts: c.latest ? { companiesKept: c.latest.companies && c.latest.companies.kept, filings: c.latest.filings && c.latest.filings.kept, liquidationCases: c.latest.insolvency && c.latest.insolvency.liquidation.kept, contractors: c.latest.contractors && c.latest.contractors.counts.contractors, activeSites: c.latest.sites && c.latest.sites.counts.active, tlvPermits: c.latest.tlv && c.latest.tlv.permits.counts.rows, tlvSites: c.latest.tlv && c.latest.tlv.sites.counts.rows } : null,
    coverage: bi('רשומות רשם החברות נשמרות רק לחברות שנפתרות משמות היזמים ולקבלנים הרשומים — לא כל המאגר; היתרים: תל אביב-יפו בלבד', 'Registrar rows are kept only for companies that resolve from developer names and for registered contractors — not the whole registry; permits: Tel Aviv-Yafo only') };
}

const liveOf = (opt) => (opt.live && opt.live.size ? [...opt.live.values()].map((r) => ({ number: r.number, checkedAt: r.checkedAt, found: !!r.company, answered: r.answered, statement: LIVE.statementOf(r) })) : []);
/* the user's documents (USER DOCUMENT): validated here whatever the page sent — rejected ones are said, never used */
function userDocsOf(opt) { const r = UD.normalizeAll(opt.userDocs || [], { today: String(opt.now || new Date().toISOString()).slice(0, 10) }); return r; }
const companyNumberOf = (D) => (D && D.identity && D.identity.resolution && D.identity.resolution.chosen ? String(D.identity.resolution.chosen.number) : null);
function premiumDeveloper(dd, K, docs) {
  const num = companyNumberOf(dd);
  const financial = FIN.profile({ statements: FIN.statementsFromDocs(docs, num), entityNumber: num, companyType: dd.financial ? dd.financial.cls : null });
  return { financial, structure: STR.structure({ companyNumbers: num ? [num] : [], developerDD: dd, userDocs: docs, index: K.c.idx }), legal: LEG.legalExposure({ companyNumber: num, corporate: dd.corporate, cache: K.c, userDocs: docs }) };
}
function developer(id, opt = {}) {
  const d = Q.developer(id); if (!d) return null;
  const K = ctx(opt);
  const dd = developerRead(d, K, opt);
  const U = userDocsOf(opt), premium = premiumDeveloper(dd, K, U.docs);
  const out = { kind: 'developer', version: VERSION, id, name: d.name, dd, premium, userDocs: { used: U.docs.filter((x) => UD.concerning([x], { companyNumbers: [companyNumberOf(dd)] }).length).map((x) => x.id), rejected: U.rejected },
    brief: BR.brief({ developer: dd, premium }), nextBest: BR.nextBestEvidence({ developer: dd, premium }), watch: W.watchContract({ developer: dd, cache: K.c, since: opt.since || null }), evidence: EV.graph({ developer: dd }), status: status(opt) };
  out.live = liveOf(opt);
  out.summary = SUM.summarize(out);
  return out;
}

function project(id, opt = {}) {
  const p = Q.project(id); if (!p) return null;
  const K = ctx(opt);
  const devId = p.developerId || (p.developerIds || [])[0] || null;
  const d = devId ? Q.developer(devId) : null;
  const devDD = d ? developerRead(d, K, opt) : null;
  const dd = PRJ.projectDD(p, K.c, { now: K.now, developerDD: devDD, lotIdx: K.lotIdx });
  const others = (p.developerIds || []).slice(1).map((x) => { const o = Q.developer(x); if (!o) return null; const r = R.resolveCompany({ id: o.id, canonical: o.canonical, kind: o.kind, joint: o.joint }, K.c.idx); return { id: o.id, name: o.name, state: r.state, company: r.chosen ? R.companyFacts(r.chosen) : null }; }).filter(Boolean);
  const U = userDocsOf(opt), docs = U.docs;
  const pco = PCO.projectCompany({ project: p, projectDD: dd, developerDD: devDD, userDocs: docs, index: K.c.idx });
  const devNum = companyNumberOf(devDD), pcNum = pco.company ? pco.company.number : null;
  /* the statements read: the project company's when the user provided them, else the developer company's — labelled as such
     (developer / public-company financials ≠ project SPV financials); legal exposure: the project company, else the developer */
  const finNum = pcNum && FIN.statementsFromDocs(docs, pcNum).length ? pcNum : devNum, legalNum = pcNum || devNum;
  const loc = K.c.localityByCode.get(String(p.localityCode));
  /* the project company's own corporate record when it is not the developer's company (by number; a live row is labelled) */
  const pcRow = pcNum && pcNum !== devNum ? (K.c.idx.companies.byNumber.get(pcNum) || K.c.idx.partnerships.byNumber.get(pcNum)) : null;
  const pcCorporate = pcRow ? DEV.corporateOf({ chosen: pcRow, state: 'VERIFIED' }, K.c, K.now) : null;
  const premium = { projectCompany: pco, projectCompanyRecord: pcCorporate ? { company: R.companyFacts(pcRow), corporate: pcCorporate, liveRead: !!pcRow.live } : null,
    financial: FIN.profile({ statements: FIN.statementsFromDocs(docs, finNum), entityNumber: finNum, companyType: devDD && devDD.financial ? devDD.financial.cls : null, projectCompanyNumber: pcNum, projectRead: true }),
    structure: STR.structure({ companyNumbers: [devNum, pcNum].filter(Boolean), developerDD: devDD, userDocs: docs, index: K.c.idx }),
    legal: LEG.legalExposure({ companyNumber: legalNum, corporate: legalNum === devNum && devDD ? devDD.corporate : pcCorporate, cache: K.c, userDocs: docs }),
    sales: SAL.salesProgress({ project: p, userDocs: docs }),
    coverage: COV.forProject({ project: p, projectDD: dd, districtName: loc && loc.district ? loc.district : null }) };
  const out = { kind: 'project', version: VERSION, id, dd, devDD, premium, userDocs: { used: UD.concerning(docs, { projectId: p.id, companyNumbers: [devNum, pcNum].filter(Boolean) }).map((x) => x.id), rejected: U.rejected }, developer: devDD ? { id: devId, name: d.name, summary: { resolution: devDD.identity.resolution.state, companyId: devDD.identity.companyId, financial: devDD.financial.cls, signals: devDD.signals.map((s) => s.id) } } : null, otherDevelopers: others,
    brief: BR.brief({ project: dd, developer: devDD, premium }), nextBest: BR.nextBestEvidence({ project: dd, developer: devDD, premium }), watch: W.watchContract({ project: dd, developer: devDD, cache: K.c, since: opt.since || null }), evidence: EV.graph({ project: dd, developer: devDD }), status: status(opt) };
  out.live = liveOf(opt);
  out.summary = SUM.summarize(out);
  delete out.devDD;
  return out;
}
/** the municipal permit connectors + the execution coverage map of a locality */
function coverage(localityCode) { return { connectors: PC.summary(), locality: localityCode != null ? COV.forLocality(localityCode) : null }; }

/* ---- the LEGAL COMPANY read ------------------------------------------------------------------------------------------ */
let RES_MEMO = null;
function resolutionsByNumber(K) {
  const key = `${K.L.stamp}|${K.c.stamp}`; if (RES_MEMO && RES_MEMO.key === key) return RES_MEMO.map;
  const m = new Map(); const add = (num, x) => { const k = String(num); if (!m.has(k)) m.set(k, []); m.get(k).push(x); };
  for (const dv of K.L.devById.values()) {
    const r = R.resolveCompany({ id: dv.id, canonical: dv.canonical, kind: dv.kind, joint: dv.joint }, K.c.idx);
    if (r.chosen) add(r.chosen.num, { id: dv.id, name: dv.canonical, state: r.state, basis: r.basis });
    else for (const c of r.candidates || []) add(c.num, { id: dv.id, name: dv.canonical, state: r.state, basis: r.basis, candidate: true });
    for (const pt of r.parties || []) if (pt.chosen) add(pt.chosen.num, { id: dv.id, name: dv.canonical, state: pt.state, basis: pt.basis, party: pt.name });
  }
  RES_MEMO = { key, map: m }; return m;
}
function company(number, opt = {}) {
  const K = ctx(opt);
  let num = number != null ? String(number).trim() : null;
  if (!num && opt.kablan) { const rows = K.c.cidx.byKablan.get(String(opt.kablan)) || []; num = rows[0] && rows[0].company ? rows[0].company : null;
    if (!num) return rows.length ? { kind: 'contractor', version: VERSION, kablan: String(opt.kablan), name: rows[0].name, company: null, note: bi('קבלן ללא מספר ישות בפנקס (יחיד / רשומה ישנה) — אין חברה רשומה לצרף', 'a contractor without an entity number in the register (an individual / an older row) — no legal company to join'), branches: rows, sites: (K.c.sitesByExecutor.get(String(opt.kablan)) || []).slice(0, 60) } : null; }
  if (!num || !/^\d{8,9}$/.test(num)) return null;
  const row = K.c.idx.companies.byNumber.get(num) || K.c.idx.partnerships.byNumber.get(num);
  if (!row) return { kind: 'company', version: VERSION, number: num, inCoverage: false, note: bi('המספר אינו בין החברות ש-PROPX שומרת (אלה שנפתרות משמות יזמים ואלה הרשומות כקבלנים) — אינו אומר דבר על החברה', 'the number is not among the companies PROPX keeps (those resolving from developer names and registered contractors) — this says nothing about the company'), status: status(opt) };
  const facts = R.companyFacts(row);
  const devs = resolutionsByNumber(K).get(num) || [];
  const corp = DEV.corporateOf({ chosen: row, state: 'VERIFIED' }, K.c, K.now);
  const contractorRows = K.c.cidx.byCompany.get(num) || [];
  const kablans = [...new Set(contractorRows.map((r) => r.kablan))];
  const sites = kablans.flatMap((k) => K.c.sitesByExecutor.get(String(k)) || []);
  const holderSites = K.c.tlvHoldersByRegKey.get(R.regKey(row.name)) || [];
  return { kind: 'company', version: VERSION, number: num, inCoverage: true, company: facts, financial: DEV.financialOf({ chosen: row }),
    developers: devs.map((x) => ({ ...x, note: x.candidate ? bi('מועמד — לא נבחר', 'a candidate — not chosen') : x.party ? bi(`צד במחרוזת משותפת: ${x.party}`, `a party of a joint string: ${x.party}`) : null })),
    corporate: corp, contractor: { registered: contractorRows.length > 0, kablan: kablans, branches: contractorRows.map((r) => ({ kablan: r.kablan, branch: r.branch, group: r.group, sivug: r.sivug, hekef: r.hekef, recognized: r.recognized, registered: r.registered })), source: 'datagov:moch:contractors-register' },
    sites: { active: sites.length, list: sites.slice(0, 60).map((s) => ({ id: 'site:labor:' + s.workId, name: s.name, city: s.city, buildTypes: s.buildTypes, firstSeen: s.firstSeen, lastSeen: s.lastSeen, sanctions: s.sanctions, warrants: s.warrants })), source: 'datagov:labor:active-construction-sites' },
    tlvHolderSites: { matchState: holderSites.length ? 'STRONG_MATCH' : null, list: holderSites.slice(0, 40).map((s) => ({ id: 'site:tlv:' + s.tik, parcels: s.parcels, state: s.state, start: s.start, address: s.address, permits: s.permits })), coverage: DEV.COVERAGE.TLV_MUNICIPAL },
    watch: W.watchContract({ developer: { identity: { companyId: facts.id, resolution: { state: 'VERIFIED' } }, contractor: contractorRows.length ? { state: 'REGISTERED', kablan: kablans, via: { state: 'VERIFIED' }, sites: { list: [] } } : { state: 'NONE' } }, cache: K.c, since: opt.since || null }),
    hardTruths: DEV.HARD_TRUTHS, status: status(opt) };
}

/* ---- one Tel Aviv permit record --------------------------------------------------------------------------------------- */
/** the rows of ONE permit request: by the request number (the record id) — or, given only a permit number, the request(s)
    that carry it; a number that is a request AND a different request's permit number is never silently picked: the request
    wins only when typed as the record id (permit:tlv:<request> / "בקשה"), the permit only when typed as a permit ("היתר") */
function requestsOf(c, n, as = null) {
  const byReq = as === 'permit' ? [] : (c.tlvPermitsByRequest.get(n) || []);
  const byPermit = as === 'request' ? [] : (c.tlvPermitsByNumber.get(n) || []);
  const reqs = new Map();
  for (const r of byReq) reqs.set(String(r.request), { via: 'exact-request-number' });
  for (const r of byPermit) if (!reqs.has(String(r.request))) reqs.set(String(r.request), { via: 'exact-permit-number' });
  return [...reqs].map(([req, x]) => ({ request: req, via: x.via, rows: c.tlvPermitsByRequest.get(req) || [] })).filter((x) => x.rows.length);
}
function permit(id, opt = {}) {
  const K = ctx(opt);
  const raw = String(id || '').trim(); const asRecord = /^permit:tlv:/.test(raw);
  const n = raw.replace(/^permit:tlv:/, '').trim(); if (!/^\d{6,9}$/.test(n)) return null;
  const found = requestsOf(K.c, n, asRecord ? 'request' : null);
  if (!found.length) return null;
  if (found.length > 1 && !asRecord) return { kind: 'permit', version: VERSION, ambiguous: true, number: n, candidates: found.map((f) => ({ id: 'permit:tlv:' + f.request, via: f.via, stage: f.rows[0].stage, addresses: f.rows[0].addresses })), note: bi('המספר הוא מספר בקשה של רשומה אחת ומספר היתר של רשומה אחרת — לא נבחר', 'the number is one record\'s request number and another record\'s permit number — none picked'), status: status(opt) };
  const rows = found[0].rows;
  /* the record's own facts over all its rows: dates = the earliest stated, permit numbers / stages all kept */
  const first = (f) => rows.map((r) => r[f]).filter(Boolean).sort()[0] || null;
  const pr = { ...rows[0], permitDate: first('permitDate'), start: first('start'), opened: first('opened'), permit: (rows.find((r) => r.permit) || {}).permit || null,
    permits: [...new Set(rows.map((r) => r.permit).filter(Boolean))], stages: [...new Set(rows.map((r) => r.stage).filter(Boolean))], rowsCount: rows.length,
    /* units as each row states them — one value when the rows agree; several values are listed per row, never summed */
    unitsValues: [...new Set(rows.map((r) => r.units).filter((v) => v != null))] };
  pr.units = pr.unitsValues.length === 1 ? pr.unitsValues[0] : null;
  const files = [...new Set(rows.map((r) => r.file).filter(Boolean).map(String))];
  const sites = [...new Map([...(pr.permits.length ? [...K.c.tlvSitesByTik.values()].filter((s) => (s.permits || []).some((x) => pr.permits.includes(x))) : []), ...files.flatMap((f) => K.c.tlvSitesByFile.get(f) || [])].map((s) => [s.tik, s])).values()];
  const parcels = [...new Set(sites.flatMap((s) => s.parcels))];
  const dates = [pr.opened, pr.permitDate, pr.start].filter(Boolean);
  const lots = parcels.flatMap((k) => [...K.L.projById.values()].filter((p) => p.kind === 'ila-awarded-lot' && (p.parcels || []).some((x) => D.parcelKeyOf(typeof x === 'string' ? x : `${x.block}/${x.parcel}`) === k)).map((p) => ({ id: p.id, tender: p.tender, decisionDate: p.decisionDate, developerName: p.developerName, units: p.units, parcel: k,
    /* PRIOR_ACTIVITY only when the record states dates and every one of them precedes the award; no dates → SAME_PARCEL */
    relation: p.decisionDate && dates.length && dates.every((d) => d < String(p.decisionDate).slice(0, 10)) ? 'PRIOR_ACTIVITY' : 'SAME_PARCEL' })));
  return { kind: 'permit', version: VERSION, id: 'permit:tlv:' + pr.request, via: found[0].via, permit: pr, sites: sites.map((s) => ({ id: 'site:tlv:' + s.tik, parcels: s.parcels, state: s.state, start: s.start, holders: s.holderList, address: s.address })), parcels, lots,
    coverage: DEV.COVERAGE.TLV_MUNICIPAL, source: 'tlv:iview2:permits-772', note: bi('רשומת היתר עירונית של תל אביב-יפו; היתר ≠ תחילת בנייה ≠ גמר; מגרש על אותה חלקה ≠ אותו פרויקט', 'a Tel Aviv-Yafo municipal permit record; permit ≠ construction start ≠ completion; a lot on the same parcel ≠ the same project'), status: status(opt) };
}

/* ---- search hits ---------------------------------------------------------------------------------------------------- */
function searchHits(qRaw, opt = {}) {
  const q = String(qRaw || '').trim(); if (q.length < 2) return [];
  let c; try { c = D.load(opt.dataDir ? { dataDir: opt.dataDir } : {}); } catch { return []; }
  if (!c.synced) return [];
  const out = [];
  const coHit = (row, via) => { const f = R.companyFacts(row); out.push({ type: 'company', id: f.id, label: f.name, sub: [`ח.פ. ${f.number}`, f.status.verbatim, f.type].filter(Boolean).join(' · '), meta: { number: f.number, status: f.status.cls, type: f.type, entity: 'LEGAL_COMPANY' }, route: { section: 'intel', company: f.number }, via }); };
  const digits = q.replace(/[\s\-]/g, '');
  /* exact keys */
  let m = /^(?:ח\.?פ\.?|חפ|company|co:)?\s*(5\d{8})$/i.exec(digits);
  if (m) { const row = c.idx.companies.byNumber.get(m[1]) || c.idx.partnerships.byNumber.get(m[1]); if (row) coHit(row, 'exact-company-number'); else out.push({ type: 'company', id: 'co:' + m[1], label: `ח.פ. ${m[1]}`, sub: 'לא בכיסוי PROPX — אינו אומר דבר על החברה', meta: { number: m[1], inCoverage: false, entity: 'LEGAL_COMPANY' }, route: { section: 'intel', company: m[1] }, via: 'exact-company-number' }); }
  m = /^(?:קבלן|contractor|kablan)[\s:]*(\d{2,6})$/i.exec(q.replace(/\s+/g, ' ').trim());
  if (m) { const rows = c.cidx.byKablan.get(m[1]) || []; if (rows.length) out.push({ type: 'contractor', id: 'kablan:' + m[1], label: rows[0].name || `קבלן ${m[1]}`, sub: `קבלן רשום ${m[1]} · ${rows.length} ענפים${rows[0].company ? ` · ח.פ. ${rows[0].company}` : ''}`, meta: { kablan: m[1], company: rows[0].company || null, entity: 'CONTRACTOR' }, route: { section: 'intel', company: rows[0].company || null, kablan: m[1] }, via: 'exact-contractor-number' }); }
  /* a typed prefix says which number it is ("היתר" / permit = a permit number, "בקשה" / request = a request number); a bare
     number returns EVERY record it identifies (as a request and as a permit), each hit saying by which — never one picked */
  m = /^(היתר|בקשה|permit|request)?[\s:]*(\d{8})$/i.exec(q.replace(/\s+/g, ' ').trim());
  if (m) { const as = /^(היתר|permit)$/i.test(m[1] || '') ? 'permit' : /^(בקשה|request)$/i.test(m[1] || '') ? 'request' : null;
    for (const f of requestsOf(c, m[2], as)) { const pr = f.rows[0]; const permits = [...new Set(f.rows.map((r) => r.permit).filter(Boolean))];
      out.push({ type: 'permit', id: 'permit:tlv:' + f.request, label: `בקשה ${f.request}${permits.length ? ` (היתר ${permits.join(', ')})` : ''}`, sub: ['תל אביב-יפו', pr.stage, pr.addresses, f.via === 'exact-permit-number' ? `לפי מספר היתר ${m[2]}` : 'לפי מספר בקשה'].filter(Boolean).join(' · '), meta: { request: Number(f.request), permit: permits[0] || null, permits, stage: pr.stage, entity: 'PERMIT_RECORD', coverage: 'TEL AVIV MUNICIPAL' }, route: { section: 'intel', permit: 'permit:tlv:' + f.request }, via: f.via }); } }
  /* a project id as PROPX prints it (moch:<ProjectID> / ila:<MichrazID>:<lot>) or an exact ILA lot-file id (TikID) → that project */
  try {
    const L = Q.load(); const qq = q.replace(/\s+/g, '');
    const projHit = (p, via) => out.push({ type: 'project', id: p.id, label: p.kind === 'ila-awarded-lot' ? `מגרש ${p.lotId} · מכרז ${p.tender || p.michrazId}` : (p.name || `פרויקט ${p.projectId}`), sub: [p.city || null, p.developerName || null].filter(Boolean).join(' · '), route: { section: 'intel', project: p.id }, via });
    if (/^(moch|ila):/i.test(qq)) { const p = L.projById.get(qq.toLowerCase().replace(/^ila:/, 'ila:').replace(/^moch:/, 'moch:')); if (p) projHit(p, 'exact-project-id'); }
    else if (/^\d{10,13}$/.test(qq)) { const want = qq.padStart(13, '0'); for (const p of L.projById.values()) if (p.kind === 'ila-awarded-lot' && p.lotId === want) projHit(p, 'exact-lot-file-id'); }
  } catch { /* the registry is not loadable here */ }
  /* legal company names (substring of the normalized key, every token) — never merged with the developer (brand) hits */
  const toks = R.regKey(q).split(' ').filter((t) => t.length > 1 && !/^(בעמ|בע|ltd)$/.test(t));
  if (toks.length && !/^\d+$/.test(digits)) {
    const hits = [];
    for (const [k, rows] of c.idx.companies.byRegKey) if (toks.every((t) => k.includes(t))) for (const r of rows) hits.push(r);
    /* order: the name starting with the first word, then an active registry status before any other, then the name — an
       order only, never a selection (every hit is its own company) */
    const active = (r) => (R.statusClassOf(r.status, r.sub).cls === 'ACTIVE' ? 0 : 1);
    hits.sort((a, b) => (R.regKey(a.name).startsWith(toks[0]) ? 0 : 1) - (R.regKey(b.name).startsWith(toks[0]) ? 0 : 1) || active(a) - active(b) || String(a.name).localeCompare(String(b.name), 'he'));
    for (const r of hits.slice(0, 6)) coHit(r, 'legal-name-substring');
  }
  return out;
}

module.exports = { VERSION, developer, project, company, permit, searchHits, status, coverage, prepare, overlay };
