/* ALTARIS · Investment Cases — five illustrative institutional deals.
 *
 * SYNTHETIC SCENARIOS. Every project, developer, SPV and counterparty below is
 * fictional; the localities are real places used only as setting. Nothing here
 * is a transaction, a tender, a project or a market observation, and none of it
 * is PROPX data: values and prices are scenario assumptions written for this
 * library. Pure data — no calculation, no DOM, no storage, no network. The page
 * loads a case into the ordinary deal screen and the ordinary engine
 * (altaris/engine.js) computes every figure; no case names a preferred structure.
 *
 * A case never enters saved deals, the portfolio or any PROPX dataset unless the
 * user creates a working copy (then it is a user deal tagged with its origin).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AltarisCases = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;
  const NOTICE = {
    he: 'מקרה השקעה להמחשה · הנתונים סינתטיים ונבנו לצורך הדגמת מודל החיתום.',
    en: 'Illustrative investment case · Synthetic data created to demonstrate the underwriting model.',
  };
  const LABEL = { he: 'מקרה השקעה להמחשה', en: 'Illustrative Investment Case' };
  const EXPORT_MARK = 'ILLUSTRATIVE CASE · מקרה השקעה להמחשה — נתונים סינתטיים; אינה עסקה, פרויקט או נתון שוק אמיתי';
  const CREATED = '2026-10-12';
  const SCEN_NOTE = 'הנחת תרחיש (סינתטית)';
  const memoText = (m) => [['תזה', m.thesis], ['למה עכשיו', m.whyNow], ['סיכונים מרכזיים', m.risks], ['הגנה מרכזית', m.protection], ['מסלול יציאה', m.exit]]
    .map(([k, v]) => `${k}: ${v.he}`).join('\n');

  const CASES = [];

  /* ================================================== 1 · Park 18 — distressed bulk acquisition */
  {
    const memo = {
      thesis: { he: 'רכישת 10 דירות גמורות בבניין שקיבל טופס 4, בכ-20% מתחת לשווי הנתמך, ממוכר שזקוק לנזילות; מימוש מבוקר דירה-אחר-דירה לאורך כשנה וחצי.', en: 'Acquire ten completed apartments in a building with occupancy certificate at c. 20% below supported value from a liquidity-constrained seller; controlled unit-by-unit disposals over c. eighteen months.' },
      whyNow: { he: 'אורון מגורים צריכה הון להשלמת תשלום קרקע בפרויקט הבא ולעמידה באמת מידה פיננסית מול הבנק; המלאי הגמור הוא הנכס הנזיל היחיד שלה, והיא מעדיפה מכירת בלוק מהירה על פני הנחות פומביות בפרויקט.', en: 'Oron Residential needs capital for a land instalment on its next project and to meet a bank covenant; the completed inventory is its only liquid asset, and it prefers a quick block sale to public price cuts in the project.' },
      risks: { he: 'קצב ספיגה של 10 דירות באותו פרויקט; לחץ על מחירי המכירה אם היזם ימשיך למכור במקביל; עלות מימון במחזיק ארוך מהצפוי; עלויות החזקה של דירות ריקות.', en: 'Absorption of ten units in one project; sale-price pressure if the developer keeps selling in parallel; financing cost over a longer hold; carrying costs of vacant units.' },
      protection: { he: 'כניסה בהנחה של כ-20% מהשווי הנתמך ומתחת לשומה; נכס גמור עם טופס 4 — ללא סיכון ביצוע; תמהיל של 3 עד 5 חדרים ופנטהאוז; התחייבות היזם שלא למכור מתחת למחירון לתקופה של 12 חודשים (תנאי עסקה מוצע).', en: 'Entry c. 20% below supported value and below the appraisal; a completed asset with occupancy certificate — no construction risk; a 3- to 5-room mix plus a penthouse; a proposed developer undertaking not to sell below list for 12 months.' },
      exit: { he: 'מכירה דירה-אחר-דירה בין חודש 6 לחודש 20 (המודל: יציאה אחת במועד המכירה הממוצע המשוקלל, חודש 14); חלופה — מכירת היתרה במקשה אחת.', en: 'Unit-by-unit sales between months 6 and 20 (modelled as one exit at the weighted-average sale date, month 14); fallback — a bulk sale of the remainder.' },
    };
    CASES.push({
      id: 'park-18', primary: 'buy',
      title: { he: 'פארק 18 — רכישת מלאי ממוכר במצוקת נזילות', en: 'Park 18 — Distressed Bulk Acquisition' },
      category: { he: 'רכישת בלוק דירות גמורות', en: 'Bulk acquisition of completed units' },
      location: { he: 'פתח תקווה · מחוז המרכז', en: 'Petah Tikva · Central District' },
      scale: { he: '10 דירות · שווי נתמך כ-₪31 מיליון', en: '10 apartments · c. ₪31M supported value' },
      thesis: { he: 'מלאי גמור מתחת לשווי ממוכר שצריך נזילות — מימוש מבוקר דירה-אחר-דירה.', en: 'Completed inventory below value from a motivated seller — controlled unit-by-unit exits.' },
      memo,
      deal: {
        schema: 1,
        info: {
          name: 'פארק 18 — 10 דירות גמורות מאורון מגורים', developer: 'אורון מגורים בע״מ', project: 'פארק 18', city: 'פתח תקווה', cityCode: '7900',
          neighborhood: 'כפר גנים ג׳', address: 'שדרת הפארק (כתובת להמחשה)', unitTypes: '3–5 חדרים ופנטהאוז', constructionStatus: 'completed',
          completionDate: '2026-08-30', startDate: '2026-11-15', source: 'developer', owner: 'צוות החיתום · ALTARIS', developerRating: 'mid', createdAt: CREATED,
          notes: memoText(memo),
        },
        units: [
          { label: 'A-4 · קומה 2', rooms: 3, sqm: 78, supported: 2250000, proposed: 1800000 },
          { label: 'A-7 · קומה 3', rooms: 4, sqm: 101, supported: 2850000, proposed: 2290000 },
          { label: 'A-9 · קומה 4', rooms: 4, sqm: 104, supported: 2920000, proposed: 2340000 },
          { label: 'A-12 · קומה 5', rooms: 5, sqm: 124, supported: 3450000, proposed: 2760000 },
          { label: 'A-15 · קומה 6', rooms: 4, sqm: 99, supported: 2900000, proposed: 2330000 },
          { label: 'B-2 · דירת גן', rooms: 4, sqm: 96, supported: 2850000, proposed: 2280000 },
          { label: 'B-8 · קומה 4', rooms: 4, sqm: 106, supported: 2980000, proposed: 2400000 },
          { label: 'B-11 · קומה 6', rooms: 5, sqm: 128, supported: 3550000, proposed: 2850000 },
          { label: 'B-14 · קומה 8', rooms: 4, sqm: 102, supported: 3020000, proposed: 2420000 },
          { label: 'B-19 · פנטהאוז, קומה 12', rooms: 5, sqm: 152, supported: 4600000, proposed: 3700000 },
        ],
        price: {},
        value: {
          appraisal: { value: 30600000, note: 'שומת שמאי במצב קיים — ' + SCEN_NOTE },
          developer: { value: 33900000, note: 'מחירון היזם לדירות — ' + SCEN_NOTE },
          chosen: 'units',
        },
        buy: {
          taxPct: 8, legalPct: 0.5, dd: 85000, brokeragePct: 0, registration: 25000, capex: 0, renovation: 0, marketing: 180000, otherAcq: 0,
          exitMonth: 14, mgmt: 6000, municipal: 6500, insurance: 2200, maintenance: 4500, otherOpex: 0, rentOn: false,
          debtMode: 'ltv', ltvPct: 50, ratePct: 6, feePct: 0.75, loanTermMonths: 24, interestMode: 'current',
          exitMode: 'haircut', haircutPct: 3, sellBrokeragePct: 1.5, sellLegalPct: 0.5, sellOther: 120000,
          vatPct: 0, profitTaxPct: 23, otherTax: 0, exitPrimary: 'unit-sales', exitSecondary: 'bulk-sale',
        },
        finance: {
          amount: 12000000, ratePct: 12, interestMode: 'current', feePct: 2, exitFeePct: 0.5, termMonths: 12, graceMonths: 0, repayment: 'bullet',
          legal: 90000, monitoring: 4000, extMonths: 6, extRatePct: 14, extFeePct: 0.75,
          haircutPct: 15, seniority: 'second', priorLiens: 6500000, saleCostPct: 3,
          sourcePrimary: 'apartment-sales', sourceSecondary: 'bank-refinancing', enforcementMonths: 15, enforcementCostPct: 8,
        },
        hybrid: {
          structure: 'secured-upside', capital: 12000000, maxCommitment: 12000000, feePct: 1.75, couponPct: 10, prefPct: 0, termMonths: 15, salesSpreadMonths: 9,
          participationPct: 25, threshold: 27500000, optionOn: false, backstopOn: false,
          haircutPct: 15, seniority: 'second', priorLiens: 6500000, saleCostPct: 3,
          triggerNote: 'פירעון שוטף מתקבולי מכירת הדירות; פירעון סופי בחודש 15', exitConditions: 'שחרור שעבוד דירה כנגד 85% מתמורת מכירתה',
          sourcePrimary: 'apartment-sales', sourceSecondary: 'bank-refinancing', legal: 90000, monitoring: 4000, enforcementMonths: 15, enforcementCostPct: 8,
        },
        scen: {
          downside: { valueShock: -12, haircutAdd: 2, delay: 8, rateAdd: 1, opexChg: 10, default: true, enforcementMonths: 18 },
          upside: { valueShock: 4, delay: -3, rateAdd: -0.5 },
        },
        selected: null,
      },
    });
  }

  /* ================================================== 2 · HaNassi 42 — senior secured bridge */
  {
    const memo = {
      thesis: { he: 'הלוואת גישור בכירה של ₪15 מיליון בשעבוד ראשון על 14 הדירות הלא מכורות בפרויקט שבנייתו הושלמה בכ-75%; תשואה חוזית עם הגנת בטוחה ב-LTV של כ-43%.', en: 'A ₪15M senior bridge loan secured by a first lien on the 14 unsold units of a project c. 75% built; contractual yield with collateral protection at an LTV of c. 43%.' },
      whyNow: { he: 'חריגה בעלויות הגמר מיצתה את מסגרת הליווי הבנקאי; רימון צריכה מימון להשלמת הפרויקט ולתשלום קרקע בפרויקט הבא, והבנק משחרר את הדירות הלא מכורות לשעבוד ראשון כנגד השלמת ההון.', en: 'A finishing-cost overrun exhausted the bank construction facility; Rimon needs funding to complete the project and pay a land instalment elsewhere, and the bank releases the unsold units to a first lien against the equity top-up.' },
      risks: { he: 'עיכוב בטופס 4 ובקצב המכירות; תלות במחזור בנקאי אם המכירות מתעכבות; ירידת ערך הבטוחה בשוק חיפה; ביצוע היזם בשלב הגמר.', en: 'Delay in occupancy certificate and sales pace; reliance on bank refinancing if sales slow; collateral-value decline in the Haifa market; developer execution in the finishing phase.' },
      protection: { he: 'שעבוד ראשון על 14 דירות בשווי שומה של ₪35.2 מיליון; ריבית גרייס נצברת לחוב; פיקוח הנדסי חודשי; אופציית הארכה בריבית גבוהה יותר; הון עצמי של היזם בפרויקט כ-₪9.5 מיליון.', en: 'First lien on 14 units appraised at ₪35.2M; grace interest capitalised into the claim; monthly engineering monitoring; an extension option at a higher rate; c. ₪9.5M of developer equity in the project.' },
      exit: { he: 'פירעון מתקבולי מכירת הדירות לאחר טופס 4; מקור משני — משכנתא קבלנית / מחזור בנקאי על המלאי הגמור.', en: 'Repayment from unit-sale proceeds after the occupancy certificate; secondary source — a bank refinancing of the completed inventory.' },
    };
    CASES.push({
      id: 'hanassi-42', primary: 'finance',
      title: { he: 'הנשיא 42 — מימון גישור בכיר לפרויקט בבנייה', en: 'HaNassi 42 — Senior Secured Development Finance' },
      category: { he: 'אשראי בכיר מובטח', en: 'Senior secured credit' },
      location: { he: 'חיפה · מרכז הכרמל', en: 'Haifa · Carmel Center' },
      scale: { he: 'הלוואה של ₪15 מיליון · בטוחה כ-₪35 מיליון', en: '₪15M facility · c. ₪35M collateral' },
      thesis: { he: 'תשואה חוזית בשעבוד ראשון על מלאי שכמעט הושלם — LTV של כ-43%.', en: 'Contractual yield on a first lien over near-complete inventory — LTV c. 43%.' },
      memo,
      deal: {
        schema: 1,
        info: {
          name: 'הנשיא 42 — הלוואת גישור לרימון פיתוח עירוני', developer: 'רימון פיתוח עירוני בע״מ', project: 'הנשיא 42', city: 'חיפה', cityCode: '4000',
          neighborhood: 'מרכז הכרמל', address: 'שדרות הנשיא (כתובת להמחשה)', unitTypes: '3–6 חדרים (14 דירות לא מכורות מתוך 42)', constructionStatus: 'construction',
          completionDate: '2027-06-30', startDate: '2026-11-01', source: 'network', owner: 'צוות החיתום · ALTARIS', developerRating: 'established', createdAt: CREATED,
          notes: memoText(memo),
        },
        units: [
          { label: 'א-3 · קומה 1', rooms: 3, sqm: 80, supported: 1860000, proposed: 1660000 },
          { label: 'א-6 · קומה 2', rooms: 4, sqm: 104, supported: 2340000, proposed: 2080000 },
          { label: 'א-9 · קומה 3', rooms: 4, sqm: 106, supported: 2400000, proposed: 2130000 },
          { label: 'א-12 · קומה 4', rooms: 5, sqm: 126, supported: 2850000, proposed: 2530000 },
          { label: 'א-14 · קומה 5', rooms: 4, sqm: 104, supported: 2450000, proposed: 2180000 },
          { label: 'א-17 · קומה 6', rooms: 4, sqm: 108, supported: 2580000, proposed: 2290000 },
          { label: 'א-20 · קומה 7, נוף לים', rooms: 5, sqm: 130, supported: 3300000, proposed: 2930000 },
          { label: 'ב-2 · דירת גן', rooms: 4, sqm: 112, supported: 2550000, proposed: 2270000 },
          { label: 'ב-5 · קומה 2', rooms: 3, sqm: 82, supported: 1920000, proposed: 1710000 },
          { label: 'ב-8 · קומה 3', rooms: 4, sqm: 103, supported: 2360000, proposed: 2100000 },
          { label: 'ב-11 · קומה 4', rooms: 4, sqm: 105, supported: 2420000, proposed: 2150000 },
          { label: 'ב-15 · קומה 6', rooms: 5, sqm: 128, supported: 3050000, proposed: 2710000 },
          { label: 'ב-18 · קומה 7', rooms: 4, sqm: 107, supported: 2620000, proposed: 2330000 },
          { label: 'ב-21 · פנטהאוז', rooms: 6, sqm: 168, supported: 4650000, proposed: 4140000 },
        ],
        price: {},
        value: {
          appraisal: { value: 35200000, note: 'שומת מלווה למצב סופי בניכוי עלויות השלמה — ' + SCEN_NOTE },
          developer: { value: 39800000, note: 'מחירון היזם — ' + SCEN_NOTE },
          chosen: 'appraisal',
        },
        buy: {
          taxPct: 8, legalPct: 0.5, dd: 60000, registration: 20000, marketing: 150000,
          exitMonth: 16, municipal: 4000, insurance: 1500, maintenance: 3000,
          debtMode: 'ltv', ltvPct: 40, ratePct: 6.25, feePct: 0.75, loanTermMonths: 18, interestMode: 'current',
          exitMode: 'haircut', haircutPct: 2, sellBrokeragePct: 1.5, sellLegalPct: 0.5, sellOther: 100000,
          vatPct: 0, profitTaxPct: 23, exitPrimary: 'unit-sales', exitSecondary: 'bulk-sale',
        },
        finance: {
          amount: 15000000, ratePct: 10.5, interestMode: 'current', feePct: 1.75, exitFeePct: 0.5, termMonths: 22, graceMonths: 6, repayment: 'bullet',
          legal: 120000, monitoring: 6000, extMonths: 6, extRatePct: 12.5, extFeePct: 0.75,
          haircutPct: 15, seniority: 'first', priorLiens: 0, borrowerEquity: 9500000, saleCostPct: 3,
          sourcePrimary: 'apartment-sales', sourceSecondary: 'bank-refinancing', enforcementMonths: 14, enforcementCostPct: 7,
        },
        hybrid: {
          structure: 'finance-option', capital: 15000000, maxCommitment: 15000000, feePct: 1.5, couponPct: 9.5, prefPct: 0, termMonths: 22, salesSpreadMonths: 10,
          participationPct: 0, optionOn: true, optionPrice: 7750000, optionSharePct: 25, backstopOn: false, resaleMonths: 6, resaleCostPct: 3, resaleHaircutPct: 5,
          haircutPct: 15, seniority: 'first', priorLiens: 0, saleCostPct: 3,
          triggerNote: 'אופציה לרכישת 25% מהמלאי הלא מכור במחיר קבוע, למימוש בטופס 4', exitConditions: 'פירעון מתקבולי מכירות; שחרור שעבוד כנגד 90% מהתמורה',
          sourcePrimary: 'apartment-sales', sourceSecondary: 'bank-refinancing', legal: 120000, monitoring: 6000, enforcementMonths: 14, enforcementCostPct: 7,
        },
        scen: {
          downside: { valueShock: -12, delay: 9, default: true, enforcementMonths: 14 },
          upside: { valueShock: 3, delay: -2 },
        },
        selected: null,
      },
    });
  }

  /* ================================================== 3 · Ganei HaPark — preferred capital + option + backstop */
  {
    const memo = {
      thesis: { he: 'הון מועדף של עד ₪10 מיליון (₪6.5 מיליון במשיכה ראשונה) בתשואה מועדפת נצברת של 12.5%, עם אופציה לרכוש רבע מהמלאי הלא מכור בכ-14% מתחת לשווי, תמורת התחייבות רכישה (backstop) על מלאי שלא יימכר.', en: 'Up to ₪10M of preferred capital (₪6.5M first draw) at a 12.5% accrued preferred return, with an option on a quarter of the unsold inventory at c. 14% below value, in exchange for a backstop on inventory left unsold.' },
      whyNow: { he: 'הבנק המלווה דורש השלמת הון עצמי ושיעור מכירות מוקדמות לפני שחרור מסגרת הבנייה של בניין ב׳; ה-backstop של ALTARIS מאפשר לבנק להכיר במלאי כמכור-בפועל.', en: 'The lending bank requires an equity top-up and a presale ratio before releasing building B’s construction facility; the ALTARIS backstop lets the bank treat the inventory as effectively sold.' },
      risks: { he: 'קצב מכירות איטי בבאר שבע; הפעלת ה-backstop דורשת הון גדול בהרבה מההשקעה הראשונית; נזילות נמוכה במכירה חוזרת; מקום נחות מאחורי הבנק המלווה.', en: 'Slow absorption in Be’er Sheva; a backstop call requires far more capital than the initial investment; weak resale liquidity; a junior position behind the lending bank.' },
      protection: { he: 'מחיר ה-backstop נקבע ב-75% מהשווי הנתמך (כ-70% ממחירון היזם); עמלת התחייבות על כל המסגרת; האופציה ממומשת רק אם המכירה החוזרת עדיפה; תשואה מועדפת נצברת שמשולמת לפני היזם.', en: 'The backstop is priced at 75% of supported value (c. 70% of the developer list); a commitment fee on the full facility; the option is exercised only when resale is better; an accrued preferred return paid ahead of the developer.' },
      exit: { he: 'פירעון מתקבולי מכירת 16 הדירות בין חודש 16 לחודש 24; מימוש האופציה ומכירה חוזרת של יחידות האופציה; במלאי שלא נמכר — רכישה במחיר ה-backstop ומכירה חוזרת.', en: 'Repayment from the sale of the 16 units between months 16 and 24; exercise of the option and resale of the option units; for unsold inventory — purchase at the backstop price and resale.' },
    };
    CASES.push({
      id: 'ganei-hapark', primary: 'hybrid',
      title: { he: 'גני הפארק — הון מועדף עם אופציה ו-Backstop', en: 'Ganei HaPark — Preferred Capital + Option' },
      category: { he: 'מבנה משולב: הון מועדף, אופציה ו-backstop', en: 'Hybrid: preferred capital, option and backstop' },
      location: { he: 'באר שבע · שכונת רמות', en: 'Be’er Sheva · Ramot' },
      scale: { he: 'התחייבות ₪10 מיליון · 16 דירות לא מכורות', en: '₪10M commitment · 16 unsold units' },
      thesis: { he: 'תשואה חוזית עם גישה סלקטיבית לאפסייד דרך אופציה — מול חשיפה מותנית ב-backstop.', en: 'Contractual return with selective upside through an option — against contingent backstop exposure.' },
      memo,
      deal: {
        schema: 1,
        info: {
          name: 'גני הפארק — הון מועדף לנגב ליווינג פרטנרס', developer: 'נגב ליווינג פרטנרס בע״מ', project: 'גני הפארק — בניין ב׳', city: 'באר שבע', cityCode: '9000',
          neighborhood: 'רמות', address: 'רחוב הפארק (כתובת להמחשה)', unitTypes: '3–6 חדרים (16 דירות לא מכורות מתוך 32)', constructionStatus: 'construction',
          completionDate: '2028-01-31', startDate: '2026-12-01', source: 'developer', owner: 'צוות החיתום · ALTARIS', developerRating: 'mid', createdAt: CREATED,
          notes: memoText(memo),
        },
        units: [
          { label: 'ב-3 · קומה 1', rooms: 3, sqm: 78, supported: 1210000, proposed: 1060000 },
          { label: 'ב-5 · קומה 2', rooms: 4, sqm: 100, supported: 1520000, proposed: 1330000 },
          { label: 'ב-7 · קומה 2', rooms: 4, sqm: 102, supported: 1550000, proposed: 1350000 },
          { label: 'ב-10 · קומה 3', rooms: 5, sqm: 121, supported: 1820000, proposed: 1590000 },
          { label: 'ב-12 · קומה 4', rooms: 4, sqm: 101, supported: 1560000, proposed: 1360000 },
          { label: 'ב-14 · קומה 4', rooms: 4, sqm: 104, supported: 1590000, proposed: 1390000 },
          { label: 'ב-17 · קומה 5', rooms: 5, sqm: 124, supported: 1880000, proposed: 1640000 },
          { label: 'ב-19 · קומה 6', rooms: 4, sqm: 102, supported: 1600000, proposed: 1400000 },
          { label: 'ב-22 · קומה 7', rooms: 4, sqm: 103, supported: 1630000, proposed: 1420000 },
          { label: 'ב-24 · קומה 8', rooms: 5, sqm: 125, supported: 1930000, proposed: 1680000 },
          { label: 'ב-27 · קומה 9', rooms: 4, sqm: 101, supported: 1640000, proposed: 1430000 },
          { label: 'ב-29 · קומה 10', rooms: 3, sqm: 80, supported: 1330000, proposed: 1160000 },
          { label: 'ב-31 · קומה 11', rooms: 4, sqm: 104, supported: 1700000, proposed: 1480000 },
          { label: 'ב-33 · קומה 12', rooms: 5, sqm: 126, supported: 2020000, proposed: 1760000 },
          { label: 'ב-35 · קומה 13', rooms: 4, sqm: 103, supported: 1720000, proposed: 1500000 },
          { label: 'ב-37 · פנטהאוז', rooms: 6, sqm: 160, supported: 2650000, proposed: 2310000 },
        ],
        price: {},
        value: {
          appraisal: { value: 26400000, note: 'שומת שמאי למצב סופי — ' + SCEN_NOTE },
          developer: { value: 29100000, note: 'מחירון היזם — ' + SCEN_NOTE },
          chosen: 'units',
        },
        buy: {
          taxPct: 8, legalPct: 0.5, dd: 70000, registration: 30000, marketing: 160000,
          exitMonth: 26, municipal: 3500, insurance: 1500, maintenance: 3000,
          debtMode: 'ltv', ltvPct: 45, ratePct: 6.25, feePct: 0.75, loanTermMonths: 30, interestMode: 'current',
          exitMode: 'haircut', haircutPct: 4, sellBrokeragePct: 2, sellLegalPct: 0.5, sellOther: 120000,
          vatPct: 0, profitTaxPct: 23, exitPrimary: 'unit-sales', exitSecondary: 'rental-hold',
        },
        finance: {
          amount: 6500000, ratePct: 13, interestMode: 'current', feePct: 2, exitFeePct: 0.5, termMonths: 24, graceMonths: 0, repayment: 'bullet',
          legal: 80000, monitoring: 3500, extMonths: 6, extRatePct: 15, extFeePct: 1,
          haircutPct: 20, seniority: 'second', priorLiens: 12000000, saleCostPct: 3,
          sourcePrimary: 'apartment-sales', sourceSecondary: 'developer-equity', enforcementMonths: 15, enforcementCostPct: 8,
        },
        hybrid: {
          structure: 'pref', capital: 6500000, maxCommitment: 10000000, feePct: 2, couponPct: 0, prefPct: 12.5, termMonths: 24, salesSpreadMonths: 8,
          participationPct: 0, optionOn: true, optionPrice: 5880000, optionSharePct: 25,
          backstopOn: true, backstopPrice: 20500000, backstopUnsoldPct: 0, resaleMonths: 8, resaleCostPct: 3, resaleHaircutPct: 6,
          haircutPct: 20, seniority: 'other', priorLiens: 12000000, saleCostPct: 3,
          triggerNote: 'טופס 4 לבניין ב׳ או חודש 24 — המוקדם מביניהם', exitConditions: 'backstop: רכישת מלאי לא מכור ב-75% מהשווי הנתמך; אופציה על 25% מהמלאי ב-86% מהשווי',
          sourcePrimary: 'apartment-sales', sourceSecondary: 'project-refinancing', legal: 80000, monitoring: 3500, enforcementMonths: 15, enforcementCostPct: 8,
        },
        scen: {
          downside: { valueShock: -15, delay: 8, rateAdd: 1, default: false, backstopUnsoldPct: 40 },
          upside: { valueShock: 4, delay: -3 },
        },
        selected: null,
      },
    });
  }

  /* ================================================== 4 · HaGefen Renewal — pre-construction urban renewal */
  {
    const memo = {
      thesis: { he: 'לכידת הערך הנוצר בין היתר בנייה בפרויקט פינוי-בינוי לבין מסירת דירות גמורות: רכישת 5 דירות יזם בתשלום מקדים בכ-24% מתחת לשווי הצפוי במצב סופי, או השלמת ההון העצמי של היזם בתשואת מינימום ושיתוף ברווח.', en: 'Capture the value created between a building permit in an urban-renewal project and delivery of completed units: buy five developer units with an upfront payment at c. 24% below expected completed value, or provide the developer’s equity at a minimum return plus a profit share.' },
      whyNow: { he: 'היתר הבנייה התקבל והדיירים פונו; הבנק המלווה מתנה את מסגרת הליווי בהשלמת הון עצמי של ₪9 מיליון, והיזם מעדיף מכירת דירות בהנחה או הון חיצוני על פני דחיית ההריסה.', en: 'The building permit is granted and residents have relocated; the lending bank conditions the construction facility on a ₪9M equity top-up, and the sponsor prefers discounted unit sales or outside equity to delaying demolition.' },
      risks: { he: 'משך ארוך (כ-42 חודשים עד מסירה ומכירה); סיכון ביצוע ועיכובי בנייה; עלות מימון לאורך התקופה; מחיר מכירה עתידי; נזילות נמוכה לפני טופס 4.', en: 'A long duration (c. 42 months to delivery and sale); execution and construction-delay risk; financing cost over the period; future sale price; weak liquidity before the occupancy certificate.' },
      protection: { he: 'הנחת כניסה עמוקה מהשווי הצפוי; ליווי בנקאי סגור עם ערבויות חוק המכר לרוכשים; היתר בנייה בתוקף; מרווח שווי גדול מעל מסגרת הבנק בפרויקט.', en: 'A deep entry discount to expected value; a closed bank construction facility with Sale Law guarantees for buyers; a valid building permit; a large value margin above the bank facility.' },
      exit: { he: 'מסירת הדירות בטופס 4 (כ-36 חודשים) ומכירתן בששת החודשים שאחרי; חלופה — החזקה והשכרה. במבנה המשולב: פירעון מהעודף שאחרי פירעון הבנק.', en: 'Delivery at the occupancy certificate (c. 36 months) and sale in the following six months; fallback — hold and let. In the hybrid: repayment from the surplus after the bank is repaid.' },
    };
    CASES.push({
      id: 'hagefen-renewal', primary: 'buy',
      title: { he: 'התחדשות הגפן — פינוי-בינוי לפני תחילת בנייה', en: 'HaGefen Renewal — Pre-Construction Urban Renewal' },
      category: { he: 'התחדשות עירונית: רכישה מול מבנה משולב', en: 'Urban renewal: BUY vs HYBRID' },
      location: { he: 'רמת גן · מרום נווה', en: 'Ramat Gan · Marom Nave' },
      scale: { he: '5 דירות יזם · שווי צפוי כ-₪23 מיליון', en: '5 developer units · c. ₪23M expected value' },
      thesis: { he: 'ערך שנוצר בין היתר בנייה למסירה — תשואה פוטנציאלית גבוהה מול משך וסיכון ביצוע.', en: 'Value created between permit and delivery — higher potential return against duration and execution risk.' },
      memo,
      deal: {
        schema: 1,
        info: {
          name: 'התחדשות הגפן — 5 דירות יזם בתשלום מקדים', developer: 'מטרו התחדשות עירונית בע״מ', project: 'התחדשות הגפן', city: 'רמת גן', cityCode: '8600',
          neighborhood: 'מרום נווה', address: 'רחוב הגפן (כתובת להמחשה)', unitTypes: '3–6 חדרים במגדל של 132 דירות', constructionStatus: 'permit',
          completionDate: '2030-01-31', startDate: '2027-01-01', source: 'broker', owner: 'צוות החיתום · ALTARIS', developerRating: 'established', createdAt: CREATED,
          notes: memoText(memo),
        },
        units: [
          { label: 'מגדל · קומה 6', rooms: 3, sqm: 82, supported: 3200000, proposed: 2430000 },
          { label: 'מגדל · קומה 11', rooms: 4, sqm: 104, supported: 4000000, proposed: 3040000 },
          { label: 'מגדל · קומה 14', rooms: 4, sqm: 106, supported: 4120000, proposed: 3130000 },
          { label: 'מגדל · קומה 19', rooms: 5, sqm: 127, supported: 4850000, proposed: 3690000 },
          { label: 'מגדל · פנטהאוז, קומה 28', rooms: 6, sqm: 168, supported: 6900000, proposed: 5240000 },
        ],
        price: {},
        value: {
          appraisal: { value: 22400000, note: 'שומה לשווי במצב סופי (מחירי היום) — ' + SCEN_NOTE },
          developer: { value: 24600000, note: 'מחירון היזם למסירה — ' + SCEN_NOTE },
          chosen: 'units',
        },
        buy: {
          taxPct: 8, legalPct: 0.75, dd: 120000, registration: 20000, marketing: 0, otherAcq: 0,
          exitMonth: 42, otherOpex: 1500,
          debtMode: 'ltv', ltvPct: 30, ratePct: 6.25, feePct: 0.75, loanTermMonths: 42, interestMode: 'accrued',
          exitMode: 'haircut', haircutPct: 4, sellBrokeragePct: 1.5, sellLegalPct: 0.5, sellOther: 100000,
          vatPct: 0, profitTaxPct: 23, exitPrimary: 'unit-sales', exitSecondary: 'rental-hold',
        },
        finance: {
          amount: 9000000, collateralValue: 353000000, collateralUnits: 84, ratePct: 13.5, interestMode: 'accrued', feePct: 2, exitFeePct: 1, termMonths: 40, graceMonths: 0, repayment: 'bullet',
          legal: 150000, monitoring: 5000, extMonths: 6, extRatePct: 15, extFeePct: 1,
          haircutPct: 20, seniority: 'second', priorLiens: 210000000, saleCostPct: 3,
          sourcePrimary: 'apartment-sales', sourceSecondary: 'project-refinancing', enforcementMonths: 24, enforcementCostPct: 8,
        },
        hybrid: {
          structure: 'min-return-share', capital: 9000000, maxCommitment: 9000000, feePct: 1.5, couponPct: 0, prefPct: 12, termMonths: 42, salesSpreadMonths: 6,
          participationPct: 30, threshold: 353000000, realizationValue: 353000000, collateralValue: 353000000, optionOn: false, backstopOn: false,
          haircutPct: 20, seniority: 'other', priorLiens: 210000000, saleCostPct: 3,
          triggerNote: 'טופס 4 ושחרור הבטוחות על ידי הבנק המלווה', exitConditions: 'פירעון מהעודף שאחרי פירעון מסגרת הליווי; שיתוף של 30% ברווח שמעל תוכנית העסקית',
          sourcePrimary: 'apartment-sales', sourceSecondary: 'developer-equity', legal: 150000, monitoring: 5000, enforcementMonths: 24, enforcementCostPct: 8,
        },
        scen: {
          downside: { valueShock: -12, delay: 12, rateAdd: 1.5, default: true, enforcementMonths: 24 },
          upside: { valueShock: 5, delay: -3, rateAdd: -0.5 },
        },
        selected: null,
      },
    });
  }

  /* ================================================== 5 · Coastal Portfolio I — institutional rental block */
  {
    const memo = {
      thesis: { he: 'השוואה בין שלוש צורות הון על אותו תיק של 30 דירות מושכרות בשלוש ערי חוף: רכישת הבלוק בהנחה ממונפת, הלוואה בכירה למחזור החוב של הבעלים, או הון מועדף עם אופציה לרכוש 30% מהדירות.', en: 'Compare three forms of capital on the same portfolio of 30 let apartments in three coastal cities: a leveraged discounted block purchase, a senior refinancing loan to the owner, or preferred capital with an option on 30% of the units.' },
      whyNow: { he: 'בלוסטון מבקשת למחזר הון מהתיק המניב לטובת פרויקטי ייזום; ההלוואה הבנקאית על התיק (₪36 מיליון) מגיעה לפירעון בתוך שנה, והבעלים פתוחים למכירת בלוק, למחזור או להון מועדף.', en: 'BlueStone wants to recycle capital from the income portfolio into development; the bank loan on the portfolio (₪36M) matures within a year, and the owner is open to a block sale, a refinancing or preferred capital.' },
      risks: { he: 'תשואת שכירות נמוכה (כ-3% ברוטו) מול עלות מימון; ריכוזיות — עסקה גדולה ביחס לגודל הקרן; מימוש הדרגתי של דירות מושכרות; ירידת ערך בשלוש ערים בו-זמנית.', en: 'A low rental yield (c. 3% gross) against financing cost; concentration — a large deal relative to fund size; gradual realization of let units; value declines in three cities at once.' },
      protection: { he: 'נכסים גמורים ומניבים בתפוסה גבוהה; פיזור בין נתניה, בת ים ואשדוד; שעבוד ראשון (במימון) או אופציה בהנחה (במבנה המשולב); תזרים שכירות שוטף.', en: 'Completed, income-producing assets at high occupancy; spread across Netanya, Bat Yam and Ashdod; a first lien (in the loan) or a discounted option (in the hybrid); running rental income.' },
      exit: { he: 'מכירה הדרגתית של דירות עם תום חוזי השכירות והחל מחודש 18, יציאה מלאה עד חודש 30; חלופה — מכירת התיק במקשה אחת לגוף מוסדי.', en: 'Gradual unit sales as leases expire from month 18, full exit by month 30; fallback — a bulk sale of the portfolio to an institution.' },
    };
    const u = (label, rooms, sqm, supported, proposed) => ({ label, rooms, sqm, supported, proposed });
    CASES.push({
      id: 'coastal-portfolio-i', primary: 'buy',
      title: { he: 'תיק החוף I — בלוק מגורים מניב', en: 'Coastal Portfolio I — Institutional Rental Block' },
      category: { he: 'תיק מניב: רכישה מול מימון מול מבנה משולב', en: 'Income portfolio: BUY vs FINANCE vs HYBRID' },
      location: { he: 'נתניה · בת ים · אשדוד', en: 'Netanya · Bat Yam · Ashdod' },
      scale: { he: '30 דירות מושכרות · שווי נתמך כ-₪88 מיליון', en: '30 let apartments · c. ₪88M supported value' },
      thesis: { he: 'חשיפת אשראי יעילה-בהון מול רכישת נכס ישירה ואופציונליות משולבת — על אותו תיק.', en: 'Capital-efficient credit exposure against outright acquisition and hybrid optionality — on the same portfolio.' },
      memo,
      deal: {
        schema: 1,
        info: {
          name: 'תיק החוף I — 30 דירות מושכרות של בלוסטון', developer: 'בלוסטון החזקות מגורים בע״מ', project: 'תיק החוף I', city: 'נתניה', cityCode: '7400',
          neighborhood: 'קריית השרון · בת ים · אשדוד', address: 'שלושה בניינים בשלוש ערים (כתובות להמחשה)', unitTypes: '3–5 חדרים, בניינים שהושלמו 2019–2022', constructionStatus: 'completed',
          completionDate: '2022-06-30', startDate: '2026-12-15', source: 'bank', owner: 'צוות החיתום · ALTARIS', developerRating: 'established', createdAt: CREATED,
          notes: memoText(memo),
        },
        units: [
          u('נתניה · N-2 · קומה 1', 3, 84, 2280000, 2080000), u('נתניה · N-5 · קומה 2', 4, 104, 2740000, 2490000),
          u('נתניה · N-7 · קומה 3', 4, 106, 2790000, 2540000), u('נתניה · N-9 · קומה 3', 5, 124, 3260000, 2970000),
          u('נתניה · N-12 · קומה 4', 4, 103, 2750000, 2500000), u('נתניה · N-14 · קומה 5', 4, 108, 2900000, 2640000),
          u('נתניה · N-16 · קומה 5', 3, 86, 2350000, 2140000), u('נתניה · N-19 · קומה 6', 5, 128, 3420000, 3110000),
          u('נתניה · N-21 · קומה 7', 4, 105, 2830000, 2580000), u('נתניה · N-24 · קומה 8', 4, 107, 2900000, 2640000),
          u('נתניה · N-27 · קומה 9', 5, 126, 3400000, 3090000), u('נתניה · N-30 · פנטהאוז', 5, 150, 4250000, 3870000),
          u('בת ים · B-3 · קומה 2', 3, 80, 2550000, 2320000), u('בת ים · B-6 · קומה 3', 4, 100, 3150000, 2870000),
          u('בת ים · B-8 · קומה 4', 4, 98, 3120000, 2840000), u('בת ים · B-11 · קומה 5', 4, 102, 3260000, 2970000),
          u('בת ים · B-13 · קומה 6', 3, 82, 2650000, 2410000), u('בת ים · B-16 · קומה 8', 4, 101, 3290000, 2990000),
          u('בת ים · B-18 · קומה 9, נוף לים', 5, 122, 4100000, 3730000), u('בת ים · B-21 · קומה 11', 4, 103, 3400000, 3090000),
          u('בת ים · B-23 · קומה 12', 4, 104, 3450000, 3140000), u('בת ים · B-26 · קומה 14', 5, 125, 4250000, 3870000),
          u('אשדוד · A-2 · קומה 1', 3, 82, 1820000, 1660000), u('אשדוד · A-4 · קומה 2', 4, 104, 2290000, 2080000),
          u('אשדוד · A-7 · קומה 3', 4, 106, 2330000, 2120000), u('אשדוד · A-9 · קומה 4', 5, 125, 2730000, 2480000),
          u('אשדוד · A-12 · קומה 5', 4, 103, 2300000, 2090000), u('אשדוד · A-14 · קומה 6', 4, 105, 2360000, 2150000),
          u('אשדוד · A-17 · קומה 7', 5, 127, 2830000, 2580000), u('אשדוד · A-20 · קומה 9', 4, 104, 2400000, 2180000),
        ],
        price: {},
        value: {
          appraisal: { value: 84200000, note: 'שומת תיק (גישת ההשוואה, דירות פנויות) — ' + SCEN_NOTE },
          developer: { value: 89500000, note: 'מחיר מבוקש של הבעלים — ' + SCEN_NOTE },
          chosen: 'units',
        },
        buy: {
          taxPct: 8, legalPct: 0.4, dd: 250000, brokeragePct: 1, registration: 60000, capex: 450000, renovation: 0, marketing: 0, otherAcq: 0,
          exitMonth: 30, mgmt: 9000, municipal: 0, insurance: 4500, maintenance: 10500, otherOpex: 2500,
          rentOn: true, rent: 210000, occupancy: 95, collection: 98, rentOpexPct: 8,
          debtMode: 'ltv', ltvPct: 55, ratePct: 5.4, feePct: 0.6, loanTermMonths: 36, interestMode: 'current',
          exitMode: 'haircut', haircutPct: 5, sellBrokeragePct: 1.5, sellLegalPct: 0.5, sellOther: 300000,
          vatPct: 0, profitTaxPct: 23, otherTax: 0, exitPrimary: 'unit-sales', exitSecondary: 'bulk-sale',
        },
        finance: {
          amount: 47000000, ratePct: 8.25, interestMode: 'current', feePct: 1, exitFeePct: 0.25, termMonths: 24, graceMonths: 0, repayment: 'bullet',
          legal: 220000, monitoring: 5000, extMonths: 6, extRatePct: 9.75, extFeePct: 0.5,
          haircutPct: 12, seniority: 'first', priorLiens: 0, saleCostPct: 2.5,
          sourcePrimary: 'bank-refinancing', sourceSecondary: 'asset-sale', enforcementMonths: 12, enforcementCostPct: 6,
        },
        hybrid: {
          structure: 'pref', capital: 28000000, maxCommitment: 28000000, feePct: 1.25, couponPct: 4, prefPct: 7, termMonths: 30, salesSpreadMonths: 12,
          participationPct: 15, threshold: 88150000, optionOn: true, optionPrice: 23270000, optionSharePct: 30, backstopOn: false,
          resaleMonths: 6, resaleCostPct: 2.5, resaleHaircutPct: 5,
          haircutPct: 12, seniority: 'second', priorLiens: 36000000, saleCostPct: 2.5,
          triggerNote: 'חודש 30 או מכירת 70% מהדירות — המוקדם מביניהם', exitConditions: 'אופציה על 30% מהדירות ב-88% מהשווי הנתמך; שיתוף של 15% בעליית הערך',
          sourcePrimary: 'asset-sale', sourceSecondary: 'bank-refinancing', legal: 220000, monitoring: 5000, enforcementMonths: 15, enforcementCostPct: 6,
        },
        scen: {
          downside: { valueShock: -10, delay: 6, rateAdd: 1.5, rentChg: -8, opexChg: 10, default: true, enforcementMonths: 15 },
          upside: { valueShock: 4, delay: -3, rateAdd: -0.5, rentChg: 3 },
        },
        selected: null,
      },
    });
  }

  const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
  CASES.forEach(deepFreeze);
  const byId = Object.freeze(Object.fromEntries(CASES.map((c) => [c.id, c])));
  return Object.freeze({ VERSION, NOTICE, LABEL, EXPORT_MARK, CASES: Object.freeze(CASES), byId });
});
