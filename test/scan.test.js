'use strict';
/* PROPX · Opportunity Radar / Risk Radar (lib/radar/scan.js), Revision Intelligence (lib/radar/revisions.js) and
 * Trust 2.0 (lib/trust/catalog.js alerts) — the gates. Deterministic rules over the dossier signals and the
 * append-only CBS ledger; strict geography; never a recommendation; never a probability. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/radar/scan');
const D = require('../lib/dossier/query');
const REV = require('../lib/radar/revisions');
const T = require('../lib/trust/catalog');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const NOW = Date.parse('2026-10-17T18:00:00Z');

console.log('scan: rules');
t('the scan is read-only and never recommends: no fetch / random; the basis says "not an investment recommendation"; no buy / invest wording in any item', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/radar/scan.js'), 'utf8');
  assert.ok(!/fetch\(|https?\.request|Math\.random/.test(src));
  assert.match(S.BASIS.en, /Not an investment recommendation/);
  const P = S.load({ now: NOW });
  for (const x of [...P.opportunities, ...P.risks]) assert.ok(!/recommend|should buy|invest now|מומלץ|לקנות/i.test(x.text.he + ' ' + x.text.en), x.id);
});
t('every rule has a kind, a constant materiality 1–3 and the geography levels it is valid at; sales and macro rules never apply to a locality', () => {
  for (const [id, r] of Object.entries(S.RULES)) { assert.ok(['opportunity', 'risk'].includes(r.kind), id); assert.ok([1, 2, 3].includes(r.m), id); assert.ok(r.levels.length, id); }
  for (const id of ['sales-momentum-up', 'sales-momentum-down', 'months-of-supply', 'construction-inputs']) assert.ok(!S.RULES[id].levels.includes('locality'), id);
});
t('strict geography on the real scan: no locality item carries a CBS or macro series; a district item\'s comparison is the national figure or its share of it', () => {
  const P = S.load({ now: NOW });
  assert.ok(P.counts.geographies >= 8 && P.geographies.some((g) => g.level === 'il') && P.geographies.filter((g) => g.level === 'district').length === 7);
  for (const x of [...P.opportunities, ...P.risks]) {
    if (x.geo.level === 'locality') assert.ok(!/cbs/.test(x.source), x.id);
    if (x.comparison) assert.ok(['national-value', 'share-of-national'].includes(x.comparison.kind) && x.comparison.he && x.comparison.en && x.geo.level !== 'il', x.id);
  }
});
t('Radar 2.0: the scan covers every registry locality with a live ILA tender (not a top-N); every geography carries a signal STATE with its reason; NO SIGNAL is a valid, counted state', () => {
  const P = S.load({ now: NOW });
  const ix = D.index({ limit: Infinity });
  assert.equal(P.scope.localities, ix.localities.length, 'every indexed locality is scanned'); assert.ok(P.scope.localities > 400, 'more than the old top-40 / 400 cap');
  assert.equal(P.scope.localitiesWithLiveTenders, ix.localities.length); assert.match(P.scope.localityRule.en, /every locality/);
  assert.deepEqual(Object.keys(S.STATES), ['SIGNALS', 'NO_SIGNAL', 'INSUFFICIENT_DATA']);
  const n = { SIGNALS: 0, NO_SIGNAL: 0, INSUFFICIENT_DATA: 0 };
  for (const g of P.geographies) { assert.ok(S.STATES[g.signalState], g.code); assert.ok(g.stateReason && g.stateReason.he && g.stateReason.en, g.code); n[g.signalState]++;
    if (g.signalState === 'SIGNALS') assert.ok(g.opportunities + g.risks > 0, g.code); else assert.equal(g.opportunities + g.risks, 0, g.code);
    if (g.level === 'locality') assert.ok(Number.isInteger(g.tracked), g.code); else assert.equal(g.tracked, null); }
  assert.deepEqual(P.counts.states, n); assert.equal(n.SIGNALS + n.NO_SIGNAL + n.INSUFFICIENT_DATA, P.counts.geographies);
  assert.ok(n.NO_SIGNAL > 0, 'NO SIGNAL exists as a state'); assert.ok(n.INSUFFICIENT_DATA >= 0);
  for (const g of P.geographies.filter((g) => g.signalState === 'INSUFFICIENT_DATA')) assert.ok(g.quality.level === 'LOW' || g.tracked === 0, 'insufficient only for LOW evidence or no tracked record: ' + g.code);
  /* the view carries the vocabulary; forGeo answers a state for a covered geography and for a computed one */
  const V = S.scan({ limit: 5 }); assert.ok(V.states && V.states.NO_SIGNAL.en && V.counts.states);
  const cov = P.geographies.find((g) => g.level === 'locality' && g.signalState === 'NO_SIGNAL'); const F = S.forGeo({ level: 'locality', code: cov.code });
  assert.equal(F.signalState, 'NO_SIGNAL'); assert.ok(F.signalStateLabel.he && F.stateReason.en); assert.equal(F.opportunities.length + F.risks.length, 0);
  const il = S.forGeo({ level: 'il', code: 'il' }); assert.ok(S.STATES[il.signalState]);
});
t('review 18.10.2026 (M3 / M4 / m8): a NO SIGNAL locality with fewer than 3 stored records and no event says the quiet-pipeline rule was NOT applicable (never "not crossed"); the reasons speak of stored records (current-scope tenders + rental; complexes + lotteries as published), the scope line of the latest ILA list', () => {
  const P = S.load({ now: NOW });
  const few = P.geographies.filter((g) => g.level === 'locality' && g.signalState === 'NO_SIGNAL' && g.tracked < D.TRACKED_MIN);
  assert.ok(few.length > 0);
  for (const g of few) { const d = D.dossier({ level: 'locality', code: g.code }); if (d.sections.changes && d.sections.changes.total === 0) assert.match(g.stateReason.en, /quiet-pipeline rule is not applicable/, g.code); else assert.match(g.stateReason.en, /no documented threshold was crossed/, g.code); }
  for (const g of P.geographies.filter((g) => g.level === 'locality' && g.signalState === 'INSUFFICIENT_DATA' && g.tracked === 0)) assert.match(g.stateReason.en, /stored record .*current scope .*as published/, g.code);
  assert.match(P.scope.localityRule.en, /in the latest list/);
  const X = require('../lib/explain/registry'); assert.match(X.SIGNAL_RULES['no-recent-changes'].rule.en, /≥ 3 stored records/);
});
t('the quiet-pipeline rule (no-recent-changes) needs a pipeline: a locality with fewer than 3 tracked records never carries it; a district always may (BEFORE 18.10.2026: 297 of 400 indexed localities carried it with as little as one old tender)', () => {
  const P = S.load({ now: NOW });
  for (const x of P.risks.filter((x) => x.signal === 'no-recent-changes' && x.geo.level === 'locality')) { const g = P.geographies.find((g) => g.level === 'locality' && g.code === x.geo.code); assert.ok(g.tracked >= D.TRACKED_MIN, x.id); }
  const base = { changes: { total: 0, window: '30d' }, land: { kpis: { tenders: 1 } }, renewal: { kpis: { complexes: 1 } }, housing: { kpis: { projects: 0 } }, rental: { pipeline: { tenders: 0, staleStatus: { n: 0 } } } };
  const ids = (S2, geo) => D.signalsOf(S2, geo, NOW).map((s) => s.id);
  assert.ok(!ids(base, { level: 'locality' }).includes('no-recent-changes'), '2 tracked records: untracked, not quiet');
  assert.ok(ids({ ...base, land: { kpis: { tenders: 2 } } }, { level: 'locality' }).includes('no-recent-changes'), '3 tracked records: quiet');
  assert.ok(ids(base, { level: 'district', district: 'd-center' }).includes('no-recent-changes'), 'a district always has a pipeline');
  const q = D.signalsOf({ ...base, land: { kpis: { tenders: 2 } } }, { level: 'locality' }, NOW).find((s) => s.id === 'no-recent-changes'); assert.ok(q.limitations && /precondition/.test(q.limitations[0].en));
  assert.equal(D.TRACKED_MIN, 3); assert.equal(D.trackedRecords(base), 2);
});
t('every item answers "why was this flagged?": trigger · value · threshold · period · source · class · evidence quality (HIGH / MEDIUM / LOW, never a probability)', () => {
  const P = S.load({ now: NOW });
  for (const x of [...P.opportunities, ...P.risks]) {
    assert.ok(x.text.he && x.text.en && x.trigger.he && x.trigger.en, x.id); assert.ok(x.threshold && x.source && x.cls, x.id);
    assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(x.evidence.level) && Number.isInteger(x.evidence.score), x.id);
    assert.ok(['OFFICIAL', 'OBSERVED', 'DERIVED'].includes(x.cls), x.id);
    if (x.derived) assert.equal(x.cls, 'DERIVED');
    if (x.value != null) assert.ok(x.valueLabel, x.id);
  }
});
t('classify() is deterministic over a dossier: a watch signal becomes an opportunity, a risk signal a risk, an unknown rule is dropped, a locality drops the sales rule', () => {
  const mk = (level, signals) => ({ geo: { level, code: 'x', name: { he: 'x', en: 'x' } }, quality: { level: 'HIGH', score: 90 }, signals, sections: {} });
  const sig = (kind, id, value) => ({ kind, id, text: { he: 'א', en: 'a' }, value, threshold: '≥ 1', period: '2026-08', source: 'rmi:michrazim', cls: 'OFFICIAL' });
  const a = S.classify(mk('district', [sig('watch', 'open-land', 600), sig('risk', 'failed-tenders', 0.4), sig('watch', 'nonexistent-rule', 1), sig('watch', 'sales-momentum-up', 12)]), null);
  assert.deepEqual(a.map((x) => x.kind + ':' + x.signal), ['opportunity:open-land', 'risk:failed-tenders', 'opportunity:sales-momentum-up', 'opportunity:demand-with-supply']);
  const b = S.classify(mk('locality', [sig('watch', 'sales-momentum-up', 12), sig('watch', 'open-land', 600)]), null);
  assert.deepEqual(b.map((x) => x.signal), ['open-land']);
  assert.deepEqual(S.classify(mk('locality', [sig('watch', 'sales-momentum-up', 12), sig('watch', 'open-land', 600)]), null), b, 'same input → same output');
});
t('the view filters by kind, level, city and district and caps the list; forGeo serves a covered geography from the file and computes an uncovered one with the same rules', () => {
  const o = S.scan({ kind: 'opportunity', limit: 5 }, { now: NOW }); assert.ok(o.opportunities.length <= 5 && o.risks.length === 0);
  const d = S.scan({ district: 'd-ta' }, { now: NOW }); for (const x of [...d.opportunities, ...d.risks]) assert.ok(x.geo.district === 'd-ta' || x.geo.code === 'd-ta');
  const g = S.forGeo({ level: 'district', code: 'd-ta' }); assert.ok(g && ['file', 'built-on-read'].includes(g.served));
  const u = S.forGeo({ level: 'locality', code: '4100' }); assert.ok(u && (u.served === 'computed' || u.served === 'file'));
  assert.equal(S.forGeo({ level: 'locality', code: '999999' }), null);
});

