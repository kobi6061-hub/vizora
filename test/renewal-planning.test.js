// PROPX · Urban renewal × XPlan — offline tests of the exact planning join.
// `node test/renewal-planning.test.js`
//
// Every complex and plan below is a TEST FIXTURE (complex numbers 9990001+, plan ids 99999000+, names "TEST FIXTURE"),
// built in memory or written only to temp directories. The xplan layer is a stub answering the same query shapes.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const P = require('../lib/renewal/planning');
const { mergePlans, FilePlanningStore } = require('../lib/renewal/planning-store');
const { fetchPlanning, variants } = require('../lib/renewal/planning-source');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };
let seq = 0;
const complex = (o = {}) => { const n = ++seq; return { id: `renewal:${9990000 + n}`, complexId: 9990000 + n, city: 'גבעתיים', localityCode: 6300, name: 'TEST FIXTURE מתחם ' + n,
  existingUnits: 100, additionalUnits: 200, proposedUnits: 300, declarationDate: '2015-03-01', planNumber: null, track: 'רשויות', approvalYear: 2019, statusHe: 'תכנית מאושרת לפני מימוש',
  stage: 'approved', executionRaw: 'לא', permitsRaw: null, links: { site: null, map: null }, inLatestSource: true, ...o }; };
const mavat = (id) => `https://mavat.iplan.gov.il/SV4/1/${id}/310`;
const DAY = (d) => Date.parse(d + 'T00:00:00Z');
const attrs = (o = {}) => ({ pl_number: '999-9990001', mp_id: 99999001, pl_id: 99999101, pl_name: 'TEST FIXTURE תכנית', station_desc: 'אישור', internet_short_status: 'פרסום אישור',
  entity_subtype_desc: 'תכנית מתאר מקומית', district_name: 'תל-אביב', jurstiction_area_name: 'גבעתיים', plan_county_name: 'גבעתיים', pl_area_dunam: 12.3, pl_landuse_string: 'מגורים ד\',דרך מוצעת',
  pq_authorised_quantity_120: 100, quantity_delta_120: 200, receiving_date: DAY('2016-01-10'), pl_last_deposit_date: DAY('2017-06-01'), pl_date7: DAY('2018-09-01'), pl_date_8: DAY('2019-02-01'),
  last_update_date: DAY('2019-02-15'), pl_url: mavat(99999001), ...o });
const FETCHED = '2026-10-13T04:00:00.000Z';
const plan = (o = {}) => P.normalizePlan(attrs(o), { fetchedAt: FETCHED });
const data = (plans, { planKeys, mavatIds } = {}) => ({ meta: { checkedAt: FETCHED }, plans, lookups: { planKeys: planKeys || plans.map((p) => p.planKey), mavatIds: mavatIds || plans.map((p) => p.mpId) } });

