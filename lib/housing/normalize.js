// PROPX · government housing — normalization of the official lottery rows.
//
// One record per official lottery, keyed by the source's LotteryId. Rules:
//   · every value is the source's own (OFFICIAL); a field the source left
//     blank ('', '-') or gave an impossible value stays null and is listed
//     in `missing` — never filled;
//   · labels are kept verbatim (Hebrew) next to any normalized key;
//   · the record's quantities keep the source's own meanings:
//       unitsInLottery  ≠ winners  ≠ signed sales  ≠ available inventory —
//     a continuation lottery re-offers units of its project's first lottery
//     and may draw more winners than it has units; nothing here is a sale;
//   · lifecycle stages come only from explicit official status fields
//     (permit status, project status). Construction start and completion are
//     not in this source and stay null.
// Rows with a malformed required identifier are rejected, with the reason.

'use strict';

const { createHash } = require('node:crypto');

const blank = (v) => v == null || String(v).trim() === '' || String(v).trim() === '-';
const text = (v) => (blank(v) ? null : String(v).trim().replace(/\s+/g, ' '));
const posInt = (v) => { if (blank(v)) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isInteger(n) && n > 0 ? n : null; };
const count = (v) => { if (blank(v)) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isInteger(n) && n >= 0 ? n : null; };
/* the source prints prices as "9,242.00"; 0 is not a price */
const price = (v) => { if (blank(v)) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
/* "2025-01-27 10:38:07" → date + datetime (source local time, kept as given) */
function when(v) {
  if (blank(v)) return { date: null, datetime: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(v).trim());
  if (!m) return { date: null, datetime: null };
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return { date: null, datetime: null };
  return { date: `${y}-${mo}-${d}`, datetime: h ? `${y}-${mo}-${d}T${h}:${mi}:${s || '00'}` : null };
}

/* program: the source's MarketingMethodDesc, verbatim + a stable key */
const PROGRAMS = { 'מחיר למשתכן': 'mechir-lamishtaken', 'מחיר מטרה': 'mechir-matara', 'דירה בהנחה': 'dira-behanacha' };
const BODIES = { 'משב"ש': 'moch', 'רמ"י': 'rmi' };
/* permit stage from the source's ConstructionPermitName (explicit official evidence only) */
const PERMIT = {
  'טרם הוגשה בקשה': 'not-submitted',
  'הוגשה בקשה': 'submitted',
  'הוגשה בקשה לחלק מהמגרשים': 'submitted-partial',
  'החלטת ועדה (היתר בתנאים)': 'conditional',
  'החלטת ועדה (היתר בתנאים) לחלק מהמגרשים': 'conditional-partial',
  'היתר מלא': 'full',
  'היתר מלא לחלק מהמגרשים': 'full-partial',
};
/* the ministry's process stage (ProjectStatus); only "post-occupancy control" evidences occupancy */
const STAGE = { 'בתהליכי הגרלה': 'lottery', 'בחירת דירות': 'unit-selection', 'בקרת חוזים': 'contract-control', 'בקרה לאחר אכלוס': 'post-occupancy' };

const REQUIRED = ['LotteryId', 'ProjectId', 'LamasCode'];
/* bump when the mapping below changes: stored records are then re-derived
   from the source rows WITHOUT history events (the source did not change) */
const NORMALIZER_VERSION = 1;

/** Normalize one official row. Returns {record} or {rejected:{reason,row}}. */
function normalizeLottery(row, ctx) {
  for (const k of REQUIRED) {
    if (posInt(row[k]) == null) return { rejected: { reason: `${k} missing or not a positive integer`, sourceRowId: row._id ?? null, value: row[k] ?? null } };
  }
  const lot = when(row.LotteryExecutionDate), signup = when(row.LotteryEndSignupDate);
  const programHe = text(row.MarketingMethodDesc), bodyHe = text(row.MarketingRep);
  const permitHe = text(row.ConstructionPermitName), stageHe = text(row.ProjectStatus), typeHe = text(row.LotteryType);
  const r = {
    id: 'lottery:' + posInt(row.LotteryId),
    lotteryId: posInt(row.LotteryId),
    projectId: posInt(row.ProjectId),
    parentLotteryId: posInt(row.ParentLotteryId),
    continuationLotteryId: posInt(row.ContinLotteryId),
    lotteryType: typeHe === 'ראשונה' ? 'first' : typeHe === 'המשך' ? 'continuation' : null,
    lotteryTypeHe: typeHe,
    round: text(row.CentralizationType),
    program: programHe ? PROGRAMS[programHe] || 'other' : null,
    programHe,
    marketingMethodCode: text(row.MarketingMethod),
    marketingBody: bodyHe ? BODIES[bodyHe] || 'other' : null,
    marketingBodyHe: bodyHe,
    eligibility: text(row.Eligibility),
    lotteryStatus: text(row.LotteryStatusValue),
    signupEndDate: signup.date,
    lotteryDate: lot.date,
    lotteryDateTime: lot.datetime,
    localityCode: posInt(row.LamasCode),
    city: text(row.LamasName),
    neighborhood: text(row.Neighborhood),
    projectName: text(row.ProjectName),
    developer: text(row.ProviderName),
    projectStage: stageHe ? STAGE[stageHe] || 'other' : null,
    projectStatusHe: stageHe,
    permitStage: permitHe ? PERMIT[permitHe] || 'other' : null,
    permitStatusHe: permitHe,
    pricePerSqm: price(row.PriceForMeter),
    unitsInLottery: count(row.LotteryHousingUnits),
    unitsAtSignup: count(row.LotterySignupHousingUnits),
    unitsLocalResidents: count(row.LotteryNativeHousingUnits),
    unitsLocalResidentsAtSignup: count(row.LotterySignupNativeHousingUnits),
    applicants: count(row.Subscribers),
    applicantsLocalResidents: count(row.SubscribersBenyMakom),
    applicantsDisabled: count(row.SubscribersDisabled),
    applicantsUpgraders: count(row.SubscribersMeshapryDiur),
    applicantsSeries: { a: count(row.SubscribersSeriesA), b: count(row.SubscribersSeriesB), c: count(row.SubscribersSeriesC) },
    winners: count(row.Winners),
    winnersLocalResidents: count(row.WinnersBneyMakom),
    winnersHomeless: count(row.WinnersHasryDiur),
    winnersUpgraders: count(row.WinnersMeshapryDiur),
    winnersSeries: { a: count(row.WinnersSeriesA), b: count(row.WinnersSeriesB), c: count(row.WinnersSeriesC) },
    /* lifecycle: only what an official field states; null = not evidenced */
    lifecycle: {
      permit: permitHe ? PERMIT[permitHe] || 'other' : null,
      occupancyEvidenced: stageHe === 'בקרה לאחר אכלוס' ? true : null,
      constructionStarted: null,          // not in this source
      completed: null,                    // not in this source (no Form 4 / completion field)
    },
    /* not published by this source — shown as — in the product */
    signedSales: null,
    availableInventory: null,
    totalProjectUnits: null,
    coordinates: null,
    provenance: {
      source: ctx.source.id, authority: ctx.source.authority, dataset: ctx.source.dataset, resourceId: ctx.source.resourceId,
      sourceRecordId: String(posInt(row.LotteryId)), sourceRowId: row._id ?? null,
      sourceUpdatedAt: ctx.sourceUpdatedAt || null, fetchedAt: ctx.fetchedAt, snapshotHash: ctx.snapshotHash || null,
      retrievalMethod: ctx.retrievalMethod || 'live-api',
      classification: 'OFFICIAL',         // every value is the source's own; aggregates over it are DERIVED
    },
  };
  r.missing = ['lotteryDate', 'signupEndDate', 'neighborhood', 'developer', 'pricePerSqm', 'unitsInLottery', 'winners', 'applicants']
    .filter((k) => r[k] == null).concat(['signedSales', 'availableInventory', 'totalProjectUnits', 'coordinates']);
  return { record: r };
}

/** Normalize a whole fetch. Duplicate LotteryIds are a source defect: the
 *  first is kept and the rest are rejected, never silently merged. */
function normalizeAll(rows, ctx) {
  const records = [], rejected = [], seen = new Set();
  for (const row of rows) {
    const out = normalizeLottery(row, ctx);
    if (out.rejected) { rejected.push(out.rejected); continue; }
    if (seen.has(out.record.id)) { rejected.push({ reason: 'duplicate LotteryId in one response', sourceRowId: row._id ?? null, value: row.LotteryId }); continue; }
    seen.add(out.record.id);
    records.push(out.record);
  }
  records.sort((a, b) => a.lotteryId - b.lotteryId);
  return { records, rejected };
}

/** Content hash of a raw response (row order independent). */
const hashRows = (rows) => createHash('sha1').update(JSON.stringify(rows.map((r) => { const { _id, ...rest } = r; return rest; })
  .map((r) => JSON.stringify(r)).sort())).digest('hex');

module.exports = { normalizeLottery, normalizeAll, hashRows, PROGRAMS, PERMIT, STAGE, NORMALIZER_VERSION };
