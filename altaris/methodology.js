/* ALTARIS · Metric Methodology — the calculation basis of every decision metric.
 *
 * Pure data (no DOM, no calculation). Written from the engine as implemented
 * (altaris/engine.js) — it documents, it never computes. Each entry names the
 * engine fields it describes (`engine`), so test/altaris.test.js can prove the
 * metric exists in the real engine for exactly the structures listed in `usedIn`.
 *
 * Versioned: VERSION.id is stamped on saved deals and exports. VERSION.engine
 * pins the engine revision this methodology was written against (engine VERSION
 * + sha256 of altaris/engine.js); a test fails when the engine changes until the
 * methodology is reviewed and re-stamped.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AltarisMethodology = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = Object.freeze({
    id: 'altaris-metric-methodology-v1',
    n: 1,
    label: { he: 'מתודולוגיית מדדים ALTARIS · גרסה 1', en: 'ALTARIS Metric Methodology v1' },
    effective: '2026-10-12',
    engine: { version: 1, sha256: '774f6a9889d45a3ecf1ebdae3f754203a12f42460a1b33ec557f8084a34217c9' },
  });

  const GROUPS = [
    { id: 'returns', code: 'A', he: 'מדדי תשואה', en: 'Return metrics' },
    { id: 'capital', code: 'B', he: 'הון וחשיפה', en: 'Capital & exposure' },
    { id: 'credit', code: 'C', he: 'אשראי ובטוחות', en: 'Credit & collateral' },
    { id: 'value', code: 'D', he: 'שווי והגנה', en: 'Value & protection' },
    { id: 'decision', code: 'E', he: 'כללי ההחלטה של הקרן', en: 'Fund decision rules' },
    { id: 'scenarios', code: 'F', he: 'תרחישים', en: 'Scenarios' },
  ];

  /* data basis classes — the same vocabulary PROPX uses for its figures */
  const CLASSES = {
    official: { he: 'רשמי', en: 'OFFICIAL',
      d: { he: 'פורסם על ידי גוף ממשלתי, עם מקור ותאריך שמורים (למשל ריבית בנק ישראל, מדד הלמ״ס). ALTARIS מציגה אותם לעיון ואינה מזינה אותם לחישוב.', en: 'Published by a government body, with source and date stored (e.g. the Bank of Israel rate, the CBS index). ALTARIS shows them for reference and does not feed them into a calculation.' } },
    propx: { he: 'נגזר · PROPX', en: 'PROPX-DERIVED',
      d: { he: 'נגזר על ידי PROPX מרשומות מדווחות — למשל חציון ₪/מ״ר של עסקאות מגורים. סטטיסטיקה, לא שומה.', en: 'Derived by PROPX from reported records — e.g. the median ₪/m² of residential deals. A statistic, not an appraisal.' } },
    model: { he: 'מודל', en: 'MODEL',
      d: { he: 'תוצאת חישוב של מנוע ALTARIS על הקלטים וההנחות. משתנה כשההנחות משתנות.', en: 'Computed by the ALTARIS engine from the inputs and assumptions. Changes when the assumptions change.' } },
    user: { he: 'הנחת משתמש', en: 'USER ASSUMPTION',
      d: { he: 'ערך או הנחה שהמשתמש הזין — או ברירת מחדל מסומנת שממתינה לבחינה.', en: 'A value or assumption the user entered — or a labelled default awaiting review.' } },
    override: { he: 'עקיפת משתמש', en: 'USER OVERRIDE',
      d: { he: 'ערך שהמשתמש קבע במקום ערך נגזר או במקום הערכה מבוססת — קופא ואינו מתעדכן; מחייב נימוק.', en: 'A value the user set in place of a derived value or an evidenced valuation — frozen, no longer updated; requires a reason.' } },
  };
  const STRUCTURES = { buy: 'BUY', finance: 'FINANCE', hybrid: 'HYBRID' };
  const FIELDS = {
    measures: { he: 'מה ALTARIS מודדת', en: 'What ALTARIS measures' },
    basis: { he: 'בסיס חישוב', en: 'Calculation basis' },
    formula: { he: 'נוסחה', en: 'Formula' },
    usedIn: { he: 'בשימוש ב', en: 'Used in' },
    perStructure: { he: 'לפי מבנה', en: 'By structure' },
    interpretation: { he: 'פירוש', en: 'Interpretation' },
    convention: { he: 'מוסכמה', en: 'Convention' },
    data: { he: 'בסיס הנתונים', en: 'Data basis' },
  };
  const ALL = ['buy', 'finance', 'hybrid'];

  /*
   * engine: where the metric lives in a run result —
   *   base:     keys on each structure's base result  (R.strategies[k].base[key])
   *   strategy: dotted paths on the structure object   (R.strategies[k][path])
   *   facts:    keys on R.facts
   *   run:      dotted paths on the run result          (R[path])
   *   portfolio: keys on portfolio().summary
   * exclusive: base keys that must NOT exist outside `usedIn` (proves the per-structure split).
   */
  const METRICS = [
    /* ================================================== A · returns */
    { id: 'irr', group: 'returns', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'IRR', en: 'IRR' }, title: { he: 'IRR — בסיס חישוב', en: 'IRR — Calculation Basis' },
      short: { he: 'תשואה שנתית לפי עיתוי התזרימים המתוארכים של המבנה הנבחר (XIRR), לפני מס על הרווח.', en: 'Annualized return on the timing of the dated modeled cash flows of the selected structure (XIRR), before profit tax.' },
      measures: { he: 'השיעור השנתי שמאפס את הערך הנוכחי של תזרים ALTARIS במבנה ובתרחיש.', en: 'The annual rate that sets the present value of the ALTARIS cash flows of a structure and scenario to zero.' },
      basis: { he: 'XIRR על תזרים חודשי מתוארך: חודש 0 = מועד העמדת ההון (T0); חודש m = T0 + m חודשים (היום בחודש נשמר, ומוגבל לסוף החודש). ספירת ימים בפועל ÷ 365. כל חודש נטו — תקבולים ותשלומים באותו חודש מתקזזים.', en: 'XIRR over the dated monthly series: month 0 = the funding date (T0); month m = T0 + m months (day kept, clamped to month end). Actual days ÷ 365. Each month is netted — receipts and payments in the same month offset.' },
      formula: 'Σ CFₘ ÷ (1 + IRR)^(daysₘ ÷ 365) = 0',
      perStructure: {
        buy: { he: 'רכישה ועלויות ב-T0, נשיאה חודשית (ריבית שוטפת, תפעול, שכירות נטו), יציאה ופירעון החוב.', en: 'Purchase and costs at T0, monthly carry (current interest, opex, net rent), exit and debt repayment.' },
        finance: { he: 'העמדה נטו מעמלת ההעמדה, ריבית וקרן לפי לוח הפירעון, פירעון במועד — או גבייה אחרי מימוש בטוחות.', en: 'Advance net of the arrangement fee, interest and principal per schedule, repayment at maturity — or recovery after enforcement.' },
        hybrid: { he: 'הון, עמלה, קופון שוטף, תשואה מועדפת והשתתפות במימוש; אופציה ו-backstop כתזרימים נפרדים. כשבתרחיש לא הושקע הון — תשואה על ההון המחויב.', en: 'Capital, fee, current coupon, preferred return and participation at realization; option and backstop as separate flows. When a scenario funds nothing — return on committed capital.' },
      },
      interpretation: { he: 'גבוה יותר = החזר גדול ו/או מהיר יותר ביחס להון ולזמן. נבדק מול סף ה-IRR של הקרן ומשמש בתשואה המותאמת-סיכון.', en: 'Higher = a larger and/or faster return relative to capital and time. Tested against the fund IRR hurdle and used in the risk-adjusted return.' },
      convention: { he: 'אין תקבולים כלל: ‎−100%. בתרחיש שלא הושקע בו הון (backstop שלא הופעל): (1 + רווח ÷ הון בסיכון)^(12 ÷ חודשים) − 1, מסומן "על ההון המחויב". תזרים שמחליף סימן יותר מפעם אחת יכול להחזיק יותר מפתרון מתמטי אחד; ALTARIS מדווחת את הפתרון שהמנוע מוצא בחיפוש תחום — MOIC והרווח נשארים חד-משמעיים. ב-BUY מוצג בנפרד IRR אחרי הנחות המס.', en: 'No receipts at all: −100%. A scenario that funds nothing (a backstop not called): (1 + profit ÷ capital at risk)^(12 ÷ months) − 1, labelled "on committed capital". A series that changes sign more than once can hold more than one mathematical IRR; ALTARIS reports the solution its bracketed search finds — MOIC and profit remain unambiguous. BUY shows a separate after-tax IRR.' },
      engine: { base: ['irr'] } },

    { id: 'moic', group: 'returns', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'MOIC', en: 'MOIC' }, title: { he: 'MOIC — מוסכמת הון', en: 'MOIC — Capital Convention' },
      short: { he: 'סך התקבולים ÷ סך ההון שהושקע (כל התזרימים השליליים) — לא שיא החשיפה ולא ההון המחויב.', en: 'Total distributions ÷ total capital invested (all negative flows) — not peak exposure and not committed capital.' },
      measures: { he: 'כמה פעמים חוזר ההון שהושקע, בלי קשר לזמן.', en: 'How many times the invested capital comes back, independent of time.' },
      basis: { he: 'על תזרים חודשי נטו: המונה = סכום החודשים החיוביים; המכנה = סכום החודשים השליליים. עמלה שמתקבלת ב-T0 מקטינה את ההון שהושקע באותו חודש ואינה נספרת כתקבול.', en: 'On monthly net flows: numerator = the sum of positive months; denominator = the sum of negative months. A fee received at T0 reduces the capital invested in that month rather than counting as a distribution.' },
      formula: 'MOIC = Σ max(CFₘ, 0) ÷ Σ max(−CFₘ, 0)',
      interpretation: { he: 'מעל 1.00x = רווח. אינו רגיש לעיתוי — לכן נקרא יחד עם IRR ומשך.', en: 'Above 1.00x = profit. Not time-sensitive — read together with IRR and duration.' },
      convention: { he: 'כשלא הושקע הון בתרחיש: 1 + רווח ÷ הון בסיכון, מסומן "על ההון המחויב".', en: 'When a scenario invests nothing: 1 + profit ÷ capital at risk, labelled "on committed capital".' },
      engine: { base: ['moic', 'invested', 'distributions'] } },

    { id: 'profit', group: 'returns', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'רווח', en: 'Profit' }, title: { he: 'רווח — בסיס חיתום', en: 'Profit — Underwriting Basis' },
      short: { he: 'סכום כל תזרימי ALTARIS בתרחיש, לפני מס על הרווח. ב-BUY: הגשר המלא מהשווי הנתמך, לא "שווי פחות מחיר".', en: 'The sum of all ALTARIS flows in the scenario, before profit tax. In BUY: the full bridge from supported value, not "value minus price".' },
      measures: { he: 'הרווח הכספי המוחלט של ALTARIS במבנה ובתרחיש.', en: 'The absolute money profit of ALTARIS in the structure and scenario.' },
      basis: { he: 'רווח = Σ תזרימים = תקבולים − הון מושקע.', en: 'Profit = Σ flows = distributions − capital invested.' },
      formula: 'Profit = Σ CFₘ',
      perStructure: {
        buy: { he: 'שווי נתמך − haircut ביציאה − מחיר − מס רכישה − עלויות עסקה והשבחה − מימון (ריבית ועמלות) − החזקה + שכירות נטו − עלויות מכירה ומע״מ. המנוע מוודא שהגשר שווה לסכום התזרים.', en: 'Supported value − exit haircut − price − purchase tax − transaction and improvement costs − financing (interest and fees) − holding + net rent − selling costs and VAT. The engine checks that the bridge equals the cash-flow sum.' },
        finance: { he: 'ריבית + עמלות (העמדה, פירעון, הארכה) − עלויות ALTARIS (משפטיות ומעקב) − חוסר בפירעון.', en: 'Interest + fees (arrangement, exit, extension) − ALTARIS costs (legal, monitoring) − any shortfall.' },
        hybrid: { he: 'עמלה + קופונים + תשואה מועדפת + השתתפות + תוצאת אופציה ו-backstop − עלויות − חוסר.', en: 'Fee + coupons + preferred return + participation + option and backstop result − costs − any shortfall.' },
      },
      interpretation: { he: 'הרווח לפני מס על הרווח; תמיד חד-משמעי גם כשה-IRR אינו.', en: 'Profit before profit tax; always unambiguous even when IRR is not.' },
      engine: { base: ['profit'] } },

    { id: 'roi', group: 'returns', usedIn: ALL, data: ['model'],
      name: { he: 'ROI ותשואה שנתית', en: 'ROI & annualized return' }, title: { he: 'תשואה על ההון — מוסכמה', en: 'Equity Return — Convention' },
      short: { he: 'ROI = רווח ÷ הון מושקע; שנתית = (1 + ROI)^(12 ÷ משך) − 1. פשוט ואינו רגיש לעיתוי בתוך התקופה.', en: 'ROI = profit ÷ capital invested; annualized = (1 + ROI)^(12 ÷ duration) − 1. Simple and not sensitive to timing inside the period.' },
      measures: { he: 'תשואה כוללת על ההון שהושקע, ובמונחים שנתיים לפי משך העסקה.', en: 'Total return on capital invested, and on an annual basis over the deal duration.' },
      basis: { he: 'המשך = חודש האירוע האחרון בתזרים. כשה-ROI ‎−100% — התשואה השנתית ‎−100%.', en: 'Duration = the month of the final event in the series. When ROI is −100% the annualized return is −100%.' },
      formula: 'ROI = Profit ÷ Invested · Annualized = (1 + ROI)^(12 ÷ months) − 1',
      interpretation: { he: 'שונה מ-IRR כשהתזרים מפוזר בזמן; IRR הוא המדד הקובע.', en: 'Differs from IRR when flows are spread over time; IRR is the decision metric.' },
      engine: { base: ['roi', 'annualized'] } },

    { id: 'taxes', group: 'returns', usedIn: ['buy'], data: ['user'],
      name: { he: 'הנחות מס', en: 'Tax assumptions' }, title: { he: 'מסים — הנחות חיתום', en: 'Taxes — Underwriting Assumptions' },
      short: { he: 'שיעורים שהמשתמש מזין — לא חישוב לפי החוק. התשואות המובילות לפני מס על הרווח; תוצאה אחרי מס מוצגת בנפרד (BUY).', en: 'Rates the user enters — not a computation under the law. Headline returns are before profit tax; an after-tax result is shown separately (BUY).' },
      measures: { he: 'השפעת הנחות המס שהוזנו על תוצאת BUY.', en: 'The effect of the entered tax assumptions on the BUY result.' },
      basis: { he: 'מס רכישה = % × מחיר, ב-T0 (חלק מהבסיס). מע״מ במכירה: החלק המועבר = מחיר × שיעור ÷ (100 + שיעור), מנוכה כעלות יציאה. מס על הרווח = max(0, רווח) × שיעור + מס אחר, בחודש היציאה — "רווח אחרי מס" ו-IRR אחרי מס.', en: 'Purchase tax = % × price, at T0 (part of the basis). VAT on sale: the remitted share = price × rate ÷ (100 + rate), deducted as an exit cost. Profit tax = max(0, profit) × rate + other tax, in the exit month — "profit after tax" and an after-tax IRR.' },
      convention: { he: 'לצורך ניתוח השקעה בלבד; יש לאשר מול המבנה המשפטי הסופי. FINANCE ו-HYBRID אינם כוללים הנחות מס — תוצאותיהם לפני מס.', en: 'For investment analysis only; to be confirmed for the final legal structure. FINANCE and HYBRID carry no tax inputs — their results are pre-tax.' },
      interpretation: { he: 'מס רכישה ומע״מ מקטינים את הרווח לפני מס ואת ה-IRR המוביל; מס על הרווח משפיע רק על השורות "אחרי מס". השוואה בין מבנים נעשית לפני מס על הרווח.', en: 'Purchase tax and VAT reduce pre-tax profit and the headline IRR; profit tax affects only the "after tax" lines. Structures are compared before profit tax.' },
      engine: { base: ['tax', 'vat', 'afterTax'], exclusive: true } },

    /* ================================================== B · capital & exposure */
    { id: 'capitalAtRisk', group: 'capital', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'הון בסיכון', en: 'Capital at Risk' }, title: { he: 'הון בסיכון — הגדרת חשיפה', en: 'Capital at Risk — Exposure Definition' },
      short: { he: 'ההון ש-ALTARIS מסכנת: שיא הפריסה המצטברת; ב-HYBRID — הגבוה מבין השיא, ההתחייבות, וההון + backstop + מחיר האופציה.', en: 'The capital ALTARIS puts at risk: peak cumulative deployment; in HYBRID — the largest of the peak, the commitment, and capital + backstop + option price.' },
      measures: { he: 'החשיפה המקסימלית של ALTARIS לעסקה. משמשת כ"הון נדרש", לחשיפה ליזם/פרויקט/יישוב, לפורטפוליו ולמהירות ההון.', en: 'The maximum ALTARIS exposure to the deal. Used as "capital required", for developer / project / locality exposure, in the portfolio and for capital velocity.' },
      basis: { he: 'שיא הפריסה = ‎−min של הסכום המצטבר של התזרים החודשי בתרחיש הבסיס.', en: 'Peak deployment = −min of the cumulative monthly cash flow in the base scenario.' },
      formula: 'BUY, FINANCE: peak = −min(Σ CF) · HYBRID: max(commitment, capital + backstop + option, peak)',
      perStructure: {
        buy: { he: 'שיא הפריסה: מחיר + מס רכישה + עלויות + עמלת חוב − חוב, ועוד הנשיאה החודשית (ריבית שוטפת, תפעול פחות שכירות) ופירעון החוב מההון אם ההלוואה מסתיימת לפני היציאה.', en: 'Peak deployment: price + purchase tax + costs + debt fee − debt, plus monthly carry (current interest, opex less rent) and debt repaid from equity if the loan ends before the exit.' },
        finance: { he: 'שיא הפריסה: ההלוואה פחות עמלת ההעמדה ועוד העלויות המשפטיות ב-T0, ועוד עלויות מעקב חודשיות שאינן מכוסות בריבית.', en: 'Peak deployment: the loan less the arrangement fee plus legal costs at T0, plus monthly monitoring costs not covered by interest.' },
        hybrid: { he: 'max(התחייבות, הון + מחיר backstop (אם פעיל) + מחיר אופציה (אם פעילה), שיא הפריסה בפועל). התחייבות = max(הון, התחייבות מקסימלית); ברירת המחדל של ההתחייבות המקסימלית = הון + מחיר backstop.', en: 'max(commitment, capital + backstop price (if on) + option price (if on), actual peak deployment). Commitment = max(capital, maximum commitment); the default maximum commitment = capital + backstop price.' },
      },
      interpretation: { he: 'גבוה יותר = יותר הון חשוף לעסקה; משנה את מהירות ההון ואת ניצול תקרות החשיפה.', en: 'Higher = more capital exposed to the deal; changes capital velocity and the use of exposure limits.' },
      convention: { he: 'מבנה ללא הון מושקע בתרחיש (fee-only, backstop שלא הופעל): ההון בסיכון = ההתחייבות, ו-IRR / MOIC מחושבים עליו. האופציה נכללת אף שהפעלתה בשיקול דעת ALTARIS.', en: 'A structure that invests nothing in a scenario (fee-only, a backstop not called): capital at risk = the commitment, and IRR / MOIC are computed on it. The option is included although exercising it is at ALTARIS’ discretion.' },
      engine: { base: ['atRisk', 'peakCapital'] } },

    { id: 'peakCapital', group: 'capital', usedIn: ALL, data: ['model'],
      name: { he: 'שיא פריסת הון', en: 'Peak deployed capital' }, title: { he: 'שיא פריסה — הגדרה', en: 'Peak Deployment — Definition' },
      short: { he: 'שיא היתרה השלילית המצטברת של התזרים — ההון שהיה בחוץ בפועל בנקודת השיא.', en: 'The deepest cumulative negative balance of the flows — the capital actually out at the peak.' },
      measures: { he: 'ההון שנפרס בפועל בתרחיש, בנקודה העמוקה ביותר.', en: 'Capital actually deployed in the scenario, at its deepest point.' },
      basis: { he: 'מחושב מאותו תזרים חודשי נטו. ב-BUY ו-FINANCE זהו ההון בסיכון; ב-HYBRID ההון בסיכון יכול להיות גבוה ממנו (התחייבות, backstop, אופציה).', en: 'Computed from the same monthly net series. In BUY and FINANCE it is the capital at risk; in HYBRID capital at risk can exceed it (commitment, backstop, option).' },
      formula: 'peak = −min_t Σ_{m≤t} CFₘ',
      interpretation: { he: 'גבוה יותר = יותר הון מזומן יוצא בפועל בנקודה העמוקה. ההפרש מההון בסיכון ב-HYBRID הוא הון מחויב שלא נפרס.', en: 'Higher = more cash actually out at the deepest point. In HYBRID, the gap to capital at risk is committed capital that was not deployed.' },
      engine: { base: ['peakCapital'] } },

    { id: 'invested', group: 'capital', usedIn: ALL, data: ['model'],
      name: { he: 'הון מושקע', en: 'Capital invested' }, title: { he: 'הון מושקע (פריסה מצטברת) — הגדרה', en: 'Capital Invested (Cumulative Deployment) — Definition' },
      short: { he: 'סך כל התזרימים השליליים לאורך חיי העסקה — המכנה של MOIC ו-ROI. ב-BUY: "הון עצמי מושקע".', en: 'The sum of all negative flows over the life of the deal — the denominator of MOIC and ROI. In BUY: "equity invested".' },
      measures: { he: 'כל ההון שיצא מ-ALTARIS, כולל נשיאה חודשית, לא רק ב-T0.', en: 'All capital paid out by ALTARIS, including monthly carry, not only at T0.' },
      basis: { he: 'Σ max(‎−CFₘ, 0). גבוה או שווה לשיא הפריסה, כי תקבולי ביניים אינם מקטינים אותו.', en: 'Σ max(−CFₘ, 0). At least the peak deployment, because interim receipts do not reduce it.' },
      formula: 'Invested = Σ max(−CFₘ, 0)',
      interpretation: { he: 'המכנה של MOIC ו-ROI. כשהוא גבוה משיא הפריסה — חלק מההון הושקע אחרי שתקבולים כבר חזרו (למשל נשיאה חודשית).', en: 'The denominator of MOIC and ROI. When it exceeds peak deployment, part of the capital went in after receipts had already come back (e.g. monthly carry).' },
      engine: { base: ['invested'] } },

    { id: 'committed', group: 'capital', usedIn: ['hybrid'], data: ['user'],
      name: { he: 'הון מחויב', en: 'Committed capital' }, title: { he: 'הון מחויב — HYBRID', en: 'Committed Capital — HYBRID' },
      short: { he: 'max(הון מושקע, התחייבות מקסימלית) — בסיס עמלת ההסדר ורכיב בהון בסיכון.', en: 'max(capital funded, maximum commitment) — the arrangement-fee base and a component of capital at risk.' },
      measures: { he: 'ההון ש-ALTARIS מתחייבת להעמיד, גם אם לא נפרס.', en: 'Capital ALTARIS commits to provide, even if not deployed.' },
      basis: { he: 'עמלת הסדר = % × התחייבות, מתקבלת ב-T0. ברירת המחדל של ההתחייבות המקסימלית כוללת את מחיר ה-backstop.', en: 'Arrangement fee = % × commitment, received at T0. The default maximum commitment includes the backstop price.' },
      interpretation: { he: 'התחייבות גבוהה מההון המושקע מגדילה את ההון בסיכון ואת בסיס העמלה, גם אם לא תיפרס בפועל.', en: 'A commitment above the capital funded raises capital at risk and the fee base, even if it is never deployed.' },
      engine: { base: ['commitment'], exclusive: true } },

    { id: 'contingent', group: 'capital', usedIn: ['hybrid'], data: ['user', 'model'],
      name: { he: 'חשיפת backstop ואופציה', en: 'Backstop & option exposure' }, title: { he: 'Backstop ואופציה — חשיפה מותנית', en: 'Backstop & Option — Contingent Exposure' },
      short: { he: 'Backstop: התחייבות לרכוש מלאי שלא נמכר; אופציה: זכות לרכוש מלאי במחיר קבוע. שתיהן נספרות בהון בסיכון במלואן.', en: 'Backstop: an obligation to buy unsold inventory; option: a right to buy inventory at a fixed price. Both count in full in capital at risk.' },
      measures: { he: 'ההון שיידרש אם ההתחייבות תופעל או האופציה תמומש, ותוצאת המכירה החוזרת.', en: 'Capital required if the backstop is called or the option exercised, and the resale result.' },
      basis: { he: 'אופציה: ממומשת במועד המימוש רק אם שווי החלק × (1 − haircut מכירה חוזרת) × (1 − עלויות) > מחיר האופציה; התמורה מתקבלת אחרי זמן המכירה החוזרת. Backstop: ALTARIS רוכשת u × מחיר ה-backstop × החלק שלא נרכש באופציה, ומוכרת ב-u × שווי × אותו חלק × (1 − haircut) × (1 − עלויות). u = מלאי לא מכור: בבסיס מההנחות, בתרחיש השלילי 50% כברירת מחדל.', en: 'Option: exercised at realization only if the share value × (1 − resale haircut) × (1 − costs) > the option price; proceeds arrive after the resale period. Backstop: ALTARIS buys u × backstop price × the share not bought through the option, and resells at u × value × that share × (1 − haircut) × (1 − costs). u = unsold share: from the assumptions in the base, 50% by default in the downside.' },
      convention: { he: 'מלאי שנרכש באופציה אינו מגובה ב-backstop פעם שנייה. Backstop מוריד 10 נקודות ברכיב ההגנה של ציון הסיכון; אופציה מוסיפה 5.', en: 'Inventory bought through the option is not backstopped a second time. A backstop takes 10 points off the protection component of the risk score; an option adds 5.' },
      interpretation: { he: 'החשיפה המותנית נספרת במלואה בהון בסיכון. בתרחיש השלילי ה-backstop מופעל על חלק המלאי הלא מכור, והתוצאה תלויה בשווי המכירה החוזרת.', en: 'Contingent exposure counts in full in capital at risk. In the downside the backstop is called on the unsold share, and the result depends on the resale value.' },
      engine: { base: ['backstopPaid', 'optionPaid', 'optionExercised', 'maxAtRisk'], exclusive: true } },

    { id: 'debt', group: 'capital', usedIn: ['buy'], data: ['user'],
      name: { he: 'חוב רכישה ויתרת חוב', en: 'Acquisition & residual debt' }, title: { he: 'חוב רכישה — מוסכמת מימון', en: 'Acquisition Debt — Financing Convention' },
      short: { he: 'חוב = LTV × מחיר או סכום קבוע, מוגבל למחיר; היתרה (קרן + ריבית נצברת) נפרעת מתמורת היציאה.', en: 'Debt = LTV × price or a fixed amount, capped at the price; the balance (principal + accrued interest) is repaid from the exit proceeds.' },
      measures: { he: 'המינוף של BUY ועלות המימון שלו.', en: 'The leverage of BUY and its financing cost.' },
      basis: { he: 'עמלת חוב = % × חוב ב-T0. ריבית חודשית על היתרה: שוטפת (משולמת מההון) או נצברת (מתווספת ליתרה). אם תקופת ההלוואה קצרה מההחזקה, היתרה נפרעת מההון בתום התקופה ומסומנת כסיכון. עלות מימון = ריבית + עמלות.', en: 'Debt fee = % × debt at T0. Monthly interest on the balance: current (paid from equity) or accrued (added to the balance). If the loan term is shorter than the hold, the balance is repaid from equity at term and flagged as a risk. Financing cost = interest + fees.' },
      convention: { he: 'סכום חוב שהוזן מעל המחיר מוגבל למחיר ומסומן. מבחן "עלות חוב +1/+2 נ״א" משנה רק חוב זה.', en: 'A debt amount entered above the price is capped at the price and flagged. The "debt cost +1/+2 pp" stress changes only this debt.' },
      interpretation: { he: 'חוב גבוה יותר מקטין את ההון העצמי ובדרך כלל מגדיל את ה-IRR, אך מקטין את מרווח הביטחון ומוסיף רגישות לריבית ולמועד היציאה.', en: 'More debt reduces equity and usually raises IRR, but narrows the margin of safety and adds sensitivity to the rate and the exit date.' },
      engine: { base: ['debt', 'debtRepaid', 'financing', 'loanMaturesBeforeExit', 'debtCapped'], exclusive: true } },

    { id: 'velocity', group: 'capital', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'מהירות הון', en: 'Capital velocity' }, title: { he: 'מהירות הון — מוסכמת מחזור', en: 'Capital Velocity — Recycling Convention' },
      short: { he: 'מחזורים בשנה = 12 ÷ משך; סבבים בחיי הקרן = ⌊(חיי קרן + השהיה) ÷ (משך + השהיה)⌋. המחשה — לא תחזית.', en: 'Turns per year = 12 ÷ duration; cycles over the fund life = ⌊(fund life + lag) ÷ (duration + lag)⌋. Illustrative — not a forecast.' },
      measures: { he: 'כמה פעמים אותו הון יכול לעבוד בחיי הקרן.', en: 'How many times the same capital can work over the fund life.' },
      basis: { he: 'הון = ההון בסיכון. AUM מוחזק = ההון. הון מצטבר שהושקע (קרן בלבד) = הון × סבבים; כולל רווחים = Σ הון × MOIC^(n−1). חיי הקרן וההשהיה מהגדרות הקרן.', en: 'Capital = capital at risk. AUM held = that capital. Cumulative capital deployed (principal only) = capital × cycles; with profits = Σ capital × MOIC^(n−1). Fund life and lag from the fund settings.' },
      convention: { he: 'בהנחה של עסקאות חוזרות באותם תנאים.', en: 'Assumes repeat deals on the same terms.' },
      interpretation: { he: 'עסקה קצרה מחזירה את ההון מוקדם ומאפשרת יותר סבבים באותו AUM — ALTARIS ממחזרת הון ואינה מחזיקה נכסים 5–10 שנים.', en: 'A shorter deal returns capital earlier and allows more cycles on the same AUM — ALTARIS recycles capital rather than holding assets for 5–10 years.' },
      engine: { strategy: ['velocity.turnsPerYear', 'velocity.cycles', 'velocity.cumulativeFlat'] } },

    { id: 'exitDependency', group: 'capital', usedIn: ALL, data: ['model'],
      name: { he: 'תלות ביציאה ונזילות', en: 'Exit dependency & liquidity' }, title: { he: 'תלות ביציאה — הגדרה', en: 'Exit Dependency — Definition' },
      short: { he: 'שיעור התקבולים שמגיעים באירוע הנזילות האחרון: גבוהה ≥ 85%, בינונית ≥ 60%. נזילות לפי משך: עד 12 ח׳ גבוהה, עד 24 בינונית.', en: 'The share of distributions arriving at the final liquidity event: high ≥ 85%, medium ≥ 60%. Liquidity by duration: up to 12 months high, up to 24 medium.' },
      measures: { he: 'כמה מהתשואה תלויה באירוע יציאה אחד.', en: 'How much of the return depends on a single exit event.' },
      basis: { he: 'תזרים החודש האחרון ÷ סך התקבולים, בתרחיש הבסיס.', en: 'Final-month flow ÷ total distributions, in the base scenario.' },
      interpretation: { he: 'תלות גבוהה = רוב התשואה תלויה באירוע יציאה אחד; תקבולים שוטפים (ריבית, קופון, שכירות) מקטינים אותה.', en: 'High dependency = most of the return rests on one exit event; running receipts (interest, coupon, rent) lower it.' },
      engine: { base: ['finalShare', 'months'] } },

    /* ================================================== C · credit & collateral */
    { id: 'ltv', group: 'credit', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'LTV', en: 'LTV' }, title: { he: 'LTV — נקודת כניסה', en: 'LTV — Attachment Point' },
      short: { he: 'FINANCE: (שעבודים קודמים + הלוואה) ÷ שווי בטוחות. HYBRID: כולל backstop. BUY: חוב ÷ מחיר.', en: 'FINANCE: (prior liens + loan) ÷ collateral value. HYBRID: including the backstop. BUY: debt ÷ price.' },
      measures: { he: 'עד היכן בערימת ההון נמצא ALTARIS ביחס לשווי.', en: 'Where ALTARIS sits in the capital stack relative to value.' },
      basis: { he: 'על השווי הנתמך של הבטוחות — לא על השווי השמרני.', en: 'On the supported collateral value — not on the conservative value.' },
      perStructure: {
        buy: { he: 'חוב רכישה ÷ מחיר רכישה (מינוף של ALTARIS כבעלים).', en: 'Acquisition debt ÷ purchase price (ALTARIS’ leverage as owner).' },
        finance: { he: '(שעבודים קודמים + הלוואה) ÷ שווי בטוחות. LTC = אותו מונה ÷ עלות הפרויקט — רק כשהוזנה.', en: '(prior liens + loan) ÷ collateral value. LTC = the same numerator ÷ project cost — only when entered.' },
        hybrid: { he: '(שעבודים קודמים + הון + מחיר backstop אם פעיל) ÷ שווי בטוחות.', en: '(prior liens + capital + backstop price if on) ÷ collateral value.' },
      },
      interpretation: { he: 'נמוך יותר = יותר שווי מתחת לחשיפה. נבדק מול LTV מקסימלי (FINANCE, HYBRID) ונכנס לרכיב "בסיס כניסה".', en: 'Lower = more value beneath the exposure. Tested against the maximum LTV (FINANCE, HYBRID) and feeds the "entry basis" component.' },
      engine: { base: ['ltv'] } },

    { id: 'coverage', group: 'credit', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'כיסוי בטוחות', en: 'Collateral coverage' }, title: { he: 'כיסוי בטוחות — בסיס שמרני', en: 'Collateral Coverage — Conservative Basis' },
      short: { he: '(שווי בטוחות × (1 − מקדם ביטחון) − שעבודים קודמים) ÷ חשיפת ALTARIS. אין DSCR — הכיסוי מבוסס בטוחות.', en: '(collateral value × (1 − haircut) − prior liens) ÷ ALTARIS exposure. No DSCR — coverage is collateral-based.' },
      measures: { he: 'כמה פעמים השווי השמרני הפנוי מכסה את חשיפת ALTARIS.', en: 'How many times the available conservative value covers the ALTARIS exposure.' },
      formula: 'Coverage = (V × (1 − h) − prior) ÷ exposure',
      perStructure: {
        buy: { he: 'אין כיסוי בטוחות — ALTARIS בעלים בנכס. במקומו: שווי ÷ בסיס כולל = שווי נתמך ÷ (מחיר + מס + עלויות + מימון + החזקה − שכירות).', en: 'No collateral coverage — ALTARIS owns the asset. Instead: value to basis = supported value ÷ (price + tax + costs + financing + holding − rent).' },
        finance: { he: 'חשיפה = קרן + ריבית שהוונה + עמלת פירעון; בכשל — התביעה במועד הכשל. כיסוי ברוטו = שווי ÷ (קודמים + חשיפה).', en: 'Exposure = principal + capitalised interest + exit fee; on default — the claim at default. Gross coverage = value ÷ (prior + exposure).' },
        hybrid: { he: 'חשיפה = הון × (1 + תשואה מועדפת ÷ 12)^תקופה + מחיר backstop אם פעיל.', en: 'Exposure = capital × (1 + preferred return ÷ 12)^term + backstop price if on.' },
      },
      interpretation: { he: 'מעל 1.00x = השווי השמרני מכסה את החשיפה. נבדק מול כיסוי מינימלי (FINANCE, HYBRID).', en: 'Above 1.00x = conservative value covers the exposure. Tested against the minimum coverage (FINANCE, HYBRID).' },
      convention: { he: 'ALTARIS אינה מחשבת DSCR: אין הנחת תזרים תפעולי ללווה.', en: 'ALTARIS does not compute DSCR: there is no borrower operating cash-flow assumption.' },
      basis: { he: 'שווי שמרני = שווי בטוחות × (1 − מקדם ביטחון); השווי הפנוי ל-ALTARIS = שווי שמרני − שעבודים קודמים; כיסוי = הפנוי ÷ החשיפה. מחושב על שווי הבטוחות בתרחיש הבסיס.', en: 'Conservative value = collateral value × (1 − haircut); value available to ALTARIS = conservative value − prior liens; coverage = available ÷ exposure. Computed on the base-scenario collateral value.' },
      engine: { base: ['coverage'], exclusive: true, alt: { buy: ['valueToBasis'] } } },

    { id: 'breakEven', group: 'credit', usedIn: ALL, data: ['model'],
      name: { he: 'נקודת איזון', en: 'Break-even' }, title: { he: 'נקודת איזון — לפי מבנה', en: 'Break-even — By Structure' },
      short: { he: 'השווי שבו ALTARIS מגיעה לאפס: BUY — מחיר מכירה; FINANCE — שווי בטוחות להחזר הקרן; HYBRID — שווי מימוש.', en: 'The value at which ALTARIS reaches zero: BUY — sale price; FINANCE — collateral value returning principal; HYBRID — realization value.' },
      measures: { he: 'הנקודה שמתחתיה מתחיל הפסד או פגיעה בקרן.', en: 'The point below which a loss or principal impairment begins.' },
      perStructure: {
        buy: { he: 'מחיר יציאה שבו הרווח לפני מס = 0: יציאה − רווח ÷ (1 − תיווך% − משפטיות% − חלק המע״מ). ₪/מ״ר = ÷ שטח כולל.', en: 'Exit price at which pre-tax profit = 0: exit − profit ÷ (1 − brokerage% − legal% − VAT share). Per m² = ÷ total area.' },
        finance: { he: '(שעבודים קודמים + קרן) ÷ ((1 − מקדם ביטחון) × (1 − עלויות מימוש)); וגם לתביעה מלאה.', en: '(prior liens + principal) ÷ ((1 − haircut) × (1 − enforcement costs)); also for the full claim.' },
        hybrid: { he: 'חיפוש בינארי על שווי המימוש: רווח = 0; ושווי פגיעה בקרן = השווי הנמוך ביותר שבו הקרן מוחזרת במלואה (עם backstop — לפי המלאי הלא מכור של התרחיש השלילי).', en: 'Binary search on realization value: profit = 0; and the impairment value = the lowest value at which principal is fully returned (with a backstop — at the downside unsold share).' },
      },
      basis: { he: 'נפתר כשכל שאר ההנחות קבועות: ב-BUY מהקשר הלינארי בין הרווח למחיר המכירה; ב-FINANCE בנוסחה סגורה; ב-HYBRID בחיפוש בינארי על שווי המימוש.', en: 'Solved with every other assumption held: in BUY from the linear relation between profit and sale price; in FINANCE in closed form; in HYBRID by binary search on realization value.' },
      interpretation: { he: 'ככל שנקודת האיזון רחוקה יותר מתחת לשווי הצפוי — ההגנה גדולה יותר. נקרא יחד עם מרווח הביטחון.', en: 'The further break-even sits below the expected value, the greater the protection. Read together with the margin of safety.' },
      engine: { base: [], alt: { buy: ['breakEvenExit', 'breakEvenPsm'], finance: ['breakEvenCollateral', 'breakEvenCollateralFull'] }, strategy: { hybrid: ['breakEven.breakEvenValue', 'breakEven.impairmentValue'] } } },

    { id: 'wal', group: 'credit', usedIn: ALL, data: ['model'],
      name: { he: 'משך ו-WAL', en: 'Duration & WAL' }, title: { he: 'משך — מוסכמת זמן', en: 'Duration — Timing Convention' },
      short: { he: 'משך = חודש האירוע האחרון בתזרים (יציאה, פירעון, גבייה או מכירה חוזרת). WAL (FINANCE) = ממוצע משוקלל של מועדי החזר הקרן.', en: 'Duration = the month of the final event in the series (exit, repayment, recovery or resale). WAL (FINANCE) = principal-weighted average repayment month.' },
      measures: { he: 'כמה זמן ההון עובד בעסקה.', en: 'How long capital works in the deal.' },
      basis: { he: 'מועד ההחזר = T0 + משך. WAL = Σ(קרן שהוחזרה × חודש) ÷ קרן.', en: 'Return date = T0 + duration. WAL = Σ(principal repaid × month) ÷ principal.' },
      interpretation: { he: 'נבדק מול משך מקסימלי ומזין את רכיב "משך" בציון הסיכון ואת מהירות ההון.', en: 'Tested against the maximum duration and feeds the "duration" risk component and capital velocity.' },
      engine: { base: ['months', 'exitDate'], alt: { finance: ['wal'] } } },

    { id: 'recovery', group: 'credit', usedIn: ['finance', 'hybrid'], data: ['model', 'user'],
      name: { he: 'מפל פירעון וגבייה', en: 'Repayment waterfall & recovery' }, title: { he: 'גבייה — מפל ומימוש בטוחות', en: 'Recovery — Waterfall & Enforcement' },
      short: { he: 'ללא כשל: הלווה פורע במלואו כשתמורת המימוש מכסה את התביעה. בכשל: גבייה = min(תביעה, שווי × (1 − haircut) × (1 − עלויות מימוש) − קודמים), אחרי תקופת המימוש.', en: 'No default: the borrower repays in full when realization proceeds cover the claim. On default: recovery = min(claim, value × (1 − haircut) × (1 − enforcement costs) − prior), after the enforcement period.' },
      measures: { he: 'מה ALTARIS מקבלת כשהיציאה הצפויה אינה מתרחשת.', en: 'What ALTARIS receives when the expected exit does not happen.' },
      basis: { he: 'מסלול רגיל: תמורה = שווי בתרחיש × (1 − עלויות מימוש של הלווה) − שעבודים קודמים; ALTARIS מקבלת min(תביעה, תמורה). מסלול כשל (תרחיש עם "כשל"): התשלומים נעצרים בחודש הכשל (ברירת מחדל: מועד הפירעון), התביעה צוברת ריבית חוזית חודשית לאורך תקופת המימוש, והגבייה מתקבלת בסופה.', en: 'Performing path: proceeds = scenario value × (1 − borrower realization costs) − prior liens; ALTARIS receives min(claim, proceeds). Default path (a scenario with "default"): payments stop in the default month (default: maturity), the claim accrues contractual interest monthly through enforcement, and recovery arrives at its end.' },
      perStructure: {
        finance: { he: 'תביעה = קרן + ריבית שלא שולמה + עמלת פירעון; פגיעה בקרן = max(0, קרן פתוחה − גבייה).', en: 'Claim = principal + unpaid interest + exit fee; principal loss = max(0, outstanding principal − recovery).' },
        hybrid: { he: 'סדר המפל: תשואה מועדפת צבורה, קרן, ואז השתתפות מהיתרה. בכשל התביעה צוברת קופון + תשואה מועדפת, וההשתתפות אפס. מבנה ללא הון מושקע (למשל backstop בלבד) אינו מחזיק תביעה ואין לו מסלול כשל — התרחיש השלילי פועל דרך הפעלת ה-backstop.', en: 'Waterfall order: accrued preferred return, principal, then participation from the remainder. On default the claim accrues coupon + preferred return, and participation is zero. A structure with no capital funded (e.g. a backstop alone) has no claim and no default path — its downside works through the backstop call.' },
      },
      interpretation: { he: 'שיעור גבייה קרוב ל-100% = הבטוחה מכסה את התביעה גם בכשל; פגיעה בקרן מופיעה רק כשהתמורה נמוכה מהקרן הפתוחה.', en: 'A recovery rate near 100% = the collateral covers the claim even on default; principal loss appears only when proceeds fall below the outstanding principal.' },
      engine: { strategy: ['recoveryCase.recovery.recovered', 'recoveryCase.recovery.rate'] } },

    { id: 'extension', group: 'credit', usedIn: ['finance'], data: ['user'],
      name: { he: 'הארכה וריבית הארכה', en: 'Extension & extension rate' }, title: { he: 'הארכה — מוסכמה', en: 'Extension — Convention' },
      short: { he: 'עיכוב בפירעון מעבר לתקופה נצבר בריבית ההארכה; עמלת הארכה בחודש שאחרי התקופה כשקיימת אופציית הארכה.', en: 'A repayment delay beyond the term accrues at the extension rate; an extension fee in the month after the term when an extension option exists.' },
      measures: { he: 'תשואת ההלוואה כשההחזר מתעכב בתקופת ההארכה.', en: 'The loan return when repayment slips into the extension.' },
      basis: { he: '"תרחיש הארכה" = הבסיס עם עיכוב בגובה תקופת ההארכה.', en: '"Extension case" = the base with a delay equal to the extension period.' },
      convention: { he: 'ריבית הארכה 0% מוחלת כ-0%. עיכוב מעבר לתקופת ההארכה ממשיך בריבית ההארכה ומסומן.', en: 'An extension rate of 0% is applied as 0%. A delay beyond the extension period continues at the extension rate and is flagged.' },
      interpretation: { he: 'מראה כמה תשואה נשמרת כשהפירעון מתעכב: הארכה מאריכה את המשך ולכן משנה את ה-IRR גם כשהרווח בשקלים עולה.', en: 'Shows how much return holds when repayment slips: an extension lengthens the duration, so IRR changes even when profit in shekels rises.' },
      engine: { strategy: ['extension.irr'], base: ['extFee'] } },

    { id: 'equityCushion', group: 'credit', usedIn: ['finance', 'hybrid'], data: ['model', 'user'],
      name: { he: 'כרית הון', en: 'Equity cushion' }, title: { he: 'כרית הון — הגדרה', en: 'Equity Cushion — Definition' },
      short: { he: 'שווי בטוחות − שעבודים קודמים − חשיפת ALTARIS; ובשווי השמרני אחרי מקדם הביטחון.', en: 'Collateral value − prior liens − ALTARIS exposure; and on the conservative value after the haircut.' },
      measures: { he: 'הערך של היזם שעומד מתחת לחשיפת ALTARIS.', en: 'The developer value standing beneath the ALTARIS exposure.' },
      basis: { he: 'כרית = שווי בטוחות − שעבודים קודמים − חשיפת ALTARIS; כרית שמרנית (FINANCE) = שווי × (1 − מקדם ביטחון) − שעבודים קודמים − חשיפה. החשיפה כמו בכיסוי הבטוחות.', en: 'Cushion = collateral value − prior liens − ALTARIS exposure; conservative cushion (FINANCE) = value × (1 − haircut) − prior liens − exposure. Exposure as in collateral coverage.' },
      interpretation: { he: 'כרית חיובית = הלווה מפסיד ראשון; כרית שלילית = החשיפה של ALTARIS גבוהה מהשווי הפנוי לאחר שעבודים קודמים.', en: 'A positive cushion = the borrower loses first; a negative cushion = the ALTARIS exposure exceeds the value left after prior liens.' },
      engine: { base: ['equityCushion'] } },

    /* ================================================== D · value & protection */
    { id: 'supportedValue', group: 'value', usedIn: ALL, data: ['propx', 'user', 'override'],
      name: { he: 'שווי נתמך', en: 'Supported value' }, title: { he: 'שווי נתמך — שווי החיתום', en: 'Supported Value — Underwriting Value' },
      short: { he: 'השווי שנבחר במפורש לצורך חיתום — אינו אוטומטית מחיר מבוקש, שווי שוק, שומה, שווי PROPX או שווי יציאה.', en: 'The value explicitly chosen for underwriting — not automatically the asking price, market value, appraisal, PROPX value or exit value.' },
      measures: { he: 'הבסיס שממנו נמדדים הנחה, יציאה, בטוחות ומרווח ביטחון.', en: 'The basis from which discount, exit, collateral and margin of safety are measured.' },
      basis: { he: 'מקורות: שווי PROPX (חציון ₪/מ״ר של עסקאות מגורים מדווחות × השטח הכולל הנוכחי), שומה, מחיר מחירון של היזם, עסקאות השוואה, ₪/מ״ר × שטח, סכום שורות היחידה, הערכה ידנית. אין ברירת מחדל: בלי בחירה אין חישוב. מחיר היזם לעולם אינו נבחר אוטומטית ומסומן כסיכון כשנבחר.', en: 'Sources: PROPX value (median ₪/m² of reported residential deals × current total area), appraisal, developer list price, comparable deals, ₪/m² × area, the sum of unit rows, manual valuation. No default: without a choice nothing is computed. The developer price is never chosen automatically and is flagged as a risk when chosen.' },
      interpretation: { he: 'משמש כנקודת המוצא לשווי היציאה ב-BUY ולשווי הבטוחות והמימוש כברירת מחדל ב-FINANCE וב-HYBRID.', en: 'The starting point for the BUY exit value and the default collateral and realization values in FINANCE and HYBRID.' },
      convention: { he: 'ערך PROPX שלא נערך מתעדכן עם השטח; ערך שנערך ידנית הופך לעקיפת משתמש וקופא. פער בין מקורות בלתי תלויים = (מקסימום − מינימום) ÷ מינימום (ללא מחיר היזם). עסקאות PROPX הן רשומות רשות המסים כפי שפורסמו מחדש על ידי גרסאות לעם — פרסום עצמאי, לא ערוץ ממשלתי.', en: 'An unedited PROPX value follows the area; a manually edited value becomes a user override and is frozen. Spread between independent sources = (max − min) ÷ min (developer price excluded). PROPX deals are Tax Authority records as republished by over.org.il (גרסאות לעם) — an independent publication, not a government channel.' },
      engine: { facts: ['smv', 'chosen', 'sources', 'spread'] } },

    { id: 'entryDiscount', group: 'value', usedIn: ALL, data: ['user', 'model'],
      name: { he: 'הנחת כניסה', en: 'Entry discount' }, title: { he: 'הנחת כניסה — הגדרה', en: 'Entry Discount — Definition' },
      short: { he: '(שווי נתמך − בסיס) ÷ שווי נתמך. בסיס = המחיר המוצע הכולל או סכום המחירים בשורות היחידה.', en: '(supported value − basis) ÷ supported value. Basis = the total proposed price or the sum of unit-row prices.' },
      measures: { he: 'כמה מתחת לשווי הנתמך נכנס ההון.', en: 'How far below supported value capital enters.' },
      perStructure: { buy: { he: 'סף "הנחת כניסה מינימלית" נבדק על מחיר ה-BUY בפועל: 1 − מחיר BUY ÷ שווי נתמך.', en: 'The "minimum entry discount" hurdle is tested on the actual BUY price: 1 − BUY price ÷ supported value.' } },
      basis: { he: 'בסיס = המחיר הכולל שהוזן, ואם לא הוזן — סכום המחיר המוצע בשורות היחידות (רק כשלכל שורה יש מחיר). הפרש בשקלים = שווי נתמך − בסיס.', en: 'Basis = the total price entered; if none — the sum of proposed prices in the unit rows (only when every row has one). Difference in shekels = supported value − basis.' },
      interpretation: { he: 'הנחה גבוהה יותר = כניסה עמוקה יותר מתחת לשווי הנתמך. ההנחה תלויה בשווי שנבחר — לכן מקור השווי מוצג לצדה.', en: 'A larger discount = entry deeper below supported value. The discount depends on the value chosen — so the value source is shown beside it.' },
      engine: { facts: ['discount', 'basis', 'diff'] } },

    { id: 'exitValue', group: 'value', usedIn: ['buy'], data: ['model', 'user'],
      name: { he: 'שווי יציאה', en: 'Exit value' }, title: { he: 'שווי יציאה — מוסכמה', en: 'Exit Value — Convention' },
      short: { he: 'שווי נתמך × (1 + שינוי שווי בתרחיש) × (1 − haircut), או מחיר יעד × (1 + שינוי) × (1 − haircut נוסף).', en: 'Supported value × (1 + scenario value change) × (1 − haircut), or target price × (1 + change) × (1 − added haircut).' },
      measures: { he: 'מחיר המכירה ברוטו שממנו נגזרת תמורת היציאה.', en: 'The gross sale price from which exit proceeds derive.' },
      basis: { he: 'תמורה נטו = יציאה − עלויות מכירה (תיווך% + משפטיות% + אחרות) − מע״מ − יתרת החוב.', en: 'Net proceeds = exit − selling costs (brokerage% + legal% + other) − VAT − debt balance.' },
      convention: { he: 'אין עליית ערך שקטה: שינוי שווי קיים רק בתרחישים ובמבחני הלחץ שהוגדרו.', en: 'No silent appreciation: a value change exists only in the defined scenarios and stress tests.' },
      interpretation: { he: 'נקודת המוצא של התמורה ב-BUY; כל שינוי בה עובר במלואו לרווח לאחר עלויות המכירה.', en: 'The starting point of BUY proceeds; any change in it passes to profit in full after selling costs.' },
      engine: { base: ['exitGross', 'exitHaircut', 'netProceeds'], exclusive: true } },

    { id: 'mos', group: 'value', usedIn: ALL, data: ['model'],
      name: { he: 'מרווח ביטחון', en: 'Margin of safety' }, title: { he: 'מרווח ביטחון — לפי מבנה', en: 'Margin of Safety — By Structure' },
      short: { he: 'כמה השווי יכול לרדת לפני הפסד או פגיעה בקרן — מוגדר לכל מבנה בנפרד, ונבדק מול סף הקרן.', en: 'How far value can fall before a loss or principal impairment — defined per structure, and tested against the fund hurdle.' },
      measures: { he: 'הכרית בין השווי הצפוי לבין נקודת האיזון.', en: 'The cushion between expected value and break-even.' },
      perStructure: {
        buy: { he: '1 − מחיר מכירה לאיזון ÷ שווי נתמך. מוצג גם מול היציאה הצפויה: (יציאה − איזון) ÷ יציאה, וכרית בשקלים = יציאה − איזון.', en: '1 − break-even sale price ÷ supported value. Also shown against the expected exit: (exit − break-even) ÷ exit, and a cushion in shekels = exit − break-even.' },
        finance: { he: '1 − שווי בטוחות לאיזון (קרן) ÷ שווי בטוחות.', en: '1 − break-even collateral value (principal) ÷ collateral value.' },
        hybrid: { he: '1 − שווי שבו נפגעת הקרן ÷ שווי מימוש צפוי; ללא הון מושקע — הירידה לפני הפסד.', en: '1 − impairment value ÷ expected realization value; with no capital funded — the decline before a loss.' },
      },
      basis: { he: 'נגזר מנקודת האיזון של כל מבנה (ראו "נקודת איזון") ומחושב על תרחיש הבסיס.', en: 'Derived from each structure’s break-even (see "Break-even") and computed on the base scenario.' },
      interpretation: { he: 'מרווח גדול יותר = השווי יכול לרדת יותר לפני הפסד או פגיעה בקרן. נבדק מול סף "מרווח ביטחון מינימלי".', en: 'A larger margin = value can fall further before a loss or principal impairment. Tested against the "minimum margin of safety" hurdle.' },
      engine: { strategy: ['mos'] } },

    { id: 'maxPrice', group: 'value', usedIn: ['buy'], data: ['model'],
      name: { he: 'מחיר רכישה מקסימלי', en: 'Maximum acceptable price' }, title: { he: 'מחיר מקסימלי — לפי רף הקרן', en: 'Maximum Price — Against the Fund Hurdle' },
      short: { he: 'מחיר הרכישה הגבוה ביותר שעדיין עומד ברף ה-IRR של הקרן, כשכל שאר ההנחות קבועות.', en: 'The highest purchase price that still meets the fund IRR hurdle, all other assumptions held.' },
      measures: { he: 'התקרה לניהול משא ומתן על המחיר.', en: 'The ceiling for negotiating the price.' },
      basis: { he: 'חיפוש בינארי על המחיר בין 5% ל-200% מהשווי הנתמך; חוב ב-LTV גדל עם המחיר, חוב בסכום מוגבל למחיר. הנחה מינימלית נדרשת = 1 − מחיר מקסימלי ÷ שווי נתמך. מחיר ברווח אפס — באותה שיטה.', en: 'Binary search on price between 5% and 200% of supported value; LTV debt scales with price, amount debt is capped at price. Required minimum discount = 1 − maximum price ÷ supported value. Zero-profit price — same method.' },
      interpretation: { he: 'מחיר מוצע מעל המחיר המקסימלי = ה-BUY לא יעבור את סף ה-IRR של הקרן באותן הנחות.', en: 'An offered price above the maximum = BUY will not clear the fund IRR hurdle on the same assumptions.' },
      engine: { strategy: ['limits.maxPrice', 'limits.requiredDiscount', 'limits.zeroProfitPrice'] } },

    /* ================================================== E · fund decision rules */
    { id: 'hurdles', group: 'decision', usedIn: ALL, data: ['user'],
      name: { he: 'ספי קרן', en: 'Fund hurdles' }, title: { he: 'ספי קרן — תנאי זכאות', en: 'Fund Hurdles — Eligibility Criteria' },
      short: { he: 'ספי ההשקעה שהוגדרו בהגדרות הקרן, נבדקים על תרחיש הבסיס של כל מבנה; מבנה מועדף חייב לעבור את כולם.', en: 'The investment thresholds set in the fund settings, tested on each structure’s base scenario; a preferred structure must clear all of them.' },
      measures: { he: 'האם המבנה עומד בקריטריונים של הקרן.', en: 'Whether the structure meets the fund criteria.' },
      basis: { he: 'כל סף משווה ערך של העסקה לסף שהוגדר; "עובר" = ≥ לסף מינימום או ≤ לסף מקסימום. BUY נבדק מול 8 ספים, FINANCE ו-HYBRID מול 9 (כשגודל הקרן מוגדר).', en: 'Each hurdle compares a deal value with its configured threshold; "pass" = ≥ a minimum or ≤ a maximum. BUY is tested on 8 hurdles, FINANCE and HYBRID on 9 (when a fund size is set).' },
      convention: { he: 'החשיפה ליזם / פרויקט / יישוב = (הון בסיכון של עסקאות שמורות אחרות עם אותו שם + הון בסיכון של העסקה) ÷ גודל הקרן; עסקאות בארכיון, שנדחו או שמומשו אינן נספרות.', en: 'Developer / project / locality exposure = (capital at risk of other saved deals with the same name + this deal’s capital at risk) ÷ fund size; archived, declined or exited deals are not counted.' },
      hurdles: [
        { k: 'irr', name: { he: 'IRR מינימלי', en: 'Minimum IRR' }, dir: 'min', setting: 'minIrr', usedIn: ALL, he: 'IRR בסיס (על ההון המחויב כשלא הושקע הון)', en: 'Base IRR (on committed capital when nothing is invested)' },
        { k: 'moic', name: { he: 'MOIC מינימלי', en: 'Minimum MOIC' }, dir: 'min', setting: 'minMoic', usedIn: ALL, he: 'MOIC בסיס', en: 'Base MOIC' },
        { k: 'discount', name: { he: 'הנחת כניסה מינימלית', en: 'Minimum entry discount' }, dir: 'min', setting: 'minDiscount', usedIn: ['buy'], he: '1 − מחיר BUY ÷ שווי נתמך', en: '1 − BUY price ÷ supported value' },
        { k: 'ltv', name: { he: 'LTV מקסימלי', en: 'Maximum LTV' }, dir: 'max', setting: 'maxLtv', usedIn: ['finance', 'hybrid'], he: 'LTV', en: 'LTV' },
        { k: 'coverage', name: { he: 'כיסוי בטוחות מינימלי', en: 'Minimum collateral coverage' }, dir: 'min', setting: 'minCoverage', usedIn: ['finance', 'hybrid'], he: 'כיסוי בטוחות שמרני', en: 'Conservative collateral coverage' },
        { k: 'duration', name: { he: 'משך מקסימלי', en: 'Maximum duration' }, dir: 'max', setting: 'maxDuration', usedIn: ALL, he: 'משך (חודשים)', en: 'Duration (months)' },
        { k: 'mos', name: { he: 'מרווח ביטחון מינימלי', en: 'Minimum margin of safety' }, dir: 'min', setting: 'minMos', usedIn: ALL, he: 'מרווח ביטחון של המבנה', en: 'Structure margin of safety' },
        { k: 'devExposure', name: { he: 'חשיפה ליזם', en: 'Developer exposure' }, dir: 'max', setting: 'maxDevExposure', usedIn: ALL, fund: true, he: 'חשיפה ליזם ÷ גודל הקרן', en: 'Developer exposure ÷ fund size' },
        { k: 'projectExposure', name: { he: 'חשיפה לפרויקט', en: 'Project exposure' }, dir: 'max', setting: 'maxProjectExposure', usedIn: ALL, fund: true, he: 'חשיפה לפרויקט ÷ גודל הקרן', en: 'Project exposure ÷ fund size' },
        { k: 'geoExposure', name: { he: 'חשיפה גיאוגרפית', en: 'Locality exposure' }, dir: 'max', setting: 'maxGeoExposure', usedIn: ALL, fund: true, he: 'חשיפה ליישוב ÷ גודל הקרן', en: 'Locality exposure ÷ fund size' },
      ],
      interpretation: { he: '"x/y ספי קרן" = כמה ספים מתקיימים מתוך כמה שנבדקו; כל סף שלא מתקיים מוצג בשמו, עם הערך בפועל והסף. מבנה שנכשל אפילו בסף אחד אינו יכול להיות המבנה המועדף.', en: '"x/y fund hurdles" = how many are met out of how many were tested; every unmet hurdle is shown by name, with its actual value and threshold. A structure failing even one cannot be the preferred structure.' },
      engine: { strategy: ['hurdles'] } },

    { id: 'riskScore', group: 'decision', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'ציון סיכון', en: 'Risk score' }, title: { he: 'ציון סיכון — מודל', en: 'Risk Score — MODEL' },
      short: { he: 'ציון מודל 0–100 משמונה רכיבים מוסברים; גבוה = סיכון נמוך יותר. אינו הסתברות להפסד ואינו דירוג אשראי.', en: 'A 0–100 model score from eight explained components; higher = lower assessed risk. Not a probability of loss and not a credit rating.' },
      measures: { he: 'הערכה יחסית ושקופה של איכות הסיכון במבנה, לפי מפות לינאריות מוצהרות.', en: 'A relative, transparent assessment of risk quality in the structure, from stated piecewise-linear maps.' },
      basis: { he: 'כל רכיב מקבל 0–100 ממפה לינארית-למקוטעין על נקודות עוגן מוצהרות; הציון הכולל = ממוצע משוקלל (משקלות בהגדרות הקרן, 1 לכל רכיב כברירת מחדל; משקל 0 מוציא רכיב). מחושב על תרחיש הבסיס של כל מבנה.', en: 'Each component scores 0–100 from a piecewise-linear map over stated anchors; the overall score = weighted mean (weights in the fund settings, 1 each by default; weight 0 removes a component). Computed on each structure’s base scenario.' },
      formula: 'Score = Σ wᵢ × sᵢ ÷ Σ wᵢ',
      components: [
        { k: 'entry', he: 'בסיס כניסה — BUY: הנחת כניסה; FINANCE, HYBRID: LTV', en: 'Entry basis — BUY: entry discount; FINANCE, HYBRID: LTV' },
        { k: 'collateral', he: 'חוזק בטוחות — BUY: שווי ÷ בסיס כולל; FINANCE, HYBRID: כיסוי שמרני', en: 'Collateral strength — BUY: value to all-in basis; FINANCE, HYBRID: conservative coverage' },
        { k: 'liquidity', he: 'נזילות יציאה — סטטוס בנייה, מספר יחידות, עומק השוק בדגימת PROPX, שני מקורות פירעון', en: 'Exit liquidity — construction status, unit count, market depth in the PROPX sample, two repayment sources' },
        { k: 'duration', he: 'משך צפוי', en: 'Expected duration' },
        { k: 'developer', he: 'סיכון יזם — הערכת האנליסט', en: 'Developer risk — analyst assessment' },
        { k: 'project', he: 'סיכון פרויקט — סטטוס ומועד השלמה', en: 'Project risk — status and completion date' },
        { k: 'concentration', he: 'ריכוזיות — 100 − 60 × ניצול התקרה הגבוה; חריגה מתקרה = 20', en: 'Concentration — 100 − 60 × the highest limit use; above a limit = 20' },
        { k: 'protection', he: 'הגנה מבנית — BUY: 40 + מרווח עד הפסד × 160 (עד +40); FINANCE, HYBRID: דרגת שעבוד, פירעון שוטף, אופציה, backstop', en: 'Structure protection — BUY: 40 + margin to loss × 160 (up to +40); FINANCE, HYBRID: lien rank, amortisation, option, backstop' },
      ],
      interpretation: { he: 'משמש לשבירת שוויון באות המבנה ולהצגה; אינו נכנס לספי הקרן.', en: 'Used to break ties in the structure signal and for display; it is not a fund hurdle.' },
      convention: { he: 'זהו פלט מודל (MODEL): אינו הסתברות, אינו מכויל סטטיסטית ואינו דירוג אשראי. התרחיש השלילי משפיע על ההחלטה דרך התשואה המותאמת-סיכון — לא דרך הציון.', en: 'This is a MODEL output: not a probability, not statistically calibrated and not a credit rating. The downside scenario reaches the decision through the risk-adjusted return — not through the score.' },
      engine: { strategy: ['risk.overall', 'risk.components'] } },

    { id: 'signal', group: 'decision', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'אות מבנה', en: 'Structure signal' }, title: { he: 'אות מבנה — כלל בחירה', en: 'Structure Signal — Selection Rule' },
      short: { he: 'המבנה בעל התשואה המותאמת-סיכון הגבוהה ביותר מבין אלה שעוברים את כל ספי הקרן — תמיד עם נימוק מפורש.', en: 'The structure with the highest risk-adjusted return among those clearing every fund hurdle — always with an explicit reason.' },
      measures: { he: 'איזו צורת הון עדיפה לעסקה לפי ספי הקרן והתרחישים.', en: 'Which form of capital is preferable for the deal under the fund hurdles and scenarios.' },
      basis: { he: 'תשואה מותאמת-סיכון = (1 − w) × IRR בסיס + w × IRR שלילי; w = משקל התרחיש השלילי בהגדרות (50% כברירת מחדל); IRR חסר = ‎−100%. בשוויון — ציון סיכון גבוה יותר. קודים: STRONG BUY (BUY עדיף), PREFER FINANCE, PREFER HYBRID. אם אף מבנה אינו עובר את כל הספים: REVIEW כשהמבנה הקרוב ביותר נכשל בעד 2 ספים, ה-IRR שלו ≥ 0 ויש מבנה רווחי; אחרת DO NOT PROCEED. INCOMPLETE כשאין שווי לחיתום.', en: 'Risk-adjusted return = (1 − w) × base IRR + w × downside IRR; w = the downside weight in the settings (50% by default); a missing IRR = −100%. Ties go to the higher risk score. Codes: STRONG BUY (BUY preferred), PREFER FINANCE, PREFER HYBRID. If no structure clears every hurdle: REVIEW when the closest one fails at most 2 hurdles, its IRR ≥ 0 and some structure is profitable; otherwise DO NOT PROCEED. INCOMPLETE when there is no underwriting value.' },
      formula: 'RA = (1 − w) × IRR_base + w × IRR_downside',
      convention: { he: 'האות אינו המלצה אוטומטית; הוא נגזר מהספים ומהתרחישים שהוזנו ומוסבר תמיד.', en: 'The signal is not an automatic recommendation; it derives from the hurdles and scenarios entered and is always explained.' },
      interpretation: { he: 'האות מדרג צורות הון לאותה עסקה; הוא אינו קובע שהעסקה כדאית ואינו המלצה אוטומטית — ההחלטה בוועדת ההשקעות.', en: 'The signal ranks forms of capital for the same deal; it does not decide that the deal is worthwhile and is not an automatic recommendation — the decision rests with the investment committee.' },
      engine: { run: ['signal.code', 'signal.why'] } },

    { id: 'portfolio', group: 'decision', usedIn: ALL, data: ['model', 'user'],
      name: { he: 'צבירת פורטפוליו', en: 'Portfolio aggregation' }, title: { he: 'פורטפוליו — מוסכמת צבירה', en: 'Portfolio — Aggregation Convention' },
      short: { he: 'כל עסקה בגרסתה האחרונה, במבנה שנבחר לביצוע או במועדף; ממוצעים משוקללים בהון בסיכון; כל עסקה נבחנת מול האחרות כהקשר ריכוזיות.', en: 'Each deal at its latest version, in the structure chosen for execution or the preferred one; averages weighted by capital at risk; each deal judged against the others as concentration context.' },
      measures: { he: 'חשיפת הקרן, התשואה המשוקללת והנזילות הצפויה.', en: 'Fund exposure, weighted return and expected liquidity.' },
      basis: { he: 'נזילות צפויה = תקבולים חיוביים מתוארכים בחלון שמהיום (3 / 6 / 12 חודשים); לוח החזרים לפי רבעון; חשיפה לפי מבנה / יזם / יישוב = הון בסיכון ÷ סך הפורטפוליו, ומול גודל הקרן.', en: 'Expected liquidity = dated positive receipts within a window from today (3 / 6 / 12 months); return calendar by quarter; exposure by structure / developer / locality = capital at risk ÷ portfolio total, and against fund size.' },
      interpretation: { he: 'מראה ריכוזיות, תשואה משוקללת והחזרי הון צפויים; כל עסקה נבחנת גם מול תקרות החשיפה של הקרן.', en: 'Shows concentration, weighted return and expected capital returns; each deal is also tested against the fund exposure limits.' },
      engine: { portfolio: ['capital', 'irr', 'moic', 'months', 'liquidity', 'byStrategy'] } },

    /* ================================================== F · scenarios */
    { id: 'scenarios', group: 'scenarios', usedIn: ALL, data: ['user', 'model'],
      name: { he: 'שלילי · בסיס · חיובי', en: 'Downside · Base · Upside' }, title: { he: 'תרחישים — הגדרה', en: 'Scenarios — Definition' },
      short: { he: 'הבסיס הוא העסקה כפי שהוזנה; בשלילי ובחיובי כל הנחה משתנה בנפרד. ברירות המחדל הן הנחות לשינוי.', en: 'The base is the deal as entered; in the downside and upside each assumption changes independently. The defaults are assumptions to edit.' },
      measures: { he: 'התוצאה של כל מבנה תחת הנחות חלופיות.', en: 'Each structure’s result under alternative assumptions.' },
      basis: { he: 'שלילי (ברירת מחדל): שווי ‎−15%, עיכוב +6 ח׳, ריבית חוב +1 נ״א, שכירות ‎−10%, תפעול +10%, בטוחות = שינוי השווי, כשל ומימוש בטוחות (FINANCE, HYBRID), מלאי לא מכור 50% (backstop). חיובי: שווי +5%, יציאה ‎−3 ח׳, ריבית ‎−0.5 נ״א, שכירות +5%.', en: 'Downside (default): value −15%, delay +6 months, debt rate +1 pp, rent −10%, opex +10%, collateral = the value change, default and enforcement (FINANCE, HYBRID), 50% unsold (backstop). Upside: value +5%, exit −3 months, rate −0.5 pp, rent +5%.' },
      convention: { he: 'ב-FINANCE וב-HYBRID יציאה מוקדמת בחיובי פירושה פירעון מוקדם: רווח בשקלים נמוך יותר ו-IRR גבוה יותר.', en: 'In FINANCE and HYBRID an earlier exit in the upside means earlier repayment: less profit in shekels and a higher IRR.' },
      interpretation: { he: 'הפער בין הבסיס לשלילי הוא הסיכון שהקרן מקבלת; משקל השלילי בתשואה המותאמת-סיכון קובע כמה הוא משפיע על האות.', en: 'The gap between base and downside is the risk the fund takes on; the downside weight in the risk-adjusted return decides how much it moves the signal.' },
      engine: { strategy: ['downside.irr', 'upside.irr'] } },

    { id: 'stress', group: 'scenarios', usedIn: ALL, data: ['model'],
      name: { he: 'מבחני לחץ', en: 'Stress tests' }, title: { he: 'מבחני לחץ — מוסכמה', en: 'Stress Tests — Convention' },
      short: { he: 'שינוי אחד על תרחיש הבסיס: שווי ‎−5/‎−10/‎−15/‎−20%, עיכוב +6/+12 ח׳, עלות חוב +1/+2 נ״א.', en: 'One change on the base scenario: value −5/−10/−15/−20%, delay +6/+12 months, debt cost +1/+2 pp.' },
      measures: { he: 'רגישות כל מבנה לשינוי בודד.', en: 'Each structure’s sensitivity to a single change.' },
      perStructure: {
        buy: { he: 'כל המבחנים משפיעים: שווי היציאה, החזקה ונשיאה, ועלות חוב הרכישה.', en: 'Every test applies: exit value, holding and carry, and the acquisition debt cost.' },
        finance: { he: 'הריבית החוזית קבועה — עלות חוב אינה משפיעה; ירידת שווי פוגעת רק כשהבטוחות אינן מכסות את התביעה; עיכוב = הארכה.', en: 'The contractual rate is fixed — debt cost has no effect; a value fall hurts only when collateral no longer covers the claim; a delay = an extension.' },
        hybrid: { he: 'השווי משפיע על ההשתתפות, על האופציה ועל הכיסוי; עלות חוב אינה משפיעה.', en: 'Value affects participation, the option and coverage; debt cost has no effect.' },
      },
      basis: { he: 'כל מבחן = תרחיש הבסיס עם שינוי אחד; שווי הבטוחות זז יחד עם שינוי השווי, ושאר ההנחות אינן משתנות.', en: 'Each test = the base scenario with one change; collateral value moves with the value change, and every other assumption stays put.' },
      interpretation: { he: 'מראה איזה משתנה בודד מזיז כל מבנה. מבחן לחץ אינו תרחיש — הוא מבודד שינוי אחד.', en: 'Shows which single variable moves each structure. A stress test is not a scenario — it isolates one change.' },
      engine: { strategy: ['stress.v10.irr', 'stress.d6.irr', 'stress.r1.irr'] } },

    { id: 'attribution', group: 'scenarios', usedIn: ALL, data: ['model'],
      name: { he: 'מפל התרחיש השלילי', en: 'Downside attribution' }, title: { he: 'ייחוס התרחיש השלילי — שיטה', en: 'Downside Attribution — Method' },
      short: { he: 'הנחות התרחיש השלילי מופעלות אחת אחרי השנייה; כל שלב = השינוי ברווח וב-IRR מהשלב הקודם.', en: 'The downside assumptions are applied one after another; each step = the change in profit and IRR from the previous step.' },
      measures: { he: 'איזו הנחה אחראית לכמה מהפער בין הבסיס לשלילי.', en: 'Which assumption accounts for how much of the base-to-downside gap.' },
      basis: { he: 'סדר: BUY — שווי, haircut, עיכוב, ריבית, שכירות, תפעול; FINANCE — בטוחות/שווי, עיכוב, כשל; HYBRID — שווי/בטוחות, עיכוב, מלאי לא מכור, כשל.', en: 'Order: BUY — value, haircut, delay, rate, rent, opex; FINANCE — collateral/value, delay, default; HYBRID — value/collateral, delay, unsold share, default.' },
      convention: { he: 'הסדר משפיע על חלוקת הייחוס; הסכום תמיד שווה לתוצאת התרחיש השלילי.', en: 'The order affects how the gap is attributed; the steps always sum to the downside result.' },
      interpretation: { he: 'מראה איזו הנחה אחראית לחלק הגדול של הירידה מהבסיס לשלילי — היכן כדאי למקד את בדיקת הנאותות.', en: 'Shows which assumption accounts for most of the fall from base to downside — where due diligence should focus.' },
      engine: { strategy: ['attribution.steps', 'attribution.downsideIrr'] } },
  ];

  const byId = Object.fromEntries(METRICS.map((m) => [m.id, m]));
  const t = (v, lang) => (v == null ? '' : typeof v === 'string' ? v : v[lang] || v.he || '');
  return { VERSION, GROUPS, CLASSES, STRUCTURES, FIELDS, METRICS, byId, t };
});
