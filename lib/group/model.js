// PROPX · SPONSOR X-RAY — DEVELOPER GROUP INTELLIGENCE (19.10.2026): the vocabulary, tiers, stage buckets, documented
// thresholds and truth rules every other lib/group module reads. Pure data — nothing here computes a fact.
//
// A GROUP is what the evidence supports, never what a name suggests:
//   CORE        every developer brand whose observed name resolves to ONE legal company (VERIFIED by a number, or a STRONG
//               MATCH by the identical registered name) — the same legal person written several ways
//   DOCUMENTED  a company related to the core by a USER DOCUMENT (an ownership chart, a company extract, a developer
//               declaration) whose parties BOTH resolve in the registry by number — the relation is the document's claim
//   SHARED      a joint award in which a group company is one named party — a co-winner, never a member; its lots are shown
//               apart and NEVER added to the group's totals (the share is not stated)
//   POSSIBLE    a brand or company that only possibly matches (same letters, a spelling variant, a candidate, a document party
//               not found in the registry) — listed with its evidence, never in a total
//   AMBIGUOUS   several candidates at the same level — none picked, never in a total
// Totals (projects, units, stages, load) are built from CORE + DOCUMENTED rows only, each project once.
'use strict';

const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-sponsor-xray-v1', effective: '2026-10-19' });

const TIERS = Object.freeze({
  CORE: { id: 'CORE', inTotals: true, label: bi('ליבה — אותה חברה משפטית', 'CORE — the same legal company'), d: bi('כתיבים של שם המותג שנפתרים לאותה חברה רשומה (מספר רשמי / שם רשום זהה)', 'spellings of the brand that resolve to the same registered company (an official number / the identical registered name)') },
  DOCUMENTED: { id: 'DOCUMENTED', inTotals: true, label: bi('קשור לפי מסמך', 'DOCUMENTED'), d: bi('חברה שמסמך שסיפק המשתמש קושר לליבה, ושני הצדדים נמצאו ברשם לפי מספר — הקשר הוא טענת המסמך', 'a company a user-provided document relates to the core, both parties found in the registry by number — the relation is the document\'s claim') },
  SHARED: { id: 'SHARED', inTotals: false, label: bi('זכייה משותפת', 'SHARED — joint award'), d: bi('זכייה שבה חברה מהקבוצה היא אחד הצדדים הנקובים — שותף לזכייה, לא חבר בקבוצה; החלק אינו מצוין, ולכן אינו נספר בסיכומים', 'an award in which a group company is one named party — a co-winner, not a member; the share is not stated, so it is never in a total') },
  POSSIBLE: { id: 'POSSIBLE', inTotals: false, label: bi('אפשרי בלבד', 'POSSIBLE only'), d: bi('התאמה אפשרית (אותן אותיות / כתיב / מועמד / צד שלא נמצא ברשם) — מוצג עם הראיה, לעולם לא בסיכום', 'a possible match (same letters / spelling / a candidate / a party not found in the registry) — shown with its evidence, never in a total') },
  AMBIGUOUS: { id: 'AMBIGUOUS', inTotals: false, label: bi('רב-משמעי', 'AMBIGUOUS'), d: bi('כמה מועמדים באותה רמה — אף אחד לא נבחר', 'several candidates at the same level — none picked') },
});

