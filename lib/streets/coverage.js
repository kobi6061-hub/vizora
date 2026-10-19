// PROPX · STREET COVERAGE AUDIT — how much of Israel's official street directory PROPX can search, and how much of it carries
// market evidence, nationally / by district / by locality. Every level reconciles with the one above it (the sums are checked,
// not assumed). Read from the stored directory, the prebuilt search index and the evidence summary — nothing is estimated.
//
//   officialRows        every row of the directory (current + historical, including the locality placeholders 9000)
//   canonical           rows that are a street / address area / site (the placeholder is the locality itself)
//   searchable          canonical rows present in the search index (must equal canonical)
//   synonyms            official synonym rows · searchable synonyms (naming a canonical row) · synonyms of the placeholder
//   withTransactions    canonical rows with ≥ 1 OBSERVED dwelling deal in the window
//   SUPPORTED / LIMITED / INSUFFICIENT / NONE / NOT_SWEPT   the street sample states (lib/streets/evidence.js)
//   possibleOnly        rows whose only deals are POSSIBLE (never aggregated)

'use strict';

const SD = require('./directory');
const EV = require('./evidence');
const SI = require('./search-index');

const blank = () => ({ officialRows: 0, placeholders: 0, canonical: 0, current: 0, historical: 0, street: 0, area: 0, site: 0, searchable: 0,
  withTransactions: 0, SUPPORTED: 0, LIMITED: 0, INSUFFICIENT: 0, NONE: 0, NOT_SWEPT: 0, possibleOnly: 0 });
const ADD = Object.keys(blank());

function coverage(opt = {}) {
  const D = SD.load();
  const S = EV.store(opt.evidenceDir);
  const ix = SI.read(SD.DIR, D.fileHash) || SI.build(D);
  /* the index's searchable set: refs of official-name postings */
  const searchable = new Set();
  for (const e of ix.entries) for (let j = 1; j < e.length; j++) if (SI.typeOf(e[j]) === SI.TYPE.OFFICIAL) searchable.add(SI.refOfPosting(e[j]));
  let reg = null; try { reg = require('../geo/registry').loadGeo(); } catch { /* names only */ }
  const total = blank(), byDistrict = {}, byLocality = {};
  for (const s of D.streets) {
    const loc = D.localities.get(s.cityCode) || {};
    const l = reg ? reg.byCode.get(s.cityCode) : null;
    const district = (l && l.district) || loc.district || 'unknown';
    const L = byLocality[s.cityCode] || (byLocality[s.cityCode] = { code: s.cityCode, name: (l && l.he) || loc.he || null, district, ...blank() });
    const Dd = byDistrict[district] || (byDistrict[district] = blank());
    const inc = (k) => { total[k]++; Dd[k]++; L[k]++; };
    inc('officialRows');
    if (s.kind === SD.KIND.LOCALITY) { inc('placeholders'); continue; }
    inc('canonical'); inc(s.status === 'historical' ? 'historical' : 'current'); inc(s.kind);
    if (searchable.has(SI.refOf(s.cityCode, s.code))) inc('searchable');
    if (S.available) {
      const st = EV.stateOf(S.summary, s.cityCode, s.code);
      inc(st);
      const e = S.summary.streets[s.cityCode + ':' + s.code];
      if (e && e[0]) inc('withTransactions'); else if (e && e[4]) inc('possibleOnly');
    }
  }
  const synonyms = { rows: D.synonyms.length, searchable: ix.counts.synonyms, ofPlaceholder: D.synonyms.filter((y) => y.officialCode === 9000).length };
  synonyms.other = synonyms.rows - synonyms.searchable - synonyms.ofPlaceholder;
  /* reconciliation: districts and localities add up to the national totals; every canonical row is searchable */
  const sum = (objs) => { const o = blank(); for (const x of objs) for (const k of ADD) o[k] += x[k]; return o; };
  const sd = sum(Object.values(byDistrict)), sl = sum(Object.values(byLocality));
  const reconcile = { districtsEqualNational: ADD.every((k) => sd[k] === total[k]), localitiesEqualNational: ADD.every((k) => sl[k] === total[k]),
    canonicalAllSearchable: total.searchable === total.canonical,
    statesAddUp: !S.available || total.SUPPORTED + total.LIMITED + total.INSUFFICIENT + total.NONE + total.NOT_SWEPT === total.canonical,
    placeholdersOnePerLocality: total.placeholders === D.localities.size };
  return {
    asOf: { directory: D.meta && D.meta.fetchedAt, registryUpdated: D.meta && D.meta.sources ? D.meta.sources.streets.lastModified : null,
      evidence: S.available ? { scrapedAt: S.meta.source.scrapedAt, window: S.meta.window, sweep: S.meta.sweep && S.meta.sweep.status } : null },
    totals: total, synonyms, localities: D.localities.size, thresholds: EV.SAMPLE, evidenceAvailable: S.available,
    byDistrict, byLocality: Object.values(byLocality).sort((a, b) => b.canonical - a.canonical || a.code - b.code), reconcile,
  };
}

module.exports = { coverage };
