/* ALTARIS · Capital Allocation Engine — page controller.
 * Reads PROPX data read-only (GET only), keeps deals in this browser
 * (localStorage, keys altaris:*), and renders every figure from the pure engine
 * (altaris/engine.js). Nothing here writes to a PROPX endpoint or PROPX state;
 * the one shared preference is the theme (kobix:theme), so both pages match.
 */
(function () {
  'use strict';
  const E = window.AltarisEngine, C = window.AxCharts, F = window.AXF, X = window.AxExport, MD = window.AltarisMethodology, CS = window.AltarisCases;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = F.esc;
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const pad2 = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const TODAY = todayISO();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'd' + Date.now().toString(36) + (performance.now() * 1000 | 0).toString(36));

  /* ------------------------------------------------------------ storage */
  const KEY = { deals: 'altaris:deals:v1', settings: 'altaris:settings:v1', draft: 'altaris:draft:v1', ui: 'altaris:ui:v1' };
  const THEME_KEY = 'kobix:theme';   // the shared PROPX theme preference (read + write, same as PROPX)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  /* ------------------------------------------------------------- labels */
  const SN = { buy: 'BUY', finance: 'FINANCE', hybrid: 'HYBRID' };
  const SH = { buy: 'רכישה', finance: 'מימון מובטח', hybrid: 'מבנה משולב' };
  const SC = C.STRAT_C;
  const OPT = {
    status: [['', '— בחרו —'], ['planning', 'תכנון'], ['permit', 'היתר בנייה'], ['construction', 'בבנייה'], ['completed', 'גמור / מאוכלס']],
    rating: [['unassessed', 'טרם הוערך'], ['tier1', 'יזם מוביל (Tier 1)'], ['established', 'יזם מבוסס'], ['mid', 'יזם בינוני'], ['new', 'יזם חדש / ללא רקורד']],
    source: [['', '— בחרו —'], ['developer', 'פנייה ישירה מהיזם'], ['broker', 'מתווך / יועץ'], ['bank', 'בנק / גוף מממן'], ['network', 'קשרי ALTARIS'], ['other', 'אחר']],
    debtMode: [['ltv', '% ממחיר הרכישה (LTV)'], ['amount', 'סכום קבוע']],
    interestMode: [['current', 'שוטפת — חודשית'], ['accrued', 'נצברת — בפירעון']],
    exitMode: [['haircut', 'שווי נתמך פחות haircut'], ['target', 'מחיר מכירה יעד']],
    seniority: [['first', 'שעבוד ראשון'], ['second', 'שעבוד שני'], ['other', 'אחר / ללא שעבוד']],
    repayment: [['bullet', 'בולט — קרן בסוף'], ['amortizing', 'פירעון קרן שוטף']],
    finSource: [['apartment-sales', 'מכירת דירות'], ['bank-refinancing', 'מחזור בנקאי'], ['project-refinancing', 'מחזור ליווי פרויקט'], ['developer-equity', 'הון עצמי של היזם'], ['asset-sale', 'מכירת הנכס'], ['other', 'אחר']],
    buyExit: [['unit-sales', 'מכירת יחידות בשוק'], ['bulk-sale', 'מכירה במקשה אחת'], ['rental-hold', 'השכרה והמשך החזקה'], ['bank-refinancing', 'מחזור בנקאי'], ['other', 'אחר']],
    structure: [['secured-upside', 'מימון מובטח + השתתפות ברווח'], ['pref', 'הון מועדף (Preferred equity)'], ['finance-option', 'מימון + אופציית רכישה'], ['backstop', 'התחייבות רכישה (Backstop)'],
      ['min-return-share', 'תשואת מינימום + חלוקת רווח'], ['inventory-option', 'אופציה לרכישת מלאי'], ['inventory-facility', 'מסגרת מימון מלאי']],
    dealStatus: [['draft', 'טיוטה'], ['review', 'בבחינה'], ['ic', 'לוועדת השקעות'], ['approved', 'אושר'], ['active', 'פעיל'], ['exited', 'מומש'], ['declined', 'נדחה']],
  };
  const optLabel = (k, v) => { const o = (OPT[k] || []).find((x) => x[0] === v); return o ? o[1] : (v || '—'); };
  const STRUCT_NOTE = {
    'secured-upside': 'ALTARIS מעמידה הלוואה מובטחת בריבית שוטפת, ובנוסף מקבלת חלק מהשווי שמעל סף שנקבע.',
    'pref': 'הון מועדף: תשואה מועדפת נצברת שמשולמת לפני היזם, ובנוסף חלק מהרווח. בדרך כלל ללא שעבוד ראשון.',
    'finance-option': 'הלוואה מובטחת, ובמועד הטריגר ALTARIS רשאית לרכוש את המלאי במחיר האופציה — רק אם המכירה החוזרת עדיפה.',
    'backstop': 'ALTARIS מתחייבת לרכוש מלאי שלא נמכר במחיר ה-backstop, תמורת עמלת התחייבות. ההון מושקע רק אם ההתחייבות מופעלת.',
    'min-return-share': 'תשואת מינימום מובטחת (נצברת) ועוד חלק מהרווח שמעל הסף.',
    'inventory-option': 'מקדמה קטנה תמורת זכות לרכוש מלאי במחיר קבוע במועד הטריגר.',
    'inventory-facility': 'מסגרת מימון למלאי שנפרעת מתקבולי מכירות לאורך תקופת המכירה.',
  };
  const RISK_HE = { entry: 'בסיס כניסה', collateral: 'חוזק בטוחות', liquidity: 'נזילות יציאה', duration: 'משך צפוי', developer: 'סיכון יזם', project: 'סיכון פרויקט', concentration: 'ריכוזיות', protection: 'הגנה מבנית' };
  const VSRC = {
    propx: { l: 'שווי שוק מוערך — PROPX', s: 'נגזר מעסקאות מגורים מדווחות ביישוב / ברחוב' },
    appraisal: { l: 'שומה בלתי תלויה', s: 'שמאי, מועד ומטרת השומה בהערה' },
    developer: { l: 'מחיר מחירון של היזם', s: 'מחיר מבוקש — אינו שווי שוק' },
    comparables: { l: 'שווי לפי עסקאות השוואה', s: 'עסקאות דומות בחדרים ובשטח' },
    ppsqm: { l: 'מחיר למ״ר × שטח כולל', s: 'הזינו ₪ למ״ר' },
    units: { l: 'סכום השווי הנתמך ברמת יחידה', s: 'מטבלת היחידות' },
    manual: { l: 'הערכה ידנית', s: 'חובה לנמק בהערה' },
  };
  const SIG_CLASS = { 'STRONG BUY': 'ok', 'PREFER FINANCE': 'ok', 'PREFER HYBRID': 'ok', 'REVIEW': 'rev', 'DO NOT PROCEED': 'no', 'INCOMPLETE': '' };
  const SIG_HE = { 'STRONG BUY': 'רכישה מומלצת', 'PREFER FINANCE': 'עדיפות למימון', 'PREFER HYBRID': 'עדיפות למבנה משולב', 'REVIEW': 'נדרשת בחינה', 'DO NOT PROCEED': 'לא להתקדם', 'INCOMPLETE': 'חסרים נתונים' };
  const STRESS_HE = { v5: 'שווי יציאה −5%', v10: 'שווי יציאה −10%', v15: 'שווי יציאה −15%', v20: 'שווי יציאה −20%', d6: 'עיכוב יציאה +6 ח׳', d12: 'עיכוב יציאה +12 ח׳', r1: 'עלות חוב +1%', r2: 'עלות חוב +2%' };

  /* --------------------------------------------------------- field specs */
  /* t: nis · pct · mo · num · sel · bool · text · area · date. derived: the default comes from the deal, not an assumption. */
  const FIELDS = {
    buy: [
      { g: 'שווי הנכס ומחיר', f: [
        { k: 'price', l: 'מחיר רכישה', t: 'nis', derived: true, how: 'ברירת המחדל: המחיר המוצע הכולל מטבלת היחידות (או המחיר הכולל שהוזן). ניתן לשנות כאן לחיתום BUY בלבד.' },
      ] },
      { g: 'עלויות עסקה', f: [
        { k: 'taxPct', l: 'מס רכישה', t: 'pct', how: 'הנחת חיתום בלבד — אינה מחושבת לפי מדרגות החוק. יש לאמת מול המבנה המשפטי.' },
        { k: 'legalPct', l: 'שכ״ט עו״ד', t: 'pct' }, { k: 'dd', l: 'בדיקת נאותות', t: 'nis' },
        { k: 'brokeragePct', l: 'תיווך ברכישה', t: 'pct' }, { k: 'registration', l: 'רישום', t: 'nis' },
        { k: 'capex', l: 'Capex', t: 'nis' }, { k: 'renovation', l: 'שיפוץ', t: 'nis' },
        { k: 'marketing', l: 'שיווק', t: 'nis' }, { k: 'otherAcq', l: 'עלויות רכישה אחרות', t: 'nis' },
      ] },
      { g: 'החזקה', f: [
        { k: 'exitMonth', l: 'תקופת החזקה עד היציאה', t: 'mo' },
        { k: 'mgmt', l: 'ניהול נכס', t: 'nis', u: '₪/ח׳' }, { k: 'municipal', l: 'ארנונה ועלויות עירוניות', t: 'nis', u: '₪/ח׳' },
        { k: 'insurance', l: 'ביטוח', t: 'nis', u: '₪/ח׳' }, { k: 'maintenance', l: 'אחזקה', t: 'nis', u: '₪/ח׳' },
        { k: 'otherOpex', l: 'הוצאות שוטפות אחרות', t: 'nis', u: '₪/ח׳' },
      ] },
      { g: 'שכירות בתקופת ההחזקה (אופציונלי)', f: [
        { k: 'rentOn', l: 'לכלול הכנסות שכירות', t: 'bool' },
        { k: 'rent', l: 'שכירות חודשית צפויה', t: 'nis', u: '₪/ח׳', show: (i) => i.rentOn },
        { k: 'occupancy', l: 'תפוסה', t: 'pct', show: (i) => i.rentOn }, { k: 'collection', l: 'גבייה', t: 'pct', show: (i) => i.rentOn },
        { k: 'rentOpexPct', l: 'הוצאות השכרה', t: 'pct', show: (i) => i.rentOn },
      ] },
      { g: 'מימון הרכישה', m: 'debt', f: [
        { k: 'debtMode', l: 'אופן קביעת החוב', t: 'sel', opts: 'debtMode' },
        { k: 'ltvPct', l: 'חוב כ-% מהמחיר (LTV)', t: 'pct', show: (i) => i.debtMode !== 'amount' },
        { k: 'debtAmount', l: 'סכום החוב', t: 'nis', show: (i) => i.debtMode === 'amount' },
        { k: 'ratePct', l: 'ריבית שנתית', t: 'pct', ref: 'boi' }, { k: 'feePct', l: 'עמלות חוב', t: 'pct' },
        { k: 'loanTermMonths', l: 'תקופת ההלוואה', t: 'mo', ph: 'עד היציאה' },
        { k: 'interestMode', l: 'תשלום ריבית', t: 'sel', opts: 'interestMode' },
      ] },
      { g: 'יציאה', m: 'exitValue', f: [
        { k: 'exitMode', l: 'בסיס שווי היציאה', t: 'sel', opts: 'exitMode' },
        { k: 'haircutPct', l: 'Haircut מול השווי הנתמך', t: 'pct', show: (i) => i.exitMode !== 'target' },
        { k: 'targetPrice', l: 'מחיר מכירה יעד', t: 'nis', show: (i) => i.exitMode === 'target' },
        { k: 'sellBrokeragePct', l: 'תיווך במכירה', t: 'pct' }, { k: 'sellLegalPct', l: 'משפטיות ביציאה', t: 'pct' },
        { k: 'sellOther', l: 'עלויות מכירה אחרות', t: 'nis' },
        { k: 'exitPrimary', l: 'יציאה עיקרית', t: 'sel', opts: 'buyExit' }, { k: 'exitSecondary', l: 'יציאה משנית', t: 'sel', opts: 'buyExit' },
      ] },
      { g: 'מסים — הנחות חיתום', tax: true, m: 'taxes', f: [
        { k: 'vatPct', l: 'מע״מ על המכירה', t: 'pct', how: 'שיעור המע״מ הכלול במחיר המכירה; החלק המועבר = מחיר × שיעור ÷ (100 + שיעור).' },
        { k: 'profitTaxPct', l: 'מס חברות / רווח הון / שבח', t: 'pct', how: 'שיעור על הרווח לפני מס. מוצג כשורה נפרדת — התשואות המובילות הן לפני מס על הרווח.' },
        { k: 'otherTax', l: 'מס עסקה / מס אחר', t: 'nis' },
      ] },
    ],
    finance: [
      { g: 'ההלוואה', f: [
        { k: 'amount', l: 'סכום ההלוואה / ההון', t: 'nis', how: 'ברירת המחדל: 60% מהשווי הנתמך — הנחה לשינוי.' },
        { k: 'ratePct', l: 'ריבית שנתית', t: 'pct', ref: 'boi' }, { k: 'interestMode', l: 'תשלום ריבית', t: 'sel', opts: 'interestMode' },
        { k: 'feePct', l: 'עמלת העמדה', t: 'pct' }, { k: 'exitFeePct', l: 'עמלת פירעון', t: 'pct' },
        { k: 'termMonths', l: 'תקופה', t: 'mo' }, { k: 'graceMonths', l: 'גרייס (ריבית נצברת)', t: 'mo' },
        { k: 'repayment', l: 'פירעון קרן', t: 'sel', opts: 'repayment' },
        { k: 'legal', l: 'עלויות משפטיות (ALTARIS)', t: 'nis' }, { k: 'monitoring', l: 'עלות מעקב', t: 'nis', u: '₪/ח׳' },
      ] },
      { g: 'אופציית הארכה', m: 'extension', f: [
        { k: 'extMonths', l: 'תקופת הארכה', t: 'mo' }, { k: 'extRatePct', l: 'ריבית בהארכה', t: 'pct' }, { k: 'extFeePct', l: 'עמלת הארכה', t: 'pct' },
      ] },
      { g: 'בטוחות', f: [
        { k: 'collateralValue', l: 'שווי בטוחות נתמך', t: 'nis', derived: true }, { k: 'collateralUnits', l: 'יחידות משועבדות', t: 'num', derived: true },
        { k: 'haircutPct', l: 'מקדם ביטחון (haircut)', t: 'pct' }, { k: 'seniority', l: 'דרגת שעבוד', t: 'sel', opts: 'seniority' },
        { k: 'priorLiens', l: 'חוב בדרגה קודמת', t: 'nis' }, { k: 'borrowerEquity', l: 'הון עצמי של הלווה', t: 'nis', ph: 'לא הוזן' },
        { k: 'projectCost', l: 'עלות פרויקט (ל-LTC)', t: 'nis', ph: 'לא הוזן' }, { k: 'saleCostPct', l: 'עלויות מימוש של הלווה', t: 'pct' },
      ] },
      { g: 'פירעון ומימוש', f: [
        { k: 'sourcePrimary', l: 'מקור פירעון עיקרי', t: 'sel', opts: 'finSource' }, { k: 'sourceSecondary', l: 'מקור פירעון משני', t: 'sel', opts: 'finSource' },
        { k: 'enforcementMonths', l: 'משך מימוש בטוחות', t: 'mo' }, { k: 'enforcementCostPct', l: 'עלויות מימוש', t: 'pct' },
      ] },
    ],
    hybrid: [
      { g: 'המבנה', f: [{ k: 'structure', l: 'סוג המבנה', t: 'sel', opts: 'structure', wide: true }] },
      { g: 'הון ותשואה חוזית', m: 'committed', f: [
        { k: 'capital', l: 'הון מושקע', t: 'nis' }, { k: 'maxCommitment', l: 'התחייבות הון מקסימלית', t: 'nis' },
        { k: 'feePct', l: 'עמלת הסדר (על ההתחייבות)', t: 'pct' }, { k: 'couponPct', l: 'ריבית / קופון שוטף', t: 'pct' },
        { k: 'prefPct', l: 'תשואה מועדפת נצברת', t: 'pct' }, { k: 'termMonths', l: 'מועד טריגר / מימוש', t: 'mo' },
        { k: 'salesSpreadMonths', l: 'פריסת תקבולי מכירה', t: 'mo', how: '0 = מימוש במועד אחד. ערך חיובי = התקבולים מתפרסים על פני החודשים האחרונים עד המימוש ומשמשים לפירעון שוטף.' },
      ] },
      { g: 'השתתפות ברווח', f: [
        { k: 'participationPct', l: 'שיעור השתתפות', t: 'pct' },
        { k: 'threshold', l: 'סף השתתפות (שווי)', t: 'nis', derived: true, how: 'ALTARIS משתתפת בשווי שמעל הסף. ברירת המחדל: המחיר המוצע (בסיס ההון).' },
        { k: 'realizationValue', l: 'שווי מימוש צפוי', t: 'nis', derived: true },
      ] },
      { g: 'אופציה ו-Backstop', m: 'contingent', f: [
        { k: 'optionOn', l: 'אופציית רכישה', t: 'bool' },
        { k: 'optionPrice', l: 'מחיר האופציה', t: 'nis', derived: true, show: (i) => i.optionOn },
        { k: 'optionSharePct', l: 'חלק המלאי באופציה', t: 'pct', show: (i) => i.optionOn },
        { k: 'backstopOn', l: 'התחייבות רכישה (backstop)', t: 'bool' },
        { k: 'backstopPrice', l: 'מחיר ה-backstop', t: 'nis', show: (i) => i.backstopOn },
        { k: 'backstopUnsoldPct', l: 'מלאי לא מכור במועד (בסיס)', t: 'pct', show: (i) => i.backstopOn },
        { k: 'resaleMonths', l: 'זמן מכירה חוזרת', t: 'mo', show: (i) => i.optionOn || i.backstopOn },
        { k: 'resaleCostPct', l: 'עלויות מכירה חוזרת', t: 'pct', show: (i) => i.optionOn || i.backstopOn },
        { k: 'resaleHaircutPct', l: 'Haircut במכירה חוזרת', t: 'pct', show: (i) => i.optionOn || i.backstopOn },
      ] },
      { g: 'בטוחות', f: [
        { k: 'collateralValue', l: 'שווי בטוחות', t: 'nis', derived: true }, { k: 'haircutPct', l: 'מקדם ביטחון', t: 'pct' },
        { k: 'seniority', l: 'דרגת שעבוד', t: 'sel', opts: 'seniority' }, { k: 'priorLiens', l: 'חוב בדרגה קודמת', t: 'nis' },
        { k: 'saleCostPct', l: 'עלויות מימוש של היזם', t: 'pct' },
      ] },
      { g: 'טריגרים ותנאי יציאה', f: [
        { k: 'triggerNote', l: 'מועדי טריגר', t: 'text', wide: true, ph: 'למשל: טופס 4 · 70% מכירות · מועד קבוע' },
        { k: 'exitConditions', l: 'תנאי יציאה', t: 'text', wide: true, ph: 'למשל: פירעון מתקבולי מכירות, מחזור ליווי' },
        { k: 'sourcePrimary', l: 'מקור מימוש עיקרי', t: 'sel', opts: 'finSource' }, { k: 'sourceSecondary', l: 'מקור מימוש משני', t: 'sel', opts: 'finSource' },
        { k: 'legal', l: 'עלויות משפטיות', t: 'nis' }, { k: 'monitoring', l: 'עלות מעקב', t: 'nis', u: '₪/ח׳' },
        { k: 'enforcementMonths', l: 'משך מימוש בטוחות', t: 'mo' }, { k: 'enforcementCostPct', l: 'עלויות מימוש', t: 'pct' },
      ] },
    ],
  };
  const INFO_FIELDS = [
    { k: 'name', l: 'שם העסקה', t: 'text', top: true },
    { k: 'developer', l: 'יזם', t: 'text' }, { k: 'project', l: 'פרויקט', t: 'text' },
    { k: 'city', l: 'יישוב', t: 'city' }, { k: 'neighborhood', l: 'שכונה', t: 'text' }, { k: 'address', l: 'כתובת', t: 'text' },
    { k: 'unitsCount', l: 'מספר יחידות', t: 'num', ph: 'מטבלת היחידות' }, { k: 'unitTypes', l: 'סוגי יחידות', t: 'text', ph: 'למשל 3–5 חדרים' },
    { k: 'totalSqm', l: 'שטח כולל', t: 'num', u: 'מ״ר', ph: 'מטבלת היחידות' },
    { k: 'constructionStatus', l: 'סטטוס בנייה', t: 'sel', opts: 'status' }, { k: 'completionDate', l: 'מועד השלמה צפוי', t: 'date' },
    { k: 'startDate', l: 'מועד העמדת ההון (T0)', t: 'date', how: 'כל תזרימי המזומנים מתוארכים מחודש 0 = מועד זה; ה-IRR מחושב לפי התאריכים (XIRR).' },
    { k: 'source', l: 'מקור העסקה', t: 'sel', opts: 'source' }, { k: 'owner', l: 'אחראי / אנליסט', t: 'text' },
    { k: 'developerRating', l: 'הערכת היזם (אנליסט)', t: 'sel', opts: 'rating' }, { k: 'createdAt', l: 'נוצר', t: 'ro' },
    { k: 'notes', l: 'הערות', t: 'area', wide: true },
  ];
  const SETTINGS_FIELDS = [
    { g: 'ספי השקעה', m: 'hurdles', f: [
      { k: 'minIrr', l: 'IRR מינימלי', t: 'pct' }, { k: 'minMoic', l: 'MOIC מינימלי', t: 'num', u: 'x' },
      { k: 'minDiscount', l: 'הנחת כניסה מינימלית (BUY)', t: 'pct' }, { k: 'minCoverage', l: 'כיסוי בטוחות מינימלי', t: 'num', u: 'x' },
      { k: 'maxLtv', l: 'LTV מקסימלי', t: 'pct' }, { k: 'maxDuration', l: 'משך מקסימלי', t: 'mo' },
      { k: 'minMos', l: 'מרווח ביטחון מינימלי', t: 'pct' },
    ] },
    { g: 'תקרות חשיפה (מגודל הקרן)', m: 'hurdles', f: [
      { k: 'fundSize', l: 'גודל הקרן', t: 'nis' }, { k: 'maxDevExposure', l: 'חשיפה מקסימלית ליזם', t: 'pct' },
      { k: 'maxProjectExposure', l: 'חשיפה מקסימלית לפרויקט', t: 'pct' }, { k: 'maxGeoExposure', l: 'חשיפה מקסימלית ליישוב', t: 'pct' },
    ] },
    { g: 'מהירות הון ודירוג מבנים', m: 'signal', f: [
      { k: 'fundLifeYears', l: 'חיי הקרן', t: 'num', u: 'שנים' }, { k: 'redeployLagMonths', l: 'זמן עד השקעה חוזרת', t: 'mo' },
      { k: 'downsideWeight', l: 'משקל התרחיש השלילי בדירוג', t: 'pct', how: 'תשואה מותאמת-סיכון = (100% − משקל) × IRR בסיס + משקל × IRR בתרחיש השלילי. המבנה המועדף הוא בעל התשואה המותאמת הגבוהה ביותר מבין העומדים בכל הספים.' },
    ] },
  ];

  /* ------------------------------------------------------------- state */
  const blankDeal = () => ({ schema: 1, info: { createdAt: TODAY, startDate: TODAY, developerRating: 'unassessed' }, units: [], price: {}, value: { chosen: null }, buy: {}, finance: {}, hybrid: {}, scen: {}, selected: null });
  const S = {
    view: 'deal', strat: 'buy', deal: null, dealId: null, settings: store.get(KEY.settings, {}) || {},
    stress: null, R: null, dirty: false, deals: store.get(KEY.deals, {}) || {}, mkt: { status: 'idle' }, mbarOpen: false, cmpVer: {},
    mlang: 'he', mAppendix: true, mfocus: null,
  };
  const VIEWS = ['deal', 'compare', 'portfolio', 'saved', 'settings', 'method'];
  const parseHash = () => { const [v, id] = location.hash.slice(1).split('/'); return { v, id: id ? decodeURIComponent(id) : null }; };
  const getP = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  function setP(o, p, v) {
    const ks = p.split('.'); let a = o;
    for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = {}; a = a[ks[i]]; }
    const last = ks[ks.length - 1];
    if (v === undefined || v === null || v === '') delete a[last]; else a[last] = v;
  }
  const dealName = (d) => (d && ((d.info && d.info.name) || d.name)) || 'עסקה ללא שם';

  /* ------------------------------------------------------------ helpers */
  /* level 1 — a subtle info mark. how(): a one-line tooltip for an input or a figure on this deal.
     mi(): a metric from the methodology — opens the metric popover (level 2), whose link leads to
     the Metric Conventions view (level 3); `live` adds how this deal's figure was computed. */
  const INFO_I = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.3"/><path d="M8 7.3v3.9"/><circle class="d" cx="8" cy="4.9" r=".85"/></svg>';
  const how = (text) => `<button type="button" class="ax-how" data-tip="${esc(text)}" aria-label="איך זה מחושב?">${INFO_I}</button>`;
  const mi = (id, live) => {
    const m = MD.byId[id]; if (!m) return live ? how(live) : '';
    return `<button type="button" class="ax-how ax-mi" data-m="${id}"${live ? ` data-live="${esc(live)}"` : ''} aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(m.name.he)} — בסיס חישוב">${INFO_I}</button>`;
  };
  const infoOf = (o) => (o && o.m ? mi(o.m, o.how) : o && o.how ? how(o.how) : '');
  const modelTag = () => '<span class="ax-tag mdl" title="ציון מודל — אינו הסתברות">MODEL</span>';
  const clsTag = (c, L) => `<span class="ax-cls ${c}">${esc(MD.CLASSES[c][L || 'he'])}</span>`;
  /* the origin of the supported value — PROPX-derived, a user input, or a user override */
  const valueOrigin = (k, src) => (k === 'propx' || k === 'comparables' ? (src && src.auto === false ? 'override' : 'propx') : k === 'manual' ? 'override' : 'user');
  /* illustrative investment cases (altaris/cases.js): synthetic templates loaded into the ordinary deal screen.
     A case is never saved, never enters the portfolio and is judged without other deals as concentration context;
     a working copy is the user's own deal, tagged with the case it came from. */
  const isCase = (d) => !!(d && d.case && CS && CS.byId[d.case.id]);
  const caseOf = (d) => (isCase(d) ? CS.byId[d.case.id] : null);
  const fromCase = (d) => !!(d && d.origin && d.origin.kind === 'illustrative-case');
  const illusKind = () => (isCase(S.deal) ? 'case' : fromCase(S.deal) ? 'copy' : null);
  const ILLUS_COPY_MARK = 'BASED ON AN ILLUSTRATIVE CASE · עותק עבודה של מקרה השקעה להמחשה — נתונים סינתטיים עד שיוחלפו בנתוני עסקה';
  const illusMark = () => (illusKind() === 'case' ? CS.EXPORT_MARK : illusKind() === 'copy' ? ILLUS_COPY_MARK : '');
  const illusBanner = () => (illusKind() ? `<div class="ax-illus" role="note">${esc(illusMark())}</div>` : '');
  const fmtIn = (v, t) => {
    if (v == null || v === '') return '';
    const n = +v;
    if (t === 'nis') return isNum(n) ? F.int(n) : String(v);
    if (t === 'mo') return isNum(n) ? String(Math.round(n)) : String(v);
    if (t === 'pct' || t === 'num') return isNum(n) ? String(+n.toFixed(4)) : String(v);
    return String(v);
  };
  const UNIT = { nis: '₪', pct: '%', mo: 'ח׳' };
  const optsHTML = (key, val) => (OPT[key] || []).map(([v, l]) => `<option value="${esc(v)}"${String(val == null ? '' : val) === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
  function boiRef() {
    const m = window.PROPX_MARKET && window.PROPX_MARKET.indicators && window.PROPX_MARKET.indicators.boiRate;
    if (!m || !isNum(m.value)) return '';
    return `ריבית בנק ישראל ${m.value}% (מאז ${F.date(m.publishedAt)}) · מקור: בנק ישראל, דרך PROPX — לעיון בלבד, אינה מוזנת אוטומטית`;
  }
  function fieldHTML(sp, path, val, isDef) {
    const id = 'f-' + path.replace(/[^\w]/g, '-');
    const tag = sp.t === 'ro' || sp.t === 'city' || path.startsWith('info.') ? '' :
      `<span data-tag="${esc(path)}"${isDef ? '' : ' hidden'}>${sp.derived ? '<span class="ax-tag der">נגזר</span>' : '<span class="ax-asm">הנחה</span>'}</span>`;
    let ctl;
    if (sp.t === 'sel') ctl = `<select id="${id}" data-k="${esc(path)}">${optsHTML(sp.opts, val)}</select>`;
    else if (sp.t === 'bool') ctl = `<label class="ax-switch"><input id="${id}" type="checkbox" data-k="${esc(path)}"${val ? ' checked' : ''}> כן</label>`;
    else if (sp.t === 'text') ctl = `<input id="${id}" type="text" data-k="${esc(path)}" value="${esc(val || '')}" placeholder="${esc(sp.ph || '')}" autocomplete="off">`;
    else if (sp.t === 'area') ctl = `<textarea id="${id}" data-k="${esc(path)}" rows="2">${esc(val || '')}</textarea>`;
    else if (sp.t === 'date') ctl = `<input id="${id}" type="date" data-k="${esc(path)}" value="${esc(val || '')}">`;
    else if (sp.t === 'ro') ctl = `<input id="${id}" type="text" readonly value="${esc(F.date(val))}">`;
    else if (sp.t === 'city') ctl = `<input id="${id}" type="text" data-k="${esc(path)}" data-geo="1" value="${esc(val || '')}" placeholder="חפשו יישוב או רחוב" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="axGeoPop"><div class="ax-geo-pop" id="axGeoPop" role="listbox" hidden></div>`;
    else ctl = `<input id="${id}" class="n" type="text" inputmode="decimal" data-k="${esc(path)}" data-t="${sp.t}" value="${esc(fmtIn(val, sp.t))}" placeholder="${esc(sp.ph || '')}" autocomplete="off">`;
    const u = sp.u || UNIT[sp.t] || '';
    const hint = sp.ref === 'boi' ? boiRef() : sp.hint || '';
    return `<div class="ax-f${isDef ? ' dflt' : ''}${sp.wide ? ' wide' : ''}" data-f="${esc(path)}"><label for="${id}">${esc(sp.l)}${sp.how ? ' ' + how(sp.how) : ''} ${tag}</label><div class="ax-inp">${ctl}${u && sp.t !== 'bool' && sp.t !== 'sel' && sp.t !== 'text' && sp.t !== 'area' && sp.t !== 'date' && sp.t !== 'city' ? `<span class="u">${esc(u)}</span>` : ''}</div>${hint ? `<div class="ax-hint">${esc(hint)}</div>` : ''}</div>`;
  }
  const secHead = (n, title, note, extra) => `<div class="ax-sec-h"><div><h2>${n ? `<span class="stp">${n}</span>` : ''}${esc(title)}</h2>${note ? `<p class="note">${note}</p>` : ''}</div>${extra || ''}</div>`;
  const lr = (label, value, o) => {
    o = o || {};
    const cls = ['ax-lr', o.key ? 'key' : '', o.sub ? 'sub' : '', o.tot ? 'tot' : '', o.txt ? 'txt' : ''].join(' ').trim();   // txt: free text, wraps (never widens the column)
    const vcls = ['v', o.neg ? 'neg' : '', value === '—' ? 'na' : ''].join(' ').trim();
    return `<div class="${cls}"><span class="l">${esc(label)}</span><span class="${vcls}">${esc(value)}</span>${o.how || o.m ? infoOf(o) : '<span></span>'}</div>`;
  };
  const kpi = (label, value, sub, o) => `<div class="ax-kpi"><div class="k">${esc(label)}${o && (o.how || o.m) ? ' ' + infoOf(o) : ''}</div><div class="v${o && o.neg ? ' neg' : ''}">${esc(value)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;
  const needBox = (html) => `<div class="ax-need">${html}</div>`;
  /* the pixel width a chart gets: the main column (minus section padding), or half of it where .ax-res.two goes two-up */
  const CW = (half) => {
    const m = $('#axMain'); const inner = (m ? m.clientWidth : 800) - 38;
    const w = half && window.innerWidth >= 1180 ? (inner - 16) / 2 : inner;
    return Math.max(290, Math.min(860, Math.round(w)));
  };
  const MISSING_HE = {
    smv: 'שווי לצורך חיתום (שלב 2)', 'buy.price': 'מחיר רכישה', 'buy.exitMonth': 'תקופת החזקה', 'buy.targetPrice': 'מחיר מכירה יעד',
    'finance.amount': 'סכום ההלוואה', 'finance.collateralValue': 'שווי הבטוחות', 'finance.termMonths': 'תקופת ההלוואה',
    'hybrid.realizationValue': 'שווי מימוש צפוי', 'hybrid.termMonths': 'מועד הטריגר', 'hybrid.capital': 'הון מושקע', 'hybrid.optionPrice': 'מחיר האופציה', 'hybrid.backstopPrice': 'מחיר ה-backstop',
    'hybrid.threshold': 'סף ההשתתפות (שווי)',
  };
  const missingTxt = (m) => (m || []).map((k) => MISSING_HE[k] || k).join(' · ');

  /* ------------------------------------------------------------ toast + tip */
  let toastT = null;
  function toast(msg) {
    let t = $('#axToast');
    if (!t) { t = document.createElement('div'); t.id = 'axToast'; t.className = 'ax-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const tipEl = () => $('#axTip');
  function showTip(target) {
    const text = target.getAttribute('data-tip'); if (!text) return;
    const tip = tipEl(); tip.textContent = text; tip.hidden = false;
    const r = target.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => { const t = tipEl(); if (t) t.hidden = true; };

  /* ------------------------------------------- metric popover (level 2) */
  const mlang = () => (S.mlang === 'en' ? 'en' : 'he');
  /* bidi isolation: in Hebrew text every Latin run (IRR, MOIC, LTV, XIRR, BUY, T0 …) is wrapped in
     <bdi>; in English text every Hebrew run is. Split first, then escape each piece. */
  const BIDI_RE = { he: /(?<![0-9A-Za-z.])[A-Za-z][A-Za-z0-9]*(?:[.\-+/][A-Za-z0-9]+)*(?: [A-Z][A-Za-z0-9]*(?:[.\-+/][A-Za-z0-9]+)*)*/g, en: /[\u0590-\u05FF][\u0590-\u05FF\u05F3\u05F4"'\-]*(?: [\u0590-\u05FF][\u0590-\u05FF\u05F3\u05F4"'\-]*)*/g };
  function bidi(text, L) {
    const s = String(text == null ? '' : text), re = BIDI_RE[L === 'en' ? 'en' : 'he'];
    let out = '', i = 0;
    for (const m of s.matchAll(re)) { out += esc(s.slice(i, m.index)) + '<bdi>' + esc(m[0]) + '</bdi>'; i = m.index + m[0].length; }
    return out + esc(s.slice(i));
  }
  const POP = { trigger: null, pinned: false, t: 0 };
  const popEl = () => $('#axPop');
  const sheetMode = () => !!(window.matchMedia && matchMedia('(hover: none), (max-width: 640px)').matches);
  const hurdleSpec = (k) => MD.byId.hurdles.hurdles.find((x) => x.k === k) || {};
  const fmtHv = (h, v) => (!isNum(v) ? '—' : h.fmt === 'pct' ? F.pct(v) : h.fmt === 'x' ? F.x(v) : h.fmt === 'months' ? F.mo(v) : String(v));
  function hurdlePopHTML(k, L) {
    const s = S.R && S.R.strategies[k]; if (!s || !s.base.ok) return '';
    const hs = s.hurdles, pass = hs.filter((h) => h.pass).length, en = L === 'en';
    const name = (h) => (hurdleSpec(h.k).name ? hurdleSpec(h.k).name[L] : E.HURDLE_HE[h.k] || h.k);
    const rows = hs.map((h) => {
      const sp = hurdleSpec(h.k), op = sp.dir === 'max' ? '≤' : '≥';
      return `<tr class="${h.pass ? 'ok' : 'fail'}"><td>${bidi(name(h), L)}</td><td class="n"><bdi dir="ltr">${esc(op + ' ' + fmtHv(h, h.limit))}</bdi></td><td class="n"><bdi dir="ltr">${esc(fmtHv(h, h.value))}</bdi></td><td class="r">${h.pass ? (en ? '✓ pass' : '✓ עובר') : (en ? '✗ fail' : '✗ נכשל')}</td></tr>`;
    }).join('');
    const fails = hs.filter((h) => !h.pass);
    return `<div class="ax-pop-h"><b>${esc(SN[k])} · ${en ? 'Fund hurdles' : 'ספי קרן'} <bdi class="num">${pass}/${hs.length}</bdi></b><button type="button" class="ax-pop-x" data-pop-close aria-label="${en ? 'Close' : 'סגירה'}">×</button></div>
      <p class="ax-pop-s">${fails.length ? (en ? `Not met (${fails.length}): ` : `לא מתקיים (${fails.length}): `) + fails.map((h) => bidi(name(h), L)).join(', ') : (en ? 'Every hurdle is met on the base scenario.' : 'כל הספים מתקיימים בתרחיש הבסיס.')}</p>
      <div class="ax-pop-tbl"><table><thead><tr><th>${en ? 'Hurdle' : 'תנאי'}</th><th class="n">${en ? 'Threshold' : 'סף'}</th><th class="n">${en ? 'Actual' : 'בפועל'}</th><th>${en ? 'Result' : 'תוצאה'}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="ax-pop-f"><span class="ax-muted">${en ? 'Thresholds: fund settings' : 'הספים: הגדרות הקרן'}</span><a href="#method/hurdles" data-mgo="hurdles">${en ? 'View calculation basis ›' : 'בסיס החישוב המלא ›'}</a></div>`;
  }
  function casesPopHTML(L) {
    const en = L === 'en', cur = S.deal && S.deal.case && S.deal.case.id;
    return `<div class="ax-pop-h"><b>${en ? 'Investment Cases' : 'מקרי השקעה'}</b><button type="button" class="ax-pop-x" data-pop-close aria-label="${en ? 'Close' : 'סגירה'}">×</button></div>
      <p class="ax-pop-s">${esc(CS.NOTICE[L])}</p>
      <div class="ax-cases">${CS.CASES.map((c, i) => `<button type="button" class="ax-case" data-case-open="${esc(c.id)}"${cur === c.id ? ' aria-current="true"' : ''}><span class="n">${i + 1}</span><span class="b"><b>${bidi(c.title[L], L)}</b><span class="m">${bidi(c.category[L], L)} · ${bidi(c.location[L], L)} · ${bidi(c.scale[L], L)}</span><span class="t">${bidi(c.thesis[L], L)}</span></span></button>`).join('')}</div>`;
  }
  function popHTML(trigger) {
    const L = mlang(), en = L === 'en';
    if (trigger.dataset.cases != null) return casesPopHTML(L);
    if (trigger.dataset.hurdles) return hurdlePopHTML(trigger.dataset.hurdles, L);
    const m = MD.byId[trigger.dataset.m]; if (!m) return '';
    const live = trigger.dataset.live;
    return `<div class="ax-pop-h"><b>${bidi(MD.t(m.name, L), L)}</b>${m.id === 'riskScore' ? modelTag() : ''}<button type="button" class="ax-pop-x" data-pop-close aria-label="${en ? 'Close' : 'סגירה'}">×</button></div>
      <p class="ax-pop-s">${bidi(MD.t(m.short, L), L)}</p>
      ${live ? `<div class="ax-pop-live"><span class="k">${en ? 'This deal' : 'בעסקה זו'}</span><span class="t" dir="rtl" lang="he">${esc(live)}</span></div>` : ''}
      <div class="ax-pop-f"><span></span><a href="#method/${m.id}" data-mgo="${m.id}">${en ? 'View calculation basis ›' : 'בסיס החישוב המלא ›'}</a></div>`;
  }
  function openPop(trigger, pin) {
    const el = popEl(); if (!el) return;
    clearTimeout(POP.t);
    if (POP.trigger && POP.trigger !== trigger) POP.trigger.setAttribute('aria-expanded', 'false');
    const html = popHTML(trigger); if (!html) return;
    const L = mlang();
    POP.trigger = trigger; POP.pinned = !!pin;
    hideTip();
    el.innerHTML = html; el.dir = L === 'en' ? 'ltr' : 'rtl'; el.lang = L;
    el.setAttribute('aria-label', trigger.getAttribute('aria-label') || '');
    const sheet = sheetMode();
    el.classList.toggle('sheet', sheet); el.classList.toggle('wide', !!trigger.dataset.hurdles); el.classList.toggle('cases', trigger.dataset.cases != null);
    el.style.left = el.style.top = '';
    el.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    const bd = $('#axPopBd'); if (bd) bd.hidden = !sheet;   // a phone: a bottom sheet over a scrim; tapping the scrim closes it
    if (!sheet) placePop();
    if (pin) el.focus({ preventScroll: true });
  }
  /* anchored next to its mark; follows the mark while the page scrolls, closes once the mark leaves the screen */
  function placePop() {
    const el = popEl(), t = POP.trigger; if (!el || el.hidden || !t || el.classList.contains('sheet')) return;
    const r = t.getBoundingClientRect();
    if (!t.isConnected || r.bottom < 0 || r.top > window.innerHeight) { closePop(false); return; }
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  function closePop(back) {
    const el = popEl(); clearTimeout(POP.t);
    if (!el || el.hidden) return;
    el.hidden = true;
    const bd = $('#axPopBd'); if (bd) bd.hidden = true;
    const t = POP.trigger; POP.trigger = null; POP.pinned = false;
    if (t) { t.setAttribute('aria-expanded', 'false'); if (back && t.isConnected) t.focus({ preventScroll: true }); }
  }
  const popLater = () => { clearTimeout(POP.t); POP.t = setTimeout(() => { if (!POP.pinned) closePop(false); }, 220); };

  /* ------------------------------------------------------------- shell */
  function renderShell() {
    $$('#axTabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === S.view)));
    const n = Object.values(S.deals).filter((d) => !d.archived).length;
    const cnt = $('#axTabs [data-view="saved"] .n'); if (cnt) cnt.textContent = n ? String(n) : '';
    $('#axLayout').classList.toggle('wide', S.view !== 'deal');
    $('#axSteps').hidden = S.view !== 'deal';
    $('#axSettingsBtn').classList.toggle('on', S.view === 'settings');
    const mb = $('#axMethodBtn'); if (mb) mb.classList.toggle('on', S.view === 'method');
    document.body.classList.toggle('has-mbar', S.view === 'deal');
    $('#axMbar').hidden = S.view !== 'deal';
    store.set(KEY.ui, { view: S.view, strat: S.strat, mlang: S.mlang, mAppendix: S.mAppendix });
  }
  function renderView() {
    closePop(false);
    renderShell();
    const main = $('#axMain');
    if (S.view === 'deal') main.innerHTML = viewDeal();
    else if (S.view === 'compare') main.innerHTML = '<div id="o-compare"></div>';
    else if (S.view === 'portfolio') main.innerHTML = '<div id="o-portfolio"></div>';
    else if (S.view === 'saved') main.innerHTML = '<div id="o-saved"></div>';
    else if (S.view === 'settings') main.innerHTML = viewSettings();
    else if (S.view === 'method') main.innerHTML = viewMethod();
    recompute(true);
    if (S.view === 'method') focusMethod();
  }

  /* ===================================================== view: new deal */
  function viewDeal() {
    const d = S.deal, info = d.info || {};
    const empty = !info.name && !(d.units || []).length && !d.value.chosen;
    const intro = empty ? `<div class="ax-sec" style="box-shadow:none;background:var(--panel-2)"><div class="ax-sec-h" style="margin:0"><div><h2 class="nb">עסקה חדשה</h2><p class="note">הזינו את פרטי העסקה ואת היחידות, בחרו את השווי לצורך חיתום, וה-ledger מימין יענה על חמש השאלות בזמן אמת. לחלופין, פתחו עסקה לדוגמה כדי לראות את המנוע בפעולה.</p></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="ax-btn" type="button" data-act="example">פתחו עסקה לדוגמה</button><button class="ax-btn" type="button" data-cases aria-haspopup="dialog" aria-expanded="false">מקרי השקעה</button></div></div></div>` : '';
    const ex = d.example ? `<div class="ax-disc" style="margin:0">עסקה לדוגמה — נתונים להמחשה בלבד, אינם עסקה אמיתית ואינם נתוני שוק.</div>` : '';
    return intro + ex + caseNoteHTML() + secDeal() + secValue() + secStruct() + secStress() + secDecide();
  }
  function caseNoteHTML() {
    const c = caseOf(S.deal);
    if (c) {
      const m = c.memo, rows = [['תזת ההשקעה', m.thesis], ['למה עכשיו', m.whyNow], ['סיכונים מרכזיים', m.risks], ['הגנה מרכזית', m.protection], ['מסלול יציאה', m.exit]];
      return `<div class="ax-case-note" role="note"><div class="h"><span class="ax-tag ill">${esc(CS.LABEL.he)}</span><b>${esc(c.title.he)}</b><span class="ax-muted">${esc(c.category.he)} · ${esc(c.location.he)} · ${esc(c.scale.he)}</span></div>
        <p>${esc(CS.NOTICE.he)} ALTARIS לא קבעה מראש מבנה מועדף — כל התוצאות מחושבות במנוע הרגיל.</p>
        <details><summary>מזכר ועדה — תזה, עיתוי, סיכונים, הגנה ויציאה</summary><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${bidi(v.he, 'he')}</dd>`).join('')}</dl></details>
        <div class="act"><button type="button" class="ax-btn pri" data-act="case-copy">יצירת עותק עבודה</button><button type="button" class="ax-btn" data-cases aria-haspopup="dialog" aria-expanded="false">מקרה אחר</button><button type="button" class="ax-btn" data-act="case-exit">יציאה לעסקה חדשה</button></div></div>`;
    }
    if (fromCase(S.deal)) return `<div class="ax-disc" style="margin:0">עותק עבודה של מקרה השקעה להמחשה — הנתונים סינתטיים עד שיוחלפו בנתוני עסקה אמיתיים.</div>`;
    return '';
  }
  function secDeal() {
    const d = S.deal, info = d.info || {};
    const fields = INFO_FIELDS.map((sp) => fieldHTML(sp, 'info.' + sp.k, info[sp.k], false)).join('');
    return `<section class="ax-sec" id="s-deal">${secHead(1, 'פרטי העסקה', 'עסקה של יחידה אחת, בלוק דירות או עסקה של כמה יחידות שונות. השורות ברמת יחידה מחשבות את הסיכומים אוטומטית.')}
      <div class="ax-fields">${fields}</div>
      <h3 class="ax-h3">יחידות בעסקה <span class="ax-muted">— שווי נתמך ומחיר מוצע לכל יחידה</span></h3>
      <div class="ax-tbl-wrap"><table class="ax-tbl" id="axUnits"><thead><tr><th>יחידה</th><th class="n">חדרים</th><th class="n">שטח מ״ר</th><th class="n">שווי נתמך ₪</th><th class="n">מחיר מוצע ₪</th><th class="n">הנחה</th><th class="n">₪/מ״ר נתמך</th><th class="n">₪/מ״ר מוצע</th><th><span class="sr">הסרה</span></th></tr></thead>
      <tbody>${unitRows()}</tbody><tfoot id="o-utot"></tfoot></table></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="ax-btn" type="button" data-act="unit-add">+ הוספת יחידה</button><button class="ax-btn" type="button" data-act="unit-add5">+ 5 יחידות</button></div>
      <div class="ax-fields" style="margin-top:8px">${fieldHTML({ k: 'total', l: 'מחיר מוצע כולל (כשאין פירוט יחידות, או לעקיפת סכום השורות)', t: 'nis', ph: 'סכום השורות' }, 'price.total', d.price && d.price.total, false)}</div>
    </section>`;
  }
  function unitRows() {
    return (S.deal.units || []).map((u, i) => `<tr data-row="${i}">
      <td><input type="text" data-u="${i}:label" value="${esc(u.label || '')}" placeholder="יחידה ${i + 1}" aria-label="שם יחידה ${i + 1}"></td>
      <td><input class="n" type="text" inputmode="decimal" data-u="${i}:rooms" value="${esc(fmtIn(u.rooms, 'num'))}" aria-label="חדרים" style="width:56px"></td>
      <td><input class="n" type="text" inputmode="decimal" data-u="${i}:sqm" value="${esc(fmtIn(u.sqm, 'num'))}" aria-label="שטח" style="width:70px"></td>
      <td><input class="n" type="text" inputmode="decimal" data-u="${i}:supported" value="${esc(fmtIn(u.supported, 'nis'))}" aria-label="שווי נתמך"></td>
      <td><input class="n" type="text" inputmode="decimal" data-u="${i}:proposed" value="${esc(fmtIn(u.proposed, 'nis'))}" aria-label="מחיר מוצע"></td>
      <td class="n" data-uc="${i}:disc">—</td><td class="n" data-uc="${i}:psm">—</td><td class="n" data-uc="${i}:ppsm">—</td>
      <td><button type="button" class="ax-x" data-act="unit-del" data-i="${i}" aria-label="הסרת יחידה ${i + 1}">×</button></td></tr>`).join('');
  }
  function paintUnits() {
    const us = S.deal.units || [];
    us.forEach((u, i) => {
      const sup = E.num(u.supported), pr = E.num(u.proposed), sq = E.num(u.sqm);
      const set = (k, v) => { const c = $(`[data-uc="${i}:${k}"]`); if (c) c.textContent = v; };
      set('disc', sup && pr ? F.pct(1 - pr / sup) : '—'); set('psm', sup && sq ? F.int(sup / sq) : '—'); set('ppsm', pr && sq ? F.int(pr / sq) : '—');
    });
    const ft = $('#o-utot'); if (!ft) return;
    const Fx = S.R.facts;
    const sup = Fx.unitSupportedSum, pr = Fx.unitProposedSum, sq = us.reduce((s, u) => s + (E.num(u.sqm) || 0), 0);
    ft.innerHTML = us.length ? `<tr><td>סה״כ · ${us.length} יחידות</td><td></td><td class="n">${sq ? F.int(sq) : '—'}</td><td class="n">${F.nis(sup)}</td><td class="n">${F.nis(pr)}</td><td class="n">${sup && pr ? F.pct(1 - pr / sup) : '—'}</td><td class="n">${sup && sq ? F.int(sup / sq) : '—'}</td><td class="n">${pr && sq ? F.int(pr / sq) : '—'}</td><td></td></tr>` : `<tr><td colspan="9" class="ax-muted" style="font-weight:500">אין שורות יחידה — הוסיפו יחידות, או הזינו מחיר כולל ושטח כולל.</td></tr>`;
  }

  /* --------------------------------------------- section 2: supported value */
  function secValue() {
    const V = S.deal.value || {};
    const rows = E.VALUE_SOURCES.map((k) => {
      const src = V[k] || {};
      const valInput = k === 'units'
        ? `<input class="n" type="text" readonly data-vro="units" value="" aria-label="${esc(VSRC[k].l)}">`
        : k === 'ppsqm'
          ? `<div class="ax-inp"><input class="n" type="text" inputmode="decimal" data-v="ppsqm.psm" value="${esc(fmtIn(src.psm, 'nis'))}" aria-label="מחיר למ״ר"><span class="u">₪/מ״ר</span></div>`
          : `<input class="n" type="text" inputmode="decimal" data-v="${k}.value" value="${esc(fmtIn(src.value, 'nis'))}" aria-label="${esc(VSRC[k].l)}">`;
      const tags = k === 'developer' ? '<span class="ax-tag warn">לא שווי שוק</span>' : k === 'propx' || k === 'comparables' ? `<span data-vtag="${k}"></span>` : '';
      return `<div class="ax-vsrc${V.chosen === k ? ' chosen' : ''}" data-src="${k}">
        <input type="radio" name="vchosen" value="${k}"${V.chosen === k ? ' checked' : ''} aria-label="בחירת ${esc(VSRC[k].l)} כשווי לצורך חיתום">
        <div class="lb">${esc(VSRC[k].l)} ${tags}<small>${esc(VSRC[k].s)}</small></div>
        ${valInput}
        ${k === 'units' ? '<span class="ax-muted">מחושב מטבלת היחידות</span>' : `<input class="t" type="text" data-v="${k}.note" value="${esc(src.note || '')}" placeholder="${k === 'manual' ? 'נימוק (חובה)' : 'מקור / הערה'}" aria-label="הערה">`}
        <div class="basis" data-vbasis="${k}"></div></div>`;
    }).join('');
    return `<section class="ax-sec" id="s-value">${secHead(2, 'שווי נתמך', 'בחרו במפורש את <b>השווי לצורך חיתום</b>. מחיר המחירון של היזם לעולם אינו נלקח כשווי שוק כברירת מחדל; כל ערך ניתן לעקיפה ידנית עם הערה.')}
      <div role="radiogroup" aria-label="שווי לצורך חיתום">${rows}</div>
      <div id="o-vstrip"></div>
      <details class="ax-mkt" id="axMkt"${S.deal.market ? ' open' : ''}><summary>נתוני שוק מ-PROPX <span class="ax-muted" style="font-weight:500">— קריאה בלבד</span></summary><div class="ax-mkt-b" id="o-mkt"></div></details>
    </section>`;
  }
  function paintValue() {
    const R = S.R, Fx = R.facts, V = S.deal.value || {};
    for (const k of E.VALUE_SOURCES) {
      const row = $(`.ax-vsrc[data-src="${k}"]`); if (!row) continue;
      const v = Fx.sources[k];
      const radio = $('input[type=radio]', row);
      radio.disabled = !(v > 0); radio.checked = V.chosen === k;
      row.classList.toggle('chosen', V.chosen === k && v > 0);
      const b = $(`[data-vbasis="${k}"]`, row);
      const src = V[k] || {};
      let basis = '';
      if (k === 'units') { const ro = $('[data-vro="units"]', row); if (ro) ro.value = v ? F.int(v) : ''; basis = v ? `${Fx.rows} יחידות` : 'נדרש שווי נתמך בכל שורת יחידה'; }
      else if (k === 'ppsqm') basis = Fx.sqm ? (v ? `${F.int(src.psm)} ₪/מ״ר × ${F.int(Fx.sqm)} מ״ר = ${F.nis(v)}` : `שטח כולל: ${F.int(Fx.sqm)} מ״ר`) : 'נדרש שטח כולל (שלב 1)';
      else if ((k === 'propx' || k === 'comparables') && src.basis) basis = (src.auto !== false && src.psm ? `${F.int(src.psm)} ₪/מ״ר × ${Fx.sqm ? F.int(Fx.sqm) + ' מ״ר' : 'שטח לא הוזן'} · ` : '') + src.basis + (src.auto === false ? ' · נערך ידנית' : '');
      if (V.chosen === k && v > 0) basis = (basis ? basis + ' · ' : '') + 'נבחר לחיתום';
      if (b) b.textContent = basis;
      if (k === 'propx' || k === 'comparables') {   // auto-filled from PROPX after the inputs were drawn: keep the box in step
        const inp = $(`[data-v="${k}.value"]`, row);
        if (inp && document.activeElement !== inp) inp.value = fmtIn(src.auto !== false ? Fx.sources[k] : src.value, 'nis');
      }
      const vt = $(`[data-vtag="${k}"]`, row);
      if (vt) vt.innerHTML = src.basis ? (src.auto === false ? '<span class="ax-tag usr">נערך ידנית</span>' : '<span class="ax-tag der">נגזר · PROPX</span>') : '';
    }
    const box = $('#o-vstrip'); if (!box) return;
    if (!Fx.smv) {
      const avail = E.VALUE_SOURCES.filter((k) => Fx.sources[k] > 0);
      box.innerHTML = `<div class="ax-strip"><div><div class="k">שווי נתמך</div><div class="v" style="color:var(--ink-3)">לא נבחר</div><div class="s">${avail.length ? 'בחרו מקור בעמודת הבחירה' : 'הזינו לפחות מקור שווי אחד'}</div></div><div><div class="k">בסיס רכישה / הון</div><div class="v">${F.m(Fx.basis)}</div></div><div><div class="k">הפרש</div><div class="v">—</div></div><div><div class="k">הנחת כניסה</div><div class="v">—</div></div></div>`;
      paintMarket();   // the PROPX data block is one of the value sources: it must be reachable before a value is chosen
      return;
    }
    const spread = Fx.spread != null ? ` · פער בין מקורות בלתי תלויים: ${F.pct(Fx.spread, 0)}` : '';
    box.innerHTML = `<div class="ax-strip">
      <div><div class="k">שווי נתמך ${mi('supportedValue', 'השווי שנבחר במפורש לצורך חיתום: ' + VSRC[Fx.chosen].l + '.')}</div><div class="v">${F.m(Fx.smv)}</div><div class="s">${esc(VSRC[Fx.chosen].l)} ${clsTag(valueOrigin(Fx.chosen, V[Fx.chosen]))}</div></div>
      <div><div class="k">בסיס רכישה / הון ${how('המחיר המוצע הכולל: ' + (Fx.basisFrom === 'total' ? 'הוזן כמחיר כולל.' : Fx.basisFrom === 'units' ? 'סכום המחיר המוצע בשורות היחידות.' : 'לא הוזן.'))}</div><div class="v">${F.m(Fx.basis)}</div><div class="s">${Fx.basisFrom === 'units' ? 'סכום שורות היחידות' : Fx.basisFrom === 'total' ? 'מחיר כולל' : 'לא הוזן'}</div></div>
      <div><div class="k">הפרש</div><div class="v">${F.m(Fx.diff)}</div><div class="s">שווי נתמך − בסיס</div></div>
      <div><div class="k">הנחת כניסה ${mi('entryDiscount', '(שווי נתמך − בסיס) ÷ שווי נתמך')}</div><div class="v${Fx.discount < 0 ? ' neg' : ''}">${F.pct(Fx.discount)}</div><div class="s">${Fx.sqm ? F.int(Fx.smv / Fx.sqm) + ' ₪/מ״ר נתמך' : ''}${esc(spread)}</div></div></div>`;
    paintMarket();
  }

  /* ----------------------------------------- PROPX market data (read only) */
  const getJSON = (u) => fetch(u, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' }).then((r) => {
    if (r.redirected && /login/.test(r.url)) throw new Error('נדרשת התחברות מחדש ל-PROPX');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
  const median = (a) => { if (!a.length) return null; const x = a.slice().sort((p, q) => p - q); const m = x.length >> 1; return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };
  const quant = (a, q) => { if (!a.length) return null; const x = a.slice().sort((p, r) => p - r); const i = (x.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return x[lo] + (x[hi] - x[lo]) * (i - lo); };
  function summarizeTx(d) {
    const val = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
    const rows = (d.transactions || []).filter((t) => t.price && t.sourceFamily === 'OFFICIAL_GOVERNMENT' && t.propertyClass === 'residential');
    const psmOf = (t) => { if (t.partialSale) return null; const p = val(t.pricePerSqm), a = val(t.areaSqm); return p || (a ? t.price / a : null); };
    const priced = rows.map((t) => ({ t, psm: psmOf(t), area: val(t.areaSqm) })).filter((x) => x.psm > 0);
    const isNew = (x) => x.t.newness === 'confirmed_new' || x.t.newness === 'probable_new';
    const newOnes = priced.filter(isNew);
    const units = (S.deal.units || []).filter((u) => E.num(u.sqm) > 0);
    let comps = [];
    if (units.length) {
      const sq = units.map((u) => E.num(u.sqm)), rooms = units.map((u) => E.num(u.rooms)).filter((r) => r > 0);
      const lo = Math.min(...sq) * 0.8, hi = Math.max(...sq) * 1.2;
      comps = priced.filter((x) => x.area >= lo && x.area <= hi && (!rooms.length || rooms.some((r) => x.t.rooms && Math.abs(x.t.rooms - r) <= 0.5)));
    }
    const dates = priced.map((x) => x.t.date).filter(Boolean).sort();
    const m = d.meta || {};
    return {
      n: priced.length, nAll: rows.length, median: median(priced.map((x) => x.psm)), p25: quant(priced.map((x) => x.psm), 0.25), p75: quant(priced.map((x) => x.psm), 0.75),
      newN: newOnes.length, newMedian: median(newOnes.map((x) => x.psm)),
      compsN: comps.length, compsMedian: median(comps.map((x) => x.psm)),
      comps: comps.slice(0, 12).map((x) => ({ date: x.t.date, street: x.t.street, house: x.t.houseNumber, rooms: x.t.rooms, area: x.area, price: x.t.price, psm: Math.round(x.psm), isNew: isNew(x) })),
      from: dates[0] || null, to: dates[dates.length - 1] || null, via: m.deliveredVia || null, channel: m.channel || null,
      snapshotAt: m.snapshotAt || null, scope: d.scope ? (d.scope.level || d.scope.label || null) : null, more: !!(m.sourceCoverage && m.sourceCoverage.more),
    };
  }
  const viaTxt = (tx) => (tx.via === 'over.org.il' ? 'רשומות רשות המסים · באמצעות גרסאות לעם — פרסום עצמאי, לא ערוץ ממשלתי' : tx.via === 'GovMap' ? 'רשות המסים · GovMap' : 'רשות המסים');
  async function loadMarket() {
    const info = S.deal.info || {};
    if (!info.city) { toast('בחרו יישוב בשלב 1 כדי לטעון נתוני שוק'); return; }
    S.mkt = { status: 'loading' }; paintMarket();
    const target = S.deal;   // the deal that asked; a reply after the user opened another deal is dropped
    const out = { retrievedAt: new Date().toISOString(), city: info.city, cityCode: info.cityCode || null, street: info.street || null };
    const q = new URLSearchParams({ city: info.city, months: '24', limit: '200' });
    if (info.street) q.set('street', info.street);
    const jobs = [getJSON('/api/gov/transactions?' + q).then((d) => { out.tx = summarizeTx(d); }).catch((e) => { out.txError = e.message; })];
    if (info.cityCode) {
      jobs.push(getJSON(`/api/land?view=summary&city=${encodeURIComponent(info.cityCode)}&scope=current&residential=1&limit=1`).then((d) => {
        const k = d.kpis || {}; out.land = { tenders: k.tenders, unitsOpen: k.unitsOpen, unitsResidential: k.unitsResidential, unitsPendingDecision: k.unitsPendingDecision, unitsAwarded: k.unitsAwarded, currentFrom: d.scope && d.scope.currentFrom };
      }).catch((e) => { out.landError = e.message; }));
      jobs.push(getJSON(`/api/housing?view=summary&city=${encodeURIComponent(info.cityCode)}&period=all`).then((d) => {
        const k = d.kpis || {}; out.housing = { lotteries: k.lotteries, projects: k.projects, units: k.unitsFirst, medianPricePerSqm: k.medianPricePerSqm, from: d.coverage && d.coverage.coveredFrom, to: d.coverage && d.coverage.coveredTo };
      }).catch((e) => { out.housingError = e.message; }));
      /* the city's observed project pipeline (MoCH lottery projects + awarded ILA residential lots — never joined) and
         the developers whose first observed activity here is recent — PROPX OBSERVED / DERIVED context, read-only */
      jobs.push(getJSON(`/api/intel?view=projects&city=${encodeURIComponent(info.cityCode)}&sort=date&size=5`).then((d) => {
        out.pipeline = { total: d.total, stageCounts: d.stageCounts || {}, recent: (d.rows || []).map((r) => ({ id: r.id, kind: r.kind, name: r.name || (r.tender ? `מכרז ${r.tender}` : null), developer: r.developerName || null,
          units: r.kind === 'ila-awarded-lot' ? r.units : r.unitsFirstLottery, date: r.kind === 'ila-awarded-lot' ? r.decisionDate : r.lastLotteryDate, stage: r.stage })), basis: d.basis };
      }).catch((e) => { out.pipelineError = e.message; }));
      jobs.push(getJSON(`/api/intel?view=signals&city=${encodeURIComponent(info.cityCode)}&limit=5`).then((d) => {
        out.entries = { total: d.total, rows: (d.rows || []).map((r) => ({ developer: r.developer, date: r.date, via: r.via })), definition: d.definition };
      }).catch((e) => { out.entriesError = e.message; }));
    }
    if ((info.developer || '').trim()) {
      /* the developer registry: the name as entered, canonicalized (typographic variants only) — no similarity match */
      jobs.push(getJSON(`/api/intel?view=developer&name=${encodeURIComponent(info.developer.trim())}`).then((d) => {
        out.devIntel = { id: d.id, name: d.name, roles: d.roles || [], lots: d.tenders ? d.tenders.lots : 0, units: d.tenders ? d.tenders.residentialUnits : null, lastWin: d.tenders ? d.tenders.lastWin : null,
          projects: d.lotteries ? d.lotteries.projects : 0, lotteryUnits: d.lotteries ? d.lotteries.unitsFirstLotteries : null, lastLottery: d.lotteries ? d.lotteries.lastLottery : null,
          cities: (d.markets || []).length, construction: d.construction ? { buildings: d.construction.buildings, started: d.construction.started, completed: d.construction.completed, asOf: d.construction.asOf } : null,
          possibleSame: (d.possibleSame || []).length, basis: d.basis };
      }).catch((e) => { if (/HTTP 404/.test(e.message)) out.devIntel = { none: true }; else out.devIntelError = e.message; }));
    }
    await Promise.all(jobs);
    if (S.deal !== target) { S.mkt = { status: 'idle' }; toast('נתוני השוק נטענו לעסקה שכבר נסגרה — לא הוחלו'); return; }
    S.deal.market = out; S.mkt = { status: 'done' };
    applyMarketToValue();
    markDirty(); recompute();
  }
  function applyMarketToValue() {
    const m = S.deal.market, tx = m && m.tx; if (!tx) return;
    const V = S.deal.value || (S.deal.value = {});
    const Fx = E.facts(S.deal, TODAY);
    const useNew = tx.newN >= 10 && tx.newMedian;
    const psm = useNew ? tx.newMedian : tx.median;
    const when = `${F.date(tx.from)}–${F.date(tx.to)}`;
    if (psm && (!V.propx || V.propx.auto !== false)) {
      V.propx = { value: Fx.sqm ? Math.round(psm * Fx.sqm) : null, auto: true, psm: Math.round(psm), note: (V.propx && V.propx.note) || '',
        basis: `חציון ${useNew ? tx.newN + ' עסקאות מגורים חדשות לפי שנת בנייה' : tx.n + ' עסקאות מגורים'} ב${m.street ? m.street + ', ' : ''}${m.city} · ${when} · ${viaTxt(tx)} · נשלף ${F.date(m.retrievedAt.slice(0, 10))}` };
    }
    if (tx.compsN >= 5 && tx.compsMedian && (!V.comparables || V.comparables.auto !== false)) {
      V.comparables = { value: Fx.sqm ? Math.round(tx.compsMedian * Fx.sqm) : null, auto: true, psm: Math.round(tx.compsMedian), note: (V.comparables && V.comparables.note) || '',
        basis: `חציון ${tx.compsN} עסקאות דומות (חדרים ושטח ±20%) · ${when} · ${viaTxt(tx)}` };
    }
  }
  function paintMarket() {
    const box = $('#o-mkt'); if (!box) return;
    const m = S.deal.market, info = S.deal.info || {};
    const btn = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="ax-btn" type="button" data-act="market"${S.mkt.status === 'loading' ? ' disabled' : ''}>${S.mkt.status === 'loading' ? 'טוען…' : m ? 'רענון נתוני PROPX' : 'טעינת נתוני שוק מ-PROPX'}</button><span class="ax-muted">${info.city ? `ל${esc(info.street ? info.street + ', ' : '')}${esc(info.city)}` : 'בחרו יישוב בשלב 1'} · עסקאות, היצע קרקע ממשלתית, דיור מסובסד, ריבית — קריאה בלבד</span></div>`;
    const boi = window.PROPX_MARKET && window.PROPX_MARKET.indicators || {};
    const facts = [];
    if (boi.boiRate && isNum(boi.boiRate.value)) facts.push(`<div class="ax-fact"><div class="k">ריבית בנק ישראל</div><div class="v num">${boi.boiRate.value}%</div><div class="s">מאז ${F.date(boi.boiRate.publishedAt)} · בנק ישראל <span class="ax-tag off">רשמי</span></div></div>`);
    if (boi.cpi && isNum(boi.cpi.yoy) && boi.cpi.period) facts.push(`<div class="ax-fact"><div class="k">מדד המחירים לצרכן</div><div class="v num">${boi.cpi.yoy > 0 ? '+' : ''}${boi.cpi.yoy}%</div><div class="s">שינוי שנתי · ${pad2(boi.cpi.period.month)}/${boi.cpi.period.year}${boi.cpi.stale ? ' · לא עדכני' : ''} · למ״ס <span class="ax-tag off">רשמי</span></div></div>`);
    if (boi.constructionInputsIndex && isNum(boi.constructionInputsIndex.yoy) && boi.constructionInputsIndex.period) facts.push(`<div class="ax-fact"><div class="k">מדד מחירי תשומה בבנייה למגורים</div><div class="v num">${boi.constructionInputsIndex.yoy > 0 ? '+' : ''}${boi.constructionInputsIndex.yoy}%</div><div class="s">שינוי שנתי · ${pad2(boi.constructionInputsIndex.period.month)}/${boi.constructionInputsIndex.period.year}${boi.constructionInputsIndex.stale ? ' · לא עדכני' : ''} · למ״ס · נתון עבר, לא הנחת עלות <span class="ax-tag off">רשמי</span></div></div>`);
    if (boi.newHomesIndex && isNum(boi.newHomesIndex.yoy)) facts.push(`<div class="ax-fact"><div class="k">מדד מחירי דירות חדשות</div><div class="v num">${boi.newHomesIndex.yoy > 0 ? '+' : ''}${boi.newHomesIndex.yoy}%</div><div class="s">שינוי שנתי · ${boi.newHomesIndex.period ? pad2(boi.newHomesIndex.period.month) + '/' + boi.newHomesIndex.period.year : ''} · למ״ס · ארצי <span class="ax-tag off">רשמי</span></div></div>`);
    let body = '';
    if (m) {
      const tx = m.tx;
      if (tx) {
        facts.unshift(`<div class="ax-fact"><div class="k">חציון ₪/מ״ר · עסקאות מגורים</div><div class="v num">${F.int(tx.median)}</div><div class="s">${tx.n} עסקאות · רבעונים ${F.int(tx.p25)}–${F.int(tx.p75)} · ${F.date(tx.from)}–${F.date(tx.to)} <span class="ax-tag der">נגזר</span></div></div>`);
        if (tx.newN) facts.splice(1, 0, `<div class="ax-fact"><div class="k">חציון ₪/מ״ר · דירות חדשות</div><div class="v num">${F.int(tx.newMedian)}</div><div class="s">${tx.newN} עסקאות (חדשות לפי שנת בנייה) <span class="ax-tag der">נגזר</span></div></div>`);
      }
      if (m.land) facts.push(`<div class="ax-fact"><div class="k">קרקע ממשלתית במכרז · יחידות פתוחות</div><div class="v num">${F.int(m.land.unitsOpen)}</div><div class="s">${F.int(m.land.tenders)} מכרזים בהיקף נוכחי (מ-${F.date(m.land.currentFrom)}) · ${F.int(m.land.unitsResidential)} יח״ד שפורסמו · רמ״י · קרקע מדינה בלבד <span class="ax-tag off">רשמי</span></div></div>`);
      if (m.housing) facts.push(`<div class="ax-fact"><div class="k">דיור מסובסד · הגרלות</div><div class="v num">${F.int(m.housing.lotteries)}</div><div class="s">${F.int(m.housing.units)} דירות · ${F.int(m.housing.projects)} פרויקטים · ${F.date(m.housing.from)}–${F.date(m.housing.to)} · משרד הבינוי והשיכון <span class="ax-tag off">רשמי</span></div></div>`);
      if (m.devWins) facts.push(`<div class="ax-fact"><div class="k">זכיות היזם במכרזי רמ״י (שם זהה)</div><div class="v num">${m.devWins.none ? '0' : F.int(m.devWins.tendersWon)}</div><div class="s">${m.devWins.none ? 'לא נמצאה זכייה בשם זהה בדיוק' : `${F.int(m.devWins.lotsWon)} מגרשים · ${F.int(m.devWins.units)} יח״ד · אחרונה ${F.date(m.devWins.lastWin)}`} · OBSERVED PUBLIC TENDER WINS IN DETAIL-READ RECORDS — לא מאגר קרקעות</div></div>`);
      if (m.devIntel) {
        const D = m.devIntel;
        facts.push(D.none ? `<div class="ax-fact"><div class="k">היזם ברישום היזמים של PROPX</div><div class="v">—</div><div class="s">השם כפי שהוזן לא נמצא ברישום (שם משפטי זהה בלבד — ללא התאמה לפי דמיון). פעילות שנצפתה במקורות PROPX — לא רשימה מלאה.</div></div>`
          : `<div class="ax-fact"><div class="k">היזם · פעילות שנצפתה ב-PROPX</div><div class="v num">${F.int(D.lots)} / ${F.int(D.projects)}</div><div class="s">מגרשים שנזכו (רמ״י${D.units != null ? ` · ${F.int(D.units)} יח״ד` : ''}${D.lastWin ? ` · אחרונה ${F.date(D.lastWin)}` : ''}) / פרויקטי הגרלה (משב״ש${D.lastLottery ? ` · אחרונה ${F.date(D.lastLottery)}` : ''}) · ${F.int(D.cities)} ערים${D.construction ? ` · ראיות בנייה: ${F.int(D.construction.buildings)} מבנים, ${F.int(D.construction.completed)} הושלמו (נכון ל-${F.date(D.construction.asOf)})` : ''}${D.possibleSame ? ` · ${F.int(D.possibleSame)} שמות דומים מקושרים ואינם ממוזגים` : ''} · יח״ד לפי מקור, לא מחוברות · לא מאגר קרקעות <span class="ax-tag der">נגזר</span></div></div>`);
      }
      if (m.pipeline) {
        const P = m.pipeline, st = P.stageCounts || {};
        const stH = { 'land-awarded': 'קרקע נזכתה', marketed: 'שווק', permitted: 'היתר', 'construction-started': 'בנייה החלה', completed: 'הושלם', occupied: 'אוכלס' };
        facts.push(`<div class="ax-fact"><div class="k">פרויקטים ואתרים ביישוב · נצפו</div><div class="v num">${F.int(P.total)}</div><div class="s">${Object.entries(st).filter(([k]) => stH[k]).map(([k, n]) => `${stH[k]} ${F.int(n)}`).join(' · ') || '—'} · פרויקטי הגרלה ומגרשי מגורים שנזכו — לא כל הבנייה ביישוב, ללא צירוף בין המקורות <span class="ax-tag der">נגזר</span></div></div>`);
      }
      if (m.entries && m.entries.total) facts.push(`<div class="ax-fact"><div class="k">יזמים שנכנסו ליישוב · 24 חודשים</div><div class="v num">${F.int(m.entries.total)}</div><div class="s">${m.entries.rows.map((r) => `${esc(r.developer)} (${F.date(r.date)})`).join(' · ')} · פעילות ראשונה שנצפתה ביישוב, ליזם שפעל במקום אחר לפני כן <span class="ax-tag der">נגזר</span></div></div>`);
      const errs = [m.txError && `עסקאות: ${m.txError}`, m.landError && `קרקע: ${m.landError}`, m.housingError && `דיור: ${m.housingError}`, m.devWinsError && `זכיות יזם: ${m.devWinsError}`,
        m.devIntelError && `רישום יזמים: ${m.devIntelError}`, m.pipelineError && `פרויקטים: ${m.pipelineError}`, m.entriesError && `כניסות יזמים: ${m.entriesError}`].filter(Boolean);
      if (!m.cityCode) errs.push('ליישוב לא נבחר קוד רשמי — בחרו אותו מרשימת החיפוש כדי לקבל נתוני קרקע ודיור');
      body += `<div class="ax-facts">${facts.join('')}</div>`;
      if (tx) body += `<p class="ax-muted">${esc(viaTxt(tx))}${tx.snapshotAt ? ' · עותק המרשם מיום ' + esc(F.date(String(tx.snapshotAt).slice(0, 10))) : ''} · היקף: ${esc(tx.scope || '—')} · ${tx.nAll} רשומות מגורים נשלפו (${tx.more ? 'עמוד ראשון מתוך יותר' : 'כל הרשומות בהיקף'}) · נשלף ${esc(F.date(m.retrievedAt.slice(0, 10)))}. השווי המוערך הוא חציון — לא שומה.</p>`;
      if (tx && tx.comps.length) body += `<div class="ax-tbl-wrap"><table class="ax-tbl data"><thead><tr><th>תאריך</th><th>כתובת</th><th class="n">חדרים</th><th class="n">שטח</th><th class="n">מחיר</th><th class="n">₪/מ״ר</th></tr></thead><tbody>${tx.comps.map((c) => `<tr><td class="num">${esc(F.date(c.date))}</td><td>${esc([c.street, c.house].filter(Boolean).join(' ') || '—')}${c.isNew ? ' <span class="ax-tag">חדשה</span>' : ''}</td><td class="n">${esc(c.rooms || '—')}</td><td class="n">${F.int(c.area)}</td><td class="n">${F.nis(c.price)}</td><td class="n">${F.int(c.psm)}</td></tr>`).join('')}</tbody></table></div><p class="ax-muted">עסקאות השוואה: חדרים כמו ביחידות העסקה (±0.5) ושטח בטווח ±20% — ${tx.compsN} נמצאו${tx.compsN < 5 ? ' (פחות מ-5: לא הוצע שווי השוואה)' : ''}.</p>`;
      if (errs.length) body += `<p class="ax-muted" style="color:var(--down)">${errs.map(esc).join(' · ')}</p>`;
    } else body += facts.length ? `<div class="ax-facts">${facts.join('')}</div>` : '';
    box.innerHTML = btn + body;
  }

  /* --------------------------------------------- section 3: capital structure */
  function secStruct() {
    return `<section class="ax-sec" id="s-struct">${secHead(3, 'מבנה ההון', 'שלוש חלופות לאותה עסקה. אל תשאלו רק אם הנכס אטרקטיבי — שאלו איזו צורת הון אטרקטיבית ביותר.')}
      <div class="ax-cards" id="o-cards"></div>
      <div id="o-stratin" style="margin-top:14px"></div>
      <div id="o-stratres"></div></section>`;
  }
  /* how this structure's capital at risk was formed (the engine's own rule, read back for the popover) */
  function capLive(k, s) {
    const b = s.base; if (!b || !b.ok) return '';
    if (k !== 'hybrid') return `שיא הפריסה המצטברת בתרחיש הבסיס: ${F.nis(b.peakCapital)}.`;
    const i = s.inputs, extra = (i.backstopOn ? E.num(i.backstopPrice) || 0 : 0) + (i.optionOn ? E.num(i.optionPrice) || 0 : 0);
    return `הגבוה מבין: התחייבות ${F.nis(b.commitment)} · הון + backstop + אופציה ${F.nis(b.capital + extra)} · שיא הפריסה ${F.nis(b.peakCapital)} = ${F.nis(E.capOf(b))}.`;
  }
  /* how the IRR shown was obtained — the engine names the basis (E.irrBasisOf) */
  const IRR_NOTE = {
    commitment: { tag: 'על ההון המחויב (לא הועמד הון)', how: (m) => `לא הועמד הון בתרחיש (למשל backstop שלא הופעל — עלויות משפטיות ומעקב אינן הון): (1 + רווח ÷ הון בסיכון)^(12 ÷ ${m}) − 1, על ההון המחויב.` },
    'commitment-no-irr': { tag: 'על ההון המחויב (לתזרים אין IRR)', how: (m) => `לתזרים אין IRR — הערך הנוכחי חיובי בכל שיעור (למשל עמלה שהתקבלה לפני הפעלת backstop): (1 + רווח ÷ הון בסיכון)^(12 ÷ ${m}) − 1, על ההון המחויב.` },
    'no-irr': { tag: 'על ההון בסיכון (לתזרים אין IRR)', how: (m) => `לתזרים אין IRR — הערך הנוכחי חיובי בכל שיעור: (1 + רווח ÷ הון בסיכון)^(12 ÷ ${m}) − 1.` },
    'below-range': { tag: 'הפסד מתחת ל-‎−99.99%', how: () => 'הפסד שה-IRR שלו נמוך מ-‎−99.99% (או שהערך הנוכחי שלו שלילי בכל שיעור): מוצג ‎−100%.' },
    'total-loss': { tag: 'אין תקבולים', how: () => 'אין תקבולים כלל: ‎−100%.' },
  };
  const irrNote = (b) => (b && b.ok ? IRR_NOTE[E.irrBasisOf(b)] || null : null);
  const irrLive = (k, b) => (b && b.ok ? (irrNote(b) ? irrNote(b).how(b.months) : `XIRR על התזרים החודשי המתוארך של ${SN[k]} · ${b.months} חודשים.`) : '');
  const moicLive = (b) => (b && b.ok ? (b.moic == null && b.moicCommit != null ? `1 + רווח ${F.nis(b.profit)} ÷ הון מחויב ${F.nis(E.capOf(b))}` : `תקבולים ${F.nis(b.distributions)} ÷ הון שהושקע ${F.nis(b.invested)}`) : '');
  /* a card label keeps its info mark on the same line as its last word when a narrow card wraps it */
  const cardLbl = (text, mark) => { const i = text.lastIndexOf(' '); return `<span class="ml">${i < 0 ? '' : esc(text.slice(0, i + 1))}<span class="nw">${esc(i < 0 ? text : text.slice(i + 1))}${mark}</span></span>`; };
  function paintCards() {
    const box = $('#o-cards'); if (!box) return;
    const R = S.R, sig = R.signal;
    box.innerHTML = E.STRATS.map((k) => {
      const s = R.strategies[k], b = s.base, ok = b && b.ok;
      const pass = ok ? s.hurdles.filter((h) => h.pass).length : 0, tot = ok ? s.hurdles.length : 0;
      const fails = ok ? s.hurdles.filter((h) => !h.pass).map((h) => E.HURDLE_HE[h.k] || h.k) : [];
      const pref = sig.strategy === k && /^(STRONG|PREFER)/.test(sig.code);
      return `<div class="ax-card${S.strat === k ? ' on' : ''}" style="--c:${SC[k]}" data-card="${k}">
        <button type="button" class="ax-card-sel" data-strat="${k}" aria-pressed="${S.strat === k}"><span class="en">${SN[k]}</span><span class="he">${SH[k]}</span></button>
        ${pref ? '<span class="pick">מועדף</span>' : S.deal.selected === k ? '<span class="pick">לביצוע</span>' : ''}
        <span class="m"><span>${cardLbl('IRR', mi('irr', irrLive(k, b)))}<b class="num">${ok ? F.pct(E.irrOf(b)) : '—'}</b></span><span>${cardLbl('הון בסיכון', mi('capitalAtRisk', capLive(k, s)))}<b class="num">${ok ? F.m(E.capOf(b)) : '—'}</b></span><span>${cardLbl('MOIC', mi('moic', moicLive(b)))}<b class="num">${ok ? F.x(E.moicOf(b)) : '—'}</b></span><span>${cardLbl('ציון סיכון', mi('riskScore'))}${modelTag()}<b class="num">${ok && s.risk ? s.risk.overall + '<small> / 100</small>' : '—'}</b></span></span>
        ${ok ? `<button type="button" class="ax-hb ${pass === tot ? 'ok' : 'no'}" data-hurdles="${k}" aria-haspopup="dialog" aria-expanded="false" aria-label="ספי קרן ${SN[k]}: ${pass} מתוך ${tot} מתקיימים${fails.length ? ' · לא מתקיימים: ' + esc(fails.join(', ')) : ''} — פירוט"><i aria-hidden="true"></i><span class="t">ספי קרן <b class="num">${pass}/${tot}</b>${fails.length ? ` · לא עומד: ${esc(fails.join(', '))}` : ' · כולם מתקיימים'}</span></button>` : '<span class="pass"><i></i>חסרים נתונים</span>'}</div>`;
    }).join('') + `<button type="button" class="ax-card all" data-view-go="compare"><span class="en">COMPARE ALL</span><span class="he">השוואה בין כל החלופות</span><span class="sub">טבלת השוואה, אות מבנה והסבר</span></button>`;
  }
  function renderStratInputs() {
    const box = $('#o-stratin'); if (!box) return;
    const k = S.strat, s = S.R.strategies[k], inputs = s.inputs, def = new Set(s.defaulted), user = S.deal[k] || {};
    const groups = FIELDS[k].map((g) => {
      const fs = g.f.filter((sp) => !sp.show || sp.show(inputs));
      let html = `<div class="ax-gt">${esc(g.g)}${g.m ? mi(g.m) : ''}</div><div class="ax-fields">${fs.map((sp) => fieldHTML(sp, k + '.' + sp.k, user[sp.k] != null && user[sp.k] !== '' ? user[sp.k] : inputs[sp.k], def.has(sp.k) && sp.t !== 'text')).join('')}</div>`;
      if (k === 'buy' && g.f[0].k === 'price') html += `<p class="ax-muted" id="o-buyinfo" style="margin-top:4px"></p>`;
      if (k === 'buy' && g.f[0].k === 'debtMode') html += `<p class="ax-muted" id="o-buyequity" style="margin-top:4px"></p>`;
      if (g.tax) html += `<div class="ax-disc">הנחות המס הן לצורך ניתוח השקעה בלבד ויש לאשרן מול המבנה המשפטי הסופי. המנוע אינו מחשב מס לפי החוק.</div>`;
      if (k === 'hybrid' && g.f[0].k === 'structure') html += `<p class="ax-muted" style="margin-top:6px">${esc(STRUCT_NOTE[inputs.structure] || '')}</p>`;
      return html;
    }).join('');
    const sel = S.deal.selected === k;
    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px"><h3 class="ax-h3" style="margin:0"><span class="st" style="--c:${SC[k]}"></span>הנחות ${SN[k]} · ${SH[k]}</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="ax-btn${sel ? ' on' : ''}" data-act="select-strat">${sel ? '✓ המבנה שנבחר לביצוע' : 'קבעו כמבנה לביצוע'}</button><button type="button" class="ax-btn" data-act="reset-strat">איפוס לברירות מחדל</button></div></div>
      <p class="ax-muted">שדה עם מסגרת מקווקוות ותג <span class="ax-asm">הנחה</span> מחזיק ערך ברירת מחדל — הנחת חיתום עד שתשנו אותו. <span class="ax-tag der">נגזר</span> = נלקח מנתוני העסקה.</p>${groups}`;
  }
  function paintStratInfo() {
    const bi = $('#o-buyinfo'), be = $('#o-buyequity'); if (!bi && !be) return;
    const R = S.R, Fx = R.facts, b = R.strategies.buy.base;
    if (bi) bi.textContent = `שווי נתמך ${F.m(Fx.smv)} · ${Fx.unitsCount ? Fx.unitsCount + ' יחידות' : 'מספר יחידות לא הוזן'} · הנחת רכישה ${b.ok ? F.pct(1 - b.price / Fx.smv) : '—'} (מחושב)`;
    if (be) be.textContent = b.ok ? `הון עצמי מושקע (מחושב): ${F.nis(b.invested)} · שיא ${F.nis(b.peakCapital)} · חוב ${F.nis(b.debt)}` : '';
  }
  function syncDefaults() {
    const k = S.strat, s = S.R.strategies[k]; if (!s) return;
    const def = new Set(s.defaulted);
    for (const el of $$('#o-stratin [data-k]')) {
      const key = el.dataset.k.split('.')[1];
      const isDef = def.has(key) && !(el.type === 'text' && !el.dataset.t);   // free text (no numeric type) is never an assumption
      const f = el.closest('.ax-f'); if (f) f.classList.toggle('dflt', isDef);
      const tag = $(`[data-tag="${CSS.escape(el.dataset.k)}"]`); if (tag) tag.hidden = !isDef;
      if (isDef && document.activeElement !== el) {
        const v = s.inputs[key];
        if (el.type === 'checkbox') el.checked = !!v;
        else if (el.tagName === 'SELECT') el.value = v == null ? '' : String(v);
        else el.value = fmtIn(v, el.dataset.t);
      }
    }
  }

  const BRIDGE_HE = { smv: 'שווי נתמך', haircut: 'Haircut ביציאה (מול השווי הנתמך)', exit: 'שווי יציאה צפוי', price: 'מחיר רכישה', tax: 'מס רכישה', costs: 'עלויות עסקה והשבחה',
    financing: 'מימון — ריבית ועמלות', holding: 'עלויות החזקה', rent: 'שכירות נטו', exitCosts: 'עלויות מכירה ומע״מ', profit: 'רווח חיתום לפני מס', profitTax: 'מס על הרווח', profitAfterTax: 'רווח אחרי מס' };
  const SU_HE = { price: 'מחיר רכישה', tax: 'מס רכישה', costs: 'עלויות עסקה', fee: 'עמלות חוב', carry: 'נשיאה (ריבית ותפעול נטו)', earlyRepay: 'פירעון הלוואה מההון לפני היציאה', debt: 'חוב', equity: 'הון עצמי' };

  function kpiStrip(k, s) {
    const b = s.base, d = s.downside && s.downside.ok ? s.downside : null;
    const cap = E.capOf(b), bi = E.irrOf(b), di = E.irrOf(d), onCommit = b.moic == null && b.moicCommit != null, note = irrNote(b);
    return `<div class="ax-kpis">${kpi('הון בסיכון', F.m(cap), cap > b.peakCapital + 1 ? `פריסה בבסיס ${F.m(b.peakCapital)}` : 'שיא החשיפה המצטברת', { m: 'capitalAtRisk', how: 'שיא היתרה השלילית המצטברת של תזרים ALTARIS — ובמבנה משולב: הגבוה מבין השיא, ההתחייבות המקסימלית, וההון + backstop + מחיר האופציה.' })}
      ${kpi('IRR בסיס', F.pct(bi), note ? note.tag : 'XIRR לפי תאריכים', { neg: bi < 0, m: 'irr', how: note ? note.how('חודשים') : 'שיעור התשואה הפנימי מהתזרים החודשי המתוארך (XIRR, בסיס 365 ימים), לפני מס על הרווח.' })}
      ${kpi('IRR בתרחיש שלילי', d ? F.pct(di) : '—', d ? `רווח ${F.m(d.profit)}` : '', { neg: di < 0, m: 'scenarios', how: 'אותו תזרים תחת הנחות התרחיש השלילי (שלב 4).' })}
      ${kpi('MOIC', F.x(E.moicOf(b)), onCommit ? '1 + רווח ÷ הון מחויב' : 'תקבולים ÷ הון מושקע', { m: 'moic', how: onCommit ? `1 + רווח ${F.nis(b.profit)} ÷ הון מחויב ${F.nis(cap)}` : `סך התקבולים ${F.nis(b.distributions)} ÷ סך ההון שהושקע ${F.nis(b.invested)} = ${F.x(b.moic)}` })}
      ${kpi('רווח לפני מס', F.m(b.profit), `ROI ${F.pct(b.roi)}`, { neg: b.profit < 0, m: 'profit', how: 'סכום כל תזרימי המזומנים של ALTARIS בתרחיש הבסיס.' })}
      ${kpi('משך צפוי', F.mo(b.months), F.date(b.exitDate), { m: 'wal', how: 'החודש של התזרים האחרון שאינו אפס; התאריך = מועד T0 + מספר החודשים.' })}</div>`;
  }
  function paintStratRes() {
    const box = $('#o-stratres'); if (!box) return;
    const k = S.strat, s = S.R.strategies[k];
    if (!s.base.ok) { box.innerHTML = `<div style="margin-top:14px">${needBox(`<b>חסרים נתונים לחישוב ${SN[k]}:</b> ${esc(missingTxt(s.base.missing))}`)}</div>`; return; }
    box.innerHTML = `<div class="ax-res">${kpiStrip(k, s)}${k === 'buy' ? resBuy(s) : k === 'finance' ? resFin(s) : resHyb(s)}</div>`;
  }
  function resBuy(s) {
    const b = s.base, Fx = S.R.facts, i = s.inputs, L = s.limits || {}, minIrr = S.R.settings.minIrr;
    const left = `<div><div class="ax-ledger">
      ${lr('שווי נתמך', F.nis(Fx.smv), { m: 'supportedValue', how: `נבחר במפורש: ${VSRC[Fx.chosen].l}` })}
      ${lr('מחיר רכישה', F.nis(b.price))}
      ${lr('הנחה ברוטו', `${F.pct(1 - b.price / Fx.smv)} · ${F.nis(Fx.smv - b.price)}`, { m: 'entryDiscount', how: '(שווי נתמך − מחיר רכישה) ÷ שווי נתמך' })}
      ${lr('בסיס רכישה כולל', F.nis(b.price + b.tax + b.costs), { how: `מחיר ${F.nis(b.price)} + מס רכישה ${F.nis(b.tax)} + עלויות עסקה והשבחה ${F.nis(b.costs)}` })}
      ${lr('חוב', `${F.nis(b.debt)}${b.debt ? ' · LTV ' + F.pct(b.ltv) : ''}`, { m: 'debt', how: b.debtCapped ? 'סכום החוב שהוזן גבוה ממחיר הרכישה — החוב הוגבל למחיר (LTV עד 100%).' : null })}
      ${lr('סך המזומן שהושקע', F.nis(b.invested), { m: 'invested', how: 'סכום כל התזרימים השליליים: רכישה, עלויות, נשיאה חודשית ופירעון חוב מוקדם אם יש.' })}
      ${lr('עלות החזקה כוללת', F.nis(b.holding), { sub: true, how: `${F.nis(b.holding / Math.max(1, b.months))} לחודש × ${b.months} חודשים` })}
      ${lr('עלות מימון', F.nis(b.financing), { sub: true, how: `ריבית ${F.nis(b.interest)} + עמלות ${F.nis(b.fee)}` })}
      ${lr('שכירות נטו בתקופה', F.nis(b.rentCarry), { sub: true, how: i.rentOn ? `שכירות × תפוסה ${i.occupancy}% × גבייה ${i.collection}% × (1 − הוצאות ${i.rentOpexPct}%) × ${b.months} חודשים` : 'לא נכללה' })}
      ${lr('שווי יציאה צפוי', F.nis(b.exitGross), { m: 'exitValue', how: i.exitMode === 'target' ? 'מחיר המכירה היעד שהוזן' : `שווי נתמך × (1 − haircut ${i.haircutPct}%)` })}
      ${lr('עלויות מכירה כוללות', F.nis(b.sellCosts + b.vat), { sub: true, how: `תיווך ${i.sellBrokeragePct}% + משפטיות ${i.sellLegalPct}% + אחרות ${F.nis(i.sellOther)}${b.vat ? ' + מע״מ ' + F.nis(b.vat) : ''}` })}
      ${lr('תמורה נטו', F.nis(b.netProceeds))}
      ${lr('רווח גולמי (יציאה − מחיר)', F.nis(b.exitGross - b.price), { how: 'לפני מס רכישה, עלויות, מימון והחזקה — לא רווח אמיתי.' })}
      ${lr('רווח נקי לפני מס', F.nis(b.profit), { key: true, tot: true, neg: b.profit < 0, m: 'profit', how: 'סכום כל התזרימים = שווי נתמך − haircut − מחיר − מס רכישה − עלויות − מימון − החזקה + שכירות − עלויות מכירה.' })}
      ${b.afterTax.profitTax > 0 ? lr('מס על הרווח (הנחה)', F.nis(-b.afterTax.profitTax), { sub: true }) + lr('רווח אחרי מס', F.nis(b.afterTax.profit), { neg: b.afterTax.profit < 0 }) + lr('IRR אחרי מס', F.pct(b.afterTax.irr), { m: 'taxes' }) : ''}
      ${lr('ROI', F.pct(b.roi), { m: 'roi', how: 'רווח ÷ סך ההון שהושקע' })}
      ${lr('תשואה שנתית', F.pct(b.annualized), { how: `(1 + ROI)^(12 ÷ ${b.months}) − 1` })}
      ${lr('IRR', F.pct(E.irrOf(b)), { key: true, neg: E.irrOf(b) < 0, m: 'irr' })}${lr('MOIC', F.x(E.moicOf(b)), { key: true, m: 'moic' })}
    </div></div>`;
    const right = `<div><div class="ax-ledger">
      <div class="ax-lgt">נקודת איזון ומרווח ביטחון</div>
      ${lr('מחיר מכירה לאיזון', F.nis(b.breakEvenExit), { key: true, m: 'breakEven', how: 'שווי היציאה שבו הרווח לפני מס = 0, כשכל שאר ההנחות קבועות (הרווח לינארי במחיר המכירה).' })}
      ${lr('מחיר למ״ר לאיזון', b.breakEvenPsm ? F.int(b.breakEvenPsm) + ' ₪' : '—', { how: 'מחיר המכירה לאיזון ÷ השטח הכולל' })}
      ${lr('מרווח ביטחון (מול היציאה הצפויה)', F.pct(b.marginOfSafety), { how: '(שווי יציאה צפוי − מחיר איזון) ÷ שווי יציאה צפוי' })}
      ${lr('Haircut מקסימלי לפני הפסד', F.pct(b.maxHaircut), { key: true, neg: b.maxHaircut < 0, m: 'mos', how: '1 − מחיר איזון ÷ שווי נתמך: כמה השווי יכול לרדת מהשווי הנתמך לפני הפסד.' })}
      ${lr('כרית ביטחון', F.nis(b.cushion), { neg: b.cushion < 0, how: 'שווי יציאה צפוי − מחיר איזון' })}
      ${lr(`מחיר רכישה מקסימלי (IRR ${minIrr}%)`, F.nis(L.maxPrice), { key: true, m: 'maxPrice', how: `מחיר הרכישה הגבוה ביותר שעדיין עומד ברף ה-IRR של הקרן (${minIrr}%), כשכל שאר ההנחות קבועות. נמצא בחיפוש בינארי.` })}
      ${lr('הנחה מינימלית נדרשת', F.pct(L.requiredDiscount), { how: '1 − מחיר רכישה מקסימלי ÷ שווי נתמך' })}
      ${lr('מחיר רכישה ברווח אפס', F.nis(L.zeroProfitPrice))}
      ${b.loanMaturesBeforeExit ? `<p class="ax-muted" style="color:var(--down);margin-top:6px">ההלוואה נפרעת בחודש ${b.loanTerm}, לפני היציאה בחודש ${b.months} — הקרן משולמת מההון העצמי.</p>` : ''}
    </div></div>`;
    const bridge = C.waterfall(b.bridge.filter((x) => x.total || Math.abs(x.v) >= 0.5).map((x) => ({ label: BRIDGE_HE[x.k], v: x.v, total: x.total })), { title: 'גשר שווי: מכניסה ליציאה', question: 'כמה מהשווי הנתמך נשאר אחרי haircut, מחיר, מס, עלויות, מימון והחזקה?', w: CW(false) });
    const su = C.sourcesUses(b.sourcesUses, SU_HE, { title: 'מקורות ושימושים', question: 'איך ממומן הבסיס הכולל — חוב מול הון עצמי?', w: CW(false) });
    return `<div class="ax-res two">${left}${right}</div><div class="ax-res">${bridge}${su}</div>`;
  }
  function collateralFlow(V, h, prior, exposure, title) {
    if (!(V > 0)) return '';
    const cons = V * (1 - h), cushion = V - prior - exposure, cc = cons - prior - exposure;
    const w = (x) => Math.max(0, Math.min(100, x / V * 100)).toFixed(1) + '%';
    const st = (l, v, c, tip) => `<div class="st"><span class="l">${esc(l)}</span><span class="bar" style="width:${w(Math.abs(v))};--c:${c}" data-tip="${esc(tip || l + ': ' + F.nis(v))}" tabindex="0"></span><span class="v">${esc(F.m(v))}</span></div>`;
    return `<figure class="ax-chart"><h4>${esc(title || 'כיסוי בטוחות')}</h4><p class="q">כמה ערך עומד מאחורי החשיפה של ALTARIS אחרי מקדם ביטחון ושעבודים קודמים?</p><div class="ax-flow">
      ${st('שווי בטוחות נתמך', V, 'var(--navy)')}<div class="ar">↓ מקדם ביטחון ${F.pct(h, 0)} (−${F.m(V * h)})</div>
      ${st('שווי שמרני', cons, 'var(--ax-buy)')}${prior ? `<div class="ar">↓ חוב בדרגה קודמת</div>${st('שעבודים קודמים', prior, 'var(--ink-3)')}` : ''}
      <div class="ar">↓</div>${st('חשיפת ALTARIS', exposure, 'var(--ax-fin)', 'חשיפת ALTARIS (קרן + ריבית נצברת + עמלות): ' + F.nis(exposure))}
      <div class="ar">↓</div>${st('כרית הון של היזם', cushion, cushion >= 0 ? 'var(--up)' : 'var(--down)', `שווי − שעבודים קודמים − חשיפה = ${F.nis(cushion)} · בשווי שמרני: ${F.nis(cc)}`)}
    </div>${C.twin(['שלב', 'סכום'], [['שווי בטוחות נתמך', F.nis(V)], ['מקדם ביטחון', F.nis(-V * h)], ['שווי שמרני', F.nis(cons)], ['שעבודים קודמים', F.nis(prior)], ['חשיפת ALTARIS', F.nis(exposure)], ['כרית הון (שווי נתמך)', F.nis(cushion)], ['כרית הון (שווי שמרני)', F.nis(cc)]])}</figure>`;
  }
  function resFin(s) {
    const b = s.base, i = s.inputs, ext = s.extension, rc = s.recoveryCase, rec = rc && rc.recovery;
    const left = `<div><div class="ax-ledger">
      ${lr('סך ההון שהועמד', F.nis(b.amount), { key: true })}
      ${lr('מימון נטו ביום ההעמדה', F.nis(b.amount - b.fee + E.num(i.legal || 0)), { sub: true, how: 'הלוואה − עמלת העמדה שנגבתה + עלויות משפטיות של ALTARIS' })}
      ${lr('הכנסות ריבית חוזיות', F.nis(b.interest), { how: `${i.ratePct}% לשנה על יתרת הקרן לאורך ${b.term} חודשים${i.interestMode === 'accrued' ? ' (נצברת ומשולמת בפירעון)' : ''}` })}
      ${lr('הכנסות עמלות', F.nis(b.feeIncome), { how: `העמדה ${F.nis(b.fee)} + פירעון ${F.nis(b.exitFee)}${b.extFee ? ' + הארכה ' + F.nis(b.extFee) : ''}` })}
      ${lr('עלויות ALTARIS', F.nis(-b.costs), { sub: true })}
      ${lr('סך ההכנסה הצפויה', F.nis(b.profit), { key: true, tot: true, neg: b.profit < 0, m: 'profit', how: 'סכום כל התזרימים: ריבית + עמלות − עלויות − חוסר בפירעון אם יש.' })}
      ${lr('תשואה שנתית פשוטה', F.pct(b.simpleYield), { how: 'סך ההכנסה ÷ (יתרת קרן ממוצעת × שנים)' })}
      ${lr('IRR', F.pct(E.irrOf(b)), { key: true, m: 'irr' })}${lr('MOIC', F.x(E.moicOf(b)), { key: true, m: 'moic' })}
      ${lr('משך צפוי', `${F.mo(b.months)} · WAL ${F.mo(b.wal)}`, { m: 'wal', how: 'משך = מועד התזרים האחרון; WAL = ממוצע משוקלל של מועדי החזר הקרן.' })}
      ${lr('מועד פירעון חוזי', F.date(E.addMonths(S.R.facts.t0, b.term)))}
      ${lr('מקור פירעון', `${optLabel('finSource', i.sourcePrimary)} · משני: ${optLabel('finSource', i.sourceSecondary)}`)}
    </div></div>`;
    const right = `<div><div class="ax-ledger">
      <div class="ax-lgt">בטוחות והגנה</div>
      ${lr('LTV', F.pct(b.ltv), { key: true, m: 'ltv', how: `(חוב קודם ${F.nis(b.priorLiens)} + הלוואה ${F.nis(b.amount)}) ÷ שווי בטוחות ${F.nis(b.collateral)}` })}
      ${lr('LTC', F.pct(b.ltc), { how: 'מחושב רק כשהוזנה עלות פרויקט' })}
      ${lr('כיסוי בטוחות (שמרני)', F.x(b.coverage), { key: true, m: 'coverage', how: `(שווי × (1 − ${F.pct(b.haircut, 0)}) − חוב קודם) ÷ חשיפה ${F.nis(b.exposure)}` })}
      ${lr('כיסוי ברוטו', F.x(b.coverageGross), { sub: true, how: 'שווי בטוחות ÷ (חוב קודם + חשיפה)' })}
      ${lr('כרית הון', F.nis(b.equityCushion), { neg: b.equityCushion < 0, m: 'equityCushion', how: 'שווי בטוחות − חוב קודם − חשיפת ALTARIS' })}
      ${lr('הון עצמי של הלווה (הוזן)', F.nis(b.borrowerEquity), { sub: true })}
      ${lr('שווי בטוחות לאיזון (קרן)', F.nis(b.breakEvenCollateral), { key: true, m: 'breakEven', how: `(חוב קודם + קרן) ÷ ((1 − מקדם ביטחון) × (1 − עלויות מימוש ${i.enforcementCostPct}%))` })}
      ${lr('ירידת שווי מקסימלית לפני פגיעה בקרן', F.pct(b.maxDecline), { key: true, neg: b.maxDecline < 0, how: '1 − שווי לאיזון ÷ שווי בטוחות' })}
      <div class="ax-lgt">תרחיש הארכה (${F.mo(E.num(i.extMonths))} ב-${i.extRatePct}%)${mi('extension')}</div>
      ${ext && ext.ok ? lr('IRR · MOIC', `${F.pct(E.irrOf(ext))} · ${F.x(E.moicOf(ext))}`) + lr('רווח · משך', `${F.m(ext.profit)} · ${F.mo(ext.months)}`) : lr('הארכה', '—')}
      <div class="ax-lgt">תרחיש מימוש בטוחות${mi('recovery')}</div>
      ${rec ? lr('כשל בחודש · גבייה בחודש', `${rec.defaultMonth} · ${rec.recoveryMonth}`) + lr('תביעה במועד הגבייה', F.nis(rec.claim), { how: 'הקרן והריבית שלא שולמו, צוברות ריבית חוזית עד הגבייה' }) + lr('תמורת מימוש', F.nis(rec.proceeds), { how: 'שווי בתרחיש × (1 − מקדם ביטחון) × (1 − עלויות מימוש) − חוב קודם' }) + lr('שיעור גבייה', F.pct(rec.rate), { key: true }) + lr('פגיעה בקרן', F.nis(rec.principalLoss), { neg: rec.principalLoss > 0 }) + lr('IRR בתרחיש', F.pct(E.irrOf(rc)), { neg: E.irrOf(rc) < 0 }) : lr('תרחיש מימוש', '—')}
    </div></div>`;
    const income = C.waterfall([{ label: 'ריבית', v: b.interest - Math.max(0, 0) }, { label: 'עמלות', v: b.feeIncome }, { label: 'עלויות ALTARIS', v: -b.costs }, { label: 'חוסר בפירעון', v: -b.shortfall }].filter((x) => Math.abs(x.v) > 0.5)
      .concat(Math.abs(b.profit - (b.interest + b.feeIncome - b.costs - b.shortfall)) > 1 ? [{ label: 'ריבית בתקופת מימוש', v: b.profit - (b.interest + b.feeIncome - b.costs - b.shortfall) }] : []).concat([{ label: 'סך ההכנסה', v: b.profit, total: true }]),
    { title: 'גשר הכנסות', question: 'מאילו רכיבים מורכבת ההכנסה החוזית?', w: CW(true) });
    return `<div class="ax-res two">${left}${right}</div><div class="ax-res two">${collateralFlow(b.collateral, b.haircut, b.priorLiens, b.exposure)}${income}</div>`;
  }
  function resHyb(s) {
    const b = s.base, i = s.inputs, be = s.breakEven || {}, rc = s.recoveryCase, rec = rc && rc.recovery;
    const left = `<div><div class="ax-ledger">
      ${lr('מבנה', optLabel('structure', i.structure))}
      ${lr('הון מושקע', F.nis(b.capital), { key: true })}${lr('התחייבות מקסימלית', F.nis(b.commitment), { sub: true, m: 'committed' })}
      ${lr('הון מקסימלי בסיכון', F.nis(b.maxAtRisk), { key: true, m: 'capitalAtRisk', how: 'הגבוה מבין: ההתחייבות המקסימלית; ההון המושקע + מחיר ה-backstop + מחיר האופציה (אם קיימים); ושיא הפריסה בפועל.' })}
      ${lr('תשואה חוזית', F.nis(b.contractual), { how: `קופונים ${F.nis(b.coupons)} + תשואה מועדפת ${F.nis(b.prefPaid)} + עמלות ${F.nis(b.fee)}` })}
      ${lr('השתתפות ברווח', F.nis(b.participation), { how: `${i.participationPct}% × (שווי מימוש ${F.nis(b.realization)} − סף ${F.nis(i.threshold)}), עד גובה התמורה שנותרה אחרי התביעה` })}
      ${b.optionExercised || b.backstopPaid ? lr('אופציה / backstop נטו', F.nis(b.optionResale - b.optionPaid + b.backstopResale - b.backstopPaid), { m: 'contingent' }) : ''}
      ${lr('תשואה משולבת (רווח)', F.nis(b.profit), { key: true, tot: true, neg: b.profit < 0, m: 'profit' })}
      ${lr(irrNote(b) && b.irrCommit != null ? 'IRR על ההון המחויב' : 'IRR', F.pct(E.irrOf(b)), { key: true, m: 'irr', how: irrNote(b) ? irrNote(b).how(b.months) : undefined })}${lr('MOIC', F.x(E.moicOf(b)), { key: true, m: 'moic' })}
      ${lr('משך צפוי', F.mo(b.months))}${lr('שווי מימוש צפוי', F.nis(b.realization))}
      ${i.triggerNote ? lr('טריגרים', i.triggerNote, { txt: true }) : ''}${i.exitConditions ? lr('תנאי יציאה', i.exitConditions, { txt: true }) : ''}
    </div></div>`;
    const right = `<div><div class="ax-ledger">
      <div class="ax-lgt">בטוחות, איזון והגנה</div>
      ${lr('LTV / נקודת כניסה', F.pct(b.ltv), { m: 'ltv', how: '(חוב קודם + הון מושקע + backstop) ÷ שווי בטוחות' })}
      ${lr('כיסוי בטוחות (שמרני)', F.x(b.coverage), { key: true, m: 'coverage', how: `(שווי × (1 − ${i.haircutPct}%) − חוב קודם) ÷ (הון + תשואה מועדפת צבורה + backstop)` })}
      ${lr('שווי מימוש לאיזון', F.nis(be.breakEvenValue), { key: true, m: 'breakEven', how: 'שווי המימוש שבו הרווח של ALTARIS = 0 (חיפוש בינארי על שווי המימוש).' })}
      ${lr('ירידת שווי מקסימלית לפני הפסד', F.pct(be.maxDeclineBeforeLoss))}
      ${lr('שווי שבו נפגעת הקרן', F.nis(be.impairmentValue), { how: 'שווי המימוש הנמוך ביותר שבו הקרן מוחזרת במלואה.' })}
      ${lr('ירידת שווי מקסימלית לפני פגיעה בהון', F.pct(be.maxDeclineBeforeImpairment), { key: true })}
      <div class="ax-lgt">גבייה בתרחיש השלילי${mi('recovery')}</div>
      ${rec ? lr('תביעה · תמורה', `${F.m(rec.claim)} · ${F.m(rec.proceeds)}`) + lr('שיעור גבייה', F.pct(rec.rate), { key: true }) + lr('פגיעה בקרן', F.nis(rec.principalLoss), { neg: rec.principalLoss > 0 }) + lr('IRR בתרחיש', F.pct(E.irrOf(rc)), { neg: E.irrOf(rc) < 0 }) : rc && rc.ok ? lr('רווח בתרחיש', F.nis(rc.profit), { neg: rc.profit < 0 }) + lr('IRR בתרחיש', F.pct(E.irrOf(rc)), { neg: E.irrOf(rc) < 0 }) : lr('תרחיש', '—')}
    </div></div>`;
    const parts = [{ label: 'עמלות', v: b.fee }, { label: 'קופונים', v: b.coupons }, { label: 'תשואה מועדפת', v: b.prefPaid }, { label: 'השתתפות ברווח', v: b.participation },
      { label: 'אופציה / backstop נטו', v: b.optionResale - b.optionPaid + b.backstopResale - b.backstopPaid }, { label: 'חוסר בפירעון', v: -b.shortfall }].filter((x) => Math.abs(x.v) > 0.5);
    const resid = b.profit - parts.reduce((a, x) => a + x.v, 0);
    if (Math.abs(resid) > 1) parts.push({ label: 'עלויות ואחר', v: resid });
    const comp = C.waterfall(parts.concat([{ label: 'רווח משולב', v: b.profit, total: true }]), { title: 'הרכב התשואה', question: 'איזה חלק מהתשואה חוזי ואיזה תלוי בשווי?', w: CW(true) });
    return `<div class="ax-res two">${left}${right}</div><div class="ax-res two">${comp}${collateralFlow(b.collateral, i.haircutPct / 100, b.priorLiens, b.exposure)}</div>`;
  }

  /* --------------------------------------------- section 4: scenarios + stress */
  const SCEN_ROWS = [
    { k: 'valueShock', l: 'שינוי בשווי היציאה / המימוש', u: '%', who: 'כל המבנים' },
    { k: 'haircutAdd', l: 'Haircut נוסף ביציאה', u: 'נ״א', who: 'BUY' },
    { k: 'delay', l: 'שינוי בזמן היציאה', u: 'ח׳', who: 'כל המבנים' },
    { k: 'rateAdd', l: 'שינוי בריבית החוב', u: 'נ״א', who: 'BUY (חוב הרכישה)' },
    { k: 'rentChg', l: 'שינוי בשכירות', u: '%', who: 'BUY' },
    { k: 'opexChg', l: 'שינוי בעלויות התפעול', u: '%', who: 'BUY' },
    { k: 'collateralShock', l: 'שינוי בשווי הבטוחות', u: '%', who: 'FINANCE · HYBRID', ph: '= שווי' },
    { k: 'default', l: 'כשל הלווה ומימוש בטוחות', u: '', who: 'FINANCE · HYBRID', bool: true },
    { k: 'defaultMonth', l: 'חודש הכשל', u: 'ח׳', who: 'FINANCE · HYBRID', ph: 'בתשלום הקרן הראשון' },
    { k: 'enforcementMonths', l: 'משך מימוש', u: 'ח׳', who: 'FINANCE · HYBRID', ph: 'מההנחות' },
    { k: 'enforcementCostPct', l: 'עלויות מימוש', u: '%', who: 'FINANCE · HYBRID', ph: 'מההנחות' },
    { k: 'backstopUnsoldPct', l: 'מלאי לא מכור (backstop)', u: '%', who: 'HYBRID', ph: 'מההנחות' },
  ];
  const ATTR_HE = { valueShock: 'שווי יציאה', haircutAdd: 'haircut נוסף', delay: 'עיכוב ביציאה', rateAdd: 'עלות חוב', rentChg: 'שכירות', opexChg: 'עלויות תפעול', collateralShock: 'שווי בטוחות', default: 'כשל ומימוש בטוחות', backstopUnsoldPct: 'מלאי לא מכור' };
  function secStress() {
    const cell = (sc, r) => {
      const v = E.scenario(S.deal, sc)[r.k];
      const user = S.deal.scen && S.deal.scen[sc] && S.deal.scen[sc][r.k] != null;
      if (r.bool) return `<td><label class="ax-switch"><input type="checkbox" data-sc="${sc}.${r.k}"${v ? ' checked' : ''}> כן</label></td>`;
      return `<td><input class="n${user ? '' : ' dflt'}" type="text" inputmode="decimal" data-sc="${sc}.${r.k}" value="${esc(v == null ? '' : String(v))}" placeholder="${esc(r.ph || '')}" aria-label="${esc(r.l)} · ${sc === 'downside' ? 'שלילי' : 'חיובי'}" style="width:88px"></td>`;
    };
    return `<section class="ax-sec" id="s-stress">${secHead(4, 'תרחישים ומבחני לחץ', 'שלושה תרחישים לכל עסקה. הבסיס הוא העסקה כפי שהוזנה; בשלילי ובחיובי כל הנחה משתנה בנפרד. מבחני הלחץ מופעלים על תרחיש הבסיס.')}
      <div class="ax-tbl-wrap"><table class="ax-tbl ax-scen"><thead><tr><th>משתנה</th><th>משפיע על</th><th>שלילי (DOWNSIDE)</th><th>בסיס (BASE)</th><th>חיובי (UPSIDE)</th><th></th></tr></thead><tbody>
      ${SCEN_ROWS.map((r) => `<tr><td>${esc(r.l)}</td><td class="ax-muted">${esc(r.who)}</td>${cell('downside', r)}<td class="base">כפי שהוזן</td>${cell('upside', r)}<td class="ax-muted">${esc(r.u)}</td></tr>`).join('')}
      </tbody></table></div>
      <div style="display:flex;gap:6px;margin-top:8px"><button type="button" class="ax-btn" data-act="reset-scen">איפוס התרחישים לברירות המחדל</button></div>
      <h3 class="ax-h3">תוצאות לפי תרחיש${mi('scenarios')}</h3><div id="o-scen"></div>
      <h3 class="ax-h3">מבחני לחץ על תרחיש הבסיס${mi('stress')} <span class="ax-muted">— לחיצה מציגה את ההשפעה גם ב-ledger</span></h3>
      <div class="ax-press" id="o-press"></div><div id="o-stressgrid"></div>
      <div id="o-attr" style="margin-top:14px"></div></section>`;
  }
  function paintScenarios() {
    const box = $('#o-scen'); if (!box) return;
    const R = S.R;
    const cellOf = (r) => (r && r.ok ? `<b class="num">${F.pct(E.irrOf(r))}</b><div class="ax-muted num">${F.m(r.profit)} · ${F.x(E.moicOf(r))} · ${F.mo(r.months)}</div>` : '—');
    box.innerHTML = `<div class="ax-tbl-wrap"><table class="ax-tbl data ax-mx"><thead><tr><th>מבנה</th><th class="n">שלילי</th><th class="n hl">בסיס</th><th class="n">חיובי</th></tr></thead><tbody>${E.STRATS.map((k) => {
      const s = R.strategies[k];
      return `<tr${S.strat === k ? ' class="pick"' : ''}><td><span class="st" style="--c:${SC[k]}">${SN[k]}</span></td><td class="n">${cellOf(s.downside)}</td><td class="n hl">${cellOf(s.base)}</td><td class="n">${cellOf(s.upside)}</td></tr>`;
    }).join('')}</tbody></table></div><p class="ax-muted">בכל תא: IRR · רווח · MOIC · משך.</p>`;
    const pr = $('#o-press');
    if (pr) pr.innerHTML = E.STRESS.map((x) => `<button type="button" class="ax-btn${S.stress === x.id ? ' on' : ''}" data-stress="${x.id}" aria-pressed="${S.stress === x.id}">${esc(STRESS_HE[x.id])}</button>`).join('') + (S.stress ? `<button type="button" class="ax-btn" data-stress="">ביטול מבחן הלחץ</button>` : '');
    const g = $('#o-stressgrid');
    if (g) g.innerHTML = `<div class="ax-tbl-wrap"><table class="ax-tbl data ax-mx"><thead><tr><th>מבחן לחץ</th>${E.STRATS.map((k) => `<th class="n">${SN[k]} · IRR</th><th class="n">שינוי ברווח</th>`).join('')}</tr></thead><tbody>${E.STRESS.map((x) => `<tr><td${S.stress === x.id ? ' class="hl"' : ''}>${esc(STRESS_HE[x.id])}</td>${E.STRATS.map((k) => {
      const s = R.strategies[k], b = s.base, r = s.stress && s.stress[x.id];
      if (!b.ok || !r || !r.ok) return '<td class="n">—</td><td class="n">—</td>';
      const dI = (E.irrOf(r) ?? -1) - (E.irrOf(b) ?? -1), dP = r.profit - b.profit;
      return `<td class="n${S.stress === x.id ? ' hl' : ''}">${F.pct(E.irrOf(r))} <span class="ax-delta ${dI < -1e-9 ? 'down' : dI > 1e-9 ? 'up' : ''}">${Math.abs(dI) < 5e-5 ? 'ללא שינוי' : F.pp(dI)}</span></td><td class="n${S.stress === x.id ? ' hl' : ''}">${Math.abs(dP) < 1 ? '—' : F.signed(dP)}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div><p class="ax-muted">FINANCE: הריבית החוזית קבועה, ולכן מבחן עלות החוב אינו משנה אותה; ירידת שווי פוגעת בתשואה רק כשהבטוחות אינן מכסות את התביעה.</p>`;
    const at = $('#o-attr'); if (!at) return;
    const s = R.strategies[S.strat], a = s.attribution;
    if (!a) { at.innerHTML = ''; return; }
    const moved = a.steps.filter((x) => Math.abs(x.dIrr) >= 5e-4 || Math.abs(x.v) >= 1);   // an assumption with no effect is listed in the ledger, not drawn
    const items = [{ label: 'IRR בסיס', v: a.baseIrr, total: true }].concat(moved.map((x) => ({ label: ATTR_HE[x.k] || x.k, v: x.dIrr }))).concat([{ label: 'IRR בתרחיש השלילי', v: a.downsideIrr, total: true }]);
    at.innerHTML = `<div class="ax-res two">${C.waterfall(items, { title: `מפל התרחיש השלילי · ${SN[S.strat]}`, question: 'איזו הנחה אחראית לכמה מהירידה בתשואה?', fmt: (v) => F.pct(v), tick: (t) => F.pct(t, 0), w: CW(true) })}
      <div><div class="ax-ledger"><div class="ax-lgt">השפעה על הרווח (₪)${mi('attribution')}</div>${lr('רווח בסיס', F.nis(a.base), { key: true })}${a.steps.map((x) => lr(ATTR_HE[x.k] || x.k, Math.abs(x.v) < 1 && Math.abs(x.dIrr) < 5e-4 ? 'ללא השפעה' : `${F.signed(x.v)} · ${F.pp(x.dIrr)}`, { sub: true, neg: x.v < 0 })).join('')}${lr('רווח בתרחיש השלילי', F.nis(a.downside), { key: true, tot: true, neg: a.downside < 0 })}</div>
      <p class="ax-muted" style="margin-top:6px">ההנחות מופעלות אחת אחרי השנייה בסדר המוצג; כל שורה היא השינוי מהשלב הקודם. ב-FINANCE כשל עשוי להגדיל את הרווח בשקלים (ריבית לאורך המימוש) ובו בזמן להוריד את ה-IRR.</p></div></div>`;
  }

  /* ----------------------------------------------- section 5: decision */
  function secDecide() {
    return `<section class="ax-sec" id="s-decide">${secHead(5, 'מרווח ביטחון, מהירות הון והחלטה', 'נקודת האיזון, כמה זמן ההון עובד, ציר הזמן, ציון הסיכון וסיכום ועדת ההשקעות.')}
      <div id="o-mos"></div><div id="o-vel" style="margin-top:16px"></div><div id="o-tl" style="margin-top:16px"></div><div id="o-risk" style="margin-top:16px"></div><div id="o-ic" style="margin-top:16px"></div></section>`;
  }
  function mosData(k) {
    const R = S.R, s = R.strategies[k], b = s.base, Fx = R.facts; if (!b.ok) return null;
    const d = s.downside && s.downside.ok ? s.downside : null;
    if (k === 'buy') {
      return {
        markers: [{ k: 'smv', label: 'שווי נתמך', v: Fx.smv }, { k: 'exit', label: 'יציאה צפויה', v: b.exitGross }, d ? { k: 'down', label: 'יציאה בתרחיש שלילי', v: d.exitGross } : null,
          { k: 'be', label: 'נקודת איזון', v: b.breakEvenExit, note: 'מחיר מכירה שבו הרווח לפני מס = 0' }, { k: 'price', label: 'מחיר רכישה (בסיס ALTARIS)', v: b.price }].filter(Boolean),
        rows: [['מחיר מכירה לאיזון', F.nis(b.breakEvenExit)], ['מחיר למ״ר לאיזון', b.breakEvenPsm ? F.int(b.breakEvenPsm) + ' ₪' : '—'], ['ירידת שווי מקסימלית לפני הפסד', F.pct(b.maxHaircut)],
          ['מחיר רכישה מקסימלי', F.nis(s.limits && s.limits.maxPrice)], ['הנחה מינימלית נדרשת', F.pct(s.limits && s.limits.requiredDiscount)], ['כרית ביטחון', F.nis(b.cushion)], ['כרית ביטחון %', F.pct(b.marginOfSafety)]],
      };
    }
    if (k === 'finance') {
      return {
        markers: [{ k: 'smv', label: 'שווי בטוחות נתמך', v: b.collateral }, { k: 'cons', label: 'שווי שמרני', v: b.conservative }, d ? { k: 'down', label: 'בטוחות בתרחיש שלילי', v: d.collateralStressed } : null,
          { k: 'be', label: 'שווי לאיזון (קרן)', v: b.breakEvenCollateral, note: 'מתחת לשווי זה הקרן נפגעת במימוש' }, { k: 'basis', label: 'חשיפה כוללת (כולל קודמים)', v: b.priorLiens + b.exposure }].filter(Boolean),
        rows: [['שווי בטוחות לאיזון (קרן)', F.nis(b.breakEvenCollateral)], ['שווי לאיזון (תביעה מלאה)', F.nis(b.breakEvenCollateralFull)], ['ירידת שווי מקסימלית לפני פגיעה בקרן', F.pct(b.maxDecline)],
          ['כיסוי בטוחות', F.x(b.coverage)], ['כרית הון', F.nis(b.equityCushion)], ['כרית הון %', F.pct(b.collateral ? b.equityCushion / b.collateral : null)]],
      };
    }
    const be = s.breakEven || {};
    return {
      markers: [{ k: 'smv', label: 'שווי מימוש צפוי', v: b.realization }, d ? { k: 'down', label: 'מימוש בתרחיש שלילי', v: d.realization } : null,
        { k: 'be', label: 'שווי לאיזון', v: be.breakEvenValue, note: 'מתחת לשווי זה ALTARIS מפסידה' }, { k: 'basis', label: 'שווי שבו נפגעת הקרן', v: be.impairmentValue }].filter(Boolean),
      rows: [['שווי מימוש לאיזון', F.nis(be.breakEvenValue)], ['ירידת שווי לפני הפסד', F.pct(be.maxDeclineBeforeLoss)], ['שווי שבו נפגעת הקרן', F.nis(be.impairmentValue)],
        ['ירידת שווי לפני פגיעה בקרן', F.pct(be.maxDeclineBeforeImpairment)], ['כיסוי בטוחות', F.x(b.coverage)], ['כרית הון', F.nis(b.equityCushion)]],
    };
  }
  function paintDecide() {
    const R = S.R, k = S.strat, s = R.strategies[k], b = s.base;
    const mos = $('#o-mos'), vel = $('#o-vel'), tl = $('#o-tl'), rk = $('#o-risk'), ic = $('#o-ic');
    if (!mos) return;
    if (!b.ok) { mos.innerHTML = needBox(`<b>חסרים נתונים:</b> ${esc(missingTxt(b.missing))}`); vel.innerHTML = tl.innerHTML = rk.innerHTML = ''; ic.innerHTML = icHTML(); return; }
    const md = mosData(k);
    const smv = md.markers.find((m) => m.k === 'smv');
    mos.innerHTML = `<h3 class="ax-h3" style="margin-top:0">מרווח ביטחון · ${SN[k]}${mi('mos')}</h3><div class="ax-two">${C.ladder(md.markers, { smv: smv && smv.v, title: '', question: 'כמה השווי יכול לרדת לפני ש-ALTARIS מפסידה?', w: CW(true) })}
      <div><div class="ax-ledger">${md.rows.map(([l, v], i) => lr(l, v, { key: i === 0 || i === 2 })).join('')}</div>
      <div class="ax-ledger" style="margin-top:10px"><div class="ax-lgt">כל המבנים · ירידת שווי מקסימלית לפני הפסד / פגיעה בקרן</div>${E.STRATS.map((x) => lr(SN[x], F.pct(R.strategies[x].mos))).join('')}</div></div></div>`;
    const v = s.velocity;
    vel.innerHTML = v ? `<h3 class="ax-h3">מהירות הון · ${SN[k]}${mi('velocity')} <span class="ax-muted">— ALTARIS ממחזרת הון, לא מחזיקה נכסים 5–10 שנים</span></h3>
      <div class="ax-two"><div><div class="ax-ledger">${lr('הון מושקע', F.nis(v.capital), { key: true })}${lr('משך צפוי', F.mo(v.months))}${lr('מועד החזרת ההון', F.date(v.returnDate))}
      ${lr('מחזורי הון בשנה', v.turnsPerYear.toFixed(2) + 'x', { how: '12 ÷ משך העסקה בחודשים' })}${lr('תשואה שנתית (IRR)', F.pct(v.irr))}
      ${lr(`סבבים בחיי הקרן (${R.settings.fundLifeYears} שנים)`, String(v.cycles), { how: `⌊(חיי הקרן ${v.lifeMonths} + השהיה ${v.lagMonths}) ÷ (משך ${v.months} + השהיה ${v.lagMonths})⌋` })}
      ${lr('AUM מוחזק (בכל רגע)', F.nis(v.aumHeld))}${lr('הון מצטבר שהושקע — קרן בלבד', F.nis(v.cumulativeFlat), { key: true })}${lr('הון מצטבר שהושקע — כולל רווחים', F.nis(v.cumulativeDeployed), { how: 'כשהרווח של כל סבב מושקע מחדש: הון × MOIC בכל סבב' })}</div>
      <p class="ax-muted" style="margin-top:6px">לדוגמה: ${F.m(v.capital)} הון ראשוני · עסקה של ${v.months} חודשים · ההון חוזר ומושקע מחדש · ${v.cycles} סבבים: AUM של ${F.m(v.aumHeld)} מייצר ${F.m(v.cumulativeFlat)} הון מצטבר שהושקע. השוואה: ${E.STRATS.map((x) => `${SN[x]} ${R.strategies[x].velocity ? R.strategies[x].velocity.turnsPerYear.toFixed(2) + 'x' : '—'}`).join(' · ')} מחזורים בשנה.</p></div>
      ${C.columns(v.schedule.map((c) => ({ label: 'סבב ' + c.n, held: v.aumHeld, cum: v.capital * c.n })), { title: 'AUM מוחזק מול הון מצטבר שהושקע', question: 'כמה הון ALTARIS מזיזה בחיי הקרן עם אותו AUM?', series: [{ k: 'held', c: 'var(--ink-3)', n: 'AUM מוחזק' }, { k: 'cum', c: 'var(--navy)', n: 'הון מצטבר שהושקע' }], periodLabel: 'סבב', w: CW(true) })}</div>` : '';
    tl.innerHTML = timelineHTML(k);
    rk.innerHTML = riskHTML(k);
    ic.innerHTML = icHTML();
  }
  function timelineHTML(k) {
    const R = S.R, s = R.strategies[k], b = s.base, i = s.inputs, t0 = R.facts.t0, lag = E.num(R.settings.redeployLagMonths) || 0;
    const ev = (d, t, sub, done) => `<div class="ev${done ? ' done' : ''}" style="--c:${SC[k]}"><span class="d">${esc(F.date(d))}</span><div class="t">${esc(t)}</div><div class="s">${esc(sub)}</div></div>`;
    let evs;
    if (k === 'buy') evs = [ev(t0, 'T0 · רכישה', `הון מושקע ${F.m(b.flows[0] ? -b.flows[0].amount : null)}`, true), ev(E.addMonths(t0, 1), 'החזקה', `${b.months} חודשים · החזקה ${F.m(b.holding)}${b.rentCarry ? ' · שכירות ' + F.m(b.rentCarry) : ''}`),
      ev(b.exitDate, 'מכירה', `שווי יציאה ${F.m(b.exitGross)} · ${optLabel('buyExit', i.exitPrimary)}`), ev(b.exitDate, 'החזרת הון', `תמורה נטו לאחר חוב ${F.m(b.flows[b.flows.length - 1].amount)}`), ev(E.addMonths(b.exitDate, lag), 'השקעה מחדש', `אחרי ${lag} חודשי השהיה`)];
    else if (k === 'finance') evs = [ev(t0, 'T0 · העמדת הלוואה', `${F.m(b.amount)} · עמלה ${F.m(b.fee)}`, true), ev(E.addMonths(t0, 1), 'ריבית', i.interestMode === 'accrued' ? `נצברת · ${i.ratePct}% לשנה` : `חודשית · ${F.m(b.amount * i.ratePct / 1200)} לחודש`),
      ev(E.addMonths(t0, b.term), 'מועד פירעון', `${optLabel('finSource', i.sourcePrimary)}`), ev(b.exitDate, 'פירעון', `${F.m(b.paid)} · עמלת פירעון ${F.m(b.exitFee)}`), ev(E.addMonths(b.exitDate, lag), 'השקעה מחדש', `אחרי ${lag} חודשי השהיה`)];
    else evs = [ev(t0, 'T0 · השקעה', `${F.m(b.capital)}${b.commitment > b.capital ? ' · התחייבות ' + F.m(b.commitment) : ''}`, true), ev(E.addMonths(t0, 1), i.prefPct ? 'תשואה מועדפת נצברת' : 'קופון', i.prefPct ? `${i.prefPct}% לשנה, משולמת במימוש` : `${i.couponPct}% לשנה, שוטף`),
      ev(E.addMonths(t0, E.num(i.termMonths)), 'טריגר / מימוש', i.triggerNote || optLabel('finSource', i.sourcePrimary)), ev(b.exitDate, 'החזרת הון', `${F.m(b.distributions)} סך התקבולים${b.participation ? ' · השתתפות ' + F.m(b.participation) : ''}`), ev(E.addMonths(b.exitDate, lag), 'השקעה מחדש', `אחרי ${lag} חודשי השהיה`)];
    return `<h3 class="ax-h3">ציר זמן · ${SN[k]}</h3><div class="ax-tl">${evs.join('')}</div>
      <h3 class="ax-h3">שיא פריסת ההון · ${SN[k]} ${F.m(b.peakCapital)}${mi('peakCapital')} <span class="ax-muted">— הנקודה הנמוכה בעקומה המצטברת</span></h3>
      <div>${C.cumulative(E.STRATS.filter((x) => R.strategies[x].base.ok).map((x) => ({ k: x, flows: R.strategies[x].base.flows })), { title: 'ציר הון מצטבר · כל המבנים', question: 'מתי ההון בשיא החשיפה, ומתי הוא חוזר?', w: CW(false) })}</div>`;
  }
  function riskHTML(k) {
    const s = S.R.strategies[k], r = s.risk; if (!r) return '';
    return `<h3 class="ax-h3">ציון סיכון · ${SN[k]}${mi('riskScore')}${modelTag()} <span class="ax-muted">— ציון מודל 0–100 מרכיבים מוסברים · גבוה = סיכון נמוך יותר · אינו הסתברות להפסד</span></h3><div>${r.components.map((c) => `<div class="ax-rk"><span class="l">${esc(RISK_HE[c.k])}</span><span class="bar"><i style="width:${c.score}%"></i></span><span class="v">${c.score}</span><span class="w">${esc(c.why)}${c.weight !== 1 ? ` · משקל ${c.weight}` : ''}</span></div>`).join('')}
      <div class="ax-rk tot"><span class="l">ציון כולל</span><span class="bar"><i style="width:${r.overall}%"></i></span><span class="v">${r.overall}</span><span class="w">ממוצע משוקלל של שמונת הרכיבים (המשקלות בהגדרות הקרן). 100 = הסיכון הנמוך ביותר. ציון מודל יחסי — אינו הסתברות להפסד ואינו דירוג אשראי.</span></div></div>`;
  }
  function icData(R) {
    R = R || S.R;
    const Fx = R.facts, ic = R.ic, k = ic.strategy, s = k ? R.strategies[k] : null, b = s && s.base.ok ? s.base : null, d = s && s.downside && s.downside.ok ? s.downside : null, info = S.deal.info || {};
    const exitLbl = (v) => (v ? (E.SOURCE_HE[v] || optLabel('finSource', v)) : '—');
    return {
      k, b, rows: [
        ['עסקה', dealName(S.deal)], ['יזם', info.developer || '—'], ['פרויקט', info.project || '—'], ['מיקום', [info.address, info.neighborhood, info.city].filter(Boolean).join(', ') || '—'],
        ['מבנה', k ? `${SN[k]} · ${SH[k]}` : '—'], ['שווי נתמך', F.nis(Fx.smv)], ['הון נדרש', b ? F.nis(E.capOf(b)) : '—'],
        ['בסיס כניסה', k === 'buy' && b ? F.nis(b.price) : k === 'finance' && b ? `הלוואה ${F.nis(b.amount)}` : b ? `הון ${F.nis(b.capital)}` : '—'],
        ['משך צפוי', b ? F.mo(b.months) : '—'], ['IRR בסיס', b ? F.pct(E.irrOf(b)) : '—'], ['IRR בתרחיש שלילי', d ? F.pct(E.irrOf(d)) : '—'], ['MOIC', b ? F.x(E.moicOf(b)) : '—'],
        ['מרווח ביטחון', s ? F.pct(s.mos) : '—'], ['LTV · כיסוי', b ? (k === 'buy' ? `LTV ${F.pct(b.ltv)} · שווי/בסיס ${F.x(b.valueToBasis)}` : `LTV ${F.pct(b.ltv)} · כיסוי ${F.x(b.coverage)}`) : '—'],
        ['יציאה עיקרית', exitLbl(ic.primaryExit)], ['יציאה משנית', exitLbl(ic.secondaryExit)],
        ['הסיכון העיקרי', ic.mainRisk || '—'], ['ההגנה העיקרית', ic.mainProtection ? ic.mainProtection.replace(/^\+ /, '') : '—'], ['אות השקעה', R.signal.code],
      ],
      why: ic.why, risks: ic.risks, signal: R.signal,
    };
  }
  function icHTML(print) {
    const D = icData(), R = S.R;
    const tag = (r) => (r[0] === 'אות השקעה' ? `${r[1]} · ${SIG_HE[r[1]] || ''}` : r[1]);
    const long = new Set(['עסקה', 'הסיכון העיקרי', 'ההגנה העיקרית', 'מיקום', 'אות השקעה']);
    const IC_M = { 'שווי נתמך': 'supportedValue', 'הון נדרש': 'capitalAtRisk', 'משך צפוי': 'wal', 'IRR בסיס': 'irr', 'IRR בתרחיש שלילי': 'scenarios', 'MOIC': 'moic', 'מרווח ביטחון': 'mos', 'LTV · כיסוי': 'coverage' };
    return `<div class="ax-ic">${illusBanner()}<div class="ax-ic-h"><div><span class="w">ALTARIS INVESTMENT COMMITTEE SNAPSHOT</span><h3>${esc(dealName(S.deal))}</h3></div><span class="ax-muted num">${esc(F.date(TODAY))}${S.dealId && S.deals[S.dealId] ? ' · גרסה ' + S.deals[S.dealId].versions.length : ''}</span></div>
      <div class="ax-ic-grid">${D.rows.filter((r) => !long.has(r[0])).map((r) => lr(r[0], tag(r), { key: r[0] === 'אות השקעה' || r[0] === 'IRR בסיס', m: print ? null : IC_M[r[0]] })).join('')}</div>
      <div class="ax-ledger" style="border-top:1px solid var(--hairline);margin-top:6px">${D.rows.filter((r) => long.has(r[0])).map((r) => `<div class="ax-lr" style="grid-template-columns:120px minmax(0,1fr)"><span class="l">${esc(r[0])}</span><span style="text-align:start;font-size:12.5px${r[0] === 'אות השקעה' ? ';font-weight:800' : ''}">${esc(tag(r))}</span></div>`).join('')}</div>
      <div class="ax-ic-cols"><div><h4>WHY THIS DEAL · למה העסקה</h4><ul>${D.why.length ? D.why.map((w) => `<li>${esc(w)}</li>`).join('') : '<li class="ax-muted">אין עדיין נימוקים — השלימו את הנתונים.</li>'}</ul></div>
      <div><h4>KEY RISKS · סיכונים מרכזיים</h4><ul class="r">${D.risks.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>
      <div class="ax-signal ${SIG_CLASS[R.signal.code] || ''}" style="margin-top:12px"><div class="lbl">ALTARIS STRUCTURE SIGNAL${print ? '' : mi('signal')}</div><div class="code"><i></i>${esc(R.signal.code)}</div><ul>${R.signal.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>
      <p class="ax-muted" style="margin-top:8px">הנחות המס הן לצורך ניתוח השקעה בלבד ויש לאשרן מול המבנה המשפטי הסופי. האות מבוסס על ספי הקרן שבהגדרות ועל התרחישים שהוזנו — אינו המלצה אוטומטית.</p>
      ${print ? '' : `<p class="ax-mline">המדדים לפי מוסכמות החישוב של ALTARIS · <button type="button" class="ax-link" data-mgo="">${esc(MD.VERSION.label.he)} ›</button></p>`}
      ${print ? '' : `<div class="ax-exp"><button type="button" class="ax-btn pri" data-act="pdf-ic">PDF · סיכום ועדת השקעות</button><button type="button" class="ax-btn" data-act="pdf-full">PDF · חיתום מלא</button><button type="button" class="ax-btn" data-act="xlsx">Excel · חישובים והנחות</button><button type="button" class="ax-btn" data-act="csv">CSV</button><button type="button" class="ax-btn" data-act="json">קובץ עסקה (JSON)</button><label class="ax-switch ax-appx"><input type="checkbox" data-act-check="appendix"${S.mAppendix !== false ? ' checked' : ''}> PDF כולל נספח מתודולוגיה</label></div>`}</div>`;
  }

  /* ===================================================== view: compare */
  function paintCompare() {
    const box = $('#o-compare'); if (!box) return;
    const R = S.R, cmp = R.compare, sig = R.signal, Fx = R.facts;
    if (!Fx.smv) { box.innerHTML = `<section class="ax-sec">${secHead('', 'השוואת מבנים')}${needBox('כדי להשוות בין המבנים יש לבחור <b>שווי לצורך חיתום</b> בעסקה. <button class="ax-link" type="button" data-view-go="deal">לעסקה</button>')}</section>`; return; }
    const pref = /^(STRONG|PREFER)/.test(sig.code) ? sig.strategy : null;
    const col = (k, f) => { const c = cmp[k]; return c.ok ? f(c, R.strategies[k]) : '—'; };
    const rows = [
      ['הון נדרש', (c) => F.m(c.capital), 'CAPITAL REQUIRED'], ['משך צפוי', (c) => F.mo(c.months), 'EXPECTED DURATION'], ['רווח צפוי', (c) => F.m(c.profit), 'EXPECTED PROFIT'],
      ['IRR בסיס', (c) => F.pct(c.irr), 'BASE IRR'], ['IRR בתרחיש שלילי', (c) => F.pct(c.irrDown), 'DOWNSIDE IRR'], ['IRR בתרחיש חיובי', (c) => F.pct(c.irrUp), 'UPSIDE IRR'],
      ['MOIC', (c) => F.x(c.moic), 'MOIC'], ['מרווח ביטחון', (c) => F.pct(c.mos), 'MARGIN OF SAFETY'],
      ['כיסוי בטוחות', (c) => (c.coverageKind === 'value-to-basis' ? `${F.x(c.coverage)} · בעלות בנכס` : F.x(c.coverage)), 'COLLATERAL COVERAGE'],
      ['הגנה בתרחיש שלילי', (c) => `${F.m(c.downProfit)}${c.recoveryRate != null ? ' · גבייה ' + F.pct(c.recoveryRate, 0) : ''}`, 'DOWNSIDE PROTECTION'],
      ['מהירות הון', (c) => (c.turns ? c.turns.toFixed(2) + 'x בשנה' : '—'), 'CAPITAL VELOCITY'],
      ['תלות ביציאה', (c) => `${{ high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' }[c.exitDependencyLevel] || '—'} · ${F.pct(c.exitDependency, 0)}`, 'EXIT DEPENDENCY'],
      ['נזילות', (c) => ({ high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' }[c.liquidity] || '—'), 'LIQUIDITY'],
      ['ציון סיכון', (c) => (c.risk != null ? c.risk + ' / 100' : '—'), 'RISK SCORE'],
      ['ספי קרן', (c) => `${c.hurdlesPassed}/${c.hurdlesTotal} מתקיימים`, 'FUND HURDLES'],
    ];
    const HOWS = { 'הון נדרש': 'ההון ש-ALTARIS מסכנת: שיא הפריסה המצטברת בתרחיש הבסיס; במבנה משולב — הגבוה מבין השיא, ההתחייבות המקסימלית, וההון + backstop + מחיר האופציה.', 'IRR בסיס': 'XIRR על התזרים המתוארך. כשבתרחיש לא הועמד הון (backstop שלא הופעל), או שלתזרים אין IRR — תשואה שנתית על ההון המחויב.', 'מרווח ביטחון': 'BUY: ירידת שווי מקסימלית מהשווי הנתמך לפני הפסד. FINANCE: ירידת שווי בטוחות לפני פגיעה בקרן. HYBRID: ירידת שווי מימוש לפני פגיעה בהון.',
      'כיסוי בטוחות': 'FINANCE / HYBRID: (שווי × (1 − מקדם ביטחון) − שעבודים קודמים) ÷ חשיפה. BUY: ALTARIS בעלים — שווי נתמך ÷ בסיס כולל.',
      'תלות ביציאה': 'החלק מסך התקבולים שמגיע באירוע הנזילות האחרון. גבוהה ≥ 85% · בינונית ≥ 60%.', 'נזילות': 'לפי משך: עד 12 חודשים גבוהה · עד 24 בינונית · מעל נמוכה.',
      'מהירות הון': '12 ÷ משך בחודשים', 'הגנה בתרחיש שלילי': 'רווח (או הפסד) בתרחיש השלילי, ושיעור הגבייה כשיש מימוש בטוחות.' };
    const CMP_M = { 'הון נדרש': 'capitalAtRisk', 'משך צפוי': 'wal', 'רווח צפוי': 'profit', 'IRR בסיס': 'irr', 'IRR בתרחיש שלילי': 'scenarios', 'IRR בתרחיש חיובי': 'scenarios', 'MOIC': 'moic', 'מרווח ביטחון': 'mos',
      'כיסוי בטוחות': 'coverage', 'הגנה בתרחיש שלילי': 'recovery', 'מהירות הון': 'velocity', 'תלות ביציאה': 'exitDependency', 'נזילות': 'exitDependency', 'ציון סיכון': 'riskScore', 'ספי קרן': 'hurdles' };
    const table = `<div class="ax-tbl-wrap"><table class="ax-tbl data ax-mx"><thead><tr><th></th>${E.STRATS.map((k) => `<th class="n${pref === k ? ' hl' : ''}"><span class="st" style="--c:${SC[k]}">${SN[k]}</span><div class="ax-muted" style="font-weight:500">${SH[k]}${pref === k ? ' · מועדף' : ''}</div></th>`).join('')}</tr></thead><tbody>${rows.map(([l, f, en]) => `<tr><td>${esc(l)} <span class="ax-muted" style="font-size:10px;direction:ltr;unicode-bidi:isolate">${en}</span>${l === 'ציון סיכון' ? ' ' + modelTag() : ''}${CMP_M[l] ? ' ' + mi(CMP_M[l], HOWS[l]) : HOWS[l] ? ' ' + how(HOWS[l]) : ''}</td>${E.STRATS.map((k) => `<td class="n${pref === k ? ' hl' : ''}">${esc(col(k, f))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const hkeys = []; for (const k of E.STRATS) for (const h of R.strategies[k].hurdles) if (!hkeys.includes(h.k)) hkeys.push(h.k);
    const fmtH = (h, v) => (h.fmt === 'pct' ? F.pct(v) : h.fmt === 'x' ? F.x(v) : String(v));
    const hmx = `<div class="ax-tbl-wrap"><table class="ax-tbl data"><thead><tr><th>סף קרן</th>${E.STRATS.map((k) => `<th class="n">${SN[k]}</th>`).join('')}</tr></thead><tbody>${hkeys.map((hk) => `<tr><td>${esc(E.HURDLE_HE[hk])}${hk === 'duration' ? ' (חודשים)' : ''}</td>${E.STRATS.map((k) => { const h = R.strategies[k].hurdles.find((x) => x.k === hk); return h ? `<td class="n"><span class="${h.pass ? 'up' : 'down'}">${h.pass ? '✓' : '✗'}</span> ${esc(fmtH(h, h.value))} <span class="ax-muted">/ ${esc(fmtH(h, h.limit))}</span></td>` : '<td class="n ax-muted">לא חל</td>'; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    const dumb = C.dumbbell(E.STRATS.filter((k) => cmp[k].ok).map((k) => ({ k, base: cmp[k].irr, down: cmp[k].irrDown, up: cmp[k].irrUp })), { hurdle: R.settings.minIrr / 100, title: 'השוואת מבנים · IRR בבסיס ובתרחישים', question: 'איזה מבנה שומר על התשואה כשהיציאה משתבשת?', w: CW(true) });
    const cum = C.cumulative(E.STRATS.filter((k) => cmp[k].ok).map((k) => ({ k, flows: R.strategies[k].base.flows })), { title: 'ציר הון · מצב מזומן מצטבר', question: 'כמה הון כל מבנה דורש ולכמה זמן?', w: CW(true) });
    const fin = R.strategies.finance.base, hyb = R.strategies.hybrid.base;
    box.innerHTML = `<section class="ax-sec">${secHead('', 'השוואת מבנים · BUY מול FINANCE מול HYBRID', `${esc(dealName(S.deal))} · שווי נתמך ${F.m(Fx.smv)} · אותה עסקה, שלוש צורות הון. האות אינו קובע מבנה "נכון" — הוא מסביר איזה מבנה עדיף לפי ספי הקרן והתרחישים.`)}
      <div class="ax-signal ${SIG_CLASS[sig.code] || ''}"><div class="lbl">ALTARIS STRUCTURE SIGNAL${mi('signal')}</div><div class="code"><i></i>${esc(sig.code)}<span class="ax-muted" style="font-weight:600;font-size:12px">${esc(SIG_HE[sig.code] || '')}</span></div><ul>${sig.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>
      <h3 class="ax-h3">טבלת השוואה</h3>${table}<h3 class="ax-h3">ספי הקרן לפי מבנה${mi('hurdles')} <span class="ax-muted">— ✓ מתקיים · ✗ לא מתקיים · ערך בפועל / סף</span></h3>${hmx}</section>
      <section class="ax-sec">${secHead('', 'תשואה, זמן והון')}<div class="ax-res two">${dumb}${cum}</div></section>
      <section class="ax-sec">${secHead('', 'כיסוי בטוחות · FINANCE ו-HYBRID')}<div class="ax-res two">${fin.ok ? collateralFlow(fin.collateral, fin.haircut, fin.priorLiens, fin.exposure, 'FINANCE · כיסוי בטוחות') : ''}${hyb.ok ? collateralFlow(hyb.collateral, R.strategies.hybrid.inputs.haircutPct / 100, hyb.priorLiens, hyb.exposure, 'HYBRID · כיסוי בטוחות') : ''}</div></section>`;
  }

  /* ===================================================== view: portfolio */
  const liveDeals = () => Object.values(S.deals).filter((r) => r.versions && r.versions.length);
  function portfolioItems() { return liveDeals().map((r) => ({ id: r.id, deal: r.versions[r.versions.length - 1].deal, status: r.status, archived: r.archived })); }
  let pctxRev = -1, pctx = [];
  function portfolioCtx() {
    if (pctxRev === S.dealsRev) return pctx.filter((x) => x.id !== S.dealId);
    pctxRev = S.dealsRev;
    try { pctx = E.portfolio(portfolioItems(), S.settings, { today: TODAY }).rows.map((r) => ({ id: r.id, developer: r.developer, project: r.project, city: r.city, capital: r.capital })); } catch (e) { pctx = []; }
    return pctx.filter((x) => x.id !== S.dealId);
  }
  function paintPortfolio() {
    const box = $('#o-portfolio'); if (!box) return;
    const items = portfolioItems();
    if (!items.length) { box.innerHTML = `<section class="ax-sec">${secHead('', 'פורטפוליו')}<div class="ax-empty"><b>אין עדיין עסקאות בפורטפוליו</b><p>כל עסקה שנשמרת הופכת לשורה כאן, עם המבנה שנבחר לביצוע (או המבנה המועדף לפי האות). עסקאות בארכיון, שנדחו או שמומשו אינן נספרות בחשיפה.</p><button class="ax-btn pri" type="button" data-view-go="deal">לעסקה חדשה</button></div></section>`; return; }
    const P = E.portfolio(items, S.settings, { today: TODAY }), sm = P.summary, st = P.settings;
    const strat = (k) => sm.byStrategy.find((x) => x.key === k) || { capital: 0, share: 0 };
    const kp = `<div class="ax-kpis">${kpi('הון מושקע כולל', F.m(sm.capital), sm.fundUse != null ? `${F.pct(sm.fundUse)} מהקרן` : '', { m: 'portfolio', how: 'סכום ההון בסיכון של העסקאות הפעילות, במבנה שנבחר לביצוע או במבנה המועדף.' })}${kpi('שווי נתמך כולל', F.m(sm.smv), `${sm.deals} עסקאות`)}${kpi('IRR משוקלל', F.pct(sm.irr), 'לפי הון', { m: 'portfolio', how: 'ממוצע IRR הבסיס של העסקאות, משוקלל בהון הנדרש' })}${kpi('MOIC משוקלל', F.x(sm.moic), 'לפי הון')}${kpi('משך משוקלל', F.mo(sm.months), 'לפי הון')}${kpi('היציאה הקרובה', sm.upcoming[0] ? F.date(sm.upcoming[0].exitDate) : '—', sm.upcoming[0] ? sm.upcoming[0].name : '')}</div>
      <div class="ax-kpis" style="border-top:none">${E.STRATS.map((k) => kpi(`חשיפת ${SN[k]}`, F.m(strat(k).capital), F.pct(strat(k).share))).join('')}${kpi('ריכוזיות יזם', F.pct(sm.topDeveloperShare), sm.byDeveloper[0] ? sm.byDeveloper[0].key : '')}${kpi('ריכוזיות יישוב', F.pct(sm.topCityShare), sm.byCity[0] ? sm.byCity[0].key : '')}${kpi('נזילות צפויה · 3 / 6 / 12 ח׳', `${F.m(sm.liquidity.m3)}`, `6 ח׳ ${F.m(sm.liquidity.m6)} · 12 ח׳ ${F.m(sm.liquidity.m12)}`, { m: 'portfolio', how: 'סך התקבולים החיוביים (קרן ורווח) המתוארכים בכל חלון מהיום' })}</div>`;
    const rows = P.rows.map((r) => `<tr><td><button class="ax-link" type="button" data-act="open" data-id="${esc(r.id)}">${esc(r.name)}</button>${S.deals[r.id] && S.deals[r.id].origin === 'illustrative-case' ? ' <span class="ax-tag ill">להמחשה</span>' : ''}</td><td>${esc(r.developer || '—')}</td><td>${esc(r.project || '—')}</td><td>${r.strategy ? `<span class="st" style="--c:${SC[r.strategy]}">${SN[r.strategy]}</span>` : '—'}</td><td class="n">${F.m(r.capital)}</td><td class="n">${F.m(r.smv)}</td><td class="n">${F.pct(r.ltv)}</td><td class="n">${F.pct(r.irr)}</td><td class="n">${F.x(r.moic)}</td><td class="n">${F.mo(r.months)}</td><td class="n">${F.date(r.exitDate)}</td><td class="n">${r.risk ?? '—'}</td><td>${statusSelect(r.id)}</td></tr>`).join('');
    const bars = (list, limit, title) => C.shareBars(list.map((x) => ({ label: x.key === '—' ? 'לא הוזן' : x.key, v: x.capital, share: st.fundSize ? x.ofFund : x.share })), { limit: st.fundSize ? limit / 100 : null, title, question: st.fundSize ? 'שיעור מגודל הקרן מול התקרה שהוגדרה' : 'שיעור מההון בפורטפוליו', w: CW(true) });
    const cal = C.columns(sm.calendar.slice(0, 8).map((x) => ({ label: x.q, v: x.v })), { title: 'לוח החזרי הון', question: 'מתי צפוי ההון (קרן ורווח) לחזור לקרן?', periodLabel: 'רבעון', w: CW(true) });
    box.innerHTML = `<section class="ax-sec">${secHead('', 'פורטפוליו', `${sm.deals} עסקאות פעילות · הגרסה האחרונה של כל עסקה, במבנה שנבחר לביצוע או במבנה המועדף. גודל קרן: ${F.m(st.fundSize)}.`)}${kp}
      <h3 class="ax-h3">עסקאות</h3><div class="ax-tbl-wrap"><table class="ax-tbl data"><thead><tr><th>עסקה</th><th>יזם</th><th>פרויקט</th><th>מבנה</th><th class="n">הון</th><th class="n">שווי נתמך</th><th class="n">LTV</th><th class="n">IRR</th><th class="n">MOIC</th><th class="n">משך</th><th class="n">יציאה צפויה</th><th class="n">סיכון</th><th>סטטוס</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <section class="ax-sec">${secHead('', 'חשיפה ולוח נזילות')}<div class="ax-res two">${C.shareBars(sm.byStrategy.map((x) => ({ label: SN[x.key] || x.key, v: x.capital, share: x.share, c: SC[x.key] })), { title: 'חשיפה לפי מבנה', question: 'איך ההון מתחלק בין רכישה, מימון ומבנה משולב?', w: CW(true) })}${cal}</div>
      <div class="ax-res two">${bars(sm.byDeveloper.slice(0, 8), st.maxDevExposure, 'חשיפה לפי יזם')}${bars(sm.byCity.slice(0, 8), st.maxGeoExposure, 'חשיפה לפי יישוב')}</div>
      <h3 class="ax-h3">יציאות קרובות</h3>${sm.upcoming.length ? `<div class="ax-ledger">${sm.upcoming.map((u) => lr(`${u.name} · ${SN[u.strategy] || ''}`, `${F.date(u.exitDate)} · ${F.m(u.capital)}`)).join('')}</div>` : '<p class="ax-muted">אין יציאות צפויות.</p>'}</section>`;
  }
  const statusSelect = (id) => `<select class="ax-status" data-status="${esc(id)}" aria-label="סטטוס">${optsHTML('dealStatus', (S.deals[id] || {}).status || 'draft')}</select>`;

  /* ===================================================== view: saved deals */
  function paintSaved() {
    const box = $('#o-saved'); if (!box) return;
    const all = liveDeals().sort((a, b) => ((b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1));
    const showArch = !!S.showArchived;
    const list = all.filter((r) => showArch || !r.archived);
    const tools = `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><button class="ax-btn pri" type="button" data-act="new">עסקה חדשה</button><label class="ax-btn" style="cursor:pointer">ייבוא קובץ עסקה (JSON)<input type="file" accept="application/json,.json" data-act-file="import" hidden></label><label class="ax-switch"><input type="checkbox" data-act-check="arch"${showArch ? ' checked' : ''}> הצגת ארכיון (${all.filter((r) => r.archived).length})</label></div>`;
    let body;
    if (!all.length) body = `<div class="ax-empty"><b>אין עסקאות שמורות</b><p>העסקאות נשמרות בדפדפן הזה בלבד (localStorage). כדי להעביר עסקה לעמית או למחשב אחר — ייצאו קובץ עסקה (JSON) וייבאו אותו שם.</p><button class="ax-btn pri" type="button" data-view-go="deal">לעסקה חדשה</button></div>`;
    else body = `<div class="ax-tbl-wrap" style="margin-top:10px"><table class="ax-tbl data"><thead><tr><th>עסקה</th><th>יזם</th><th>יישוב</th><th>אות אחרון</th><th>סטטוס</th><th class="n">נשמר</th><th class="n">גרסאות</th><th>פעולות</th></tr></thead><tbody>${list.map((r) => {
      const v = r.versions[r.versions.length - 1], info = v.deal.info || {};
      return `<tr${r.id === S.dealId ? ' class="pick"' : ''}><td><button class="ax-link" type="button" data-act="open" data-id="${esc(r.id)}">${esc(dealName(v.deal))}</button>${r.archived ? ' <span class="ax-tag">ארכיון</span>' : ''}${v.deal.example ? ' <span class="ax-tag">דוגמה</span>' : ''}${fromCase(v.deal) ? ' <span class="ax-tag ill">מבוסס על מקרה להמחשה</span>' : ''}</td><td>${esc(info.developer || '—')}</td><td>${esc(info.city || '—')}</td><td>${esc(v.signal || '—')}</td><td>${statusSelect(r.id)}</td><td class="n">${esc(F.date((r.updatedAt || '').slice(0, 10)))}</td><td class="n">${r.versions.length}</td>
        <td style="white-space:nowrap"><button class="ax-btn" type="button" data-act="dup" data-id="${esc(r.id)}">שכפול</button> <button class="ax-btn" type="button" data-act="archive" data-id="${esc(r.id)}">${r.archived ? 'שחזור' : 'ארכוב'}</button> <button class="ax-btn" type="button" data-act="cmp" data-id="${esc(r.id)}"${r.versions.length < 2 ? ' disabled title="נדרשות לפחות שתי גרסאות"' : ''}>השוואת גרסאות</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
    box.innerHTML = `<section class="ax-sec">${secHead('', 'עסקאות שמורות', 'שמירה יוצרת גרסה חדשה; גרסאות קודמות נשמרות להשוואה. העסקאות נשמרות בדפדפן זה בלבד.')}${tools}${body}</section>${S.cmpVer.id && S.deals[S.cmpVer.id] ? versionsHTML() : ''}`;
  }
  function flat(o, pre, out) {
    out = out || {};
    for (const [k, v] of Object.entries(o || {})) {
      const p = pre ? pre + '.' + k : k;
      if (k === 'market' || k === 'example' || k === 'case' || k === 'origin') continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, p, out);
      else if (Array.isArray(v)) v.forEach((x, i) => flat(x, `${p}[${i + 1}]`, out));
      else out[p] = v;
    }
    return out;
  }
  const PATH_HE = (() => {
    const m = {};
    for (const sp of INFO_FIELDS) m['info.' + sp.k] = sp.l;
    for (const k of E.STRATS) for (const g of FIELDS[k]) for (const sp of g.f) m[k + '.' + sp.k] = `${SN[k]} · ${sp.l}`;
    for (const k of E.VALUE_SOURCES) { m[`value.${k}.value`] = VSRC[k].l; m[`value.${k}.note`] = VSRC[k].l + ' · הערה'; }
    m['value.chosen'] = 'שווי לצורך חיתום'; m['price.total'] = 'מחיר מוצע כולל'; m.selected = 'מבנה לביצוע';
    return m;
  })();
  function versionsHTML() {
    const rec = S.deals[S.cmpVer.id], n = rec.versions.length;
    const a = Math.min(S.cmpVer.a || n - 1, n), b = Math.min(S.cmpVer.b || n, n);
    const va = rec.versions[a - 1], vb = rec.versions[b - 1];
    const fa = flat(va.deal), fb = flat(vb.deal);
    const keys = [...new Set(Object.keys(fa).concat(Object.keys(fb)))].filter((k) => JSON.stringify(fa[k]) !== JSON.stringify(fb[k])).sort();
    const label = (k) => PATH_HE[k] || PATH_HE[k.replace(/\[\d+\]/, '')] || k.replace(/^units\[(\d+)\]\./, 'יחידה $1 · ').replace(/^scen\./, 'תרחיש · ');
    const show = (v) => (v == null ? 'ברירת מחדל / ריק' : typeof v === 'number' ? (Number.isInteger(v) ? F.int(v) : String(v)) : typeof v === 'boolean' ? (v ? 'כן' : 'לא') : String(v));
    const ra = E.run(va.deal, S.settings, { today: TODAY }), rb = E.run(vb.deal, S.settings, { today: TODAY });
    const mver = (v) => (v.methodology === MD.VERSION.id ? `v${MD.VERSION.n}` : v.methodology || 'לא סומן (לפני v1)');
    const out = [['מתודולוגיית מדדים בשמירה', mver(va), mver(vb)], ['אות מבנה', ra.signal.code, rb.signal.code], ['שווי נתמך', F.nis(ra.facts.smv), F.nis(rb.facts.smv)]]
      .concat(E.STRATS.flatMap((k) => [[`${SN[k]} · IRR`, F.pct(E.irrOf(ra.strategies[k].base)), F.pct(E.irrOf(rb.strategies[k].base))], [`${SN[k]} · הון בסיכון`, F.m(E.capOf(ra.strategies[k].base)), F.m(E.capOf(rb.strategies[k].base))], [`${SN[k]} · MOIC`, F.x(E.moicOf(ra.strategies[k].base)), F.x(E.moicOf(rb.strategies[k].base))]]));
    const sel = (key, val) => `<select class="ax-status" data-ver="${key}">${rec.versions.map((v) => `<option value="${v.n}"${v.n === val ? ' selected' : ''}>גרסה ${v.n} · ${esc(F.date(v.savedAt.slice(0, 10)))}</option>`).join('')}</select>`;
    return `<section class="ax-sec">${secHead('', `השוואת גרסאות · ${esc(dealName(vb.deal))}`, 'הנחות שהשתנו בין שתי גרסאות, והשפעתן על התוצאות (מחושב מחדש עם הגדרות הקרן הנוכחיות).', `<button class="ax-btn" type="button" data-act="cmp-close">סגירה</button>`)}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${sel('a', a)} <span class="ax-muted">מול</span> ${sel('b', b)}</div>
      <div class="ax-res two"><div><h3 class="ax-h3">הנחות שהשתנו (${keys.length})</h3><div class="ax-tbl-wrap"><table class="ax-tbl data ax-diff"><thead><tr><th>שדה</th><th class="n">גרסה ${a}</th><th class="n">גרסה ${b}</th></tr></thead><tbody>${keys.length ? keys.map((k) => `<tr><td>${esc(label(k))}</td><td class="n">${esc(show(fa[k]))}</td><td class="n ch">${esc(show(fb[k]))}</td></tr>`).join('') : '<tr><td colspan="3" class="ax-muted">אין הבדלים</td></tr>'}</tbody></table></div></div>
      <div><h3 class="ax-h3">תוצאות</h3><div class="ax-tbl-wrap"><table class="ax-tbl data ax-diff"><thead><tr><th>מדד</th><th class="n">גרסה ${a}</th><th class="n">גרסה ${b}</th></tr></thead><tbody>${out.map((r) => `<tr><td>${esc(r[0])}</td><td class="n">${esc(r[1])}</td><td class="n${r[1] !== r[2] ? ' ch' : ''}">${esc(r[2])}</td></tr>`).join('')}</tbody></table></div></div></div></section>`;
  }

  /* ===================================================== view: settings */
  function viewSettings() {
    const st = E.settingsOf(S.settings);
    const groups = SETTINGS_FIELDS.map((g) => `<div class="ax-gt">${esc(g.g)}${g.m ? mi(g.m) : ''}</div><div class="ax-fields">${g.f.map((sp) => fieldHTML(sp, 'set.' + sp.k, st[sp.k], false).replace(/data-k="set\./g, 'data-set="')).join('')}</div>`).join('');
    const w = Object.keys(E.SETTINGS_DEF.weights).map((k) => fieldHTML({ k, l: RISK_HE[k], t: 'num' }, 'set.weights.' + k, st.weights[k], false).replace(/data-k="set\./g, 'data-set="')).join('');
    return `<section class="ax-sec">${secHead('', 'הגדרות קרן · ספי השקעה', 'הנהלת ALTARIS מגדירה את הספים; הערכים ההתחלתיים הם ברירות מחדל לשינוי, לא מדיניות. האות, ציון הריכוזיות והפורטפוליו משתמשים בהם מיד.', '<button class="ax-btn" type="button" data-act="settings-reset">איפוס לברירות המחדל</button>')}
      ${groups}<div class="ax-gt">משקלות רכיבי ציון הסיכון${mi('riskScore')}</div><div class="ax-fields c3">${w}</div>
      <p class="ax-muted" style="margin-top:10px">ההגדרות נשמרות בדפדפן זה (altaris:settings:v1). משקל 0 מוציא רכיב מהציון הכולל.</p></section>`;
  }

  /* ======================================= view: metric conventions (level 3) */
  const MTXT = {
    he: { h: 'מתודולוגיית מדדים', sub: 'בסיס חישוב והגדרות השקעה', intro: 'גיליון המוסכמות של ALTARIS: מה כל מדד מודד, על איזה בסיס הוא מחושב, היכן הוא משמש בכל מבנה ואיך לקרוא אותו. נכתב מתוך מימוש המנוע הנוכחי — המנוע הוא מקור האמת; הגיליון מתעד ואינו מחשב.',
      eff: 'בתוקף מ-', eng: 'מנוע', toc: 'תוכן', cls: 'סיווג בסיס הנתונים', na: 'לא חל', same: 'כמו בבסיס החישוב', hurdles: 'הספים', comps: 'רכיבים',
      hTbl: ['סף', 'מבחן', 'הגדרה', 'סף נוכחי', 'מבנים'], fund: 'רק כשגודל הקרן מוגדר', weight: 'משקל נוכחי', pdf: 'PDF · נספח מתודולוגיה', lang: 'שפת הגיליון',
      appx: 'נספח מתודולוגיה — בסיס חישוב והגדרות השקעה', engWarn: 'המתודולוגיה נכתבה למנוע גרסה' },
    en: { h: 'Metric Conventions', sub: 'Calculation Basis & Investment Definitions', intro: 'The ALTARIS conventions sheet: what each metric measures, the basis it is calculated on, where it is used in each structure and how to read it. Written from the current engine implementation — the engine is the source of truth; this sheet documents and computes nothing.',
      eff: 'Effective', eng: 'Engine', toc: 'Contents', cls: 'Data basis classes', na: 'Not applicable', same: 'As in the calculation basis', hurdles: 'Hurdles', comps: 'Components',
      hTbl: ['Hurdle', 'Test', 'Definition', 'Current threshold', 'Structures'], fund: 'only when a fund size is set', weight: 'current weight', pdf: 'PDF · methodology appendix', lang: 'Sheet language',
      appx: 'Investment Metrics — Calculation Basis', engWarn: 'This methodology was written for engine version' },
  };
  const SET_FMT = { minMoic: 'x', minCoverage: 'x', maxDuration: 'mo' };
  const setFmt = (key, v, L) => (!isNum(v) ? '—' : SET_FMT[key] === 'x' ? `${v}x` : SET_FMT[key] === 'mo' ? `${v} ${L === 'en' ? 'mo' : 'ח׳'}` : `${v}%`);
  const mStructs = (list) => list.map((k) => SN[k]).join(' · ');
  function methodEntry(m, L, print) {
    const MT = MTXT[L], T = (v) => MD.t(v, L), B = (v) => bidi(T(v), L), st = E.settingsOf(S.settings);
    const row = (f, html) => (html ? `<dt>${esc(typeof f === 'string' && MD.FIELDS[f] ? MD.t(MD.FIELDS[f], L) : f.label)}</dt><dd>${html}</dd>` : '');
    const used = `<span class="ax-mu">${E.STRATS.map((k) => `<span class="ax-mst${m.usedIn.includes(k) ? '' : ' off'}" style="--c:${SC[k]}"${m.usedIn.includes(k) ? '' : ` title="${esc(MT.na)}"`}>${SN[k]}</span>`).join('')}</span>`;
    const per = m.perStructure ? `<table class="ax-mtbl per"><tbody>${E.STRATS.map((k) => {
      const on = m.usedIn.includes(k);
      return `<tr${on ? '' : ' class="off"'}><th><span class="ax-mst" style="--c:${SC[k]}">${SN[k]}</span></th><td>${!on ? esc(MT.na) : m.perStructure[k] ? B(m.perStructure[k]) : esc(MT.same)}</td></tr>`;
    }).join('')}</tbody></table>` : '';
    const hurdles = m.hurdles ? `<div class="ax-mtbl-w"><table class="ax-mtbl hz"><thead><tr>${MT.hTbl.map((h, i) => `<th${i === 1 || i === 3 ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${m.hurdles.map((h) => `<tr><td>${bidi(h.name[L], L)}</td><td class="n"><bdi dir="ltr">${h.dir === 'min' ? '≥' : '≤'}</bdi></td><td class="d">${bidi(T(h), L)}</td><td class="n"><bdi dir="ltr">${esc(setFmt(h.setting, st[h.setting], L))}</bdi></td><td>${esc(mStructs(h.usedIn))}${h.fund ? ` <span class="ax-muted">(${esc(MT.fund)})</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
    const comps = m.components ? `<ul class="ax-mcomp">${m.components.map((c) => { const txt = T(c), i = txt.indexOf(' — '); const w = st.weights[c.k]; return `<li><b>${bidi(i > 0 ? txt.slice(0, i) : txt, L)}</b>${i > 0 ? ' — ' + bidi(txt.slice(i + 3), L) : ''} <span class="ax-muted">· ${esc(MT.weight)} <bdi>${esc(String(w))}</bdi></span></li>`; }).join('')}</ul>` : '';
    return `<article class="ax-mm" id="${print ? 'p' : 'm'}-${m.id}"${print ? '' : ' tabindex="-1"'}>
      <div class="ax-mm-h"><h4>${B(m.title)}${m.id === 'riskScore' ? ' ' + modelTag() : ''}</h4>${used}</div>
      <p class="ax-mm-lead">${B(m.short)}</p>
      <dl class="ax-mdl">${row('measures', B(m.measures))}${row('basis', B(m.basis))}${row('formula', m.formula ? `<code class="ax-fx" dir="ltr">${esc(m.formula)}</code>` : '')}${row('perStructure', per)}${row({ label: MT.hurdles }, hurdles)}${row({ label: MT.comps }, comps)}${row('interpretation', B(m.interpretation))}${row('convention', m.convention ? B(m.convention) : '')}${row('data', m.data.map((c) => clsTag(c, L)).join(' '))}</dl></article>`;
  }
  const methodClasses = (L) => `<dl class="ax-mcls">${Object.keys(MD.CLASSES).map((c) => `<div><dt>${clsTag(c, L)}</dt><dd>${bidi(MD.t(MD.CLASSES[c].d, L), L)}</dd></div>`).join('')}</dl>`;
  const methodGroup = (g, L, print) => `<div class="ax-mg" id="${print ? 'p' : 'm'}-g-${g.id}"><h3 class="ax-mg-h"><span class="c">${g.code}</span>${esc(MD.t(g, L))}</h3>${MD.METRICS.filter((m) => m.group === g.id).map((m) => methodEntry(m, L, print)).join('')}</div>`;
  const methodMeta = (L) => `<span class="ax-tag">${esc(MD.VERSION.id)}</span> ${esc(MD.VERSION.label[L])} · ${esc(MTXT[L].eff)} <bdi>${esc(F.date(MD.VERSION.effective))}</bdi> · ${esc(MTXT[L].eng)} v${E.VERSION}${E.VERSION !== MD.VERSION.engine.version ? ` <span class="ax-tag warn">${esc(MTXT[L].engWarn)} ${MD.VERSION.engine.version}</span>` : ''}`;
  function viewMethod() {
    const L = mlang(), MT = MTXT[L], dir = L === 'en' ? 'ltr' : 'rtl';
    const toc = `<nav class="ax-mtoc" aria-label="${esc(MT.toc)}">${MD.GROUPS.map((g) => `<div><b><span class="c">${g.code}</span>${esc(MD.t(g, L))}</b><span class="ls">${MD.METRICS.filter((m) => m.group === g.id).map((m) => `<a href="#method/${m.id}" data-mgo="${m.id}">${bidi(MD.t(m.name, L), L)}</a>`).join('')}</span></div>`).join('')}</nav>`;
    return `<section class="ax-sec ax-mv" dir="${dir}" lang="${L}"><div class="ax-mv-h"><div><div class="kick">ALTARIS · METRIC CONVENTIONS</div><h2>${esc(MT.h)}</h2><p class="sub">${esc(MT.sub)}</p></div>
        <div class="tools"><div class="ax-seg" role="group" aria-label="${esc(MT.lang)}"><button type="button" data-mlang="he" lang="he" aria-pressed="${L === 'he'}">עברית</button><button type="button" data-mlang="en" lang="en" aria-pressed="${L === 'en'}">English</button></div><button type="button" class="ax-btn" data-act="pdf-method">${esc(MT.pdf)}</button></div></div>
      <p class="ax-mv-meta">${methodMeta(L)}</p><p class="ax-mv-intro">${bidi(MT.intro, L)}</p>${toc}
      <h3 class="ax-mg-h">${esc(MT.cls)}</h3>${methodClasses(L)}</section>
      ${MD.GROUPS.map((g) => `<section class="ax-sec ax-mv" dir="${dir}" lang="${L}">${methodGroup(g, L, false)}</section>`).join('')}`;
  }
  /* the PDF appendix: the same sheet, after the report, in the sheet's language */
  function methodPrintHTML() {
    const L = mlang(), MT = MTXT[L];
    return `<div class="ax-pp ax-mapx" dir="${L === 'en' ? 'ltr' : 'rtl'}" lang="${L}"><div class="ax-mapx-h"><span class="w">ALTARIS METRIC CONVENTIONS</span><h2>${esc(MT.appx)}</h2><p>${methodMeta(L)}</p><p>${bidi(MT.intro, L)}</p></div>
      <h3 class="ax-mg-h">${esc(MT.cls)}</h3>${methodClasses(L)}${MD.GROUPS.map((g) => methodGroup(g, L, true)).join('')}</div>`;
  }
  const printFoot = () => `<p class="ax-pfoot" dir="ltr">${S.mAppendix !== false ? 'Metrics follow ALTARIS calculation conventions. See methodology appendix.' : 'Metrics follow ALTARIS calculation conventions.'} · ${esc(MD.VERSION.label.en)} (${esc(MD.VERSION.id)})</p>`;
  /* the Excel sheet / CSV section: one row per metric, then the hurdle and risk-component tables */
  function methodRows() {
    const L = mlang(), MT = MTXT[L], T = (v) => MD.t(v, L), FL = (f) => MD.t(MD.FIELDS[f], L), st = E.settingsOf(S.settings), en = L === 'en';
    const rows = [[{ v: 'ALTARIS Metric Conventions', b: true }, MD.t(MD.VERSION.label, L)], [en ? 'Methodology version' : 'גרסת מתודולוגיה', MD.VERSION.id], [MT.eff, MD.VERSION.effective], [en ? 'Engine version' : 'גרסת מנוע', E.VERSION],
      [en ? 'Source of truth' : 'מקור האמת', en ? 'The current engine implementation (altaris/engine.js). This sheet documents the calculations; it computes nothing.' : 'מימוש המנוע הנוכחי (altaris/engine.js). הגיליון מתעד את החישובים ואינו מחשב.'], ['']];
    rows.push([en ? 'Group' : 'קבוצה', en ? 'Metric' : 'מדד', en ? 'Definition' : 'הגדרה', FL('basis'), FL('formula'), en ? 'Structures' : 'מבנים', FL('data'), en ? 'Convention / notes' : 'מוסכמה / הערות', FL('interpretation')].map((c) => ({ v: c, b: true })));
    for (const m of MD.METRICS) {
      const g = MD.GROUPS.find((x) => x.id === m.group);
      const per = m.perStructure ? ' ' + E.STRATS.filter((k) => m.perStructure[k]).map((k) => `${SN[k]}: ${T(m.perStructure[k])}`).join(' | ') : '';
      rows.push([`${g.code} · ${T(g)}`, T(m.title), T(m.short), T(m.basis) + per, m.formula || '', mStructs(m.usedIn), m.data.map((c) => MD.CLASSES[c][L]).join(' · '), m.convention ? T(m.convention) : '', T(m.interpretation)]);
    }
    rows.push([''], [{ v: MD.t(MD.byId.hurdles.title, L), b: true }], MT.hTbl.map((c) => ({ v: c, b: true })));
    for (const h of MD.byId.hurdles.hurdles) rows.push([h.name[L], h.dir === 'min' ? '≥' : '≤', T(h), setFmt(h.setting, st[h.setting], L), mStructs(h.usedIn) + (h.fund ? ` (${MT.fund})` : '')]);
    rows.push([''], [{ v: MD.t(MD.byId.riskScore.title, L), b: true }], [en ? 'Component' : 'רכיב', FL('basis'), MT.weight].map((c) => ({ v: c, b: true })));
    for (const c of MD.byId.riskScore.components) { const txt = T(c), i = txt.indexOf(' — '); rows.push([i > 0 ? txt.slice(0, i) : txt, i > 0 ? txt.slice(i + 3) : '', st.weights[c.k]]); }
    rows.push([''], [{ v: MT.cls, b: true }]);
    for (const c of Object.keys(MD.CLASSES)) rows.push([MD.CLASSES[c][L], T(MD.CLASSES[c].d)]);
    return rows;
  }
  function goMethod(id) {
    S.view = 'method'; S.mfocus = id || null; S.mbarOpen = false;
    history.replaceState(null, '', '#method' + (id ? '/' + id : ''));
    renderView();
    if (!id) window.scrollTo(0, 0);
  }
  function focusMethod() {
    const a = S.mfocus && document.getElementById('m-' + S.mfocus); if (!a) return;
    a.scrollIntoView({ block: 'start' }); a.focus({ preventScroll: true });
    a.classList.add('hl'); setTimeout(() => a.classList.remove('hl'), 1800);
  }

  /* ============================================ the five-questions ledger */
  function ledgerHTML() {
    const R = S.R, Fx = R.facts, k = S.strat, s = R.strategies[k];
    const st = S.stress && s.stress && s.stress[S.stress] && s.stress[S.stress].ok ? s.stress[S.stress] : null;
    const b = s.base.ok ? (st || s.base) : null, base = s.base.ok ? s.base : null, d = s.downside && s.downside.ok ? s.downside : null;
    const sig = R.signal;
    const head = `<div class="ax-ldg-h"><div class="t"><span class="nm" title="${esc(dealName(S.deal))}">${esc(dealName(S.deal))}</span>${S.deal.example ? '<span class="ax-tag">דוגמה</span>' : ''}${isCase(S.deal) ? '<span class="ax-tag ill">להמחשה</span>' : fromCase(S.deal) ? '<span class="ax-tag ill">עותק · להמחשה</span>' : ''}</div>
      <div class="ax-seg" role="group" aria-label="מבנה מוצג">${E.STRATS.map((x) => `<button type="button" data-strat="${x}" aria-pressed="${x === k}">${SN[x]}</button>`).join('')}</div>
      ${st ? `<div class="ax-stressnote">מבחן לחץ פעיל: ${esc(STRESS_HE[S.stress])} <button class="ax-link" type="button" data-stress="">ביטול</button></div>` : ''}</div>`;
    const delta = (v, v0, f) => (st && isNum(v) && isNum(v0) && Math.abs(v - v0) > 1e-9 ? `<div class="x">בסיס ${f(v0)}</div>` : '');
    const q1 = `<div class="ax-q"><div class="qn"><b>1</b>מהו השווי הנתמך האמיתי?${mi('supportedValue')}</div><div class="a"><span class="v num">${Fx.smv ? F.m(Fx.smv) : '—'}</span><span class="x">${Fx.chosen ? esc(VSRC[Fx.chosen].l) + ' ' + clsTag(valueOrigin(Fx.chosen, (S.deal.value || {})[Fx.chosen])) : 'לא נבחר שווי לחיתום'}</span></div>
      <div class="s">${Fx.smv ? `הנחת כניסה ${F.pct(Fx.discount)} · בסיס ${F.m(Fx.basis)}${Fx.sqm ? ' · ' + F.int(Fx.smv / Fx.sqm) + ' ₪/מ״ר' : ''}` : 'בחרו מקור שווי במפורש בשלב 2.'}</div></div>`;
    if (!b) {
      return head + q1 + `<div class="ax-q">${needBox(`<b>${SN[k]}:</b> חסרים ${esc(missingTxt(s.base.missing))}`)}</div>` + sigHTML(sig) + footHTML();
    }
    const q2 = `<div class="ax-q"><div class="qn"><b>2</b>כמה הון ALTARIS מסכנת?${mi('capitalAtRisk', capLive(k, s))}</div><div class="a"><span class="v num">${F.m(E.capOf(b))}</span><span class="x">${SN[k]} · ${SH[k]}</span></div>
      <div class="s">${k === 'buy' ? `חוב ${F.m(b.debt)}${b.debt ? ' · LTV ' + F.pct(b.ltv) : ''} · מחיר ${F.m(b.price)}` : k === 'finance' ? `LTV ${F.pct(b.ltv)} · כיסוי בטוחות ${F.x(b.coverage)}` : `הון בסיכון מקסימלי ${F.m(b.maxAtRisk)} · כיסוי ${F.x(b.coverage)}`}</div></div>`;
    const q3 = `<div class="ax-q"><div class="qn"><b>3</b>מה ALTARIS יכולה להרוויח?</div>
      <div class="row"><div><div class="k">IRR${mi('irr', irrLive(k, b))}</div><div class="v2 num${E.irrOf(b) < 0 ? ' neg' : ''}">${F.pct(E.irrOf(b))}</div>${delta(E.irrOf(b), E.irrOf(base), F.pct)}</div><div><div class="k">MOIC${mi('moic', moicLive(b))}</div><div class="v2 num">${F.x(E.moicOf(b))}</div>${delta(E.moicOf(b), E.moicOf(base), F.x)}</div><div><div class="k">רווח</div><div class="v2 num${b.profit < 0 ? ' neg' : ''}">${F.m(b.profit)}</div>${delta(b.profit, base.profit, F.m)}</div></div>
      <div class="s">משך ${F.mo(b.months)} · הון חוזר ${F.date(b.exitDate)} · לפני מס על הרווח</div></div>`;
    const q4 = `<div class="ax-q"><div class="qn"><b>4</b>מה קורה אם היציאה הצפויה לא מתרחשת?</div>
      <div class="row"><div><div class="k">IRR שלילי</div><div class="v2 num${d && E.irrOf(d) < 0 ? ' neg' : ''}">${d ? F.pct(E.irrOf(d)) : '—'}</div></div><div><div class="k">רווח שלילי</div><div class="v2 num${d && d.profit < 0 ? ' neg' : ''}">${d ? F.m(d.profit) : '—'}</div></div><div><div class="k">מרווח ביטחון${mi('mos')}</div><div class="v2 num${s.mos < 0 ? ' neg' : ''}">${F.pct(s.mos)}</div></div></div>
      <div class="s">${k === 'buy' ? `נקודת איזון ${F.m(base.breakEvenExit)} · השווי יכול לרדת ${F.pct(base.maxHaircut)} מהשווי הנתמך לפני הפסד` : d && d.recovery ? `כשל בחודש ${d.recovery.defaultMonth}, גבייה בחודש ${d.recovery.recoveryMonth}: ${F.pct(d.recovery.rate, 0)} מהתביעה${d.recovery.principalLoss > 0 ? ' · פגיעה בקרן ' + F.m(d.recovery.principalLoss) : ' · הקרן מוחזרת'}` : 'ירידת שווי מקסימלית לפני פגיעה בהון'}</div></div>`;
    const risk = s.risk ? `<div class="ax-q"><div class="qn">ציון סיכון · ${SN[k]}${mi('riskScore')}${modelTag()}</div><div class="ax-risk"><span class="v2 num" style="font-family:var(--f-display);font-weight:800;font-size:16px">${s.risk.overall}</span><span class="bar"><i style="width:${s.risk.overall}%"></i></span><span class="x ax-muted">/ 100 · גבוה = סיכון נמוך</span></div></div>` : '';
    return head + q1 + q2 + q3 + q4 + sigHTML(sig) + risk + footHTML();
  }
  const sigHTML = (sig) => `<div class="ax-signal ${SIG_CLASS[sig.code] || ''}"><div class="qn" style="font-size:10.5px;font-weight:700;color:var(--ink-3)"><b style="font-family:var(--f-display);color:var(--brass)">5</b> BUY, FINANCE או HYBRID?${mi('signal')}</div><div class="code"><i></i>${esc(sig.code)}</div><ul>${sig.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul><button class="ax-link" type="button" data-view-go="compare">ההסבר המלא בהשוואת המבנים</button></div>`;
  const footHTML = () => (isCase(S.deal) ? `<div class="ax-ldg-f"><button class="ax-btn pri" type="button" data-act="case-copy">יצירת עותק עבודה</button><button class="ax-btn" type="button" data-act="pdf-ic">PDF ועדה</button><span class="ax-muted" style="align-self:center">מקרה להמחשה — אינו נשמר בעסקאות</span></div>` : `<div class="ax-ldg-f"><button class="ax-btn pri" type="button" data-act="save">${S.dealId ? 'שמירת גרסה' : 'שמירת עסקה'}</button><button class="ax-btn" type="button" data-act="pdf-ic">PDF ועדה</button><span class="ax-muted" style="align-self:center">${S.dealId ? (S.dirty ? 'שינויים שלא נשמרו' : 'נשמר') : 'טיוטה — נשמרת אוטומטית בדפדפן'}</span></div>`);
  function paintLedger() {
    const a = $('#axAside');
    if (a) a.innerHTML = S.view === 'deal' ? `<div class="ax-ldg">${ledgerHTML()}</div>` : '';
    const m = $('#axMbar'); if (!m || S.view !== 'deal') return;
    const R = S.R, s = R.strategies[S.strat], b = s.base.ok ? s.base : null;
    m.innerHTML = `<div class="ax-mbar-in"><div><div class="k">אות מבנה</div><div class="v sig">${esc(R.signal.code)}</div></div><div><div class="k">IRR ${SN[S.strat]}</div><div class="v num${b && E.irrOf(b) < 0 ? ' neg' : ''}">${b ? F.pct(E.irrOf(b)) : '—'}</div></div><div><div class="k">הון בסיכון</div><div class="v num">${b ? F.m(E.capOf(b)) : '—'}</div></div><div><div class="k">מרווח ביטחון</div><div class="v num">${b ? F.pct(s.mos) : '—'}</div></div>
      <button class="ax-btn" type="button" data-act="mbar" aria-expanded="${S.mbarOpen}">${S.mbarOpen ? 'סגירה' : 'פרטים'}</button></div>${S.mbarOpen ? `<div class="ax-mbar-sheet"><div class="ax-ldg">${ledgerHTML()}</div></div>` : ''}`;
  }
  function paintSteps() {
    const R = S.R, info = S.deal.info || {}, k = S.strat;
    const done = [!!(info.name && (R.facts.basis || R.facts.rows)), !!R.facts.smv, R.strategies[k].base.ok, !!(R.strategies[k].downside && R.strategies[k].downside.ok), R.signal.code !== 'INCOMPLETE'];
    const names = ['עסקה', 'שווי', 'מבנה', 'לחץ', 'החלטה'], ids = ['s-deal', 's-value', 's-struct', 's-stress', 's-decide'];
    $('#axSteps').innerHTML = names.map((n, i) => `<a href="#${ids[i]}" class="${done[i] ? 'done' : ''}"><b>${done[i] ? '✓' : i + 1}</b>${n}</a>`).join('<span class="sep">›</span>') + '<span class="ax-muted" style="margin-inline-start:6px">NEW DEAL → UNDERWRITE → COMPARE → STRESS TEST → DECISION</span>';
  }

  /* ---------------------------------------------------------- recompute */
  let raf = 0;
  function schedule(full) { if (full) { cancelAnimationFrame(raf); raf = 0; recompute(true); return; } if (raf) return; raf = requestAnimationFrame(() => { raf = 0; recompute(false); }); }
  function recompute(full) {
    const ctx = { today: TODAY, portfolio: isCase(S.deal) ? [] : portfolioCtx(), marketDepth: S.deal.market && S.deal.market.tx ? { deals: S.deal.market.tx.n, from: S.deal.market.tx.from, to: S.deal.market.tx.to } : null };
    S.R = E.run(S.deal, S.settings, ctx);
    if (S.view === 'deal') {
      if (full) renderStratInputs();
      paintUnits(); paintValue(); paintCards(); syncDefaults(); paintStratInfo(); paintStratRes(); paintScenarios(); paintDecide(); paintSteps();
    } else if (S.view === 'compare') paintCompare();
    else if (S.view === 'portfolio') paintPortfolio();
    else if (S.view === 'saved') paintSaved();
    paintLedger();
    if (POP.trigger && !POP.trigger.isConnected) closePop(false);
    store.set(KEY.draft, { deal: S.deal, dealId: S.dealId, dirty: S.dirty });
  }
  const markDirty = () => { S.dirty = true; };

  /* ------------------------------------------------------ save / versions */
  const persistDeals = () => { if (!store.set(KEY.deals, S.deals)) toast('השמירה נכשלה — אחסון הדפדפן מלא או חסום'); S.dealsRev = (S.dealsRev || 0) + 1; };
  function saveDeal() {
    if (isCase(S.deal)) { toast('מקרה להמחשה אינו נשמר בעסקאות — צרו עותק עבודה'); return; }
    if (!S.R.facts.smv && !(S.deal.info && S.deal.info.name)) { toast('הזינו לפחות שם עסקה לפני שמירה'); return; }
    const now = new Date().toISOString();
    let rec = S.dealId && S.deals[S.dealId];
    if (!rec) { const id = uid(); rec = S.deals[id] = { id, status: 'draft', archived: false, createdAt: now, versions: [] }; S.dealId = id; }
    const snap = clone(S.deal), last = rec.versions[rec.versions.length - 1];
    if (last && JSON.stringify(last.deal) === JSON.stringify(snap)) { toast('אין שינויים מאז הגרסה האחרונה'); return; }
    rec.versions.push({ n: rec.versions.length + 1, savedAt: now, deal: snap, signal: S.R.signal.code, strategy: S.R.ic.strategy, methodology: MD.VERSION.id });
    rec.updatedAt = now;
    persistDeals(); S.dirty = false;
    toast(`נשמר · גרסה ${rec.versions.length}`); renderShell(); recompute(false);
  }
  function openDeal(id, n) {
    const rec = S.deals[id]; if (!rec) return;
    if (S.dirty && S.dealId !== id && !confirm('יש שינויים שלא נשמרו בעסקה הנוכחית. לפתוח עסקה אחרת בכל זאת?')) return;
    const v = rec.versions[(n || rec.versions.length) - 1];
    S.deal = normalizeDeal(clone(v.deal)); S.dealId = id; S.dirty = false; S.stress = null; S.mkt = { status: 'idle' };
    S.view = 'deal'; location.hash = 'deal'; renderView(); window.scrollTo(0, 0);
  }
  function newDeal(example) {
    if (S.dirty && !confirm('יש שינויים שלא נשמרו. להתחיל עסקה חדשה בכל זאת?')) return;
    S.deal = example ? exampleDeal() : blankDeal(); S.dealId = null; S.dirty = !!example; S.stress = null; S.mkt = { status: 'idle' };
    S.view = 'deal'; renderView(); window.scrollTo(0, 0);
  }
  function openCase(id) {
    const c = CS.byId[id]; if (!c) return;
    if (S.dirty && !confirm('יש שינויים שלא נשמרו. לפתוח את מקרה ההשקעה במקומם?')) return;
    S.deal = normalizeDeal(clone(c.deal)); S.deal.case = { id: c.id, v: CS.VERSION };
    S.dealId = null; S.dirty = false; S.stress = null; S.mkt = { status: 'idle' }; S.strat = c.primary;
    S.view = 'deal'; S.mfocus = null; history.replaceState(null, '', '#deal'); renderView(); window.scrollTo(0, 0);
    toast('נפתח מקרה השקעה להמחשה');
  }
  /* the case as it stands on screen becomes the user's own deal (a saved version), tagged with its origin */
  function caseCopy() {
    const c = caseOf(S.deal); if (!c) return;
    const d = clone(S.deal); delete d.case;
    d.origin = { kind: 'illustrative-case', id: c.id, v: CS.VERSION, copiedAt: TODAY };
    d.info = d.info || {}; d.info.name = `${d.info.name || c.title.he} — עותק עבודה`; d.info.createdAt = TODAY;
    S.deal = d; S.dealId = null; S.dirty = true; S.stress = null;
    recompute(true); saveDeal();
    const rec = S.deals[S.dealId];
    if (rec) { rec.origin = 'illustrative-case'; rec.versions[0].note = 'עותק עבודה ממקרה השקעה להמחשה'; persistDeals(); }
    renderView(); toast('נוצר עותק עבודה · נשמר בעסקאות השמורות כעסקה שלך');
  }
  function duplicateDeal(id) {
    const rec = S.deals[id]; if (!rec) return;
    const d = clone(rec.versions[rec.versions.length - 1].deal);
    d.info = d.info || {}; d.info.name = (d.info.name || 'עסקה') + ' (עותק)'; d.info.createdAt = TODAY;
    const nid = uid(), now = new Date().toISOString();
    S.deals[nid] = { id: nid, status: 'draft', archived: false, createdAt: now, updatedAt: now, versions: [{ n: 1, savedAt: now, deal: d, signal: rec.versions[rec.versions.length - 1].signal, methodology: MD.VERSION.id }] };
    persistDeals(); toast('העסקה שוכפלה'); recompute(false); renderShell();
  }
  function normalizeDeal(d) {
    d = d && typeof d === 'object' ? d : blankDeal();
    for (const [k, v] of Object.entries(blankDeal())) {
      if (k === 'selected') continue;   // null by default; a string when the user picked a structure to execute
      if (d[k] == null || typeof d[k] !== typeof v) d[k] = clone(v);
    }
    if (!E.STRATS.includes(d.selected)) d.selected = null;
    if (!Array.isArray(d.units)) d.units = [];
    return d;
  }
  function exampleDeal() {
    const d = blankDeal();
    d.example = true;
    Object.assign(d.info, { name: 'עסקה לדוגמה — 6 יחידות בבנייה', developer: 'יזם לדוגמה בע״מ', project: 'פרויקט לדוגמה', unitTypes: '3–5 חדרים', constructionStatus: 'construction',
      completionDate: E.addMonths(TODAY, 10), source: 'developer', developerRating: 'established', notes: 'נתונים להמחשה בלבד — אינם עסקה אמיתית ואינם נתוני שוק.' });
    d.units = [
      { label: 'A-12', rooms: 4, sqm: 96, supported: 3000000, proposed: 2250000 }, { label: 'A-14', rooms: 3, sqm: 82, supported: 2550000, proposed: 1950000 },
      { label: 'B-7', rooms: 5, sqm: 121, supported: 3700000, proposed: 2800000 }, { label: 'B-9', rooms: 4, sqm: 101, supported: 3150000, proposed: 2380000 },
      { label: 'C-3', rooms: 3, sqm: 79, supported: 2450000, proposed: 1880000 }, { label: 'C-5', rooms: 4, sqm: 98, supported: 3050000, proposed: 2300000 },
    ];
    d.value = { appraisal: { value: 17600000, note: 'שומה לדוגמה' }, developer: { value: 19200000, note: 'מחירון לדוגמה' }, chosen: 'units' };
    return d;
  }

  /* --------------------------------------------------------------- exports */
  const fileBase = () => { const slug = X.fileName(dealName(S.deal)); return 'ALTARIS-' + (illusKind() ? 'ILLUSTRATIVE-' : '') + (slug === 'altaris' ? 'deal' : slug) + '-' + TODAY; };
  function exportModel() {
    const R = S.R, Fx = R.facts, info = S.deal.info || {};
    const meta = [['ALTARIS Capital Allocation Engine', ''], ['עסקה', dealName(S.deal)], ['הופק', new Date().toISOString().slice(0, 16).replace('T', ' ')], ['גרסת מנוע', E.VERSION], ['הנחות מס', 'לצורך ניתוח השקעה בלבד — יש לאשר מול המבנה המשפטי הסופי']];
    const dealRows = [['שדה', 'ערך']].concat(INFO_FIELDS.map((sp) => [sp.l, sp.t === 'sel' ? optLabel(sp.opts, info[sp.k]) : info[sp.k] == null ? '' : info[sp.k]]));
    const unitRows = [['יחידה', 'חדרים', 'שטח מ״ר', 'שווי נתמך', 'מחיר מוצע']].concat((S.deal.units || []).map((u, i) => [u.label || 'יחידה ' + (i + 1), E.num(u.rooms), E.num(u.sqm), E.num(u.supported), E.num(u.proposed)]));
    const V = S.deal.value || {};
    const valRows = [['מקור', 'שווי', 'הערה', 'בסיס', 'נבחר']].concat(E.VALUE_SOURCES.map((k) => [VSRC[k].l, Fx.sources[k], (V[k] && V[k].note) || '', (V[k] && V[k].basis) || '', Fx.chosen === k ? 'כן' : '']))
      .concat([['שווי נתמך', Fx.smv], ['בסיס רכישה / הון', Fx.basis], ['הפרש', Fx.diff], ['הנחת כניסה', { v: Fx.discount, f: 'pct' }]]);
    const assum = [['מבנה', 'הנחה', 'ערך', 'מקור']];
    for (const k of E.STRATS) {
      const s = R.strategies[k], def = new Set(s.defaulted);
      for (const g of FIELDS[k]) for (const sp of g.f) { const v = s.inputs[sp.k]; assum.push([SN[k], sp.l, sp.t === 'sel' ? optLabel(sp.opts, v) : typeof v === 'boolean' ? (v ? 'כן' : 'לא') : v == null ? '' : v, def.has(sp.k) ? (sp.derived ? 'נגזר' : 'ברירת מחדל — הנחה') : 'הוזן']); }
    }
    for (const sc of ['downside', 'upside']) { const x = E.scenario(S.deal, sc); for (const r of SCEN_ROWS) assum.push(['תרחיש ' + (sc === 'downside' ? 'שלילי' : 'חיובי'), r.l, typeof x[r.k] === 'boolean' ? (x[r.k] ? 'כן' : 'לא') : x[r.k] == null ? '' : x[r.k], r.u]); }
    const st = R.settings;
    for (const g of SETTINGS_FIELDS) for (const sp of g.f) assum.push(['הגדרות קרן', sp.l, st[sp.k], '']);
    const M = [['מדד', 'BUY · שלילי', 'BUY · בסיס', 'BUY · חיובי', 'FINANCE · שלילי', 'FINANCE · בסיס', 'FINANCE · חיובי', 'HYBRID · שלילי', 'HYBRID · בסיס', 'HYBRID · חיובי']];
    const metric = (l, f, fmt) => M.push([l].concat(E.STRATS.flatMap((k) => ['downside', 'base', 'upside'].map((sc) => { const r = R.strategies[k][sc]; const v = r && r.ok ? f(r) : null; return v == null ? '' : fmt ? { v, f: fmt } : v; }))));
    metric('הון בסיכון', (r) => E.capOf(r)); metric('שיא פריסת הון', (r) => r.peakCapital); metric('סך הון שהושקע', (r) => r.invested); metric('סך תקבולים', (r) => r.distributions); metric('רווח לפני מס', (r) => r.profit);
    metric('IRR (על ההון המחויב כשלא הועמד הון או שלתזרים אין IRR)', (r) => E.irrOf(r), 'pct'); metric('בסיס ה-IRR', (r) => E.irrBasisOf(r)); metric('MOIC', (r) => E.moicOf(r), 'x'); metric('ROI', (r) => r.roi, 'pct'); metric('תשואה שנתית', (r) => r.annualized, 'pct'); metric('משך (חודשים)', (r) => r.months, 'n');
    const extra = [['מדד', 'BUY', 'FINANCE', 'HYBRID'],
      ['מרווח ביטחון', ...E.STRATS.map((k) => ({ v: R.strategies[k].mos, f: 'pct' }))],
      ['ציון סיכון', ...E.STRATS.map((k) => (R.strategies[k].risk ? R.strategies[k].risk.overall : ''))],
      ['ספי קרן שעברו', ...E.STRATS.map((k) => `${R.strategies[k].hurdles.filter((h) => h.pass).length}/${R.strategies[k].hurdles.length}`)],
      ['מחזורי הון בשנה', ...E.STRATS.map((k) => (R.strategies[k].velocity ? { v: R.strategies[k].velocity.turnsPerYear, f: 'x' } : ''))]];
    const b = R.strategies.buy.base, f = R.strategies.finance.base, h = R.strategies.hybrid.base;
    if (b.ok) extra.push(['BUY · מחיר מכירה לאיזון', b.breakEvenExit, '', ''], ['BUY · מחיר רכישה מקסימלי', R.strategies.buy.limits.maxPrice, '', ''], ['BUY · בסיס כולל', b.price + b.tax + b.costs, '', '']);
    if (f.ok) extra.push(['FINANCE · LTV', '', { v: f.ltv, f: 'pct' }, ''], ['FINANCE · כיסוי בטוחות', '', { v: f.coverage, f: 'x' }, ''], ['FINANCE · שווי בטוחות לאיזון', '', f.breakEvenCollateral, '']);
    if (h.ok) extra.push(['HYBRID · תשואה חוזית', '', '', h.contractual], ['HYBRID · השתתפות', '', '', h.participation], ['HYBRID · הון מקסימלי בסיכון', '', '', h.maxAtRisk]);
    const stress = [['מבחן לחץ', 'BUY · IRR', 'BUY · רווח', 'FINANCE · IRR', 'FINANCE · רווח', 'HYBRID · IRR', 'HYBRID · רווח']].concat(E.STRESS.map((x) => [STRESS_HE[x.id]].concat(E.STRATS.flatMap((k) => { const r = R.strategies[k].stress && R.strategies[k].stress[x.id]; return r && r.ok ? [{ v: r.irr, f: 'pct' }, r.profit] : ['', '']; }))));
    const risk = [['מבנה', 'רכיב', 'ציון', 'הסבר']];
    for (const k of E.STRATS) { const r = R.strategies[k].risk; if (r) { r.components.forEach((c) => risk.push([SN[k], RISK_HE[c.k], c.score, c.why])); risk.push([SN[k], 'ציון כולל', r.overall, '']); } }
    const flows = {};
    for (const k of E.STRATS) {
      const s = R.strategies[k]; if (!s.base.ok) continue;
      const by = (r) => new Map(((r && r.ok && r.flows) || []).map((x) => [x.m, x.amount]));
      const bm = by(s.base), dm = by(s.downside), um = by(s.upside);
      const maxM = Math.max(...[s.base, s.downside, s.upside].filter((r) => r && r.ok).map((r) => r.months));
      flows[k] = [['חודש', 'תאריך', 'בסיס', 'שלילי', 'חיובי']];
      for (let m = 0; m <= maxM; m++) flows[k].push([m, E.addMonths(Fx.t0, m), bm.get(m) ?? '', dm.get(m) ?? '', um.get(m) ?? '']);
    }
    const D = icData();
    const summary = [[{ v: 'ALTARIS INVESTMENT COMMITTEE SNAPSHOT', b: true }]].concat(D.rows.map((r) => [r[0], r[1]])).concat([[''], [{ v: 'WHY THIS DEAL', b: true }]]).concat(D.why.map((w) => [w]))
      .concat([[''], [{ v: 'KEY RISKS', b: true }]]).concat(D.risks.map((w) => [w])).concat([[''], [{ v: 'ALTARIS STRUCTURE SIGNAL · ' + R.signal.code, b: true }]]).concat(R.signal.why.map((w) => [w]));
    if (illusKind()) { const mark = [{ v: illusMark(), b: true }]; meta.unshift(mark); summary.unshift(mark, ['']); }
    return { meta, summary, dealRows, unitRows, valRows, assum, M, extra, stress, risk, flows };
  }
  function exportCSV() {
    const m = exportModel();
    const sections = [{ title: 'ALTARIS', rows: m.meta }, { title: 'סיכום ועדת השקעות', rows: m.summary }, { title: 'פרטי העסקה', rows: m.dealRows }, { title: 'יחידות', rows: m.unitRows },
      { title: 'שווי נתמך', rows: m.valRows }, { title: 'הנחות', rows: m.assum }, { title: 'תוצאות לפי תרחיש', rows: m.M }, { title: 'מדדים נוספים', rows: m.extra }, { title: 'מבחני לחץ', rows: m.stress }, { title: 'ציון סיכון', rows: m.risk }]
      .concat(Object.entries(m.flows).map(([k, rows]) => ({ title: 'תזרים חודשי · ' + SN[k], rows })))
      .concat([{ title: 'Metric Conventions', rows: methodRows() }]);
    X.download(fileBase() + '.csv', X.csv(sections), 'text/csv;charset=utf-8');
  }
  function exportXLSX() {
    const m = exportModel();
    const B = (rows) => rows.map((r, i) => (i === 0 ? r.map((c) => (c && typeof c === 'object' ? c : { v: c, b: true })) : r));
    const sheets = [{ name: 'סיכום', rows: m.summary.concat([['']], m.meta), widths: [34, 70] }, { name: 'עסקה', rows: B(m.dealRows).concat([['']], B(m.unitRows)), widths: [28, 22, 14, 16, 16] },
      { name: 'שווי נתמך', rows: B(m.valRows), widths: [30, 16, 30, 60, 8] }, { name: 'הנחות', rows: B(m.assum), widths: [16, 34, 18, 20] },
      { name: 'תוצאות', rows: B(m.M).concat([['']], B(m.extra)), widths: [30, 14, 14, 14, 14, 14, 14, 14, 14, 14] }, { name: 'מבחני לחץ', rows: B(m.stress), widths: [24, 12, 14, 12, 14, 12, 14] },
      { name: 'סיכון', rows: B(m.risk), widths: [12, 16, 8, 90] }].concat(Object.entries(m.flows).map(([k, rows]) => ({ name: 'תזרים ' + SN[k], rows: B(rows), widths: [8, 12, 16, 16, 16] })))
      .concat([{ name: 'Metric Conventions', rows: methodRows(), widths: [22, 30, 60, 80, 44, 26, 24, 70, 50], ltr: mlang() === 'en' }]);
    if (illusKind()) sheets.forEach((sh, i) => { if (i > 0) sh.rows = [[{ v: illusMark(), b: true }], ['']].concat(sh.rows); });   // the summary sheet already opens with it
    X.download(fileBase() + '.xlsx', new Blob([X.xlsx(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  function exportJSON() { X.download(fileBase() + '.altaris.json', JSON.stringify({ kind: 'altaris-deal', schema: 1, methodology: MD.VERSION.id, illustrative: illusKind() ? illusMark() : undefined, exportedAt: new Date().toISOString(), deal: S.deal, record: S.dealId ? S.deals[S.dealId] : null }, null, 1), 'application/json'); }
  async function importJSON(file) {
    try {
      const o = JSON.parse(await file.text());
      if (!o || o.kind !== 'altaris-deal' || !o.deal || typeof o.deal !== 'object') throw new Error('not an ALTARIS deal file');
      const now = new Date().toISOString(), id = uid();
      const deCase = (d) => { if (d && d.case) { d.origin = { kind: 'illustrative-case', id: d.case.id, v: d.case.v, importedAt: TODAY }; delete d.case; } return d; };   // an imported case is a working copy, never an unmarked deal
      const versions = o.record && Array.isArray(o.record.versions) && o.record.versions.length ? o.record.versions.map((v, i) => ({ n: i + 1, savedAt: v.savedAt || now, deal: deCase(normalizeDeal(v.deal)), signal: v.signal || null, methodology: typeof v.methodology === 'string' ? v.methodology : null })) : [];
      const working = deCase(normalizeDeal(o.deal)), lastV = versions[versions.length - 1];
      if (!lastV || JSON.stringify(lastV.deal) !== JSON.stringify(working)) versions.push({ n: versions.length + 1, savedAt: o.exportedAt || now, deal: working, note: 'עותק העבודה מהקובץ', methodology: typeof o.methodology === 'string' ? o.methodology : null });
      S.deals[id] = { id, status: (o.record && o.record.status) || 'draft', archived: false, createdAt: now, updatedAt: now, versions };
      if (fromCase(working)) S.deals[id].origin = 'illustrative-case';
      persistDeals(); toast('העסקה יובאה'); recompute(false); renderShell();
    } catch (e) { toast('הקובץ אינו קובץ עסקה של ALTARIS'); }
  }
  const appendix = () => (S.mAppendix !== false ? methodPrintHTML() : '');
  function printIC() { X.printHTML(`<div class="ax-pp">${icHTML(true)}${printFoot()}</div>${appendix()}`, fileBase() + '-IC'); }
  function printMethod() { X.printHTML(methodPrintHTML(), 'ALTARIS-metric-conventions-' + MD.VERSION.id); }
  function printFull() {
    const R = S.R, keep = S.strat;
    const m = exportModel();
    const tbl = (rows) => `<table class="ax-tbl data"><thead><tr>${rows[0].map((c, i) => `<th${i ? ' class="n"' : ''}>${esc(c && typeof c === 'object' ? c.v : c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c, i) => { const v = c && typeof c === 'object' ? c.v : c; const f = c && typeof c === 'object' ? c.f : null; return `<td${i ? ' class="n"' : ''}>${esc(isNum(v) ? (f === 'pct' ? F.pct(v) : f === 'x' ? F.x(v) : f === 'n' ? String(v) : F.int(v)) : v == null ? '' : v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    let html = `<div class="ax-pp">${icHTML(true)}${printFoot()}</div><div class="ax-pp"><section class="ax-sec"><h2>פרטי העסקה</h2>${tbl(m.dealRows)}<h3 class="ax-h3">יחידות</h3>${tbl(m.unitRows)}<h3 class="ax-h3">שווי נתמך</h3>${tbl(m.valRows)}</section></div>`;
    for (const k of E.STRATS) {
      const s = R.strategies[k]; S.strat = k;
      html += `<div class="ax-pp"><section class="ax-sec"><h2>${SN[k]} · ${SH[k]}</h2>${s.base.ok ? `<div class="ax-res">${kpiStrip(k, s)}${k === 'buy' ? resBuy(s) : k === 'finance' ? resFin(s) : resHyb(s)}</div>` : needBox(missingTxt(s.base.missing))}</section></div>`;
    }
    S.strat = keep;
    html += `<div class="ax-pp"><section class="ax-sec"><h2>הנחות</h2>${tbl(m.assum)}</section></div><div class="ax-pp"><section class="ax-sec"><h2>תרחישים ומבחני לחץ</h2>${tbl(m.M)}<h3 class="ax-h3">מבחני לחץ</h3>${tbl(m.stress)}<h3 class="ax-h3">מדדים נוספים</h3>${tbl(m.extra)}</section></div>
      <div class="ax-pp"><section class="ax-sec"><h2>ציון סיכון</h2>${tbl(m.risk)}</section></div>`;
    for (const [k, rows] of Object.entries(m.flows)) html += `<div class="ax-pp"><section class="ax-sec"><h2>תזרים חודשי · ${SN[k]}</h2>${tbl(rows)}</section></div>`;
    if (illusKind()) { const pp = html.split('<div class="ax-pp">'); html = pp[0] + pp.slice(1).map((x, i) => '<div class="ax-pp">' + (i ? illusBanner() : '') + x).join(''); }   // every page after the IC page carries the mark too
    html += appendix();
    X.printHTML(html, fileBase() + '-underwriting');
  }

  /* --------------------------------------------------------- geo search */
  let geoT = 0, geoQ = '';
  function geoSearch(input) {
    const q = input.value.trim(); const pop = $('#axGeoPop');
    clearTimeout(geoT);
    if (q.length < 2) { pop.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    geoT = setTimeout(async () => {
      geoQ = q;
      try {
        const d = await getJSON('/api/geo/search?q=' + encodeURIComponent(q) + '&limit=8');
        if (geoQ !== q) return;
        const ms = (d.matches || []).slice(0, 8);
        pop.innerHTML = ms.length ? ms.map((m, i) => `<button type="button" role="option" data-geo-i="${i}">${m.kind === 'locality' ? `<b>${esc(m.he)}</b> <small>יישוב · ${esc(m.code)}</small>` : `${esc(m.he)} · <b>${esc(m.city)}</b> <small>רחוב${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</small>`}</button>`).join('') : '<div class="ax-muted" style="padding:8px">לא נמצא — ניתן להשאיר טקסט חופשי</div>';
        pop._matches = ms; pop.hidden = false; input.setAttribute('aria-expanded', 'true');
      } catch (e) { pop.innerHTML = `<div class="ax-muted" style="padding:8px">חיפוש PROPX אינו זמין (${esc(e.message)}) — הטקסט נשמר כפי שהוקלד</div>`; pop._matches = []; pop.hidden = false; }
    }, 220);
  }
  function geoPick(i) {
    const pop = $('#axGeoPop'), m = (pop._matches || [])[i]; if (!m) return;
    const info = S.deal.info;
    if (m.kind === 'locality') { info.city = m.he; info.cityCode = String(m.code); delete info.street; }
    else { info.city = m.city; info.cityCode = String(m.cityCode); info.street = m.he; if (!info.address) info.address = m.he; if (m.neighborhood && !info.neighborhood) info.neighborhood = m.neighborhood; }
    pop.hidden = true; markDirty();
    renderView();
  }

  /* --------------------------------------------------------------- theme */
  const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  function applyThemeIcon() {
    const dark = currentTheme() === 'dark';
    const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M19.1 4.9l-1.9 1.9M6.8 17.2l-1.9 1.9"/></svg>';
    const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.4 14.2A8.5 8.5 0 0 1 9.8 3.6a8.5 8.5 0 1 0 10.6 10.6z"/></svg>';
    const b = $('#themeBtn'); if (b) b.innerHTML = dark ? sun : moon;
    const r = $('#themeBtnRail'); if (r) r.innerHTML = (dark ? sun : moon) + `<span>${dark ? 'בהיר' : 'כהה'}</span>`;
  }
  function setTheme(m) {
    if (m === 'dark') document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(THEME_KEY, m); } catch (e) { /* storage blocked */ }
    applyThemeIcon();
  }

  /* --------------------------------------------------------------- events */
  function onInput(e) {
    const el = e.target;
    if (el.dataset.k) {
      const path = el.dataset.k, t = el.dataset.t;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (t) v = E.num(el.value);
      else v = el.value;
      if (path === 'info.city') { delete S.deal.info.cityCode; delete S.deal.info.street; geoSearch(el); }
      setP(S.deal, path, v === null ? undefined : v);
      markDirty();
      const structural = el.tagName === 'SELECT' || el.type === 'checkbox';
      if (structural && /^(buy|finance|hybrid)\./.test(path)) schedule(true); else schedule(false);
      return;
    }
    if (el.dataset.u) {
      const [i, f] = el.dataset.u.split(':');
      const u = S.deal.units[+i]; if (!u) return;
      if (f === 'label') u.label = el.value; else { const n = E.num(el.value); if (n == null) delete u[f]; else u[f] = n; }
      markDirty(); schedule(false); return;
    }
    if (el.dataset.v) {
      const [k, f] = el.dataset.v.split('.');
      const V = S.deal.value; V[k] = V[k] || {};
      if (f === 'note') V[k].note = el.value;
      else { const n = E.num(el.value); if (n == null) delete V[k][f]; else V[k][f] = n; if (k === 'propx' || k === 'comparables') V[k].auto = false; }
      markDirty(); schedule(false); return;
    }
    if (el.name === 'vchosen') { S.deal.value.chosen = el.value; markDirty(); schedule(false); return; }
    if (el.dataset.sc) {
      const [sc, k] = el.dataset.sc.split('.');
      S.deal.scen[sc] = S.deal.scen[sc] || {};
      if (el.type === 'checkbox') S.deal.scen[sc][k] = el.checked;
      else { const n = E.num(el.value); if (n == null) delete S.deal.scen[sc][k]; else S.deal.scen[sc][k] = n; }
      markDirty(); schedule(false); return;
    }
    if (el.dataset.set) {
      const n = E.num(el.value);
      setP(S.settings, el.dataset.set, n == null ? undefined : n);
      store.set(KEY.settings, S.settings); S.dealsRev = (S.dealsRev || 0) + 1; schedule(false); return;
    }
    if (el.dataset.status) { const r = S.deals[el.dataset.status]; if (r) { r.status = el.value; persistDeals(); schedule(false); } return; }
    if (el.dataset.ver) { S.cmpVer[el.dataset.ver] = +el.value; paintSaved(); return; }
    if (el.dataset.actCheck === 'arch') { S.showArchived = el.checked; paintSaved(); return; }
    if (el.dataset.actCheck === 'appendix') { S.mAppendix = el.checked; renderShell(); return; }
    if (el.dataset.actFile === 'import' && el.files && el.files[0]) { importJSON(el.files[0]); el.value = ''; }
  }
  function onBlur(e) {
    const el = e.target;
    if (el.dataset && el.dataset.t === 'nis' && el.value) { const n = E.num(el.value); if (n != null) el.value = F.int(n); }
    if ((el.dataset && (el.dataset.u || el.dataset.v)) && el.classList.contains('n') && el.value) {
      const n = E.num(el.value); const isMoney = /supported|proposed|value|psm/.test(el.dataset.u || el.dataset.v || '');
      if (n != null && isMoney) el.value = F.int(n);
    }
    if (el.dataset && el.dataset.geo) setTimeout(() => { const p = $('#axGeoPop'); if (p && !p.contains(document.activeElement)) p.hidden = true; }, 160);
  }
  function onClick(e) {
    if (e.target.id === 'axPopBd') { closePop(false); return; }
    if (POP.trigger && !e.target.closest('#axPop, .ax-mi, [data-hurdles], [data-cases]')) closePop(false);
    const t = e.target.closest('button, a, [data-geo-i]');
    if (!t) {   // anywhere on a structure card (outside its buttons) selects that structure
      const card = e.target.closest('.ax-card[data-card]');
      if (card && card.dataset.card !== S.strat) { S.strat = card.dataset.card; recompute(true); }
      return;
    }
    if (t.dataset.geoI != null) { geoPick(+t.dataset.geoI); return; }
    if (t.dataset.popClose != null) { closePop(true); return; }
    if (t.classList.contains('ax-mi') || t.dataset.hurdles || t.dataset.cases != null) {
      e.preventDefault();
      if (POP.trigger === t && POP.pinned) closePop(true); else openPop(t, true);
      return;
    }
    if (t.dataset.mgo != null) { e.preventDefault(); closePop(false); goMethod(t.dataset.mgo); return; }
    if (t.dataset.caseOpen) { closePop(false); openCase(t.dataset.caseOpen); return; }
    if (t.dataset.mlang) {
      if (t.dataset.mlang !== S.mlang) { const y = window.scrollY; S.mlang = t.dataset.mlang; S.mfocus = null; renderView(); window.scrollTo(0, y); }
      return;
    }
    if (t.classList.contains('ax-how')) { e.preventDefault(); showTip(t); return; }
    if (t.dataset.view || t.dataset.viewGo) {
      S.view = t.dataset.view || t.dataset.viewGo; S.mbarOpen = false; S.mfocus = null;
      history.replaceState(null, '', '#' + S.view); renderView(); window.scrollTo(0, 0); return;
    }
    if (t.dataset.strat) { S.strat = t.dataset.strat; recompute(true); return; }
    if (t.dataset.stress != null) { S.stress = t.dataset.stress || null; recompute(false); return; }
    const act = t.dataset.act; if (!act) return;
    const id = t.dataset.id;
    switch (act) {
      case 'example': newDeal(true); break;
      case 'case-copy': caseCopy(); break;
      case 'case-exit': newDeal(false); break;
      case 'unit-add': case 'unit-add5': {
        const n = act === 'unit-add5' ? 5 : 1;
        for (let i = 0; i < n; i++) S.deal.units.push({ label: '' });
        markDirty(); $('#axUnits tbody').innerHTML = unitRows(); recompute(false);
        const ins = $$('#axUnits tbody tr:last-child input'); if (ins[0]) ins[0].focus();
        break;
      }
      case 'unit-del': S.deal.units.splice(+t.dataset.i, 1); markDirty(); $('#axUnits tbody').innerHTML = unitRows(); recompute(false); break;
      case 'market': loadMarket(); break;
      case 'select-strat': S.deal.selected = S.deal.selected === S.strat ? null : S.strat; markDirty(); recompute(true); break;
      case 'reset-strat': if (confirm(`לאפס את כל הנחות ${SN[S.strat]} לברירות המחדל?`)) { S.deal[S.strat] = {}; markDirty(); recompute(true); } break;
      case 'reset-scen': S.deal.scen = {}; markDirty(); renderView(); break;
      case 'save': saveDeal(); break;
      case 'new': newDeal(false); break;
      case 'open': openDeal(id); break;
      case 'dup': duplicateDeal(id); break;
      case 'archive': if (S.deals[id]) { S.deals[id].archived = !S.deals[id].archived; persistDeals(); recompute(false); renderShell(); } break;
      case 'cmp': S.cmpVer = { id, a: S.deals[id].versions.length - 1, b: S.deals[id].versions.length }; paintSaved(); break;
      case 'cmp-close': S.cmpVer = {}; paintSaved(); break;
      case 'settings-reset': if (confirm('לאפס את הגדרות הקרן לברירות המחדל?')) { S.settings = {}; store.set(KEY.settings, {}); S.dealsRev = (S.dealsRev || 0) + 1; renderView(); } break;
      case 'mbar': S.mbarOpen = !S.mbarOpen; paintLedger(); break;
      case 'pdf-ic': printIC(); break;
      case 'pdf-full': printFull(); break;
      case 'pdf-method': printMethod(); break;
      case 'xlsx': exportXLSX(); break;
      case 'csv': exportCSV(); break;
      case 'json': exportJSON(); break;
      default: break;
    }
  }
  function wire() {
    const main = document.body;
    main.addEventListener('input', onInput);
    main.addEventListener('change', (e) => { if (e.target.matches('select, input[type=checkbox], input[type=radio], input[type=date], input[type=file]')) onInput(e); });
    main.addEventListener('focusout', onBlur);
    main.addEventListener('click', onClick);
    main.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'mouse') {   // desktop: hovering a metric mark previews its popover; a click pins it
        const m = e.target.closest('.ax-mi, [data-hurdles]');
        if (m || e.target.closest('#axPop')) {
          clearTimeout(POP.t);
          if (m && !POP.pinned && POP.trigger !== m && !sheetMode()) POP.t = setTimeout(() => { if (!POP.pinned) openPop(m, false); }, 140);
          return;
        }
      }
      const t = e.target.closest('[data-tip]'); if (t && !t.classList.contains('ax-how')) showTip(t); else if (t && t.classList.contains('ax-how') && e.pointerType === 'mouse') showTip(t);
    });
    main.addEventListener('pointerout', (e) => {
      if (e.target.closest('[data-tip]')) hideTip();
      const m = e.target.closest('.ax-mi, [data-hurdles], #axPop');
      if (m && e.pointerType === 'mouse' && !POP.pinned && !(e.relatedTarget && m.contains(e.relatedTarget))) popLater();
    });
    main.addEventListener('focusout', (e) => {   // tabbing out of a pinned popover closes it
      const p = popEl();
      if (p && !p.hidden && p.contains(e.target) && e.relatedTarget && !p.contains(e.relatedTarget) && e.relatedTarget !== POP.trigger) closePop(false);
    });
    main.addEventListener('focusin', (e) => { const t = e.target.closest('[data-tip]'); if (t) showTip(t); });
    main.addEventListener('focusout', (e) => { if (e.target.closest('[data-tip]')) hideTip(); });
    main.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (POP.trigger) { closePop(true); return; } hideTip(); const p = $('#axGeoPop'); if (p) p.hidden = true; }
      if (e.key === 'Enter' && e.target.dataset && e.target.dataset.geo) { const p = $('#axGeoPop'); if (p && !p.hidden && (p._matches || []).length) { e.preventDefault(); geoPick(0); } }
    });
    window.addEventListener('scroll', () => { hideTip(); placePop(); }, { passive: true });
    let rw = window.innerWidth, rt = 0;   // charts are drawn at their pixel width: redraw when the width changes
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(window.innerWidth - rw) > 8) { rw = window.innerWidth; closePop(false); recompute(false); } }, 180); });
    ['themeBtn', 'themeBtnRail'].forEach((i) => { const b = document.getElementById(i); if (b) b.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')); });
    window.addEventListener('hashchange', () => {
      const h = parseHash(); if (!VIEWS.includes(h.v)) return;
      if (h.v === 'method') { if (S.view !== 'method' || h.id !== S.mfocus) goMethod(h.id); }
      else if (h.v !== S.view) { S.view = h.v; S.mfocus = null; renderView(); }
    });
  }

  /* ----------------------------------------------------------------- init */
  function init() {
    const ui = store.get(KEY.ui, {}) || {};
    const dr = store.get(KEY.draft, null);
    S.deal = normalizeDeal(dr && dr.deal ? dr.deal : blankDeal());
    S.dealId = dr && dr.dealId && S.deals[dr.dealId] ? dr.dealId : null;
    S.dirty = !!(dr && dr.dirty);
    S.dealsRev = 0;
    const h = parseHash();
    S.view = VIEWS.includes(h.v) ? h.v : VIEWS.includes(ui.view) ? ui.view : 'deal';
    S.mfocus = S.view === 'method' && h.v === 'method' ? h.id : null;
    S.strat = E.STRATS.includes(ui.strat) ? ui.strat : 'buy';
    S.mlang = ui.mlang === 'en' ? 'en' : 'he';
    S.mAppendix = ui.mAppendix !== false;
    wire(); applyThemeIcon(); renderView();
    const on = $('.rail .ri.on');   // on the bottom rail (narrow screens) bring the active item into view
    if (on && window.innerWidth < 980) { const r = $('.rail'); r.scrollLeft = on.offsetLeft - r.clientWidth / 2 + on.offsetWidth / 2; }
  }
  window.ALTARIS = { state: S, recompute: () => recompute(true), engine: E };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
