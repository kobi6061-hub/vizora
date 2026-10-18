// PROPX · LIVE REGISTRY LOOKUP BY COMPANY NUMBER (Premium Diligence 2.0, 18.10.2026).
//
// The daily sync keeps registry rows only for the companies that resolve from PROPX developer names and for registered
// contractors (~11 k of 732 k). A project company named in a user document (a purchase agreement, a Sale-Law guarantee, a
// developer declaration) or a number the user types is usually outside that set. For those numbers ONLY, the read asks
// data.gov.il directly — one exact-key request per official resource (the companies register, the filings register, the
// Official Receiver's liquidation file, the fast-track voluntary-liquidation list, the designated-for-strike-off list):
//   • exact `filters` on the number field — never a name, never full text;
//   • at most MAX_NUMBERS numbers per read, a hard timeout per request, an honest User-Agent;
//   • the answer is used for THIS read only (nothing stored, nothing logged) and labelled LIVE READ with its time;
//   • a refusal / timeout is said ("the live lookup did not answer"), never turned into "no record".
'use strict';

const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-dd-live-lookup-v1', effective: '2026-10-18' });
const CKAN = 'https://data.gov.il/api/3/action/datastore_search';
const UA = 'PROPX-dd-live/1.0 (+https://github.com/kobi6061-hub/vizora; exact company-number lookup, read-only)';
const MAX_NUMBERS = 3, TIMEOUT_MS = 6000;
const RES = Object.freeze({
  companies: { id: 'datagov:ica:companies', resource: 'f004176c-b85f-4542-8901-7b3176f9a054', key: 'מספר חברה' },
  filings: { id: 'datagov:ica:changes', resource: '28780ab5-3ef1-44c7-8377-da82c0aa6781', key: 'מספר תאגיד', limit: 500 },
  liquidation: { id: 'datagov:moj:official-receiver:liquidation', resource: 'd8715392-287f-49b7-9ae3-f21ec5bf55f3', key: 'מספר זיהוי של החברה' },
  voluntaryFast: { id: 'datagov:ica:voluntary-liquidation-fast-track', resource: '6f3f0df3-5968-4135-81c5-8dd76bf89410', key: 'מספר חברה' },
  strikeOff: { id: 'datagov:ica:designated-strike-off', resource: '0fd312bb-68c9-4647-b186-60c3e7b4f6f7', key: 'מספר התאגיד' },
});
const s = (v) => (v == null ? null : String(v).trim() || null);
const n = (v) => { if (v == null || v === '') return null; const x = Number(String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : null; };
const dmy = (v) => { const t = s(v); if (!t) return null; const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; const i = t.match(/^(\d{4}-\d{2}-\d{2})/); return i ? i[1] : null; };
const pick = (row, re) => { const k = Object.keys(row || {}).find((x) => re.test(x)); return k ? row[k] : null; };
/* the same slim shapes the sync keeps (lib/dd/sync.js) */
const SLIM = {
  companies: (r) => ({ num: n(r['מספר חברה']), name: s(r['שם חברה']), type: s(r['סוג תאגיד']), status: s(r['סטטוס חברה']), sub: s(r['תת סטטוס']), violating: s(r['מפרה']), lastReport: n(r['שנה אחרונה של דוח שנתי (שהוגש)']), incorporated: dmy(r['תאריך התאגדות']), city: s(r['שם עיר']), government: s(r['חברה ממשלתית']), kind: 'company', live: true }),
  filings: (r) => ({ num: n(r['מספר תאגיד']), kind: s(r['סוג בקשה']), kindCode: n(r['קוד סוג בקשה']), date: dmy(r['תאריך עדכון סטטוס']), chargeId: n(r['מזהה השיעבוד']) }),
  liquidation: (r) => ({ caseId: n(r['מזהה תיק פירוק חברה']), num: n(r['מספר זיהוי של החברה']), name: s(r['שם החברה']), status: s(r['סטטוס תיק']), requested: dmy(r['תאריך הגשת הבקשה']), orderDate: dmy(r['תאריך קבלת צו פירוק']), stayDate: dmy(r['תאריך ביטול / הקפאת צו פירוק']), closed: dmy(r['תאריך סגירת תיק']), closeReason: s(r['סיבת סגירה']), court: s(r['בית משפט מחוזי בו מתנהל התיק']) }),
  voluntaryFast: (r) => ({ num: n(r['מספר חברה']), name: s(r['שם חברה']), status: s(r['סטטוס חברה']), sub: s(r['תת סטטוס']), approved: dmy(pick(r, /אישור/)) }),
  strikeOff: (r) => ({ num: n(pick(r, /^מספר התאגיד$/)), name: s(pick(r, /^שם התאגיד$/)), status: s(pick(r, /^סטטוס התאגיד$/)), sub: s(pick(r, /^תת סטטוס התאגיד$/)), published: dmy(pick(r, /פרסום/)), expected: dmy(pick(r, /הצפוי/)) }),
};

async function defaultFetchJson(url, timeoutMs) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = null; }
  if (!r.ok || !json || !json.result) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return json;
}
async function one(fetchJson, res, num, timeoutMs) {
  const u = new URL(CKAN); u.searchParams.set('resource_id', res.resource); u.searchParams.set('filters', JSON.stringify({ [res.key]: num })); u.searchParams.set('limit', String(res.limit || 20));
  const j = await fetchJson(u.toString(), timeoutMs);
  return (j.result.records || []);
}
/** numbers → Map(number → { company, filings, liquidation, voluntaryFast, strikeOff, checkedAt, answered, errors }) */
async function lookup(numbers, { fetchJson = defaultFetchJson, timeoutMs = TIMEOUT_MS, now = new Date().toISOString() } = {}) {
  const want = [...new Set((numbers || []).map(String).filter((x) => /^\d{8,9}$/.test(x)))].slice(0, MAX_NUMBERS);
  const out = new Map();
  await Promise.all(want.map(async (num) => {
    const rec = { number: num, checkedAt: now, source: 'live', answered: {}, errors: {}, company: null, filings: [], liquidation: [], voluntaryFast: [], strikeOff: null };
    await Promise.all(Object.entries(RES).map(async ([k, res]) => {
      /* only rows whose number IS the requested number are used — an answer for another number is never applied */
      try { const rows = (await one(fetchJson, res, num, timeoutMs)).map(SLIM[k]).filter((x) => x && x.num != null && String(x.num) === num);
        rec.answered[k] = true;
        if (k === 'companies') rec.company = rows[0] || null; else if (k === 'strikeOff') rec.strikeOff = rows[0] || null; else rec[k] = rows;
      } catch (e) { rec.answered[k] = false; rec.errors[k] = String(e && e.message || e).slice(0, 120); }
    }));
    out.set(num, rec);
  }));
  return out;
}
/** a statement of what the live lookup did, for the read */
const LANE_HE = { companies: 'רשם החברות', filings: 'שינויים בתאגידים', liquidation: 'קובץ הפירוק של הכונס הרשמי', voluntaryFast: 'רשימת הפירוק מרצון', strikeOff: 'רשימת המיועדות למחיקה' };
function statementOf(rec) {
  if (!rec) return null;
  const failed = Object.entries(rec.answered).filter(([, v]) => !v).map(([k]) => k);
  if (rec.answered.companies === false) return bi('הבדיקה החיה ברשם לא נענתה — אין לפרש כ"אין חברה"', 'the live registry lookup did not answer — not to be read as "no company"');
  if (!rec.company) return bi('אין שורה ברשם החברות למספר זה (בדיקה חיה לפי מספר)', 'no row in the companies register for this number (a live lookup by number)');
  return failed.length ? bi(`נקרא חי מהרשם; לא נענו: ${failed.map((k) => LANE_HE[k] || k).join(', ')} — לא נבדקו`, `read live from the registry; did not answer: ${failed.join(', ')} — not checked`) : bi('נקרא חי מהרשם לפי מספר — לקריאה זו בלבד', 'read live from the registry by number — for this read only');
}

module.exports = { VERSION, RES, MAX_NUMBERS, TIMEOUT_MS, lookup, statementOf, SLIM };
