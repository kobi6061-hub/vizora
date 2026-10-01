// PROPX · official market indicators — source connectors.
//
// Each connector reads ONE documented, keyless, official endpoint and
// returns a normalized indicator, or throws. A connector never estimates,
// fills, or carries a value forward: keeping the last good value when a
// source is down is the snapshot layer's job (lib/market/snapshot.js), and
// it marks that value stale instead of passing it off as fresh.
//
//   Bank of Israel policy rate
//     https://www.boi.org.il/PublicApi/GetInterest
//     (public API documented in the BoI website Q&A) →
//     {currentInterest, nextInterestDate, lastPublishedDate}
//
//   CBS dwelling-price indices (new homes · all dwellings)
//     https://api.cbs.gov.il/index/data/price_all          — discovery
//     https://api.cbs.gov.il/index/data/price?id=<code>    — the series
//     Series are DISCOVERED BY NAME from the CBS index API, never by a
//     hardcoded code: a CBS renumbering degrades to a clear failure, never
//     to a different series silently. CBS requires a User-Agent header.
//
// Runs only where the official hosts are reachable (GitHub Actions, Vercel,
// a workstation) — see scripts/market-sync.js and .github/workflows/.

'use strict';

const UA = 'PROPX-market-sync/1.0 (+https://propx.live)';
const TIMEOUT_MS = 20000;

const BOI_URL = 'https://www.boi.org.il/PublicApi/GetInterest';
const CBS_ALL_URL = 'https://api.cbs.gov.il/index/data/price_all?lang=he&format=json&download=false';
const CBS_CATALOG_URL = 'https://api.cbs.gov.il/index/catalog/catalog?lang=he&format=json&download=false';
const CBS_CHAPTER_URL = (id) =>
  `https://api.cbs.gov.il/index/catalog/chapter?id=${encodeURIComponent(id)}&lang=he&format=json&download=false`;
const CBS_SERIES_URL = (code, last) =>
  `https://api.cbs.gov.il/index/data/price?id=${encodeURIComponent(code)}&format=json&download=false&lang=he&last=${last}`;

class SourceError extends Error {
  constructor(source, reason) { super(`[${source}] ${reason}`); this.name = 'SourceError'; this.source = source; }
}

async function getJson(fetchImpl, url, source) {
  if (!fetchImpl) throw new SourceError(source, 'no fetch implementation in this runtime');
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    });
  } catch (e) {
    throw new SourceError(source, `request failed: ${e.message} (${url})`);
  }
  if (!res.ok) throw new SourceError(source, `HTTP ${res.status} from ${url}`);
  try { return await res.json(); } catch (e) { throw new SourceError(source, `invalid JSON from ${url}`); }
}

/* ------------------------------------------------------------------ BoI */

/** "2026-10-21T00:00:00Z" | "2026-10-21" | "21/10/2026" → "2026-10-21" or null */
function isoDay(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

async function fetchBoiRate({ fetchImpl, now = new Date() } = {}) {
  const body = await getJson(fetchImpl, BOI_URL, 'boi');
  const rate = Number(body && body.currentInterest);
  if (!Number.isFinite(rate) || rate < 0 || rate > 20) {
    throw new SourceError('boi', `currentInterest missing or implausible: ${JSON.stringify(body && body.currentInterest)}`);
  }
  // the next decision date is shown only when it is a real, upcoming date
  let next = isoDay(body.nextInterestDate);
  const today = now.toISOString().slice(0, 10);
  if (next && (next < today || next > new Date(now.getTime() + 200 * 864e5).toISOString().slice(0, 10))) next = null;
  return {
    value: Math.round(rate * 100) / 100,
    unit: '%',
    nextDecision: next,
    publishedAt: isoDay(body.lastPublishedDate),
    source: { authority: 'בנק ישראל', authorityEn: 'Bank of Israel', dataset: 'PublicApi/GetInterest', url: BOI_URL },
  };
}

/* ------------------------------------------------------------------ CBS */

// The index to show and the series that must never be mistaken for it.
const SERIES_RULES = {
  newHomesIndex: {
    label: 'new-homes price index',
    want: /דירות\s+חדשות/,
    reject: /(ללא|למעט|בהנחה|מחיר\s*למשתכן|מחוז|אזור|ירושלים|תל[\s-]*אביב|חיפה|צפון|דרום|מרכז|שרון|יד\s*שני)/,
  },
  dwellingsIndex: {
    label: 'dwellings price index (all dwellings)',
    want: /מחירי\s+(ה)?דירות/,
    reject: /(חדשות|יד\s*שני|ללא|למעט|בהנחה|מחוז|אזור|ירושלים|תל[\s-]*אביב|חיפה|צפון|דרום|מרכז|שרון|שכר|תשומה|בנייה|בניה)/,
  },
};

/** Collect every {code, name} pair in a CBS response, wherever it is nested. */
function collectSeries(node, out = new Map()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((c) => collectSeries(c, out)); return out; }
  const code = node.code ?? node.Code ?? node.id ?? node.Id;
  const name = node.name ?? node.Name ?? node.title ?? node.Title;
  if (code !== undefined && code !== null && typeof name === 'string' && /^\d{3,7}$/.test(String(code))) {
    if (!out.has(String(code))) out.set(String(code), { code: String(code), name: name.trim() });
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectSeries(v, out);
  return out;
}

function pickSeries(candidates, rule) {
  const hits = candidates.filter((c) => rule.want.test(c.name) && !rule.reject.test(c.name));
  // the plain national series has the shortest name ("מדד מחירי דירות חדשות")
  hits.sort((a, b) => a.name.length - b.name.length || Number(a.code) - Number(b.code));
  return hits[0] || null;
}

async function discoverCbsSeries({ fetchImpl } = {}) {
  let list = [];
  const tried = [];
  try {
    list = [...collectSeries(await getJson(fetchImpl, CBS_ALL_URL, 'cbs')).values()];
    tried.push(`price_all: ${list.length} series`);
  } catch (e) { tried.push(`price_all: ${e.message}`); }
  if (!Object.values(SERIES_RULES).every((r) => pickSeries(list, r))) {
    // fall back to walking the catalog chapter by chapter
    try {
      const chapters = [...collectChapters(await getJson(fetchImpl, CBS_CATALOG_URL, 'cbs'))];
      tried.push(`catalog: ${chapters.length} chapters`);
      for (const ch of chapters) {
        try {
          for (const s of collectSeries(await getJson(fetchImpl, CBS_CHAPTER_URL(ch), 'cbs')).values()) list.push(s);
        } catch (e) { tried.push(`chapter ${ch}: ${e.message}`); }
      }
    } catch (e) { tried.push(`catalog: ${e.message}`); }
  }
  const seen = new Map(list.map((s) => [s.code, s]));
  const candidates = [...seen.values()];
  const picks = {};
  for (const [key, rule] of Object.entries(SERIES_RULES)) picks[key] = pickSeries(candidates, rule);
  return { picks, candidates, tried };
}

/** Chapter ids from the CBS catalog ({chapters:[{chapterId|id, ...}]} or similar). */
function collectChapters(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((c) => collectChapters(c, out)); return out; }
  const id = node.chapterId ?? node.ChapterId ?? node.chapter_id;
  if (id !== undefined && id !== null && String(id).length <= 4) out.add(String(id));
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectChapters(v, out);
  return out;
}

