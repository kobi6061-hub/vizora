'use strict';
/* ALTARIS · LIVE THESIS (altaris/thesis.js) — the gates and the acceptance cases, 18.10.2026.
 *
 * What these gates prove: the decision snapshot is immutable (hashed, frozen, refused on rewrite); a market update never changes
 * IRR, MOIC, capital at risk, cash flows, gates or the economic verdict (they are frozen in the snapshot — only a re-underwrite,
 * a new version, recomputes them); the same evidence and the same rules give the same thesis result; an irrelevant market change
 * creates no decision delta; a material relevant change creates the documented delta through rules F3 / F4 / F5 only; a condition
 * is resolved only by its documented rule and never disappears because data is missing or stale; weak evidence never creates a
 * strong outcome; a stale read never masquerades as current; a source conflict is preserved on both values; a revision keeps the
 * original beside the revised value; then-vs-now and the retrospective answer are historically correct; next-best-evidence ranking
 * and the portfolio attention order are deterministic; the module has no Supabase, DOM, storage, network or clock dependency; the
 * saved-deal flow and every existing ALTARIS output are untouched (engine hash + baseline unchanged by the sibling suites). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../altaris/engine.js');
const DX = require('../altaris/decision.js');
const MA = require('../altaris/market-assessment.js');
const CS = require('../altaris/cases.js');
const TH = require('../altaris/thesis.js');
const X = require('../lib/explain/registry');
const ROOT = path.join(__dirname, '..');
const SRC = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TODAY = '2026-10-18', LATER = '2026-10-25', FRESH = '2026-10-17T20:00:00Z', FRESH2 = '2026-10-24T20:00:00Z';
const clone = (o) => JSON.parse(JSON.stringify(o));
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); } };
const caseDeal = (id) => clone(CS.CASES.find((c) => c.id === id).deal);

/* ---- synthetic market contexts shaped exactly as the ALTARIS page keeps deal.market (TEST INPUTS — never product data) ---- */
const item = (signal, kind, over) => Object.assign({ id: signal, signal, text: { he: 'אות ' + signal, en: 'signal ' + signal }, valueLabel: '44%', threshold: '≥ 30%', comparison: { he: 'ארצי: 18%', en: 'national: 18%' }, period: 'current scope', source: 'rmi:michrazim', cls: 'OFFICIAL', evidence: { level: 'HIGH', score: 76 }, m: 3, derived: false }, over || {});
const momentumDown = { id: 'sales-momentum-down', text: { he: 'מומנטום המחוז −10.5%', en: 'district momentum −10.5%' }, threshold: '≤ −10%', period: '2026-08', source: 'cbs:timeseries:44,10', cls: 'OFFICIAL' };
const momentumUp = { id: 'sales-momentum-up', text: { he: 'מומנטום המחוז +32%', en: 'district momentum +32%' }, threshold: '≥ +10%', period: '2026-08', source: 'cbs:timeseries:44,10', cls: 'OFFICIAL' };
const dossierOf = (risk, watch, at, over) => Object.assign({ geo: { level: 'locality', code: '7900', name: { he: 'פתח תקווה', en: 'Petah Tiqwa' } }, quality: { level: 'HIGH', score: 76, items: [] }, risk: clone(risk || []), watch: clone(watch || []), missing: ['מלאי: ארצי בלבד'], missingEn: ['inventory: national only'], missingIds: ['inventory'], salesScope: 'district', generatedAt: at || FRESH, narrative: [], landEconomics: null }, over || {});   // items cloned: a gate may mutate its own read, never the shared constants
const base = (at) => ({ retrievedAt: at || FRESH, city: 'פתח תקווה', cityCode: '7900', street: null, tx: { n: 57, newN: 12, median: 30000, newMedian: 31000, from: '2025-10-01', to: '2026-09-30', via: 'over.org.il' }, land: { tenders: 12, unitsOpen: 400, unitsAwarded: 1545, unitsPendingDecision: 120 }, housing: { lotteries: 3, projects: 2, units: 300 },
  pipeline: { total: 9, stageCounts: { awarded: 5, lottery: 4 }, recent: [] }, rental: { tenders: 2, tenderUnits: 240, withNotice: 1, checkedAt: at || FRESH }, entries: { total: 1 }, devIntel: { id: 'dev-1', name: 'אורון מגורים', lots: 4, units: 320, lastWin: '2026-03-02', projects: 1, lotteryUnits: 120, lastLottery: '2025-11-11', cities: 2, construction: { buildings: 3, started: 2, completed: 1, asOf: '2026-06-30' }, possibleSame: 0 } });
const NEUTRAL = (at) => Object.assign(base(at), { dossier: dossierOf([], [item('open-land', 'opportunity', { m: 2 })], at), radar: { opportunities: [item('open-land', 'opportunity', { m: 2 })], risks: [], builtAt: at || FRESH, served: 'file' } });
const CAUTION = (at) => Object.assign(base(at), { dossier: dossierOf([momentumDown], [], at), radar: { opportunities: [item('open-land', 'opportunity', { valueLabel: '1,893', m: 2 })], risks: [item('failed-tenders', 'risk')], builtAt: at || FRESH, served: 'file' } });
const STRONG = (at) => Object.assign(base(at), { tx: Object.assign(base().tx, { n: 160 }), dossier: dossierOf([], [momentumUp], at), radar: { opportunities: [item('developer-entries', 'opportunity', { valueLabel: '5', source: 'lib/entities', cls: 'OBSERVED', m: 2 })], risks: [], builtAt: at || FRESH, served: 'file' } });
const ONE_NEG = (at) => { const m = NEUTRAL(at); m.radar.risks = [item('failed-tenders', 'risk')]; return m; };
const WEAK_NEG = (at) => { const m = NEUTRAL(at); m.radar.risks = [item('failed-tenders', 'risk', { evidence: { level: 'LOW', score: 20 } })]; return m; };
const CBS = (over) => Object.assign({ ok: true, level: 'district', code: 'd-center', scope: { he: 'מחוז המרכז', en: 'Central district' }, momentum: -3.2, small: false, latest: '2026-08', freshness: 'CURRENT', sourceUpdate: '2026-10-07', checkedAt: '2026-10-15T06:00:00Z', inventory: 61000, inventoryPeriod: '2026-07' }, over || {});

/* a decided deal → its snapshot (the page's own flow: run → assess → decide → snapshot) */
function decided(id, market, opt) {
  opt = opt || {};
  const deal = caseDeal(id); deal.market = market === undefined ? NEUTRAL() : market; if (opt.deal) opt.deal(deal);
  const settings = opt.settings || null;
  const R = E.run(deal, settings, { today: opt.today || TODAY });
  const cbs = opt.cbs === undefined ? CBS() : opt.cbs;
  const ma = MA.assess(deal.market, cbs, { today: opt.today || TODAY });
  const ctx = { today: opt.today || TODAY, deal, market: deal.market, cbs, indicators: opt.indicators || { boiRate: { value: 4.5, publishedAt: '2026-09-01' } }, marketAssessment: ma };
  const D = DX.decide(R, ctx);
  if (opt.flips) D.flips = DX.flips(R, ctx, { run: (d) => E.run(d, settings, { today: opt.today || TODAY }), decision: D });
  const snap = TH.snapshot({ D, R, deal, ctx, meta: { dealId: opt.dealId || id, versionN: opt.versionN || 1, savedAt: '2026-10-18T10:00:00Z', basis: opt.basis || 'DECISION_SAVE', stamp: D.stamp, settings } });
  return { deal, R, D, snap, settings };
}
const now = (snap, market, over) => Object.assign({ today: LATER, market, cbs: CBS(), indicators: { boiRate: { value: 4.5, publishedAt: '2026-09-01' } }, dealHash: snap.assumptions.dealHash, settingsHash: snap.assumptions.settingsHash }, over || {});
const ECON = (snap) => JSON.stringify({ e: snap.economic, a: snap.assumptions, c: snap.conditions.filter((c) => c.source !== 'market'), f: snap.flips });

