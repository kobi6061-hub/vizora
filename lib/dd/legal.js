// PROPX · LEGAL EXPOSURE — PUBLICLY DISCLOSED ONLY (Premium Diligence 2.0, 18.10.2026).
//
// What PROPX can state, by exact company number: the Official Receiver's liquidation cases, the registry status and
// sub-status (an order opening proceedings, rehabilitation, an arrangement, court / voluntary liquidation), the fast-track
// voluntary-liquidation list, the Registrar's companies-designated-for-strike-off list (NEW, lane "strikeoff"), attachment-
// order filings — plus what a user document discloses (a lawsuit, a class action, a regulatory proceeding, a dispute).
// Civil litigation has NO open defendant-level source (the class-actions registry is an HTML search; court records are a
// login service): ABSENCE OF A PUBLIC ROW ≠ NO LITIGATION. A lien / attachment ≠ insolvency; a designation for strike-off
// ≠ insolvency; voluntary liquidation ≠ insolvency.
'use strict';

const UD = require('./userdocs');
const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-dd-legal-exposure-v1', effective: '2026-10-18' });
const KIND = Object.freeze({
  INSOLVENCY_PROCEEDING: bi('הליך חדלות פירעון (לפי סטטוס הרשם)', 'insolvency proceeding (per the registry status)'),
  LIQUIDATION_CASE: bi('תיק פירוק בקובץ הכונס הרשמי', 'a liquidation case in the Official Receiver\'s file'),
  COURT_LIQUIDATION_STATUS: bi('סטטוס פירוק בבית משפט ברשם', 'a court-liquidation status in the registry'),
  VOLUNTARY_LIQUIDATION: bi('פירוק מרצון (החלטת בעלי מניות — לא חדלות פירעון)', 'voluntary liquidation (a shareholder decision — not insolvency)'),
  STRIKE_OFF_DESIGNATION: bi('ייעוד למחיקה ברשם (ייעוד ≠ מחיקה; לא חדלות פירעון)', 'designated for strike-off by the Registrar (designation ≠ strike-off; not insolvency)'),
  ATTACHMENT_ORDER: bi('בקשה בנושא צו עיקול — הוספה / עדכון / הסרה (המקור אינו מבחין; עיקול ≠ חדלות פירעון)', 'a filing about an attachment order — add / update / remove (the source does not say which; attachment ≠ insolvency)'),
  DISCLOSED_LITIGATION: bi('הליך משפטי שגולה במסמך', 'a proceeding disclosed in a document'),
});
const COVERAGE = Object.freeze({
  insolvency: { state: 'COVERED_BY_NUMBER', label: bi('פירוק / חדלות פירעון — לפי מספר החברה (רשמי)', 'liquidation / insolvency — by company number (official)') },
  strikeOff: { state: 'COVERED_BY_NUMBER', label: bi('ייעוד למחיקה — לפי מספר החברה (רשמי)', 'strike-off designation — by company number (official)') },
  civil: { state: 'NOT_IN_COVERAGE', label: bi('תביעות אזרחיות / ייצוגיות — אין מקור פתוח ברמת הנתבע; היעדר שורה ≠ היעדר הליך', 'civil / class-action litigation — no open defendant-level source; NO COURT ROW ≠ NO LITIGATION') },
  regulatory: { state: 'NOT_IN_COVERAGE', label: bi('הליכים רגולטוריים — אין מקור פתוח', 'regulatory proceedings — no open source') },
});
const isOpenCase = (c) => !c.closed && !c.stayDate && !c.closeReason && !/סגור|ביטול|עיכוב|נמחקה|חיסול/.test(String(c.status || ''));

