/* PROPX · ATLAS (22.10.2026, live build only) — the geographic drill-down at the top of the Overview.
 *
 * Israel → district → subdistrict → locality → verified neighbourhood | CBS statistical area → street, by breadcrumbs, "one level up",
 * the children of the current level (tables / lists / a street search) and the district map. One scope for the whole page: the atlas
 * points every geography-dependent section at it through the page's own doors (selectLocation · openGeoView · dsOpen · the change feed's
 * setGeo · the land / housing / developers / pulse filters · the transactions area), and FOLLOWS the page when the geography changes
 * elsewhere (search, the board, the map, the crumbs, "Reset to Israel"). Each section whose own geography is not the selected one says so
 * in a banner (CONTEXT — the nearest level it covers), never silently. Everything shown comes from GET /api/intel?view=scope
 * (lib/geo/scope-read.js) and lib/geo/scope.js (the module × level matrix); nothing is computed here but the layout.
 */
(function () {
  'use strict';
  const S = window.PropxScope, host = document.getElementById('atlas');
  if (!S || !host || typeof state === 'undefined') return;

  const AT = { id: 'il', data: null, status: 'idle', err: null, req: 0, nat: null, nav: 0, sq: '', sres: null, sreq: 0, sbusy: false, kq: '', boardReq: 0 };
  const NAMES = window.PROPX_GEO_NAMES = window.PROPX_GEO_NAMES || {};
  const isHe = () => state.lang !== 'en';
  const L = (o) => (o == null ? '' : typeof o === 'string' ? o : isHe() ? o.he : (o.en || o.he));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = () => (isHe() ? 'he-IL' : 'en-US');
  const N = (v) => (v == null ? '—' : Number(v).toLocaleString(nf()));
  const D = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '—');
  const NIS = (v) => (v == null ? '—' : '₪' + Number(v).toLocaleString('en-US'));
  const xp = (id) => (typeof xpBtn === 'function' ? xpBtn(id) : '');
  const nz = (s) => String(s || '').replace(/[״"'’׳]/g, '').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();

  const STR = {
    he: {
      kicker: 'אטלס ישראל', title: 'מבט ארצי וירידה לרמות', crumbs: 'היררכיה גאוגרפית', up: 'רמה אחת למעלה', level: 'רמה',
      loading: 'טוען את הגאוגרפיה…', error: 'לא ניתן לטעון את הגאוגרפיה כרגע.', retry: 'נסו שוב',
      known: 'העסקה הידועה האחרונה', priced: 'עסקת המגורים המתומחרת האחרונה', none: 'אין עסקה כזו בנתונים ש-PROPX מחזיקה לגאוגרפיה הזאת',
      priceNo: 'מחיר לא מוצג — לא משמש בסטטיסטיקה', source: 'מקור', copy: 'עותק', state: 'מצב', rooms: 'חד׳', sqm: 'מ״ר',
      events: 'אירועי עסקה רשומים', last12: 'ב-12 החודשים האחרונים', window: 'בחלון השמור', pop: 'אוכלוסייה — מפקד 2022', popAgg: (n, of) => `סכום ${N(n)} מתוך ${N(of)} יישובים שבטבלת המפקד`,
      popNote: 'אוכלוסייה = סכום היישובים שבטבלת מפקד 2022 (יישובים קטנים שהטבלה משמיטה אינם בסכום) · אירועי עסקה = כל האירועים שהאיחוד השמור מחזיק',
      since: 'מאז', households: 'משקי בית — מפקד 2022', residents: 'תושבים רשומים (מרשם האוכלוסין)', sales12: 'דירות חדשות שנמכרו — 12 חודשים (למ״ס)', starts12: 'התחלות בנייה — 12 חודשים (למ״ס)',
      ctxOf: (n) => `הקשר: ${n}`, agg: 'מצרפי', exact: 'מדויק', na: 'לא זמין',
      districts: 'השוואת מחוזות', napot: 'נפות המחוז', locs: 'יישובי הנפה', nbs: 'שכונות מאומתות', sas: 'אזורים סטטיסטיים — נתוני מפקד 2022 בלבד', streets: 'רחובות',
      nbStreets: 'רחובות מקושרים לשכונה (רחוב יכול לעבור בכמה שכונות — לעולם לא משויך לאחת)', streetPh: (n) => `חיפוש רחוב ב${n}…`, streetHint: (n) => `${N(n)} רחובות רשמיים ביישוב — חפשו כדי לרדת לרמת רחוב`,
      kFilter: 'סינון לפי שם…', noKids: 'אין רמה רשמית מתחת לגאוגרפיה הזאת ב-PROPX', addrNote: 'בניין / כתובת / חלקה — ראיות בתוך דוח הרחוב (סינון לפי בניין או גוש-חלקה); נכס — מעבדת העסקה, על ההנחות שלכם.',
      c: { name: 'שם', dist: 'מחוז', locs: 'יישובים', napot: 'נפות', pop: 'אוכלוסייה (2022)', ev: 'אירועי עסקה', latest: 'עסקה אחרונה', latestP: 'מגורים מתומחרת אחרונה', sales: 'מכירות חדשות 12ח׳ (למ״ס)', starts: 'התחלות בנייה 12ח׳ (למ״ס)' },
      order: 'סדר', popOrder: 'לפי אוכלוסיית מפקד 2022 — סדר של נתון רשמי, לא ציון', cities: 'הערים הגדולות', nbCov: (n, m) => `שכונות מאומתות: ${N(n)} ב-${N(m)} יישובים — שמות בלבד, ללא גבולות`,
      cov: 'כיסוי לפי רמה', lv: { country: 'ארץ', district: 'מחוזות', subdistrict: 'נפות', locality: 'יישובים', neighbourhood: 'שכונות מאומתות', statArea: 'אזורים סטטיסטיים', street: 'רחובות', address: 'בניין / כתובת / חלקה', property: 'נכס' },
      mx: 'מה כל מודול אומר ברמה הזאת', mxSum: (t) => `${t.EXACT} מדויק · ${t.AGGREGATED} מצרפי · ${t.CONTEXT} הקשר · ${t.NOT_AVAILABLE} לא זמין · ${t.NOT_APPLICABLE} לא רלוונטי`,
      mxCols: ['מודול', 'מצב', 'בסיס', ''], open: 'פתח', jsNote: 'יהודה ושומרון — לא נקלט גבול; בחירה מהרשימה', mapAria: 'מפת המחוזות — בחירת מחוז', mapLegend: 'גבולות מחוזות: Natural Earth (גאומטריה בלבד); נקודות: קואורדינטות היישובים מהמרשם',
      noNapa: 'הנפה לא צוינה בקובץ הרשמי', live: (n) => `הגאוגרפיה שנבחרה: ${n}`,
      scnSel: 'נבחר', scnShown: 'כאן מוצג', scnBoard: 'כרטיסי הלוח מותאמים לישראל, 6 מחוזות ו-40 ערים — זו הרמה הקרובה שיש לה כרטיס',
      scnCtx: 'הרמה הקרובה שהמודול מכסה', scnNat: (n) => `הרשימה כאן ארצית — נתוני ${n} עצמה (סכום יישוביה) בתיק השוק`, scnAll: 'כל היישובים', scnDs: 'לתיק השוק',
    },
    en: {
      kicker: 'Israel atlas', title: 'National view and drill-down', crumbs: 'Geographic hierarchy', up: 'One level up', level: 'Level',
      loading: 'Loading the geography…', error: 'The geography could not be loaded right now.', retry: 'Retry',
      known: 'Latest known transaction', priced: 'Latest priced residential transaction', none: 'No such transaction in the data PROPX holds for this geography',
      priceNo: 'Price not shown — not used in statistics', source: 'Source', copy: 'copy', state: 'State', rooms: 'rooms', sqm: 'm²',
      events: 'Recorded transaction events', last12: 'in the last 12 months', window: 'in the stored window', pop: 'Population — census 2022', popAgg: (n, of) => `sum of ${N(n)} of ${N(of)} localities in the census table`,
      popNote: 'Population = the sum of the localities in the census 2022 table (small localities the table omits are not in it) · transaction events = every event the stored union holds',
      since: 'since', households: 'Households — census 2022', residents: 'Registered residents (population register)', sales12: 'New dwellings sold — 12 months (CBS)', starts12: 'Construction starts — 12 months (CBS)',
      ctxOf: (n) => `Context: ${n}`, agg: 'AGGREGATED', exact: 'EXACT', na: 'NOT AVAILABLE',
      districts: 'District comparison', napot: 'The district\'s subdistricts', locs: 'The subdistrict\'s localities', nbs: 'Verified neighbourhoods', sas: 'Statistical areas — census 2022 figures only', streets: 'Streets',
      nbStreets: 'Streets linked to the neighbourhood (a street may run through several neighbourhoods — it is never placed in one)', streetPh: (n) => `Search a street in ${n}…`, streetHint: (n) => `${N(n)} official streets in the locality — search to drill down to a street`,
      kFilter: 'Filter by name…', noKids: 'PROPX holds no official level below this geography', addrNote: 'Building / address / parcel — evidence inside the street report (building or block-parcel filters); property — the Deal Lab, on your own assumptions.',
      c: { name: 'Name', dist: 'District', locs: 'Localities', napot: 'Subdistricts', pop: 'Population (2022)', ev: 'Transaction events', latest: 'Latest transaction', latestP: 'Latest priced residential', sales: 'New sales 12m (CBS)', starts: 'Construction starts 12m (CBS)' },
      order: 'Order', popOrder: 'by census 2022 population — an order of an official figure, never a score', cities: 'Major cities', nbCov: (n, m) => `Verified neighbourhoods: ${N(n)} in ${N(m)} localities — names only, no boundaries`,
      cov: 'Coverage by level', lv: { country: 'Country', district: 'Districts', subdistrict: 'Subdistricts', locality: 'Localities', neighbourhood: 'Verified neighbourhoods', statArea: 'Statistical areas', street: 'Streets', address: 'Building / address / parcel', property: 'Property' },
      mx: 'What each module says at this level', mxSum: (t) => `${t.EXACT} exact · ${t.AGGREGATED} aggregated · ${t.CONTEXT} context · ${t.NOT_AVAILABLE} not available · ${t.NOT_APPLICABLE} not applicable`,
      mxCols: ['Module', 'Mode', 'Basis', ''], open: 'Open', jsNote: 'Judea and Samaria — no boundary is held; pick it from the list', mapAria: 'District map — pick a district', mapLegend: 'District boundaries: Natural Earth (geometry only); points: the registry\'s locality coordinates',
      noNapa: 'no subdistrict in the official file', live: (n) => `Selected geography: ${n}`,
      scnSel: 'Selected', scnShown: 'Shown here', scnBoard: 'board cards exist for Israel, 6 districts and 40 cities — this is the nearest level with a card',
      scnCtx: 'the nearest level this module covers', scnNat: (n) => `this list is national — ${n}'s own figures (summed over its localities) are in the market dossier`, scnAll: 'all localities', scnDs: 'To the dossier',
    },
  };
  const t = () => STR[isHe() ? 'he' : 'en'];
  const STATE_L = { he: { PRICED_IN_STATISTICS: 'מתומחרת בסטטיסטיקה', VERIFIED_DWELLING: 'דירה מאומתת', RECORDED_EVENT: 'אירוע רשום', LIMITED_SHARE_NOT_STATED: 'החלק הנמכר לא צוין', CONFLICT: 'סתירה בין מקורות', POSSIBLE_DUPLICATE: 'כפילות אפשרית' },
    en: { PRICED_IN_STATISTICS: 'priced in statistics', VERIFIED_DWELLING: 'verified dwelling', RECORDED_EVENT: 'recorded event', LIMITED_SHARE_NOT_STATED: 'share sold not stated', CONFLICT: 'source conflict', POSSIBLE_DUPLICATE: 'possible duplicate' } };
  const KIND_L = { he: { DWELLING: 'דירה', TYPE_NOT_STATED: 'סוג נכס לא צוין', NON_DWELLING: 'לא למגורים' }, en: { DWELLING: 'dwelling', TYPE_NOT_STATED: 'property type not stated', NON_DWELLING: 'not a dwelling' } };
  const SRC_L = { he: { 'over:deals-register': 'מאגר רשות המסים — עותק over.org.il', 'over:govmap-recent': 'שכבת GovMap — חלון אחרון (over.org.il)', 'over:govmap-national': 'קובץ שכבת GovMap הארצי (over.org.il)' },
    en: { 'over:deals-register': 'Tax Authority register — over.org.il copy', 'over:govmap-recent': 'GovMap layer — recent window (over.org.il)', 'over:govmap-national': 'GovMap layer national file (over.org.il)' } };
  const lk = (M, k) => (M[isHe() ? 'he' : 'en'][k] || k || '—');
  const lvName = (lv) => { const x = S.levelOf(lv); return x ? L(x) : lv; };

  /* ───────────── reading ───────────── */
  async function get(id) {
    const r = await fetch('/api/intel?view=scope&id=' + encodeURIComponent(id), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  function remember(d) {
    const put = (id, name) => { const m = /^loc:(\d+)$/.exec(id || ''); if (m && name) NAMES[m[1]] = { he: name.he, en: name.en || name.he }; };
    (d.scope.chain || []).forEach((c) => put(c.id, c.name));
    ((d.children && d.children.rows) || []).forEach((r) => put(r.id, r.name));
    if (d.national) d.national.cities.rows.forEach((r) => put(r.id, r.name));
  }
  /** load a scope; `then(scope)` runs once it resolved (navigation / filters) */
  function load(id, then) {
    const req = ++AT.req;
    AT.id = id; AT.status = 'loading'; AT.err = null; AT.sq = ''; AT.sres = null; AT.kq = '';
    render();
    get(id).then((d) => {
      if (req !== AT.req) return;
      AT.data = d; AT.status = 'ok'; remember(d);
      if (d.scope.level === 'country') AT.nat = d;
      if (then) then(d.scope);
      render(); banners();
    }).catch((e) => { if (req !== AT.req) return; AT.status = 'error'; AT.err = e; render(); });
  }

  /* ───────────── pointing the page's sections at the scope ───────────── */
  const district = (sc) => (sc.chain || []).find((c) => c.level === 'district') || null;
  const locality = (sc) => (sc.chain || []).find((c) => c.level === 'locality') || null;
  function changesTo(id) { try { if (window.PropxChanges) window.PropxChanges.setGeo(id, { follow: true }); } catch (e) { /* the change feed is optional */ } }
  /** the land / housing / developers & renewal / pulse filters: a locality code from locality level down, none above (a district: pulse only) */
  function filters(sc) {
    const loc = locality(sc), code = loc ? String(sc.locality) : null, dist = !code && sc.district ? sc.district : null;
    try { const f = ldState.f; if ((f.city || null) !== code || f.region) { f.city = code; f.region = null; ldState.page = 1; if (ldState.started) ldLoad(); else ldPersist(); } } catch (e) { /* land absent */ }
    try { const f = hoState.f; if ((f.city || null) !== code) { f.city = code; f.neighborhood = null; f.project = null; hoState.page = 1; hoState.geoAll = false; if (hoState.started) hoLoad(); else hoPersist(); } } catch (e) { /* housing absent */ }
    try { if ((inState.city || '') !== (code || '')) { inState.city = code || ''; inState.page = 1; if (inState.started) inLoad(); else inPersist(); } } catch (e) { /* intel absent */ }
    try { if ((puState.city || '') !== (code || '') || (puState.district || '') !== (dist || '')) { puState.city = code || ''; puState.district = dist || ''; puState.page = 1; puState.acc = []; if (puState.started) puLoad(); } } catch (e) { /* pulse absent */ }
  }
  function dossierTo(sc) {
    if (typeof dsOpen !== 'function') return;
    if (sc.level === 'country') dsOpen('il', null);
    else if (sc.level === 'district' || sc.level === 'subdistrict') dsOpen('district', sc.district);
    else if (sc.locality != null) dsOpen('locality', String(sc.locality));
  }
  function dispatch(sc, from) { try { document.dispatchEvent(new CustomEvent('propx:scope', { detail: { id: sc.id, level: sc.level, from } })); } catch (e) { /* old browsers */ } }
  /* the board moved BY the atlas: marked as the page's own navigation (_geoNav), so the modules that follow the board by themselves
     (the change feed's board follower answers asynchronously, the dossier's name match) do not re-derive a geography the atlas sets
     exactly — a verified neighbourhood was overwritten by its city (QA 22.10.2026) */
  function boardTo(id) {
    let prev = false; try { prev = _geoNav; _geoNav = true; } catch (e) { /* no flag: plain selection */ }
    try { if (state.locId !== id) selectLocation(id); else refresh(false); } finally { try { _geoNav = prev; } catch (e) { /* no flag */ } }
  }
  /** the atlas moves the page: board / opened place, then the sections */
  function navigate(sc) {
    AT.nav++;
    try {
      const lv = sc.level, dId = sc.district || null, cur = dId && typeof LOC !== 'undefined' && LOC[dId] ? dId : null;
      state.scope = sc.id; state.scopeArea = null;
      if (lv === 'district' || lv === 'subdistrict') {
        if (state.geo) { state.geo = null; const gv = document.getElementById('geoView'); if (gv) gv.hidden = true; }
        if (!cur && dId) state.scopeArea = { id: dId, he: S.DISTRICTS[dId].he, en: S.DISTRICTS[dId].en };   /* Judea and Samaria: no board card */
        boardTo(cur || 'il');
        changesTo(dId);
      } else if (lv === 'street') {
        const loc = locality(sc), m = /^st:(\d+):(\d+)$/.exec(sc.id);
        openGeoView({ kind: 'street', id: sc.id, he: sc.name.he, en: sc.name.en, city: loc.name.he, cityEn: loc.name.en, cityCode: Number(m[1]), streetCode: Number(m[2]), district: dId, status: 'current' }, { noScroll: true });
      } else {
        const loc = locality(sc), code = sc.locality, nbCurated = lv === 'neighbourhood' && typeof LOC !== 'undefined' && LOC[sc.id.slice(3)] ? sc.id.slice(3) : null;
        if (nbCurated) { if (state.geo) { state.geo = null; const gv = document.getElementById('geoView'); if (gv) gv.hidden = true; } boardTo(nbCurated); }
        else openGeoView({ kind: 'locality', id: 'loc:' + code, code, he: loc.name.he, en: loc.name.en, district: dId }, { noScroll: true });
        changesTo(lv === 'neighbourhood' ? sc.id : 'loc:' + code);
      }
      dossierTo(sc);
      filters(sc);
      if (typeof renderCmd === 'function') renderCmd();
      if (typeof txFetch === 'function') txFetch(false);
    } finally { AT.nav--; }
    dispatch(sc, 'atlas');
    const live = document.getElementById('ilrLive'); if (live) { live.textContent = ''; setTimeout(() => { live.textContent = t().live(L(sc.name)); }, 40); }
  }
  /** the page moved (search · board · map · crumbs): the atlas and the sections that do not follow by themselves */
  function follow(sc) {
    state.scope = sc.id;
    dossierTo(sc); filters(sc);
    if (sc.level !== 'street' && sc.level !== 'locality') { /* a street / locality opened elsewhere already moved the change feed */ }
    if (typeof renderCmd === 'function') renderCmd();
    dispatch(sc, 'follow');
  }
  function go(id) {
    if (!id) return;
    if (id === 'il') { if (typeof resetToIsrael === 'function') resetToIsrael({ from: 'atlas', scroll: false }); return; }
    load(id, navigate);
  }

  /* the page's own selections → the official scope */
  function boardToScope(l) {
    if (!l) return;
    if (l.type === 'country') { if (AT.id !== 'il' || state.scopeArea) { state.scopeArea = null; load('il', follow); } return; }
    if (l.type === 'district') { load(l.id, follow); return; }
    if (l.type === 'nbhd' && /^[a-z0-9-]+$/.test(l.id)) { load('nb:' + l.id, (sc) => follow(sc)); return; }
    let c = l; while (c && c.type !== 'city' && c.parent && typeof LOC !== 'undefined') c = LOC[c.parent];
    if (!c || c.type !== 'city') return;
    const req = ++AT.boardReq;
    fetch('/api/geo/search?limit=5&q=' + encodeURIComponent(c.he), { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (req !== AT.boardReq || !d || !Array.isArray(d.matches)) return;
      const m = d.matches.filter((g) => g.kind === 'locality' && nz(g.he) === nz(c.he));
      if (m.length === 1) load('loc:' + m[0].code, follow);
    }).catch(() => { /* stays */ });
  }
  (function wrap() {
    const orig = window.selectLocation; if (typeof orig !== 'function') return;
    window.selectLocation = function (id) {
      const before = state.locId, r = orig.apply(this, arguments);
      try { if (!AT.nav && !(typeof _geoNav !== 'undefined' && _geoNav) && state.locId !== before && typeof LOC !== 'undefined' && LOC[id]) { state.scopeArea = null; boardToScope(LOC[id]); } } catch (e) { /* the board stays the board */ }
      return r;
    };
  }());
  /* closing an opened street / locality returns the scope to the board's place (the button's own handler — closeGeo — runs first) */
  { const cb = document.getElementById('geoCloseBtn'); if (cb) cb.addEventListener('click', () => { try { if (!AT.nav && typeof LOC !== 'undefined') boardToScope(LOC[state.locId]); } catch (e) { /* stays */ } }); }
  document.addEventListener('propx:geo', (e) => {
    const g = e && e.detail; if (!g || AT.nav) return;
    if (g.kind === 'street' && /^st:\d+:\d+$/.test(String(g.id || ''))) load(g.id, follow);
    else if (g.kind === 'locality') { const c = g.code != null ? String(g.code) : String(g.id || '').replace(/^loc:/, ''); if (/^\d+$/.test(c)) load('loc:' + c, follow); }
  });
  /* "Reset to Israel" (and any other national reset): the national read, cached after the first one */
  document.addEventListener('propx:scope', (e) => {
    const d = e && e.detail; if (!d || d.id !== 'il') return;
    if (AT.id !== 'il' || AT.status !== 'ok') { if (AT.nat) { AT.req++; AT.id = 'il'; AT.data = AT.nat; AT.status = 'ok'; AT.sq = ''; AT.sres = null; AT.kq = ''; render(); } else load('il'); }
    banners();
  });
  document.addEventListener('propx:lang', () => { render(); banners(); });

  /* ───────────── the mini map (the page's own projection and district paths) ───────────── */
  function mapSVG() {
    if (typeof distPath !== 'function' || typeof israelPath === 'undefined' || typeof proj !== 'function') return '';
    const d = AT.data, sc = d && d.scope, selD = sc && sc.district;
    const ids = ['d-north', 'd-haifa', 'd-center', 'd-ta', 'd-jm', 'd-south'];
    const name = (id) => L(S.DISTRICTS[id]);
    const paths = ids.map((id) => `<path class="atl-d${id === selD ? ' on' : ''}" d="${distPath(id)}" data-atgo="${id}" tabindex="0" role="button" aria-label="${esc(name(id))}" aria-pressed="${id === selD}"><title>${esc(name(id))}</title></path>`).join('');
    const areas = typeof areaPath === 'function' ? ['westBank', 'gaza'].map((k) => `<path class="atl-area${k === 'westBank' && selD === 'js-area' ? ' js' : ''}" d="${areaPath(k)}"/>`).join('') : '';
    let pts = '';
    const dot = (p, cls, r) => { const xy = proj(p.lat, p.lng); return `<circle class="${cls}" cx="${xy[0].toFixed(1)}" cy="${xy[1].toFixed(1)}" r="${r}"/>`; };
    if (sc && sc.point) pts += dot(sc.point, 'atl-pt on', 4.2);
    else if (sc && sc.level === 'subdistrict' && d.children && d.children.rows) d.children.rows.forEach((r) => { if (r.point) pts += dot(r.point, 'atl-pt', 1.9); });
    return `<svg class="atl-svg" viewBox="0 0 ${MAP_W} ${MAP_H}" role="group" aria-label="${esc(t().mapAria)}"><path class="atl-land" d="${israelPath}"/>${areas}${paths}${pts}</svg>`;
  }

  /* ───────────── the view ───────────── */
  function modeChip(mode, ctx) {
    const m = S.MODES[mode] || { he: mode, en: mode };
    return `<span class="atl-mode m-${esc(mode)}">${esc(L(m))}${ctx ? ` · ${esc(ctx)}` : ''}</span>`;
  }
  function eventCard(kind, e, tx) {
    const T = t(), term = kind === 'known' ? 'latest_known_transaction' : 'latest_priced_residential_transaction';
    const head = `<div class="atl-ev-h"><span>${esc(kind === 'known' ? T.known : T.priced)}</span>${xp(term)}</div>`;
    if (!e) return `<div class="atl-ev">${head}<p class="atl-ev-none">${esc(T.none)}</p></div>`;
    const place = [e.street ? e.street + (e.house ? ' ' + e.house : '') : null, e.city].filter(Boolean).join(', ');
    const facts = [e.rooms != null ? `${N(e.rooms)} ${T.rooms}` : null, e.areaSqm != null ? `${N(e.areaSqm)} ${T.sqm}` : null, e.propertyType || lk(KIND_L, e.kind)].filter(Boolean).join(' · ');
    const price = e.priceUsed && e.price != null ? `<b class="atl-ev-p num">${NIS(e.price)}</b>` : `<span class="atl-ev-np">${esc(T.priceNo)} · ${esc(lk(STATE_L, e.state))}</span>`;
    return `<div class="atl-ev${kind === 'priced' ? ' pr' : ''}">${head}<div class="atl-ev-d num">${D(e.date)}</div><div class="atl-ev-pl"><bdi>${esc(place || '—')}</bdi></div><div class="atl-ev-f">${esc(facts)}</div>${price}
      <div class="atl-ev-s">${esc(T.source)}: ${esc(lk(SRC_L, e.sourceId))}${e.snapshotDate ? ` · ${esc(T.copy)} ${D(e.snapshotDate)}` : ''} · ${esc(T.state)}: ${esc(lk(STATE_L, e.state))}</div></div>`;
  }
  function factsHTML(d) {
    const T = t(), x = d.transactions || {}, g = d.demographics || {}, out = [];
    const ctx = (blk) => (blk && blk.mode === 'CONTEXT' && blk.of ? modeChip('CONTEXT', L(blk.of.name)) : blk && blk.mode === 'AGGREGATED' ? modeChip('AGGREGATED') : '');
    if (x.mode && x.mode !== 'NOT_AVAILABLE') {
      out.push(`<div class="atl-f"><span class="k">${esc(T.events)} ${xp('recorded_transaction_events')}</span><b class="num">${N(x.events)}</b><span class="s">${x.window ? `${esc(T.since)} ${D(x.window.from)} · ` : ''}${ctx(x)}</span></div>`);
      if (x.last12 != null) out.push(`<div class="atl-f"><span class="k">${esc(T.events)} — ${esc(T.last12)}</span><b class="num">${N(x.last12)}</b><span class="s">${ctx(x)}</span></div>`);
    }
    if (g.mode && g.mode !== 'NOT_AVAILABLE' && g.population != null) {
      out.push(`<div class="atl-f"><span class="k">${esc(T.pop)} ${xp('census_2022_locality')}</span><b class="num">${N(g.population)}</b><span class="s">${g.mode === 'AGGREGATED' ? esc(T.popAgg(g.listed, g.of)) + ' ' : ''}${ctx(g)}</span></div>`);
      if (g.households != null) out.push(`<div class="atl-f"><span class="k">${esc(T.households)}</span><b class="num">${N(g.households)}</b><span class="s">${ctx(g)}</span></div>`);
      if (g.residents && g.residents.residents != null) out.push(`<div class="atl-f"><span class="k">${esc(T.residents)} ${xp('registered_residents')}</span><b class="num">${N(g.residents.residents)}</b><span class="s">${ctx(g)}</span></div>`);
    }
    const se = d.series;
    if (se && se.sales) out.push(`<div class="atl-f"><span class="k">${esc(T.sales12)} ${xp('official_new_home_sales')}</span><b class="num">${N(se.sales.value)}</b><span class="s">${esc(L(se.sales.label))}</span></div>`);
    if (se && se.starts) out.push(`<div class="atl-f"><span class="k">${esc(T.starts12)} ${xp('construction_starts')}</span><b class="num">${N(se.starts.value)}</b><span class="s">${esc(L(se.starts.label))}</span></div>`);
    return out.length ? `<div class="atl-facts">${out.join('')}</div>` : '';
  }
  const cell = (v, show) => `<td class="num" data-v="${v == null ? '' : esc(v)}">${show}</td>`;
  const goBtn = (id, name) => `<button type="button" class="atl-go" data-atgo="${esc(id)}"><bdi>${esc(name)}</bdi></button>`;
  function kidsHTML(d) {
    const T = t(), C = T.c, k = d.children || {}, sc = d.scope;
    if (sc.level === 'country') {
      const rows = k.rows.map((r) => `<tr><td>${goBtn(r.id, L(r.name))}</td>${cell(r.localities, N(r.localities))}${cell(r.subdistricts, N(r.subdistricts))}${cell(r.population, N(r.population))}${cell(r.events, N(r.events))}${cell(r.latest, D(r.latest))}${cell(r.latestPriced, D(r.latestPriced))}${cell(r.salesT12 && r.salesT12.value, r.salesT12 ? N(r.salesT12.value) : '—')}${cell(r.startsT12 && r.startsT12.value, r.startsT12 ? N(r.startsT12.value) : '—')}</tr>`).join('');
      const s0 = k.rows.find((r) => r.salesT12), s1 = k.rows.find((r) => r.startsT12);
      return `<h4 class="atl-h">${esc(T.districts)}</h4><div class="atl-scroll"><table class="atl-t" data-ptdom="atdist"><thead><tr><th>${esc(C.dist)}</th><th>${esc(C.locs)}</th><th>${esc(C.napot)}</th><th>${esc(C.pop)}</th><th>${esc(C.ev)}</th><th>${esc(C.latest)}</th><th>${esc(C.latestP)}</th><th>${esc(C.sales)}</th><th>${esc(C.starts)}</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="atl-note">${esc(T.popNote)}${s0 ? ' · ' + esc(C.sales) + ': ' + esc(L(s0.salesT12.label)) : ''}${s1 ? ' · ' + esc(C.starts) + ': ' + esc(L(s1.startsT12.label)) : ''} · ${esc(T.jsNote)}</p>`;
    }
    if (sc.level === 'district') {
      const rows = k.rows.map((r) => `<tr><td>${goBtn(r.id, L(r.name))}</td>${cell(r.localities, N(r.localities))}${cell(r.population, N(r.population))}${cell(r.events, N(r.events))}${cell(r.latest, D(r.latest))}</tr>`).join('');
      return `<h4 class="atl-h">${esc(T.napot)}</h4><div class="atl-scroll"><table class="atl-t" data-ptdom="atnapa"><thead><tr><th>${esc(C.name)}</th><th>${esc(C.locs)}</th><th>${esc(C.pop)}</th><th>${esc(C.ev)}</th><th>${esc(C.latest)}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    if (sc.level === 'subdistrict') {
      const q = nz(AT.kq), list = k.rows.filter((r) => !q || nz(r.name.he).includes(q) || nz(r.name.en).toLowerCase().includes(q.toLowerCase()));
      const rows = list.map((r) => `<tr><td>${goBtn(r.id, L(r.name))}</td>${cell(r.population, N(r.population))}${cell(r.events, N(r.events))}${cell(r.latest, D(r.latest))}</tr>`).join('');
      return `<h4 class="atl-h">${esc(T.locs)} <span class="atl-cnt num">${N(k.rows.length)}</span></h4><input class="ho-in atl-kq" type="search" data-atkq value="${esc(AT.kq)}" placeholder="${esc(T.kFilter)}" aria-label="${esc(T.kFilter)}">
        <div class="atl-scroll atl-tall"><table class="atl-t" data-ptdom="atloc"><thead><tr><th>${esc(C.name)}</th><th>${esc(C.pop)}</th><th>${esc(C.ev)}</th><th>${esc(C.latest)}</th></tr></thead><tbody>${rows}</tbody></table></div><p class="atl-note">${esc(T.order)}: ${esc(T.popOrder)}</p>`;
    }
    if (sc.level === 'locality') {
      const nbs = (k.neighbourhoods || []).map((n) => goBtn(n.id, L(n.name))).join('');
      const sas = k.statAreas || [];
      const sres = AT.sres ? (AT.sres.length ? AT.sres.map((m) => goBtn(m.id, m.he)).join('') : `<span class="atl-note">—</span>`) : '';
      return `<div class="atl-kid"><h4 class="atl-h">${esc(T.streets)}</h4><p class="atl-note">${esc(T.streetHint(k.streets ? k.streets.current : 0))}</p>
          <input class="ho-in atl-sq" type="search" data-atsq value="${esc(AT.sq)}" placeholder="${esc(T.streetPh(L(sc.name)))}" aria-label="${esc(T.streetPh(L(sc.name)))}"><div class="atl-chips" aria-live="polite">${AT.sbusy ? `<span class="atl-note">${esc(T.loading)}</span>` : sres}</div></div>
        <div class="atl-kid"><h4 class="atl-h">${esc(T.nbs)} <span class="atl-cnt num">${N((k.neighbourhoods || []).length)}</span></h4>${nbs ? `<div class="atl-chips">${nbs}</div>` : '<p class="atl-note">—</p>'}</div>
        <div class="atl-kid"><h4 class="atl-h">${esc(T.sas)} <span class="atl-cnt num">${N(sas.length)}</span></h4>${sas.length ? `<select class="ho-sel" data-atsa aria-label="${esc(T.sas)}"><option value="">—</option>${sas.map((a) => `<option value="${esc(a.id)}">${esc(L(a.name))}${a.population != null ? ` · ${N(a.population)}` : ''}</option>`).join('')}</select>` : '<p class="atl-note">—</p>'}</div>`;
    }
    if (sc.level === 'neighbourhood') {
      const rows = (k.rows || []).map((r) => goBtn(r.id, L(r.name))).join('');
      return `<h4 class="atl-h">${esc(T.nbStreets)}</h4>${rows ? `<div class="atl-chips">${rows}</div>` : '<p class="atl-note">—</p>'}`;
    }
    return `<p class="atl-note">${esc(sc.level === 'street' ? T.addrNote : T.noKids)}</p>`;
  }
  function nationalHTML(n) {
    if (!n) return '';
    const T = t(), C = T.c;
    const cities = n.cities.rows.map((r) => `<tr><td>${goBtn(r.id, L(r.name))}</td><td>${esc(r.district && S.DISTRICTS[r.district] ? L(S.DISTRICTS[r.district]) : '—')}</td>${cell(r.population, N(r.population))}${cell(r.events, N(r.events))}${cell(r.latest, D(r.latest))}</tr>`).join('');
    const nb = n.neighbourhoods, nbList = nb.byLocality.map((x) => `<div class="atl-nbl"><button type="button" class="atl-go" data-atgo="${esc(x.id)}"><bdi>${esc(L(x.name))}</bdi></button> <span class="atl-cnt num">${N(x.neighbourhoods.length)}</span></div>`).join('');
    const cov = n.coverage.map((c) => `<li><b>${esc(T.lv[c.level] || c.level)}</b> <span class="num">${c.n != null ? N(c.n) : '—'}</span> <span class="atl-note">${esc(L(c.note))}${c.withEvents != null ? ` · ${N(c.withEvents)} ${isHe() ? 'עם אירועי עסקה' : 'with transaction events'}` : ''}${c.census != null ? ` · ${N(c.census)} ${isHe() ? 'בטבלת המפקד' : 'in the census table'}` : ''}</span></li>`).join('');
    return `<div class="atl-nat">
      <div class="atl-col"><h4 class="atl-h">${esc(T.cities)}</h4><div class="atl-scroll"><table class="atl-t" data-ptdom="atcity"><thead><tr><th>${esc(C.name)}</th><th>${esc(C.dist)}</th><th>${esc(C.pop)}</th><th>${esc(C.ev)}</th><th>${esc(C.latest)}</th></tr></thead><tbody>${cities}</tbody></table></div><p class="atl-note">${esc(T.order)}: ${esc(T.popOrder)}</p></div>
      <div class="atl-col"><h4 class="atl-h">${esc(T.nbs)}</h4><p class="atl-note">${esc(T.nbCov(nb.total, nb.localities))}</p><div class="atl-nbs">${nbList}</div>
        <h4 class="atl-h">${esc(T.cov)}</h4><ul class="atl-cov">${cov}</ul></div></div>`;
  }
  function matrixHTML(d) {
    const T = t(), lv = d.scope.level, rows = S.matrix(lv), tally = { EXACT: 0, AGGREGATED: 0, CONTEXT: 0, NOT_AVAILABLE: 0, NOT_APPLICABLE: 0 };
    rows.forEach((r) => { tally[r.mode]++; });
    const body = rows.map((r) => {
      const c = r.context ? S.contextOf(d.scope, r.context) : null;
      const open = r.section && document.getElementById(r.section) ? `<a class="atl-open" href="#${esc(r.section)}">${esc(T.open)}</a>` : '';
      return `<tr><td>${esc(L(r))}</td><td>${modeChip(r.mode, c ? L(c.name) : null)}</td><td>${esc(L(r.basis))}</td><td>${open}</td></tr>`;
    }).join('');
    return `<details class="atl-mx"${lv !== 'country' ? ' open' : ''}><summary>${esc(T.mx)} ${xp('geographic_scope_mode')} <span class="atl-note">${esc(T.mxSum(tally))}</span></summary>
      <div class="atl-scroll"><table class="atl-t atl-mxt"><thead><tr>${T.mxCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></details>`;
  }
  function render() {
    const T = t(), d = AT.data, busy = AT.status === 'loading';
    const sc = d ? d.scope : null;
    const crumbs = sc ? sc.chain.map((c, i) => { const cur = i === sc.chain.length - 1; return `<button type="button" class="atl-cr${cur ? ' cur' : ''}" data-atgo="${esc(c.id)}"${cur ? ' aria-current="location"' : ''}><bdi>${esc(L(c.name))}</bdi></button>`; }).join('<span class="atl-sep" aria-hidden="true">›</span>') : '';
    const up = sc && d.up ? (sc.chain.find((c) => c.id === d.up) || null) : null;
    const head = `<div class="atl-head"><div class="atl-ttl"><span class="atl-k">${esc(T.kicker)}</span><h3>${esc(sc ? L(sc.name) : T.title)}</h3>${sc ? `<span class="atl-lv">${esc(T.level)}: ${esc(lvName(sc.level))}</span>` : ''}</div>
      <nav class="atl-crumbs" aria-label="${esc(T.crumbs)}">${crumbs}</nav>${up ? `<button type="button" class="atl-up" data-atgo="${esc(up.id)}"><span aria-hidden="true">↑</span> ${esc(T.up)}: <bdi>${esc(L(up.name))}</bdi></button>` : ''}</div>`;
    let body;
    if (AT.status === 'error') body = `<div class="atl-err" role="alert">${esc(T.error)} <button type="button" class="chip" data-atretry>${esc(T.retry)}</button></div>`;
    else if (!d) body = `<p class="atl-note" role="status">${esc(T.loading)}</p>`;
    else {
      const x = d.transactions || {};
      const txCtx = x.mode === 'CONTEXT' && x.of ? `<p class="atl-ctx">${modeChip('CONTEXT', L(x.of.name))} ${esc(L(x.reason))}</p>` : x.mode === 'AGGREGATED' ? `<p class="atl-ctx">${modeChip('AGGREGATED')} ${esc(L(x.countBasis))}</p>` : x.mode === 'NOT_AVAILABLE' ? `<p class="atl-ctx">${modeChip('NOT_AVAILABLE')} ${esc(L(x.reason))}</p>` : '';
      const pair = x.mode && x.mode !== 'NOT_AVAILABLE' ? `<div class="atl-pair">${eventCard('known', x.latestKnown, x)}${eventCard('priced', x.latestPriced, x)}</div>` : '';
      const jsArea = sc.level === 'country' || sc.level === 'district' ? `<button type="button" class="atl-go atl-js${sc.district === 'js-area' ? ' on' : ''}" data-atgo="js-area">${esc(L(S.DISTRICTS['js-area']))}</button>` : '';
      body = `<div class="atl-grid${busy ? ' busy' : ''}" aria-busy="${busy}">
        <div class="atl-map">${mapSVG()}${jsArea}<p class="atl-note">${esc(T.mapLegend)}</p></div>
        <div class="atl-main">${txCtx}${pair}${factsHTML(d)}<div class="atl-kids">${kidsHTML(d)}</div></div></div>
        ${sc.level === 'country' ? nationalHTML(d.national) : ''}${matrixHTML(d)}`;
    }
    host.innerHTML = `<div class="atl${busy ? ' is-busy' : ''}">${head}${body}</div>`;
    if (typeof ptDomAll === 'function') try { ptDomAll(host); } catch (e) { /* the tables stay in their default order */ }
    const focusSel = AT._focus; if (focusSel) { const n = host.querySelector(focusSel); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) { /* not text */ } } AT._focus = null; }
  }

  /* ───────────── the section banners: a section whose geography is not the selected one says so ───────────── */
  const SECTIONS = ['overview', 'txSection', 'prices', 'map', 'dossier', 'pulse', 'changes', 'land', 'housing', 'intel'];
  function shownOf(sec, sc) {
    const T = t(), nm = (o) => L(o), il = isHe() ? 'ישראל' : 'Israel';
    const dName = (id) => (S.DISTRICTS[id] ? L(S.DISTRICTS[id]) : id);
    const codeName = (c) => (NAMES[c] ? L(NAMES[c]) : c);
    if (sec === 'overview' || sec === 'prices' || sec === 'map') {
      const l = typeof LOC !== 'undefined' ? LOC[state.locId] : null; if (!l) return null;
      const board = heName(l);
      if (state.scopeArea && state.locId === 'il') return { name: board, why: T.scnBoard, mode: 'CONTEXT' };
      const want = L(sc.name), wantLoc = locality(sc);
      if (nz(board) === nz(want) || (l.type === 'nbhd' && sc.level === 'neighbourhood')) return null;
      if (l.type === 'city' && wantLoc && (sc.level === 'locality') && nz(board) === nz(L(wantLoc.name))) return null;
      return { name: board, why: T.scnBoard, mode: 'CONTEXT' };
    }
    if (sec === 'dossier') {
      if (typeof dsState === 'undefined') return null;
      const lv = dsState.level, code = dsState.code;
      const shownId = lv === 'il' ? 'il' : lv === 'district' ? code : 'loc:' + code;
      if (shownId === sc.id) return null;
      return { name: lv === 'il' ? il : lv === 'district' ? dName(code) : codeName(code), why: T.scnCtx, mode: 'CONTEXT' };
    }
    if (sec === 'pulse') {
      if (typeof puState === 'undefined') return null;
      const shownId = puState.city ? 'loc:' + puState.city : puState.district || 'il';
      if (shownId === sc.id) return null;
      return { name: puState.city ? codeName(puState.city) : puState.district ? dName(puState.district) : il, why: T.scnCtx, mode: 'CONTEXT' };
    }
    if (sec === 'changes') {
      const st = window.PropxChanges && window.PropxChanges.state ? window.PropxChanges.state() : null; if (!st || !st.geo) return null;
      if (st.geo === sc.id) return null;
      const g = st.geo, name = g === 'il' ? il : S.DISTRICTS[g] ? dName(g) : /^loc:(\d+)$/.test(g) ? codeName(g.slice(4)) : (st.geoLabel && st.geoLabel.name ? nm(st.geoLabel.name) : g);
      return { name, why: T.scnCtx, mode: 'CONTEXT' };
    }
    if (sec === 'txSection') {
      if (typeof txQueryFor !== 'function') return null;
      const q = txQueryFor(); if (!q) return null;
      const lv = sc.level;
      if (lv === 'street' || lv === 'locality' || lv === 'country') return null;
      if (lv === 'district' && (q.did === sc.id || q.area === sc.id)) return null;
      return { name: q.label || il, why: T.scnCtx, mode: 'CONTEXT' };
    }
    if (sec === 'land' || sec === 'housing' || sec === 'intel') {
      const code = sec === 'land' ? (typeof ldState !== 'undefined' ? ldState.f.city : null) : sec === 'housing' ? (typeof hoState !== 'undefined' ? hoState.f.city : null) : (typeof inState !== 'undefined' ? inState.city : null);
      if (sc.level === 'district' || sc.level === 'subdistrict') return { name: T.scnAll, why: T.scnNat(L(sc.level === 'district' ? sc.name : (district(sc) || sc).name)), mode: 'CONTEXT', ds: true };
      if (sc.level === 'locality' && code && String(code) === String(sc.locality)) return null;
      if (code && /^\d+$/.test(String(code))) return { name: codeName(String(code)), why: T.scnCtx, mode: 'CONTEXT' };
      return null;
    }
    return null;
  }
  function banners() {
    const sc = AT.data && AT.status === 'ok' ? AT.data.scope : null, T = t();
    for (const sec of SECTIONS) {
      const root = document.getElementById(sec); if (!root) continue;
      let b = root.querySelector(':scope > .scn');
      const info = sc && sc.level !== 'country' ? shownOf(sec, sc) : null;
      if (!info) { if (b) b.remove(); continue; }
      if (!b) { b = document.createElement('div'); b.className = 'scn'; b.setAttribute('role', 'note'); const head = root.querySelector(':scope > .blk-head'); if (head) head.after(b); else root.prepend(b); }
      b.dataset.scn = sec;
      b.innerHTML = `${modeChip(info.mode)}<span>${esc(T.scnSel)}: <b><bdi>${esc(L(sc.name))}</bdi></b> · ${esc(T.scnShown)}: <b><bdi>${esc(info.name)}</bdi></b> — ${esc(info.why)}</span>${info.ds ? ` <button type="button" data-scnds>${esc(T.scnDs)}</button>` : ''}`;
    }
  }
  /* sections re-render after the atlas moved them (the dossier / pulse / feed load asynchronously): the banners follow */
  let bt = null; const later = () => { clearTimeout(bt); bt = setTimeout(banners, 250); };
  ['propx:scope', 'propx:geo'].forEach((ev) => document.addEventListener(ev, later));
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-scnds]')) { const d = document.getElementById('dossier'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });

  /* ───────────── interaction ───────────── */
  host.addEventListener('click', (e) => {
    const g = e.target.closest('[data-atgo]'); if (g) { e.preventDefault(); go(g.dataset.atgo); return; }
    if (e.target.closest('[data-atretry]')) { load(AT.id, AT.id === 'il' ? null : navigate); }
  });
  host.addEventListener('keydown', (e) => {
    const g = e.target.closest && e.target.closest('path[data-atgo]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(g.dataset.atgo); }
  });
  host.addEventListener('change', (e) => { const s = e.target.closest('[data-atsa]'); if (s && s.value) go(s.value); });
  let st = null, kt = null;
  host.addEventListener('input', (e) => {
    const x = e.target;
    if (x.matches('[data-atkq]')) { clearTimeout(kt); kt = setTimeout(() => { AT.kq = x.value; AT._focus = '[data-atkq]'; render(); }, 180); return; }
    if (!x.matches('[data-atsq]')) return;
    clearTimeout(st); const v = x.value.trim(); AT.sq = x.value;
    st = setTimeout(() => {
      const sc = AT.data && AT.data.scope; if (!sc || sc.level !== 'locality') return;
      if (v.length < 2) { AT.sres = null; AT.sbusy = false; AT._focus = '[data-atsq]'; render(); return; }
      const req = ++AT.sreq; AT.sbusy = true; AT._focus = '[data-atsq]'; render();
      fetch(`/api/geo/search?limit=20&near=${encodeURIComponent(sc.locality)}&q=${encodeURIComponent(v)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))).then((d) => {
        if (req !== AT.sreq) return;
        AT.sres = (d.matches || []).filter((m) => m.kind === 'street' && Number(m.cityCode) === Number(sc.locality)).slice(0, 12);
        AT.sbusy = false; AT._focus = '[data-atsq]'; render();
      }).catch(() => { if (req !== AT.sreq) return; AT.sbusy = false; AT.sres = []; AT._focus = '[data-atsq]'; render(); });
    }, 300);
  });

  /* styles (the page's tokens) */
  const css = document.createElement('style'); css.id = 'atlStyle';
  css.textContent = `
.atl{border:1px solid var(--edge);border-radius:var(--r-m);background:var(--panel);box-shadow:var(--shadow-card);padding:14px 16px;margin:0 0 16px}
.atl.is-busy .atl-main,.atl.is-busy .atl-nat{opacity:.55;transition:opacity .2s}
.atl-head{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;margin-bottom:10px}
.atl-ttl{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}.atl-ttl h3{font-size:17px;font-weight:800;margin:0}
.atl-k{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-deep)}
.atl-lv{font-size:11.5px;color:var(--ink-3);border:1px solid var(--hairline);border-radius:99px;padding:1px 9px}
.atl-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;font-size:12.5px;flex:1 1 300px}
.atl-cr{font:inherit;border:0;background:none;color:var(--accent-deep);cursor:pointer;padding:3px 5px;border-radius:6px;min-height:32px}
.atl-cr:hover{background:var(--accent-wash)}.atl-cr.cur{color:var(--ink);font-weight:800;cursor:default}
.atl-sep{color:var(--ink-3)}
.atl-up{font:inherit;font-size:12.5px;border:1px solid var(--edge);background:var(--panel-2);color:var(--ink);border-radius:99px;padding:5px 12px;cursor:pointer;min-height:34px}
.atl-up:hover{border-color:var(--accent)}
.atl-grid{display:grid;grid-template-columns:200px minmax(0,1fr);gap:16px}
.atl-map{display:flex;flex-direction:column;gap:6px;align-items:stretch}
.atl-svg{width:100%;max-height:380px;display:block}
.atl-land{fill:var(--panel-2);stroke:var(--baseline);stroke-width:1}
.atl-area{fill:none;stroke:var(--baseline);stroke-dasharray:3 2;stroke-width:.8}.atl-area.js{stroke:var(--accent);stroke-width:1.4}
.atl-d{fill:var(--accent-wash);stroke:var(--panel);stroke-width:1.2;cursor:pointer;outline:none}
.atl-d:hover,.atl-d:focus-visible{fill:var(--heat-3)}.atl-d.on{fill:var(--accent)}
.atl-pt{fill:var(--brass);stroke:var(--panel);stroke-width:.6}.atl-pt.on{fill:var(--down);stroke-width:1.4}
.atl-js{font:inherit;font-size:12px;border:1px dashed var(--edge);border-radius:8px;background:var(--panel);padding:6px 8px;cursor:pointer;color:var(--ink)}
.atl-js.on{border-style:solid;border-color:var(--accent);background:var(--accent-wash)}
.atl-main{min-width:0;display:flex;flex-direction:column;gap:12px}
.atl-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.atl-ev{border:1px solid var(--hairline);border-radius:var(--r-s);padding:10px 12px;background:var(--tint);display:flex;flex-direction:column;gap:3px;min-width:0}
.atl-ev.pr{border-color:var(--up);background:var(--up-wash)}
.atl-ev-h{display:flex;gap:6px;align-items:center;font-size:11.5px;font-weight:800;color:var(--ink-2);text-transform:uppercase;letter-spacing:.03em}
.atl-ev-d{font-size:18px;font-weight:800;color:var(--ink)}.atl-ev-pl{font-size:13.5px;font-weight:700}
.atl-ev-f,.atl-ev-s{font-size:12px;color:var(--ink-2)}.atl-ev-p{font-size:16px;color:var(--ink)}
.atl-ev-np{font-size:12px;color:var(--brass-ink);font-weight:700}.atl-ev-none{font-size:12.5px;color:var(--ink-3);margin:0}
.atl-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.atl-f{border:1px solid var(--hairline);border-radius:var(--r-s);padding:8px 10px;display:flex;flex-direction:column;gap:2px}
.atl-f .k{font-size:11.5px;color:var(--ink-2);display:flex;gap:4px;align-items:center}.atl-f b{font-size:17px}.atl-f .s{font-size:11px;color:var(--ink-3)}
.atl-mode{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.03em;border-radius:99px;padding:1px 8px;border:1px solid var(--hairline);white-space:nowrap}
.atl-mode.m-EXACT{border-color:var(--up);color:var(--up)}.atl-mode.m-AGGREGATED{border-color:var(--accent);color:var(--accent-deep)}
.atl-mode.m-CONTEXT{border-color:var(--brass);color:var(--brass-ink);background:var(--wash-brass)}.atl-mode.m-NOT_AVAILABLE,.atl-mode.m-NOT_APPLICABLE{color:var(--ink-3)}
.atl-ctx{font-size:12px;color:var(--ink-2);margin:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.atl-h{font-size:13px;font-weight:800;margin:4px 0 6px;display:flex;gap:6px;align-items:center}
.atl-cnt{font-size:11px;color:var(--ink-3);font-weight:700}
.atl-note{font-size:11.5px;color:var(--ink-3);margin:4px 0 0}
.atl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}.atl-tall{max-height:360px;overflow-y:auto}
.atl-t{width:100%;border-collapse:collapse;font-size:12.5px}.atl-t th{font-size:11px;color:var(--ink-2);text-align:start;font-weight:700;padding:5px 6px;border-bottom:1px solid var(--edge);white-space:nowrap}
.atl-t td{padding:4px 6px;border-bottom:1px solid var(--hairline);vertical-align:top}.atl-t td.num{white-space:nowrap}
.atl-go{font:inherit;border:0;background:none;color:var(--accent-deep);cursor:pointer;padding:2px 0;text-align:start;font-weight:700;min-height:28px}
.atl-go:hover{text-decoration:underline}
.atl-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.atl-chips .atl-go{border:1px solid var(--hairline);border-radius:99px;padding:3px 10px;background:var(--panel-2);font-weight:600}
.atl-kids{display:flex;flex-direction:column;gap:10px}.atl-kq,.atl-sq{width:100%;max-width:360px}
.atl-nat{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px;margin-top:14px;padding-top:12px;border-top:1px solid var(--hairline)}
.atl-nat>*,.atl-grid>*,.atl-kids>*{min-width:0}
.atl-nbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:2px 10px;max-height:150px;overflow:auto;font-size:12.5px}
.atl-cov{list-style:none;margin:0;padding:0;display:grid;gap:3px;font-size:12.5px}
.atl-mx{margin-top:14px;border-top:1px solid var(--hairline);padding-top:10px}.atl-mx summary{cursor:pointer;font-size:13px;font-weight:800;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.atl-mxt td:nth-child(3){color:var(--ink-2);min-width:240px}
.atl-open{font-size:12px;color:var(--accent-deep)}
.atl-err{padding:12px;border:1px solid var(--down);border-radius:var(--r-s);background:var(--down-wash);font-size:13px}
@media (max-width:820px){.atl-grid{grid-template-columns:minmax(0,1fr)}.atl-map{flex-direction:row;flex-wrap:wrap;align-items:flex-start}.atl-svg{max-width:150px;max-height:300px}.atl-map .atl-note{flex:1 1 140px}.atl-nat{grid-template-columns:minmax(0,1fr)}}
@media (max-width:560px){.atl{padding:12px}.atl-pair{grid-template-columns:1fr}.atl-up{width:100%}.atl-svg{max-width:120px}}
`;
  document.head.appendChild(css);

  window.PropxAtlas = { go, state: () => AT, banners };
  render();
  load('il');
}());
