// PROPX · USER-PROVIDED EVIDENCE (Premium Diligence 2.0, 18.10.2026) — the documents public sources cannot supply: audited
// financial statements, an ownership chart, a permit, a bank guarantee, a sales report, a financing agreement, an appraisal,
// a land-rights document, a company extract, a bond covenant schedule, a purchase agreement, a developer declaration, a
// litigation disclosure.
//
// Truth rules (enforced here and by test/dd-premium.test.js):
//   • USER-UPLOADED DOCUMENT ≠ OFFICIAL SOURCE — every fact carries class USER_DOCUMENT and its provenance; nothing here is
//     ever relabelled official, and a document never overrides an official record (a disagreement is a CONFLICT, both shown).
//   • PROPX does not read PDFs and calls no model: the user enters the key facts (or imports the CSV template); the file
//     itself never leaves the browser — PROPX keeps its SHA-256 fingerprint, name, size and type as provenance.
//   • A company number in a document is checked against the registry (a row with that number and a consistent name), and
//     the result is said — the document is still the document's claim.
//   • Every document carries its date; facts older than the latest official evidence are shown with both dates.
//
// UMD: the page (window.PropxUserDocs) validates before storing; the server re-validates whatever the page sends.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PropxUserDocs = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const bi = (he, en) => ({ he, en });
  const VERSION = Object.freeze({ id: 'propx-dd-user-documents-v1', effective: '2026-10-18' });
  const CLASS = 'USER_DOCUMENT';
  const MAX_DOCS = 60, MAX_TEXT = 600, MAX_LIST = 40;

  /* field kinds: text · date (yyyy-mm-dd) · amount (finite number, the document's own units) · int · percent (0..100) ·
     companyNumber (8–9 digits) · bool · enum · list (of a sub-schema) */
  const F = (k, kind, he, en, o = {}) => Object.freeze({ k, kind, label: bi(he, en), ...o });
  const AMOUNTS = [
    ['cash', 'מזומנים ושווי מזומנים', 'cash and cash equivalents'], ['restrictedCash', 'מזומנים מוגבלים', 'restricted cash'],
    ['shortTermDebt', 'אשראי לזמן קצר (כולל חלויות שוטפות)', 'short-term debt (incl. current maturities)'], ['longTermDebt', 'הלוואות ואג״ח לזמן ארוך', 'long-term loans and bonds'],
    ['totalFinancialDebt', 'סך החוב הפיננסי (כפי שדווח)', 'total financial debt (as reported)'], ['netDebt', 'חוב נטו (כפי שדווח)', 'net debt (as reported)'],
    ['nearTermDebt', 'חוב לפירעון תוך 12 חודשים', 'debt maturing within 12 months'], ['bondBalance', 'יתרת אג״ח (רכיב של החוב — לא תוספת)', 'bond balance (a component of debt — never added)'],
    ['equity', 'הון עצמי', 'equity'], ['totalAssets', 'סך הנכסים', 'total assets'], ['currentAssets', 'נכסים שוטפים', 'current assets'], ['currentLiabilities', 'התחייבויות שוטפות', 'current liabilities'],
    ['inventoryWip', 'מלאי / בנייה בתהליך', 'inventory / work in progress'], ['customerAdvances', 'מקדמות מלקוחות', 'customer advances'],
    ['revenue', 'הכנסות', 'revenue'], ['grossProfit', 'רווח גולמי', 'gross profit'], ['operatingProfit', 'רווח תפעולי', 'operating profit'], ['financeExpenses', 'הוצאות מימון', 'finance expenses'],
    ['operatingCashFlow', 'תזרים מפעילות שוטפת', 'operating cash flow'], ['investingCashFlow', 'תזרים מפעילות השקעה', 'investing cash flow'], ['financingCashFlow', 'תזרים מפעילות מימון', 'financing cash flow'],
  ];
  const TYPES = Object.freeze({
    financial_statements: { label: bi('דוחות כספיים', 'Financial statements'), resolves: ['financials'], fields: [
      F('entityNumber', 'companyNumber', 'מספר החברה המדווחת', 'reporting company number', { req: true }),
      F('entityName', 'text', 'שם החברה המדווחת', 'reporting company name'),
      F('periodEnd', 'date', 'סוף התקופה', 'period end', { req: true }),
      F('periodKind', 'enum', 'סוג התקופה', 'period kind', { req: true, values: ['annual', 'half', 'quarter'] }),
      F('reportDate', 'date', 'תאריך הדוח', 'report date', { req: true }),
      F('audited', 'enum', 'ביקורת', 'assurance', { req: true, values: ['audited', 'reviewed', 'unaudited'] }),
      F('basis', 'enum', 'בסיס', 'basis', { req: true, values: ['consolidated', 'separate'] }),
      F('currency', 'enum', 'מטבע', 'currency', { req: true, values: ['ILS', 'USD', 'EUR'] }),
      F('units', 'enum', 'יחידות', 'units', { req: true, values: ['units', 'thousands', 'millions'] }),
      F('restated', 'bool', 'מוצג מחדש (הצגה מחדש של תקופה קודמת)', 'restated (a re-presented period)'),
      ...AMOUNTS.map(([k, he, en]) => F(k, 'amount', he, en)),
      F('goingConcern', 'bool', 'הערת "עסק חי" / ספק להמשך פעילות מופיעה', 'going-concern language present'),
      F('goingConcernText', 'text', 'נוסח הערת עסק חי', 'going-concern wording'),
      F('auditorEmphasis', 'text', 'הפניית תשומת לב של רואה החשבון', 'auditor emphasis of matter'),
      F('covenantNotes', 'text', 'אמות מידה פיננסיות — גילוי', 'covenant disclosures'),
      F('refinancingNotes', 'text', 'מחזור חוב מהותי — גילוי', 'material refinancing disclosure'),
      F('creditRating', 'text', 'דירוג אשראי', 'credit rating'), F('ratingAgency', 'enum', 'חברת דירוג', 'rating agency', { values: ['maalot', 'midroog', 'other'] }),
      F('ratingOutlook', 'enum', 'אופק דירוג', 'rating outlook', { values: ['positive', 'stable', 'negative', 'developing', 'watch-negative', 'watch-positive'] }), F('ratingDate', 'date', 'תאריך הדירוג', 'rating date'),
    ] },
    ownership_chart: { label: bi('תרשים אחזקות', 'Ownership chart'), resolves: ['ownership', 'parent'], fields: [
      F('asOf', 'date', 'נכון לתאריך', 'as of', { req: true }),
      F('relations', 'list', 'קשרי אחזקה', 'holdings', { req: true, of: [F('parentNumber', 'companyNumber', 'מספר החברה המחזיקה', 'holder company number', { req: true }), F('parentName', 'text', 'שם המחזיקה', 'holder name'), F('childNumber', 'companyNumber', 'מספר החברה המוחזקת', 'held company number', { req: true }), F('childName', 'text', 'שם המוחזקת', 'held company name'), F('sharePct', 'percent', 'שיעור אחזקה %', 'share %')] }),
    ] },
    company_extract: { label: bi('נסח חברה', 'Company extract'), resolves: ['ownership', 'identity'], fields: [
      F('entityNumber', 'companyNumber', 'מספר החברה', 'company number', { req: true }), F('entityName', 'text', 'שם החברה', 'company name'), F('asOf', 'date', 'תאריך הנסח', 'extract date', { req: true }),
      F('shareholders', 'list', 'בעלי מניות', 'shareholders', { of: [F('name', 'text', 'שם', 'name', { req: true }), F('number', 'companyNumber', 'מספר חברה (אם תאגיד)', 'company number (if a company)'), F('sharePct', 'percent', '%', '%')] }),
      F('officers', 'text', 'נושאי משרה', 'officers'),
    ] },
    permit: { label: bi('היתר בנייה', 'Building permit'), resolves: ['permit', 'projectCompany'], fields: [
      F('projectId', 'text', 'מזהה הפרויקט ב-PROPX', 'PROPX project id', { req: true }), F('municipality', 'text', 'רשות / ועדה מקומית', 'municipality / local committee', { req: true }),
      F('permitNumber', 'text', 'מספר היתר', 'permit number', { req: true }), F('requestNumber', 'text', 'מספר בקשה', 'request number'), F('issueDate', 'date', 'תאריך הוצאת ההיתר', 'issue date', { req: true }),
      F('holderName', 'text', 'בעל ההיתר', 'permit holder'), F('holderNumber', 'companyNumber', 'מספר החברה של בעל ההיתר', 'permit holder company number'),
      F('block', 'int', 'גוש', 'block'), F('parcel', 'int', 'חלקה', 'parcel'), F('units', 'int', 'יח״ד בהיתר', 'units in the permit'), F('startDate', 'date', 'תחילת עבודות (אם צוינה)', 'works start (if stated)'),
    ] },
    bank_guarantee: { label: bi('ערבות בנקאית', 'Bank guarantee'), resolves: ['guarantee', 'projectCompany'], fields: [
      F('projectId', 'text', 'מזהה הפרויקט ב-PROPX', 'PROPX project id'), F('bank', 'text', 'הבנק הערב', 'guarantor bank', { req: true }),
      F('kind', 'enum', 'סוג', 'kind', { req: true, values: ['sale-law', 'performance', 'ila', 'municipal', 'parent-company', 'other'] }),
      F('applicantName', 'text', 'מבקש הערבות (החייב)', 'applicant (obligor)', { req: true }), F('applicantNumber', 'companyNumber', 'מספר החברה של המבקש', 'applicant company number'),
      F('guarantorName', 'text', 'ערב שאינו בנק (אם קיים — למשל חברת אם)', 'non-bank guarantor (if any — e.g. a parent)'), F('guarantorNumber', 'companyNumber', 'מספר החברה של הערב', 'guarantor company number'),
      F('amount', 'amount', 'סכום', 'amount'), F('currency', 'enum', 'מטבע', 'currency', { values: ['ILS', 'USD', 'EUR'] }), F('issueDate', 'date', 'תאריך הוצאה', 'issue date', { req: true }), F('expiryDate', 'date', 'תוקף', 'expiry', { future: true }),
    ] },
    sales_report: { label: bi('דוח מכירות', 'Sales report'), resolves: ['sales'], fields: [
      F('projectId', 'text', 'מזהה הפרויקט ב-PROPX', 'PROPX project id', { req: true }), F('asOf', 'date', 'נכון לתאריך', 'as of', { req: true }),
      F('reportedBy', 'enum', 'מי דיווח', 'reported by', { req: true, values: ['developer', 'bank', 'appraiser', 'public-filing', 'other'] }),
      F('unitsPlanned', 'int', 'יח״ד מתוכננות', 'units planned'), F('unitsMarketed', 'int', 'יח״ד ששווקו', 'units marketed'), F('unitsSold', 'int', 'יח״ד שנמכרו (חוזים)', 'units sold (contracts)'), F('unitsRemaining', 'int', 'יח״ד שנותרו', 'units remaining'),
      F('presalesAmount', 'amount', 'היקף מכירות מוקדמות', 'presales amount'), F('avgPricePerUnit', 'amount', 'מחיר ממוצע ליח״ד', 'average price per unit'), F('currency', 'enum', 'מטבע', 'currency', { values: ['ILS', 'USD', 'EUR'] }),
      F('deliveryDate', 'date', 'מועד מסירה מתוכנן', 'planned delivery', { future: true }), F('recognition', 'text', 'הכרה בהכנסה (כפי שצוין)', 'revenue recognition (as stated)'),
    ] },
    financing_agreement: { label: bi('הסכם ליווי / מימון', 'Financing agreement'), resolves: ['financing', 'projectCompany'], fields: [
      F('projectId', 'text', 'מזהה הפרויקט ב-PROPX', 'PROPX project id'), F('lender', 'text', 'המלווה', 'lender', { req: true }),
      F('borrowerName', 'text', 'הלווה', 'borrower', { req: true }), F('borrowerNumber', 'companyNumber', 'מספר החברה של הלווה', 'borrower company number'),
      F('facilityAmount', 'amount', 'מסגרת', 'facility'), F('currency', 'enum', 'מטבע', 'currency', { values: ['ILS', 'USD', 'EUR'] }), F('signDate', 'date', 'תאריך חתימה', 'signing date', { req: true }), F('maturityDate', 'date', 'פירעון', 'maturity', { future: true }),
    ] },
    appraisal: { label: bi('שומה / הערכת שווי', 'Appraisal'), resolves: ['value'], fields: [
      F('projectId', 'text', 'מזהה הפרויקט ב-PROPX', 'PROPX project id', { req: true }), F('appraiser', 'text', 'השמאי', 'appraiser', { req: true }), F('asOf', 'date', 'מועד הקובע', 'valuation date', { req: true }),
      F('value', 'amount', 'שווי', 'value', { req: true }), F('currency', 'enum', 'מטבע', 'currency', { req: true, values: ['ILS', 'USD', 'EUR'] }), F('basis', 'text', 'בסיס השומה', 'basis of value'),
    ] },
    land_rights: { label: bi('מסמך זכויות במקרקעין', 'Land-rights document'), resolves: ['projectCompany', 'land'], fields: [
      F('projectId', 'text', 'מזהה הפרויקט ב-PROPX', 'PROPX project id', { req: true }), F('holderName', 'text', 'בעל הזכויות', 'rights holder', { req: true }), F('holderNumber', 'companyNumber', 'מספר החברה של בעל הזכויות', 'rights holder company number'),
      F('rightType', 'enum', 'סוג הזכות', 'right', { req: true, values: ['development-agreement', 'lease', 'ownership', 'other'] }), F('block', 'int', 'גוש', 'block'), F('parcel', 'int', 'חלקה', 'parcel'), F('date', 'date', 'תאריך', 'date', { req: true }),
    ] },
    bond_covenants: { label: bi('אמות מידה באג״ח', 'Bond covenant schedule'), resolves: ['financials'], fields: [
      F('entityNumber', 'companyNumber', 'מספר החברה המנפיקה', 'issuer company number', { req: true }), F('series', 'text', 'סדרה', 'series', { req: true }), F('asOf', 'date', 'נכון לתאריך', 'as of', { req: true }),
      F('covenant', 'text', 'אמת המידה', 'covenant', { req: true }), F('threshold', 'text', 'הסף', 'threshold'), F('actual', 'text', 'בפועל (כפי שדווח)', 'actual (as reported)'),
      F('compliant', 'enum', 'עמידה', 'compliance', { req: true, values: ['yes', 'no', 'not-stated'] }),
      F('maturities', 'list', 'לוח סילוקין', 'maturities', { of: [F('date', 'date', 'מועד', 'date', { req: true, future: true }), F('amount', 'amount', 'סכום', 'amount', { req: true })] }),
    ] },
    purchase_agreement: { label: bi('הסכם רכישה', 'Purchase agreement'), resolves: ['projectCompany'], fields: [
      F('projectId', 'text', 'מזהה הפרויקט ב-PROPX', 'PROPX project id', { req: true }), F('sellerName', 'text', 'המוכר', 'seller', { req: true }), F('sellerNumber', 'companyNumber', 'מספר החברה של המוכר', 'seller company number', { req: true }), F('signDate', 'date', 'תאריך חתימה', 'signing date', { req: true }),
    ] },
    developer_declaration: { label: bi('הצהרת יזם', 'Developer declaration'), resolves: ['projectCompany', 'parent', 'guarantee'], fields: [
      F('projectId', 'text', 'מזהה הפרויקט ב-PROPX', 'PROPX project id'), F('asOf', 'date', 'תאריך ההצהרה', 'declaration date', { req: true }),
      F('projectCompanyName', 'text', 'חברת הפרויקט', 'project company'), F('projectCompanyNumber', 'companyNumber', 'מספר חברת הפרויקט', 'project company number'),
      F('parentName', 'text', 'חברת האם', 'parent company'), F('parentNumber', 'companyNumber', 'מספר חברת האם', 'parent company number'),
      F('guarantee', 'enum', 'ערבות חברת אם', 'parent guarantee', { req: true, values: ['explicit-parent-guarantee', 'no-guarantee', 'not-stated'] }),
    ] },
    litigation_disclosure: { label: bi('גילוי הליכים משפטיים', 'Litigation disclosure'), resolves: ['legal'], fields: [
      F('entityNumber', 'companyNumber', 'מספר החברה', 'company number', { req: true }), F('asOf', 'date', 'נכון לתאריך', 'as of', { req: true }),
      F('kind', 'enum', 'סוג', 'kind', { req: true, values: ['lawsuit', 'class-action', 'regulatory', 'insolvency', 'receivership', 'dispute'] }),
      F('court', 'text', 'ערכאה', 'court / forum'), F('caseNumber', 'text', 'מספר תיק', 'case number'), F('amount', 'amount', 'סכום התביעה', 'amount claimed'), F('currency', 'enum', 'מטבע', 'currency', { values: ['ILS', 'USD', 'EUR'] }),
      F('status', 'text', 'מצב', 'status'), F('material', 'enum', 'מהותי לפי המסמך', 'material per the document', { values: ['yes', 'no', 'not-stated'] }),
    ] },
  });

  const LIMITS = [
    bi('מסמך שסופק על ידי המשתמש — PROPX לא אימתה את המסמך עצמו; העובדות הוזנו על ידי המשתמש', 'a user-provided document — PROPX did not authenticate the document; the facts were entered by the user'),
    bi('מסמך משתמש ≠ מקור רשמי; אינו גובר על רשומה רשמית — סתירה מוצגת כסתירה', 'a user document ≠ an official source; it never overrides an official record — a disagreement is shown as a conflict'),
    bi('הקובץ לא יצא מהדפדפן — נשמרה טביעת אצבע (SHA-256), שם, גודל וסוג', 'the file never left the browser — its fingerprint (SHA-256), name, size and type are kept'),
  ];

  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
  const trimText = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, MAX_TEXT);
  const num = (v) => { if (v === '' || v == null) return null; const x = typeof v === 'number' ? v : Number(String(v).replace(/[,\s₪$€]/g, '')); return Number.isFinite(x) ? x : NaN; };

  /** one field value → { ok, value } or { ok:false, error } */
  function fieldValue(f, v, today) {
    if (v === undefined || v === null || v === '') return { ok: !f.req, value: null, error: f.req ? `${f.k}: required` : null };
    switch (f.kind) {
      case 'text': { const t = trimText(v); return t ? { ok: true, value: t } : { ok: !f.req, value: null, error: f.req ? `${f.k}: required` : null }; }
      case 'date': { const d = String(v).slice(0, 10); if (!isDate(d)) return { ok: false, error: `${f.k}: not a date (yyyy-mm-dd)` }; if (!f.future && today && d > today) return { ok: false, error: `${f.k}: in the future` }; return { ok: true, value: d }; }
      case 'amount': { const x = num(v); return Number.isNaN(x) ? { ok: false, error: `${f.k}: not a number` } : { ok: true, value: x }; }
      case 'int': { const x = num(v); return Number.isNaN(x) || (x != null && (!Number.isInteger(x) || x < 0)) ? { ok: false, error: `${f.k}: not a whole number` } : { ok: true, value: x }; }
      case 'percent': { const x = num(v); return Number.isNaN(x) || (x != null && (x < 0 || x > 100)) ? { ok: false, error: `${f.k}: not a percentage 0–100` } : { ok: true, value: x }; }
      case 'companyNumber': { const t = String(v).replace(/\D/g, ''); return /^\d{8,9}$/.test(t) ? { ok: true, value: t } : { ok: false, error: `${f.k}: not a company number (8–9 digits)` }; }
      case 'bool': return { ok: true, value: v === true || v === 'true' || v === 'yes' || v === 1 || v === '1' };
      case 'enum': return f.values.includes(String(v)) ? { ok: true, value: String(v) } : { ok: false, error: `${f.k}: one of ${f.values.join(' / ')}` };
      case 'list': {
        if (!Array.isArray(v)) return { ok: false, error: `${f.k}: a list` };
        const out = [], errs = [];
        for (const [i, item] of v.slice(0, MAX_LIST).entries()) { const r = fieldsOf(f.of, item || {}, today); if (r.errors.length) errs.push(...r.errors.map((e) => `${f.k}[${i}].${e}`)); else out.push(r.values); }
        if (f.req && !out.length && !errs.length) errs.push(`${f.k}: at least one row`);
        return errs.length ? { ok: false, error: errs.join('; ') } : { ok: true, value: out };
      }
      default: return { ok: false, error: `${f.k}: unknown kind` };
    }
  }
  function fieldsOf(fields, raw, today) {
    const values = {}, errors = [];
    for (const f of fields) { const r = fieldValue(f, raw[f.k], today); if (!r.ok) errors.push(r.error); else if (r.value !== null && r.value !== undefined) values[f.k] = r.value; }
    return { values, errors };
  }
  const hex = /^[0-9a-f]{64}$/;
  /** a stable id: the file's fingerprint when there is one, else a hash of the entered facts (FNV-1a, deterministic) */
  function idOf(type, provenance, values) {
    if (provenance.sha256) return 'udoc:' + provenance.sha256.slice(0, 20);
    let h = 0x811c9dc5; const s = type + JSON.stringify(values);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'udoc:f' + h.toString(16).padStart(8, '0');
  }
  /** validate one raw document → { ok, errors, doc } — the doc is the ONLY shape the read models accept */
  function normalize(raw, { today = new Date().toISOString().slice(0, 10) } = {}) {
    const errors = [];
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['not an object'], doc: null };
    const T = TYPES[raw.type]; if (!T) return { ok: false, errors: [`type: one of ${Object.keys(TYPES).join(' / ')}`], doc: null };
    const P = raw.provenance || {};
    const provenance = { fileName: P.fileName ? trimText(P.fileName).slice(0, 160) : null, fileSize: Number.isFinite(Number(P.fileSize)) ? Number(P.fileSize) : null,
      mime: P.mime ? trimText(P.mime).slice(0, 80) : null, sha256: P.sha256 && hex.test(String(P.sha256).toLowerCase()) ? String(P.sha256).toLowerCase() : null,
      enteredAt: P.enteredAt && !Number.isNaN(Date.parse(P.enteredAt)) ? new Date(P.enteredAt).toISOString() : null, issuer: P.issuer ? trimText(P.issuer).slice(0, 160) : null, note: P.note ? trimText(P.note) : null };
    if (P.sha256 && !provenance.sha256) errors.push('provenance.sha256: not a SHA-256 hex digest');
    if (!provenance.fileName && !provenance.issuer) errors.push('provenance: a file name or an issuer is required (where the document comes from)');
    const r = fieldsOf(T.fields, raw.fields || {}, today); errors.push(...r.errors);
    if (errors.length) return { ok: false, errors, doc: null };
    const docDate = r.values.reportDate || r.values.asOf || r.values.issueDate || r.values.signDate || r.values.date || r.values.periodEnd || null;
    const doc = { id: idOf(raw.type, provenance, r.values), type: raw.type, typeLabel: T.label, cls: CLASS, version: VERSION.id, docDate, fields: r.values, provenance, resolves: T.resolves, limitations: LIMITS };
    return { ok: true, errors: [], doc };
  }
  function normalizeAll(list, opt) {
    const docs = [], rejected = [], seen = new Set();
    for (const raw of (Array.isArray(list) ? list : []).slice(0, MAX_DOCS)) { const r = normalize(raw, opt); if (!r.ok) { rejected.push({ type: raw && raw.type, errors: r.errors }); continue; } if (seen.has(r.doc.id)) continue; seen.add(r.doc.id); docs.push(r.doc); }
    return { docs, rejected };
  }
  /** the documents that concern an entity: a project by its PROPX id; a company by any company number the document carries */
  const NUMBER_FIELDS = ['entityNumber', 'holderNumber', 'applicantNumber', 'guarantorNumber', 'borrowerNumber', 'sellerNumber', 'projectCompanyNumber', 'parentNumber'];
  function numbersOf(doc) {
    const out = new Set(NUMBER_FIELDS.map((k) => doc.fields[k]).filter(Boolean));
    for (const r of doc.fields.relations || []) { out.add(r.parentNumber); out.add(r.childNumber); }
    for (const s of doc.fields.shareholders || []) if (s.number) out.add(s.number);
    return out;
  }
  function concerning(docs, { projectId = null, companyNumbers = [] } = {}) {
    const nums = new Set((companyNumbers || []).filter(Boolean).map(String));
    return (docs || []).filter((d) => (projectId && d.fields.projectId === projectId) || [...numbersOf(d)].some((n) => nums.has(n)));
  }
  /** a company number in a document, checked against the registry index (when the caller has one): found + name consistency */
  function registryCheck(number, name, index, regKey) {
    if (!number) return { state: 'NO_NUMBER', row: null };
    const row = index && index.companies ? (index.companies.byNumber.get(String(number)) || (index.partnerships && index.partnerships.byNumber.get(String(number))) || null) : null;
    if (!row) return { state: 'NOT_IN_COVERAGE', row: null, note: bi('המספר אינו בין החברות ש-PROPX שומרת — אינו אומר דבר על החברה', 'the number is not among the companies PROPX keeps — this says nothing about the company') };
    if (name && regKey && regKey(name) !== regKey(row.name)) return { state: 'NAME_DIFFERS', row, note: bi('השם במסמך שונה מהשם הרשום למספר זה — מוצגים שניהם', 'the name in the document differs from the registered name of this number — both shown') };
    return { state: 'REGISTRY_ROW_FOUND', row };
  }
  /** the CSV template (financial statements / sales report): "field,value" rows → raw fields */
  function fromCsv(type, text) {
    const T = TYPES[type]; if (!T) return { fields: {}, errors: ['unknown type'] };
    const keys = new Set(T.fields.map((f) => f.k)), fields = {}, errors = [];
    for (const [i, line] of String(text || '').split(/\r?\n/).entries()) {
      if (!line.trim() || /^#/.test(line)) continue;
      const m = line.match(/^\s*([A-Za-z]+)\s*[,;\t]\s*(.*?)\s*$/); if (!m) { errors.push(`line ${i + 1}: expected "field,value"`); continue; }
      if (!keys.has(m[1])) { errors.push(`line ${i + 1}: unknown field ${m[1]}`); continue; }
      fields[m[1]] = m[2].replace(/^"|"$/g, '');
    }
    return { fields, errors };
  }
  function template(type) { const T = TYPES[type]; return T ? '# PROPX ' + type + ' template — field,value (one per line; leave unknown values empty)\n' + T.fields.filter((f) => f.kind !== 'list').map((f) => `${f.k},`).join('\n') + '\n' : ''; }

  return Object.freeze({ VERSION, CLASS, TYPES, LIMITS, MAX_DOCS, normalize, normalizeAll, concerning, numbersOf, registryCheck, fromCsv, template });
}));
