// PROPX · XPlan housing-unit semantics — offline regression tests (audit 13.10.2026).
// `node test/xplan-units.test.js`
//
// pq_authorised_quantity_120 = units authorised BEFORE the plan · quantity_delta_120 = the plan's change ·
// units after the plan = their sum (DERIVED). Fixtures are TEST FIXTURE records (tender ids 99900000+, plan numbers
// 999-99xxxxx / תמל/99xx), written only to temp directories.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XU = require('../lib/planning/xplan-units');
const N = require('../lib/land/normalize');
const P = require('../lib/land/planning');
const { mergeRecords, FileLandStore } = require('../lib/land/store');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };
const CTX = { snapshotHash: 'f'.repeat(64), fetchedAt: '2026-10-13T03:00:00.000Z', retrievalMethod: 'live-api' };
let seq = 0;
const row = (o = {}) => ({ MichrazID: 99900000 + (++seq), MichrazName: `TEST FIXTURE ${seq}/2026`, KodMerchav: 2, StatusMichraz: 2, KodYeudMichraz: 2, KodYeshuv: 99001, KodSugMichraz: 1,
  PublishedChoveret: true, Mekuvan: true, YechidotDiur: 200, Shchuna: 'TEST FIXTURE שכונה', PirsumDate: '2026-07-09T00:00:00+03:00', PtichaDate: '2026-07-09T00:00:00+03:00',
  SgiraDate: '2026-08-05T12:00:00+03:00', VaadaDate: null, ChoveretUpdateDate: null, KhalYaadRashi: 2, ...o });
const lot = (plan, o = {}) => ({ TikID: '0000800099' + String(++seq).padStart(3, '0'), MitchamName: 'א', Shetach: 10000, ShetachBniya: 0, Kibolet: 100, HotzaotPituach: 10000000, MechirSaf: 1,
  mechirShuma: 5000000, SchumArvut: 500000, ShemZoche: null, SchumZchiya: null, TmuraMufchetet: 0, MechirMaximum: null,
  TochnitMigrash: [{ Tochnit: plan, MigrashName: '210' }], mpHatzaaotMitcham: [], GushHelka: [], ...o });
const detail = (r, lots) => ({ MichrazID: r.MichrazID, StatusMichrazMurchav: r.StatusMichraz, SugTacharut: 1, SugMechirMufchat: 0, KayamSivsud: 0, MechirSafMichraz: 1, MechirSafType: 1,
  MaxToWin: null, UpdateDate: '2026-08-05T16:09:02.903+03:00', HagralaDate: null, Uchlusiyot: [], Tik: lots, MichrazDocList: [], MessageDetails: { messageText: 'TEST FIXTURE' }, MichrazLinks: [] });
const feature = (o) => P.normalizeXplanFeature({ pl_id: 1, mp_id: 1, pl_name: 'TEST FIXTURE', station_desc: 'אישור', pl_area_dunam: 50, ...o }, { fetchedAt: CTX.fetchedAt });
/** a land data dir: tenders (each with its lot plan numbers) joined to the given xplan plans, stored like land-sync stores them */
function landDir(tenders, plans) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplan-units-')), s = new FileLandStore(dir);
  const xplan = new Map(plans.map((p) => [p.planKey, p]));
  const recs = tenders.map((lots) => { const r = row(); return P.joinPlans(N.normalizeTender({ row: r, detail: detail(r, lots.map((pl) => lot(pl))) }, CTX).record, { xplan, inventory: new Map() }); });
  s.write({ records: mergeRecords([], recs, { fetchedAt: CTX.fetchedAt, syncRunId: 'r' }).records, plans: { xplan: plans, inventory: [] },
    meta: { checkedAt: CTX.fetchedAt, snapshotHash: 'b'.repeat(64), coverage: { publishedFrom: '2026-07-09', publishedTo: '2026-07-09' } }, run: { id: 'r' } });
  return { dir, recs };
}
const LQ = () => require('../lib/land/query');
const F = (q = 'period=all&scope=all') => LQ().parseFilters(new URLSearchParams(q), new Date('2026-10-13T12:00:00Z')).filters;

