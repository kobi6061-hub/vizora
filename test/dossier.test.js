'use strict';
/* PROPX · Market Dossier (lib/dossier) — the gates.
 *
 * The dossier composes PROPX's existing read models for one geography. It never fetches, never models, never adds
 * one universe of units to another, labels district-level official sales as such for a locality, says what is
 * missing, and grades its own evidence from rules. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../lib/dossier/query');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const NOW = Date.parse('2026-10-16T12:00:00Z');

console.log('dossier: module');
t('the dossier is read-only: no fetch, no network, no randomness; it composes the existing read models', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/dossier/query.js'), 'utf8');
  assert.ok(!/fetch\(|https?\.request|XMLHttpRequest|Math\.random/.test(src));
  for (const m of ['../land/query', '../housing/query', '../renewal/query', '../rental/query', '../entities/query', '../radar/query', '../trust/catalog']) assert.ok(src.includes(`require('${m}')`), m);
});
const IL = D.dossier({ level: 'il', now: NOW }), TLV = D.dossier({ level: 'locality', code: '5000', now: NOW }), DTA = D.dossier({ level: 'district', code: 'd-ta', now: NOW });
t('three levels resolve from the registry; an unknown geography is null', () => {
  assert.equal(IL.geo.level, 'il'); assert.equal(TLV.geo.level, 'locality'); assert.equal(TLV.geo.district, 'd-ta'); assert.equal(DTA.geo.level, 'district'); assert.ok(DTA.geo.localities > 5);
  assert.equal(D.dossier({ level: 'locality', code: '999999' }), null); assert.equal(D.dossier({ level: 'district', code: 'd-nowhere' }), null);
  for (const d of [IL, TLV, DTA]) { assert.equal(d.schema, 1); assert.ok(d.basis.he && d.basis.en); for (const k of ['sales', 'land', 'housing', 'renewal', 'rental', 'developers', 'macro', 'changes']) assert.ok(d.sections[k], k); }
});
t('official sales for a locality are the DISTRICT series, labelled so; inventory exists only nationally and is named missing elsewhere', () => {
  assert.match(TLV.sections.sales.scope.en, /district level, not the locality's figure/);
  assert.equal(TLV.sections.sales.latest, DTA.sections.sales.latest); assert.equal(TLV.sections.sales.latestValue, DTA.sections.sales.latestValue);
  assert.ok(IL.sections.inventory && IL.sections.inventory.value > 0); assert.ok(!TLV.sections.inventory && TLV.missing.some((m) => m.id === 'inventory')); assert.ok(!DTA.sections.inventory);
  assert.match(IL.sections.sales.scope.en, /national/);
});
t('a district is the same KPI function over the live records of its localities — never a national fallback', () => {
  const K = DTA.sections.land.kpis; assert.equal(K.byLocalities, true); assert.ok(K.tenders > 0 && K.tenders < IL.sections.land.kpis.tenders);
  assert.ok(K.tenders >= TLV.sections.land.kpis.tenders, 'the district holds at least its largest locality');
  const H = DTA.sections.housing.kpis; assert.equal(H.byLocalities, true); assert.ok(H.lotteries > 0 && H.lotteries < IL.sections.housing.kpis.lotteries); assert.equal(H.unitsFirst, null, 'units are not summed across localities');
  const R = DTA.sections.renewal.kpis; assert.equal(R.byLocalities, true); assert.ok(R.complexes >= TLV.sections.renewal.kpis.complexes && R.complexes < IL.sections.renewal.kpis.complexes);
  assert.ok(DTA.sections.developers.total > 0 && DTA.sections.developers.total < IL.sections.developers.total);
});
t('unit universes are kept apart: the dossier never adds tender, lottery, renewal and rental units into one figure', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/dossier/query.js'), 'utf8');
  assert.ok(!/totalUnits\s*=|unitsTotal\s*=|allUnits/.test(src));
  assert.match(IL.basis.en, /never added together/);
  assert.match(IL.sections.rental.basis.en, /tender units = the tender total/);
});
t('rental stays separate from operating projects and rents; macro is labelled national context', () => {
  assert.match(IL.sections.rental.basis.en, /the rent index = a general market benchmark, not a project rent/);
  assert.match(IL.sections.macro.scope.en, /national — context, not a local figure/);
});
t('recent changes come from the radar for the same geography; transactions and permits are named as missing, never fetched', () => {
  assert.equal(TLV.sections.changes.source, 'lib/radar'); assert.ok(TLV.sections.changes.rows.every((e) => e.geo.localityCode === '5000'));
  assert.ok(TLV.missing.some((m) => m.id === 'transactions') && TLV.missing.some((m) => m.id === 'permits'));
  assert.ok(IL.missing.some((m) => m.id === 'transactions'));
});
t('freshness keeps observation, publication and PROPX check apart for every source', () => {
  for (const f of IL.freshness) { assert.ok(f.id && f.label.he && f.label.en); assert.ok('observed' in f && 'published' in f && 'checked' in f); }
  const s = IL.freshness.find((f) => f.id === 'sales'); assert.ok(s.observed && s.published && s.checked);
});

console.log('dossier: signals and evidence quality (deterministic rules)');
t('signals are explainable triggers with value, threshold, period, source and class — never a recommendation', () => {
  for (const d of [IL, TLV, DTA]) for (const s of d.signals) { assert.ok(['watch', 'risk'].includes(s.kind)); assert.ok(s.text.he && s.text.en); assert.ok(s.threshold && s.source && s.cls); assert.ok(!/recommend|buy|invest|מומלץ|לקנות/i.test(s.text.en + s.text.he)); }
});
t('signal thresholds: sales momentum ±10%, months of supply ≥ 18, failed tenders ≥ 30% of ≥ 5, open land ≥ 500, stale rental ≥ 3, concentration ≥ 50% of ≥ 5 lots', () => {
  const mk = (over) => Object.assign({ sales: { momentum: { ok: true, pct: 0 }, small: false, scope: { he: 'x', en: 'x' }, latest: '2026-08' }, land: { kpis: { tenders: 10, decided: 4, decidedWithoutDetail: 0, cancelled: 0, unitsOpen: 0, unitsAwarded: 0, unitsPendingDecision: 0 } }, developers: { top: [], entries: { total: 0 } }, changes: { total: 1, window: '7d' } }, over);
  const ids = (S) => D.signalsOf(S, { level: 'il' }, NOW).map((s) => s.kind + ':' + s.id);
  assert.deepEqual(ids(mk({})), ['risk:failed-tenders']);
  assert.ok(ids(mk({ sales: { momentum: { ok: true, pct: 12 }, small: false, scope: { he: 'x', en: 'x' }, latest: '2026-08' } })).includes('watch:sales-momentum-up'));
  assert.ok(ids(mk({ sales: { momentum: { ok: true, pct: -11 }, small: false, scope: { he: 'x', en: 'x' }, latest: '2026-08' } })).includes('risk:sales-momentum-down'));
  assert.ok(!ids(mk({ sales: { momentum: { ok: true, pct: 40 }, small: true, scope: { he: 'x', en: 'x' }, latest: '2026-08' } })).some((x) => /momentum/.test(x)), 'a small sample has no trend signal');
  assert.ok(ids(mk({ inventory: { monthsSupply: 18, period: '2026-08' } })).includes('risk:months-of-supply'));
  assert.ok(ids(mk({ land: { kpis: { tenders: 10, decided: 2, decidedWithoutDetail: 0, cancelled: 0, unitsOpen: 500 } } })).includes('watch:open-land'));
  assert.ok(ids(mk({ rental: { pipeline: { tenders: 1, staleStatus: { n: 3 } } } })).includes('risk:stale-rental-status'));
  assert.ok(ids(mk({ developers: { top: [{ name: 'A', lots: 6 }, { name: 'B', lots: 4 }], entries: { total: 0 } } })).includes('risk:developer-concentration'));
  assert.ok(ids(mk({ changes: { total: 0, window: '30d' } })).includes('risk:no-recent-changes'));
  assert.ok(ids(mk({ renewal: { kpis: { complexes: 3, proposedUnits: { sum: 2500, of: 3 } } } })).includes('watch:renewal-pipeline'));
});
t('signal threshold and period are bilingual where they are words (he + en), plain where they are numbers or dates; the page follows the board selection exactly', () => {
  for (const d of [IL, TLV, DTA]) for (const s of d.signals) {
    for (const k of ['threshold', 'period']) { const v = s[k]; if (v == null) continue; if (typeof v === 'object') assert.ok(v.he && v.en && /[\u0590-\u05FF]/.test(v.he) && !/[\u0590-\u05FF]/.test(v.en), k + ' ' + s.id); else assert.ok(!/[A-Za-z]{3,}/.test(String(v)), k + ' is a bare word: ' + v + ' (' + s.id + ')'); }
  }
  assert.equal(TLV.geo.name.en, 'Tel Aviv - Yafo'); assert.equal(D.index().localities[0].en, 'Tel Aviv - Yafo');
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /function dsFollow\(id\)\{const l=LOC\[id\];if\(!l\|\|_geoNav\)return;/); assert.match(page, /if\(m\.length===1\)dsOpen\("locality",m\[0\]\.code\)/, 'exactly one exact name match opens a locality — never a similarity match');
  assert.match(page, /if\(typeof dsFollow==="function"\)dsFollow\(id\);/);
});
t('evidence quality: documented deductions, HIGH ≥ 70 / MEDIUM ≥ 45 / LOW; a locality loses points for district-only sales and missing inventory; never a probability', () => {
  const q = D.evidenceQuality({ sales: { latest: '2026-08', scope: { he: 'מחוז', en: 'district level' }, national: {}, freshness: 'CURRENT' }, land: { kpis: { tenders: 5 }, detailCoverage: { pct: 90 } }, developers: { top: [{}] }, renewal: { kpis: { complexes: 1 } } }, [{ id: 'permits' }], [], NOW);
  assert.deepEqual(q.items.map((i) => i.id).sort(), ['inventory', 'permits', 'salesGeo', 'transactions'].sort()); assert.equal(q.score, 100 - 8 - 5 - 5 - 6); assert.equal(q.level, 'HIGH');
  const low = D.evidenceQuality({}, [], [{ id: 'x', label: { he: 'x', en: 'x' }, checked: '2026-09-01' }], NOW); assert.ok(low.score < 70); assert.ok(low.items.some((i) => i.id === 'checked:x'));
  assert.match(q.basis.en, /Not a probability/); assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(TLV.quality.level) && Number.isInteger(TLV.quality.score));
});
t('the index lists the districts and the localities with live ILA tenders; the API routes dossier and dossierIndex', () => {
  const ix = D.index(); assert.equal(ix.districts.length, 7); assert.ok(ix.localities.length >= 50 && ix.localities[0].tenders >= ix.localities[1].tenders);
  const api = fs.readFileSync(path.join(ROOT, 'api/intel.js'), 'utf8');
  assert.match(api, /if \(view === 'dossier'\) \{ const level = p\.city \? 'locality' : p\.district \? 'district' : 'il';/); assert.match(api, /if \(view === 'dossierIndex'\) return send\(res, 200, DOSSIER\.index\(\)\);/);
});

t('review fixes: a district is not deducted for "district-only sales"; a district emits its own land signals; a locality tags district / national context signals; the concentration denominator is every listed developer here; land freshness = latest publication, no fake publication date', () => {
  assert.ok(!DTA.quality.items.some((i) => i.id === 'salesGeo'), 'district: the district series IS its figure'); assert.ok(TLV.quality.items.some((i) => i.id === 'salesGeo'));
  const dc = D.dossier({ level: 'district', code: 'd-center', now: NOW }); assert.ok(dc.signals.some((s) => ['open-land', 'awarded-pipeline', 'pending-decision', 'failed-tenders'].includes(s.id)), 'd-center has 15k open units — a land signal must fire');
  for (const s of TLV.signals) { if (/^sales-momentum/.test(s.id)) assert.equal(s.geoScope, 'district', s.id); if (s.id === 'construction-inputs') assert.equal(s.geoScope, 'national'); }
  for (const s of IL.signals) if (/^sales-momentum/.test(s.id) || s.id === 'construction-inputs') assert.equal(s.geoScope, 'own', s.id);
  assert.ok(Number.isInteger(TLV.sections.developers.lotsHereTotal) && TLV.sections.developers.lotsHereTotal >= TLV.sections.developers.top.reduce((s, x) => s + x.lotsHere, 0));
  const land = IL.freshness.find((f) => f.id === 'land'); assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(land.observed) && land.published === null && land.checked, 'observation = latest tender publication; the ILA site has no release date');
  assert.equal(DTA.sections.renewal.planning, null, 'a district never carries the national XPlan join');
  assert.equal(D.dossier({ level: 'nowhere' }), null);
  const ci = IL.signals.find((s) => s.id === 'construction-inputs'); if (ci) assert.match(String(ci.period), /^\d{4}-\d{2}$/);
});
t('the WHOLE market (21.10.2026): all dwellings / second-hand / subsidized new — national and district series only, a locality carries its district\'s labelled, never summed with new-home sales', () => {
  const cbs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cbs-sales/latest.json'), 'utf8'));
  if (!cbs.market) { assert.ok(IL.missing.some((m) => m.id === 'market'), 'not synced → named missing'); return; }
  const M = IL.sections.market, MT = TLV.sections.market, MD = DTA.sections.market;
  assert.equal(M.cls, 'OFFICIAL'); assert.equal(M.key, 'il'); assert.equal(M.total.latestValue, cbs.market.il.total_sold.metrics.latestValue);
  assert.match(MT.scope.en, /district level, not the locality's figure/); assert.equal(MT.key, 'd-ta'); assert.equal(MT.total.latestValue, MD.total.latestValue);
  assert.equal(MD.secondHand.cbs, cbs.market['d-ta'].second_hand_sold.cbs);
  for (const x of [M, MD]) { const sh = x.secondHandShare; if (sh && sh.ok) { assert.equal(sh.pct, +(sh.secondHand / sh.total * 100).toFixed(1)); assert.ok(sh.from && sh.to); } }
  assert.ok(!M.subsidized, 'no national subsidized-by-district series'); assert.ok(MD.subsidized && MD.subsidized.latestValue >= 0);
  assert.notEqual(IL.sections.sales.latestValue, M.total.latestValue, 'new-home sales are their own series — not the all-dwellings figure');
  assert.match(M.doesNotMean.en, /never added/);
});
console.log(`dossier: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
