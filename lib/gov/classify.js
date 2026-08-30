// PROPX · Government Real Estate Data Layer — new-construction classification.
//
// PROPX analytics focus on NEW CONSTRUCTION, so contamination is worse than
// omission. A transaction is classified by explicit evidence only:
//
//   confirmed_new — the source itself states a first-hand/developer sale
//                   (deal-nature text such as "דירה חדשה מקבלן", or an
//                   explicit new-sale flag in the source record);
//   probable_new  — strong but indirect evidence: the building year equals
//                   the deal year (or deal year − 1), or the record carries
//                   a named developer project without an explicit new flag;
//   unknown       — anything else. NEVER counted as new construction.
//
// Every classification returns its evidence list so the UI and audits can
// show exactly why a record was classified.

'use strict';

const { NEWNESS } = require('./schema');

const CONFIRM_PATTERNS = [
  /דירה\s+חדשה/,
  /חדשה\s+מקבלן/,
  /מקבלן/,
  /new\s+(apartment|home|dwelling)/i,
  /first\s*hand/i,
];

const FIRST_HAND_RE = /first[\s-]*hand|יד\s*ראשונה|dealType\s*=?\s*1/i;
const SECOND_HAND_RE = /second[\s-]*hand|יד\s*שנייה|יד\s*2|dealType\s*=?\s*2/i;

/**
 * @param {object} ev evidence bundle:
 *   sourceClassification the source's OWN new/second-hand indication, verbatim
 *                        (e.g. GovMap query dealType 1=first hand / 2=second hand)
 *   dealNature   free-text deal/property nature from the source
 *   newFlag      explicit boolean "new sale" flag if the source has one
 *   yearBuilt    numeric year the building was built (from the source)
 *   dealYear     numeric year of the transaction
 *   projectName  developer project name if the source carries one
 * @returns {{newness:string, evidence:string[]}}
 */
function classifyNewness(ev) {
  const e = ev || {};
  const evidence = [];

  // the source's own classification outranks every inference — in both directions
  const srcCls = String(e.sourceClassification || '');
  if (SECOND_HAND_RE.test(srcCls)) {
    evidence.push('source classification "' + srcCls + '" = second hand');
    return { newness: NEWNESS.SECOND_HAND, evidence };
  }
  if (FIRST_HAND_RE.test(srcCls)) {
    evidence.push('source classification "' + srcCls + '" = first hand (from developer)');
    return { newness: NEWNESS.CONFIRMED_NEW, evidence };
  }

  if (e.newFlag === true) {
    evidence.push('source new-sale flag = true');
    return { newness: NEWNESS.CONFIRMED_NEW, evidence };
  }
  const nature = String(e.dealNature || '');
  const pat = CONFIRM_PATTERNS.find((p) => p.test(nature));
  if (pat) {
    evidence.push('deal nature "' + nature + '" matches ' + String(pat));
    return { newness: NEWNESS.CONFIRMED_NEW, evidence };
  }

  // null/undefined must NOT coerce to 0 (Number(null)===0) — that would let a
  // record with no year at all masquerade as "building year equals deal year"
  const yb = e.yearBuilt == null ? NaN : Number(e.yearBuilt);
  const dy = e.dealYear == null ? NaN : Number(e.dealYear);
  if (Number.isFinite(yb) && Number.isFinite(dy) && (dy === yb || dy === yb + 1)) {
    evidence.push('building year ' + yb + ' ≈ deal year ' + dy);
    if (e.projectName) evidence.push('developer project "' + e.projectName + '"');
    return { newness: NEWNESS.PROBABLE_NEW, evidence };
  }
  if (e.projectName) {
    evidence.push('developer project "' + e.projectName + '" (no explicit new flag)');
    return { newness: NEWNESS.PROBABLE_NEW, evidence };
  }
  if (Number.isFinite(yb) && Number.isFinite(dy) && dy >= yb + 2) {
    evidence.push('building year ' + yb + ' predates deal year ' + dy + ' by 2+ years');
    return { newness: NEWNESS.SECOND_HAND, evidence };
  }

  evidence.push('no new-construction evidence in source record');
  return { newness: NEWNESS.UNKNOWN, evidence };
}

/** Partition helper enforced at the service boundary: analytics that claim
 *  "new construction" may consume `confirmed` only. */
function partitionByNewness(txs) {
  const confirmed = [], probable = [], secondHand = [], unknown = [];
  for (const t of txs) {
    (t.newness === NEWNESS.CONFIRMED_NEW ? confirmed
      : t.newness === NEWNESS.PROBABLE_NEW ? probable
      : t.newness === NEWNESS.SECOND_HAND ? secondHand : unknown).push(t);
  }
  return { confirmed, probable, secondHand, unknown };
}

module.exports = { classifyNewness, partitionByNewness };
