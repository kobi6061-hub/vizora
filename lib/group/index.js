// PROPX · SPONSOR X-RAY — DEVELOPER GROUP INTELLIGENCE (19.10.2026). "Show me the entire real-estate group": one institutional read of
// the group behind a developer brand, a legal company (company number), a project or an SPV — composed ONLY from the read models
// PROPX already has (lib/entities registry, lib/dd resolution / ladder / project company / financial / legal, lib/land lineage) and the
// user's own documents (class USER_DOCUMENT, used for that read only, never stored). Additive: nothing it reads is rewritten.
//
//   group({ developer | company | project }, opt)  →  { kind:'group', version, anchor, identity, firstRead, oneMinute, top, portfolio,
//        shared, stages, load, history, signals, geography, programme, land, financial, pipelineVsFinancial, spv, structure, legal,
//        timeline, matrix, brief, nextBest, deep, truths, coverage, freshness }
//   opt: { now, companyNumber (USER-PROVIDED key for a developer anchor), confirmedCandidate, userDocs, live }
//
// Group totals come from CORE + DOCUMENTED rows only, each project once, per universe (ILA lots ≠ MoCH lottery projects); SHARED
// (joint-award) and POSSIBLE / AMBIGUOUS members are shown apart and never added. No group score, no probability, no recommendation.
'use strict';

const DD = require('../dd');
const { cohort } = require('./cohort');
const { membership, NOT } = require('./identity');
const P = require('./portfolio');
const F = require('./finance');
const B = require('./brief');
const { VERSION, bi, TIERS, STATUS, STRUCTURE, TRUTHS, RULES, STAGE_BUCKETS, UNIVERSE } = require('./model');

const nodeOut = (n) => { const { company, ...rest } = n; return company ? { ...rest, number: company.number, status: company.status ? { cls: company.status.cls, verbatim: company.status.verbatim, label: company.status.label } : null, type: company.type || null } : rest; };
const rowOut = (r) => { const { _f, ...rest } = r; return rest; };

/** the anchor from the query: developer (+ a user key) · company · project */
function anchorOf(q) {
  if (q.developer) return { type: 'developer', id: String(q.developer) };
  if (q.project) return { type: 'project', id: String(q.project) };
  if (q.company) return { type: 'company', id: String(q.company).trim() };
  return null;
}