/* the identity status of the group read */
const STATUS = Object.freeze({
  LEGAL_CORE_VERIFIED: bi('ליבה משפטית מאומתת — מספר חברה', 'LEGAL CORE VERIFIED — a company number'),
  LEGAL_CORE_STRONG: bi('ליבה משפטית בהתאמה חזקה — שם רשום זהה (לא מאומת)', 'LEGAL CORE — STRONG MATCH by the identical registered name (not VERIFIED)'),
  LEGAL_CORE_USER_KEY: bi('ליבה משפטית לפי מספר החברה שסיפקת — הנחת משתמש, לא אומתה ממקור', 'LEGAL CORE by the company number you provided — a USER ASSUMPTION, not verified from a source'),
  BRAND_ONLY: bi('מותג בלבד — החברה המשפטית לא נפתרה', 'BRAND ONLY — the legal company is not resolved'),
  JOINT_AWARD_ONLY: bi('זכייה משותפת בלבד — מחרוזת הזוכים נוקבת בכמה צדדים; לכל צד קבוצה משלו, והמגרשים מוצגים כמשותפים ואינם נספרים', 'JOINT AWARD ONLY — the winner string names several parties; each party has its own group, and the lots are shown as shared, never counted'),
  COMPANY_ONLY: bi('חברה בלבד — אף מותג שנצפה אינו נפתר אליה', 'COMPANY ONLY — no observed brand resolves to it'),
  NOT_IN_COVERAGE: bi('מחוץ לכיסוי — המספר אינו בין החברות ש-PROPX שומרת', 'NOT IN COVERAGE — the number is not among the companies PROPX keeps'),
});
const STRUCTURE = Object.freeze({
  NOT_IN_COVERAGE: bi('מבנה הבעלות אינו בכיסוי: אין חברת אם, חברה בת או SPV שנקבעו — רק כתיבי מותג שנפתרים לאותה חברה', 'Ownership is not in coverage: no parent, subsidiary or SPV is asserted — only brand spellings resolving to the same company'),
  DOCUMENTED: bi('מבנה לפי מסמכים שסיפק המשתמש: זהות הצדדים נבדקה מול הרשם לפי מספר; הקשרים הם טענות המסמכים', 'Structure per documents the user provided: the parties\' identities checked against the registry by number; the relations are the documents\' claims'),
});

/* the stage buckets — every project once, at its FURTHEST VERIFIED stage (only STRONG / VERIFIED links move it) */
const STAGE_BUCKETS = Object.freeze([
  { id: 'LAND', label: bi('קרקע', 'LAND'), d: bi('מגרש שנזכה, ללא ראיה מאוחרת, והזכייה לפני פחות מ-18 חודשים', 'a lot won, no later evidence, awarded less than 18 months ago') },
  { id: 'MARKETED', label: bi('שיווק (הגרלה)', 'MARKETED (LOTTERY)'), d: bi('פרויקט הגרלה ללא סטטוס היתר, וההגרלה האחרונה לפני פחות מ-18 חודשים', 'a lottery project without a permit status, its latest lottery less than 18 months ago') },
  { id: 'PERMIT', label: bi('היתר', 'PERMIT'), d: bi('ראיה ישירה להיתר (רשומת היתר בתל אביב בקישור חזק / סטטוס היתר של משב״ש)', 'direct permit evidence (a Tel Aviv permit record on a STRONG link / a MoCH permit status)') },
  { id: 'CONSTRUCTION', label: bi('בנייה (ראיה לתחילה)', 'CONSTRUCTION (start evidence)'), d: bi('ראיה לתחילת בנייה שאינה אתר פעיל נוכחי (למשל דיווחי משב״ש — נכון ל-2024-03, ישן)', 'construction-start evidence that is not a current active site (e.g. MoCH progress rows — as of 2024-03, STALE)') },
  { id: 'ACTIVE_SITE', label: bi('אתר פעיל', 'ACTIVE SITE'), d: bi('אתר בנייה פעיל נוכחי בקישור חזק (רשימת משרד העבודה העדכנית / אתר פעיל בתל אביב)', 'a current active construction site on a STRONG link (the current Ministry of Labour list / an active Tel Aviv site)') },
  { id: 'COMPLETION', label: bi('גמר', 'COMPLETION'), d: bi('ראיה לגמר (דיווח משב״ש / תעודת גמר לפי שלב ההיתר)', 'completion evidence (a MoCH report / a completion certificate per the permit stage)') },
  { id: 'OCCUPANCY', label: bi('אכלוס / מסירה', 'OCCUPANCY / DELIVERY'), d: bi('ראיה לאכלוס (שלב ההיתר / סטטוס משב״ש)', 'occupancy evidence (the permit stage / a MoCH status)') },
  { id: 'NO_LATER_EVIDENCE', label: bi('אין ראיה ציבורית מאוחרת', 'NO LATER PUBLIC EVIDENCE'), d: bi('הראיה האחרונה היא הזכייה / ההגרלה, לפני 18 חודשים ויותר — לא "תקוע": מחוץ לתל אביב אין מקור היתרים / התחלות ברמת הפרויקט', 'the latest evidence is the award / the lottery, 18 months ago or more — not "stalled": outside Tel Aviv there is no project-level permits / starts source') },
]);
const BUCKET_IDS = STAGE_BUCKETS.map((b) => b.id);

