// PROPX · DEVELOPER DUE DILIGENCE (18.10.2026) — one institutional read of a developer entity's LEGAL IDENTITY, CORPORATE
// RECORD, FINANCIAL-DATA COVERAGE, CONTRACTOR REGISTRATION, CONSTRUCTION-SITE EVIDENCE and EXECUTION RECORD, as a pure
// module over the registry's developer answer (lib/entities/query.js developer(id)) and the due-diligence rows
// (lib/dd/data.js). Additive beside Developer Intelligence 2.0 — nothing there changes.
//
//   developerDD(d, cache, { now })  →  { version, identity, corporate, financial, contractor, permits, execution, signals,
//                                        missing, hardTruths, coverage, freshness, basis }
//
// Every fact names its source, class, period and coverage label. Nothing is a score, a probability or a judgement:
// a CHARGE is collateral (never distress); a BREACH FLAG is a filing-duty fact (never insolvency); VOLUNTARY LIQUIDATION
// is a shareholder decision (never a court insolvency); an ACTIVE SITE is a registration under safety supervision (never
// completed units); PUBLIC FINANCIAL DATA is NOT AVAILABLE IN CURRENT COVERAGE for every company, so a private developer
// is never penalized for being private. The observed name ≠ the legal company ≠ a project SPV ≠ a parent.
'use strict';

const R = require('../entities/resolve');
const { canonicalName } = require('../entities/names');

const VERSION = Object.freeze({ id: 'propx-developer-dd-v1', effective: '2026-10-18' });
const bi = (he, en) => ({ he, en });
const day = (v) => (v ? String(v).slice(0, 10) : null);
const MS_DAY = 86400000;
const monthsBetween = (a, b) => (a && b ? Math.round(((Date.parse(b) - Date.parse(a)) / (MS_DAY * 30.4375)) * 10) / 10 : null);
const SRC = R.SRC;
const COVERAGE = Object.freeze({
  DEVELOPER_LEVEL: bi('רמת היזם (החברה הרשומה שנפתרה)', 'DEVELOPER LEVEL (the resolved legal company)'),
  CONTRACTOR_LEVEL: bi('רמת הקבלן המבצע (רישום באתרים)', 'CONTRACTOR LEVEL (site registrations)'),
  NATIONAL: bi('כיסוי ארצי', 'NATIONAL COVERAGE'),
  TLV_MUNICIPAL: bi('כיסוי עירוני — תל אביב-יפו בלבד', 'TEL AVIV MUNICIPAL COVERAGE'),
  PROJECT_LEVEL: bi('רמת הפרויקט', 'PROJECT LEVEL'),
  HISTORICAL: bi('היסטורי', 'HISTORICAL'),
  STALE: bi('לא עדכני', 'STALE'),
  PARTIAL: bi('חלקי', 'PARTIAL'),
  NONE: bi('אין כיסוי', 'NO COVERAGE'),
});
const HARD_TRUTHS = Object.freeze([
  bi('שם היזם ≠ החברה הרשומה: השם שנצפה נפתר לחברה — הוא אינו החברה', 'DEVELOPER NAME ≠ LEGAL COMPANY: the observed name resolves to a company — it is not the company'),
  bi('מותג יזם ≠ חברת פרויקט (SPV): שעבודים והליכים של החברה שנפתרה אינם של חברת הפרויקט, ולהפך', 'DEVELOPER BRAND ≠ PROJECT SPV: the resolved company\'s charges and proceedings are not the project company\'s, nor the reverse'),
  bi('חברת אם ≠ ערב לפרויקט: חוזק קבוצתי אינו תמיכה בפרויקט', 'PARENT COMPANY ≠ PROJECT GUARANTOR: group strength is not project support'),
  bi('שעבוד ≠ מצוקה: שעבוד הוא בטוחה למימון', 'CHARGE ≠ DISTRESS: a charge is financing collateral'),
  bi('דגל הפרה ≠ חדלות פירעון: עובדת דיווח לפי הרשם', 'BREACH FLAG ≠ INSOLVENCY: a filing-duty fact per the Registrar'),
  bi('פירוק מרצון ≠ חדלות פירעון; רק צו בית משפט הוא הליך חדלות פירעון', 'VOLUNTARY LIQUIDATION ≠ INSOLVENCY; only a court order is an insolvency proceeding'),
  bi('אתר פעיל ≠ יח״ד שהושלמו; קבלן מבצע ≠ יזם', 'ACTIVE SITE ≠ COMPLETED UNITS; EXECUTING CONTRACTOR ≠ DEVELOPER'),
  bi('שתיקת מקור ≠ ראיה שלילית: "לא נצפה" ≠ "לא קיים"', 'SOURCE SILENCE ≠ NEGATIVE EVIDENCE: "not observed" ≠ "does not exist"'),
  bi('דוחות חברה ציבורית ≠ דוחות SPV; ובכל מקרה אינם בכיסוי', 'PUBLIC COMPANY FINANCIALS ≠ SPV FINANCIALS; and neither is in coverage'),
]);

