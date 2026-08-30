// PROPX · Government Real Estate Data Layer — canonical transaction schema.
//
// Every transaction from every government provider is normalized into this
// one shape before it may enter PROPX analytics. Rules:
//   · a field the source did not supply stays null and is listed in
//     `missing` — it is NEVER silently filled;
//   · a value PROPX derived rather than read is wrapped as
//     {value, estimated:true, method} — never a bare number;
//   · provenance (source, sourceTimestamp, retrievedAt, raw echo) is
//     mandatory on every record.

'use strict';

/** New-construction evidence classes. PROPX analytics may aggregate
 *  `confirmed_new` only; `probable_new` is displayed separately and
 *  `unknown` never enters new-construction metrics. */
const NEWNESS = Object.freeze({
  CONFIRMED_NEW: 'confirmed_new',
  PROBABLE_NEW: 'probable_new',
  UNKNOWN: 'unknown',
});

const REQUIRED_META = ['source', 'retrievedAt'];

/** The canonical field list (kept in one place so tests, docs and the
 *  normalizer can never drift apart). */
const FIELDS = Object.freeze([
  'txId',            // government identifier when supplied (e.g. KEYVALUE)
  'date',            // ISO yyyy-mm-dd at the resolution supplied
  'price',           // ILS integer
  'pricePerSqm',     // ILS integer; derived → {value,estimated:true,method}
  'areaSqm',
  'rooms',
  'floor',
  'floorsInBuilding',
  'yearBuilt',
  'city',
  'street',
  'houseNumber',
  'block',           // גוש
  'parcel',          // חלקה
  'subParcel',       // תת-חלקה
  'lat',
  'lng',
  'dealType',        // free-text property/deal nature from the source
  'newness',         // NEWNESS.*
  'newnessEvidence', // array of strings explaining the classification
]);

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[₪,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** dd.mm.yyyy / yyyy-mm-dd / dd/mm/yyyy (with optional time) → ISO date. */
function toIsoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/**
 * Build a canonical PROPX government transaction.
 * @param {object} fields  raw field values (see FIELDS)
 * @param {object} meta    {source, sourceTimestamp?, retrievedAt, sourceUrl?, raw?}
 */
function makeTransaction(fields, meta) {
  for (const k of REQUIRED_META) {
    if (!meta || !meta[k]) throw new Error('transaction meta missing required "' + k + '"');
  }
  const tx = {};
  const missing = [];
  for (const f of FIELDS) {
    const v = fields[f];
    tx[f] = v === undefined ? null : v;
    if (tx[f] === null) missing.push(f);
  }
  if (!tx.newness) tx.newness = NEWNESS.UNKNOWN;
  // derived price/sqm — allowed, but only explicitly marked as estimated
  if (tx.pricePerSqm === null && toNumber(tx.price) && toNumber(tx.areaSqm)) {
    tx.pricePerSqm = {
      value: Math.round(toNumber(tx.price) / toNumber(tx.areaSqm)),
      estimated: true,
      method: 'price/areaSqm',
    };
    missing.splice(missing.indexOf('pricePerSqm'), 1);
  }
  tx.missing = missing;
  tx.provenance = {
    source: meta.source,
    sourceUrl: meta.sourceUrl || null,
    sourceTimestamp: meta.sourceTimestamp || null,
    retrievedAt: meta.retrievedAt,
    sample: meta.sample === true || undefined, // fixture rows only — never live data
    raw: meta.raw === undefined ? null : meta.raw,
  };
  return tx;
}

function isEstimated(v) {
  return !!(v && typeof v === 'object' && v.estimated === true);
}

/** Plain numeric view of a field that may be wrapped as estimated. */
function fieldValue(v) {
  return isEstimated(v) ? v.value : v;
}

function validateTransaction(tx) {
  const errs = [];
  if (!tx || typeof tx !== 'object') return ['not an object'];
  for (const f of FIELDS) if (!(f in tx)) errs.push('missing field ' + f);
  if (!tx.provenance || !tx.provenance.source) errs.push('missing provenance.source');
  if (!tx.provenance || !tx.provenance.retrievedAt) errs.push('missing provenance.retrievedAt');
  if (tx.newness && !Object.values(NEWNESS).includes(tx.newness)) errs.push('bad newness ' + tx.newness);
  if (tx.price !== null && typeof fieldValue(tx.price) !== 'number') errs.push('price not numeric');
  return errs;
}

module.exports = { NEWNESS, FIELDS, makeTransaction, validateTransaction, toNumber, toIsoDate, isEstimated, fieldValue };