console.log('live thesis: module');
t('pure, isolated, versioned: no DOM / storage / network / clock / randomness / Supabase; imports only the decision layer and the assessment (never the engine); UMD', () => {
  const src = SRC('altaris/thesis.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/document\.|window\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest|Math\.random|Date\.now\(\)|new Date\(|supabase|SUPABASE|process\.env/i.test(src.replace(/root\.AltarisThesis/g, '')), 'impure or coupled code');
  assert.ok(!/require\('\.\/engine/.test(src) && !/AltarisEngine/.test(src), 'the thesis layer must not touch the engine');
  assert.ok(!/xirr|cashflow|cashFlows|\.flows\b/i.test(src), 'no return arithmetic');
  assert.equal(TH.VERSION.id, 'altaris-live-thesis-v1'); assert.equal(TH.VERSION.decision, DX.VERSION.id); assert.equal(TH.VERSION.market, MA.VERSION.id);
  assert.deepEqual(Object.keys(TH.DELTA), ['NO_MATERIAL_THESIS_CHANGE', 'THESIS_STRENGTHENED', 'CONDITION_RESOLVED', 'NEW_CONDITION_TRIGGERED', 'THESIS_WEAKENED', 'DECISION_REQUIRES_REVIEW', 'INSUFFICIENT_NEW_EVIDENCE', 'DEAL_CHANGED']);
  assert.deepEqual(Object.keys(TH.CATEGORY), ['DEAL_ASSUMPTION', 'MARKET_EVIDENCE', 'PROJECT_EXECUTION', 'DEVELOPER', 'SOURCE_EVIDENCE', 'MACRO', 'GEOGRAPHY']);
  for (const [id, r] of Object.entries(TH.RULES)) { assert.ok(TH.CATEGORY[r.category], id); assert.ok(TH.MATERIALITY[r.materiality], id); assert.ok(r.rule.he && r.rule.en, id); assert.ok(X.SIGNAL_RULES[id], 'registry rule missing for ' + id); }
  assert.ok(typeof DX.finalOf === 'function', 'decision.js exports finalOf (additively)');
  const m = SRC('altaris/decision.js'); assert.ok(m.includes('finalOf, t: T, fmtV'), 'finalOf exported');
});
t('no recommendation, prediction or performance wording anywhere in the module\'s copy, rules and labels', () => {
  const txt = JSON.stringify([TH.COPY, TH.RULES, TH.STATUS, TH.DELTA, TH.IMPACT, TH.RELEVANCE, TH.ATTENTION, TH.RESOLVES_BY, TH.EV_DEDUCTIONS]);
  assert.ok(!/will succeed|prices will rise|will fail|you should sell|will crash|great investment|guaranteed|probabilit|forecast(?!,)/i.test(txt.replace(/not a forecast|does not predict|not a probability|never guaranteed|אינה חוזה|לא הסתברות|לא תחזית|אין ערובה/g, '')), txt.match(/will succeed|prices will rise|will fail|you should sell|will crash|great investment|guaranteed|probabilit|forecast/i));
  for (const k of ['tagline', 'title', 'cta', 'ctaBody', 'whatQ', 'whatA', 'automatic', 'limitation', 'reassessVsReunderwrite', 'disclaimer']) assert.ok(TH.COPY[k].he && TH.COPY[k].en, k);
  assert.equal(TH.COPY.tagline.en, 'PROPX remembers why you made the decision — and tells you when the facts behind it materially change.');
  assert.equal(TH.COPY.title.en, 'Your decision should not stop learning when you press TAKE.');
  assert.equal(TH.COPY.always.length, 6);
});

console.log('live thesis: the decision snapshot');
t('a snapshot is normalized facts only (never a rendered page): economics, gates, conditions, flips, market factors, sources, freshness, missing, rules fired — deep-frozen, hashed, verifiable', () => {
  const { snap, D } = decided('park-18', NEUTRAL(), { flips: true });
  assert.equal(snap.schema, 'altaris-decision-snapshot-v1'); assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.economic.structures) && Object.isFrozen(snap.market.factors));
  assert.ok(!/<[a-z!\/]/i.test(JSON.stringify(snap)), 'no markup');
  assert.equal(snap.final.verdict, D.final.verdict); assert.equal(snap.economic.verdict, D.verdict); assert.equal(snap.economic.structures[D.lead].irr, D.structures[D.lead].irr); assert.equal(snap.economic.structures[D.lead].moic, D.structures[D.lead].moic); assert.equal(snap.economic.structures[D.lead].capitalAtRisk, D.structures[D.lead].capital);
  assert.ok(snap.economic.structures[D.lead].gates.length >= 9 && snap.economic.structures[D.lead].gates.every((g) => g.id && g.status));
  assert.ok(Array.isArray(snap.flips) && snap.flips.length && snap.flips[0].text.en, 'flip points stored when computed');
  assert.ok(snap.market.factors.length >= 3 && snap.market.factors.every((f) => f.id && f.dimension && f.direction));
  assert.equal(snap.context.market.retrievedAt, FRESH); assert.equal(snap.context.cbs.level, 'district'); assert.equal(snap.context.cbs.code, 'd-center');
  assert.ok(snap.rulesFired.final === 'F5' || snap.rulesFired.final === 'F0'); assert.ok(Array.isArray(snap.rulesFired.evidenceDeductions));
  assert.equal(snap.decidedAt, TODAY); assert.equal(snap.basis, 'DECISION_SAVE'); assert.equal(snap.stampAtSave.verdict, D.stamp.verdict);
  assert.match(snap.hash, /^[0-9a-f]{16}-[0-9a-z]+$/); assert.ok(TH.verify(snap).ok);
  for (const id of snap.registry) assert.ok(X.term(id), 'registry term ' + id);
});
t('the snapshot is immutable: a mutation attempt throws in strict mode and the hash no longer verifies; two snapshots of the same decision are identical; a different decision has a different hash', () => {
  const a = decided('park-18', NEUTRAL()).snap, b = decided('park-18', NEUTRAL()).snap, c = decided('park-18', CAUTION()).snap;
  assert.equal(a.hash, b.hash); assert.notEqual(a.hash, c.hash);
  assert.throws(() => { 'use strict'; a.final.verdict = 'PASS'; }, /read only|Cannot assign/);
  const tampered = JSON.parse(JSON.stringify(a)); tampered.economic.structures[tampered.economic.lead].irr = 0.99; assert.equal(TH.verify(tampered).ok, false);
});
t('the original decision cannot be silently rewritten: the repository refuses a different snapshot for the same saved version, appends a re-underwrite as a new version with the previous hash, and never mutates stored versions', () => {
  const repo = TH.createRepository(TH.memoryAdapter());
  const A = decided('park-18', NEUTRAL()), C = TH.contract(A.snap), N = TH.nextBestEvidence(A.snap), W = TH.watchlist(A.snap, C);
  assert.equal(repo.init('d1', A.snap, { contract: C, watch: W, nbe: N }, { at: '2026-10-18T10:00:00Z' }).action, 'created');
  assert.equal(repo.init('d1', A.snap, { contract: C, watch: W, nbe: N }).action, 'unchanged');
  const forged = decided('park-18', CAUTION()).snap;   // same version n, same deal hash — a different decision snapshot
  const r = repo.init('d1', forged, { contract: C, watch: W, nbe: N }); assert.equal(r.action, 'refused'); assert.match(r.reason, /immutable/);
  assert.equal(repo.get('d1').versions.length, 1); assert.equal(repo.get('d1').versions[0].hash, A.snap.hash);
  const B = decided('park-18', NEUTRAL(), { deal: (d) => { d.hybrid.couponPct = 6; }, versionN: 2 });   // the user changed an assumption → version 2
  assert.notEqual(B.snap.assumptions.dealHash, A.snap.assumptions.dealHash);
  const r2 = repo.init('d1', B.snap, { contract: TH.contract(B.snap), watch: W, nbe: N }, { at: '2026-10-20T10:00:00Z' }); assert.equal(r2.action, 'appended');
  const rec = repo.get('d1'); assert.equal(rec.versions.length, 2); assert.equal(rec.versions[0].hash, A.snap.hash); assert.equal(rec.events[1].kind, 'REUNDERWRITE'); assert.equal(r2.kind, 'REUNDERWRITE'); assert.equal(rec.events[1].previousHash, A.snap.hash);
  /* the same assumptions decided again (the market context loaded after the first save) → a REDECIDE version, the original kept */
  const M2 = decided('park-18', CAUTION(), { deal: (d) => { d.hybrid.couponPct = 6; }, versionN: 3 }); const r3 = repo.init('d1', M2.snap, { contract: TH.contract(M2.snap), watch: W, nbe: N }, { at: '2026-10-21T10:00:00Z' }); assert.equal(r3.action, 'appended'); assert.equal(r3.kind, 'REDECIDE'); assert.equal(repo.get('d1').versions.length, 3); assert.equal(repo.get('d1').versions[0].hash, A.snap.hash);
  assert.ok(repo.integrity('d1').every((v) => v.ok));
  const got = repo.get('d1'); got.versions[0].snapshot.final.verdict = 'PASS'; assert.equal(repo.get('d1').versions[0].snapshot.final.verdict, A.snap.final.verdict, 'reads are copies');
});
t('reconstruction gate: stampMatches is true only when verdict, final, structure, evidence level and score equal the stamp saved with the version', () => {
  const { D } = decided('park-18', NEUTRAL());
  assert.ok(TH.stampMatches(D, D.stamp)); assert.ok(!TH.stampMatches(D, Object.assign({}, D.stamp, { final: 'PASS' }))); assert.ok(!TH.stampMatches(D, Object.assign({}, D.stamp, { score: (D.stamp.score || 0) + 1 }))); assert.ok(!TH.stampMatches(D, null));
  assert.equal(TH.BASIS.BASELINE_TODAY.en, 'BASELINE CREATED TODAY — no trustworthy historical decision snapshot existed');
});

console.log('live thesis: economics immutable to market data');
t('a market update cannot change IRR, MOIC, capital at risk, gates, cash-flow-derived figures, the economic verdict, the economic conditions or the flip points: every reassessment leaves the snapshot byte-identical and reads its economics frozen', () => {
  const A = decided('park-18', NEUTRAL(), { flips: true }); const before = ECON(A.snap), h = A.snap.hash;
  for (const m of [CAUTION(FRESH2), STRONG(FRESH2), ONE_NEG(FRESH2), WEAK_NEG(FRESH2), null]) { const r = TH.reassess(A.snap, now(A.snap, m)); assert.equal(ECON(A.snap), before); assert.equal(A.snap.hash, h); if (r.current) { assert.equal(r.current.economic, A.snap.economic.verdict); assert.equal(r.current.evidence, A.snap.economic.evidence.level); } assert.ok(r.thenVsNow.whatDidNotChange.some((x) => /^IRR/.test(x.en)) && r.thenVsNow.whatDidNotChange.some((x) => /^MOIC/.test(x.en)) && r.thenVsNow.whatDidNotChange.some((x) => /capital at risk/.test(x.en))); }
});
t('a user assumption change is not a reassessment: the delta is DEAL_CHANGED (rule TH-DEAL) and the page path creates a new underwriting version; fund-settings changes are noted, never applied to the frozen economics', () => {
  const A = decided('park-18', NEUTRAL());
  const r = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { dealHash: 'changed' })); assert.equal(r.state, 'DEAL_CHANGED'); assert.equal(r.rule, 'TH-DEAL'); assert.equal(r.current, null); assert.equal(r.attention.key, 'DEAL_CHANGED');
  const s = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { settingsHash: 'other' })); assert.ok(s.changes.some((c) => c.rule === 'TH-SETTINGS' && c.materiality === 'INFORMATIONAL')); assert.equal(s.state, 'NO_MATERIAL_THESIS_CHANGE');
});
t('determinism: the same evidence and the same rules give the same thesis result (snapshot, contract, next-best evidence, watchlist, delta, portfolio) — twice', () => {
  const A = decided('ganei-hapark', NEUTRAL()), B = decided('ganei-hapark', NEUTRAL());
  assert.equal(JSON.stringify(TH.contract(A.snap)), JSON.stringify(TH.contract(B.snap))); assert.equal(JSON.stringify(TH.nextBestEvidence(A.snap)), JSON.stringify(TH.nextBestEvidence(B.snap))); assert.equal(JSON.stringify(TH.watchlist(A.snap)), JSON.stringify(TH.watchlist(B.snap)));
  const r1 = TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2))), r2 = TH.reassess(B.snap, now(B.snap, CAUTION(FRESH2))); assert.equal(JSON.stringify(r1), JSON.stringify(r2));
  const list = [{ dealId: 'a', snapshot: A.snap, nbe: TH.nextBestEvidence(A.snap), lastCheck: r1 }, { dealId: 'b', snapshot: B.snap, nbe: TH.nextBestEvidence(B.snap), lastCheck: null }];
  assert.equal(JSON.stringify(TH.portfolio(list)), JSON.stringify(TH.portfolio(list.slice().reverse())));
});

