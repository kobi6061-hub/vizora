// PROPX · Land & Tender — normalization of the Israel Land Authority's tender records.
//
// One record per tender of the Authority's tender site (apps.land.gov.il/
// MichrazimSite), keyed by the site's own MichrazID. Rules:
//   · every value is the Authority's own; a blank or impossible value stays
//     null and is listed in `missing` — never filled, never estimated;
//   · the lifecycle stage is the Authority's status code, read through the
//     code table (lib/land/codes.js). PUBLISHED ≠ OPEN ≠ CLOSED ≠ DECIDED ≠
//     AWARDED: "awarded" needs a lot whose winner row carries a name AND an
//     award sum or a winning bid; a note the source wrote into the winner
//     column ("אין הצעות למתחם זה", "בחירת מתחם תערך במרחב") is kept as a
//     note and is never a winner. CONTRACTED, PERMIT and CONSTRUCTION START
//     are not in this source and stay null here (lib/land/planning.js adds
//     construction evidence only through exact parcel joins);
//   · the marketing track (open market / subsidized / rental / special
//     population / lottery / mixed / commercial) comes from the type and
//     purpose codes and the priority-population list, never from text;
//   · economics are derived per LOT, only when the numerator and the
//     denominator belong to that same lot, and every figure carries its
//     basis: a competitive bid is a total land price, a מחיר למשתכן bid is
//     ₪ per m² of built area under a ceiling, a lottery allocation is a
//     fixed price. The Authority does not state whether its sums include VAT:
//     `vat: 'not-stated-by-source'` on every figure;
//   · a tender's list row is re-read on every sync; its detail (lots, bids,
//     winners, parcels, plans) and map are fetched on a budget, so a record
//     may carry a detail observed at an earlier run — provenance.detail says
//     when. A record without detail has lots: null (not an empty list).
// Nothing here is an apartment-sale transaction.

'use strict';

const { createHash } = require('node:crypto');
const { TENDER_TYPES, STATUSES, PURPOSES, REGIONS, BID_STATES, POPULATIONS, trackOf, LOTTERY_TYPES, OPEN_MARKET_TYPES } = require('./codes');
const { BASE } = require('./rmi');
const { itmToWgs84, inIsrael } = require('../geo/itm');

const NORMALIZER_VERSION = 4;
const SOURCE_ID = 'rmi:michrazim';
const LIST_ENDPOINT = BASE + '/SearchApi/Search';
const detailEndpoint = (id) => `${BASE}/MichrazDetailsApi/Get?michrazID=${id}`;
const mapEndpoint = (id) => `${BASE}/MichrazDetailsApi/GetMichrazMapaDetails?michrazID=${id}`;
const TENDER_PAGE = (id) => `https://apps.land.gov.il/MichrazimSite/#/michraz/${id}`;

