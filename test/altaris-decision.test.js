'use strict';
/* ALTARIS · Investment Decision layer (altaris/decision.js) — the gates.
 *
 * The decision layer sits on top of the underwriting engine: it reads the engine's results and the PROPX context the
 * page already holds, applies a documented deterministic policy, and never recalculates a return. These tests prove
 * the four verdict states, the gates, the two separate ratings, the structure selection, the conditions, the flip
 * points, the source-aware breakdown, the rental separation, the narrative's agreement with the verdict — and that
 * adding the layer moved no engine number (zero drift: the frozen baseline and the engine hash are unchanged). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const SRC = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const E = require('../altaris/engine.js');
const DX = require('../altaris/decision.js');
const CS = require('../altaris/cases.js');
const MD = require('../altaris/methodology.js');
const FX = JSON.parse(SRC('test/fixtures/altaris-baseline.json'));
const TODAY = '2026-10-16';
const clone = (o) => JSON.parse(JSON.stringify(o));
const sha256 = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const caseDeal = (id) => clone(CS.CASES.find((c) => c.id === id).deal);
const decide = (deal, settings, ctx, runCtx) => { const R = E.run(deal, settings || null, Object.assign({ today: TODAY }, runCtx || {})); return { R, D: DX.decide(R, Object.assign({ today: TODAY, deal }, ctx || {})) }; };
const flipsOf = (x, settings, runCtx) => DX.flips(x.R, Object.assign({ today: TODAY, deal: x.D ? x.R && x.deal : null }, x.ctx || {}), { run: (d) => E.run(d, settings || null, Object.assign({ today: TODAY }, runCtx || {})), decision: x.D });
const V = DX.VERDICT;

console.log('altaris decision: module');
t('the decision module is deterministic and isolated: no DOM, storage, network, randomness; it imports only the engine', () => {
  const m = SRC('altaris/decision.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/document\.|window\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest|Math\.random|Date\.now\(\)|new Date\(\)/.test(m.replace(/root\.AltarisDecision|root\.AltarisEngine/g, '')), 'DOM / storage / network / clock / randomness');
  assert.deepEqual([...m.matchAll(/require\('([^']+)'\)/g)].map((x) => x[1]), ['./engine.js']);
  assert.ok(!/SITE_PASSWORD|SESSION_SECRET|SUPABASE|service_role|eyJ[A-Za-z0-9_-]{20,}/.test(m));
});
t('it never recalculates a return: every IRR / MOIC / capital figure comes through the engine accessors; no xirr, no cash-flow arithmetic', () => {
  const m = SRC('altaris/decision.js');
  assert.ok(!/xirr|metricsOf|buyModel|financeModel|hybridModel|\.flows\b/.test(m), 'the decision layer touches the cash-flow models');
  assert.ok((m.match(/E\.irrOf\(/g) || []).length >= 4 && (m.match(/E\.moicOf\(/g) || []).length >= 2 && (m.match(/E\.capOf\(/g) || []).length >= 4);
});
t('versioned: ALTARIS Investment Decision Methodology v1, pinned to the engine version and the metric methodology', () => {
  assert.equal(DX.VERSION.id, 'altaris-investment-decision-v1');
  assert.equal(DX.VERSION.label.en, 'ALTARIS Investment Decision Methodology v1');
  assert.equal(DX.VERSION.engine.version, E.VERSION);
  assert.equal(DX.VERSION.metricMethodology, MD.VERSION.id);
  assert.ok(Object.isFrozen(DX.VERSION) && Object.isFrozen(DX.POLICY));
});
t('the policy is documented in both languages and its thresholds are the ones the code uses', () => {
  assert.equal(DX.POLICY_TEXT.length, 8, 'seven policy lines + the FINAL DECISION rules F0–F5 (18.10.2026)');
  assert.match(DX.POLICY_TEXT[7].en, /F0–F5/); assert.ok(DX.POLICY.final && DX.POLICY.final.neverUpgrades === true);
  for (const p of DX.POLICY_TEXT) assert.ok(p.he && p.en);
  assert.ok(DX.POLICY_TEXT[0].en.includes(`attractiveness ≥ ${DX.POLICY.takeMin}`) && DX.POLICY_TEXT[1].en.includes(`attractiveness ≥ ${DX.POLICY.conditionsMin}`));
  assert.deepEqual(Object.keys(V), ['TAKE', 'TAKE_WITH_CONDITIONS', 'PASS', 'INSUFFICIENT_EVIDENCE']);
  assert.equal(V.TAKE.label.he, 'לקחת'); assert.equal(V.TAKE_WITH_CONDITIONS.label.he, 'לקחת בכפוף לתנאים'); assert.equal(V.PASS.label.he, 'לא לקחת'); assert.equal(V.INSUFFICIENT_EVIDENCE.label.he, 'אין מספיק מידע להחלטה');
  assert.ok(DX.DISCLAIMER.he.startsWith('הערכת ALTARIS מבוססת') && DX.DISCLAIMER.en.startsWith('ALTARIS assessment is based'));
  assert.ok(!/Moody|rating agency|credit rating|probability of default/i.test(SRC('altaris/decision.js') + SRC('altaris/app.js')), 'no rating-agency claim');
});

console.log('altaris decision: zero regression');
t('ZERO drift: the engine file and every frozen engine output are unchanged by the decision layer', () => {
  assert.equal(MD.VERSION.engine.sha256, sha256(fs.readFileSync(path.join(ROOT, 'altaris/engine.js'))), 'altaris/engine.js changed');
  for (const [k, r] of Object.entries(FX.runs)) {
    const R = E.run(FX.deals[r.deal], FX.settings[r.settings], { today: FX.generatedWith.today });
    assert.equal(sha256(JSON.stringify(R)), r.sha256, k);
  }
  for (const c of CS.CASES) { const d = clone(c.deal); const before = JSON.stringify(d); const R = E.run(d, null, { today: TODAY }); const s0 = sha256(JSON.stringify(R)); DX.decide(R, { today: TODAY, deal: d }); assert.equal(sha256(JSON.stringify(R)), s0, c.id + ': decide mutated the engine output'); assert.equal(JSON.stringify(d), before, c.id + ': decide mutated the deal'); }
});
t('flips never mutate the deal or the engine result (they re-run the engine on copies)', () => {
  const d = caseDeal('park-18'), before = JSON.stringify(d);
  const x = decide(d); const s0 = sha256(JSON.stringify(x.R));
  const fl = DX.flips(x.R, { today: TODAY, deal: d }, { run: (dd) => E.run(dd, null, { today: TODAY }), decision: x.D });
  assert.ok(fl.length >= 1);
  assert.equal(JSON.stringify(d), before); assert.equal(sha256(JSON.stringify(x.R)), s0);
});

console.log('altaris decision: the four verdicts');
const park = () => decide(caseDeal('park-18'));
t('TAKE — high return, strong downside: Park 18 HYBRID meets every gate (9/9), attractiveness ≥ 65, downside ≥ 45, evidence HIGH', () => {
  const { D } = park();
  assert.equal(D.verdict, 'TAKE'); assert.equal(D.recommended, 'hybrid'); assert.equal(D.second, 'finance');
  assert.ok(D.score >= DX.POLICY.takeMin, D.score); assert.equal(D.evidence.level, 'HIGH');
  const h = D.structures.hybrid; assert.ok(h.gates.every((g) => g.status === 'pass')); assert.ok(h.groups.downside.score >= DX.POLICY.downsideMin);
  assert.equal(D.conditions.length, 0);
});
t('TAKE WITH CONDITIONS — Ganei HaPark FINANCE: IRR and margin of safety are near misses (within 20%), so conditions, not a PASS', () => {
  const { D } = decide(caseDeal('ganei-hapark'));
  assert.equal(D.verdict, 'TAKE_WITH_CONDITIONS'); assert.equal(D.recommended, 'finance');
  const f = D.structures.finance; assert.deepEqual(f.gates.filter((g) => g.status === 'near').map((g) => g.id).sort(), ['irr', 'mos']);
  assert.ok(D.conditions.some((c) => c.id === 'irr') && D.conditions.some((c) => c.id === 'mos'), JSON.stringify(D.conditions.map((c) => c.id)));
  for (const c of D.conditions) assert.ok(c.text.he && c.text.en && c.basis.he && c.basis.en);
});
t('PASS — a critical gate clearly failed: HaNassi 42 FINANCE IRR 11.4% is more than 20% below the 15% hurdle; a 79 attractiveness does not rescue it', () => {
  const { D } = decide(caseDeal('hanassi-42'));
  assert.equal(D.verdict, 'PASS'); assert.equal(D.recommended, null);
  const f = D.structures.finance; assert.equal(f.verdict, 'PASS'); assert.deepEqual(f.criticalFail, ['irr']); assert.ok(f.score >= 65, 'the score is reported honestly, the gate decides');
  assert.match(D.basis.en, /critical gate failed: minimum IRR/);
});
t('INSUFFICIENT EVIDENCE — the developer\'s list price as the only value: an evidence gate, never a PASS, never a TAKE', () => {
  const d = caseDeal('park-18'); d.value.chosen = 'developer';
  const { D } = decide(d);
  assert.equal(D.verdict, 'INSUFFICIENT_EVIDENCE');
  for (const k of E.STRATS) { const a = D.structures[k]; assert.equal(a.verdict, 'INSUFFICIENT_EVIDENCE'); assert.equal(a.gates.find((g) => g.id === 'supportedValue').status, 'fail'); }
});
t('INSUFFICIENT EVIDENCE — no underwriting value at all: nothing computes, the missing inputs are named, no neutral substitute', () => {
  const d = caseDeal('park-18'); d.value.chosen = null;
  const { D } = decide(d);
  assert.equal(D.verdict, 'INSUFFICIENT_EVIDENCE'); assert.equal(D.score, null); assert.equal(D.recommended, null);
  assert.deepEqual(D.missing.map((m) => m.k), ['buy', 'finance', 'hybrid']); assert.ok(D.missing[0].missing.includes('smv'));
});

console.log('altaris decision: gates and ratings');
t('high return / unacceptable downside: a −45% downside shock fails BUY on the downside-loss gate (> 50% of capital) → BUY PASS', () => {
  const d = caseDeal('park-18'); d.scen.downside = { valueShock: -45, default: true, enforcementMonths: 18 };
  const { D } = decide(d);
  const b = D.structures.buy; assert.equal(b.verdict, 'PASS'); assert.equal(b.gates.find((g) => g.id === 'downsideLoss').status, 'fail');
});
t('extreme leverage: BUY at 95% LTV scores 15 on leverage and fails IRR / MOIC / MOS / downside loss; a loan at 83% LTV fails coverage → PASS', () => {
  const d = caseDeal('park-18'); d.buy.ltvPct = 95; d.buy.ratePct = 9;
  const b = decide(d).D.structures.buy; assert.equal(b.verdict, 'PASS'); assert.equal(b.groups.structure.parts.find((p) => p.k === 'leverage').score, 15);
  const d2 = caseDeal('park-18'); d2.finance.amount = 26000000; d2.finance.priorLiens = 0;
  const f = decide(d2).D.structures.finance; assert.equal(f.verdict, 'PASS'); assert.equal(f.gates.find((g) => g.id === 'coverage').status, 'fail');
});
t('concentration: the fund\'s developer / project caps are hard gates — the same deal becomes PASS on every structure when the portfolio already holds the developer', () => {
  const d = caseDeal('park-18');
  const x = decide(d, { fundSize: 60000000 }, {}, { portfolio: [{ developer: d.info.developer, project: 'x', city: 'y', capital: 20000000 }] });
  assert.equal(x.D.verdict, 'PASS');
  for (const k of E.STRATS) assert.ok(x.D.structures[k].criticalFail.includes('devExposure'), k);
});
t('two separate ratings: attractiveness (0–100 + descriptor) and evidence quality (HIGH / MEDIUM / LOW) — never one score, never a probability', () => {
  const { D } = park();
  assert.ok(Number.isInteger(D.score) && D.score >= 0 && D.score <= 100);
  assert.ok(['VERY_ATTRACTIVE', 'ATTRACTIVE', 'MARGINAL', 'WEAK'].includes(D.descriptor));
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(D.evidence.level) && Number.isInteger(D.evidence.score));
  assert.ok(!/confidence|probab/i.test(JSON.stringify(D.evidence)) && !/% confidence/.test(SRC('altaris/app.js')));
  const desc = (s) => DX.POLICY.descriptor.find(([min]) => s >= min)[1];
  assert.equal(desc(80), 'VERY_ATTRACTIVE'); assert.equal(desc(79), 'ATTRACTIVE'); assert.equal(desc(64), 'MARGINAL'); assert.equal(desc(49), 'WEAK');
});
t('strong economics / weak evidence: a manual value, no appraisal, no status, unassessed developer and defaulted terms → LOW evidence caps the verdict at TAKE WITH CONDITIONS', () => {
  const d = caseDeal('park-18'); d.value = { manual: { value: 31000000, note: 'x' }, chosen: 'manual' }; d.info.constructionStatus = null; d.info.developerRating = 'unassessed'; d.hybrid = {};
  const { D } = decide(d);
  assert.equal(D.evidence.level, 'LOW'); assert.equal(D.verdict, 'TAKE_WITH_CONDITIONS'); assert.ok(D.score >= DX.POLICY.takeMin, 'economics alone would be a TAKE');
  const ids = D.evidence.items.map((i) => i.id); for (const id of ['value', 'appraisal', 'status', 'developer', 'market']) assert.ok(ids.includes(id), id);
  assert.ok(D.conditions.some((c) => c.id === 'appraisal') && D.conditions.some((c) => c.id === 'developer'));
});
t('missing evidence never raises a rating: adding PROPX market data can only add deductions when it is weak, and removes the "not loaded" deduction only when loaded', () => {
  const d = caseDeal('park-18');
  const without = decide(d).D.evidence;
  const d2 = clone(d); d2.market = { retrievedAt: '2026-10-15', city: 'x', tx: { n: 180, median: 29800, from: '2024-11-01', to: '2026-10-01', via: 'over.org.il' }, devIntel: { lots: 4, projects: 1, cities: 2 } };
  const withM = decide(d2, null, { market: d2.market }).D.evidence;
  assert.ok(without.items.some((i) => i.id === 'market') && !withM.items.some((i) => i.id === 'market'));
  assert.ok(withM.score >= without.score);
  const d3 = clone(d); d3.market = { retrievedAt: '2026-10-15', city: 'x', tx: { n: 8, median: 29800, from: '2024-11-01', to: '2026-10-01' } };
  const weak = decide(d3, null, { market: d3.market }).D.evidence; assert.ok(weak.items.some((i) => i.id === 'tx' && i.delta < 0));
});

console.log('altaris decision: stale, conflicts, user assumptions, rental');
t('material stale source: an old observation and an old PROPX read are separate deductions, and a stale CBS series is flagged — a fresh check of an old observation is not current', () => {
  const d = caseDeal('park-18'); d.market = { retrievedAt: '2026-05-01', city: 'x', tx: { n: 60, median: 29800, from: '2024-01-01', to: '2025-03-01' } };
  const { D } = decide(d, null, { market: d.market, cbs: { ok: true, scope: { he: 'ארצי', en: 'national' }, level: 'national', momentum: -2, small: false, latest: '2026-08', freshness: 'STALE', sourceUpdate: '2026-10-07', checkedAt: TODAY } });
  const ids = D.evidence.items.map((i) => i.id);
  assert.ok(ids.includes('txAge') && ids.includes('checked') && ids.includes('cbs'), ids.join(','));
  const f = D.freshness.find((x) => x.id === 'tx'); assert.equal(f.observed, '2025-03-01'); assert.equal(f.checked, '2026-05-01');
  assert.ok(D.freshness.find((x) => x.id === 'cbsSales').state === 'STALE');
});
t('conflicting sources: independent value sources 20% apart are shown side by side, neither silently chosen, evidence reduced, a condition to resolve', () => {
  const d = caseDeal('park-18'); d.value.appraisal.value = 25000000;   // units sum ≈ 31.4M vs 25.0M appraisal
  const { D, R } = decide(d);
  assert.ok(R.facts.spread > DX.POLICY.conflictSpread);
  const c = D.conflicts.find((x) => x.id === 'valueSources'); assert.ok(c && c.material);
  assert.deepEqual(c.values.map((v) => v.source).sort(), ['appraisal', 'units']); assert.equal(c.values.find((v) => v.used).source, 'units');
  assert.ok(D.evidence.items.some((i) => i.id === 'spread' && i.delta < 0)); assert.ok(D.conditions.some((x) => x.id === 'conflict'));
  assert.ok(D.evidence.conflict);
});
t('the PROPX median versus the chosen value is a stated conflict too (the deal median is a statistic, not an appraisal)', () => {
  const d = caseDeal('park-18'); d.market = { retrievedAt: '2026-10-15', city: 'x', tx: { n: 90, median: 22000, from: '2025-01-01', to: '2026-10-01' } };
  const { D } = decide(d, null, { market: d.market });
  const c = D.conflicts.find((x) => x.id === 'propxMedian'); assert.ok(c); assert.match(c.treatment.en, /not an appraisal/);
});
t('user-assumption dependence: material defaulted inputs are named, deducted and counted; the most material assumption is the underwriting value', () => {
  const d = caseDeal('park-18'); d.finance = { amount: 12000000, collateralValue: 31000000 };   // the rest on defaults
  const { D } = decide(d);
  const f = D.structures.finance; const it = f.evidence.items.find((i) => i.id === 'defaults'); assert.ok(it && it.delta <= -2 && /ratePct|termMonths/.test(it.text.en));
  assert.ok(D.breakdown.counts.USER_ASSUMPTION >= 2); assert.match(D.breakdown.mostMaterial.en, /underwriting value/);
  assert.ok(D.breakdown.counts.MODEL === 8 && D.breakdown.counts.MISSING >= 1);
});
t('rental context is never misread: a rental-track tender is a pipeline fact (OFFICIAL), not an operating project; the rent index is a general benchmark; no rent input is ever touched', () => {
  const d = caseDeal('park-18'); d.market = { retrievedAt: '2026-10-15', city: 'x', rental: { tenders: 3, tenderUnits: 400, rentalUnits: 300 } };
  const { D } = decide(d, null, { market: d.market, indicators: { rentIndex: { yoy: 3.1, period: { year: 2026, month: 8 } } } });
  const r = D.breakdown.items.OFFICIAL.find((x) => x.id === 'rental'); assert.ok(r); assert.match(r.text.en, /pipeline — not an operating project/);
  const ri = D.breakdown.items.OFFICIAL.find((x) => x.id === 'rentIndex'); assert.ok(ri); assert.match(ri.text.en, /general market benchmark/);
  const m = SRC('altaris/decision.js'); assert.ok(!/rentOn|\.rent\b|occupancy/.test(m), 'the decision layer reads no rent assumption');
  assert.ok(!/rental/.test(JSON.stringify(D.structures.hybrid.groups.market.parts)), 'rental is context, never a market score');
});

console.log('altaris decision: structure selection, conditions, flips, narrative');
t('BUY recommended when it wins: Park 18 bought 20% cheaper makes BUY the highest-scoring eligible structure; FINANCE and HYBRID remain second / third with the reasons stated', () => {
  const d = caseDeal('park-18'); for (const u of d.units) u.proposed = Math.round(u.proposed * 0.8);
  const { D } = decide(d);
  assert.equal(D.verdict, 'TAKE'); assert.equal(D.recommended, 'buy'); assert.equal(D.second, 'hybrid');
  assert.equal(D.whyStructure.length, 2); for (const w of D.whyStructure) assert.ok(w.text.he.includes('לעומת') && w.text.en.startsWith('vs '));
});
t('FINANCE recommended: Ganei HaPark (BUY and HYBRID fail critical gates)', () => { const { D } = decide(caseDeal('ganei-hapark')); assert.equal(D.recommended, 'finance'); assert.equal(D.structures.buy.verdict, 'PASS'); assert.equal(D.structures.hybrid.verdict, 'PASS'); });
t('HYBRID recommended: Park 18 — and the comparison explains why not the other two on consistent dimensions', () => {
  const { D } = park(); assert.equal(D.recommended, 'hybrid');
  assert.deepEqual(D.comparison.map((r) => r.id), ['verdict', 'score', 'return', 'downside', 'capital', 'atRisk', 'duration', 'protection', 'liquidity', 'execution', 'hurdles', 'evidence']);
  for (const r of D.comparison) for (const k of E.STRATS) assert.notStrictEqual(r.cells[k], undefined);
  assert.match(D.whyStructure.find((w) => w.k === 'buy').text.en, /PASS \(a critical gate failed/);
  assert.match(D.whyStructure.find((w) => w.k === 'finance').text.en, /attractiveness 73 vs 83/);
});
t('no structure acceptable: Coastal Portfolio I — every structure fails a critical gate; the lead structure and its basis are still named', () => {
  const { D } = decide(caseDeal('coastal-portfolio-i'));
  assert.equal(D.verdict, 'PASS'); assert.equal(D.recommended, null); assert.ok(D.lead); assert.ok(D.basis.en.length > 10);
  assert.ok(E.STRATS.every((k) => D.structures[k].verdict === 'PASS'));
});
t('conditions come only from the gates and the engine solvers: price ≤ max price from buyPriceLimits, collateral from the coverage formula, permit from the entered status', () => {
  const d = caseDeal('park-18'); for (const u of d.units) u.proposed = Math.round(u.proposed * 0.93); d.info.constructionStatus = 'permit';
  const { D, R } = decide(d);
  const b = D.structures.buy; assert.equal(b.verdict, 'TAKE_WITH_CONDITIONS');
  const conds = DX.decide(R, { today: TODAY, deal: d }).conditions;   // the lead is hybrid here; evaluate BUY's own conditions through assess
  assert.ok(conds.some((c) => c.id === 'permit'), 'permit milestone from the status');
  const lim = R.strategies.buy.limits.maxPrice; assert.ok(lim > 0);
  const d2 = clone(d); d2.finance.amount = 23000000; d2.finance.priorLiens = 0;
  const f = decide(d2).D.structures.finance; assert.ok(f.gates.find((g) => g.id === 'coverage').status !== 'pass');
});
t('decision flips: the smallest input changes that move the verdict, found by re-running the engine — 2 to 4, deduplicated, both languages, no invented variable', () => {
  const x = park();
  const fl = DX.flips(x.R, { today: TODAY, deal: x.D && caseDeal('park-18') }, { run: (d) => E.run(d, null, { today: TODAY }), decision: x.D });
  assert.ok(fl.length >= 2 && fl.length <= 4, fl.length);
  for (const f of fl) { assert.ok(f.text.he && f.text.en); assert.equal(f.fromVerdict, 'TAKE'); assert.ok(V[f.toVerdict].rank < V.TAKE.rank); assert.ok(Number.isFinite(f.at)); }
  assert.ok(fl.some((f) => f.id === 'supportedValue' || f.id === 'realization'));
  const keys = fl.map((f) => `${f.direction}|${f.toVerdict}|${f.fmt}|${f.rel.toFixed(3)}`); assert.equal(new Set(keys).size, keys.length, 'duplicates');
  const y = decide(caseDeal('hanassi-42'));
  const up = DX.flips(y.R, { today: TODAY, deal: caseDeal('hanassi-42') }, { run: (d) => E.run(d, null, { today: TODAY }), decision: y.D });
  assert.ok(up.some((f) => f.direction === 'better' && V[f.toVerdict].rank > V.PASS.rank), 'a PASS names what would make it a TAKE / conditional');
});
t('the narrative is generated from the decision object only and never contradicts it (verdict, structure, conditions, disclaimer line)', () => {
  for (const c of CS.CASES) {
    const { D } = decide(clone(c.deal));
    for (const L of ['he', 'en']) {
      const N = DX.narrative(D, L);
      assert.ok(N[0].includes(DX.t(D.verdictLabel, L)), c.id + ' ' + L);
      if (D.recommended) assert.ok(N[1].includes(DX.t({ he: 'המבנה המומלץ', en: 'Recommended structure' }, L) + ': ' + (D.recommended.toUpperCase())));
      if (D.conditions.length) assert.ok(N.some((p) => p.includes(DX.t(D.conditions[0].text, L))));
      assert.ok(/not an AI recommendation|אינה המלצת AI/.test(N[N.length - 1]));
    }
  }
});
t('every illustrative case runs through the layer: the five verdicts are the natural result of the policy (no case input changed for variety)', () => {
  const res = Object.fromEntries(CS.CASES.map((c) => [c.id, decide(clone(c.deal)).D.verdict]));
  assert.deepEqual(res, { 'park-18': 'TAKE', 'hanassi-42': 'PASS', 'ganei-hapark': 'TAKE_WITH_CONDITIONS', 'hagefen-renewal': 'TAKE_WITH_CONDITIONS', 'coastal-portfolio-i': 'PASS' });
  assert.equal(sha256(SRC('altaris/cases.js')).length, 64);
});

console.log('altaris decision: page wiring (additive)');
const APP = SRC('altaris/app.js'), HTML = SRC('altaris/index.html'), CSS = SRC('altaris/altaris.css');
t('the page loads the decision module after the engine and the methodology and before the controller', () => {
  assert.ok(HTML.indexOf('/altaris/engine.js') < HTML.indexOf('/altaris/decision.js') && HTML.indexOf('/altaris/methodology.js') < HTML.indexOf('/altaris/decision.js') && HTML.indexOf('/altaris/decision.js') < HTML.indexOf('/altaris/app.js'));
  assert.match(APP, /DX = window\.AltarisDecision;/);
  assert.match(APP, /S\.D = DX\.decide\(S\.R, dctx\(\)\); scheduleFlips\(ctx\);/, 'the verdict is recomputed with every engine run; flips are scheduled lazily');
});
t('the compact decision card sits at the top of the ledger in both ledger branches; nothing existing is removed; the disclaimer sits beneath it', () => {
  assert.match(APP, /return head \+ decisionCardHTML\(\) \+ thesisCardHTML\(\) \+ q1 \+ `<div class="ax-q">/);
  assert.match(APP, /return head \+ decisionCardHTML\(\) \+ thesisCardHTML\(\) \+ q1 \+ q2 \+ q3 \+ q4 \+ sigHTML\(sig\) \+ risk \+ footHTML\(\);/);
  assert.match(APP, /data-view-go="decision">\$\{DT\.he\.basis\} ←<\/button>\n\s*<p class="ax-dec-disc">\$\{esc\(DX\.DISCLAIMER\.he\)\}<\/p>/);
  for (const s of ['ALTARIS INVESTMENT DECISION', "kick: 'ALTARIS INVESTMENT DECISION'", 'ax-dec-dl', '<dt>${DT.he.why}</dt>', '<dt>${DT.he.risk}</dt>', '<dt>${DT.he.cond}</dt>']) assert.ok(APP.includes(s), s);
  assert.ok(!/gauge|sparkle|confetti/i.test(APP + CSS));
});
t('the basis view: a route of its own, Hebrew RTL / English LTR, every section of the brief', () => {
  assert.match(APP, /const VIEWS = \['deal', 'compare', 'portfolio', 'saved', 'settings', 'method', 'decision', 'thesis'\];/);
  assert.match(APP, /else if \(S\.view === 'decision'\) main\.innerHTML = '<div id="o-decision"><\/div>';/);
  for (const id of ['whyStruct', 'cmp', 'returns', 'downside', 'structure', 'market', 'execution', 'gates', 'evidence', 'conds', 'flips', 'sources', 'conflicts', 'fresh', 'policy', 'narr']) assert.ok(APP.includes(`sec('${id}'`) || APP.includes(`sec(g, `), id);
  assert.match(APP, /<section class="ax-sec ax-mv ax-dv" dir="\$\{dir\}" lang="\$\{L\}">/);
  assert.ok(APP.includes("conflicts: 'סתירות בין מקורות'") && APP.includes("conflicts: 'SOURCE CONFLICTS'"));
  assert.ok(CSS.includes('.ax-dec.tone-take{--tone:var(--up)}') && CSS.includes('.ax-dec.tone-cond{') && CSS.includes('.ax-dec.tone-pass{--tone:var(--down)}') && CSS.includes('.ax-dec.tone-none{'), 'restrained tones');
});
t('IC snapshot, full PDF, Excel and CSV gain additive decision sections; the existing sheets and pages are untouched', () => {
  assert.match(APP, /\$\{icDecisionHTML\(print\)\}<div class="ax-ic-grid">/);
  assert.match(APP, /<div class="ax-pp">\$\{icHTML\(true\)\}\$\{printFoot\(\)\}<\/div><div class="ax-pp">\$\{decisionPrintHTML\(\)\}<\/div><div class="ax-pp"><section class="ax-sec"><h2>פרטי העסקה<\/h2>/);
  assert.match(APP, /\.concat\(\[\{ name: 'Investment Decision', rows: decisionRows\(\)[^\n]*\n\s*\.concat\(\[\{ name: 'Metric Conventions', rows: methodRows\(\)/);
  assert.match(APP, /\.concat\(\[\{ title: 'Investment Decision', rows: decisionRows\(\) \}\]\)\n\s*\.concat\(\[\{ title: 'Metric Conventions', rows: methodRows\(\) \}\]\)/);
  const sheets = [...APP.slice(APP.indexOf('function exportXLSX()')).matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(sheets.slice(0, 8), ['סיכום', 'עסקה', 'שווי נתמך', 'הנחות', 'תוצאות', 'מבחני לחץ', 'סיכון', 'תזרים ']);
  assert.deepEqual(sheets.slice(-2), ['Investment Decision', 'Metric Conventions']);
  for (const s of ['T.s.gates', 'T.s.conds', 'T.s.flips', 'T.s.sources', 'T.s.policy', 'DX.VERSION.id']) assert.ok(APP.slice(APP.indexOf('function decisionRows()')).includes(s), s);
});
t('portfolio and saved deals gain decision columns (sortable through the shared table core); existing columns stay', () => {
  assert.match(APP, /AXT\.types\.pf \+= ',text,number,text,text';/);
  assert.match(APP, /<th>סטטוס<\/th><th>החלטה<\/th><th class="n">אטרקטיביות<\/th><th>מבנה מומלץ<\/th><th>ראיות<\/th>/);
  assert.match(APP, /<th>אות אחרון<\/th><th>החלטה בשמירה<\/th><th>תזה חיה<\/th><th>סטטוס<\/th>/);
  assert.match(APP, /saved: 'text,text,text,text,text,text,text,date,number,-'/);
  assert.ok(APP.includes("לא משנה את חישובי הפורטפוליו"));
});
t('versioning: saved versions, JSON exports and imports carry the decision stamp beside the metric methodology id; old versions stay readable', () => {
  assert.match(APP, /signal: S\.R\.signal\.code, decision: S\.D \? S\.D\.stamp : null, strategy: S\.R\.ic\.strategy, methodology: MD\.VERSION\.id \}\);/);
  assert.match(APP, /kind: 'altaris-deal', schema: 1, methodology: MD\.VERSION\.id, decision: S\.D \? S\.D\.stamp : null,/);
  assert.match(APP, /decision: v\.decision && typeof v\.decision === 'object' \? v\.decision : null/);
  assert.match(APP, /'לא סומן \(לפני v1\)'/);
  const { D } = park(); assert.deepEqual(Object.keys(D.stamp), ['v', 'verdict', 'score', 'evidence', 'structure', 'at', 'final', 'market'], 'the stamp gains the final verdict and the market status (18.10.2026); old stamps stay readable'); assert.equal(D.stamp.v, 'altaris-investment-decision-v1'); assert.equal(D.stamp.final, D.verdict, 'without an assessment the final verdict equals the economic one'); assert.equal(D.stamp.market, null);
});
t('the AI role is explanation only: the page has no model call; the narrative function is deterministic text from the decision object', () => {
  assert.ok(!/anthropic|openai|chat\/completions|messages\.create|\bllm\b|language model/i.test((APP + SRC('altaris/decision.js')).replace(/\/\*[\s\S]*?\*\//g, '')), 'a model call in the page or the decision layer');
  assert.match(SRC('altaris/decision.js'), /function narrative\(D, L\)/);
});


console.log('the Market Dossier / Opportunity-Risk fields on ctx.market never move the ECONOMIC decision (they reach the final verdict only through ctx.marketAssessment → POLICY.final)');
t('decide() is byte-identical with and without the dossier / radar context fields on ctx.market (they are display-only in the ALTARIS market panel)', () => {
  for (const c of CS.CASES.slice(0, 3)) {
    const d = clone(c.deal);
    const R = E.run(d, null, { today: TODAY });
    const base = { ...(d.market || {}), tx: d.market && d.market.tx };
    const plain = DX.decide(R, { today: TODAY, deal: d, market: base });
    const withCtx = DX.decide(R, { today: TODAY, deal: d, market: { ...base,
      dossier: { geo: { level: 'locality', code: '7900' }, quality: { level: 'LOW', score: 10, items: ['x'] }, watch: [{ id: 'open-land', text: { he: 'א', en: 'a' } }], risk: [{ id: 'failed-tenders', text: { he: 'ב', en: 'b' } }], missing: ['permits'], salesScope: 'district' },
      radar: { opportunities: [{ signal: 'open-land', m: 3, evidence: { level: 'LOW', score: 10 } }], risks: [{ signal: 'failed-tenders', m: 3, evidence: { level: 'LOW', score: 10 } }], served: 'file' } } });
    const strip = (D) => JSON.stringify(D, (k, v) => (k === 'generatedAt' || k === 'at' ? undefined : v));
    assert.equal(strip(withCtx), strip(plain), c.id);
  }
});

console.log(`altaris decision: ${passed} passed${failed ? `, ${failed} FAILED` : ', all green'}`);
process.exit(failed ? 1 : 0);