console.log('live thesis: the decision delta');
t('an irrelevant market change creates no decision delta: a count / informational factor moving, a transaction-window shift, a macro tick, a developer activity change → NO MATERIAL THESIS CHANGE, every item INFORMATIONAL, decision impact NONE', () => {
  const A = decided('park-18', NEUTRAL());
  const m = NEUTRAL(FRESH2); m.radar.opportunities[0].valueLabel = '2,140'; m.tx.n = 61; m.tx.to = '2026-10-20'; m.devIntel.lots = 5;
  const r = TH.reassess(A.snap, now(A.snap, m, { indicators: { boiRate: { value: 4.25, publishedAt: '2026-10-20' } } }));
  assert.equal(r.state, 'NO_MATERIAL_THESIS_CHANGE'); assert.equal(r.current.verdict, A.snap.final.verdict); assert.equal(r.materiality, 'INFORMATIONAL');
  assert.ok(r.changes.length >= 3 && r.changes.every((c) => c.materiality === 'INFORMATIONAL' && c.impact === 'NONE'), JSON.stringify(r.changes.map((c) => [c.id, c.materiality, c.impact])));
  assert.ok(r.changes.some((c) => c.category === 'MACRO') && r.changes.some((c) => c.category === 'DEVELOPER') && r.changes.some((c) => c.category === 'MARKET_EVIDENCE'));
  assert.equal(r.attention.key, 'NEW_INFORMATION'); assert.equal(r.retrospective.answer, 'NO'); assert.deepEqual(r.conditions.resolved, []); assert.deepEqual(r.conditions.added, []);
});
t('a material relevant change creates the correct delta: TAKE + a later CAUTION read → DECISION REQUIRES REVIEW, rule TH-F3, the market condition added, current decision TAKE WITH CONDITIONS, retrospective YES (F3)', () => {
  const A = decided('park-18', NEUTRAL()); assert.equal(A.snap.final.verdict, 'TAKE');
  const r = TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2)));
  assert.equal(r.state, 'DECISION_REQUIRES_REVIEW'); assert.equal(r.status, 'REVIEW_REQUIRED'); assert.equal(r.materiality, 'DECISION_IMPACTING'); assert.equal(r.rule, 'TH-F3');
  assert.equal(r.current.verdict, 'TAKE_WITH_CONDITIONS'); assert.equal(r.current.rule, 'F3'); assert.equal(r.conditions.added.length, 1); assert.equal(r.conditions.added[0].id, 'market-caution');
  assert.ok(r.changes.find((c) => c.id === 'verdict' && c.impact === 'VERDICT_CHANGED' && c.from === 'TAKE' && c.to === 'TAKE_WITH_CONDITIONS'));
  assert.equal(r.retrospective.answer, 'YES'); assert.equal(r.retrospective.rule, 'F3'); assert.ok(r.retrospective.facts.length >= 2);
  assert.match(r.narrative[0].en, /would be TAKE WITH CONDITIONS instead of TAKE \(rule F3\)/); assert.match(r.narrative[0].en, /economics, IRR and capital at risk are unchanged/);
  assert.equal(r.attention.key, 'DECISION_REQUIRES_REVIEW');
});
t('a condition can be resolved only by documented evidence / rule: TAKE WITH CONDITIONS (F3) + a later NEUTRAL read → CONDITION RESOLVED (rule TH-F5-RESOLVE), current decision TAKE (F5); an economic condition never resolves on a market read', () => {
  const B = decided('park-18', CAUTION()); assert.equal(B.snap.final.verdict, 'TAKE_WITH_CONDITIONS'); assert.equal(B.snap.final.rule, 'F3');
  const r = TH.reassess(B.snap, now(B.snap, NEUTRAL(FRESH2)));
  assert.equal(r.state, 'CONDITION_RESOLVED'); assert.equal(r.current.verdict, 'TAKE'); assert.equal(r.current.rule, 'F5'); assert.deepEqual(r.conditions.resolved.map((c) => c.id), ['market-caution']); assert.equal(r.retrospective.answer, 'YES');
  assert.match(r.narrative[0].en, /resolves the market condition that was open at decision time/); assert.match(r.narrative[0].en, /Core economics are unchanged/);
  const G = decided('ganei-hapark', NEUTRAL()); assert.ok(G.snap.conditions.some((c) => c.id === 'irr'));   // economic conditions
  const g = TH.reassess(G.snap, now(G.snap, STRONG(FRESH2))); assert.ok(g.conditions.active.some((c) => c.id === 'irr'), 'the economic condition stays whatever the market does'); assert.deepEqual(g.conditions.resolved, []); assert.equal(g.current.verdict, 'TAKE_WITH_CONDITIONS');
});
t('a condition cannot disappear because data is missing: TAKE WITH CONDITIONS (F3) + no new read / a read without dossier and radar → INSUFFICIENT NEW EVIDENCE, the market condition stays, the decision stays, the status is kept', () => {
  const B = decided('park-18', CAUTION());
  for (const m of [null, Object.assign(base(FRESH2), { dossier: null, radar: null })]) { const r = TH.reassess(B.snap, now(B.snap, m)); assert.equal(r.state, 'INSUFFICIENT_NEW_EVIDENCE'); assert.equal(r.rule, m ? 'TH-PARTIAL' : 'TH-NOREAD'); assert.equal(r.status, null); assert.equal(r.current.verdict, 'TAKE_WITH_CONDITIONS'); assert.ok(r.current.conditions.some((c) => c.id === 'market-caution')); assert.equal(r.retrospective.answer, 'CANNOT_DETERMINE'); assert.match(r.narrative[0].en, /absence of evidence is not positive evidence/i); }
});
t('weak evidence cannot create a strong override: a LOW-evidence negative, a DERIVED negative or a national figure never adds a condition or moves the verdict; one material negative alone is THESIS WEAKENED with no decision impact', () => {
  const A = decided('park-18', NEUTRAL());
  const w = TH.reassess(A.snap, now(A.snap, WEAK_NEG(FRESH2))); assert.equal(w.state, 'NO_MATERIAL_THESIS_CHANGE'); assert.equal(w.current.verdict, 'TAKE'); assert.ok(w.changes.every((c) => c.materiality === 'INFORMATIONAL'));
  const d = NEUTRAL(FRESH2); d.radar.risks = [item('failed-tenders', 'risk', { cls: 'DERIVED' }), item('months-of-supply', 'risk', { source: 'cbs:timeseries:44,10' })]; const dr = TH.reassess(A.snap, now(A.snap, d)); assert.equal(dr.current.verdict, 'TAKE'); assert.deepEqual(dr.conditions.added, []);
  const o = TH.reassess(A.snap, now(A.snap, ONE_NEG(FRESH2))); assert.equal(o.state, 'THESIS_WEAKENED'); assert.equal(o.current.verdict, 'TAKE'); assert.deepEqual(o.conditions.added, []); assert.equal(o.materiality, 'RELEVANT'); assert.match(o.narrative[0].en, /Alone it does not move the assessment/);
});
t('stale evidence cannot masquerade as current: a new read older than 30 days → INSUFFICIENT NEW EVIDENCE (its factors never resolve or add a condition); the decision\'s own read older than 90 days → EVIDENCE AGING (rule TH-AGING), reported as aging, never as a negative signal', () => {
  const B = decided('park-18', CAUTION());
  const stale = NEUTRAL('2026-08-20T00:00:00Z'); const r = TH.reassess(B.snap, now(B.snap, stale)); assert.equal(r.state, 'INSUFFICIENT_NEW_EVIDENCE'); assert.ok(r.current.conditions.some((c) => c.id === 'market-caution'), 'a stale NEUTRAL read must not resolve the condition'); assert.match(r.changes[0].text.en, /older than 30 days/);
  const A = decided('park-18', NEUTRAL()); const a = TH.reassess(A.snap, now(A.snap, NEUTRAL('2027-02-10T00:00:00Z'), { today: '2027-02-12' }));
  const ag = a.changes.find((c) => c.rule === 'TH-AGING'); assert.ok(ag && ag.category === 'SOURCE_EVIDENCE' && ag.impact === 'EVIDENCE' && ag.materiality === 'RELEVANT'); assert.equal(a.state, 'NO_MATERIAL_THESIS_CHANGE'); assert.equal(a.attention.key, 'NEW_INFORMATION', 'aging alone never parks a deal in the sources bucket'); assert.match(a.narrative.map((p) => p.en).join(' '), /evidence aging, not a negative signal/);
});
t('a source that turns STALE is "source stale", not a new negative; a recovered source is noted; a CBS period / value move is informational', () => {
  const A = decided('park-18', NEUTRAL());
  const s = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { cbs: CBS({ freshness: 'STALE', latest: '2026-09', momentum: -8.1 }) }));
  const st = s.changes.find((c) => c.rule === 'TH-SOURCE-STALE'); assert.ok(st && st.category === 'SOURCE_EVIDENCE' && st.materiality === 'RELEVANT' && st.impact === 'EVIDENCE'); assert.ok(s.changes.some((c) => c.rule === 'TH-CBS' && c.materiality === 'INFORMATIONAL'));
  assert.equal(s.current.verdict, 'TAKE'); assert.deepEqual(s.conditions.added, []);
  const B = decided('park-18', NEUTRAL(), { cbs: CBS({ freshness: 'STALE' }) }); const rec = TH.reassess(B.snap, now(B.snap, NEUTRAL(FRESH2))); assert.ok(rec.changes.some((c) => c.rule === 'TH-SOURCE-RECOVERED'));
});
t('a source conflict is preserved on both values: the PROPX median moving away from the frozen underwriting value → SOURCE / EVIDENCE change (rule TH-CONFLICT) with both figures, impact EVIDENCE (on re-underwrite), no verdict move; the decision\'s stored value-source conflicts are kept in the snapshot', () => {
  const A = decided('park-18', NEUTRAL()); assert.ok(A.snap.assumptions.sqm > 0 && A.snap.assumptions.supportedValue > 0);
  const m = NEUTRAL(FRESH2); m.tx.median = Math.round(A.snap.assumptions.supportedValue / A.snap.assumptions.sqm * 0.7);
  const r = TH.reassess(A.snap, now(A.snap, m)); const c = r.changes.find((x) => x.rule === 'TH-CONFLICT');
  assert.ok(c, 'conflict detected'); assert.equal(c.category, 'SOURCE_EVIDENCE'); assert.match(c.text.en, /deviates \d+% from the underwriting value/); assert.equal(c.impact, 'EVIDENCE'); assert.equal(r.current.verdict, 'TAKE');
  const H = decided('hanassi-42', NEUTRAL()); assert.ok(Array.isArray(H.snap.conflicts)); for (const k of H.snap.conflicts) assert.ok(k.values.length >= 2);
});
t('a source revision preserves the original snapshot: revision rows for the deal\'s district and pre-decision periods are listed with original · revised · delta · publication, the retrospective impact is judged through the momentum factor, and the snapshot itself is untouched', () => {
  const A = decided('park-18', NEUTRAL()); const h = A.snap.hash;
  const rows = [{ id: '44,10:d-center#2', key: '44,10:d-center', measure: 'new_sold', geo: 'd-center', period: '2026-07', oldValue: 812, newValue: 846, delta: 34, material: false, publishedAt: '2026-10-22', observedAt: '2026-10-23T06:00:00Z' }, { id: 'x#1', measure: 'new_sold', geo: 'd-north', period: '2026-07', oldValue: 1, newValue: 2 }, { id: 'y#1', measure: 'new_sold', geo: 'd-center', period: '2026-09', oldValue: 1, newValue: 2 }];
  const r = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { revisions: rows })); assert.equal(A.snap.hash, h);
  assert.equal(r.revisions.length, 1, 'other districts and post-decision periods are not the thesis\'s'); assert.equal(r.revisions[0].original, 812); assert.equal(r.revisions[0].revised, 846); assert.equal(r.revisions[0].impact, 'NONE'); assert.match(r.revisions[0].retrospectiveImpact.en, /the decision would not have changed/);
  const rc = TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2), { revisions: rows })); assert.equal(rc.revisions[0].impact, 'ASSESSMENT_MOVED');
});
t('district-to-city leakage: the district series factor keeps geoScope "district" and its text names the district in the snapshot and in every change item; a national figure stays context', () => {
  const B = decided('park-18', CAUTION()); const f = B.snap.market.factors.find((x) => x.signal === 'sales-momentum-down'); assert.equal(f.geoScope, 'district'); assert.match(f.text.en, /district/);
  const r = TH.reassess(decided('park-18', NEUTRAL()).snap, now(B.snap, CAUTION(FRESH2))); const c = r.changes.find((x) => x.signal === 'sales-momentum-down'); assert.equal(c.geoScope, 'district');
  const n = NEUTRAL(FRESH2); n.radar.risks = [item('months-of-supply', 'risk', { source: 'cbs:timeseries:44,10' })]; const rn = TH.reassess(decided('park-18', NEUTRAL()).snap, now(B.snap, n)); const cn = rn.changes.find((x) => x.signal === 'months-of-supply'); assert.equal(cn.materiality, 'INFORMATIONAL'); assert.equal(cn.geoScope, 'national');
});
t('then-vs-now is historically correct: THEN carries the original verdict, market status, evidence and conditions from the snapshot; NOW the decision under the same policy; what changed (material first) and what did not; why it matters; next to watch', () => {
  const B = decided('park-18', CAUTION()); const r = TH.reassess(B.snap, now(B.snap, NEUTRAL(FRESH2))); const v = r.thenVsNow;
  assert.equal(v.status, 'CHANGED'); assert.equal(r.status, 'CHANGED'); assert.equal(v.original.verdict, 'TAKE_WITH_CONDITIONS'); assert.equal(v.original.market, 'CAUTION'); assert.equal(v.original.evidence, 'HIGH'); assert.equal(v.original.conditions.length, 1); assert.equal(v.original.decidedAt, TODAY);
  assert.equal(v.current.verdict, 'TAKE'); assert.equal(v.current.market, 'NEUTRAL'); assert.equal(v.current.conditions.length, 0); assert.equal(v.current.rule, 'F5');
  assert.ok(v.whatChanged.length >= 1 && v.whatChanged[0].materiality.en === 'DECISION-IMPACTING CHANGE'); assert.ok(v.whatDidNotChange.length === 6); assert.match(v.whyItMatters.en, /resolved the condition/); assert.equal(v.resolved.length, 1);
  assert.ok(v.nextToWatch && v.nextToWatch.fact);
});
t('the retrospective question is deterministic: NO when nothing moved · YES (verdict, rule) · YES (condition) for F4 · CANNOT DETERMINE without an assessment', () => {
  const A = decided('park-18', NEUTRAL()), G = decided('ganei-hapark', NEUTRAL()), B = decided('park-18', CAUTION());
  assert.equal(TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2))).retrospective.answer, 'NO');
  assert.equal(TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2))).retrospective.answer, 'YES');
  const g = TH.reassess(G.snap, now(G.snap, CAUTION(FRESH2))); assert.equal(g.retrospective.answer, 'YES_CONDITION'); assert.equal(g.retrospective.rule, 'F4'); assert.equal(g.state, 'NEW_CONDITION_TRIGGERED');
  assert.equal(TH.reassess(B.snap, now(B.snap, null)).retrospective.answer, 'CANNOT_DETERMINE');
  for (const r of [TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2)))]) assert.match(r.retrospective.unchanged.en, /IRR, MOIC, capital at risk/);
});
t('market change is never mixed with deal change: every change carries exactly one category; MARKET_EVIDENCE items carry the "never changes IRR" limitation; only DEAL_ASSUMPTION items may claim a VERDICT impact outside the F-rules', () => {
  const A = decided('park-18', NEUTRAL()); const r = TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2), { indicators: { boiRate: { value: 4.0 } } }));
  for (const c of r.changes) { assert.ok(TH.CATEGORY[c.category], c.id); assert.ok(c.categoryLabel.en); if (c.category === 'MARKET_EVIDENCE') assert.match(c.limitation.en, /never changes IRR, MOIC, cash flows or capital at risk/); if (c.impact === 'VERDICT_CHANGED') assert.ok(/^TH-F[35]/.test(c.rule) || c.rule === 'TH-DEAL', c.rule); }
  const d = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { dealHash: 'x' })); assert.equal(d.changes[0].category, 'DEAL_ASSUMPTION');
});
t('PASS stays PASS and INSUFFICIENT stays INSUFFICIENT whatever the market does (rules F2 / F1): market factor changes are context (impact CONTEXT), no condition is added, no verdict moves', () => {
  const H = decided('hanassi-42', NEUTRAL()); assert.equal(H.snap.final.verdict, 'PASS');
  for (const m of [STRONG(FRESH2), CAUTION(FRESH2)]) { const r = TH.reassess(H.snap, now(H.snap, m)); assert.equal(r.current.verdict, 'PASS'); assert.equal(r.current.rule, 'F2'); assert.equal(r.state, 'NO_MATERIAL_THESIS_CHANGE'); assert.deepEqual(r.conditions.added, []); assert.ok(r.changes.filter((c) => c.category === 'MARKET_EVIDENCE').every((c) => c.materiality === 'INFORMATIONAL')); assert.match(r.narrative.map((p) => p.en).join(' '), /never moves with the market \(rule F2\)/); }
  const I = decided('park-18', NEUTRAL(), { deal: (d) => { d.value = { chosen: null }; d.units.forEach((u) => { delete u.supported; }); } }); assert.equal(I.snap.final.verdict, 'INSUFFICIENT_EVIDENCE');
  const ri = TH.reassess(I.snap, now(I.snap, STRONG(FRESH2))); assert.equal(ri.current.verdict, 'INSUFFICIENT_EVIDENCE'); assert.equal(ri.current.rule, 'F1'); assert.deepEqual(ri.conditions.added, []);
});
t('dossier history integration: the geography\'s own changes since the decision are listed apart (category GEOGRAPHY) with decision impact NONE unless the factor that reads the fact moved; NO_SNAPSHOT is reported, never fabricated', () => {
  const A = decided('park-18', NEUTRAL());
  const hist = { status: 'OK', from: { date: '2026-10-18' }, to: { date: '2026-10-24' }, changes: [{ fact: 'land.unitsAwarded', label: { he: 'יח״ד שנזכו', en: 'awarded units' }, kind: 'CHANGED', verb: 'CHANGED', from: 1545, to: 2140, delta: 595, unit: 'units', cls: 'OFFICIAL', source: 'rmi:michrazim', period: { from: null, to: null, moved: false } }, { fact: 'sales.momentum3m', label: { he: 'מומנטום', en: 'sales momentum' }, kind: 'CHANGED', verb: 'NEW', from: 8.4, to: -11.2, delta: -19.6, unit: 'percent', cls: 'DERIVED', source: 'cbs:timeseries:44,10', period: { from: '2026-07', to: '2026-08', moved: true }, scope: 'district' }] };
  const r = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { dossierHistory: hist })); assert.equal(r.geoChanges.length, 2); assert.ok(r.geoChanges.every((g) => g.category === 'GEOGRAPHY' && g.impact === 'NONE')); assert.match(r.geoChanges[0].text.en, /1,545 → 2,140/); assert.equal(r.state, 'NO_MATERIAL_THESIS_CHANGE');
  const rc = TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2), { dossierHistory: hist })); const g = rc.geoChanges.find((x) => x.id === 'geo:sales.momentum3m'); assert.equal(g.impact, 'ASSESSMENT_MOVED'); assert.equal(g.contributes, 'sales-momentum-down');
  const rn = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { dossierHistory: { status: 'NO_SNAPSHOT', reason: { he: 'אין', en: 'no snapshots yet' } } })); assert.deepEqual(rn.geoChanges, []); assert.ok(rn.notes.some((n) => /NO_SNAPSHOT/.test(n.en)));
});

