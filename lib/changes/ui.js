/* PROPX · What Changed Here? — the page module (21.10.2026). Mounts into #chRoot (live build only; loaded after the main script).
   Reads GET /api/intel?view=changes|changesMeta (lib/changes). Follows the page's language ("propx:lang"), the geography opened from
   search ("propx:geo"), the board's own selection (country · district · city · verified neighbourhood) and the "What changed here?"
   links of the street report and the dossier ([data-chgeo]); it has its own geography search (/api/geo/search) and district list.
   Every item shows its event date, the date PROPX saw it, its verb, its source with the copy date, its scope and its class; every
   kind shows its coverage and a statement that never confuses "no change" with "not covered" or "source stale". Nothing here
   computes a figure — the read model does; this file renders. */
(function () {
  'use strict';
  var root = document.getElementById('chRoot');
  if (!root) return;

  /* ───────────── styles (one <style>, the page's tokens) ───────────── */
  var CSS = [
    '#changes .ch-card{padding:0}',
    '#changes .ch-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px 18px;margin-bottom:12px}',
    '#changes .ch-head h2{font-size:16.5px;font-weight:700;display:flex;align-items:center;gap:9px;letter-spacing:-.01em}',
    '#changes .ch-head h2::before{content:"";flex:none;width:4px;height:15px;border-radius:2px;background:var(--navy)}',
    '#changes .ch-geo-name{color:var(--brass)}',
    '#changes .ch-how{font-size:12px;color:var(--ink-2);margin-top:4px;line-height:1.5;max-width:860px}',
    '#changes .ch-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:11px 15px;border-bottom:1px solid var(--hairline)}',
    '#changes .ch-bar .lbl{font-size:10.5px;font-weight:800;letter-spacing:.06em;color:var(--ink-3);text-transform:uppercase}',
    '#changes .ch-chips{display:flex;flex-wrap:wrap;gap:5px}',
    '#changes .ch-chips .chip{padding:3px 10px;border-radius:99px;background:var(--panel);line-height:1.5}',
    '#changes .ch-chips .chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--paper)}',
    '#changes .ch-chips .chip .n{font-variant-numeric:tabular-nums;opacity:.75;margin-inline-start:4px}',
    '#changes .ch-search{position:relative;min-width:230px;flex:1 1 260px;max-width:420px}',
    '#changes .ch-search input{width:100%;font-size:13px;padding:7px 11px;border:1px solid var(--hairline);border-radius:8px;background:var(--paper);color:var(--ink)}',
    '#changes .ch-search input:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 3px var(--accent-wash)}',
    '#changes .ch-list{position:absolute;inset-inline:0;top:calc(100% + 4px);z-index:30;background:var(--panel);border:1px solid var(--edge);border-radius:10px;box-shadow:var(--shadow-pop);max-height:320px;overflow:auto;padding:4px;list-style:none}',
    '#changes .ch-list li{padding:7px 9px;border-radius:7px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:8px}',
    '#changes .ch-list li small{color:var(--ink-3);font-size:11.5px}',
    '#changes .ch-list li[aria-selected="true"],#changes .ch-list li:hover{background:var(--panel-2)}',
    '#changes .ch-list .ch-err{color:var(--down);cursor:default}',
    '#changes .ch-sel{font:inherit;font-size:12.5px;font-weight:600;color:var(--ink-2);background:var(--paper);border:1px solid var(--hairline);border-radius:8px;padding:6px 9px;max-width:100%}',
    '#changes .ch-cur{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12.5px}',
    '#changes .ch-cur b{font-size:13.5px}',
    '#changes .ch-anchor{font-size:12px;color:var(--ink-2);padding:9px 15px;border-bottom:1px solid var(--hairline);background:var(--tint);line-height:1.55}',
    '#changes .ch-sum{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;padding:12px 15px;border-bottom:1px solid var(--hairline)}',
    '#changes .ch-tile{border:1px solid var(--hairline);border-radius:10px;padding:8px 10px;background:var(--panel);text-align:start;display:flex;flex-direction:column;gap:2px;min-height:64px}',
    '#changes .ch-tile:hover{border-color:var(--baseline)}',
    '#changes .ch-tile[aria-pressed="true"]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}',
    '#changes .ch-tile .k{font-size:11px;font-weight:700;color:var(--ink-2)}',
    '#changes .ch-tile .v{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.2}',
    '#changes .ch-tile .s{font-size:10.5px;color:var(--ink-3);line-height:1.35}',
    '#changes .ch-tile .v.na{color:var(--ink-3);font-size:15px}',
    '#changes .ch-newsum{display:flex;flex-wrap:wrap;gap:6px 16px;padding:8px 15px;border-bottom:1px solid var(--hairline);font-size:12.5px}',
    '#changes .ch-newsum b{font-variant-numeric:tabular-nums}',
    '#changes .ch-tl{padding:4px 15px 10px}',
    '#changes .ch-mo{font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--brass);text-transform:uppercase;padding:12px 0 4px;border-bottom:1px solid var(--hairline);display:flex;gap:8px;align-items:baseline}',
    '#changes .ch-mo small{color:var(--ink-3);font-weight:700;letter-spacing:0;text-transform:none}',
    '#changes .ch-it{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:4px 12px;padding:9px 0;border-bottom:1px solid var(--hairline);align-items:start;list-style:none}',
    '#changes ol{margin:0;padding:0}',
    '#changes .ch-it.m3 .ch-t{font-weight:800} #changes .ch-it.m1 .ch-t{font-weight:600;color:var(--ink-2)}',
    '#changes .ch-date{display:flex;flex-direction:column;gap:1px;font-variant-numeric:tabular-nums}',
    '#changes .ch-date b{font-size:12.5px} #changes .ch-date small{font-size:10px;color:var(--ink-3);line-height:1.25}',
    '#changes .ch-t{font-size:13px;line-height:1.45;overflow-wrap:anywhere}',
    '#changes .ch-x{font-size:12px;color:var(--ink-2);line-height:1.45;margin-top:2px;overflow-wrap:anywhere}',
    '#changes .ch-meta{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font-size:11px;color:var(--ink-3);margin-top:4px;line-height:1.4}',
    '#changes .ch-meta .ch-seen b{color:var(--ink-2);font-variant-numeric:tabular-nums}',
    '#changes .ch-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:3px}',
    '#changes .ch-nw{display:inline-block;font-size:10px;font-weight:800;border-radius:4px;padding:1px 6px;border:1px solid var(--hairline);color:var(--ink-2)}',
    '#changes .ch-nw.n-NEW_EVENT{color:var(--up);border-color:var(--up)} #changes .ch-nw.n-NEWLY_OBSERVED_OLDER_EVENT{color:var(--brass);border-color:var(--brass);border-style:dashed}',
    '#changes .ch-nw.n-REVISION{color:var(--conf-med);border-color:var(--conf-med)} #changes .ch-nw.n-STATE_CHANGE{color:var(--accent-deep);border-color:var(--accent-deep)}',
    '#changes .ch-sc{display:inline-block;font-size:10px;font-weight:700;border-radius:99px;padding:0 7px;border:1px solid var(--hairline);color:var(--ink-2)}',
    '#changes .ch-sc.s-EXACT_STREET{border-color:var(--up);color:var(--up)} #changes .ch-sc.s-NEAR_STREET{border-color:var(--accent);color:var(--accent-deep)}',
    '#changes .ch-sc.s-DISTRICT_CONTEXT,#changes .ch-sc.s-NATIONAL_CONTEXT{border-style:dashed;color:var(--ink-3)}',
    '#changes .ch-poss{color:var(--conf-med);font-weight:700}',
    '#changes .ch-a{display:flex;flex-direction:column;align-items:flex-end;gap:4px}',
    '#changes .ch-go{font-size:11.5px;font-weight:700;color:var(--accent-deep);border:1px solid var(--hairline);border-radius:7px;padding:3px 9px;background:var(--panel);text-decoration:none;white-space:nowrap}',
    '#changes .ch-go:hover{border-color:var(--accent)}',
    '#changes .ch-lay{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.03em;border:1px dashed var(--brass);color:var(--brass);border-radius:4px;padding:0 5px}',
    '#changes .ch-kids{grid-column:1/-1;border-inline-start:3px solid var(--wash-brass);padding-inline-start:10px;margin-top:4px}',
    '#changes .ch-more{display:flex;justify-content:center;padding:10px 0 4px}',
    '#changes .ch-empty{padding:16px 15px;font-size:13px;color:var(--ink-2);line-height:1.6}',
    '#changes .ch-empty ul{margin:6px 0 0;padding-inline-start:18px}',
    '#changes .ch-cov{border-top:1px solid var(--hairline)}',
    '#changes .ch-cov>summary{cursor:pointer;padding:11px 15px;font-size:13px;font-weight:700;list-style-position:inside}',
    '#changes .ch-covl{display:grid;gap:0;padding:0 15px 12px}',
    '#changes .ch-cr{display:grid;grid-template-columns:150px 150px minmax(0,1fr);gap:4px 12px;padding:8px 0;border-bottom:1px solid var(--hairline);font-size:12px;align-items:start}',
    '#changes .ch-cr .ch-k{font-weight:700}',
    '#changes .ch-st{display:inline-block;font-size:10px;font-weight:800;border-radius:4px;padding:1px 6px;border:1px solid var(--hairline)}',
    '#changes .ch-st.c-COVERED{color:var(--up);border-color:var(--up)} #changes .ch-st.c-STALE{color:var(--down);border-color:var(--down)}',
    '#changes .ch-st.c-SNAPSHOT_ONLY,#changes .ch-st.c-NOT_APPLICABLE,#changes .ch-st.c-NOT_IN_COVERAGE{color:var(--ink-3);border-style:dashed}',
    '#changes .ch-stm{display:inline-block;font-size:10px;font-weight:800;margin-top:3px}',
    '#changes .ch-stm.t-CHANGES{color:var(--ink-2)} #changes .ch-stm.t-NO_CHANGES_IN_PERIOD{color:var(--up)} #changes .ch-stm.t-NOT_COVERED{color:var(--ink-3)} #changes .ch-stm.t-SOURCE_STALE{color:var(--down)}',
    '#changes .ch-parts{margin:3px 0 0;padding:0;list-style:none;color:var(--ink-3);font-size:11px;line-height:1.45}',
    '#changes .ch-note{font-size:11.5px;color:var(--ink-3);padding:8px 15px 12px;line-height:1.5}',
    '#changes .ch-load{padding:18px 15px;font-size:13px;color:var(--ink-3)}',
    '#changes .ch-errbox{margin:12px 15px;padding:10px 12px;border:1px solid var(--down);background:var(--down-wash);border-radius:8px;font-size:12.5px}',
    '@media (max-width:720px){#changes .ch-it{grid-template-columns:minmax(0,1fr)}#changes .ch-date{flex-direction:row;gap:8px;align-items:baseline}#changes .ch-a{align-items:flex-start;flex-direction:row}',
    '#changes .ch-cr{grid-template-columns:minmax(0,1fr)}#changes .ch-sum{grid-template-columns:repeat(2,minmax(0,1fr))}#changes .ch-search{min-width:0;flex-basis:100%;max-width:none}#changes .ch-bar{padding:10px 12px}#changes .ch-tl{padding:4px 12px 10px}}',
  ].join('\n');
  if (!document.getElementById('chStyle')) { var st = document.createElement('style'); st.id = 'chStyle'; st.textContent = CSS; document.head.appendChild(st); }

  /* ───────────── words ───────────── */
  var W = {
    he: {
      lyr: 'L1 · שוק · מה השתנה כאן', title: 'מה השתנה כאן?', geoKind: { street: 'רחוב', neighbourhood: 'שכונה מאומתת', locality: 'יישוב', district: 'מחוז', il: 'ארצי' },
      how: 'לכל פריט שני תאריכים: <b>תאריך האירוע</b> — מתי זה קרה (עסקה, אבן דרך של תכנית, החלטה במכרז, פרסום) — ו<b>נצפה ב-PROPX</b> — מתי PROPX החזיקה את זה לראשונה. "ישן שנצפה לראשונה" = אירוע ישן שהגיע עכשיו בעותק חדש יותר.',
      search: 'חיפוש רחוב או יישוב', searchAria: 'חיפוש גאוגרפיה לפיד השינויים', il: 'ישראל — כל הארץ', districts: 'מחוזות', nb: 'שכונה מאומתת', nbNone: 'שכונה מאומתת…',
      follows: 'עוקב אחרי החיפוש והלוח', period: 'תקופה', days: function (n) { return n + ' יום'; }, kinds: 'סוג', all: 'הכול', newness: 'חדשות', scope: 'היקף',
      scopes: { street: 'ברחוב', near: 'ליד הרחוב', locality: 'הקשר היישוב', ctx: 'הקשר מחוזי / ארצי', inLoc: 'ביישוב', district: 'המחוז', national: 'ארצי' },
      anchor: function (a, b, n, src, at) { return 'התקופה: <b class="num">' + a + ' → ' + b + '</b> (' + n + ' יום), מסתיימת בתצפית החדשה ביותר של PROPX בנתונים — ' + src + ' ב-<span class="num">' + at + '</span>. לא "היום" כשהנתונים ישנים יותר.'; },
      newSum: { NEW_EVENT: 'אירועים חדשים', NEWLY_OBSERVED_OLDER_EVENT: 'ישנים שנצפו לראשונה', REVISION: 'תיקונים', STATE_CHANGE: 'שינויי מצב' },
      event: 'תאריך האירוע', seen: 'נצפה ב-PROPX', copy: 'עותק', basis: { SOURCE_UPDATE: 'לפי עדכון הרשומה במקור', OBSERVED: 'המקור לא נתן תאריך — תאריך הצפייה' },
      possible: 'אפשרי', layer: 'שכבה נפרדת — המחיר אינו בשימוש בסטטיסטיקה', conflict: 'סתירה בין מקורות',
      open: { street: 'דוח הרחוב', tender: 'המכרז', renewal: 'המתחם', permit: 'ההיתר', plan: 'התכנית במבא״ת', dossier: 'תיק השוק', revisions: 'יומן התיקונים', sources: 'מרכז האמון', housing: 'הגרלות', external: 'למקור', transactions: 'שינויי היישוב', changes: 'שינויי היישוב' },
      expand: 'הצגת העסקאות', collapse: 'הסתרה', more: 'עוד שינויים', loading: 'טוען את השינויים…', err: 'לא ניתן לטעון את פיד השינויים כעת.', retry: 'ניסיון חוזר',
      covT: 'כיסוי לפי סוג — מה PROPX יכולה לומר כאן', covState: 'כיסוי', statement: 'אמירה לתקופה', srcs: 'מקורות', since: 'היסטוריה מאז', checked: 'נבדק', copyD: 'עותק', through: 'הראיות עד',
      emptyAll: 'אין פריטים בבחירה הזאת. מה ש-PROPX יכולה לומר על כל סוג:', listing: function (l, e) { return 'מוצגים ' + l + ' מתוך ' + e + ' — הרשימה היא האירועים החדשים ביותר של האזור; הספירה מדויקת.'; },
      excluded: function (n) { return n + ' כפילויות אפשריות לא נספרו'; }, km: function (m) { return m < 1000 ? m + ' מ׳' : (m / 1000).toFixed(1) + ' ק״מ'; },
      rel: { ON_A_PARCEL_OF_THE_STREET: 'על חלקה של הרחוב', PARCEL_WITHIN_RADIUS: 'חלקה בטווח', PLAN_INCLUDES_A_PARCEL_OF_THE_STREET: 'גבול התכנית כולל חלקה ברחוב', PLAN_WITHIN_RADIUS: 'תכנית בטווח', AREA_WIDE_PLAN: 'תכנית כלל-אזורית', TRANSIT_PLAN_WITHIN_1000M: 'תכנית תחבורה עד 1 ק״מ', VATMAL_INCLUDES_A_PARCEL_OF_THE_STREET: 'ותמ״ל כולל חלקה ברחוב', VATMAL_WITHIN_RADIUS: 'ותמ״ל בטווח', NAMED_IN_THE_RECORD_ADDRESS: 'הכתובת ברשומה נוקבת ברחוב', IN_THE_STREET_LOCALITY: 'ביישוב של הרחוב', PLAN_LOCALITY_FIELD: 'לפי שדה היישוב של התכנית', JOINED_BY_TENDER_NUMBER: 'לפי מספר מכרז רמ״י' },
      match: { STREET_POSSIBLE: 'חלקה פינתית / כמה רחובות', STREET_VIA_PARCEL: 'דרך החלקה', STREET_VIA_PARCEL_POSSIBLE: 'דרך החלקה — אפשרי', STREET_PUBLISHED_ADDRESS: 'לפי הכתובת שפורסמה', STREET_REPUBLISHER_LINK: 'לפי קישור המפרסם' },
      linkHere: 'מה השתנה כאן?', back: 'ישראל', nolocated: 'הרחוב לא ממוקם בקובץ השכבה — יחס מרחבי לא חושב',
      monthNames: ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'], items: 'פריטים', events: 'אירועים',
      geoErr: { network: 'אין חיבור לרשת', auth: 'החיבור פג — יש להתחבר מחדש', server: 'שגיאת שרת', timeout: 'תם הזמן', index: 'מרשם הגאוגרפיה אינו זמין', invalid: 'תשובה לא תקינה', offline: 'החיפוש אינו זמין בעותק הלא מקוון' },
      stShort: { NO_CHANGES_IN_PERIOD: 'לא נמצאו שינויים — המקור מכסה את התקופה', NOT_COVERED: 'לא מכוסה', SOURCE_STALE: 'המקור לא עדכני — היעדר אינו ראיה' },
      noMatch: 'לא נמצא רחוב או יישוב בשם הזה', kindAll: 'כל הסוגים', perKindEmpty: 'אין פריט בסוג הזה בבחירה',
    },
    en: {
      lyr: 'L1 · Market · What changed here', title: 'What changed here?', geoKind: { street: 'street', neighbourhood: 'verified neighbourhood', locality: 'locality', district: 'district', il: 'national' },
      how: 'Every item has two dates: the <b>event date</b> — when it happened (a deal, a plan milestone, a tender decision, a publication) — and <b>seen by PROPX</b> — when PROPX first held it. "Older event, newly observed" = an old event that arrived now in a newer copy.',
      search: 'Search a street or locality', searchAria: 'Search a geography for the change feed', il: 'Israel — the whole country', districts: 'Districts', nb: 'Verified neighbourhood', nbNone: 'Verified neighbourhood…',
      follows: 'follows the search and the board', period: 'Period', days: function (n) { return n + ' days'; }, kinds: 'Kind', all: 'All', newness: 'Newness', scope: 'Scope',
      scopes: { street: 'On the street', near: 'Near the street', locality: 'Locality context', ctx: 'District / national context', inLoc: 'In the locality', district: 'The district', national: 'National' },
      anchor: function (a, b, n, src, at) { return 'Period: <b class="num">' + a + ' → ' + b + '</b> (' + n + ' days), ending at the newest PROPX observation in the data — ' + src + ' on <span class="num">' + at + '</span>. Never "today" when the data is older.'; },
      newSum: { NEW_EVENT: 'new events', NEWLY_OBSERVED_OLDER_EVENT: 'older, newly observed', REVISION: 'revisions', STATE_CHANGE: 'state changes' },
      event: 'event date', seen: 'seen by PROPX', copy: 'copy', basis: { SOURCE_UPDATE: 'by the source record\'s update', OBSERVED: 'no source date — the observation date' },
      possible: 'possible', layer: 'separate layer — price not used in statistics', conflict: 'source conflict',
      open: { street: 'Street report', tender: 'Tender', renewal: 'Complex', permit: 'Permit', plan: 'Plan on Mavat', dossier: 'Market dossier', revisions: 'Revision ledger', sources: 'Trust Center', housing: 'Lotteries', external: 'Source', transactions: 'Locality changes', changes: 'Locality changes' },
      expand: 'Show the deals', collapse: 'Hide', more: 'More changes', loading: 'Loading the changes…', err: 'The change feed could not be loaded right now.', retry: 'Retry',
      covT: 'Coverage by kind — what PROPX can say here', covState: 'Coverage', statement: 'Statement for the period', srcs: 'Sources', since: 'history since', checked: 'checked', copyD: 'copy', through: 'evidence through',
      emptyAll: 'No items in this selection. What PROPX can say for each kind:', listing: function (l, e) { return l + ' of ' + e + ' listed — the list is the area\'s newest events; the count is exact.'; },
      excluded: function (n) { return n + ' possible duplicates not counted'; }, km: function (m) { return m < 1000 ? m + ' m' : (m / 1000).toFixed(1) + ' km'; },
      rel: { ON_A_PARCEL_OF_THE_STREET: 'on a parcel of the street', PARCEL_WITHIN_RADIUS: 'a parcel within range', PLAN_INCLUDES_A_PARCEL_OF_THE_STREET: 'plan boundary includes a street parcel', PLAN_WITHIN_RADIUS: 'plan within range', AREA_WIDE_PLAN: 'area-wide plan', TRANSIT_PLAN_WITHIN_1000M: 'transit plan within 1 km', VATMAL_INCLUDES_A_PARCEL_OF_THE_STREET: 'VATMAL includes a street parcel', VATMAL_WITHIN_RADIUS: 'VATMAL within range', NAMED_IN_THE_RECORD_ADDRESS: 'the record\'s address names the street', IN_THE_STREET_LOCALITY: 'in the street\'s locality', PLAN_LOCALITY_FIELD: 'by the plan\'s locality field', JOINED_BY_TENDER_NUMBER: 'by the ILA tender number' },
      match: { STREET_POSSIBLE: 'corner / multi-street parcel', STREET_VIA_PARCEL: 'via the parcel', STREET_VIA_PARCEL_POSSIBLE: 'via the parcel — possible', STREET_PUBLISHED_ADDRESS: 'by the published address', STREET_REPUBLISHER_LINK: 'by the republisher\'s link' },
      linkHere: 'What changed here?', back: 'Israel', nolocated: 'the street is not located in the layer file — no spatial relation computed',
      monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], items: 'items', events: 'events',
      geoErr: { network: 'No network connection', auth: 'The session ended — sign in again', server: 'Server error', timeout: 'Timed out', index: 'The geography registry is unavailable', invalid: 'Invalid answer', offline: 'Search is unavailable in the offline copy' },
      stShort: { NO_CHANGES_IN_PERIOD: 'No changes found — the source covers the period', NOT_COVERED: 'Not covered', SOURCE_STALE: 'Source stale — absence is not evidence' },
      noMatch: 'No street or locality by that name', kindAll: 'All kinds', perKindEmpty: 'No item of this kind in the selection',
    },
  };
  var lang = function () { try { return (typeof state !== 'undefined' && state.lang === 'en') ? 'en' : 'he'; } catch (e) { return 'he'; } };
  var w = function () { return W[lang()]; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pick = function (v) { return v == null ? '' : typeof v === 'object' ? (v[lang()] != null ? v[lang()] : v.en) : String(v); };
  var dmy = function (d) { return d ? String(d).slice(0, 10).split('-').reverse().join('.') : '—'; };
  var fmt = function (n) { return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—'; };
  /* the page's own helpers (global bindings of the main script) — each guarded, so the module renders without them */
  var xp = function (id) { return typeof xpBtn === 'function' ? xpBtn(id) : ''; };
  var xpSigH = function (id, rt) { return typeof xpSig === 'function' ? xpSig(id, rt) : ''; };
  var xpMissH = function (id) { return typeof xpMiss === 'function' ? xpMiss(id) : ''; };
  var clsChip = function (c) { return typeof xpClsChip === 'function' ? xpClsChip(c) : '<span class="vc">' + esc(c) + '</span>'; };
  var vocab = function (list, id) { if (!ST.meta || !ST.meta.vocabulary) return id; var x = (ST.meta.vocabulary[list] || []).find(function (v) { return v.id === id; }); return x ? pick(x.label) : id; };
  var VERB = { he: { NEW: 'חדש', ADVANCED: 'התקדם', CHANGED: 'השתנה', REVISED: 'תוקן', STALE: 'ישן', RECOVERED: 'התאושש', CONFLICT: 'סתירה' }, en: { NEW: 'NEW', ADVANCED: 'ADVANCED', CHANGED: 'CHANGED', REVISED: 'REVISED', STALE: 'STALE', RECOVERED: 'RECOVERED', CONFLICT: 'CONFLICT' } };
  var verbLabel = function (v) { return (VERB[lang()] || VERB.en)[v] || v || ''; };

  /* ───────────── state ───────────── */
  var KINDS = ['TRANSACTION', 'PLANNING', 'LAND_TENDER', 'URBAN_RENEWAL', 'HOUSING', 'RENTAL', 'CONSTRUCTION', 'SALES', 'SOURCE_REVISION', 'SOURCE_STATE'];
  var NEWNESS = ['NEW_EVENT', 'NEWLY_OBSERVED_OLDER_EVENT', 'REVISION', 'STATE_CHANGE'];
  var KIND_TERM = { TRANSACTION: 'transaction_event_sources', PLANNING: 'street_report_relation', LAND_TENDER: 'tender_units_open', URBAN_RENEWAL: 'renewal_proposed_units', HOUSING: 'applicants_per_unit', RENTAL: 'rental_tender_units_vs_stated', CONSTRUCTION: 'construction_starts', SALES: 'official_new_home_sales', SOURCE_REVISION: 'data_revision', SOURCE_STATE: 'source_freshness' };
  var MISS_OF = { NOT_COVERED: 'changes_not_covered', SOURCE_STALE: 'changes_source_stale' };
  var COV_MISS = { SNAPSHOT_ONLY: 'changes_snapshot_only', NOT_APPLICABLE: 'changes_not_applicable', NOT_IN_COVERAGE: 'changes_not_in_coverage', STALE: 'changes_source_stale' };
  var ST = { geo: 'il', geoLabel: null, period: 90, kinds: null, newness: null, scopeGroups: null, data: null, items: [], status: 'idle', req: 0, err: null, meta: null, started: false, expanded: {}, kids: {}, sugg: [], suggIdx: -1, suggErr: null, q: '', more: false, loadingMore: false };
  try { var saved = JSON.parse(sessionStorage.getItem('propx:changes:v1') || 'null'); if (saved && /^(30|90|180|365)$/.test(String(saved.period))) ST.period = saved.period; } catch (e) { /* storage unavailable */ }
  var persist = function () { try { sessionStorage.setItem('propx:changes:v1', JSON.stringify({ period: ST.period })); } catch (e) { /* storage unavailable */ } };

  var geoKind = function (id) { return /^st:/.test(id) ? 'street' : /^nb:/.test(id) ? 'neighbourhood' : /^loc:/.test(id) ? 'locality' : id === 'il' ? 'il' : 'district'; };
  /* scope groups offered per geography kind; by default the geography's own scopes are on and every CONTEXT scope (the street's locality, the district / national series) is one click away */
  var SCOPE_GROUPS = {
    street: [['street', ['EXACT_STREET'], true], ['near', ['NEAR_STREET'], true], ['locality', ['LOCALITY'], false], ['ctx', ['DISTRICT_CONTEXT', 'NATIONAL_CONTEXT'], false]],
    locality: [['inLoc', ['LOCALITY'], true], ['ctx', ['DISTRICT_CONTEXT', 'NATIONAL_CONTEXT'], false]],
    district: [['inLoc', ['LOCALITY'], true], ['district', ['DISTRICT'], true], ['ctx', ['NATIONAL_CONTEXT'], false]],
    il: [['inLoc', ['LOCALITY'], true], ['national', ['NATIONAL'], true]],
  };
  var groupsOf = function () { var k = geoKind(ST.geo); return SCOPE_GROUPS[k === 'neighbourhood' ? 'street' : k]; };
  var defaultGroups = function () { var o = {}; groupsOf().forEach(function (g) { o[g[0]] = g[2]; }); return o; };
  var scopesSel = function () { var G = groupsOf(), sel = ST.scopeGroups || defaultGroups(), out = []; G.forEach(function (g) { if (sel[g[0]]) out = out.concat(g[1]); }); return out; };

  /* ───────────── data ───────────── */
  function get(qs) {
    return fetch('/api/intel?' + qs, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function query(extra) {
    var p = new URLSearchParams({ view: 'changes', geo: ST.geo, period: String(ST.period), batch: '1', limit: '60' });
    if (ST.kinds && ST.kinds.length) p.set('kinds', ST.kinds.join(','));
    if (ST.newness && ST.newness.length) p.set('newness', ST.newness.join(','));
    var sc = scopesSel(); p.set('scope', sc.length ? sc.join(',') : 'EXACT_STREET');
    if (extra) Object.keys(extra).forEach(function (k) { p.set(k, extra[k]); });
    return p.toString();
  }
  function load(reset) {
    ST.started = true;
    var id = ++ST.req;
    if (reset) { ST.status = 'loading'; ST.expanded = {}; ST.kids = {}; render(); }
    else { ST.loadingMore = true; render(); }
    var jobs = [get(query(reset ? null : { offset: String(ST.items.length) }))];
    if (!ST.meta) jobs.push(get('view=changesMeta').then(function (m) { ST.meta = m; }).catch(function () { /* the vocabulary is optional */ }));
    Promise.all(jobs).then(function (r) {
      if (id !== ST.req) return;
      var d = r[0];
      ST.data = d; ST.items = reset ? d.items : ST.items.concat(d.items); ST.more = d.more; ST.status = 'ok'; ST.loadingMore = false; ST.err = null;
      ST.geoLabel = { kind: d.geo.kind, name: d.geo.name, locality: d.geo.locality || null, district: d.geo.districtName || null };
      render();
      /* a "What changed here?" link asked for the section: the sections above it may have grown while the feed loaded — land on it again */
      if (ST.scrollPending) { ST.scrollPending = false; scrollHere(true); setTimeout(function () { scrollHere(true); }, 700); }
    }).catch(function (e) { if (id !== ST.req) return; ST.status = 'error'; ST.loadingMore = false; ST.err = e && e.status ? e.status : 'network'; render(); });
  }
  function setGeo(id, opts) {
    opts = opts || {};
    if (!id) return;
    var same = id === ST.geo && ST.started;
    /* a link asked for the section: land on it again once the feed is rendered (the sections above may grow meanwhile) */
    if (opts.scroll) ST.scrollPending = !same || !!opts.force || ST.status === 'loading';
    if (same && !opts.force) { if (opts.scroll) scrollHere(); return; }
    ST.geo = id; ST.scopeGroups = null; ST.kinds = null; ST.newness = null; ST.items = []; ST.data = null;
    load(true);
    if (opts.scroll) scrollHere();
  }
  function scrollHere(settle) {
    var s = document.getElementById('changes'); if (!s) return;
    if (settle) { var r = s.getBoundingClientRect(); if (r.top >= -4 && r.top < window.innerHeight * 0.5) return; s.scrollIntoView({ behavior: 'auto', block: 'start' }); return; }
    /* the rail's own jump keeps the section anchored while the lazily loading sections above it grow (the launchpad does the same) */
    var rail = document.querySelector('.rail .ri[data-sec="changes"]');
    if (rail) { rail.click(); return; }
    s.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { scrollHere(true); }, 1000);
  }

  /* ───────────── render ───────────── */
  function header() {
    var t = w(), G = ST.geoLabel, k = geoKind(ST.geo);
    var name = G ? pick(G.name) : ST.geo === 'il' ? (lang() === 'en' ? 'Israel' : 'ישראל') : ST.geo;
    var sub = G && G.locality && (k === 'street' || k === 'neighbourhood') ? ' · ' + esc(pick(G.locality.name)) : '';
    var S = window.PropxExplain && window.PropxExplain.section ? window.PropxExplain.section('changes', lang()) : null;
    return '<div class="ch-head"><div><span class="lyr">' + esc(t.lyr) + '</span><h2>' + esc(t.title) + ' <span class="ch-geo-name">' + esc(name) + sub + '</span></h2>' +
      (S ? '<p class="orient">' + esc(S.what) + ' <button type="button" class="xp-how" data-xpsec="changes">' + (lang() === 'en' ? 'How to read this' : 'איך לקרוא את זה') + ' ⓘ</button></p>' : '') +
      '<p class="ch-how">' + t.how + ' ' + xp('change_event_vs_observed') + '</p></div></div>';
  }
  function picker() {
    var t = w(), k = geoKind(ST.geo), G = ST.geoLabel;
    var dists = (ST.meta && ST.meta.districts) || [];
    var distSel = '<select class="ch-sel" data-chdist aria-label="' + esc(t.districts) + '"><option value="il"' + (ST.geo === 'il' ? ' selected' : '') + '>' + esc(t.il) + '</option><optgroup label="' + esc(t.districts) + '">' +
      dists.map(function (d) { return '<option value="' + esc(d.id) + '"' + (ST.geo === d.id ? ' selected' : '') + '>' + esc(pick(d)) + '</option>'; }).join('') + '</optgroup>' +
      (k !== 'il' && k !== 'district' ? '<option value="' + esc(ST.geo) + '" selected>' + esc(G ? pick(G.name) : ST.geo) + ' (' + esc(t.geoKind[k]) + ')</option>' : '') + '</select>';
    var locCode = G && G.locality ? G.locality.code : null;
    var nbs = ((ST.meta && ST.meta.neighbourhoods) || []).filter(function (n) { return n.streetLinks && locCode != null && n.localityCode === locCode; });
    var nbSel = nbs.length ? '<select class="ch-sel" data-chnb aria-label="' + esc(t.nb) + '"><option value="">' + esc(t.nbNone) + '</option>' + nbs.map(function (n) { return '<option value="' + esc(n.id) + '"' + (ST.geo === n.id ? ' selected' : '') + '>' + esc(pick(n)) + '</option>'; }).join('') + '</select>' : '';
    var list = '';
    if (ST.suggErr) list = '<ul class="ch-list" role="listbox" id="chList"><li class="ch-err" role="option" aria-disabled="true">' + esc(t.geoErr[ST.suggErr] || t.geoErr.server) + '</li></ul>';
    else if (ST.sugg.length) list = '<ul class="ch-list" role="listbox" id="chList">' + ST.sugg.map(function (g, i) {
      return '<li role="option" id="chOpt' + i + '" data-chpick="' + i + '" aria-selected="' + (i === ST.suggIdx) + '"><span>' + esc(g.he) + (g.kind === 'street' ? ' · ' + esc(g.city) : '') + '</span><small>' + esc(g.kind === 'street' ? t.geoKind.street : t.geoKind.locality) + '</small></li>';
    }).join('') + '</ul>';
    else if (ST.q && ST.q.length >= 2 && ST.searched) list = '<ul class="ch-list" role="listbox" id="chList"><li class="ch-err" role="option" aria-disabled="true">' + esc(t.noMatch) + '</li></ul>';
    return '<div class="ch-bar"><div class="ch-search"><input type="search" data-chq value="' + esc(ST.q) + '" placeholder="' + esc(t.search) + '" aria-label="' + esc(t.searchAria) + '" role="combobox" aria-autocomplete="list" aria-expanded="' + (!!list) + '" aria-controls="chList"' + (ST.suggIdx >= 0 ? ' aria-activedescendant="chOpt' + ST.suggIdx + '"' : '') + ' autocomplete="off">' + list + '</div>' +
      distSel + nbSel + '<span class="ho-note" style="margin:0">' + esc(t.follows) + '</span></div>';
  }
  function chips() {
    var t = w(), D = ST.data, K = D ? D.kinds : null;
    var per = [30, 90, 180, 365].map(function (n) { return '<button type="button" class="chip" data-chper="' + n + '" aria-pressed="' + (ST.period === n) + '">' + esc(t.days(n)) + '</button>'; }).join('');
    var kinds = '<button type="button" class="chip" data-chkind="" aria-pressed="' + (!ST.kinds) + '">' + esc(t.kindAll) + '</button>' + KINDS.map(function (k) {
      var n = K && K[k] ? K[k].counts.total : null;
      return '<button type="button" class="chip" data-chkind="' + k + '" aria-pressed="' + (!!(ST.kinds && ST.kinds.indexOf(k) >= 0)) + '">' + esc(K && K[k] ? pick(K[k].label) : k) + (n ? '<span class="n">' + fmt(n) + '</span>' : '') + '</button>';
    }).join('');
    var nw = '<button type="button" class="chip" data-chnew="" aria-pressed="' + (!ST.newness) + '">' + esc(t.all) + '</button>' + NEWNESS.map(function (n) {
      var c = D ? D.counts.byNewness[n] : null;
      return '<button type="button" class="chip" data-chnew="' + n + '" aria-pressed="' + (!!(ST.newness && ST.newness.indexOf(n) >= 0)) + '">' + esc(vocab('newness', n) || n) + (c != null ? '<span class="n">' + fmt(c) + '</span>' : '') + '</button>';
    }).join('') + xp('change_newness');
    var sel = ST.scopeGroups || defaultGroups();
    var sc = groupsOf().map(function (g) {
      var c = D ? g[1].reduce(function (a, s) { return a + (D.counts.byScope[s] || 0); }, 0) : null;
      return '<button type="button" class="chip" data-chscope="' + g[0] + '" aria-pressed="' + (!!sel[g[0]]) + '">' + esc(t.scopes[g[0]]) + (c != null ? '<span class="n">' + fmt(c) + '</span>' : '') + '</button>';
    }).join('') + xp('change_scope');
    return '<div class="ch-bar"><span class="lbl" id="chPerL">' + esc(t.period) + '</span><div class="ch-chips" role="group" aria-labelledby="chPerL">' + per + '</div>' + xp('change_period_anchor') + '</div>' +
      '<div class="ch-bar"><span class="lbl" id="chScL">' + esc(t.scope) + '</span><div class="ch-chips" role="group" aria-labelledby="chScL">' + sc + '</div></div>' +
      '<div class="ch-bar"><span class="lbl" id="chKiL">' + esc(t.kinds) + '</span><div class="ch-chips" role="group" aria-labelledby="chKiL">' + kinds + '</div></div>' +
      '<div class="ch-bar"><span class="lbl" id="chNwL">' + esc(t.newness) + '</span><div class="ch-chips" role="group" aria-labelledby="chNwL">' + nw + '</div></div>';
  }
  function anchorLine() {
    var D = ST.data, t = w(); if (!D) return '';
    var srcLabel = D.anchor.source || '—';
    try { var X = window.PropxExplain; if (X && X.sourceLabel) srcLabel = X.sourceLabel(D.anchor.source, lang()) || D.anchor.source; } catch (e) { /* label optional */ }
    var tx = D.kinds.TRANSACTION, li = tx && tx.listing && tx.listing.truncated ? ' · ' + esc(t.listing(fmt(tx.listing.listed), fmt(tx.listing.exact))) : '';
    var ex = D.counts.possibleDuplicatesExcluded ? ' · ' + esc(t.excluded(fmt(D.counts.possibleDuplicatesExcluded))) : '';
    var nl = (D.geo.streets || []).filter(function (s) { return !s.located; });
    return '<div class="ch-anchor">' + t.anchor(dmy(D.period.from), dmy(D.period.to), D.period.days, esc(srcLabel), dmy(D.anchor.at)) + li + ex + (nl.length ? ' · ' + esc(t.nolocated) : '') + '</div>';
  }
  function summary() {
    var D = ST.data, t = w(); if (!D) return '';
    var tiles = KINDS.map(function (k) {
      var K = D.kinds[k], n = K.counts.total, S = K.statement;
      var v = n > 0 ? '<span class="v">' + fmt(n) + '</span>' : S.code === 'NO_CHANGES_IN_PERIOD' ? '<span class="v">0</span>' : '<span class="v na">—</span>';
      var s = n > 0 ? [K.counts.NEW_EVENT ? fmt(K.counts.NEW_EVENT) + ' ' + t.newSum.NEW_EVENT : '', K.counts.NEWLY_OBSERVED_OLDER_EVENT ? fmt(K.counts.NEWLY_OBSERVED_OLDER_EVENT) + ' ' + t.newSum.NEWLY_OBSERVED_OLDER_EVENT : '', K.counts.REVISION ? fmt(K.counts.REVISION) + ' ' + t.newSum.REVISION : '', K.counts.STATE_CHANGE ? fmt(K.counts.STATE_CHANGE) + ' ' + t.newSum.STATE_CHANGE : ''].filter(Boolean).join(' · ')
        : (t.stShort[S.code] || pick(S.text)) + (S.reason ? ' — ' + pick(S.reason) : '');
      return '<button type="button" class="ch-tile" data-chkind="' + k + '" aria-pressed="' + (!!(ST.kinds && ST.kinds.length === 1 && ST.kinds[0] === k)) + '"><span class="k">' + esc(pick(K.label)) + '</span>' + v + '<span class="s">' + esc(s) + '</span></button>';
    }).join('');
    var ns = NEWNESS.map(function (n) { return '<span><b>' + fmt(D.counts.byNewness[n]) + '</b> ' + esc(t.newSum[n]) + '</span>'; }).join('');
    return '<div class="ch-sum">' + tiles + '</div><div class="ch-newsum">' + ns + ' ' + xp('change_statement') + '</div>';
  }
  function linkOf(it) {
    var t = w(), L = it.link; if (!L) return '';
    if (L.type === 'expand') { var open = !!ST.expanded[it.id]; return '<button type="button" class="ch-go" data-chexp="' + esc(it.id) + '" aria-expanded="' + open + '">' + esc(open ? t.collapse : t.expand) + '</button>'; }
    if ((L.type === 'plan' || L.type === 'external') && L.href) return '<a class="ch-go" href="' + esc(L.href) + '" target="_blank" rel="noopener noreferrer">' + esc(t.open[L.type]) + ' ↗</a>';
    if (L.type === 'plan' || L.type === 'external' || L.type === 'site' || L.type === 'vatmal') return '';
    if (!t.open[L.type]) return '';
    return '<button type="button" class="ch-go" data-chopen="' + esc(L.type) + '" data-chid="' + esc(L.id || '') + '" data-chname="' + esc((it.values && it.values.street) || (it.matchedStreet && it.matchedStreet.name) || '') + '" data-chcity="' + esc((it.values && it.values.city) || '') + '">' + esc(t.open[L.type]) + '</button>';
  }
  function itemHTML(it, nested) {
    var t = w(), v = it.values || {};
    var scope = '<span class="ch-sc s-' + esc(it.scope) + '">' + esc(vocab('scopes', it.scope)) + (it.distanceM != null && it.scope === 'NEAR_STREET' ? ' · ' + esc(t.km(it.distanceM)) : '') + '</span>';
    var rel = it.relation && t.rel[it.relation] ? '<span>' + esc(t.rel[it.relation]) + '</span>' : '';
    var poss = it.placement === 'POSSIBLE' ? '<span class="ch-poss">' + esc(t.possible) + (v.match && t.match[v.match] ? ' · ' + esc(t.match[v.match]) : '') + '</span>' : '';
    var layer = v.recentLayer || it.rule === 'chg-tx-govmap-national' || (it.rule === 'chg-tx-batch') ? '<span class="ch-lay">' + esc(t.layer) + '</span>' : '';
    var conflict = v.conflict ? '<span class="ch-poss">' + esc(t.conflict) + '</span>' : '';
    var src = it.source ? '<span>' + esc(pick(it.source.label)) + (it.source.copyDate ? ' (' + esc(t.copy) + ' <span class="num">' + dmy(it.source.copyDate) + '</span>)' : '') + '</span>' : '';
    var ed = it.eventDateRange ? dmy(it.eventDateRange.from) + ' – ' + dmy(it.eventDateRange.to) : dmy(it.eventDate);
    var basis = it.eventDateBasis && it.eventDateBasis !== 'SOURCE' ? ' <small>' + esc(t.basis[it.eventDateBasis] || '') + '</small>' : '';
    var rt = { trigger: it.title, period: { he: (ST.data ? ST.data.period.from + ' → ' + ST.data.period.to : ''), en: (ST.data ? ST.data.period.from + ' → ' + ST.data.period.to : '') }, source: it.source ? it.source.id : null, cls: it.cls, value: it.n > 1 ? fmt(it.n) : null };
    var kids = ST.expanded[it.id] ? '<div class="ch-kids">' + (ST.kids[it.id] ? (ST.kids[it.id].error ? '<p class="ch-errbox">' + esc(t.err) + '</p>' : '<ol>' + ST.kids[it.id].items.map(function (x) { return itemHTML(x, true); }).join('') + '</ol>' + (ST.kids[it.id].more ? '<div class="ch-more"><button type="button" class="chip" data-chkmore="' + esc(it.id) + '">' + esc(t.more) + '</button></div>' : '')) : '<p class="ch-load">' + esc(t.loading) + '</p>') + '</div>' : '';
    return '<li class="ch-it m' + it.m + '" data-chit="' + esc(it.id) + '">' +
      '<div class="ch-date"><b class="num">' + ed + '</b><small>' + esc(t.event) + '</small></div>' +
      '<div><div class="ch-tags"><span class="pu-verb v-' + esc(it.verb) + '" title="' + esc(it.verb || '') + '">' + esc(verbLabel(it.verb)) + '</span><span class="ch-nw n-' + esc(it.newness) + '">' + esc(vocab('newness', it.newness)) + '</span>' + scope + layer + conflict + '</div>' +
      '<div class="ch-t">' + esc(pick(it.title)) + (it.n > 1 ? ' <span class="ho-chip">' + fmt(it.n) + ' ' + esc(t.events) + '</span>' : '') + '</div>' + (it.detail ? '<div class="ch-x">' + esc(pick(it.detail)) + '</div>' : '') +
      '<div class="ch-meta"><span class="ch-seen">' + esc(t.seen) + ' <b class="num">' + dmy(it.observedAt) + '</b></span>' + basis + src + clsChip(it.cls) + rel + poss + xpSigH(it.rule, rt) + '</div></div>' +
      '<div class="ch-a">' + linkOf(it) + '</div>' + kids + '</li>';
  }
  function timeline() {
    var t = w(), D = ST.data; if (!D) return '';
    if (!ST.items.length) return emptyHTML();
    var html = '', cur = null, mo = {}; (D.months || []).forEach(function (m) { mo[m.month] = m; });
    var open = false;
    ST.items.forEach(function (it) {
      var m = String(it.changeDate || '').slice(0, 7);
      if (m !== cur) {
        if (open) html += '</ol>';
        cur = m; var M = mo[m], y = m.slice(0, 4), n = Number(m.slice(5, 7));
        html += '<h3 class="ch-mo">' + esc((t.monthNames[n - 1] || m) + ' ' + y) + (M ? ' <small>' + fmt(M.items) + ' ' + esc(t.items) + (M.n !== M.items ? ' · ' + fmt(M.n) + ' ' + esc(t.events) : '') + '</small>' : '') + '</h3><ol>';
        open = true;
      }
      html += itemHTML(it, false);
    });
    if (open) html += '</ol>';
    if (ST.more) html += '<div class="ch-more"><button type="button" class="chip" data-chmore="1"' + (ST.loadingMore ? ' disabled' : '') + '>' + esc(ST.loadingMore ? t.loading : t.more) + ' (' + fmt(D.total - ST.items.length) + ')</button></div>';
    return '<div class="ch-tl">' + html + '</div>';
  }
  function emptyHTML() {
    var t = w(), D = ST.data;
    var ks = KINDS.filter(function (k) { return !ST.kinds || ST.kinds.indexOf(k) >= 0; });
    return '<div class="ch-empty">' + esc(t.emptyAll) + '<ul>' + ks.map(function (k) {
      var K = D.kinds[k], S = K.statement;
      var why = S.code === 'CHANGES' ? t.perKindEmpty : S.reason ? pick(S.reason) : '';
      return '<li><b>' + esc(pick(K.label)) + '</b> — <span class="ch-stm t-' + esc(S.code) + '">' + esc(pick(S.text)) + '</span>' + (why ? ' · ' + esc(why) : '') + (MISS_OF[S.code] ? ' ' + xpMissH(MISS_OF[S.code]) : '') + '</li>';
    }).join('') + '</ul></div>';
  }
  function coverage() {
    var t = w(), D = ST.data; if (!D) return '';
    var rows = KINDS.map(function (k) {
      var K = D.kinds[k], C = K.coverage, S = K.statement;
      var parts = (C.parts || []).map(function (p) {
        var bits = [pick(p.label) || p.id];
        if (p.notApplicable) bits.push(pick(p.note));
        else {
          if (p.copyDate) bits.push(t.copyD + ' ' + dmy(p.copyDate));
          if (p.coveredThrough) bits.push(t.through + ' ' + dmy(p.coveredThrough));
          if (p.history && p.history.since) bits.push(t.since + ' ' + dmy(p.history.since));
          if (p.checkedAt) bits.push(t.checked + ' ' + dmy(p.checkedAt));
          if (p.freshness) bits.push(p.freshness);
          if (p.history && p.history.note) bits.push(pick(p.history.note));
          if (p.placement) bits.push(pick(p.placement));
          if (p.note) bits.push(pick(p.note));
        }
        return '<li>' + esc(bits.join(' · ')) + '</li>';
      }).join('');
      return '<div class="ch-cr"><div class="ch-k">' + esc(pick(K.label)) + ' ' + (KIND_TERM[k] ? xp(KIND_TERM[k]) : '') + '</div>' +
        '<div><span class="ch-st c-' + esc(C.state) + '">' + esc(pick(C.label) || C.state) + '</span>' + (COV_MISS[C.state] ? ' ' + xpMissH(COV_MISS[C.state]) : '') + '<br><span class="ch-stm t-' + esc(S.code) + '">' + esc(pick(S.text)) + '</span></div>' +
        '<div>' + (S.reason ? esc(pick(S.reason)) : C.reason ? esc(pick(C.reason)) : '') + (C.note ? '<div class="ho-note" style="margin-top:2px">' + esc(pick(C.note)) + '</div>' : '') + (C.scopeReason ? '<div class="ho-note" style="margin-top:2px">' + esc(pick(C.scopeReason)) + '</div>' : '') + '<ul class="ch-parts">' + parts + '</ul></div></div>';
    }).join('');
    return '<details class="ch-cov" open><summary>' + esc(t.covT) + ' ' + xp('change_coverage') + '</summary><div class="ch-covl">' + rows + '</div></details>';
  }
  function render() {
    var t = w();
    var hd = header();
    var body;
    if (ST.status === 'error') body = '<div class="ch-errbox" role="alert">' + esc(t.err) + ' <button type="button" class="chip" data-chretry="1">' + esc(t.retry) + '</button></div>';
    else if (ST.status === 'loading' || !ST.data) body = '<p class="ch-load">' + esc(t.loading) + '</p>';
    else body = anchorLine() + summary() + timeline() + coverage() + '<p class="ch-note">' + esc(ST.data.engine) + ' · ' + fmt(ST.data.timings.totalMs) + ' ms · ' + xp('change_feed') + ' ' + xp('change_materiality') + '</p>';
    /* keep the search box's focus and caret across renders */
    var a = document.activeElement, focusQ = a && a.hasAttribute && a.hasAttribute('data-chq'), caret = focusQ ? a.selectionStart : null;
    root.hidden = false;
    root.innerHTML = hd + '<div class="card ch-card">' + picker() + chips() + body + '</div>';
    if (focusQ) { var q = root.querySelector('[data-chq]'); if (q) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) { /* type=search */ } } }
  }

  /* ───────────── geography search (/api/geo/search) ───────────── */
  var qTimer = null, qSeq = 0;
  function search(q) {
    ST.q = q; ST.suggIdx = -1;
    clearTimeout(qTimer);
    if (q.trim().length < 2) { ST.sugg = []; ST.suggErr = null; ST.searched = false; render(); return; }
    var seq = ++qSeq;
    qTimer = setTimeout(function () {
      var url = '/api/geo/search?limit=8&q=' + encodeURIComponent(q.trim());
      var near = ST.geoLabel && ST.geoLabel.locality ? String(ST.geoLabel.locality.code) : '';
      if (near) url += '&near=' + encodeURIComponent(near);
      var p = typeof srchFetch === 'function' ? srchFetch(url, function (d) { return Array.isArray(d.matches); })
        : fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json().then(function (d) { return { data: d }; }) : { err: { kind: 'server' } }; }).catch(function () { return { err: { kind: 'network' } }; });
      Promise.resolve(p).then(function (R) {
        if (seq !== qSeq) return;
        if (!R || R.err) { ST.sugg = []; ST.suggErr = R && R.err ? R.err.kind : 'server'; }
        else { ST.sugg = (R.data.matches || []).filter(function (g) { return g.kind === 'street' || g.kind === 'locality'; }).slice(0, 8); ST.suggErr = null; }
        ST.searched = true; render();
      });
    }, 180);
  }
  function choose(g) {
    if (!g) return;
    ST.q = ''; ST.sugg = []; ST.suggIdx = -1; ST.searched = false;
    setGeo(g.kind === 'street' ? g.id : 'loc:' + (g.code != null ? g.code : String(g.id || '').replace(/^loc:/, '')), { force: true });
  }

  /* ───────────── events ───────────── */
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-chper],[data-chkind],[data-chnew],[data-chscope],[data-chmore],[data-chopen],[data-chexp],[data-chkmore],[data-chretry],[data-chpick]');
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute('data-chpick')) { choose(ST.sugg[Number(b.getAttribute('data-chpick'))]); return; }
    if (b.hasAttribute('data-chretry')) { load(true); return; }
    if (b.hasAttribute('data-chper')) { ST.period = Number(b.getAttribute('data-chper')); persist(); load(true); return; }
    if (b.hasAttribute('data-chkind')) {
      var k = b.getAttribute('data-chkind');
      if (!k) ST.kinds = null;
      else if (b.classList.contains('ch-tile')) ST.kinds = ST.kinds && ST.kinds.length === 1 && ST.kinds[0] === k ? null : [k];
      else { var ks = ST.kinds ? ST.kinds.slice() : []; var i = ks.indexOf(k); if (i >= 0) ks.splice(i, 1); else ks.push(k); ST.kinds = ks.length ? ks : null; }
      load(true); return;
    }
    if (b.hasAttribute('data-chnew')) {
      var n = b.getAttribute('data-chnew');
      if (!n) ST.newness = null; else { var ns = ST.newness ? ST.newness.slice() : []; var j = ns.indexOf(n); if (j >= 0) ns.splice(j, 1); else ns.push(n); ST.newness = ns.length ? ns : null; }
      load(true); return;
    }
    if (b.hasAttribute('data-chscope')) { var g = b.getAttribute('data-chscope'); var sel = Object.assign({}, ST.scopeGroups || defaultGroups()); sel[g] = !sel[g]; if (!Object.keys(sel).some(function (x) { return sel[x]; })) sel[g] = true; ST.scopeGroups = sel; load(true); return; }
    if (b.hasAttribute('data-chmore')) { load(false); return; }
    if (b.hasAttribute('data-chexp')) { expand(b.getAttribute('data-chexp'), false); return; }
    if (b.hasAttribute('data-chkmore')) { expand(b.getAttribute('data-chkmore'), true); return; }
    if (b.hasAttribute('data-chopen')) { openLink(b); return; }
  });
  root.addEventListener('change', function (e) {
    var x = e.target;
    if (x.hasAttribute('data-chdist')) { setGeo(x.value, { force: true }); return; }
    if (x.hasAttribute('data-chnb') && x.value) { setGeo(x.value, { force: true }); }
  });
  root.addEventListener('input', function (e) { if (e.target.hasAttribute('data-chq')) search(e.target.value); });
  root.addEventListener('keydown', function (e) {
    if (!e.target.hasAttribute || !e.target.hasAttribute('data-chq')) return;
    var n = ST.sugg.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); ST.suggIdx = (ST.suggIdx + 1) % n; render(); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); ST.suggIdx = (ST.suggIdx - 1 + n) % n; render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (n) choose(ST.sugg[ST.suggIdx >= 0 ? ST.suggIdx : 0]); }
    else if (e.key === 'Escape') { ST.sugg = []; ST.suggIdx = -1; ST.searched = false; render(); }
  });
  function expand(id, more) {
    var it = ST.items.find(function (x) { return x.id === id; }); if (!it) return;
    if (!more && ST.expanded[id]) { ST.expanded[id] = false; render(); return; }
    ST.expanded[id] = true;
    var X = it.values && it.values.expand; if (!X) { render(); return; }
    var prev = more && ST.kids[id] ? ST.kids[id].items : [];
    if (!more) ST.kids[id] = null;
    render();
    var qs = new URLSearchParams({ view: 'changes', geo: ST.geo, period: String(ST.period), batch: '0', limit: '60', offset: String(prev.length), newness: X.newness, kinds: X.kinds, source: X.source, scope: X.scope });
    get(qs.toString()).then(function (d) { ST.kids[id] = { items: prev.concat(d.items), more: d.more }; render(); }).catch(function () { ST.kids[id] = { error: true, items: [] }; render(); });
  }
  function openLink(b) {
    var type = b.getAttribute('data-chopen'), id = b.getAttribute('data-chid');
    if (type === 'street' && /^st:\d+:\d+$/.test(id)) {
      var m = /^st:(\d+):(\d+)$/.exec(id), G = ST.geoLabel || {};
      var city = b.getAttribute('data-chcity') || (G.locality ? pick(G.locality.name) : '');
      var g = { kind: 'street', id: id, he: b.getAttribute('data-chname') || (G.kind === 'street' ? pick(G.name) : id), city: city, cityEn: G.locality ? G.locality.name.en : null, cityCode: Number(m[1]), streetCode: Number(m[2]), district: G.district ? null : null, status: 'current' };
      try { if (G.locality && Number(G.locality.code) === Number(m[1])) g.district = ST.data && ST.data.geo ? ST.data.geo.district : null; } catch (e) { /* optional */ }
      if (typeof openGeoView === 'function') openGeoView(g);
      return;
    }
    if (type === 'tender' && typeof ldOpen === 'function') { ldOpen(id, b); return; }
    if ((type === 'renewal' || type === 'permit') && typeof inOpen === 'function') { inOpen(type, id, b); return; }
    if ((type === 'transactions' || type === 'changes') && id) { setGeo(id, { force: true, scroll: true }); return; }
    if (type === 'dossier' && typeof dsOpen === 'function') { if (id === 'il') dsOpen('il', null); else dsOpen('district', id); var d = document.getElementById('dossier'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    var target = { revisions: 'pulse', sources: 'sources', housing: 'housing' }[type];
    if (target) { var s = document.getElementById(target); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  /* the page: language, the opened geography, the board's selection, the "What changed here?" links */
  document.addEventListener('propx:lang', function () { if (ST.started) render(); });
  document.addEventListener('propx:geo', function (e) {
    var g = e && e.detail; if (!g) return;
    if (g.kind === 'street' && /^st:\d+:\d+$/.test(String(g.id || ''))) setGeo(g.id);
    else if (g.kind === 'locality') { var c = g.code != null ? String(g.code) : String(g.id || '').replace(/^loc:/, ''); if (/^\d+$/.test(c)) setGeo('loc:' + c); }
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-chgeo]'); if (!a || root.contains(a)) return;
    var id = a.getAttribute('data-chgeo'); if (!id) return;
    e.preventDefault(); setGeo(id, { scroll: true });
  });
  /* the board's own selection (country · district · city · verified neighbourhood) — never while the page navigates to an opened street */
  (function () {
    var orig = window.selectLocation; if (typeof orig !== 'function') return;
    window.selectLocation = function (id) {
      var r = orig.apply(this, arguments);
      try {
        var nav = typeof _geoNav !== 'undefined' && _geoNav;
        if (!nav && typeof LOC !== 'undefined' && LOC[id]) followBoard(LOC[id]);
      } catch (e) { /* the board stays the board */ }
      return r;
    };
  }());
  function followBoard(l) {
    if (l.type === 'country') { setGeo('il'); return; }
    if (l.type === 'district') { setGeo(l.id); return; }
    if (l.type === 'nbhd') {
      var nb = ((ST.meta && ST.meta.neighbourhoods) || []).find(function (n) { return n.id === 'nb:' + l.id && n.streetLinks; });
      if (nb) { setGeo(nb.id); return; }
      if (typeof LOC !== 'undefined' && LOC[l.parent]) { followBoard(LOC[l.parent]); return; }
    }
    if (l.type !== 'city') return;
    /* the board's city → the official locality by its exact name (the registry search; a locality hit whose name is the same) */
    var nz = function (s) { return String(s || '').replace(/[״"'’]/g, '').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim(); };
    var url = '/api/geo/search?limit=5&q=' + encodeURIComponent(l.he);
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !Array.isArray(d.matches)) return;
      var m = d.matches.filter(function (g) { return g.kind === 'locality' && nz(g.he) === nz(l.he); });
      if (m.length === 1) setGeo('loc:' + m[0].code);
    }).catch(function () { /* stays on the current geography */ });
  }

  /* first load when the section comes into view (or at once without an observer) */
  var sec = document.getElementById('changes');
  render();
  if ('IntersectionObserver' in window && sec) {
    var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); if (!ST.started) load(true); } }, { rootMargin: '600px 0px' });
    io.observe(sec);
  } else load(true);
  window.PropxChanges = { setGeo: setGeo, state: function () { return ST; } };
}());