console.log('revisions: the ledger');
t('a revision = a later record with the value it replaces; old and new are both kept; material = |Δ| ≥ 5% (a constant); publication ≠ PROPX observation', () => {
  const v = REV.revisions({ window: 'all' }, { now: NOW });
  assert.equal(REV.MATERIAL_PCT, 5); assert.match(v.basis.en, /old value is kept/); assert.ok(v.totals.all > 0);
  for (const x of v.rows) { assert.ok(x.oldValue != null && x.newValue != null && x.revision >= 1, x.id); assert.equal(x.material, x.pct != null && Math.abs(x.pct) >= 5); assert.ok(x.publishedAt && x.observedAt && x.publishedAt !== x.observedAt.slice(0, 10) || x.publishedAt, x.id); assert.equal(x.cls, 'OFFICIAL'); }
  const m = REV.revisions({ window: 'all', material: '1' }, { now: NOW }); assert.ok(m.rows.every((x) => x.material) && m.rows.length === v.totals.material);
  assert.ok(v.releases.length >= 1 && v.releases[0].revisions >= 1 && v.releases[0].byGeo.every((g) => Number.isFinite(g.netDelta)));
});
t('the ledger on disk agrees: the count of revision records equals the view\'s total; a window excludes older observations', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'data/cbs-sales/observations.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const n = lines.filter((r) => (r.revision || 0) > 0 && r.replaces != null).length;
  assert.equal(REV.revisions({ window: 'all' }, { now: NOW }).totals.all, n);
  assert.equal(REV.revisions({ window: '30d' }, { now: Date.parse('2027-06-01T00:00:00Z') }).totals.inWindow, 0);
});

