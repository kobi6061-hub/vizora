// PROPX · Urban renewal × XPlan — the Planning Administration's record of each renewal complex's plan, joined EXACTLY.
//
// Source: the Planning Administration's xplan ArcGIS service, layer 1 "קוים כחולים-תכניות מקוונות" (the blue lines of
// the plans managed online, ~37.6k plans; ags.iplan.gov.il PlanningPublic/Xplan/MapServer/1). Read on the GitHub
// runner by scripts/renewal-planning-sync.js; everything here is pure.
//
// The join (deterministic, in this order — nothing fuzzier, never a name):
//   1. the plan number MoCH prints (MisparTochnit) = the layer's pl_number (whitespace removed on both sides, nothing else);
//   2. the Mavat main-plan id in MoCH's own site link (mavat.iplan.gov.il/SV4/1/<id>/…) = the layer's mp_id ("מזהה תכנית
//      ראשי"). Verified 13.10.2026 (Actions run 38384097282): in all 687 complexes found by plan number that carry a
//      link, the link's id equals mp_id — 0 disagreements;
//   3. block / parcel: the layer publishes none, so it never corroborates here;
//   4. geometry: MoCH publishes no complex geometry; a spatial relation alone is NEVER a join (recorded as a diagnostic).
// Two keys that point at different plans make the complex AMBIGUOUS — PROPX never picks one.
//
// MoCH and XPlan are separate source universes: the complex's MoCH fields are never overwritten; XPlan's values sit
// beside them, and every disagreement (units, approval year, stage, plan number) is listed, never resolved.
// Planning approval is not construction: no stage here says permit, construction start or completion.

'use strict';

const LAYER = 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1';
const SOURCE = Object.freeze({
  id: 'iplan:xplan:renewal',
  authority: 'מינהל התכנון', authorityEn: 'Planning Administration',
  dataset: 'xplan — קוים כחולים, תכניות מקוונות', datasetEn: 'xplan — blue lines of the plans managed online',
  layer: LAYER, page: 'https://mavat.iplan.gov.il/', classification: 'CONFIRMED_STRUCTURED_API',
  scope: 'plans managed online in the national planning system (~37.6k); older plans that were never moved online are not in this layer',
  verified: { run: '38384097282', at: '2026-10-13', planNumbersAsked: 934, found: 708, mavatIdAgreement: '687 of 687' },
});
const NORMALIZER_VERSION = 1;

/* the layer's fields read (aliases as the layer publishes them) */
const FIELDS = ['pl_number', 'pl_id', 'mp_id', 'pl_name', 'station_desc', 'internet_short_status', 'entity_subtype_desc', 'plan_charactor_name',
  'district_name', 'jurstiction_area_name', 'plan_county_name', 'plan_area_name', 'ja_concat', 'pl_area_dunam', 'pl_landuse_string', 'pl_objectives',
  'pq_authorised_quantity_120', 'quantity_delta_120', 'pq_authorised_quantity_110', 'quantity_delta_110', 'quantity_delta_125',
  'receiving_date', 'date_saf', 'depositing_date', 'pl_last_deposit_date', 'pl_date_advertise', 'pl_rejection_date', 'pl_date7', 'on_hold_date', 'open_date', 'pl_date_8',
  'last_update_date', 'pl_url', 'pl_order_print_version', 'pl_tasrit_prn_version'];
const ALIAS = Object.freeze({
  receivedDate: 'receiving_date · תאריך קבלת תכנית', thresholdDate: 'date_saf · תאריך עמידה בתנאי סף', depositHearingDate: 'depositing_date · תאריך דיון בהפקדה',
  depositDate: 'pl_last_deposit_date · תאריך אחרון להפקדה', newspaperDate: 'pl_date_advertise · תאריך פרסום בעיתונים', objectionsDeadline: 'pl_rejection_date · תאריך אחרון להתנגדויות',
  approvalHearingDate: 'pl_date7 · תאריך דיון באישור', approvalHandlingStart: 'on_hold_date · תאריך תחילת טיפול באישור', approvalHandlingEnd: 'open_date · תאריך סיום טיפול באישור',
  gazetteDate: 'pl_date_8 · תאריך פרסום ברשומות', lastUpdate: 'last_update_date · תאריך עדכון אחרון',
  unitsApprovedState: 'pq_authorised_quantity_120 · מגורים מאושר יח"ד (the approved state the plan starts from)', unitsChange: 'quantity_delta_120 · שינוי מס\' יח\' דיור (the change the plan makes)',
});

