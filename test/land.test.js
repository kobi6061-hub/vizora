// PROPX · Land & Tender — offline tests.
// `node test/land.test.js`
//
// Every tender below is a TEST FIXTURE (MichrazID 99900001+, locality 99001,
// names prefixed "TEST FIXTURE"), built in memory in the Authority's own field
// names and written only to temp directories.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const C = require('../lib/land/codes');
const N = require('../lib/land/normalize');
const P = require('../lib/land/planning');
const { mergeRecords, FileLandStore } = require('../lib/land/store');
const { SOURCES, byId } = require('../lib/land/sources');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'land-test-'));
const CTX = { snapshotHash: 'f'.repeat(64), fetchedAt: '2026-10-04T03:00:00.000Z', retrievalMethod: 'live-api' };

/* ---- fixtures in the Authority's own field names ---- */
let seq = 0;
const row = (o = {}) => ({ MichrazID: 99900000 + (++seq), MichrazName: `TEST FIXTURE ${seq}/2026`, KodMerchav: 2, StatusMichraz: 2, KodYeudMichraz: 2, KodYeshuv: 99001, KodSugMichraz: 1,
  PublishedChoveret: true, Mekuvan: true, YechidotDiur: 200, Shchuna: 'TEST FIXTURE שכונה', PirsumDate: '2026-07-09T00:00:00+03:00', PtichaDate: '2026-07-09T00:00:00+03:00',
  SgiraDate: '2026-08-05T12:00:00+03:00', VaadaDate: null, ChoveretUpdateDate: null, KhalYaadRashi: 2, ...o });
const lot = (o = {}) => ({ TikID: '0000800099' + String(++seq).padStart(3, '0'), MitchamName: 'א', Shetach: 10000, ShetachBniya: 0, Kibolet: 100, HotzaotPituach: 10000000, MechirSaf: 1,
  mechirShuma: 5000000, SchumArvut: 500000, ShemZoche: null, SchumZchiya: null, TmuraMufchetet: 0, MechirMaximum: null,
  TochnitMigrash: [{ Tochnit: 'תמל/9999', MigrashName: '210       ' }], mpHatzaaotMitcham: [], GushHelka: [{ Gush: '99999', Helka: '7' }], ...o });
const detail = (r, o = {}) => ({ MichrazID: r.MichrazID, StatusMichrazMurchav: r.StatusMichraz, SugTacharut: 1, SugMechirMufchat: 0, KayamSivsud: 0, MechirSafMichraz: 1, MechirSafType: 1,
  MaxToWin: null, UpdateDate: '2026-08-05T16:09:02.903+03:00', HagralaDate: null, Uchlusiyot: [], Tik: [lot()], MichrazDocList: [], MessageDetails: { messageText: 'TEST FIXTURE' }, MichrazLinks: [], ...o });
const map = (r) => ({ MichrazID: r.MichrazID, CenterX: 228701.281, CenterY: 768507.438, MinX: 228566.609, MinY: 768388.563, MaxX: 228843.922, MaxY: 768669.3, Migrashim: [{ TikShape: 'MULTIPOLYGON (())' }] });
const norm = (r, d, m, prior) => N.decorate(N.normalizeTender({ row: r, detail: d, map: m, prior }, CTX).record);
const WIN = { ShemZoche: 'TEST FIXTURE זוכה בע"מ ', SchumZchiya: 12000000, mpHatzaaotMitcham: [{ HatzaaID: 1, HatzaaSum: 12000000, HatzaaDescription: 1 }, { HatzaaID: 2, HatzaaSum: 11000000, HatzaaDescription: 2 }, { HatzaaID: 3, HatzaaSum: 9000000, HatzaaDescription: null }] };