console.log('trust 2.0: alerts and run history');
t('runSummary states latest success and latest failure apart, flags RECOVERED only for a good check after a bad one inside the window, and tallies checks', () => {
  const r = (at, status, error) => ({ id: 'x', finishedAt: at, status, error, retrievalMethod: 'live-api' });
  const now = Date.parse('2026-10-17T12:00:00Z');
  const s = T.runSummary([r('2026-10-10T08:00:00Z', 'ok'), r('2026-10-14T08:00:00Z', 'failed', 'HTTP 500'), r('2026-10-16T08:00:00Z', 'ok')], { staleAfterHours: 50, now });
  assert.equal(s.latestSuccessAt, '2026-10-16T08:00:00Z'); assert.equal(s.latestFailureAt, '2026-10-14T08:00:00Z'); assert.equal(s.latestFailureState, 'FAILED'); assert.equal(s.recovered, true); assert.deepEqual(s.tally, { total: 3, good: 2, bad: 1 });
  const old = T.runSummary([r('2026-09-01T08:00:00Z', 'failed', 'x'), r('2026-09-02T08:00:00Z', 'ok')], { staleAfterHours: 50, now }); assert.equal(old.recovered, false, 'a recovery older than the window is not shown'); assert.equal(old.state, 'STALE');
  const bad = T.runSummary([r('2026-10-16T08:00:00Z', 'ok'), r('2026-10-17T08:00:00Z', 'refused', 'HTTP 403')], { staleAfterHours: 50, now }); assert.equal(bad.recovered, false); assert.equal(bad.state, 'REFUSED'); assert.equal(bad.latestSuccessAt, '2026-10-16T08:00:00Z');
});
t('the catalogue lists alerts only for sources PROPX reads whose state is not good, recovered sources, and sources whose own content is stale — ordered by severity; no fake green', () => {
  const c = T.catalog({ now: NOW });
  assert.ok(Array.isArray(c.alerts) && c.recoveryWindowDays === 7);
  /* SOURCE_LAG (the daily transaction-freshness monitor's lag alerts, P0 19.10.2026) is a content alert like SOURCE_STALE */
  for (const a of c.alerts) { assert.ok(['REFUSED', 'FAILED', 'SCHEMA_CHANGED', 'STALE', 'PARTIAL', 'RECOVERED', 'SOURCE_STALE', 'SOURCE_LAG'].includes(a.kind), a.id); const s = c.sources.find((x) => x.id === a.id); assert.ok(s && s.inProduct !== false, a.id); if (!['RECOVERED', 'SOURCE_STALE', 'SOURCE_LAG'].includes(a.kind)) assert.equal(s.sync.state, a.kind); }
  const ranks = c.alerts.map((a) => ({ REFUSED: 0, SCHEMA_CHANGED: 1, FAILED: 2, STALE: 3, PARTIAL: 4, SOURCE_LAG: 5, SOURCE_STALE: 6, RECOVERED: 7 })[a.kind]); assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  for (const s of c.sources) if (s.sync && s.sync.tally) assert.equal(s.sync.tally.total, s.sync.tally.good + s.sync.tally.bad);
});
t('the API routes scan, scanGeo, revisions and supply; the radar build writes scan.json', () => {
  const api = fs.readFileSync(path.join(ROOT, 'api/intel.js'), 'utf8');
  for (const v of ["view === 'scan'", "view === 'scanGeo'", "view === 'revisions'", "view === 'supply'"]) assert.ok(api.includes(v), v);
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts/radar-build.js'), 'utf8'), /scan\.json/);
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/radar/scan.json'), 'utf8')); assert.equal(f.schema, 1); assert.ok(f.counts.geographies >= 8);
});

