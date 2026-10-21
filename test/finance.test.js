// PROPX · housing finance (lib/finance, Bank of Israel SDMX) — offline gates on the labelled fixture built from the 21.10.2026 discovery
// read: codes select the series, names verify the codes, exactly one series per measure, base units, revisions appended, failures never 0,
// DERIVED shares inside one month, freshness on the documented lag, the workflow's scope. Run: node test/finance.test.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const F = require('../lib/finance');
const { MEASURES } = require('../lib/finance/series');

const ROOT = path.join(__dirname, '..');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'boi-finance-2026-10-21.json'), 'utf8'));
let passed = 0, failed = 0;
const pending = [];
const t = (name, fn) => pending.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'propx-fin-'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-10-21T12:00:00Z');
/* the fixture served as the Bank of Israel would: structure (sdmx-json) and data (CSV) per flow */
const server = (fx = FX, { fail = null } = {}) => async (url) => {
  const flow = Object.keys(fx.flows).find((f) => url.includes('/' + f + '/'));
  if (fail) throw new Error(fail);
  if (!flow) throw new Error('HTTP 404 for ' + url);
  return url.includes('/structure/') ? JSON.stringify(fx.flows[flow].structure) : fx.flows[flow].csv;
};

t('the fixture is labelled and never read by the product', () => {
  assert.match(FX.note, /^TEST FIXTURE — never read by the product/); assert.match(FX.note, /FIXTURE INSERTION/);
  for (const f of ['lib/finance/index.js', 'lib/finance/series.js', 'scripts/finance-sync.js']) assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('boi-finance-2026-10-21'), f);
});

t('CODES select the series and NAMES verify the codes: every measure resolves to exactly one series; the unpublished variable unindexed track is NOT PUBLISHED, never 0', async () => {
  const dir = tmp();
  const r = await F.runSync({ dir, fetchText: server(), now: NOW });
  assert.equal(r.status, 'success');
  const st = r.state;
  assert.equal(st.newLoans.series, 'BNK_99034_LR_BIR_MRTG_897'); assert.equal(st.newLoansSA.series, 'BNK_99034_LM_BIR_MRTG_897_SA');
  assert.equal(st.rateFixedUnindexed.series, 'BNK_99034_LR_BIR_MRTG_467'); assert.equal(st.balance.series, 'BNK_99034_LR_MRTG_OL_7');
  assert.deepEqual(MEASURES.filter((m) => st[m.id].state !== 'OK').map((m) => [m.id, st[m.id].state]), [['variableUnindexedAnchor', 'NOT_PUBLISHED'], ['variableUnindexedMargin', 'NOT_PUBLISHED']]);
  const M = r.latest.measures;
  assert.equal(M.variableUnindexedAnchor.latest, null); assert.equal(M.variableUnindexedAnchor.missing, 'series-not-published'); assert.equal(M.variableUnindexedAnchor.state, 'MISSING');
  const ids = new Set(MEASURES.filter((m) => st[m.id].series).map((m) => st[m.id].series)); assert.equal(ids.size, MEASURES.length - 2, 'no two measures read the same series');
});

t('UNITS: amounts in ₪ after the series multiplier (thousands × 1,000), counts as counts, rates as % a year; a missing observation is skipped, never 0', async () => {
  const r = await F.runSync({ dir: tmp(), fetchText: server(), now: NOW });
  const M = r.latest.measures;
  assert.equal(M.newLoans.latest.period, '2026-09'); assert.equal(M.newLoans.latest.value, 8668214640);
  assert.equal(M.newLoansCount.latest.value, 10272); assert.equal(M.rateFixedUnindexed.latest.value, 4.62); assert.equal(M.rateFixedUnindexed.unit, '% a year');
  assert.equal(M.balance.latest.value, 673286856000);
  assert.equal(M.rateFixedUnindexed.latest.changeUnit, 'percentage points'); assert.equal(M.newLoans.latest.changeUnit, '%');
  const fx = clone(FX); fx.flows.BIR_MRTG_99.csv = fx.flows.BIR_MRTG_99.csv.replace(/(BNK_99034_LR_BIR_MRTG_467,[^\n]*,2026-08,)4\.62,/, '$1,');
  const r2 = await F.runSync({ dir: tmp(), fetchText: server(fx), now: NOW });
  assert.equal(r2.latest.measures.rateFixedUnindexed.latest.period, '2026-07', 'the empty August value is skipped — the latest held month is July');
});

