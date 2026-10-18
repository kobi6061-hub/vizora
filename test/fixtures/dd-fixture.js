'use strict';
/* TEST FIXTURE — synthetic due-diligence rows for test/dd.test.js. Fictional names and numbers (51000000x / 52000000x), never read
   by the product. Written to a temporary directory at test time in the exact shapes lib/dd/sync.js writes to data/dd/. */
const AT = '2026-10-18T05:00:00.000Z';
const co = (num, name, status, type = 'ישראלית חברה פרטית', extra = {}) => ({ num, name, type, status, sub: null, violating: null, lastReport: 2026, incorporated: '2001-01-01', city: 'תל אביב - יפו', government: 'לא', kind: 'company', ...extra });
module.exports = {
  'companies.json': { schema: 'propx-dd-companies-v1', source: 'datagov:ica:companies', fetchedAt: AT, sourceModified: '2026-10-18T01:22:00', total: 10, rows: [
    co(510000001, 'אלפא בנייה בע~מ', 'פעילה'),
    co(510000002, 'אלפא בנייה (פרויקטים) בע~מ', 'פעילה'),
    co(520000003, 'בטא נדל~ן בע~מ', 'פעילה', 'ישראלית חברה ציבורית'),
    co(510000004, 'גמא יזמות בע~מ', 'מחוקה'),
    co(510000005, 'גמא. יזמות בע~מ', 'פעילה'),
    co(510000006, 'דלתא הנדסה בע~מ', 'בפרוק ע~י בימ~ש'),
    co(510000007, 'אפסילון בניה בע~מ', 'פעילה', 'ישראלית חברה פרטית', { violating: 'מפרה', lastReport: 2021 }),
    co(510000008, 'זטא קבלנות בע~מ', 'פעילה'),
    co(510000009, 'אטא בנייה והשקעות בע~מ', 'פעילה'),
  ] },
  'partnerships.json': { schema: 'propx-dd-partnerships-v1', fetchedAt: AT, rows: [] },
  'filings.json': { schema: 'propx-dd-filings-v1', source: 'datagov:ica:changes', fetchedAt: AT, sourceModified: '2026-10-18T01:22:00', window: { from: '2025-10-18', to: '2026-10-17' }, rows: [
    { num: 510000007, kind: 'רישום שעבוד', kindCode: 68, date: '2026-03-01', chargeId: 5 },
    { num: 510000007, kind: 'סילוק שעבוד', kindCode: 70, date: '2026-06-01', chargeId: 5 },
    { num: 510000007, kind: 'דו~ח שנתי', kindCode: 1, date: '2026-05-01', chargeId: null },
  ] },
  'insolvency.json': { schema: 'propx-dd-insolvency-v1', fetchedAt: AT,
    liquidation: { source: 'datagov:moj:official-receiver:liquidation', sourceModified: '2026-10-11', rows: [{ caseId: 900, num: 510000006, name: 'דלתא הנדסה בע~מ', status: 'מתן צו פרוק', requested: '2026-01-10', orderDate: '2026-03-01', stayDate: null, closed: null, closeReason: null, court: 'מחוזי ת~א' }] },
    voluntaryFast: { source: 'datagov:ica:voluntary-liquidation-fast-track', rows: [] } },
  'contractors.json': { schema: 'propx-dd-contractors-v1', fetchedAt: AT, sourceModified: '2026-08-17', rows: [
    { kablan: '1001', company: '510000008', name: 'זטא קבלנות בע"מ', branch: 'בניה', branchCode: '100', group: 'ג', sivug: '5', registered: '2010-01-01' },
    { kablan: '1002', company: '510000001', name: 'אלפא בנייה בע"מ', branch: 'בניה', branchCode: '100', group: 'ב', sivug: '3', registered: '2012-01-01' },
    { kablan: '1003', company: null, name: 'משה לוי', branch: 'שיפוצים', branchCode: '131', group: 'א', sivug: '1' },
  ] },
  'sites.json': { schema: 'propx-dd-sites-v1', fetchedAt: AT, sourceModified: '2026-10-17T21:15:00', firstRun: false, active: [
    { workId: 1, name: 'בניה גוש 7000 חלקה 1 תל אביב', executorName: 'אלפא בנייה בע"מ', executorId: 1002, city: 'תל אביב - יפו', buildTypes: 'מגורים', sanctions: 0, warrants: 0, firstSeen: '2026-09-01', lastSeen: '2026-10-18' },
    { workId: 2, name: 'מגרש 12 שכונת הפארק באר שבע', executorName: 'זטא קבלנות בע"מ', executorId: 1001, city: 'באר שבע', buildTypes: 'מגורים', sanctions: 1, warrants: 0, firstSeen: '2026-09-01', lastSeen: '2026-10-18' },
    { workId: 3, name: 'מגרש 12 אזור תעשיה באר שבע', executorName: 'זטא קבלנות בע"מ', executorId: 1001, city: 'באר שבע', buildTypes: 'תעשייה', sanctions: 0, warrants: 0, firstSeen: '2026-09-01', lastSeen: '2026-10-18' },
    { workId: 4, name: 'תיכון רעננה', executorName: 'משה לוי', executorId: 1003, city: 'רעננה', buildTypes: 'ציבורי', sanctions: 0, warrants: 0, firstSeen: '2026-09-01', lastSeen: '2026-10-18' },
  ], gone: [], closed: { rows: [] } },
  'tlv.json': { schema: 'propx-dd-tlv-v1', fetchedAt: AT, coverage: 'TEL AVIV MUNICIPAL COVERAGE',
    permits: { imported: '16/10/2026', rows: [
      { request: 20240001, permit: 20250001, permitDate: '2025-06-01', opened: '2024-02-01', units: 40, stage: 'בבניה', start: '2026-02-01', file: 111 },
      { request: 20140001, permit: 20150001, permitDate: '2015-01-01', opened: '2014-03-01', units: 6, stage: 'קיימת לפחות תעודת גמר אחת', start: '2015-05-01', finished: '2017-01-01', file: 110 },
      { request: 20240002, permit: 20250002, permitDate: '2025-07-01', opened: '2024-05-01', units: 30, stage: 'קיים היתר', start: null, file: 112 },
      { request: 20240003, permit: 20250003, permitDate: '2025-08-01', opened: '2024-06-01', units: 20, stage: 'בבניה', start: '2026-04-01', file: 113 },
    ] },
    sites: { rows: [
      { tik: 'T-1', parcel: '6000 / 5', permits: [20250001], holders: 'אלפא בנייה בע"מ', state: 'תחילת עבודות', start: '2026-02-01', supervision: 'אישור התחלת עבודות', supervisionDate: '2026-02-01', file: 111, address: 'רחוב א 1' },
      { tik: 'T-1', parcel: '6000 / 6', permits: [20250001], holders: 'אלפא בנייה בע"מ', state: 'תחילת עבודות', start: '2026-02-01', supervision: 'אישור התחלת עבודות', supervisionDate: '2026-02-01', file: 111, address: 'רחוב א 1' },
      { tik: 'T-0', parcel: '6000 / 5', permits: [20150001], holders: 'מישהו אחר', state: 'גמר', start: '2015-05-01', supervision: 'גמר', supervisionDate: '2017-01-01', file: 110, address: 'רחוב א 1' },
      { tik: 'T-2', parcel: '6100 / 7', permits: [20250002], holders: 'בטא נדל"ן בע"מ', state: 'היתר', start: null, supervision: 'היתר', supervisionDate: '2025-07-01', file: 112, address: 'רחוב ב 2' },
      { tik: 'T-3', parcel: '6200 / 9', permits: [20250003], holders: 'גורם אחר', state: 'תחילת עבודות', start: '2026-04-01', supervision: 'אישור התחלת עבודות', supervisionDate: '2026-04-01', file: 113, address: 'רחוב ג 3' },
    ] } },
  'latest.json': { schema: 'propx-dd-latest-v1', generatedAt: AT, run: { at: AT, status: 'SUCCESS', lanes: { companies: 'SUCCESS' } } },
  'history-recent.json': { schema: 'propx-dd-history-recent-v1', generatedAt: '2026-10-19T05:00:00.000Z', days: 180, events: [
    { at: '2026-10-19T05:00:00.000Z', lane: 'companies', event: 'company-status-changed', key: 'co:510000006', name: 'דלתא הנדסה בע~מ', old: 'פעילה', new: 'בפרוק ע~י בימ~ש', sourceDate: '2026-10-19' },
  ] },
};