/* ---- the corporate record of the resolved company ---------------------------------------------------------------- */
const KIND_CLASS = (k) => (/רישום שעבוד/.test(k) ? 'chargeRegistered' : /ביטול סילוק/.test(k) ? 'chargeRemovalCancelled' : /סילוק שעבוד/.test(k) ? 'chargeRemoved' : /עדכון שעבוד|שעבוד/.test(k) ? 'chargeUpdated' : /הפרה/.test(k) ? 'breachUpdate' : /דו.ח שנתי/.test(k) ? 'annualReport' : /בעלי תפקידים|דירקטור|מנהל/.test(k) ? 'officers' : /מניות|הון/.test(k) ? 'shares' : 'other');
function corporateOf(res, cache, now) {
  const row = res.chosen; if (!row) return { state: 'UNRESOLVED', reason: bi('אין חברה רשומה שנפתרה — אין רשומה תאגידית להציג', 'no resolved legal company — no corporate record to show'), coverage: COVERAGE.NONE };
  const num = String(row.num), F = cache.filingsByNum.get(num) || [], fil = cache.filings;
  const counts = {}; for (const r of F) counts[KIND_CLASS(r.kind)] = (counts[KIND_CLASS(r.kind)] || 0) + 1;
  const first = (cls) => F.find((r) => KIND_CLASS(r.kind) === cls) || null;
  const liq = cache.liquidationByNum.get(num) || [], vol = cache.voluntaryByNum.get(num) || [];
  const openLiq = liq.filter((c) => !c.closed);
  const facts = R.companyFacts(row);
  const statusEvents = (cache.historyByKey.get('co:' + num) || []).filter((e) => /company-status|breach-flag|annual-report-year/.test(e.event));
  const insolvencyStatement = openLiq.length ? bi(`הליך פירוק בבית משפט רשום (${openLiq.length}; הסטטוס לפי הכונס הרשמי)`, `a court liquidation proceeding is recorded (${openLiq.length}; status per the Official Receiver)`)
    : liq.length ? bi(`תיק פירוק היסטורי (${liq.length}, סגור)`, `a historical liquidation case (${liq.length}, closed)`)
    : vol.length ? bi('רשומה ברשימת הפירוק מרצון בהליך מזורז — החלטת בעלי מניות, לא הליך חדלות פירעון', 'listed for fast-track voluntary liquidation — a shareholder decision, not an insolvency proceeding')
    : cache.insolvency ? bi('לא נמצאה רשומה בקובץ החברות בפירוק של הכונס הרשמי ולא ברשימת הפירוק מרצון (לפי מספר החברה) — היעדר רשומה אינו ראיה לכושר פירעון', 'no row in the Official Receiver\'s company-liquidation file nor in the fast-track voluntary list (by company number) — the absence of a row is not evidence of solvency')
    : bi('קובץ הכונס הרשמי טרם סונכרן', 'the Official Receiver file is not synced yet');
  return { state: 'RESOLVED', company: facts, coverage: COVERAGE.DEVELOPER_LEVEL,
    registeredStatus: facts.status, breach: facts.violating, lastAnnualReportYear: facts.lastAnnualReportYear, incorporated: facts.incorporated,
    statusChanges: statusEvents.map((e) => ({ at: e.at, event: e.event, old: e.old, new: e.new })),
    filings: { source: SRC.icaChanges, cls: 'OFFICIAL', window: fil ? fil.window : null, checkedAt: fil ? fil.fetchedAt : null, total: F.length, counts,
      latest: F[0] ? { kind: F[0].kind, date: F[0].date } : null, lastChargeRegistered: first('chargeRegistered') ? first('chargeRegistered').date : null, lastChargeRemoved: first('chargeRemoved') ? first('chargeRemoved').date : null,
      events: F.slice(0, 60).map((r) => ({ date: r.date, kind: r.kind, cls: KIND_CLASS(r.kind), chargeId: r.chargeId })), truncated: Math.max(0, F.length - 60),
      interpretation: bi('שעבוד = בטוחה למימון (אין נושה, סכום או נכס במקור); חלון המקור מתגלגל — היעדר אירועים לפני תחילתו אינו היעדר שעבודים', 'a charge = financing collateral (no chargee, amount or asset in the source); the source window rolls — no events before its start is not no charges') },
    insolvency: { source: `${SRC.receiver} · ${SRC.volFast}`, cls: 'OFFICIAL', checkedAt: cache.insolvency ? cache.insolvency.fetchedAt : null, liquidationCases: liq.map((c) => ({ caseId: c.caseId, status: c.status, requested: c.requested, orderDate: c.orderDate, stayDate: c.stayDate, closed: c.closed, closeReason: c.closeReason, court: c.court, open: !c.closed })), voluntary: vol.map((v) => ({ status: v.status, sub: v.sub, approved: v.approved, expectedDissolution: v.expectedDissolution })), statement: insolvencyStatement },
    freshness: { registry: cache.freshness.companies, filings: cache.freshness.filings, insolvency: cache.freshness.insolvency } };
}