t('a code whose NAME changed is not read (SCHEMA_CHANGED, named in the run) — the other measures still are; nothing is applied from it', async () => {
  const fx = clone(FX);
  const bs = fx.flows.BIR_MRTG_99.structure.data.codelists.find((c) => c.codes.some((k) => k.id === 'A2C5'));
  bs.codes.find((k) => k.id === 'A2C5').names.he = 'אשראי צרכני אחר';
  const r = await F.runSync({ dir: tmp(), fetchText: server(fx), now: NOW });
  assert.equal(r.status, 'partial');
  assert.equal(r.state.investmentLoans.state, 'SCHEMA_CHANGED'); assert.match(r.state.investmentLoans.problem, /BS_ITEM=A2C5: named "אשראי צרכני אחר"/);
  assert.equal(r.latest.measures.investmentLoans.latest, null); assert.equal(r.latest.derived.investmentShare, null);
  assert.equal(r.state.newLoans.state, 'OK');
  assert.ok(r.run.problems.some((p) => /^investmentLoans: SCHEMA_CHANGED/.test(p)));
});

t('EXACTLY ONE series per measure: a second series under the same codes is AMBIGUOUS — neither is read', async () => {
  const fx = clone(FX);
  const rows = fx.flows.BIR_MRTG_99.csv.split('\n'), twin = rows.filter((l) => l.startsWith('BNK_99034_LR_BIR_MRTG_467,')).map((l) => l.replace('BNK_99034_LR_BIR_MRTG_467,', 'BNK_99034_LR_BIR_MRTG_9467,'));
  fx.flows.BIR_MRTG_99.csv = rows.concat(twin).join('\n');
  const r = await F.runSync({ dir: tmp(), fetchText: server(fx), now: NOW });
  assert.equal(r.state.rateFixedUnindexed.state, 'SCHEMA_CHANGED'); assert.match(r.state.rateFixedUnindexed.problem, /ambiguous: 2 series match/);
});

