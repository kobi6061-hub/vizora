'use strict';
/* PROPX · SUPPLY PIPELINE (lib/supply) — the gates.
 *
 * One geography → parallel universes of housing supply (planning · land · renewal · rental · lotteries · construction),
 * never added together, every figure with its source, class, period and bilingual basis; indicators DERIVED and
 * explainable; a district is the same computation over its localities; what the sources do not say is null, never 0.
 * Runs over the real committed data (no synthetic directory). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/supply/pipeline');
const LQ = require('../lib/land/query');
const PL = require('../lib/renewal/planning');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const NOW = Date.parse('2026-10-17T12:00:00Z');
const HE = /[֐-׿]/;
const isBi = (v, where) => { assert.ok(v && typeof v.he === 'string' && typeof v.en === 'string', where + ': he + en'); assert.ok(HE.test(v.he), where + ': Hebrew in he'); assert.ok(!HE.test(v.en), where + ': no Hebrew in en: ' + v.en); };
const walk = (o, fn, p = '$') => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach((x, i) => walk(x, fn, p + '[' + i + ']')); return; } fn(o, p); for (const k of Object.keys(o)) walk(o[k], fn, p + '.' + k); };
const FORBIDDEN = /^(total|allUnits|pipelineUnits|totalUnits|unitsTotal|sumUnits)$/;

console.log('supply: module');
t('the module is read-only: no fetch, no network, no randomness; it composes the existing read models', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/supply/pipeline.js'), 'utf8');
  assert.ok(!/fetch\(|https?\.request|XMLHttpRequest|Math\.random|child_process/.test(src));
  for (const m of ['../land/query', '../renewal/query', '../rental/query', '../entities/query', '../renewal/planning', '../planning/xplan-units', '../dossier/query']) assert.ok(src.includes(`require('${m}')`), m);
  assert.deepEqual(Object.keys(S).sort(), ['UNIVERSES', 'momentum', 'resolveGeo', 'supply', 'windowsOf']);
});
const T0 = Date.now();
const IL = S.supply({ level: 'il', now: NOW });
const WARM = Date.now() - T0;
const DTA = S.supply({ level: 'district', code: 'd-ta', now: NOW }), TLV = S.supply({ level: 'locality', code: '5000', now: NOW });
t('three levels resolve from the registry; an unknown geography (or level) is null; schema 1 with a bilingual basis', () => {
  assert.equal(IL.geo.level, 'il'); assert.equal(IL.geo.code, 'il'); assert.equal(TLV.geo.level, 'locality'); assert.equal(TLV.geo.district, 'd-ta'); assert.equal(TLV.geo.name.en, 'Tel Aviv - Yafo');
  assert.equal(DTA.geo.level, 'district'); assert.equal(DTA.geo.localities, 14); assert.equal(S.supply({ level: 'district', code: 'js-area', now: NOW }).geo.name.en, 'Judea and Samaria Area');
  assert.equal(S.supply({ level: 'locality', code: '999999', now: NOW }), null); assert.equal(S.supply({ level: 'district', code: 'd-nowhere', now: NOW }), null); assert.equal(S.supply({ level: 'nowhere', code: 'x', now: NOW }), null);
  for (const d of [IL, DTA, TLV]) { assert.equal(d.schema, 1); isBi(d.basis, 'basis'); assert.equal(d.today, '2026-10-17'); assert.equal(d.generatedAt, new Date(NOW).toISOString()); }
});
t('nine universes (six + the three CBS construction series since 18.10.2026), in the ONE order of UNIVERSES, each with its class, source id and bilingual label — and the output keys follow it', () => {
  assert.deepEqual(S.UNIVERSES.map((u) => u.id), ['planning', 'land', 'renewal', 'rental', 'lotteries', 'construction', 'permits', 'starts', 'activeConstruction']);
  for (const u of S.UNIVERSES) { assert.equal(u.cls, 'OFFICIAL'); assert.ok(u.source); isBi(u.label, u.id); isBi(u.counts, u.id); isBi(u.notTheOthers, u.id); }
  for (const d of [IL, DTA, TLV]) { assert.deepEqual(Object.keys(d.universes), S.UNIVERSES.map((u) => u.id)); assert.deepEqual(d.universeOrder, S.UNIVERSES.map((u) => u.id));
    for (const u of S.UNIVERSES) { const x = d.universes[u.id]; assert.equal(x.cls, u.cls, u.id); assert.equal(x.source, u.source, u.id); isBi(x.scope, u.id + '.scope'); } }
});
t('universes are NEVER summed: no total / allUnits / pipelineUnits key anywhere in the output, no such sum in the source, and the basis says so', () => {
  for (const d of [IL, DTA, TLV]) { const bad = []; walk(d, (o, p) => { for (const k of Object.keys(o)) if (FORBIDDEN.test(k)) bad.push(p + '.' + k); }); assert.deepEqual(bad, []); assert.ok(!('total' in d) && !('allUnits' in d) && !('pipelineUnits' in d)); }
  const src = fs.readFileSync(path.join(ROOT, 'lib/supply/pipeline.js'), 'utf8');
  assert.ok(!/\b(allUnits|pipelineUnits|totalUnits|unitsTotal)\b/.test(src)); assert.ok(!/total\s*[:=]/.test(src));
  assert.match(IL.basis.en, /never added together/); assert.match(IL.basis.he, /לעולם אינם מחוברים/);
  assert.match(IL.universes.planning.overlap.note.en, /not added/); assert.match(IL.universes.rental.tenderUnitsLabel.en, /TOTAL units of the tenders/);
});
t('a locality ⊆ its district ⊆ national in every count — tenders, complexes, lotteries, rental tenders, plans, construction, awarded units', () => {
  const le = (a, b, what) => { if (a == null || b == null) return; assert.ok(a <= b, `${what}: ${a} ≤ ${b}`); };
  const chain = (get, what) => { le(get(TLV), get(DTA), what + ' locality ≤ district'); le(get(DTA), get(IL), what + ' district ≤ national'); };
  chain((d) => d.universes.land.kpis.tenders, 'tenders'); chain((d) => d.universes.land.kpis.unitsAwarded, 'awarded units'); chain((d) => d.universes.land.kpis.unitsOpen, 'open units');
  chain((d) => d.universes.renewal.complexes, 'complexes'); chain((d) => d.universes.renewal.declared, 'declared'); chain((d) => d.universes.renewal.proposedUnits.sum, 'proposed units');
  chain((d) => d.universes.lotteries.lotteries, 'lotteries'); chain((d) => d.universes.lotteries.firstLotteries, 'first lotteries'); chain((d) => d.universes.rental.tenders, 'rental tenders'); chain((d) => d.universes.rental.tenderUnits, 'rental tender units');
  chain((d) => d.universes.planning.renewalPlans.plans, 'renewal plans'); chain((d) => d.universes.planning.tenderPlans.plans, 'tender plans'); chain((d) => d.universes.planning.stateLandInventory.plans, 'inventory plans');
  chain((d) => d.universes.construction.buildings, 'buildings'); chain((d) => d.universes.construction.lots, 'construction lots');
  assert.ok(TLV.universes.land.kpis.tenders > 50 && DTA.universes.land.kpis.tenders > TLV.universes.land.kpis.tenders && IL.universes.land.kpis.tenders > DTA.universes.land.kpis.tenders);
  assert.ok(TLV.universes.renewal.complexes > 10 && IL.universes.renewal.complexes > DTA.universes.renewal.complexes);
});
t('a district is the same computation over its localities — the sum of its localities equals the district, never a national fallback', () => {
  const G = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/localities.json'), 'utf8')).localities.filter((l) => l.district === 'd-ta');
  const parts = G.map((l) => S.supply({ level: 'locality', code: String(l.code), now: NOW }));
  const sum = (get) => parts.reduce((s, d) => s + (get(d) || 0), 0);
  assert.equal(sum((d) => d.universes.land.kpis.tenders), DTA.universes.land.kpis.tenders); assert.equal(sum((d) => d.universes.renewal.complexes), DTA.universes.renewal.complexes);
  assert.equal(sum((d) => d.universes.lotteries.lotteries), DTA.universes.lotteries.lotteries); assert.equal(sum((d) => d.universes.rental.tenders), DTA.universes.rental.tenders);
  assert.equal(sum((d) => d.universes.land.momentum.awarded.count.prior12), DTA.universes.land.momentum.awarded.count.prior12);
  assert.equal(DTA.universes.land.byLocalities, true); assert.equal(IL.universes.land.byLocalities, false); assert.match(DTA.universes.land.basis.en, /never a national fallback/);
  assert.equal(DTA.universes.rental.rentalUnitsStated, null, 'stated rental units are not summed at district level'); assert.ok(DTA.missing.some((m) => m.id === 'rental-stated'));
});
t('the land universe is the land read model\'s own KPI function (four unit meanings kept apart) over the current scope of the geography', () => {
  const { filters } = LQ.parseFilters(new URLSearchParams({ scope: 'current', period: 'all', city: '5000' }), new Date(NOW));
  const own = LQ.summary(filters).kpis, K = TLV.universes.land.kpis;
  for (const k of ['tenders', 'unitsOpen', 'unitsPendingDecision', 'unitsAwarded', 'unitsFailed', 'unitsDecidedNotRead']) assert.strictEqual(K[k], own[k], k);
  assert.equal(K.lifecycle.awarded, own.awarded); assert.match(K.unitsMeaning.en, /four meanings of units, never added/); assert.ok(K.unique && K.unique.lots > 0);
  assert.equal(IL.universes.land.kpis.unitsDecidedNotRead, null, 'a quantity the records do not carry is null, never 0');
});
console.log('supply: momentum and the small-sample rule');
t('momentum: pct = (last12 − prior12) ÷ prior12 × 100 to 0.1; small (pct null) under 3 items or under 100 units in the prior window; an uncovered window is null, never 0', () => {
  const W = S.windowsOf('2026-10-17');
  assert.deepEqual([W.last12, W.prior12, W.last24], [{ from: '2025-10-17', to: '2026-10-17' }, { from: '2024-10-17', to: '2025-10-17' }, { from: '2024-10-17', to: '2026-10-17' }]);
  const it = (d, u) => ({ d, u }), opts = { dateOf: (x) => x.d, W, coveredTo: '2026-10-17', what: { he: 'פריטים', en: 'items' } };
  const m1 = S.momentum([it('2026-01-01'), it('2026-02-01'), it('2025-01-01'), it('2025-02-01')], opts);
  assert.equal(m1.prior12, 2); assert.equal(m1.small, true); assert.equal(m1.pct, null, 'fewer than 3 items in the prior window');
  const m2 = S.momentum([it('2026-01-01'), it('2026-02-01'), it('2026-03-01'), it('2026-04-01'), it('2025-01-01'), it('2025-02-01'), it('2025-03-01')], opts);
  assert.deepEqual([m2.last12, m2.prior12, m2.pct, m2.small], [4, 3, 33.3, false]);
  const m3 = S.momentum([it('2026-01-01', 100), it('2026-02-01', 100), it('2026-03-01', 100), it('2025-01-01', 20), it('2025-02-01', 20), it('2025-03-01', 20)], { ...opts, unitsOf: (x) => x.u });
  assert.deepEqual([m3.last12, m3.prior12, m3.small, m3.pct], [300, 60, true, null], 'three items but fewer than 100 units in the prior window');
  const m4 = S.momentum([it('2026-01-01', 150), it('2026-02-01', 150), it('2026-03-01', 150), it('2025-01-01', 100), it('2025-02-01', 100), it('2025-03-01', 100)], { ...opts, unitsOf: (x) => x.u });
  assert.deepEqual([m4.last12, m4.prior12, m4.pct, m4.small], [450, 300, 50, false]);
  const m5 = S.momentum([it('2025-01-01', 10), it('2025-01-02', 10), it('2025-01-03', 10)], { ...opts, unitsOf: (x) => x.u, coveredTo: '2025-01-27' });
  assert.equal(m5.last12, null, 'a window the source does not cover is null'); assert.equal(m5.coverage.last12, 'none'); assert.equal(m5.coverage.prior12, 'partial'); assert.equal(m5.pct, null);
  const m6 = S.momentum([], { ...opts, unitsOf: (x) => x.u }); assert.equal(m6.last12, 0, 'inside coverage, no items is a real 0'); assert.equal(m6.prior12, 0); assert.equal(m6.pct, null); assert.equal(m6.small, true);
  isBi(m6.rule, 'rule'); assert.match(m6.rule.en, /fewer than 3 items or fewer than 100 units/);
});
t('real data: the lottery source ends 2025-01 → the last-12 window is null (not 0), the indicator says why; windows are dated from `now` and reported', () => {
  for (const d of [IL, DTA, TLV]) { const m = d.universes.lotteries.firstLotteryUnits; assert.equal(m.last12, null); assert.equal(m.pct, null); assert.equal(m.coverage.last12, 'none'); assert.equal(m.coverage.coveredTo, '2025-01-27');
    const i = d.indicators.find((x) => x.id === 'lottery-momentum'); assert.equal(i.value, null); assert.match(i.reason.en, /does not cover the window/); assert.ok(d.missing.some((x) => x.id === 'lotteries-window'));
    assert.deepEqual(d.windows.last12, { from: '2025-10-17', to: '2026-10-17' }); assert.deepEqual(d.windows.prior12, { from: '2024-10-17', to: '2025-10-17' }); isBi(d.windows.basis, 'windows'); }
  assert.ok(IL.universes.lotteries.firstLotteryUnits.prior12 > 1000 && IL.universes.lotteries.firstLotteryUnits.count.prior12 > 50, 'the prior window is partly covered and counted');
  const m = IL.universes.land.momentum.published; assert.ok(m.last12 > 0 && m.prior12 > 0 && typeof m.pct === 'number'); assert.equal(m.pct, Math.round(((m.last12 - m.prior12) / m.prior12) * 1000) / 10); assert.equal(m.unit, 'units');
  const a = IL.universes.land.momentum.awarded; assert.ok(a.count.last12 >= 3 && a.last12 > 0); assert.equal(IL.universes.renewal.momentum.declarations.unit, 'count');
});
console.log('supply: indicators');
t('every indicator is DERIVED with a bilingual label, formula, period and limitations, named inputs, and a bilingual reason whenever its value is null', () => {
  const ids = ['planning-momentum', 'land-marketing-momentum', 'tender-award-momentum', 'renewal-declaration-momentum', 'lottery-momentum', 'supply-pressure'];
  for (const d of [IL, DTA, TLV]) { assert.deepEqual(d.indicators.map((i) => i.id), ids);
    for (const i of d.indicators) { assert.equal(i.cls, 'DERIVED', i.id); isBi(i.label, i.id); isBi(i.formula, i.id + '.formula'); isBi(i.period, i.id + '.period'); assert.ok(i.inputs && typeof i.inputs === 'object' && Object.keys(i.inputs).length, i.id + '.inputs');
      assert.ok(Array.isArray(i.limitations) && i.limitations.length, i.id + '.limitations'); for (const l of i.limitations) isBi(l, i.id + '.limitation'); assert.ok(['%', 'months'].includes(i.unit));
      assert.ok(i.value === null || Number.isFinite(i.value), i.id); if (i.value === null) isBi(i.reason, i.id + '.reason'); else assert.equal(i.reason, null);
      if (i.unit === '%' && i.value != null && i.id !== 'planning-momentum') assert.equal(i.value, Math.round(((i.inputs.last12 - i.inputs.prior12) / i.inputs.prior12) * 1000) / 10, i.id + ': the value follows the formula from the stated inputs'); } }
});
t('supply pressure: national / district only — awarded units of 24 months ÷ monthly official sales; null at locality level with the reason; state-land and awarded ≠ built limitations', () => {
  const p = TLV.indicators.find((i) => i.id === 'supply-pressure'); assert.equal(p.value, null); assert.match(p.reason.en, /no official locality sales series/); assert.ok(TLV.missing.some((m) => m.id === 'supply-pressure'));
  for (const d of [IL, DTA]) { const i = d.indicators.find((x) => x.id === 'supply-pressure'); assert.equal(i.unit, 'months'); const I = i.inputs;
    assert.ok(I.salesT12 > 0 && I.unitsAwarded24 != null && I.awardedTenders24 > 0); assert.equal(I.monthlyPace, Math.round((I.salesT12 / 12) * 10) / 10); assert.deepEqual(I.window.awarded, { from: '2024-10-17', to: '2026-10-17' }); assert.equal(I.window.sales.to, '2026-08');
    if (i.value != null) assert.equal(i.value, Math.round((I.unitsAwarded24 / (I.salesT12 / 12)) * 10) / 10); else assert.ok(i.reason && I.salesSmall === true);
    assert.ok(i.limitations.some((l) => /state land only/.test(l.en)) && i.limitations.some((l) => /awarded ≠ built/.test(l.en)) && i.limitations.some((l) => /different universes/.test(l.en))); }
  assert.equal(IL.indicators.find((x) => x.id === 'supply-pressure').inputs.salesScope.en, 'national'); assert.match(DTA.indicators.find((x) => x.id === 'supply-pressure').inputs.salesScope.en, /district series/);
  assert.ok(IL.indicators.find((x) => x.id === 'supply-pressure').inputs.unitsAwarded24 > DTA.indicators.find((x) => x.id === 'supply-pressure').inputs.unitsAwarded24);
  assert.ok(!IL.missing.some((m) => m.id === 'supply-pressure'));
});
t('planning momentum: Σ plan unit delta of plans approved in the window, the layer\'s own dates, each plan once; the date basis and the undated plans are stated', () => {
  for (const d of [IL, DTA, TLV]) { const i = d.indicators.find((x) => x.id === 'planning-momentum'); const I = i.inputs;
    assert.ok(I.plans >= I.approvedOrEffective && I.approvedOrEffective >= I.dated && I.dated >= 0); isBi(I.dateBasis, 'dateBasis'); assert.match(I.dateBasis.en, /pl_date_8/); assert.equal(I.datedBy.renewal + I.datedBy.land, I.dated);
    assert.ok(i.limitations.some((l) => /not every planning approval/.test(l.en)) && i.limitations.some((l) => /stage history starts on 2026-10-13/.test(l.en)));
    if (I.dated) { assert.ok(I.planUnitDelta && 'last12' in I.planUnitDelta && 'prior12' in I.planUnitDelta); if (i.value != null) assert.equal(i.value, Math.round(((I.planUnitDelta.last12 - I.planUnitDelta.prior12) / I.planUnitDelta.prior12) * 1000) / 10, 'the value follows the formula from the stated inputs'); } else assert.match(i.reason.en, /no dated approved plans/); }
  assert.ok(IL.indicators.find((x) => x.id === 'planning-momentum').inputs.dated > 300);
  const P = IL.universes.planning; assert.ok(P.renewalPlans.plans >= DTA.universes.planning.renewalPlans.plans); assert.ok(P.tenderPlans.plans <= P.tenderPlans.planReferences.found);
  for (const blk of [P.renewalPlans, P.tenderPlans]) { assert.equal(blk.byStage.reduce((s, x) => s + x.plans, 0), blk.plans, 'each plan once'); for (const x of blk.byStage) { assert.ok(PL.STAGES.concat(PL.TERMINAL, PL.OTHER).includes(x.stage), x.stage); assert.ok('sum' in x.unitsAfterPlan && 'of' in x.unitsAfterPlan && 'sum' in x.planUnitDelta && 'sum' in x.existingAuthorisedUnits); } isBi(blk.unitsBasis, 'unitsBasis'); assert.match(blk.unitsBasis.en, /DERIVED/); isBi(blk.join, 'join'); }
  assert.equal(P.stateLandInventory.stale, true); assert.equal(P.stateLandInventory.asOf, '2022-02-17'); assert.match(P.stateLandInventory.basis.en, /STATE LAND ONLY/); assert.ok(P.limitations.length >= 3);
});
console.log('supply: the other universes');
t('renewal: complexes and declarations as the Ministry publishes them; unit sums say how many publish the column; additional ≠ net; stages partition the complexes', () => {
  for (const d of [IL, DTA, TLV]) { const R = d.universes.renewal; assert.equal(R.byStage.reduce((s, x) => s + x.complexes, 0), R.complexes); assert.equal(R.declaration.declared + R.declaration['not-yet-declared'] + R.declaration['not-stated'], R.complexes); assert.equal(R.declared, R.declaration.declared);
    assert.ok(R.proposedUnits.of <= R.complexes && (R.proposedUnits.sum == null || R.proposedUnits.sum > 0)); assert.match(R.additionalUnits.note.en, /additional ≠ net/); assert.ok(R.planningJoin.exact + R.planningJoin.unmatched === R.complexes); isBi(R.basis, 'renewal.basis'); assert.match(R.basis.en, /not construction/); }
  assert.ok(IL.universes.renewal.complexes > 900 && IL.universes.renewal.declared > 500);
});
t('rental: the ILA rental track — tender units are the TOTAL, stated rental units only at locality / national level over the same tenders', () => {
  for (const d of [IL, TLV]) { const R = d.universes.rental; assert.ok(R.tenders > 0 && R.tenderUnits > 0); assert.ok(R.rentalUnitsStated == null || R.rentalUnitsStated <= R.tenderUnitsOfStated); assert.match(R.basis.en, /tender units = the tender total/); assert.match(R.basis.en, /general market benchmark/); }
  assert.equal(DTA.universes.rental.byLocalities, true); assert.equal(TLV.universes.rental.byLocalities, false); assert.ok(IL.universes.rental.rentalUnitsStated > 0);
});
t('lotteries: first-lottery units only, projects by the furthest evidenced stage (registry); construction: exact block/parcel joins, STALE and dated', () => {
  for (const d of [IL, DTA, TLV]) { const L = d.universes.lotteries; assert.ok(L.firstLotteries <= L.lotteries); assert.equal(L.unitsFirstLotteries.of <= L.firstLotteries, true); assert.match(L.basis.en, /FIRST lotteries only/);
    for (const x of L.projectsByStage) assert.ok(['land-awarded', 'marketed', 'permitted', 'construction-started', 'completed', 'occupied', 'no-evidence'].includes(x.stage)); isBi(L.projectStageBasis, 'projectStageBasis');
    const C = d.universes.construction; assert.equal(C.stale, true); assert.equal(C.asOf, '2024-03-01'); assert.match(C.basis.en, /exact block\/parcel joins to awarded lots only/); assert.ok(C.started <= C.buildings && C.completed <= C.buildings && C.lots <= C.buildings); assert.ok(C.limitations.length >= 2); }
  assert.ok(IL.universes.construction.buildings > 1000 && IL.universes.construction.completed > 0); assert.ok(IL.universes.lotteries.projectsByStage.find((x) => x.stage === 'permitted').projects > 500);
});
console.log('supply: freshness, missing, bilingual, determinism, speed');
t('freshness keeps observation, publication and PROPX check apart for every source; sources named by id', () => {
  for (const d of [IL, DTA, TLV]) { const ids = d.freshness.map((f) => f.id); for (const id of ['land', 'renewal', 'planning', 'inventory', 'rental', 'housing', 'construction', 'sales']) assert.ok(ids.includes(id), id);
    for (const f of d.freshness) { isBi(f.label, f.id); assert.ok('observed' in f && 'published' in f && 'checked' in f, f.id); } }
  const land = IL.freshness.find((f) => f.id === 'land'); assert.ok(land.observed && land.published && land.checked); assert.ok(land.observed !== land.published && land.published !== land.checked);
  const sales = IL.freshness.find((f) => f.id === 'sales'); assert.ok(sales.observed && sales.published && sales.checked && sales.observed !== sales.published);
  const h = IL.freshness.find((f) => f.id === 'housing'); assert.equal(h.observed, '2025-01-27'); assert.ok(h.published > h.observed);
  assert.equal(IL.freshness.find((f) => f.id === 'construction').state, 'STALE'); assert.equal(IL.freshness.find((f) => f.id === 'inventory').state, 'STALE');
});
t('what is missing is said, bilingually: permits / starts / completions everywhere; locality sales, inventory and pressure; no private-land source', () => {
  for (const d of [IL, DTA, TLV]) for (const m of d.missing) { assert.ok(m.id && HE.test(m.he) && !HE.test(m.en), m.id); }
  assert.ok(IL.missing.some((m) => m.id === 'permits') && TLV.missing.some((m) => m.id === 'permits') && IL.missing.some((m) => m.id === 'private-land'));
  for (const id of ['supply-pressure', 'sales', 'inventory']) assert.ok(TLV.missing.some((m) => m.id === id), id);
  assert.ok(DTA.missing.some((m) => m.id === 'inventory') && !IL.missing.some((m) => m.id === 'inventory') && !DTA.missing.some((m) => m.id === 'sales'));
});
t('every {he, en} pair in the output has Hebrew in he and none in en', () => {
  for (const d of [IL, DTA, TLV]) walk(d, (o, p) => { if (typeof o.he === 'string' && typeof o.en === 'string') isBi(o, p); });
});
t('deterministic: a fresh recomputation equals the memoized answer; a different `now` moves the windows', () => {
  const a = S.supply({ level: 'locality', code: '5000', now: NOW }), b = S.supply({ level: 'locality', code: '5000', now: NOW, fresh: true });
  assert.deepEqual(a, b);
  const c = S.supply({ level: 'locality', code: '5000', now: Date.parse('2026-04-01T12:00:00Z') }); assert.equal(c.today, '2026-04-01'); assert.deepEqual(c.windows.last12, { from: '2025-04-01', to: '2026-04-01' });
  assert.notEqual(c.universes.land.momentum.published.last12, a.universes.land.momentum.published.last12);
});
t('speed: after warm-up a locality or district computation takes well under a second', () => {
  const times = [];
  for (const g of [{ level: 'locality', code: '3000' }, { level: 'locality', code: '7900' }, { level: 'district', code: 'd-center' }, { level: 'locality', code: '5000' }]) { const t0 = Date.now(); S.supply({ ...g, now: NOW, fresh: true }); times.push(Date.now() - t0); }
  assert.ok(times.every((ms) => ms < 1000), 'ms: ' + times.join(', ') + ' (warm-up ' + WARM + ')');
});

t('review fix: a source that stops before today anchors both momentum windows on its coverage date — no partial last-12 window against a full prior-12', () => {
  const items = []; for (let i = 0; i < 40; i++) items.push({ d: `2025-${String((i % 12) + 1).padStart(2, '0')}-10` }); for (let i = 0; i < 20; i++) items.push({ d: `2024-${String((i % 12) + 1).padStart(2, '0')}-10` });
  const W = S.windowsOf('2026-10-17');
  const m = S.momentum(items, { dateOf: (x) => x.d, W, coveredFrom: '2020-01-01', coveredTo: '2026-08-15', what: { he: 'x', en: 'x' } });
  assert.equal(m.anchoredOn, '2026-08-15'); assert.equal(m.window.last12.to, '2026-08-15'); assert.equal(m.coverage.last12, 'within');
  const far = S.momentum(items, { dateOf: (x) => x.d, W, coveredFrom: '2020-01-01', coveredTo: '2025-01-27', what: { he: 'x', en: 'x' } }); assert.equal(far.anchoredOn, null, 'a source that stopped 21 months ago is not anchored'); assert.equal(far.last12, null, 'its last-12 window stays null');
  const il = S.supply({ level: 'il', fresh: true }); const rm = il.universes.renewal.momentum.declarations; assert.ok(rm.anchoredOn && rm.coverage.last12 === 'within', 'renewal windows anchored on the MoCH publication date');
  const ind = il.indicators.find((i) => i.id === 'renewal-declaration-momentum'); assert.match(ind.period.en, /anchored on the source's coverage date/);
});
console.log(`supply: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