(async () => {
  console.log('xplan units: the definition');
  await t('field semantics: pq_authorised_quantity_120 = units authorised BEFORE the plan, quantity_delta_120 = the plan\'s change, after = sum (DERIVED)', () => {
    const S = XU.SEMANTICS;
    assert.equal(S.fields.pq_authorised_quantity_120.alias, 'מגורים מאושר יח"ד'); assert.match(S.fields.pq_authorised_quantity_120.meaning, /before this plan/);
    assert.equal(S.fields.quantity_delta_120.alias, "שינוי מס' יח' דיור"); assert.match(S.fields.quantity_delta_120.meaning, /change/);
    assert.match(S.derived.unitsAfterPlan, /pq_authorised_quantity_120 \+ quantity_delta_120 — DERIVED/);
    assert.deepEqual(S.labels.en, { existingAuthorisedUnits: 'Previously Authorized Units', planUnitDelta: 'Plan Unit Delta', unitsAfterPlan: 'Units After Plan' });
    assert.deepEqual(S.labels.he, { existingAuthorisedUnits: 'יח"ד מאושרות לפני התוכנית', planUnitDelta: 'תוספת יח"ד בתוכנית', unitsAfterPlan: 'סה"כ יח"ד לאחר התוכנית' });
    assert.equal(S.run, '38421239199');
  });
  await t('raw values are kept exactly as published beside the interpretation', () => {
    const u = XU.interpretUnits(716, 360);
    assert.deepEqual(u.raw, { pq_authorised_quantity_120: 716, quantity_delta_120: 360 });
    assert.deepEqual(XU.interpretUnits(12.5, -0.5).raw, { pq_authorised_quantity_120: 12.5, quantity_delta_120: -0.5 });
    assert.deepEqual(XU.interpretUnits(null, undefined).raw, { pq_authorised_quantity_120: null, quantity_delta_120: null });
  });
  await t('units after the plan = authorised before + delta; an amendment adds to its base', () => {
    const u = XU.interpretUnits(716, 360);
    assert.deepEqual([u.existingAuthorisedUnits, u.planUnitDelta, u.unitsAfterPlan], [716, 360, 1076]);
    assert.equal(XU.interpretUnits(0, 1308).unitsAfterPlan, 1308, 'a new neighbourhood: nothing authorised before it');
  });
  await t('zero and negative deltas: a re-arrangement keeps its base; a reduction lowers it; a negative sum is never shown', () => {
    assert.equal(XU.interpretUnits(290, 0).unitsAfterPlan, 290);
    assert.equal(XU.interpretUnits(677, -453).unitsAfterPlan, 224);
    const neg = XU.interpretUnits(10, -25);
    assert.equal(neg.unitsAfterPlan, null); assert.ok(neg.flags.includes('negative-after-plan')); assert.equal(neg.planUnitDelta, -25, 'the raw delta stays');
  });
  await t('a missing base or a missing delta leaves units after the plan missing — never 0, never guessed', () => {
    const a = XU.interpretUnits(null, 50), b = XU.interpretUnits(50, null), c = XU.interpretUnits('', '');
    assert.deepEqual([a.existingAuthorisedUnits, a.planUnitDelta, a.unitsAfterPlan], [null, 50, null]); assert.ok(a.flags.includes('missing-authorised-state'));
    assert.deepEqual([b.existingAuthorisedUnits, b.planUnitDelta, b.unitsAfterPlan], [50, null, null]); assert.ok(b.flags.includes('missing-delta'));
    assert.equal(c.unitsAfterPlan, null);
  });
  await t('a non-residential plan publishes 0 and 0: a real zero, shown as 0; a mixed-use plan is read only by its housing pair', () => {
    const z = XU.interpretUnits(0, 0); assert.deepEqual([z.existingAuthorisedUnits, z.planUnitDelta, z.unitsAfterPlan, z.flags.length], [0, 0, 0, 0]);
    const mixed = XU.unitsOfAttributes({ pq_authorised_quantity_120: 100, quantity_delta_120: 40, pq_authorised_quantity_105: 9000, quantity_delta_105: 2000, quantity_delta_75: 5000, pq_authorised_quantity_110: 30 });
    assert.deepEqual([mixed.existingAuthorisedUnits, mixed.planUnitDelta, mixed.unitsAfterPlan], [100, 40, 140], 'hotel, commerce and special-housing quantities never enter housing units');
  });
  await t('every stored shape reads the same pair: land storage keys, renewal names, older renewal names, the raw object', () => {
    for (const p of [{ approvedUnits: 300, unitsDelta: 120 }, { existingAuthorisedUnits: 300, planUnitDelta: 120 }, { unitsApprovedState: 300, unitsChange: 120 },
      { raw: { pq_authorised_quantity_120: 300, quantity_delta_120: 120 } }]) assert.equal(XU.unitsOfStored(p).unitsAfterPlan, 420, JSON.stringify(p));
    assert.equal(XU.unitsOfStored(null).unitsAfterPlan, null);
  });
  await t('no double counting: a plan counts once however many times it is referenced', () => {
    const S = XU.sumUnits([{ key: 'A', units: XU.interpretUnits(10, 90) }, { key: 'A', units: XU.interpretUnits(10, 90) }, { key: 'B', units: XU.interpretUnits(0, 50) }]);
    assert.deepEqual([S.plans, S.existingAuthorisedUnits, S.planUnitDelta, S.unitsAfterPlan], [2, 10, 140, 150]);
    assert.equal(XU.sumUnits([{ key: 'X', units: XU.interpretUnits(null, null) }]).unitsAfterPlan, null, 'no value → missing, not 0');
  });

  console.log('xplan units: the land read model');
  await t('land storage is unchanged (raw under its legacy keys); the API serves the explicit pair and never "approvedUnits"', () => {
    const plan = feature({ pl_number: '999-9900001', pq_authorised_quantity_120: 0, quantity_delta_120: 1308 });
    assert.equal(plan.approvedUnits, 0, 'the land store keeps the raw pq_authorised_quantity_120 (legacy key, unchanged)'); assert.equal(plan.unitsDelta, 1308);
    const { dir, recs } = landDir([['999-9900001']], [plan]);
    const d = LQ().record(recs[0].id, { dataDir: dir });
    const pl = d.plans.find((x) => x.via === 'lot');
    assert.deepEqual([pl.units.existingAuthorisedUnits, pl.units.planUnitDelta, pl.units.unitsAfterPlan], [0, 1308, 1308]);
    assert.deepEqual(pl.units.raw, { pq_authorised_quantity_120: 0, quantity_delta_120: 1308 });
    assert.ok(pl.full, 'the full plan record is found by its plan key');
    assert.ok(!JSON.stringify(d.plans).includes('"approvedUnits"') && !JSON.stringify(d.record.planning).includes('approvedUnits'), 'no ambiguous key is served');
    assert.equal(d.record.planning.units.unitsAfterPlan, 1308);
    const rows = LQ().records(F(), { dataDir: dir }).rows;
    assert.equal(rows[0].planUnits.unitsAfterPlan, 1308); assert.ok(!('approvedUnitsInPlans' in rows[0]));
  });
  await t('the pipeline sums the referenced plans once each (two tenders on one plan, one tender citing a plan twice)', () => {
    const a = feature({ pl_number: '999-9900002', mp_id: 2, pq_authorised_quantity_120: 100, quantity_delta_120: 400 }), b = feature({ pl_number: '999-9900003', mp_id: 3, pq_authorised_quantity_120: 50, quantity_delta_120: -20 });
    const { dir } = landDir([['999-9900002', '999-9900002'], ['999-9900002', '999-9900003']], [a, b]);
    const R = LQ().pipeline(F(), { dataDir: dir }).referencedPlans;
    assert.equal(R.count, 2); assert.deepEqual([R.units.existingAuthorisedUnits, R.units.planUnitDelta, R.units.unitsAfterPlan], [150, 380, 530]);
    assert.ok(!('approvedUnits' in R)); assert.equal(R.sample[0].units.unitsAfterPlan, 500, 'sorted by units after the plan');
  });
  await t('city totals: the pipeline filtered by a locality sums only that locality\'s referenced plans', () => {
    const p = feature({ pl_number: '999-9900004', mp_id: 4, pq_authorised_quantity_120: 20, quantity_delta_120: 80 });
    const { dir } = landDir([['999-9900004']], [p]);
    assert.equal(LQ().pipeline(F('period=all&scope=all&city=99001'), { dataDir: dir }).referencedPlans.units.unitsAfterPlan, 100);
    assert.equal(LQ().pipeline(F('period=all&scope=all&city=99002'), { dataDir: dir }).referencedPlans.count, 0);
  });
  await t('land per unit and the summary figures never read XPlan units (plan units change, the figures do not)', () => {
    const one = landDir([['999-9900005']], [feature({ pl_number: '999-9900005', mp_id: 5, pq_authorised_quantity_120: 10, quantity_delta_120: 10 })]);
    const two = landDir([['999-9900005']], [feature({ pl_number: '999-9900005', mp_id: 5, pq_authorised_quantity_120: 10, quantity_delta_120: 9000 })]);
    const k1 = LQ().summary(F(), { dataDir: one.dir }).kpis, k2 = LQ().summary(F(), { dataDir: two.dir }).kpis;
    for (const k of ['landPerUnit', 'unitsResidential', 'unitsOpen', 'unitsAwarded', 'awardedLandTotal']) assert.equal(k1[k], k2[k], k);
    const src = fs.readFileSync(path.join(ROOT, 'lib/land/query.js'), 'utf8');
    assert.doesNotMatch(src.slice(src.indexOf('function kpis'), src.indexOf('\nfunction ', src.indexOf('function kpis') + 10)), /planUnits|unitsAfterPlan|approvedUnits/);
  });

  console.log('xplan units: the rest of PROPX');
  await t('developer totals and ALTARIS read no XPlan unit field', () => {
    for (const f of ['lib/entities/registry.js', 'lib/entities/query.js', 'altaris/app.js', 'altaris/engine.js']) {
      assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /pq_authorised_quantity_120|quantity_delta_120|approvedUnits|unitsAfterPlan|planUnitDelta/, f);
    }
  });
  await t('renewal reads units only through the one definition; an older stored record is renamed without a history event', () => {
    const { mergePlans, upgrade } = require('../lib/renewal/planning-store'), RP = require('../lib/renewal/planning');
    const p = RP.normalizePlan({ pl_number: '999-9900006', mp_id: 99999006, station_desc: 'אישור', pq_authorised_quantity_120: 58, quantity_delta_120: 232 }, { fetchedAt: CTX.fetchedAt });
    assert.deepEqual([p.existingAuthorisedUnits, p.planUnitDelta, p.raw.quantity_delta_120], [58, 232, 232]); assert.ok(!('unitsApprovedState' in p));
    const legacy = { ...p, unitsApprovedState: 58, unitsChange: 232 }; delete legacy.existingAuthorisedUnits; delete legacy.planUnitDelta; delete legacy.raw;
    assert.equal(upgrade(legacy).planUnitDelta, 232);
    const m = mergePlans([legacy], [p], { fetchedAt: '2026-10-14T00:00:00Z', askedKeys: [p.planKey] });
    assert.equal(m.history.length, 0, 'renaming is not a change'); assert.equal(m.stats.unchanged, 1);
    const src = fs.readFileSync(path.join(ROOT, 'lib/renewal/planning.js'), 'utf8');
    assert.doesNotMatch(src, /unitsApprovedState \+|unitsChange\b/, 'no second definition of the sum');
  });
  await t('the page names the three concepts and never "approved units" for an XPlan value', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const s of ['יח״ד מאושרות לפני התוכנית', 'תוספת יח״ד בתוכנית', 'סה״כ יח״ד לאחר התוכנית', 'Previously Authorized Units', 'Plan Unit Delta', 'Units After Plan']) assert.ok(html.includes(s), s);
    assert.doesNotMatch(html, /יח״ד מאושרות בתוכניות|Approved units in plans|units:"Approved units"|x\.approvedUnits|R\.approvedUnits/);
  });
  await t('every inline script of the page and of the offline build compiles (a quote inside a string literal breaks the whole page)', () => {
    const vm = require('node:vm');
    for (const f of ['index.html', 'standalone/israel-new-homes-v2.html']) {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8'), re = /<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/ld\+json|application\/json)")[^>]*>([\s\S]*?)<\/script>/g;
      let m, n = 0;
      while ((m = re.exec(html))) { n++; assert.doesNotThrow(() => new vm.Script(m[1], { filename: `${f}#script${n}` }), `${f} inline script ${n}`); }
      assert.ok(n > 0, f);
    }
  });
  await t('the Trust Center explains the fields, the derivation and the correction', () => {
    const c = require('../lib/trust/catalog').catalog(), s = c.sources.find((x) => x.id === 'iplan:xplan');
    assert.ok(s.methodology.some((m) => /pq_authorised_quantity_120/.test(m) && /before this plan/.test(m)));
    assert.ok(s.methodology.some((m) => /DERIVED/.test(m))); assert.ok(s.methodology.some((m) => /correction 13\.10\.2026/.test(m)));
  });
  await t('over the committed land data: each served plan\'s units after the plan = its raw pair summed; the stored files keep the raw values', () => {
    const plans = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/land/plans.json'), 'utf8')).xplan || [];
    for (const p of plans) {
      const u = XU.unitsOfStored(p);
      assert.equal(u.raw.pq_authorised_quantity_120, p.approvedUnits); assert.equal(u.raw.quantity_delta_120, p.unitsDelta);
      if (p.approvedUnits != null && p.unitsDelta != null && p.approvedUnits + p.unitsDelta >= 0) assert.equal(u.unitsAfterPlan, p.approvedUnits + p.unitsDelta, p.plan);
    }
  });

  console.log(`\nxplan units: ${passed} passed`);
})();