/* documented thresholds — each shown with the signal it drives; changing one changes the signal, never a hidden score */
const RULES = Object.freeze({
  noLaterEvidenceMonths: 18,          // the project DD's execution-gap threshold (lib/dd/project.js GAP_MONTHS)
  concentrationTendersMin: 3,         // a concentration signal needs the group's lots from ≥ 3 distinct tenders (one tender = one observation)
  activityTendersMin: 3,              // an activity trend counts distinct tenders; the larger window needs ≥ 3
  oldLotMonths: 72,                   // "older lots" for the completion-coverage statement: awarded ≥ 72 months before the read
  startHorizonMonths: 36,             // award → construction start compared only over lots fully observable for 36 months
  completionHorizonMonths: 72,        // kept for reference; completion is now read over lots with a DATED start ≥ 36 months before the coverage end
  unfinishedStartMonths: 36,          // a start ≥ 36 months before the completion coverage end with no completion evidence
  ownMin: 3,                          // a group duration / share needs ≥ 3 observations
  cohortMin: 30,                      // a cohort comparison needs ≥ 30 observations
  localityCohortMin: 10,              // a locality cohort needs ≥ 10 observations
  fasterRatio: 0.8, slowerRatio: 1.25, // own median ≤ 0.8 × comparison → shorter; ≥ 1.25 × → longer; else similar
  shareMarginPp: 0.15,                // a share signal needs ≥ 15 percentage points against the cohort
  loadMin: 5,                         // the execution-load signal needs ≥ 5 projects with execution evidence …
  loadPercentile: 0.9,                // … and ≥ the 90th percentile of groups with any
  earlyStageMin: 5, earlyStageShare: 0.6, earlyStageMonths: 36,
  unfinishedMin: 3, unfinishedShare: 0.5,
  completionMin: 5, completionStrongShare: 0.5,
  trendMin: 3,                        // max(last 12, prior 12) ≥ 3 for an activity trend (as Developer Intelligence 2.0)
  concentrationShare: 0.7, concentrationMin: 5,
  matrixCellShare: 0.5, matrixCellMin: 5,
  entryWindows: [12, 24, 36],
  activeMonths: 36,                   // "active (open)" = not completed and either execution evidence or awarded / first lottery ≤ 36 months
  rowFreshMonths: 24, rowStaleMonths: 60,
});

