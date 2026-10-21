// PROPX · CBS new-home sales — the append-only observation ledger.
//
// One record per (measure, CBS geography, frequency, period) VERSION. A value CBS publishes for the first time is
// revision 0; when a later release changes it, a new record is appended (revision n+1, with the value it replaces).
// Nothing is ever deleted or overwritten: the raw history of every published value stays in
// data/cbs-sales/observations.jsonl. A period the source stops returning is reported, never removed, never set to 0.

'use strict';

const keyOf = (o) => `${o.measure}|${o.cbs}|${o.freq}|${o.period}`;

/** the current (latest-revision) record per key from ledger lines */
function currentOf(records) {
  const cur = new Map();
  for (const r of records) {
    const k = r.key || keyOf(r);
    const prev = cur.get(k);
    if (!prev || (r.revision ?? 0) >= (prev.revision ?? 0)) cur.set(k, r);
  }
  return cur;
}

/**
 * Merge freshly parsed observations into the ledger.
 * @param {object[]} records   existing ledger records (append-only)
 * @param {object[]} incoming  parsed observations of this run (only from requests that answered)
 * @param {object}   ctx       { fetchedAt, snapshot, answered: Set of "measure|cbs" that answered in full }
 * @returns {{append: object[], added: number, revised: number, unchanged: number, missingInSource: string[]}}
 */
function merge(records, incoming, ctx) {
  const cur = currentOf(records);
  const append = [], seen = new Set();
  let added = 0, revised = 0, unchanged = 0;
  for (const o of incoming) {
    const key = keyOf(o);
    if (seen.has(key)) continue;   /* the same period from two overlapping windows: the first wins (identical in practice) */
    seen.add(key);
    const prev = cur.get(key);
    if (prev && prev.value === o.value) { unchanged++; continue; }
    const rec = {
      key, measure: o.measure, cbs: o.cbs, geo: o.geo, ...(o.geoName ? { geoName: o.geoName } : {}), freq: o.freq, period: o.period, value: o.value,
      seriesId: o.seriesId, dataKind: o.dataKind, unit: o.unit, sourceUpdate: o.update, fetchedAt: ctx.fetchedAt,
      snapshot: ctx.snapshot || null, url: o.url, revision: prev ? (prev.revision ?? 0) + 1 : 0,
      ...(prev ? { replaces: prev.value, replacesUpdate: prev.sourceUpdate || null } : {}),
    };
    append.push(rec);
    if (prev) revised++; else added++;
  }
  /* periods already held whose series answered in full this run but no longer carry them: reported, kept */
  const missingInSource = [];
  if (ctx.answered) {
    for (const [k, r] of cur) {
      if (!ctx.answered.has(`${r.measure}|${r.cbs}`)) continue;
      if (!seen.has(k)) missingInSource.push(k);
    }
  }
  return { append, added, revised, unchanged, missingInSource };
}

/** monthly (or annual) value map of one measure × geography from the current records */
function seriesOf(cur, measure, cbs, freq = 'M') {
  const out = {};
  for (const r of cur.values()) if (r.measure === measure && r.cbs === cbs && r.freq === freq) out[r.period] = r.value;
  return out;
}
/** revision history of one key (oldest first) */
function historyOf(records, key) { return records.filter((r) => (r.key || keyOf(r)) === key).sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0)); }

module.exports = { keyOf, currentOf, merge, seriesOf, historyOf };