t('REVIEW M1 · a partial read never resolves a condition: an unanswered source (radarError / txError) or a source the snapshot had and the new read lacks → INSUFFICIENT NEW EVIDENCE (rule TH-PARTIAL), the market condition stays, nothing is "resolved"', () => {
  const B = decided('park-18', CAUTION());
  const noRadar = NEUTRAL(FRESH2); delete noRadar.radar; noRadar.radarError = 'HTTP 502';
  const r = TH.reassess(B.snap, now(B.snap, noRadar)); assert.equal(r.state, 'INSUFFICIENT_NEW_EVIDENCE'); assert.equal(r.rule, 'TH-PARTIAL'); assert.ok(r.current.conditions.some((c) => c.id === 'market-caution')); assert.equal(r.current.verdict, 'TAKE_WITH_CONDITIONS'); assert.match(r.changes[0].text.en, /unanswered \/ missing: radar/); assert.deepEqual(r.conditions, undefined);
  const noTx = NEUTRAL(FRESH2); delete noTx.tx; noTx.txError = 'timeout'; const r2 = TH.reassess(B.snap, now(B.snap, noTx)); assert.equal(r2.rule, 'TH-PARTIAL');
  const silent = NEUTRAL(FRESH2); delete silent.radar; const r3 = TH.reassess(B.snap, now(B.snap, silent)); assert.equal(r3.rule, 'TH-PARTIAL', 'a missing source without an error flag is still partial against a snapshot that had it');
  const okRead = TH.reassess(B.snap, now(B.snap, NEUTRAL(FRESH2))); assert.equal(okRead.state, 'CONDITION_RESOLVED', 'the complete fresh read still resolves');
});
t('REVIEW M2 · weaker evidence never resolves a condition: the same negative facts with a lower evidence quality → INSUFFICIENT NEW EVIDENCE (rule TH-NEG-UNCOUNTABLE), the condition stays, retrospective CANNOT DETERMINE; a changed class (OFFICIAL → DERIVED) likewise', () => {
  const B = decided('park-18', CAUTION());
  const low = CAUTION(FRESH2); low.dossier.quality = { level: 'LOW', score: 30, items: [] }; low.radar.risks[0].evidence = { level: 'LOW', score: 20 };
  const r = TH.reassess(B.snap, now(B.snap, low)); assert.equal(r.state, 'INSUFFICIENT_NEW_EVIDENCE'); assert.equal(r.rule, 'TH-NEG-UNCOUNTABLE'); assert.ok(r.current.conditions.some((c) => c.id === 'market-caution')); assert.equal(r.current.verdict, 'TAKE_WITH_CONDITIONS'); assert.equal(r.retrospective.answer, 'CANNOT_DETERMINE');
  assert.ok(r.changes.filter((c) => c.rule === 'TH-NEG-UNCOUNTABLE').length >= 1); assert.ok(r.changes.every((c) => c.impact !== 'CONDITION_RESOLVED')); assert.match(r.narrative[0].en, /Weaker evidence never resolves a condition/);
  const derived = CAUTION(FRESH2); derived.radar.risks[0].cls = 'DERIVED'; derived.dossier.risk[0].cls = 'DERIVED'; const r2 = TH.reassess(B.snap, now(B.snap, derived)); assert.equal(r2.rule, 'TH-NEG-UNCOUNTABLE'); assert.equal(r2.current.verdict, 'TAKE_WITH_CONDITIONS');
});
t('REVIEW M4 · a thesis without a market assessment at decision time (context not loaded / a baseline on a stale read): the first fresh read is a FIRST ASSESSMENT — its factors are TH-FIRST-ASSESSMENT (informational), nothing is "new versus then", no status move, retrospective CANNOT DETERMINE; a CAUTION first read still adds the market condition under F3 (the policy)', () => {
  const M = decided('park-18', null); assert.equal(M.snap.market.status, 'INSUFFICIENT');
  const n = TH.reassess(M.snap, now(M.snap, NEUTRAL(FRESH2))); assert.equal(n.state, 'NO_MATERIAL_THESIS_CHANGE'); assert.ok(n.changes.filter((c) => c.category === 'MARKET_EVIDENCE').every((c) => c.rule === 'TH-FIRST-ASSESSMENT' && c.materiality === 'INFORMATIONAL')); assert.ok(!n.changes.some((c) => c.id === 'status')); assert.equal(n.retrospective.answer, 'CANNOT_DETERMINE'); assert.match(n.narrative.map((p) => p.en).join(' '), /this is the first assessment/);
  const c = TH.reassess(M.snap, now(M.snap, CAUTION(FRESH2))); assert.equal(c.state, 'DECISION_REQUIRES_REVIEW'); assert.equal(c.current.rule, 'F3'); assert.ok(!c.changes.some((x) => x.rule === 'TH-NEG-NEW')); assert.equal(c.retrospective.answer, 'CANNOT_DETERMINE');
  const stale = decided('park-18', NEUTRAL('2026-06-01T00:00:00Z')); assert.ok(stale.snap.market.factors.every((f) => !f.material), 'a stale read at save time: every factor informational');
});
t('REVIEW m3 · the portfolio next-best-evidence aggregation has a total order: the same list in any order gives the same ranking, ties included', () => {
  const A = decided('park-18', NEUTRAL()), B = decided('park-18', CAUTION()), G = decided('ganei-hapark', NEUTRAL()), P = decided('park-18', NEUTRAL(), { deal: (d) => { d.info.constructionStatus = 'planning'; d.info.developerRating = 'unassessed'; } });
  const items = [A, B, G, P].map((x, i) => ({ dealId: 'd' + i, snapshot: x.snap, nbe: TH.nextBestEvidence(x.snap), lastCheck: null }));
  const key = (l) => JSON.stringify(TH.portfolio(l).nbe.map((x) => [x.id, x.fact.en, x.deals]));
  assert.equal(key(items), key(items.slice().reverse())); assert.equal(key(items), key([items[2], items[0], items[3], items[1]]));
});
t('REVIEW m6 · a store written by a newer / unknown schema is read as empty and never overwritten; a failed persist of a check is reported', () => {
  const ad = TH.memoryAdapter(); ad.set('altaris:thesis:v1', { schema: 2, records: { x: 1 } });
  const repo = TH.createRepository(ad); const A = decided('park-18', NEUTRAL());
  const r = repo.init('d1', A.snap, { contract: TH.contract(A.snap), watch: TH.watchlist(A.snap), nbe: TH.nextBestEvidence(A.snap) }); assert.equal(r.ok, false); assert.match(r.reason, /schema 2/);
  assert.deepEqual(ad.get('altaris:thesis:v1'), { schema: 2, records: { x: 1 } }, 'the foreign blob is untouched');
  assert.equal(repo.get('d1'), null); assert.equal(repo.recordCheck('d1', TH.reassess(A.snap, now(A.snap, null))).ok, false);
});

