// PROPX · CBS construction — the official series PROPX reads (building permits · construction starts · completions ·
// active construction), for the country and its 7 districts, and nothing else.
//
// Source (audited 17.10.2026 on a GitHub runner, lib/trust/discovery/2026-10-17.json → cbs:series:construction-by-district):
// the Central Bureau of Statistics time-series API, subject 44 "בינוי ונדל"ן" — the SAME API, response shape and
// request format the new-home sales lane reads (lib/cbs-sales). Four branches:
//   44,11,2  היתרי בנייה — דירות (building permits, dwellings)         geography = name_id 271–277, total = 1
//   44,2,3   התחלות בנייה — דירות לפי מחוז (construction starts)        geography = level-4 code 1–7, total = 8
//   44,3,3   גמר בנייה — דירות לפי מחוז (completions)                   geography = level-4 code 1–7, total = 8
//   44,4,3   בנייה פעילה — דירות לפי מחוז (active construction, a STOCK) geography = level-4 code 1–7, total = 8
// The geography code sets differ per branch (the discovery's own limitation #4), so every branch has its own table,
// and the catalogue is walked at sync time (lib/construction/resolve.js) to verify each code against the node's name
// and to resolve the level-5 leaf under a district node. Stored data is keyed by the CBS node code the API returns —
// never by a name; the name is kept as a label. There is no locality (city) series in the API: the 269 level-5 nodes
// of subject 44 are all totals or districts (see lib/construction/README.md).
//
// The period kind is never assumed: the response says it (time.value 3 month / 4 quarter / 1 year) and every
// observation is stored with it (lib/construction/parse.js).

'use strict';

const SALES = require('../cbs-sales/series');   /* the same API: base URL, request windows */

const SERIES_BASE = SALES.SERIES_BASE;
const UA = 'PROPX-cbs-construction-sync/1.0 (+https://propx.live)';

const SOURCE = {
  id: 'cbs:construction',
  publisher: 'הלשכה המרכזית לסטטיסטיקה', publisherEn: 'Central Bureau of Statistics',
  dataset: 'בינוי — היתרי בנייה, התחלות בנייה, גמר בנייה ובנייה פעילה: דירות, ארצי ולפי מחוז (סדרות עתיות, נושא 44)',
  datasetEn: 'Construction — building permits, construction starts, completions and active construction: dwellings, national and by district (time series, subject 44)',
  api: SERIES_BASE + '/data/path',
  catalog: SERIES_BASE + '/catalog/level?id=5&subject=44&format=json&download=false&lang=he',
  catalogSubject: SERIES_BASE + '/catalog/path?id=44&format=json&download=false&lang=he',
  discovery: 'cbs:series:construction-by-district',   /* the audited candidate this lane integrates (lib/trust/discovery/2026-10-17.json) */
  /* CBS's own semantics, one line per measure — permits ≠ starts ≠ completions ≠ active: four universes, never summed */
  definition: {
    he: 'היתרי בנייה = דירות בהיתרי בנייה שניתנו בתקופה · התחלות בנייה = דירות שבנייתן החלה בתקופה · גמר בנייה = דירות שבנייתן הסתיימה בתקופה · בנייה פעילה = דירות בבנייה בסוף התקופה (מלאי). נתונים מקוריים, מספר דירות.',
    en: 'Building permits = dwellings in building permits issued in the period · construction starts = dwellings whose construction began in the period · completions = dwellings whose construction was completed in the period · active construction = dwellings under construction at the end of the period (a stock). Original data, number of dwellings.',
  },
  population: {
    he: 'דירות (לא שטח, לא בניינים); ארצי ולפי מחוז בלבד — אין סדרת יישוב',
    en: 'dwellings (not floor area, not buildings); national and by district only — no locality series',
  },
  cadence: { he: 'הודעת בנייה רבעונית — כ-10 שבועות אחרי סוף הרבעון; הנתונים החודשיים מתפרסמים עם הרבעון', en: 'a quarterly construction release about 10 weeks after the quarter ends; monthly figures appear with the quarter' },
  revisions: {
    he: 'חודשים ורבעונים אחרונים מתעדכנים בהודעות הבאות; ה-API נושא רק את הערך הנוכחי — PROPX שומר כל גרסה.',
    en: 'recent months and quarters are revised in later releases; the API carries only the current value — PROPX keeps every version.',
  },
  /* the reporting-lag ASSUMPTION the freshness states rest on — documented, not a CBS statement (lib/construction/metrics.js) */
  lagAssumption: {
    he: 'הנחה (לא לוח פרסום רשמי): הודעת הבנייה הרבעונית מתפרסמת כ-10 שבועות אחרי סוף הרבעון (נצפה פעם אחת: רבעון 2 2026 → עדכון סדרה 10.09.2026, 72 ימים). CURRENT עד 60 ימים אחרי סוף הרבעון הבא; EXPECTED_REPORTING_LAG 60–120 ימים; STALE מעבר לכך.',
    en: 'Assumption (not an official release calendar): the quarterly construction release appears about 10 weeks after the quarter ends (observed once: Q2 2026 → series update 2026-09-10, 72 days). CURRENT up to 60 days after the next quarter ends; EXPECTED_REPORTING_LAG 60–120 days; STALE beyond.',
    observed: [{ quarter: '2026-Q2', quarterEnd: '2026-06-30', seriesUpdate: '2026-09-10', days: 72 }],
  },
};

