'use strict';
/* PROPX · "What changed?" — the seven verbs of the Market Radar (17.10.2026).
 *
 *   verbOf(event)  →  'NEW' | 'CHANGED' | 'REVISED' | 'ADVANCED' | 'STALE' | 'RECOVERED' | 'CONFLICT'
 *
 * A deterministic classification of every radar event by its rule id (lib/radar/events.js RULES) — and, for a source-state
 * event, by the transition the run logs recorded (values.from → values.to). The verb says WHAT KIND of change PROPX
 * observed, never how good or bad it is:
 *   NEW        a record or a period the source published for the first time in PROPX's reads (a tender, a notice, a month, an index)
 *   ADVANCED   a record moved forward in the lifecycle its source defines (open → closed → awarded; declared; a lottery due)
 *   CHANGED    a stored value or state changed without a forward direction PROPX can assert (a status, a notice, a rate; a tender
 *              decided without a winner, cancelled or frozen)
 *   REVISED    an official figure already published was replaced by its publisher (the old value is kept)
 *   STALE      a source's content is older than its expected publication calendar, or its check state turned STALE
 *   RECOVERED  a source answered again after REFUSED / FAILED / SCHEMA_CHANGED
 *   CONFLICT   a source's structure no longer matches what PROPX expects (SCHEMA_CHANGED) — a disagreement PROPX cannot resolve alone
 * Pure data + one function; no fetch, no model. */
const bi = (he, en) => ({ he, en });
const VERBS = Object.freeze({
  NEW: { label: bi('חדש', 'NEW'), d: bi('רשומה או תקופה שהמקור פרסם לראשונה בקריאות PROPX', 'a record or a period the source published for the first time in PROPX\'s reads') },
  ADVANCED: { label: bi('התקדם', 'ADVANCED'), d: bi('רשומה שהתקדמה במחזור החיים שהמקור מגדיר', 'a record that moved forward in the lifecycle its source defines') },
  CHANGED: { label: bi('השתנה', 'CHANGED'), d: bi('ערך או מצב שהשתנו ללא כיוון קדימה ש-PROPX יכולה לקבוע', 'a value or state that changed without a forward direction PROPX can assert') },
  REVISED: { label: bi('תוקן', 'REVISED'), d: bi('נתון רשמי שכבר פורסם והוחלף על ידי המפרסם — הערך הישן נשמר', 'an official figure already published, replaced by its publisher — the old value is kept') },
  STALE: { label: bi('ישן', 'STALE'), d: bi('תוכן מקור ישן מלוח הפרסום הצפוי, או מצב בדיקה שהפך STALE', 'source content older than the expected publication calendar, or a check state that turned STALE') },
  RECOVERED: { label: bi('התאושש', 'RECOVERED'), d: bi('מקור שענה שוב אחרי REFUSED / FAILED / SCHEMA_CHANGED', 'a source that answered again after REFUSED / FAILED / SCHEMA_CHANGED') },
  CONFLICT: { label: bi('סתירה', 'CONFLICT'), d: bi('מבנה המקור אינו תואם עוד את מה ש-PROPX מצפה לו (SCHEMA_CHANGED) — אי-הסכמה ש-PROPX אינה פותרת לבד', 'the source\'s structure no longer matches what PROPX expects (SCHEMA_CHANGED) — a disagreement PROPX cannot resolve alone') },
});
const ORDER = ['NEW', 'ADVANCED', 'CHANGED', 'REVISED', 'STALE', 'RECOVERED', 'CONFLICT'];
/* every rule id of lib/radar/events.js → its verb; source-state is decided by the transition */
const BY_KIND = Object.freeze({
  'tender-published': 'NEW', 'tender-new': 'NEW', 'renewal-new': 'NEW', 'rental-notice-new': 'NEW', 'lottery-new': 'NEW', 'cbs-month-published': 'NEW', 'index-published': 'NEW', 'developer-market-entry': 'NEW',
  'tender-open': 'ADVANCED', 'tender-closed': 'ADVANCED', 'tender-awarded': 'ADVANCED', 'developer-wins-land': 'ADVANCED', 'renewal-declared': 'ADVANCED', 'renewal-stage': 'ADVANCED', 'lottery-due': 'ADVANCED',
  'tender-no-award': 'CHANGED', 'tender-cancelled': 'CHANGED', 'tender-frozen': 'CHANGED', 'plan-status': 'CHANGED', 'rental-notice-updated': 'CHANGED', 'rental-planning-updated': 'CHANGED', 'boi-rate-changed': 'CHANGED',
  'cbs-revised': 'REVISED', 'source-stale': 'STALE',
});
const RECOVERABLE = new Set(['REFUSED', 'FAILED', 'SCHEMA_CHANGED']), GOOD = new Set(['SUCCESS', 'UNCHANGED']);
function sourceStateVerb(e) {
  const v = (e && e.values) || {}, from = String(v.from || ''), to = String(v.to || '');
  if (to === 'SCHEMA_CHANGED') return 'CONFLICT';
  if (to === 'STALE') return 'STALE';
  if (RECOVERABLE.has(from) && GOOD.has(to)) return 'RECOVERED';
  return 'CHANGED';
}
function verbOf(e) {
  if (!e || !e.kind) return null;
  if (e.kind === 'source-state') return sourceStateVerb(e);
  return BY_KIND[e.kind] || 'CHANGED';
}
const BASIS = bi('הפועל אומר איזה סוג שינוי PROPX צפתה — לעולם לא אם הוא טוב או רע; קבוע לכל כלל אירוע, ולאירוע מצב-מקור לפי המעבר שנרשם ביומני הריצה.',
  'The verb says what kind of change PROPX observed — never whether it is good or bad; a constant per event rule, and for a source-state event the transition the run logs recorded.');
module.exports = { VERBS, ORDER, BY_KIND, verbOf, sourceStateVerb, BASIS };
