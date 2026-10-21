'use strict';
/* PROPX · FRESHNESS AUDIT (22.10.2026) — the gates.
 *
 * One row per source: latest observation · publication · ingestion · last check · cadence · state · evidence — four dates never one.
 * And the regressions found by the audit: the national detector's unchanged checks were never recorded (a `git log` in a depth-1
 * checkout answers with the branch head), the finance run log's single `at` left its Trust entry undated, the coverage audit counted
 * GovMap rows FOLDED into a register event as missed, and the street-geography build lost its push to a binary rebase conflict. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const FA = require('../lib/trust/freshness-audit');
const RL = require('../lib/txevents/runlog');
const KIT = require('../lib/txevents/kit');
const CAT = require('../lib/trust/catalog');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0, failed = 0;
const results = [];
const t = (name, fn) => results.push([name, fn]);
const NOW = Date.parse('2026-10-21T22:30:00Z');
const line = (o) => JSON.stringify(o);

console.log('freshness-audit: the per-source inventory and its regressions');

/* ── the national detector's record decision ── */
t('RECORD DECISION: an unchanged check is recorded at most every 12 hours, from the run log itself — a build, a new version or a failure always', () => {
  const at = (h) => new Date(NOW - h * 3600e3).toISOString();
  const log = (...xs) => xs.map(line).join('\n') + '\n';
  assert.equal(RL.recordDecision(log({ kind: 'build', at: at(3), status: 'SUCCESS' }, { kind: 'check', at: at(0), status: 'UNCHANGED' }), { now: NOW }).record, false, '3 h after the last record: skip');
  assert.equal(RL.recordDecision(log({ kind: 'check', at: at(13), status: 'UNCHANGED' }, { kind: 'check', at: at(0), status: 'UNCHANGED' }), { now: NOW }).record, true, '13 h: record');
  assert.equal(RL.recordDecision(log({ kind: 'check', at: at(12), status: 'UNCHANGED' }, { kind: 'check', at: at(0), status: 'UNCHANGED' }), { now: NOW }).record, true, 'exactly 12 h: record');
  for (const status of ['NEW_VERSION', 'FAILED', 'SUCCESS']) assert.equal(RL.recordDecision(log({ kind: 'check', at: at(1), status: 'UNCHANGED' }, { kind: 'check', at: at(0), status }), { now: NOW }).record, true, status + ' is always recorded');
  assert.equal(RL.recordDecision('', { now: NOW }).record, true, 'no log: record');
  assert.equal(RL.recordDecision(log({ kind: 'check', at: at(0), status: 'UNCHANGED' }), { now: NOW }).record, true, 'a first line: record');
  assert.equal(RL.recordDecision(log({ kind: 'check', at: at(20), status: 'UNCHANGED' }) + '{torn\n' + line({ kind: 'check', at: at(0), status: 'UNCHANGED' }), { now: NOW }).record, true, 'a torn line is skipped, the record still found');
});
t('REGRESSION (GitHub runs 39596014029 · 39642748425 · 39681669082): on the stored run log, the checks of 21.10.2026 11:59 / 17:19 / 21:48 UTC are RECORDED — 04:58 is not', () => {
  const stored = read('data/txevents/national/runs.jsonl');
  const lastAt = stored.trim().split('\n').map((l) => JSON.parse(l)).map((r) => r.at).sort().pop();
  const check = (iso) => RL.recordDecision(stored + line({ kind: 'check', at: iso, status: 'UNCHANGED' }) + '\n', { now: Date.parse(iso) });
  if (lastAt === '2026-10-20T18:55:44.262Z') {   // the log as the audit found it
    for (const iso of ['2026-10-21T11:59:17.925Z', '2026-10-21T17:19:30.000Z', '2026-10-21T21:48:10.000Z']) assert.equal(check(iso).record, true, iso);
    assert.equal(check('2026-10-21T04:58:30.000Z').record, false, '10 h after the last record: skip');
  } else {                                        // a later log: the rule itself, from its own last line
    assert.equal(check(new Date(Date.parse(lastAt) + 13 * 3600e3).toISOString()).record, true);
    assert.equal(check(new Date(Date.parse(lastAt) + 2 * 3600e3).toISOString()).record, false);
  }
});
t('THE WORKFLOW decides through `--record-decision` — never `git log` in the shallow checkout; the commit step is valid bash', () => {
  const y = read('.github/workflows/txevents-national.yml');
  const step = y.slice(y.indexOf('- name: Commit'));
  assert.ok(!step.split('\n').filter((l) => !/^\s*#/.test(l)).some((l) => /git log/.test(l)), 'no git log command in the commit step');
  assert.match(step, /DECISION=\$\(node scripts\/txevents-national\.js --record-decision \|\| echo record\)/);
  assert.match(step, /if \[ "\$DECISION" = "skip" \]; then echo 'Unchanged — recorded in the run history only\.'; exit 0; fi/);
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'txevents-national.js'), '--record-decision'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  assert.ok(out === 'record' || out === 'skip', 'prints record | skip');
  bashSyntax(step);
});
function bashSyntax(stepText) {
  const body = stepText.slice(stepText.indexOf('run: |') + 6).split('\n').filter((l, i) => i === 0 || /^ {10}|^\s*$/.test(l)).map((l) => l.replace(/^ {10}/, '')).join('\n');
  try { execFileSync('bash', ['-n'], { input: body, stdio: ['pipe', 'ignore', 'pipe'] }); } catch (e) { if (e.code === 'ENOENT') return; throw new Error('bash -n: ' + String(e.stderr || e.message)); }
}

/* ── the Trust catalogue ── */
t('TRUST: a run log that dates a run once (`at`, data/finance/sync-runs.jsonl) is dated — the finance lane is no longer undated', () => {
  const runs = read('data/finance/sync-runs.jsonl').trim().split('\n').map((l) => JSON.parse(l));
  const c = CAT.catalog({ now: NOW }).sources.find((s) => s.id === 'boi:housing-finance');
  assert.ok(c && c.sync.lastCheckAt, 'lastCheckAt set');
  assert.equal(c.sync.lastCheckAt, runs[runs.length - 1].at);
  const s = CAT.runSummary([{ id: 'x', at: '2026-10-21T13:34:59.019Z', status: 'success' }], { staleAfterHours: 100, now: NOW });
  assert.equal(s.lastCheckAt, '2026-10-21T13:34:59.019Z'); assert.equal(s.lastGoodAt, '2026-10-21T13:34:59.019Z');
  assert.equal(CAT.runSummary([{ id: 'x', at: '2026-10-10T00:00:00Z', status: 'success' }], { staleAfterHours: 100, now: NOW }).state, 'STALE', 'an old `at` can now go STALE');
});
t('TRUST: the national detector is STALE only beyond 24 hours (12 h recording gap + the 4.5–7 h observed schedule interval)', () => {
  const c = (now) => CAT.catalog({ now }).sources.find((s) => s.id === 'over:govmap-national');
  const x = c(NOW);
  assert.equal(x.sync.expectedCadenceHours, 24);
  const last = Date.parse(x.sync.lastGoodAt);
  assert.notEqual(c(last + 23 * 3600e3).sync.state, 'STALE');
  assert.equal(c(last + 25 * 3600e3).sync.state, 'STALE');
});

t('TRUST: the national file\'s latest observation is never a FUTURE-DATED row (the file\'s own maximum 2048-05-29 is INVALID)', () => {
  const c = CAT.catalog({ now: NOW }).sources.find((s) => s.id === 'over:govmap-national');
  const nm = JSON.parse(read('data/txevents/national/meta.json'));
  const loadDay = String(nm.version.detectedAt).slice(0, 10);
  assert.ok(c.latestObservation == null || c.latestObservation <= loadDay, `latest observation ${c.latestObservation} after the load day ${loadDay}`);
  if (nm.file.dates.max > loadDay) assert.match(c.latestObservationKind, /INVALID/);
});

/* ── the coverage audit's accounting ── */
t('COVERAGE AUDIT: a GovMap row FOLDED into a register event of the same read is never "missed"; a row neither shown nor folded is', () => {
  const folds = new Map([['gm:2', 'regx:a'], ['gm:3', 'regx:gone']]);
  const a = KIT.surfaceAccount(['gm:1', 'gm:2', 'gm:3', 'gm:4'], new Set(['gm:1', 'regx:a']), folds);
  assert.deepEqual({ rows: a.rows, surfaced: a.surfaced, folded: a.folded, missed: a.missed }, { rows: 4, surfaced: 1, folded: 1, missed: 2 });
  assert.deepEqual(a.missedIds, ['gm:3', 'gm:4'], 'a fold into an event the read does not show is missed');
  const TX = require('../lib/txevents');
  assert.equal(KIT.gmIdOf({ dealId: 1136, oid: 7 }), TX.gmEvent({ dealId: 1136, oid: 7, date: '2026-09-01' }, 'over:govmap-recent', null).id);
  assert.equal(KIT.gmIdOf({ dealId: null, oid: 7 }), TX.gmEvent({ dealId: null, oid: 7, date: '2026-09-01' }, 'over:govmap-national', null).id);
  assert.deepEqual([...KIT.foldsOf([['regx:a', { dealId: 5, oid: 9 }], ['regx:b', { dealId: null, oid: 11 }]])], [['gm:5', 'regx:a'], ['gm:o11', 'regx:b']]);
});
t('COVERAGE AUDIT on the stored data (locality 1072): every GovMap row is an event or folded into a register event the read shows — 0 missed', () => {
  const TX = require('../lib/txevents'), RECENT = require('../lib/recent/read');
  const S = TX.stores(), L = RECENT.load(), code = 1072;
  const ids = [];
  if (L.layer) for (const i of L.layer.byCode[String(code)] || []) { const r = L.layer.rows[i]; ids.push(KIT.gmIdOf({ dealId: r[1], oid: r[0] })); }
  if (S.national) for (const i of S.national.byCode[String(code)] || []) { const r = S.national.rows[i]; ids.push(KIT.gmIdOf({ dealId: r[1], oid: r[0] })); }
  const q = TX.query({ code, all: true, unlimited: true, today: '2026-10-21' });
  const evIds = new Set(q.events.map((e) => e.id));
  const folds = KIT.foldsOf(TX.layerEventsOf(code, S).evidence);
  const a = KIT.surfaceAccount(ids, evIds, folds);
  assert.equal(a.missed, 0, 'missed ' + a.missedIds.join(','));
  assert.equal(a.surfaced + a.folded, ids.length);
  if (a.folded) assert.ok(ids.filter((id) => !evIds.has(id)).length === a.folded, 'the pre-22.10 rule (event ids only) would have counted each folded row as missed');
  const src = read('scripts/txevents-audit.js');
  assert.match(src, /KIT\.surfaceAccount\(gmRows\.map\(\(r\) => r\.id\), ids, foldsOf\(code\)\)/, 'the locality pass uses the accounting');
  assert.match(src, /KIT\.surfaceAccount\(gmOnStreet\.map\(\(r\) => r\.id\), ids, foldsOf\(c\.code\)\)/, 'the street sample too');
});

/* ── the street-geography build's commit ── */
t('STREET GEO BUILD (run 39560045045): the commit places the whole build on the newest branch head — no rebase of binary files', () => {
  const y = read('.github/workflows/street-geo-build.yml');
  const step = y.slice(y.indexOf('- name: Commit'));
  assert.ok(!/pull -q --rebase/.test(step), 'no rebase of the binary build');
  assert.match(step, /git fetch -q --depth=1 origin "\$GITHUB_REF_NAME" && git reset -q --hard FETCH_HEAD/);
  assert.match(step, /rm -rf data\/geo\/street-geo && cp -a "\$BUILD" data\/geo\/street-geo/);
  assert.match(step, /git add -A data\/geo\/street-geo/);
  assert.match(y, /concurrency:\s*\n\s*group: street-geo-build\s*\n\s*cancel-in-progress: false/, 'runs serialized — the latest build wins');
  bashSyntax(step);
});

/* ── the read model ── */
t('THE STATE RULE: REFUSED › FAILING › CHECK_STALE › SOURCE_STALE › EXPECTED_LAG › CURRENT; no schedule → DATED_BUILD / NO_RUN', () => {
  const base = { scheduled: true, runState: 'SUCCESS', lastGoodAt: '2026-10-21T20:00:00Z', lastCheckAt: '2026-10-21T20:00:00Z', staleAfterHours: 50, lagState: 'CURRENT', now: NOW };
  assert.equal(FA.stateOf(base).state, 'CURRENT');
  assert.equal(FA.stateOf({ ...base, runState: 'REFUSED', lagState: 'SOURCE_STALE' }).state, 'REFUSED');
  assert.equal(FA.stateOf({ ...base, runState: 'FAILED' }).state, 'FAILING');
  assert.equal(FA.stateOf({ ...base, runState: 'SCHEMA_CHANGED' }).state, 'FAILING');
  assert.equal(FA.stateOf({ ...base, lastGoodAt: '2026-10-19T00:00:00Z', lagState: 'SOURCE_STALE' }).state, 'CHECK_STALE');
  assert.equal(FA.stateOf({ ...base, lagState: 'SOURCE_STALE' }).state, 'SOURCE_STALE');
  assert.equal(FA.stateOf({ ...base, lagState: 'EXPECTED_LAG' }).state, 'EXPECTED_LAG');
  assert.equal(FA.stateOf({ ...base, lagState: null }).state, 'CURRENT');
  assert.equal(FA.stateOf({ ...base, scheduled: false }).state, 'DATED_BUILD');
  assert.equal(FA.stateOf({ ...base, scheduled: false, lastGoodAt: null, lastCheckAt: null, builtAt: '2026-10-21' }).state, 'DATED_BUILD');
  assert.equal(FA.stateOf({ ...base, scheduled: false, lastGoodAt: null, lastCheckAt: null }).state, 'NO_RUN');
  assert.equal(FA.stateOf({ ...base, lastGoodAt: null, lastCheckAt: null }).state, 'NO_RUN');
  assert.deepEqual(FA.STATES, ['REFUSED', 'FAILING', 'CHECK_STALE', 'SOURCE_STALE', 'EXPECTED_LAG', 'CURRENT', 'DATED_BUILD', 'NO_RUN']);
  for (const s of FA.STATES) assert.ok(FA.STATE_MEANING[s], 'meaning of ' + s);
});
t('CBS INDEX LAG (a stated ASSUMPTION, never an official calendar): monthly ≈ the 15th of the next month; a two-month window ≈ the 15th of the second month after', () => {
  assert.equal(FA.cbsIndexLag({ year: 2026, month: 9 }, 'monthly', '2026-10-21').state, 'CURRENT');
  assert.equal(FA.cbsIndexLag({ year: 2026, month: 8 }, 'monthly', '2026-10-21').state, 'SOURCE_STALE');
  assert.equal(FA.cbsIndexLag({ year: 2026, month: 8 }, 'monthly', '2026-10-17').state, 'EXPECTED_LAG');
  assert.equal(FA.cbsIndexLag({ year: 2026, month: 8 }, 'monthly', '2026-10-14').state, 'CURRENT', 'before the 16th the previous month is still the expected one');
  assert.equal(FA.cbsIndexLag({ year: 2026, month: 7 }, 'bimonthly', '2026-10-21').state, 'CURRENT');
  assert.equal(FA.cbsIndexLag({ year: 2026, month: 6 }, 'bimonthly', '2026-10-21').state, 'SOURCE_STALE');
  assert.equal(FA.cbsIndexLag({ year: 2025, month: 12 }, 'monthly', '2026-01-21').state, 'CURRENT', 'year boundary');
  assert.match(FA.cbsIndexLag({ year: 2026, month: 9 }, 'monthly', '2026-10-21').basis, /^ASSUMPTION/);
});
t('SCHEDULES are the workflow files\' own cron lines; previous / next fire computed in UTC', () => {
  assert.deepEqual(FA.cronOf('txevents-national.yml'), ['23 */3 * * *']);
  assert.deepEqual(FA.cronOf('tx-freshness.yml'), ['23 5,17 * * *']);
  assert.deepEqual(FA.cronOf('street-geo-build.yml'), [], 'no schedule');
  assert.deepEqual(FA.cronFires(['23 */3 * * *'], NOW), { previous: '2026-10-21T21:23:00.000Z', next: '2026-10-22T00:23:00.000Z' });
  assert.deepEqual(FA.cronFires(['23 4 * * 1'], NOW), { previous: '2026-10-19T04:23:00.000Z', next: '2026-10-26T04:23:00.000Z' }, 'Mondays');
  assert.deepEqual(FA.cronFires(['23 12 * * 0-4'], NOW), { previous: '2026-10-21T12:23:00.000Z', next: '2026-10-22T12:23:00.000Z' }, 'Sun–Thu');
});
t('NEWER COPY → THE WORKFLOW THAT INGESTS IT: register → street-evidence-sync · GovMap copy → street-recent-sync · version → txevents-national (force)', () => {
  const ev = { source: { scrapedAt: '2026-09-19 11:07:39.013275+00' } };
  const rm = { source: { loadedAt: '2026-10-08T01:50:12+00:00' }, register: { scrapedAt: '2026-09-19 11:07:39.013275+00' } };
  const nm = { version: { id: 'v4', n: 4 }, file: { sha256: 'aaa' } };
  const same = { register: { snapshotAt: '2026-09-19 11:07:39.013275+00' }, govmapLayer: { snapshotAt: '2026-10-08T01:50:12+00:00' } };
  assert.deepEqual(FA.newerCopyActions({ evidenceMeta: ev, recentMeta: rm, monitor: same, nationalMeta: nm, nationalLastCheck: { govmap: { id: 'v4', n: 4 }, registerChanged: false }, streetGeoMeta: { file: { sha256: 'aaa' } } }), [], 'nothing newer → nothing to dispatch');
  const a = FA.newerCopyActions({ evidenceMeta: ev, recentMeta: rm, monitor: { register: { snapshotAt: '2026-10-20 03:00:00+00' }, govmapLayer: { snapshotAt: '2026-10-21T01:00:00+00:00' } }, nationalMeta: nm, nationalLastCheck: { govmap: { id: 'v5', n: 5 } }, streetGeoMeta: { file: { sha256: 'bbb' } } });
  const by = Object.fromEntries(a.map((x) => [x.kind, x]));
  assert.equal(by.NEW_COPY_NOT_SWEPT.workflow, 'street-evidence-sync.yml');
  assert.equal(by.NEW_COPY_NOT_READ.workflow, 'street-recent-sync.yml');
  assert.equal(by.NEW_VERSION_NOT_BUILT.workflow, 'txevents-national.yml'); assert.deepEqual(by.NEW_VERSION_NOT_BUILT.inputs, { force: true });
  assert.equal(by.STREET_GEO_OLDER_FILE.workflow, 'street-geo-build.yml');
  const b = FA.newerCopyActions({ evidenceMeta: ev, recentMeta: { ...rm, register: { scrapedAt: '2026-08-01 00:00:00+00' } }, monitor: same, nationalMeta: nm, nationalLastCheck: { govmap: { id: 'v4' } } });
  assert.deepEqual(b.map((x) => x.kind), ['RECENT_NOT_RECONCILED']);
});
t('THE AUDIT over the stored data: pure and deterministic; every row carries the four dates apart, a cadence, one state from the vocabulary, evidence paths', () => {
  const a = FA.audit({ now: NOW }), b = FA.audit({ now: NOW });
  assert.deepEqual(a, b, 'same inputs → same output');
  assert.equal(a.engine, FA.ENGINE);
  assert.ok(a.entries.length >= 40, 'every lane');
  const ids = new Set();
  for (const e of a.entries) {
    assert.ok(!ids.has(e.id), 'one row per id: ' + e.id); ids.add(e.id);
    for (const k of ['latestObservation', 'publication', 'ingestion', 'lastCheck', 'cadence', 'state', 'stateRule', 'evidence']) assert.ok(k in e, `${e.id}: ${k}`);
    assert.ok(FA.STATES.includes(e.state), e.id + ' ' + e.state);
    assert.ok(Array.isArray(e.evidence) && e.evidence.length, e.id + ' evidence');
    for (const p of e.evidence) { const f = p.split(' ')[0]; if (/^(data|lib)\//.test(f)) assert.ok(fs.existsSync(path.join(ROOT, f)), `${e.id}: ${f} exists`); }
  }
  for (const id of ['over:street-evidence', 'over:govmap-recent', 'over:govmap-national', 'cbs:new-home-sales', 'cbs:construction', 'cbs:newHomesIndex', 'boi:policy-rate', 'boi:housing-finance',
    'rmi:michrazim', 'datagov:moch:urban-renewal-complexes', 'datagov:moch:dira-behanacha-lotteries', 'dira-lehaskir:tenders', 'iplan:vatmal', 'propx:plan-boundaries', 'datagov:mot:bus-stops',
    'datagov:moep:contaminated-land', 'datagov:piba:residents-by-locality', 'cbs:average-dwelling-price', 'govmap:tax-authority-deals']) assert.ok(ids.has(id), 'covers ' + id);
  const by = Object.fromEntries(a.entries.map((e) => [e.id, e]));
  assert.equal(by['govmap:tax-authority-deals'].state, 'REFUSED', 'the official channel refuses — never worked around');
  assert.equal(by['propx:plan-boundaries'].state, 'DATED_BUILD', 'no schedule');
  assert.equal(by['cbs:average-dwelling-price'].state, 'DATED_BUILD', 'transcribed by hand');
});
t('TRANSACTIONS: the register copy, the GovMap copy and the union are dated apart, from the stored metas — and the copies the monitor sees are the ones PROPX holds', () => {
  const T = FA.audit({ now: NOW }).transactions;
  const ev = JSON.parse(read('data/streets/evidence/meta.json')), rm = JSON.parse(read('data/streets/recent/meta.json')), mon = JSON.parse(read('data/transactions/freshness.json'));
  assert.equal(T.register.latestDeal, ev.source.lastDeal); assert.equal(T.register.copy, ev.source.scrapedAt); assert.notEqual(T.register.latestDeal, String(T.register.copy).slice(0, 10), 'deal date ≠ copy date');
  assert.equal(T.recent.latestDeal, rm.source.lastDeal); assert.equal(T.recent.copy, rm.source.loadedAt);
  assert.equal(T.recent.reconciledAgainstCurrentRegister, rm.register.scrapedAt === ev.source.scrapedAt);
  assert.ok(T.union.latestEvent >= T.register.latestDeal, 'the union is at least as new as the register copy');
  assert.ok(!(T.national.latestShown > String(T.recent.copy).slice(0, 10)), 'no shown national-file row after the copy\'s load day');
  assert.equal(T.union.largestLocalities.length, 10);
  assert.equal(T.union.largestLocalities[0].code, 3000, 'Jerusalem has the most registered residents');
  for (const c of T.union.largestLocalities) assert.ok(!c.union || !c.register || c.union >= c.register, c.name);
  const newer = T.actions.filter((x) => x.kind === 'NEW_COPY_NOT_SWEPT');
  assert.equal(newer.length > 0, FA.newerCopyActions({ evidenceMeta: ev, monitor: mon }).some((x) => x.kind === 'NEW_COPY_NOT_SWEPT'), 'raised exactly when the monitor serves a newer register copy');
  assert.equal(T.integrity.unionUnexplained, JSON.parse(read('data/txevents/completeness.json')).notSurfaced.unexplained);
});
t('GITHUB EVIDENCE: a successful production run newer than the run log dates the check — and the gap is a finding, never hidden', () => {
  const gh = { workflows: { 'txevents-national.yml': { production: { latest: { id: 39681669082, at: '2026-10-21T21:48:03Z', event: 'schedule', conclusion: 'success' }, lastSuccess: { id: 39681669082, at: '2026-10-21T21:48:03Z', event: 'schedule', conclusion: 'success' }, lastFailure: null } } } };
  const e = FA.audit({ now: NOW, github: gh }).entries.find((x) => x.id === 'over:govmap-national');
  assert.equal(e.lastCheck.origin, 'github-run'); assert.equal(e.lastCheck.at, '2026-10-21T21:48:03Z');
  assert.notEqual(e.state, 'CHECK_STALE');
  if (e.lastCheck.runLog && Date.parse('2026-10-21T21:48:03Z') - Date.parse(e.lastCheck.runLog) > 12 * 3600e3) assert.ok(e.findings.some((f) => f.kind === 'RUN_LOG_BEHIND'));
  const green = { production: { latest: { id: 2, at: '2026-10-21T21:00:00Z', event: 'schedule', conclusion: 'success' }, lastSuccess: { id: 2, at: '2026-10-21T21:00:00Z', event: 'schedule', conclusion: 'success' }, lastFailure: null } };
  const g = FA.audit({ now: NOW, github: { workflows: { 'data-sync.yml': green } } }).entries.find((x) => x.id === 'govmap:tax-authority-deals');
  assert.equal(g.state, 'REFUSED'); assert.equal(g.lastCheck.origin, 'run-log', 'a green run never stands for a check of a source that refuses');
  assert.notEqual(g.lastCheck.lastGoodAt, '2026-10-21T21:00:00Z');
  const n = FA.audit({ now: NOW, github: { workflows: { 'finance-sync.yml': { production: null, preview: { latest: { id: 1 } } } } } }).entries.find((x) => x.id === 'boi:housing-finance');
  assert.ok(n.findings.some((f) => f.kind === 'NO_PRODUCTION_RUN_YET'), 'a lane that has run only on the preview branch says so');
});

/* ── the committed outputs ── */
t('THE COMMITTED AUDIT (lib/trust/discovery/2026-10-22-freshness-audit.json): the read model\'s rows + GitHub run evidence (status · dates · run ids only) — no credential, no log text, not a discovery list', () => {
  const f = path.join(ROOT, 'lib', 'trust', 'discovery', '2026-10-22-freshness-audit.json');
  assert.ok(fs.existsSync(f));
  const text = fs.readFileSync(f, 'utf8'), j = JSON.parse(text);
  assert.equal(j.kind, 'freshness-audit'); assert.equal(j.producedBy, 'scripts/freshness-audit.js');
  assert.ok(!/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|Bearer\s+[A-Za-z0-9._-]{20,}|##\[group\]|AUTHORIZATION/.test(text), 'no credential or log text');
  assert.ok(j.audit && Array.isArray(j.audit.entries) && j.audit.entries.length >= 40);
  for (const e of j.audit.entries) assert.ok(FA.STATES.includes(e.state));
  assert.ok(j.github && j.github.workflows && Object.keys(j.github.workflows).length >= 30, 'every workflow');
  const allowed = new Set(['id', 'at', 'event', 'conclusion']);
  for (const [file, w] of Object.entries(j.github.workflows)) for (const side of ['production', 'preview']) if (w[side]) for (const k of ['latest', 'lastSuccess', 'lastFailure']) if (w[side][k]) assert.ok(Object.keys(w[side][k]).every((x) => allowed.has(x)), `${file} ${side}.${k}`);
  assert.ok(Array.isArray(j.investigation) && j.investigation.every((x) => x.workflow && Array.isArray(x.runs) && x.runs.every(Number.isInteger) && x.cause && x.class));
  assert.ok(!/^\d{4}-\d{2}-\d{2}(-[a-z]+)?\.json$/.test(path.basename(f)), 'the Trust catalogue never reads it as a discovery candidate list');
  assert.ok(!CAT.catalog({ now: NOW }).sources.some((s) => /freshness-audit/.test(s.id)));
});
t('THE REPORT (docs/DATA-FRESHNESS-2026-10-22.md) exists and names the workflows to dispatch', () => {
  const d = read('docs/DATA-FRESHNESS-2026-10-22.md');
  assert.match(d, /street-geo-build\.yml/); assert.match(d, /Latest defensible transaction dates/i); assert.match(d, /Blockers/i);
});

(async () => {
  for (const [name, fn] of results) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); }
  }
  console.log(`freshness-audit: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