/* the truth rules the module and its gates enforce */
const TRUTHS = Object.freeze([
  bi('מותג ≠ חברה משפטית', 'BRAND ≠ LEGAL COMPANY'),
  bi('חברת אם ≠ ערב', 'PARENT ≠ GUARANTOR'),
  bi('חברה בת ≠ חברת פרויקט (SPV)', 'SUBSIDIARY ≠ SPV'),
  bi('זוכה בקרקע ≠ חברת הפרויקט', 'LAND WINNER ≠ PROJECT COMPANY'),
  bi('קבלן ≠ יזם', 'CONTRACTOR ≠ DEVELOPER'),
  bi('אתר פעיל ≠ פרויקט שהושלם', 'ACTIVE SITE ≠ COMPLETED PROJECT'),
  bi('צנרת קרקע ≠ בנייה פעילה', 'LAND PIPELINE ≠ ACTIVE CONSTRUCTION'),
  bi('יח״ד שנזכו ≠ יח״ד שנמכרו', 'AWARDED UNITS ≠ SOLD UNITS'),
  bi('גודל הצנרת ≠ יכולת פיננסית', 'PIPELINE SIZE ≠ FINANCIAL CAPACITY'),
  bi('מינוף גבוה ≠ כשל', 'HIGH LEVERAGE ≠ DEFAULT'),
  bi('שעבוד ≠ מצוקה', 'CHARGE ≠ DISTRESS'),
  bi('אין דוחות ≠ חולשה פיננסית', 'NO FINANCIALS ≠ FINANCIAL WEAKNESS'),
  bi('אין ראיה מאוחרת ≠ פרויקט תקוע', 'NO LATER EVIDENCE ≠ PROJECT STALLED'),
  bi('קשר אפשרי ≠ שליטה קבוצתית', 'POSSIBLE RELATION ≠ GROUP CONTROL'),
]);

/* the two project universes — never joined, units never added across them */
const UNIVERSE = Object.freeze({
  ila: { id: 'ila', label: bi('מגרשי רמ״י שנזכו', 'ILA lots won'), units: bi('קיבולת המגרש (יח״ד במכרז) — לא דירות שנבנו', 'lot capacity (tender units) — not homes built'), source: 'rmi:michrazim' },
  moch: { id: 'moch', label: bi('פרויקטי הגרלה של משב״ש', 'MoCH lottery projects'), units: bi('יח״ד בהגרלה הראשונה — לא דירות שנמכרו', 'units of the first lottery — not homes sold'), source: 'datagov:moch:dira-behanacha-lotteries' },
  note: bi('שני היקומים אינם מצורפים בשום מפתח ועשויים לתאר את אותן דירות — הספירות והיח״ד לעולם אינן מחוברות ביניהם', 'the two universes share no key and may describe the same homes — their counts and units are never added together'),
});

const PROGRAMMES = Object.freeze({
  OPEN_MARKET: bi('שוק חופשי', 'OPEN MARKET'),
  SUBSIDIZED: bi('דיור מסובסד', 'SUBSIDIZED HOUSING'),
  LONG_TERM_RENTAL: bi('דיור להשכרה ארוכת טווח', 'LONG-TERM RENTAL'),
  URBAN_RENEWAL: bi('התחדשות עירונית', 'URBAN RENEWAL'),
  STATE_LAND: bi('קרקע מדינה', 'STATE LAND'),
  PRIVATE_LAND: bi('קרקע פרטית', 'PRIVATE LAND'),
  OTHER: bi('אחר', 'OTHER'),
});
const SUBSIDIZED_TRACKS = new Set(['subsidized', 'residential-lottery', 'special-population']);
const programmeOfTrack = (t) => (t === 'open-market' ? 'OPEN_MARKET' : t === 'rental' ? 'LONG_TERM_RENTAL' : SUBSIDIZED_TRACKS.has(t) ? 'SUBSIDIZED' : 'OTHER');
const marketOfTrack = (t) => (t === 'open-market' ? 'open' : t === 'rental' ? 'rental' : SUBSIDIZED_TRACKS.has(t) ? 'subsidized' : 'other');

/* Tel Aviv sites layer: the states that mean works are under way (a file opened is not; "גמר בניה" is completion) */
const TLV_ACTIVE_STATES = new Set(['תחילת עבודות', 'עבודות עפר וביסוס', 'גמר יסודות', 'גמר שלד']);

module.exports = { VERSION, bi, TIERS, STATUS, STRUCTURE, STAGE_BUCKETS, BUCKET_IDS, RULES, TRUTHS, UNIVERSE, PROGRAMMES, SUBSIDIZED_TRACKS, programmeOfTrack, marketOfTrack, TLV_ACTIVE_STATES };
