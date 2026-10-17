// PROPX · Revision Intelligence — official figures that were revised, read from the append-only CBS ledger.
//
// CBS revises recent months in later releases. PROPX never overwrites: every published value is a record in
// data/cbs-sales/observations.jsonl with its revision number and the value it replaces (lib/cbs-sales/ledger.js). This
// module turns those records into a dated revision ledger — OLD VALUE · NEW VALUE · OBSERVATION PERIOD · PUBLICATION
// (the CBS series update date) · PROPX CHECK (when the revision was read) — grouped by the release that revised them,
// with the materiality of each change stated by rule (|Δ| ≥ 5% = material, a constant, never a model).
// Nothing is fetched; nothing is estimated; a revision of 0 is listed like any other.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', 'data');
const DAY = 86400e3;
const MATERIAL_PCT = 5;
const SOURCE = 'cbs:timeseries:44,10';
const MEASURE = {
  new_sold: { he: 'דירות חדשות שנמכרו', en: 'new dwellings sold' },
  new_sold_subsidized: { he: 'דירות חדשות שנמכרו — בסבסוד ממשלתי', en: 'new dwellings sold — government-subsidized' },
  inventory: { he: 'מלאי דירות חדשות שטרם נמכרו', en: 'unsold new-dwelling inventory' },
  months_supply: { he: 'חודשי היצע', en: 'months of supply' },
};
const bi = (he, en) => ({ he, en });
const readLines = (f) => { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; } const out = []; for (const l of t.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* torn line */ } } return out; };
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const pct = (o, n) => (Number.isFinite(o) && o !== 0 && Number.isFinite(n) ? Math.round(((n - o) / o) * 1000) / 10 : null);

let cache = { key: null, value: null };
function ledger(dataDir) {
  const f = path.join(dataDir, 'cbs-sales', 'observations.jsonl');
  let st = null; try { st = fs.statSync(f); } catch { /* absent */ }
  const key = st ? `${f}|${st.mtimeMs}|${st.size}` : null;
  if (key && cache.key === key) return cache.value;
  const rows = readLines(f);
  const latest = readJson(path.join(dataDir, 'cbs-sales', 'latest.json'));
  const geoName = {}; if (latest && latest.geos) for (const [k, g] of Object.entries(latest.geos)) geoName[k] = g.name || { he: k, en: k };
  cache = { key, value: { rows, geoName } };
  return cache.value;
}

/** every revision record → one ledger item (the record is the NEW value; `replaces` the one it superseded) */
function items({ dataDir = ROOT } = {}) {
  const L = ledger(dataDir);
  return L.rows.filter((r) => (r.revision || 0) > 0 && r.replaces != null).map((r) => {
    const p = pct(r.replaces, r.value);
    return { id: `${r.key}#${r.revision}`, key: r.key, measure: r.measure, measureLabel: MEASURE[r.measure] || bi(r.measure, r.measure), geo: r.geo, geoName: L.geoName[r.geo] || bi(r.geo, r.geo), cbs: r.cbs,
      freq: r.freq || null, period: r.period, oldValue: r.replaces, newValue: r.value, delta: Number.isFinite(r.value) && Number.isFinite(r.replaces) ? r.value - r.replaces : null, pct: p,
      material: p != null && Math.abs(p) >= MATERIAL_PCT, materialRule: `|Δ| ≥ ${MATERIAL_PCT}%`, revision: r.revision,
      publishedAt: r.sourceUpdate || null, previousPublishedAt: r.replacesUpdate || null, observedAt: r.fetchedAt || null, snapshot: r.snapshot || null,
      source: SOURCE, cls: 'OFFICIAL' };
  }).sort((a, b) => (b.observedAt || '').localeCompare(a.observedAt || '') || b.period.localeCompare(a.period));
}

/**
 * The revision ledger view: window=30d|90d|365d|all (by PROPX observation date), material=1, measure, geo, page, size.
 * Grouped by release (publication date) with the net effect per geography and the material changes named.
 */
function revisions(params = {}, opt = {}) {
  const dataDir = opt.dataDir || ROOT, now = opt.now || Date.now();
  const WIN = { '30d': 30, '90d': 90, '365d': 365, all: 100000 };
  const win = WIN[params.window] ? params.window : '90d';
  const sinceT = now - WIN[win] * DAY;
  const sinceIso = win === 'all' ? null : new Date(sinceT).toISOString();
  const all = items({ dataDir });
  let rows = all.filter((x) => !x.observedAt || Date.parse(x.observedAt) >= sinceT);
  if (params.material === '1' || params.material === true) rows = rows.filter((x) => x.material);
  if (params.measure) rows = rows.filter((x) => x.measure === params.measure);
  if (params.geo) rows = rows.filter((x) => x.geo === params.geo);
  const releases = new Map();
  for (const x of rows) {
    const k = x.publishedAt || 'unknown';
    const R = releases.get(k) || { publishedAt: x.publishedAt, observedAt: x.observedAt, revisions: 0, material: 0, measures: {}, byGeo: {}, byGeoBasis: 'net Δ of the MONTHLY new_sold revisions per geography (annual rows are the same revisions aggregated — not added)' };
    R.revisions++; if (x.material) R.material++; R.measures[x.measure] = (R.measures[x.measure] || 0) + 1;
    if (x.measure === 'new_sold' && x.freq === 'M' && x.delta != null) { const g = R.byGeo[x.geo] || { geo: x.geo, name: x.geoName, periods: 0, netDelta: 0, from: x.period, to: x.period }; g.periods++; g.netDelta += x.delta; if (x.period < g.from) g.from = x.period; if (x.period > g.to) g.to = x.period; R.byGeo[x.geo] = g; }
    if (x.observedAt && (!R.observedAt || x.observedAt > R.observedAt)) R.observedAt = x.observedAt;
    releases.set(k, R);
  }
  const size = Math.max(1, Math.min(200, Number(params.size) || 60)), pages = Math.max(1, Math.ceil(rows.length / size)), page = Math.max(1, Math.min(pages, Number(params.page) || 1));
  return {
    basis: bi('תיקון = ערך רשמי שפורסם מחדש בערך אחר לאותה תקופה. הערך הישן נשמר לצד החדש (יומן הוסף-בלבד); "מהותי" = |Δ| ≥ 5% — כלל קבוע, לא מודל. תאריך הפרסום הוא תאריך העדכון של סדרת הלמ״ס; "נצפה" = מתי PROPX קראה את התיקון.',
      'A revision = an official value re-published with a different value for the same period. The old value is kept beside the new one (append-only ledger); "material" = |Δ| ≥ 5% — a constant rule, not a model. The publication date is the CBS series update date; "observed" = when PROPX read the revision.'),
    source: SOURCE, cls: 'OFFICIAL', materialRule: `|Δ| ≥ ${MATERIAL_PCT}%`, window: win, since: sinceIso, generatedAt: new Date(now).toISOString(),
    totals: { all: all.length, inWindow: rows.length, material: rows.filter((x) => x.material).length, measures: MEASURE },
    releases: [...releases.values()].map((R) => ({ ...R, byGeo: Object.values(R.byGeo).sort((a, b) => Math.abs(b.netDelta) - Math.abs(a.netDelta)) })).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')),
    page, pages, size, rows: rows.slice((page - 1) * size, page * size),
  };
}

module.exports = { revisions, items, MATERIAL_PCT, MEASURE, SOURCE };