/** Monthly points {year, month, value, percent, percentYear} from a CBS series body. */
function parseCbsPoints(body) {
  const pts = new Map();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    let year = node.year ?? node.Year;
    let month = node.month ?? node.Month;
    if ((year === undefined || month === undefined) && typeof node.date === 'string') {
      const m = node.date.match(/^(\d{4})-(\d{1,2})/);
      if (m) { year = m[1]; month = m[2]; }
    }
    const value = node.currBase && typeof node.currBase === 'object' ? node.currBase.value : node.value;
    if (year !== undefined && month !== undefined && value !== undefined && value !== null) {
      const y = Number(year), mo = Number(month);
      if (y > 1990 && mo >= 1 && mo <= 12 && Number.isFinite(Number(value))) {
        const num = (x) => (x === undefined || x === null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
        pts.set(`${y}-${mo}`, {
          year: y, month: mo, value: Number(value),
          percent: num(node.percent), percentYear: num(node.percentYear),
          base: node.currBase && node.currBase.baseDesc ? String(node.currBase.baseDesc) : null,
        });
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  })(body);
  return [...pts.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

const round1 = (x) => Math.round(x * 10) / 10;

async function fetchCbsIndex(key, series, { fetchImpl, now = new Date() } = {}) {
  if (!series) throw new SourceError('cbs', `${SERIES_RULES[key].label}: series not found in the CBS index API`);
  const url = CBS_SERIES_URL(series.code, 15);
  const pts = parseCbsPoints(await getJson(fetchImpl, url, 'cbs'));
  if (!pts.length) throw new SourceError('cbs', `series ${series.code} returned no readable points`);
  const last = pts[pts.length - 1];
  // y/y: the CBS-published figure when present, else computed from the
  // index level 12 months earlier on the same base
  let yoy = last.percentYear;
  if (yoy === null) {
    const prior = pts.find((p) => p.year === last.year - 1 && p.month === last.month);
    if (prior && prior.value > 0 && (!prior.base || !last.base || prior.base === last.base)) {
      yoy = (last.value / prior.value - 1) * 100;
    }
  }
  if (yoy === null || !Number.isFinite(yoy) || Math.abs(yoy) > 40) {
    throw new SourceError('cbs', `series ${series.code}: annual change unavailable or implausible (${yoy})`);
  }
  // a dwelling-price index lags ~2–3 months; older than 9 months means a dead series
  const ageMonths = (now.getUTCFullYear() - last.year) * 12 + (now.getUTCMonth() + 1 - last.month);
  if (ageMonths < 0 || ageMonths > 9) {
    throw new SourceError('cbs', `series ${series.code}: latest point ${last.year}-${last.month} is not current`);
  }
  return {
    yoy: round1(yoy),
    mom: last.percent === null ? null : round1(last.percent),
    level: last.value,
    base: last.base,
    period: { year: last.year, month: last.month },
    // CBS computes dwelling-price indices over two-month windows; the point is
    // dated by the window's second month (e.g. month 7 = June–July)
    periodKind: 'bimonthly',
    series: { code: series.code, name: series.name },
    source: { authority: 'הלשכה המרכזית לסטטיסטיקה', authorityEn: 'Central Bureau of Statistics', dataset: series.name, url },
  };
}

module.exports = {
  fetchBoiRate, discoverCbsSeries, fetchCbsIndex,
  parseCbsPoints, collectSeries, pickSeries, isoDay,
  SERIES_RULES, SourceError, BOI_URL, CBS_ALL_URL,
};