/** one company's publicly disclosed legal exposure (+ the user's disclosures) */
function legalExposure({ companyNumber = null, corporate = null, cache = null, userDocs = [] } = {}) {
  const items = [], num = companyNumber ? String(companyNumber) : null;
  /* a live read whose lanes did not answer: those lanes are NOT CHECKED — never "no row" */
  const liveRec = num && cache && cache.live ? cache.live.get(num) : null;
  const notChecked = liveRec ? Object.entries(liveRec.answered).filter(([k, v]) => !v && k !== 'companies').map(([k]) => k) : [];
  if (num && cache) {
    for (const c of cache.liquidationByNum.get(num) || []) items.push({ kind: 'LIQUIDATION_CASE', label: KIND.LIQUIDATION_CASE, status: c.status, open: isOpenCase(c), dates: { requested: c.requested || null, order: c.orderDate || null, stay: c.stayDate || null, closed: c.closed || null }, court: c.court || null, caseId: c.caseId, source: 'datagov:moj:official-receiver:liquidation', cls: 'OFFICIAL' });
    for (const v of cache.voluntaryByNum.get(num) || []) items.push({ kind: 'VOLUNTARY_LIQUIDATION', label: KIND.VOLUNTARY_LIQUIDATION, status: v.sub || v.status || null, dates: { approved: v.approved || null }, source: 'datagov:ica:voluntary-liquidation-fast-track', cls: 'OFFICIAL' });
    const so = cache.strikeOffByNum ? cache.strikeOffByNum.get(num) : null;
    if (so) items.push({ kind: 'STRIKE_OFF_DESIGNATION', label: KIND.STRIKE_OFF_DESIGNATION, status: [so.status, so.sub].filter(Boolean).join(' · '), dates: { published: so.published || null, expected: so.expected || null }, source: 'datagov:ica:designated-strike-off', cls: 'OFFICIAL' });
    for (const f of (cache.filingsByNum.get(num) || []).filter((x) => /צו עיקול/.test(x.kind))) items.push({ kind: 'ATTACHMENT_ORDER', label: KIND.ATTACHMENT_ORDER, status: String(f.kind).replace(/~/g, '"'), dates: { filed: f.date || null }, source: 'datagov:ica:changes', cls: 'OFFICIAL' });
  }
  if (corporate && corporate.state === 'RESOLVED') {
    const cls = corporate.registeredStatus && corporate.registeredStatus.cls;
    if (cls === 'INSOLVENCY_PROCEEDINGS' || cls === 'ARRANGEMENT_OR_PROVISIONAL_LIQUIDATION') items.push({ kind: 'INSOLVENCY_PROCEEDING', label: KIND.INSOLVENCY_PROCEEDING, status: [corporate.registeredStatus.verbatim, corporate.registeredStatus.sub].filter(Boolean).join(' · '), dates: {}, source: 'datagov:ica:companies', cls: 'OFFICIAL' });
    if (cls === 'IN_COURT_LIQUIDATION' || cls === 'DISSOLVED_BY_COURT') items.push({ kind: 'COURT_LIQUIDATION_STATUS', label: KIND.COURT_LIQUIDATION_STATUS, status: corporate.registeredStatus.verbatim, dates: {}, source: 'datagov:ica:companies', cls: 'OFFICIAL' });
  }
  for (const d of UD.concerning(userDocs, { companyNumbers: num ? [num] : [] }).filter((x) => x.type === 'litigation_disclosure'))
    items.push({ kind: 'DISCLOSED_LITIGATION', label: KIND.DISCLOSED_LITIGATION, subKind: d.fields.kind, status: d.fields.status || null, court: d.fields.court || null, caseNumber: d.fields.caseNumber || null, amount: d.fields.amount ?? null, currency: d.fields.currency || null, material: d.fields.material || 'not-stated', dates: { asOf: d.fields.asOf }, source: 'user-document', cls: 'USER_DOCUMENT', document: { id: d.id, date: d.docDate, provenance: d.provenance } });
  const openOfficial = items.filter((i) => i.cls === 'OFFICIAL' && (i.kind === 'INSOLVENCY_PROCEEDING' || i.kind === 'COURT_LIQUIDATION_STATUS' || (i.kind === 'LIQUIDATION_CASE' && i.open)));
  const userInsolvency = items.filter((i) => i.kind === 'DISCLOSED_LITIGATION' && (i.subKind === 'insolvency' || i.subKind === 'receivership'));
  const userNote = userInsolvency.length ? bi(` · מסמך המשתמש מגלה הליך ${userInsolvency.map((i) => (i.subKind === 'insolvency' ? 'חדלות פירעון' : 'כינוס נכסים')).join(' / ')} (מסמך משתמש)`, ` · the user's document discloses ${userInsolvency.map((i) => (i.subKind === 'insolvency' ? 'an insolvency' : 'a receivership')).join(' / ')} proceeding (USER DOCUMENT)`) : bi('', '');
  const ncNote = notChecked.length ? bi(` · לא נבדק (הבדיקה החיה לא נענתה): ${notChecked.join(', ')}`, ` · not checked (the live lookup did not answer): ${notChecked.join(', ')}`) : bi('', '');
  const st = (x) => (x ? bi(x.he + userNote.he + ncNote.he, x.en + userNote.en + ncNote.en) : x);
  return { version: VERSION, companyNumber: num, items, coverage: COVERAGE, notChecked, checkedAt: liveRec ? liveRec.checkedAt : null, userDisclosedInsolvency: userInsolvency.length,
    statement: st(!num ? bi('אין חברה רשומה פתורה — אין חשיפה משפטית לבדוק לפי מספר', 'no resolved legal company — no exposure to check by number')
      : openOfficial.length ? bi(`${openOfficial.length} רשומות רשמיות פתוחות של חדלות פירעון / פירוק — כפי שהמקור כותב`, `${openOfficial.length} open official insolvency / liquidation records — as the source writes them`)
      : items.length ? bi('רשומות רשמיות / גילויים — ראו פירוט; אין רשומה רשמית של הליך חדלות פירעון פתוח', 'official records / disclosures — see the list; no OFFICIAL record of an open insolvency proceeding')
      : notChecked.length ? bi('לא נמצאה רשומה במקורות שנענו — חלק מהמקורות לא נבדקו', 'no row in the sources that answered — some sources were not checked')
      : bi('לא נמצאה רשומה במקורות הפתוחים לפי מספר החברה — היעדר שורה ציבורית ≠ היעדר הליכים', 'no row in the open sources by company number — ABSENCE OF A PUBLIC ROW ≠ NO LITIGATION')),
    notA: [bi('היעדר שורה ציבורית ≠ היעדר הליכים', 'ABSENCE OF A PUBLIC ROW ≠ NO LITIGATION'), bi('עיקול / שעבוד ≠ חדלות פירעון', 'A LIEN / ATTACHMENT ≠ INSOLVENCY'), bi('ייעוד למחיקה ≠ חדלות פירעון', 'A STRIKE-OFF DESIGNATION ≠ INSOLVENCY')] };
}

module.exports = { VERSION, KIND, COVERAGE, legalExposure, isOpenCase };
