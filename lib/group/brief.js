// PROPX · SPONSOR X-RAY — the LEGAL / CORPORATE TIMELINE of the group's legal entities (exact entity only), the GROUP TIMELINE,
// the RISK & GAP BRIEF (six categories; each item: why it matters · what it does not mean · what would confirm · what would disprove ·
// what to verify next), NEXT BEST EVIDENCE at group level, the FIVE-LINE first read, the ONE-MINUTE answers and the TOP SECTION.
// Deterministic text from the read models above — never a recommendation, a probability, a verdict or a score.
'use strict';

const DEV = require('../dd/developer');
const LEG = require('../dd/legal');
const { bi, STATUS, STRUCTURE, TRUTHS, BUCKET_IDS, STAGE_BUCKETS, PROGRAMMES, RULES } = require('./model');
const { inTotals } = require('./portfolio');

const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const CHARGE_NOT = bi('שעבוד ≠ מצוקה: שעבוד הוא בטוחה למימון', 'CHARGE ≠ DISTRESS: a charge is financing collateral');

/* ------------------------------------------------------------ legal / corporate timeline */
function legalOf({ M, K, docs, fin, now }) {
  const events = [], entities = [];
  for (const c of M.companies.values()) {
    if (c.tier !== 'CORE' && c.tier !== 'DOCUMENTED') continue;
    const row = K.c.idx.companies.byNumber.get(c.number) || K.c.idx.partnerships.byNumber.get(c.number);
    if (!row) { entities.push({ number: c.number, name: c.company ? c.company.name : null, role: c.role, inCoverage: false }); continue; }
    const corp = DEV.corporateOf({ chosen: row, state: 'VERIFIED' }, K.c, now);
    const leg = LEG.legalExposure({ companyNumber: c.number, corporate: corp, cache: K.c, userDocs: docs });
    const ent = { number: c.number, name: c.company ? c.company.name : null, role: c.role };
    const add = (date, kind, label, o = {}) => events.push({ date: date ? String(date).slice(0, 10) : null, kind, label, entity: ent, cls: o.cls || 'OFFICIAL', source: o.source || 'datagov:ica:companies', notA: o.notA || null, dateBasis: o.dateBasis || bi('תאריך המקור', 'the source date') });
    for (const s of corp.statusChanges || []) add(s.at, 'company-status-change', bi(`שינוי ${s.event === 'company-sub-status-changed' ? 'תת-סטטוס' : s.event === 'company-breach-flag-changed' ? 'דגל הפרה' : 'סטטוס'} ברשם: ${s.old || '—'} → ${s.new || '—'}`, `registry ${s.event === 'company-sub-status-changed' ? 'sub-status' : s.event === 'company-breach-flag-changed' ? 'breach flag' : 'status'} changed: ${s.old || '—'} → ${s.new || '—'}`), { dateBasis: bi('תאריך שבו PROPX ראתה את השינוי בין שתי קריאות', 'the date PROPX saw the change between two reads') });
    for (const f of (corp.filings && corp.filings.events) || []) {
      if (f.cls === 'chargeRegistered') add(f.date, 'charge-registered', bi('רישום שעבוד', 'charge registered'), { source: 'datagov:ica:changes', notA: CHARGE_NOT });
      else if (f.cls === 'chargeRemoved') add(f.date, 'charge-removed', bi('סילוק שעבוד', 'charge removed'), { source: 'datagov:ica:changes' });
      else if (f.cls === 'chargeRemovalCancelled') add(f.date, 'charge-removal-cancelled', bi('ביטול סילוק שעבוד — השעבוד עומד שוב', 'charge removal cancelled — the charge stands again'), { source: 'datagov:ica:changes', notA: CHARGE_NOT });
      else if (f.cls === 'chargeUpdated') add(f.date, 'charge-updated', bi('עדכון שעבוד', 'charge updated'), { source: 'datagov:ica:changes', notA: CHARGE_NOT });
      else if (/צו עיקול/.test(String(f.kind || ''))) add(f.date, 'attachment-filing', bi('בקשה בנושא צו עיקול (הוספה / עדכון / הסרה — המקור אינו מבחין)', 'a filing about an attachment order (add / update / remove — the source does not say which)'), { source: 'datagov:ica:changes', notA: bi('עיקול ≠ חדלות פירעון', 'an attachment ≠ insolvency') });
      else if (f.cls === 'breachUpdate') add(f.date, 'breach-update', bi('עדכון הפרה (חובות דיווח)', 'breach update (filing duties)'), { source: 'datagov:ica:changes', notA: bi('הפרה ≠ חדלות פירעון', 'a breach ≠ insolvency') });
    }
    /* open / closed in both languages (the file's own status kept verbatim beside it); a closed case is never current insolvency */
    for (const lc of (corp.insolvency && corp.insolvency.liquidationCases) || []) add(lc.orderDate || lc.requested || lc.closed, 'liquidation-case', bi(`תיק פירוק בקובץ הכונס הרשמי — ${lc.open ? 'פתוח' : 'סגור'} (כפי שבקובץ: ${lc.status || '—'})`, `a liquidation case in the Official Receiver's file — ${lc.open ? 'OPEN' : 'CLOSED'} (as the file writes it: ${lc.status || '—'})`), { source: 'datagov:moj:official-receiver:liquidation', notA: lc.open ? null : bi('תיק סגור ≠ חדלות פירעון נוכחית', 'A CLOSED CASE ≠ CURRENT INSOLVENCY') });
    for (const v of (corp.insolvency && corp.insolvency.voluntary) || []) add(v.approved, 'voluntary-liquidation', bi('פירוק מרצון בהליך מזורז — החלטת בעלי מניות', 'fast-track voluntary liquidation — a shareholder decision'), { source: 'datagov:ica:voluntary-liquidation-fast-track', notA: bi('פירוק מרצון ≠ חדלות פירעון', 'voluntary liquidation ≠ insolvency') });
    for (const i of leg.items) {
      if (i.kind === 'STRIKE_OFF_DESIGNATION') add(i.dates.published, 'strike-off-designation', bi(`ייעוד למחיקה ברשם (${i.status || '—'})`, `designated for strike-off by the Registrar (${i.status || '—'})`), { source: 'datagov:ica:designated-strike-off', notA: bi('ייעוד ≠ מחיקה ≠ חדלות פירעון', 'designation ≠ strike-off ≠ insolvency') });
      if (i.kind === 'DISCLOSED_LITIGATION') add(i.dates.asOf, 'disclosed-proceeding', bi(`הליך שגולה במסמך: ${i.subKind}${i.status ? ' · ' + i.status : ''}`, `a proceeding disclosed in a document: ${i.subKind}${i.status ? ' · ' + i.status : ''}`), { cls: 'USER_DOCUMENT', source: 'user-document' });
      if (i.kind === 'INSOLVENCY_PROCEEDING' || i.kind === 'COURT_LIQUIDATION_STATUS') add(null, i.kind === 'INSOLVENCY_PROCEEDING' ? 'insolvency-status' : 'court-liquidation-status', bi(`סטטוס ברשם: ${i.status}`, `registry status: ${i.status}`), { dateBasis: bi('סטטוס נוכחי (ללא תאריך במקור)', 'the current status (undated in the source)') });
    }
    const fe = fin.entities.find((e) => e.number === c.number);
    if (fe && fe.profile.latest && fe.profile.latest.rating) { const rt = fe.profile.latest.rating; add(rt.date || fe.profile.latest.reportDate, 'rating', bi(`דירוג ${rt.rating}${rt.agency ? ' (' + rt.agency + ')' : ''}${rt.outlook ? ' · אופק ' + rt.outlook : ''} — לפי מסמך`, `rating ${rt.rating}${rt.agency ? ' (' + rt.agency + ')' : ''}${rt.outlook ? ' · outlook ' + rt.outlook : ''} — per a document`), { cls: 'USER_DOCUMENT', source: 'user-document' }); }
    entities.push({ ...ent, inCoverage: true, status: corp.registeredStatus, breach: corp.breach, lastAnnualReportYear: corp.lastAnnualReportYear, charges: { registered: (corp.filings.counts || {}).chargeRegistered || 0, removed: (corp.filings.counts || {}).chargeRemoved || 0, window: corp.filings.window },
      /* OPEN = an insolvency proceeding, a court liquidation in progress or an open Official Receiver case; DISSOLVED BY THE COURT is a
         TERMINAL registry status — reported as such, never as an open record (independent review 19.10.2026) */
      openInsolvencyRecords: leg.items.filter((i) => i.cls === 'OFFICIAL' && (i.kind === 'INSOLVENCY_PROCEEDING' || (i.kind === 'COURT_LIQUIDATION_STATUS' && !(corp.registeredStatus && corp.registeredStatus.cls === 'DISSOLVED_BY_COURT')) || (i.kind === 'LIQUIDATION_CASE' && i.open))).length,
      dissolvedByCourt: corp.registeredStatus && corp.registeredStatus.cls === 'DISSOLVED_BY_COURT' ? corp.registeredStatus.verbatim || true : null,
      strikeOff: leg.items.some((i) => i.kind === 'STRIKE_OFF_DESIGNATION'), insolvencyStatement: corp.insolvency.statement, legalStatement: leg.statement, coverage: leg.coverage });
  }
  events.sort((a, b) => String(b.date || '0000').localeCompare(String(a.date || '0000')));
  return { cls: 'OFFICIAL', entities, events, exactEntityOnly: bi('רק אירועים של הישות המדויקת (לפי מספר חברה) — לעולם לא לפי שם, מותג או כתובת', 'only events of the exact entity (by company number) — never by name, brand or address'),
    notObservable: [bi('החלפת חברת פרויקט — אינה נצפית במקור ציבורי', 'a project-company change — not observable in a public source'), bi('תביעות אזרחיות / ייצוגיות — אין מקור פתוח ברמת הנתבע; היעדר שורה ≠ היעדר הליך', 'civil / class-action litigation — no open defendant-level source; NO COURT ROW ≠ NO LITIGATION'), bi('דיווחים מיידיים של חברות ציבוריות (מאיה) — חסומים', 'public-company immediate reports (MAYA) — blocked')],
    truths: [CHARGE_NOT, bi('ייעוד למחיקה ≠ חדלות פירעון', 'A STRIKE-OFF DESIGNATION ≠ INSOLVENCY')] };
}

