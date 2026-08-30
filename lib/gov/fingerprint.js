// PROPX · Government Real Estate Data Layer — deduplication fingerprints.
//
// A transaction is identified, in order of strength, by:
//   1. its government identifier (txId) when the source supplies one;
//   2. an address/date/price fingerprint — city|street|house|date|price|areaSqm.
// Two records sharing either identity are the same deal; the merged record
// keeps the union of fields and every provenance entry (never discards one).

'use strict';

const { createHash } = require('node:crypto');
const { fieldValue } = require('./schema');

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/["'׳״]/g, '');

function govIdKey(tx) {
  return tx.txId ? 'gov:' + norm(tx.txId) : null;
}

function addressFingerprint(tx) {
  const parts = [
    norm(tx.city), norm(tx.street), norm(tx.houseNumber),
    norm(tx.date), norm(fieldValue(tx.price)), norm(fieldValue(tx.areaSqm)),
  ];
  return 'fp:' + createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);
}

/** Merge b into a: fill a's nulls from b, append provenance. */
function mergeTx(a, b) {
  for (const k of Object.keys(b)) {
    if (k === 'provenance' || k === 'missing') continue;
    if ((a[k] === null || a[k] === undefined) && b[k] !== null && b[k] !== undefined) a[k] = b[k];
  }
  a.missing = a.missing.filter((f) => a[f] === null);
  const provs = Array.isArray(a.provenance) ? a.provenance : [a.provenance];
  provs.push(...(Array.isArray(b.provenance) ? b.provenance : [b.provenance]));
  a.provenance = provs;
  return a;
}

/** Deduplicate a list of normalized transactions. Order-stable. */
function dedupe(txs) {
  const byKey = new Map();
  const out = [];
  for (const tx of txs) {
    const keys = [govIdKey(tx), addressFingerprint(tx)].filter(Boolean);
    const hitKey = keys.find((k) => byKey.has(k));
    if (hitKey) {
      mergeTx(byKey.get(hitKey), tx);
    } else {
      out.push(tx);
    }
    for (const k of keys) if (!byKey.has(k)) byKey.set(k, tx);
  }
  return out;
}

module.exports = { govIdKey, addressFingerprint, dedupe, mergeTx };
