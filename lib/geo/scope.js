/* PROPX · GEOGRAPHIC SCOPE (22.10.2026) — the one definition of the geographic hierarchy and of what every intelligence module can
 * say at every level. Pure data + pure functions, UMD: the page loads it as /lib/geo/scope.js (window.PropxScope, inlined in the
 * offline build) and the server read model (lib/geo/scope-read.js) requires it.
 *
 *   Israel → District → Subdistrict (נפה) → Locality → Verified neighbourhood | CBS statistical area → Street → (building / parcel —
 *   evidence inside the street report) → (property — the Deal Lab, the user's own assumptions)
 *
 * Ids are the official keys the read models already use: `il`, `d-<district>` / `js-area`, `napa:<CBS subdistrict code>`,
 * `loc:<CBS locality code>`, `nb:<verified neighbourhood id>`, `sa:<locality>:<statistical area>` (census 2022 rows only), `st:<locality>:<street>`.
 * A level PROPX holds no source for is never constructed: no subdistrict / neighbourhood / statistical-area BOUNDARY is ingested, a
 * statistical area has no address key, a street is never placed in a neighbourhood or a statistical area (its parent is its locality).
 *
 * MODULES × LEVELS: every module states, per level, one mode —
 *   EXACT          the geography's own figures / records (an exact key)
 *   AGGREGATED     combined from this geography's own child records, each counted once, coverage stated (DERIVED)
 *   CONTEXT        the nearest wider geography the source covers — labelled with that geography, never this one's figure
 *   NOT_AVAILABLE  no source PROPX reads holds it at this level (the reason is stated)
 *   NOT_APPLICABLE the module is not about a geography at this level
 * The matrix documents; it never computes a value.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PropxScope = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA = 'propx-scope-v1';

  /* the seven CBS districts — the same keys and names as lib/dossier/query.js DISTRICTS (test/geo-scope.test.js holds them equal) */
  var DISTRICTS = {
    'd-jm': { he: 'מחוז ירושלים', en: 'Jerusalem district', cbs: 'd-jm' },
    'd-north': { he: 'מחוז הצפון', en: 'Northern district', cbs: 'd-north' },
    'd-haifa': { he: 'מחוז חיפה', en: 'Haifa district', cbs: 'd-haifa' },
    'd-center': { he: 'מחוז המרכז', en: 'Central district', cbs: 'd-center' },
    'd-ta': { he: 'מחוז תל אביב', en: 'Tel Aviv district', cbs: 'd-ta' },
    'd-south': { he: 'מחוז הדרום', en: 'Southern district', cbs: 'd-south' },
    'js-area': { he: 'יהודה ושומרון', en: 'Judea and Samaria Area', cbs: 'jsr' },
  };
  var DISTRICT_ORDER = ['d-jm', 'd-north', 'd-haifa', 'd-center', 'd-ta', 'd-south', 'js-area'];

  /* the subdistrict's Hebrew name is the official directory's (Population and Immigration Authority, region_name); the English
     name below is a translation of that name for the English page — never a source value */
  var NAPA_EN = {
    11: 'Jerusalem', 21: 'Zefat', 22: 'Kinneret', 23: 'Afula', 24: 'Akko', 25: 'Nazareth', 29: 'Golan', 31: 'Haifa', 32: 'Hadera',
    41: 'HaSharon', 42: 'Petah Tikva', 43: 'Ramla', 44: 'Rehovot', 51: 'Tel Aviv', 52: 'Ramat Gan', 53: 'Holon', 61: 'Ashkelon',
    62: "Be'er Sheva", 71: 'Jenin', 72: 'Shechem (Nablus)', 73: 'Tulkarm', 74: 'Ramallah', 75: 'Jordan (Jericho)', 76: 'Bethlehem', 77: 'Hebron',
  };
  /* the directory prints the bracket pair reversed for one name ("ירדן )יריחו("): shown normalized, the raw value kept */
  function napaName(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var m = /^(.*?)\s*\)([^()]+)\(\s*$/.exec(s);
    return m ? (m[1] + ' (' + m[2] + ')').trim() : s;
  }

  var LEVELS = [
    { id: 'country', he: 'ארץ', en: 'Country', navigable: true },
    { id: 'district', he: 'מחוז', en: 'District', navigable: true },
    { id: 'subdistrict', he: 'נפה', en: 'Subdistrict', navigable: true },
    { id: 'locality', he: 'יישוב', en: 'Locality', navigable: true },
    { id: 'neighbourhood', he: 'שכונה מאומתת', en: 'Verified neighbourhood', navigable: true, sibling: 'statArea' },
    { id: 'statArea', he: 'אזור סטטיסטי (למ״ס)', en: 'CBS statistical area', navigable: true, sibling: 'neighbourhood' },
    { id: 'street', he: 'רחוב', en: 'Street', navigable: true },
    { id: 'address', he: 'בניין / כתובת / חלקה', en: 'Building / address / parcel', navigable: false,
      where: { he: 'ראיות בתוך דוח הרחוב (סינון לפי בניין / גוש-חלקה)', en: 'evidence inside the street report (building / block-parcel filters)' } },
    { id: 'property', he: 'נכס', en: 'Property', navigable: false,
      where: { he: 'מעבדת העסקה — על הנחות המשתמש בלבד', en: 'the Deal Lab — on the user\'s own assumptions only' } },
  ];
  var LEVEL_IDS = LEVELS.map(function (l) { return l.id; });
  function levelOf(id) { for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i]; return null; }

  var ID_RE = /^(il|d-(?:jm|north|haifa|center|ta|south)|js-area|napa:\d{1,2}|loc:\d{1,5}|sa:\d{1,5}:\d{1,5}|nb:[a-z0-9-]{1,48}|st:\d{1,5}:\d{1,5})$/;
  /** an id → { id, level, … keys } or null (never guessed) */
  function parse(raw) {
    var id = String(raw == null ? '' : raw).trim();
    if (!ID_RE.test(id)) return null;
    if (id === 'il') return { id: id, level: 'country' };
    if (DISTRICTS[id]) return { id: id, level: 'district', district: id };
    var m;
    if ((m = /^napa:(\d+)$/.exec(id))) return { id: id, level: 'subdistrict', napa: Number(m[1]) };
    if ((m = /^loc:(\d+)$/.exec(id))) return { id: id, level: 'locality', locality: Number(m[1]) };
    if ((m = /^sa:(\d+):(\d+)$/.exec(id))) return { id: id, level: 'statArea', locality: Number(m[1]), statArea: Number(m[2]) };
    if ((m = /^st:(\d+):(\d+)$/.exec(id))) return { id: id, level: 'street', locality: Number(m[1]), street: Number(m[2]) };
    if (/^nb:/.test(id)) return { id: id, level: 'neighbourhood' };
    return null;
  }
  /** the parent of a RESOLVED scope (its chain) — one level up; Israel has none */
  function up(scope) { var c = scope && scope.chain; return c && c.length > 1 ? c[c.length - 2].id : null; }

  var MODES = {
    EXACT: { he: 'מדויק', en: 'EXACT', simple: { he: 'הנתונים של הגאוגרפיה הזאת עצמה', en: 'this geography\'s own figures' } },
    AGGREGATED: { he: 'מצרפי', en: 'AGGREGATED', simple: { he: 'סכום / צירוף של רשומות התת-יחידות שלה, כל אחת פעם אחת; הכיסוי מוצג', en: 'combined from its own child records, each once; coverage stated' } },
    CONTEXT: { he: 'הקשר', en: 'CONTEXT', simple: { he: 'הגאוגרפיה הרחבה הקרובה שהמקור מכסה — מסומנת בשמה, לעולם לא נתון של הגאוגרפיה שנבחרה', en: 'the nearest wider geography the source covers — labelled with its name, never this geography\'s figure' } },
    NOT_AVAILABLE: { he: 'לא זמין', en: 'NOT AVAILABLE', simple: { he: 'אין מקור ש-PROPX קוראת שמחזיק את זה ברמה הזאת', en: 'no source PROPX reads holds it at this level' } },
    NOT_APPLICABLE: { he: 'לא רלוונטי', en: 'NOT APPLICABLE', simple: { he: 'המודול אינו עוסק בגאוגרפיה ברמה הזאת', en: 'the module is not about a geography at this level' } },
  };

  /* cell = [mode, context level | null, he, en] */
  function C(mode, ctx, he, en) { return { mode: mode, context: ctx || null, he: he, en: en }; }
  var NO_SA_KEY = ['אין מפתח כתובת → אזור סטטיסטי ואין גבולות אזורים סטטיסטיים', 'no address → statistical-area key and no statistical-area boundary is held'];
  var MODULES = [
    { id: 'overview', section: 'overview', he: 'סקירה מנהלית', en: 'Executive overview', levels: {
      country: C('EXACT', null, 'לוח ארצי (נתוני למ״ס רשמיים תחילה, הערכות PROPX מסומנות) + התיק הארצי + האטלס', 'national board (official CBS figures first, PROPX estimates labelled) + the national dossier + the atlas'),
      district: C('EXACT', null, 'תיק המחוז + האטלס; כרטיסי הלוח לשישה מחוזות (ליהודה ושומרון אין כרטיס לוח)', 'the district dossier + the atlas; board cards for six districts (Judea and Samaria has no board card)'),
      subdistrict: C('AGGREGATED', null, 'האטלס: יישובי הנפה, אוכלוסיית מפקד 2022 (סכום היישובים שבטבלה) ואירועי עסקה רשומים; תיק השוק מציג את המחוז (הקשר)', 'the atlas: its localities, census 2022 population (sum over the listed localities) and recorded transaction events; the dossier shows its district (context)'),
      locality: C('EXACT', null, 'תיק היישוב (כל יישוב רשמי) + האטלס; כרטיס לוח מותאם רק ל-40 הערים המכוסות', 'the locality dossier (any official locality) + the atlas; a curated board card only for the 40 covered cities'),
      neighbourhood: C('CONTEXT', 'locality', 'אין תיק שכונה: תיק היישוב, מסומן; "מה השתנה כאן" קורא את הרחובות המקושרים לשכונה', 'no neighbourhood dossier: the locality\'s, labelled; What Changed Here reads the neighbourhood\'s linked streets'),
      statArea: C('CONTEXT', 'locality', 'רק נתוני המפקד הם של האזור עצמו (דמוגרפיה); השאר — היישוב, מסומן', 'only the census figures are the area\'s own (demographics); the rest is the locality, labelled'),
      street: C('EXACT', null, 'דוח הרחוב: הרחוב הרשמי, שוק נצפה, מודל, תוכניות וסיכונים', 'the street report: official street, observed market, model, plans, risks') } },
    { id: 'transactions', section: 'txSection', he: 'עסקאות', en: 'Transactions', levels: {
      country: C('EXACT', null, 'כל אירועי העסקה מכל המקורות, החדש ראשון; ספירת התקופה המדויקת מהתיעוד היומי השמור', 'every source\'s events, newest first; the period\'s exact count from the stored per-day tally'),
      district: C('EXACT', null, 'אותו דבר על יישובי המחוז', 'the same over the district\'s localities'),
      subdistrict: C('AGGREGATED', null, 'ספירות ותאריכים אחרונים מצורפים מיישובי הנפה (כל יישוב פעם אחת); הרשימה עצמה — לכל יישוב, או המחוז (הקשר)', 'counts and latest dates combined over its localities (each once); the list itself per locality, or the district (context)'),
      locality: C('EXACT', null, 'הקריאה המאוחדת של היישוב', 'the locality\'s unified read'),
      neighbourhood: C('CONTEXT', 'locality', 'עסקאות מפתחות ביישוב / רחוב / חלקה, לעולם לא בגבול שכונה: רשימת היישוב, מסומנת', 'transactions are keyed to a locality / street / parcel, never to a neighbourhood boundary: the locality\'s list, labelled'),
      statArea: C('NOT_AVAILABLE', null, NO_SA_KEY[0], NO_SA_KEY[1]),
      street: C('EXACT', null, 'אירועי הרחוב (+ סינון בניין / חלקה בתוך דוח הרחוב)', 'the street\'s events (+ building / parcel filters inside the street report)') } },
    { id: 'prices', section: 'prices', he: 'מחירים ושווי', en: 'Prices & valuation', levels: {
      country: C('EXACT', null, 'ממוצע כלל הדירות של למ״ס, לוח 2.2 (רשמי) + הערכת PROPX לדירה חדשה (מודל)', 'CBS Table 2.2 all-dwellings average (OFFICIAL) + the PROPX new-home estimate (MODEL)'),
      district: C('EXACT', null, 'שורת המחוז עצמו בלוח 2.2 + הערכת PROPX (שישה מחוזות); ליהודה ושומרון אין שורה', 'the district\'s own Table 2.2 row + the PROPX estimate (six districts); Judea and Samaria has no row'),
      subdistrict: C('CONTEXT', 'district', 'למ״ס אינה מפרסמת ממוצע לנפה — המחוז, מסומן', 'CBS publishes no subdistrict average — the district, labelled'),
      locality: C('EXACT', null, 'שורת העיר עצמה בלוח 2.2 כשלמ״ס מפרסמת אותה (18 ערים), אחרת "—" עם הסיבה; לעולם לא שורת המחוז', 'the city\'s own Table 2.2 row where CBS lists it (18 cities), else “—” with the reason; never the district\'s row'),
      neighbourhood: C('CONTEXT', 'locality', 'מחירי שכונה מותאמים הם מודל; נתוני שכונה מאומתת מופיעים כהקשר במודיעין הרחוב', 'curated neighbourhood prices are MODEL; verified-neighbourhood figures appear as context in Street Intelligence'),
      statArea: C('NOT_AVAILABLE', null, NO_SA_KEY[0], NO_SA_KEY[1]),
      street: C('EXACT', null, 'עסקאות נצפות מהמרשם (מבוסס / מוגבל / לא מספיק / אין) לצד אומדן מודל הרחוב (מודל)', 'observed register deals (SUPPORTED / LIMITED / INSUFFICIENT / NONE) beside the Street Value Model estimate (MODEL)') } },
    { id: 'trends', section: 'prices', he: 'מגמות', en: 'Trends', levels: {
      country: C('EXACT', null, 'מדד מחירי הדירות החדשות וסדרת המכירות הרשמית של למ״ס', 'the CBS new-homes price index and the official sales series'),
      district: C('EXACT', null, 'סדרת המכירות ומדד מחירי הדירות של המחוז (למ״ס)', 'the district\'s CBS sales series and dwellings price index'),
      subdistrict: C('CONTEXT', 'district', 'למ״ס מפרסמת סדרות ארציות ומחוזיות בלבד', 'CBS publishes national and district series only'),
      locality: C('CONTEXT', 'district', 'סדרות למ״ס ארציות ומחוזיות בלבד — בתיק: "רמת מחוז, לא נתון היישוב"', 'CBS series are national and district only — the dossier labels them “district level, not the locality\'s figure”'),
      neighbourhood: C('CONTEXT', 'district', 'כמו ביישוב', 'as for the locality'),
      statArea: C('NOT_AVAILABLE', null, NO_SA_KEY[0], NO_SA_KEY[1]),
      street: C('EXACT', null, 'שינוי 12 חודשים ב-₪/מ״ר של הרחוב — רק עם 30 + 30 עסקאות ורווח סמך של 95%', 'the street\'s 12-month ₪/m² change — only with 30 + 30 deals and a 95 % interval') } },
    { id: 'supply', section: 'dossier', he: 'בנייה והיצע', en: 'Construction & supply', levels: {
      country: C('EXACT', null, 'היתרים · התחלות · גמר · בנייה פעילה (למ״ס) + יקומי צנרת ההיצע, לעולם לא מסוכמים', 'CBS permits · starts · completions · active construction + the supply-pipeline universes, never summed'),
      district: C('EXACT', null, 'אותו דבר ברמת המחוז', 'the same at district level'),
      subdistrict: C('CONTEXT', 'district', 'אין סדרת בנייה לנפה', 'no construction series for a subdistrict'),
      locality: C('EXACT', null, 'יקומי הצנרת של היישוב (מכרזי רמ״י, הגרלות, התחדשות, השכרה); בנייה של למ״ס — המחוז כהקשר', 'the locality\'s pipeline universes (ILA tenders, lotteries, renewal, rental); CBS construction as district context'),
      neighbourhood: C('CONTEXT', 'locality', 'היקום אינו ממופה לשכונה', 'the universes are not keyed to a neighbourhood'),
      statArea: C('NOT_AVAILABLE', null, NO_SA_KEY[0], NO_SA_KEY[1]),
      street: C('NOT_AVAILABLE', null, 'אין מקור בנייה שממופה לרחוב (תוכניות — ראו תכנון)', 'no construction source is keyed to a street (plans: see planning)') } },
    { id: 'planning', section: 'intel', he: 'תכנון, היתרים והתחדשות', en: 'Planning, permits & renewal', levels: {
      country: C('EXACT', null, 'מתחמי התחדשות עירונית (משב״ש) + צירוף מדויק ל-XPlan; מכרזי רמ״י עם מספרי תוכנית מדויקים', 'MoCH urban-renewal complexes + their exact XPlan join; ILA tenders with exact plan numbers'),
      district: C('AGGREGATED', null, 'על יישובי המחוז (תיק המחוז)', 'over the district\'s localities (the district dossier)'),
      subdistrict: C('CONTEXT', 'district', 'לא מחושב לנפה', 'not computed for a subdistrict'),
      locality: C('EXACT', null, 'מתחמי ההתחדשות והמכרזים של היישוב (קוד יישוב מדויק)', 'the locality\'s renewal complexes and tenders (exact locality code)'),
      neighbourhood: C('CONTEXT', 'locality', 'לא ממופה לשכונה', 'not keyed to a neighbourhood'),
      statArea: C('NOT_AVAILABLE', null, NO_SA_KEY[0], NO_SA_KEY[1]),
      street: C('EXACT', null, 'גבולות תוכניות החוצים / הסמוכים לרחוב (הקשר מרחבי) + היתרי תל אביב-יפו לפי כתובת מדויקת', 'plan boundaries intersecting / near the street (spatial context) + Tel Aviv-Yafo permits by exact address') } },
    { id: 'transport', section: null, he: 'תשתיות ותחבורה', en: 'Infrastructure & transport', levels: {
      country: C('NOT_AVAILABLE', null, 'תחבורה נקראת סביב רחוב; לא נבנה סיכום ארצי', 'transport is read around a street; no national aggregate is built'),
      district: C('NOT_AVAILABLE', null, 'לא נבנה סיכום מחוזי', 'no district aggregate is built'),
      subdistrict: C('NOT_AVAILABLE', null, 'לא נבנה סיכום לנפה', 'no subdistrict aggregate is built'),
      locality: C('NOT_AVAILABLE', null, 'לא נבנה סיכום ליישוב — פתחו רחוב', 'no locality aggregate is built — open a street'),
      neighbourhood: C('NOT_AVAILABLE', null, 'לא נבנה סיכום לשכונה', 'no neighbourhood aggregate is built'),
      statArea: C('NOT_AVAILABLE', null, NO_SA_KEY[0], NO_SA_KEY[1]),
      street: C('EXACT', null, 'תחנות אוטובוס / רכבת קלה ליד הרחוב (מאגר התחנות, החודש שלו); תוכנית תחבורה סטטוטורית — תוכנית, לא קו פעיל', 'bus / light-rail stops near the street (the stop registry, its own month); a statutory transit plan is a plan, never an operating line') } },
    { id: 'demographics', section: 'dossier', he: 'דמוגרפיה', en: 'Demographics', levels: {
      country: C('EXACT', null, 'שורת מפקד 2022 הארצית (תצפית אחת, לעולם לא "עדכני")', 'the census 2022 national row (one observation, never current)'),
      district: C('AGGREGATED', null, 'אוכלוסיית מפקד 2022 בסכום היישובים שבטבלת המפקד (הכיסוי מוצג)', 'census 2022 population summed over the localities the census table lists (coverage stated)'),
      subdistrict: C('AGGREGATED', null, 'כמו במחוז', 'as for the district'),
      locality: C('EXACT', null, 'מפקד 2022 + התושבים הרשומים (שני יקומים, לעולם לא מעורבבים)', 'census 2022 + the registered residents (two universes, never mixed)'),
      neighbourhood: C('CONTEXT', 'locality', 'אין מפתח שכונה ↔ אזור סטטיסטי', 'no neighbourhood ↔ statistical-area key'),
      statArea: C('EXACT', null, 'נתוני מפקד 2022 של האזור הסטטיסטי', 'the statistical area\'s census 2022 figures'),
      street: C('CONTEXT', 'locality', 'נתון יישוב לעולם אינו נתון של רחוב', 'a locality figure is never a street\'s') } },
    { id: 'risks', section: 'pulse', he: 'סיכונים והזדמנויות', en: 'Risks & opportunities', levels: {
      country: C('EXACT', null, 'סריקת הזדמנויות / סיכונים (כללים, לעולם לא המלצה)', 'the opportunity / risk scan (rules, never a recommendation)'),
      district: C('EXACT', null, 'אותה סריקה ברמת המחוז', 'the same scan at district level'),
      subdistrict: C('CONTEXT', 'district', 'הסריקה אינה רצה לנפה', 'the scan does not run for a subdistrict'),
      locality: C('EXACT', null, 'יישובים עם מכרז חי; לאחרים — אין אות / אין מספיק נתונים, עם הסיבה', 'localities with a live tender; others NO SIGNAL / INSUFFICIENT DATA with the reason'),
      neighbourhood: C('CONTEXT', 'locality', 'הסריקה אינה רצה לשכונה', 'the scan does not run for a neighbourhood'),
      statArea: C('NOT_AVAILABLE', null, NO_SA_KEY[0], NO_SA_KEY[1]),
      street: C('EXACT', null, 'כללי ההערכה של דוח הרחוב (SA-* / DD-*) — ללא ציון', 'the street report\'s assessment rules (SA-* / DD-*) — no score') } },
    { id: 'changes', section: 'changes', he: 'מה השתנה כאן', en: 'What Changed Here', levels: {
      country: C('EXACT', null, 'פיד השינויים הארצי', 'the national change feed'),
      district: C('EXACT', null, 'פיד המחוז', 'the district feed'),
      subdistrict: C('CONTEXT', 'district', 'הפיד אינו נבנה לנפה', 'the feed is not built for a subdistrict'),
      locality: C('EXACT', null, 'פיד היישוב', 'the locality feed'),
      neighbourhood: C('EXACT', null, 'הרחובות המקושרים לשכונה המאומתת', 'the verified neighbourhood\'s linked streets'),
      statArea: C('NOT_AVAILABLE', null, NO_SA_KEY[0], NO_SA_KEY[1]),
      street: C('EXACT', null, 'פיד הרחוב (+ סביב הרחוב, עם מרחק)', 'the street feed (+ near the street, with the distance)') } },
    { id: 'dealLab', section: 'dealLab', he: 'מעבדת עסקה', en: 'Deal Lab', levels: {
      country: C('NOT_APPLICABLE', null, 'רכישה מתוכננת אחת ברחוב רשמי אחד', 'one contemplated purchase on one official street'),
      district: C('NOT_APPLICABLE', null, 'רכישה מתוכננת אחת ברחוב רשמי אחד', 'one contemplated purchase on one official street'),
      subdistrict: C('NOT_APPLICABLE', null, 'רכישה מתוכננת אחת ברחוב רשמי אחד', 'one contemplated purchase on one official street'),
      locality: C('NOT_APPLICABLE', null, 'בחרו רחוב ביישוב', 'pick a street in the locality'),
      neighbourhood: C('NOT_APPLICABLE', null, 'בחרו רחוב', 'pick a street'),
      statArea: C('NOT_APPLICABLE', null, 'בחרו רחוב', 'pick a street'),
      street: C('EXACT', null, 'הרחוב שנבחר — עם ההנחות שלכם בלבד', 'the selected street — on your own assumptions only') } },
    { id: 'map', section: 'map', he: 'מפות', en: 'Maps', levels: {
      country: C('EXACT', null, 'גבולות המחוזות (Natural Earth, גאומטריה בלבד)', 'district boundaries (Natural Earth, geometry only)'),
      district: C('EXACT', null, 'גבול המחוז (שישה מחוזות; ליהודה ושומרון לא נקלט גבול)', 'the district\'s boundary (six districts; no boundary is held for Judea and Samaria)'),
      subdistrict: C('NOT_AVAILABLE', null, 'לא נקלט גבול נפה רשמי — רק נקודות היישובים', 'no official subdistrict boundary is held — its localities\' points only'),
      locality: C('EXACT', null, 'נקודת היישוב (כשיש קואורדינטות במרשם); אין גבול שיפוט', 'the locality point (where the registry has coordinates); no municipal boundary'),
      neighbourhood: C('NOT_AVAILABLE', null, 'לא נקלט גבול שכונה', 'no neighbourhood boundary is held'),
      statArea: C('NOT_AVAILABLE', null, 'לא נקלט גבול אזור סטטיסטי', 'no statistical-area boundary is held'),
      street: C('EXACT', null, 'הנקודות של הרחוב עצמו (קובץ שכבת GovMap)', 'the street\'s own points (the GovMap-layer file)') } },
    { id: 'sources', section: 'sources', he: 'מקורות ועדכניות', en: 'Sources & freshness', levels: {
      country: C('EXACT', null, 'כל מקור עם תאריכיו ומצב בדיקתו (מרכז האמון); כל מודול מציג את עדכניותו', 'every source with its dates and check state (Trust Center); every module states its own freshness'),
      district: C('EXACT', null, 'כנ״ל', 'as above'), subdistrict: C('EXACT', null, 'כנ״ל', 'as above'), locality: C('EXACT', null, 'כנ״ל', 'as above'),
      neighbourhood: C('EXACT', null, 'כנ״ל', 'as above'), statArea: C('EXACT', null, 'כנ״ל', 'as above'), street: C('EXACT', null, 'כנ״ל', 'as above') } },
  ];
  var NAV_LEVELS = ['country', 'district', 'subdistrict', 'locality', 'neighbourhood', 'statArea', 'street'];

  function capability(moduleId, level) {
    for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === moduleId) return MODULES[i].levels[level] || null;
    return null;
  }
  /** the module rows of one level: { id, section, he, en, mode, context, basis:{he,en} } */
  function matrix(level) {
    if (NAV_LEVELS.indexOf(level) < 0) return [];
    return MODULES.map(function (m) { var c = m.levels[level]; return { id: m.id, section: m.section, he: m.he, en: m.en, mode: c.mode, context: c.context, basis: { he: c.he, en: c.en } }; });
  }
  /** per level: how many modules are EXACT / AGGREGATED / CONTEXT / NOT_AVAILABLE / NOT_APPLICABLE */
  function coverageSummary() {
    var out = {};
    NAV_LEVELS.forEach(function (lv) { var t = { EXACT: 0, AGGREGATED: 0, CONTEXT: 0, NOT_AVAILABLE: 0, NOT_APPLICABLE: 0 }; MODULES.forEach(function (m) { t[m.levels[lv].mode]++; }); out[lv] = t; });
    return out;
  }
  /** the chain item of a resolved scope at a given level, or null (the nearest valid context a CONTEXT cell names) */
  function contextOf(scope, level) {
    var c = (scope && scope.chain) || [];
    for (var i = c.length - 1; i >= 0; i--) if (c[i].level === level) return c[i];
    return null;
  }

  return { SCHEMA: SCHEMA, DISTRICTS: DISTRICTS, DISTRICT_ORDER: DISTRICT_ORDER, NAPA_EN: NAPA_EN, napaName: napaName, LEVELS: LEVELS, LEVEL_IDS: LEVEL_IDS,
    NAV_LEVELS: NAV_LEVELS, levelOf: levelOf, ID_RE: ID_RE, parse: parse, up: up, MODES: MODES, MODULES: MODULES, capability: capability, matrix: matrix,
    coverageSummary: coverageSummary, contextOf: contextOf };
}));