/* ------------------------------------------------------------ the group timeline */
function groupTimeline(projectEvents, legal, fin, today) {
  const ev = projectEvents.map((e) => ({ ...e, lane: 'project' }));
  /* charge filings are collapsed per entity and month (independent review 19.10.2026: dozens of filings must not drown the project lane) */
  const CH = /^charge-/; const months = new Map();
  for (const e of legal.events) {
    if (!e.date) continue;
    if (CH.test(e.kind)) { const k = `${e.entity.number}|${e.date.slice(0, 7)}`; if (!months.has(k)) months.set(k, { date: e.date.slice(0, 7) + '-01', entity: e.entity, registered: 0, removed: 0, other: 0 }); const m = months.get(k); if (e.kind === 'charge-registered') m.registered++; else if (e.kind === 'charge-removed') m.removed++; else m.other++; continue; }
    ev.push({ date: e.date, kind: e.kind, label: e.label, entity: e.entity, cls: e.cls, source: e.source, lane: 'corporate', notA: e.notA });
  }
  for (const m of months.values()) ev.push({ date: m.date, kind: 'charges-month', label: bi(`${m.entity.name || m.entity.number}: ${m.date.slice(5, 7)}/${m.date.slice(0, 4)} — ${m.registered} רישומי שעבוד · ${m.removed} סילוקים${m.other ? ` · ${m.other} עדכונים` : ''}`, `${m.entity.name || m.entity.number}: ${m.date.slice(5, 7)}/${m.date.slice(0, 4)} — ${m.registered} charge registration(s) · ${m.removed} removal(s)${m.other ? ` · ${m.other} update(s)` : ''}`), entity: m.entity, cls: 'OFFICIAL', source: 'datagov:ica:changes', lane: 'corporate', notA: CHARGE_NOT, monthly: true });
  for (const e of fin.entities) for (const s of e.profile.latest ? [e.profile.latest] : []) ev.push({ date: s.reportDate, kind: 'financial-report', label: bi(`דוח כספי ${s.period.kind} ל-${s.period.end} — ${e.name || e.number} (מסמך משתמש)`, `financial statement ${s.period.kind} for ${s.period.end} — ${e.name || e.number} (a user document)`), entity: { number: e.number, name: e.name }, cls: 'USER_DOCUMENT', source: 'user-document', lane: 'financial' });
  ev.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.kind).localeCompare(String(b.kind)));
  const from = (m) => { const d = new Date(today + 'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - m, d.getUTCDate())).toISOString().slice(0, 10); };
  const windows = { m12: from(12), m24: from(24), y5: from(60), all: null };
  const counts = Object.fromEntries(Object.entries(windows).map(([k, f]) => [k, ev.filter((e) => !f || e.date >= f).length]));
  return { events: ev.slice(0, 800), total: ev.length, truncated: Math.max(0, ev.length - 800), windows, counts, question: bi('מה הקבוצה עשתה בפועל?', 'What has this group actually been doing?'),
    basis: bi('תאריכים רשמיים; תצפית PROPX מסומנת; אירוע תאגידי של הישות המדויקת בלבד', 'official dates; a PROPX observation is labelled; a corporate event of the exact entity only') };
}

/* ------------------------------------------------------------ RISK & GAP BRIEF */
const CATS = ['VERIFIED_FACT', 'DERIVED_SIGNAL', 'MISSING_EVIDENCE', 'SOURCE_LIMITATION', 'ENTITY_AMBIGUITY', 'SOURCE_CONFLICT'];
const item = (category, id, text, o) => ({ category, id, text, cls: o.cls || null, source: o.source || null, state: o.state || null, value: o.value ?? null, why: o.why, notMean: o.notMean, confirms: o.confirms, disproves: o.disproves, verify: o.verify });
function briefOf({ M, rows, stages, load, signals, fin, legal, geo, spv }) {
  const I = [];
  const T = rows.filter(inTotals);
  const core = M.core && M.core.company;
  if (core && (M.status === 'LEGAL_CORE_VERIFIED' || M.status === 'LEGAL_CORE_STRONG' || M.status === 'LEGAL_CORE_USER_KEY')) {
    const nb = [...M.brands.values()].filter((b) => b.tier === 'CORE').length;
    /* VERIFIED FACT only when every brand link is VERIFIED from a source; a STRONG name link is an entity question; a user key is the user's */
    const cat = M.status === 'LEGAL_CORE_VERIFIED' ? 'VERIFIED_FACT' : 'ENTITY_AMBIGUITY';
    const how = M.status === 'LEGAL_CORE_USER_KEY' ? bi('לפי מספר החברה שסיפקת', 'by the company number you provided') : M.status === 'LEGAL_CORE_STRONG' ? bi('מספר החברה מאומת; הקישור מהמותגים אליו — התאמת שם חזקה (לא מאומתת)', 'the company number is verified; the link from the brands to it is a STRONG name match (not verified)') : bi('מספר רשמי', 'an official number');
    I.push(item(cat, 'core-legal-entity', bi(`${nb} כתיבי מותג נפתרים לחברה רשומה ${core.number} (${core.status.verbatim || '—'}) — ${how.he}`, `${nb} brand spelling(s) resolve to legal company ${core.number} (${(core.status.label && core.status.label.en) || core.status.verbatim || '—'}) — ${how.en}`), { cls: M.status === 'LEGAL_CORE_VERIFIED' ? 'OFFICIAL' : M.status === 'LEGAL_CORE_USER_KEY' ? 'USER_ASSUMPTION' : 'DERIVED', source: 'datagov:ica:companies', state: M.core.linkState,
      why: bi('זו הישות המשפטית שמאחורי הפרויקטים שנצפו — כל עובדה תאגידית נקראת לפי מספרה', 'this is the legal person behind the observed projects — every corporate fact is read by its number'), notMean: bi('אינו קובע בעלות, חברת אם או חברות פרויקט; התאמה חזקה לפי שם אינה "מאומתת"', 'it establishes no ownership, parent or project companies; a STRONG match by name is not VERIFIED'),
      confirms: bi('מספר החברה בחוזה / נסח', 'the company number on a contract / extract'), disproves: bi('נסח שמראה חברה אחרת מאחורי המותג', 'an extract showing another company behind the brand'), verify: bi('נסח חברה עדכני', 'a current company extract') }));
  }
  for (const e of legal.entities.filter((x) => x.inCoverage)) {
    if (e.openInsolvencyRecords) I.push(item('VERIFIED_FACT', 'insolvency-record-' + e.number, bi(`${e.name}: ${e.openInsolvencyRecords} רשומות רשמיות פתוחות של חדלות פירעון / פירוק — כפי שהמקור כותב`, `${e.name}: ${e.openInsolvencyRecords} open official insolvency / liquidation records — as the source writes them`), { cls: 'OFFICIAL', source: 'datagov:moj:official-receiver:liquidation · datagov:ica:companies',
      why: bi('רשומה רשמית לפי מספר החברה', 'an official record by company number'), notMean: bi('המצב המשפטי המלא אינו בכיסוי; פרטי ההליך — במקור', 'the full legal position is not in coverage; the details are in the source'), confirms: bi('פסק דין / צו בתיק', 'the order in the case'), disproves: bi('סגירת התיק ברשומת הכונס', 'the case closed in the Receiver\'s record'), verify: bi('תיק בית המשפט', 'the court file') }));
    if (e.dissolvedByCourt) I.push(item('VERIFIED_FACT', 'dissolved-' + e.number, bi(`${e.name}: חוסלה על ידי בית משפט — סטטוס סופי ברשם (${e.dissolvedByCourt === true ? '—' : e.dissolvedByCourt})`, `${e.name}: dissolved by the court — a terminal registry status (${e.dissolvedByCourt === true ? '—' : e.dissolvedByCourt})`), { cls: 'OFFICIAL', source: 'datagov:ica:companies', state: 'VERIFIED',
      why: bi('ישות שחוסלה אינה יכולה לשאת פרויקט או התחייבות חדשה', 'a dissolved entity cannot carry a project or a new obligation'), notMean: bi('סטטוס סופי ≠ הליך פתוח; אינו אומר דבר על ישויות אחרות בקבוצה', 'a terminal status ≠ an open proceeding; it says nothing about the other group entities'), confirms: bi('נסח החברה', 'the company extract'), disproves: bi('—', '—'), verify: bi('מי מחזיק כיום בזכויות של הפרויקטים שלה', 'who holds its projects\' rights today') }));
    if (e.charges.registered) I.push(item('VERIFIED_FACT', 'charges-' + e.number, bi(`${e.name}: ${e.charges.registered} רישומי שעבוד ו-${e.charges.removed} סילוקים בחלון המקור`, `${e.name}: ${e.charges.registered} charge registrations and ${e.charges.removed} removals in the source window`), { cls: 'OFFICIAL', source: 'datagov:ica:changes',
      why: bi('שעבודים מראים פעילות מימון מובטחת', 'charges show secured financing activity'), notMean: CHARGE_NOT, confirms: bi('תעודת השעבוד ברשם', 'the charge certificate at the Registrar'), disproves: bi('—', '—'), verify: bi('פרטי השעבוד (נושה, סכום, נכס) בנסח המלא', 'the charge details (chargee, amount, asset) in the full extract') }));
  }
  for (const s of signals) I.push(item('DERIVED_SIGNAL', s.id, s.text, { cls: 'DERIVED', source: s.source, value: s.valueLabel,
    why: SIGNAL_WHY[s.id] || bi('כלל דטרמיניסטי מתועד שנורה', 'a documented deterministic rule fired'), notMean: SIGNAL_NOT[s.id] || bi('אינו שיפוט ואינו המלצה', 'not a judgement and not a recommendation'),
    confirms: bi('ראיה ברמת הפרויקט (היתר / אתר / דוח מכירות) לפרויקטים המעורבים', 'project-level evidence (a permit / a site / a sales report) for the projects involved'), disproves: bi('ראיה מאוחרת שהמקורות שבכיסוי אינם נושאים', 'later evidence the sources in coverage do not carry'), verify: bi('רשימת הפרויקטים המעורבים בסימן', 'the list of projects involved in the signal') }));
  const rep = fin.reporting ? fin.entities.find((e) => e.number === fin.reporting.number) : null;
  if (rep) for (const f of rep.profile.flags) if (f.id !== 'INSUFFICIENT_FINANCIAL_DATA') I.push(item('DERIVED_SIGNAL', 'fin-' + f.id, bi(`${rep.name || rep.number}: ${f.text.he}`, `${rep.name || rep.number}: ${f.text.en}`), { cls: f.cls || 'DERIVED', source: 'user-document',
    why: bi('דגל מול התקופה המקבילה, עם הקלט והסף', 'a flag against the comparable period, with its inputs and threshold'), notMean: bi('אינו הסתברות כשל ואינו ציון', 'not a probability of default and not a score'), confirms: bi('הדוח המבוקר הבא', 'the next audited statement'), disproves: bi('הצגה מחדש של הנתונים', 'a restatement of the figures'), verify: bi('ביאורי החוב ולוח הפירעון', 'the debt notes and the maturity schedule') }));
  if (!rep) I.push(item('MISSING_EVIDENCE', 'no-financials', bi('אין דוחות כספיים לישויות הקבוצה בכיסוי', 'no financial statements for the group\'s entities in coverage'), { cls: 'MISSING', source: 'lib/dd/financial',
    why: bi('בלי דוחות אי אפשר לקרוא מינוף, נזילות או לוח פירעון', 'without statements leverage, liquidity and maturities cannot be read'), notMean: bi('אין דוחות ≠ חולשה פיננסית; היגד על הנתונים, לא על החברה', 'NO FINANCIALS ≠ FINANCIAL WEAKNESS; a statement about the data, not the company'), confirms: bi('—', '—'), disproves: bi('—', '—'), verify: bi('דוחות שנתיים מבוקרים (מסמך משתמש)', 'audited annual statements (a user document)') }));
  if (M.structure === 'NOT_IN_COVERAGE') I.push(item('MISSING_EVIDENCE', 'ownership', bi('מבנה הבעלות של הקבוצה אינו בכיסוי', 'the group\'s ownership structure is not in coverage'), { cls: 'MISSING', source: 'datagov:ica:companies',
    why: bi('חברות אם, בנות ו-SPV קובעות היכן יושבים הנכסים וההתחייבויות', 'parents, subsidiaries and SPVs decide where assets and liabilities sit'), notMean: bi('היעדר נתוני בעלות ≠ אין בעלים / אין חברות בנות', 'NO PUBLIC OWNERSHIP DATA ≠ NO OWNER / NO SUBSIDIARIES'), confirms: bi('—', '—'), disproves: bi('—', '—'), verify: bi('תרשים אחזקות / נסח חברה', 'an ownership chart / a company extract') }));
  const unres = T.filter((r) => !r.projectCompany.identified), ofRec = unres.filter((r) => r.projectCompany.ofRecordOnly).length;
  if (unres.length) I.push(item('MISSING_EVIDENCE', 'project-company-unresolved', bi(`${unres.length} פרויקטים ללא חברת פרויקט מזוהה (${ofRec} מהם — רק הזוכה / היזם ברשומה אחת)`, `${unres.length} projects without an identified project company (${ofRec} of them — only the winner / developer on one record)`), { cls: 'MISSING', value: unres.length, source: 'lib/dd/projectco',
    why: bi('חברת הפרויקט היא הלווה והמוכר — היא נושאת את התחייבויות הפרויקט', 'the project company is the borrower and the seller — it carries the project\'s liabilities'), notMean: bi('לא מזוהה ≠ לא קיים; זוכה בקרקע ≠ חברת הפרויקט', 'not identified ≠ does not exist; LAND WINNER ≠ PROJECT COMPANY'), confirms: bi('הסכם רכישה / ערבות חוק המכר', 'a purchase agreement / a Sale-Law guarantee'), disproves: bi('—', '—'), verify: bi('הצהרת יזם על חברות הפרויקט', 'a developer declaration of the project companies') }));
  I.push(item('MISSING_EVIDENCE', 'no-verified-project-company', bi(`לאף פרויקט אין חברת פרויקט מאומתת (מזהה רשמי ברמת הפרויקט אינו בכיסוי) — ${spv.strong} בהתאמה חזקה`, `no project has a VERIFIED project company (an official project-level identifier is not in coverage) — ${spv.strong} STRONG`), { cls: 'MISSING', source: 'lib/dd/projectco',
    why: bi('התאמה חזקה נשענת על הזוכה / היזם ברשומה — לא על מזהה פרויקט', 'a STRONG match rests on the winner / developer on the record — not on a project identifier'), notMean: bi('חזקה ≠ מאומתת', 'STRONG ≠ VERIFIED'), confirms: bi('מספר החברה ברשומת הפרויקט', 'the company number on the project record'), disproves: bi('מסמך שנוקב בחברה אחרת', 'a document naming another company'), verify: bi('הסכם הפיתוח / החכירה עם רמ״י', 'the ILA development / lease agreement') }));
  if (load.withoutLaterEvidence.total) I.push(item('MISSING_EVIDENCE', 'no-later-execution-evidence', bi(`${load.withoutLaterEvidence.total} פרויקטים ללא ראיה ציבורית מאוחרת ל-18+ חודשים (${load.withoutLaterEvidence.gapRuleFires} בכיסוי שיכול היה להראות ראיה; ${load.withoutLaterEvidence.total - load.withoutLaterEvidence.gapRuleFires} — פער כיסוי)`, `${load.withoutLaterEvidence.total} projects without later public evidence for 18+ months (${load.withoutLaterEvidence.gapRuleFires} where a covered source could show it; ${load.withoutLaterEvidence.total - load.withoutLaterEvidence.gapRuleFires} — a coverage gap)`), { cls: 'MISSING', value: load.withoutLaterEvidence.total,
    why: bi('בלי ראיה לביצוע לא ניתן לדעת אם הקרקע עברה לבנייה', 'without execution evidence one cannot tell whether the land moved to construction'), notMean: bi('אין ראיה מאוחרת ≠ פרויקט תקוע', 'NO LATER EVIDENCE ≠ PROJECT STALLED'), confirms: bi('היתר / אתר פעיל / תעודת גמר', 'a permit / an active site / a completion certificate'), disproves: bi('—', '—'), verify: bi('היתרי הבנייה ברשויות המקומיות', 'the building permits at the local authorities') }));
  I.push(item('MISSING_EVIDENCE', 'sales', bi('קצב מכירות ברמת הפרויקט — אין מקור', 'project-level sales pace — no source'), { cls: 'MISSING', why: bi('מכירות מוקדמות מממנות את הבנייה', 'presales fund construction'), notMean: bi('יח״ד שנזכו ≠ יח״ד שנמכרו', 'AWARDED UNITS ≠ SOLD UNITS'), confirms: bi('—', '—'), disproves: bi('—', '—'), verify: bi('דוח מכירות (מסמך משתמש)', 'a sales report (a user document)') }));
  I.push(item('SOURCE_LIMITATION', 'construction-stale', bi(`ראיות הבנייה והגמר מחוץ לתל אביב נשענות על דיווחי משב״ש שנעצרים ב-${load.consAsOf || '2024-03-01'}`, `construction and completion evidence outside Tel Aviv rests on MoCH progress rows that stop at ${load.consAsOf || '2024-03-01'}`), { cls: 'DERIVED', source: 'datagov:moch:construction-progress',
    why: bi('כך המקור בנוי', 'how the source is built'), notMean: bi('אין ראיה אחרי התאריך ≠ אין בנייה', 'no evidence after the date ≠ no construction'), confirms: bi('—', '—'), disproves: bi('—', '—'), verify: bi('אתרי משרד העבודה בקישור חזק / ביקור באתר', 'Ministry of Labour sites on a STRONG link / a site visit') }));
  I.push(item('SOURCE_LIMITATION', 'public-channels', bi('PROPX צופה בערוצים ציבוריים בלבד (מכרזי רמ״י, הגרלות משב״ש) — קרקע פרטית והתחדשות עירונית של היזם אינן נצפות', 'PROPX observes public channels only (ILA tenders, MoCH lotteries) — the developer\'s private-land and urban-renewal activity is not observed'), { cls: 'DERIVED',
    why: bi('התיק הנצפה הוא חלק מהפעילות', 'the observed portfolio is part of the activity'), notMean: bi('לא נצפה ≠ לא קיים', 'NOT OBSERVED ≠ DOES NOT EXIST'), confirms: bi('—', '—'), disproves: bi('—', '—'), verify: bi('רשימת פרויקטים מהיזם', 'a project list from the developer') }));
  if (M.status === 'JOINT_AWARD_ONLY') I.push(item('ENTITY_AMBIGUITY', 'joint-award-only', bi('מחרוזת הזוכים נוקבת בכמה צדדים — אין "קבוצה" אחת; לכל צד שנפתר קריאת קבוצה משלו', 'the winner string names several parties — there is no single "group"; each resolved party has its own group read'), { cls: 'OFFICIAL', state: 'UNRESOLVED',
    why: bi('ההחלטה נוגעת לכל צד בנפרד', 'the decision concerns each party separately'), notMean: bi('זכייה משותפת ≠ קבוצה ≠ חברת אם', 'a joint award ≠ a group ≠ a parent'), confirms: bi('הסכם המיזם המשותף', 'the joint-venture agreement'), disproves: bi('—', '—'), verify: bi('חלוקת הזכויות בין הצדדים', 'the split of rights between the parties') }));
  if (M.status === 'BRAND_ONLY') I.push(item('ENTITY_AMBIGUITY', 'brand-only', bi('החברה המשפטית שמאחורי המותג לא נפתרה — הקבוצה היא המותג בלבד', 'the legal company behind the brand is not resolved — the group is the brand only'), { cls: 'DERIVED', state: M.anchor.resolution ? M.anchor.resolution.state : null,
    why: bi('בלי ישות משפטית אין רשומה תאגידית לקרוא', 'without a legal entity there is no corporate record to read'), notMean: bi('לא נפתר ≠ לא קיים', 'unresolved ≠ does not exist'), confirms: bi('מספר חברה', 'a company number'), disproves: bi('—', '—'), verify: bi('ח.פ. מהיזם / מחוזה', 'the company number from the developer / a contract') }));
  if (M.excluded.length) I.push(item('ENTITY_AMBIGUITY', 'possible-members', bi(`${M.excluded.length} ישויות אפשריות / רב-משמעיות מוצגות ואינן נספרות בקבוצה`, `${M.excluded.length} possible / ambiguous entities are shown and not counted in the group`), { cls: 'DERIVED', state: 'POSSIBLE_MATCH', value: M.excluded.length,
    why: bi('ייתכן שהן חלק מהקבוצה — אין ראיה מספיקה', 'they may be part of the group — the evidence is not enough'), notMean: bi('קשר אפשרי ≠ שליטה קבוצתית', 'POSSIBLE RELATION ≠ GROUP CONTROL'), confirms: bi('מספר חברה / תרשים אחזקות', 'a company number / an ownership chart'), disproves: bi('נסח שמראה בעלים אחרים', 'an extract showing other owners'), verify: bi('בדיקת כל מועמד לפי מספר', 'check each candidate by number') }));
  const sharedRows = rows.filter((r) => r.tier === 'SHARED').length;
  if (sharedRows) I.push(item('ENTITY_AMBIGUITY', 'joint-awards', bi(`${sharedRows} פרויקטים בזכייה משותפת (${M.shared.length} מחרוזות זוכים) — מוצגים בנפרד ואינם נספרים`, `${sharedRows} project(s) in joint awards (${M.shared.length} winner string(s)) — shown apart and not counted`), { cls: 'OFFICIAL', value: sharedRows,
    why: bi('הקבוצה נושאת חלק לא ידוע מהן', 'the group carries an unknown share of them'), notMean: bi('זכייה משותפת ≠ קבוצה ≠ חברת אם', 'a joint award ≠ a group ≠ a parent'), confirms: bi('הסכם המיזם המשותף', 'the joint-venture agreement'), disproves: bi('—', '—'), verify: bi('חלוקת הזכויות בין השותפים', 'the split of rights between the partners') }));
  const conf = T.filter((r) => r.projectCompany.conflict);
  if (conf.length) I.push(item('SOURCE_CONFLICT', 'project-company-conflict', bi(`${conf.length} פרויקטים שבהם רשומות שונות נוקבות בחברות שונות — לא נבחרה`, `${conf.length} projects where different records name different companies — none picked`), { cls: 'DERIVED', value: conf.length,
    why: bi('ייתכן שהזכויות הועברו לחברת פרויקט', 'the rights may have moved to a project company'), notMean: bi('סתירה ≠ טעות של אחד המקורות', 'a conflict ≠ an error of one source'), confirms: bi('מסמך הזכויות העדכני', 'the current rights document'), disproves: bi('—', '—'), verify: bi('הסכם הפיתוח / החכירה', 'the development / lease agreement') }));
  for (const e of fin.entities) for (const c of e.profile.conflicts || []) I.push(item('SOURCE_CONFLICT', 'fin-conflict-' + e.number + '-' + c.period.end, bi(`${e.name}: שני דוחות סותרים ל-${c.period.end} — לא נבחר`, `${e.name}: two conflicting statements for ${c.period.end} — none picked`), { cls: 'USER_DOCUMENT',
    why: bi('ערכים שונים לאותה תקופה', 'different values for one period'), notMean: bi('אינו ממצא על החברה', 'not a finding about the company'), confirms: bi('הדוח המבוקר', 'the audited statement'), disproves: bi('—', '—'), verify: bi('סימון הצגה מחדש', 'a restatement mark') }));
  const order = Object.fromEntries(CATS.map((c, i) => [c, i]));
  I.sort((a, b) => order[a.category] - order[b.category]);
  return { categories: CATS, items: I, basis: bi('כל פריט: למה זה חשוב · מה זה לא אומר · מה יאשר · מה יפריך · מה לבדוק הלאה', 'every item: why it matters · what it does not mean · what would confirm · what would disprove · what to verify next') };
}
const SIGNAL_WHY = {
  HIGH_SIMULTANEOUS_PROJECT_LOAD: bi('צנרת מקבילה גדולה יותר עשויה לדרוש יותר ניהול, מימון ויכולת ביצוע.', 'A larger simultaneous pipeline may require more management, funding and execution capacity.'),
  HIGH_EARLY_STAGE_PIPELINE: bi('קרקע שעוד לא נבנתה קושרת הון לפני שיש הכנסות', 'land not yet built ties up capital before there are revenues'),
  HIGH_UNFINISHED_OBSERVED_PIPELINE: bi('בנייה שהחלה ללא ראיה לגמר מותירה פרויקטים פתוחים', 'construction started without completion evidence leaves projects open'),
  LIMITED_COMPLETION_EVIDENCE: bi('רקורד גמר נמוך מקשה להעריך ביצוע', 'a thin completion record makes execution hard to assess'),
  COMPLETION_EVIDENCE_STRONG: bi('רקורד גמר מתועד מול הקבוצה הרחבה', 'a documented completion record against the wider cohort'),
  EXECUTION_TIME_LENGTHENING: bi('זמן ארוך יותר מזכייה לבנייה מאריך את כבילת ההון', 'longer award-to-start keeps capital tied up longer'),
  EXECUTION_TIME_IMPROVING: bi('קיצור הזמן מזכייה לבנייה מול ההיסטוריה של הקבוצה', 'a shorter award-to-start against the group\'s own history'),
  RECENT_PROJECT_ACTIVITY_ACCELERATING: bi('פעילות חדשה מואצת מוסיפה צנרת', 'accelerating new activity adds pipeline'),
  RECENT_PROJECT_ACTIVITY_SLOWING: bi('פחות פעילות חדשה בערוצים הציבוריים', 'less new activity in public channels'),
  NO_LATER_PUBLIC_EVIDENCE_FOUND: bi('פרויקטים בכיסוי ללא ראיה מאוחרת', 'projects in coverage without later evidence'),
  GROUP_GEOGRAPHIC_CONCENTRATION: bi('התיק הנצפה נשען יותר על שוק אחד', 'the observed portfolio depends more heavily on one market'),
};
const SIGNAL_NOT = {
  HIGH_SIMULTANEOUS_PROJECT_LOAD: bi('אינו הוכחה שהיזם במתיחות יתר', 'Proof that the developer is overextended — it is not.'),
  HIGH_EARLY_STAGE_PIPELINE: bi('מוקדם ≠ בעייתי; קרקע ≠ בנייה', 'early ≠ problematic; land ≠ construction'),
  HIGH_UNFINISHED_OBSERVED_PIPELINE: bi('אין ראיה לגמר ≠ לא הושלם', 'no completion evidence ≠ not completed'),
  LIMITED_COMPLETION_EVIDENCE: bi('אין ראיה לגמר ≠ לא הושלם', 'no completion evidence ≠ not completed'),
  NO_LATER_PUBLIC_EVIDENCE_FOUND: bi('לא "תקוע", "נכשל" או "מתעכב"', 'not "stalled", "failed" or "delayed"'),
  GROUP_GEOGRAPHIC_CONCENTRATION: bi('אינו כשלעצמו חולשה פיננסית', 'not by itself financial weakness'),
};

/* ------------------------------------------------------------ NEXT BEST EVIDENCE (group level) */
const NBE = [
  { id: 'audited-financials', doc: 'financial_statements', text: bi('הדוחות הכספיים המבוקרים האחרונים', 'the latest audited financial statements'), why: bi('הבסיס לכל קריאה של מינוף, נזילות ולוח פירעון', 'the basis of any read of leverage, liquidity and maturities'), couldChange: bi('פותח את חלק המינוף, השינוי בזמן והצנרת מול המצב הפיננסי', 'unlocks the leverage, change-over-time and pipeline-vs-financial sections'), retrievable: bi('לא — מאיה / מגנא חסומים ללקוח שאינו דפדפן', 'no — MAYA / MAGNA refuse a non-browser client') },
  { id: 'ownership-chart', doc: 'ownership_chart', text: bi('תרשים אחזקות של הקבוצה', 'the group\'s ownership chart'), why: bi('קובע אילו חברות הן הקבוצה', 'decides which companies are the group'), couldChange: bi('מרחיב את הקבוצה בחברות בנות / אם (לפי מספר), ומשנה את הסיכומים', 'extends the group with subsidiaries / parents (by number), and changes the totals'), retrievable: bi('לא — אין מקור בעלות פתוח', 'no — no open ownership source') },
  { id: 'project-spv-identity', doc: 'developer_declaration', text: bi('זהות חברות הפרויקט (SPV)', 'the project companies (SPVs)'), why: bi('חברת הפרויקט היא הלווה והמוכר', 'the project company is the borrower and the seller'), couldChange: bi('מעלה פרויקטים מ"לא מזוהה" לחברת פרויקט מזוהה ומראה מי חולק חברה', 'moves projects from "not identified" to an identified project company and shows which share one'), retrievable: bi('לא — אין מזהה פרויקט רשמי בכיסוי', 'no — no official project identifier in coverage') },
  { id: 'debt-maturity-schedule', doc: 'bond_covenants', text: bi('לוח פירעון החוב / אמות מידה באג״ח', 'the debt maturity schedule / bond covenants'), why: bi('ריכוז פירעונות הוא סיכון מיחזור', 'a concentration of maturities is a refinancing risk'), couldChange: bi('ממלא את ריכוז הפירעונות לפי שנה', 'fills the maturities by year'), retrievable: bi('לא', 'no') },
  { id: 'company-extract', doc: 'company_extract', text: bi('נסח חברה עדכני של חברת הליבה', 'a current company extract of the core company'), why: bi('מאמת את הזהות לפי מספר ומראה בעלי מניות', 'verifies the identity by number and shows shareholders'), couldChange: bi('הופך את הליבה ל"מאומתת" ומוסיף קשרי בעלות', 'makes the core VERIFIED and adds ownership links'), retrievable: bi('לא — שירות בתשלום של הרשם', 'no — a paid Registrar service') },
  { id: 'financing-agreement', doc: 'financing_agreement', text: bi('הסכם ליווי בנקאי לפרויקטים בביצוע', 'the bank financing agreement of projects in execution'), why: bi('מראה מי מממן ומה מסגרת המימון', 'shows who funds and the facility'), couldChange: bi('מוסיף מימון לפי פרויקט (לא מסוכם בין ישויות)', 'adds financing per project (never summed across entities)'), retrievable: bi('לא', 'no') },
  { id: 'updated-permit', doc: 'permit', text: bi('היתרי בנייה עדכניים לפרויקטים ללא ראיה מאוחרת', 'current building permits for projects without later evidence'), why: bi('מראה אם הקרקע עברה לביצוע', 'shows whether the land moved to execution'), couldChange: bi('מקדם פרויקטים בסולם השלבים (קישור במפתח)', 'moves projects up the stage ladder (a keyed link)'), retrievable: bi('חלקית — תל אביב-יפו בלבד', 'partly — Tel Aviv-Yafo only') },
  { id: 'sales-report', doc: 'sales_report', text: bi('דוח מכירות לפרויקטים פתוחים', 'a sales report for open projects'), why: bi('מכירות מוקדמות מממנות בנייה', 'presales fund construction'), couldChange: bi('מוסיף מכירות מדווחות (דיווח עצמי) לצד הנתונים הרשמיים', 'adds reported sales (self-reported) beside the official figures'), retrievable: bi('לא', 'no') },
  { id: 'guarantee', doc: 'bank_guarantee', text: bi('ערבויות (חוק המכר / חברת אם)', 'guarantees (Sale Law / parent)'), why: bi('חברת אם ≠ ערב — רק מסמך מפורש מראה ערבות', 'a parent ≠ a guarantor — only an explicit document shows a guarantee'), couldChange: bi('מוסיף ערב מפורש לפרויקט', 'adds an explicit guarantor to a project'), retrievable: bi('לא', 'no') },
  { id: 'construction-evidence', doc: null, text: bi('ראיות ביצוע (אתר / ביקור / דיווח)', 'execution evidence (a site / a visit / a report)'), why: bi('מחוץ לתל אביב אין מקור ביצוע עדכני ברמת הפרויקט', 'outside Tel Aviv there is no current project-level execution source'), couldChange: bi('מעדכן את עומס הביצוע ואת השלבים', 'updates the execution load and the stages'), retrievable: bi('חלקית — אתרי משרד העבודה בקישור במפתח', 'partly — Ministry of Labour sites by a keyed link') },
];
function nextBestOf({ M, rows, load, fin, spv }) {
  const T = rows.filter(inTotals);
  const rep = fin.reporting ? fin.entities.find((e) => e.number === fin.reporting.number) : null;
  const pub = fin.publicPrivate && (fin.publicPrivate.cls === 'PUBLIC' || fin.publicPrivate.cls === 'BOND_COMPANY');
  const noCore = !(M.core && M.core.company);
  const use = {
    /* statements, charts and declarations attach to a legal entity by number: with no resolved core, the company number comes first */
    'audited-financials': !rep ? (M.core && M.core.company ? 'HIGH' : 'MEDIUM') : 'LOW',
    'ownership-chart': noCore ? 'MEDIUM' : M.structure === 'NOT_IN_COVERAGE' && (pub || spv.distinct >= 2 || spv.unresolved >= 1) ? 'HIGH' : M.structure === 'NOT_IN_COVERAGE' ? 'MEDIUM' : 'LOW',
    'project-spv-identity': !noCore && spv.unresolved >= 1 ? 'HIGH' : 'MEDIUM',
    'debt-maturity-schedule': rep && !(rep.leverage.maturity && rep.leverage.maturity.nearTermDebt != null) ? 'HIGH' : 'MEDIUM',
    'company-extract': M.status === 'LEGAL_CORE_STRONG' || M.status === 'LEGAL_CORE_USER_KEY' || M.status === 'BRAND_ONLY' || M.status === 'NOT_IN_COVERAGE' ? 'HIGH' : 'LOW',
    'financing-agreement': load.executionEvidence.lots >= 1 ? 'MEDIUM' : 'LOW',
    'updated-permit': load.withoutLaterEvidence.total >= 1 ? 'MEDIUM' : 'LOW',
    'sales-report': load.openRecords.ila + load.openRecords.moch >= 1 ? 'MEDIUM' : 'LOW',
    'guarantee': [...M.companies.values()].some((c) => c.role === 'PARENT') ? 'MEDIUM' : 'LOW',
    'construction-evidence': T.filter((r) => r.bucket === 'NO_LATER_EVIDENCE' && r.universe === 'ila').length >= 3 ? 'MEDIUM' : 'LOW',
  };
  const R = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  /* with no legal core the extract identifies the brand's legal company (a user-provided number) — not "the core company's" extract */
  const NOCORE_EXTRACT = { text: bi('מספר החברה ונסח החברה של הישות המשפטית שמאחורי המותג', 'the company number and extract of the legal company behind the brand'), couldChange: bi('פותר את המותג לחברה משפטית (מספר שסיפק המשתמש → "מאומת" בתווית משתמש) ופותח את כל קריאות הקבוצה לפי מספר', 'resolves the brand to a legal company (a user-provided number → VERIFIED, labelled as the user\'s) and opens every by-number group read') };
  const items = NBE.map((x, i) => ({ ...x, ...(noCore && x.id === 'company-extract' ? NOCORE_EXTRACT : {}), usefulness: use[x.id], order: i, userProvides: !!x.doc, propxRetrieves: x.id === 'updated-permit' || x.id === 'construction-evidence' ? 'PARTIAL' : 'NO' }))
    .sort((a, b) => R[b.usefulness] - R[a.usefulness] || a.order - b.order);
  return { items, basis: bi('מדורג לפי התועלת להחלטה (קבוע לכל סוג + תנאי מתועד): למה זה חשוב · מה זה יכול לשנות · האם PROPX יכולה להשיג · האם המשתמש צריך לספק', 'ranked by decision usefulness (a constant per kind + a documented condition): why it matters · what it could change · can PROPX retrieve it · does the user need to provide it') };
}

/* ------------------------------------------------------------ SPV exposure */
function spvOf(rows, M = null) {
  /* a project company is IDENTIFIED only with ≥ 2 independent records (or VERIFIED); the land winner / programme developer of record
     alone is "not identified — of record only"; the group's own core company is never listed as an SPV (independent review 19.10.2026) */
  const T = rows.filter(inTotals);
  const coreNo = M && M.core ? M.core.number : null;
  const ok = (r) => r.projectCompany.identified;
  const by = new Map();
  for (const r of T) { if (!ok(r) || !r.projectCompany.number || r.projectCompany.number === coreNo) continue; const k = r.projectCompany.number; if (!by.has(k)) by.set(k, { number: k, name: r.projectCompany.name, state: r.projectCompany.state, projects: [] }); by.get(k).projects.push(r.id); }
  const groups = [...by.values()].sort((a, b) => b.projects.length - a.projects.length);
  const heldByCore = T.filter((r) => ok(r) && r.projectCompany.number && r.projectCompany.number === coreNo);
  const ofRecord = T.filter((r) => r.projectCompany.ofRecordOnly);
  const unresolved = T.filter((r) => !ok(r));
  return { cls: 'DERIVED', distinct: groups.length, sharedLegalCompany: groups.filter((g) => g.projects.length > 1), groups, unresolved: unresolved.length, unresolvedIds: unresolved.map((r) => r.id),
    ofRecordOnly: ofRecord.length, heldByCore: heldByCore.length,
    strong: T.filter((r) => r.projectCompany.state === 'STRONG_MATCH').length, verified: T.filter((r) => r.projectCompany.state === 'VERIFIED').length, conflicts: T.filter((r) => r.projectCompany.conflict).map((r) => r.id),
    notVerified: T.length - T.filter((r) => r.projectCompany.state === 'VERIFIED').length,
    rules: [bi('זוכה בקרקע ≠ חברת הפרויקט', 'LAND WINNER ≠ PROJECT COMPANY'), bi('חברה בת ≠ SPV', 'SUBSIDIARY ≠ SPV'), bi('חברת אם ≠ ערב — ערב רק ממסמך מפורש', 'PARENT ≠ GUARANTOR — a guarantor only from an explicit document'), bi('התחייבויות SPV אינן מגולגלות לחברת האם', 'SPV liabilities are not rolled into the parent')],
    basis: bi('חברת הפרויקט מזוהה רק עם ≥ 2 רשומות בלתי תלויות (או מאומתת); זוכה / יזם ברשומה אחת בלבד = "לא מזוהה — הזוכה ברשומה"; חברת הליבה עצמה אינה SPV', 'a project company is identified only with ≥ 2 independent records (or VERIFIED); a winner / developer on one record only = "not identified — winner of record"; the core company itself is never an SPV') };
}

/* ------------------------------------------------------------ first read · one-minute · top section */
/* the order (independent review 19.10.2026): an open official insolvency record · a terminal court dissolution · the reporting entity's
   document flags that a credit reader treats first (going-concern language, a covenant not met, a rating downgrade, a negative outlook)
   · the portfolio signals · the reporting entity's leverage / maturity / liquidity flags · the largest market. Every financial text
   names its entity. */
function mainExposureOf({ legal, signals, geo, fin, load }) {
  const open = legal.entities.find((e) => e.openInsolvencyRecords);
  if (open) return { id: 'OPEN_INSOLVENCY_RECORD', text: bi(`רשומה רשמית פתוחה של חדלות פירעון / פירוק: ${open.name}`, `an open official insolvency / liquidation record: ${open.name}`), cls: 'OFFICIAL' };
  const dis = legal.entities.find((e) => e.dissolvedByCourt);
  if (dis) return { id: 'DISSOLVED_BY_COURT', text: bi(`חוסלה על ידי בית משפט (סטטוס סופי ברשם): ${dis.name}`, `dissolved by the court (a terminal registry status): ${dis.name}`), cls: 'OFFICIAL' };
  const rep = fin.reporting ? fin.entities.find((e) => e.number === fin.reporting.number) : null;
  const named = (f) => ({ id: 'fin-' + f.id, text: bi(`${rep.name || rep.number}: ${f.text.he}`, `${rep.name || rep.number}: ${f.text.en}`), cls: f.cls || 'DERIVED' });
  for (const id of ['GOING_CONCERN_LANGUAGE_PRESENT', 'COVENANT_NOT_MET', 'RATING_DOWNGRADE', 'RATING_OUTLOOK_NEGATIVE']) { const f = rep && rep.profile.flags.find((x) => x.id === id); if (f) return named(f); }
  const CONC = bi('ריכוז גבוה פירושו שהתיק הנצפה נשען יותר על שוק אחד; אינו כשלעצמו חולשה פיננסית.', 'High concentration means the observed portfolio depends more heavily on one market. It does not by itself indicate financial weakness.');
  for (const id of ['GROUP_GEOGRAPHIC_CONCENTRATION', 'HIGH_EARLY_STAGE_PIPELINE', 'HIGH_SIMULTANEOUS_PROJECT_LOAD', 'HIGH_UNFINISHED_OBSERVED_PIPELINE', 'EXECUTION_TIME_LENGTHENING']) { const s = signals.find((x) => x.id === id); if (s) return { id, text: id === 'GROUP_GEOGRAPHIC_CONCENTRATION' ? bi(`${s.text.he} — ${CONC.he}`, `${s.text.en} — ${CONC.en}`) : s.text, cls: 'DERIVED' }; }
  for (const id of ['LEVERAGE_INCREASED', 'NEAR_TERM_DEBT_CONCENTRATION', 'LIQUIDITY_WEAKENED', 'OPERATING_CASH_FLOW_NEGATIVE']) { const f = rep && rep.profile.flags.find((x) => x.id === id); if (f) return named(f); }
  const top = geo.byLocality[0];
  if (top) { const c = geo.concentration;
    return { id: 'NO_RULE_FIRED', text: bi(`אף כלל חשיפה לא נורה; השוק הגדול ביותר: ${top.label.he || top.key} (${top.ila.n} מגרשים${top.moch.n ? ` · ${top.moch.n} פרויקטי הגרלה` : ''}${c && c.share != null ? `; ${pct(c.share)} מהמגרשים, סף הריכוז 70%` : ''})`, `No exposure rule fired; largest market: ${top.label.en || top.key} (${top.ila.n} lots${top.moch.n ? ` · ${top.moch.n} lottery projects` : ''}${c && c.share != null ? `; ${pct(c.share)} of the lots, concentration threshold 70%` : ''})`), cls: 'DERIVED' }; }
  return { id: 'NO_ACTIVITY', text: bi('לא נצפתה פעילות ייזום במקורות שבכיסוי — אין מה להעריך', 'No development activity observed in the sources in coverage — nothing to assess'), cls: 'DERIVED' };
}
function mainUnknownOf({ M, fin, spv, load }) {
  if (M.status === 'JOINT_AWARD_ONLY') return { id: 'JOINT_PARTIES', text: bi('הקבוצה של כל צד בזכייה המשותפת וחלוקת הזכויות ביניהם', 'each joint-award party\'s own group, and the split of rights between them'), cls: 'MISSING' };
  if (M.status === 'BRAND_ONLY') return { id: 'LEGAL_IDENTITY', text: bi('מי החברה המשפטית שמאחורי המותג', 'which legal company stands behind the brand'), cls: 'MISSING' };
  if (M.status === 'NOT_IN_COVERAGE') return { id: 'COMPANY_RECORD', text: bi('הרשומה של החברה — המספר אינו בין החברות ש-PROPX שומרת', 'the company\'s record — the number is not among the companies PROPX keeps'), cls: 'MISSING' };
  if (!fin.reporting) return { id: 'FINANCIALS', text: bi('המצב הפיננסי — אין דוחות בכיסוי', 'the financial position — no statements in coverage'), cls: 'MISSING' };
  if (M.structure === 'NOT_IN_COVERAGE') return { id: 'OWNERSHIP', text: bi('מבנה הבעלות: חברות אם, בנות ו-SPV', 'the ownership structure: parents, subsidiaries and SPVs'), cls: 'MISSING' };
  if (spv.unresolved) return { id: 'PROJECT_COMPANIES', text: bi(`${spv.unresolved} חברות פרויקט לא מזוהות`, `${spv.unresolved} project companies not identified`), cls: 'MISSING' };
  return { id: 'EXECUTION', text: bi(`ראיות ביצוע ל-${load.withoutLaterEvidence.total} פרויקטים`, `execution evidence for ${load.withoutLaterEvidence.total} projects`), cls: 'MISSING' };
}
function headlinesOf({ M, rows, stages, load, history, signals, geo, programme, land, fin, legal, spv, nbe, today, excludedTotals = null, cohortEvidence = null }) {
  const T = rows.filter(inTotals), ila = T.filter((r) => r.universe === 'ila'), moch = T.filter((r) => r.universe === 'moch');
  const units = (xs) => { const k = xs.filter((r) => r.units != null); return k.length ? sum(k.map((r) => r.units)) : null; };
  const done = (u) => stages[u].buckets.COMPLETION.n + stages[u].buckets.OCCUPANCY.n;
  const hasCore = !!(M.core && M.core.company);
  const anchorBrand = M.anchor.devId ? [...M.brands.values()].find((b) => b.dev.id === M.anchor.devId) : null;
  /* the group's name: the legal core, else the brand — never a project label (independent review 19.10.2026) */
  const groupName = hasCore ? M.core.company.name : anchorBrand ? anchorBrand.dev.name : M.anchor.name;
  const exp = mainExposureOf({ legal, signals, geo, fin, load }), unk = mainUnknownOf({ M, fin, spv, load }), nx = nbe.items[0];
  const pp = fin.publicPrivate;
  const sharedRows = rows.filter((r) => r.tier === 'SHARED');
  const ex = excludedTotals && (excludedTotals.lots || excludedTotals.lotteryProjects) ? excludedTotals : null;
  const exTxt = ex ? bi(` (+${ex.lots} מגרשים${ex.lotteryProjects ? ` ו-${ex.lotteryProjects} פרויקטי הגרלה` : ''} תחת ${ex.brands} כתיבים אפשריים — לא נספרים)`, ` (+${ex.lots} lots${ex.lotteryProjects ? ` and ${ex.lotteryProjects} lottery projects` : ''} under ${ex.brands} possible spelling(s) — not counted)`) : bi('', '');
  const groupCls = !hasCore ? 'OBSERVED' : M.status === 'LEGAL_CORE_VERIFIED' ? 'OFFICIAL' : M.status === 'LEGAL_CORE_USER_KEY' ? 'USER_ASSUMPTION' : 'DERIVED';
  const groupTxt = M.status === 'JOINT_AWARD_ONLY'
    ? bi(`זכייה משותפת — לא קבוצה אחת: ${groupName} · ${(M.shared || []).filter((x) => x.number).length} צדדים נפתרו, לכל אחד קבוצה משלו`, `Joint award — not one group: ${groupName} · ${(M.shared || []).filter((x) => x.number).length} part(ies) resolved, each with its own group`)
    : bi(`${groupName}${hasCore ? ` · ח.פ. ${M.core.company.number}` : ''} · ${STATUS[M.status].he}`, `${groupName}${hasCore ? ` · company ${M.core.company.number}` : ''} · ${STATUS[M.status].en}`);
  const portTxt = M.status === 'JOINT_AWARD_ONLY'
    ? bi(`${sharedRows.length} פרויקטים בזכייה המשותפת — משותפים, לא נספרים לאף צד`, `${sharedRows.length} project(s) in the joint award — shared, counted for no party`)
    : bi(`${ila.length} מגרשי רמ״י${units(ila) != null ? ` (${fmt(units(ila))} יח״ד קיבולת)` : ''} · ${moch.length} פרויקטי הגרלה${units(moch) != null ? ` (${fmt(units(moch))} יח״ד בהגרלה ראשונה)` : ''} — שני יקומים, לא מחוברים${exTxt.he}`, `${ila.length} ILA lots${units(ila) != null ? ` (${fmt(units(ila))} units of capacity)` : ''} · ${moch.length} lottery projects${units(moch) != null ? ` (${fmt(units(moch))} first-lottery units)` : ''} — two universes, never added${exTxt.en}`);
  /* execution — with its coverage context, so "0" never reads as "builds nothing" and stale rows never read as live sites */
  const E = load.executionEvidence, ctr = M.contractor;
  const cov = cohortEvidence && cohortEvidence.startShare != null ? bi(` · כיסוי: תחילות מתוארכות רק מדיווחי משב״ש עד ${load.consAsOf} ומתל אביב; בכלל המגרשים רק ${pct(cohortEvidence.startShare)} מראים תחילה`, ` · coverage: dated starts only from MoCH reports to ${load.consAsOf} and Tel Aviv; across all lots only ${pct(cohortEvidence.startShare)} show a start`) : bi('', '');
  const ctrTxt = ctr && ctr.activeSitesAsExecutor ? bi(` · בנפרד: החברה רשומה כקבלן מבצע ב-${ctr.activeSitesAsExecutor} אתרים פעילים של משרד העבודה (לא מקושרים למגרש, לא נספרים)`, ` · separately: the company is the registered executing contractor on ${ctr.activeSitesAsExecutor} active Ministry of Labour sites (not linked to a lot, not counted)`) : bi('', '');
  const stale = E.staleOnly ? bi(` (${E.staleOnly} מהם רק בדיווחי משב״ש עד ${load.consAsOf})`, ` (${E.staleOnly} of them only in MoCH reports to ${load.consAsOf})`) : bi('', '');
  const execTxt = bi(`${E.lots} מגרשים מקושרים לראיית התחלה ללא ראיה לגמר${stale.he} · ${E.current} באתר פעיל נוכחי · ${done('ila')} מגרשים ו-${done('moch')} פרויקטי הגרלה עם ראיה לגמר / אכלוס${cov.he}${ctrTxt.he}`, `${E.lots} lots linked to start evidence with no completion evidence${stale.en} · ${E.current} on a current active site · ${done('ila')} lots and ${done('moch')} lottery projects with completion / occupancy evidence${cov.en}${ctrTxt.en}`);
  /* five lines: group · portfolio · execution · main exposure · main unknown → what to verify next */
  const firstRead = [
    { id: 'group', label: bi('קבוצה', 'GROUP'), cls: groupCls, text: groupTxt, term: 'group_identity_status' },
    { id: 'portfolio', label: bi('תיק נצפה', 'OBSERVED PORTFOLIO'), cls: 'OBSERVED', text: portTxt, term: 'observed_portfolio' },
    { id: 'execution', label: bi('ביצוע', 'EXECUTION'), cls: 'DERIVED', text: execTxt, term: 'observed_execution_load' },
    { id: 'exposure', label: bi('חשיפה עיקרית שנצפתה', 'MAIN OBSERVED EXPOSURE'), cls: exp.cls, text: exp.text, term: 'group_main_exposure' },
    { id: 'unknown', label: bi('נעלם עיקרי → מה לבדוק', 'MAIN UNKNOWN → VERIFY NEXT'), cls: unk.cls, text: nx ? bi(`${unk.text.he} → ${nx.text.he}`, `${unk.text.en} → ${nx.text.en}`) : unk.text, term: 'group_main_unknown' },
  ];
  const earlyL = load.earlyStage.lots, earlyM = load.earlyStage.lotteryProjects;
  const geoTop = geo.top3[0], gl = geo.topLottery;
  const lead = geoTop && geoTop.ila ? bi(`${geoTop.city || geoTop.localityCode} מובילה במגרשים (${geoTop.ila})`, `${geoTop.cityEn || geoTop.city || geoTop.localityCode} leads by lots (${geoTop.ila})`) : null;
  const leadL = gl ? bi(`${gl.city} מובילה בפרויקטי הגרלה (${gl.moch})`, `${gl.cityEn || gl.city} leads by lottery projects (${gl.moch})`) : null;
  const geoA = lead || leadL ? bi([lead && lead.he, leadL && leadL.he].filter(Boolean).join(' · ') + (geo.largestCityUnitsShare ? `; ${pct(geo.largestCityUnitsShare.share)} מיח״ד המגרשים ב${geo.largestCityUnitsShare.city}` : ''), [lead && lead.en, leadL && leadL.en].filter(Boolean).join(' · ') + (geo.largestCityUnitsShare ? `; ${pct(geo.largestCityUnitsShare.share)} of lot units in ${geo.largestCityUnitsShare.cityEn || geo.largestCityUnitsShare.city}` : '')) : bi('—', '—');
  const oneMinute = [
    { q: bi('מהי הקבוצה?', 'WHAT IS THIS GROUP?'), a: firstRead[0].text, cls: firstRead[0].cls, term: 'sponsor_xray' },
    { q: bi('עד כמה מבנה הקבוצה ודאי?', 'HOW CERTAIN IS THE GROUP STRUCTURE?'), a: bi(`${STATUS[M.status].he}. ${STRUCTURE[M.structure].he}. ${M.excluded.length} ישויות אפשריות אינן נספרות.`, `${STATUS[M.status].en}. ${STRUCTURE[M.structure].en}. ${M.excluded.length} possible ${M.excluded.length === 1 ? 'entity is' : 'entities are'} not counted.`), cls: 'DERIVED', term: 'group_identity_status' },
    { q: bi('כמה גדולה הצנרת הנצפית?', 'HOW LARGE IS ITS OBSERVED PIPELINE?'), a: firstRead[1].text, cls: 'OBSERVED', term: 'observed_portfolio' },
    { q: bi('היכן היא מרוכזת?', 'WHERE IS IT CONCENTRATED?'), a: geoA, cls: 'DERIVED', term: 'group_geographic_concentration' },
    { q: bi('כמה מהצנרת בשלב מוקדם?', 'HOW MUCH OF THE PIPELINE IS EARLY STAGE?'), a: bi(`${earlyL} מגרשים בשלב קרקע ו-${earlyM} פרויקטי הגרלה בשלב שיווק (פחות מ-18 חודשים) · ${load.withoutLaterEvidence.total} ללא ראיה ציבורית מאוחרת (${load.withoutLaterEvidence.gapRuleFires} בכיסוי שיכול היה להראות ראיה; ${load.withoutLaterEvidence.coverageGap} — פער כיסוי)`, `${earlyL} lots at the land stage and ${earlyM} lottery projects at marketing (under 18 months) · ${load.withoutLaterEvidence.total} without later public evidence (${load.withoutLaterEvidence.gapRuleFires} where a covered source could show it; ${load.withoutLaterEvidence.coverageGap} — a coverage gap)`), cls: 'DERIVED', term: 'stage_distribution' },
    { q: bi('כמה כבר בביצוע?', 'HOW MUCH IS ALREADY UNDER EXECUTION?'), a: execTxt, cls: 'DERIVED', term: 'observed_execution_load' },
    { q: bi('מה היזם השלים בפועל?', 'WHAT HAS THE DEVELOPER ACTUALLY COMPLETED?'), a: bi(`${done('ila')} מגרשים עם ראיה לגמר / אכלוס · ${done('moch')} פרויקטי הגרלה באכלוס — נשען על דיווחי משב״ש (עד ${load.consAsOf}) ותל אביב`, `${done('ila')} lots with completion / occupancy evidence · ${done('moch')} lottery projects at occupancy — rests on MoCH reports (to ${load.consAsOf}) and Tel Aviv`), cls: 'DERIVED', term: 'completion_evidence' },
    { q: bi('מהי החשיפה העיקרית שנצפתה?', 'WHAT IS THE MAIN OBSERVED EXPOSURE?'), a: exp.text, cls: exp.cls, term: 'group_main_exposure' },
    { q: bi('מה הנעלם החשוב ביותר?', 'WHAT IS THE MOST IMPORTANT UNKNOWN?'), a: unk.text, cls: unk.cls, term: 'group_main_unknown' },
  ];
  const legalFlags = legal.entities.filter((e) => e.inCoverage).map((e) => ({ number: e.number, name: e.name, status: e.status ? e.status.verbatim : null, statusObj: e.status || null, statusCls: e.status ? e.status.cls : null, breach: e.breach ? e.breach.flag : false, charges: { registered: e.charges.registered, removed: e.charges.removed, window: e.charges.window || null }, openInsolvency: e.openInsolvencyRecords, dissolvedByCourt: e.dissolvedByCourt || null, strikeOff: e.strikeOff }));
  /* the leading programme per universe — lots and lottery projects are never added (independent review 19.10.2026) */
  const topOf = (u) => programme.rows.filter((r) => r.available && r.id !== 'STATE_LAND' && r[u] && r[u].n).map((r) => ({ id: r.id, label: PROGRAMMES[r.id], n: r[u].n })).sort((a, b) => b.n - a.n)[0] || null;
  const top = {
    group: { name: groupName, anchor: M.anchor }, identityStatus: { code: M.status, label: STATUS[M.status], structure: M.structure, structureLabel: STRUCTURE[M.structure] },
    coreLegalEntity: hasCore ? { number: M.core.company.number, name: M.core.company.name, status: M.core.company.status, linkState: M.core.linkState || null, userProvided: !!M.core.userProvided } : null,
    publicPrivate: pp, observedProjects: { ila: ila.length, moch: moch.length }, observedUnits: { ila: units(ila), moch: units(moch) }, excludedTotals: ex, sharedProjects: sharedRows.length,
    activeProjects: load.openRecords, activeConstructionEvidence: { lots: E.lots, current: E.current, staleOnly: E.staleOnly, startEvidenceOnly: E.startEvidenceOnly, contractorSites: ctr ? ctr.activeSitesAsExecutor : null, nationalStartShare: cohortEvidence ? cohortEvidence.startShare : null },
    completionEvidence: { ila: done('ila'), moch: done('moch') }, landPipeline: { m36: land.windows.m36, latestAward: land.latestAward },
    geographicExposure: { top: geo.top3, topLottery: geo.topLottery, largestCityUnitsShare: geo.largestCityUnitsShare }, programmeExposure: { ila: topOf('ila'), moch: topOf('moch') },
    financialCoverage: { cls: fin.coverage, reporting: fin.reporting, statement: fin.statement }, legalFlags,
    mainExposure: exp, mainEvidenceGap: unk, verifyNext: nx ? { id: nx.id, text: nx.text, doc: nx.doc } : null,
  };
  return { firstRead, oneMinute, top };
}

module.exports = { legalOf, groupTimeline, briefOf, nextBestOf, spvOf, headlinesOf, mainExposureOf, mainUnknownOf, NBE, CATS, TRUTHS, BUCKET_IDS, STAGE_BUCKETS, RULES };
