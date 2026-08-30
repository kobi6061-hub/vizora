// PROPX · acceptance verification — compare INDEPENDENTLY OBSERVED reference
// records against what the pipeline actually retrieved from the authoritative
// source. The references are never injected into product data; they are the
// expected side of a comparison, so a live run either matches them or fails
// loudly. A field absent from one side is reported as `notComparable`, never
// silently counted as a match.

'use strict';

const { fieldValue } = require('./schema');

const monthOf = (iso) => (iso ? String(iso).slice(0, 7) : null);
/** dd/mm/yyyy → yyyy-mm-dd */
function refDateToIso(d) {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

const CORE_FIELDS = ['price', 'dateMonth', 'areaSqm', 'rooms', 'floor'];

function compareOne(ref, tx) {
  const refIso = refDateToIso(ref.date);
  const checks = {
    price: { ref: ref.price, got: fieldValue(tx.price), ok: fieldValue(tx.price) === ref.price },
    dateMonth: { ref: monthOf(refIso), got: monthOf(tx.date), ok: !!refIso && monthOf(tx.date) === monthOf(refIso) },
    areaSqm: { ref: ref.areaSqm, got: fieldValue(tx.areaSqm), ok: Math.abs((fieldValue(tx.areaSqm) ?? -1e9) - ref.areaSqm) <= 3 },
    rooms: { ref: ref.rooms, got: tx.rooms, ok: tx.rooms === ref.rooms },
    floor: { ref: String(ref.floor), got: tx.floor, ok: String(tx.floor) === String(ref.floor) },
  };
  for (const k of ['block', 'parcel']) {
    if (ref[k] != null) {
      checks[k] = tx[k] == null
        ? { ref: ref[k], got: null, notComparable: 'field not served by the retrieval endpoint' }
        : { ref: String(ref[k]), got: String(tx[k]), ok: String(tx[k]) === String(ref[k]) };
    }
  }
  const coreOk = CORE_FIELDS.filter((k) => checks[k] && checks[k].ok).length;
  return { checks, coreOk, matched: coreOk >= 4 }; // 4 of 5 core fields = same deal
}

/**
 * @param {object[]} transactions normalized PROPX transactions (live retrieval)
 * @param {object[]} references  independently observed records
 * @returns per-reference best-match report + overall verdict
 */
function verifyAgainstReference(transactions, references) {
  const results = references.map((ref) => {
    let best = null;
    for (const tx of transactions) {
      const c = compareOne(ref, tx);
      if (!best || c.coreOk > best.coreOk) best = { ...c, txId: tx.txId, provenance: tx.provenance };
    }
    return { reference: ref, best: best || { matched: false, coreOk: 0, checks: {} } };
  });
  const matched = results.filter((r) => r.best.matched).length;
  return {
    results,
    matched,
    total: references.length,
    verdict: matched === references.length ? 'ALL_MATCHED' : matched > 0 ? 'PARTIAL_MATCH' : 'NO_MATCH',
  };
}

module.exports = { verifyAgainstReference, compareOne, refDateToIso };
