// PROPX · XPlan housing-unit fields — the ONE place their meaning lives.
//
// The Planning Administration's online-plans layer (PlanningPublic/Xplan/MapServer/1) publishes, per plan, the housing-unit
// pair of the plan's quantities table:
//   pq_authorised_quantity_120   alias "מגורים מאושר יח"ד"     — the APPROVED STATE the plan starts from: housing units already
//                                                               authorised in the plan's area BEFORE this plan
//   quantity_delta_120           alias "שינוי מס' יח' דיור"    — the CHANGE this plan makes to that state (may be 0 or negative)
// and PROPX derives
//   units after the plan = pq_authorised_quantity_120 + quantity_delta_120   (DERIVED)
//
// Audit 13.10.2026 (scripts/land-discover.js --xplan-semantics, GitHub Actions run 38421239199, all 37,573 plans):
//   · the plans' own objectives text, used as VALIDATION ONLY (never as a value):
//       "from X units to Y units"  312 plans — X = pq_authorised 265, Y = authorised + delta 267, both 251
//       "adds N units"           1,307 plans — N = delta 986 (75%), N = pq_authorised 186 (14%)
//       "total N units"          1,235 plans — N = authorised + delta 956 (77%), N = pq_authorised 84 (7%)
//   · delta < 0 in 740 plans and authorised + delta < 0 in exactly 1 — a change applied to a base, not a total;
//   · 1,818 plans have pq_authorised = 0 and delta > 0 (new neighbourhoods: nothing authorised before them);
//   · validation sets: MoCH urban renewal (766 exact joins) existing = pq_authorised in 615 of 760, additional = delta in 500
//     of 767, proposed = authorised + delta in 480 of 761 (= pq_authorised alone in 2); ILA planning inventory (100 plans
//     with both) marketing potential = authorised + delta 26, = delta 21, = pq_authorised 2.
// The layer publishes no "total proposed" housing field for code 120, so the sum is DERIVED and labelled so.
// Raw source values are kept exactly as published beside the interpretation; nothing is inferred from names or text.

'use strict';

const SEMANTICS = Object.freeze({
  version: 1, audited: '2026-10-13', run: '38421239199', layer: 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1',
  fields: {
    pq_authorised_quantity_120: { alias: 'מגורים מאושר יח"ד', meaning: 'housing units already authorised in the plan area before this plan (the approved state the plan starts from)', as: 'existingAuthorisedUnits' },
    quantity_delta_120: { alias: "שינוי מס' יח' דיור", meaning: 'the change in housing units this plan makes to that approved state (0 or negative possible)', as: 'planUnitDelta' },
  },
  derived: { unitsAfterPlan: 'pq_authorised_quantity_120 + quantity_delta_120 — DERIVED; null when either is missing; null (flagged) when the sum is negative' },
  limitations: [
    'a plan\'s area is usually wider than one tender lot or renewal complex — the plan\'s units are the plan\'s, never the lot\'s',
    'a plan that only re-arranges an approved state has delta 0: its units after the plan equal the earlier approval, not new supply',
    'plans managed before the online system are not in the layer',
  ],
  labels: { he: { existingAuthorisedUnits: 'יח"ד מאושרות לפני התוכנית', planUnitDelta: 'תוספת יח"ד בתוכנית', unitsAfterPlan: 'סה"כ יח"ד לאחר התוכנית' },
    en: { existingAuthorisedUnits: 'Previously Authorized Units', planUnitDelta: 'Plan Unit Delta', unitsAfterPlan: 'Units After Plan' } },
});

const finite = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** the raw pair as published → { raw, existingAuthorisedUnits, planUnitDelta, unitsAfterPlan, flags } */
function interpretUnits(rawAuthorised, rawDelta) {
  const A = finite(rawAuthorised), D = finite(rawDelta), flags = [];
  const existingAuthorisedUnits = A != null && A >= 0 ? A : null;
  if (A != null && A < 0) flags.push('negative-authorised-state');
  let unitsAfterPlan = null;
  if (existingAuthorisedUnits != null && D != null) {
    const s = existingAuthorisedUnits + D;
    if (s >= 0) unitsAfterPlan = s; else flags.push('negative-after-plan');
  } else {
    if (A == null) flags.push('missing-authorised-state');
    if (D == null) flags.push('missing-delta');
  }
  return { raw: { pq_authorised_quantity_120: rawAuthorised ?? null, quantity_delta_120: rawDelta ?? null },
    existingAuthorisedUnits, planUnitDelta: D, unitsAfterPlan, flags, basis: 'xplan-units-v1' };
}
/** from the layer's attributes */
const unitsOfAttributes = (a) => interpretUnits(a ? a.pq_authorised_quantity_120 : null, a ? a.quantity_delta_120 : null);
/** from a stored PROPX plan record: the land store keeps the raw pair under its storage keys approvedUnits / unitsDelta
 *  (lib/land/planning.js — the key name is legacy, the value is the raw pq_authorised_quantity_120), the renewal store under
 *  existingAuthorisedUnits / planUnitDelta (older renewal records: unitsApprovedState / unitsChange) */
function unitsOfStored(p) {
  if (!p) return interpretUnits(null, null);
  if (p.raw && ('pq_authorised_quantity_120' in p.raw || 'quantity_delta_120' in p.raw)) return interpretUnits(p.raw.pq_authorised_quantity_120, p.raw.quantity_delta_120);
  if ('existingAuthorisedUnits' in p || 'planUnitDelta' in p) return interpretUnits(p.existingAuthorisedUnits, p.planUnitDelta);
  if ('unitsApprovedState' in p || 'unitsChange' in p) return interpretUnits(p.unitsApprovedState, p.unitsChange);
  return interpretUnits(p.approvedUnits, p.unitsDelta);
}
/** Σ over DISTINCT plans (by key) — each plan counted once however many tenders / complexes reference it */
function sumUnits(plans, keyOf = (p) => p.key) {
  const seen = new Set(), out = { existingAuthorisedUnits: 0, planUnitDelta: 0, unitsAfterPlan: 0, plans: 0, withAfterPlan: 0 };
  let anyA = false, anyD = false, anyU = false;
  for (const p of plans) {
    const k = keyOf(p); if (k == null || seen.has(k)) continue; seen.add(k); out.plans++;
    const u = p.units || unitsOfStored(p);
    if (u.existingAuthorisedUnits != null) { out.existingAuthorisedUnits += u.existingAuthorisedUnits; anyA = true; }
    if (u.planUnitDelta != null) { out.planUnitDelta += u.planUnitDelta; anyD = true; }
    if (u.unitsAfterPlan != null) { out.unitsAfterPlan += u.unitsAfterPlan; out.withAfterPlan++; anyU = true; }
  }
  if (!anyA) out.existingAuthorisedUnits = null; if (!anyD) out.planUnitDelta = null; if (!anyU) out.unitsAfterPlan = null;
  return { ...out, basis: 'Σ over distinct plans; units after the plan DERIVED (pq_authorised_quantity_120 + quantity_delta_120)' };
}

module.exports = { SEMANTICS, interpretUnits, unitsOfAttributes, unitsOfStored, sumUnits };