/* ───────────────────────── planning stage (from the source's own status strings only) ───────────────────────── */
/* the station (station_desc, "תיאור סטטוס") → stage; ordered by how far a plan went. EFFECTIVE only where the station is
   approval AND the latest event (internet_short_status) is the approval's publication; REJECTED wherever the latest event is a
   rejection. The layer publishes no "cancelled" status: a stage the source does not state is never inferred. */
const STAGES = ['PREPARATION', 'SUBMITTED', 'PRE_DEPOSIT', 'DEPOSITED', 'OBJECTIONS', 'APPROVAL_PROCESS', 'APPROVED', 'EFFECTIVE'];
const TERMINAL = ['REJECTED'];
const OTHER = ['OTHER', 'UNKNOWN'];
const STATION_STAGE = Object.freeze({
  'הכנת תכנית': 'PREPARATION', 'עריכת תכנית תמ"א': 'PREPARATION', 'מסמך מדיניות': 'PREPARATION', 'תסקיר סביבתי': 'PREPARATION', 'הכנת הודעה 77/78': 'PREPARATION',
  'בבדיקה תכנונית': 'SUBMITTED',
  'במילוי תנאים להפקדה': 'PRE_DEPOSIT',
  'הפקדה להתנגדויות/השגות': 'DEPOSITED', 'הגשת הערות והשגות': 'DEPOSITED', 'החלטת העברה להערות והשגות': 'DEPOSITED', 'מילוי תנאים להערות והשגות': 'DEPOSITED',
  'הכרעה בהתנגדויות / אישור': 'OBJECTIONS',
  'בהליך אישור': 'APPROVAL_PROCESS', 'העברה לממשלה לאישור': 'APPROVAL_PROCESS',
  'אישור': 'APPROVED',
  'רשת חלוקה': 'OTHER', 'אחר': 'OTHER', 'טיפול בתשריט מתקן': 'OTHER',
});
const REJECTED_EVENTS = new Set(['דחיית תכנית', 'התכנית נדחתה', 'לא מולאו תנאים']);
const EFFECTIVE_EVENT = 'פרסום אישור';
const clean = (v) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim() || null);
function stageOf(station, event) {
  const s = clean(station), e = clean(event);
  if (e && REJECTED_EVENTS.has(e)) return 'REJECTED';
  const st = s ? STATION_STAGE[s] : null;
  if (!st) return s ? 'UNKNOWN' : 'UNKNOWN';
  if (st === 'APPROVED' && e === EFFECTIVE_EVENT) return 'EFFECTIVE';
  return st;
}
/** 1…8 along STAGES (DERIVED); null for a rejected, other or unknown stage */
const maturityOf = (stage) => { const i = STAGES.indexOf(stage); return i < 0 ? null : i + 1; };

/* ───────────────────────── normalization ───────────────────────── */
const day = (ms) => (ms == null || ms === '' || !Number.isFinite(Number(ms)) ? null : new Date(Number(ms)).toISOString().slice(0, 10));
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const units = (v) => { const n = num(v); return n != null && n >= 0 ? n : null; };
const delta = (v) => num(v);
const planKey = (s) => { const t = clean(s); return t ? t.replace(/\s+/g, '') : null; };
const httpUrl = (v) => { const s = clean(v); return s && /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : null; };
const cut = (s, n) => { const t = clean(s); return t && t.length > n ? t.slice(0, n) + '…' : t; };

