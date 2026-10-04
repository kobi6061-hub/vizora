// PROPX · Land & Tender — the Israel Land Authority's own code tables.
//
// Every code → label pair below was read from the tender site's reference
// service, GET https://apps.land.gov.il/MichrazimSite/api/GeneralTablesApi/Get
// (84 rows, GitHub Actions run 37224109743, 04.10.2026). The tables are kept
// verbatim so a tender's type, status, purpose and region are the Authority's
// words, never PROPX's guess. The track classification (open market /
// subsidized / rental / special population / commercial) is derived from
// these codes alone — never from keywords.
//
// Two "purpose" tables exist on the service: TableID 318 (8 rows) and the
// legacy TableID -1 (26 rows, with a Group column מגורים / אחר). The tender
// rows carry codes up to 26 and 99, and the open-source clients of the same
// API agree, so the legacy table is the one the data uses (verified on real
// tenders: 20260158, 436 units in 3 lots, purpose 2 = בנייה רוויה; 20250516,
// 8 single-unit lots, purpose 1 = בנייה נמוכה).

'use strict';

const TABLE_SOURCE = Object.freeze({
  endpoint: 'https://apps.land.gov.il/MichrazimSite/api/GeneralTablesApi/Get',
  readAt: '2026-10-04', runId: '37224109743',
});

/* TableID 215 · סוג מכרז — the marketing method */
const TENDER_TYPES = Object.freeze({
  1: 'מכרז פומבי רגיל', 2: 'הרשמה והגרלה', 3: 'מכרז למגרש בלתי מסוים', 4: 'קדימות על פי עדיפות',
  5: 'מחיר מטרה', 6: 'דיור להשכרה', 7: 'מחיר למשתכן', 8: 'דיור במחיר מופחת', 9: 'מכרז ייזום',
  10: 'מכרזי עמידר', 11: 'מכרזי החברה לפיתוח עכו',
});
/* TableID 237 · סטטוס מכרז מורחב — the status the search list and the detail carry (StatusMichraz / StatusMichrazMurchav).
   MichrazPail = 1 marks the statuses the site lists under "מכרזי מקרקעין פעילים". */
const STATUSES = Object.freeze({
  1: { he: 'מפורסם', active: true }, 2: { he: 'פתוח להגשת הצעות', active: true }, 3: { he: 'טרם הוכרזו זוכים', active: false },
  4: { he: 'נדחה/מוקפא', active: false }, 5: { he: 'נדון בוועדת מכרזים', active: false }, 6: { he: 'ממתין להגרלה/בחירת מגרשים', active: false },
  7: { he: 'בוטל', active: false },
});
/* TableID -1 · ייעוד מכרז with its group (מגורים / אחר) */
const PURPOSES = Object.freeze({
  1: { he: 'בנייה נמוכה/צמודת קרקע', group: 'מגורים' }, 2: { he: 'בנייה רוויה', group: 'מגורים' }, 3: { he: 'מסחר ו/או משרדים', group: 'אחר' },
  4: { he: 'תעשיה', group: 'אחר' }, 5: { he: 'מוסדות ו/או בניינים ציבוריים', group: 'אחר' }, 6: { he: 'חניונים', group: 'אחר' },
  7: { he: 'תחנות דלק', group: 'אחר' }, 8: { he: 'מלונאות', group: 'אחר' }, 9: { he: 'ספורט ו/או נופש ו/או תיירות ו/או מלונאות', group: 'אחר' },
  10: { he: 'כרייה וחציבה', group: 'אחר' }, 11: { he: 'חקלאות', group: 'אחר' }, 12: { he: 'מגורים ו/או מסחר ו/או מלונאות ו/או נופש', group: 'מגורים' },
  13: { he: 'דיור מוגן (בית אבות)', group: 'מגורים' }, 14: { he: 'נכסי הרשות - מכירה - מגורים', group: 'מגורים' }, 15: { he: 'נכסי הרשות - מכירה - אחר', group: 'אחר' },
  16: { he: 'עודפים', group: 'אחר' }, 17: { he: 'נופש וחקלאות', group: 'אחר' }, 18: { he: 'הטמנת פסולת', group: 'אחר' }, 20: { he: 'דיור להשכרה', group: 'מגורים' },
  21: { he: 'נכסי הרשות - השכרה - מגורים', group: 'מגורים' }, 22: { he: 'נכסי הרשות - השכרה - אחר', group: 'אחר' }, 23: { he: 'אנרגיה מתחדשת', group: 'אחר' },
  24: { he: 'תחנת כוח', group: 'אחר' }, 25: { he: 'תכנון וביצוע לכריה וחציבה', group: 'אחר' }, 26: { he: 'תעסוקה', group: 'אחר' }, 99: { he: 'אחר', group: 'אחר' },
});
/* TableID 66 · מרחבים — the Authority's regions */
const REGIONS = Object.freeze({ 0: 'מטה הרשות', 1: 'ירושלים', 2: 'צפון', 3: 'חיפה', 4: 'מרכז', 5: 'תל אביב', 6: 'דרום', 7: 'יו"ש', 8: 'עזה' });
/* TableID 291 · הצעה - מצב זכיה — a bid's state (HatzaaDescription) */
const BID_STATES = Object.freeze({ 1: 'הצעה זוכה', 2: 'הצעה שניה', 3: 'הצעה פסולה', 4: 'הגרלה/התמחרות' });
/* TableID -2 · אוכלוסיות — priority populations (Uchlusiyot) */
const POPULATIONS = Object.freeze({
  1: 'אנשים עם מוגבלות', 3: 'חסרי דיור', 4: 'בני מיעוטים מומלצי כוחות הביטחון (בעבר ובהווה)', 5: 'כלל הציבור', 6: 'חיילי מילואים',
  7: 'חיילי מילואים לוחמים', 8: 'חיילי מילואים לוחמים בני מקום תושבי היישוב', 9: 'חיילי מילואים פעילים בני מקום תושבי היישוב',
  10: 'חיילי מילואים לוחמים בני מקום תושבי המועצה', 11: 'חיילי מילואים לוחמים בני מקום', 12: 'חיילי מילואים פעילים בני מקום תושבי המועצה',
  13: 'חיילי מילואים פעילים בני מקום', 14: 'בני מקום תושבי היישוב', 15: 'בני מקום תושבי המועצה', 16: 'בני מקום',
});