function group(q = {}, opt = {}) {
  const anchor = anchorOf(q); if (!anchor) return null;
  const K = DD.ctx(opt);
  const C = cohort(K);
  const resMap = DD.resolutionsByNumber(K);
  const U = DD.userDocsOf(opt); const docs = U.docs;
  const today = String(K.now).slice(0, 10);
  const M = membership(anchor, K, resMap, { companyNumber: anchor.type === 'developer' ? opt.companyNumber : undefined, confirmedCandidate: !!opt.confirmedCandidate, docs, resByDev: C.resByDev });
  if (!M) return null;
  const rows = P.rowsOf(M, K, C, { userDocs: docs, today, anchorRes: M.anchorRes && M.anchorRes.userProvided ? M.anchorRes : null });
  const stages = P.stagesOf(rows);
  const load = { ...P.loadOf(rows, C, today), consAsOf: C.consAsOf };
  const history = P.historyOf(rows, C);
  const activity = P.activityOf(rows, today);
  const geography = P.geographyOf(rows, today);
  const programme = P.programmeOf(rows);
  const land = P.landOf(rows, K, today);
  const matrix = P.matrixOf(rows);
  const signals = P.signalsOf({ rows, C, load, history, geo: geography, activity, today });
  const financial = F.financialOf({ M, docs, K });
  const pvf = F.pipelineVsFinancial({ load, land, fin: financial, activity });
  const spv = B.spvOf(rows);
  const legal = B.legalOf({ M, K, docs, fin: financial, now: K.now });
  const timeline = B.groupTimeline(P.projectEventsOf(rows, geography), legal, financial, today);
  const brief = B.briefOf({ M, rows, stages, load, signals, fin: financial, legal, geo: geography, spv });
  const nextBest = B.nextBestOf({ M, rows, load, fin: financial, spv });
  const H = B.headlinesOf({ M, rows, stages, load, history, signals, geo: geography, programme, land, fin: financial, legal, spv, nbe: nextBest, today });
  const inT = rows.filter(P.inTotals), shared = rows.filter((r) => r.tier === 'SHARED');
  const members = [...M.brands.values()].map((b) => ({ devId: b.dev.id, name: b.dev.name, tier: b.tier, state: b.state, via: b.via, companyNumber: b.companyNumber, role: b.role || null, inTotals: TIERS[b.tier].inTotals, lots: b.dev.tenders ? b.dev.tenders.lots : 0, lotteryProjects: b.dev.lotteries ? b.dev.lotteries.projects : 0 }));
  const sourcesUsed = [...new Set(['rmi:michrazim', 'datagov:moch:dira-behanacha-lotteries', 'datagov:ica:companies', 'datagov:ica:changes', 'datagov:moj:official-receiver:liquidation', 'datagov:moch:contractors-register', 'datagov:labor:active-construction-sites', 'tlv:iview2:sites-499', 'tlv:iview2:permits-772', 'datagov:moch:construction-progress'].concat(docs.length ? ['user-document'] : []))];
  const out = {
    kind: 'group', version: VERSION, generatedAt: K.now, generatedFor: today,
    name: bi('מודיעין קבוצת יזם', 'DEVELOPER GROUP INTELLIGENCE'), product: 'SPONSOR X-RAY',
    promise: bi('לראות את היזם שמאחורי הפרויקטים — החברות, ה-SPV, הצנרת, הביצוע, המינוף, החשיפות ופערי הראיות, בתצוגה מוסדית אחת.', 'See the developer behind the projects — the companies, SPVs, pipeline, execution, leverage, exposures and evidence gaps in one institutional view.'),
    anchor: M.anchor, otherDevelopers: M.otherDevelopers,
    identity: { status: M.status, statusLabel: STATUS[M.status], structure: M.structure, structureLabel: STRUCTURE[M.structure], core: M.core ? { number: M.core.number, company: M.core.company, state: M.core.state, linkState: M.core.linkState || null, basis: M.core.basis || null, userProvided: !!M.core.userProvided } : null,
      members, excluded: M.excluded, shared: M.shared, companies: [...M.companies.values()].map((c) => ({ number: c.number, name: c.company ? c.company.name : null, tier: c.tier, role: c.role, state: c.state, path: c.path, publicPrivate: F.publicPrivateOf(c.company) })),
      contractor: M.contractor, tiers: M.tiers, tierDefs: TIERS, notes: M.notes,
      rule: bi('ליבה = כתיבי מותג שנפתרים לאותה חברה משפטית; קשור = חברה שמסמך משתמש קושר, כששני הצדדים נמצאו ברשם; זכייה משותפת, אפשרי ורב-משמעי — מוצגים ולעולם לא נספרים', 'CORE = brand spellings resolving to one legal company; DOCUMENTED = a company a user document relates, both parties found in the registry; SHARED, POSSIBLE and AMBIGUOUS — shown, never counted') },
    firstRead: H.firstRead, oneMinute: H.oneMinute, top: H.top,
    portfolio: { rows: inT.map(rowOut), total: inT.length, districts: Object.fromEntries([...new Set(rows.map((r) => r.district).filter(Boolean))].map((d) => [d, P.districtLabel(d)])), byUniverse: { ila: inT.filter((r) => r.universe === 'ila').length, moch: inT.filter((r) => r.universe === 'moch').length }, universes: UNIVERSE, qualityReasons: P.QUALITY_REASONS,
      basis: bi('כל פרויקט פעם אחת (מזהה הרשומה); פרויקט שמגיע דרך שני מותגים בקבוצה — שורה אחת; לעולם לא צירוף בין מקורות בלי מפתח', 'every project once (its record id); a project reached through two group brands — one row; never a join across sources without a key') },
    shared: { rows: shared.map(rowOut), total: shared.length, note: TIERS.SHARED.d },
    stages, load, history, activity, signals, geography, programme, land, matrix,
    financial, pipelineVsFinancial: pvf, spv,
    structure: { nodes: [...M.nodes.values()].map(nodeOut), edges: M.edges.map(({ notProves, ...e }) => ({ ...e, notProvesKey: e.type })), notProves: NOT, docEdges: M.docEdges.length, statement: STRUCTURE[M.structure], rules: [bi('אותו מותג / כתובת / דירקטור / קבלן / חלקה ≠ בעלות או שליטה', 'SAME BRAND / ADDRESS / DIRECTOR / CONTRACTOR / PARCEL ≠ OWNERSHIP OR CONTROL'), bi('חברת אם ≠ ערב', 'PARENT ≠ GUARANTOR'), bi('חברה בת ≠ SPV', 'SUBSIDIARY ≠ SPV'), bi('קשר אפשרי ≠ שליטה קבוצתית', 'POSSIBLE RELATION ≠ GROUP CONTROL')] },
    legal, timeline, brief, nextBest,
    deep: {
      sources: sourcesUsed, comparables: { cohort: { start: C.start, early: C.early, unfinished: C.unfinished, completion: C.completion, load: C.load, consAsOf: C.consAsOf, records: C.facts.size } },
      formulas: ['group_identity_status', 'observed_portfolio', 'furthest_verified_stage', 'observed_execution_load', 'execution_duration', 'execution_cohort_comparison', 'group_geographic_concentration', 'programme_exposure', 'group_land_pipeline', 'understanding_leverage', 'financial_change_view', 'pipeline_vs_financial_position', 'spv_exposure', 'row_evidence_quality'],
      rawRefs: { ila: inT.filter((r) => r.universe === 'ila').map((r) => ({ id: r.id, tenderId: r.tenderId, lotId: r.lotId })), moch: inT.filter((r) => r.universe === 'moch').map((r) => r.id) },
      rules: RULES, buckets: STAGE_BUCKETS,
      methodology: bi('קריאה דטרמיניסטית של המודלים הקיימים: זהות (lib/entities/resolve.js), סולם השלבים וחברת הפרויקט (lib/dd), שושלת מגרשים (lib/land/lineage.js), השוואה לאותו כלל על כל המגרשים (הקבוצה הלאומית); ללא ציון, ללא הסתברות', 'a deterministic read of the existing models: identity (lib/entities/resolve.js), the stage ladder and the project company (lib/dd), lot lineage (lib/land/lineage.js), comparison by the same rule over every lot (the national cohort); no score, no probability') },
    userDocs: { used: docs.length, rejected: U.rejected },
    truths: TRUTHS,
    coverage: { ila: bi('מגרשים שנזכו של מכרזים שפרטיהם נקראו', 'awarded lots of detail-read tenders'), moch: bi('הגרלות דירה בהנחה', 'subsidized-housing lotteries'), permits: bi('תל אביב-יפו בלבד', 'Tel Aviv-Yafo only'), construction: bi(`דיווחי משב״ש עד ${C.consAsOf} + אתרי משרד העבודה (ללא תאריכים)`, `MoCH progress rows to ${C.consAsOf} + Ministry of Labour sites (undated)`), ownership: bi('מסמכי משתמש בלבד', 'user documents only'), financials: bi('מסמכי משתמש בלבד', 'user documents only') },
    freshness: { registry: K.L.stamp ? K.L.today : null, dd: K.c.freshness, cohortBuiltFor: C.today },
    basis: bi('פעילות שנצפתה ב-PROPX — מה שהמקורות הציבוריים מראים; לא מאגר קרקעות, לא צנרת כוללת, לא נתח שוק; ללא ציון קבוצתי', 'OBSERVED PROPX ACTIVITY — what the public sources show; never a land bank, a total pipeline or a market share; no group score'),
  };
  return out;
}

module.exports = { group, anchorOf, VERSION };