/** one layer feature's attributes → the stored plan record (every value as the layer publishes it, dates as days) */
function normalizePlan(a, ctx = {}) {
  const planNumber = clean(a && a.pl_number), mpId = num(a && a.mp_id);
  if (!planNumber || mpId == null) return null;
  const station = clean(a.station_desc), event = clean(a.internet_short_status), stage = stageOf(station, event);
  return {
    id: 'xplan:' + mpId, mpId, plId: num(a.pl_id), planNumber, planKey: planKey(planNumber), name: clean(a.pl_name),
    station, event, stage, kind: clean(a.entity_subtype_desc), permitPower: clean(a.plan_charactor_name),
    district: clean(a.district_name), jurisdiction: clean(a.jurstiction_area_name), locality: clean(a.plan_county_name), planningArea: clean(a.plan_area_name), committee: clean(a.ja_concat),
    areaDunam: num(a.pl_area_dunam), landUse: cut(a.pl_landuse_string, 400), objectives: cut(a.pl_objectives, 700),
    unitsApprovedState: units(a.pq_authorised_quantity_120), unitsChange: delta(a.quantity_delta_120),
    specialUnitsApprovedState: units(a.pq_authorised_quantity_110), specialUnitsChange: delta(a.quantity_delta_110), housingAreaChangeSqm: delta(a.quantity_delta_125),
    dates: { receivedDate: day(a.receiving_date), thresholdDate: day(a.date_saf), depositHearingDate: day(a.depositing_date), depositDate: day(a.pl_last_deposit_date),
      newspaperDate: day(a.pl_date_advertise), objectionsDeadline: day(a.pl_rejection_date), approvalHearingDate: day(a.pl_date7),
      approvalHandlingStart: day(a.on_hold_date), approvalHandlingEnd: day(a.open_date), gazetteDate: day(a.pl_date_8) },
    lastUpdate: day(a.last_update_date), url: httpUrl(a.pl_url), versions: { instructions: num(a.pl_order_print_version), map: num(a.pl_tasrit_prn_version) },
    provenance: { source: SOURCE.id, layer: LAYER, fetchedAt: ctx.fetchedAt || null, normalizerVersion: NORMALIZER_VERSION, classification: 'OFFICIAL' },
  };
}

