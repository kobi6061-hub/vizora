// PROPX · Land & Tender — re-tender / re-marketing lineage, and the unique
// land pipeline it allows.
//
// Evidence, nothing else: the Authority gives every marketed lot a stable file
// id (TikID — the same id returns when the lot is marketed again in a later
// tender) and prints the plan number + lot number on it. Two tenders are linked
// only when they share a TikID; the shared plan+lot keys are recorded as
// corroboration. A shared block/parcel without a shared lot is a weaker,
// site-level link kept apart ('same-parcel') and never used to deduplicate.
// Tenders whose detail has not been read carry no lot ids and are never linked
// (a locality + unit-count match is not evidence).
//
// Relationship of an earlier tender E to a later tender L sharing lots (by the
// earlier tender's own outcome, never a guess at the reason):
//   re-tender               E failed: cancelled / frozen / decided with no winner
//   unawarded-lot-re-marketed  E awarded other lots; the shared lots had no winner in E
//   awarded-lot-re-marketed    the shared lot HAD a recorded winner in E and was marketed again
//   round-after-closing     E closed with no winners declared yet (e.g. a lottery round) when L was published
//   parallel-marketing      E and L published on the same date
//   successive-marketing    anything else (E open/published when L appeared)
//
// Unique pipeline: a lot (TikID) is counted once, with the units of its LATEST
// marketing in scope. Only detail-read tenders can be deduplicated; the rest
// are reported as not deduplicable, never silently included or excluded.

'use strict';

const RELATION = Object.freeze({
  're-tender': { he: 'מכרז חוזר לאחר כישלון/ביטול', en: 'Re-tender after failure / cancellation' },
  'unawarded-lot-re-marketed': { he: 'מגרש ללא זוכה שווק מחדש', en: 'Unawarded lot marketed again' },
  'awarded-lot-re-marketed': { he: 'מגרש שהוכרז בו זוכה שווק מחדש', en: 'Awarded lot marketed again' },
  'round-after-closing': { he: 'סבב נוסף לאחר סגירה ללא הכרזה', en: 'Further round after a closing without award' },
  'parallel-marketing': { he: 'שיווק מקביל (אותו מועד פרסום)', en: 'Parallel marketing (same publication date)' },
  'successive-marketing': { he: 'שיווק עוקב', en: 'Successive marketing' },
  'same-parcel': { he: 'אותו גוש/חלקה (ראיה ברמת אתר בלבד)', en: 'Same block/parcel (site-level evidence only)' },
});
const FAILED = new Set(['cancelled', 'frozen', 'decided-no-award']);
const order = (r) => (r.publishedDate || '') + '|' + String(r.michrazId).padStart(10, '0');

/** lot references of a record: from the slim record (v4) or from its loaded lots */
function lotRefsOf(r, lots) {
  if (Array.isArray(r.lotRefs)) return r.lotRefs;
  if (!Array.isArray(lots)) return null;
  return lots.map((l) => ({ id: l.lotId, keys: (l.plans || []).filter((p) => p.plan && p.lot).map((p) => String(p.plan).replace(/\s+/g, '') + '|' + String(p.lot).replace(/\s+/g, '')),
    parcels: (l.parcels || []).filter((p) => p.block && p.parcel && p.parcel !== '0').map((p) => p.block + '/' + p.parcel), units: l.units ?? null, won: !!l.winner }));
}

function relationOf(E, L, sharedWonInE) {
  if (E.publishedDate && E.publishedDate === L.publishedDate) return 'parallel-marketing';
  if (FAILED.has(E.lifecycle)) return 're-tender';
  if (E.lifecycle === 'awarded') return sharedWonInE ? 'awarded-lot-re-marketed' : 'unawarded-lot-re-marketed';
  if (E.lifecycle === 'closed' || E.lifecycle === 'lottery-pending') return 'round-after-closing';
  return 'successive-marketing';
}

/**
 * buildLineage(records, refsOf) → { links, byTender }
 *   records  the live records
 *   refsOf   record → lot refs (lotRefsOf) or null when unknown
 * links: [{from, to, relation, sharedLots, sharedKeys, evidence}] with from = the earlier tender.
 */
