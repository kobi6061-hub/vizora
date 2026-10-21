// PROPX · STREET REPORT — FAIR COMPARISON BENCHMARKS (DERIVED from the register sweep; lib/streets/evidence.js does the counting).
//
// A street is compared with its verified neighbourhood, its locality and its district only on the SAME POPULATION: priced dwelling deals
// of the register copy in the same 36-month window (whole property, ≥ ₪100,000 — evidence.js `priced`), the same sample states
// (SUPPORTED ≥ 10 · LIMITED 5–9 · INSUFFICIENT 1–4 · NONE), and — for the segment view — the same rooms band. The street and a
// neighbourhood use OBSERVED deals (every address of the parcel on the street); a locality and a district use every address state (the
// locality is certain). A district figure is the median of its localities' deals pooled — never an average of locality medians.
//
// `segmentStats` is pure; `build` writes data/streets/benchmarks.json (scripts/street-benchmarks-build.js) for the locality and district
// rows, stamped with the evidence copy it was built from — a report reading a benchmark of another copy says so and shows none.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const EV = require('./evidence');
const SD = require('./directory');

const FILE = process.env.STREET_BENCHMARKS_FILE || path.join(__dirname, '..', '..', 'data', 'streets', 'benchmarks.json');
const BANDS = Object.freeze(['≤2.5', '3–3.5', '4–4.5', '5+']);
const bandOf = (rooms) => (rooms == null ? null : rooms < 3 ? '≤2.5' : rooms < 4 ? '3–3.5' : rooms < 5 ? '4–4.5' : '5+');

const median = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (v, k) => (v == null ? null : Math.round(v / k) * k);
const stateOf = (n) => (n >= EV.SAMPLE.SUPPORTED ? EV.STATE.SUPPORTED : n >= EV.SAMPLE.LIMITED ? EV.STATE.LIMITED : n > 0 ? EV.STATE.INSUFFICIENT : EV.STATE.NONE);

/** the comparison figures of one deal set (pure): every priced dwelling deal, and per rooms band — a median only where the state allows */
function segmentStats(deals) {
  const priced = deals.filter((d) => d.dwelling && d.priced);
  const one = (xs) => {
    const sqm = xs.filter((d) => d.pricePerSqm != null).map((d) => d.pricePerSqm);
    const st = stateOf(xs.length), show = st === EV.STATE.SUPPORTED || st === EV.STATE.LIMITED;
    return { priced: xs.length, withSqm: sqm.length, state: st, medianPrice: show ? round(median(xs.map((d) => d.amount)), 1000) : null,
      medianPricePerSqm: show && sqm.length >= EV.SAMPLE.LIMITED ? round(median(sqm), 10) : null, sqmLimited: show && sqm.length >= EV.SAMPLE.LIMITED && sqm.length < EV.SAMPLE.SUPPORTED,
      medianAreaSqm: show ? round(median(xs.filter((d) => d.areaSqm != null).map((d) => d.areaSqm)), 1) : null,
      probableNewPct: xs.length ? Math.round((xs.filter((d) => d.probableNew).length / xs.length) * 100) : null };
  };
  const bands = {};
  for (const b of BANDS) bands[b] = one(priced.filter((d) => bandOf(d.rooms) === b));
  bands.unknown = { priced: priced.filter((d) => d.rooms == null).length };
  return { all: one(priced), bands };
}

/** every locality's and district's comparison figures from the stored sweep */
function build() {
  const S = EV.store();
  if (!S.available) throw new Error('the register sweep is not stored');
  const D = SD.load();
  const localities = {}, byDistrict = new Map();
  for (const f of fs.readdirSync(S.dir).filter((x) => /^\d+\.json$/.test(x))) {
    const code = Number(f.replace('.json', ''));
    const sh = EV.shardOf(code); if (!sh) continue;
    const deals = EV.dealsOf(sh).map((x) => x.deal).filter((d) => d.dwelling);
    localities[code] = segmentStats(deals);
    const district = (D.localities.get(code) || {}).district || null;
    if (district) { if (!byDistrict.has(district)) byDistrict.set(district, { deals: [], localities: 0 }); const g = byDistrict.get(district); g.localities++; for (const d of deals) g.deals.push(d); }
  }
  const districts = {};
  for (const [name, g] of byDistrict) districts[name] = { localities: g.localities, ...segmentStats(g.deals) };
  return { schema: 1, engine: 'propx-street-benchmarks-1', builtAt: new Date().toISOString(), cls: 'DERIVED',
    evidence: { scrapedAt: S.meta.source.scrapedAt, window: S.meta.window },
    population: 'priced dwelling deals of the register copy (whole property, ≥ ₪100,000) in the window — every address state; a district pools its localities\' deals',
    bands: BANDS, localities, districts };
}

let CACHE;
/** the stored benchmarks + whether they were built from the evidence copy stored now */
function load() {
  if (CACHE !== undefined) return CACHE;
  let doc = null; try { doc = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { doc = null; }
  const S = EV.store();
  const current = !!(doc && S.available && doc.evidence && doc.evidence.scrapedAt === S.meta.source.scrapedAt && JSON.stringify(doc.evidence.window) === JSON.stringify(S.meta.window));
  CACHE = doc ? { ...doc, current } : null;
  return CACHE;
}
const reset = () => { CACHE = undefined; };

module.exports = { FILE, BANDS, bandOf, segmentStats, build, load, reset, stateOf };