(async () => {
  console.log('land: codes & classification');
  await t('the code tables are the Authority\'s (read from GeneralTablesApi, run recorded) and the track comes from codes alone', () => {
    assert.equal(C.TABLE_SOURCE.runId, '37224109743');
    assert.equal(C.TENDER_TYPES[7], 'מחיר למשתכן'); assert.equal(C.STATUSES[7].he, 'בוטל'); assert.equal(C.PURPOSES[2].group, 'מגורים');
    assert.equal(C.trackOf({ typeCode: 1, purposeCode: 2 }), 'open-market');
    assert.equal(C.trackOf({ typeCode: 7, purposeCode: 2 }), 'subsidized');
    assert.equal(C.trackOf({ typeCode: 5, purposeCode: 1 }), 'subsidized');
    assert.equal(C.trackOf({ typeCode: 6, purposeCode: 20 }), 'rental');
    assert.equal(C.trackOf({ typeCode: 1, purposeCode: 20 }), 'rental');
    assert.equal(C.trackOf({ typeCode: 2, purposeCode: 1, populations: [5] }), 'residential-lottery');
    assert.equal(C.trackOf({ typeCode: 2, purposeCode: 1, populations: [1] }), 'special-population');
    assert.equal(C.trackOf({ typeCode: 1, purposeCode: 12 }), 'mixed-use');
    assert.equal(C.trackOf({ typeCode: 1, purposeCode: 3 }), 'commercial-other');
    assert.equal(C.trackOf({ typeCode: 42, purposeCode: 2 }), 'unknown');
  });
  await t('subsidized tracks are never open market and open market never subsidized', () => {
    for (const ty of C.SUBSIDIZED_TYPES) assert.equal(C.trackOf({ typeCode: ty, purposeCode: 2 }), 'subsidized');
    for (const ty of C.OPEN_MARKET_TYPES) assert.equal(C.trackOf({ typeCode: ty, purposeCode: 2 }), 'open-market');
  });

  console.log('land: identity, lifecycle, winners');
  await t('record id = the Authority\'s MichrazID; a row without one is rejected', () => {
    const r = norm(row({ MichrazID: 99912345 }), null, null);
    assert.equal(r.id, 'rmi:99912345'); assert.equal(r.michrazId, 99912345);
    assert.ok(N.normalizeTender({ row: { MichrazName: 'x' } }, CTX).error);
    const { records, rejected } = N.normalizeList([row(), { MichrazName: 'no id' }], CTX);
    assert.equal(records.length, 1); assert.equal(rejected.length, 1);
  });
  await t('PUBLISHED ≠ OPEN ≠ CLOSED ≠ DECIDED ≠ AWARDED: each stage is the status code; "awarded" needs winner evidence', () => {
    assert.equal(norm(row({ StatusMichraz: 1 }), null, null).lifecycle, 'published');
    assert.equal(norm(row({ StatusMichraz: 2 }), null, null).lifecycle, 'open');
    assert.equal(norm(row({ StatusMichraz: 3 }), null, null).lifecycle, 'closed');
    assert.equal(norm(row({ StatusMichraz: 4 }), null, null).lifecycle, 'frozen');
    assert.equal(norm(row({ StatusMichraz: 6 }), null, null).lifecycle, 'lottery-pending');
    assert.equal(norm(row({ StatusMichraz: 7 }), null, null).lifecycle, 'cancelled');
    const r5 = row({ StatusMichraz: 5 });
    assert.equal(norm(r5, null, null).lifecycle, 'decided');                                   // no detail: decided, not awarded
    assert.equal(norm(r5, detail(r5), null).lifecycle, 'decided-no-award');                   // detail, no winner
    const aw = norm(r5, detail(r5, { Tik: [lot(WIN)] }), null);
    assert.equal(aw.lifecycle, 'awarded'); assert.equal(aw.awardScope, 'all-lots'); assert.equal(aw.winners.length, 1);
    assert.equal(aw.winners[0].name, 'TEST FIXTURE זוכה בע"מ'); assert.equal(aw.winners[0].amount, 12000000);
    /* a published or open tender with a stale winner column is still not "awarded" — the status rules */
    assert.equal(norm(row({ StatusMichraz: 2 }), detail(row(), { Tik: [lot(WIN)] }), null).lifecycle, 'open');
  });
  await t('a note in the winner column ("אין הצעות למתחם זה") is a note, never a winner; a name needs an award sum or a winning bid', () => {
    const r5 = row({ StatusMichraz: 5 });
    const a = norm(r5, detail(r5, { Tik: [lot({ ShemZoche: ' אין הצעות למתחם זה', SchumZchiya: 0 })] }), null);
    assert.equal(a.lots[0].winner, undefined); assert.equal(a.lots[0].sourceNote, 'אין הצעות למתחם זה'); assert.equal(a.lifecycle, 'decided-no-award');
    const b = norm(r5, detail(r5, { Tik: [lot({ ShemZoche: 'בחירת מתחם תערך במרחב', SchumZchiya: 0 })] }), null);
    assert.equal(b.lots[0].winner, undefined);
    const c = norm(r5, detail(r5, { Tik: [lot({ ShemZoche: 'TEST FIXTURE זוכה', SchumZchiya: null, mpHatzaaotMitcham: [{ HatzaaID: 9, HatzaaSum: 777, HatzaaDescription: 1 }] })] }), null);
    assert.equal(c.lots[0].winner.amount, 777); assert.equal(c.lots[0].winner.evidence, 'winner-name+winning-bid');
  });
  await t('multi-lot tenders: lots keep their own winners (one per lot, different names); partial awards are "some-lots"', () => {
    const r5 = row({ StatusMichraz: 5 });
    const d = detail(r5, { Tik: [lot(WIN), lot({ ...WIN, ShemZoche: 'TEST FIXTURE זוכה ב', SchumZchiya: 8000000, Kibolet: 50 }), lot({ ShemZoche: ' אין הצעות למתחם זה', SchumZchiya: 0 })] });
    const r = norm(r5, d, null);
    assert.equal(r.lots.length, 3); assert.equal(r.winners.length, 2); assert.equal(r.awardScope, 'some-lots');
    assert.deepEqual(r.winners.map((w) => w.name), ['TEST FIXTURE זוכה בע"מ', 'TEST FIXTURE זוכה ב']);
    assert.equal(r.economics.scope, 'awarded-lots-only'); assert.equal(r.economics.awardedUnits, 150); assert.equal(r.economics.awardedLandTotal, 20000000);
    assert.equal(r.economics.landPerUnit, Math.round(20000000 / 150));
  });
  await t('contracted / permit / construction start are never derived from an award', () => {
    const r5 = row({ StatusMichraz: 5 });
    const r = norm(r5, detail(r5, { Tik: [lot(WIN)] }), null);
    assert.equal(r.contracted, null); assert.equal(r.contractedEvidence, 'not-published-by-source');
    assert.equal(r.construction.permit, null); assert.equal(r.construction.start, null); assert.equal(r.construction.evidence, 'not-checked', 'no join ran: not checked');
  });

  console.log('land: economics');
  await t('competitive bid: per-unit figures use the lot\'s own numerator and denominator; VAT is labelled not stated', () => {
    const r5 = row({ StatusMichraz: 5 });
    const r = norm(r5, detail(r5, { Tik: [lot(WIN)] }), null);
    const e = r.lots[0].economics;
    assert.equal(e.basis, 'competitive-bid'); assert.equal(e.vat, 'not-stated-by-source');
    assert.equal(e.landPrice, 12000000); assert.equal(e.landPerUnit, 120000); assert.equal(e.developmentPerUnit, 100000); assert.equal(e.totalBasisPerUnit, 220000);
    assert.equal(e.premiumVsMinimum, null, 'the ₪1 token minimum yields no premium'); assert.equal(e.premiumVsAppraisal, 1.4);
    assert.equal(e.bidsReceived, 3); assert.equal(e.secondBid, 11000000);
    assert.equal(r.economics.bidders, null, 'bidder identities are not published');
  });
  await t('a real minimum (> ₪1) gives a premium; no units → no per-unit figure (never a default)', () => {
    const r5 = row({ StatusMichraz: 5 });
    const a = norm(r5, detail(r5, { Tik: [lot({ ...WIN, MechirSaf: 10000000 })] }), null).lots[0].economics;
    assert.equal(a.premiumVsMinimum, 0.2);
    const b = norm(r5, detail(r5, { Tik: [lot({ ...WIN, Kibolet: 0 })] }), null).lots[0].economics;
    assert.equal(b.units, null); assert.equal(b.landPerUnit, null); assert.equal(b.developmentPerUnit, null); assert.equal(b.totalBasisPerUnit, null);
  });
  await t('מחיר למשתכן: the bid is ₪/m² under a ceiling — no land-per-unit figure can be derived from it', () => {
    const r5 = row({ StatusMichraz: 5, KodSugMichraz: 7 });
    const r = norm(r5, detail(r5, { SugTacharut: null, Tik: [lot({ ShemZoche: 'TEST FIXTURE קבלן', SchumZchiya: 5885, MechirMaximum: 7000, Kibolet: 48 })] }), null);
    assert.equal(r.priceBasis, 'price-per-sqm-bid'); assert.equal(r.track, 'subsidized');
    const e = r.lots[0].economics;
    assert.equal(e.pricePerSqm, 5885); assert.equal(e.ceilingPerSqm, 7000); assert.equal(e.discountVsCeiling, Number((1 - 5885 / 7000).toFixed(4)));
    assert.equal(e.landPerUnit, null); assert.ok(e.landPerUnitUnavailable);
    assert.equal(r.economics.landPerUnit, null); assert.equal(r.economics.pricePerSqmMin, 5885);
  });
  await t('price basis follows the Authority\'s competition code first: a lottery type with SugTacharut 1 is a competitive bid; without the code it is a fixed-price allocation', () => {
    const r6 = row({ StatusMichraz: 6, KodSugMichraz: 2, KodYeudMichraz: 1 });
    const r = norm(r6, detail(r6, { SugTacharut: null, Uchlusiyot: ['1'], Tik: [lot({ Kibolet: 1, mechirShuma: 69100, SchumZchiya: 21421 })] }), null);
    assert.equal(r.priceBasis, 'fixed-price-allocation'); assert.equal(r.basisEvidence, 'tender-type'); assert.equal(r.track, 'special-population'); assert.equal(r.lifecycle, 'lottery-pending');
    assert.equal(r.lots[0].winner, undefined, 'a price without a name is not a winner');
    /* type 3 (מגרש בלתי מסוים) with SugTacharut 1: different bids over one minimum — as rmi:20220410 in the data */
    const r3 = row({ StatusMichraz: 5, KodSugMichraz: 3, KodYeudMichraz: 1 });
    const c = norm(r3, detail(r3, { SugTacharut: 1, Uchlusiyot: ['5'], Tik: [lot({ Kibolet: 1, MechirSaf: 1785500, mechirShuma: 3820606, ShemZoche: 'TEST FIXTURE א, TEST FIXTURE ב', SchumZchiya: 5612345 })] }), null);
    assert.equal(c.priceBasis, 'competitive-bid'); assert.equal(c.basisEvidence, 'SugTacharut'); assert.equal(c.lifecycle, 'awarded');
    assert.equal(c.lots[0].economics.premiumVsMinimum, Number((5612345 / 1785500 - 1).toFixed(4)));
    /* a lottery type with a stated competition code other than 1: lottery / priority allocation at a fixed price; an open-market type with such a code is not guessed */
    assert.equal(norm(r3, detail(r3, { SugTacharut: 4 }), null).priceBasis, 'fixed-price-allocation');
    assert.equal(norm(row({ KodSugMichraz: 1 }), detail(row(), { SugTacharut: 2 }), null).priceBasis, 'unknown');
    /* an open-market type whose older detail carries no competition code: the Authority's type says price tender */
    const r1 = row({ StatusMichraz: 5, KodSugMichraz: 1 });
    const o = norm(r1, detail(r1, { SugTacharut: null, Tik: [lot(WIN)] }), null);
    assert.equal(o.priceBasis, 'competitive-bid'); assert.equal(o.basisEvidence, 'tender-type'); assert.equal(o.economics.landPerUnit, 120000);
  });
  await t('a lottery allocation names its allottee (a winner without a published sum); elsewhere a name without a sum is a named party, never an award', () => {
    const r6 = row({ StatusMichraz: 5, KodSugMichraz: 2, KodYeudMichraz: 1 });
    const a = norm(r6, detail(r6, { SugTacharut: null, Uchlusiyot: ['1'], Tik: [lot({ Kibolet: 1, mechirShuma: 426280, ShemZoche: 'TEST FIXTURE משפחה', SchumZchiya: null })] }), null);
    assert.equal(a.lifecycle, 'awarded'); assert.equal(a.lots[0].winner.amount, null); assert.match(a.lots[0].winner.evidence, /fixed-price allocation/);
    assert.equal(a.economics.awardedLandTotal, null); assert.equal(a.economics.landPerUnit, null, 'no published sum → no price figure');
    const r1 = row({ StatusMichraz: 5, KodSugMichraz: 1 });
    const b = norm(r1, detail(r1, { Tik: [lot({ ShemZoche: 'TEST FIXTURE חברה', SchumZchiya: null })] }), null);
    assert.equal(b.lots[0].winner, undefined); assert.equal(b.lots[0].namedWithoutSum.name, 'TEST FIXTURE חברה'); assert.equal(b.lifecycle, 'decided-no-award'); assert.equal(b.namedWithoutSum, 1);
  });
  await t('a lottery type without detail is track "lottery" (population list not read), never "general public"', () => {
    const r = norm(row({ KodSugMichraz: 2, KodYeudMichraz: 1 }), null, null);
    assert.equal(r.track, 'lottery'); assert.equal(r.trackBasis, 'type+purpose');
    assert.equal(norm(row({ KodSugMichraz: 2, KodYeudMichraz: 1 }), detail(row(), { Uchlusiyot: ['5'] }), null).track, 'residential-lottery');
  });
  await t('awarded total sums every priced lot; the per-unit figure only the lots with units, and says so', () => {
    const r5 = row({ StatusMichraz: 5 });
    const r = norm(r5, detail(r5, { Tik: [lot(WIN), lot({ ...WIN, Kibolet: 0, SchumZchiya: 3000000 })] }), null);
    assert.equal(r.economics.pricedLots, 2); assert.equal(r.economics.awardedLandTotal, 15000000); assert.equal(r.economics.perUnitLots, 1);
    assert.equal(r.economics.awardedUnits, 100); assert.equal(r.economics.landPerUnit, 120000); assert.equal(r.economics.perUnitScope, 'lots-with-units-only');
  });
  await t('tender-level economics: only awarded lots are summed; dev cost per unit only when every awarded lot has one', () => {
    const r5 = row({ StatusMichraz: 5 });
    const r = norm(r5, detail(r5, { Tik: [lot(WIN), lot({ ...WIN, HotzaotPituach: 0 })] }), null);
    assert.equal(r.economics.awardedLots, 2); assert.equal(r.economics.developmentPerUnit, null); assert.equal(r.economics.totalBasisPerUnit, null);
  });

  console.log('land: geography');
  await t('a position comes only from the Authority\'s polygon centroid (exact ITM → WGS84); otherwise locality-level, never a fake pin', () => {
    const r = row();
    const withMap = norm(r, detail(r), map(r));
    assert.equal(withMap.geoBasis, 'tender-polygon-centroid'); assert.ok(Math.abs(withMap.geometry.lat - 33.0112) < 0.001 && Math.abs(withMap.geometry.lng - 35.3027) < 0.001);
    const noMap = norm(r, detail(r), null);
    assert.equal(noMap.geometry, null); assert.equal(noMap.geoBasis, 'locality');
    const empty = norm(r, detail(r), { MichrazID: null, CenterX: null, CenterY: null, MaxX: 0, MaxY: 0, MinX: 0, MinY: 0, MichrazShape: null, Migrashim: [] });
    assert.equal(empty.geometry, null); assert.equal(empty.geoBasis, 'locality');
    assert.equal(N.geometryOf({ CenterX: 1, CenterY: 1 }), null, 'a point outside Israel is refused');
  });

  console.log('land: joins');
  await t('plan join is by the exact plan number (whitespace removed); site-link ids are never joined; a near miss does not join', () => {
    assert.equal(N.planKey(' תמל/ 9999 '), 'תמל/9999');
    assert.deepEqual(norm(row(), detail(row()), null).winners, [], 'winners carry lot units for the read model');
    const r = norm(row(), detail(row(), { MichrazLinks: [{ url: 'https://apps.land.gov.il/TabaSearch/#/Plans?planNumber=2051381' }] }), null);
    const x = P.normalizeXplanFeature({ pl_number: 'תמל/9999', pl_id: 1, pl_name: 'TEST FIXTURE', station_desc: 'אישור', pq_authorised_quantity_120: 1200, pl_date_8: 1700000000000, pl_area_dunam: 50 }, { fetchedAt: CTX.fetchedAt });
    const near = P.normalizeXplanFeature({ pl_number: 'תמל/999', pq_authorised_quantity_120: 5 }, { fetchedAt: CTX.fetchedAt });
    const j = P.joinPlans(r, { xplan: new Map([[x.planKey, x], [near.planKey, near]]), inventory: new Map() });
    const lotPlan = j.plans.find((p) => p.via === 'lot'), link = j.plans.find((p) => p.via === 'site-link');
    assert.equal(lotPlan.join, 'exact-plan-number'); assert.equal(lotPlan.xplan.approvedUnits, 1200); assert.equal(lotPlan.xplan.station, 'אישור');
    assert.equal(link.join, 'not-a-plan-number'); assert.equal(link.xplan, null); assert.equal(lotPlan.xplanStatus, 'found');
    const unchecked = P.joinPlans(r, { xplan: new Map(), inventory: new Map() }).plans.find((p) => p.via === 'lot');
    assert.equal(unchecked.xplanStatus, 'not-checked', 'never asked → not checked, not "not found"');
    assert.equal(P.joinPlans(r, { xplan: new Map(), inventory: new Map(), misses: new Set(['תמל/9999']) }).plans.find((p) => p.via === 'lot').xplanStatus, 'not-found');
    assert.equal(j.planning.approvedUnitsInPlans, 1200); assert.equal(j.planning.basis, 'exact-plan-number');
  });
  await t('construction evidence only through an exact block AND parcel; parcel "0" never joins; the stale date travels with it', () => {
    const r = norm(row(), detail(row()), null);
    const pctx = { sourceUpdatedAt: '2024-03-01T01:15:14.000Z', fetchedAt: CTX.fetchedAt };
    const hit = P.normalizeProgressRow({ _id: 1, GUSH: '99999', HELKA: '7', YESHUV_LAMAS: 'TEST FIXTURE', MISPAR_BINYAN: '1', YEHIDOT_BINYAN: 10, TAARICH_SHLAV_BNIYA_5: '41000', TAARICH_SHLAV_BNIYA_42: '-' }, pctx);
    const zero = P.normalizeProgressRow({ _id: 2, GUSH: '99999', HELKA: '0' }, pctx);
    const other = P.normalizeProgressRow({ _id: 3, GUSH: '99999', HELKA: '8', TAARICH_SHLAV_BNIYA_5: '41000' }, pctx);
    assert.equal(zero.joinable, false);
    const by = new Map([['99999/7', [hit]], ['99999/8', [other]]]);
    /* an un-awarded tender never carries construction evidence, whatever its parcels say */
    const na = P.joinConstruction(r, by);
    assert.equal(na.construction.links.length, 0); assert.match(na.construction.evidence, /not-applicable/); assert.equal(na.construction.checked, true);
    const a5 = row({ StatusMichraz: 5, VaadaDate: '2010-05-01T00:00:00+03:00' });
    const awarded = norm(a5, detail(a5, { Tik: [lot(WIN)] }), null);
    /* a row contracted before the award belongs to an earlier marketing of the parcel */
    const early = P.normalizeProgressRow({ _id: 4, GUSH: '99999', HELKA: '7', SHNAT_HOZE: '1997', TAARICH_SHLAV_BNIYA_5: '36000' }, pctx);
    assert.equal(P.joinConstruction(awarded, new Map([['99999/7', [early]]])).construction.links.length, 0);
    const j = P.joinConstruction(awarded, by);
    assert.equal(j.construction.links.length, 1); assert.equal(j.construction.links[0].join, 'exact-block-parcel'); assert.equal(j.construction.evidence, 'moch-progress:exact-block-parcel');
    assert.equal(j.construction.start, '2012-04-01'); assert.equal(j.construction.completion, null); assert.equal(j.construction.permit, null);
    assert.equal(j.construction.links[0].asOf, '2024-03-01');
    assert.equal(P.joinConstruction(awarded, new Map()).construction.evidence, 'no-exact-parcel-join');
    assert.equal(N.decorate(N.normalizeTender({ row: a5, detail: detail(a5, { Tik: [lot(WIN)] }) }, CTX).record).construction.evidence, 'not-checked', 'no join run → not checked, never "no join"');
  });
  await t('the planning inventory is state land only and dated; potential units are never read as nationwide coverage', () => {
    const p = P.normalizeInventoryRow({ _id: 1, 'מפתח לפוליגון תכנית': 806201, 'מספר תוכנית': 'תמל/9999', 'שם תוכנית': 'TEST FIXTURE', 'שלב תכנוני': 'תוקף', 'סמל יישוב': 99001, 'יישוב': 'TEST', 'תאריך פרסום לאישור ברשומות': '19/12/2017', 'יחד פוטנציאל לשיווק': 4002 },
      { sourceUpdatedAt: '2022-02-17T10:59:42.000Z', fetchedAt: CTX.fetchedAt, snapshotHash: 'abc' });
    assert.equal(p.stateLandOnly, true); assert.equal(p.asOf, '2022-02-17'); assert.equal(p.potentialUnits, 4002); assert.equal(p.approvalDate, '2017-12-19');
    const src = byId['datagov:rmi:planning-inventory'];
    assert.equal(src.classification, 'STALE'); assert.match(src.geographicCoverage, /state land only/i);
  });

  await t('xplan lookups: a failed batch leaves its plans unasked (re-asked next run); only a successful batch can produce a miss', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; if (n === 2) throw new Error('timeout'); return { json: async () => ({ features: [{ attributes: { pl_number: n === 1 ? 'A/1' : 'C/1', pq_authorised_quantity_120: 10 } }] }) }; };
    const got = await P.fetchXplanPlans(['A/1', 'A/2', 'B/1', 'B/2', 'C/1', 'C/2'], { fetchImpl, batch: 2 });
    assert.equal(got.found.size, 2); assert.deepEqual([...got.askedKeys].sort(), ['A/1', 'A/2', 'C/1', 'C/2']); assert.equal(got.complete, false); assert.equal(got.errors.length, 1);
  });

  console.log('land: history & store');
  await t('upsert on id, firstSeenAt kept, source changes recorded, delisted kept (never deleted), relisted recorded', () => {
    const a = row({ StatusMichraz: 2 }), b = row({ StatusMichraz: 2 });
    const r1 = [norm(a, detail(a), null), norm(b, null, null)];
    const m1 = mergeRecords([], r1, { fetchedAt: '2026-10-01T00:00:00Z', syncRunId: 'run1' });
    assert.equal(m1.stats.inserted, 2); assert.equal(m1.history.length, 0);
    const a5 = { ...a, StatusMichraz: 5 };
    const r2 = [norm(a5, detail(a5, { Tik: [lot(WIN)] }), null)];
    const m2 = mergeRecords(m1.records, r2, { fetchedAt: '2026-10-02T00:00:00Z', syncRunId: 'run2', prevCheckedAt: '2026-10-01T00:00:00Z', presentIds: new Set([r2[0].id]) });
    assert.equal(m2.stats.updated, 1); assert.equal(m2.stats.missingFromSource, 1); assert.equal(m2.records.length, 2);
    const ra = m2.records.find((r) => r.id === r2[0].id), rb = m2.records.find((r) => r.id !== r2[0].id);
    assert.equal(ra.firstSeenAt, '2026-10-01T00:00:00Z'); assert.equal(ra.lifecycle, 'awarded');
    assert.equal(rb.inLatestSource, false); assert.equal(rb.lastSeenAt, '2026-10-01T00:00:00Z');
    const fields = m2.history.map((h) => h.field);
    for (const f of ['statusCode', 'lifecycle', 'winners', 'inLatestSource']) assert.ok(fields.includes(f), f + ' not in history');
    const m3 = mergeRecords(m2.records, [r2[0], norm(b, null, null)], { fetchedAt: '2026-10-03T00:00:00Z', syncRunId: 'run3' });
    assert.ok(m3.history.some((h) => h.field === 'inLatestSource' && h.to === true)); assert.equal(m3.stats.unchanged, 2); assert.ok(m3.records.every((r) => r.inLatestSource));
  });
  await t('a stored detail is carried forward when the run read only the list; a fresh list status still rules', () => {
    const a = row({ StatusMichraz: 3 });
    const first = norm(a, detail(a, { Tik: [lot(), lot()] }), map(a));
    const later = norm({ ...a, StatusMichraz: 5 }, null, null, first);
    assert.equal(later.detailLevel, 'detail'); assert.equal(later.lots.length, 2); assert.equal(later.lifecycle, 'decided-no-award');
    assert.equal(later.provenance.detail.fetchedAt, first.provenance.detail.fetchedAt); assert.equal(later.geometry.basis, 'tender-polygon-centroid');
    const listOnly = norm(a, null, null, null);
    assert.equal(listOnly.lots, null); assert.equal(listOnly.economics, null); assert.ok(listOnly.missing.includes('lots'));
  });
  await t('file store: one record per line, raw snapshot once per content hash, history appended', () => {
    const dir = tmp(), s = new FileLandStore(dir);
    const a = row(); const recs = mergeRecords([], [norm(a, detail(a), null)], { fetchedAt: CTX.fetchedAt, syncRunId: 'r' }).records;
    const name = s.snapshotRaw([a], 'a'.repeat(64), CTX.fetchedAt, { endpoint: N.LIST_ENDPOINT });
    assert.equal(s.snapshotRaw([a], 'a'.repeat(64), CTX.fetchedAt), null);
    s.write({ records: recs, history: [{ id: recs[0].id, field: 'statusCode', from: 1, to: 2, observedAt: CTX.fetchedAt }], meta: { snapshotHash: 'a'.repeat(64) }, run: { id: 'r' } });
    assert.equal(s.readRecords().length, 1); assert.equal(s.readHistory().length, 1); assert.equal(s.readRuns().length, 1); assert.ok(name && fs.existsSync(path.join(dir, 'raw', name)));
    assert.equal(fs.readFileSync(path.join(dir, 'tenders.json'), 'utf8').split('\n').length, 4);
    assert.ok(!fs.readFileSync(path.join(dir, 'tenders.json'), 'utf8').includes('"lots":['), 'lots live in the per-year shard, not in tenders.json');
    assert.ok(fs.existsSync(path.join(dir, 'lots-9990.json')) && s.readRecords()[0].lots.length === 1, 'lots re-attached from the shard');
  });
  await t('the sync refuses to replay a file into the production data directory', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/land-sync.js'), '--from', path.join(ROOT, 'package.json')], { encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr + r.stdout, /refused/);
  });

  console.log('land: read model (api views over a fixture store)');
  await t('filters: period by published / close / committee date, custom range validated, city by code or official name, winner exact, lifecycle list', () => {
    const dir = tmp(), s = new FileLandStore(dir);
    const a = row({ StatusMichraz: 5, KodYeshuv: 5000, PirsumDate: '2026-01-10T00:00:00+02:00', SgiraDate: '2026-03-01T12:00:00+02:00', VaadaDate: '2026-04-02T00:00:00+03:00' });
    const b = row({ StatusMichraz: 2, KodYeshuv: 6100, PirsumDate: '2025-06-01T00:00:00+03:00', SgiraDate: '2025-08-01T12:00:00+03:00' });
    const c = row({ StatusMichraz: 7, KodYeshuv: 5000, PirsumDate: '2024-01-01T00:00:00+02:00' });
    const recs = [N.normalizeTender({ row: a, detail: detail(a, { Tik: [lot(WIN), lot({ ...WIN, ShemZoche: 'TEST FIXTURE זוכה ב', SchumZchiya: 8000000, Kibolet: 50 })] }) }, CTX).record,
      N.normalizeTender({ row: b, detail: detail(b) }, CTX).record, N.normalizeTender({ row: c }, CTX).record];
    const { records } = mergeRecords([], recs, { fetchedAt: CTX.fetchedAt, syncRunId: 'r' });
    s.write({ records, meta: { checkedAt: CTX.fetchedAt, snapshotHash: 'a'.repeat(64), coverage: { publishedFrom: '2024-01-01', publishedTo: '2026-01-10', closeFrom: '2025-08-01', closeTo: '2026-03-01', committeeFrom: '2026-04-02', committeeTo: '2026-04-02' }, detail: { withDetail: 2 } }, run: { id: 'r' } });
    const Q = require('../lib/land/query');
    const F = (q) => Q.parseFilters(new URLSearchParams(q), new Date('2026-10-04T12:00:00Z'));
    assert.equal(F('period=custom&from=2026-02-01').error, 'custom period needs from and to as YYYY-MM-DD');
    assert.equal(F('period=custom&from=2026-02-01&to=2026-01-01').error, 'from is after to');
    assert.equal(F('period=12m').filters.from, '2025-10-04');
    const n = (q, o) => Q.records(F(q).filters, { dataDir: dir, ...o }).total;
    assert.equal(n('period=all'), 3);
    assert.equal(n('period=custom&from=2026-01-01&to=2026-01-31'), 1, 'published in January 2026');
    assert.equal(n('period=custom&from=2026-01-01&to=2026-01-31&dateField=close'), 0, 'none closed in January');
    assert.equal(n('period=custom&from=2026-03-01&to=2026-03-01&dateField=close'), 1);
    assert.equal(n('period=custom&from=2026-04-01&to=2026-04-30&dateField=committee'), 1);
    assert.equal(n('city=5000'), 2); assert.equal(n('city=תל אביב-יפו'), 2, 'the official locality name resolves through the registry'); assert.equal(n('city=6100'), 1);
    assert.equal(n('lifecycle=awarded,cancelled'), 2); assert.equal(n('awarded=1'), 1);
    assert.equal(n('winner=' + encodeURIComponent('TEST FIXTURE זוכה בע"מ')), 1); assert.equal(n('winner=' + encodeURIComponent('TEST FIXTURE זוכה')), 0, 'winner is an exact string, not a prefix');
    assert.equal(n('q=' + encodeURIComponent('זוכה ב')), 1);
    const S = Q.summary(F('period=all').filters, { dataDir: dir });
    assert.equal(S.kpis.tenders, 3); assert.equal(S.kpis.awarded, 1); assert.equal(S.kpis.open, 1); assert.equal(S.kpis.cancelled, 1);
    assert.equal(S.kpis.unitsAwarded, 150); assert.equal(S.kpis.awardedLandTotal, 20000000); assert.equal(S.kpis.landPerUnit, Math.round(20000000 / 150));
    assert.equal(S.kpis.landPerUnitLots, 2); assert.equal(S.kpis.vat, 'not-stated-by-source'); assert.equal(S.kpis.contracted, null); assert.equal(S.kpis.permits, null);
    assert.deepEqual(S.kpis.landPerUnitTracks, ['open-market']); assert.equal(S.kpis.landPerUnitBasis, 'competitive-bid');
    /* a subsidized (מחיר מטרה) tender and a fixed-price lottery allocation never enter the open-market land figure */
    const sub = row({ StatusMichraz: 5, KodSugMichraz: 5, KodYeshuv: 5000, PirsumDate: '2023-05-01T00:00:00+03:00' }), lotr = row({ StatusMichraz: 5, KodSugMichraz: 2, KodYeudMichraz: 1, KodYeshuv: 5000, PirsumDate: '2023-04-01T00:00:00+03:00' });
    const extra = [N.normalizeTender({ row: sub, detail: detail(sub, { Tik: [lot({ ...WIN, SchumZchiya: 100000 })] }) }, CTX).record,
      N.normalizeTender({ row: lotr, detail: detail(lotr, { SugTacharut: null, Uchlusiyot: ['5'], Tik: [lot({ Kibolet: 1, ShemZoche: 'TEST FIXTURE זוכה הגרלה', SchumZchiya: 500000 })] }) }, CTX).record];
    const s2 = new FileLandStore(dir); s2.write({ records: mergeRecords(records, [...records, ...extra], { fetchedAt: CTX.fetchedAt }).records, meta: s2.readMeta(), run: { id: 'r2' } });
    const S2 = Q.summary(F('period=all').filters, { dataDir: dir });
    assert.equal(S2.kpis.landPerUnit, Math.round(20000000 / 150), 'unchanged by the subsidized and lottery lots'); assert.equal(S2.kpis.fixedPriceLots, 1);
    assert.equal(Q.summary(F('track=subsidized').filters, { dataDir: dir }).kpis.landPerUnit, 1000, 'a selected track reports its own figure');
    const lotDev = S2.developers.find((d) => d.name === 'TEST FIXTURE זוכה הגרלה');
    assert.equal(lotDev.landTotalCompetitive, null); assert.equal(lotDev.fixedLots, 1); assert.equal(lotDev.lotsWon, 1);
    assert.equal(S.developers.length, 2, 'two different winner strings stay two developers');
    assert.equal(S.kpis.decidedWithoutDetail, 0);
    assert.deepEqual(S.developers.map((d) => d.basis), ['observed-public-tender-wins', 'observed-public-tender-wins']);
    assert.equal(S.cities[0].localityCode, 5000); assert.equal(S.cities[0].city, 'תל אביב - יפו');
    assert.ok(S.methodology.landPerUnit.includes('same awarded lots'));
    const none = Q.summary(F('period=custom&from=2027-01-01&to=2027-02-01').filters, { dataDir: dir });
    assert.equal(none.coverage.state, 'none'); assert.equal(none.kpis, null, 'a period the source does not cover is "—", not zero');
    const R = Q.records(F('period=all').filters, { dataDir: dir, sort: 'publishedDate', order: 'desc', size: 2 });
    assert.equal(R.pages, 1); assert.equal(R.size, 5, 'page size floor'); assert.equal(R.rows.length, 5); assert.equal(R.rows[0].lifecycle, 'awarded'); assert.equal(R.rows[0].winners.length, 2); assert.equal(R.rows[0].page, `https://apps.land.gov.il/MichrazimSite/#/michraz/${R.rows[0].michrazId}`);
    assert.equal(R.rows[1].lots, 1); assert.equal(R.rows[1].winners.length, 0);
    const one = Q.record(String(recs[0].michrazId), { dataDir: dir });
    assert.equal(one.record.lots.length, 2, 'lots hydrated from the year shard'); assert.equal(one.lifecycle.stage, 'awarded'); assert.equal(one.lifecycle.contracted, null); assert.equal(one.lifecycle.permit, null);
    assert.match(one.lifecycle.evidence, /StatusMichraz 5/); assert.equal(one.record.provenance.source, 'rmi:michrazim'); assert.ok(one.record.provenance.detail.fetchedAt);
    assert.equal(one.locality.he, 'תל אביב - יפו');
    const listOnly = Q.record(String(recs[2].michrazId), { dataDir: dir });
    assert.equal(listOnly.record.lots, null); assert.equal(listOnly.record.detailLevel, 'list');
    const P = Q.pipeline(F('period=all').filters, { dataDir: dir });
    assert.equal(P.inventory.label, 'POTENTIAL UNITS FOR MARKETING — STATE LAND ONLY'); assert.equal(P.inventory.stale, true); assert.equal(P.funnel.contracted, null);
    const M = Q.mapPoints(F('period=all').filters, { dataDir: dir });
    assert.equal(M.points.length, 0, 'no polygon → no point'); assert.equal(M.localities.length, 2, 'locality-level counts from the registry'); assert.ok(M.localities.every((l) => l.basis === 'locality'));
    const st = Q.status({ dataDir: dir });
    assert.equal(st.freshness.store, 'git'); assert.ok(st.sources.some((x) => x.id === 'datagov:rmi:planning-inventory' && x.classification === 'STALE'));
  });
  await t('a tender with a locality the registry cannot place is reported as without position — never a guessed pin', () => {
    const dir = tmp(), s = new FileLandStore(dir);
    const a = row({ KodYeshuv: 99001 });
    const { records } = mergeRecords([], [N.normalizeTender({ row: a }, CTX).record], { fetchedAt: CTX.fetchedAt, syncRunId: 'r' });
    s.write({ records, meta: { checkedAt: CTX.fetchedAt, snapshotHash: 'b'.repeat(64), coverage: { publishedFrom: '2026-07-09', publishedTo: '2026-07-09' } }, run: { id: 'r' } });
    const Q = require('../lib/land/query');
    const M = Q.mapPoints(Q.parseFilters(new URLSearchParams('period=all')).filters, { dataDir: dir });
    assert.equal(M.points.length + M.localities.length, 0); assert.equal(M.withoutPosition, 1);
  });

  console.log('land: distinctness & registry');
  await t('nothing in the layer is a transaction: no sale-record fields, and subsidized lotteries are a different source', () => {
    const r = norm(row(), detail(row(), { Tik: [lot(WIN)] }), null);
    for (const k of ['dealDate', 'pricePerSqm', 'rooms', 'floor', 'salePrice', 'deliveredVia']) assert.ok(!(k in r), k + ' present on a tender');
    assert.equal(byId['rmi:michrazim'].productionEligible, true);
    assert.ok(!SOURCES.some((s) => s.id === 'datagov:moch:dira-behanacha-lotteries'), 'the housing-lottery source is not a land source');
  });
  await t('registry: every source is classified, only eligible classes are production-eligible, and limitations are stated', () => {
    const classes = new Set(['CONFIRMED_STRUCTURED_API', 'CONFIRMED_STRUCTURED_FILE', 'CONFIRMED_GIS', 'OFFICIAL_SEMI_STRUCTURED', 'OFFICIAL_PAGE_ONLY', 'STALE', 'UNJOINABLE', 'RESTRICTED', 'UNUSABLE']);
    for (const s of SOURCES) {
      assert.ok(classes.has(s.classification), s.id + ' ' + s.classification);
      assert.ok(Array.isArray(s.limitations) && s.limitations.length, s.id + ' has no limitations');
      if (['OFFICIAL_PAGE_ONLY', 'UNJOINABLE', 'RESTRICTED', 'UNUSABLE'].includes(s.classification)) assert.equal(s.productionEligible, false, s.id);
    }
    assert.equal(byId['datagov:moch:development-bids'].productionEligible, false);
  });
  await t('no credential or store address in the land modules, tests or workflow', () => {
    const files = ['lib/land/codes.js', 'lib/land/sources.js', 'lib/land/rmi.js', 'lib/land/normalize.js', 'lib/land/planning.js', 'lib/land/store.js', 'scripts/land-sync.js', '.github/workflows/land-sync.yml', 'test/land.test.js'];
    for (const f of files) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(!/supabase\.co\b/.test(s), f + ' names a store host'); assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(s), f + ' carries a token');
    }
  });

  console.log(`\nland: ${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
})();
