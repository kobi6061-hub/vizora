// PROPX · CBS new-home sales — the official series PROPX reads, and nothing else.
//
// Source (verified 13.10.2026 on a GitHub runner, scripts/cbs-sales-discover.js): the Central Bureau of Statistics
// time-series API, subject 44 "בינוי ונדל"ן" → 44,10 "דירות בעסקאות נדל"ן" (real-estate transactions — dwellings).
// The API publishes new-dwelling sales MONTHLY for the whole country and its 7 districts only. There is no locality
// (city) series in the API: CBS publishes city figures only inside the monthly media-release PDF ("לוח ב" — the
// localities where more than 150 dwellings were sold in a rolling three-month window), which is not a machine-readable
// source and is not ingested (see lib/cbs-sales/README.md).
//
// Geography is keyed by the CBS code the API itself returns (path.name_id) — never by a name.

'use strict';

const SERIES_BASE = 'https://apis.cbs.gov.il/series';
const UA = 'PROPX-cbs-sales-sync/1.0 (+https://propx.live)';

const SOURCE = {
  id: 'cbs:new-home-sales',
  publisher: 'הלשכה המרכזית לסטטיסטיקה', publisherEn: 'Central Bureau of Statistics',
  dataset: 'דירות בעסקאות נדל"ן — דירות חדשות שנמכרו (סדרות עתיות, נושא 44)',
  datasetEn: 'Real-estate transactions — new dwellings sold (time series, subject 44)',
  api: SERIES_BASE + '/data/path',
  catalog: SERIES_BASE + '/catalog/path?id=44,10&format=json&download=false&lang=he',
  page: 'https://www.cbs.gov.il/he/subjects/Pages/דירות-בעסקאות-נדלן.aspx',
  /* CBS's own words for what is counted */
  definition: {
    he: 'דירות חדשות שנמכרו בתקופה — מספר דירות (נתונים מקוריים, חודשי). כולל דירות שנמכרו בסבסוד ממשלתי (מחיר למשתכן / מחיר מטרה ודומיהם). הנתונים מעובדים מעסקאות הנדל"ן המדווחות לרשות המסים.',
    en: 'New dwellings sold in the period — number of dwellings (original data, monthly). Includes dwellings sold with a government subsidy (Mechir LaMishtaken / Mechir Matara and similar). Compiled from the real-estate transactions reported to the Tax Authority.',
  },
  population: {
    he: 'דירות חדשות שנמכרו (מכירה ראשונה של דירה חדשה) — לא דירות יד שנייה; ארצי ולפי מחוז בלבד',
    en: 'new dwellings sold (the first sale of a new dwelling) — not second-hand; national and by district only',
  },
  cadence: { he: 'חודשי — הודעה לתקשורת כ-6 שבועות אחרי סוף החודש', en: 'monthly — a media release about 6 weeks after the month ends' },
  revisions: {
    he: 'החודשים האחרונים מתעדכנים בהודעות הבאות (נצפה: תל אביב-יפו מרץ–מאי 2026 — 1,137 בהודעה 216/2026, 1,210 בהודעה 317/2026). PROPX שומר כל גרסה.',
    en: 'recent months are revised in later releases (observed: Tel Aviv-Yafo Mar–May 2026 — 1,137 in release 216/2026, 1,210 in release 317/2026). PROPX keeps every version.',
  },
};

/* the CBS district codes the API returns (path.name_id) → the PROPX board row. 5076 has no board row. */
const GEOS = [
  { cbs: 5069, key: 'il', level: 'national', he: 'ישראל — סך הכל', en: 'Israel — total', note: { he: 'כולל מחוז לא ידוע', en: 'includes unknown district' } },
  { cbs: 5070, key: 'd-jm', level: 'district', he: 'מחוז ירושלים', en: 'Jerusalem District' },
  { cbs: 5071, key: 'd-north', level: 'district', he: 'מחוז הצפון', en: 'Northern District' },
  { cbs: 5072, key: 'd-haifa', level: 'district', he: 'מחוז חיפה', en: 'Haifa District' },
  { cbs: 5073, key: 'd-center', level: 'district', he: 'מחוז המרכז', en: 'Central District' },
  { cbs: 5074, key: 'd-ta', level: 'district', he: 'מחוז תל אביב', en: 'Tel Aviv District' },
  { cbs: 5075, key: 'd-south', level: 'district', he: 'מחוז הדרום', en: 'Southern District' },
  { cbs: 5076, key: 'jsr', level: 'district', he: 'אזור יהודה והשומרון', en: 'Judea and Samaria Area', note: { he: 'יישובים ישראליים', en: 'Israeli localities' } },
];
/* the WHOLE-MARKET measures (21.10.2026, discovery candidate cbs:series:second-hand-sales-by-district): the second-hand and the
   subsidized-by-district branches use a SECOND code set (7047–7053) whose order is not documented — each code's district is read from the
   NAME the API returns with it (exactly one district pattern must match), never from its position; the total-sold branch uses 5070–5076
   and its names are checked against the expected district too. A name that matches no district, or two, is a schema change. */