/* ---- financial-data coverage ------------------------------------------------------------------------------------- */
function financialOf(res) {
  const row = res.chosen; const cov = row ? R.financialCoverageOf(row.type) : { cls: 'UNKNOWN', label: bi('זהות החברה לא נפתרה — לא ניתן לסווג', 'the legal company is not resolved — cannot be classified'), statementsAvailable: false };
  return { cls: cov.cls, label: cov.label, statementsAvailable: false, basis: row ? bi('סוג התאגיד במאגר רשם החברות בלבד', 'the registry TYPE in the Registrar of Companies only') : bi('—', '—'), source: row ? SRC.ica : null, cls_: 'OFFICIAL',
    statement: bi('נתונים כספיים ציבוריים אינם זמינים בכיסוי הנוכחי — לכל חברה, פרטית או ציבורית (מאיה / מגנ״א חסומים ללקוח שאינו דפדפן; אין מאגר פתוח)', 'PUBLIC FINANCIAL DATA NOT AVAILABLE IN CURRENT COVERAGE — for every company, private or public (MAYA / MAGNA refuse a non-browser client; no open dataset)'),
    neverShown: ['revenue', 'equity', 'leverage', 'bond price', 'rating', 'PD estimate', 'solvency label'],
    limitations: [bi('חברה ציבורית לפי הרשם ≠ זמינות דוחות: גם כשדוחות קיימים הם מתארים את האם הנסחרת, לא SPV', 'public per the Registrar ≠ statements available: even where statements exist they describe the listed parent, never an SPV'), bi('חברה פרטית אינה "חלשה": "לא בכיסוי" הוא היגד על הנתונים, לא על החברה', 'a private company is not "weak": "not in coverage" is a statement about the data, not the company')] };
}