/** a polygon (rings in WGS84) → a small stored outline: rings rounded to 5 decimals, bbox, area-weighted centroid */
function outlineOf(geometry) {
  const rings = geometry && Array.isArray(geometry.rings) ? geometry.rings.filter((r) => Array.isArray(r) && r.length >= 4) : [];
  if (!rings.length) return null;
  const R = rings.map((r) => r.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, A = 0, cx = 0, cy = 0;
  for (const r of R) for (let i = 0; i < r.length; i++) {
    const [x, y] = r[i]; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    if (i) { const [x0, y0] = r[i - 1], f = x0 * y - x * y0; A += f; cx += (x0 + x) * f; cy += (y0 + y) * f; }
  }
  const c = A ? [Math.round((cx / (3 * A)) * 1e5) / 1e5, Math.round((cy / (3 * A)) * 1e5) / 1e5] : [Math.round(((minX + maxX) / 2) * 1e5) / 1e5, Math.round(((minY + maxY) / 2) * 1e5) / 1e5];
  return { rings: R, bbox: [minX, minY, maxX, maxY], centroid: c, sr: 4326, generalized: 'maxAllowableOffset 0.00005° (~5 m)' };
}

/* ───────────────────────── the join ───────────────────────── */
/** the Mavat main-plan id in MoCH's site link, or null */
function mavatIdOf(complex) {
  const u = complex && complex.links && complex.links.site;
  const m = u && /^https?:\/\/mavat\.iplan\.gov\.il\/SV\d\/\d+\/(\d+)\//.exec(u);
  return m ? Number(m[1]) : null;
}
/** the stored planning data → lookup index */
function indexOf(data) {
  const plans = (data && Array.isArray(data.plans) ? data.plans : []).filter((p) => p && p.inLatestSource !== false);
  const byKey = new Map(), byMp = new Map();
  for (const p of plans) {
    if (!byKey.has(p.planKey)) byKey.set(p.planKey, []); byKey.get(p.planKey).push(p);
    if (!byMp.has(p.mpId)) byMp.set(p.mpId, []); byMp.get(p.mpId).push(p);
  }
  const L = (data && data.lookups) || {};
  return { byKey, byMp, askedKeys: new Set(L.planKeys || []), askedIds: new Set((L.mavatIds || []).map(Number)), checkedAt: data && data.checkedAt || null };
}
const distinctPlans = (list) => { const m = new Map(); for (const p of list || []) if (!m.has(p.mpId)) m.set(p.mpId, p); return [...m.values()]; };

/**
 * One complex → its match. status: exact · ambiguous · not-found · no-identifier · not-checked.
 * `spatial` (optional): plans related to the complex only by geometry — recorded, never joined.
 */
function matchComplex(complex, index, { spatial = [] } = {}) {
  const key = complex && complex.planNumber ? planKey(complex.planNumber) : null, mavatId = mavatIdOf(complex);
  const byNumber = key ? distinctPlans(index.byKey.get(key)) : [], byId = mavatId != null ? distinctPlans(index.byMp.get(mavatId)) : [];
  const diag = { planNumber: complex && complex.planNumber || null, planKey: key, mavatId, numberAsked: key ? index.askedKeys.has(key) : false, idAsked: mavatId != null ? index.askedIds.has(mavatId) || byId.length > 0 : false,
    byNumber: byNumber.map((p) => ({ mpId: p.mpId, planNumber: p.planNumber })), byId: byId.map((p) => ({ mpId: p.mpId, planNumber: p.planNumber })),
    spatialOnly: (spatial || []).map((p) => ({ mpId: p.mpId, planNumber: p.planNumber, note: 'related by geometry only — never joined' })) };
  const out = (status, plan, evidence, reason, extra = {}) => ({ status, mpId: plan ? plan.mpId : null, evidence, reason, ...extra, diagnostics: diag });
  if (!key && mavatId == null) return out('no-identifier', null, [], 'MoCH publishes neither a plan number nor a Mavat link for this complex');
  if (byNumber.length > 1) {
    const pick = mavatId != null ? byNumber.filter((p) => p.mpId === mavatId) : [];
    if (pick.length === 1) return out('exact', pick[0], ['plan-number', 'mavat-id'], 'the plan number names several plans; the Mavat id in MoCH\'s link selects exactly one');
    return out('ambiguous', null, [], `the plan number names ${byNumber.length} plans in the layer and no second key selects one`, { candidates: byNumber.map((p) => p.mpId) });
  }
  if (byNumber.length === 1) {
    const p = byNumber[0];
    if (mavatId != null && mavatId !== p.mpId) {
      return out('ambiguous', null, [], 'the plan number and the Mavat id in MoCH\'s link point at different plans — PROPX does not pick one', { candidates: [p.mpId, ...byId.map((x) => x.mpId)].filter((v, i, a) => a.indexOf(v) === i) });
    }
    return out('exact', p, mavatId != null ? ['plan-number', 'mavat-id'] : ['plan-number'], mavatId != null ? 'plan number and Mavat id agree' : 'plan number (MoCH publishes no Mavat link for this complex)');
  }
  /* no plan by number */
  if (byId.length === 1) {
    const p = byId[0];
    return out('exact', p, ['mavat-id'], key ? 'the plan number is not in the layer as MoCH writes it; the Mavat id in MoCH\'s own link names exactly one plan' : 'MoCH publishes no plan number; the Mavat id in its link names exactly one plan',
      { planNumberDiffers: key ? { moch: complex.planNumber, xplan: p.planNumber } : null });
  }
  if (byId.length > 1) return out('ambiguous', null, [], `the Mavat id names ${byId.length} plans in the layer`, { candidates: byId.map((p) => p.mpId) });
  const checked = (key ? diag.numberAsked : true) && (mavatId != null ? diag.idAsked : true);
  if (!checked) return out('not-checked', null, [], 'not yet looked up in the layer (a failed or pending request) — never assumed absent');
  const oldFormat = key && !/^\d{3}-\d{7}$/.test(key);
  return out('not-found', null, [], [key ? `plan number ${complex.planNumber} is not in the layer` : 'no plan number', mavatId != null ? `Mavat id ${mavatId} is not in the layer` : 'no Mavat link',
    oldFormat ? 'the number is in a local (pre-online) format — the layer holds plans managed online' : null].filter(Boolean).join(' · '), { oldFormat: !!oldFormat });
}

/* ───────────────────────── MoCH ↔ XPlan comparison and derived metrics ───────────────────────── */
const yearsBetween = (a, b) => (a && b ? Math.round(((Date.parse(b) - Date.parse(a)) / (365.25 * 864e5)) * 10) / 10 : null);
/** the approval reference date: the gazette publication on an EFFECTIVE plan, else the approval hearing; with its basis */
function approvalRef(p) {
  if (!p) return { date: null, basis: null };
  if (p.stage === 'EFFECTIVE' && p.dates.gazetteDate) return { date: p.dates.gazetteDate, basis: 'gazetteDate (pl_date_8, on an EFFECTIVE plan)' };
  if ((p.stage === 'EFFECTIVE' || p.stage === 'APPROVED') && p.dates.approvalHearingDate) return { date: p.dates.approvalHearingDate, basis: 'approvalHearingDate (pl_date7)' };
  return { date: null, basis: null };
}
const MOCH_APPROVED = new Set(['approved', 'approved-in-implementation', 'approved-after-licensing']);
/** MoCH vs XPlan, side by side — every pair shown, a disagreement flagged, never resolved */
function compare(complex, p) {
  if (!p) return [];
  const pairs = [];
  const add = (field, moch, xplan, note) => pairs.push({ field, moch: moch ?? null, xplan: xplan ?? null, differs: moch != null && xplan != null && moch !== xplan, note });
  const total = p.unitsApprovedState != null && p.unitsChange != null ? p.unitsApprovedState + p.unitsChange : null;
  add('existingUnits~unitsApprovedState', complex.existingUnits, p.unitsApprovedState, 'MoCH existing units vs the approved state the plan starts from');
  add('additionalUnits~unitsChange', complex.additionalUnits, p.unitsChange, 'MoCH additional units vs the change the plan makes');
  add('proposedUnits~unitsAfterPlan', complex.proposedUnits, total, 'MoCH proposed units vs approved state + change (DERIVED sum of two XPlan fields)');
  const ap = approvalRef(p);
  add('approvalYear', complex.approvalYear, ap.date ? Number(ap.date.slice(0, 4)) : null, 'MoCH approval year vs the year of XPlan\'s approval reference date (' + (ap.basis || 'none') + ')');
  const mochApproved = MOCH_APPROVED.has(complex.stage), xplanApproved = p.stage === 'APPROVED' || p.stage === 'EFFECTIVE';
  pairs.push({ field: 'stage', moch: complex.statusHe || null, xplan: [p.station, p.event].filter(Boolean).join(' · ') || null, differs: !!complex.statusHe && mochApproved !== xplanApproved,
    note: 'MoCH calls the plan ' + (mochApproved ? 'approved' : 'not approved') + '; XPlan stage ' + p.stage });
  if (complex.planNumber && planKey(complex.planNumber) !== p.planKey) pairs.push({ field: 'planNumber', moch: complex.planNumber, xplan: p.planNumber, differs: true, note: 'joined by the Mavat id; the numbers differ' });
  return pairs;
}
const STALE_YEARS = 3;
/** DERIVED metrics of a matched complex — each with its basis */
function derived(complex, p, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!p) return null;
  const ap = approvalRef(p), decl = complex.declarationDate || null, dep = p.dates.depositDate || null;
  const declToApproval = decl && ap.date ? yearsBetween(decl, ap.date) : null;
  const total = p.unitsApprovedState != null && p.unitsChange != null ? p.unitsApprovedState + p.unitsChange : null;
  const final = p.stage === 'EFFECTIVE' || p.stage === 'APPROVED' || p.stage === 'REJECTED';
  const sinceUpdate = p.lastUpdate ? yearsBetween(p.lastUpdate, today) : null;
  const permits = complex.permitsRaw != null && /^\d+$/.test(String(complex.permitsRaw)) ? Number(complex.permitsRaw) : null;
  const mochEvidence = complex.executionRaw === 'כן' || (permits != null && permits > 0) || complex.stage === 'approved-in-implementation' || complex.stage === 'approved-after-licensing';
  return {
    basis: 'DERIVED from the joined MoCH and XPlan values',
    maturity: maturityOf(p.stage), maturityOf: STAGES.length,
    yearsDeclarationToApproval: declToApproval != null && declToApproval >= 0 ? declToApproval : null,
    approvedBeforeDeclaration: declToApproval != null && declToApproval < 0 ? Math.abs(declToApproval) : null,
    yearsDepositToApproval: dep && ap.date && ap.date >= dep ? yearsBetween(dep, ap.date) : null,
    approvalBasis: ap.basis,
    unitsAfterPlan: total, unitDeltaVsMoch: total != null && complex.proposedUnits != null ? total - complex.proposedUnits : null,
    yearsSinceUpdate: sinceUpdate,
    stalePlanning: !final && sinceUpdate != null && sinceUpdate > STALE_YEARS,
    staleRule: `not approved / effective / rejected and the layer's last update is more than ${STALE_YEARS} years old`,
    approvedNoMochEvidence: (p.stage === 'EFFECTIVE' || p.stage === 'APPROVED') && !mochEvidence,
    evidenceRule: "MoCH's own columns: in execution (בביצוע = כן), permits (סך היתרים > 0) or a status after licensing / in implementation — none of them is not proof that nothing was built",
  };
}

