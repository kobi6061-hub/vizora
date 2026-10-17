// PROPX · CBS construction — the append-only observation ledger (data/construction/observations.jsonl).
//
// The revision logic is the sales ledger's (lib/cbs-sales/ledger.js), reused — not copied: one record per
// (measure, CBS geography code, frequency, period) VERSION; revision 0 on first publication, revision n+1 with the value
// it replaces when a later release changes it; nothing deleted or overwritten; a period the source stops returning is
// reported, never removed, never set to 0. The geography codes are per measure (level-4 code or name_id), so
// `measure|cbs` is unique and the sales key `measure|cbs|freq|period` holds here too. This module only adds the
// construction fields the sales merge does not carry: the catalogue path, the leaf (nameId), the geography name as a
// label, the source's own period string and the measure kind (flow / stock).

'use strict';

const SL = require('../cbs-sales/ledger');

const EXTRA = ['pathId', 'nameId', 'geoName', 'sourcePeriod', 'kind'];

/**
 * @param {object[]} records   existing ledger records (append-only)
 * @param {object[]} incoming  parsed observations of this run (only from requests that answered)
 * @param {object}   ctx       { fetchedAt, snapshot, answered: Set of "measure|cbs" that answered in full }
 */
function merge(records, incoming, ctx) {
  const m = SL.merge(records, incoming, ctx);
  const first = new Map();
  for (const o of incoming) { const k = SL.keyOf(o); if (!first.has(k)) first.set(k, o); }   /* the sales merge keeps the first of a key */
  for (const r of m.append) {
    const o = first.get(r.key);
    if (o) for (const f of EXTRA) r[f] = o[f] === undefined ? null : o[f];
  }
  return m;
}

/** period → value of one measure × PROPX geography × frequency from the current records */
function seriesByGeo(cur, measure, geo, freq) {
  const out = {};
  for (const r of cur.values()) if (r.measure === measure && r.geo === geo && r.freq === freq) out[r.period] = r.value;
  return out;
}

module.exports = { keyOf: SL.keyOf, currentOf: SL.currentOf, historyOf: SL.historyOf, seriesOf: SL.seriesOf, seriesByGeo, merge, EXTRA };