console.log('live thesis: contract, next best evidence, watchtower');
t('the thesis contract derives only from documented rules: every passed gate is a dependency that "moves only with a deal assumption"; evidence level; no-CAUTION (F3 / F4); breakers = flip points + market convergence + evidence drop + condition failure; PASS / INSUFFICIENT carry their F2 / F1 note', () => {
  const A = decided('park-18', NEUTRAL(), { flips: true }); const C = TH.contract(A.snap);
  assert.equal(C.original.verdict, 'TAKE'); assert.ok(C.dependsOn.filter((d) => d.id.startsWith('gate:')).length >= 9); assert.ok(C.dependsOn.every((d) => d.source && d.text.he && d.text.en));
  for (const d of C.dependsOn.filter((x) => x.kind === 'ECONOMIC')) assert.match(d.movesOnly.en, /never with market data/);
  assert.ok(C.dependsOn.find((d) => d.id === 'market-no-caution' && d.rule === 'F3')); assert.ok(C.breakers.find((b) => b.id === 'market-convergence' && b.rule === 'F3')); assert.ok(C.breakers.filter((b) => b.id.startsWith('flip:')).length >= 1); assert.ok(C.breakers.find((b) => b.id === 'evidence-low'));
  const B = decided('park-18', CAUTION()); const CB = TH.contract(B.snap); assert.equal(CB.activeConditions.length, 1); assert.equal(CB.activeConditions[0].path, 'REASSESS'); assert.match(CB.activeConditions[0].resolvedBy.en, /leaves CAUTION on a fresh read/); assert.ok(!CB.dependsOn.find((d) => d.id === 'market-no-caution'));
  const G = decided('ganei-hapark', NEUTRAL()); const CG = TH.contract(G.snap); assert.ok(CG.activeConditions.every((c) => c.path === 'RE_UNDERWRITE')); assert.ok(CG.breakers.some((b) => b.id.startsWith('condition-fails:')));
  assert.ok(TH.contract(decided('hanassi-42', NEUTRAL()).snap).notes.some((n) => /rule F2/.test(n.en)));
  const nf = TH.contract(decided('park-18', NEUTRAL()).snap); assert.ok(nf.notes.some((n) => /not computed at save time/.test(n.en)));
});
t('next-best-evidence ranking is deterministic and by decision relevance: the one fact that can remove a condition ranks HIGH above nine that cannot; market-condition removers rank HIGH only when they change the verdict; commercial terms are not evidence; "if verified / if not / expected source / never guaranteed" on every item', () => {
  const B = decided('park-18', CAUTION()); const N = TH.nextBestEvidence(B.snap);
  assert.equal(N.items[0].relevance, 'HIGH'); assert.ok(N.items[0].id.startsWith('market-remove:')); assert.equal(N.items[0].effect, 'VERDICT'); assert.equal(N.items[0].rule, 'F5');
  const rest = N.items.filter((x) => x.relevance !== 'HIGH'); assert.ok(rest.length >= 2 && rest.every((x) => x.effect !== 'VERDICT' && x.effect !== 'CONDITION'));
  for (const it of N.items) { assert.ok(it.fact.en && it.why.en && it.ifVerified.en && it.ifNot.en && it.expectedSource && it.path && it.rank, it.id); assert.match(it.limitation.en, /never guaranteed/); }
  const G = decided('ganei-hapark', NEUTRAL()); const NG = TH.nextBestEvidence(G.snap); assert.ok(!NG.items.some((x) => x.id === 'condition:irr' || x.id === 'condition:mos'), 'a commercial term is not evidence');
  /* the one fact that removes a condition vs nine that cannot: a planning-stage deal with an appraisal condition */
  const P = decided('park-18', NEUTRAL(), { deal: (d) => { d.info.constructionStatus = 'planning'; d.info.developerRating = 'unassessed'; } }); const NP = TH.nextBestEvidence(P.snap);
  const high = NP.items.filter((x) => x.relevance === 'HIGH'); assert.ok(high.length >= 1 && high.every((x) => x.id.startsWith('condition:')), JSON.stringify(NP.items.map((x) => [x.id, x.relevance])));
  assert.ok(NP.items.find((x) => x.id === 'condition:permit' && x.missingId === 'no_permits_source' && x.expectedSource === 'user'), 'the permit condition names the missing public source and the user path');
  assert.equal(JSON.stringify(TH.nextBestEvidence(P.snap)), JSON.stringify(NP));
  const I = decided('park-18', NEUTRAL(), { deal: (d) => { d.value = { chosen: null }; d.units.forEach((u) => { delete u.supported; }); } }); const NI = TH.nextBestEvidence(I.snap); assert.equal(NI.items[0].relevance, 'HIGH'); assert.equal(NI.items[0].rule, 'F1'); assert.equal(NI.items[0].path, 'RE_UNDERWRITE');
  const M = decided('park-18', null); const NM = TH.nextBestEvidence(M.snap); assert.ok(NM.items.find((x) => x.id === 'market-assessment' && x.relevance === 'HIGH' && x.rule === 'F0'));
});
t('the watchtower watches only what the thesis depends on and says what it cannot see: project execution is unwatchable with the registry reason (no_permits_source); a deal without a registry locality has no geography watch; PASS / INSUFFICIENT dimensions carry the F2 / F1 note', () => {
  const A = decided('park-18', NEUTRAL()); const W = TH.watchlist(A.snap);
  const ids = W.dimensions.map((d) => d.id); for (const id of ['demand', 'land-market', 'supply', 'transactions', 'execution', 'developer', 'macro', 'source-freshness', 'revisions', 'geography-history', 'project-execution']) assert.ok(ids.includes(id), id);
  const pe = W.dimensions.find((d) => d.id === 'project-execution'); assert.equal(pe.watchable, false); assert.equal(pe.missingId, 'no_permits_source'); assert.ok(X.missing(pe.missingId)); assert.match(pe.reason.en, /no public per-project permit/);
  for (const d of W.dimensions.filter((x) => x.watchable)) { assert.ok(d.feeds.length >= 1 || d.id === 'geography-history', d.id); for (const f of d.feeds) assert.ok(X.canonicalSource(f) || /^propx:/.test(f), d.id + ' feed ' + f); }
  const N = decided('park-18', NEUTRAL(), { deal: (d) => { delete d.info.cityCode; delete d.info.district; } }); const WN = TH.watchlist(N.snap); assert.ok(WN.dimensions.find((d) => d.id === 'geography' && d.watchable === false)); assert.ok(!WN.dimensions.find((d) => d.id === 'demand'));
  const H = decided('hanassi-42', NEUTRAL()); assert.ok(TH.watchlist(H.snap).dimensions.every((d) => d.note && /rule F2/.test(d.note.en)));
});

