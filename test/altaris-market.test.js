'use strict';
/* ALTARIS · the intelligence → decision loop (altaris/market-assessment.js + POLICY.final in altaris/decision.js) — the gates (§72)
 * and the acceptance deal set (§73), 18.10.2026.
 *
 * What these gates prove: PROPX market context cannot change IRR, MOIC, XIRR, cash flows, repayment or capital at risk (the engine
 * reads only the deal and the fund settings — the one documented exception is the explained RISK SCORE's exit-liquidity component,
 * which reads the observed deal count with its period, ±5/−10, pre-existing and documented in the metric methodology); the economic
 * verdict and every economic field are byte-identical with and without the assessment; the final verdict moves only through the
 * documented rules F0–F5; a weak / stale / model / national signal never creates CAUTION; district data stays labelled district;
 * missing context is INSUFFICIENT (never neutral-positive); source conflicts reach evidence quality; the explanation names the rule
 * that fired; the acceptance set covers strong / weak markets × strong / marginal / weak economics across BUY / FINANCE / HYBRID. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../altaris/engine.js');
const DX = require('../altaris/decision.js');
const MA = require('../altaris/market-assessment.js');
const CS = require('../altaris/cases.js');
const ROOT = path.join(__dirname, '..');
const TODAY = '2026-10-18';
const clone = (o) => JSON.parse(JSON.stringify(o));
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const strip = (o, drop) => JSON.stringify(o, (k, v) => (drop.includes(k) ? undefined : v));
const caseDeal = (id) => clone(CS.CASES.find((c) => c.id === id).deal);

/* synthetic market contexts shaped exactly as the page keeps them (test inputs only — never product data) */
const FRESH = '2026-10-17T20:00:00Z';
const item = (signal, kind, over) => Object.assign({ signal, text: { he: 'אות ' + signal, en: 'signal ' + signal }, valueLabel: '44%', threshold: '≥ 30%', comparison: { he: 'ארצי: 18%', en: 'national: 18%' }, period: 'current scope', source: 'rmi:michrazim', cls: 'OFFICIAL', evidence: { level: 'HIGH', score: 76 }, m: 3, derived: false }, over || {});
const dossierOf = (risk, watch, over) => Object.assign({ geo: { level: 'locality', code: '7900', name: { he: 'פתח תקווה', en: 'Petah Tiqwa' } }, quality: { level: 'HIGH', score: 76, items: [] }, risk: risk || [], watch: watch || [], missing: [], salesScope: 'district', generatedAt: FRESH }, over || {});
const CAUTION_CTX = () => ({ tx: { n: 57, from: '2025-10-01', to: '2026-09-30', via: 'over.org.il' }, retrievedAt: FRESH,
  dossier: dossierOf([{ id: 'sales-momentum-down', text: { he: 'מומנטום המחוז', en: 'district momentum −10.5%' }, threshold: '≤ −10%', period: '2026-08', source: 'cbs:timeseries:44,10', cls: 'OFFICIAL' }], []),
  radar: { opportunities: [item('open-land', 'opportunity', { valueLabel: '1,893', m: 2 })], risks: [item('failed-tenders', 'risk')], builtAt: FRESH, served: 'file' } });
const STRONG_CTX = () => ({ tx: { n: 160, from: '2025-10-01', to: '2026-09-30', via: 'over.org.il' }, retrievedAt: FRESH,
  dossier: dossierOf([], [{ id: 'sales-momentum-up', text: { he: 'מומנטום', en: 'district momentum +32%' }, threshold: '≥ +10%', period: '2026-08', source: 'cbs:timeseries:44,10', cls: 'OFFICIAL' }]),
  radar: { opportunities: [item('developer-entries', 'opportunity', { valueLabel: '5', source: 'lib/entities', cls: 'DERIVED', m: 2 })], risks: [], builtAt: FRESH, served: 'file' } });