/* ---- contractor registration + construction sites ---------------------------------------------------------------- */
function contractorOf(d, res, cache, now) {
  const C = cache.cidx; if (!C.synced) return { state: 'NOT_SYNCED', coverage: COVERAGE.NONE, reason: bi('פנקס הקבלנים טרם סונכרן', 'the contractors register is not synced yet') };
  let rows = [], via = null;
  if (res.chosen && res.state !== 'AMBIGUOUS') { rows = C.byCompany.get(String(res.chosen.num)) || []; if (rows.length) via = { basis: 'company-number', state: R.weakest([res.state, 'VERIFIED']), reasons: [R.reason('COMPANY_NUMBER_FROM_SOURCE'), R.reason('EXACT_OFFICIAL_KEY_JOIN')] }; }
  if (!rows.length) { const byName = R.resolveByName(d.canonical || d.name, C.byRegKey, { entity: 'CONTRACTOR', source: SRC.contractors }); if (byName.state === 'STRONG_MATCH') { rows = byName.candidates; via = { basis: 'normalized-name', state: 'STRONG_MATCH', reasons: byName.reasons }; } else if (byName.state === 'AMBIGUOUS') return { state: 'AMBIGUOUS', coverage: COVERAGE.CONTRACTOR_LEVEL, resolution: byName, candidates: byName.candidates.map((r) => ({ kablan: r.kablan, name: r.name, company: r.company })), reason: bi('כמה קבלנים רשומים באותו שם מנורמל — לא נבחר', 'several registered contractors under the same normalized name — none picked') }; }
  if (!rows.length) return { state: 'NOT_REGISTERED_AS_OBSERVED', coverage: COVERAGE.CONTRACTOR_LEVEL, source: SRC.contractors, checkedAt: C.fetchedAt, sourceModified: C.sourceModified,
    reason: bi('לא נמצא בפנקס הקבלנים לפי מספר החברה שנפתר או לפי השם המנורמל — יזם אינו חייב להיות קבלן רשום; אתרים מבוצעים אז על ידי קבלן אחר', 'not found in the contractors register by the resolved company number or the normalized name — a developer need not be a registered contractor; its sites are then executed by another contractor') };
  const kablans = [...new Set(rows.map((r) => r.kablan))];
  const branches = rows.map((r) => ({ kablan: r.kablan, code: r.branchCode, branch: r.branch, group: r.group, sivug: r.sivug, sivugDate: r.sivugDate, hekef: r.hekef, recognized: r.recognized, registered: r.registered }));
  const active = kablans.flatMap((k) => cache.sitesByExecutor.get(String(k)) || []), gone = kablans.flatMap((k) => cache.goneByExecutor.get(String(k)) || []);
  const cities = new Map(); for (const s of active) { const key = s.city || '—'; const loc = s.city ? cache.localityByName.get(require('./data').cityKey(s.city)) : null; const cur = cities.get(key) || { name: s.city || null, code: loc ? loc.code : null, district: loc ? loc.district : null, n: 0 }; cur.n++; cities.set(key, cur); }
  const closed = cache.closedByRegKey.get(R.regKey(rows[0].name)) || [];
  return { state: 'REGISTERED', coverage: COVERAGE.CONTRACTOR_LEVEL, via, source: SRC.contractors, checkedAt: C.fetchedAt, sourceModified: C.sourceModified, kablan: kablans, branches,
    sites: { source: SRC.sites, cls: 'OFFICIAL', checkedAt: cache.freshness.sites ? cache.freshness.sites.checkedAt : null, active: active.length, withBuildTypeResidential: active.filter((s) => /מגורים/.test(s.buildTypes || '')).length, cities: [...cities.values()].sort((a, b) => b.n - a.n), firstSeen: active.map((s) => s.firstSeen).filter(Boolean).sort()[0] || null, lastSeen: active.map((s) => s.lastSeen).filter(Boolean).sort().pop() || null,
      enforcement: { sanctions: active.reduce((s, x) => s + (x.sanctions || 0), 0), warrants: active.reduce((s, x) => s + (x.warrants || 0), 0) }, noLongerListed: gone.length,
      list: active.slice(0, 40).map((s) => ({ id: 'site:labor:' + s.workId, name: s.name, city: s.city, buildTypes: s.buildTypes, cranes: s.cranes, firstSeen: s.firstSeen, lastSeen: s.lastSeen, parcel: (R.parseParcel(s.name) || {}).key || null, lot: R.parseLotNumber(s.name) })), truncated: Math.max(0, active.length - 40),
      interpretation: bi('אתר פעיל = רישום בפיקוח בטיחות של משרד העבודה; ללא תאריכי התחלה / גמר (התאריכים הם תצפיות PROPX); אינו יח״ד שהושלמו ואינו פרויקט מסוים אלא אם צוין צירוף', 'an active site = a Ministry of Labour safety-supervision registration; no start / completion dates (the dates are PROPX observations); not completed units and not a specific project unless a join is stated') },
    closedNotices: closed.map((c) => ({ name: c.name, from: c.from, interpretation: bi('סגירת אתר על ידי מינהל הבטיחות — אירוע אכיפה, לא כישלון פרויקט', 'a site closure by the safety administration — an enforcement event, not a project failure') })), closedBasis: closed.length ? bi('לפי שם הקבלן המנורמל בלבד (התאמה חזקה)', 'by the normalized contractor name only (STRONG MATCH)') : null };
}