console.log('live thesis: portfolio and persistence');
t('portfolio attention ordering is deterministic (review > new condition > worsened > deal changed > sources > resolved > new information > no change > not checked > paused), counts by state, next-best evidence across deals counted once per deal, no score', () => {
  const A = decided('park-18', NEUTRAL()), B = decided('park-18', CAUTION()), G = decided('ganei-hapark', NEUTRAL()), H = decided('hanassi-42', NEUTRAL());
  const mk = (id, X0, lc, monitor) => ({ dealId: id, name: id, monitor: monitor || 'LIVE', snapshot: X0.snap, nbe: TH.nextBestEvidence(X0.snap), lastCheck: lc, status: 'SUPPORTED' });
  const list = [mk('p-ok', A, TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2)))), mk('p-review', A, TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2)))), mk('p-resolved', B, TH.reassess(B.snap, now(B.snap, NEUTRAL(FRESH2)))), mk('p-newcond', G, TH.reassess(G.snap, now(G.snap, CAUTION(FRESH2)))), mk('p-weak', A, TH.reassess(A.snap, now(A.snap, ONE_NEG(FRESH2)))),
    mk('p-info', A, TH.reassess(A.snap, now(A.snap, WEAK_NEG(FRESH2)))), mk('p-none', A, null), mk('p-paused', A, null, 'PAUSED'), mk('p-pass', H, TH.reassess(H.snap, now(H.snap, CAUTION(FRESH2)))), mk('p-deal', A, TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { dealHash: 'x' }))), mk('p-aging', A, TH.reassess(A.snap, now(A.snap, NEUTRAL('2027-02-10T00:00:00Z'), { today: '2027-02-12' }))), mk('p-conflict', A, (() => { const m = NEUTRAL(FRESH2); m.tx.median = Math.round(A.snap.assumptions.supportedValue / A.snap.assumptions.sqm * 0.7); return TH.reassess(A.snap, now(A.snap, m)); })())];
  const P = TH.portfolio(list);
  assert.deepEqual(P.rows.map((r) => r.dealId), ['p-review', 'p-newcond', 'p-weak', 'p-deal', 'p-conflict', 'p-resolved', 'p-aging', 'p-info', 'p-pass', 'p-ok', 'p-none', 'p-paused'], JSON.stringify(P.rows.map((r) => [r.dealId, r.attention.key])));
  assert.equal(P.summary.total, 12); assert.equal(P.summary.requiresReview, 1); assert.equal(P.summary.newCondition, 1); assert.equal(P.summary.resolved, 1); assert.equal(P.summary.notChecked, 1); assert.equal(P.summary.paused, 1); assert.equal(P.summary.dealChanged, 1); assert.equal(P.summary.sourceIssue, 1);
  assert.ok(!('score' in P) && !P.rows.some((r) => 'score' in r), 'no black-box portfolio score');
  assert.ok(P.nbe.length >= 1 && P.nbe.some((x) => x.deals >= 2) && P.nbe.every((x) => x.relevanceLabel) && TH.RELEVANCE[P.nbe[0].relevance].rank >= TH.RELEVANCE[P.nbe[P.nbe.length - 1].relevance].rank); assert.equal(JSON.stringify(TH.portfolio(list.slice().reverse()).rows.map((r) => r.dealId)), JSON.stringify(P.rows.map((r) => r.dealId)));
});
t('the repository is append-only and adapter-agnostic: checks are events, status history is kept, pause / resume are events, a failing adapter is reported (never thrown), the key is the ALTARIS namespace; Supabase unavailable has zero effect (there is no Supabase code path)', () => {
  const repo = TH.createRepository(TH.memoryAdapter()); assert.equal(repo.key, 'altaris:thesis:v1');
  const A = decided('park-18', NEUTRAL()); const C = TH.contract(A.snap), N = TH.nextBestEvidence(A.snap), W = TH.watchlist(A.snap, C);
  repo.init('d1', A.snap, { contract: C, watch: W, nbe: N }, { at: '2026-10-18T10:00:00Z' });
  const r1 = TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2))); assert.ok(repo.recordCheck('d1', r1).ok); let rec = repo.get('d1'); assert.equal(rec.status, 'REVIEW_REQUIRED'); assert.equal(rec.events.length, 2); assert.equal(rec.events[1].kind, 'CHECK'); assert.equal(rec.statusHistory.length, 2); assert.equal(rec.lastCheck.state, 'DECISION_REQUIRES_REVIEW');
  const r2 = TH.reassess(A.snap, now(A.snap, null)); repo.recordCheck('d1', r2); rec = repo.get('d1'); assert.equal(rec.status, 'REVIEW_REQUIRED', 'insufficient new evidence keeps the last status'); assert.equal(rec.events.length, 3);
  assert.ok(repo.setMonitor('d1', 'PAUSED').ok); assert.equal(repo.get('d1').monitor, 'PAUSED'); assert.equal(repo.get('d1').events[3].kind, 'PAUSE'); assert.ok(repo.setMonitor('d1', 'LIVE').ok);
  assert.equal(repo.get('d1').versions[0].hash, A.snap.hash);
  const broken = TH.createRepository({ get: () => null, set: () => false }); const r = broken.init('d1', A.snap, { contract: C, watch: W, nbe: N }); assert.equal(r.ok, false); assert.equal(r.reason, 'storage');
  for (const f of ['altaris/thesis.js', 'altaris/app.js', 'altaris/index.html']) assert.ok(!/@supabase|supabase\.co|createClient\(|SUPABASE_URL|service_role/i.test(SRC(f)), 'no Supabase runtime dependency in ' + f);
  assert.ok(!fs.existsSync(path.join(ROOT, 'supabase/migrations')) || !fs.readdirSync(path.join(ROOT, 'supabase/migrations')).some((f) => /thesis/i.test(f)), 'no thesis migration file');
});

