/* ALTARIS · LIVE THESIS — post-decision intelligence (altaris-live-thesis-v1, 18.10.2026)
 *
 * PROPX does not stop helping after an investment decision is made. This module keeps the ORIGINAL decision and the evidence
 * behind it, derives what had to remain true, ranks the missing evidence by decision relevance, names what to watch, and
 * compares THEN against NOW whenever a new verified PROPX read is available — through the SAME documented decision policy
 * (altaris/decision.js POLICY.final, rules F0–F5) and the SAME market & execution assessment (altaris/market-assessment.js).
 *
 *   snapshot({ D, R, deal, ctx, meta })   → an immutable DECISION SNAPSHOT: normalized facts only (never a rendered page), hashed
 *   contract(snapshot)                    → the THESIS CONTRACT: what must remain true · active conditions · what would break it
 *   nextBestEvidence(snapshot)            → the missing facts ranked by DECISION RELEVANCE (HIGH · MEDIUM · LOW · INFORMATIONAL)
 *   watchlist(snapshot)                   → the WATCHTOWER: only the dimensions the thesis depends on, with their sources
 *   reassess(snapshot, now)               → THEN vs NOW: the DECISION DELTA, every change with its category · materiality · rule ·
 *                                           decision impact, the retrospective answer, the narrative — economics frozen
 *   portfolio(list)                       → the PORTFOLIO THESIS MONITOR: counts by state, deterministic attention order
 *   createRepository(adapter)             → append-only records over a key/value adapter (localStorage today; a Supabase
 *                                           adapter later — see altaris/THESIS_PERSISTENCE.md); original snapshots never rewritten
 *
 * Principles (each one gated in test/altaris-thesis.test.js):
 *   · the economics are FROZEN in the snapshot: IRR · MOIC · capital at risk · cash flows · gates · the economic verdict never
 *     move with market data; only the user's RE-UNDERWRITE (a new saved version) recomputes them — that is a new thesis version;
 *   · a REASSESSMENT reads new external evidence only: the new market & execution assessment reaches the verdict through
 *     POLICY.final exactly as at decision time (never an upgrade of the economic verdict);
 *   · missing or stale evidence is never positive evidence: no fresh read → INSUFFICIENT NEW EVIDENCE and every condition stays;
 *   · a condition is resolved only by the documented rule that created it (the market condition by the assessment leaving
 *     CAUTION; an economic condition only by a re-underwrite with the verified input);
 *   · materiality is a constant per rule — a number that changed is not material; convergence / conditions / verdict are;
 *   · categories are kept apart: DEAL_ASSUMPTION · MARKET_EVIDENCE · PROJECT_EXECUTION · DEVELOPER · SOURCE_EVIDENCE · MACRO;
 *   · history is never rewritten: the original snapshot is hashed; later states are appended as events / versions;
 *   · no prediction, no recommendation, no probability — only evidence and decision policy.
 * Pure: no DOM, no storage, no network, no clock (dates are passed in), no randomness. UMD: the page loads /altaris/thesis.js
 * (window.AltarisThesis); Node tests require it. It reads the decision layer's output and the assessment module — never the engine. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./decision.js'), require('./market-assessment.js'));
  else root.AltarisThesis = factory(root.AltarisDecision, root.AltarisMarket);
})(typeof self !== 'undefined' ? self : this, function (DX, MA) {
  'use strict';
  const VERSION = Object.freeze({ id: 'altaris-live-thesis-v1', n: 1, effective: '2026-10-18', decision: DX.VERSION.id, market: MA.VERSION.id, snapshotSchema: 'altaris-decision-snapshot-v1' });
  const bi = (he, en) => ({ he, en });
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const DAY = 86400000;
  const day = (s) => (s ? String(s).slice(0, 10) : null);
  const daysBetween = (a, b) => (a && b && /^\d{4}-\d{2}-\d{2}/.test(String(a)) && /^\d{4}-\d{2}-\d{2}/.test(String(b)) ? Math.round((Date.parse(day(b)) - Date.parse(day(a))) / DAY) : null);
  const T = (v, L) => (v == null ? '' : typeof v === 'object' ? (v[L] != null ? v[L] : v.en) : String(v));
  const VERDICT = DX.VERDICT;
  const FRESH_DAYS = MA.FRESH_DAYS;
  const STALE_READ_DAYS = DX.POLICY.staleCheckDays;   // the decision's own evidence deduction threshold (−8 beyond it)

  /* ------------------------------------------------------------------ canon */
  /* a canonical JSON (sorted keys) and a deterministic FNV-1a hash over it: tamper evidence for the immutable snapshot (not a secret) */
  function canon(v) {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? 'null' : JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  function hashOf(v) {
    const s = canon(v);
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0; h2 = (h2 + c * (i + 1)) >>> 0; h2 = Math.imul(h2 ^ (h2 >>> 13), 0x5bd1e995) >>> 0; }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8) + '-' + s.length.toString(36);
  }
  const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  /* the deal without its PROPX context and labels: what the user entered (the engine reads only this) */
  function dealFacts(deal) { const d = clone(deal || {}); delete d.market; delete d.example; delete d.case; delete d.origin; return d; }

  /* ------------------------------------------------------------ vocabulary */
  const STATUS = Object.freeze({
    SUPPORTED: { label: bi('נתמכת', 'SUPPORTED'), d: bi('אף שינוי מהותי לא נמצא מאז ההחלטה; ההחלטה המקורית עומדת תחת אותה מדיניות', 'no material change since the decision; the original decision stands under the same policy') },
    CHANGED: { label: bi('השתנתה', 'CHANGED'), d: bi('ראיה מאומתת חדשה שינתה תנאי, הערכת שוק או גורם מהותי — ההחלטה תחת אותה מדיניות מצוינת לצד המקורית', 'new verified evidence changed a condition, the market assessment or a material factor — the decision under the same policy is shown beside the original') },
    REVIEW_REQUIRED: { label: bi('נדרשת בחינה', 'REVIEW REQUIRED'), d: bi('תחת אותה מדיניות ההחלטה הייתה שונה היום — הראיה והכלל שהניעו זאת מפורטים', 'under the same policy the decision would differ today — the evidence and the rule that moved it are listed') },
    NOT_CHECKED: { label: bi('טרם נבדקה', 'NOT CHECKED'), d: bi('תמונת ההחלטה נשמרה; טרם נעשתה בדיקה מול קריאה חדשה', 'the decision snapshot is kept; no check against a newer read has been made yet') },
  });
  const DELTA = Object.freeze({
    NO_MATERIAL_THESIS_CHANGE: { label: bi('אין שינוי מהותי בתזה', 'NO MATERIAL THESIS CHANGE'), status: 'SUPPORTED', attention: 7 },
    THESIS_STRENGTHENED: { label: bi('התזה התחזקה', 'THESIS STRENGTHENED'), status: 'CHANGED', attention: 6 },
    CONDITION_RESOLVED: { label: bi('תנאי הוסר', 'CONDITION RESOLVED'), status: 'CHANGED', attention: 5 },
    NEW_CONDITION_TRIGGERED: { label: bi('תנאי חדש הופעל', 'NEW CONDITION TRIGGERED'), status: 'CHANGED', attention: 2 },
    THESIS_WEAKENED: { label: bi('התזה נחלשה', 'THESIS WEAKENED'), status: 'CHANGED', attention: 3 },
    DECISION_REQUIRES_REVIEW: { label: bi('ההחלטה דורשת בחינה', 'DECISION REQUIRES REVIEW'), status: 'REVIEW_REQUIRED', attention: 1 },
    INSUFFICIENT_NEW_EVIDENCE: { label: bi('אין מספיק ראיות חדשות', 'INSUFFICIENT NEW EVIDENCE'), status: null, attention: 8 },
    DEAL_CHANGED: { label: bi('הנחות העסקה השתנו', 'DEAL ASSUMPTIONS CHANGED'), status: null, attention: 4 },
  });
  const CATEGORY = Object.freeze({
    DEAL_ASSUMPTION: bi('שינוי הנחת עסקה', 'DEAL ASSUMPTION CHANGE'), MARKET_EVIDENCE: bi('שינוי ראיות שוק', 'MARKET EVIDENCE CHANGE'), PROJECT_EXECUTION: bi('שינוי בביצוע הפרויקט', 'PROJECT EXECUTION CHANGE'),
    DEVELOPER: bi('שינוי אצל היזם', 'DEVELOPER CHANGE'), SOURCE_EVIDENCE: bi('שינוי מקור / ראיה', 'SOURCE / EVIDENCE CHANGE'), MACRO: bi('שינוי מאקרו', 'MACRO CHANGE'), GEOGRAPHY: bi('שינוי בתיק הגאוגרפיה', 'GEOGRAPHY DOSSIER CHANGE'),
  });
  const MATERIALITY = Object.freeze({ INFORMATIONAL: { rank: 0, label: bi('מידע', 'INFORMATIONAL CHANGE') }, RELEVANT: { rank: 1, label: bi('רלוונטי', 'RELEVANT CHANGE') }, MATERIAL_THESIS: { rank: 2, label: bi('מהותי לתזה', 'MATERIAL THESIS CHANGE') }, DECISION_IMPACTING: { rank: 3, label: bi('משפיע על ההחלטה', 'DECISION-IMPACTING CHANGE') } });
  const IMPACT = Object.freeze({ NONE: bi('ללא', 'NONE'), CONDITION_RESOLVED: bi('תנאי הוסר', 'CONDITION RESOLVED'), CONDITION_ADDED: bi('תנאי נוסף', 'CONDITION ADDED'), VERDICT_CHANGED: bi('ההחלטה השתנתה', 'DECISION CHANGED'), ASSESSMENT_MOVED: bi('הערכת השוק זזה', 'ASSESSMENT MOVED'), EVIDENCE: bi('איכות ראיות (בחיתום מחדש)', 'EVIDENCE QUALITY (on re-underwrite)'), CONTEXT: bi('הקשר בלבד', 'CONTEXT ONLY') });
  const RELEVANCE = Object.freeze({ HIGH: { rank: 3, label: bi('רלוונטיות גבוהה להחלטה', 'HIGH DECISION RELEVANCE') }, MEDIUM: { rank: 2, label: bi('רלוונטיות בינונית להחלטה', 'MEDIUM DECISION RELEVANCE') }, LOW: { rank: 1, label: bi('רלוונטיות נמוכה להחלטה', 'LOW DECISION RELEVANCE') }, INFORMATIONAL: { rank: 0, label: bi('מידע בלבד', 'INFORMATIONAL ONLY') } });
  const MONITOR = Object.freeze({ LIVE: bi('חיה', 'LIVE'), PAUSED: bi('מושהית', 'PAUSED') });
  const BASIS = Object.freeze({
    DECISION_SAVE: bi('נשמרה עם ההחלטה', 'SAVED WITH THE DECISION'),
    RECONSTRUCTED: bi('שוחזרה מהגרסה השמורה (ההחלטה שנחתמה בשמירה זהה)', 'RECONSTRUCTED FROM THE SAVED VERSION (the decision stamped at save time matches)'),
    BASELINE_TODAY: bi('קו בסיס שנוצר היום — לא הייתה תמונת החלטה היסטורית מהימנה', 'BASELINE CREATED TODAY — no trustworthy historical decision snapshot existed'),
  });
  /* every thesis rule the delta can cite — a constant materiality per rule; never a judgement */
  const RULES = Object.freeze({
    'TH-DEAL': { category: 'DEAL_ASSUMPTION', materiality: 'DECISION_IMPACTING', rule: bi('הנחות העסקה השמורה שונות מתמונת ההחלטה — הכלכלה מחושבת מחדש רק בחיתום מחדש (גרסה חדשה); התזה אינה נבחנת מול הנחות שהשתנו', 'the saved deal\'s assumptions differ from the decision snapshot — economics recompute only on a re-underwrite (a new version); the thesis is not reassessed against changed assumptions') },
    'TH-NOREAD': { category: 'SOURCE_EVIDENCE', materiality: 'INFORMATIONAL', rule: bi('אין קריאת PROPX חדשה וטרייה (תיק + רדאר ≤ 30 ימים) — אין הערכה חדשה; כל תנאי נשאר; ראיה חסרה אינה ראיה חיובית', 'no fresh new PROPX read (dossier + radar ≤ 30 days) — no new assessment; every condition stays; missing evidence is not positive evidence') },
    'TH-F3': { category: 'MARKET_EVIDENCE', materiality: 'DECISION_IMPACTING', rule: bi('הערכת השוק הגיעה לזהירות (≥ 2 גורמים שליליים מהותיים מ-≥ 2 משפחות מקור) — תחת כלל F3 TAKE הופך ל-TAKE WITH CONDITIONS עם תנאי שוק', 'the assessment reached CAUTION (≥ 2 material negatives from ≥ 2 source families) — under rule F3 TAKE becomes TAKE WITH CONDITIONS with a market condition') },
    'TH-F4': { category: 'MARKET_EVIDENCE', materiality: 'MATERIAL_THESIS', rule: bi('הערכת השוק הגיעה לזהירות — תחת כלל F4 תנאי השוק מתווסף לצד התנאים הכלכליים; ההחלטה נשארת TAKE WITH CONDITIONS', 'the assessment reached CAUTION — under rule F4 the market condition is added beside the economic ones; the decision stays TAKE WITH CONDITIONS') },
    'TH-F5-RESOLVE': { category: 'MARKET_EVIDENCE', materiality: 'DECISION_IMPACTING', rule: bi('הערכת השוק יצאה מזהירות — תנאי השוק המקורי הוסר (הגורמים שיצרו אותו אינם מתכנסים עוד); תחת כלל F5 ההכרעה הכלכלית עומדת', 'the assessment left CAUTION — the original market condition is resolved (its factors no longer converge); under rule F5 the economic verdict stands') },
    'TH-NEG-NEW': { category: 'MARKET_EVIDENCE', materiality: 'RELEVANT', rule: bi('גורם שלילי מהותי חדש (רשמי / נצפה, איכות HIGH / MEDIUM, גאוגרפיה של העסקה, קריאה טרייה) — נרשם; לבדו אינו משנה הערכה', 'a new material negative factor (OFFICIAL / OBSERVED, HIGH / MEDIUM evidence, the deal\'s geography, a fresh read) — noted; alone it moves no assessment') },
    'TH-NEG-GONE': { category: 'MARKET_EVIDENCE', materiality: 'RELEVANT', rule: bi('גורם שלילי מהותי שהיה בתמונת ההחלטה אינו מתקיים עוד בקריאה הטרייה', 'a material negative factor of the decision snapshot no longer holds in the fresh read') },
    'TH-POS-NEW': { category: 'MARKET_EVIDENCE', materiality: 'RELEVANT', rule: bi('גורם חיובי מהותי חדש — הקשר; לעולם אינו משדרג הכרעה כלכלית', 'a new material positive factor — context; it never upgrades an economic verdict') },
    'TH-POS-GONE': { category: 'MARKET_EVIDENCE', materiality: 'RELEVANT', rule: bi('גורם חיובי מהותי שהיה בתמונת ההחלטה אינו מתקיים עוד', 'a material positive factor of the decision snapshot no longer holds') },
    'TH-STATUS': { category: 'MARKET_EVIDENCE', materiality: 'MATERIAL_THESIS', rule: bi('מצב הערכת השוק וביצוע השתנה (חזק / ניטרלי / זהירות) — לפי כללי ההתכנסות של ההערכה', 'the market & execution status moved (STRONG / NEUTRAL / CAUTION) — by the assessment\'s own convergence rules') },
    'TH-FACTOR-INFO': { category: 'MARKET_EVIDENCE', materiality: 'INFORMATIONAL', rule: bi('גורם מידע (ללא כיוון, נגזר / מודל, ראיות חלשות, ארצי או קריאה ישנה) הופיע, נעלם או השתנה — אינו נספר להתכנסות', 'an informational factor (no direction, DERIVED / MODEL, weak evidence, national or an old read) appeared, disappeared or changed — it never counts toward convergence') },
    'TH-FACTOR-VALUE': { category: 'MARKET_EVIDENCE', materiality: 'INFORMATIONAL', rule: bi('ערך של גורם מהותי השתנה בלי לחצות את ספו — המספר זז, הכלל לא', 'a material factor\'s value changed without crossing its threshold — the number moved, the rule did not') },
    'TH-AGING': { category: 'SOURCE_EVIDENCE', materiality: 'RELEVANT', rule: bi(`קריאת PROPX שעמדה בבסיס ההחלטה ישנה מ-${STALE_READ_DAYS} ימים — התיישנות ראיות, לא אות שלילי; בחיתום מחדש איכות הראיות תנכה −8`, `the PROPX read behind the decision is older than ${STALE_READ_DAYS} days — evidence aging, not a negative signal; a re-underwrite would deduct −8 from evidence quality`) },
    'TH-SOURCE-STALE': { category: 'SOURCE_EVIDENCE', materiality: 'RELEVANT', rule: bi('מקור רשמי שהזין את ההחלטה מסומן ישן (STALE) בקריאה הנוכחית — הערך הישן אינו הופך לאות שלילי חדש', 'an official source behind the decision is now STALE — the old value does not become a new negative signal') },
    'TH-SOURCE-RECOVERED': { category: 'SOURCE_EVIDENCE', materiality: 'RELEVANT', rule: bi('מקור שהיה ישן / חסר בתמונת ההחלטה זמין שוב בקריאה הנוכחית', 'a source that was stale / missing in the decision snapshot is available again in the current read') },
    'TH-CONFLICT': { category: 'SOURCE_EVIDENCE', materiality: 'RELEVANT', rule: bi(`חציון PROPX × שטח סוטה מהשווי לחיתום ביותר מ-${Math.round(DX.POLICY.conflictSpread * 100)}% — סתירת מקורות; שני הערכים נשמרים; בחיתום מחדש איכות הראיות תנכה`, `the PROPX median × area deviates from the underwriting value by more than ${Math.round(DX.POLICY.conflictSpread * 100)}% — a source conflict; both values are kept; a re-underwrite would deduct from evidence quality`) },
    'TH-CONFLICT-GONE': { category: 'SOURCE_EVIDENCE', materiality: 'RELEVANT', rule: bi('סתירת המקורות שנרשמה בתמונת ההחלטה אינה מתקיימת עוד בקריאה הנוכחית', 'the source conflict recorded in the decision snapshot no longer holds in the current read') },
    'TH-TX': { category: 'MARKET_EVIDENCE', materiality: 'INFORMATIONAL', rule: bi('חלון העסקאות של היישוב (ספירה / תקופה) השתנה בלי לחצות סף עומק (≥ 100 חיובי · < 10 שלילי)', 'the locality\'s transaction window (count / period) changed without crossing a depth threshold (≥ 100 positive · < 10 negative)') },
    'TH-DEV': { category: 'DEVELOPER', materiality: 'INFORMATIONAL', rule: bi('פעילות היזם שנצפתה ב-PROPX השתנתה (מגרשים / זכיות / הגרלות / ראיות בנייה) — הקשר; אין כלל החלטה שקורא אותה ישירות', 'the developer\'s observed PROPX activity changed (lots / wins / lotteries / construction evidence) — context; no decision rule reads it directly') },
    'TH-DEV-CONSTR': { category: 'PROJECT_EXECUTION', materiality: 'RELEVANT', rule: bi('ראיות הבנייה של היזם (דיווחי התקדמות משב״ש) השתנו — ברמת היזם, לא ברמת הפרויקט; אינן פותרות תנאי היתר / תחילת בנייה של העסקה', 'the developer\'s construction evidence (MoCH progress reports) changed — developer-level, not project-level; it resolves no permit / construction-start condition of the deal') },
    'TH-PIPE': { category: 'PROJECT_EXECUTION', materiality: 'INFORMATIONAL', rule: bi('צנרת הפרויקטים שנצפתה ביישוב (שלבים / ספירות) השתנתה — הקשר; לעסקה אין צירוף לפרויקט ציבורי (שם בלבד)', 'the observed project pipeline in the locality (stages / counts) changed — context; the deal has no join to a public project (name only)') },
    'TH-MACRO': { category: 'MACRO', materiality: 'INFORMATIONAL', rule: bi('אינדיקטור מאקרו (ריבית בנק ישראל, תשומות בנייה) השתנה בלי שגורם המאקרו חצה את ספו', 'a macro indicator (Bank of Israel rate, construction inputs) changed without the macro factor crossing its threshold') },
    'TH-CBS': { category: 'MARKET_EVIDENCE', materiality: 'INFORMATIONAL', rule: bi('סדרת המכירות הרשמית פרסמה תקופה חדשה / ערך מתוקן — נרשם; המשמעות להחלטה נקבעת רק דרך גורם המומנטום', 'the official sales series published a new period / a revised value — noted; its decision meaning is determined only through the momentum factor') },
    'TH-REVISION': { category: 'SOURCE_EVIDENCE', materiality: 'INFORMATIONAL', rule: bi('תיקון רשמי לתקופה שקדמה להחלטה — הערך המקורי נשמר לצד המתוקן; ההשפעה הרטרוספקטיבית נבחנת דרך הגורם שקרא אותו', 'an official revision of a period before the decision — the original value is kept beside the revised one; the retrospective impact is judged through the factor that read it') },
    'TH-GEO': { category: 'GEOGRAPHY', materiality: 'INFORMATIONAL', rule: bi('עובדה בתיק הגאוגרפיה השתנתה בין שתי תמונות מצב של PROPX (היסטוריית התיק) — השפעה על ההחלטה רק אם גורם הערכה שקורא אותה זז', 'a fact of the geography dossier changed between two PROPX snapshots (dossier history) — a decision impact only when an assessment factor that reads it moved') },
    'TH-SETTINGS': { category: 'DEAL_ASSUMPTION', materiality: 'INFORMATIONAL', rule: bi('הגדרות הקרן השתנו מאז ההחלטה — הכלכלה קפואה בהגדרות ההחלטה; חיתום מחדש יחיל את החדשות', 'the fund settings changed since the decision — the economics are frozen at the decision\'s settings; a re-underwrite applies the new ones') },
  });
  const ATTENTION = Object.freeze([
    { n: 1, state: 'DECISION_REQUIRES_REVIEW', label: bi('ההחלטה דורשת בחינה', 'DECISION REQUIRES REVIEW') },
    { n: 2, state: 'NEW_CONDITION_TRIGGERED', label: bi('תנאי חדש', 'NEW CONDITION') },
    { n: 3, state: 'THESIS_WEAKENED', label: bi('תנאי פעיל החמיר / גורם שלילי חדש', 'ACTIVE CONDITION WORSENED / NEW NEGATIVE') },
    { n: 4, state: 'DEAL_CHANGED', label: bi('הנחות השתנו — נדרש חיתום מחדש', 'ASSUMPTIONS CHANGED — RE-UNDERWRITE') },
    { n: 5, state: 'SOURCE_ISSUE', label: bi('סתירת מקורות / התיישנות ראיות', 'SOURCE CONFLICT / EVIDENCE DETERIORATION') },
    { n: 6, state: 'CONDITION_RESOLVED', label: bi('תנאי הוסר', 'CONDITION RESOLVED') },
    { n: 7, state: 'NEW_INFORMATION', label: bi('מידע חדש — ללא השפעה על ההחלטה', 'NEW INFORMATION — NO DECISION IMPACT') },
    { n: 8, state: 'NO_MATERIAL_THESIS_CHANGE', label: bi('אין שינוי מהותי', 'NO MATERIAL CHANGE') },
    { n: 9, state: 'NOT_CHECKED', label: bi('טרם נבדקה', 'NOT CHECKED') },
    { n: 10, state: 'PAUSED', label: bi('מושהית', 'PAUSED') },
  ]);

  /* the product copy — one source for the page and the documentation */
  const COPY = Object.freeze({
    name: bi('תזה חיה', 'LIVE THESIS'),
    tagline: bi('PROPX זוכרת למה קיבלתם את ההחלטה — ומודיעה כשהעובדות שמאחוריה משתנות מהותית.', 'PROPX remembers why you made the decision — and tells you when the facts behind it materially change.'),
    title: bi('ההחלטה שלכם לא צריכה להפסיק ללמוד ברגע שלחצתם TAKE.', 'Your decision should not stop learning when you press TAKE.'),
    body: [
      bi('PROPX שומרת את תזת ההשקעה המקורית ואת הראיות שמאחוריה, ובודקת מידע מאומת חדש מול ההחלטה הזו לאורך זמן.', 'PROPX keeps the original investment thesis and the evidence behind it, then checks new verified information against that decision over time.'),
      bi('היא אינה חוזה את העתיד ואינה מגיבה לכל עדכון שוק.', 'It does not predict the future and it does not react to every market update.'),
      bi('היא עוקבת אחר העובדות שהיו חשובות להחלטה המקורית ומודיעה כשאחת מהן משתנה מהותית.', 'It watches the facts that mattered to your original decision and tells you when one of them materially changes.'),
    ],
    always: [bi('מה PROPX ידעה כשההחלטה התקבלה', 'what PROPX knew when the decision was made'), bi('מה היה חייב להישאר נכון', 'what had to remain true'), bi('איזו ראיה הייתה החשובה ביותר', 'what evidence mattered most'),
      bi('מה השתנה מאז', 'what changed since then'), bi('האם השינוי משפיע על ההחלטה המקורית', 'whether the change affects the original decision'), bi('איזו ראיה חשובה עכשיו', 'what evidence matters next')],
    cta: bi('השאירו את התזה חיה', 'KEEP THIS THESIS LIVE'),
    ctaBody: bi('PROPX תעקוב אחר הראיות שמאחורי ההחלטה ותציף רק שינויים מהותיים.', 'PROPX will monitor the evidence behind this decision and surface only material changes.'),
    whatQ: bi('מה התזה החיה עוקבת אחריו?', 'WHAT DOES LIVE THESIS MONITOR?'),
    whatA: bi('את העובדות המאומתות שהשפיעו על ההחלטה הזו — לא כל רעש שוק.', 'It monitors the verified facts that influenced this decision — not every piece of market noise.'),
    automatic: bi('שמירת עסקה עם החלטה שומרת גם את תמונת ההחלטה ואת הראיות שמאחוריה — אוטומטית, בלי צעד נוסף. בדיקה מול קריאה חדשה נעשית כשמבקשים ("בדיקה עכשיו") ובפתיחת הפורטפוליו.', 'Saving a deal that carries a decision also keeps the decision snapshot and the evidence behind it — automatically, no extra step. A check against a newer read runs on request ("Check now") and when the portfolio opens.'),
    limitation: bi('העסקאות והתזות נשמרות בדפדפן זה בלבד (אחסון מקומי), כמו העסקאות השמורות; שמירה בשרת תתווסף כשמאגר PROPX יחובר — ללא שינוי בלוגיקה.', 'Deals and theses are kept in this browser only (local storage), like the saved deals; server-side persistence follows when the PROPX store is connected — with no change in logic.'),
    reassessVsReunderwrite: bi('בחינה מחדש של תזת השוק קוראת ראיות חיצוניות חדשות בלבד — ההנחות והכלכלה אינן משתנות. חיתום מחדש = שינוי הנחות על ידי המשתמש, חישוב כלכלי מחדש וגרסת החלטה חדשה.', 'Reassessing the market thesis reads new external evidence only — assumptions and economics do not change. A re-underwrite = the user changes assumptions, the economics recompute, a new decision version is created.'),
    disclaimer: bi('התזה החיה מתעדת ראיות ומדיניות החלטה. היא אינה תחזית, אינה הערכת ביצועים ואינה ייעוץ השקעות.', 'Live Thesis documents evidence and decision policy. It is not a forecast, not a performance estimate and not investment advice.'),
  });

  /* ------------------------------------------------------------- snapshot */
  const slimGate = (g) => ({ id: g.id, kind: g.kind || null, label: g.label, status: g.status, value: isNum(g.value) ? g.value : null, limit: isNum(g.limit) ? g.limit : null, fmt: g.fmt || null, critical: !!g.critical });
  const slimFactor = (f) => ({ id: f.id, signal: f.signal, kind: f.kind || null, dimension: f.dimension, direction: f.direction, material: !!f.material, text: f.text, value: f.value != null ? f.value : null, comparison: f.comparison || null, period: f.period || null, source: f.source || null,
    family: f.family || null, cls: f.cls || null, evidence: f.evidence || null, geoScope: f.geoScope || null, fresh: f.fresh !== false, rule: f.rule || null, remove: f.remove || null, derived: !!f.derived, via: f.via || null, whyNotMaterial: f.whyNotMaterial || null, m: isNum(f.m) ? f.m : null });
  const slimCond = (c) => ({ id: c.id, source: c.source || 'economic', text: c.text, basis: c.basis || null, factors: Array.isArray(c.factors) ? c.factors.map((f) => ({ id: f.id, signal: f.signal, text: f.text, remove: f.remove || null })) : null, remove: Array.isArray(c.remove) ? c.remove : null });
  const slimFlip = (f) => ({ id: f.id, label: f.label, fmt: f.fmt || null, direction: f.direction, from: isNum(f.from) ? f.from : null, at: isNum(f.at) ? f.at : null, fromVerdict: f.fromVerdict, toVerdict: f.toVerdict, rel: isNum(f.rel) ? f.rel : null, text: f.text });
  const slimDev = (d) => (!d ? null : d.none ? { none: true } : { id: d.id || null, name: d.name || null, lots: isNum(d.lots) ? d.lots : null, units: isNum(d.units) ? d.units : null, lastWin: d.lastWin || null, projects: isNum(d.projects) ? d.projects : null, lotteryUnits: isNum(d.lotteryUnits) ? d.lotteryUnits : null, lastLottery: d.lastLottery || null, cities: isNum(d.cities) ? d.cities : null,
    construction: d.construction ? { buildings: d.construction.buildings != null ? d.construction.buildings : null, started: d.construction.started != null ? d.construction.started : null, completed: d.construction.completed != null ? d.construction.completed : null, asOf: d.construction.asOf || null } : null, possibleSame: isNum(d.possibleSame) ? d.possibleSame : 0 });
  const slimTx = (tx) => (!tx ? null : { n: isNum(tx.n) ? tx.n : null, newN: isNum(tx.newN) ? tx.newN : null, median: isNum(tx.median) ? tx.median : null, newMedian: isNum(tx.newMedian) ? tx.newMedian : null, from: tx.from || null, to: tx.to || null, via: tx.via || null, snapshotAt: tx.snapshotAt || null });
  const slimCbs = (c) => (!c ? null : { ok: !!c.ok, level: c.level || null, code: c.code || null, scope: c.scope || null, latest: c.latest || null, momentum: isNum(c.momentum) ? c.momentum : null, small: !!c.small, freshness: c.freshness || null, sourceUpdate: c.sourceUpdate || null, checkedAt: c.checkedAt || null, inventory: isNum(c.inventory) ? c.inventory : null, inventoryPeriod: c.inventoryPeriod || null });
  const slimInd = (ind) => { const o = {}; for (const k of ['boiRate', 'cpi', 'newHomesIndex', 'constructionInputsIndex']) { const x = ind && ind[k]; if (x) o[k] = { value: isNum(x.value) ? x.value : null, yoy: isNum(x.yoy) ? x.yoy : null, period: x.period || null, publishedAt: x.publishedAt || null }; } return o; };
  /* the market context exactly as the page keeps it (deal.market) → the normalized facts the thesis needs */
  function slimMarket(m) {
    if (!m) return null;
    const ds = m.dossier || null, rd = m.radar || null;
    return { retrievedAt: m.retrievedAt || null, city: m.city || null, cityCode: m.cityCode || null, street: m.street || null, tx: slimTx(m.tx),
      land: m.land ? { tenders: m.land.tenders != null ? m.land.tenders : null, unitsOpen: m.land.unitsOpen != null ? m.land.unitsOpen : null, unitsAwarded: m.land.unitsAwarded != null ? m.land.unitsAwarded : null, unitsPendingDecision: m.land.unitsPendingDecision != null ? m.land.unitsPendingDecision : null } : null,
      housing: m.housing ? { lotteries: m.housing.lotteries != null ? m.housing.lotteries : null, projects: m.housing.projects != null ? m.housing.projects : null, units: m.housing.units != null ? m.housing.units : null } : null,
      pipeline: m.pipeline ? { total: m.pipeline.total != null ? m.pipeline.total : null, stageCounts: m.pipeline.stageCounts || {}, recent: (m.pipeline.recent || []).map((r) => ({ id: r.id, kind: r.kind, name: r.name || null, developer: r.developer || null, stage: r.stage || null, date: r.date || null })) } : null,
      rental: m.rental ? { tenders: m.rental.tenders != null ? m.rental.tenders : null, tenderUnits: m.rental.tenderUnits != null ? m.rental.tenderUnits : null, withNotice: m.rental.withNotice != null ? m.rental.withNotice : null, checkedAt: m.rental.checkedAt || null } : null,
      dossier: ds ? { generatedAt: ds.generatedAt || null, quality: ds.quality ? { level: ds.quality.level, score: ds.quality.score } : null, salesScope: ds.salesScope || null, watch: (ds.watch || []).map((s) => s.id), risk: (ds.risk || []).map((s) => s.id), missing: (ds.missing || []).slice(), missingIds: (ds.missingIds || []).slice(),
        landEconomics: ds.landEconomics ? { medianPct: isNum(ds.landEconomics.medianPct) ? ds.landEconomics.medianPct : null, lots: ds.landEconomics.lots != null ? ds.landEconomics.lots : null, mixWarning: !!ds.landEconomics.mixWarning } : null } : null,
      radar: rd ? { builtAt: rd.builtAt || null, served: rd.served || null, opportunities: (rd.opportunities || []).map((x) => x.signal), risks: (rd.risks || []).map((x) => x.signal) } : null,
      entries: m.entries ? { total: m.entries.total != null ? m.entries.total : null } : null, devIntel: slimDev(m.devIntel),
      errors: ['tx', 'land', 'housing', 'pipeline', 'rental', 'dossier', 'radar', 'entries', 'devIntel'].filter((k) => m[k + 'Error']) };
  }
  /**
   * snapshot({ D, R, deal, ctx, meta }) — D: the decision (altaris/decision.js decide, with D.flips when computed); R: the engine output
   * (read only through D's own figures); deal: the saved deal; ctx: the decision context the page passed (today, market, cbs, indicators,
   * marketAssessment); meta: { dealId, versionN, savedAt, createdAt, basis (DECISION_SAVE · RECONSTRUCTED · BASELINE_TODAY), stamp, settings }.
   * Returns a deep-frozen object with its hash. Normalized facts only.
   */
  function snapshot(a) {
    const D = a.D, deal = a.deal || {}, ctx = a.ctx || {}, meta = a.meta || {}, R = a.R || null;
    if (!D || !D.version) throw new Error('snapshot needs a decision');
    const F = R && R.facts ? R.facts : {};
    const lead = D.lead || null, A = D.structures || {};
    const structures = {};
    for (const k of Object.keys(A)) { const s = A[k]; structures[k] = !s || !s.ok ? { ok: false, verdict: 'INSUFFICIENT_EVIDENCE', missing: (s && s.missing) || [] } : { ok: true, verdict: s.verdict, basis: s.basis, score: isNum(s.score) ? s.score : null, irr: isNum(s.irr) ? s.irr : null, irrDown: isNum(s.irrDown) ? s.irrDown : null, moic: isNum(s.moic) ? s.moic : null, capitalAtRisk: isNum(s.capital) ? s.capital : null, profit: isNum(s.profit) ? s.profit : null, months: isNum(s.months) ? s.months : null, mos: isNum(s.mos) ? s.mos : null, coverage: isNum(s.coverage) ? s.coverage : null,
      hurdles: s.hurdles || null, gates: (s.gates || []).map(slimGate), soft: s.soft || [], criticalFail: s.criticalFail || [], evidence: s.evidence ? { score: s.evidence.score, level: s.evidence.level } : null, groups: s.groups ? Object.fromEntries(Object.keys(s.groups).map((g) => [g, isNum(s.groups[g].score) ? s.groups[g].score : null])) : null }; }
    const MAx = D.marketAssessment || null;
    const market = slimMarket(ctx.market || deal.market || null);
    const info = deal.info || {};
    const dealF = dealFacts(deal);
    const snap = {
      schema: VERSION.snapshotSchema, version: { thesis: VERSION.id, decision: D.version.id, market: MAx ? (MAx.version && MAx.version.id) || MA.VERSION.id : null, engine: D.version.engine ? D.version.engine.version : null, metricMethodology: D.version.metricMethodology || null },
      dealId: meta.dealId || null, versionN: isNum(meta.versionN) ? meta.versionN : null, decidedAt: day(ctx.today) || day(meta.savedAt) || null, savedAt: meta.savedAt || null, createdAt: meta.createdAt || meta.savedAt || null,
      basis: BASIS[meta.basis] ? meta.basis : 'DECISION_SAVE', basisLabel: BASIS[BASIS[meta.basis] ? meta.basis : 'DECISION_SAVE'], stampAtSave: meta.stamp || null,
      name: info.name || null,
      geography: { city: info.city || null, cityCode: info.cityCode || null, district: info.district || null, street: info.street || null },
      developer: info.developer || null, project: info.project || null,
      assumptions: { dealHash: hashOf(dealF), settingsHash: hashOf(meta.settings || null), supportedValue: isNum(F.smv) ? F.smv : null, valueSource: F.chosen || null, basis: isNum(F.basis) ? F.basis : null, sqm: isNum(F.sqm) ? F.sqm : null, status: F.status || null, developerRating: F.developerRating || null, selected: deal.selected || null, spread: isNum(F.spread) ? F.spread : null, sources: F.sources ? Object.fromEntries(Object.keys(F.sources).map((k) => [k, isNum(F.sources[k]) ? F.sources[k] : null])) : null },
      economic: { verdict: D.economic ? D.economic.verdict : D.verdict, basis: D.economic ? D.economic.basis : D.basis, score: isNum(D.score) ? D.score : null, descriptor: D.descriptor || null, recommended: D.recommended || null, second: D.second || null, lead, structures,
        evidence: { score: D.evidence ? D.evidence.score : null, level: D.evidence ? D.evidence.level : null, conflict: !!(D.evidence && D.evidence.conflict), insufficient: !!(D.evidence && D.evidence.insufficient), items: ((D.evidence && D.evidence.items) || []).map((it) => ({ id: it.id, delta: isNum(it.delta) ? it.delta : null, cls: it.cls || null, text: it.text })) },
        missing: (D.missing || []).map((m) => ({ k: m.k, missing: (m.missing || []).slice() })), strengths: (D.strengths || []).map((x) => ({ k: x.k, group: x.group, score: x.score, text: x.text })), risks: (D.risks || []).map((x) => ({ k: x.k, group: x.group, score: x.score, text: x.text })) },
      market: MAx ? { status: MAx.status, statusLabel: MAx.statusLabel, convergence: MAx.convergence || null, factors: (MAx.factors || []).map(slimFactor), freshness: MAx.freshness || null, notes: MAx.notes || [] } : { status: 'INSUFFICIENT', statusLabel: MA.STATUS.INSUFFICIENT.label, convergence: null, factors: [], freshness: null, notes: [] },
      final: D.final ? { verdict: D.final.verdict, verdictLabel: D.final.verdictLabel, changed: !!D.final.changed, from: D.final.from, to: D.final.to, rule: D.final.rule, reason: D.final.reason, marketCondition: D.final.marketCondition ? slimCond(D.final.marketCondition) : null, whatWouldRemove: D.final.whatWouldRemove || [] } : { verdict: D.verdict, verdictLabel: D.verdictLabel, changed: false, from: D.verdict, to: D.verdict, rule: null, reason: null, marketCondition: null, whatWouldRemove: [] },
      conditions: ((D.final && D.final.conditions) || D.conditions || []).map(slimCond),
      flips: Array.isArray(D.flips) ? D.flips.map(slimFlip) : null,
      breakdown: D.breakdown ? { counts: D.breakdown.counts, missing: (D.breakdown.items && D.breakdown.items.MISSING ? D.breakdown.items.MISSING : []).map((x) => ({ id: x.id, text: x.text })), mostMaterial: D.breakdown.mostMaterial || null } : null,
      conflicts: (D.conflicts || []).map((c) => ({ id: c.id, material: !!c.material, label: c.label, values: (c.values || []).map((v) => ({ source: v.source, value: isNum(v.value) ? v.value : null, used: !!v.used, period: v.period || null })), treatment: c.treatment || null })),
      freshness: (D.freshness || []).map((f) => ({ id: f.id, label: f.label, observed: f.observed || null, published: f.published || null, checked: f.checked || null, state: f.state || null })),
      context: { market, cbs: slimCbs(ctx.cbs), indicators: slimInd(ctx.indicators), indicatorsCheckedAt: ctx.indicatorsCheckedAt || null, readAt: meta.basis === 'RECONSTRUCTED' || meta.basis === 'BASELINE_TODAY' ? bi('הקשר הלמ״ס והאינדיקטורים נקראו בזמן השחזור (לא נשמרו בגרסה)', 'the CBS context and the indicators were read at reconstruction time (not stored with the version)') : null },
      rulesFired: { final: D.final ? D.final.rule : null, criticalGates: lead && A[lead] && A[lead].ok ? A[lead].criticalFail || [] : [], softGates: lead && A[lead] && A[lead].ok ? A[lead].soft || [] : [], evidenceDeductions: ((D.evidence && D.evidence.items) || []).filter((it) => isNum(it.delta) && it.delta < 0).map((it) => it.id), materialNegatives: MAx ? (MAx.material.negative || []).map((f) => f.id) : [], materialPositives: MAx ? (MAx.material.positive || []).map((f) => f.id) : [] },
      registry: ['live_thesis', 'decision_snapshot', 'final_decision', 'market_execution_assessment', 'decision_condition', 'flip_point', 'evidence_quality', 'investment_attractiveness'],
    };
    snap.hash = hashOf(snap);
    return deepFreeze(snap);
  }
  /** does a decision match the stamp a saved version carries? (the reconstruction gate — a mismatch means BASELINE TODAY) */
  function stampMatches(D, stamp) {
    if (!D || !stamp) return false;
    const fin = D.final ? D.final.verdict : D.verdict;
    return stamp.verdict === D.verdict && (stamp.final == null ? true : stamp.final === fin) && (stamp.structure || null) === (D.recommended || null) && (stamp.evidence || null) === (D.evidence ? D.evidence.level : null) && (isNum(stamp.score) ? stamp.score === D.score : D.score == null);
  }
  /** the snapshot's integrity: its stored hash against a recomputation (tamper evidence; never a security control) */
  function verify(snap) { if (!snap || !snap.hash) return { ok: false, reason: 'no hash' }; const h = snap.hash; const c = Object.assign({}, snap); delete c.hash; const now = hashOf(c); return { ok: now === h, stored: h, computed: now }; }

  /* -------------------------------------------------------------- contract */
  const vLabel = (v) => (VERDICT[v] ? VERDICT[v].label : bi(v, v));
  const fmtV = (fmt, v) => (DX.fmtV ? DX.fmtV(fmt, v, 'en') : String(v));
  const fmtVhe = (fmt, v) => (DX.fmtV ? DX.fmtV(fmt, v, 'he') : String(v));
  function contract(snap) {
    const E = snap.economic, lead = E.lead, s = lead ? E.structures[lead] : null, fin = snap.final.verdict;
    const depends = [], breakers = [], notes = [];
    const positive = fin === 'TAKE' || fin === 'TAKE_WITH_CONDITIONS';
    if (s && s.ok) {
      for (const g of s.gates) {
        if (g.status !== 'pass') continue;
        if (g.kind === 'evidence') { depends.push({ id: 'gate:' + g.id, kind: 'EVIDENCE', category: 'DEAL_ASSUMPTION', text: bi(`${T(g.label, 'he')} — נשאר מגובה בראיה (שער ראיות)`, `${T(g.label, 'en')} — stays evidence-backed (an evidence gate)`), value: g.value, threshold: g.limit, fmt: g.fmt, critical: g.critical, movesOnly: bi('זז רק עם קלט חיתום (חיתום מחדש)', 'moves only with an underwriting input (re-underwrite)'), source: 'altaris:decision', rule: 'evidence gate' }); continue; }
        depends.push({ id: 'gate:' + g.id, kind: 'ECONOMIC', category: 'DEAL_ASSUMPTION', text: bi(`${T(g.label, 'he')} נשאר בתוך סף הקרן (${fmtVhe(g.fmt, g.value)} מול ${fmtVhe(g.fmt, g.limit)})`, `${T(g.label, 'en')} stays inside the fund threshold (${fmtV(g.fmt, g.value)} vs ${fmtV(g.fmt, g.limit)})`), value: g.value, threshold: g.limit, fmt: g.fmt, critical: g.critical,
          movesOnly: bi('זז רק עם שינוי הנחת עסקה (חיתום מחדש) — לעולם לא עם נתוני שוק', 'moves only with a deal-assumption change (re-underwrite) — never with market data'), source: 'altaris:decision', rule: g.critical ? 'critical gate' : 'gate' });
      }
      if (positive && E.evidence.level) depends.push({ id: 'evidence-level', kind: 'EVIDENCE', category: 'DEAL_ASSUMPTION', text: bi(`איכות הראיות נשארת ${E.evidence.level} (${E.evidence.score}/100) — TAKE דורש לפחות MEDIUM`, `evidence quality stays ${E.evidence.level} (${E.evidence.score}/100) — TAKE requires at least MEDIUM`), value: E.evidence.score, threshold: fin === 'TAKE' ? DX.POLICY.evidence.medium : DX.POLICY.evidence.insufficient, source: 'altaris:decision', rule: 'evidence',
        movesOnly: bi('מחושב מחדש רק בחיתום מחדש; התיישנות קריאה מדווחת כהתיישנות ראיות', 'recomputed only on a re-underwrite; read aging is reported as evidence aging') });
    }
    const mc = snap.final.marketCondition;
    if (positive && !mc) depends.push({ id: 'market-no-caution', kind: 'MARKET', category: 'MARKET_EVIDENCE', text: bi(`הערכת השוק וביצוע אינה מגיעה לזהירות — פחות מ-${MA.MIN_MATERIAL} גורמים שליליים מהותיים מ-${MA.MIN_INDEPENDENT} משפחות מקור בלתי תלויות (כיום ${snap.market.convergence ? snap.market.convergence.negative : 0} מ-${snap.market.convergence ? (snap.market.convergence.negativeFamilies || []).length : 0})`, `the market & execution assessment stays short of CAUTION — fewer than ${MA.MIN_MATERIAL} material negatives from ${MA.MIN_INDEPENDENT} independent source families (now ${snap.market.convergence ? snap.market.convergence.negative : 0} from ${snap.market.convergence ? (snap.market.convergence.negativeFamilies || []).length : 0})`), value: snap.market.convergence ? snap.market.convergence.negative : 0, threshold: MA.MIN_MATERIAL, source: 'altaris:market-assessment', rule: fin === 'TAKE' ? 'F3' : 'F4' });
    for (const f of snap.market.factors.filter((x) => x.material && x.direction === 'negative')) depends.push({ id: 'noted:' + f.id, kind: 'MARKET', category: 'MARKET_EVIDENCE', text: bi(`הגורם השלילי המהותי שנרשם (${T(f.text, 'he')}) אינו מקבל גורם שלילי מהותי שני ממשפחת מקור אחרת`, `the noted material negative (${T(f.text, 'en')}) does not gain a second material negative from another source family`), source: f.source, period: f.period, rule: 'convergence', signal: f.signal, remove: f.remove || null });
    const conditions = snap.conditions.map((c) => ({ id: c.id, source: c.source, text: c.text, basis: c.basis, resolvedBy: c.source === 'market' ? bi('הערכת השוק יוצאת מזהירות בקריאה טרייה — ' + (c.remove || []).map((r) => T(r, 'he')).join('; '), 'the assessment leaves CAUTION on a fresh read — ' + (c.remove || []).map((r) => T(r, 'en')).join('; ')) : RESOLVES_BY[c.id] ? RESOLVES_BY[c.id].text : bi('קלט מאומת של המשתמש בחיתום מחדש', 'a verified user input on a re-underwrite'), path: c.source === 'market' ? 'REASSESS' : 'RE_UNDERWRITE', remove: c.remove || null }));
    /* breakers */
    if (snap.flips && snap.flips.length) for (const f of snap.flips) breakers.push({ id: 'flip:' + f.id, kind: 'ECONOMIC', category: 'DEAL_ASSUMPTION', text: f.text, fromVerdict: f.fromVerdict, toVerdict: f.toVerdict, at: f.at, from: f.from, fmt: f.fmt, source: 'altaris:decision', rule: 'flip point', movesOnly: bi('רק אם המשתמש משנה את ההנחה (חיתום מחדש)', 'only if the user changes the assumption (re-underwrite)') });
    else if (snap.flips === null) notes.push(bi('נקודות ההיפוך הכלכליות לא חושבו בזמן השמירה — מחושבות לפי דרישה במסך ההחלטה', 'the economic flip points were not computed at save time — computed on demand in the decision view'));
    else notes.push(bi('לא נמצא שינוי קלט בטווח הנבדק שמשנה את ההחלטה', 'no input change inside the searched range moves the decision'));
    if (positive) breakers.push({ id: 'market-convergence', kind: 'MARKET', category: 'MARKET_EVIDENCE', text: bi(`${MA.MIN_MATERIAL} גורמים שליליים מהותיים מ-${MA.MIN_INDEPENDENT} משפחות מקור בלתי תלויות מתכנסים (איכות HIGH / MEDIUM, רשמי / נצפה, הגאוגרפיה של העסקה, קריאה טרייה) → זהירות → ${fin === 'TAKE' ? 'TAKE WITH CONDITIONS (כלל F3)' : 'תנאי שוק נוסף (כלל F4)'}`, `${MA.MIN_MATERIAL} material negative factors from ${MA.MIN_INDEPENDENT} independent source families converge (HIGH / MEDIUM evidence, OFFICIAL / OBSERVED, the deal's geography, a fresh read) → CAUTION → ${fin === 'TAKE' ? 'TAKE WITH CONDITIONS (rule F3)' : 'a market condition is added (rule F4)'}`), source: 'altaris:market-assessment', rule: fin === 'TAKE' ? 'F3' : 'F4' });
    if (positive && s && s.ok) breakers.push({ id: 'evidence-low', kind: 'EVIDENCE', category: 'DEAL_ASSUMPTION', text: bi(`איכות הראיות יורדת מתחת ל-${DX.POLICY.evidence.medium} בחיתום מחדש (ניכויים מתועדים: קריאה ישנה מ-${STALE_READ_DAYS} ימים −8, סתירת מקורות −10 / −20, שומה חסרה −10 …) → TAKE דורש MEDIUM`, `evidence quality falls below ${DX.POLICY.evidence.medium} on a re-underwrite (documented deductions: a read older than ${STALE_READ_DAYS} days −8, a source conflict −10 / −20, no appraisal −10 …) → TAKE requires MEDIUM`), source: 'altaris:decision', rule: 'evidence' });
    for (const c of snap.conditions.filter((x) => x.source !== 'market')) breakers.push({ id: 'condition-fails:' + c.id, kind: 'CONDITION', category: 'DEAL_ASSUMPTION', text: bi(`התנאי "${T(c.text, 'he')}" אינו מתקיים בסף שהוגדר`, `the condition "${T(c.text, 'en')}" fails its defined threshold`), source: 'altaris:decision', rule: 'condition' });
    if (fin === 'PASS') notes.push(bi('ההחלטה PASS נשענת על הכלכלה — שוק חזק לעולם אינו מציל אותה (כלל F2); התזה עוקבת רק אחר חיתום מחדש', 'the PASS decision rests on the economics — a strong market never rescues it (rule F2); the thesis follows only a re-underwrite'));
    if (fin === 'INSUFFICIENT_EVIDENCE') notes.push(bi('ראיות החיתום אינן מספיקות — השוק אינו יכול להשלים אותן (כלל F1); הראיה החסרה מגיעה רק בחיתום מחדש', 'the underwriting evidence is insufficient — the market cannot supply it (rule F1); the missing evidence arrives only through a re-underwrite'));
    return deepFreeze({ version: VERSION.id, original: { verdict: fin, verdictLabel: vLabel(fin), economic: E.verdict, market: snap.market.status, evidence: E.evidence.level, structure: E.recommended, decidedAt: snap.decidedAt }, dependsOn: depends, activeConditions: conditions, breakers, notes,
      basis: bi('חוזה התזה נגזר רק מכללי ההחלטה המתועדים: שערים שעברו, איכות הראיות, מצב ההערכה, התנאים הפעילים ונקודות ההיפוך — לא מדעה', 'the thesis contract derives only from the documented decision rules: passed gates, evidence quality, the assessment status, the active conditions and the flip points — never from an opinion') });
  }
  /* what resolves an economic condition — the documented input behind each condition id (altaris/decision.js conditionsOf) */
  const RESOLVES_BY = Object.freeze({
    appraisal: { text: bi('שומה בלתי תלויה מוזנת לעסקה (חיתום מחדש) — מסירה את התנאי ואת ניכוי −10 מאיכות הראיות', 'an independent appraisal entered into the deal (re-underwrite) — removes the condition and the −10 evidence deduction'), source: 'user', fact: bi('שומה בלתי תלויה', 'independent appraisal') },
    permit: { text: bi('סטטוס הבנייה מעודכן למאומת (היתר / תחילת בנייה) על סמך מסמך שאומת — חיתום מחדש; ל-PROPX אין מקור היתרים ציבורי לפי פרויקט', 'the construction status updated to a verified state (permit / construction start) on a verified document — re-underwrite; PROPX has no public per-project permit source'), source: 'user', fact: bi('היתר בנייה / תחילת בנייה מאומתת', 'verified building permit / construction start'), missingId: 'no_permits_source' },
    developer: { text: bi('הערכת אנליסט של היזם מוזנת (דירוג) — חיתום מחדש', 'an analyst assessment of the developer entered (rating) — re-underwrite'), source: 'user', fact: bi('הערכת היזם', 'developer assessment') },
    conflict: { text: bi('יישוב הפער בין מקורות השווי (שומה / השוואות / PROPX) — חיתום מחדש', 'the value-source spread reconciled (appraisal / comparables / PROPX) — re-underwrite'), source: 'user', fact: bi('יישוב סתירת מקורות השווי', 'value-source reconciliation') },
    price: { text: bi('מחיר רכישה בתוך המחיר המקסימלי של פותר המנוע — תנאי מסחרי, לא ראיה', 'an acquisition price inside the engine solver\'s maximum — a commercial term, not evidence'), source: 'terms', fact: null },
    irr: { text: bi('תנאים משופרים כך שה-IRR עומד ברף — תנאי מסחרי', 'improved terms so the IRR meets the hurdle — a commercial term'), source: 'terms', fact: null },
    moic: { text: bi('תנאים משופרים כך שה-MOIC עומד ברף — תנאי מסחרי', 'improved terms so the MOIC meets the hurdle — a commercial term'), source: 'terms', fact: null },
    discount: { text: bi('מחיר בתוך הנחת הכניסה הנדרשת — תנאי מסחרי', 'a price inside the required entry discount — a commercial term'), source: 'terms', fact: null },
    collateral: { text: bi('שווי בטוחות מאומת גבוה יותר (שומה) או חשיפה קטנה יותר — חיתום מחדש', 'a higher verified collateral value (appraisal) or a smaller exposure — re-underwrite'), source: 'user', fact: bi('שווי בטוחות מאומת', 'verified collateral value') },
    ltv: { text: bi('הלוואה בתוך ה-LTV המקסימלי על הבטוחה הנוכחית — תנאי מסחרי', 'a loan inside the maximum LTV on the current collateral — a commercial term'), source: 'terms', fact: null },
    duration: { text: bi('משך בתוך המקסימום של הקרן או אישור חריג של הוועדה', 'a duration inside the fund maximum or an explicit committee exception'), source: 'terms', fact: null },
    mos: { text: bi('מרווח ביטחון בסף — מחיר נמוך יותר או שווי מאומת גבוה יותר', 'a margin of safety at the hurdle — a lower price or a higher verified value'), source: 'terms', fact: null },
    security: { text: bi('ביטחונות נוספים / ערבות המכסים את הפסד התרחיש השלילי', 'additional security / guarantee covering the downside loss'), source: 'terms', fact: null },
    equity: { text: bi('הון עצמי של היזם מתחת לחשיפת ALTARIS — מבנה מתוקן', 'developer equity ranking below the ALTARIS exposure — a corrected structure'), source: 'terms', fact: null },
  });

  /* ------------------------------------------------------ next best evidence */
  const EV_DEDUCTIONS = Object.freeze({   // the evidence deductions of altaris/decision.js evidenceOf → the fact that lifts them and where it comes from
    appraisal: { fact: bi('שומה בלתי תלויה', 'independent appraisal'), source: 'user', path: 'RE_UNDERWRITE' },
    market: { fact: bi('נתוני השוק של PROPX לעסקה (תיק היישוב, רדאר, עסקאות)', 'the deal\'s PROPX market data (locality dossier, radar, transactions)'), source: 'propx:dossier', path: 'RE_UNDERWRITE' },
    tx: { fact: bi('עסקאות מגורים מתומחרות ביישוב (≥ 30 למדגם מלא)', 'priced residential deals in the locality (≥ 30 for a full sample)'), source: 'over:deals-republication', path: 'RE_UNDERWRITE' },
    txAge: { fact: bi('תצפית עסקאות עדכנית (≤ 12 חודשים)', 'a recent transaction observation (≤ 12 months)'), source: 'over:deals-republication', path: 'RE_UNDERWRITE' },
    checked: { fact: bi(`קריאת PROPX טרייה (≤ ${STALE_READ_DAYS} ימים)`, `a fresh PROPX read (≤ ${STALE_READ_DAYS} days)`), source: 'propx:dossier', path: 'RE_UNDERWRITE' },
    status: { fact: bi('סטטוס בנייה מאומת', 'a verified construction status'), source: 'user', path: 'RE_UNDERWRITE' },
    developer: { fact: bi('הערכת היזם', 'the developer assessment'), source: 'user', path: 'RE_UNDERWRITE' },
    defaults: { fact: bi('בחינת ברירות המחדל המהותיות של המבנה', 'a review of the structure\'s material defaults'), source: 'user', path: 'RE_UNDERWRITE' },
    spread: { fact: bi('יישוב הפער בין מקורות השווי', 'reconciliation of the value-source spread'), source: 'user', path: 'RE_UNDERWRITE' },
    propxVsValue: { fact: bi('הסבר לפער בין חציון PROPX לשווי לחיתום (שומה)', 'an explanation of the PROPX-median vs underwriting-value gap (appraisal)'), source: 'user', path: 'RE_UNDERWRITE' },
    cbs: { fact: bi('פרסום למ״ס עדכני של סדרת המכירות', 'a current CBS release of the sales series'), source: 'cbs:timeseries:44,10', path: 'REASSESS' },
    cbsGeo: { fact: bi('זיהוי המחוז של היישוב (רישום גאוגרפי)', 'the locality\'s district (geo registry)'), source: 'propx:geo', path: 'RE_UNDERWRITE' },
    value: { fact: bi('שווי לחיתום ממקור בלתי תלוי (שומה / השוואות / PROPX)', 'an underwriting value from an independent source (appraisal / comparables / PROPX)'), source: 'user', path: 'RE_UNDERWRITE' },
  });
  const nextLevel = (score) => (score >= DX.POLICY.evidence.high ? null : score >= DX.POLICY.evidence.medium ? { to: 'HIGH', at: DX.POLICY.evidence.high } : score >= DX.POLICY.evidence.insufficient ? { to: 'MEDIUM', at: DX.POLICY.evidence.medium } : { to: 'LOW', at: DX.POLICY.evidence.insufficient });
  function nextBestEvidence(snap) {
    const E = snap.economic, fin = snap.final.verdict, lead = E.lead, s = lead ? E.structures[lead] : null, items = [];
    const condIds = new Set(snap.conditions.map((c) => c.id));
    const onlyCondition = (id) => snap.conditions.length === 1 && snap.conditions[0].id === id;
    const twcReasons = s && s.ok && E.verdict === 'TAKE_WITH_CONDITIONS' ? { soft: s.soft.length, downside: s.groups && isNum(s.groups.downside) && s.groups.downside < DX.POLICY.downsideMin, low: E.evidence.level === 'LOW', score: isNum(E.score) && E.score < DX.POLICY.takeMin } : null;
    const push = (x) => { if (!items.some((y) => y.id === x.id)) items.push(x); };
    /* 1 · INSUFFICIENT EVIDENCE: the missing underwriting inputs */
    if (E.verdict === 'INSUFFICIENT_EVIDENCE') {
      const miss = [...new Set(E.missing.flatMap((m) => m.missing))];
      if (!miss.length && E.evidence.items.some((it) => it.id === 'value' && it.cls === 'MISSING')) miss.push('supported value');
      for (const m of miss) push({ id: 'missing:' + m, fact: bi(m === 'supported value' ? 'שווי לחיתום ממקור בלתי תלוי' : m, m), why: bi('קלט חיתום חסר — ללא הקלט הזה אף מבנה אינו מחושב / איכות הראיות אינה מספיקה', 'a missing underwriting input — without it no structure is computed / the evidence is insufficient'), ifVerified: bi('ההחלטה יוצאת מ-INSUFFICIENT EVIDENCE בחיתום מחדש (כלל F1: השוק אינו יכול להשלים ראיית חיתום)', 'the decision leaves INSUFFICIENT EVIDENCE on a re-underwrite (rule F1: the market cannot supply underwriting evidence)'), ifNot: bi('ההחלטה נשארת INSUFFICIENT EVIDENCE', 'the decision stays INSUFFICIENT EVIDENCE'), expectedSource: 'user', path: 'RE_UNDERWRITE', relevance: 'HIGH', effect: 'VERDICT', rule: 'F1' });
    }
    /* 2 · the active conditions and the evidence that resolves them */
    for (const c of snap.conditions) {
      if (c.source === 'market') { const sole = onlyCondition(c.id); for (const [i, r] of (c.remove || []).entries()) push({ id: 'market-remove:' + i, fact: r, why: bi('התנאי הפעיל של השוק וביצוע נשען על ההתכנסות הזו', 'the active market & execution condition rests on this convergence'), ifVerified: sole && E.verdict === 'TAKE' ? bi('תנאי השוק מוסר — תחת כלל F5 ההחלטה חוזרת ל-TAKE', 'the market condition is resolved — under rule F5 the decision returns to TAKE') : bi('תנאי השוק מוסר — ההחלטה נשארת TAKE WITH CONDITIONS בשל התנאים הכלכליים', 'the market condition is resolved — the decision stays TAKE WITH CONDITIONS on the economic conditions'), ifNot: bi('תנאי השוק נשאר פעיל', 'the market condition stays active'), expectedSource: (c.factors && c.factors[i] && snap.market.factors.find((f) => f.id === c.factors[i].id) || {}).source || 'propx:dossier', path: 'REASSESS', relevance: sole && E.verdict === 'TAKE' ? 'HIGH' : 'MEDIUM', effect: sole && E.verdict === 'TAKE' ? 'VERDICT' : 'CONDITION', rule: sole && E.verdict === 'TAKE' ? 'F5' : 'F4' }); continue; }
      const rb = RESOLVES_BY[c.id] || (/Exposure$/.test(c.id) ? { source: 'terms', fact: null } : null);
      if (!rb || !rb.fact) continue;   // a commercial term is not evidence (listed with the conditions, not here)
      const sole = onlyCondition(c.id);
      push({ id: 'condition:' + c.id, fact: rb.fact, why: bi(`התנאי הפעיל "${T(c.text, 'he')}" ממתין לראיה הזו`, `the active condition "${T(c.text, 'en')}" waits for this evidence`), ifVerified: sole && E.verdict === 'TAKE_WITH_CONDITIONS' && twcReasons && !twcReasons.soft && !twcReasons.downside && !twcReasons.score ? bi('התנאי מוסר; אם אין סיבה אחרת ל-TAKE WITH CONDITIONS, ההחלטה בחיתום מחדש עשויה להיות TAKE', 'the condition is resolved; with no other reason for TAKE WITH CONDITIONS the re-underwrite decision may be TAKE') : bi('התנאי מוסר בחיתום מחדש; שאר התנאים נשארים', 'the condition is resolved on a re-underwrite; the other conditions stay'), ifNot: bi('ההחלטה הנוכחית נשארת כפי שהיא', 'the current decision stays as it is'), expectedSource: rb.source, path: 'RE_UNDERWRITE', relevance: 'HIGH', effect: 'CONDITION', rule: 'condition:' + c.id, missingId: rb.missingId || null });
    }
    /* 3 · the evidence deductions that could lift the evidence level */
    if (isNum(E.evidence.score)) for (const it of E.evidence.items) {
      if (!isNum(it.delta) || it.delta >= 0) continue; const d = EV_DEDUCTIONS[it.id]; if (!d) continue;
      if (condIds.has(it.id) || items.some((x) => x.id === 'condition:' + it.id)) continue;
      const nl = nextLevel(E.evidence.score), lifts = nl && E.evidence.score - it.delta >= nl.at;
      const soleLow = twcReasons && twcReasons.low && !twcReasons.soft && !twcReasons.downside && !twcReasons.score;
      const rel = lifts && soleLow && nl.to === 'MEDIUM' ? 'HIGH' : lifts ? 'MEDIUM' : 'LOW';
      push({ id: 'evidence:' + it.id, fact: d.fact, why: bi(`ניכוי מתועד מאיכות הראיות: ${T(it.text, 'he')}`, `a documented evidence deduction: ${T(it.text, 'en')}`), ifVerified: lifts ? bi(`הניכוי (${it.delta}) מוסר — ציון הראיות ${E.evidence.score} → ${E.evidence.score - it.delta}: הרמה עולה ל-${nl.to}${rel === 'HIGH' ? ' — הסיבה היחידה ל-TAKE WITH CONDITIONS נעלמת' : ''}`, `the deduction (${it.delta}) is lifted — evidence score ${E.evidence.score} → ${E.evidence.score - it.delta}: the level rises to ${nl.to}${rel === 'HIGH' ? ' — the only reason for TAKE WITH CONDITIONS disappears' : ''}`) : bi(`הניכוי (${it.delta}) מוסר — הציון עולה בלי לחצות רמת ראיות`, `the deduction (${it.delta}) is lifted — the score rises without crossing an evidence level`), ifNot: bi('איכות הראיות נשארת כפי שהיא', 'evidence quality stays as it is'), expectedSource: d.source, path: d.path, relevance: rel, effect: lifts ? 'EVIDENCE_LEVEL' : 'EVIDENCE', rule: 'evidence:' + it.id });
    }
    /* 4 · the market & execution assessment itself */
    if (snap.market.status === 'INSUFFICIENT' && (fin === 'TAKE' || fin === 'TAKE_WITH_CONDITIONS')) push({ id: 'market-assessment', fact: bi('תיק היישוב והרדאר של PROPX לעסקה', 'the locality\'s PROPX dossier and radar for the deal'), why: bi('ללא הערכת שוק וביצוע ההכרעה הכלכלית עומדת לבדה (כלל F0)', 'without a market & execution assessment the economic verdict stands alone (rule F0)'), ifVerified: bi('ההערכה עשויה להוסיף תנאי שוק (זהירות → כלל F3 / F4) או לאשר את ההחלטה (F5); לעולם לא שדרוג', 'the assessment may add a market condition (CAUTION → rule F3 / F4) or confirm the decision (F5); never an upgrade'), ifNot: bi('ההחלטה עומדת ללא הערכת שוק', 'the decision stands without a market assessment'), expectedSource: 'propx:dossier', path: 'REASSESS', relevance: 'HIGH', effect: 'CONDITION', rule: 'F0' });
    /* 5 · informational negative factors that a better read could make material */
    const negInfo = snap.market.factors.filter((f) => !f.material && f.direction === 'negative' && f.whyNotMaterial && f.whyNotMaterial.length);
    const matNeg = snap.market.factors.filter((f) => f.material && f.direction === 'negative');
    for (const f of negInfo) {
      const fams = new Set(matNeg.map((x) => x.family).concat([f.family]).flatMap((x) => String(x || '').split('+')).filter(Boolean));
      const wouldConverge = (fin === 'TAKE' || fin === 'TAKE_WITH_CONDITIONS') && !snap.final.marketCondition && matNeg.length + 1 >= MA.MIN_MATERIAL && fams.size >= MA.MIN_INDEPENDENT;
      const onlyFixable = f.whyNotMaterial.every((r) => /evidence quality|older than|קריאה ישנה|איכות ראיות/.test(T(r, 'en') + T(r, 'he')));
      if (!onlyFixable) continue;   // a DERIVED / national / undirected factor cannot become material by better evidence
      push({ id: 'factor:' + f.id, fact: bi(`קריאה טרייה / באיכות גבוהה יותר של: ${T(f.text, 'he')}`, `a fresh / higher-evidence read of: ${T(f.text, 'en')}`), why: bi(`הגורם מידע בלבד כיום (${f.whyNotMaterial.map((r) => T(r, 'he')).join('; ')})`, `the factor is informational today (${f.whyNotMaterial.map((r) => T(r, 'en')).join('; ')})`), ifVerified: wouldConverge ? bi(`הגורם הופך מהותי ומשלים התכנסות (${matNeg.length + 1} שליליים מ-${fams.size} משפחות) → זהירות → ${fin === 'TAKE' ? 'TAKE WITH CONDITIONS (F3)' : 'תנאי שוק נוסף (F4)'}`, `the factor becomes material and completes convergence (${matNeg.length + 1} negatives from ${fams.size} families) → CAUTION → ${fin === 'TAKE' ? 'TAKE WITH CONDITIONS (F3)' : 'a market condition is added (F4)'}`) : bi('הגורם הופך מהותי ונרשם — לבדו אינו משנה את ההערכה', 'the factor becomes material and is noted — alone it moves no assessment'), ifNot: bi('הגורם נשאר מידע', 'the factor stays informational'), expectedSource: f.source || 'propx:dossier', path: 'REASSESS', relevance: wouldConverge ? 'MEDIUM' : 'LOW', effect: wouldConverge ? 'CONDITION' : 'ASSESSMENT', rule: 'material' });
    }
    /* 6 · what the dossier says is missing for the geography — no decision rule reads it: informational */
    const ds = snap.context.market && snap.context.market.dossier;
    if (ds) ds.missing.forEach((m, i) => push({ id: 'dossier-missing:' + (ds.missingIds[i] || i), fact: typeof m === 'object' ? m : bi(m, m), why: bi('התיק מסמן את העובדה כחסרה למקור הרשמי', 'the dossier marks the fact as missing at the official source'), ifVerified: bi('הקשר לתיק היישוב — אף כלל החלטה אינו קורא את העובדה הזו היום', 'context for the locality dossier — no decision rule reads this fact today'), ifNot: bi('ללא שינוי', 'no change'), expectedSource: 'propx:dossier', path: 'REASSESS', relevance: 'INFORMATIONAL', effect: 'NONE', rule: 'dossier:missing', missingId: ds.missingIds[i] || null }));
    if (snap.context.market && snap.context.market.devIntel && snap.context.market.devIntel.none) push({ id: 'developer-registry', fact: bi('פעילות היזם ברישום PROPX תחת השם המדויק', 'the developer\'s PROPX registry activity under the exact name'), why: bi('השם המדויק אינו ברישום — הקשר בלבד', 'the exact name is not in the registry — context only'), ifVerified: bi('הקשר ליזם (גורם חיובי אפשרי "כניסות יזם"); אינו יכול להוסיף תנאי', 'developer context (a possible positive "developer entries" factor); it cannot add a condition'), ifNot: bi('ללא שינוי', 'no change'), expectedSource: 'lib/entities', path: 'REASSESS', relevance: 'LOW', effect: 'ASSESSMENT', rule: 'developer-entries' });
    const EFF = { VERDICT: 4, CONDITION: 3, EVIDENCE_LEVEL: 2, ASSESSMENT: 1, EVIDENCE: 1, NONE: 0 };
    items.sort((a, b) => RELEVANCE[b.relevance].rank - RELEVANCE[a.relevance].rank || EFF[b.effect] - EFF[a.effect] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    items.forEach((x, i) => { x.rank = i + 1; x.relevanceLabel = RELEVANCE[x.relevance].label; x.limitation = bi('אין ערובה שהמקור הצפוי יהיה זמין; רלוונטיות — לא הסתברות', 'the expected source is never guaranteed to become available; relevance — not a probability'); });
    return deepFreeze({ version: VERSION.id, items, basis: bi('דירוג דטרמיניסטי לפי רלוונטיות להחלטה: עובדה שיכולה לשנות הכרעה > להסיר / להוסיף תנאי > להעלות רמת ראיות > לשנות הערכה > מידע; שוויון נשבר לפי מזהה', 'a deterministic ranking by decision relevance: a fact that can change the verdict > remove / add a condition > lift the evidence level > move the assessment > informational; ties by id') });
  }

  /* -------------------------------------------------------------- watchlist */
  function watchlist(snap, C) {
    C = C || contract(snap);
    const m = snap.context.market, geo = snap.geography, out = [];
    const add = (x) => out.push(Object.assign({ watchable: true }, x));
    const fin = snap.final.verdict, positive = fin === 'TAKE' || fin === 'TAKE_WITH_CONDITIONS';
    if (geo.cityCode) {
      add({ id: 'demand', label: bi('ביקוש — סדרת המכירות הרשמית של המחוז', 'DEMAND — the district\'s official sales series'), why: bi('גורם המומנטום (±10%) הוא גורם רשמי מהותי בהערכת השוק', 'the momentum factor (±10%) is a material OFFICIAL factor of the assessment'), feeds: ['cbs:timeseries:44,10'], views: ['intel?view=dossier', 'intel?view=scanGeo', 'intel?view=revisions'], signals: ['sales-momentum-down', 'sales-momentum-up', 'demand-with-supply'], scope: 'district' });
      add({ id: 'land-market', label: bi('שוק הקרקע — מכרזי רמ״י ביישוב', 'LAND MARKET — ILA tenders in the locality'), why: bi('מכרזים שנכשלו וריכוזיות יזמים הם גורמים שליליים מהותיים אפשריים ממשפחת רמ״י', 'failed tenders and developer concentration are possible material negatives from the ILA family'), feeds: ['rmi:michrazim'], views: ['intel?view=scanGeo', 'land?view=summary'], signals: ['failed-tenders', 'developer-concentration'], scope: 'own' });
      add({ id: 'supply', label: bi('היצע — צנרת ביישוב ומלאי ארצי', 'SUPPLY — the locality pipeline and the national inventory'), why: bi('ספירות היצע הן הקשר; חודשי היצע ארציים — גורם שלילי ארצי (הקשר לעסקה מקומית)', 'supply counts are context; national months of supply — a national negative (context for a local deal)'), feeds: ['rmi:michrazim', 'cbs:timeseries:44,10', 'datagov:moch:urban-renewal'], views: ['intel?view=supply', 'intel?view=dossier'], signals: ['open-land', 'awarded-pipeline', 'pending-decision', 'renewal-pipeline', 'months-of-supply', 'inventory-plus-pipeline'], scope: 'own+national' });
      add({ id: 'transactions', label: bi('נזילות עסקאות — עומק העסקאות ביישוב', 'TRANSACTION LIQUIDITY — the locality\'s transaction depth'), why: bi('≥ 100 חיובי · < 10 שלילי (נצפה, הגאוגרפיה של העסקה); חציון PROPX מול השווי לחיתום — סתירת מקורות', '≥ 100 positive · < 10 negative (OBSERVED, own geography); the PROPX median vs the underwriting value — source conflict'), feeds: ['over:deals-republication'], views: ['gov/transactions'], signals: ['tx-depth'], scope: 'own' });
      add({ id: 'execution', label: bi('ביצוע — פעילות שנצפתה ביישוב', 'EXECUTION — observed activity in the locality'), why: bi('אירועים שנצפו ב-30 ימים, סטטוס מכרזי השכרה', 'events observed within 30 days, rental-tender status'), feeds: ['propx:radar', 'rmi:michrazim'], views: ['intel?view=scanGeo', 'intel?view=dossierHistory'], signals: ['no-recent-changes', 'stale-rental-status'], scope: 'own' });
      add({ id: 'geography-history', label: bi('היסטוריית התיק — מה השתנה בגאוגרפיה מאז ההחלטה', 'DOSSIER HISTORY — what changed in the geography since the decision'), why: bi('תמונות המצב הליליות של PROPX; השפעה על ההחלטה רק דרך גורם הערכה', 'PROPX\'s nightly snapshots; a decision impact only through an assessment factor'), feeds: ['propx:dossier-history'], views: ['intel?view=dossierHistory'], signals: [], scope: 'own' });
    } else add({ id: 'geography', label: bi('גאוגרפיה — לא זוהה יישוב מהרישום', 'GEOGRAPHY — no registry locality'), why: bi('ללא קוד יישוב אין תיק, רדאר או סדרת מחוז לעקוב אחריהם', 'without a locality code there is no dossier, radar or district series to watch'), feeds: [], views: [], signals: [], scope: null, watchable: false, reason: bi('בחרו יישוב מהרישום הגאוגרפי בשלב 1', 'pick a registry locality in step 1') });
    if (snap.developer) add({ id: 'developer', label: bi(`יזם — ${snap.developer}`, `DEVELOPER — ${snap.developer}`), why: bi('פעילות שנצפתה (מגרשים, זכיות, הגרלות), ראיות בנייה ברמת היזם, "ייתכן אותו גוף"', 'observed activity (lots, wins, lotteries), developer-level construction evidence, "possibly the same"'), feeds: ['lib/entities'], views: ['intel?view=developer'], signals: ['developer-entries'], scope: 'developer' });
    add({ id: 'project-execution', label: bi(`ביצוע הפרויקט${snap.project ? ' — ' + snap.project : ''}`, `PROJECT EXECUTION${snap.project ? ' — ' + snap.project : ''}`), why: bi('תנאי ההיתר / תחילת הבנייה של העסקה', 'the deal\'s permit / construction-start condition'), feeds: [], views: [], signals: [], scope: 'project', watchable: false, reason: bi('ל-PROPX אין מקור ציבורי להיתרים / התחלות ברמת פרויקט, והעסקה אינה מצורפת לפרויקט ציבורי (שם בלבד) — התנאי נפתר רק במסמך מאומת בחיתום מחדש', 'PROPX has no public per-project permit / start source and the deal is not joined to a public project (name only) — the condition resolves only on a verified document in a re-underwrite'), missingId: 'no_permits_source' });
    add({ id: 'macro', label: bi('מאקרו — ריבית בנק ישראל, תשומות בנייה', 'MACRO — Bank of Israel rate, construction inputs'), why: bi('מדד תשומות הבנייה ≥ +3% — גורם שלילי ארצי (הקשר)', 'construction inputs ≥ +3% y/y — a national negative (context)'), feeds: ['boi:interest', 'cbs:constructionInputsIndex'], views: ['data/market/latest.js'], signals: ['construction-inputs'], scope: 'national' });
    add({ id: 'source-freshness', label: bi('רעננות המקורות — התיק, הרדאר, הלמ״ס, הקריאה שבבסיס ההחלטה', 'SOURCE FRESHNESS — the dossier, the radar, CBS, the read behind the decision'), why: bi(`קריאה ישנה מ-${FRESH_DAYS} ימים → גורמיה מידע; קריאת ההחלטה ישנה מ-${STALE_READ_DAYS} ימים → התיישנות ראיות`, `a read older than ${FRESH_DAYS} days → its factors are informational; the decision's read older than ${STALE_READ_DAYS} days → evidence aging`), feeds: ['propx:dossier', 'propx:radar', 'cbs:timeseries:44,10'], views: ['intel?view=sources'], signals: [], scope: 'all' });
    add({ id: 'revisions', label: bi('תיקונים רשמיים — סדרת המכירות של המחוז', 'OFFICIAL REVISIONS — the district\'s sales series'), why: bi('ערך מתוקן לתקופה שקדמה להחלטה: המקורי נשמר לצד המתוקן; השפעה רטרוספקטיבית דרך גורם המומנטום', 'a revised value for a period before the decision: the original is kept beside the revised; retrospective impact through the momentum factor'), feeds: ['cbs:timeseries:44,10'], views: ['intel?view=revisions'], signals: ['sales-momentum-down', 'sales-momentum-up'], scope: 'district', watchable: !!geo.cityCode });
    if (m && m.rental && m.rental.tenders) add({ id: 'rental', label: bi('הקשר השכרה — מכרזי דיור להשכרה ביישוב', 'RENTAL CONTEXT — rental-track tenders in the locality'), why: bi('הקשר בלבד — צנרת, לא פרויקט מאוכלס; לעולם לא שכר דירה או תפוסה של העסקה', 'context only — pipeline, not an operating project; never the deal\'s rent or occupancy'), feeds: ['rmi:michrazim', 'dira-lehaskir:wp'], views: ['land?view=rental'], signals: ['rental-pipeline', 'stale-rental-status'], scope: 'own' });
    if (!positive) out.forEach((d) => { d.note = fin === 'PASS' ? bi('ההחלטה PASS — נתוני שוק אינם משנים אותה (כלל F2); המעקב הוא הקשר', 'the decision is PASS — market data never moves it (rule F2); the watch is context') : bi('INSUFFICIENT EVIDENCE — נתוני שוק אינם משלימים ראיית חיתום (כלל F1)', 'INSUFFICIENT EVIDENCE — market data never supplies underwriting evidence (rule F1)'); });
    return deepFreeze({ version: VERSION.id, dimensions: out, basis: bi('נעקבים רק הממדים שהתזה נשענת עליהם; מה שאין לו מקור ציבורי מסומן כבלתי ניתן למעקב עם הסיבה', 'only the dimensions the thesis depends on are watched; what has no public source is marked unwatchable with the reason') });
  }

  /* --------------------------------------------------------------- reassess */
  const sameNum = (a, b) => (a == null && b == null) || (isNum(a) && isNum(b) && Math.abs(a - b) < 1e-9);
  const sameVal = (a, b) => (isNum(a) || isNum(b) ? sameNum(a, b) : JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b));
  const verdictRank = (v) => (VERDICT[v] ? VERDICT[v].rank : -1);
  /**
   * reassess(snap, now) — now: { today, market (a fresh page-shaped market context, or null), cbs, indicators, dealHash, settingsHash,
   * dossierHistory (the diff since the decision, optional), revisions (rows of view=revisions for the deal's CBS geography, optional) }.
   * Economics frozen; the new assessment reaches the verdict through DX.finalOf only. Returns the delta, the changes, then-vs-now,
   * the retrospective answer and the narrative. Deterministic.
   */
  function reassess(snap, now) {
    now = now || {};
    const today = day(now.today), changes = [], notes = [];
    const then = { verdict: snap.final.verdict, economic: snap.economic.verdict, market: snap.market.status, conditions: snap.conditions, evidence: snap.economic.evidence.level, marketCondition: snap.final.marketCondition };
    const base = { version: VERSION.id, checkedAt: now.today || null, then, snapshotHash: snap.hash };
    /* 0 · a changed deal is a re-underwrite, not a reassessment */
    if (now.dealHash && now.dealHash !== snap.assumptions.dealHash) {
      return deepFreeze(Object.assign(base, { state: 'DEAL_CHANGED', stateLabel: DELTA.DEAL_CHANGED.label, status: null, materiality: 'DECISION_IMPACTING', rule: 'TH-DEAL', attention: attentionOf('DEAL_CHANGED', []), changes: [chg('deal', 'DEAL_ASSUMPTION', 'TH-DEAL', bi('הנחות העסקה השמורה שונות מתמונת ההחלטה', 'the saved deal\'s assumptions differ from the decision snapshot'), snap.assumptions.dealHash, now.dealHash, 'altaris:deal', null, null, 'VERDICT_CHANGED', 'DECISION_IMPACTING')], current: null, thenVsNow: null, retrospective: { answer: 'CANNOT_DETERMINE', text: bi('ההנחות השתנו — חיתום מחדש יוצר גרסת החלטה חדשה', 'the assumptions changed — a re-underwrite creates a new decision version') }, narrative: [bi('הנחות העסקה שונות מאלה שבתמונת ההחלטה. הכלכלה מחושבת מחדש רק בחיתום מחדש, שיוצר גרסת תזה חדשה; התזה המקורית נשמרת.', 'The deal assumptions differ from those in the decision snapshot. Economics recompute only on a re-underwrite, which creates a new thesis version; the original thesis is kept.')], notes }));
    }
    if (now.settingsHash && snap.assumptions.settingsHash && now.settingsHash !== snap.assumptions.settingsHash) changes.push(chg('settings', 'DEAL_ASSUMPTION', 'TH-SETTINGS', bi('הגדרות הקרן השתנו מאז ההחלטה', 'the fund settings changed since the decision'), snap.assumptions.settingsHash, now.settingsHash, 'altaris:settings', null, null, 'NONE', 'INFORMATIONAL'));
    /* 1 · the new assessment — only a fresh read counts; nothing loaded or a stale read → INSUFFICIENT NEW EVIDENCE, every condition stays */
    const nowM = now.market || null, MAn = MA.assess(nowM, now.cbs || null, { today: now.today || null });
    const fr = MAn.freshness || {}, freshNow = MAn.status !== 'INSUFFICIENT' && (fr.dossierAgeDays != null && fr.dossierAgeDays >= 0 && fr.dossierAgeDays <= FRESH_DAYS) && (fr.radarAgeDays == null || (fr.radarAgeDays >= 0 && fr.radarAgeDays <= FRESH_DAYS));
    const ageOfDecisionRead = snap.context.market && snap.context.market.retrievedAt && today ? daysBetween(snap.context.market.retrievedAt, today) : null;
    if (isNum(ageOfDecisionRead) && ageOfDecisionRead > STALE_READ_DAYS) changes.push(chg('aging', 'SOURCE_EVIDENCE', 'TH-AGING', bi(`קריאת PROPX שבבסיס ההחלטה נשלפה לפני ${ageOfDecisionRead} ימים`, `the PROPX read behind the decision was retrieved ${ageOfDecisionRead} days ago`), day(snap.context.market.retrievedAt), today, 'propx:dossier', null, null, 'EVIDENCE', 'RELEVANT'));
    if (!freshNow) {
      const why = !nowM ? bi('לא נטענה קריאת PROPX חדשה לעסקה', 'no new PROPX read was loaded for the deal') : MAn.status === 'INSUFFICIENT' ? bi('התיק והרדאר של היישוב לא נטענו בקריאה החדשה', 'the locality\'s dossier and radar were not loaded in the new read') : bi(`הקריאה החדשה ישנה מ-${FRESH_DAYS} ימים (תיק ${fr.dossierAgeDays != null ? fr.dossierAgeDays : '—'} ימים · רדאר ${fr.radarAgeDays != null ? fr.radarAgeDays : '—'} ימים) — גורמיה מידע בלבד`, `the new read is older than ${FRESH_DAYS} days (dossier ${fr.dossierAgeDays != null ? fr.dossierAgeDays : '—'} days · radar ${fr.radarAgeDays != null ? fr.radarAgeDays : '—'} days) — its factors are informational only`);
      changes.push(chg('no-read', 'SOURCE_EVIDENCE', 'TH-NOREAD', why, then.market, MAn.status, 'propx:dossier', null, null, 'NONE', 'INFORMATIONAL'));
      const mat = maxMateriality(changes);
      return deepFreeze(Object.assign(base, { state: 'INSUFFICIENT_NEW_EVIDENCE', stateLabel: DELTA.INSUFFICIENT_NEW_EVIDENCE.label, status: null, materiality: mat, rule: 'TH-NOREAD', attention: attentionOf('INSUFFICIENT_NEW_EVIDENCE', changes), changes, current: { verdict: then.verdict, verdictLabel: vLabel(then.verdict), market: then.market, conditions: then.conditions, marketCondition: then.marketCondition, rule: snap.final.rule, economic: then.economic, evidence: then.evidence, basis: bi('ללא קריאה טרייה ההחלטה והתנאים המקוריים נשארים — ראיה חסרה אינה ראיה חיובית', 'without a fresh read the original decision and conditions stay — missing evidence is not positive evidence') },
        thenVsNow: thenVsNow(snap, then, null, changes, null), retrospective: { answer: 'CANNOT_DETERMINE', text: bi('אין ראיות חדשות מספיקות לבחינה רטרוספקטיבית', 'not enough new evidence for a retrospective answer') }, narrative: [bi('לא נמצאה קריאת PROPX טרייה לבדיקה הזו. ההחלטה המקורית ותנאיה נשארים כפי שהם; היעדר ראיה אינו ראיה חיובית.', 'No fresh PROPX read was found for this check. The original decision and its conditions stay as they are; absence of evidence is not positive evidence.')].concat(isNum(ageOfDecisionRead) && ageOfDecisionRead > STALE_READ_DAYS ? [bi(`הקריאה שבבסיס ההחלטה ישנה מ-${STALE_READ_DAYS} ימים — התיישנות ראיות, לא אות שלילי.`, `The read behind the decision is older than ${STALE_READ_DAYS} days — evidence aging, not a negative signal.`)] : []), notes }));
    }
    /* 2 · the final verdict under the same policy: the frozen economic verdict ∘ the new assessment */
    const finNow = DX.finalOf(then.economic, snap.economic.basis, MAn);
    const condsNow = snap.conditions.filter((c) => c.source !== 'market').concat(finNow.marketCondition ? [slimCond(finNow.marketCondition)] : []);
    const nowF = (MAn.factors || []).map(slimFactor);
    const thenF = snap.market.factors;
    const byId = (list) => Object.fromEntries(list.map((f) => [f.id, f]));
    const tF = byId(thenF), nF = byId(nowF);
    /* 3 · factor-level changes */
    for (const f of nowF) {
      const t = tF[f.id];
      const rt = (x) => (x.material ? (x.direction === 'negative' ? 'NEG' : 'POS') : 'INFO');
      if (!t) { changes.push(chg('factor:' + f.id, 'MARKET_EVIDENCE', f.material ? (f.direction === 'negative' ? 'TH-NEG-NEW' : 'TH-POS-NEW') : 'TH-FACTOR-INFO', bi(`גורם ${f.material ? 'מהותי ' : ''}חדש: ${T(f.text, 'he')}`, `new ${f.material ? 'material ' : ''}factor: ${T(f.text, 'en')}`), null, f.value != null ? f.value : T(f.text, 'en'), f.source, f.period, f.cls, 'NONE', f.material ? 'RELEVANT' : 'INFORMATIONAL', f)); continue; }
      if (rt(t) !== rt(f)) { const toNeg = rt(f) === 'NEG', toPos = rt(f) === 'POS', fromNeg = rt(t) === 'NEG', fromPos = rt(t) === 'POS';
        changes.push(chg('factor:' + f.id, 'MARKET_EVIDENCE', toNeg ? 'TH-NEG-NEW' : fromNeg ? 'TH-NEG-GONE' : toPos ? 'TH-POS-NEW' : fromPos ? 'TH-POS-GONE' : 'TH-FACTOR-INFO', bi(`${T(f.text, 'he')} — ${toNeg ? 'הפך לגורם שלילי מהותי' : fromNeg ? 'אינו גורם שלילי מהותי עוד' : toPos ? 'הפך לגורם חיובי מהותי' : fromPos ? 'אינו גורם חיובי מהותי עוד' : 'השתנה'}${!f.material && f.whyNotMaterial ? ' (' + f.whyNotMaterial.map((r) => T(r, 'he')).join('; ') + ')' : ''}`, `${T(f.text, 'en')} — ${toNeg ? 'became a material negative' : fromNeg ? 'is no longer a material negative' : toPos ? 'became a material positive' : fromPos ? 'is no longer a material positive' : 'changed'}${!f.material && f.whyNotMaterial ? ' (' + f.whyNotMaterial.map((r) => T(r, 'en')).join('; ') + ')' : ''}`), t.value != null ? t.value : T(t.text, 'en'), f.value != null ? f.value : T(f.text, 'en'), f.source, f.period, f.cls, 'NONE', toNeg || fromNeg || toPos || fromPos ? 'RELEVANT' : 'INFORMATIONAL', f)); continue; }
      if (!sameVal(t.value, f.value) || T(t.text, 'en') !== T(f.text, 'en')) changes.push(chg('factor:' + f.id, 'MARKET_EVIDENCE', f.material ? 'TH-FACTOR-VALUE' : 'TH-FACTOR-INFO', bi(`${T(f.text, 'he')} (היה: ${T(t.text, 'he')})`, `${T(f.text, 'en')} (was: ${T(t.text, 'en')})`), t.value != null ? t.value : T(t.text, 'en'), f.value != null ? f.value : T(f.text, 'en'), f.source, f.period, f.cls, 'NONE', 'INFORMATIONAL', f));
    }
    for (const t of thenF) if (!nF[t.id]) changes.push(chg('factor:' + t.id, 'MARKET_EVIDENCE', t.material ? (t.direction === 'negative' ? 'TH-NEG-GONE' : 'TH-POS-GONE') : 'TH-FACTOR-INFO', bi(`${T(t.text, 'he')} — אינו מופיע בקריאה הנוכחית`, `${T(t.text, 'en')} — not present in the current read`), t.value != null ? t.value : T(t.text, 'en'), null, t.source, t.period, t.cls, 'NONE', t.material ? 'RELEVANT' : 'INFORMATIONAL', t));
    /* a PASS / INSUFFICIENT economic verdict leaves the market no path to the decision (rules F1 / F2): its factor changes are context */
    const noPath = then.economic === 'PASS' || then.economic === 'INSUFFICIENT_EVIDENCE';
    if (noPath) for (const c of changes) if (c.category === 'MARKET_EVIDENCE' && c.materiality !== 'INFORMATIONAL') { c.materiality = 'INFORMATIONAL'; c.materialityLabel = MATERIALITY.INFORMATIONAL.label; c.impact = 'CONTEXT'; c.impactLabel = IMPACT.CONTEXT; c.limitation = bi(`ההכרעה הכלכלית ${T(vLabel(then.economic), 'he')} — לשוק אין נתיב להחלטה (כלל ${then.economic === 'PASS' ? 'F2' : 'F1'}); הקשר בלבד`, `the economic verdict is ${T(vLabel(then.economic), 'en')} — the market has no path to the decision (rule ${then.economic === 'PASS' ? 'F2' : 'F1'}); context only`); }
    /* 4 · status, condition and verdict changes — the only decision-level moves, each by its F-rule */
    const statusMoved = MAn.status !== then.market;
    const towardCaution = then.market === 'CAUTION' || MAn.status === 'CAUTION';
    if (statusMoved && !noPath) changes.push(chg('status', 'MARKET_EVIDENCE', 'TH-STATUS', bi(`הערכת השוק וביצוע: ${T(MA.STATUS[then.market].label, 'he')} → ${T(MAn.statusLabel, 'he')} (${MAn.convergence.negative} שליליים מהותיים מ-${(MAn.convergence.negativeFamilies || []).length} משפחות; ${MAn.convergence.positive} חיוביים)`, `market & execution: ${T(MA.STATUS[then.market].label, 'en')} → ${T(MAn.statusLabel, 'en')} (${MAn.convergence.negative} material negatives from ${(MAn.convergence.negativeFamilies || []).length} families; ${MAn.convergence.positive} positives)`), then.market, MAn.status, 'altaris:market-assessment', null, 'DERIVED', 'ASSESSMENT_MOVED', towardCaution ? 'MATERIAL_THESIS' : 'RELEVANT'));
    const hadMC = !!then.marketCondition, hasMC = !!finNow.marketCondition;
    const verdictMoved = finNow.verdict !== then.verdict;
    let state;
    if (hadMC && !hasMC) { changes.push(chg('market-condition', 'MARKET_EVIDENCE', 'TH-F5-RESOLVE', bi(`תנאי השוק המקורי הוסר: ${T(then.marketCondition.text, 'he')}`, `the original market condition is resolved: ${T(then.marketCondition.text, 'en')}`), 'active', 'resolved', 'altaris:market-assessment', null, null, 'CONDITION_RESOLVED', verdictMoved ? 'DECISION_IMPACTING' : 'MATERIAL_THESIS')); state = 'CONDITION_RESOLVED'; }
    else if (!hadMC && hasMC) { changes.push(chg('market-condition', 'MARKET_EVIDENCE', finNow.rule === 'F3' ? 'TH-F3' : 'TH-F4', bi(`תנאי שוק חדש: ${T(finNow.marketCondition.text, 'he')}`, `a new market condition: ${T(finNow.marketCondition.text, 'en')}`), 'none', 'active', 'altaris:market-assessment', null, null, 'CONDITION_ADDED', verdictMoved ? 'DECISION_IMPACTING' : 'MATERIAL_THESIS')); state = verdictMoved ? 'DECISION_REQUIRES_REVIEW' : 'NEW_CONDITION_TRIGGERED'; }
    if (verdictMoved) changes.push(chg('verdict', 'MARKET_EVIDENCE', finNow.rule === 'F3' ? 'TH-F3' : 'TH-F5-RESOLVE', bi(`ההחלטה תחת אותה מדיניות: ${T(vLabel(then.verdict), 'he')} → ${T(vLabel(finNow.verdict), 'he')} (כלל ${finNow.rule})`, `the decision under the same policy: ${T(vLabel(then.verdict), 'en')} → ${T(vLabel(finNow.verdict), 'en')} (rule ${finNow.rule})`), then.verdict, finNow.verdict, 'altaris:decision', null, 'DERIVED', 'VERDICT_CHANGED', 'DECISION_IMPACTING'));
    if (!state) {
      const negNew = !noPath && changes.some((c) => c.rule === 'TH-NEG-NEW'), negGone = !noPath && changes.some((c) => c.rule === 'TH-NEG-GONE'), posNew = !noPath && changes.some((c) => c.rule === 'TH-POS-NEW');
      if (verdictMoved && verdictRank(finNow.verdict) < verdictRank(then.verdict)) state = 'DECISION_REQUIRES_REVIEW';
      else if (negNew) state = 'THESIS_WEAKENED';
      else if ((statusMoved && !noPath && MAn.status === 'STRONG') || negGone || posNew) state = 'THESIS_STRENGTHENED';
      else state = 'NO_MATERIAL_THESIS_CHANGE';
    }
    /* 5 · source evidence: freshness states, conflicts, transactions, developer, pipeline, macro, CBS, dossier history, revisions */
    const cT = snap.context.cbs, cN = now.cbs ? slimCbs(now.cbs) : null;
    if (cT && cN) {
      if (cT.freshness !== 'STALE' && cN.freshness === 'STALE') changes.push(chg('cbs-stale', 'SOURCE_EVIDENCE', 'TH-SOURCE-STALE', bi('סדרת המכירות של הלמ״ס מסומנת ישנה בקריאה הנוכחית', 'the CBS sales series is STALE in the current read'), cT.freshness, cN.freshness, 'cbs:timeseries:44,10', cN.latest, 'OFFICIAL', 'EVIDENCE', 'RELEVANT'));
      if (cT.freshness === 'STALE' && cN.freshness !== 'STALE') changes.push(chg('cbs-recovered', 'SOURCE_EVIDENCE', 'TH-SOURCE-RECOVERED', bi('סדרת המכירות של הלמ״ס עדכנית שוב', 'the CBS sales series is current again'), cT.freshness, cN.freshness, 'cbs:timeseries:44,10', cN.latest, 'OFFICIAL', 'NONE', 'RELEVANT'));
      if (cT.latest !== cN.latest || !sameNum(cT.momentum, cN.momentum)) changes.push(chg('cbs-series', 'MARKET_EVIDENCE', 'TH-CBS', bi(`סדרת המכירות (${T(cN.scope, 'he')}): תקופה אחרונה ${cT.latest || '—'} → ${cN.latest || '—'}; מומנטום 3 חודשים ${cT.momentum != null ? cT.momentum + '%' : '—'} → ${cN.momentum != null ? cN.momentum + '%' : '—'}`, `the sales series (${T(cN.scope, 'en')}): latest period ${cT.latest || '—'} → ${cN.latest || '—'}; 3-month momentum ${cT.momentum != null ? cT.momentum + '%' : '—'} → ${cN.momentum != null ? cN.momentum + '%' : '—'}`), cT.momentum, cN.momentum, 'cbs:timeseries:44,10', cN.latest, 'OFFICIAL', 'NONE', 'INFORMATIONAL'));
    }
    const mT = snap.context.market, mN = slimMarket(nowM);
    if (mT && mN) {
      /* the PROPX-median vs underwriting-value conflict (the decision's conflictsOf rule) on the new window; the underwriting value is frozen */
      const A = snap.assumptions;
      const devOf = (tx) => (tx && isNum(tx.median) && isNum(A.sqm) && isNum(A.supportedValue) && A.valueSource !== 'propx' ? Math.abs(A.supportedValue - tx.median * A.sqm) / (tx.median * A.sqm) : null);
      const dT = devOf(mT.tx), dN = devOf(mN.tx), lim = DX.POLICY.conflictSpread;
      if (isNum(dN) && dN > lim && !(isNum(dT) && dT > lim)) changes.push(chg('conflict:propx-median', 'SOURCE_EVIDENCE', 'TH-CONFLICT', bi(`חציון PROPX × שטח (${Math.round(mN.tx.median * A.sqm).toLocaleString('en-US')} ₪) סוטה ${Math.round(dN * 100)}% מהשווי לחיתום (${Math.round(A.supportedValue).toLocaleString('en-US')} ₪)`, `PROPX median × area (₪${Math.round(mN.tx.median * A.sqm).toLocaleString('en-US')}) deviates ${Math.round(dN * 100)}% from the underwriting value (₪${Math.round(A.supportedValue).toLocaleString('en-US')})`), isNum(dT) ? Math.round(dT * 100) + '%' : '—', Math.round(dN * 100) + '%', mN.tx.via || 'over:deals-republication', mN.tx.from && mN.tx.to ? `${mN.tx.from} → ${mN.tx.to}` : null, 'OBSERVED', 'EVIDENCE', 'RELEVANT'));
      if (isNum(dT) && dT > lim && !(isNum(dN) && dN > lim)) changes.push(chg('conflict:propx-median', 'SOURCE_EVIDENCE', 'TH-CONFLICT-GONE', bi('סתירת חציון PROPX מול השווי לחיתום אינה מתקיימת עוד', 'the PROPX-median vs underwriting-value conflict no longer holds'), Math.round(dT * 100) + '%', isNum(dN) ? Math.round(dN * 100) + '%' : '—', (mN.tx && mN.tx.via) || 'over:deals-republication', mN.tx && mN.tx.from && mN.tx.to ? `${mN.tx.from} → ${mN.tx.to}` : null, 'OBSERVED', 'EVIDENCE', 'RELEVANT'));
      if (mT.tx && mN.tx && (mT.tx.n !== mN.tx.n || mT.tx.to !== mN.tx.to) && !changes.some((c) => c.id === 'factor:tx:depth')) changes.push(chg('tx-window', 'MARKET_EVIDENCE', 'TH-TX', bi(`חלון העסקאות: ${mT.tx.n != null ? mT.tx.n : '—'} עסקאות (עד ${mT.tx.to || '—'}) → ${mN.tx.n != null ? mN.tx.n : '—'} (עד ${mN.tx.to || '—'})`, `the transaction window: ${mT.tx.n != null ? mT.tx.n : '—'} deals (to ${mT.tx.to || '—'}) → ${mN.tx.n != null ? mN.tx.n : '—'} (to ${mN.tx.to || '—'})`), mT.tx.n, mN.tx.n, mN.tx.via || 'over:deals-republication', mN.tx.from && mN.tx.to ? `${mN.tx.from} → ${mN.tx.to}` : null, 'OBSERVED', 'NONE', 'INFORMATIONAL'));
      const dvT = mT.devIntel, dvN = mN.devIntel;
      if (dvT && dvN && !dvT.none && !dvN.none) {
        const diffs = ['lots', 'units', 'lastWin', 'projects', 'lotteryUnits', 'lastLottery', 'cities', 'possibleSame'].filter((k) => JSON.stringify(dvT[k]) !== JSON.stringify(dvN[k]));
        if (diffs.length) changes.push(chg('developer', 'DEVELOPER', 'TH-DEV', bi(`פעילות היזם שנצפתה השתנתה: ${diffs.map((k) => `${k} ${dvT[k] != null ? dvT[k] : '—'} → ${dvN[k] != null ? dvN[k] : '—'}`).join(' · ')}`, `the developer\'s observed activity changed: ${diffs.map((k) => `${k} ${dvT[k] != null ? dvT[k] : '—'} → ${dvN[k] != null ? dvN[k] : '—'}`).join(' · ')}`), null, null, 'lib/entities', null, 'OBSERVED', 'NONE', 'INFORMATIONAL'));
        const cT2 = dvT.construction, cN2 = dvN.construction;
        if (JSON.stringify(cT2) !== JSON.stringify(cN2)) changes.push(chg('developer-construction', 'PROJECT_EXECUTION', 'TH-DEV-CONSTR', bi(`ראיות הבנייה של היזם (משב״ש): בניינים ${cT2 ? cT2.buildings : '—'} → ${cN2 ? cN2.buildings : '—'} · התחלות ${cT2 ? cT2.started : '—'} → ${cN2 ? cN2.started : '—'} · גמר ${cT2 ? cT2.completed : '—'} → ${cN2 ? cN2.completed : '—'} (נכון ל-${cN2 && cN2.asOf ? cN2.asOf : '—'})`, `the developer\'s construction evidence (MoCH): buildings ${cT2 ? cT2.buildings : '—'} → ${cN2 ? cN2.buildings : '—'} · started ${cT2 ? cT2.started : '—'} → ${cN2 ? cN2.started : '—'} · completed ${cT2 ? cT2.completed : '—'} → ${cN2 ? cN2.completed : '—'} (as of ${cN2 && cN2.asOf ? cN2.asOf : '—'})`), cT2 ? cT2.started : null, cN2 ? cN2.started : null, 'moch:construction-progress', cN2 ? cN2.asOf : null, 'OFFICIAL', 'NONE', 'RELEVANT'));
      } else if (dvT && dvN && !!dvT.none !== !!dvN.none) changes.push(chg('developer-registry', 'DEVELOPER', dvN.none ? 'TH-DEV' : 'TH-SOURCE-RECOVERED', dvN.none ? bi('היזם אינו ברישום PROPX בקריאה הנוכחית', 'the developer is not in the PROPX registry in the current read') : bi('היזם נמצא ברישום PROPX תחת השם המדויק', 'the developer is now in the PROPX registry under the exact name'), !dvT.none, !dvN.none, 'lib/entities', null, 'OBSERVED', 'NONE', dvN.none ? 'INFORMATIONAL' : 'RELEVANT'));
      if (mT.pipeline && mN.pipeline && JSON.stringify(mT.pipeline.stageCounts) !== JSON.stringify(mN.pipeline.stageCounts)) changes.push(chg('pipeline', 'PROJECT_EXECUTION', 'TH-PIPE', bi(`צנרת הפרויקטים שנצפתה ביישוב: ${JSON.stringify(mT.pipeline.stageCounts)} → ${JSON.stringify(mN.pipeline.stageCounts)}`, `the observed project pipeline in the locality: ${JSON.stringify(mT.pipeline.stageCounts)} → ${JSON.stringify(mN.pipeline.stageCounts)}`), mT.pipeline.total, mN.pipeline.total, 'lib/entities', null, 'DERIVED', 'NONE', 'INFORMATIONAL'));
    }
    const iT = snap.context.indicators || {}, iN = slimInd(now.indicators);
    for (const k of Object.keys(iN)) if (iT[k] && (!sameNum(iT[k].value, iN[k].value) || !sameNum(iT[k].yoy, iN[k].yoy)) && !changes.some((c) => c.id === 'factor:radar:construction-inputs' || c.id === 'factor:dossier:construction-inputs')) changes.push(chg('macro:' + k, 'MACRO', 'TH-MACRO', bi(`${k}: ${iT[k].value != null ? iT[k].value : '—'} → ${iN[k].value != null ? iN[k].value : '—'}${iN[k].yoy != null ? ` (שנתי ${iN[k].yoy}%)` : ''}`, `${k}: ${iT[k].value != null ? iT[k].value : '—'} → ${iN[k].value != null ? iN[k].value : '—'}${iN[k].yoy != null ? ` (y/y ${iN[k].yoy}%)` : ''}`), iT[k].value, iN[k].value, k === 'boiRate' ? 'boi:interest' : 'propx:market-sync', iN[k].period || iN[k].publishedAt || null, 'OFFICIAL', 'NONE', 'INFORMATIONAL'));
    /* dossier history: the geography's own facts since the decision (PROPX snapshots) — a decision impact only through a moved factor */
    const H = now.dossierHistory || null, geoChanges = [];
    if (H && H.status === 'OK') for (const c of H.changes || []) {
      const sig = FACT_SIGNAL[c.fact] || null, moved = sig && changes.some((x) => x.id.startsWith('factor:') && x.signal === sig && x.materiality !== 'INFORMATIONAL');
      const item = chg('geo:' + c.fact, 'GEOGRAPHY', 'TH-GEO', bi(`${T(c.label, 'he')}: ${fmtGeo(c.from, c.unit)} → ${fmtGeo(c.to, c.unit)}${c.period && c.period.moved ? ` (תקופה ${c.period.from || '—'} → ${c.period.to || '—'})` : ''}`, `${T(c.label, 'en')}: ${fmtGeo(c.from, c.unit)} → ${fmtGeo(c.to, c.unit)}${c.period && c.period.moved ? ` (period ${c.period.from || '—'} → ${c.period.to || '—'})` : ''}`), c.from, c.to, c.source || 'propx:dossier-history', c.period ? c.period.to || c.period.from : null, c.cls || null, moved ? 'ASSESSMENT_MOVED' : 'NONE', moved ? 'RELEVANT' : 'INFORMATIONAL');
      item.kind = c.kind; item.verb = c.verb; item.scope = c.scope || c.geoScope || null; item.window = { from: H.from ? H.from.date : null, to: H.to ? H.to.date : null }; item.contributes = moved ? sig : null;
      geoChanges.push(item);
    } else if (H) notes.push(bi(`היסטוריית התיק: ${H.status}${H.reason ? ' — ' + T(H.reason, 'he') : ''}`, `dossier history: ${H.status}${H.reason ? ' — ' + T(H.reason, 'en') : ''}`));
    /* official revisions of periods before the decision: the original value is kept beside the revised one; retrospective impact only through the momentum factor */
    const revisions = [];
    if (Array.isArray(now.revisions) && cT) for (const r of now.revisions) {
      if (cT.code && r.geo && String(r.geo) !== String(cT.code)) continue;
      if (cT.latest && r.period && String(r.period) > String(cT.latest)) continue;
      const momentumThen = thenF.find((f) => /sales-momentum/.test(f.signal) && f.material), momentumNow = nowF.find((f) => /sales-momentum/.test(f.signal) && f.material);
      const impact = (momentumThen ? momentumThen.signal : null) !== (momentumNow ? momentumNow.signal : null);
      revisions.push({ id: r.id || `${r.key || r.measure}#${r.period}`, measure: r.measure || null, period: r.period || null, original: r.oldValue != null ? r.oldValue : (r.old != null ? r.old : null), revised: r.newValue != null ? r.newValue : (r.value != null ? r.value : null), delta: r.delta != null ? r.delta : null, material: !!r.material, publishedAt: r.publishedAt || null, observedAt: r.observedAt || null, source: 'cbs:timeseries:44,10', cls: 'OFFICIAL', rule: 'TH-REVISION',
        retrospectiveImpact: impact ? bi('מצב גורם המומנטום שונה בין תמונת ההחלטה לקריאה הנוכחית — התיקון תורם להפרש', 'the momentum factor\'s state differs between the decision snapshot and the current read — the revision contributes to the delta') : bi('ללא — מצב גורם המומנטום זהה; ההחלטה לא הייתה משתנה', 'none — the momentum factor\'s state is the same; the decision would not have changed'), impact: impact ? 'ASSESSMENT_MOVED' : 'NONE' });
    }
    /* 6 · the delta */
    const materiality = maxMateriality(changes);
    const current = { verdict: finNow.verdict, verdictLabel: finNow.verdictLabel, changed: finNow.changed, from: then.verdict, rule: finNow.rule, reason: finNow.reason, market: MAn.status, marketLabel: MAn.statusLabel, convergence: MAn.convergence, conditions: condsNow, marketCondition: finNow.marketCondition ? slimCond(finNow.marketCondition) : null, whatWouldRemove: finNow.whatWouldRemove || [], economic: then.economic, evidence: then.evidence, factors: nowF, freshness: MAn.freshness, basis: bi('ההכרעה הכלכלית, איכות הראיות, התנאים הכלכליים ונקודות ההיפוך קפואים בתמונת ההחלטה; רק הערכת השוק וביצוע חושבה מחדש והגיעה להחלטה דרך כללי F0–F5', 'the economic verdict, evidence quality, economic conditions and flip points are frozen in the decision snapshot; only the market & execution assessment was recomputed and reached the decision through rules F0–F5') };
    const resolved = then.conditions.filter((c) => !condsNow.some((x) => x.id === c.id)), added = condsNow.filter((c) => !then.conditions.some((x) => x.id === c.id));
    const retrospective = retrospectiveOf(then, finNow, MAn, changes);
    const nbe = nextBestEvidence(snap).items;
    const tvn = thenVsNow(snap, then, current, changes.concat(geoChanges), { resolved, added, nbe, revisions });
    const out = Object.assign(base, { state, stateLabel: DELTA[state].label, status: DELTA[state].status, materiality, rule: topRule(changes), changes, geoChanges, revisions, current, conditions: { active: condsNow, resolved, added, unchanged: then.conditions.filter((c) => condsNow.some((x) => x.id === c.id)) }, thenVsNow: tvn, retrospective, narrative: narrativeOf(snap, state, then, current, changes, resolved, added, tvn), notes, attention: attentionOf(state, changes) });
    return deepFreeze(out);
  }
  const FACT_SIGNAL = Object.freeze({ 'sales.momentum3m': 'sales-momentum-down', 'land.unitsFailed': 'failed-tenders', 'inventory.monthsSupply': 'months-of-supply', 'land.unitsAwarded': 'awarded-pipeline', 'land.unitsOpen': 'open-land', 'land.unitsPendingDecision': 'pending-decision', 'renewal.proposedUnits': 'renewal-pipeline', 'rental.tenderUnits': 'rental-pipeline', 'developers.entries': 'developer-entries', 'macro.constructionInputsYoy': 'construction-inputs' });
  const fmtGeo = (v, unit) => (v == null ? '—' : typeof v === 'number' ? (unit === 'percent' ? v + '%' : v.toLocaleString('en-US')) : String(v));
  function chg(id, category, rule, text, from, to, source, period, cls, impact, materiality, factor) {
    const R = RULES[rule] || {};
    return { id, category, categoryLabel: CATEGORY[category], rule, ruleText: R.rule || null, text, from: from === undefined ? null : from, to: to === undefined ? null : to, source: source || null, period: period || null, cls: cls || null, evidence: factor ? factor.evidence || null : null, geoScope: factor ? factor.geoScope || null : null, signal: factor ? factor.signal || null : null, impact, impactLabel: IMPACT[impact] || IMPACT.NONE, materiality, materialityLabel: MATERIALITY[materiality].label,
      limitation: category === 'MARKET_EVIDENCE' || category === 'GEOGRAPHY' ? bi('ראיית שוק אינה משנה IRR, MOIC, תזרים או הון בסיכון — רק את הערכת השוק וביצוע וההחלטה הסופית דרך המדיניות', 'market evidence never changes IRR, MOIC, cash flows or capital at risk — only the market & execution assessment and the final decision through the policy') : category === 'SOURCE_EVIDENCE' ? bi('מקור ישן / חסר אינו אות שלילי; סתירה נשמרת על שני ערכיה', 'a stale / missing source is not a negative signal; a conflict keeps both values') : category === 'DEVELOPER' || category === 'PROJECT_EXECUTION' ? bi('ראיות ברמת היזם / היישוב אינן ראיות ברמת הפרויקט', 'developer- / locality-level evidence is not project-level evidence') : null };
  }
  const maxMateriality = (changes) => changes.reduce((m, c) => (MATERIALITY[c.materiality].rank > MATERIALITY[m].rank ? c.materiality : m), 'INFORMATIONAL');
  const topRule = (changes) => { const top = changes.slice().sort((a, b) => MATERIALITY[b.materiality].rank - MATERIALITY[a.materiality].rank)[0]; return top ? top.rule : null; };
  function attentionOf(state, changes) {
    const src = changes.some((c) => c.category === 'SOURCE_EVIDENCE' && c.materiality !== 'INFORMATIONAL');
    const info = changes.some((c) => c.materiality === 'INFORMATIONAL' || c.materiality === 'RELEVANT');
    const key = state === 'NO_MATERIAL_THESIS_CHANGE' ? (src ? 'SOURCE_ISSUE' : info ? 'NEW_INFORMATION' : 'NO_MATERIAL_THESIS_CHANGE') : state === 'INSUFFICIENT_NEW_EVIDENCE' ? (src ? 'SOURCE_ISSUE' : 'NOT_CHECKED') : state === 'THESIS_STRENGTHENED' ? 'NEW_INFORMATION' : state;
    const a = ATTENTION.find((x) => x.state === key) || ATTENTION[ATTENTION.length - 2];
    return { n: a.n, key: a.state, label: a.label };
  }
  function retrospectiveOf(then, finNow, MAn, changes) {
    if (MAn.status === 'INSUFFICIENT') return { answer: 'CANNOT_DETERMINE', text: bi('הראיות אינן מספיקות — אין הערכת שוק', 'the evidence remains insufficient — no market assessment') };
    const moved = finNow.verdict !== then.verdict, hadMC = !!then.marketCondition, hasMC = !!finNow.marketCondition;
    const facts = changes.filter((c) => c.materiality === 'DECISION_IMPACTING' || c.materiality === 'MATERIAL_THESIS' || c.rule === 'TH-NEG-NEW' || c.rule === 'TH-NEG-GONE').map((c) => ({ id: c.id, text: c.text, rule: c.rule, cls: c.cls, source: c.source, period: c.period }));
    const unchanged = bi('ללא שינוי: IRR, MOIC, הון בסיכון, התזרימים, ההכרעה הכלכלית, איכות הראיות והתנאים הכלכליים', 'unchanged: IRR, MOIC, capital at risk, the cash flows, the economic verdict, evidence quality and the economic conditions');
    if (moved) return { answer: 'YES', text: bi(`כן — ${T(vLabel(then.verdict), 'he')} היה הופך ל-${T(vLabel(finNow.verdict), 'he')} (כלל ${finNow.rule})`, `YES — ${T(vLabel(then.verdict), 'en')} would have become ${T(vLabel(finNow.verdict), 'en')} (rule ${finNow.rule})`), from: then.verdict, to: finNow.verdict, rule: finNow.rule, facts, unchanged };
    if (hadMC && !hasMC) return { answer: 'YES_CONDITION', text: bi('כן — תנאי השוק לא היה נדרש (ההערכה אינה בזהירות); ההחלטה עצמה זהה', 'YES — the market condition would not have been required (the assessment is not CAUTION); the decision itself is the same'), rule: 'F5', facts, unchanged };
    if (!hadMC && hasMC) return { answer: 'YES_CONDITION', text: bi(`כן — תנאי שוק היה נוסף (כלל ${finNow.rule}); ההחלטה עצמה זהה`, `YES — a market condition would have been added (rule ${finNow.rule}); the decision itself is the same`), rule: finNow.rule, facts, unchanged };
    return { answer: 'NO', text: bi('לא — תחת אותה מדיניות ההחלטה ותנאיה היו זהים', 'NO — under the same policy the decision and its conditions would have been the same'), facts, unchanged };
  }
  function thenVsNow(snap, then, current, changes, extra) {
    extra = extra || {};
    const mat = changes.filter((c) => c.materiality !== 'INFORMATIONAL').sort((a, b) => MATERIALITY[b.materiality].rank - MATERIALITY[a.materiality].rank), info = changes.filter((c) => c.materiality === 'INFORMATIONAL');
    const E = snap.economic, s = E.lead ? E.structures[E.lead] : null;
    const unchanged = [bi(`IRR ${s && isNum(s.irr) ? Math.round(s.irr * 1000) / 10 + '%' : '—'}`, `IRR ${s && isNum(s.irr) ? Math.round(s.irr * 1000) / 10 + '%' : '—'}`), bi(`MOIC ${s && isNum(s.moic) ? Math.round(s.moic * 100) / 100 + '×' : '—'}`, `MOIC ${s && isNum(s.moic) ? Math.round(s.moic * 100) / 100 + '×' : '—'}`), bi(`הון בסיכון ${s && isNum(s.capitalAtRisk) ? Math.round(s.capitalAtRisk).toLocaleString('en-US') + ' ₪' : '—'}`, `capital at risk ${s && isNum(s.capitalAtRisk) ? '₪' + Math.round(s.capitalAtRisk).toLocaleString('en-US') : '—'}`), bi('הנחות העסקה המקוריות', 'the original deal assumptions'), bi(`ההכרעה הכלכלית ${T(vLabel(then.economic), 'he')}`, `the economic verdict ${T(vLabel(then.economic), 'en')}`), bi(`איכות ראיות ${then.evidence || '—'}`, `evidence quality ${then.evidence || '—'}`)];
    const top = mat[0] || null;
    const next = extra.nbe && extra.nbe[0] ? extra.nbe[0] : null;
    return { status: current ? DELTA_STATUS(current, then) : 'NOT_CHECKED', original: { verdict: then.verdict, verdictLabel: vLabel(then.verdict), market: then.market, evidence: then.evidence, conditions: then.conditions.map((c) => c.text), missing: snap.economic.evidence.items.filter((it) => it.cls === 'MISSING').map((it) => it.text), decidedAt: snap.decidedAt },
      current: current ? { verdict: current.verdict, verdictLabel: current.verdictLabel, market: current.market, conditions: current.conditions.map((c) => c.text), rule: current.rule } : null,
      whatChanged: mat.map((c) => ({ id: c.id, text: c.text, category: c.categoryLabel, impact: c.impactLabel, materiality: c.materialityLabel, rule: c.rule })), informational: info.map((c) => ({ id: c.id, text: c.text, category: c.categoryLabel, rule: c.rule })), whatDidNotChange: unchanged,
      whyItMatters: top ? (top.impact === 'CONDITION_RESOLVED' ? bi('ראיה מאומתת הסירה את התנאי שהיה פתוח בזמן ההחלטה', 'verified evidence resolved the condition that was open at decision time') : top.impact === 'CONDITION_ADDED' ? bi('ראיות שוק באיכות גבוהה מתכנסות לזהירות — תנאי שוק נוסף תחת המדיניות', 'high-quality market evidence converges to CAUTION — a market condition is added under the policy') : top.impact === 'VERDICT_CHANGED' ? bi('תחת אותה מדיניות ההחלטה שונה היום — הכלל והראיה מפורטים', 'under the same policy the decision differs today — the rule and the evidence are listed') : top.impact === 'ASSESSMENT_MOVED' ? bi('הערכת השוק וביצוע זזה; ההחלטה לא השתנתה', 'the market & execution assessment moved; the decision did not change') : top.rule === 'TH-AGING' || top.category === 'SOURCE_EVIDENCE' ? bi('מצב המקורות השתנה — איכות הראיות תיבחן בחיתום מחדש; לא אות שלילי', 'the state of the sources changed — evidence quality is reviewed on a re-underwrite; not a negative signal') : bi('גורם מהותי השתנה בלי להזיז את ההערכה או את ההחלטה', 'a material factor changed without moving the assessment or the decision')) : bi('אף שינוי מהותי — ההחלטה המקורית ותנאיה עומדים', 'no material change — the original decision and its conditions stand'),
      nextToWatch: next ? { fact: next.fact, relevance: next.relevanceLabel, why: next.why } : null, resolved: (extra.resolved || []).map((c) => c.text), added: (extra.added || []).map((c) => c.text), revisions: extra.revisions || [] };
  }
  const DELTA_STATUS = (current, then) => (current.verdict !== then.verdict ? 'REVIEW_REQUIRED' : (!!current.marketCondition !== !!then.marketCondition || current.market !== then.market) ? 'CHANGED' : 'SUPPORTED');
  function narrativeOf(snap, state, then, current, changes, resolved, added, tvn) {
    const P = [];
    const name = snap.name ? `${snap.name}: ` : '';
    if (state === 'NO_MATERIAL_THESIS_CHANGE') P.push(bi(`${name}ההחלטה המקורית (${T(vLabel(then.verdict), 'he')}) נתמכת. בקריאה הנוכחית לא נמצא שינוי מהותי בעובדות שהשפיעו עליה; ${changes.length ? `${changes.length} שינויי מידע נרשמו ללא השפעה על ההחלטה.` : 'לא נרשמו שינויים.'}`, `${name}The original decision (${T(vLabel(then.verdict), 'en')}) remains supported. The current read shows no material change in the facts that influenced it; ${changes.length ? `${changes.length} informational changes were noted with no decision impact.` : 'no changes were noted.'}`));
    if (state === 'CONDITION_RESOLVED') P.push(bi(`${name}ראיה מאומתת חדשה הסירה את תנאי השוק שהיה פתוח בזמן ההחלטה (${resolved.map((c) => T(c.text, 'he')).join('; ')}). תחת אותה מדיניות ההחלטה היא ${T(current.verdictLabel, 'he')} (כלל ${current.rule}). הכלכלה המרכזית לא השתנתה.`, `${name}New verified evidence resolves the market condition that was open at decision time (${resolved.map((c) => T(c.text, 'en')).join('; ')}). Under the same policy the decision is ${T(current.verdictLabel, 'en')} (rule ${current.rule}). Core economics are unchanged.`));
    if (state === 'NEW_CONDITION_TRIGGERED') P.push(bi(`${name}ראיות שוק באיכות גבוהה מתכנסות לזהירות — תנאי שוק נוסף (${added.map((c) => T(c.text, 'he')).join('; ')}). ההחלטה נשארת ${T(current.verdictLabel, 'he')} (כלל ${current.rule}); הכלכלה לא השתנתה.`, `${name}High-quality market evidence converges to CAUTION — a market condition is added (${added.map((c) => T(c.text, 'en')).join('; ')}). The decision stays ${T(current.verdictLabel, 'en')} (rule ${current.rule}); the economics are unchanged.`));
    if (state === 'DECISION_REQUIRES_REVIEW') P.push(bi(`${name}תחת אותה מדיניות ההחלטה הייתה היום ${T(current.verdictLabel, 'he')} במקום ${T(vLabel(then.verdict), 'he')} (כלל ${current.rule}): ${changes.filter((c) => c.materiality === 'DECISION_IMPACTING' || c.rule === 'TH-NEG-NEW').map((c) => T(c.text, 'he')).join('; ')}. הכלכלה, ה-IRR וההון בסיכון לא השתנו — ההחלטה דורשת בחינה.`, `${name}Under the same policy the decision today would be ${T(current.verdictLabel, 'en')} instead of ${T(vLabel(then.verdict), 'en')} (rule ${current.rule}): ${changes.filter((c) => c.materiality === 'DECISION_IMPACTING' || c.rule === 'TH-NEG-NEW').map((c) => T(c.text, 'en')).join('; ')}. The economics, IRR and capital at risk are unchanged — the decision requires review.`));
    if (state === 'THESIS_WEAKENED') P.push(bi(`${name}גורם שלילי מהותי חדש נרשם (${changes.filter((c) => c.rule === 'TH-NEG-NEW').map((c) => T(c.text, 'he')).join('; ')}). לבדו אינו מזיז את ההערכה; ההחלטה ${T(current.verdictLabel, 'he')} עומדת, ללא תנאי חדש.`, `${name}A new material negative factor is noted (${changes.filter((c) => c.rule === 'TH-NEG-NEW').map((c) => T(c.text, 'en')).join('; ')}). Alone it does not move the assessment; the decision ${T(current.verdictLabel, 'en')} stands with no new condition.`));
    if (state === 'THESIS_STRENGTHENED') P.push(bi(`${name}ראיות השוק השתפרו (${changes.filter((c) => c.rule === 'TH-NEG-GONE' || c.rule === 'TH-POS-NEW' || c.rule === 'TH-STATUS').map((c) => T(c.text, 'he')).join('; ')}). ההחלטה ${T(current.verdictLabel, 'he')} אינה משתדרגת — שוק טוב לעולם אינו משדרג הכרעה כלכלית.`, `${name}The market evidence improved (${changes.filter((c) => c.rule === 'TH-NEG-GONE' || c.rule === 'TH-POS-NEW' || c.rule === 'TH-STATUS').map((c) => T(c.text, 'en')).join('; ')}). The decision ${T(current.verdictLabel, 'en')} is not upgraded — a good market never upgrades an economic verdict.`));
    if ((then.economic === 'PASS' || then.economic === 'INSUFFICIENT_EVIDENCE') && changes.some((c) => c.impact === 'CONTEXT')) P.push(bi(`ראיות השוק זזו, אך ההכרעה הכלכלית ${T(vLabel(then.economic), 'he')} אינה משתנה עם השוק (כלל ${then.economic === 'PASS' ? 'F2' : 'F1'}) — הקשר בלבד.`, `The market evidence moved, but the economic verdict ${T(vLabel(then.economic), 'en')} never moves with the market (rule ${then.economic === 'PASS' ? 'F2' : 'F1'}) — context only.`));
    const aging = changes.find((c) => c.rule === 'TH-AGING'); if (aging) P.push(bi(`${T(aging.text, 'he')} — התיישנות ראיות, לא אות שלילי; בחיתום מחדש איכות הראיות תנכה −8.`, `${T(aging.text, 'en')} — evidence aging, not a negative signal; a re-underwrite would deduct −8 from evidence quality.`));
    if (tvn && tvn.nextToWatch) P.push(bi(`הראיה החשובה הבאה: ${T(tvn.nextToWatch.fact, 'he')} (${T(tvn.nextToWatch.relevance, 'he')}).`, `Next most valuable evidence: ${T(tvn.nextToWatch.fact, 'en')} (${T(tvn.nextToWatch.relevance, 'en')}).`));
    return P;
  }

  /* --------------------------------------------------------------- portfolio */
  /** portfolio(list) — list: [{ dealId, name, monitor, snapshot, contract, nbe, lastCheck (a reassess result or null), checkedAt }] */
  function portfolio(list) {
    const rows = (list || []).map((x) => {
      const lc = x.lastCheck || null, paused = x.monitor === 'PAUSED';
      const att = paused ? ATTENTION.find((a) => a.state === 'PAUSED') : !lc ? ATTENTION.find((a) => a.state === 'NOT_CHECKED') : lc.attention ? ATTENTION.find((a) => a.n === lc.attention.n) : ATTENTION.find((a) => a.state === 'NOT_CHECKED');
      const state = paused ? 'PAUSED' : lc ? lc.state : 'NOT_CHECKED';
      const status = paused ? x.status || 'NOT_CHECKED' : lc && lc.status ? lc.status : x.status || 'NOT_CHECKED';
      return { dealId: x.dealId, name: x.name || null, monitor: x.monitor || 'LIVE', state, stateLabel: DELTA[state] ? DELTA[state].label : state === 'PAUSED' ? MONITOR.PAUSED : STATUS.NOT_CHECKED.label, status, statusLabel: STATUS[status] ? STATUS[status].label : null, attention: { n: att.n, key: att.state, label: att.label },
        original: x.snapshot ? x.snapshot.final.verdict : null, current: lc && lc.current ? lc.current.verdict : (x.snapshot ? x.snapshot.final.verdict : null), activeConditions: lc && lc.conditions ? lc.conditions.active.length : (x.snapshot ? x.snapshot.conditions.length : 0), resolved: lc && lc.conditions ? lc.conditions.resolved.length : 0, materiality: lc ? lc.materiality : null, materialChanges: lc ? (lc.changes || []).filter((c) => c.materiality !== 'INFORMATIONAL').length : 0, informational: lc ? (lc.changes || []).filter((c) => c.materiality === 'INFORMATIONAL').length : 0,
        checkedAt: lc ? lc.checkedAt : null, decidedAt: x.snapshot ? x.snapshot.decidedAt : null, basis: x.snapshot ? x.snapshot.basis : null, nbeTop: x.nbe && x.nbe.items && x.nbe.items[0] ? { fact: x.nbe.items[0].fact, relevance: x.nbe.items[0].relevance } : null };
    });
    rows.sort((a, b) => a.attention.n - b.attention.n || ((b.checkedAt || '') > (a.checkedAt || '') ? 1 : (b.checkedAt || '') < (a.checkedAt || '') ? -1 : 0) || (a.dealId < b.dealId ? -1 : a.dealId > b.dealId ? 1 : 0));
    const counts = {}; for (const a of ATTENTION) counts[a.state] = rows.filter((r) => r.attention.key === a.state).length;
    const byState = {}; for (const k of Object.keys(DELTA).concat(['NOT_CHECKED', 'PAUSED'])) byState[k] = rows.filter((r) => r.state === k).length;
    const summary = { total: rows.length, noMaterialChange: rows.filter((r) => ['NO_MATERIAL_THESIS_CHANGE'].includes(r.attention.key)).length, newInformation: counts.NEW_INFORMATION, requiresReview: counts.DECISION_REQUIRES_REVIEW, newCondition: counts.NEW_CONDITION_TRIGGERED, weakened: counts.THESIS_WEAKENED, sourceIssue: counts.SOURCE_ISSUE, resolved: counts.CONDITION_RESOLVED, notChecked: counts.NOT_CHECKED, paused: counts.PAUSED, dealChanged: counts.DEAL_CHANGED };
    /* next best evidence across the portfolio: the same fact, counted once per deal, ranked by relevance then by the number of deals */
    const agg = new Map();
    for (const x of list || []) for (const it of (x.nbe && x.nbe.items) || []) { const k = it.id.replace(/^(market-remove|dossier-missing):.*$/, '$1'); const key = k + '|' + T(it.fact, 'en'); const a = agg.get(key) || { id: k, fact: it.fact, relevance: it.relevance, deals: 0, effect: it.effect, expectedSource: it.expectedSource, path: it.path }; a.deals++; if (RELEVANCE[it.relevance].rank > RELEVANCE[a.relevance].rank) a.relevance = it.relevance; agg.set(key, a); }
    const nbe = [...agg.values()].sort((a, b) => RELEVANCE[b.relevance].rank - RELEVANCE[a.relevance].rank || b.deals - a.deals || (a.id < b.id ? -1 : 1)).slice(0, 10).map((x) => Object.assign(x, { relevanceLabel: RELEVANCE[x.relevance].label }));
    return deepFreeze({ version: VERSION.id, rows, counts, byState, summary, nbe, order: ATTENTION, basis: bi('סדר תשומת הלב דטרמיניסטי: בחינה נדרשת > תנאי חדש > החמרה > הנחות השתנו > מקורות > תנאי הוסר > מידע חדש > ללא שינוי > טרם נבדקה > מושהית; שוויון לפי תאריך הבדיקה ואז לפי מזהה. אין ציון פורטפוליו.', 'a deterministic attention order: review > new condition > worsened > assumptions changed > sources > condition resolved > new information > no change > not checked > paused; ties by check date, then by id. No portfolio score.') });
  }

  /* -------------------------------------------------------------- repository */
  /**
   * createRepository(adapter) — adapter: { get(key) → value | null, set(key, value) → boolean }. One key holds every thesis record.
   * Records are append-only: a version's snapshot is never rewritten (init refuses a different snapshot for the same saved version;
   * a re-underwrite appends a new version); checks and status changes are appended as events. Pure over the adapter — no clock.
   * The same interface is the contract of the future Supabase adapter (altaris/THESIS_PERSISTENCE.md).
   */
  function createRepository(adapter, opt) {
    opt = opt || {};
    const KEY = opt.key || 'altaris:thesis:v1';
    const load = () => { const v = adapter.get(KEY); return v && typeof v === 'object' && v.schema === 1 ? v : { schema: 1, records: {} }; };
    const save = (db) => adapter.set(KEY, db);
    const get = (dealId) => { const db = load(); return db.records[dealId] ? clone(db.records[dealId]) : null; };
    const all = () => Object.values(load().records).map((r) => clone(r));
    const latest = (rec) => (rec && rec.versions.length ? rec.versions[rec.versions.length - 1] : null);
    /** init: create the record (first version) or append a version on a re-underwrite; returns { ok, action: created | appended | unchanged | refused, record } */
    function init(dealId, snap, extras, meta) {
      meta = meta || {};
      const db = load(); let rec = db.records[dealId];
      const ver = { n: rec ? rec.versions.length + 1 : 1, snapshot: clone(snap), contract: clone(extras.contract), watch: clone(extras.watch), nbe: clone(extras.nbe), createdAt: meta.at || snap.createdAt || null, versionN: snap.versionN, basis: snap.basis, hash: snap.hash };
      if (!rec) { rec = db.records[dealId] = { schema: 1, id: dealId, dealId, monitor: 'LIVE', status: 'NOT_CHECKED', createdAt: ver.createdAt, versions: [ver], events: [{ n: 1, at: ver.createdAt, kind: 'BASELINE', version: 1, basis: snap.basis, hash: snap.hash, verdict: snap.final.verdict, market: snap.market.status, conditions: snap.conditions.length }], statusHistory: [{ at: ver.createdAt, status: 'NOT_CHECKED', reason: 'baseline' }], lastCheck: null }; return save(db) ? { ok: true, action: 'created', record: clone(rec) } : { ok: false, action: 'refused', reason: 'storage' }; }
      const last = latest(rec);
      if (last.hash === snap.hash) return { ok: true, action: 'unchanged', record: clone(rec) };
      if (last.snapshot.assumptions.dealHash === snap.assumptions.dealHash && last.snapshot.assumptions.settingsHash === snap.assumptions.settingsHash && last.versionN === snap.versionN) return { ok: false, action: 'refused', reason: 'same version, different snapshot — the original is immutable', record: clone(rec) };
      /* a new saved version: changed assumptions = RE-UNDERWRITE; the same assumptions decided again (market context loaded, a later decision stamp) = REDECIDE — both append, neither rewrites */
      const kind = last.snapshot.assumptions.dealHash !== snap.assumptions.dealHash || last.snapshot.assumptions.settingsHash !== snap.assumptions.settingsHash ? 'REUNDERWRITE' : 'REDECIDE';
      rec.versions.push(ver); rec.events.push({ n: rec.events.length + 1, at: ver.createdAt, kind, version: ver.n, basis: snap.basis, hash: snap.hash, from: last.snapshot.final.verdict, to: snap.final.verdict, verdict: snap.final.verdict, market: snap.market.status, conditions: snap.conditions.length, previousHash: last.hash });
      rec.status = 'NOT_CHECKED'; rec.lastCheck = null; rec.statusHistory.push({ at: ver.createdAt, status: 'NOT_CHECKED', reason: kind.toLowerCase() + ' v' + ver.n });
      return save(db) ? { ok: true, action: 'appended', kind, record: clone(rec) } : { ok: false, action: 'refused', reason: 'storage' };
    }
    /** recordCheck: append a CHECK event with the reassessment's summary; the record's status follows the delta (INSUFFICIENT keeps the last status) */
    function recordCheck(dealId, result, meta) {
      meta = meta || {}; const db = load(), rec = db.records[dealId]; if (!rec) return { ok: false, reason: 'no thesis' };
      const summary = { state: result.state, materiality: result.materiality, rule: result.rule, verdict: result.current ? result.current.verdict : null, market: result.current ? result.current.market : null, conditions: result.conditions ? { active: result.conditions.active.length, resolved: result.conditions.resolved.length, added: result.conditions.added.length } : null, changes: (result.changes || []).map((c) => ({ id: c.id, rule: c.rule, materiality: c.materiality, impact: c.impact, from: c.from, to: c.to })), attention: result.attention || null, snapshotHash: result.snapshotHash };
      rec.events.push(Object.assign({ n: rec.events.length + 1, at: result.checkedAt || meta.at || null, kind: 'CHECK', version: rec.versions.length }, summary, meta.basis ? { basis: meta.basis } : {}));
      rec.lastCheck = Object.assign({ checkedAt: result.checkedAt || meta.at || null, version: rec.versions.length }, clone(result));
      if (result.status && result.status !== rec.status) { rec.status = result.status; rec.statusHistory.push({ at: result.checkedAt || meta.at || null, status: result.status, reason: result.state + (result.rule ? ' · ' + result.rule : '') }); }
      return save(db) ? { ok: true, record: clone(rec) } : { ok: false, reason: 'storage' };
    }
    function setMonitor(dealId, monitor, meta) {
      meta = meta || {}; const db = load(), rec = db.records[dealId]; if (!rec || !MONITOR[monitor]) return { ok: false };
      if (rec.monitor === monitor) return { ok: true, record: clone(rec) };
      rec.monitor = monitor; rec.events.push({ n: rec.events.length + 1, at: meta.at || null, kind: monitor === 'PAUSED' ? 'PAUSE' : 'RESUME', version: rec.versions.length });
      return save(db) ? { ok: true, record: clone(rec) } : { ok: false, reason: 'storage' };
    }
    /** integrity: every stored snapshot hash recomputed (tamper evidence) */
    const integrity = (dealId) => { const rec = get(dealId); if (!rec) return null; return rec.versions.map((v) => ({ n: v.n, ok: verify(v.snapshot).ok && v.hash === v.snapshot.hash })); };
    return { key: KEY, get, all, init, recordCheck, setMonitor, integrity, latest: (dealId) => latest(get(dealId)) };
  }
  const memoryAdapter = () => { const m = new Map(); return { get: (k) => (m.has(k) ? clone(m.get(k)) : null), set: (k, v) => { m.set(k, clone(v)); return true; } }; };

  return Object.freeze({ VERSION, STATUS, DELTA, CATEGORY, MATERIALITY, IMPACT, RELEVANCE, MONITOR, BASIS, RULES, ATTENTION, COPY, RESOLVES_BY, EV_DEDUCTIONS, FACT_SIGNAL, snapshot, stampMatches, verify, hashOf, canon, dealFacts, contract, nextBestEvidence, watchlist, reassess, portfolio, createRepository, memoryAdapter, t: T });
});