(async () => {
  console.log('renewal × xplan: stages');
  await t('the stage comes only from the layer\'s own strings: EFFECTIVE needs the approval\'s publication, REJECTED any rejection, an unknown station is UNKNOWN', () => {
    assert.equal(P.stageOf('אישור', 'פרסום אישור'), 'EFFECTIVE'); assert.equal(P.stageOf('אישור', 'התכנית אושרה'), 'APPROVED'); assert.equal(P.stageOf('אישור', 'סיום טיפול'), 'APPROVED');
    assert.equal(P.stageOf('הפקדה להתנגדויות/השגות', 'פרסום הפקדה'), 'DEPOSITED'); assert.equal(P.stageOf('במילוי תנאים להפקדה', 'החלטה בדיון'), 'PRE_DEPOSIT');
    assert.equal(P.stageOf('בבדיקה תכנונית', 'קיום תנאי סף'), 'SUBMITTED'); assert.equal(P.stageOf('הכרעה בהתנגדויות / אישור', 'בתהליך הפקדה'), 'OBJECTIONS');
    assert.equal(P.stageOf('בהליך אישור', 'בתהליך אישור'), 'APPROVAL_PROCESS');
    assert.equal(P.stageOf('הפקדה להתנגדויות/השגות', 'דחיית תכנית'), 'REJECTED'); assert.equal(P.stageOf('אישור', 'התכנית נדחתה'), 'REJECTED');
    assert.equal(P.stageOf('TEST FIXTURE תחנה חדשה', null), 'UNKNOWN'); assert.equal(P.stageOf(null, null), 'UNKNOWN');
    for (const st of Object.values(P.STATION_STAGE)) assert.ok(!/PERMIT|CONSTRUCTION|COMPLET/.test(st), 'planning never says permit / construction / completion');
    assert.equal(P.maturityOf('EFFECTIVE'), 8); assert.equal(P.maturityOf('SUBMITTED'), 2); assert.equal(P.maturityOf('REJECTED'), null);
  });

  console.log('renewal × xplan: the join');
  await t('exact plan number joins (whitespace removed on both sides, nothing else); the Mavat id corroborates', () => {
    const p = plan(), c = complex({ planNumber: '999-9990001', links: { site: mavat(99999001) } });
    const m = P.matchComplex(c, P.indexOf(data([p])));
    assert.equal(m.status, 'exact'); assert.deepEqual(m.evidence, ['plan-number', 'mavat-id']); assert.equal(m.mpId, 99999001);
    const spaced = plan({ pl_number: 'גב/ 4001', mp_id: 99999002 });
    assert.equal(P.matchComplex(complex({ planNumber: 'גב/4001' }), P.indexOf(data([spaced]))).status, 'exact', 'the layer\'s spacing is not a difference');
    assert.deepEqual(variants('תמל/2022'), ['תמל/2022', 'תמל/ 2022']);
    assert.equal(P.matchComplex(complex({ planNumber: 'גב/4001/א' }), P.indexOf(data([spaced], { planKeys: ['גב/4001', 'גב/4001/א'] }))).status, 'not-found', 'a longer number is another plan');
  });
  await t('no fuzzy join: the same name, city or a near number never joins', () => {
    const p = plan({ pl_number: '999-9990002', mp_id: 99999003, pl_name: 'TEST FIXTURE מתחם 1' });
    const c = complex({ name: 'TEST FIXTURE מתחם 1', planNumber: '999-9990003' });
    const m = P.matchComplex(c, P.indexOf(data([p], { planKeys: ['999-9990002', '999-9990003'] })));
    assert.equal(m.status, 'not-found'); assert.equal(m.mpId, null);
    assert.equal(P.matchComplex(complex({ name: 'TEST FIXTURE מתחם 1' }), P.indexOf(data([p]))).status, 'no-identifier', 'a name alone is no identifier');
  });
  await t('one number naming several plans: the Mavat id selects one, otherwise AMBIGUOUS — never a pick', () => {
    const a = plan({ pl_number: '999-9990004', mp_id: 99999004 }), b = plan({ pl_number: '999-9990004', mp_id: 99999005 });
    const I = P.indexOf(data([a, b]));
    const amb = P.matchComplex(complex({ planNumber: '999-9990004' }), I);
    assert.equal(amb.status, 'ambiguous'); assert.deepEqual(amb.candidates.sort(), [99999004, 99999005]); assert.equal(amb.mpId, null);
    const sel = P.matchComplex(complex({ planNumber: '999-9990004', links: { site: mavat(99999005) } }), I);
    assert.equal(sel.status, 'exact'); assert.equal(sel.mpId, 99999005); assert.deepEqual(sel.evidence, ['plan-number', 'mavat-id']);
  });
  await t('two keys pointing at different plans are AMBIGUOUS; the Mavat id alone joins and states that the numbers differ', () => {
    const a = plan({ pl_number: '999-9990006', mp_id: 99999006 }), b = plan({ pl_number: '999-9990007', mp_id: 99999007 });
    const I = P.indexOf(data([a, b]));
    const m = P.matchComplex(complex({ planNumber: '999-9990006', links: { site: mavat(99999007) } }), I);
    assert.equal(m.status, 'ambiguous'); assert.match(m.reason, /different plans/);
    const byId = P.matchComplex(complex({ planNumber: 'גב/9', links: { site: mavat(99999007) } }), P.indexOf(data([b], { planKeys: ['גב/9', '999-9990007'] })));
    assert.equal(byId.status, 'exact'); assert.deepEqual(byId.evidence, ['mavat-id']); assert.deepEqual(byId.planNumberDiffers, { moch: 'גב/9', xplan: '999-9990007' });
  });
  await t('not checked is never "not found": a number no successful lookup asked stays unresolved', () => {
    const I = P.indexOf({ plans: [], lookups: { planKeys: [], mavatIds: [] } });
    assert.equal(P.matchComplex(complex({ planNumber: '999-9990008' }), I).status, 'not-checked');
    const asked = P.indexOf({ plans: [], lookups: { planKeys: ['999-9990008'], mavatIds: [] } });
    const nf = P.matchComplex(complex({ planNumber: '999-9990008' }), asked);
    assert.equal(nf.status, 'not-found'); assert.equal(nf.diagnostics.numberAsked, true); assert.equal(nf.oldFormat, false);
    assert.equal(P.matchComplex(complex({ planNumber: 'גב/490' }), P.indexOf({ plans: [], lookups: { planKeys: ['גב/490'] } })).oldFormat, true, 'a local-format number is diagnosed as such');
    const vat = P.matchComplex(complex({ planNumber: 'תמל/2064' }), P.indexOf({ plans: [], lookups: { planKeys: ['תמל/2064'] } }));
    assert.equal(vat.oldFormat, false, 'a VATMAL number is not a local pre-online number'); assert.equal(vat.diagnostics.format, 'vatmal');
    assert.deepEqual(['101-0935189', 'תמל/2022', 'גב/490', null].map((k) => P.formatOf(k)), ['national', 'vatmal', 'local', null]);
  });
  await t('geometry without an exact identifier is never a join — it is recorded as a diagnostic only', () => {
    const p = plan({ pl_number: '999-9990009', mp_id: 99999009 });
    const m = P.matchComplex(complex({ planNumber: null }), P.indexOf(data([p])), { spatial: [p] });
    assert.equal(m.status, 'no-identifier'); assert.equal(m.mpId, null);
    assert.equal(m.diagnostics.spatialOnly[0].mpId, 99999009); assert.match(m.diagnostics.spatialOnly[0].note, /never joined/);
  });

  console.log('renewal × xplan: MoCH beside XPlan');
  await t('conflicting unit counts: both values kept and the disagreement flagged, never resolved; the MoCH record is untouched', () => {
    const p = plan({ pq_authorised_quantity_120: 100, quantity_delta_120: 160 }), c = complex({ planNumber: '999-9990001', existingUnits: 100, additionalUnits: 200, proposedUnits: 300 });
    const before = JSON.stringify(c), J = P.joinAll([c], data([p]), { today: '2026-10-13' }), j = J.byComplex.get(c.id);
    const pair = (f) => j.compare.find((d) => d.field === f);
    assert.deepEqual([pair('proposedUnits~unitsAfterPlan').moch, pair('proposedUnits~unitsAfterPlan').xplan, pair('proposedUnits~unitsAfterPlan').differs], [300, 260, true]);
    assert.equal(pair('existingUnits~unitsApprovedState').differs, false); assert.equal(pair('additionalUnits~unitsChange').differs, true);
    assert.equal(j.derived.unitDeltaVsMoch, -40); assert.equal(JSON.stringify(c), before, 'MoCH values are never overwritten');
    assert.equal(J.discrepancies.differs['proposedUnits~unitsAfterPlan'], 1);
  });
  await t('one plan referenced by several complexes: each complex says so, and the plan\'s units count once', () => {
    const p = plan({ pl_number: '999-9990010', mp_id: 99999010, pq_authorised_quantity_120: 50, quantity_delta_120: 450 });
    const a = complex({ planNumber: '999-9990010' }), b = complex({ planNumber: '999-9990010', localityCode: 6300 });
    const J = P.joinAll([a, b], data([p]), { today: '2026-10-13' });
    assert.deepEqual(J.byComplex.get(a.id).sharedWith, [b.id]); assert.equal(J.coverage.sharedPlans, 1); assert.equal(J.coverage.distinctPlans, 1);
    assert.deepEqual(J.coverage.xplanUnitsAfterPlan, { sum: 500, of: 1 }, 'not 1,000');
    assert.equal(J.pipeline.find((x) => x.stage === 'EFFECTIVE').plans, 1);
  });
  await t('a rejected plan stays joined (it is the plan) but never counts as approved, has no maturity and no approval date', () => {
    const p = plan({ pl_number: '999-9990011', mp_id: 99999011, station_desc: 'הפקדה להתנגדויות/השגות', internet_short_status: 'דחיית תכנית' });
    const c = complex({ planNumber: '999-9990011' }), J = P.joinAll([c], data([p]), { today: '2026-10-13' }), j = J.byComplex.get(c.id);
    assert.equal(j.match.status, 'exact'); assert.equal(j.plan.stage, 'REJECTED'); assert.equal(j.derived.maturity, null);
    assert.equal(j.derived.yearsDeclarationToApproval, null); assert.equal(J.cities.approvedUnits.length, 0);
    assert.equal(j.compare.find((d) => d.field === 'stage').differs, true, 'MoCH approved vs a rejected plan is flagged');
  });
  await t('missing dates are null — no milestone, no duration, never a guessed date', () => {
    const p = plan({ pl_number: '999-9990012', mp_id: 99999012, pl_date_8: null, pl_date7: null, pl_last_deposit_date: null, internet_short_status: 'פרסום אישור' });
    const c = complex({ planNumber: '999-9990012', declarationDate: null });
    const d = P.joinAll([c], data([p]), { today: '2026-10-13' }).byComplex.get(c.id).derived;
    assert.equal(p.dates.gazetteDate, null); assert.equal(p.dates.depositDate, null);
    assert.equal(d.yearsDeclarationToApproval, null); assert.equal(d.yearsDepositToApproval, null); assert.equal(d.approvalBasis, null);
  });
  await t('derived metrics: declaration → approval, deposit → approval, maturity, stale planning, approval without MoCH evidence — each labelled', () => {
    const p = plan({ pl_number: '999-9990013', mp_id: 99999013 }), c = complex({ planNumber: '999-9990013', declarationDate: '2015-02-01' });
    const d = P.joinAll([c], data([p]), { today: '2026-10-13' }).byComplex.get(c.id).derived;
    assert.equal(d.basis, 'DERIVED from the joined MoCH and XPlan values'); assert.equal(d.maturity, 8);
    assert.equal(d.yearsDeclarationToApproval, 4); assert.equal(d.yearsDepositToApproval, 1.7); assert.match(d.approvalBasis, /pl_date_8/);
    assert.equal(d.approvedNoMochEvidence, true, 'execution "לא", no permits');
    assert.equal(P.joinAll([complex({ planNumber: '999-9990013', permitsRaw: '120' })], data([p])).byComplex.values().next().value.derived.approvedNoMochEvidence, false);
    const old = plan({ pl_number: '999-9990014', mp_id: 99999014, station_desc: 'הפקדה להתנגדויות/השגות', internet_short_status: 'פרסום הפקדה', last_update_date: DAY('2020-01-01') });
    const s = P.joinAll([complex({ planNumber: '999-9990014' })], data([old]), { today: '2026-10-13' }).byComplex.values().next().value.derived;
    assert.equal(s.stalePlanning, true); assert.equal(s.yearsSinceUpdate, 6.8);
    const early = P.joinAll([complex({ planNumber: '999-9990013', declarationDate: '2021-02-01' })], data([p]), { today: '2026-10-13' }).byComplex.values().next().value.derived;
    assert.equal(early.yearsDeclarationToApproval, null); assert.equal(early.approvedBeforeDeclaration, 2, 'a plan approved before the declaration is said so, never a negative duration');
  });
  await t('provenance: every plan carries its source, layer and fetch time; the outline is WGS84 with a bbox and centroid', () => {
    const p = plan();
    assert.deepEqual([p.provenance.source, p.provenance.layer, p.provenance.fetchedAt, p.provenance.classification], ['iplan:xplan:renewal', P.LAYER, FETCHED, 'OFFICIAL']);
    assert.equal(p.url, mavat(99999001)); assert.equal(P.normalizePlan(attrs({ pl_url: 'javascript:alert(1)' })).url, null);
    const o = P.outlineOf({ rings: [[[34.8, 32.0], [34.802, 32.0], [34.802, 32.002], [34.8, 32.002], [34.8, 32.0]]] });
    assert.deepEqual(o.bbox, [34.8, 32, 34.802, 32.002]); assert.deepEqual(o.centroid, [34.801, 32.001]); assert.equal(o.sr, 4326);
    assert.equal(P.outlineOf({ rings: [[[1, 2], [1, 2]]] }), null);
  });
  await t('coverage: exact / ambiguous / not found / no identifier / not checked add up, with reasons and the best / worst cities', () => {
    const p = plan({ pl_number: '999-9990015', mp_id: 99999015 });
    const cs = [complex({ planNumber: '999-9990015' }), complex({ planNumber: 'גב/1' }), complex({ planNumber: null }), complex({ planNumber: '999-9990016' })];
    const J = P.joinAll(cs, data([p], { planKeys: ['999-9990015', 'גב/1'] }), { today: '2026-10-13', minCity: 1 });
    const C = J.coverage;
    assert.deepEqual([C.complexes, C.exact, C.ambiguous, C.notFound, C.noIdentifier, C.notChecked], [4, 1, 0, 1, 1, 1]);
    assert.equal(C.matchRate, 25); assert.equal(C.unmatchedReasons['local-format-number-not-online'], 1); assert.equal(C.unmatchedReasons['no-plan-number-no-link'], 1);
    assert.equal(J.cities.bestCoverage[0].matchRate, 25);
  });

  console.log('renewal × xplan: store and read');
  await t('a plan disappears only when its own lookup succeeded; an unchecked plan is kept; every change is history', () => {
    const a = { ...plan({ pl_number: '999-9990017', mp_id: 99999017 }) }, b = { ...plan({ pl_number: '999-9990018', mp_id: 99999018 }) };
    const m1 = mergePlans([], [a, b], { fetchedAt: FETCHED, runId: 'r1', askedKeys: [a.planKey, b.planKey] });
    assert.equal(m1.stats.inserted, 2);
    const a2 = { ...plan({ pl_number: '999-9990017', mp_id: 99999017, station_desc: 'אישור', internet_short_status: 'התכנית אושרה' }) };
    const m2 = mergePlans(m1.plans, [a2], { fetchedAt: '2026-10-14T04:00:00Z', runId: 'r2', askedKeys: [a.planKey] });
    assert.equal(m2.plans.find((x) => x.mpId === 99999018).inLatestSource, true, 'not asked this run: kept as it was');
    assert.ok(m2.history.some((h) => h.field === 'stage' && h.from === 'EFFECTIVE' && h.to === 'APPROVED'));
    const m3 = mergePlans(m2.plans, [a2], { fetchedAt: '2026-10-15T04:00:00Z', runId: 'r3', askedKeys: [a.planKey, b.planKey] });
    assert.equal(m3.plans.find((x) => x.mpId === 99999018).inLatestSource, false); assert.equal(m3.plans.length, 2, 'nothing deleted');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-planning-')), S = new FilePlanningStore(dir);
    S.write({ planning: { meta: { checkedAt: FETCHED }, lookups: { planKeys: [a.planKey], mavatIds: [] }, plans: m3.plans }, geometry: { 99999017: P.outlineOf({ rings: [[[1, 1], [2, 1], [2, 2], [1, 1]]] }) }, history: m3.history, run: { id: 'r3' } });
    assert.equal(S.readPlanning().plans.length, 2); assert.ok(S.readGeometry()['99999017']); assert.equal(S.readRuns().length, 1);
  });
  await t('the read: plan numbers in the layer\'s spacing, Mavat ids, boundaries; a failed batch leaves its keys unchecked', async () => {
    const layer = [attrs({ pl_number: 'תמל/ 9001', mp_id: 99999020 }), attrs({ pl_number: '999-9990021', mp_id: 99999021 })];
    let fail = false;
    const fetchImpl = async (u, init = {}) => {
      assert.equal(init.method, 'POST', 'the layer is queried by POST (long batches of Hebrew numbers overrun a GET URL)');
      const q = new URLSearchParams(init.body), where = q.get('where');
      if (fail) return { ok: false, status: 503, text: async () => 'Service Unavailable' };
      const nums = /pl_number IN \((.*)\)/.exec(where), ids = /mp_id IN \((.*)\)/.exec(where);
      let feats = [];
      if (nums) { const v = nums[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')); feats = layer.filter((a) => v.includes(a.pl_number)); }
      if (ids) { const v = ids[1].split(',').map(Number); feats = layer.filter((a) => v.includes(a.mp_id)); }
      const geo = q.get('returnGeometry') === 'true';
      return { ok: true, status: 200, text: async () => JSON.stringify({ features: feats.map((a) => (geo ? { attributes: { mp_id: a.mp_id }, geometry: { rings: [[[34.8, 32], [34.81, 32], [34.81, 32.01], [34.8, 32]]] } } : { attributes: a })) }) };
    };
    const cs = [complex({ planNumber: 'תמל/9001' }), complex({ planNumber: 'גב/77', links: { site: mavat(99999021) } })];
    const got = await fetchPlanning(cs, { fetchImpl, fetchedAt: FETCHED });
    assert.deepEqual(got.plans.map((p) => p.mpId).sort(), [99999020, 99999021]); assert.equal(got.complete, true); assert.ok(got.geometry[99999020]);
    const J = P.joinAll(cs, { plans: got.plans, lookups: { planKeys: got.askedKeys, mavatIds: got.askedIds } }, { today: '2026-10-13' });
    assert.deepEqual(cs.map((c) => J.byComplex.get(c.id).match.status), ['exact', 'exact']);
    fail = true;
    const bad = await fetchPlanning(cs, { fetchImpl, fetchedAt: FETCHED });
    assert.equal(bad.askedKeys.length, 0); assert.equal(bad.complete, false); assert.ok(bad.errors.length);
    const J2 = P.joinAll(cs, { plans: [], lookups: { planKeys: bad.askedKeys, mavatIds: bad.askedIds } });
    assert.ok(cs.every((c) => J2.byComplex.get(c.id).match.status === 'not-checked'), 'a failed read is never "not found"');
  });
  await t('the sync answering nothing keeps every stored plan and writes only its run log (exit 1)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-planning-sync-')), stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-planning-stub-'));
    fs.writeFileSync(path.join(dir, 'complexes.json'), JSON.stringify([complex({ planNumber: '999-9990030' })]));
    const S = new FilePlanningStore(dir), kept = plan({ pl_number: '999-9990030', mp_id: 99999030 });
    S.write({ planning: { meta: { checkedAt: FETCHED }, lookups: { planKeys: [kept.planKey], mavatIds: [] }, plans: [kept] } });
    const stub = path.join(stubDir, 'stub.js');
    fs.writeFileSync(stub, 'globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => "down" });');
    const r = spawnSync(process.execPath, ['-r', stub, path.join(ROOT, 'scripts/renewal-planning-sync.js')], { env: { ...process.env, RENEWAL_DATA_DIR: dir }, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(S.readPlanning().plans[0].mpId, 99999030, 'the stored plan stays'); assert.equal(S.readRuns().slice(-1)[0].status, 'failed');
  });
  console.log('renewal × xplan: the committed data and the page');
  await t('over the committed data: every exact join is proven by its own key; the counts add up; no fuzzy evidence exists', () => {
    const RN = require('../lib/renewal/query'), C = RN.load();
    if (!C.planning) return;                                                  // before the first read every complex is "not checked"
    const K = C.join.coverage;
    assert.equal(K.exact + K.ambiguous + K.notFound + K.noIdentifier + K.notChecked, K.complexes, 'every complex in exactly one state');
    for (const c of C.live) {
      const j = C.join.byComplex.get(c.id);
      if (j.match.status !== 'exact') { assert.equal(j.plan, null); continue; }
      assert.ok(j.match.evidence.length && j.match.evidence.every((e) => e === 'plan-number' || e === 'mavat-id'), c.id);
      if (j.match.evidence.includes('plan-number')) assert.equal(P.planKey(c.planNumber), j.plan.planKey, c.id + ' plan number');
      if (j.match.evidence.includes('mavat-id')) assert.equal(P.mavatIdOf(c), j.plan.mpId, c.id + ' Mavat id');
      assert.ok(!/PERMIT|CONSTRUCTION|COMPLET/.test(j.plan.stage));
    }
    const S = RN.summary({}), rows = RN.records({ match: 'exact', size: 1 });
    assert.equal(rows.total, S.planning.coverage.exact, 'the match filter and the coverage agree');
    assert.equal(RN.records({ pstage: 'EFFECTIVE', size: 1 }).total, (S.planning.pipeline.find((x) => x.stage === 'EFFECTIVE') || { complexes: 0 }).complexes);
    const d = RN.record(rows.rows[0].id).planning;
    assert.ok(d.plan && d.plan.provenance.source === 'iplan:xplan:renewal' && d.freshness.checkedAt);
  });
  await t('the page: PLANNING STATUS beside the MoCH values, "—" for missing, DERIVED tags, only milestones that exist, never "|| 0"', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const fn = (name) => { const i = html.indexOf('function ' + name + '('); assert.ok(i > -1, name); return html.slice(i, html.indexOf('\nfunction ', i + 10)); };
    const list = fn('renderRenewal'), drawer = fn('renewalDrawerHTML');
    assert.doesNotMatch(list + drawer, /\|\|\s*0\b/, 'a missing figure is never rendered as 0');
    assert.match(drawer, /L\.sec/); assert.match(drawer, /urow\(L\.urow\.prop\+" "\+D/, 'the summed after-the-plan units are tagged DERIVED');
    assert.match(drawer, /\.filter\(\(\[,v\]\)=>v\)/, 'a timeline milestone without a date is not drawn');
    assert.match(drawer, /X\.stage==="EFFECTIVE"\?XD\.gazetteDate:null/, 'the in-force milestone only on an EFFECTIVE plan');
    assert.match(html, /pl:\{t:"תכנון — מינהל התכנון \(XPlan\)"/); assert.match(html, /pl:\{t:"Planning — Planning Administration \(XPlan\)"/);
    for (const st of P.STAGES.concat(P.TERMINAL, P.OTHER)) assert.ok(html.includes(st + ':"'), 'a label for every stage: ' + st);
  });
  await t('the Trust Center lists the planning join with its run state', () => {
    const c = require('../lib/trust/catalog').catalog(), s = c.sources.find((x) => x.id === 'iplan:xplan:renewal');
    assert.ok(s && s.vertical === 'renewal' && s.sync && s.sync.state); assert.ok(s.limitations.some((l) => /never by name or geometry/.test(l)));
  });
  await t('no credential or store address in the planning modules', () => {
    for (const f of ['lib/renewal/planning.js', 'lib/renewal/planning-source.js', 'lib/renewal/planning-store.js', 'scripts/renewal-planning-sync.js']) {
      assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /SITE_PASSWORD|SESSION_SECRET|SERVICE_ROLE_KEY=|supabase\.co|PROPX_JOB_TOKEN/, f);
    }
  });

  console.log(`\nrenewal × xplan: ${passed} passed`);
})();
