// PROPX · What Changed Here? — the vocabulary of the change feed (21.10.2026): kinds, newness, scopes, coverage states,
// statements, periods and the RULES every change item is produced by. Pure data; nothing here reads a file or computes a value.
//
// A RULE names one way a stored record becomes a change item: its kind, how its newness is decided (DATED — the source dates
// the event itself; STATE_CHANGE — PROPX observed a state change between two of its reads; REVISION — a publisher replaced a
// figure it had published), its verb (lib/radar/verbs.js vocabulary), its data class and its MATERIALITY — a documented
// constant per rule (1–3), never a model and never a judgement of good or bad.
'use strict';

const bi = (he, en) => ({ he, en });

const KINDS = Object.freeze(['TRANSACTION', 'PLANNING', 'LAND_TENDER', 'URBAN_RENEWAL', 'HOUSING', 'RENTAL', 'CONSTRUCTION', 'SALES', 'SOURCE_REVISION', 'SOURCE_STATE']);
const KIND_LABEL = Object.freeze({
  TRANSACTION: bi('עסקאות', 'Transactions'), PLANNING: bi('תכנון', 'Planning'), LAND_TENDER: bi('מכרזי קרקע', 'Land tenders'), URBAN_RENEWAL: bi('התחדשות עירונית', 'Urban renewal'),
  HOUSING: bi('הגרלות דיור', 'Housing lotteries'), RENTAL: bi('דיור להשכרה', 'Rental'), CONSTRUCTION: bi('בנייה', 'Construction'), SALES: bi('מכירות (למ״ס)', 'Sales (CBS)'),
  SOURCE_REVISION: bi('תיקוני מקור', 'Source revisions'), SOURCE_STATE: bi('מצב מקורות', 'Source state'),
});

/* NEW_EVENT                    the event's own date (deal · plan milestone · tender decision · publication) is inside the period
   NEWLY_OBSERVED_OLDER_EVENT   the event is older than the period, but PROPX first held it inside the period — in a copy / read
                                newer than the one it already held (a deal the register copy did not hold, a tender first listed late);
                                a source's FIRST ingestion is a baseline, never "newly observed"
   REVISION                     a publisher replaced a figure it had already published (both values kept), read inside the period
   STATE_CHANGE                 a stored state changed between two PROPX reads inside the period (a lifecycle, a status, a check state) */
const NEWNESS = Object.freeze(['NEW_EVENT', 'NEWLY_OBSERVED_OLDER_EVENT', 'REVISION', 'STATE_CHANGE']);
const NEWNESS_LABEL = Object.freeze({
  NEW_EVENT: bi('אירוע חדש', 'New event'), NEWLY_OBSERVED_OLDER_EVENT: bi('אירוע ישן שנצפה לראשונה', 'Older event, newly observed'),
  REVISION: bi('תיקון', 'Revision'), STATE_CHANGE: bi('שינוי מצב', 'State change'),
});

/* where an item stands relative to the geography asked about — a wider scope is CONTEXT, never the place's own fact */
const SCOPES = Object.freeze(['EXACT_STREET', 'NEAR_STREET', 'LOCALITY', 'DISTRICT', 'DISTRICT_CONTEXT', 'NATIONAL', 'NATIONAL_CONTEXT']);
const SCOPE_LABEL = Object.freeze({
  EXACT_STREET: bi('ברחוב', 'On the street'), NEAR_STREET: bi('ליד הרחוב', 'Near the street'), LOCALITY: bi('ביישוב', 'In the locality'),
  DISTRICT: bi('המחוז', 'The district'), DISTRICT_CONTEXT: bi('הקשר מחוזי — לא נתון המקום', 'District context — not this place\'s figure'),
  NATIONAL: bi('ארצי', 'National'), NATIONAL_CONTEXT: bi('הקשר ארצי — לא נתון המקום', 'National context — not this place\'s figure'),
});

/* coverage of one kind for one geography and period */
const COVERAGE = Object.freeze(['COVERED', 'SNAPSHOT_ONLY', 'NOT_APPLICABLE', 'NOT_IN_COVERAGE', 'STALE']);
const COVERAGE_LABEL = Object.freeze({
  COVERED: bi('מכוסה', 'Covered'), SNAPSHOT_ONLY: bi('תמונת מצב בלבד', 'Snapshot only'), NOT_APPLICABLE: bi('לא רלוונטי לרמה זו', 'Not applicable here'),
  NOT_IN_COVERAGE: bi('המקור אינו מגיע למקום', 'Source does not reach this place'), STALE: bi('המקור לא עדכני', 'Source stale'),
});