const blank = (v) => v == null || String(v).trim() === '' || String(v).trim() === '-';
const text = (v) => (blank(v) ? null : String(v).trim().replace(/\s+/g, ' '));
const num = (v) => { if (blank(v)) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const posNum = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };
const posInt = (v) => { const n = posNum(v); return n != null && Number.isInteger(n) ? n : null; };
const code = (v) => { const n = num(v); return n != null && Number.isInteger(n) ? n : null; };
/* the site dates are Israel-local midnight with an offset: the calendar date is the part before T */
const day = (v) => { const m = /^(\d{4}-\d{2}-\d{2})T/.exec(String(v || '')); return m ? m[1] : null; };
const stamp = (v) => { if (blank(v)) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const round = (x, p = 0) => (x == null ? null : Number(x.toFixed(p)));
const uniqBy = (arr, key) => { const seen = new Set(); return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** a plan number as a join key: the Authority's own number with every whitespace removed (exact join, lib/land/planning.js) */
const planKey = (s) => { const t = text(s); return t ? t.replace(/\s+/g, '') : null; };

/* the lifecycle stage for each status code of the Authority (TableID 237) */
const LIFECYCLE = Object.freeze({
  published: { he: 'פורסם', en: 'Published', order: 1 },
  open: { he: 'פתוח להצעות', en: 'Open for bids', order: 2 },
  closed: { he: 'נסגר — ממתין להחלטה', en: 'Closed — decision pending', order: 3 },
  'lottery-pending': { he: 'ממתין להגרלה', en: 'Awaiting lottery', order: 4 },
  decided: { he: 'נדון בוועדה', en: 'Committee decided', order: 5 },
  awarded: { he: 'הוכרזו זוכים', en: 'Awarded', order: 6 },
  'decided-no-award': { he: 'נדון — ללא זוכה', en: 'Decided — no winner recorded', order: 6 },
  frozen: { he: 'נדחה / מוקפא', en: 'Postponed / frozen', order: 7 },
  cancelled: { he: 'בוטל', en: 'Cancelled', order: 8 },
});
const STATUS_LIFECYCLE = { 1: 'published', 2: 'open', 3: 'closed', 4: 'frozen', 5: 'decided', 6: 'lottery-pending', 7: 'cancelled' };

/* the economic basis of a tender's prices (TableID 215 type + the detail's competition flags) */
const PRICE_BASES = Object.freeze({
  'competitive-bid': { he: 'הצעת מחיר (סה"כ לקרקע)', en: 'Competitive bid (total land price)' },
  'price-per-sqm-bid': { he: 'הצעה ב-₪ למ"ר בנוי (תחת מחיר מרבי)', en: 'Bid in ₪ per built m² (under a ceiling)' },
  'fixed-price-allocation': { he: 'הקצאה במחיר קבוע (הגרלה / קדימות)', en: 'Fixed-price allocation (lottery / priority)' },
  unknown: { he: 'בסיס לא מפורסם', en: 'Basis not published' },
});
/* SugTacharut 1 = price competition (verified on types 1, 2, 3, 5, 6 in the data: different winning bids over one minimum, HatzaaDescription 1).
   Lottery / priority types without that code allocate at a fixed price. Open-market types (TableID 215: מכרז פומבי רגיל, ייזום, עמידר,
   החברה לפיתוח עכו) are price tenders by the Authority's own definition: when an older detail carries no competition code, the type decides
   (basisEvidence 'tender-type'); any other stated code is 'unknown'. */
function priceBasisOf({ typeCode, competition, reducedPriceKind }) {
  if (typeCode === 7 || reducedPriceKind === 1) return 'price-per-sqm-bid';
  if (competition === 1) return 'competitive-bid';
  if (LOTTERY_TYPES.has(typeCode)) return 'fixed-price-allocation';   // the type allocates by lottery / priority and the source states no price competition
  if (competition != null) return 'unknown';
  if (OPEN_MARKET_TYPES.has(typeCode)) return 'competitive-bid';
  return 'unknown';
}
const basisEvidenceOf = ({ typeCode, competition, reducedPriceKind }) => (typeCode === 7 || reducedPriceKind === 1 ? 'tender-type' : competition != null ? 'SugTacharut' : 'tender-type');
const VAT = 'not-stated-by-source';

/* ───────────────────────── lots ───────────────────────── */
/* the notes the Authority writes into the winner column (exact strings observed in the data) — never a party */
const SOURCE_NOTES = new Set(['אין הצעות למתחם זה', 'אין הצעות למגרש זה', 'בחירת מתחם תערך במרחב', 'הצעות נמוכות', 'לא הוגשו הצעות', 'אין זוכה', 'בוטל']);

function normalizeBid(b) {
  const state = code(b.HatzaaDescription);
  return { bidId: code(b.HatzaaID), amount: posNum(b.HatzaaSum), stateCode: state || null, ...(posNum(b.TosefetLatmura) != null ? { addition: posNum(b.TosefetLatmura) } : {}) };
}

/** One lot (Tik) of a tender. The winner is recorded only with evidence (name + award sum, or name + winning bid). */
function normalizeLot(tik, basis) {
  const bids = (Array.isArray(tik.mpHatzaaotMitcham) ? tik.mpHatzaaotMitcham : []).map(normalizeBid).filter((b) => b.amount != null)
    .sort((a, b) => b.amount - a.amount);
  const minimumRaw = num(tik.MechirSaf);
  const lot = {
    lotId: text(tik.TikID), name: text(tik.MitchamName),
    areaSqm: posNum(tik.Shetach), builtAreaSqm: posNum(tik.ShetachBniya), units: posInt(tik.Kibolet),
    developmentCost: posNum(tik.HotzaotPituach),                 // MoCH-approved development/infrastructure levy for this lot, as published by the Authority
    minimumPrice: minimumRaw != null && minimumRaw > 1 ? minimumRaw : null,
    minimumIsToken: minimumRaw === 1,                              // "₪1": no real minimum published
    appraisal: posNum(tik.mechirShuma), guarantee: posNum(tik.SchumArvut),
    ceilingPerSqm: posNum(tik.MechirMaximum),                      // מחיר למשתכן: the maximum ₪/m² a bid may reach
    reducedConsideration: posNum(tik.TmuraMufchetet),
    winner: null, sourceNote: null, bids,
    plans: uniqBy((Array.isArray(tik.TochnitMigrash) ? tik.TochnitMigrash : []).map((t) => ({ plan: text(t.Tochnit), lot: text(t.MigrashName) }))
      .filter((p) => p.plan), (p) => planKey(p.plan) + '|' + p.lot),
    parcels: uniqBy((Array.isArray(tik.GushHelka) ? tik.GushHelka : []).map((g) => ({ block: text(g.Gush), parcel: text(g.Helka) })).filter((p) => p.block), (p) => p.block + '/' + p.parcel),
  };
  const name = text(tik.ShemZoche), award = posNum(tik.SchumZchiya), winning = bids.find((b) => b.stateCode === 1) || null;
  if (name && SOURCE_NOTES.has(name)) lot.sourceNote = name;        // the source wrote a note into the winner column
  else if (name && (award != null || winning)) {
    lot.winner = { name, amount: award != null ? award : winning.amount,
      evidence: award != null && winning ? 'winner-name+award-sum+winning-bid' : award != null ? 'winner-name+award-sum' : 'winner-name+winning-bid' };
  } else if (name && basis === 'fixed-price-allocation') {
    /* a lottery / priority allocation: the Authority names the allottee; the consideration is the fixed lot price, published or not */
    lot.winner = { name, amount: null, evidence: 'winner-name (fixed-price allocation, sum not published)' };
  } else if (name) lot.namedWithoutSum = { name, evidence: 'winner-name-only' };   // a name with no award sum and no winning bid: not an award
  lot.economics = lotEconomics(lot, basis);
  for (const k of Object.keys(lot)) if (lot[k] === null || lot[k] === false) delete lot[k];
  return lot;
}

/** Figures of ONE lot, each with its basis. Numerator and denominator are always this lot's own. */
function lotEconomics(lot, basis) {
  const price = lot.winner && lot.winner.amount != null ? lot.winner.amount : null;
  const e = { basis, vat: VAT, units: lot.units, bidsReceived: lot.bids.length || null };   // null: no bid list published
  if (basis === 'competitive-bid' || basis === 'fixed-price-allocation') {
    e.landPrice = price;
    e.landPerUnit = price != null && lot.units ? round(price / lot.units) : null;
    e.developmentPerUnit = lot.developmentCost != null && lot.units ? round(lot.developmentCost / lot.units) : null;
    e.totalBasisPerUnit = e.landPerUnit != null && e.developmentPerUnit != null ? e.landPerUnit + e.developmentPerUnit : null;
    e.premiumVsMinimum = price != null && lot.minimumPrice ? round(price / lot.minimumPrice - 1, 4) : null;
    e.premiumVsAppraisal = price != null && lot.appraisal ? round(price / lot.appraisal - 1, 4) : null;
    e.secondBid = lot.bids.find((b) => b.stateCode === 2) ? lot.bids.find((b) => b.stateCode === 2).amount : null;
  } else if (basis === 'price-per-sqm-bid') {
    e.pricePerSqm = price;                                          // ₪ per built m² — not a land total; no per-unit land cost can be derived from it
    e.ceilingPerSqm = lot.ceilingPerSqm;
    e.discountVsCeiling = price != null && lot.ceilingPerSqm ? round(1 - price / lot.ceilingPerSqm, 4) : null;
    e.developmentPerUnit = lot.developmentCost != null && lot.units ? round(lot.developmentCost / lot.units) : null;
    e.landPerUnit = null; e.landPerUnitUnavailable = 'per-sqm basis: the bid is a price per m² of the apartments, not a land consideration';
  }
  return e;
}

/** Figures of the whole tender, over its AWARDED lots only (numerators and denominators from the same lots). */
function tenderEconomics(lots, basis) {
  if (!lots) return null;
  const e = { basis, vat: VAT, lots: lots.length, awardedLots: lots.filter((l) => l.winner).length, unitsPublished: sumOf(lots, 'units'), scope: null };
  e.scope = e.awardedLots === 0 ? 'none-awarded' : e.awardedLots === lots.length ? 'all-lots' : 'awarded-lots-only';
  const bidLots = lots.filter((l) => l.bids.length);
  e.bidsReceived = bidLots.length ? bidLots.reduce((s, l) => s + l.bids.length, 0) : null;
  e.bidders = null;                                                  // the site publishes bid sums, not bidder identities
  if (basis === 'competitive-bid' || basis === 'fixed-price-allocation') {
    const priced = lots.filter((l) => l.winner && l.winner.amount != null), won = priced.filter((l) => l.units);
    e.pricedLots = priced.length;
    e.awardedLandTotal = priced.length ? priced.reduce((s, l) => s + l.winner.amount, 0) : null;   // every awarded lot with a published sum
    e.perUnitLots = won.length;                                                                      // the per-unit figures: lots with a sum AND units
    e.awardedUnits = won.length ? won.reduce((s, l) => s + l.units, 0) : null;
    e.perUnitLandTotal = won.length ? won.reduce((s, l) => s + l.winner.amount, 0) : null;
    e.landPerUnit = e.awardedUnits ? round(e.perUnitLandTotal / e.awardedUnits) : null;
    e.perUnitScope = !priced.length ? null : won.length === priced.length ? 'all-priced-lots' : won.length ? 'lots-with-units-only' : 'no-units-published';
    const dev = won.filter((l) => l.developmentCost != null);
    e.developmentPerUnit = dev.length === won.length && won.length ? round(dev.reduce((s, l) => s + l.developmentCost, 0) / e.awardedUnits) : null;
    e.totalBasisPerUnit = e.landPerUnit != null && e.developmentPerUnit != null ? e.landPerUnit + e.developmentPerUnit : null;
    const withMin = won.filter((l) => l.minimumPrice), withApp = won.filter((l) => l.appraisal);
    e.premiumVsMinimum = withMin.length ? round(withMin.reduce((s, l) => s + l.winner.amount, 0) / withMin.reduce((s, l) => s + l.minimumPrice, 0) - 1, 4) : null;
    e.premiumVsAppraisal = withApp.length ? round(withApp.reduce((s, l) => s + l.winner.amount, 0) / withApp.reduce((s, l) => s + l.appraisal, 0) - 1, 4) : null;
  } else if (basis === 'price-per-sqm-bid') {
    const won = lots.filter((l) => l.winner);
    const ps = won.map((l) => l.winner.amount);
    e.awardedUnits = won.filter((l) => l.units).length === won.length && won.length ? won.reduce((s, l) => s + l.units, 0) : null;
    e.pricePerSqmMin = ps.length ? Math.min(...ps) : null; e.pricePerSqmMax = ps.length ? Math.max(...ps) : null;
    const ceil = lots.map((l) => l.ceilingPerSqm).filter((x) => x != null);
    e.ceilingPerSqmMin = ceil.length ? Math.min(...ceil) : null; e.ceilingPerSqmMax = ceil.length ? Math.max(...ceil) : null;
    e.landPerUnit = null;
  }
  return e;
}
const sumOf = (arr, k) => { const v = arr.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) : null; };

/* ───────────────────────── the tender ───────────────────────── */

/** The map answer → a locality-independent position: the tender polygon's centroid in ITM, converted exactly to WGS84. Never a guess. */
function geometryOf(map) {
  if (!map || !posNum(map.CenterX) || !posNum(map.CenterY)) return null;
  const x = num(map.CenterX), y = num(map.CenterY);
  const { lat, lng } = itmToWgs84(x, y);
  if (!inIsrael(lat, lng)) return null;
  const g = { basis: 'tender-polygon-centroid', lat: round(lat, 6), lng: round(lng, 6), itm: { x: round(x, 1), y: round(y, 1) },
    bbox: [num(map.MinX), num(map.MinY), num(map.MaxX), num(map.MaxY)].every((v) => v != null && v > 0) ? { minX: num(map.MinX), minY: num(map.MinY), maxX: num(map.MaxX), maxY: num(map.MaxY) } : null,
    lotShapes: Array.isArray(map.Migrashim) ? map.Migrashim.filter((m) => m && m.TikShape).length : 0 };
  return g;
}

/**
 * normalizeTender({row, detail, map, prior, detailError}, ctx)
 *   row         the list row of this sync (required; the status of record)
 *   detail      the detail answer fetched this run, or null
 *   map         the map answer fetched this run, or null
 *   prior       the stored record, whose detail-derived parts are carried forward when no detail was fetched this run
 *   detailError {status, at} when the detail call failed this run (a 404 is remembered so it is not retried daily)
 *   ctx         {snapshotHash, fetchedAt, retrievalMethod, detailFetchedAt, mapFetchedAt}
 * Returns {record} or {error}. The record is the stored (slim) shape: codes, not labels — decorate() adds the
 * Authority's labels, the page link and the constant disclosures at read time. Lots travel in record.lots
 * (the store keeps them in per-year shards); winners carry their lot's units so the read model never needs the lots.
 */
function normalizeTender({ row, detail = null, map = null, prior = null, detailError = null }, ctx) {
  const michrazId = posInt(row && row.MichrazID);
  if (!michrazId) return { error: 'missing MichrazID' };
  const d = detail || null;
  const statusCode = code(row.StatusMichraz), typeCode = code(row.KodSugMichraz), purposeCode = code(row.KodYeudMichraz), regionCode = code(row.KodMerchav);
  const carried = !d && prior && prior.lots ? prior : null;
  const populations = d ? (Array.isArray(d.Uchlusiyot) ? d.Uchlusiyot.map(Number).filter((x) => POPULATIONS[x]) : []) : carried ? carried.populations : null;
  const competition = d ? code(d.SugTacharut) : carried ? carried.competitionCode : null;
  const reducedPriceKind = d ? code(d.SugMechirMufchat) : carried ? carried.reducedPriceKind : null;
  const basis = d || carried ? priceBasisOf({ typeCode, competition, reducedPriceKind }) : null;
  const lots = d ? (Array.isArray(d.Tik) ? d.Tik : []).map((t) => normalizeLot(t, basis)).filter((l) => l.lotId)
    : carried ? carried.lots.map((l) => {
      const x = { ...l };
      if (x.sourceNote && !SOURCE_NOTES.has(x.sourceNote) && !x.winner) {   // stored before the named-party rule: re-read
        if (basis === 'fixed-price-allocation') x.winner = { name: x.sourceNote, amount: null, evidence: 'winner-name (fixed-price allocation, sum not published)' };
        else x.namedWithoutSum = { name: x.sourceNote, evidence: 'winner-name-only' };
        delete x.sourceNote;
      }
      x.economics = lotEconomics({ ...x, bids: x.bids || [] }, basis); return x; }) : null;
  const winners = lots ? lots.filter((l) => l.winner).map((l) => ({ lotId: l.lotId, name: l.winner.name, amount: l.winner.amount ?? null, units: l.units ?? null })) : null;
  let lifecycle = STATUS_LIFECYCLE[statusCode] || null;
  if (lifecycle === 'decided' && lots) lifecycle = winners.length ? 'awarded' : 'decided-no-award';
  const units = posInt(row.YechidotDiur);
  const localityCode = posInt(row.KodYeshuv);
  const lotPlans = lots ? lots.flatMap((l) => l.plans.map((p) => ({ plan: p.plan, via: 'lot' }))) : [];
  const linkPlans = d ? (Array.isArray(d.MichrazLinks) ? d.MichrazLinks : []).map((l) => (/[?&]planNumber=([^&]+)/.exec(String(l.url || '')) || [])[1]).filter(Boolean)
    .map((p) => ({ plan: decodeURIComponent(p), via: 'site-link' })) : carried ? carried.plans.filter((p) => p.via === 'site-link').map((p) => ({ plan: p.plan, via: p.via })) : [];
  const plans = d || carried ? uniqBy([...lotPlans, ...linkPlans], (p) => planKey(p.plan)) : null;
  const parcels = lots ? uniqBy(lots.flatMap((l) => l.parcels), (p) => p.block + '/' + p.parcel) : null;
  const docs = d ? (Array.isArray(d.MichrazDocList) ? d.MichrazDocList : []) : null;
  const docsUpdatedAt = docs ? docs.map((x) => stamp(x.UpdateDate)).filter(Boolean).sort().pop() || null : carried ? carried.docsUpdatedAt : null;
  const geometry = map ? geometryOf(map) : prior && prior.geometry ? prior.geometry : null;
  const record = {
    id: `rmi:${michrazId}`, michrazId, name: text(row.MichrazName),
    statusCode, lifecycle, awardScope: lots && winners.length ? (winners.length === lots.length ? 'all-lots' : 'some-lots') : null,
    typeCode, purposeCode, track: trackOf({ typeCode, purposeCode, populations }),
    regionCode, localityCode, neighborhood: text(row.Shchuna), units,
    publishedDate: day(row.PirsumDate), openDate: day(row.PtichaDate), closeDate: day(row.SgiraDate), committeeDate: day(row.VaadaDate),
    lotteryDate: d ? day(d.HagralaDate) : carried ? carried.lotteryDate : null,
    bookletUpdatedAt: day(row.ChoveretUpdateDate),
    sourceUpdatedAt: d ? stamp(d.UpdateDate) : carried ? carried.sourceUpdatedAt : null,
    populations, competitionCode: competition, reducedPriceKind, subsidyFlag: d ? code(d.KayamSivsud) : carried ? carried.subsidyFlag : null,
    tenderMinimum: d ? (num(d.MechirSafMichraz) != null && num(d.MechirSafMichraz) > 1 ? num(d.MechirSafMichraz) : null) : carried ? carried.tenderMinimum : null,
    minimumKind: d ? code(d.MechirSafType) : carried ? carried.minimumKind : null,
    maxLotsPerBidder: d ? posInt(d.MaxToWin) : carried ? carried.maxLotsPerBidder : null,
    sourceMessage: d ? text(d.MessageDetails && d.MessageDetails.messageText) : carried ? carried.sourceMessage : null,
    priceBasis: basis, basisEvidence: basis ? basisEvidenceOf({ typeCode, competition, reducedPriceKind }) : null,
    namedWithoutSum: lots ? lots.filter((l) => l.namedWithoutSum).length || null : null,
    lotsDigest: lots ? hashRows(lots.map((l) => [l.lotId, l.units, l.areaSqm, l.developmentCost, l.minimumPrice, l.appraisal, l.ceilingPerSqm, l.winner, l.namedWithoutSum, l.sourceNote, (l.bids || []).map((b) => [b.bidId, b.amount, b.stateCode])])).slice(0, 12) : null,
    lotsCount: lots ? lots.length : null, bidsCount: lots ? lots.reduce((s, l) => s + l.bids.length, 0) : null,
    /* the lineage keys of each lot (the Authority's stable lot file id, its plan+lot numbers, its parcels) — lib/land/lineage.js */
    lotRefs: lots ? lots.map((l) => ({ id: l.lotId, keys: (l.plans || []).filter((p) => p.plan && p.lot).map((p) => planKey(p.plan) + '|' + String(p.lot).replace(/\s+/g, '')),
      parcels: (l.parcels || []).filter((p) => p.block && p.parcel && p.parcel !== '0').map((p) => p.block + '/' + p.parcel), units: l.units ?? null, won: !!l.winner })) : null,
    decisionDate: day(row.VaadaDate) || (d ? day(d.HagralaDate) : carried ? carried.lotteryDate : null) || null,
    lots, winners, plans, parcels,
    docs: docs ? docs.length : carried ? carried.docs : null, docsUpdatedAt,
    economics: tenderEconomics(lots, basis),
    geometry,
    construction: prior && prior.construction ? (lifecycle === 'awarded' ? prior.construction
      : { permit: null, start: null, links: [], checked: !!prior.construction.checked, evidence: 'not-applicable: no award recorded' }) : null,   // re-joined by lib/land/planning.js when the progress source answered this run
    provenance: {
      snapshotHash: ctx.snapshotHash ? String(ctx.snapshotHash).slice(0, 12) : null, fetchedAt: ctx.fetchedAt || null, retrievalMethod: ctx.retrievalMethod || 'live-api',
      detail: d ? { fetchedAt: ctx.detailFetchedAt || ctx.fetchedAt || null, hash: hashRows(d).slice(0, 12), statusCode: code(d.StatusMichrazMurchav) } : carried ? carried.provenance.detail : null,
      map: map ? { fetchedAt: ctx.mapFetchedAt || ctx.fetchedAt || null, hasShape: !!geometry } : prior && prior.provenance && prior.provenance.map ? prior.provenance.map : null,
      detailError: detailError ? { status: detailError.status || null, at: detailError.at || ctx.detailFetchedAt || null } : !d && prior && prior.provenance && prior.provenance.detailError ? prior.provenance.detailError : null,
    },
  };
  return { record };
}

/** The read-time shape: the Authority's labels, the page link, the lifecycle and basis wording, and the constant disclosures. */
function decorate(r) {
  if (!r) return r;
  const lc = r.lifecycle;
  return { ...r, page: TENDER_PAGE(r.michrazId),
    status: STATUSES[r.statusCode] ? STATUSES[r.statusCode].he : null, active: !!(STATUSES[r.statusCode] && STATUSES[r.statusCode].active),
    lifecycleHe: lc ? LIFECYCLE[lc].he : null, lifecycleEn: lc ? LIFECYCLE[lc].en : null,
    type: TENDER_TYPES[r.typeCode] || null, purpose: PURPOSES[r.purposeCode] ? PURPOSES[r.purposeCode].he : null,
    purposeGroup: PURPOSES[r.purposeCode] ? PURPOSES[r.purposeCode].group : null, region: REGIONS[r.regionCode] || null,
    trackBasis: r.populations ? 'type+purpose+populations' : 'type+purpose',
    populations: r.populations ? r.populations.map((p) => ({ code: p, he: POPULATIONS[p] })) : null,
    priceBasisHe: r.priceBasis ? PRICE_BASES[r.priceBasis].he : null, priceBasisEn: r.priceBasis ? PRICE_BASES[r.priceBasis].en : null,
    plans: r.plans ? r.plans.map((p) => ({ ...p, planKey: planKey(p.plan) })) : null,
    geoBasis: r.geometry ? r.geometry.basis : r.localityCode ? 'locality' : null,
    contracted: null, contractedEvidence: 'not-published-by-source',
    construction: r.construction || { permit: null, start: null, links: [], checked: false, evidence: r.lotsCount != null ? 'not-checked' : 'detail-not-read' },
    detailLevel: r.lotsCount != null ? 'detail' : 'list',
    missing: ['localityCode', 'units', 'publishedDate', 'closeDate', 'lifecycle'].filter((k) => r[k] == null).concat(r.lotsCount == null ? ['lots'] : []),
    provenance: { source: SOURCE_ID, listEndpoint: LIST_ENDPOINT, ...r.provenance,
      detail: r.provenance && r.provenance.detail ? { endpoint: detailEndpoint(r.michrazId), ...r.provenance.detail } : null,
      map: r.provenance && r.provenance.map ? { endpoint: mapEndpoint(r.michrazId), ...r.provenance.map } : null },
  };
}

/** every list row → records (+ the rejected rows with reasons) */
function normalizeList(rows, ctx, { details = new Map(), maps = new Map(), prior = new Map(), detailErrors = new Map() } = {}) {
  const records = [], rejected = [];
  for (const row of rows) {
    const id = row && row.MichrazID != null ? `rmi:${row.MichrazID}` : null;
    const r = normalizeTender({ row, detail: details.get(id) || null, map: maps.get(id) || null, prior: prior.get(id) || null, detailError: detailErrors.get(id) || null }, ctx);
    if (r.error) rejected.push({ id, reason: r.error }); else records.push(r.record);
  }
  return { records, rejected };
}

/* the fields whose change the status history records (the Authority's own values and the stages derived from them alone) */
const HISTORY_FIELDS = ['statusCode', 'lifecycle', 'units', 'publishedDate', 'openDate', 'closeDate', 'committeeDate', 'lotteryDate',
  'typeCode', 'purposeCode', 'regionCode', 'localityCode', 'neighborhood', 'populations', 'competitionCode', 'tenderMinimum', 'minimumKind',
  'winners', 'lotCount', 'bidCount', 'lotsDigest', 'docs', 'docsUpdatedAt', 'sourceUpdatedAt'];
function historyValue(rec, k) {
  if (k === 'lotCount') return rec.lotsCount == null ? (rec.lots ? rec.lots.length : null) : rec.lotsCount;
  if (k === 'bidCount') return (rec.bidsCount == null ? (rec.lots ? rec.lots.reduce((s, l) => s + l.bids.length, 0) : null) : rec.bidsCount) || null;
  if (k === 'winners') return rec.winners ? rec.winners.map((w) => ({ lotId: w.lotId, name: w.name, amount: w.amount })) : null;
  return rec[k] == null ? null : rec[k];
}
const hashRows = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

module.exports = { NORMALIZER_VERSION, SOURCE_ID, LIST_ENDPOINT, detailEndpoint, mapEndpoint, LIFECYCLE, STATUS_LIFECYCLE, PRICE_BASES, VAT,
  priceBasisOf, normalizeLot, lotEconomics, tenderEconomics, normalizeTender, normalizeList, decorate, geometryOf, TENDER_PAGE, planKey, HISTORY_FIELDS, historyValue, hashRows, text, num, day };
