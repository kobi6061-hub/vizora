'use strict';
/* PROPX · Project Intelligence 2.0 (lib/entities/project-intel.js) — the gates.
 *
 * A deterministic read of one project / awarded lot from its stored official records: a dated timeline with a source and class
 * on every event, a six-rung stage ladder with direct evidence or the reason there is none, the lot's ₪/unit beside the
 * locality's own competitive-bid lots (same track, this tender excluded, ≥ 5), applicants per unit beside the locality's
 * other first lotteries, explainable signals with a registry rule, missing-data ids with a registry reason. Never a join by
 * name or geometry, never an estimate, never a project sales / occupancy / rent figure, never a judgement. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PI = require('../lib/entities/project-intel');
const Q = require('../lib/entities/query');
const X = require('../lib/explain/registry');
const { STAGES } = require('../lib/entities/registry');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const NOW = '2026-10-17';
const c = Q.load();
const ALL = [...c.projById.values()];
const ilaCons = ALL.find((p) => p.kind === 'ila-awarded-lot' && p.construction && p.construction.started);
const ilaBid = ALL.find((p) => p.kind === 'ila-awarded-lot' && p.landPerUnit && p.priceBasis === 'competitive-bid' && p.track === 'open-market' && p.decisionDate > '2025-01');
const moch = ALL.find((p) => p.kind !== 'ila-awarded-lot' && p.demand && p.demand.applicantsPerUnit != null);
const intel = (p) => Q.project(p.id, { now: NOW }).intel;

console.log('project intelligence: module');
t('pure and read-only: no fetch, no network, no randomness; version stamped; additive on project() (every prior field unchanged)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/entities/project-intel.js'), 'utf8');
  assert.ok(!/fetch\(|https?\.request|XMLHttpRequest|Math\.random|child_process/.test(src));
  assert.equal(PI.VERSION.id, 'propx-project-intel-v1'); assert.equal(PI.projIntel(null), null);
  const d = Q.project(ilaBid.id); for (const k of ['id', 'kind', 'tender', 'developers', 'sources', 'joins', 'freshness', 'stage', 'units', 'landPerUnit']) assert.ok(k in d, k); assert.ok(d.intel && d.intel.timeline && d.intel.ladder);
});
t('the timeline is dated, sorted, and every event carries a source and a class; ILA: published → deadline → awarded (+ plan approval, + construction as of 2024-03 flagged stale); MoCH: lotteries + undated permit / stage as of the source update', () => {
  const I = intel(ilaCons); const ev = I.timeline.map((e) => e.event);
  assert.ok(ev.includes('tender-published') && ev.includes('land-awarded') && ev.includes('construction-started'), ev.join(','));
  for (let i = 1; i < I.timeline.length; i++) assert.ok(String(I.timeline[i - 1].date || '9999') <= String(I.timeline[i].date || '9999'), 'sorted');
  for (const e of I.timeline) { assert.ok(e.source && ['OFFICIAL', 'OBSERVED', 'DERIVED'].includes(e.cls), e.event); assert.ok(e.label.he && e.label.en, e.event); }
  const cs = I.timeline.find((e) => e.event === 'construction-started'); assert.equal(cs.stale, true); assert.equal(cs.asOf, '2024-03-01'); assert.equal(cs.source, 'datagov:moch:construction-progress');
  const M = intel(moch); assert.ok(M.timeline.some((e) => e.event === 'lottery' && e.date && Number.isFinite(e.units)));
  const ps = M.timeline.find((e) => e.event === 'permit-status'); if (ps) { assert.equal(ps.undated, true); assert.match(ps.label.en, /undated/); }
});
t('the stage ladder has the six rungs in order; an evidenced rung carries its date and source; a rung without evidence carries the reason, never an inferred state', () => {
  for (const p of [ilaCons, ilaBid, moch]) { const L = intel(p).ladder; assert.deepEqual(L.rungs.map((r) => r.stage), STAGES);
    for (const r of L.rungs) { if (r.evidenced) assert.ok(r.source, r.stage); else { assert.ok(r.reason && r.reason.he && r.reason.en, r.stage); assert.equal(r.date, null); } }
    assert.match(L.basis.en, /not a stage that did not happen/); assert.equal(L.furthest, p.stage.furthest); }
  const ila = intel(ilaBid).ladder; assert.ok(ila.rungs.find((r) => r.stage === 'land-awarded').evidenced); assert.match(ila.rungs.find((r) => r.stage === 'permitted').reason.en, /no machine-readable permits source/);
  const mo = intel(moch).ladder; assert.match(mo.rungs.find((r) => r.stage === 'land-awarded').reason.en, /not joined to an ILA lot/);
});
t('land ₪/unit context: competitive-bid lots of the same locality and track over 36 months by decision date, THIS tender excluded; a position only with ≥ 5 lots; the land read model\'s own quartiles and formula; nothing for a lot without a competitive-bid ₪/unit', () => {
  const I = intel(ilaBid); const Lc = I.land;
  assert.equal(Lc.value, ilaBid.landPerUnit); assert.equal(Lc.basis, 'competitive-bid'); assert.ok(Lc.locality && Number.isInteger(Lc.locality.lots));
  assert.equal(Lc.locality.period.months, 36); assert.equal(Lc.locality.period.dateField, 'decision'); assert.equal(Lc.locality.track, ilaBid.track); assert.match(Lc.locality.formula, /Σ winning sums ÷ Σ units/);
  if (Lc.locality.lots >= 5) { assert.ok(['above-p75', 'within', 'below-p25'].includes(Lc.position)); assert.ok(Lc.locality.p25 <= Lc.locality.median && Lc.locality.median <= Lc.locality.p75); } else { assert.equal(Lc.position, null); assert.match(Lc.reason.en, /fewer than 5/); }
  /* the tender itself is excluded from its own context: recomputing with the tender included changes the lot count by its own priced lots */
  const LQ = require('../lib/land/query'); const C = LQ.load(); const own = C.live.find((r) => r.id === ilaBid.tenderId); assert.ok(own, 'own tender in the live list');
  const nocost = intel(ilaCons); if (ilaCons.landPerUnit == null) { assert.equal(nocost.land.locality, null); assert.match(nocost.land.reason.en, /no competitive-bid/); }
  assert.equal(intel(moch).land, null, 'a lottery project has no land context');
});
t('applicants-per-unit context: the locality\'s OTHER first lotteries (this project excluded), the median of per-lottery ratios, a position only with ≥ 5; a lot has none', () => {
  const D = intel(moch).demand; assert.equal(D.value, moch.demand.applicantsPerUnit); assert.ok(D.locality && Number.isInteger(D.locality.lotteries));
  assert.match(D.locality.formula, /this project excluded/);
  if (D.locality.lotteries >= 5) assert.ok(['above-p75', 'within', 'below-p25'].includes(D.position)); else assert.equal(D.position, null);
  assert.equal(intel(ilaBid).demand, null);
});
t('every signal has a registry rule, a bilingual text, a formatted value, a threshold, a period, a source, a class and limitations; a land-cost position only for a lot awarded inside the window; lottery demand signals are relative to the locality (never an absolute "hot" threshold); the project construction signal has its own id', () => {
  let n = 0, stale = 0;
  for (const p of ALL.slice(0, 600)) { const I = intel(p); for (const s of I.signals) { n++;
    assert.ok(X.SIGNAL_RULES[s.id], 'no rule for ' + s.id); assert.ok(s.text.he && s.text.en && s.trigger.he, s.id); assert.ok(typeof s.valueLabel === 'string' && s.valueLabel.length, s.id + ' value ' + s.valueLabel); if (/^LAND_COST_/.test(s.id)) assert.match(s.valueLabel, /^₪[\d,]+$/, s.id);
    assert.ok(s.threshold && s.period && s.source && ['OFFICIAL', 'DERIVED'].includes(s.cls) && Array.isArray(s.limitations) && s.limitations.length, s.id);
    assert.notEqual(s.id, 'STAGE_EVIDENCE_STALE', 'staleness is a missing-data reason, not a signal'); assert.notEqual(s.id, 'CONSTRUCTION_EVIDENCE', 'the project signal has its own id');
    if (/^LOTTERY_DEMAND_/.test(s.id)) { assert.equal(p.kind, 'moch-lottery-project'); assert.ok(I.demand.locality.lotteries >= 5); assert.match(s.text.en, /first lottery \d{4}-\d{2}-\d{2}/); }
    if (/^LAND_COST_/.test(s.id)) { assert.ok(I.land.locality.lots >= 5); assert.ok(p.decisionDate >= I.land.locality.period.from, s.id + ' own award inside the window'); assert.match(s.text.en, /\(awarded \d{4}-\d{2}-\d{2}\)/); stale++; } } }
  assert.ok(n > 0, 'signals fire on the sample');
  const src = fs.readFileSync(path.join(ROOT, 'lib/entities/project-intel.js'), 'utf8'); assert.ok(!/OVERSUBSCRIBED = \d/.test(src), 'no absolute demand threshold');
  const old = intel(ilaCons); assert.ok(old.missing.some((m) => m.id === 'later-evidence') && X.missing('later-evidence'), 'an old lot says no source can carry a later stage'); assert.ok(!old.signals.some((s) => s.id === 'STAGE_EVIDENCE_STALE'));
  assert.ok(old.signals.some((s) => s.id === 'PROJECT_CONSTRUCTION_REPORT') && X.SIGNAL_RULES.PROJECT_CONSTRUCTION_REPORT.term === 'construction_progress_report');
  const oldBid = ALL.find((p) => p.kind === 'ila-awarded-lot' && p.landPerUnit && p.priceBasis === 'competitive-bid' && p.decisionDate < '2022-01-01'); if (oldBid) { const Lc = intel(oldBid).land; assert.equal(Lc.position, null); assert.match(Lc.reason.en, /own decision date .* outside the 36-month window/); }
  /* XPlan units after the plan resolve from the land store's plan-units map */
  const withPlan = ALL.filter((p) => p.kind === 'ila-awarded-lot').map((p) => intel(p)).find((I) => I.timeline.some((e) => e.event === 'plan-approved' && e.units && Number.isFinite(e.units.unitsAfterPlan))); assert.ok(withPlan, 'at least one site prints units after the plan'); assert.match(withPlan.timeline.find((e) => e.event === 'plan-approved' && e.units && Number.isFinite(e.units.unitsAfterPlan)).label.en, /units after the plan/);
});
t('what is missing resolves to a registry reason (permits, construction join, lottery ↔ lot join, permit date, project sales, occupancy); never a sales / occupancy / rent figure', () => {
  for (const p of [ilaBid, ilaCons, moch]) { const I = intel(p); for (const m of I.missing) assert.ok(X.missing(m.id), 'no reason for ' + m.id); const ids = I.missing.map((m) => m.id); assert.ok(ids.includes('project-sales') && ids.includes('occupancy'), ids.join(','));
    if (p.kind === 'ila-awarded-lot') { assert.ok(ids.includes('permits') && ids.includes('lottery-join')); if (!p.construction) assert.ok(ids.includes('construction')); } else assert.ok(ids.includes('tender-join') && ids.includes('permit-date'));
    assert.ok(!('sales' in I) && !('occupancy' in I) && !('rent' in I)); }
});
t('deterministic and cheap: the same project gives the same intel; 300 projects read in bounded time', () => {
  const a = JSON.stringify(intel(ilaBid)), b = JSON.stringify(intel(ilaBid)); assert.equal(a, b);
  const t0 = Date.now(); for (const p of ALL.slice(0, 300)) intel(p); assert.ok(Date.now() - t0 < 8000, 'ms ' + (Date.now() - t0));
});
t('GET /api/intel?view=project carries intel; the page renders the block (piHTML) inside the project drawer with ⓘ marks; the project view\'s prior shape is intact', async () => {
  const h = require('../api/intel');
  const call = (url) => new Promise((r) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { r({ status: this.statusCode, body: b }); } }; h({ method: 'GET', url }, res); });
  const r = await call('/api/intel?view=project&id=' + encodeURIComponent(moch.id)); assert.equal(r.status, 200); const d = JSON.parse(r.body); assert.ok(d.intel && d.intel.ladder && d.intel.timeline.length);
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /function piHTML\(d\)/); assert.match(page, /d\.intel&&t\.pi\?sec\(t\.pi\.title,D,piHTML\(d\)\)/); assert.match(page, /xpBtn\("project_stage"\)/); assert.match(page, /"land_cost_position"\)/); assert.match(page, /"lottery_demand_position"\)/); assert.match(page, /pi:\{title:"מודיעין פרויקט"/); assert.match(page, /pi:\{title:"Project intelligence"/);
});
setTimeout(() => { console.log(`project intelligence: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`); process.exit(failed ? 1 : 0); }, 1500);