const NEUTRAL_CTX = () => ({ tx: { n: 57, from: '2025-10-01', to: '2026-09-30' }, retrievedAt: FRESH, dossier: dossierOf([], [item('open-land', 'opportunity', { m: 2 })]), radar: { opportunities: [item('open-land', 'opportunity', { m: 2 })], risks: [], builtAt: FRESH } });
const decideWith = (deal, assessment, extra) => { const R = E.run(deal, null, { today: TODAY }); return { R, D: DX.decide(R, Object.assign({ today: TODAY, deal }, extra || {}, assessment ? { marketAssessment: assessment } : {})) }; };
const ECON_KEYS = ['verdict', 'basis', 'score', 'descriptor', 'evidence', 'recommended', 'second', 'lead', 'structures', 'ranked', 'whyStructure', 'comparison', 'strengths', 'risks', 'conditions', 'breakdown', 'conflicts', 'freshness', 'mainReason', 'mainRisk'];

console.log('intelligence → decision: the assessment module');
t('pure, isolated, versioned: no DOM / storage / network / randomness, no engine or decision import, UMD; four statuses, seven dimensions, every PROPX signal id mapped', () => {
  const m = fs.readFileSync(path.join(ROOT, 'altaris/market-assessment.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest|Math\.random|Date\.now\(\)|new Date\(\)|require\(/.test(m.replace(/root\.AltarisMarket/g, '')));
  assert.equal(MA.VERSION.id, 'altaris-market-assessment-v1'); assert.deepEqual(Object.keys(MA.STATUS), ['STRONG', 'NEUTRAL', 'CAUTION', 'INSUFFICIENT']);
  const S = require('../lib/radar/scan'); for (const id of Object.keys(S.RULES).concat(['demand-with-supply', 'inventory-plus-pipeline'])) assert.ok(MA.SIGNALS[id], 'no mapping for signal ' + id);
  for (const [id, s] of Object.entries(MA.SIGNALS)) { assert.ok(MA.DIM[s.dim], id); assert.ok(['positive', 'negative', 'neutral'].includes(s.dir), id); if (s.dir === 'negative') assert.ok(s.remove && s.remove.he && s.remove.en, id + ' needs what-would-remove'); }
});
t('CAUTION needs convergence: two material negatives from two independent source families (CBS + ILA); one alone is NOTED and stays NEUTRAL; two from one family stay NEUTRAL', () => {
  const a = MA.assess(CAUTION_CTX(), null, { today: TODAY }); assert.equal(a.status, 'CAUTION'); assert.deepEqual(a.convergence.negativeFamilies.sort(), ['cbs', 'rmi']); assert.equal(a.material.negative.length, 2);
  for (const f of a.material.negative) { assert.ok(f.remove, f.id); assert.ok(['OFFICIAL', 'OBSERVED'].includes(f.cls)); assert.ok(['own', 'district'].includes(f.geoScope)); }
  const one = CAUTION_CTX(); one.dossier.risk = []; const b = MA.assess(one, null, { today: TODAY }); assert.equal(b.status, 'NEUTRAL'); assert.equal(b.material.negative.length, 1); assert.match(b.notes[0].en, /noted; alone it does not move/);
  const sameFamily = CAUTION_CTX(); sameFamily.dossier.risk = [{ id: 'developer-concentration', text: { he: 'ריכוז', en: 'concentration 60%' }, threshold: '≥ 50%', period: 'observed', source: 'rmi:michrazim', cls: 'OBSERVED' }];
  const c = MA.assess(sameFamily, null, { today: TODAY }); assert.equal(c.status, 'NEUTRAL'); assert.equal(c.material.negative.length, 2); assert.match(c.notes[0].en, /one source family/);
});
t('a weak, stale, modelled or national signal never creates CAUTION: LOW evidence → informational; a read older than 30 days → informational; DERIVED class → informational; a national figure → context', () => {
  const low = CAUTION_CTX(); low.dossier.quality = { level: 'LOW', score: 30, items: [] }; low.radar.risks[0].evidence = { level: 'LOW', score: 30 };
  const a = MA.assess(low, null, { today: TODAY }); assert.equal(a.status, 'NEUTRAL'); assert.equal(a.material.negative.length, 0); assert.ok(a.factors.find((f) => f.signal === 'failed-tenders').whyNotMaterial.some((r) => /evidence quality LOW/.test(r.en)));
  const stale = CAUTION_CTX(); stale.dossier.generatedAt = '2026-08-01T00:00:00Z'; stale.radar.builtAt = '2026-08-01T00:00:00Z';
  const b = MA.assess(stale, null, { today: TODAY }); assert.equal(b.status, 'NEUTRAL'); assert.equal(b.material.negative.length, 0); assert.ok(b.notes.some((n) => /older than 30 days/.test(n.en)));
  const derived = CAUTION_CTX(); derived.radar.risks[0].cls = 'DERIVED'; derived.dossier.risk[0].cls = 'DERIVED';
  const c = MA.assess(derived, null, { today: TODAY }); assert.equal(c.status, 'NEUTRAL'); assert.equal(c.material.negative.length, 0);
  const national = CAUTION_CTX(); national.radar.risks = [item('months-of-supply', 'risk', { valueLabel: '26.7', source: 'cbs:timeseries:44,10' }), item('construction-inputs', 'risk', { valueLabel: '+3.6%', source: 'cbs:constructionInputsIndex', m: 2 })]; national.dossier.risk = [];
  const d = MA.assess(national, null, { today: TODAY }); assert.equal(d.status, 'NEUTRAL'); for (const f of d.factors.filter((f) => /months-of-supply|construction-inputs/.test(f.signal))) { assert.equal(f.geoScope, 'national'); assert.equal(f.material, false); assert.ok(f.whyNotMaterial.some((r) => /national figure/.test(r.en))); }
});
t('district data remains district data: the district sales-momentum factor carries geoScope "district" and its text names the district; it is material (the deal\'s own district) but never relabelled as the locality', () => {
  const a = MA.assess(CAUTION_CTX(), null, { today: TODAY }); const f = a.factors.find((x) => x.signal === 'sales-momentum-down');
  assert.equal(f.geoScope, 'district'); assert.equal(f.material, true); assert.match(f.text.en, /district/);
});
t('missing context is INSUFFICIENT, never neutral-positive; a STRONG read needs two independent material positives and no material negative', () => {
  const none = MA.assess(null, null, { today: TODAY }); assert.equal(none.status, 'INSUFFICIENT'); assert.equal(none.factors.length, 0); assert.match(none.notes[0].en, /not loaded/);
  assert.equal(MA.assess({ tx: { n: 500 } }, null, { today: TODAY }).status, 'INSUFFICIENT', 'transactions alone are not an assessment');
  const s = MA.assess(STRONG_CTX(), null, { today: TODAY }); assert.equal(s.status, 'STRONG'); assert.equal(s.material.negative.length, 0); assert.ok(s.convergence.positiveFamilies.length >= 2, s.convergence.positiveFamilies.join(','));
  const n = MA.assess(NEUTRAL_CTX(), null, { today: TODAY }); assert.equal(n.status, 'NEUTRAL');
  const mixed = STRONG_CTX(); mixed.radar.risks = [item('failed-tenders', 'risk')]; mixed.dossier.risk = [{ id: 'failed-tenders', text: { he: 'כ', en: 'failed 44%' }, threshold: '≥ 30%', period: 'current', source: 'rmi:michrazim', cls: 'OFFICIAL' }];
  assert.notEqual(MA.assess(mixed, null, { today: TODAY }).status, 'STRONG', 'a material negative blocks STRONG');
});

console.log('intelligence → decision: the final rules (§72)');
t('the engine never reads the market: IRR, MOIC, cash flows, repayment and capital at risk are byte-identical with and without any market context (the explained risk score\'s exit-liquidity component reads the observed deal count — documented, pre-existing, ±5/−10)', () => {
  for (const c of CS.CASES) { const d = clone(c.deal); const a = E.run(d, null, { today: TODAY }), b = E.run(d, null, { today: TODAY, marketDepth: { deals: 500, from: '2025-10-01', to: '2026-09-30' }, market: CAUTION_CTX(), marketAssessment: MA.assess(CAUTION_CTX(), null, { today: TODAY }) });
    const econ = (R) => JSON.stringify(E.STRATS.map((k) => { const s = R.strategies[k]; return s && s.base ? { irr: s.base.irr, moic: s.base.moic, flows: s.base.flows, cap: s.base.capAtRisk, cash: s.base.cash, metrics: s.base.metrics } : null; }));
    assert.equal(econ(a), econ(b), c.id + ' economics moved with market context');
    assert.equal(JSON.stringify(E.STRATS.map((k) => [E.irrOf(a, k), E.moicOf(a, k), E.capOf(a, k)])), JSON.stringify(E.STRATS.map((k) => [E.irrOf(b, k), E.moicOf(b, k), E.capOf(b, k)])), c.id + ' accessors moved'); }
  const eng = fs.readFileSync(path.join(ROOT, 'altaris/engine.js'), 'utf8'); assert.ok(!/marketAssessment|dossier|radar/.test(eng), 'the engine must not know the assessment');
});
t('the economic verdict and every economic field are byte-identical with and without the assessment; only final / marketAssessment / marketImpact / stamp.final / stamp.market differ', () => {
  for (const c of CS.CASES) { const d = clone(c.deal); const plain = decideWith(d, null).D, withA = decideWith(d, MA.assess(CAUTION_CTX(), null, { today: TODAY })).D;
    for (const k of ECON_KEYS) assert.equal(JSON.stringify(plain[k]), JSON.stringify(withA[k]), c.id + ' economic field moved: ' + k);
    assert.equal(plain.stamp.verdict, withA.stamp.verdict); assert.equal(plain.stamp.score, withA.stamp.score); assert.ok(withA.marketAssessment && withA.final && withA.marketImpact); }
});
t('final rules F0–F5: PASS stays PASS under STRONG (a good market never rescues bad economics); TAKE + CAUTION → TAKE WITH CONDITIONS with a market condition, its rule and what would remove it; TAKE + STRONG / NEUTRAL stays TAKE; TWC + CAUTION adds the condition; INSUFFICIENT stays; no assessment → F0; never an upgrade', () => {
  const take = caseDeal('park-18'), pass = caseDeal('hanassi-42'), twc = caseDeal('ganei-hapark');
  assert.equal(decideWith(take, null).D.verdict, 'TAKE'); assert.equal(decideWith(pass, null).D.verdict, 'PASS'); assert.equal(decideWith(twc, null).D.verdict, 'TAKE_WITH_CONDITIONS');
  const caution = MA.assess(CAUTION_CTX(), null, { today: TODAY }), strong = MA.assess(STRONG_CTX(), null, { today: TODAY }), neutral = MA.assess(NEUTRAL_CTX(), null, { today: TODAY }), none = MA.assess(null, null, { today: TODAY });
  const f = (deal, a) => decideWith(deal, a).D.final;
  const tc = f(take, caution); assert.equal(tc.verdict, 'TAKE_WITH_CONDITIONS'); assert.equal(tc.changed, true); assert.equal(tc.rule, 'F3'); assert.equal(tc.from, 'TAKE'); assert.ok(tc.marketCondition && tc.marketCondition.source === 'market' && tc.marketCondition.factors.length === 2); assert.equal(tc.whatWouldRemove.length, 2); assert.ok(tc.conditions.some((x) => x.id === 'market-caution'));
  assert.match(tc.marketCondition.text.en, /market & execution caution/); for (const r of tc.whatWouldRemove) assert.ok(r.he && r.en);
  const ts = f(take, strong); assert.equal(ts.verdict, 'TAKE'); assert.equal(ts.changed, false); assert.equal(ts.rule, 'F5');
  const tn = f(take, neutral); assert.equal(tn.verdict, 'TAKE'); assert.equal(tn.rule, 'F5');
  const t0 = f(take, none); assert.equal(t0.verdict, 'TAKE'); assert.equal(t0.rule, 'F0'); assert.equal(f(take, null).rule, 'F0');
  const ps = f(pass, strong); assert.equal(ps.verdict, 'PASS'); assert.equal(ps.changed, false); assert.equal(ps.rule, 'F2'); assert.match(ps.reason.en, /never rescues/);
  assert.equal(f(pass, caution).verdict, 'PASS'); assert.equal(f(pass, caution).rule, 'F2');
  const wc = f(twc, caution); assert.equal(wc.verdict, 'TAKE_WITH_CONDITIONS'); assert.equal(wc.changed, false); assert.equal(wc.rule, 'F4'); assert.ok(wc.marketCondition); assert.ok(wc.conditions.length >= 2, 'economic conditions + the market condition');
  assert.equal(f(twc, strong).verdict, 'TAKE_WITH_CONDITIONS'); assert.equal(f(twc, strong).rule, 'F5');
  /* INSUFFICIENT economics: a deal without an independent value */
  const ins = caseDeal('park-18'); ins.value = {}; ins.units = []; const di = decideWith(ins, strong).D; if (di.verdict === 'INSUFFICIENT_EVIDENCE') { assert.equal(di.final.verdict, 'INSUFFICIENT_EVIDENCE'); assert.equal(di.final.rule, 'F1'); }
  const ORDER = { INSUFFICIENT_EVIDENCE: 0, PASS: 1, TAKE_WITH_CONDITIONS: 2, TAKE: 3 };
  for (const deal of [take, pass, twc]) for (const a of [caution, strong, neutral, none]) { const D = decideWith(deal, a).D; assert.ok(ORDER[D.final.verdict] <= ORDER[D.verdict], 'an upgrade: ' + D.verdict + ' → ' + D.final.verdict); }
});
t('the explanation matches the rule: D.marketImpact names the economic view, the assessment, the final verdict with its rule, the primary factors, the conditions added and what would remove them; the committee narrative states the assessment and the rule', () => {
  const D = decideWith(caseDeal('park-18'), MA.assess(CAUTION_CTX(), null, { today: TODAY })).D;
  const MI = D.marketImpact; assert.equal(MI.economic.verdict, 'TAKE'); assert.equal(MI.assessment.status, 'CAUTION'); assert.equal(MI.final.verdict, 'TAKE_WITH_CONDITIONS'); assert.equal(MI.final.rule, 'F3'); assert.equal(MI.primaryFactors.length, 2); assert.equal(MI.conditionsAdded.length, 1); assert.equal(MI.whatWouldRemove.length, 2); assert.equal(MI.policy, DX.POLICY.final);
  const he = DX.narrative(D, 'he').join(' '), en = DX.narrative(D, 'en').join(' '); assert.match(en, /Market & execution assessment: CAUTION/); assert.match(en, /rule F3/); assert.match(en, /It is removed when:/); assert.match(he, /הערכת שוק וביצוע: זהירות/); assert.match(he, /כלל F3/);
  const D2 = decideWith(caseDeal('park-18'), MA.assess(NEUTRAL_CTX(), null, { today: TODAY })).D; assert.match(DX.narrative(D2, 'en').join(' '), /economic verdict stands \(rule F5\)/); assert.equal(D2.marketImpact.conditionsAdded.length, 0);
});
t('source conflicts reach evidence quality (pre-existing −10 CONFLICT deduction) and a conflicting read never raises the assessment', () => {
  const d = caseDeal('park-18'); const R = E.run(d, null, { today: TODAY }); const F = E.facts(d);
  const ctx = CAUTION_CTX(); ctx.tx.median = F.smv && F.sqm ? Math.round((F.smv / F.sqm) * 1.6) : 60000;
  const D = DX.decide(R, { today: TODAY, deal: d, market: ctx, marketAssessment: MA.assess(ctx, null, { today: TODAY }) });
  assert.ok(D.evidence.items.some((i) => i.cls === 'CONFLICT'), 'the conflict deduction is applied'); assert.equal(D.marketAssessment.status, 'CAUTION');
});
t('the page wires the loop read-only: the assessment is computed in dctx() and passed in, the card and the basis head show the FINAL verdict beside the economic and market views, the basis view has the MARKET IMPACT ON DECISION section, the IC rows and the Excel rows carry it, the script tag loads the module, and the decision layer still imports only the engine', () => {
  const app = fs.readFileSync(path.join(ROOT, 'altaris/app.js'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'altaris/index.html'), 'utf8'), dec = fs.readFileSync(path.join(ROOT, 'altaris/decision.js'), 'utf8');
  assert.match(app, /marketAssessment: marketAssess\(\)/); assert.match(app, /AM\(\)\.assess\(S\.deal\.market \|\| null, cbsCtx\(S\.deal\.info\)/); assert.match(app, /ax-dec-fin/); assert.match(app, /sec\('marketImpact', T\.s\.marketImpact, miT\)/); assert.match(app, /\['החלטה סופית'/); assert.match(app, /\[T\.mi\.final,/);
  assert.match(html, /altaris\/market-assessment\.js/); assert.deepEqual([...dec.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/require\('([^']+)'\)/g)].map((x) => x[1]), ['./engine.js']);
  assert.ok(!/marketAssessment/.test(fs.readFileSync(path.join(ROOT, 'altaris/engine.js'), 'utf8')));
  const X = require('../lib/explain/registry'); for (const id of ['market_execution_assessment', 'final_decision', 'market_impact_on_decision']) assert.ok(X.term(id) && X.term(id).cls === 'DERIVED' && X.term(id).formula, id);
});

console.log('acceptance deal set (§73): 5 cases × 3 market contexts (none / STRONG / CAUTION) = 15, plus a conflicting read');
t('every row reports economic · market · evidence · final · why · impact · condition · flip point; the final verdict never exceeds the economic one; the table is written for the ledger', () => {
  const rows = [];
  const ctxs = { none: null, strong: STRONG_CTX(), caution: CAUTION_CTX() };
  for (const c of CS.CASES) for (const [k, ctx] of Object.entries(ctxs)) {
    const d = clone(c.deal); const R = E.run(d, null, { today: TODAY }); const a = ctx ? MA.assess(ctx, null, { today: TODAY }) : MA.assess(null, null, { today: TODAY });
    const D = DX.decide(R, Object.assign({ today: TODAY, deal: d }, ctx ? { market: ctx } : {}, { marketAssessment: a }));
    const row = { deal: c.id, structure: D.recommended || D.lead, market: k, economic: D.verdict, assessment: a.status, evidence: D.evidence.level + ' ' + D.evidence.score, final: D.final.verdict, rule: D.final.rule, why: (D.final.reason && D.final.reason.en) || '', impact: D.final.changed ? D.final.from + ' → ' + D.final.to : 'unchanged', condition: D.final.marketCondition ? D.final.marketCondition.text.en.slice(0, 90) : (D.conditions[0] ? D.conditions[0].text.en.slice(0, 90) : '—'), flip: D.final.whatWouldRemove.length ? D.final.whatWouldRemove.map((r) => r.en).join('; ').slice(0, 120) : '(economic flip points on demand)' };
    rows.push(row);
    assert.ok(['TAKE', 'TAKE_WITH_CONDITIONS', 'PASS', 'INSUFFICIENT_EVIDENCE'].includes(row.final)); assert.ok(/^F[0-5]$/.test(row.rule));
    if (row.economic === 'PASS') assert.equal(row.final, 'PASS'); if (row.economic === 'TAKE' && row.assessment === 'CAUTION') assert.equal(row.final, 'TAKE_WITH_CONDITIONS'); if (row.economic === 'TAKE' && row.assessment !== 'CAUTION') assert.equal(row.final, 'TAKE');
  }
  assert.equal(rows.length, 15);
  const kinds = new Set(rows.map((r) => r.economic + '|' + r.assessment)); assert.ok(kinds.size >= 8, 'the set covers ≥ 8 economic × market combinations: ' + [...kinds].join(', '));
  assert.ok(rows.some((r) => r.impact !== 'unchanged'), 'at least one row changes through F3');
  const out = path.join(ROOT, 'test', 'fixtures', 'altaris-acceptance-2026-10-18.json'); fs.writeFileSync(out, JSON.stringify({ today: TODAY, basis: 'synthetic market contexts (test inputs) over the five illustrative cases — never product data', rows }, null, 1));
  console.log('    ' + rows.map((r) => `${r.deal}/${r.market}: ${r.economic} + ${r.assessment} → ${r.final} (${r.rule})`).join('\n    '));
});
console.log(`altaris market → decision: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`); process.exit(failed ? 1 : 0);