/* ───────────────────────── the whole layer: per-complex join, coverage, pipeline (DERIVED counts) ───────────────────────── */
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10; };
const sumOf = (xs) => { const v = xs.filter((x) => x != null); return { sum: v.length ? v.reduce((a, b) => a + b, 0) : null, of: v.length }; };
/**
 * complexes (live MoCH records) × stored planning data → { byComplex: Map(id → joined), coverage, pipeline, cities, discrepancies, derivedCounts }.
 * Every unit sum over plans counts a plan ONCE, however many complexes reference it.
 */
function joinAll(complexes, data, { today = new Date().toISOString().slice(0, 10), minCity = 5 } = {}) {
  const index = indexOf(data), plansById = new Map(((data && data.plans) || []).map((p) => [p.mpId, p]));
  const byComplex = new Map(), byPlan = new Map();
  for (const c of complexes) {
    const m = matchComplex(c, index), p = m.status === 'exact' ? plansById.get(m.mpId) || null : null;
    byComplex.set(c.id, { match: m, plan: p, compare: p ? compare(c, p) : [], derived: p ? derived(c, p, { today }) : null });
    if (p) { if (!byPlan.has(p.mpId)) byPlan.set(p.mpId, []); byPlan.get(p.mpId).push(c.id); }
  }
  for (const [mpId, ids] of byPlan) if (ids.length > 1) for (const id of ids) byComplex.get(id).sharedWith = ids.filter((x) => x !== id);
  const J = (c) => byComplex.get(c.id), exact = complexes.filter((c) => J(c).match.status === 'exact');
  const count = (st) => complexes.filter((c) => J(c).match.status === st).length;
  const plansOf = (cs) => { const m = new Map(); for (const c of cs) { const p = J(c).plan; if (p && !m.has(p.mpId)) m.set(p.mpId, p); } return [...m.values()]; };
  const afterPlan = (p) => (p.unitsApprovedState != null && p.unitsChange != null ? p.unitsApprovedState + p.unitsChange : null);
  const reasons = {}; for (const c of complexes) { const m = J(c).match; if (m.status === 'exact' || m.status === 'ambiguous') continue;
    const k = m.status === 'no-identifier' ? 'no-plan-number-no-link' : m.status === 'not-checked' ? 'not-checked' : m.oldFormat ? 'local-format-number-not-online' : !c.planNumber ? 'no-plan-number-link-not-in-layer' : 'national-number-not-in-layer';
    reasons[k] = (reasons[k] || 0) + 1; }
  const evidence = {}; for (const c of exact) { const k = J(c).match.evidence.join('+'); evidence[k] = (evidence[k] || 0) + 1; }
  const coverage = {
    complexes: complexes.length, exact: exact.length, ambiguous: count('ambiguous'), notFound: count('not-found'), noIdentifier: count('no-identifier'), notChecked: count('not-checked'),
    unmatched: count('not-found') + count('no-identifier'), matchRate: complexes.length ? Math.round((exact.length / complexes.length) * 1000) / 10 : null,
    evidence, unmatchedReasons: reasons, distinctPlans: byPlan.size, sharedPlans: [...byPlan.values()].filter((v) => v.length > 1).length,
    mochProposedUnits: { all: sumOf(complexes.map((c) => c.proposedUnits)), matched: sumOf(exact.map((c) => c.proposedUnits)) },
    xplanUnitsAfterPlan: sumOf(plansOf(exact).map(afterPlan)),
    checkedAt: data && data.meta ? data.meta.checkedAt || null : null,
    basis: 'DERIVED counts over the exact join; a plan counts once however many complexes reference it',
  };
  const cityMap = new Map();
  for (const c of complexes) {
    const k = c.localityCode || c.city; if (!cityMap.has(k)) cityMap.set(k, { localityCode: c.localityCode, city: c.city, cs: [] }); cityMap.get(k).cs.push(c);
  }
  const cities = [...cityMap.values()].map(({ localityCode, city, cs }) => {
    const ex = cs.filter((c) => J(c).match.status === 'exact'), plans = plansOf(ex), approved = plans.filter((p) => p.stage === 'APPROVED' || p.stage === 'EFFECTIVE');
    return { localityCode, city, complexes: cs.length, exact: ex.length, matchRate: Math.round((ex.length / cs.length) * 1000) / 10,
      mochProposedUnits: sumOf(cs.map((c) => c.proposedUnits)), xplanPlans: plans.length, xplanApprovedPlans: approved.length,
      xplanUnitsAfterApprovedPlans: sumOf(approved.map(afterPlan)), xplanUnitsAfterAllPlans: sumOf(plans.map(afterPlan)) };
  });
  const ranked = cities.filter((c) => c.complexes >= minCity);
  const pipeline = STAGES.concat(TERMINAL, OTHER).map((st) => {
    const cs = exact.filter((c) => J(c).plan.stage === st), plans = plansOf(cs);
    return { stage: st, complexes: cs.length, plans: plans.length, mochProposedUnits: sumOf(cs.map((c) => c.proposedUnits)), xplanUnitsAfterPlan: sumOf(plans.map(afterPlan)) };
  }).filter((x) => x.complexes);
  const discrepancies = {}; for (const c of exact) for (const d of J(c).compare) if (d.differs) discrepancies[d.field] = (discrepancies[d.field] || 0) + 1;
  const comparable = {}; for (const c of exact) for (const d of J(c).compare) if (d.moch != null && d.xplan != null) comparable[d.field] = (comparable[d.field] || 0) + 1;
  const D = exact.map((c) => J(c).derived);
  const derivedCounts = {
    basis: 'DERIVED', stalePlanning: D.filter((d) => d.stalePlanning).length, staleRule: D.length ? D[0].staleRule : null,
    approvedNoMochEvidence: D.filter((d) => d.approvedNoMochEvidence).length, evidenceRule: D.length ? D[0].evidenceRule : null,
    approvedBeforeDeclaration: D.filter((d) => d.approvedBeforeDeclaration != null).length,
    medianYearsDeclarationToApproval: median(D.map((d) => d.yearsDeclarationToApproval)), withDeclarationToApproval: D.filter((d) => d.yearsDeclarationToApproval != null).length,
    medianYearsDepositToApproval: median(D.map((d) => d.yearsDepositToApproval)), withDepositToApproval: D.filter((d) => d.yearsDepositToApproval != null).length,
  };
  return { byComplex, coverage, pipeline, discrepancies: { differs: discrepancies, comparable },
    cities: { largestPipeline: cities.slice().sort((a, b) => (b.mochProposedUnits.sum || 0) - (a.mochProposedUnits.sum || 0)).slice(0, 15),
      approvedUnits: cities.filter((c) => c.xplanUnitsAfterApprovedPlans.sum != null).sort((a, b) => b.xplanUnitsAfterApprovedPlans.sum - a.xplanUnitsAfterApprovedPlans.sum).slice(0, 15),
      bestCoverage: ranked.slice().sort((a, b) => b.matchRate - a.matchRate || b.complexes - a.complexes).slice(0, 5),
      worstCoverage: ranked.slice().sort((a, b) => a.matchRate - b.matchRate || b.complexes - a.complexes).slice(0, 5), minComplexes: minCity },
    derivedCounts };
}

module.exports = { SOURCE, joinAll, LAYER, FIELDS, ALIAS, STAGES, TERMINAL, OTHER, STATION_STAGE, REJECTED_EVENTS, EFFECTIVE_EVENT, NORMALIZER_VERSION, STALE_YEARS,
  stageOf, maturityOf, normalizePlan, outlineOf, mavatIdOf, indexOf, matchComplex, compare, derived, approvalRef, planKey };