t('the LEDGER is append-only: an unchanged read appends nothing (UNCHANGED); a revised value is a new revision with the value it replaces', async () => {
  const dir = tmp();
  const a = await F.runSync({ dir, fetchText: server(), now: NOW });
  const n = fs.readFileSync(path.join(dir, 'observations.jsonl'), 'utf8').trim().split('\n').length;
  assert.equal(n, a.merge.added);
  const b = await F.runSync({ dir, fetchText: server(), now: new Date('2026-10-22T12:00:00Z') });
  assert.equal(b.status, 'unchanged'); assert.equal(b.merge.append.length, 0);
  assert.equal(b.latest.readAt, NOW.toISOString(), 'the read time stays the last content change'); assert.equal(b.latest.checkedAt, '2026-10-22T12:00:00.000Z');
  const fx = clone(FX); fx.flows.BIR_MRTG_99.csv = fx.flows.BIR_MRTG_99.csv.replace(/(BNK_99034_LR_BIR_MRTG_467,[^\n]*,2026-08,)4\.62,/, '$14.65,');
  const c = await F.runSync({ dir, fetchText: server(fx), now: new Date('2026-10-23T12:00:00Z') });
  assert.equal(c.status, 'success'); assert.equal(c.merge.revised, 1);
  const rev = fs.readFileSync(path.join(dir, 'observations.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter((x) => x.measure === 'rateFixedUnindexed' && x.period === '2026-08');
  assert.deepEqual(rev.map((x) => [x.revision, x.value, x.replaces]), [[0, 4.62, undefined], [1, 4.65, 4.62]]);
  assert.equal(c.latest.measures.rateFixedUnindexed.latest.value, 4.65);
  assert.equal(fs.readFileSync(path.join(dir, 'sync-runs.jsonl'), 'utf8').trim().split('\n').length, 3);
});

t('a FAILED or REFUSED source writes nothing but the run log: the stored figures stay (never 0, never removed)', async () => {
  const dir = tmp();
  await F.runSync({ dir, fetchText: server(), now: NOW });
  const before = fs.readFileSync(path.join(dir, 'latest.json'), 'utf8');
  const r = await F.runSync({ dir, fetchText: server(FX, { fail: 'HTTP 403 for https://edge.boi.gov.il/…' }), now: new Date('2026-10-22T12:00:00Z') });
  assert.equal(r.status, 'refused'); assert.equal(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'), before);
  const f = await F.runSync({ dir, fetchText: async () => '<html>Radware</html>', now: new Date('2026-10-23T12:00:00Z') });
  assert.ok(['schema_changed', 'failed'].includes(f.status)); assert.equal(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'), before);
  const runs = fs.readFileSync(path.join(dir, 'sync-runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(runs.map((x) => x.status), ['success', 'refused', f.status]);
  assert.equal(F.summary(dir).headline.find((h) => h.id === 'newLoans').value, 8668214640, 'the held value is still served');
});

t('DERIVED figures are named, inside ONE month, with their formula — band shares over the published bands, ratios on the latest month both series hold', async () => {
  const r = await F.runSync({ dir: tmp(), fetchText: server(), now: NOW });
  const D = r.latest.derived;
  for (const k of ['ltvShares', 'ptiShares']) { assert.equal(D[k].class, 'DERIVED'); assert.equal(D[k].period, '2026-08'); assert.ok(Math.abs(D[k].bands.reduce((a, b) => a + b.sharePct, 0) - 100) < 0.5); assert.match(D[k].denominator, /sum of the published bands/); }
  assert.equal(D.investmentShare.period, '2026-08', 'August: the total amount has September, the investment loans do not — August is compared');
  assert.equal(D.investmentShare.valuePct, 8.15); assert.equal(D.arrearsShare.valuePct, 0.61); assert.equal(D.averageNewLoan.period, '2026-08');
  assert.ok(Object.values(D).every((x) => !x || x.class === 'DERIVED'));
  const S = F.summary;
  assert.match(r.latest.note, /never summed by PROPX/); assert.match(r.latest.note, /Never a locality or district figure/);
});

t('FRESHNESS on the documented lag: CURRENT ≤ 75 days after the month · EXPECTED_REPORTING_LAG ≤ 120 · STALE beyond; nothing held = MISSING', () => {
  assert.equal(F.freshness('2026-09', Date.parse('2026-10-21T00:00:00Z')).state, 'CURRENT');
  assert.equal(F.freshness('2026-06', Date.parse('2026-10-21T00:00:00Z')).state, 'EXPECTED_REPORTING_LAG');
  assert.equal(F.freshness('2026-05', Date.parse('2026-10-21T00:00:00Z')).state, 'STALE');
  assert.equal(F.freshness(null, Date.now()).state, 'MISSING');
  assert.equal(F.summary(tmp()).missing, 'finance-not-synced');
});

t('the WORKFLOW tests before it writes and commits only data/finance; the CLI reads GET only, one request a second, from the Bank of Israel host', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/finance-sync.yml'), 'utf8');
  assert.ok(wf.indexOf('node test/finance.test.js') < wf.indexOf('node scripts/finance-sync.js'));
  assert.match(wf, /git add data\/finance\n/); assert.ok(!/git add (?!data\/finance)/.test(wf));
  const cli = fs.readFileSync(path.join(ROOT, 'scripts/finance-sync.js'), 'utf8');
  assert.match(cli, /1000 - \(Date\.now\(\) - last\)/); assert.ok(!/method:\s*['"](POST|PUT|DELETE)/.test(cli));
  for (const m of MEASURES) { const u = F.urlOf(m.flow); assert.ok(u.data.startsWith('https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/')); assert.match(u.data, /startperiod=2016-01&format=csv$/); }
});

t('WIRING: the dossier carries the finance block as NATIONAL context on every geography (never a local figure); the API, the page, the registry and the deployed bundle read it', () => {
  const DQ = require('../lib/dossier/query');
  const stored = F.read();
  for (const [level, code] of [['il', null], ['locality', '7900']]) {
    const d = DQ.dossier({ level, code }); const S = d.sections.finance;
    if (!stored) { assert.equal(S, undefined); assert.ok(d.missing.some((m) => m.id === 'finance-not-synced')); continue; }
    assert.equal(S.cls, 'OFFICIAL'); assert.equal(S.source, 'boi:housing-finance'); assert.equal(S.geoScope, level === 'il' ? 'own' : 'national');
    assert.match(S.scope.en, /national — the whole banking system; context, not a local figure/);
    assert.ok(S.headline.every((h) => h.missing || (h.period && h.value != null)), 'every headline figure has its month, or its reason');
    assert.ok(d.freshness.some((f) => f.id === 'finance'));
  }
  const api = fs.readFileSync(path.join(ROOT, 'api/intel.js'), 'utf8'); assert.match(api, /view === 'finance'/);
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /function dsFinanceHTML\(D\)/); assert.match(page, /\$\{dsFinanceHTML\(D\)\}/);
  for (const x of ['mortgage_rate_by_track', 'new_housing_loans', 'loan_to_value_band', 'housing_credit_stock']) { assert.ok(page.includes(`"${x}"`), 'page ⓘ ' + x); assert.ok(require('../lib/explain/registry').term(x), 'registry ' + x); }
  assert.ok(/dsFin:\{title:"מימון דיור/.test(page) && /dsFin:\{title:"Housing finance/.test(page), 'he + en');
  const vc = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')); assert.ok(require('./helpers/vercel-include').matches(vc.functions['api/intel.js'].includeFiles, 'data/finance/latest.json'));
  const C = require('../lib/trust/catalog').catalog(); assert.ok(C.sources.some((s) => s.id === 'boi:housing-finance'));
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
  }
  console.log(`finance: ${passed} passed${failed ? ', ' + failed + ' FAILED' : ''}`);
  process.exit(failed ? 1 : 0);
})();