/* the 8 geographies, one table; the per-branch CBS codes sit in MEASURES. `match` finds the node by its catalogue name at
   sync time (the name is only used to VERIFY the code — the code keys the data). */
const GEOS = [
  { key: 'il', level: 'national', he: 'ישראל — סך הכל', en: 'Israel — total', match: /^\s*(סך הכל|סה"כ|סה״כ|סך-הכל|ישראל)\s*$/ },
  { key: 'd-jm', level: 'district', he: 'מחוז ירושלים', en: 'Jerusalem District', match: /ירושלים/ },
  { key: 'd-north', level: 'district', he: 'מחוז הצפון', en: 'Northern District', match: /צפון/ },
  { key: 'd-haifa', level: 'district', he: 'מחוז חיפה', en: 'Haifa District', match: /חיפה/ },
  { key: 'd-center', level: 'district', he: 'מחוז המרכז', en: 'Central District', match: /מרכז/ },
  { key: 'd-ta', level: 'district', he: 'מחוז תל אביב', en: 'Tel Aviv District', match: /תל[ -]אביב/ },
  { key: 'd-south', level: 'district', he: 'מחוז הדרום', en: 'Southern District', match: /דרום/ },
  { key: 'jsr', level: 'district', he: 'אזור יהודה והשומרון', en: 'Judea and Samaria Area', match: /יהודה|יו"ש|יו״ש/, note: { he: 'יישובים ישראליים', en: 'Israeli localities' } },
];
const GEO_BY_KEY = Object.fromEntries(GEOS.map((g) => [g.key, g]));
const DISTRICT_KEYS = GEOS.filter((g) => g.level === 'district').map((g) => g.key);

/* the level-4 district codes of the three "by district" branches (discovery: 1 ירושלים · 2 הצפון · 3 חיפה · 4 המרכז ·
   5 תל אביב · 6 הדרום · 7 יו"ש · 8 סך הכל) */
const LEVEL4_CODES = { il: 8, 'd-jm': 1, 'd-north': 2, 'd-haifa': 3, 'd-center': 4, 'd-ta': 5, 'd-south': 6, jsr: 7 };
/* the name_id codes of the permits branch (discovery: 271..277 in CBS district order, total = 1; 275 = Tel Aviv and 1 = total
   read on the runner, the others inferred from the order — every one is verified against the catalogue name at sync time) */
const PERMIT_CODES = { il: 1, 'd-jm': 271, 'd-north': 272, 'd-haifa': 273, 'd-center': 274, 'd-ta': 275, 'd-south': 276, jsr: 277 };

/**
 * The measures. `geoLevel` says where the branch keeps its geography: 'level4' (the district is path.level4, the leaf
 * path.name_id is resolved from the catalogue — "סך הכל" expected) or 'name_id' (the district is path.name_id, level4 empty).
 * `kind`: 'flow' (dwellings in the period — sums over periods are meaningful) or 'stock' (dwellings at period end — never summed).
 */
const MEASURES = {
  permits: { id: 'permits', path: '44,11,2', level2: 11, level3: 2, level4: null, geoLevel: 'name_id', kind: 'flow', dataKind: 1, codes: PERMIT_CODES,
    he: 'היתרי בנייה — דירות', en: 'building permits — dwellings',
    semantics: { he: 'דירות בהיתרי בנייה שניתנו בתקופה', en: 'dwellings in building permits issued in the period' },
    verified: ['44,11,2,,275', '44,11,2,,1'] },
  starts: { id: 'starts', path: '44,2,3', level2: 2, level3: 3, geoLevel: 'level4', kind: 'flow', dataKind: 1, codes: LEVEL4_CODES,
    he: 'התחלות בנייה — דירות', en: 'construction starts — dwellings',
    semantics: { he: 'דירות שבנייתן החלה בתקופה', en: 'dwellings whose construction began in the period' },
    verified: ['44,2,3,8,2'] },
  completions: { id: 'completions', path: '44,3,3', level2: 3, level3: 3, geoLevel: 'level4', kind: 'flow', dataKind: 1, codes: LEVEL4_CODES,
    he: 'גמר בנייה — דירות', en: 'completions — dwellings',
    semantics: { he: 'דירות שבנייתן הסתיימה בתקופה', en: 'dwellings whose construction was completed in the period' },
    verified: ['44,3,3,8,2'] },
  active: { id: 'active', path: '44,4,3', level2: 4, level3: 3, geoLevel: 'level4', kind: 'stock', dataKind: 1, codes: LEVEL4_CODES,
    he: 'בנייה פעילה — דירות בבנייה בסוף התקופה', en: 'active construction — dwellings under construction at period end',
    semantics: { he: 'דירות בבנייה בסוף התקופה (מלאי, לא זרם — לא מסוכם על פני תקופות)', en: 'dwellings under construction at the end of the period (a stock, not a flow — never summed over periods)' },
    verified: ['44,4,3,8,2'] },
};
const MEASURE_IDS = Object.keys(MEASURES);

/* CBS "data" kinds: 1 original, 2 seasonally adjusted, 3 trend — only the original is read */
const DATA_KIND = { 1: 'original', 2: 'sa', 3: 'trend' };
/* CBS "time" kinds seen in subject 44: 3 month, 4 quarter, 1 year — stored with every observation, never assumed */
const TIME_KIND = { 3: 'M', 4: 'Q', 1: 'Y' };

const FIRST_YEAR = 2016;   /* the same depth as the sales lane; the API serves earlier periods on request */
const windows = (now = new Date()) => SALES.windows(now).map(([a, b]) => [Math.max(a, FIRST_YEAR), b]);

/** the catalogue path of one geography of one measure, once its codes are known */
function pathIdOf(measure, code, leaf) {
  const M = MEASURES[measure];
  if (!M) throw new Error('unknown measure ' + measure);
  if (M.geoLevel === 'name_id') return `${M.path},,${code}`;
  if (leaf == null || leaf === '') throw new Error(`${measure}: a level-4 branch needs the resolved leaf`);
  return `${M.path},${code},${leaf}`;
}
const catalogUrl = (id) => `${SERIES_BASE}/catalog/path?id=${encodeURIComponent(id)}&format=json&download=false&lang=he`;
const urlFor = (pathId, win) => `${SERIES_BASE}/data/path?id=${pathId}&format=json&download=false&lang=he&startperiod=01-${win[0]}&endperiod=12-${win[1]}`;

/**
 * every data request one sync makes, from a resolution (lib/construction/resolve.js): only geographies whose code was
 * verified against the catalogue (status 'resolved') are requested — a mismatch or an unresolved node is never guessed.
 */
function plan(resolution, now = new Date()) {
  const out = [];
  for (const measure of MEASURE_IDS) {
    const R = resolution && resolution.measures && resolution.measures[measure];
    if (!R || !R.geos) continue;
    for (const g of GEOS) {
      const x = R.geos[g.key];
      if (!x || x.status !== 'resolved') continue;
      for (const w of windows(now)) out.push({ measure, geo: g.key, cbs: x.code, leaf: x.leaf ?? null, pathId: x.pathId, window: w, url: urlFor(x.pathId, w) });
    }
  }
  return out;
}

module.exports = { SOURCE, GEOS, GEO_BY_KEY, DISTRICT_KEYS, MEASURES, MEASURE_IDS, LEVEL4_CODES, PERMIT_CODES, DATA_KIND, TIME_KIND, SERIES_BASE, UA, FIRST_YEAR, windows, pathIdOf, catalogUrl, urlFor, plan };