/* what an empty (or a non-empty) kind means — never interchangeable */
const STATEMENTS = Object.freeze({
  CHANGES: bi('נמצאו שינויים בתקופה', 'Changes found in this period'),
  NO_CHANGES_IN_PERIOD: bi('לא נמצאו שינויים בתקופה — המקור מכסה את התקופה ונבדק', 'No changes found in this period — the source covers the period and was checked'),
  NOT_COVERED: bi('לא מכוסה — PROPX אינה יכולה לומר מה השתנה כאן', 'Not covered — PROPX cannot say what changed here'),
  SOURCE_STALE: bi('המקור לא עדכני — היעדר שינוי אינו ראיה', 'Source stale — the absence of a change is not evidence'),
});

const PERIODS = Object.freeze([30, 90, 180, 365]);
const DEFAULT_PERIOD = 90;
const MAX_PERIOD = 365;

/* every rule: kind · how newness is decided · verb · class · materiality (1–3, a constant) · label */
const R = (kind, mode, verb, cls, m, he, en) => Object.freeze({ kind, mode, verb, cls, m, label: bi(he, en) });
const RULES = Object.freeze({
  'chg-tx-register': R('TRANSACTION', 'DATED', 'NEW', 'OBSERVED', 2, 'עסקה במאגר רשות המסים (עותק)', 'deal in the Tax Authority register (copy)'),
  'chg-tx-govmap-recent': R('TRANSACTION', 'DATED', 'NEW', 'OBSERVED', 2, 'עסקה בשכבת GovMap — חלון אחרון (שכבה נפרדת)', 'deal in the GovMap layer — recent window (separate layer)'),
  'chg-tx-govmap-national': R('TRANSACTION', 'DATED', 'NEW', 'OBSERVED', 1, 'עסקה בקובץ שכבת GovMap שאינה בעותק המרשם', 'deal in the GovMap-layer file the register copy does not hold'),
  'chg-tx-batch': R('TRANSACTION', 'DATED', 'NEW', 'OBSERVED', 1, 'עסקאות ישנות שנצפו לראשונה — לפי יישוב', 'older deals first observed — per locality'),
  'chg-land-published': R('LAND_TENDER', 'DATED', 'NEW', 'OFFICIAL', 2, 'מכרז קרקע פורסם', 'land tender published'),
  'chg-land-awarded': R('LAND_TENDER', 'DATED', 'ADVANCED', 'OFFICIAL', 3, 'מכרז נדון — הוכרזו זוכים', 'tender decided — winners declared'),
  'chg-land-no-award': R('LAND_TENDER', 'DATED', 'CHANGED', 'OFFICIAL', 3, 'מכרז נדון — ללא זוכה', 'tender decided — no winner'),
  'chg-land-transition': R('LAND_TENDER', 'STATE_CHANGE', null, 'OFFICIAL', 2, 'שינוי במחזור החיים של מכרז (בין שתי קריאות)', 'tender lifecycle change (between two reads)'),
  'chg-renewal-declared': R('URBAN_RENEWAL', 'DATED', 'ADVANCED', 'OFFICIAL', 3, 'מתחם התחדשות הוכרז', 'renewal complex declared'),
  'chg-renewal-transition': R('URBAN_RENEWAL', 'STATE_CHANGE', null, 'OFFICIAL', 2, 'מתחם התחדשות — שינוי בין שתי קריאות', 'renewal complex — change between two reads'),
  'chg-plan-received': R('PLANNING', 'DATED', 'NEW', 'OFFICIAL', 2, 'תכנית נקלטה במערכת התכנון', 'plan received by the planning system'),
  'chg-plan-deposited': R('PLANNING', 'DATED', 'ADVANCED', 'OFFICIAL', 3, 'תכנית הופקדה', 'plan deposited'),
  'chg-plan-approval-hearing': R('PLANNING', 'DATED', 'ADVANCED', 'OFFICIAL', 2, 'דיון באישור תכנית', 'plan approval hearing'),
  'chg-plan-in-force': R('PLANNING', 'DATED', 'ADVANCED', 'OFFICIAL', 3, 'תכנית פורסמה ברשומות (בתוקף)', 'plan published in the gazette (in force)'),
  'chg-plan-status': R('PLANNING', 'STATE_CHANGE', 'CHANGED', 'OFFICIAL', 3, 'תכנית — שינוי סטטוס בין שתי קריאות', 'plan — status change between two reads'),
  'chg-vatmal-declared': R('PLANNING', 'DATED', 'ADVANCED', 'OFFICIAL', 3, 'מתחם ותמ״ל הוכרז', 'VATMAL complex declared'),
  'chg-vatmal-updated': R('PLANNING', 'DATED', 'CHANGED', 'OFFICIAL', 1, 'מתחם ותמ״ל — עדכון', 'VATMAL complex updated'),
  'chg-lottery-held': R('HOUSING', 'DATED', 'ADVANCED', 'OFFICIAL', 2, 'הגרלת דיור התקיימה', 'housing lottery held'),
  'chg-rental-notice': R('RENTAL', 'DATED', 'NEW', 'OFFICIAL', 2, 'הודעת מכרז דיור להשכרה פורסמה', 'rental-track tender notice published'),
  'chg-rental-transition': R('RENTAL', 'STATE_CHANGE', null, 'OFFICIAL', 1, 'דיור להשכרה — עדכון בין שתי קריאות', 'rental — update between two reads'),
  'chg-cbs-construction-period': R('CONSTRUCTION', 'DATED', 'NEW', 'OFFICIAL', 2, 'הלמ״ס פרסמה תקופה של נתוני בנייה', 'CBS published a construction period'),
  'chg-tlv-permit-issued': R('CONSTRUCTION', 'DATED', 'ADVANCED', 'OFFICIAL', 2, 'היתר בנייה הוצא (תל אביב-יפו)', 'building permit issued (Tel Aviv-Yafo)'),
  'chg-tlv-construction-started': R('CONSTRUCTION', 'DATED', 'ADVANCED', 'OFFICIAL', 2, 'תחילת עבודות (תל אביב-יפו)', 'construction started (Tel Aviv-Yafo)'),
  'chg-tlv-completion': R('CONSTRUCTION', 'DATED', 'ADVANCED', 'OFFICIAL', 2, 'תעודת גמר / אכלוס (תל אביב-יפו)', 'completion / occupancy (Tel Aviv-Yafo)'),
  'chg-tlv-transition': R('CONSTRUCTION', 'STATE_CHANGE', 'CHANGED', 'OFFICIAL', 1, 'היתר / אתר — שינוי בין שתי קריאות (תל אביב-יפו)', 'permit / site — change between two reads (Tel Aviv-Yafo)'),
  'chg-cbs-sales-period': R('SALES', 'DATED', 'NEW', 'OFFICIAL', 2, 'הלמ״ס פרסמה חודש מכירות', 'CBS published a sales month'),
  'chg-cbs-revision': R('SOURCE_REVISION', 'REVISION', 'REVISED', 'OFFICIAL', 2, 'הלמ״ס תיקנה נתון שפורסם (הערך הישן נשמר)', 'CBS revised a published figure (the old value kept)'),
  'chg-source-state': R('SOURCE_STATE', 'STATE_CHANGE', null, 'DERIVED', 2, 'מקור — שינוי במצב הבדיקה', 'source — check-state change'),
});

/* a revision's materiality: |Δ| of its largest revised period — a documented constant threshold (the radar's), never a model */
const revisionMateriality = (maxAbsPct) => (maxAbsPct >= 5 ? 3 : maxAbsPct >= 2 ? 2 : 1);

/* the near-street radius (metres from the nearest located point of the street) — the street report's own constant */
const NEAR_M = 300;

module.exports = { bi, KINDS, KIND_LABEL, NEWNESS, NEWNESS_LABEL, SCOPES, SCOPE_LABEL, COVERAGE, COVERAGE_LABEL, STATEMENTS, PERIODS, DEFAULT_PERIOD, MAX_PERIOD, RULES, revisionMateriality, NEAR_M };