t('review fixes: RECOVERED expires — anchored on the FIRST good check after the failure; the net change by geography sums MONTHLY revisions only; rank never compares values across rules', () => {
  const r = (at, status, error) => ({ id: 'x', finishedAt: at, status, error, retrievalMethod: 'live-api' });
  const now = Date.parse('2026-10-17T12:00:00Z');
  const runs = [r('2026-09-07T08:00:00Z', 'failed', 'HTTP 500')]; for (let i = 1; i <= 40; i++) runs.push(r(new Date(Date.parse('2026-09-07T08:00:00Z') + i * 86400e3).toISOString(), 'ok'));
  const s = T.runSummary(runs, { staleAfterHours: 50, now }); assert.equal(s.recovered, false, 'a recovery 40 days ago is not "this week"'); assert.equal(s.latestFailureAt, '2026-09-07T08:00:00Z');
  const fresh = T.runSummary([r('2026-10-14T08:00:00Z', 'failed', 'x'), r('2026-10-15T08:00:00Z', 'ok'), r('2026-10-16T08:00:00Z', 'ok')], { staleAfterHours: 50, now }); assert.equal(fresh.recovered, true); assert.equal(fresh.recoveredAt, '2026-10-15T08:00:00Z', 'the first good check after the failure, not the latest');
  const v = REV.revisions({ window: 'all' }, { now: NOW }); for (const x of v.rows) assert.ok(x.freq === 'M' || x.freq === 'Y' || x.freq == null, x.id);
  const allRows = REV.items(); for (const R of v.releases) for (const g of R.byGeo) { const monthly = allRows.filter((x) => x.publishedAt === R.publishedAt && x.geo === g.geo && x.measure === 'new_sold' && x.freq === 'M').reduce((s, x) => s + x.delta, 0); assert.equal(g.netDelta, monthly, g.geo + ' monthly net'); assert.ok(!/^\d{4}$/.test(g.to) || !/\d{4}-\d{2}/.test(g.from), 'from/to never mix annual and monthly keys'); }
  assert.equal(REV.revisions({ window: 'all' }, { now: NOW }).since, null);
  const P = S.load({ now: NOW }); const ms = P.opportunities.map((x) => x.m); assert.deepEqual(ms, [...ms].sort((a, b) => b - a), 'materiality first');
});
console.log(`scan · revisions · trust 2.0: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