const DISTRICT_NAME = Object.freeze({ 'd-jm': /ירושלים/, 'd-north': /צפון/, 'd-haifa': /חיפה/, 'd-center': /מרכז/, 'd-ta': /תל[\s-]*אביב/, 'd-south': /דרום/, jsr: /יהודה|שומרון|איו"ש/ });
const GEOS_B = [7047, 7048, 7049, 7050, 7051, 7052, 7053].map((cbs) => ({ cbs, key: null, level: 'district', codeSet: 'B', he: `קוד מחוז ${cbs} (לפי השם בתשובה)`, en: `CBS district code ${cbs} (district read from the name in the response)` }));
const GEO_BY_CBS = Object.fromEntries([...GEOS, ...GEOS_B].map((g) => [g.cbs, g]));
const GEO_BY_KEY = Object.fromEntries(GEOS.map((g) => [g.key, g]));
/** the district key a name returned by the API denotes: exactly one pattern, else null */
function districtOfName(name) { const hits = Object.entries(DISTRICT_NAME).filter(([, re]) => re.test(String(name || ''))).map(([k]) => k); return hits.length === 1 ? hits[0] : null; }

/* the measures: path in the catalogue (level3 = the branch, level4 where the branch has one) */
const MEASURES = {
  new_sold: { path: '44,10,2,1', level3: 2, level4: 1, geos: GEOS.map((g) => g.cbs), dataKind: 1,
    he: 'דירות חדשות שנמכרו', en: 'new dwellings sold' },
  new_sold_subsidized: { path: '44,10,2,2', level3: 2, level4: 2, geos: [5069], dataKind: 1,
    he: 'מתוכן בסבסוד ממשלתי', en: 'of which government-subsidized' },
  inventory: { path: '44,10,4,', level3: 4, level4: null, geos: [5069], dataKind: 1,
    he: 'דירות חדשות שנותרו למכירה בסוף החודש', en: 'new dwellings remaining for sale at month end' },
  months_supply: { path: '44,10,5,', level3: 5, level4: null, geos: [5069], dataKind: 371,
    he: 'חודשי היצע לדירות חדשות (ממוצע על סמך נתוני מגמה)', en: 'months of supply, new dwellings (average based on trend data)' },
  /* the whole market (21.10.2026) — separate universes, never added to new_sold on the board */
  total_sold: { path: '44,10,6,', level3: 6, level4: null, geos: [5069, 5070, 5071, 5072, 5073, 5074, 5075, 5076], dataKind: 1, verifyName: true, market: true,
    he: 'סך הדירות שנמכרו — חדשות ויד שנייה', en: 'all dwellings sold — new and second-hand' },
  second_hand_sold: { path: '44,10,7,', level3: 7, level4: null, geos: [5069, ...GEOS_B.map((g) => g.cbs)], dataKind: 1, verifyName: true, market: true,
    he: 'דירות יד שנייה שנמכרו', en: 'second-hand dwellings sold' },
  subsidized_by_district: { path: '44,10,2,2', level3: 2, level4: 2, geos: GEOS_B.map((g) => g.cbs), dataKind: 1, verifyName: true, market: true,
    he: 'דירות חדשות שנמכרו בסבסוד ממשלתי (לפי מחוז)', en: 'new dwellings sold with a government subsidy (by district)' },
};
/* CBS "data" kinds seen in the API: 1 original, 2 seasonally adjusted, 3 trend, 371 average based on trend data */
const DATA_KIND = { 1: 'original', 2: 'sa', 3: 'trend', 371: 'trend_avg' };
/* CBS "time" kinds: 3 month, 1 year */
const TIME_KIND = { 3: 'M', 1: 'Y' };

const FIRST_YEAR = 2016;   /* 60+ months; the CBS trend chart in the releases starts here */

/** the request windows: each ≤ 6 years so no series is cut by the API's per-page size */
function windows(now = new Date()) {
  const y = now.getUTCFullYear();
  const out = [];
  for (let a = FIRST_YEAR; a <= y; a += 6) out.push([a, Math.min(a + 5, y)]);
  return out;
}
const pad2 = (n) => String(n).padStart(2, '0');
/* the catalogue path of one geography: 44,10,2,1 + 5074 → 44,10,2,1,5074 · 44,10,4, (no level 4) + 5069 → 44,10,4,,5069 */
const pathId = (measure, cbs) => `${MEASURES[measure].path},${cbs}`;   /* subsidized_by_district: 44,10,2,2,7051 */
function urlFor(measure, cbs, win) {
  return `${SERIES_BASE}/data/path?id=${pathId(measure, cbs)}&format=json&download=false&lang=he&startperiod=01-${win[0]}&endperiod=12-${win[1]}`;
}
/** every request one sync makes */
function plan(now = new Date()) {
  const out = [];
  for (const [measure, m] of Object.entries(MEASURES)) for (const cbs of m.geos) for (const w of windows(now)) out.push({ measure, cbs, window: w, url: urlFor(measure, cbs, w) });
  return out;
}

module.exports = { SOURCE, GEOS, GEOS_B, DISTRICT_NAME, districtOfName, GEO_BY_CBS, GEO_BY_KEY, MEASURES, DATA_KIND, TIME_KIND, SERIES_BASE, UA, FIRST_YEAR, windows, plan, pathId, urlFor, pad2 };
