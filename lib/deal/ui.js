/* PROPX · DEAL DECISION LAB — the page module (live build only; loaded after the page's main script, mounted into #dlRoot).
 *
 * One street (picked here, opened anywhere on the page — "propx:geo" — or sent from the street report's valuation section), the user's
 * deal (property · price · financing · rent & costs — every value a USER ASSUMPTION, nothing defaulted), and the results:
 *   price check (asking ↔ observed comparables ↔ the PROPX model) · comparables (sortable, every exclusion counted, the source line) ·
 *   financing · cash-flow statement · yields / cash-on-cash / DSCR / break-evens · sensitivity · scenarios · risk & due-diligence
 *   checklist (deal rules + the street report's items) · sources & dates · the INVESTMENT MEMO (print / .html) · saved deals
 *   (localStorage propx:deallab:v1, per browser only).
 * Data: GET /api/intel?view=dealContext | dealLab | dealStreet (lib/deal/index.js); arithmetic: window.PropxDealEngine (lib/deal/engine.js,
 * loaded on demand). Strings in Hebrew and English live here; the page's "propx:lang" event re-renders. ⓘ through the page's xpBtn.
 */
(function () {
  'use strict';
  const root = document.getElementById('dlRoot');
  if (!root) return;

  /* ───────────────────────── strings ───────────────────────── */
  const STR = {
    he: {
      lyr: 'L3 · עסקה', title: 'מעבדת עסקה', note: 'כל קלט הוא הנחה שלכם · עסקאות נצפו · המודל הוא מודל',
      orient: 'בוחרים רחוב רשמי, מתארים את הדירה ואת העסקה — ורואים את המחיר מול עסקאות שנצפו ומול המודל, את המימון, התזרים, התשואות, הרגישות והדגלים.',
      howToRead: 'איך לקרוא את זה', street: 'רחוב', streetPh: 'חיפוש רחוב רשמי — למשל הרצל פתח תקווה', streetNone: 'בחרו רחוב כדי לטעון עסקאות השוואה.',
      streetFrom: 'הרחוב שנפתח בדף', openReport: 'לדוח הרחוב', change: 'החלפה', srchNone: 'אין רחוב רשמי תואם', srchErr: (k) => `החיפוש נכשל (${k}) — נסו שוב`, srchMin: 'הקלידו לפחות 2 תווים',
      g: { property: 'הנכס', price: 'מחיר ועלויות רכישה', finance: 'מימון', rent: 'שכירות והוצאות', comps: 'סינון עסקאות ההשוואה', targets: 'יעד ותרחישים' },
      f: { sqm: 'שטח (מ״ר)', rooms: 'חדרים', built: 'שנת בנייה', newness: 'חדשה / קיימת', type: 'סוג', floor: 'קומה (לא בהשוואה)',
        price: 'מחיר מבוקש (₪)', buyer: 'סוג הרוכש', tax: 'מס רכישה (₪)', legal: 'עו״ד (₪)', broker: 'תיווך (₪)', renovation: 'שיפוץ (₪)', other: 'אחר (₪)',
        mode: 'מימון לפי', downPayment: 'הון עצמי במחיר (₪)', ltvPct: 'שיעור מימון (%)', ratePct: 'ריבית שנתית (%)', years: 'תקופה (שנים)',
        rent: 'שכירות חודשית (₪)', vacancyPct: 'תקופות ריקות (%)', maintenance: 'תחזוקה (₪ לחודש)', managementPct: 'ניהול (% מהשכירות)', insurance: 'ביטוח (₪ לשנה)', otherOpex: 'אחר (₪ לחודש)',
        sizeTol: 'שטח ± (%)', roomsTol: 'חדרים ±', months: 'חודשים אחרונים', minComps: 'מינימום עסקאות לפני הרחבה',
        targetCocPct: 'יעד תשואה על ההון (%)', dRent: 'שכירות (%)', dVac: 'ריק (נק׳)', dRate: 'ריבית (נק׳)', dOpex: 'הוצאות (%)', uRent: 'שכירות (%)', uVac: 'ריק (נק׳)', uRate: 'ריבית (נק׳)', uOpex: 'הוצאות (%)' },
      opt: { newness: { '': '—', existing: 'קיימת', new: 'חדשה' }, type: { '': '—', flat: 'דירה בבניין', garden: 'דירת גן', roof: 'דירת גג', cottage: 'קוטג׳', house: 'בית בודד' },
        buyer: { '': '—', single: 'דירה יחידה', replacement: 'מחליף דירה', additional: 'דירה נוספת' }, mode: { down: 'הון עצמי', ltv: 'שיעור מימון', cash: 'מזומן (ללא הלוואה)' } },
      downside: 'תרחיש שלילי', upside: 'תרחיש חיובי', exampleStress: 'מילוי זעזוע לדוגמה (ניתן לשינוי)', zeroCosts: 'שדות עלות ריקים = 0', zeroOpex: 'הוצאות ריקות = 0',
      taxFill: 'מילוי לפי מדרגות מס הרכישה', taxFilled: (d, s) => `מולא ממדרגות מס הרכישה (טבלה סטטית, נבדקה ${d}; ${s}) — ניתן לשנות`, taxNeedBuyer: 'בחרו סוג רוכש ומחיר כדי למלא לפי המדרגות',
      taxNoTable: 'טבלת מדרגות המס אינה זמינה בדף', blankIsBlank: 'שדה ריק = לא הוזן (0 הוא ערך). שום דבר לא ממולא בברירת מחדל.',
      official: 'רשמי · בנק ישראל', officialTrack: (v, p) => `ממוצע קבועה לא צמודה: <span class="num">${v}%</span> (<span class="num">${p}</span>)`, officialMore: 'מסלולים נוספים', officialNote: 'ממוצע הלוואות חדשות במערכת הבנקאית — לא הצעה; הריבית שלכם היא שמשמשת לחישוב.',
      ltvRule: (s, r, a) => `כלל מגבלות המימון: דירה יחידה <span class="num">${s}%</span> · מחליף דירה <span class="num">${r}%</span> · דירה נוספת <span class="num">${a}%</span> (הוראה 329 — לבדוק את ההוראה בתוקף)`,
      analyse: 'ניתוח', save: 'שמירת עסקה', saved: 'עסקאות שמורות', open: 'פתיחה', del: 'מחיקה', noSaved: 'אין עסקאות שמורות בדפדפן זה', savedOk: 'נשמר בדפדפן זה',
      print: 'הדפסת מזכר', download: 'הורדת מזכר (.html)', altaris: 'חיתום מוסדי מלא ב-ALTARIS', storageOff: 'הדפדפן חוסם שמירה מקומית — העסקה לא נשמרה',
      loading: 'טוען…', err: 'לא ניתן לטעון את נתוני הרחוב כעת', retry: 'ניסיון חוזר', paramErr: (f, r) => `ערך לא תקין ב"${f}" — ${r}`,
      r: { price: 'בדיקת מחיר', comps: 'עסקאות השוואה', fin: 'מימון', cf: 'דוח תזרים', ret: 'תשואות, כיסוי ואיזון', sens: 'רגישות', scen: 'תרחישים', risk: 'סיכונים ובדיקת נאותות', src: 'מקורות ותאריכים' },
      perSqm: '/מ״ר', ask: 'המחיר המבוקש', askSqm: 'מבוקש למ״ר', obs: 'עסקאות שנצפו', model: 'מודל PROPX', median: 'חציון ₪/מ״ר', iqr: 'P25–P75', minmax: 'מינימום–מקסימום', pctl: 'אחוזון המבוקש',
      vsMed: 'מבוקש מול החציון', n: 'עסקאות', state: { SUPPORTED: 'מספק', LIMITED: 'מוגבל', INSUFFICIENT: 'לא מספיק', NONE: 'אין' },
      level: { STREET: 'הרחוב', BLOCKS: 'גושים נוגעים ברחוב', NEIGHBOURHOOD: 'שכונה מאומתת', LOCALITY: 'היישוב' },
      levelCls: { OBSERVED: 'נצפה ברחוב', 'LOCATION-LINKED': 'קשור-מיקום', 'VERIFIED-NEIGHBOURHOOD': 'שכונה מאומתת', 'LOCALITY-CONTEXT': 'הקשר יישובי' },
      wider: (l) => `נבדק ברמה רחבה: ${l} — לא מחיר הרחוב`, noComps: 'אין מספיק עסקאות השוואה לבדיקת מחיר', notSwept: (r) => `אין עסקאות שמורות ליישוב (${r})`,
      modelApt: 'הערכה לדירה', modelRange: 'טווח אימות', tier: 'רמת ראיות', modelStreet: 'רמת הרחוב (דירת ייחוס 85 מ״ר)', modelNA: 'אין הערכה לדירה',
      modelNote: 'מודל — לא שומה; טווח האימות הוא טווח שגיאות על עסקאות שלא נראו, לא טווח ביטחון.', strip: 'מיקום המחיר המבוקש מול עסקאות ההשוואה והמודל (₪/מ״ר)',
      fresh: (d, s, l) => `עותק המרשם ${d} · ${s} · העסקה האחרונה בו ${l}`, latestEv: (d, s) => `האירוע האחרון שידוע לרחוב: ${d} (${s})`,
      fState: { CURRENT: 'עדכני', RECENT: 'חדש יחסית', STALE: 'לא עדכני', VERY_STALE: 'לא עדכני מאוד', SOURCE_LAG_UNKNOWN: 'פיגור לא ידוע' },
      funnel: 'מה נכנס ומה הוחרג', universe: 'עסקאות ברמה', included: 'נכנסו', excluded: 'הוחרגו', sample: 'מצב המדגם', excl: {
        NOT_OBSERVED_ON_STREET: 'התאמה לא ודאית לרחוב', NON_DWELLING: 'לא מגורים', FUTURE_DATED: 'תאריך עתידי', PARTIAL_SHARE: 'חלק מנכס', SHARE_NOT_STATED: 'חלק לא מצוין',
        SEVERAL_UNITS_ONE_PRICE: 'כמה יחידות בתמורה אחת', BELOW_MARKET_OR_NO_AMOUNT: 'מתחת ל-100,000 ₪ / ללא סכום', NOT_PRICED: 'לא מתומחרת', NO_USABLE_AREA: 'ללא שטח שמיש',
        OUTSIDE_PERIOD: 'מחוץ לתקופה', SIZE_OUTSIDE: 'שטח מחוץ לטווח', ROOMS_NOT_STATED: 'חדרים לא מצוינים', ROOMS_OUTSIDE: 'חדרים מחוץ לטווח' },
      notUsed: { 'narrower-levels-reached-min': 'לא נדרש — ברמות הצרות יש מספיק', 'no-verified-neighbourhood': 'אין קישור שכונה מאומת' },
      filterLine: (s, r, m, k) => `שטח ${s} · חדרים ${r} · ${m} חודשים · מינימום ${k}`, notApplied: 'ללא סינון',
      cols: ['תאריך', 'רמה', 'כתובת', 'מחיר', 'מ״ר', '₪/מ״ר', 'חדרים', 'קומה', 'בנייה', 'גוש/חלקה/תת', 'מקור · עותק', 'סיווג'],
      srcReg: 'מרשם רשות המסים (עותק over.org.il)', srcShort: 'עותק המרשם', showAll: (n) => `הצגת כל ${n}`, showLess: 'הצגת פחות', floorWhy: 'עותק המרשם אינו כולל קומה',
      newTag: 'חדשה כנראה', offPlan: 'שנת בנייה אחרי העסקה',
      notInReg: (n) => `${n} עסקאות ברחוב מעותק שכבת GovMap שעותק המרשם עדיין לא מחזיק — מחירן לא נכנס להשוואה`, notInRegCols: ['תאריך', 'כתובת', 'מחיר כפי שפורסם', 'מ״ר', 'חדרים', 'קומה', 'מצב', 'עותק'],
      concentration: (p, s) => `חלקה ${p} מחזיקה ${s}% מהעסקאות המתומחרות ברחוב — המדגם מתאר בעיקר אותה`,
      v: { loan: 'הלוואה', ltvPct: 'שיעור מימון', downPayment: 'הון עצמי במחיר', monthlyPayment: 'החזר חודשי', totalInterest: 'סך ריבית', totalPaid: 'סך תשלומים', purchaseCosts: 'עלויות רכישה',
        totalCost: 'עלות כוללת', equity: 'הון מושקע', grossYieldPct: 'תשואה ברוטו', netYieldPct: 'תשואה נטו', cashOnCashPct: 'תשואה על ההון', dscr: 'DSCR', breakEvenRentMonthly: 'שכירות איזון',
        breakEvenPrice: 'מחיר איזון ליעד', noi: 'NOI', cashFlowMonthly: 'תזרים חודשי', cashFlowAnnual: 'תזרים שנתי', pricePerSqm: '₪ למ״ר' },
      amort: 'לוח סילוקין לפי שנה', amortCols: ['שנה', 'תשלומים', 'ריבית', 'קרן', 'יתרה בסוף'], rateUser: 'הריבית שלכם', perMonth: 'לחודש', perYear: 'לשנה',
      cfRows: { gross: 'שכירות ברוטו', vac: 'תקופות ריקות', egi: 'הכנסה אפקטיבית', maint: 'תחזוקה', mgmt: 'ניהול', ins: 'ביטוח', oth: 'אחר', noi: 'NOI — הכנסה תפעולית נטו', ds: 'החזרי משכנתא',
        dsI: 'מתוכם ריבית (שנה 1)', dsP: 'מתוכם קרן (שנה 1)', cf: 'תזרים לפני מס' }, cfCols: ['', 'חודשי', 'שנתי'], cfNote: 'לפני מס; ללא עליית שכירות או ערך. קרן שנפרעת היא יציאת מזומן שבונה הון.',
      sensCols: ['שינוי', 'תזרים חודשי', 'תשואה על ההון', 'DSCR', 'תשואה נטו'], sensRent: 'שכירות', sensRate: 'ריבית', sensPrice: 'מחיר', grid: 'תזרים חודשי: שכירות × ריבית', gridRow: 'שכירות', gridCol: 'ריבית',
      sensNote: 'כל תא — המנוע מחושב מחדש עם שינוי אחד; בשינוי מחיר העלויות נשארות בסכומים שהזנתם.',
      scenCols: ['', 'זעזועים', 'תזרים חודשי', 'תשואה על ההון', 'DSCR', 'תשואה נטו'], scenName: { base: 'בסיס', downside: 'שלילי', upside: 'חיובי' }, scenNone: 'לא הוזן זעזוע',
      shock: { rentPct: 'שכירות', vacancyPp: 'ריק', ratePp: 'ריבית', opexPct: 'הוצאות' },
      flagsH: 'דגלי העסקה', noFlags: 'אף כלל לא הופעל — זה לא אישור, רק שאין דגל.', kind: { risk: 'סיכון', watch: 'מעקב', info: 'מידע' }, value: 'ערך', threshold: 'סף', source: 'מקור', why: 'למה אני רואה את זה?',
      flag: {
        'DL-ASK-ABOVE-P75': (f) => `המבוקש למ״ר מעל P75 של עסקאות ההשוואה (${f.lv}, n=${f.n})`, 'DL-ASK-BELOW-P25': (f) => `המבוקש למ״ר מתחת ל-P25 של עסקאות ההשוואה (${f.lv}, n=${f.n}) — לברר למה`,
        'DL-COMPS-THIN': () => 'ברחוב פחות מ-5 עסקאות השוואה', 'DL-NEGATIVE-CASHFLOW': () => 'תזרים חודשי שלילי', 'DL-DSCR-BELOW-1': () => 'DSCR מתחת ל-1.0 — השכירות נטו לא מכסה את ההחזר',
        'DL-DSCR-BELOW-1-2': () => 'DSCR מתחת ל-1.2 — כיסוי דק', 'DL-LTV-ABOVE-LIMIT': (f) => `שיעור המימון מעל ${f.threshold}% (${f.buyer}) — הוראה 329, לבדוק את ההוראה בתוקף`,
        'DL-EVIDENCE-STALE': () => 'עותק העסקאות לא עדכני — עסקאות אחרונות עלולות לחסור', 'DL-MODEL-UNAVAILABLE': () => 'אין הערכת מודל לדירה', 'DL-MODEL-LIMITED': () => 'רמת הראיות של המודל מוגבלת',
        'DL-ASK-ABOVE-MODEL-RANGE': () => 'המבוקש מעל טווח האימות של המודל', 'DL-RATE-VS-OFFICIAL': () => 'הריבית שלכם רחוקה ב-1 נק׳ או יותר מממוצע בנק ישראל', 'DL-CONCENTRATION': () => 'חלקה אחת מחזיקה ≥ 50% מעסקאות הרחוב' },
      streetH: 'מה דוח הרחוב אומר', sup: 'תומך', ag: 'נגד', chg: 'עשוי להשתנות', dd: 'בדיקת נאותות — לסמן כשנבדק', kinds: { FACT: 'עובדה', INTERPRETATION: 'פרשנות' }, streetLoading: 'טוען את דוח הרחוב…',
      streetErr: 'דוח הרחוב לא נטען', plans: (i, p, t) => `תכניות שגבולן כולל חלקה ברחוב: ${i} (${p} בהליך) · תכניות תחבורה מסילתית בטווח 1,000 מ׳: ${t}`,
      srcCols: ['מקור', 'סיווג', 'תאריך', 'הערה'], disclaimer: 'לא שומה ולא ייעוץ השקעות. עסקאות ההשוואה הן עסקאות שנצפו בעותק של מאגר רשות המסים (לא ערוץ ממשלתי); ההערכה היא מודל; כל קלט הוא הנחה שלכם.',
      needs: 'חסר:', na: { 'no-loan': 'אין הלוואה', 'no-debt': 'אין חוב', 'no-equity': 'אין הון מושקע', 'target-not-reachable': 'היעד אינו מושג', 'above-search-range': 'מעל טווח החיפוש', 'not-computable': 'לא ניתן לחישוב', 'rate-below-zero': 'ריבית מתחת ל-0%', 'no-shock-entered': 'לא הוזן זעזוע', 'down-payment-above-price': 'הון עצמי מעל המחיר' },
      inp: { price: 'מחיר', sqm: 'שטח', tax: 'מס רכישה', legal: 'עו״ד', broker: 'תיווך', renovation: 'שיפוץ', other: 'אחר', financingMode: 'אופן מימון', downPayment: 'הון עצמי', ltvPct: 'שיעור מימון', ratePct: 'ריבית', years: 'תקופה',
        rentMonthly: 'שכירות', vacancyPct: 'ריק', maintenance: 'תחזוקה', managementPct: 'ניהול', insurance: 'ביטוח', otherOpex: 'הוצאה אחרת', targetCocPct: 'יעד תשואה' },
      invalid: (l) => `ערכים לא תקינים: ${l}`,
      memoT: 'מזכר השקעה', memoGen: (d) => `הופק ${d} · PROPX מעבדת עסקה`, memoIn: 'הקלטים', memoOut: 'התוצאות', memoCls: 'סיווג', memoVal: 'ערך', memoField: 'שדה',
      memoNoStreet: 'בחרו רחוב ומלאו את העסקה לפני הפקת מזכר.', unusedMode: 'לא בשימוש באופן המימון שנבחר',
    },
    en: {
      lyr: 'L3 · Deal', title: 'Deal Decision Lab', note: 'every input is your assumption · deals are observed · the model is a model',
      orient: 'Pick an official street, describe the flat and the deal — and see the price against observed deals and the model, the financing, cash flow, yields, sensitivity and flags.',
      howToRead: 'How to read this', street: 'Street', streetPh: 'Search an official street — e.g. Herzl Petah Tikva', streetNone: 'Pick a street to load comparables.',
      streetFrom: 'the street opened on the page', openReport: 'Street report', change: 'Change', srchNone: 'No matching official street', srchErr: (k) => `Search failed (${k}) — try again`, srchMin: 'Type at least 2 characters',
      g: { property: 'Property', price: 'Price & purchase costs', finance: 'Financing', rent: 'Rent & costs', comps: 'Comparables filter', targets: 'Target & scenarios' },
      f: { sqm: 'Area (m²)', rooms: 'Rooms', built: 'Build year', newness: 'New / existing', type: 'Type', floor: 'Floor (not in comps)',
        price: 'Asking price (₪)', buyer: 'Buyer type', tax: 'Purchase tax (₪)', legal: 'Legal (₪)', broker: 'Broker (₪)', renovation: 'Renovation (₪)', other: 'Other (₪)',
        mode: 'Finance by', downPayment: 'Down payment (₪)', ltvPct: 'Loan-to-value (%)', ratePct: 'Annual rate (%)', years: 'Term (years)',
        rent: 'Monthly rent (₪)', vacancyPct: 'Vacancy (%)', maintenance: 'Maintenance (₪/month)', managementPct: 'Management (% of rent)', insurance: 'Insurance (₪/year)', otherOpex: 'Other (₪/month)',
        sizeTol: 'Area ± (%)', roomsTol: 'Rooms ±', months: 'Last months', minComps: 'Minimum deals before widening',
        targetCocPct: 'Target cash-on-cash (%)', dRent: 'Rent (%)', dVac: 'Vacancy (pp)', dRate: 'Rate (pp)', dOpex: 'Costs (%)', uRent: 'Rent (%)', uVac: 'Vacancy (pp)', uRate: 'Rate (pp)', uOpex: 'Costs (%)' },
      opt: { newness: { '': '—', existing: 'Existing', new: 'New' }, type: { '': '—', flat: 'Flat in a building', garden: 'Garden flat', roof: 'Roof flat', cottage: 'Cottage', house: 'Detached house' },
        buyer: { '': '—', single: 'Single home', replacement: 'Replacement home', additional: 'Additional home' }, mode: { down: 'Down payment', ltv: 'Loan-to-value', cash: 'Cash (no loan)' } },
      downside: 'Downside', upside: 'Upside', exampleStress: 'Fill an example stress (editable)', zeroCosts: 'Empty cost fields = 0', zeroOpex: 'Empty costs = 0',
      taxFill: 'Fill from the purchase-tax brackets', taxFilled: (d, s) => `Filled from the purchase-tax brackets (a static table, checked ${d}; ${s}) — editable`, taxNeedBuyer: 'Choose a buyer type and a price to fill from the brackets',
      taxNoTable: 'The tax-bracket table is not available on the page', blankIsBlank: 'An empty field = not entered (0 is a value). Nothing is filled by default.',
      official: 'OFFICIAL · Bank of Israel', officialTrack: (v, p) => `Average fixed, unindexed: <span class="num">${v}%</span> (<span class="num">${p}</span>)`, officialMore: 'Other tracks', officialNote: 'The average of new loans in the banking system — not an offer; your rate is the one computed with.',
      ltvRule: (s, r, a) => `LTV limits rule: single home <span class="num">${s}%</span> · replacement <span class="num">${r}%</span> · additional <span class="num">${a}%</span> (Directive 329 — check the directive in force)`,
      analyse: 'Analyse', save: 'Save deal', saved: 'Saved deals', open: 'Open', del: 'Delete', noSaved: 'No deals saved in this browser', savedOk: 'Saved in this browser',
      print: 'Print memo', download: 'Download memo (.html)', altaris: 'Full institutional underwriting in ALTARIS', storageOff: 'The browser blocks local storage — the deal was not saved',
      loading: 'Loading…', err: 'The street data could not be loaded', retry: 'Retry', paramErr: (f, r) => `Invalid value in "${f}" — ${r}`,
      r: { price: 'Price check', comps: 'Comparables', fin: 'Financing', cf: 'Cash-flow statement', ret: 'Yields, coverage & break-evens', sens: 'Sensitivity', scen: 'Scenarios', risk: 'Risk & due diligence', src: 'Sources & dates' },
      perSqm: '/m²', ask: 'Asking price', askSqm: 'Asking per m²', obs: 'Observed deals', model: 'PROPX model', median: 'Median ₪/m²', iqr: 'P25–P75', minmax: 'Min–max', pctl: 'Asking percentile',
      vsMed: 'Asking vs median', n: 'deals', state: { SUPPORTED: 'SUPPORTED', LIMITED: 'LIMITED', INSUFFICIENT: 'INSUFFICIENT', NONE: 'NONE' },
      level: { STREET: 'the street', BLOCKS: 'blocks touching the street', NEIGHBOURHOOD: 'verified neighbourhood', LOCALITY: 'the locality' },
      levelCls: { OBSERVED: 'OBSERVED on the street', 'LOCATION-LINKED': 'LOCATION-LINKED', 'VERIFIED-NEIGHBOURHOOD': 'VERIFIED NEIGHBOURHOOD', 'LOCALITY-CONTEXT': 'LOCALITY CONTEXT' },
      wider: (l) => `Checked at a wider level: ${l} — not the street's price`, noComps: 'Too few comparables for a price check', notSwept: (r) => `No stored deals for the locality (${r})`,
      modelApt: 'Estimate for the flat', modelRange: 'Validation range', tier: 'Evidence tier', modelStreet: 'Street level (85 m² reference dwelling)', modelNA: 'No estimate for the flat',
      modelNote: 'A model — not an appraisal; the validation range is an error range on unseen deals, not a confidence interval.', strip: 'Where the asking price sits against the comparables and the model (₪/m²)',
      fresh: (d, s, l) => `Register copy ${d} · ${s} · latest deal in it ${l}`, latestEv: (d, s) => `Latest known event on the street: ${d} (${s})`,
      fState: { CURRENT: 'CURRENT', RECENT: 'RECENT', STALE: 'STALE', VERY_STALE: 'VERY STALE', SOURCE_LAG_UNKNOWN: 'SOURCE LAG UNKNOWN' },
      funnel: 'What qualified and what was excluded', universe: 'deals at the level', included: 'qualified', excluded: 'excluded', sample: 'sample state', excl: {
        NOT_OBSERVED_ON_STREET: 'not a certain street match', NON_DWELLING: 'not a dwelling', FUTURE_DATED: 'future-dated', PARTIAL_SHARE: 'partial share', SHARE_NOT_STATED: 'share not stated',
        SEVERAL_UNITS_ONE_PRICE: 'several units, one price', BELOW_MARKET_OR_NO_AMOUNT: 'under ₪100,000 / no amount', NOT_PRICED: 'not priced', NO_USABLE_AREA: 'no usable area',
        OUTSIDE_PERIOD: 'outside the period', SIZE_OUTSIDE: 'area outside the range', ROOMS_NOT_STATED: 'rooms not stated', ROOMS_OUTSIDE: 'rooms outside the range' },
      notUsed: { 'narrower-levels-reached-min': 'not needed — the narrower levels hold enough', 'no-verified-neighbourhood': 'no verified neighbourhood link' },
      filterLine: (s, r, m, k) => `area ${s} · rooms ${r} · ${m} months · minimum ${k}`, notApplied: 'not filtered',
      cols: ['Date', 'Level', 'Address', 'Price', 'm²', '₪/m²', 'Rooms', 'Floor', 'Built', 'Block/parcel/sub', 'Source · copy', 'Class'],
      srcReg: 'Tax Authority register (over.org.il copy)', srcShort: 'register copy', showAll: (n) => `Show all ${n}`, showLess: 'Show fewer', floorWhy: 'the register copy carries no floor',
      newTag: 'probably new', offPlan: 'build year after the deal',
      notInReg: (n) => `${n} deals on the street from the GovMap-layer copy that the register copy does not hold yet — their price never enters the comparison`, notInRegCols: ['Date', 'Address', 'Price as printed', 'm²', 'Rooms', 'Floor', 'State', 'Copy'],
      concentration: (p, s) => `Parcel ${p} holds ${s}% of the street's priced deals — the sample mostly describes it`,
      v: { loan: 'Loan', ltvPct: 'Loan-to-value', downPayment: 'Down payment', monthlyPayment: 'Monthly payment', totalInterest: 'Total interest', totalPaid: 'Total paid', purchaseCosts: 'Purchase costs',
        totalCost: 'Total cost', equity: 'Equity invested', grossYieldPct: 'Gross yield', netYieldPct: 'Net yield', cashOnCashPct: 'Cash-on-cash', dscr: 'DSCR', breakEvenRentMonthly: 'Break-even rent',
        breakEvenPrice: 'Break-even price for the target', noi: 'NOI', cashFlowMonthly: 'Monthly cash flow', cashFlowAnnual: 'Annual cash flow', pricePerSqm: '₪ per m²' },
      amort: 'Amortisation by year', amortCols: ['Year', 'Payments', 'Interest', 'Principal', 'Closing balance'], rateUser: 'Your rate', perMonth: 'a month', perYear: 'a year',
      cfRows: { gross: 'Gross rent', vac: 'Vacancy', egi: 'Effective income', maint: 'Maintenance', mgmt: 'Management', ins: 'Insurance', oth: 'Other', noi: 'NOI — net operating income', ds: 'Mortgage payments',
        dsI: 'of which interest (year 1)', dsP: 'of which principal (year 1)', cf: 'Pre-tax cash flow' }, cfCols: ['', 'Monthly', 'Annual'], cfNote: 'Pre-tax; no rent growth or appreciation. Principal repaid is a cash outflow that builds equity.',
      sensCols: ['Change', 'Monthly cash flow', 'Cash-on-cash', 'DSCR', 'Net yield'], sensRent: 'Rent', sensRate: 'Rate', sensPrice: 'Price', grid: 'Monthly cash flow: rent × rate', gridRow: 'Rent', gridCol: 'Rate',
      sensNote: 'Each cell — the engine re-run with one change; in the price change the costs stay at the amounts you entered.',
      scenCols: ['', 'Shocks', 'Monthly cash flow', 'Cash-on-cash', 'DSCR', 'Net yield'], scenName: { base: 'Base', downside: 'Downside', upside: 'Upside' }, scenNone: 'no shock entered',
      shock: { rentPct: 'rent', vacancyPp: 'vacancy', ratePp: 'rate', opexPct: 'costs' },
      flagsH: 'Deal flags', noFlags: 'No rule fired — that is not an approval, only that there is no flag.', kind: { risk: 'RISK', watch: 'WATCH', info: 'INFO' }, value: 'value', threshold: 'threshold', source: 'source', why: 'Why am I seeing this?',
      flag: {
        'DL-ASK-ABOVE-P75': (f) => `Asking ₪/m² above the comparables' P75 (${f.lv}, n=${f.n})`, 'DL-ASK-BELOW-P25': (f) => `Asking ₪/m² below the comparables' P25 (${f.lv}, n=${f.n}) — find out why`,
        'DL-COMPS-THIN': () => 'Fewer than 5 comparables on the street', 'DL-NEGATIVE-CASHFLOW': () => 'Negative monthly cash flow', 'DL-DSCR-BELOW-1': () => 'DSCR below 1.0 — the net rent does not cover the payment',
        'DL-DSCR-BELOW-1-2': () => 'DSCR below 1.2 — thin coverage', 'DL-LTV-ABOVE-LIMIT': (f) => `LTV above ${f.threshold}% (${f.buyer}) — Directive 329, check the directive in force`,
        'DL-EVIDENCE-STALE': () => 'The transaction copy is not current — recent deals may be missing', 'DL-MODEL-UNAVAILABLE': () => 'No model estimate for the flat', 'DL-MODEL-LIMITED': () => 'The model\'s evidence tier is LIMITED',
        'DL-ASK-ABOVE-MODEL-RANGE': () => 'Asking above the model\'s validation range', 'DL-RATE-VS-OFFICIAL': () => 'Your rate is 1 pp or more from the Bank of Israel average', 'DL-CONCENTRATION': () => 'One parcel holds ≥ 50% of the street\'s deals' },
      streetH: 'What the street report says', sup: 'Supports', ag: 'Against', chg: 'Could change', dd: 'Due diligence — tick when checked', kinds: { FACT: 'FACT', INTERPRETATION: 'INTERPRETATION' }, streetLoading: 'Loading the street report…',
      streetErr: 'The street report did not load', plans: (i, p, t) => `Plans whose boundary includes a parcel of the street: ${i} (${p} in process) · rail-transit plans within 1,000 m: ${t}`,
      srcCols: ['Source', 'Class', 'Date', 'Note'], disclaimer: 'Not an appraisal and not investment advice. The comparables are deals observed in a copy of the Tax Authority register (not a government channel); the estimate is a model; every input is your assumption.',
      needs: 'needs:', na: { 'no-loan': 'no loan', 'no-debt': 'no debt', 'no-equity': 'no equity invested', 'target-not-reachable': 'target not reachable', 'above-search-range': 'above the search range', 'not-computable': 'not computable', 'rate-below-zero': 'rate below 0%', 'no-shock-entered': 'no shock entered', 'down-payment-above-price': 'down payment above the price' },
      inp: { price: 'price', sqm: 'area', tax: 'purchase tax', legal: 'legal', broker: 'broker', renovation: 'renovation', other: 'other', financingMode: 'financing mode', downPayment: 'down payment', ltvPct: 'LTV', ratePct: 'rate', years: 'term',
        rentMonthly: 'rent', vacancyPct: 'vacancy', maintenance: 'maintenance', managementPct: 'management', insurance: 'insurance', otherOpex: 'other cost', targetCocPct: 'target return' },
      invalid: (l) => `Invalid values: ${l}`,
      memoT: 'Investment memo', memoGen: (d) => `Generated ${d} · PROPX Deal Decision Lab`, memoIn: 'Inputs', memoOut: 'Results', memoCls: 'Class', memoVal: 'Value', memoField: 'Field',
      memoNoStreet: 'Pick a street and fill in the deal before generating a memo.', unusedMode: 'not used by the chosen financing',
    },
  };

  /* ───────────────────────── page bridges (all optional) ───────────────────────── */
  const lang = () => { try { if (typeof state !== 'undefined' && state && state.lang) return state.lang === 'en' ? 'en' : 'he'; } catch (e) { /* no page state */ } return document.documentElement.lang === 'en' ? 'en' : 'he'; };
  const t = () => STR[lang()];
  const XPX = () => window.PropxExplain || null;
  const xp = (id) => { try { return typeof xpBtn === 'function' ? xpBtn(id) : ''; } catch (e) { return ''; } };
  const xs = (id, rt) => { try { return typeof xpSig === 'function' ? xpSig(id, rt) : ''; } catch (e) { return ''; } };
  const xm = (id) => { try { return typeof xpMiss === 'function' ? xpMiss(id) : ''; } catch (e) { return ''; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }), nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MINUS = '−';
  const cityOf = (x) => { if (!x) return ''; if (lang() !== 'en' || !x.cityEn) return x.city || ''; try { return typeof enTitle === 'function' ? enTitle(x.cityEn) || x.city : x.cityEn; } catch (e) { return x.cityEn; } };
  const sgn = (s) => s.replace(/^-/, MINUS);
  const num = (s) => `<span class="num">${s}</span>`;
  const nis = (v, d) => (v == null || !Number.isFinite(v) ? null : sgn((v < 0 ? '-' : '') + '₪' + (d ? nf2 : nf0).format(Math.abs(v))));
  const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : sgn(v.toFixed(d)) + '%');
  const spct = (v, d = 1) => (v == null ? null : (v > 0 ? '+' : '') + sgn(Number(v).toFixed(d)) + '%');
  const x2 = (v) => (v == null || !Number.isFinite(v) ? null : sgn(v.toFixed(2)) + '×');
  const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '—');
  const CLS_CSS = { OFFICIAL: 'raw', OBSERVED: 'obs', DERIVED: 'der', MODEL: 'mod', MISSING: 'na', USER_ASSUMPTION: 'usr', STATIC: 'static' };
  function chip(code) {
    const X = XPX(), L = lang();
    const label = code === 'STATIC' ? (L === 'en' ? 'STATIC' : 'סטטי') : X && X.classLabel ? X.classLabel(code, L) : code;
    return `<span class="vc ${CLS_CSS[code] || 'na'}" data-cls="${esc(code)}">${esc(label)}</span>`;
  }
  const ENGINE_SRC = '/lib/deal/engine.js';
  let ENG = window.PropxDealEngine || null, engWait = null;
  function engine() {
    if (ENG) return Promise.resolve(ENG);
    if (engWait) return engWait;
    engWait = new Promise((res, rej) => { const s = document.createElement('script'); s.src = ENGINE_SRC; s.onload = () => { ENG = window.PropxDealEngine || null; ENG ? res(ENG) : rej(new Error('engine')); }; s.onerror = () => rej(new Error('engine')); document.head.appendChild(s); });
    return engWait;
  }
  async function getJSON(q) {
    const r = await fetch('/api/intel?' + q, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    let d = null; try { d = await r.json(); } catch (e) { d = null; }
    if (!r.ok) { const e = new Error((d && d.error) || ('HTTP ' + r.status)); e.status = r.status; e.body = d; throw e; }
    return d;
  }

  /* ───────────────────────── state ───────────────────────── */
  const KEY = 'propx:deallab:v1';
  const FIELDS = ['sqm', 'rooms', 'built', 'newness', 'type', 'floor', 'price', 'buyer', 'tax', 'legal', 'broker', 'renovation', 'other', 'mode', 'downPayment', 'ltvPct', 'ratePct', 'years',
    'rent', 'vacancyPct', 'maintenance', 'managementPct', 'insurance', 'otherOpex', 'sizeTol', 'roomsTol', 'months', 'minComps', 'targetCocPct', 'dRent', 'dVac', 'dRate', 'dOpex', 'uRent', 'uVac', 'uRate', 'uOpex'];
  const blankInputs = () => Object.fromEntries(FIELDS.map((k) => [k, k === 'mode' ? 'down' : '']));
  const S = { street: null, streetFrom: null, ctx: null, data: null, status: 'idle', err: null, sdata: null, sstatus: 'idle', inputs: blankInputs(), prov: {}, dd: {},
    sort: { key: 'date', dir: 'desc', isDefault: true }, showAll: false, req: 0, sreq: 0, result: null, msg: null, taxNote: null };
  /* the similarity filter's starting values come from the read model (dealContext.filter), shown in the form as the user's filter */
  const store = {
    read() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.v === 1 && Array.isArray(v.deals) ? v : { v: 1, deals: [] }; } catch (e) { return { v: 1, deals: [] }; } },
    write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  /* ───────────────────────── style (one element) ───────────────────────── */
  const CSS = `
#dlRoot{display:block}
.dl-orient{margin:0 0 12px}
.dl-pick{position:relative;display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}
.dl-pick label{font-size:12px;font-weight:700;color:var(--ink-3)}
.dl-pick input[type=search]{flex:1 1 280px;min-width:0;font:inherit;font-size:14px;padding:8px 12px;border:1px solid var(--edge);border-radius:10px;background:var(--panel);color:var(--ink);min-height:42px}
.dl-list{position:absolute;inset-inline:0;top:100%;z-index:30;margin:4px 0 0;padding:4px;list-style:none;background:var(--panel);border:1px solid var(--edge);border-radius:10px;box-shadow:var(--shadow-pop);max-height:320px;overflow:auto}
.dl-list li{padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13.5px;display:flex;justify-content:space-between;gap:10px}
.dl-list li[aria-selected=true],.dl-list li:hover{background:var(--accent-wash)}
.dl-list li small{color:var(--ink-3)}
.dl-cur{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13.5px;margin:0 0 10px}
.dl-cur b{font-size:15px}
.dl-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;margin:0 0 12px}
.dl-form fieldset{border:1px solid var(--hairline);border-radius:12px;padding:10px 12px 12px;margin:0;min-width:0;background:var(--panel)}
.dl-form legend{font-size:12.5px;font-weight:800;color:var(--ink);padding:0 6px}
.dl-fg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px}
.dl-f{display:flex;flex-direction:column;gap:3px;font-size:11.5px;font-weight:700;color:var(--ink-2);min-width:0}
.dl-f .dl-lt{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.dl-f label{cursor:pointer}
.dl-fg input,.dl-fg select{width:100%;box-sizing:border-box;font:inherit;font-size:13.5px;padding:6px 8px;border:1px solid var(--edge);border-radius:8px;background:var(--paper);color:var(--ink);min-height:38px}
.dl-fg input[aria-invalid=true]{border-color:var(--down)}
.dl-fg input:disabled{opacity:.45}
.dl-fg .dl-wide{grid-column:1/-1}
.dl-fg fieldset.dl-radio{grid-column:1/-1;border:0;padding:0;display:flex;flex-wrap:wrap;gap:6px 12px;background:none}
.dl-fg fieldset.dl-radio legend{font-size:11.5px;font-weight:700;color:var(--ink-2);padding:0;width:100%}
.dl-fg fieldset.dl-radio label{flex-direction:row;align-items:center;gap:5px;font-weight:600}
.dl-fg fieldset.dl-radio input{width:auto;min-height:0}
.dl-ctx{font-size:11.5px;color:var(--ink-2);line-height:1.5;margin:6px 0 0}
.dl-ctx details{margin-top:2px}.dl-ctx summary{cursor:pointer;font-weight:700;color:var(--accent-deep)}
.dl-ctx ul{margin:4px 0 0;padding-inline-start:16px}
.dl-mini{font:inherit;font-size:11.5px;font-weight:700;color:var(--accent-deep);background:none;border:1px dashed var(--edge);border-radius:99px;padding:3px 10px;cursor:pointer;margin-top:6px}
.dl-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 14px}
.dl-acts .chip{min-height:38px;cursor:pointer}
.dl-acts .dl-go{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.dl-acts select{font:inherit;font-size:12.5px;padding:6px 8px;border:1px solid var(--edge);border-radius:99px;background:var(--panel);color:var(--ink);min-height:38px;max-width:260px}
.dl-acts a.chip{text-decoration:none}
.dl-msg{font-size:12.5px;color:var(--ink-2);margin:-6px 0 12px}
.dl-sec{border:1px solid var(--hairline);border-radius:12px;background:var(--panel);margin:0 0 12px;padding:0}
.dl-sec>summary{cursor:pointer;list-style:none;padding:11px 14px;font-weight:800;font-size:14px;display:flex;gap:8px;align-items:center}
.dl-sec>summary::-webkit-details-marker{display:none}
.dl-sub{margin-top:10px}.dl-sub>summary{font-size:12.5px;font-weight:700;padding:8px 12px}.dl-ex{font-size:11.5px}
.dl-sec>summary::before{content:"▸";color:var(--ink-3);font-size:11px}
.dl-sec[open]>summary::before{content:"▾"}
.dl-body{padding:0 14px 14px}
.dl-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.dl-card{border:1px solid var(--hairline);border-radius:11px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;min-width:0}
.dl-card.mod{border-style:dashed;border-color:var(--brass)}
.dl-card .h{font-size:11.5px;font-weight:800;color:var(--ink-3);display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.dl-card .v{font-size:20px;font-weight:800;color:var(--ink)}
.dl-card .s{font-size:12px;color:var(--ink-2);line-height:1.5}
.dl-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.dl-kv>div{border:1px solid var(--hairline);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;min-width:0}
.dl-kv .l{font-size:11.5px;font-weight:700;color:var(--ink-3);display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.dl-kv .v{font-size:16px;font-weight:800}
.dl-kv .s{font-size:11.5px;color:var(--ink-3);line-height:1.45}
.dl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
.dl-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.dl-tbl th,.dl-tbl td{padding:6px 8px;border-bottom:1px solid var(--hairline);text-align:start;vertical-align:top;white-space:nowrap}
.dl-tbl th{font-size:11px;font-weight:800;color:var(--ink-3)}
.dl-tbl td.w{white-space:normal;min-width:120px}
.dl-tbl tr.tot td{font-weight:800;border-top:2px solid var(--edge)}
.dl-tbl tr.sub td{color:var(--ink-3);font-size:11.5px}
.dl-tbl th button{font:inherit;font-weight:800;color:inherit;background:none;border:0;padding:0;cursor:pointer;display:inline-flex;gap:3px;align-items:center}
.dl-tbl .neg{color:var(--down)}
.dl-tag{display:inline-block;font-size:10px;font-weight:700;color:var(--ink-3);border:1px solid var(--hairline);border-radius:99px;padding:0 6px;margin-inline-start:4px}
.dl-lv{display:inline-block;font-size:10px;font-weight:800;border-radius:99px;padding:0 7px;border:1px solid var(--accent);color:var(--accent)}
.dl-lv.wide{border-style:dashed;color:var(--brass);border-color:var(--brass)}
.dl-note{font-size:12px;color:var(--ink-2);line-height:1.55;margin:8px 0 0}
.dl-na{color:var(--ink-3)}
.dl-na small{display:block;font-size:11px;font-weight:600;color:var(--ink-3)}
.dl-flags{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.dl-flags li{border:1px solid var(--hairline);border-radius:10px;padding:8px 10px;font-size:13px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.dl-k{font-size:10px;font-weight:800;border-radius:99px;padding:1px 8px;border:1px solid currentColor}
.dl-k.risk{color:var(--down)}.dl-k.watch{color:var(--conf-med)}.dl-k.info{color:var(--accent-deep)}
.dl-flags .m{font-size:11.5px;color:var(--ink-3)}
.dl-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.dl-two ul{margin:0;padding-inline-start:18px;font-size:12.5px;line-height:1.55}
.dl-two h4{font-size:12.5px;margin:6px 0}
.dl-dd{list-style:none;padding:0;margin:0;font-size:12.5px}
.dl-dd li{margin:0 0 6px}
.dl-dd label{display:flex;gap:8px;align-items:flex-start;cursor:pointer}
.dl-dd input{margin-top:3px;min-width:16px;min-height:16px}
.dl-strip{width:100%;max-width:640px;height:auto;display:block;margin:8px 0 0}
.dl-src{white-space:nowrap}
.dl-strip text{font-size:11px;fill:var(--ink-2);font-family:inherit}
.dl-sens{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.dl-sens h4{font-size:12.5px;margin:0 0 4px}
.dl-sens td.base{font-weight:800}
.dl-disc{font-size:12px;font-weight:700;color:var(--ink-2);border-inline-start:3px solid var(--brass);padding:6px 10px;margin:0 0 12px;background:var(--wash-brass)}
#dlPrint{display:none}
@media (max-width:560px){.dl-fg{grid-template-columns:minmax(0,1fr)}.dl-card .v{font-size:18px}.dl-acts select{max-width:100%}}
@media print{body.dl-printing>*:not(#dlPrint){display:none!important}body.dl-printing #dlPrint{display:block!important}
  #dlPrint{font-family:Assistant,Heebo,system-ui,sans-serif;color:#101b30;font-size:11px}#dlPrint table{width:100%;border-collapse:collapse;margin:4px 0 10px}
  #dlPrint th,#dlPrint td{border-bottom:1px solid #ccd;padding:3px 5px;text-align:start;vertical-align:top}#dlPrint h1{font-size:18px;margin:0 0 4px}#dlPrint h2{font-size:13px;margin:12px 0 4px;break-after:avoid}#dlPrint tr{break-inside:avoid}}
`;
  if (!document.getElementById('dlStyle')) { const st = document.createElement('style'); st.id = 'dlStyle'; st.textContent = CSS; document.head.appendChild(st); }

  /* ───────────────────────── inputs → engine ───────────────────────── */
  const val = (k) => S.inputs[k];
  function engineInputs() {
    return { price: val('price'), sqm: val('sqm'), costs: { tax: val('tax'), legal: val('legal'), broker: val('broker'), renovation: val('renovation'), other: val('other') },
      financing: { mode: val('mode') || null, downPayment: val('downPayment'), ltvPct: val('ltvPct'), ratePct: val('ratePct'), years: val('years') },
      rent: { monthly: val('rent'), vacancyPct: val('vacancyPct'), maintenance: val('maintenance'), managementPct: val('managementPct'), insurance: val('insurance'), otherOpex: val('otherOpex') },
      targetCocPct: val('targetCocPct') };
  }
  const shocks = () => ({ downside: { rentPct: val('dRent'), vacancyPp: val('dVac'), ratePp: val('dRate'), opexPct: val('dOpex') }, upside: { rentPct: val('uRent'), vacancyPp: val('uVac'), ratePp: val('uRate'), opexPct: val('uOpex') } });
  function compute() {
    if (!ENG) return null;
    const inp = engineInputs();
    const r = ENG.analyze(inp);
    const D = S.data;
    const C = D && D.comps && D.comps.available ? D.comps : null;
    const Mo = D && D.model ? D.model : null;
    const rate = D && D.finance && D.finance.available ? (D.finance.tracks || []).find((x) => x.id === 'rateFixedUnindexed') : null;
    let modelCtx = null;
    /* the model rules read the APARTMENT estimate (₪); before an area is entered only the street's own state speaks (unavailable / LIMITED) */
    if (Mo) {
      if (!Mo.available) modelCtx = { available: false, reason: Mo.reason };
      else if (Mo.apartment) modelCtx = { available: true, tier: Mo.tier, value: Mo.apartment.value, range: Mo.apartment.range };
      else if (Mo.apartmentReason && Mo.apartmentReason !== 'area-not-entered') modelCtx = { available: false, reason: Mo.apartmentReason, tier: Mo.tier };
      else if (Mo.tier === 'LIMITED' && Mo.street) modelCtx = { available: true, tier: Mo.tier, value: Mo.street.ppsqm, range: null };
    }
    const fl = ENG.flags(r, { buyer: val('buyer') || null,
      comps: C ? { percentile: C.percentileLevel, street: C.street } : null, model: modelCtx,
      freshness: D && D.freshness ? D.freshness : null, officialRate: rate && rate.value != null ? { value: rate.value, period: rate.period } : null,
      concentration: C && C.concentration ? C.concentration : null });
    return { r, sens: ENG.sensitivity(inp), scen: ENG.scenarios(inp, shocks()), flags: fl };
  }

  /* ───────────────────────── rendering helpers ───────────────────────── */
  const lvName = (lv) => t().level[lv] || lv;
  function naCell(r, key) {
    const T = t();
    if (r && r.notApplicable && r.notApplicable[key]) { const k = r.notApplicable[key]; return `<span class="dl-na">—<small>${esc(T.na[k] || k)} ${xm(k)}</small></span>`; }
    const m = r && r.missing ? r.missing[key] : null;
    if (m && m.length) return `<span class="dl-na">—<small>${esc(T.needs)} ${m.map((x) => esc(T.inp[x] || x)).join(' · ')} ${xm(m.includes('rentMonthly') && m.length <= 6 ? 'rentMonthly' : 'deal-input-missing')}</small></span>`;
    return '<span class="dl-na">—</span>';
  }
  /* a computed value: the formatted figure, or "—" with what it needs */
  function cell(r, key, fmt) {
    const v = r ? r.values[key] : null;
    if (v == null || !Number.isFinite(v)) return naCell(r, key);
    const s = fmt(v);
    return num(`<span class="${v < 0 ? 'neg' : ''}">${esc(s)}</span>`);
  }
  function kv(label, inner, sub, term, cls) {
    return `<div><span class="l">${esc(label)} ${cls ? chip(cls) : ''} ${term ? xp(term) : ''}</span><span class="v">${inner}</span>${sub ? `<span class="s">${sub}</span>` : ''}</div>`;
  }
  function details(id, title, body, term, open = true) {
    return `<details class="dl-sec" id="dl-${id}"${open ? ' open' : ''}><summary>${esc(title)} ${term ? xp(term) : ''}</summary><div class="dl-body">${body}</div></details>`;
  }

  /* ───────────────────────── the form ───────────────────────── */
  function field(k, opt = {}) {
    const T = t(), lab = T.f[k];
    const v = S.inputs[k] == null ? '' : S.inputs[k];
    const c = S.prov[k] === 'table' ? chip('DERIVED') + chip('STATIC') : chip('USER_ASSUMPTION');
    const ctl = opt.select
      ? `<select data-dl="${k}" id="dl-f-${k}">${Object.entries(opt.select).map(([o, l]) => `<option value="${esc(o)}"${String(v) === o ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<input data-dl="${k}" id="dl-f-${k}"${opt.disabled ? ' disabled' : ''} type="${opt.text ? 'text' : 'number'}"${opt.text ? '' : ' inputmode="decimal"'} value="${esc(v)}"${opt.min != null ? ` min="${opt.min}"` : ''}${opt.max != null ? ` max="${opt.max}"` : ''}${opt.step ? ` step="${opt.step}"` : ''}${opt.ph ? ` placeholder="${esc(opt.ph)}"` : ''} aria-describedby="dl-blank">`;
    return `<div class="dl-f${opt.wide ? ' dl-wide' : ''}"><span class="dl-lt"><label for="dl-f-${k}">${esc(lab)}</label> ${c}${opt.term ? ' ' + xp(opt.term) : ''}</span>${ctl}${opt.after || ''}</div>`;
  }
  function officialRateHTML() {
    const T = t(), F = S.ctx && S.ctx.finance;
    if (!F) return '';
    if (!F.available) return `<p class="dl-ctx">${chip('MISSING')} ${xm('finance-not-synced')}</p>`;
    const L = lang(), ref = (F.tracks || []).find((x) => x.id === F.reference);
    const rest = (F.tracks || []).filter((x) => x.id !== F.reference && x.id !== 'pti');
    return `<div class="dl-ctx">${chip('OFFICIAL')} ${ref && ref.value != null ? T.officialTrack(Number(ref.value), esc(ref.period)) : '—'} ${xp('deal_official_rate')}
      <details><summary>${esc(T.officialMore)}</summary><ul>${rest.map((x) => `<li>${esc(L === 'en' ? x.en : x.he)}: ${x.value != null ? num(esc(x.value + '%')) + ' (' + esc(x.period) + ')' : '— ' + xm(x.missing || 'series-not-published')}</li>`).join('')}</ul></details>
      <div>${esc(T.officialNote)}</div></div>`;
  }
  function formHTML() {
    const T = t(), R = (S.ctx && S.ctx.rules) || (ENG && ENG.RULES) || null;
    const radio = `<fieldset class="dl-radio"><legend>${esc(T.f.mode)} ${chip('USER_ASSUMPTION')} ${xp('deal_loan')}</legend>${Object.entries(T.opt.mode).map(([k, l]) => `<label><input type="radio" name="dl-mode" data-dl="mode" value="${k}"${S.inputs.mode === k ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</fieldset>`;
    const ltvRule = R && R.ltv ? `<p class="dl-ctx">${T.ltvRule(Number(R.ltv.single), Number(R.ltv.replacement), Number(R.ltv.additional))} ${xp('deal_ltv_limit')}</p>` : '';
    const taxBtn = `<button type="button" class="dl-mini" data-dlact="tax">${esc(T.taxFill)}</button>${S.taxNote ? `<span class="dl-ctx">${esc(S.taxNote)}</span>` : ''}`;
    return `<form class="dl-form" data-dlform="1" novalidate>
      <fieldset><legend>${esc(T.g.property)}</legend><div class="dl-fg">${field('sqm', { min: 15, max: 1000, step: 1 })}${field('rooms', { min: 1, max: 15, step: 0.5 })}${field('built', { min: 1800, max: 2100, step: 1 })}
        ${field('newness', { select: T.opt.newness })}${field('type', { select: T.opt.type })}${field('floor', { text: true, after: `<span class="dl-ctx">${esc(T.floorWhy)} ${xm('floor-not-in-register')}</span>` })}</div></fieldset>
      <fieldset><legend>${esc(T.g.price)}</legend><div class="dl-fg">${field('price', { min: 1, step: 1000, wide: true, term: 'deal_comps_percentile' })}${field('buyer', { select: T.opt.buyer, wide: true })}
        ${field('tax', { min: 0, step: 100, wide: true, term: 'deal_purchase_costs', after: taxBtn })}${field('legal', { min: 0, step: 100 })}${field('broker', { min: 0, step: 100 })}${field('renovation', { min: 0, step: 1000 })}${field('other', { min: 0, step: 100 })}</div>
        <button type="button" class="dl-mini" data-dlact="zeroCosts">${esc(T.zeroCosts)}</button></fieldset>
      <fieldset><legend>${esc(T.g.finance)}</legend><div class="dl-fg">${radio}${field('downPayment', { min: 0, step: 1000, disabled: S.inputs.mode !== 'down' })}${field('ltvPct', { min: 0, max: 100, step: 0.5, disabled: S.inputs.mode !== 'ltv' })}
        ${field('ratePct', { min: 0, max: 30, step: 0.01, term: 'deal_monthly_payment', disabled: S.inputs.mode === 'cash' })}${field('years', { min: 1, max: 40, step: 1, disabled: S.inputs.mode === 'cash' })}</div>${officialRateHTML()}${ltvRule}</fieldset>
      <fieldset><legend>${esc(T.g.rent)}</legend><div class="dl-fg">${field('rent', { min: 0, step: 50, wide: true, term: 'deal_noi' })}${field('vacancyPct', { min: 0, max: 99, step: 0.5 })}${field('maintenance', { min: 0, step: 10 })}
        ${field('managementPct', { min: 0, max: 99, step: 0.5 })}${field('insurance', { min: 0, step: 50 })}${field('otherOpex', { min: 0, step: 10 })}</div>
        <button type="button" class="dl-mini" data-dlact="zeroOpex">${esc(T.zeroOpex)}</button></fieldset>
      <fieldset><legend>${esc(T.g.comps)} ${xp('deal_comparables')}</legend><div class="dl-fg">${field('sizeTol', { min: 0, max: 100, step: 1 })}${field('roomsTol', { min: 0, max: 5, step: 0.5 })}${field('months', { min: 1, max: 36, step: 1 })}${field('minComps', { min: 1, max: 50, step: 1 })}</div></fieldset>
      <fieldset><legend>${esc(T.g.targets)} ${xp('deal_scenarios')}</legend><div class="dl-fg">${field('targetCocPct', { min: -50, max: 50, step: 0.1, wide: true, term: 'deal_break_even_price' })}
        <span class="dl-wide dl-ctx"><b>${esc(T.downside)}</b></span>${field('dRent', { min: -90, max: 90, step: 1 })}${field('dVac', { min: -50, max: 50, step: 1 })}${field('dRate', { min: -10, max: 10, step: 0.25 })}${field('dOpex', { min: -90, max: 300, step: 1 })}
        <span class="dl-wide dl-ctx"><b>${esc(T.upside)}</b></span>${field('uRent', { min: -90, max: 90, step: 1 })}${field('uVac', { min: -50, max: 50, step: 1 })}${field('uRate', { min: -10, max: 10, step: 0.25 })}${field('uOpex', { min: -90, max: 300, step: 1 })}</div>
        <button type="button" class="dl-mini" data-dlact="stress">${esc(T.exampleStress)}</button></fieldset>
    </form><p class="dl-note" id="dl-blank">${esc(T.blankIsBlank)}</p>`;
  }

  function savedHTML() {
    const T = t(), st = store.read();
    const opts = st.deals.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
    return st.deals.length ? `<label class="dl-ctx" for="dl-saved">${esc(T.saved)}</label><select id="dl-saved" data-dlsaved="1">${opts}</select><button type="button" class="chip" data-dlact="load">${esc(T.open)}</button><button type="button" class="chip" data-dlact="delete">${esc(T.del)}</button>`
      : `<span class="dl-ctx">${esc(T.noSaved)}</span>`;
  }
  function actsHTML() {
    const T = t();
    return `<div class="dl-acts"><button type="button" class="chip dl-go" data-dlact="analyse">${esc(T.analyse)}</button><button type="button" class="chip" data-dlact="save">${esc(T.save)}</button>
      <span class="dl-saved-wrap" style="display:contents">${savedHTML()}</span>
      <button type="button" class="chip" data-dlact="print">${esc(T.print)}</button><button type="button" class="chip" data-dlact="download">${esc(T.download)}</button>
      <a class="chip" href="/altaris">${esc(T.altaris)} ↗</a></div>${S.msg ? `<p class="dl-msg" role="status">${esc(S.msg)}</p>` : ''}`;
  }
  function curHTML() {
    const T = t(), s = S.street;
    return s ? `<div class="dl-cur"><span>${esc(T.street)}:</span> <b>${esc(s.name)}</b> <span>· ${esc(cityOf(s))}</span> ${chip('OFFICIAL')} <span class="dl-tag"><bdi>${esc(s.id)}</bdi></span>
      ${S.streetFrom ? `<span class="dl-tag">${esc(T.streetFrom)}</span>` : ''}${typeof openGeoView === 'function' ? `<button type="button" class="chip" data-dlact="report">${esc(T.openReport)}</button>` : ''}</div>` : `<p class="dl-ctx">${esc(T.streetNone)}</p>`;
  }
  /* the shell (built on first paint and on a language change); every part re-renders on its own, so a late answer never wipes what
     the user is typing (the search box keeps its text; a re-rendered form keeps the focused field and its caret) */
  function render() {
    const T = t();
    const q = document.getElementById('dl-q'), qv = q ? q.value : '';
    root.innerHTML = `<div class="blk-head"><div><span class="lyr">${esc(T.lyr)}</span><h2>${esc(T.title)} ${xp('deal_lab')}</h2></div><span class="note">${esc(T.note)}</span></div>
      <p class="orient dl-orient">${esc(T.orient)} <button type="button" class="xp-how" data-xpsec="dealLab">${esc(T.howToRead)} ⓘ</button></p>
      <p class="dl-disc">${esc(T.disclaimer)}</p>
      <div class="dl-pick"><label for="dl-q">${esc(T.street)}</label><input id="dl-q" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dl-list" placeholder="${esc(T.streetPh)}">
        <ul id="dl-list" class="dl-list" role="listbox" hidden></ul></div>
      <div id="dlCur"></div><div id="dlForm"></div><div id="dlActs"></div><p id="dlStatus" class="dl-msg" role="status"></p><div id="dlRes"></div>`;
    const nq = document.getElementById('dl-q'); if (nq) nq.value = qv;
    renderCur(); renderForm(); renderActs(); renderResults();
  }
  const part = (id, html) => { const n = document.getElementById(id); if (n) n.innerHTML = html; return n; };
  function renderCur() { part('dlCur', curHTML()); }
  function renderActs() { part('dlActs', actsHTML()); }
  function renderForm() {
    const a = document.activeElement, k = a && a.dataset ? a.dataset.dl : null, isRadio = a && a.type === 'radio';
    let sel = null; try { sel = k && !isRadio && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null; } catch (e) { sel = null; }
    const act = a && a.dataset ? a.dataset.dlact : null;
    part('dlForm', formHTML());
    const back = k ? root.querySelector(isRadio ? `input[name="dl-mode"][value="${a.value}"]` : `[data-dl="${k}"]`) : act ? root.querySelector(`[data-dlact="${act}"]`) : null;
    if (back) { back.focus(); if (sel) { try { back.setSelectionRange(sel[0], sel[1]); } catch (e) { /* a number input has no caret API */ } } }
  }
  function status(msg) { const n = document.getElementById('dlStatus'); if (n) n.textContent = msg || ''; }

  /* ───────────────────────── results ───────────────────────── */
  function priceStrip(C, Mo, askPpsqm) {
    const P = C && C.primary ? C.primary : null;
    const apt = Mo && Mo.apartment && Mo.apartment.range ? Mo.apartment : null;
    const sqm = Number(val('sqm'));
    const mLo = apt && sqm > 0 ? apt.range.lo / sqm : null, mHi = apt && sqm > 0 ? apt.range.hi / sqm : null, mV = apt ? apt.ppsqm : null;
    const pts = [P && P.p25, P && P.p75, P && P.min, P && P.max, P && P.medianPpsqm, askPpsqm, mLo, mHi, mV].filter((x) => x != null && Number.isFinite(x));
    if (pts.length < 2) return '';
    const lo = Math.min(...pts) * 0.96, hi = Math.max(...pts) * 1.04, W = Math.max(320, Math.min(640, Math.round((root.clientWidth || 640) - 8))), x = (v) => 20 + ((v - lo) / (hi - lo)) * (W - 40);
    const T = t(), parts = [], dir = lang() === 'en' ? 'ltr' : 'rtl';
    const bandLo = P ? (P.p25 != null ? P.p25 : P.min) : null, bandHi = P ? (P.p75 != null ? P.p75 : P.max) : null;
    if (bandLo != null && bandHi != null) parts.push(`<rect x="${x(bandLo)}" y="16" width="${Math.max(2, x(bandHi) - x(bandLo))}" height="16" rx="4" fill="var(--accent)" opacity=".28"><title>${esc((P.p25 != null ? T.iqr : T.minmax) + ': ' + nis(bandLo) + '–' + nis(bandHi))}</title></rect>`);
    if (P && P.medianPpsqm != null) parts.push(`<line x1="${x(P.medianPpsqm)}" x2="${x(P.medianPpsqm)}" y1="12" y2="36" stroke="var(--accent)" stroke-width="2"><title>${esc(T.median + ': ' + nis(P.medianPpsqm))}</title></line><text x="${x(P.medianPpsqm)}" y="50" text-anchor="middle" direction="${dir}">${esc(T.median.split(' ')[0])} ${esc(nis(P.medianPpsqm))}</text>`);
    if (mLo != null && mHi != null) parts.push(`<line x1="${x(mLo)}" x2="${x(mHi)}" y1="62" y2="62" stroke="var(--brass)" stroke-width="2" stroke-dasharray="4 3"><title>${esc(T.modelRange + ': ' + nis(mLo) + '–' + nis(mHi))}</title></line>`);
    if (mV != null) parts.push(`<rect x="${x(mV) - 5}" y="57" width="10" height="10" fill="var(--brass)" transform="rotate(45 ${x(mV)} 62)"><title>${esc(T.model + ': ' + nis(mV))}</title></rect><text x="${x(mV)}" y="82" text-anchor="middle" direction="${dir}">${esc(T.model)} ${esc(nis(mV))}</text>`);
    if (askPpsqm != null) parts.push(`<path d="M${x(askPpsqm)} 8 l-6 -8 h12 z" fill="var(--ink)"><title>${esc(T.askSqm + ': ' + nis(askPpsqm))}</title></path><line x1="${x(askPpsqm)}" x2="${x(askPpsqm)}" y1="8" y2="40" stroke="var(--ink)" stroke-width="2"/><text x="${x(askPpsqm)}" y="96" text-anchor="middle" font-weight="700" direction="${dir}">${esc(T.askSqm)} ${esc(nis(askPpsqm))}</text>`);
    const label = [P && P.medianPpsqm != null ? T.median + ' ' + nis(P.medianPpsqm) : null, askPpsqm != null ? T.askSqm + ' ' + nis(askPpsqm) : null, mV != null ? T.model + ' ' + nis(mV) : null].filter(Boolean).join(' · ');
    return `<svg class="dl-strip" viewBox="0 0 ${W} 104" dir="ltr" role="img" aria-label="${esc(T.strip + ': ' + label)}"><line x1="20" x2="${W - 20}" y1="24" y2="24" stroke="var(--hairline)" stroke-width="1"/>${parts.join('')}</svg>`;
  }
  function priceHTML(res) {
    const T = t(), D = S.data, C = D && D.comps, Mo = D && D.model, r = res && res.r;
    const askP = r ? r.values.pricePerSqm : null;
    const ask = `<div class="dl-card"><span class="h">${esc(T.ask)} ${chip('USER_ASSUMPTION')}</span><span class="v">${val('price') !== '' && Number(val('price')) > 0 ? num(esc(nis(Number(val('price'))))) : '—'}</span>
      <span class="s">${esc(T.askSqm)}: ${askP != null ? num(esc(nis(askP))) : naCell(r, 'pricePerSqm')} ${chip('DERIVED')}</span></div>`;
    let obs;
    if (!C) obs = '';
    else if (!C.available) obs = `<div class="dl-card"><span class="h">${esc(T.obs)} ${chip('MISSING')}</span><span class="v">—</span><span class="s">${esc(T.notSwept(C.reason))} ${xm(C.reason)}</span></div>`;
    else {
      const P = C.primary, Q = C.percentileLevel;
      obs = `<div class="dl-card"><span class="h">${esc(T.obs)} ${chip('OBSERVED')} ${xp('deal_comps_percentile')}</span>
        ${P ? `<span class="v">${num(esc(nis(P.medianPpsqm)))}</span><span class="s">${esc(T.median)} · ${esc(lvName(P.level))} · n=${P.n} · ${esc(T.state[P.state])}${P.level !== 'STREET' ? ` <span class="dl-lv wide">${esc(T.wider(lvName(P.level)))}</span>` : ''}</span>
          <span class="s">${P.p25 != null ? `${esc(T.iqr)}: ${num(esc(nis(P.p25) + '–' + nis(P.p75)))}` : P.min != null ? `${esc(T.minmax)}: ${num(esc(nis(P.min) + '–' + nis(P.max)))}` : ''}</span>
          <span class="s">${esc(T.vsMed)}: ${P.askVsMedianPct != null ? num(esc(spct(P.askVsMedianPct))) : '—'} · ${esc(T.pctl)}: ${Q && Q.askPercentile != null ? num(esc(String(Q.askPercentile))) + (Q.level !== P.level ? ` (${esc(lvName(Q.level))})` : '') : '—'}</span>`
          : `<span class="v">—</span><span class="s">${esc(T.noComps)} ${xm('narrower-levels-reached-min')}</span>`}
        ${C.street && (!P || P.level !== 'STREET') ? `<span class="s">${esc(lvName('STREET'))}: n=${C.street.n} · ${esc(T.state[C.street.state])}</span>` : ''}</div>`;
    }
    let mod = '';
    if (Mo) {
      if (!Mo.available) mod = `<div class="dl-card mod"><span class="h">${esc(T.model)} ${chip('MODEL')} ${xp('deal_model_estimate')}</span><span class="v">—</span><span class="s">${esc(Mo.reason || '')} ${xm(Mo.reason || 'model-not-built')}</span></div>`;
      else {
        const A = Mo.apartment;
        mod = `<div class="dl-card mod"><span class="h">${esc(T.model)} ${chip('MODEL')} ${xp('deal_model_estimate')}</span>
          ${A ? `<span class="v">${num(esc(nis(A.value)))}</span><span class="s">${esc(T.modelApt)} · ${num(esc(nis(A.ppsqm)))}${esc(T.perSqm)} · ${esc(T.tier)}: ${esc(Mo.tier)}</span><span class="s">${esc(T.modelRange)}: ${A.range ? num(esc(nis(A.range.lo) + '–' + nis(A.range.hi))) : '—'}</span>`
            : `<span class="v">—</span><span class="s">${esc(T.modelNA)}: ${esc(Mo.apartmentReason || '')} ${xm(Mo.apartmentReason || 'area-not-entered')}</span>`}
          <span class="s">${esc(T.modelStreet)}: ${Mo.street ? num(esc(nis(Mo.street.ppsqm))) + esc(T.perSqm) : '—'} · ${num(esc(dmy(Mo.asOf)))}${Mo.priceLevelQuarter ? ' · ' + num(esc(Mo.priceLevelQuarter)) : ''}</span>
          <span class="s">${esc(T.modelNote)}</span></div>`;
      }
    }
    const F = D && D.freshness, R = D && D.recency && D.recency.available ? D.recency.recency : null;
    const fresh = F && F.available ? `<p class="dl-note">${esc(T.fresh(dmy(F.snapshotDate), T.fState[F.state] || F.state, dmy(F.latestTransactionDate)))} ${xp('transaction_freshness')}${R && R.latestKnownEvent ? ' · ' + esc(T.latestEv(dmy(R.latestKnownEvent.date), R.latestKnownEvent.sourceId)) : ''}</p>` : '';
    const conc = C && C.concentration ? `<p class="dl-note">${esc(T.concentration(C.concentration.parcel, C.concentration.share))}</p>` : '';
    return `<div class="dl-cards">${ask}${obs}${mod}</div>${C && C.available ? priceStrip(C, Mo, askP) : ''}${fresh}${conc}`;
  }
  const SORTS = { date: ['date', 'date'], price: ['price', 'currency'], areaSqm: ['areaSqm', 'number'], pricePerSqm: ['pricePerSqm', 'currency'], rooms: ['rooms', 'number'], yearBuilt: ['yearBuilt', 'number'] };
  function compsHTML() {
    const T = t(), C = S.data && S.data.comps;
    if (!C) return `<p class="dl-ctx">${esc(T.streetNone)}</p>`;
    if (!C.available) return `<p class="dl-ctx">${esc(T.notSwept(C.reason))} ${xm(C.reason)}</p>`;
    const f = C.filter;
    const line = T.filterLine(f.sizeApplied ? `${f.sqm} m² ±${f.sizeTolPct}%` : T.notApplied, f.roomsApplied ? `${f.rooms} ±${f.roomsTol}` : T.notApplied, f.months, f.minComps);
    const funnel = `<h4>${esc(T.funnel)} ${xp('deal_comps_exclusions')}</h4><div class="dl-wrap"><table class="dl-tbl"><thead><tr><th>${esc(T.cols[1])}</th><th>${esc(T.universe)}</th><th>${esc(T.included)}</th><th>${esc(T.sample)}</th><th>${esc(T.median)}</th></tr></thead><tbody>
      ${C.levels.map((l) => l.used ? `<tr><td class="w"><span class="dl-lv${l.level === 'STREET' ? '' : ' wide'}">${esc(lvName(l.level))}</span> <small>${esc(T.levelCls[l.cls] || l.cls)}</small></td><td>${num(esc(nf0.format(l.universe)))}</td><td>${num(esc(String(l.included)))}</td><td>${esc(T.state[l.stats.state])}</td>
        <td>${l.stats.medianPpsqm != null ? num(esc(nis(l.stats.medianPpsqm))) : '—'}</td></tr>
        <tr class="sub"><td colspan="5" class="w dl-ex">${esc(T.excluded)} (${num(esc(nf0.format(l.excludedTotal)))}): ${Object.entries(l.excluded).filter(([, n]) => n > 0).map(([k, n]) => `${esc(T.excl[k] || k)} ${num(esc(String(n)))}`).join(' · ') || '—'}</td></tr>`
        : `<tr class="sub"><td class="w">${esc(lvName(l.level))}</td><td>${l.universe != null ? num(esc(nf0.format(l.universe))) : '—'}</td><td colspan="3" class="w">${esc(T.notUsed[l.reason] || l.reason)} ${xm(l.reason)}</td></tr>`).join('')}</tbody></table></div>
      <p class="dl-note">${esc(line)} ${xp('deal_comps_level')}</p>`;
    let rows = C.rows.slice();
    const sk = SORTS[S.sort.key] || SORTS.date;
    const PT = window.PropxTable;
    if (PT && PT.sortRows) rows = PT.sortRows(rows, (x) => x[sk[0]], sk[1], S.sort.dir, { tie: (a, b) => (b.date || '').localeCompare(a.date || '') });
    const shown = S.showAll ? rows : rows.slice(0, 40);
    const th = (k, i) => { const on = S.sort.key === k; return `<th aria-sort="${on ? (S.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-dlsort="${k}">${esc(T.cols[i])}${on ? (S.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>`; };
    const table = `<div class="dl-wrap"><table class="dl-tbl"><thead><tr>${th('date', 0)}<th>${esc(T.cols[1])}</th><th>${esc(T.cols[2])}</th>${th('price', 3)}${th('areaSqm', 4)}${th('pricePerSqm', 5)}${th('rooms', 6)}<th>${esc(T.cols[7])}</th>${th('yearBuilt', 8)}<th>${esc(T.cols[9])}</th><th>${esc(T.cols[10])}</th><th>${esc(T.cols[11])}</th></tr></thead><tbody>
      ${shown.map((x) => `<tr><td>${num(esc(dmy(x.date)))}</td><td><span class="dl-lv${x.level === 'STREET' ? '' : ' wide'}">${esc(lvName(x.level))}</span></td><td class="w"><bdi>${esc(x.level === 'STREET' ? `${x.streets[0] || ''} ${(x.houses || []).join(', ')}` : (x.streets || []).join(' · '))}</bdi></td>
        <td>${num(esc(nis(x.price)))}</td><td>${num(esc(String(x.areaSqm)))}</td><td>${num(esc(nis(x.pricePerSqm)))}</td><td>${x.rooms != null ? num(esc(String(x.rooms))) : '—'}</td><td><span class="dl-na">—</span></td>
        <td>${x.yearBuilt != null ? num(esc(String(x.yearBuilt))) : '—'}${x.probableNew ? `<span class="dl-tag">${esc(T.newTag)}</span>` : ''}${x.buildYearAfterDeal ? `<span class="dl-tag">${esc(T.offPlan)}</span>` : ''}</td>
        <td><bdi>${esc([x.block, x.parcel, x.subParcel].filter((y) => y != null).join('/'))}</bdi></td><td class="dl-src" title="${esc(T.srcReg)}">${esc(T.srcShort)} · ${num(esc(dmy(x.snapshotDate)))}</td><td>${chip(x.cls)}</td></tr>`).join('') || `<tr><td colspan="12">—</td></tr>`}</tbody></table></div>
      ${rows.length > 40 ? `<button type="button" class="dl-mini" data-dlact="showAll">${esc(S.showAll ? T.showLess : T.showAll(rows.length))}</button>` : ''}
      <p class="dl-note">${esc(T.cols[7])}: — · ${esc(T.floorWhy)} ${xm('floor-not-in-register')} · ${esc(C.source.name)} · ${esc(T.fresh(dmy(C.source.snapshotDate), '', dmy(C.source.lastDeal)).replace(' ·  · ', ' · '))}</p>`;
    const RC = S.data.recency;
    const nr = RC && RC.available && RC.notInRegisterTotal ? `<details class="dl-sec dl-sub"><summary>${esc(T.notInReg(RC.notInRegisterTotal))} ${xp('recent_transaction_layer')}</summary><div class="dl-body"><div class="dl-wrap"><table class="dl-tbl"><thead><tr>${T.notInRegCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${RC.notInRegister.map((e) => `<tr><td>${num(esc(dmy(e.date)))}</td><td class="w"><bdi>${esc(e.houseNumber || '')}</bdi></td><td>${e.price != null ? num(esc(nis(e.price))) : '—'}</td><td>${e.areaSqm != null ? num(esc(String(e.areaSqm))) : '—'}</td><td>${e.rooms != null ? num(esc(String(e.rooms))) : '—'}</td><td>${esc(e.floor || '—')}</td><td>${esc(e.state)}</td><td>${num(esc(dmy(e.snapshotDate)))}</td></tr>`).join('')}</tbody></table></div></div></details>` : '';
    return funnel + table + nr;
  }
  function finHTML(res) {
    const T = t(), r = res.r, v = r.values, F = S.ctx && S.ctx.finance;
    const ref = F && F.available ? (F.tracks || []).find((x) => x.id === F.reference) : null;
    const rate = val('ratePct') !== '' ? `${esc(T.rateUser)}: ${num(esc(val('ratePct') + '%'))} ${chip('USER_ASSUMPTION')}${ref && ref.value != null ? ` · ${chip('OFFICIAL')} ${num(esc(ref.value + '%'))} (${esc(ref.period)})` : ''}` : '';
    const kvs = `<div class="dl-kv">${kv(T.v.loan, cell(r, 'loan', nis), null, 'deal_loan', 'DERIVED')}${kv(T.v.ltvPct, cell(r, 'ltvPct', (x) => pct(x, 1)), null, 'deal_ltv_limit', 'DERIVED')}${kv(T.v.downPayment, cell(r, 'downPayment', nis), null, 'deal_loan', 'DERIVED')}
      ${kv(T.v.monthlyPayment, cell(r, 'monthlyPayment', (x) => nis(x, true)), rate, 'deal_monthly_payment', 'DERIVED')}${kv(T.v.totalInterest, cell(r, 'totalInterest', nis), null, 'deal_total_interest', 'DERIVED')}${kv(T.v.totalPaid, cell(r, 'totalPaid', nis), null, 'deal_total_interest', 'DERIVED')}
      ${kv(T.v.purchaseCosts, cell(r, 'purchaseCosts', nis), null, 'deal_purchase_costs', 'DERIVED')}${kv(T.v.totalCost, cell(r, 'totalCost', nis), null, 'deal_purchase_costs', 'DERIVED')}${kv(T.v.equity, cell(r, 'equity', nis), null, 'deal_equity', 'DERIVED')}</div>`;
    const A = r.amortization;
    const am = A ? `<details class="dl-sec dl-sub"><summary>${esc(T.amort)} ${xp('deal_amortization')}</summary><div class="dl-body"><div class="dl-wrap"><table class="dl-tbl"><thead><tr>${T.amortCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${A.byYear.map((y) => `<tr><td>${num(String(y.year))}</td><td>${num(esc(nis(y.payments)))}</td><td>${num(esc(nis(y.interest)))}</td><td>${num(esc(nis(y.principal)))}</td><td>${num(esc(nis(y.closing)))}</td></tr>`).join('')}</tbody></table></div></div></details>`
      : r.notApplicable.amortization ? `<p class="dl-note">${esc(T.na['no-loan'])} ${xm('no-loan')}</p>` : '';
    const inv = r.invalid && r.invalid.length ? `<p class="dl-note" role="alert">${esc(T.invalid(r.invalid.map((k) => T.inp[k] || T.f[k] || k).join(' · ')))}</p>` : '';
    return inv + kvs + am;
  }
  function cfHTML(res) {
    const T = t(), r = res.r, v = r.values, O = r.opex, fy = r.firstYear;
    const both = (a) => (a == null ? ['—', '—'] : [num(`<span class="${a < 0 ? 'neg' : ''}">${esc(nis(a / 12))}</span>`), num(`<span class="${a < 0 ? 'neg' : ''}">${esc(nis(a))}</span>`)]);
    const row = (label, annual, cls, missKey) => { const b = annual == null && missKey ? [naCell(r, missKey), ''] : both(annual); return `<tr class="${cls || ''}"><td class="w">${esc(label)}</td><td>${b[0]}</td><td>${b[1]}</td></tr>`; };
    const neg = (x) => (x == null ? null : -x);
    return `<div class="dl-wrap"><table class="dl-tbl"><thead><tr>${T.cfCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${row(T.cfRows.gross, v.grossRentAnnual, '', 'grossRentAnnual')}${row(T.cfRows.vac, neg(v.vacancyLoss), '', 'vacancyLoss')}${row(T.cfRows.egi, v.effectiveIncome, 'sub', 'effectiveIncome')}
      ${row(T.cfRows.maint, O ? -O.maintenance : null, '', 'opexAnnual')}${row(T.cfRows.mgmt, O ? -O.management : null)}${row(T.cfRows.ins, O ? -O.insurance : null)}${row(T.cfRows.oth, O ? -O.other : null)}
      ${row(T.cfRows.noi, v.noi, 'tot', 'noi')}${row(T.cfRows.ds, neg(v.annualDebtService), '', 'annualDebtService')}${fy ? row(T.cfRows.dsI, -fy.interest, 'sub') + row(T.cfRows.dsP, -fy.principal, 'sub') : ''}
      ${row(T.cfRows.cf, v.cashFlowAnnual, 'tot', 'cashFlowAnnual')}</tbody></table></div><p class="dl-note">${esc(T.cfNote)} ${xp('deal_cash_flow')} ${xp('deal_noi')}</p>`;
  }
  function retHTML(res) {
    const T = t(), r = res.r;
    return `<div class="dl-kv">${kv(T.v.grossYieldPct, cell(r, 'grossYieldPct', (x) => pct(x)), null, 'deal_gross_yield', 'DERIVED')}${kv(T.v.netYieldPct, cell(r, 'netYieldPct', (x) => pct(x)), null, 'deal_net_yield', 'DERIVED')}
      ${kv(T.v.cashOnCashPct, cell(r, 'cashOnCashPct', (x) => pct(x)), null, 'deal_cash_on_cash', 'DERIVED')}${kv(T.v.dscr, cell(r, 'dscr', x2), null, 'deal_dscr', 'DERIVED')}
      ${kv(T.v.cashFlowMonthly, cell(r, 'cashFlowMonthly', nis), null, 'deal_cash_flow', 'DERIVED')}${kv(T.v.noi, cell(r, 'noi', nis), esc(T.perYear), 'deal_noi', 'DERIVED')}
      ${kv(T.v.breakEvenRentMonthly, cell(r, 'breakEvenRentMonthly', nis), esc(T.perMonth), 'deal_break_even_rent', 'DERIVED')}${kv(T.v.breakEvenPrice, cell(r, 'breakEvenPrice', nis), val('targetCocPct') !== '' ? esc(`${T.f.targetCocPct}: ${val('targetCocPct')}%`) : null, 'deal_break_even_price', 'DERIVED')}</div>`;
  }
  function sensHTML(res) {
    const T = t(), s = res.sens;
    const fmt = (vv) => (vv ? [nis(vv.cashFlowMonthly), pct(vv.cashOnCashPct), x2(vv.dscr), pct(vv.netYieldPct)] : null);
    const tbl = (title, rows, unit) => `<div><h4>${esc(title)}</h4><div class="dl-wrap"><table class="dl-tbl"><thead><tr>${T.sensCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((x) => { const f = fmt(x.values); return `<tr><td class="${x.delta === 0 ? 'base' : ''}">${num(esc((x.delta > 0 ? '+' : '') + sgn(String(x.delta)) + unit))}</td>${f ? f.map((y) => `<td class="${x.delta === 0 ? 'base' : ''}">${y != null ? num(`<span class="${/^−|^-/.test(y) ? 'neg' : ''}">${esc(y)}</span>`) : '—'}</td>`).join('') : `<td colspan="4"><span class="dl-na">— <small>${esc(T.na[x.reason] || T.needs + ' ' + (T.inp[x.reason] || x.reason))} ${xm(x.reason)}</small></span></td>`}</tr>`; }).join('')}</tbody></table></div></div>`;
    const G = s.grid;
    const grid = G ? `<div><h4>${esc(T.grid)}</h4><div class="dl-wrap"><table class="dl-tbl"><thead><tr><th>${esc(T.gridRow)} \\ ${esc(T.gridCol)}</th>${G.cols.map((c) => `<th>${num(esc((c > 0 ? '+' : '') + sgn(String(c)) + ' pp'))}</th>`).join('')}</tr></thead><tbody>
      ${G.rows.map((rr, i) => `<tr><th>${num(esc((rr > 0 ? '+' : '') + sgn(String(rr)) + '%'))}</th>${G.cells[i].map((c, j) => `<td class="${rr === 0 && G.cols[j] === 0 ? 'base' : ''}">${c == null ? '—' : num(`<span class="${c < 0 ? 'neg' : ''}">${esc(nis(c))}</span>`)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>` : '';
    return `<div class="dl-sens">${tbl(T.sensRent, s.rent, '%')}${tbl(T.sensRate, s.rate, ' pp')}${tbl(T.sensPrice, s.price, '%')}${grid}</div><p class="dl-note">${esc(T.sensNote)}</p>`;
  }
  function scenHTML(res) {
    const T = t(), s = res.scen;
    const sh = (x) => (x ? Object.entries(x).filter(([, v]) => v != null).map(([k, v]) => `${T.shock[k]} ${(v > 0 ? '+' : '') + sgn(String(v))}${/Pp$/.test(k) ? ' pp' : '%'}`).join(' · ') : '');
    const row = (k) => { const x = s[k]; const vv = x.values;
      return `<tr><td>${esc(T.scenName[k])}</td><td class="w">${k === 'base' ? '—' : esc(sh(x.shocks)) || ''}</td>${vv ? [nis(vv.cashFlowMonthly), pct(vv.cashOnCashPct), x2(vv.dscr), pct(vv.netYieldPct)].map((y) => `<td>${y != null ? num(`<span class="${/^−|^-/.test(y) ? 'neg' : ''}">${esc(y)}</span>`) : '—'}</td>`).join('') : `<td colspan="4"><span class="dl-na">— <small>${esc(T.scenNone)} ${xm('no-shock-entered')}</small></span></td>`}</tr>`; };
    return `<div class="dl-wrap"><table class="dl-tbl"><thead><tr>${T.scenCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${row('base')}${row('downside')}${row('upside')}</tbody></table></div>`;
  }
  function flagText(f) {
    const T = t(), fn = T.flag[f.id];
    const buyer = T.opt.buyer[val('buyer')] || '';
    return fn ? fn({ ...f, lv: f.level ? lvName(f.level) : '', buyer }) : f.id;
  }
  /* a flag's value / threshold in its own unit (₪ · ₪/m² · % · pp · ×) — never a bare engine number */
  const FLAG_UNIT = { 'DL-ASK-ABOVE-P75': 'nis', 'DL-ASK-BELOW-P25': 'nis', 'DL-NEGATIVE-CASHFLOW': 'nis', 'DL-ASK-ABOVE-MODEL-RANGE': 'nis', 'DL-LTV-ABOVE-LIMIT': 'pct',
    'DL-CONCENTRATION': 'pct', 'DL-DSCR-BELOW-1': 'x', 'DL-DSCR-BELOW-1-2': 'x', 'DL-RATE-VS-OFFICIAL': 'pp', 'DL-COMPS-THIN': 'n' };
  function flagVal(f, v) {
    if (v == null) return '—';
    if (typeof v !== 'number') return String(v);
    const u = FLAG_UNIT[f.id];
    return u === 'nis' ? nis(v) : u === 'pct' ? pct(v, 1) : u === 'x' ? x2(v) : u === 'pp' ? (v > 0 ? '+' : '') + sgn(v.toFixed(2)) + ' pp' : sgn(String(v));
  }
  function riskHTML(res) {
    const T = t(), L = lang();
    const fl = res.flags.length ? `<ul class="dl-flags">${res.flags.map((f) => `<li><span class="dl-k ${f.kind}">${esc(T.kind[f.kind])}</span><span>${esc(flagText(f))}</span>
      <span class="m">${esc(T.value)}: ${num(esc(flagVal(f, f.value)))}${f.threshold != null ? ` · ${esc(T.threshold)}: ${num(esc(flagVal(f, f.threshold)))}` : ''} · ${esc(T.source)}: <bdi>${esc(f.source)}</bdi></span> ${chip(f.cls)} ${xs(f.id, { text: { he: flagText(f), en: flagText(f) }, valueLabel: flagVal(f, f.value), threshold: f.threshold != null ? flagVal(f, f.threshold) : null, source: f.source, cls: f.cls })}</li>`).join('')}</ul>`
      : `<p class="dl-note">${esc(T.noFlags)}</p>`;
    const SD = S.sdata;
    let street = '';
    if (S.sstatus === 'loading') street = `<p class="dl-note">${esc(T.streetLoading)}</p>`;
    else if (S.sstatus === 'error' || (SD && !SD.available)) street = `<p class="dl-note">${esc(T.streetErr)}</p>`;
    else if (SD) {
      const A = SD.assessment || { supports: [], against: [], couldChange: [], dueDiligence: [] };
      const li = (it) => `<li><span class="dl-tag">${esc(T.kinds[it.kind] || it.kind)}</span> ${esc(L === 'en' ? it.en : it.he)} ${it.cls ? chip(it.cls === 'SOURCE LABEL' ? 'OBSERVED' : it.cls) : ''}</li>`;
      const P = SD.planning && SD.planning.available ? SD.planning.summary : null;
      street = `<h4>${esc(T.streetH)} ${xp('street_report_assessment')}</h4><div class="dl-two"><div><h4>${esc(T.sup)}</h4><ul>${A.supports.map(li).join('') || '<li>—</li>'}</ul></div><div><h4>${esc(T.ag)}</h4><ul>${A.against.map(li).join('') || '<li>—</li>'}</ul></div>
        <div><h4>${esc(T.chg)}</h4><ul>${A.couldChange.map(li).join('') || '<li>—</li>'}</ul></div>
        <div><h4>${esc(T.dd)}</h4><ul class="dl-dd">${A.dueDiligence.map((d) => `<li><label><input type="checkbox" data-dldd="${esc(d.rule)}"${S.dd[d.rule] ? ' checked' : ''}> <span>${esc(L === 'en' ? d.en : d.he)}</span></label></li>`).join('')}</ul></div></div>
        ${P ? `<p class="dl-note">${esc(T.plans(P.intersects, P.pending, P.transit))} ${chip('OFFICIAL')} ${xp('street_report_relation')}</p>` : ''}`;
    }
    return `<h4>${esc(T.flagsH)} ${xp('deal_rules')}</h4>${fl}${street}`;
  }
  function sourcesRows() {
    const T = t(), D = S.data, L = lang(), out = [];
    if (S.street) out.push([L === 'en' ? 'Official street directory (Population and Immigration Authority)' : 'מרשם הרחובות הרשמי (רשות האוכלוסין וההגירה)', 'OFFICIAL', null, S.street.id]);
    if (D && D.comps && D.comps.source) out.push([D.comps.source.name, 'OBSERVED', D.comps.source.snapshotDate, `${D.comps.source.window.from} → ${D.comps.source.window.to}`]);
    if (D && D.freshness && D.freshness.available) out.push([L === 'en' ? 'PROPX transaction freshness monitor' : 'ניטור עדכניות העסקאות של PROPX', 'DERIVED', D.freshness.checkedAt, T.fState[D.freshness.state] || D.freshness.state]);
    if (D && D.model && D.model.available) out.push([L === 'en' ? 'PROPX Street Value Model' : 'מודל השווי לרחוב של PROPX', 'MODEL', D.model.asOf, `${D.model.modelVersion || ''} · ${D.model.tier || ''}`]);
    const F = (D && D.finance) || (S.ctx && S.ctx.finance);
    if (F && F.available) out.push([L === 'en' ? `${F.source.publisherEn} — ${F.source.datasetEn}` : `${F.source.publisher} — ${F.source.dataset}`, 'OFFICIAL', F.checkedAt, (F.tracks.find((x) => x.id === F.reference) || {}).period || '']);
    if (S.sdata && S.sdata.available) out.push([L === 'en' ? 'PROPX street report (assessment, planning, transport, surroundings)' : 'דוח הרחוב של PROPX (הערכה, תכנון, תחבורה, סביבה)', 'DERIVED', S.sdata.generatedAt, S.sdata.engine]);
    out.push([L === 'en' ? 'Your inputs (this browser)' : 'הקלטים שלכם (בדפדפן זה)', 'USER_ASSUMPTION', new Date().toISOString(), 'propx:deallab:v1']);
    return out;
  }
  function srcHTML() {
    const T = t();
    return `<div class="dl-wrap"><table class="dl-tbl"><thead><tr>${T.srcCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${sourcesRows().map(([n, c, d, note]) => `<tr><td class="w">${esc(n)}</td><td>${chip(c)}</td><td>${num(esc(dmy(d)))}</td><td class="w"><bdi>${esc(note || '')}</bdi></td></tr>`).join('')}</tbody></table></div>
      <p class="dl-note">${esc(T.disclaimer)}</p>`;
  }
  function renderResults() {
    const box = document.getElementById('dlRes');
    if (!box) return;
    const T = t();
    if (S.status === 'loading' && !S.data) { box.innerHTML = `<p class="dl-note">${esc(T.loading)}</p>`; return; }
    if (S.status === 'error') { box.innerHTML = `<p class="dl-note" role="alert">${esc(S.err || T.err)} <button type="button" class="chip" data-dlact="analyse">${esc(T.retry)}</button></p>`; if (!ENG) return; }
    const res = S.result || (ENG ? (S.result = compute()) : null);
    if (!res) { box.innerHTML = S.status === 'error' ? box.innerHTML : `<p class="dl-note">${esc(T.loading)}</p>`; return; }
    const keepOpen = {};
    box.querySelectorAll('details.dl-sec[id]').forEach((d) => { keepOpen[d.id] = d.open; });
    box.innerHTML = (S.status === 'error' ? `<p class="dl-note" role="alert">${esc(S.err || T.err)} <button type="button" class="chip" data-dlact="analyse">${esc(T.retry)}</button></p>` : '')
      + details('price', T.r.price, priceHTML(res), 'deal_comps_percentile')
      + details('comps', T.r.comps, compsHTML(), 'deal_comparables')
      + details('fin', T.r.fin, finHTML(res), 'deal_monthly_payment')
      + details('cf', T.r.cf, cfHTML(res), 'deal_cash_flow')
      + details('ret', T.r.ret, retHTML(res), 'deal_cash_on_cash')
      + details('sens', T.r.sens, sensHTML(res), 'deal_sensitivity')
      + details('scen', T.r.scen, scenHTML(res), 'deal_scenarios')
      + details('risk', T.r.risk, riskHTML(res), 'deal_rules')
      + details('src', T.r.src, srcHTML(), null, false);
    box.querySelectorAll('details.dl-sec[id]').forEach((d) => { if (d.id in keepOpen) d.open = keepOpen[d.id]; });
  }

  /* ───────────────────────── data ───────────────────────── */
  function labParams() {
    const p = new URLSearchParams({ view: 'dealLab', id: S.street.id });
    const put = (k, v, ok) => { if (v !== '' && v != null && ok(Number(v))) p.set(k, String(v).trim()); };
    put('sqm', val('sqm'), (x) => x >= 15 && x <= 1000);
    put('rooms', val('rooms'), (x) => x >= 1 && x <= 15 && Math.abs(x * 2 - Math.round(x * 2)) < 1e-9);
    put('built', val('built'), (x) => Number.isInteger(x) && x >= 1800 && x <= 2100);
    put('ask', val('price'), (x) => x >= 1 && x <= 1e10);
    put('sizeTol', val('sizeTol'), (x) => x >= 0 && x <= 100);
    put('roomsTol', val('roomsTol'), (x) => x >= 0 && x <= 5 && Math.abs(x * 2 - Math.round(x * 2)) < 1e-9);
    put('months', val('months'), (x) => Number.isInteger(x) && x >= 1 && x <= 36);
    put('min', val('minComps'), (x) => Number.isInteger(x) && x >= 1 && x <= 50);
    if (val('newness')) p.set('newness', val('newness'));
    if (val('type')) p.set('type', val('type'));
    p.set('limit', '300');
    return p.toString();
  }
  async function load() {
    if (!S.street) { S.result = ENG ? compute() : null; renderResults(); return; }
    const id = ++S.req;
    S.status = 'loading'; S.err = null; status(t().loading); renderResults();
    try {
      await engine();
      const d = await getJSON(labParams());
      if (id !== S.req) return;
      S.data = d; S.status = 'ok';
      const C = d.comps, T = t();
      status(C && C.available ? `${d.identity.name} · ${C.street ? `${T.level.STREET}: n=${C.street.n} (${T.state[C.street.state]})` : ''}` : d.identity.name);
    } catch (e) {
      if (id !== S.req) return;
      S.status = 'error';
      S.err = e.status === 400 && e.body && e.body.param ? t().paramErr(e.body.param, e.body.rule) : e.status === 404 ? t().err : t().err;
    }
    S.result = ENG ? compute() : null;
    renderResults();
  }
  async function loadStreet() {
    if (!S.street) return;
    const id = ++S.sreq, sid = S.street.id;
    S.sstatus = 'loading'; S.sdata = null;
    try { const d = await getJSON('view=dealStreet&id=' + encodeURIComponent(sid)); if (id !== S.sreq) return; S.sdata = d; S.sstatus = 'ok'; }
    catch (e) { if (id !== S.sreq) return; S.sstatus = 'error'; }
    S.result = ENG ? compute() : null;
    renderResults();
  }
  async function loadContext() {
    try { S.ctx = await getJSON('view=dealContext'); } catch (e) { S.ctx = null; }
    const F = S.ctx && S.ctx.filter;
    /* the similarity filter's stated starting values (size ±25 %, rooms ±1, 36 months, the minimum) — visible and editable in the form */
    if (F) { if (S.inputs.sizeTol === '') S.inputs.sizeTol = String(F.sizeTolPct); if (S.inputs.roomsTol === '') S.inputs.roomsTol = String(F.roomsTol); if (S.inputs.months === '') S.inputs.months = String(F.months); if (S.inputs.minComps === '') S.inputs.minComps = String(F.minComps); }
    renderForm(); renderResults();
  }
  function setStreet(g, from) {
    if (!g || !/^st:\d{1,5}:\d{1,5}$/.test(String(g.id || ''))) return;
    S.street = { id: g.id, name: g.he || g.name || '', city: g.city || '', cityEn: g.cityEn || null, cityCode: g.cityCode, streetCode: g.streetCode, district: g.district || null, lat: g.lat, lng: g.lng };
    S.streetFrom = from || null; S.data = null; S.sdata = null; S.result = null; S.showAll = false; S.dd = {};
    renderCur();
    /* a street opened elsewhere on the page is read only once the section comes near the screen (the page's own lazy rule) */
    if (from === 'page' && !S.near) { S.deferred = true; S.result = ENG ? compute() : null; renderResults(); return; }
    S.deferred = false; load(); loadStreet();
  }

  /* ───────────────────────── street picker (the page's own search API) ───────────────────────── */
  let qTimer = null, qSeq = 0, qList = [], qActive = -1;
  function listRender(inp, items, msg) {
    const ul = document.getElementById('dl-list'); if (!ul) return;
    qList = items; qActive = -1;
    if (!items.length && !msg) { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); return; }
    ul.innerHTML = items.length ? items.map((g, i) => `<li role="option" id="dl-opt-${i}" aria-selected="false" data-dlopt="${i}"><span>${esc(g.he)}</span><small>${esc(cityOf(g))}</small></li>`).join('') : `<li role="option" aria-disabled="true">${esc(msg)}</li>`;
    ul.hidden = false; inp.setAttribute('aria-expanded', 'true');
  }
  function closeList() { const inp = document.getElementById('dl-q'); if (inp) listRender(inp, [], null); }
  async function search(inp) {
    const q = inp.value.trim(), T = t();
    if (q.length < 2) { listRender(inp, [], q.length ? T.srchMin : null); return; }
    const seq = ++qSeq;
    const near = S.street ? String(S.street.cityCode || '') : '';
    const url = '/api/geo/search?limit=12&q=' + encodeURIComponent(q) + (near ? '&near=' + encodeURIComponent(near) : '');
    let R;
    try { R = typeof srchFetch === 'function' ? await srchFetch(url, (d) => Array.isArray(d.matches)) : { data: await (await fetch(url, { credentials: 'same-origin' })).json() }; }
    catch (e) { R = { err: { kind: 'network' } }; }
    if (seq !== qSeq) return;
    if (R.err) { listRender(inp, [], T.srchErr(R.err.kind)); return; }
    const items = ((R.data && R.data.matches) || []).filter((g) => g.kind === 'street').slice(0, 10);
    listRender(inp, items, items.length ? null : T.srchNone);
  }
  function choose(i) { const g = qList[i]; if (!g) return; closeList(); setStreet(g, null); const inp = document.getElementById('dl-q'); if (inp) inp.value = ''; }

  /* ───────────────────────── saved deals · memo ───────────────────────── */
  function dealName() {
    const s = S.street, p = val('price');
    return [s ? `${s.name} · ${s.city}` : '—', p ? nis(Number(p)) : null, new Date().toISOString().slice(0, 16).replace('T', ' ')].filter(Boolean).join(' · ');
  }
  function save() {
    const st = store.read();
    const deal = { id: 'd' + Date.now().toString(36), name: dealName(), savedAt: new Date().toISOString(), street: S.street, inputs: { ...S.inputs }, prov: { ...S.prov }, dd: { ...S.dd } };
    st.deals = [deal].concat(st.deals.filter((d) => d.id !== deal.id)).slice(0, 50);
    S.msg = store.write(st) ? t().savedOk : t().storageOff;
    renderActs(); const b = root.querySelector('[data-dlact="save"]'); if (b) b.focus();
  }
  function loadSaved(id) {
    const d = store.read().deals.find((x) => x.id === id); if (!d) return;
    S.inputs = { ...blankInputs(), ...d.inputs }; S.prov = d.prov || {}; S.msg = null;
    renderForm(); renderActs();
    if (d.street) { setStreet({ ...d.street, he: d.street.name }, null); S.dd = d.dd || {}; }
    else { S.result = ENG ? compute() : null; renderResults(); }
  }
  function delSaved(id) { const st = store.read(); st.deals = st.deals.filter((x) => x.id !== id); store.write(st); S.msg = null; renderActs(); }

  const INPUT_GROUPS = [['property', ['sqm', 'rooms', 'built', 'newness', 'type', 'floor']], ['price', ['price', 'buyer', 'tax', 'legal', 'broker', 'renovation', 'other']],
    ['finance', ['mode', 'downPayment', 'ltvPct', 'ratePct', 'years']], ['rent', ['rent', 'vacancyPct', 'maintenance', 'managementPct', 'insurance', 'otherOpex']],
    ['comps', ['sizeTol', 'roomsTol', 'months', 'minComps']], ['targets', ['targetCocPct', 'dRent', 'dVac', 'dRate', 'dOpex', 'uRent', 'uVac', 'uRate', 'uOpex']]];
  function memoHTML(forFile) {
    const T = t(), L = lang(), res = S.result || (ENG ? compute() : null);
    const X = XPX(), cl = (c) => (c === 'STATIC' ? (L === 'en' ? 'STATIC' : 'סטטי') : X && X.classLabel ? X.classLabel(c, L) : c);
    /* every input as the reader reads it: ₪ amounts formatted, a signed shock with its sign, a choice by its label (numbers isolated) */
    const MONEY = new Set(['price', 'tax', 'legal', 'broker', 'renovation', 'other', 'downPayment', 'rent', 'maintenance', 'insurance', 'otherOpex']);
    const shownVal = (k) => { const v = S.inputs[k]; if (v === '' || v == null) return '—'; const o = T.opt[k]; if (o && typeof o === 'object' && o[v] != null) return esc(o[v]);
      const n = Number(v); if (!Number.isFinite(n)) return esc(String(v));
      return num(esc(MONEY.has(k) ? nis(n) : /^[du]/.test(k) && k !== 'downPayment' ? (n > 0 ? '+' : '') + sgn(String(n)) : String(n))); };
    const unused = (k) => (k === 'downPayment' && S.inputs.mode !== 'down') || (k === 'ltvPct' && S.inputs.mode !== 'ltv') || ((k === 'ratePct' || k === 'years') && S.inputs.mode === 'cash');
    const fLabel = (k) => (k === 'mode' ? T.f.mode : /^d[A-Z]/.test(k) ? `${T.downside} · ${T.f[k]}` : /^u[A-Z]/.test(k) ? `${T.upside} · ${T.f[k]}` : T.f[k] || k);
    const inRows = INPUT_GROUPS.map(([g, ks]) => `<tr><th colspan="3">${esc(T.g[g])}</th></tr>` + ks.map((k) => `<tr><td>${esc(fLabel(k))}</td><td>${shownVal(k)}</td><td>${esc(unused(k) ? T.unusedMode : S.inputs[k] === '' ? cl('MISSING') : S.prov[k] === 'table' ? cl('DERIVED') + ' · ' + cl('STATIC') : cl('USER_ASSUMPTION'))}</td></tr>`).join('')).join('');
    const strip = (h) => String(h).replace(/<button[^>]*data-dlsort[^>]*>(.*?)<\/button>/g, '$1').replace(/<button[^>]*>.*?<\/button>/g, '').replace(/<details[^>]*>|<\/details>/g, '').replace(/<summary[^>]*>(.*?)<\/summary>/g, '<p><b>$1</b></p>')
      .replace(/<input[^>]*type="checkbox"[^>]*>/g, (m) => (/ checked/.test(m) ? '☑' : '☐')).replace(/<input[^>]*>/g, '');
    const out = res ? [[T.r.price, priceHTML(res)], [T.r.comps, compsMemo()], [T.r.fin, finHTML(res)], [T.r.cf, cfHTML(res)], [T.r.ret, retHTML(res)], [T.r.sens, sensHTML(res)], [T.r.scen, scenHTML(res)], [T.r.risk, riskHTML(res)], [T.r.src, srcHTML()]] : [];
    const s = S.street;
    const body = `<h1>${esc(T.memoT)} — ${esc(s ? `${s.name}, ${cityOf(s)}` : '—')}</h1><p>${esc(T.memoGen(new Date().toISOString().slice(0, 16).replace('T', ' ')))}${s ? ` · <bdi>${esc(s.id)}</bdi>` : ''}</p>
      <p style="font-weight:700;border-inline-start:3px solid #a4791c;padding:4px 8px">${esc(T.disclaimer)}</p>
      <h2>${esc(T.memoIn)}</h2><table><thead><tr><th>${esc(T.memoField)}</th><th>${esc(T.memoVal)}</th><th>${esc(T.memoCls)}</th></tr></thead><tbody>${inRows}</tbody></table>
      ${out.map(([h, b]) => `<h2>${esc(h)}</h2>${strip(b)}`).join('')}`;
    if (!forFile) return body;
    return `<!doctype html><html lang="${L}" dir="${L === 'en' ? 'ltr' : 'rtl'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PROPX — ${esc(T.memoT)}</title>
      <style>body{font-family:Assistant,Heebo,system-ui,sans-serif;color:#101b30;background:#fff;max-width:1000px;margin:24px auto;padding:0 16px;font-size:13px;line-height:1.5}table{width:100%;border-collapse:collapse;margin:4px 0 12px}th,td{border-bottom:1px solid #d4dbe8;padding:4px 6px;text-align:start;vertical-align:top}
      h1{font-size:20px}h2{font-size:15px;margin-top:20px;border-bottom:2px solid #101b30;padding-bottom:2px}.num{direction:ltr;unicode-bidi:isolate}.vc{font-size:10px;font-weight:800;border:1px solid currentColor;border-radius:99px;padding:0 5px;margin:0 2px}.neg{color:#d13438}
      .dl-cards,.dl-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}.dl-card,.dl-kv>div{border:1px solid #d4dbe8;border-radius:8px;padding:6px 8px;display:flex;flex-direction:column}.dl-card .v,.dl-kv .v{font-size:16px;font-weight:800}
      .dl-na small,.dl-note,.s{color:#43536f;font-size:11.5px}.dl-tag,.dl-lv,.dl-k{font-size:10px;border:1px solid #c2cddf;border-radius:99px;padding:0 5px}svg{max-width:100%;height:auto}.dl-strip{max-width:640px}svg text{font-size:11px;fill:#43536f}
      :root{--accent:#2563eb;--brass:#a4791c;--ink:#101b30;--hairline:#e3e8f1}ul{padding-inline-start:18px}</style></head><body>${body}</body></html>`;
  }
  function compsMemo() {
    const T = t(), C = S.data && S.data.comps;
    if (!C || !C.available) return compsHTML();
    const saveAll = S.showAll; S.showAll = true; const h = compsHTML(); S.showAll = saveAll; return h;
  }
  function printMemo() {
    if (!S.street) { S.msg = t().memoNoStreet; renderActs(); return; }
    let box = document.getElementById('dlPrint');
    if (!box) { box = document.createElement('div'); box.id = 'dlPrint'; document.body.appendChild(box); }
    box.setAttribute('dir', lang() === 'en' ? 'ltr' : 'rtl'); box.setAttribute('lang', lang());
    box.innerHTML = memoHTML(false);
    document.body.classList.add('dl-printing');
    const done = () => { document.body.classList.remove('dl-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { try { window.print(); } finally { setTimeout(done, 600); } }, 50);
  }
  function downloadMemo() {
    if (!S.street) { S.msg = t().memoNoStreet; renderActs(); return; }
    const html = memoHTML(true);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    a.download = `propx-deal-memo-${S.street.id.replace(/[^0-9]+/g, '-').replace(/^-|-$/g, '')}-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ───────────────────────── actions ───────────────────────── */
  function fillTax() {
    const T = t(), price = Number(val('price')), buyer = val('buyer');
    let table = null; try { table = typeof NH_TAX !== 'undefined' ? NH_TAX : null; } catch (e) { table = null; }
    if (!table) { S.taxNote = T.taxNoTable; renderForm(); return; }
    const kind = buyer === 'additional' ? 'additional' : buyer === 'single' || buyer === 'replacement' ? 'single' : null;
    if (!kind || !(price > 0) || !ENG) { S.taxNote = T.taxNeedBuyer; renderForm(); return; }
    const x = ENG.bracketTax(price, table[kind]);
    if (!x) { S.taxNote = T.taxNeedBuyer; renderForm(); return; }
    S.inputs.tax = String(Math.round(x.tax)); S.prov.tax = 'table';
    S.taxNote = T.taxFilled(dmy(table.checked), table.directive || table.source);
    renderForm(); recompute(true);
  }
  function recompute(fetchToo) {
    S.result = ENG ? compute() : null; renderResults();
    if (fetchToo && S.street) { clearTimeout(recompute.t); recompute.t = setTimeout(load, 500); }
  }
  const FETCH_KEYS = new Set(['sqm', 'rooms', 'built', 'newness', 'type', 'price', 'sizeTol', 'roomsTol', 'months', 'minComps']);
  root.addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.dl;
    if (k) {
      S.inputs[k] = e.target.value;
      if (k === 'tax' && S.prov.tax === 'table') { S.prov.tax = 'usr'; S.taxNote = null; }
      const n = e.target.type === 'number' ? e.target.value : null;
      if (n != null) e.target.setAttribute('aria-invalid', String(n !== '' && !Number.isFinite(Number(n))));
      clearTimeout(root._t); root._t = setTimeout(() => recompute(FETCH_KEYS.has(k)), 150);
      return;
    }
    if (e.target.id === 'dl-q') { clearTimeout(qTimer); const inp = e.target; qTimer = setTimeout(() => search(inp), 180); }
  });
  root.addEventListener('change', (e) => {
    const k = e.target.dataset && e.target.dataset.dl;
    if (k && (e.target.tagName === 'SELECT' || e.target.type === 'radio')) { S.inputs[k] = e.target.value; if (k === 'mode') renderForm(); recompute(FETCH_KEYS.has(k)); }
    if (e.target.dataset && e.target.dataset.dldd) S.dd[e.target.dataset.dldd] = e.target.checked;
  });
  root.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  root.addEventListener('keydown', (e) => {
    if (e.target.id !== 'dl-q') return;
    const ul = document.getElementById('dl-list');
    if (e.key === 'Escape') { closeList(); return; }
    if (!qList.length || !ul || ul.hidden) { if (e.key === 'Enter') e.preventDefault(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      qActive = (qActive + (e.key === 'ArrowDown' ? 1 : -1) + qList.length) % qList.length;
      ul.querySelectorAll('[role=option]').forEach((li, i) => li.setAttribute('aria-selected', String(i === qActive)));
      e.target.setAttribute('aria-activedescendant', 'dl-opt-' + qActive);
      const li = document.getElementById('dl-opt-' + qActive); if (li) li.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); choose(qActive >= 0 ? qActive : 0); }
  });
  root.addEventListener('click', (e) => {
    const o = e.target.closest('[data-dlopt]'); if (o) { choose(Number(o.dataset.dlopt)); return; }
    const s = e.target.closest('[data-dlsort]');
    if (s) { const k = s.dataset.dlsort, PT = window.PropxTable, type = (SORTS[k] || SORTS.date)[1];
      S.sort = PT && PT.nextSort ? PT.nextSort(S.sort, k, type, { key: 'date', dir: 'desc' }) : { key: k, dir: S.sort.key === k && S.sort.dir === 'desc' ? 'asc' : 'desc' };
      renderResults(); const b = root.querySelector(`[data-dlsort="${k}"]`); if (b) b.focus(); return; }
    const a = e.target.closest('[data-dlact]'); if (!a) return;
    const act = a.dataset.dlact;
    if (act === 'analyse') load();
    else if (act === 'save') save();
    else if (act === 'load') { const sel = document.getElementById('dl-saved'); if (sel) loadSaved(sel.value); }
    else if (act === 'delete') { const sel = document.getElementById('dl-saved'); if (sel) delSaved(sel.value); }
    else if (act === 'print') printMemo();
    else if (act === 'download') downloadMemo();
    else if (act === 'tax') fillTax();
    else if (act === 'showAll') { S.showAll = !S.showAll; renderResults(); }
    else if (act === 'report' && S.street && typeof openGeoView === 'function') { openGeoView({ kind: 'street', id: S.street.id, he: S.street.name, city: S.street.city, cityEn: S.street.cityEn, cityCode: S.street.cityCode, streetCode: S.street.streetCode, district: S.street.district, lat: S.street.lat, lng: S.street.lng }); const gv = document.getElementById('geoView'); if (gv) gv.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (act === 'zeroCosts' || act === 'zeroOpex') {
      for (const k of act === 'zeroCosts' ? ['tax', 'legal', 'broker', 'renovation', 'other'] : ['vacancyPct', 'maintenance', 'managementPct', 'insurance', 'otherOpex']) if (S.inputs[k] === '') S.inputs[k] = '0';
      renderForm(); recompute(false);
    } else if (act === 'stress') {
      /* an EXAMPLE the user asked for — visible and editable, still the user's assumption */
      const ex = { dRent: '-10', dVac: '5', dRate: '1', dOpex: '10', uRent: '5', uVac: '-2', uRate: '-0.5', uOpex: '0' };
      for (const [k, v] of Object.entries(ex)) if (S.inputs[k] === '') S.inputs[k] = v;
      renderForm(); recompute(false);
    }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.dl-pick')) closeList(); });

  /* the street report's valuation section: "Analyse this deal in the Deal Lab" (index.html srHTML → data-srdeal) */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-srdeal]'); if (!b) return;
    e.preventDefault();
    const sr = b.closest('.sr'), f = sr ? sr.querySelector('[data-srprop]') : null;
    const fd = f ? new FormData(f) : null, g = (k) => (fd && fd.get(k) != null ? String(fd.get(k)).trim() : '');
    open({ id: b.dataset.srdeal, name: b.dataset.srdealName || '', city: b.dataset.srdealCity || '', askingPrice: g('askingPrice'), sqm: g('sqm'), rooms: g('rooms'), built: g('built'), newness: g('newness'), type: g('type'), rentMonthly: g('rentMonthly') });
  });

  /* ───────────────────────── the page's events + the public hook ───────────────────────── */
  document.addEventListener('propx:lang', () => { render(); });
  document.addEventListener('propx:geo', (e) => {
    const g = e.detail;
    if (g && g.kind === 'street' && /^st:\d{1,5}:\d{1,5}$/.test(String(g.id || '')) && (!S.street || S.street.id !== g.id)) setStreet(g, 'page');
  });
  /** open the lab on a street, prefilled with what the caller passes (nothing else is filled) */
  async function open(p) {
    if (!p || !/^st:\d{1,5}:\d{1,5}$/.test(String(p.id || ''))) return;
    const map = { askingPrice: 'price', sqm: 'sqm', rooms: 'rooms', built: 'built', newness: 'newness', type: 'type', rentMonthly: 'rent' };
    for (const [from, to] of Object.entries(map)) if (p[from] != null && String(p[from]) !== '') S.inputs[to] = String(p[from]);
    renderForm();
    let g = { id: p.id, he: p.name || '', city: p.city || '' };
    if (!p.name) { try { const d = await getJSON('view=dealLab&id=' + encodeURIComponent(p.id)); g = { id: d.identity.id, he: d.identity.name, city: d.identity.city, cityEn: d.identity.cityEn, cityCode: d.identity.cityCode, streetCode: d.identity.streetCode, district: d.identity.district }; } catch (e) { /* the lab shows its error */ } }
    setStreet(g, 'report');
    const sec = document.getElementById('dealLab'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.PropxDealLab = Object.freeze({ open });

  /* first paint: the shell at once; the official context, then the engine (lazy) */
  S.near = !('IntersectionObserver' in window);
  if (!S.near) {
    const io = new IntersectionObserver((es) => { if (!es.some((x) => x.isIntersecting)) return; S.near = true; io.disconnect(); if (S.deferred && S.street) { S.deferred = false; load(); loadStreet(); } }, { rootMargin: '600px 0px' });
    io.observe(document.getElementById('dealLab') || root);
  }
  render();
  loadContext();
  engine().then(() => { S.result = compute(); renderResults(); }).catch(() => { /* the results say the engine is loading */ });
}());