/* the type codes behind each marketing track — product vocabulary over the Authority's codes */
const SUBSIDIZED_TYPES = new Set([5, 7, 8]);        // מחיר מטרה · מחיר למשתכן · דיור במחיר מופחת
const RENTAL_TYPES = new Set([6]);                  // דיור להשכרה
const LOTTERY_TYPES = new Set([2, 3, 4]);           // הרשמה והגרלה · מגרש בלתי מסוים · קדימות — allocation by lottery / priority, not by price
const OPEN_MARKET_TYPES = new Set([1, 9, 10, 11]);  // מכרז פומבי רגיל · ייזום · עמידר · החברה לפיתוח עכו — price competition
const RESIDENTIAL_PURPOSES = new Set(Object.entries(PURPOSES).filter(([, p]) => p.group === 'מגורים').map(([k]) => Number(k)));
const MIXED_PURPOSE = 12;

/**
 * The marketing track of a tender, from the Authority's own type and purpose
 * codes and its priority-population list. Never from free text.
 *   open-market        residential purpose, price competition (types 1, 9, 10, 11)
 *   subsidized         מחיר מטרה / מחיר למשתכן / דיור במחיר מופחת (types 5, 7, 8)
 *   rental             דיור להשכרה (type 6, or purpose 20 / 21)
 *   special-population lottery / priority types whose population list names a specific public
 *   residential-lottery  lottery / priority types open to the general public (self-build plots at a fixed price)
 *   mixed-use          purpose 12 (מגורים ו/או מסחר ו/או מלונאות)
 *   commercial-other   every purpose of the אחר group
 *   unknown            codes the tables do not list
 */
function trackOf({ typeCode, purposeCode, populations = [] }) {
  const t = Number(typeCode), p = Number(purposeCode);
  if (!PURPOSES[p] || !TENDER_TYPES[t]) return 'unknown';
  if (p === MIXED_PURPOSE) return 'mixed-use';
  if (!RESIDENTIAL_PURPOSES.has(p)) return 'commercial-other';
  if (RENTAL_TYPES.has(t) || p === 20 || p === 21) return 'rental';
  if (SUBSIDIZED_TYPES.has(t)) return 'subsidized';
  if (LOTTERY_TYPES.has(t)) {
    const pops = (populations || []).map(Number).filter((x) => POPULATIONS[x]);
    return pops.length && !(pops.length === 1 && pops[0] === 5) ? 'special-population' : 'residential-lottery';
  }
  if (OPEN_MARKET_TYPES.has(t)) return 'open-market';
  return 'unknown';
}
const RESIDENTIAL_TRACKS = new Set(['open-market', 'subsidized', 'rental', 'special-population', 'residential-lottery', 'mixed-use']);

module.exports = { TABLE_SOURCE, TENDER_TYPES, STATUSES, PURPOSES, REGIONS, BID_STATES, POPULATIONS, trackOf, RESIDENTIAL_TRACKS,
  SUBSIDIZED_TYPES, RENTAL_TYPES, LOTTERY_TYPES, OPEN_MARKET_TYPES, RESIDENTIAL_PURPOSES };