/* ---- Tel Aviv permit holders (municipal coverage) ----------------------------------------------------------------- */
function permitsOf(d, cache) {
  if (!cache.tlv) return { state: 'NOT_SYNCED', coverage: COVERAGE.TLV_MUNICIPAL };
  const k = R.regKey(d.canonical || d.name); const sites = (cache.tlvHoldersByRegKey.get(k) || []);
  return { state: sites.length ? 'HOLDER_MATCHED' : 'NO_MATCH', coverage: COVERAGE.TLV_MUNICIPAL, source: SRC.tlvSites, cls: 'OFFICIAL', matchState: sites.length ? 'STRONG_MATCH' : null, matchBasis: sites.length ? bi('בעל ההיתר בשכבת אתרי הבנייה = השם המשפטי המנורמל (התאמה חזקה, לא מאומת)', 'the permit holder on the sites layer = the normalized legal name (STRONG MATCH, not VERIFIED)') : null,
    sites: sites.slice(0, 40).map((s) => ({ id: 'site:tlv:' + s.tik, parcel: s.parcel, parcelKey: (R.parseParcel(s.parcel) || {}).key || null, state: s.state, start: s.start, supervision: s.supervision, supervisionDate: s.supervisionDate, use: s.use, address: s.address, permits: s.permits, file: s.file })), total: sites.length,
    note: bi('תל אביב-יפו בלבד — היעדר התאמה כאן אינו אומר דבר על ערים אחרות', 'Tel Aviv-Yafo only — no match here says nothing about other cities') };
}

/* ---- execution record: the lots and projects PROPX observes, by their furthest evidenced stage — the DUE-DILIGENCE ladder
   (lib/dd/project.js: only STRONG / VERIFIED site and permit links move it) when the caller supplies it; execution velocity
   only from dated pairs (award → a dated construction start on a STRONG link), with its coverage and no peer comparison
   below a documented minimum */
const VELOCITY_MIN = 3;
function executionOf(d, cache, now, opt = {}) {
  const lots = opt.lots || d.sites || [], projects = d.projects || [];
  const stageOf = (x) => (typeof x.stage === 'string' ? x.stage : (x.stage && x.stage.furthest) || 'unknown');
  const by = {}, byBase = {}, pairs = [], linked = { strong: 0, possible: 0, lots: 0 };
  for (const s of lots) {
    const base = stageOf(s); byBase[base] = (byBase[base] || 0) + 1;
    const L = opt.ladderOf ? opt.ladderOf(s) : null; const st = L ? L.ladder.furthest || base : base; by[st] = (by[st] || 0) + 1;
    if (L) { const sl = L.sites; const strong = sl.tlv.filter((x) => x.onLadder).length + sl.labour.filter((x) => x.onLadder).length; const possible = sl.tlv.length + sl.labour.length - strong; if (strong) linked.lots++; linked.strong += strong; linked.possible += possible;
      const start = L.ladder.rungs.find((r) => r.stage === 'construction-started'); if (s.decisionDate && start && start.date) pairs.push({ id: s.id, award: s.decisionDate, start: start.date, months: monthsBetween(s.decisionDate, start.date), source: start.ddSource || start.source }); }
  }
  const byMoch = {}; for (const p of projects) { const st = stageOf(p); byMoch[st] = (byMoch[st] || 0) + 1; }
  const sorted = pairs.map((p) => p.months).filter((m) => m != null).sort((a, b) => a - b);
  const median = (xs) => (xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : Math.round(((xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2) * 10) / 10) : null);
  const ref = opt.velocityReference || null;
  const BASIS = bi('חודשים מהחלטת הזכייה לתחילת הבנייה המתוארכת הראשונה בסולם: דיווחי ההתקדמות של משב״ש (צירוף מדויק בגוש/חלקה; נעצרים ב-2024-03) או רשומת היתר / אתר בתל אביב בקישור חזק', 'months from the award decision to the first DATED construction start on the ladder: MoCH progress reports (exact block/parcel join; they stop at 2024-03) or a Tel Aviv permit / site record on a STRONG link');
  const velocity = pairs.length >= VELOCITY_MIN ? { measurable: true, pairs, medianMonths: median(sorted), n: pairs.length, basis: BASIS, coverage: COVERAGE.PARTIAL,
      comparison: ref && ref.n >= 30 ? { medianMonths: ref.medianMonths, n: ref.n, basis: bi('אותו כלל, אותם מקורות, על כל המגרשים שנזכו עם זוג מתוארך — השוואה מתועדת, לא דירוג', 'the same rule and sources over every awarded lot with a dated pair — a documented comparison, not a ranking') } : null,
      limitations: [bi('רק מגרשים עם תחילת בנייה מתוארכת נספרים — מגרשים שלא התחילו (או שלא דווחו) אינם בחישוב: הטיית בחירה', 'only lots with a DATED start count — lots not started (or not reported) are not in it: a selection bias'), bi('דיווחי משב״ש נעצרים ב-2024-03: זכיות מאוחרות כמעט אינן נכנסות', 'MoCH reports stop at 2024-03: later awards rarely enter'), bi('אינו מדד איכות ואינו השוואת ביצועים', 'not a quality measure and not a performance comparison')] }
    : { measurable: false, pairs, n: pairs.length, reason: bi(`פחות מ-${VELOCITY_MIN} זוגות מתוארכים (זכייה → תחילת בנייה מתוארכת): ${pairs.length} — מהירות ביצוע אינה נמדדת`, `fewer than ${VELOCITY_MIN} dated pairs (award → a dated construction start): ${pairs.length} — execution velocity is not measured`), basis: BASIS, coverage: COVERAGE.PARTIAL };
  return { source: `${SRC.ila} · ${SRC.moch} · ${SRC.tlvSites} · ${SRC.tlvPermits} · ${SRC.sites}`, cls: 'OBSERVED', awardedLots: lots.length, lotsByFurthestStage: by, lotsByRegistryStage: byBase, linkedSites: linked, lotteryProjects: projects.length, lotteryProjectsByStage: byMoch, velocity,
    basis: bi('שלב = הרונג הרחוק ביותר עם ראיה ישירה (רק קישור חזק מזיז); רונג חסר אינו שלב חסר — מחוץ לתל אביב אין מקור היתרים / התחלות ברמת הפרויקט', 'stage = the furthest rung with direct evidence (only a STRONG link moves it); a missing rung is not a missing stage — outside Tel Aviv there is no project-level permits / starts source'), coverage: COVERAGE.PROJECT_LEVEL };
}

