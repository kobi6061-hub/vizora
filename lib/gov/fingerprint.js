// PROPX · Government Real Estate Data Layer — transaction identity & deduplication.
//
// A transaction's identity (its `recordKey`), in order of strength:
//   1. 'id:<official id>' — the government identifier (txId) when the source
//      supplies one. Two DIFFERENT official ids are two deals, however alike
//      the rest of the row (two identical flats sold the same day in one
//      building are legitimate separate deals).
//   2. 'fp:<fingerprint>#<k>' — for an id-less row: the address/date/price/
//      area fingerprint plus k, its occurrence number among identical id-less
//      rows of ONE source response. Two identical rows in one response stay
//      two deals; the same row seen again in an overlapping or later
//      response (same fingerprint, same k) is the same deal — so re-fetching
//      a window is idempotent.
// An id-less row is folded into an official-id row only when the match is
// unambiguous: exactly one official row and exactly one id-less row share
// that fingerprint. Merging keeps the union of fields and every provenance
// entry (never discards one).

'use strict';

const { createHash } = require('node:crypto');
const { fieldValue } = require('./schema');

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/["'׳״]/g, '');

function govIdKey(tx) {
  return tx.txId ? 'id:' + norm(tx.txId) : null;
}

function addressFingerprint(tx) {
  const parts = [
    norm(tx.city), norm(tx.street), norm(tx.houseNumber),
    norm(tx.date), norm(fieldValue(tx.price)), norm(fieldValue(tx.areaSqm)),
  ];
  return 'fp:' + createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);
}

/* the source response a row came from (its request URL + source): the scope
   in which identical id-less rows are counted as separate deals */
function batchOf(tx) {
  const p = Array.isArray(tx.provenance) ? tx.provenance[0] : tx.provenance;
  return p ? `${p.source || ''}|${p.sourceUrl || ''}|${p.retrievedAt || ''}` : '';
}

/** Give every row its recordKey (mutates and returns the rows). */
function assignRecordKeys(txs) {
  const seen = new Map();                  // batch|fingerprint → occurrences so far
  for (const tx of txs) {
    const id = govIdKey(tx);
    if (id) { tx.recordKey = id; continue; }
    const fp = addressFingerprint(tx), bk = batchOf(tx) + '|' + fp;
    const k = (seen.get(bk) || 0) + 1;
    seen.set(bk, k);
    tx.recordKey = fp + '#' + k;
  }
  return txs;
}

/** Merge b into a: fill a's nulls from b, append provenance. */
function mergeTx(a, b) {
  for (const k of Object.keys(b)) {
    if (k === 'provenance' || k === 'missing' || k === 'recordKey') continue;
    if ((a[k] === null || a[k] === undefined) && b[k] !== null && b[k] !== undefined) a[k] = b[k];
  }
  a.missing = (a.missing || []).filter((f) => a[f] === null);
  const provs = Array.isArray(a.provenance) ? a.provenance : [a.provenance];
  provs.push(...(Array.isArray(b.provenance) ? b.provenance : [b.provenance]));
  a.provenance = provs;
  return a;
}

/** Deduplicate a list of normalized transactions by identity. Order-stable. */
function dedupe(txs) {
  assignRecordKeys(txs);
  const byKey = new Map();
  const out = [];
  for (const tx of txs) {
    const hit = byKey.get(tx.recordKey);
    if (hit) { mergeTx(hit, tx); continue; }
    byKey.set(tx.recordKey, tx);
    out.push(tx);
  }
  // unambiguous cross-source fold: one official row ↔ one id-less row
  const byFp = new Map();
  for (const tx of out) {
    const fp = addressFingerprint(tx);
    const g = byFp.get(fp) || { ided: [], bare: [] };
    (tx.recordKey.startsWith('id:') ? g.ided : g.bare).push(tx);
    byFp.set(fp, g);
  }
  const folded = new Set();
  for (const g of byFp.values()) {
    if (g.ided.length === 1 && g.bare.length === 1) { mergeTx(g.ided[0], g.bare[0]); folded.add(g.bare[0]); }
  }
  return folded.size ? out.filter((tx) => !folded.has(tx)) : out;
}

module.exports = { govIdKey, addressFingerprint, assignRecordKeys, dedupe, mergeTx, batchOf };