/* ------------------------------------------------------------------------------------------------
 * ACCEPTANCE CASES (§32) — twenty representative post-decision situations over the illustrative cases
 * and the synthetic market contexts; the table is frozen in test/fixtures/altaris-thesis-acceptance-2026-10-18.json.
 * ---------------------------------------------------------------------------------------------- */
console.log('live thesis: acceptance cases');
const ACCEPT = [];
const rowOf = (n, title, X0, r, nbe) => ({ n, title, originalDecision: X0.snap.final.verdict, originalThesis: { economic: X0.snap.economic.verdict, market: X0.snap.market.status, evidence: X0.snap.economic.evidence.level, conditions: X0.snap.conditions.map((c) => c.id), rule: X0.snap.final.rule }, newEvidence: r.changes.filter((c) => c.materiality !== 'INFORMATIONAL').map((c) => c.text.en).slice(0, 4), materiality: r.materiality, rule: r.rule, decisionDelta: r.state, currentDecision: r.current ? r.current.verdict : null, activeConditions: r.conditions ? r.conditions.active.map((c) => c.id) : (r.current ? r.current.conditions.map((c) => c.id) : null), resolvedConditions: r.conditions ? r.conditions.resolved.map((c) => c.id) : [], nextBestEvidence: nbe.items.slice(0, 2).map((x) => `${x.fact.en} (${x.relevance})`), retrospective: r.retrospective.answer, attention: r.attention ? r.attention.key : null });
t('1 · TAKE, no material changes → NO MATERIAL THESIS CHANGE, TAKE stands', () => { const A = decided('park-18', NEUTRAL()); const r = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2))); assert.equal(r.state, 'NO_MATERIAL_THESIS_CHANGE'); assert.equal(r.current.verdict, 'TAKE'); ACCEPT.push(rowOf(1, 'TAKE, no material changes', A, r, TH.nextBestEvidence(A.snap))); });
t('2 · TAKE WITH CONDITIONS, the permit later verified → the permit is a deal input: the re-underwrite (new version) resolves it; the thesis itself reports the assumptions change (TH-DEAL)', () => {
  const P = decided('park-18', NEUTRAL(), { deal: (d) => { d.info.constructionStatus = 'planning'; } }); assert.ok(P.snap.conditions.some((c) => c.id === 'permit'));
  const V2 = decided('park-18', NEUTRAL(FRESH2), { deal: (d) => { d.info.constructionStatus = 'construction'; }, today: LATER, versionN: 2 }); assert.ok(!V2.snap.conditions.some((c) => c.id === 'permit'), 'the verified status resolves the permit condition in the new version');
  const r = TH.reassess(P.snap, now(P.snap, NEUTRAL(FRESH2), { dealHash: V2.snap.assumptions.dealHash })); assert.equal(r.state, 'DEAL_CHANGED');
  const repo = TH.createRepository(TH.memoryAdapter()); repo.init('d', P.snap, { contract: TH.contract(P.snap), watch: TH.watchlist(P.snap), nbe: TH.nextBestEvidence(P.snap) }); const a = repo.init('d', V2.snap, { contract: TH.contract(V2.snap), watch: TH.watchlist(V2.snap), nbe: TH.nextBestEvidence(V2.snap) }); assert.equal(a.action, 'appended'); assert.equal(a.record.events[1].from, P.snap.final.verdict); assert.equal(a.record.events[1].to, V2.snap.final.verdict);
  const row = rowOf(2, 'TAKE WITH CONDITIONS, permit later verified (re-underwrite v2)', P, r, TH.nextBestEvidence(P.snap)); row.reunderwrite = { from: P.snap.final.verdict, to: V2.snap.final.verdict, conditionsAfter: V2.snap.conditions.map((c) => c.id) }; ACCEPT.push(row);
});
t('3 · a decision with an open permit milestone, the condition remains unresolved → NO MATERIAL THESIS CHANGE, the condition stays active, nothing resolves it', () => { const P = decided('park-18', NEUTRAL(), { deal: (d) => { d.info.constructionStatus = 'planning'; } }); const r = TH.reassess(P.snap, now(P.snap, NEUTRAL(FRESH2))); assert.equal(r.state, 'NO_MATERIAL_THESIS_CHANGE'); assert.ok(r.conditions.active.some((c) => c.id === 'permit')); assert.equal(r.current.verdict, P.snap.final.verdict); assert.deepEqual(r.conditions.resolved, []); ACCEPT.push(rowOf(3, 'TAKE WITH CONDITIONS, condition unresolved', P, r, TH.nextBestEvidence(P.snap))); });
t('4 · TAKE, one weak negative signal appears → NO MATERIAL THESIS CHANGE (informational), TAKE stands', () => { const A = decided('park-18', NEUTRAL()); const r = TH.reassess(A.snap, now(A.snap, WEAK_NEG(FRESH2))); assert.equal(r.state, 'NO_MATERIAL_THESIS_CHANGE'); assert.equal(r.current.verdict, 'TAKE'); ACCEPT.push(rowOf(4, 'TAKE, one weak negative signal', A, r, TH.nextBestEvidence(A.snap))); });
t('5 · TAKE, three high-quality negative factors from independent families converge (CBS + ILA ×2) → DECISION REQUIRES REVIEW, TAKE WITH CONDITIONS under F3', () => { const A = decided('park-18', NEUTRAL()); const m = CAUTION(FRESH2); m.radar.risks.push(item('developer-concentration', 'risk', { valueLabel: '61%', threshold: '≥ 50%' })); const r = TH.reassess(A.snap, now(A.snap, m)); assert.equal(r.state, 'DECISION_REQUIRES_REVIEW'); assert.equal(r.current.verdict, 'TAKE_WITH_CONDITIONS'); assert.ok(r.current.convergence.negative >= 3 && r.current.convergence.negativeFamilies.length >= 2, JSON.stringify(r.current.convergence)); ACCEPT.push(rowOf(5, 'TAKE, three high-quality negatives from independent families converge', A, r, TH.nextBestEvidence(A.snap))); });
t('6 · PASS, the market improves strongly → PASS (F2), context only', () => { const H = decided('hanassi-42', NEUTRAL()); const r = TH.reassess(H.snap, now(H.snap, STRONG(FRESH2))); assert.equal(r.current.verdict, 'PASS'); assert.equal(r.current.rule, 'F2'); ACCEPT.push(rowOf(6, 'PASS, market improves strongly', H, r, TH.nextBestEvidence(H.snap))); });
t('7 · PASS must remain PASS while the economics fail, under any market', () => { const H = decided('coastal-portfolio-i', NEUTRAL()); for (const m of [STRONG(FRESH2), NEUTRAL(FRESH2), CAUTION(FRESH2)]) assert.equal(TH.reassess(H.snap, now(H.snap, m)).current.verdict, 'PASS'); const r = TH.reassess(H.snap, now(H.snap, CAUTION(FRESH2))); ACCEPT.push(rowOf(7, 'PASS remains PASS (economics fail)', H, r, TH.nextBestEvidence(H.snap))); });
t('8 · INSUFFICIENT EVIDENCE, the missing key evidence later arrives → it is an underwriting input (F1): next-best evidence ranks it HIGH on the re-underwrite path; the market cannot supply it', () => { const I = decided('park-18', NEUTRAL(), { deal: (d) => { d.value = { chosen: null }; d.units.forEach((u) => { delete u.supported; }); } }); const r = TH.reassess(I.snap, now(I.snap, STRONG(FRESH2))); assert.equal(r.current.verdict, 'INSUFFICIENT_EVIDENCE'); const N = TH.nextBestEvidence(I.snap); assert.equal(N.items[0].relevance, 'HIGH'); assert.equal(N.items[0].path, 'RE_UNDERWRITE'); const V2 = decided('park-18', NEUTRAL(FRESH2), { today: LATER, versionN: 2 }); assert.notEqual(V2.snap.final.verdict, 'INSUFFICIENT_EVIDENCE'); const row = rowOf(8, 'INSUFFICIENT EVIDENCE, key evidence later arrives (re-underwrite v2)', I, r, N); row.reunderwrite = { from: I.snap.final.verdict, to: V2.snap.final.verdict }; ACCEPT.push(row); });
t('9 · a source revision changes a historical market fact → original beside revised, retrospective impact judged through the momentum factor', () => { const A = decided('park-18', NEUTRAL()); const rows = [{ id: '44,10:d-center#2', measure: 'new_sold', geo: 'd-center', period: '2026-07', oldValue: 812, newValue: 846, delta: 34, publishedAt: '2026-10-22' }]; const r = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { revisions: rows })); assert.equal(r.revisions.length, 1); assert.equal(r.revisions[0].impact, 'NONE'); const row = rowOf(9, 'source revision of a historical fact', A, r, TH.nextBestEvidence(A.snap)); row.revision = r.revisions[0]; ACCEPT.push(row); });
t('10 · a stale source → SOURCE STALE / EVIDENCE AGING, never a negative signal', () => { const A = decided('park-18', NEUTRAL()); const r = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { cbs: CBS({ freshness: 'STALE' }) })); assert.ok(r.changes.some((c) => c.rule === 'TH-SOURCE-STALE')); assert.equal(r.current.verdict, 'TAKE'); ACCEPT.push(rowOf(10, 'stale source', A, r, TH.nextBestEvidence(A.snap))); });
t('11 · conflicting sources → SOURCE CONFLICT preserved on both values, evidence impact on re-underwrite only', () => { const A = decided('park-18', NEUTRAL()); const m = NEUTRAL(FRESH2); m.tx.median = Math.round(A.snap.assumptions.supportedValue / A.snap.assumptions.sqm * 0.7); const r = TH.reassess(A.snap, now(A.snap, m)); assert.ok(r.changes.some((c) => c.rule === 'TH-CONFLICT')); assert.equal(r.current.verdict, 'TAKE'); ACCEPT.push(rowOf(11, 'conflicting sources', A, r, TH.nextBestEvidence(A.snap))); });
t('12 · project execution advances (the developer\'s MoCH construction evidence) → PROJECT EXECUTION change, relevant, developer-level: it resolves no permit condition', () => { const P = decided('park-18', NEUTRAL(), { deal: (d) => { d.info.constructionStatus = 'planning'; } }); const m = NEUTRAL(FRESH2); m.devIntel.construction = { buildings: 4, started: 3, completed: 1, asOf: '2026-09-30' }; const r = TH.reassess(P.snap, now(P.snap, m)); const c = r.changes.find((x) => x.rule === 'TH-DEV-CONSTR'); assert.ok(c && c.category === 'PROJECT_EXECUTION'); assert.ok(r.conditions.active.some((x) => x.id === 'permit')); ACCEPT.push(rowOf(12, 'project execution advances (developer-level evidence)', P, r, TH.nextBestEvidence(P.snap))); });
t('13 · no later public evidence found → INSUFFICIENT NEW EVIDENCE, nothing changes, nothing is inferred', () => { const A = decided('park-18', NEUTRAL()); const r = TH.reassess(A.snap, now(A.snap, null)); assert.equal(r.state, 'INSUFFICIENT_NEW_EVIDENCE'); ACCEPT.push(rowOf(13, 'no later public evidence found', A, r, TH.nextBestEvidence(A.snap))); });
t('14 · developer evidence weakens materially ("possibly the same" entity appears, fewer lots) → DEVELOPER change, informational (no decision rule reads it); the developer-entries positive factor leaving is RELEVANT', () => { const S = decided('park-18', STRONG()); const m = NEUTRAL(FRESH2); m.devIntel.possibleSame = 2; m.devIntel.lots = 1; const r = TH.reassess(S.snap, now(S.snap, m)); assert.ok(r.changes.some((c) => c.rule === 'TH-DEV' && c.materiality === 'INFORMATIONAL')); assert.ok(r.changes.some((c) => c.rule === 'TH-POS-GONE')); assert.equal(r.current.verdict, 'TAKE'); ACCEPT.push(rowOf(14, 'developer evidence weakens materially', S, r, TH.nextBestEvidence(S.snap))); });
t('15 · an irrelevant macro change → MACRO, informational, no delta', () => { const A = decided('park-18', NEUTRAL()); const r = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { indicators: { boiRate: { value: 4.25, publishedAt: '2026-10-20' } } })); assert.equal(r.state, 'NO_MATERIAL_THESIS_CHANGE'); assert.ok(r.changes.find((c) => c.category === 'MACRO' && c.materiality === 'INFORMATIONAL')); ACCEPT.push(rowOf(15, 'irrelevant macro change', A, r, TH.nextBestEvidence(A.snap))); });
t('16 · the user changes a deal assumption → DEAL ASSUMPTIONS CHANGED; the save creates a new underwriting version (re-underwrite), the original kept', () => { const A = decided('park-18', NEUTRAL()); const V2 = decided('park-18', NEUTRAL(), { deal: (d) => { d.hybrid.couponPct = 6; }, versionN: 2 }); const r = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2), { dealHash: V2.snap.assumptions.dealHash })); assert.equal(r.state, 'DEAL_CHANGED'); assert.notEqual(V2.snap.economic.structures[V2.snap.economic.lead].irr, A.snap.economic.structures[A.snap.economic.lead].irr, 'the re-underwrite legitimately recomputes the economics'); const row = rowOf(16, 'user changes a deal assumption (re-underwrite v2)', A, r, TH.nextBestEvidence(A.snap)); row.reunderwrite = { from: A.snap.final.verdict, to: V2.snap.final.verdict, irrFrom: A.snap.economic.structures[A.snap.economic.lead].irr, irrTo: V2.snap.economic.structures[V2.snap.economic.lead].irr }; ACCEPT.push(row); });
t('17 · a portfolio with one materially changed deal among many unchanged → the one deal ranks first; the rest "no material change"', () => { const A = decided('park-18', NEUTRAL()); const ok = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2))), bad = TH.reassess(A.snap, now(A.snap, CAUTION(FRESH2))); const list = []; for (let i = 0; i < 19; i++) list.push({ dealId: 'u' + String(i).padStart(2, '0'), snapshot: A.snap, nbe: TH.nextBestEvidence(A.snap), lastCheck: ok }); list.push({ dealId: 'changed', snapshot: A.snap, nbe: TH.nextBestEvidence(A.snap), lastCheck: bad }); const P = TH.portfolio(list); assert.equal(P.rows[0].dealId, 'changed'); assert.equal(P.summary.requiresReview, 1); assert.equal(P.summary.noMaterialChange, 19); ACCEPT.push({ n: 17, title: 'portfolio: one materially changed deal among 19 unchanged', portfolio: { total: P.summary.total, first: P.rows[0].dealId, requiresReview: P.summary.requiresReview, noMaterialChange: P.summary.noMaterialChange } }); });
t('18 · an old saved deal with no historical snapshot → BASELINE CREATED TODAY (labelled), never a fabricated past state', () => { const A = decided('park-18', NEUTRAL(), { basis: 'BASELINE_TODAY' }); assert.equal(A.snap.basis, 'BASELINE_TODAY'); assert.match(A.snap.basisLabel.en, /BASELINE CREATED TODAY/); assert.ok(A.snap.context.readAt); const r = TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2))); const row = rowOf(18, 'old saved deal, no historical snapshot (baseline today)', A, r, TH.nextBestEvidence(A.snap)); row.basis = A.snap.basis; ACCEPT.push(row); });
t('19 · next-best evidence: one missing fact can remove a condition and the others cannot → it ranks first, HIGH; the rest LOW / INFORMATIONAL', () => { const P = decided('park-18', NEUTRAL(), { deal: (d) => { d.info.constructionStatus = 'planning'; } }); const N = TH.nextBestEvidence(P.snap); assert.equal(N.items[0].id, 'condition:permit'); assert.equal(N.items[0].relevance, 'HIGH'); assert.ok(N.items.slice(1).every((x) => x.relevance !== 'HIGH')); assert.ok(N.items.length >= 3); ACCEPT.push({ n: 19, title: 'next-best evidence: one fact removes a condition, the others cannot', ranking: N.items.map((x) => `${x.rank}. ${x.fact.en} — ${x.relevance} (${x.effect})`) }); });
t('20 · Supabase completely unavailable → zero effect: the feature runs on the in-memory / browser adapter with no Supabase code path', () => { const repo = TH.createRepository(TH.memoryAdapter()); const A = decided('park-18', NEUTRAL()); assert.equal(repo.init('d', A.snap, { contract: TH.contract(A.snap), watch: TH.watchlist(A.snap), nbe: TH.nextBestEvidence(A.snap) }).action, 'created'); assert.ok(repo.recordCheck('d', TH.reassess(A.snap, now(A.snap, NEUTRAL(FRESH2)))).ok); ACCEPT.push({ n: 20, title: 'Supabase unavailable', effect: 'none — no runtime dependency; the thesis repository runs over the browser adapter', events: repo.get('d').events.map((e) => e.kind) }); });

t('the acceptance table is frozen (zero drift) — test/fixtures/altaris-thesis-acceptance-2026-10-18.json', () => {
  const file = path.join(ROOT, 'test/fixtures/altaris-thesis-acceptance-2026-10-18.json');
  const out = { today: TODAY, later: LATER, basis: 'synthetic market contexts (test inputs) over the illustrative cases — never product data; economics frozen in every reassessment', cases: ACCEPT };
  const txt = JSON.stringify(out, null, 1) + '\n';
  if (process.env.UPDATE_FIXTURE === '1' || !fs.existsSync(file)) fs.writeFileSync(file, txt);
  assert.equal(fs.readFileSync(file, 'utf8'), txt, 'acceptance set drifted — review, then UPDATE_FIXTURE=1');
  assert.equal(ACCEPT.length, 20);
});

console.log(`live thesis: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