/* ---- deterministic signals (descriptions with their rule; never a judgement) --------------------------------------- */
function signalsOf(X, now) {
  const S = []; const add = (id, kind, cls, source, text, data = {}) => S.push({ id, kind, cls, source, text, ...data });
  const res = X.identity.resolution, co = X.corporate;
  if (res.state === 'AMBIGUOUS') add('ENTITY_AMBIGUOUS', 'info', 'DERIVED', SRC.ica, bi(`${res.candidates.length} חברות רשומות באותו שם מנורמל — אף אחת לא נבחרה`, `${res.candidates.length} registered companies under the same normalized name — none picked`), { trigger: 'candidates > 1', value: res.candidates.length, threshold: '> 1' });
  if (res.state === 'UNRESOLVED' && X.identity.kind === 'company') add('ENTITY_UNRESOLVED', 'info', 'DERIVED', SRC.ica, bi('לא נמצאה חברה רשומה בשם זה', 'no registered company found under this name'), { trigger: res.reasons[0] ? res.reasons[0].code : null });
  if (co.state === 'RESOLVED') {
    if (co.registeredStatus.cls === 'IN_COURT_LIQUIDATION' || co.registeredStatus.cls === 'DISSOLVED_BY_COURT') add('COURT_LIQUIDATION_STATUS', 'risk', 'OFFICIAL', SRC.ica, bi(`סטטוס הרשם: ${co.registeredStatus.verbatim}`, `registrar status: ${co.registeredStatus.verbatim}`), { trigger: 'status class ∈ {IN_COURT_LIQUIDATION, DISSOLVED_BY_COURT}', value: co.registeredStatus.verbatim });
    else if (co.registeredStatus.cls !== 'ACTIVE' && co.registeredStatus.cls !== 'UNKNOWN') add('COMPANY_NOT_ACTIVE', 'watch', 'OFFICIAL', SRC.ica, bi(`סטטוס הרשם: ${co.registeredStatus.verbatim} (לא "פעילה")`, `registrar status: ${co.registeredStatus.verbatim} (not "active")`), { trigger: 'status class ≠ ACTIVE', value: co.registeredStatus.verbatim });
    if (co.insolvency.liquidationCases.some((c) => c.open)) add('COURT_LIQUIDATION_PROCEEDING', 'risk', 'OFFICIAL', SRC.receiver, bi('תיק פירוק פתוח בקובץ הכונס הרשמי', 'an open liquidation case in the Official Receiver\'s file'), { trigger: 'open case by company number', value: co.insolvency.liquidationCases.filter((c) => c.open).length });
    if (co.insolvency.voluntary.length) add('VOLUNTARY_LIQUIDATION_LISTED', 'watch', 'OFFICIAL', SRC.volFast, bi('רשומה ברשימת הפירוק מרצון בהליך מזורז — אינו הליך חדלות פירעון', 'listed for fast-track voluntary liquidation — not an insolvency proceeding'), { trigger: 'row by company number' });
    if (co.breach.flag) add('BREACH_FLAG', 'info', 'OFFICIAL', SRC.ica, bi('חברה מפרה לפי הרשם — חובות דיווח; אינו חדלות פירעון', 'a "violating company" per the Registrar — filing duties; not insolvency'), { trigger: 'מפרה' });
    if (co.lastAnnualReportYear != null && now && (new Date(now).getFullYear() - co.lastAnnualReportYear) >= 3) add('ANNUAL_REPORT_LAG', 'info', 'OFFICIAL', SRC.ica, bi(`הדוח השנתי האחרון שהוגש: ${co.lastAnnualReportYear}`, `last annual report filed: ${co.lastAnnualReportYear}`), { trigger: 'current year − last report year ≥ 3', value: co.lastAnnualReportYear, threshold: '≥ 3 years' });
    const ch = co.filings.counts.chargeRegistered || 0; if (ch) add('CHARGE_ACTIVITY', 'info', 'OFFICIAL', SRC.icaChanges, bi(`${ch} רישומי שעבוד ו-${co.filings.counts.chargeRemoved || 0} סילוקים בחלון המקור — פעילות מימון, לא מצוקה`, `${ch} charge registrations and ${co.filings.counts.chargeRemoved || 0} removals in the source window — financing activity, not distress`), { trigger: 'charge registrations ≥ 1', value: ch, period: co.filings.window });
  }
  if (X.financial.cls !== 'UNKNOWN') add('NO_PUBLIC_FINANCIALS', 'info', 'DERIVED', SRC.ica, X.financial.label, { trigger: 'coverage class', value: X.financial.cls });
  const K = X.contractor; if (K.state === 'REGISTERED') { add('REGISTERED_CONTRACTOR', 'info', 'OFFICIAL', SRC.contractors, bi(`רשום בפנקס הקבלנים (${K.branches.length} ענפים) — ${K.sites.active} אתרים פעילים כמבצע`, `registered contractor (${K.branches.length} branches) — ${K.sites.active} active sites as executor`), { trigger: 'register row', value: K.sites.active });
    if (K.sites.enforcement.sanctions || K.sites.enforcement.warrants) add('SITE_ENFORCEMENT', 'watch', 'OFFICIAL', SRC.sites, bi(`אכיפת בטיחות באתרים פעילים: ${K.sites.enforcement.sanctions} עיצומים · ${K.sites.enforcement.warrants} צווי בטיחות`, `safety enforcement on active sites: ${K.sites.enforcement.sanctions} sanctions · ${K.sites.enforcement.warrants} safety warrants`), { trigger: 'sanctions + warrants ≥ 1' });
    if (K.closedNotices.length) add('SITE_CLOSURE_NOTICE', 'watch', 'OFFICIAL', SRC.sitesClosed, bi(`${K.closedNotices.length} הודעות סגירת אתר על ידי מינהל הבטיחות`, `${K.closedNotices.length} site-closure notices by the safety administration`), { trigger: 'closed-site rows by normalized name ≥ 1', value: K.closedNotices.length }); }
  if ((X.identity.possibleSame || []).length) add('POSSIBLE_SAME_ENTITY', 'info', 'DERIVED', 'lib/entities', bi(`${X.identity.possibleSame.length} שמות דומים באותיות — ייתכן אותה ישות; לא אוחד`, `${X.identity.possibleSame.length} same-letters names — possibly the same entity; not merged`), { trigger: 'registry POSSIBLY_SAME links ≥ 1' });
  return S;
}

