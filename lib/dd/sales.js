// PROPX · SALES / COMMERCIAL PROGRESS (Premium Diligence 2.0, 18.10.2026).
//
// Source audit: no government source publishes project-level sales; developer-reported project tables live in public
// filings (MAYA / MAGNA — blocked). What PROPX can show, each in its own class and never mixed:
//   OFFICIAL         the programme record (MoCH lotteries): units OFFERED in each lottery, applicants, winners — offered ≠
//                    sold, winners ≠ signed contracts; the ILA tender's units — capacity, not marketed units
//   DEVELOPER_REPORTED / USER_DOCUMENT  a sales report the user provides (units planned / marketed / sold / remaining,
//                    presales, average price) — labelled by who reported it; never an independent government record
//   DERIVED          a sales rate only between two dated user reports of the same project
//   MISSING          everything else (signed contracts, presales, delivery) — "—", never 0
// DEVELOPER-REPORTED SALES ≠ OFFICIAL SALES · MARKETING CLAIM ≠ VERIFIED FACT · no official transaction is read here.
'use strict';

const UD = require('./userdocs');
const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-dd-sales-v1', effective: '2026-10-18' });
const monthsBetween = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / (86400e3 * 30.4375);

function salesProgress({ project, userDocs = [] } = {}) {
  const p = project || {}, rows = [];
  if (p.kind === 'moch-lottery-project') for (const l of p.lotteries || []) rows.push({ kind: 'PROGRAMME_LOTTERY', cls: 'OFFICIAL', source: 'datagov:moch:dira-behanacha-lotteries', date: l.date || null,
    unitsOffered: l.units ?? null, applicants: l.applicants ?? null, winners: l.winners ?? null, lotteryType: l.type || null,
    note: bi('יח״ד שהוצעו בהגרלה ≠ יח״ד שנמכרו; זוכים ≠ חוזים חתומים', 'units offered in a lottery ≠ units sold; winners ≠ signed contracts') });
  if (p.kind === 'ila-awarded-lot' && p.units != null) rows.push({ kind: 'TENDER_UNITS', cls: 'OFFICIAL', source: 'rmi:michrazim', date: p.decisionDate || null, unitsPlanned: p.units, note: bi('יח״ד במכרז = קיבולת — לא יח״ד ששווקו או נמכרו', 'tender units = capacity — not units marketed or sold') });
  const reports = UD.concerning(userDocs, { projectId: p.id }).filter((d) => d.type === 'sales_report').sort((a, b) => (a.fields.asOf < b.fields.asOf ? -1 : 1));
  for (const d of reports) { const f = d.fields;
    rows.push({ kind: 'SALES_REPORT', cls: 'USER_DOCUMENT', reportedBy: f.reportedBy, classLabel: f.reportedBy === 'developer' ? bi('דיווח היזם · מסמך משתמש', 'DEVELOPER-REPORTED · USER DOCUMENT') : f.reportedBy === 'public-filing' ? bi('דיווח בפרסום ציבורי · מסמך משתמש', 'PUBLIC FILING · USER DOCUMENT') : bi('מסמך משתמש', 'USER DOCUMENT'),
      source: 'user-document', date: f.asOf, unitsPlanned: f.unitsPlanned ?? null, unitsMarketed: f.unitsMarketed ?? null, unitsSold: f.unitsSold ?? null, unitsRemaining: f.unitsRemaining ?? null,
      presalesAmount: f.presalesAmount ?? null, avgPricePerUnit: f.avgPricePerUnit ?? null, currency: f.currency || null, deliveryDate: f.deliveryDate || null, recognition: f.recognition || null,
      document: { id: d.id, date: d.docDate, provenance: d.provenance },
      consistency: f.unitsSold != null && f.unitsMarketed != null && f.unitsSold > f.unitsMarketed ? bi('נמכרו יותר ממה ששווק — לא עקבי במסמך', 'more sold than marketed — inconsistent within the document') : null,
      note: bi('נתון שדווח (לא רישום ממשלתי בלתי תלוי) — לא עסקאות רשמיות', 'a reported figure (not an independent government record) — not official transactions') }); }
  let rate = null;
  const withSold = reports.filter((d) => d.fields.unitsSold != null);
  if (withSold.length >= 2) { const a = withSold[0], b = withSold[withSold.length - 1]; const m = monthsBetween(a.fields.asOf, b.fields.asOf);
    rate = m >= 1 ? { cls: 'DERIVED', value: Math.round(((b.fields.unitsSold - a.fields.unitsSold) / m) * 10) / 10, unit: 'units / month', formula: '(units sold at the later report − at the earlier) ÷ months between the reports', inputs: [{ id: a.id, asOf: a.fields.asOf, unitsSold: a.fields.unitsSold }, { id: b.id, asOf: b.fields.asOf, unitsSold: b.fields.unitsSold }], basis: 'two user-provided sales reports of the same project' }
      : { cls: 'DERIVED', value: null, reason: bi('פחות מחודש בין הדוחות', 'less than a month between the reports') }; }
  const missing = [];
  if (!reports.length) missing.push({ id: 'sales-progress', he: 'יח״ד שנמכרו / מכירות מוקדמות / מועד מסירה — אין מקור ציבורי; ניתן להוסיף דוח מכירות', en: 'units sold / presales / delivery — no public source; a sales report can be added' });
  return { version: VERSION, rows, rate, missing,
    statement: reports.length ? bi('נתוני מכירות מדוח שסיפק המשתמש — מסווגים לפי המדווח; אינם עסקאות רשמיות', 'sales figures from a report the user provided — classed by who reported them; not official transactions')
      : bi('אין ל-PROPX נתוני מכירות ברמת הפרויקט — המקורות הציבוריים אינם מפרסמים אותם', 'PROPX has no project-level sales data — public sources do not publish it'),
    notA: [bi('מכירות שדווחו על ידי היזם ≠ מכירות רשמיות', 'DEVELOPER-REPORTED SALES ≠ OFFICIAL SALES'), bi('טענה שיווקית ≠ עובדה מאומתת', 'MARKETING CLAIM ≠ VERIFIED FACT'), bi('הגרלה ≠ מכירה', 'A LOTTERY ≠ A SALE')] };
}

module.exports = { VERSION, salesProgress };