function buildLineage(records, refsOf) {
  const byLot = new Map(), byParcel = new Map(), refs = new Map();
  for (const r of records) {
    const rs = refsOf(r); if (!rs) continue;
    refs.set(r.id, rs);
    for (const l of rs) {
      if (l.id) { if (!byLot.has(l.id)) byLot.set(l.id, []); byLot.get(l.id).push(r); }
      for (const p of l.parcels || []) { if (!byParcel.has(p)) byParcel.set(p, new Set()); byParcel.get(p).add(r.id); }
    }
  }
  const byId = new Map(records.map((r) => [r.id, r]));
  const pairs = new Map();   // "E|L" → {lots:Set, keys:Set, wonInE:bool}
  for (const [lotId, rs] of byLot) {
    const uniq = [...new Map(rs.map((r) => [r.id, r])).values()].sort((a, b) => (order(a) < order(b) ? -1 : 1));
    for (let i = 0; i < uniq.length - 1; i++) {
      const E = uniq[i], L = uniq[i + 1], k = E.id + '|' + L.id;    // consecutive marketings of the lot
      const p = pairs.get(k) || { lots: new Set(), keys: new Set(), wonInE: false };
      p.lots.add(lotId);
      const le = refs.get(E.id).find((x) => x.id === lotId), ll = refs.get(L.id).find((x) => x.id === lotId);
      for (const key of (le && le.keys) || []) if (ll && ll.keys.includes(key)) p.keys.add(key);
      if (le && le.won) p.wonInE = true;
      pairs.set(k, p);
    }
  }
  const links = [];
  for (const [k, p] of pairs) {
    const [a, b] = k.split('|'), E = byId.get(a), L = byId.get(b);
    links.push({ from: E.id, to: L.id, relation: relationOf(E, L, p.wonInE), sharedLots: [...p.lots].sort(), sharedKeys: [...p.keys].sort(),
      evidence: `same lot file id (TikID) ×${p.lots.size}${p.keys.size ? ` · same plan+lot ×${p.keys.size}` : ''}`,
      fromStage: E.lifecycle, fromDate: E.publishedDate, toStage: L.lifecycle, toDate: L.publishedDate });
  }
  /* site-level: parcels shared by tenders that share no lot */
  const lotLinked = new Set(links.map((l) => l.from + '|' + l.to));
  const parcelPairs = new Map();
  for (const [parcel, ids] of byParcel) {
    if (ids.size < 2) continue;
    const rs = [...ids].map((id) => byId.get(id)).sort((a, b) => (order(a) < order(b) ? -1 : 1));
    for (let i = 0; i < rs.length - 1; i++) for (let j = i + 1; j < rs.length; j++) {
      const k = rs[i].id + '|' + rs[j].id; if (lotLinked.has(k)) continue;
      const p = parcelPairs.get(k) || new Set(); p.add(parcel); parcelPairs.set(k, p);
    }
  }
  for (const [k, parcels] of parcelPairs) {
    const [a, b] = k.split('|'), E = byId.get(a), L = byId.get(b);
    links.push({ from: a, to: b, relation: 'same-parcel', sharedLots: [], sharedKeys: [], sharedParcels: [...parcels].sort(), evidence: `same block/parcel ×${parcels.size} (no shared lot)`,
      fromStage: E.lifecycle, fromDate: E.publishedDate, toStage: L.lifecycle, toDate: L.publishedDate });
  }
  links.sort((a, b) => (a.fromDate || '') < (b.fromDate || '') ? 1 : -1);
  const byTender = new Map();
  for (const l of links) {
    if (!byTender.has(l.from)) byTender.set(l.from, { predecessors: [], successors: [] });
    if (!byTender.has(l.to)) byTender.set(l.to, { predecessors: [], successors: [] });
    byTender.get(l.from).successors.push(l); byTender.get(l.to).predecessors.push(l);
  }
  return { links, byTender };
}

/**
 * uniquePipeline(records, refsOf) — units counted once per lot (TikID), from the lot's latest marketing in scope.
 * Returns the deduplicated figure, what it rests on, and what could not be deduplicated.
 */
function uniquePipeline(records, refsOf) {
  const latest = new Map();   // lotId → {units, tender}
  let covered = 0, coveredUnits = 0, lotRows = 0, rawLotUnits = 0, notDedup = 0, notDedupUnits = 0, unkeyed = 0;
  for (const r of records) {
    const rs = refsOf(r);
    if (!rs) { notDedup++; notDedupUnits += r.units || 0; continue; }
    covered++; coveredUnits += r.units || 0;
    for (const l of rs) {
      lotRows++; rawLotUnits += l.units || 0;
      const id = l.id || `${r.id}#${unkeyed++}`;    // a lot without an id (never seen) is counted once
      const cur = latest.get(id);
      if (!cur || order(r) > cur.order) latest.set(id, { units: l.units || 0, order: order(r) });
    }
  }
  let units = 0; for (const v of latest.values()) units += v.units;
  return { lots: latest.size, units, lotRows, rawLotUnits, duplicateLotRows: lotRows - latest.size, duplicateUnits: rawLotUnits - units,
    tendersCovered: covered, tenderUnitsCovered: coveredUnits, tendersNotDeduplicable: notDedup, unitsNotDeduplicable: notDedupUnits,
    basis: 'one count per lot file id (TikID), units of the latest marketing in scope; detail-read tenders only' };
}

module.exports = { RELATION, buildLineage, uniquePipeline, lotRefsOf, relationOf };