function developerDD(d, cache, opt = {}) {
  const now = opt.now || new Date().toISOString();
  if (!d) return null;
  const res = R.resolveCompany({ id: d.id, canonical: d.canonical || d.name, kind: d.kind, joint: d.joint, companyId: d.companyId }, cache.idx, { companyNumber: opt.companyNumber != null ? opt.companyNumber : undefined, confirmedCandidate: !!opt.confirmedCandidate });
  const identity = { observedName: d.canonical || d.name, kind: d.kind, joint: !!d.joint, roles: d.roles || [], aliases: d.aliases || [], possibleSame: (d.possibleSame || []).map((x) => ({ id: x.id, name: x.name, evidence: x.evidence, state: 'POSSIBLE_MATCH', note: bi('קשר הרישום עצמו — מסומן, לא מאוחד', 'the registry\'s own link — flagged, never merged') })),
    resolution: { ...res, chosen: res.chosen ? R.companyFacts(res.chosen) : null, candidates: (res.candidates || []).map(R.companyFacts) }, companyId: res.chosen ? 'co:' + res.chosen.num : null,
    brandNote: bi('השם שנצפה (מותג) מזוהה עם החברה הרשומה רק במצב ההתאמה שלעיל; חברת פרויקט / חברת אם / ערב אינם נפתרים במקורות הציבוריים', 'the observed name (brand) is tied to the legal company only at the match state above; project SPV / parent / guarantor are not resolvable from public sources') };
  const X = { version: VERSION, generatedFor: d.id, generatedAt: now, basis: bi('מקורות רשמיים בלבד, במפתח מדויק או בשם מנורמל עם מצב התאמה מפורש; ללא ציון, ללא הסתברות', 'official sources only, by exact key or by normalized name with an explicit match state; no score, no probability'), identity };
  X.corporate = corporateOf(res, cache, now);
  X.financial = financialOf(res);
  X.contractor = contractorOf(d, res, cache, now);
  X.permits = permitsOf(d, cache);
  X.execution = executionOf(d, cache, now, opt);
  X.signals = signalsOf(X, now);
  X.missing = [];
  if (!cache.synced) X.missing.push({ id: 'dd-not-synced', he: 'מקורות הבדיקה טרם סונכרנו (data/dd)', en: 'the due-diligence sources are not synced yet (data/dd)' });
  if (res.state !== 'VERIFIED') X.missing.push({ id: 'company-number', he: 'מספר חברה ממקור רשמי או מהמשתמש — נדרש לאימות מלא', en: 'a company number from an official source or the user — needed for VERIFIED' });
  X.missing.push({ id: 'ownership', he: 'מבנה בעלות (אם / בת / SPV / ערב) — אינו במקור ציבורי פתוח', en: 'ownership structure (parent / subsidiary / SPV / guarantor) — not in any open public source' });
  X.missing.push({ id: 'financials', he: 'דוחות כספיים — מאיה / מגנ״א חסומים; אינם בכיסוי', en: 'financial statements — MAYA / MAGNA blocked; not in coverage' });
  X.missing.push({ id: 'litigation', he: 'הליכים משפטיים אזרחיים — אין מאגר ברמת הנתבע', en: 'civil litigation — no defendant-level dataset' });
  if (X.contractor.state === 'NOT_REGISTERED_AS_OBSERVED') X.missing.push({ id: 'executing-contractor', he: 'הקבלן המבצע של הפרויקטים — אינו נקבע מהיזם; נראה רק באתר עם צירוף', en: 'the projects\' executing contractor — not determined from the developer; visible only on a joined site' });
  X.hardTruths = HARD_TRUTHS;
  X.coverage = { corporate: COVERAGE.DEVELOPER_LEVEL, sites: COVERAGE.NATIONAL, permits: COVERAGE.TLV_MUNICIPAL, execution: COVERAGE.PROJECT_LEVEL, financial: COVERAGE.NONE };
  X.freshness = cache.freshness;
  return X;
}

module.exports = { developerDD, VERSION, VELOCITY_MIN, COVERAGE, HARD_TRUTHS, corporateOf, financialOf, contractorOf, permitsOf, executionOf, signalsOf, monthsBetween };
