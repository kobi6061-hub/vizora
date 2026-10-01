// PROPX · government (subsidized) housing — offline tests.
// `node test/housing.test.js`
//
// Every row below is a TEST FIXTURE (LotteryId 990001+, localities 99001+,
// names prefixed "TEST FIXTURE"), built in memory and written only to temp
// directories. One group of tests proves that none of it can reach the
// production data directory or the page.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { SOURCE } = require('../lib/housing/source');
const { normalizeLottery, normalizeAll, hashRows } = require('../lib/housing/normalize');
const { mergeRecords, FileHousingStore, SupabaseHousingStore, readRawSnapshot, verifyOfficialSnapshot } = require('../lib/housing/store');
const Q = require('../lib/housing/query');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'housing-test-'));

/* ---- fixture rows in the source's own column names and formats ---- */
let rid = 0;
const row = (o = {}) => ({
  _id: ++rid, LotteryId: 990000 + rid, ProjectId: 880001, ParentLotteryId: '', ContinLotteryId: '',
  LotteryType: 'ראשונה', CentralizationType: 'הגרלה ארצית', MarketingMethod: '1', MarketingMethodDesc: 'מחיר למשתכן',
  MarketingRep: 'משב"ש', Eligibility: 'חסרי דירה', LotteryStatusValue: 'פורסמו תוצאות',
  LotteryEndSignupDate: '2024-11-20 00:00:00', LotteryExecutionDate: '2024-12-10 10:00:00',
  LamasCode: '99001', LamasName: 'TEST FIXTURE עיר א', Neighborhood: 'TEST FIXTURE שכונה 1', ProjectName: 'TEST FIXTURE פרויקט 1',
  ProviderName: 'TEST FIXTURE יזם 1', ProjectStatus: 'בחירת דירות', ConstructionPermitName: 'היתר מלא', PriceForMeter: '9,242.00',
  LotteryHousingUnits: '100', LotterySignupHousingUnits: '110', LotteryNativeHousingUnits: '25', LotterySignupNativeHousingUnits: '27',
  Subscribers: '1,500', SubscribersBenyMakom: '300', SubscribersDisabled: '5', SubscribersMeshapryDiur: '0',
  SubscribersSeriesA: '1', SubscribersSeriesB: '2', SubscribersSeriesC: '3',
  Winners: '100', WinnersBneyMakom: '25', WinnersHasryDiur: '75', WinnersMeshapryDiur: '0', WinnersSeriesA: '', WinnersSeriesB: '', WinnersSeriesC: '',
  ...o,
});
const CTX = { source: SOURCE, sourceUpdatedAt: '2026-08-16T08:00:00Z', fetchedAt: '2026-10-01T03:00:00Z', snapshotHash: 'abc123', retrievalMethod: 'live-api' };
/* a small national picture: three fixture cities, first + continuation lotteries, 2023 → Jan 2025 */
function nation() {
  rid = 0;
  return [
    row({ LotteryExecutionDate: '2025-01-27 10:38:07', ProjectId: 880001 }),                                                   // A, newest
    row({ LotteryExecutionDate: '2024-12-10 10:00:00', ProjectId: 880002, ProjectName: 'TEST FIXTURE פרויקט 2', LotteryHousingUnits: '40',
      LotterySignupHousingUnits: '40', Winners: '40', PriceForMeter: '10,240.00', ProviderName: 'TEST FIXTURE יזם 2', MarketingMethodDesc: 'מחיר מטרה' }),
    row({ LotteryExecutionDate: '2025-01-05 09:00:00', ProjectId: 880001, LotteryType: 'המשך', ParentLotteryId: '990001',
      LotteryHousingUnits: '12', LotterySignupHousingUnits: '12', Winners: '30', Subscribers: '200' }),                       // A, continuation
    row({ LotteryExecutionDate: '2023-06-01 10:00:00', ProjectId: 880003, ProjectName: 'TEST FIXTURE פרויקט 3', Neighborhood: '',
      LotteryHousingUnits: '60', LotterySignupHousingUnits: '60', Winners: '60', PriceForMeter: '0.00', ConstructionPermitName: 'טרם הוגשה בקשה' }),
    row({ LotteryExecutionDate: '2024-03-15 10:00:00', LamasCode: '99002', LamasName: 'TEST FIXTURE עיר ב', ProjectId: 880004,
      ProjectName: 'TEST FIXTURE פרויקט 4', LotteryHousingUnits: '80', LotterySignupHousingUnits: '90', Winners: '80', ProviderName: 'TEST FIXTURE יזם 2' }),
    row({ LotteryExecutionDate: '2022-02-01 10:00:00', LamasCode: '99003', LamasName: 'TEST FIXTURE עיר ג', ProjectId: 880005,
      ProjectName: 'TEST FIXTURE פרויקט 5', LotteryHousingUnits: '20', LotterySignupHousingUnits: '20', Winners: '', PriceForMeter: '',
      ProjectStatus: 'בקרה לאחר אכלוס' }),
  ];
}
const NOW = new Date('2026-10-01T12:00:00Z');

/* a data directory as the sync job writes it, from fixture rows */
function syncInto(dir, rows, extraArgs = [], env = {}) {
  const f = path.join(dir, '..', path.basename(dir) + '-payload.json');
  fs.writeFileSync(f, JSON.stringify({ rows, sourceUpdatedAt: '2026-08-16T08:00:00Z' }));
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'housing-sync.js'), '--from', f, ...extraArgs],
    { env: { ...process.env, HOUSING_DATA_DIR: dir, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', ...env }, encoding: 'utf8' });
}

(async () => {
  console.log('normalization — the source parser');
  await t('rejects malformed required identifiers (LotteryId, ProjectId, LamasCode)', () => {
    for (const bad of [{ LotteryId: '' }, { LotteryId: 'abc' }, { LotteryId: '-3' }, { LotteryId: '1.5' }, { ProjectId: '' }, { LamasCode: '0' }, { LamasCode: null }]) {
      const out = normalizeLottery(row(bad), CTX);
      assert.ok(out.rejected && !out.record, 'accepted ' + JSON.stringify(bad));
      assert.match(out.rejected.reason, /missing or not a positive integer/);
    }
    assert.ok(normalizeLottery(row(), CTX).record);
  });
  await t('keeps the source values; blanks and impossible values stay null and are listed as missing', () => {
    const r = normalizeLottery(row({ Neighborhood: '-', ProviderName: '', PriceForMeter: '0.00', Winners: '', LotteryExecutionDate: '2025-02-30 10:00:00' }), CTX).record;
    assert.equal(r.neighborhood, null); assert.equal(r.developer, null); assert.equal(r.pricePerSqm, null);
    assert.equal(r.winners, null); assert.equal(r.lotteryDate, null);
    for (const k of ['neighborhood', 'developer', 'pricePerSqm', 'winners', 'lotteryDate']) assert.ok(r.missing.includes(k), k + ' not listed missing');
    const ok = normalizeLottery(row(), CTX).record;
    assert.equal(ok.pricePerSqm, 9242); assert.equal(ok.applicants, 1500); assert.equal(ok.lotteryDate, '2024-12-10');
    assert.equal(ok.lotteryDateTime, '2024-12-10T10:00:00'); assert.equal(ok.program, 'mechir-lamishtaken'); assert.equal(ok.permitStage, 'full');
  });
  await t('winners are never labelled signed sales; units are never inventory', () => {
    const r = normalizeLottery(row(), CTX).record;
    assert.equal(r.winners, 100);
    assert.equal(r.signedSales, null); assert.equal(r.availableInventory, null); assert.equal(r.totalProjectUnits, null);
    assert.ok(r.missing.includes('signedSales') && r.missing.includes('availableInventory'));
    const k = Q.kpis(normalizeAll(nation(), CTX).records);
    assert.ok(k.winners > 0 && k.unitsFirst > 0);
    assert.equal(k.signedSales, null); assert.equal(k.availableInventory, null); assert.equal(k.subsidizedShareOfUnsold, null); assert.equal(k.programUnits, null);
  });
  await t('construction start / completion are never inferred; occupancy only from the explicit status', () => {
    const old = normalizeLottery(row({ LotteryExecutionDate: '2016-03-01 10:00:00' }), CTX).record;   // a lottery ten years ago
    assert.equal(old.lifecycle.constructionStarted, null); assert.equal(old.lifecycle.completed, null); assert.equal(old.lifecycle.occupancyEvidenced, null);
    const occ = normalizeLottery(row({ ProjectStatus: 'בקרה לאחר אכלוס' }), CTX).record;
    assert.equal(occ.lifecycle.occupancyEvidenced, true); assert.equal(occ.lifecycle.completed, null);
  });
  await t('source provenance survives normalization, storage and the read API', () => {
    const src = row(), r = normalizeLottery(src, CTX).record;
    assert.deepEqual([r.provenance.source, r.provenance.resourceId, r.provenance.sourceRecordId, r.provenance.sourceRowId, r.provenance.fetchedAt,
      r.provenance.sourceUpdatedAt, r.provenance.snapshotHash, r.provenance.classification],
    [SOURCE.id, SOURCE.resourceId, String(src.LotteryId), src._id, CTX.fetchedAt, CTX.sourceUpdatedAt, 'abc123', 'OFFICIAL']);
    const dir = tmp(), res = syncInto(dir, nation());
    assert.equal(res.status, 0, res.stderr);
    const one = Q.record('lottery:990001', { dataDir: dir });
    assert.equal(one.record.provenance.source, SOURCE.id);
    assert.equal(one.record.provenance.sourceRowId, 1);
    assert.match(one.record.provenance.snapshotHash, /^[0-9a-f]{40}$/);
  });
  await t('a duplicate LotteryId in one response is rejected, never merged', () => {
    const rows = nation(); rows.push({ ...rows[0], _id: 99 });
    const { records, rejected } = normalizeAll(rows, CTX);
    assert.equal(records.length, 6); assert.equal(rejected.length, 1); assert.match(rejected[0].reason, /duplicate/);
  });
  await t('the content hash ignores row order and the datastore _id', () => {
    const a = nation(), b = [...nation()].reverse().map((r, i) => ({ ...r, _id: 500 + i }));
    assert.equal(hashRows(a), hashRows(b));
    assert.notEqual(hashRows(a), hashRows(a.map((r, i) => (i ? r : { ...r, Winners: '101' }))));
  });

  console.log('persistence — upsert, history, never delete');
  await t('re-ingesting the same official records never duplicates them', () => {
    const recs = normalizeAll(nation(), CTX).records;
    const m1 = mergeRecords([], recs, { fetchedAt: 'T1' });
    const m2 = mergeRecords(m1.records, normalizeAll(nation(), { ...CTX, fetchedAt: 'T2' }).records, { fetchedAt: 'T2' });
    assert.equal(m2.records.length, 6); assert.deepEqual(m2.stats, { inserted: 0, updated: 0, unchanged: 6, rederived: 0, missingFromSource: 0, keptUnparsed: 0 });
    assert.equal(new Set(m2.records.map((r) => r.id)).size, 6);
    assert.ok(m2.records.every((r) => r.firstSeenAt === 'T1' && r.provenance.fetchedAt === CTX.fetchedAt), 'an unchanged record was rewritten');
    assert.deepEqual(m2.records, m1.records, 'an unchanged source must leave every stored record byte-identical');
  });
  await t('a changed official field is updated and recorded in the status history; firstSeenAt stays', () => {
    const m1 = mergeRecords([], normalizeAll(nation(), CTX).records, { fetchedAt: 'T1' });
    const rows = nation(); rows[1].ProjectStatus = 'בקרת חוזים'; rows[1].Winners = '41';
    const m2 = mergeRecords(m1.records, normalizeAll(rows, CTX).records, { fetchedAt: 'T2', syncRunId: 'run2' });
    assert.equal(m2.stats.updated, 1);
    const fields = m2.history.map((h) => h.field).sort();
    assert.ok(fields.includes('projectStatusHe') && fields.includes('winners'), fields.join());
    const ev = m2.history.find((h) => h.field === 'winners');
    assert.deepEqual([ev.id, ev.from, ev.to, ev.observedAt, ev.syncRunId], ['lottery:990002', 40, 41, 'T2', 'run2']);
    assert.equal(m2.records.find((r) => r.id === 'lottery:990002').firstSeenAt, 'T1');
  });
  await t('a lottery the source stops listing is kept (inLatestSource:false), never deleted — and can return', () => {
    const m1 = mergeRecords([], normalizeAll(nation(), CTX).records, { fetchedAt: 'T1' });
    const m2 = mergeRecords(m1.records, normalizeAll(nation().slice(1), CTX).records, { fetchedAt: 'T2', prevCheckedAt: 'T1' });
    assert.equal(m2.records.length, 6); assert.equal(m2.stats.missingFromSource, 1);
    const gone = m2.records.find((r) => r.id === 'lottery:990001');
    assert.equal(gone.inLatestSource, false); assert.equal(gone.lastSeenAt, 'T1');
    const m3 = mergeRecords(m2.records, normalizeAll(nation(), CTX).records, { fetchedAt: 'T3' });
    assert.equal(m3.records.find((r) => r.id === 'lottery:990001').inLatestSource, true);
    assert.ok(m3.history.some((h) => h.id === 'lottery:990001' && h.field === 'inLatestSource' && h.to === true));
  });
  await t('the raw payload is snapshotted once per distinct content', () => {
    const dir = tmp(), s = new FileHousingStore(dir);
    assert.ok(s.snapshotRaw(nation(), 'a'.repeat(40), '2026-10-01T03:00:00Z'));
    assert.equal(s.snapshotRaw(nation(), 'a'.repeat(40), '2026-10-02T03:00:00Z'), null);
    assert.ok(s.snapshotRaw(nation(), 'b'.repeat(40), '2026-10-02T03:00:00Z'));
    assert.equal(fs.readdirSync(path.join(dir, 'raw')).length, 2);
  });
  await t('Supabase: upserts on the official id into schema market, the key only in headers', async () => {
    const calls = [];
    const fetchImpl = async (url, o) => { calls.push({ url, o }); return { ok: true, text: async () => '' }; };
    const recs = mergeRecords([], normalizeAll(nation(), CTX).records, { fetchedAt: 'T1' }).records;
    await new SupabaseHousingStore({ url: 'https://example.supabase.co', key: 'service-key-xyz', fetchImpl })
      .write({ records: recs, history: [], run: { status: 'ok', startedAt: 'T0', finishedAt: 'T1', fetched: 6 }, source: SOURCE, raw: { hash: 'h', rows: nation(), fetchedAt: 'T1' } });
    const urls = calls.map((c) => c.url.replace('https://example.supabase.co/rest/v1/', ''));
    assert.deepEqual(urls, ['sources?on_conflict=id', 'raw_snapshots?on_conflict=source_id,content_hash', 'housing_lotteries?on_conflict=id', 'sync_runs']);
    for (const c of calls) {
      assert.equal(c.o.headers['Content-Profile'], 'market');
      assert.ok(!c.o.body.includes('service-key-xyz'), 'the key leaked into a body');
    }
    assert.match(calls[2].o.headers.Prefer, /resolution=merge-duplicates/);
    const sent = JSON.parse(calls[2].o.body);
    assert.equal(sent.length, 6); assert.equal(sent[0].id, 'lottery:990001'); assert.ok(!('signed_sales' in sent[0]));
  });

  console.log('sync job — end to end (fixture into a temp directory)');
  await t('first run inserts; the identical re-run changes nothing; a source change is upserted with history', () => {
    const dir = tmp();
    let r = syncInto(dir, nation());
    assert.equal(r.status, 0, r.stderr);
    const first = fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8');
    assert.equal(JSON.parse(first).length, 6);
    r = syncInto(dir, [...nation()].reverse());
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8'), first, 'an unchanged source rewrote the records');
    const runs = fs.readFileSync(path.join(dir, 'sync-runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(runs.map((x) => [x.status, x.contentChanged]), [['ok', true], ['ok', false]]);
    const rows = nation(); rows[4].Winners = '79';
    r = syncInto(dir, rows);
    assert.equal(r.status, 0, r.stderr);
    const recs = JSON.parse(fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8'));
    assert.equal(recs.length, 6);
    assert.equal(recs.find((x) => x.id === 'lottery:990005').winners, 79);
    assert.match(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'), /"field":"winners","from":80,"to":79/);
    assert.equal(fs.readdirSync(path.join(dir, 'raw')).length, 2);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    assert.deepEqual(meta.coverage, { lotteryDateFrom: '2022-02-01', lotteryDateTo: '2025-01-27', signupEndDateTo: '2024-11-20' });
    assert.equal(meta.sourceUpdatedAt, '2026-08-16T08:00:00Z');
  });
  await t('a renamed source column fails the run and writes nothing but the run log', () => {
    const dir = tmp();
    syncInto(dir, nation());
    const before = fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8');
    const r = syncInto(dir, nation().map(({ Winners, ...rest }) => ({ ...rest, WinnersTotal: Winners })));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing column\(s\): Winners/);
    assert.equal(fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8'), before);
    assert.match(fs.readFileSync(path.join(dir, 'sync-runs.jsonl'), 'utf8').trim().split('\n').pop(), /"status":"failed"/);
  });
  await t('a response under half of the listed rows is not applied', () => {
    const dir = tmp();
    syncInto(dir, nation());
    const r = syncInto(dir, nation().slice(0, 2));
    assert.equal(r.status, 1); assert.match(r.stderr, /under half/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8')).filter((x) => x.inLatestSource).length, 6);
  });
  await t('no fake project can enter Production: a fixture replay into the production data directory is refused', () => {
    const f = path.join(tmp(), 'fixture.json');
    fs.writeFileSync(f, JSON.stringify(nation()));
    const prodDir = path.join(ROOT, 'data', 'housing');
    const before = fs.existsSync(prodDir) ? fs.readdirSync(prodDir).sort().join() : null;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'housing-sync.js'), '--from', f],
      { env: { ...process.env, HOUSING_DATA_DIR: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /refused/);
    assert.equal(fs.existsSync(prodDir) ? fs.readdirSync(prodDir).sort().join() : null, before, 'the production data directory changed');
  });

  console.log('read model — filters, periods, coverage');
  const DIR = tmp();
  { const r = syncInto(DIR, nation()); assert.equal(r.status, 0, r.stderr); }
  const F = (q) => { const p = Q.parseFilters(new URLSearchParams(q), NOW); assert.ok(!p.error, p.error); return p.filters; };
  const S = (q, o = {}) => Q.summary(F(q), { dataDir: DIR, ...o });
  await t('6 / 12 / 24 months are different windows ending today', () => {
    assert.deepEqual([F('period=6m').from, F('period=12m').from, F('period=24m').from], ['2026-04-01', '2025-10-01', '2024-10-01']);
    assert.ok([F('period=6m'), F('period=12m'), F('period=24m')].every((f) => f.to === '2026-10-01'));
    assert.equal(F('').period, 'all'); assert.equal(F('period=all').from, null);
  });
  await t('a period the source does not cover is "—" (null), never 0', () => {
    for (const p of ['6m', '12m']) {
      const s = S('period=' + p);
      assert.equal(s.coverage.state, 'none'); assert.equal(s.kpis, null); assert.deepEqual(s.series.points, []);
    }
    const s24 = S('period=24m');
    assert.equal(s24.coverage.state, 'partial'); assert.equal(s24.coverage.coveredTo, '2025-01-27');
  });
  await t('freshness keeps the source update, the latest lottery in the source and the PROPX check apart', () => {
    const A = S('period=all'), Fr = A.freshness;
    assert.equal(Fr.sourceUpdatedAt.slice(0, 10), '2026-08-16');
    assert.equal(Fr.latestEventDate, '2025-01-27', 'the event horizon comes from the content, never from the update time');
    assert.ok(Fr.checkedAt && Fr.checkedAt.slice(0, 10) !== Fr.latestEventDate);
    assert.equal(A.coverage.state, 'within'); assert.equal(A.coverage.coveredTo, '2025-01-27');
    /* nothing is claimed past the newest lottery: no KPI, no maturity, no table total, no filter count */
    for (const q of ['period=6m', 'period=12m', 'period=custom&from=2025-01-28&to=2026-09-30']) {
      const s = S(q);
      assert.equal(s.coverage.state, 'none', q); assert.equal(s.kpis, null, q); assert.equal(s.maturity, null, q);
      assert.ok(Object.values(s.facets).flat().every((o) => o.n == null), q + ': a filter count past the horizon');
      assert.equal(Q.records(F(q), { dataDir: DIR }).total, null, q);
    }
    assert.equal(S('period=custom&from=2025-01-01&to=2025-03-31').coverage.state, 'partial');
    assert.equal(S('period=custom&from=2024-01-01&to=2024-12-31').coverage.state, 'within');
  });
  await t('aggregates respect the date filters', () => {
    const k24 = S('period=24m').kpis, kAll = S('period=all').kpis;
    assert.deepEqual([k24.lotteries, k24.firstLotteries, k24.continuationLotteries], [3, 2, 1]);      // Dec 2024, Jan 2025 ×2
    assert.deepEqual([kAll.lotteries, kAll.projects, kAll.cities], [6, 5, 3]);
    const c = S('period=custom&from=2024-01-01&to=2024-12-31').kpis;
    assert.deepEqual([c.lotteries, c.unitsFirst], [2, 120]);                                           // Mar 2024 (80) + Dec 2024 (40)
    assert.equal(Q.parseFilters(new URLSearchParams('period=custom&from=2025-01-01&to=2024-01-01'), NOW).error, 'from is after to');
    assert.ok(Q.parseFilters(new URLSearchParams('period=custom&from=2024-02-30&to=2024-03-01'), NOW).error);
  });
  await t('first-lottery units, re-offered units and winners are reported separately, never added together', () => {
    const k = S('period=all&city=99001').kpis;
    assert.equal(k.unitsFirst, 100 + 40 + 60);      // first lotteries only
    assert.equal(k.unitsReoffered, 12);             // the continuation lottery
    assert.equal(k.winners, 100 + 40 + 30 + 60);    // winners can exceed units (continuation drew 30 for 12)
    assert.equal(k.unitsAtSignupFirst, 110 + 40 + 60);
  });
  await t('the city filter works by official code and by official name', () => {
    assert.equal(S('city=99002').kpis.lotteries, 1);
    assert.equal(S('city=' + encodeURIComponent('TEST FIXTURE עיר ב')).kpis.lotteries, 1);
    const none = S('city=99009');                    // inside the covered period the source lists none there: a real 0
    assert.deepEqual([none.kpis.lotteries, none.kpis.unitsFirst, none.kpis.medianPricePerSqm, none.scopeHasRecords], [0, 0, null, false]);
  });
  await t('the program filter works', () => {
    assert.equal(S('program=mechir-matara').kpis.lotteries, 1);
    assert.equal(S('program=mechir-lamishtaken').kpis.lotteries, 5);
  });
  await t('the developer filter works', () => {
    assert.equal(S('developer=' + encodeURIComponent('TEST FIXTURE יזם 2')).kpis.lotteries, 2);
  });
  await t('derived figures carry their basis; a city with no valid price shows —', () => {
    const k = S('city=99001').kpis;
    assert.equal(k.medianPricePerSqm, (9242 + 10240) / 2);   // first lotteries with a price (the 0.00 one is not a price)
    assert.equal(k.pricedLotteries, 2);
    assert.equal(S('city=99003').kpis.medianPricePerSqm, null);
  });
  await t('series: zeros only inside the covered range; month buckets for ≤ 24 months', () => {
    const s = S('period=24m');
    assert.equal(s.series.bucket, 'month');
    assert.deepEqual(s.series.points.map((p) => p.period), ['2024-10', '2024-11', '2024-12', '2025-01']);
    assert.deepEqual(s.series.points.map((p) => p.lotteries), [0, 0, 1, 2]);
    assert.equal(s.series.points[3].partial, true, 'the source ends inside January 2025');
    assert.equal(s.series.points[0].partial, false);
    const c = S('period=custom&from=2024-12-15&to=2025-03-31');
    assert.equal(c.series.points[0].partial, true, 'a window starting mid-month is a partial first month');
    assert.equal(S('period=all').series.bucket, 'year');
  });
  await t('geographic drill-down: national → city → neighborhood → project, from official fields only', () => {
    assert.equal(S('').breakdown.level, 'city');
    const nb = S('city=99001').breakdown;
    assert.equal(nb.level, 'neighborhood');
    assert.ok(nb.rows.some((r) => r.label === null), 'an unpublished neighborhood is shown as missing, not assigned');
    const pj = S('city=99001&neighborhood=' + encodeURIComponent('TEST FIXTURE שכונה 1')).breakdown;
    assert.equal(pj.level, 'project');
    assert.ok(S('').breakdown.rows.every((r) => !('lat' in r) && !('lng' in r)));
  });
  await t('the table is paginated and sorted on the server', () => {
    const p1 = Q.records(F(''), { dataDir: DIR, size: 5, page: 1 });
    assert.deepEqual([p1.total, p1.pages, p1.rows.length], [6, 2, 5]);
    assert.equal(p1.rows[0].lotteryDate, '2025-01-27');
    const p2 = Q.records(F(''), { dataDir: DIR, size: 5, page: 2, sort: 'unitsInLottery', order: 'asc' });
    assert.equal(p2.rows.length, 1); assert.equal(p2.rows[0].unitsInLottery, 100);
    assert.ok(!('provenance' in p1.rows[0]) && !('record' in p1.rows[0]), 'the table rows carry the full record');
  });
  await t('project detail: siblings by official ProjectId, lifecycle evidence or null, history', () => {
    const d = Q.record('lottery:990001', { dataDir: DIR, today: '2026-10-01' });
    assert.deepEqual(d.project.lotteries.map((x) => x.lotteryId), [990003, 990001]);     // by lottery date
    assert.deepEqual([d.project.unitsFirst, d.project.unitsReoffered], [100, 12]);
    assert.equal(d.lifecycle.constructionStarted, null); assert.equal(d.lifecycle.completed, null); assert.equal(d.lifecycle.occupied, null);
    assert.equal(d.lifecycle.permit.value, 'היתר מלא');
    assert.equal(Q.record('lottery:990006', { dataDir: DIR }).lifecycle.occupied.value, 'בקרה לאחר אכלוס');
    assert.equal(Q.record('lottery:1', { dataDir: DIR }), null);
  });
  await t('data maturity: no winners recorded yet, or a recent lottery, is "updating"; a status text is not read as pending', () => {
    const r = normalizeLottery(row({ Winners: '' }), CTX).record;
    assert.equal(Q.maturityOf(r, '2026-10-01'), 'updating', 'no winners recorded');
    assert.equal(Q.maturityOf({ ...r, winners: 26, lotteryDate: '2026-09-01' }, '2026-10-01'), 'updating', 'held 30 days ago');
    assert.equal(Q.maturityOf({ ...r, winners: 26, lotteryDate: '2025-01-27' }, '2026-10-01'), 'settled');
    // "registration renewed at the developer" with winners drawn years ago is history, not pending
    assert.equal(Q.maturityOf({ ...r, winners: 26, lotteryStatus: 'חידוש הרשמה במשרדי הקבלן', lotteryDate: '2022-03-07' }, '2026-10-01'), 'settled');
  });

  console.log('adversarial-review regressions');
  /* the source's national grants row: official, but not a housing lottery in a locality */
  const grant = () => row({ LotteryId: '992315', ProjectId: '1234567', LamasCode: '9999', LamasName: 'כלל הישובים', Neighborhood: '',
    ProjectName: 'מענקים לרוכשי דירות יד שנייה', ProviderName: 'מענקים לרוכשי דירות יד שנייה', MarketingMethod: '90', PriceForMeter: '0.00',
    LotteryHousingUnits: '1000', LotterySignupHousingUnits: '1000', Winners: '790', Subscribers: '20818', LotteryExecutionDate: '2024-12-01 10:00:00' });
  await t('a grants program row is kept as OFFICIAL but never counted as a lottery, project, units, winners or locality', () => {
    assert.equal(normalizeLottery(grant(), CTX).record.recordType, 'grant-program');
    assert.equal(normalizeLottery(row(), CTX).record.recordType, 'lottery');
    const dir = tmp(); const r = syncInto(dir, [...nation(), grant()]); assert.equal(r.status, 0, r.stderr);
    const all = Q.summary(F(''), { dataDir: dir }), base = Q.summary(F(''), { dataDir: DIR });
    for (const k of ['lotteries', 'projects', 'cities', 'unitsFirst', 'unitsAtSignupFirst', 'winners', 'applicants']) assert.equal(all.kpis[k], base.kpis[k], k + ' counted the grants row');
    assert.deepEqual(all.excluded.map((x) => [x.lotteryId, x.recordType]), [[992315, 'grant-program']]);
    assert.ok(!all.facets.city.some((c) => c.value === '9999'), 'the city filter offers "כלל הישובים"');
    assert.ok(!all.breakdown.rows.some((x) => x.key === '9999'));
    assert.equal(Q.records(F(''), { dataDir: dir }).total, 6);
    assert.equal(Q.record('lottery:992315', { dataDir: dir }).record.recordType, 'grant-program', 'still openable as an official record');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).coverage.lotteryDateTo, '2025-01-27');
  });
  await t('a period the source does not cover has no record count ("—"), and filter counts follow the period', () => {
    assert.equal(Q.records(F('period=6m'), { dataDir: DIR }).total, null);
    assert.equal(Q.records(F('period=all'), { dataDir: DIR }).total, 6);
    assert.ok(Q.summary(F('period=6m'), { dataDir: DIR }).facets.city.every((c) => c.n === null), 'counts shown for an uncovered period');
    const c24 = Q.summary(F('period=24m'), { dataDir: DIR }).facets.city;
    assert.deepEqual(c24.map((c) => [c.value, c.n]), [['99001', 3], ['99002', 0], ['99003', 0]], 'counts are for the selected period; every city stays selectable');
  });
  /* 300 valid rows, for the share-based guards */
  const many = (n = 300) => { rid = 0; return Array.from({ length: n }, (_, i) => row({ LotteryId: String(991000 + i), ProjectId: String(870000 + i), _id: i + 1 })); };
  await t('a response that mostly fails normalization is refused; a few rejected rows are never marked delisted', () => {
    const dir = tmp(); assert.equal(syncInto(dir, many()).status, 0);
    const before = fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8');
    const bad = many().map((x, i) => (i < 200 ? { ...x, LamasCode: '' } : x));
    const r = syncInto(dir, bad);
    assert.equal(r.status, 1); assert.match(r.stderr, /failed normalization/);
    assert.equal(fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8'), before, 'records changed by a refused run');
    const few = many().map((x, i) => (i < 3 ? { ...x, LamasCode: '' } : i === 10 ? { ...x, Winners: '99' } : x));
    const r2 = syncInto(dir, few); assert.equal(r2.status, 0, r2.stderr);
    const recs = JSON.parse(fs.readFileSync(path.join(dir, 'lotteries.json'), 'utf8'));
    assert.ok(recs.every((x) => x.inLatestSource), 'a listed row that failed normalization was marked delisted');
    const hist = fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8');
    assert.ok(!/inLatestSource/.test(hist) && /"winners"/.test(hist));
  });
  await t('history records SOURCE values only: no derived keys, one event per source change; derived-only changes are silent', () => {
    const m1 = mergeRecords([], normalizeAll(nation(), CTX).records, { fetchedAt: 'T1' });
    const rows = nation(); rows[0].ConstructionPermitName = 'הוגשה בקשה'; rows[0].LotteryExecutionDate = '2025-01-28 09:00:00';
    const m2 = mergeRecords(m1.records, normalizeAll(rows, CTX).records, { fetchedAt: 'T2' });
    assert.deepEqual(m2.history.map((h) => h.field).sort(), ['lotteryDate', 'permitStatusHe']);
    assert.deepEqual(m2.history.find((h) => h.field === 'lotteryDate'), { id: 'lottery:990001', field: 'lotteryDate', from: '2025-01-27T10:38:07', to: '2025-01-28T09:00:00', observedAt: 'T2', syncRunId: null });
    const stale = m1.records.map((x) => (x.id === 'lottery:990002' ? { ...x, permitStage: 'old-mapping' } : x));   // an older normalizer's derived value
    const m3 = mergeRecords(stale, normalizeAll(nation(), CTX).records, { fetchedAt: 'T3' });
    assert.equal(m3.history.length, 0); assert.equal(m3.stats.rederived, 1);
    assert.equal(m3.records.find((x) => x.id === 'lottery:990002').permitStage, 'full');
  });
  await t('the drawer history lists a project-level change once, with the lotteries it appeared on', () => {
    const dir = tmp(); syncInto(dir, nation());
    const ev = (id) => JSON.stringify({ id, field: 'permitStatusHe', from: 'היתר מלא', to: 'הוגשה בקשה', observedAt: '2026-10-02T03:00:00Z', syncRunId: 'r' });
    fs.writeFileSync(path.join(dir, 'history.jsonl'), ev('lottery:990001') + '\n' + ev('lottery:990003') + '\n');
    const h = Q.record('lottery:990001', { dataDir: dir }).history;
    assert.equal(h.length, 1); assert.deepEqual(h[0].ids.sort(), ['lottery:990001', 'lottery:990003']);
  });
  await t('replay into the production directory: only an official snapshot a live run recorded, unforged and not older', () => {
    const { hashRows: hr } = require('../lib/housing/normalize');
    const dir = tmp(); fs.mkdirSync(path.join(dir, 'raw'));
    const write = (rows, at, live = true) => {
      const h = hr(rows), name = `${at.slice(0, 10)}-${h.slice(0, 12)}.json.gz`;
      fs.writeFileSync(path.join(dir, 'raw', name), require('node:zlib').gzipSync(JSON.stringify({ contentHash: h, fetchedAt: at, sourceUpdatedAt: 'S', rows })));
      fs.appendFileSync(path.join(dir, 'sync-runs.jsonl'), JSON.stringify({ rawSnapshot: name, retrievalMethod: live ? 'live-api' : 'replay', snapshotHash: h, finishedAt: at }) + '\n');
      return { file: path.join(dir, 'raw', name), h };
    };
    const a = write(nation(), '2026-10-01T03:00:00Z');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ snapshotHash: a.h, snapshotFetchedAt: '2026-10-01T03:00:00Z' }));
    assert.equal(verifyOfficialSnapshot(dir, a.file, { hashRows: hr }).snap.rows.length, 6);
    // a forged payload under an official-looking name
    const forged = path.join(dir, 'raw', path.basename(a.file).replace(/^2026-10-01/, '2026-10-02'));
    fs.writeFileSync(forged, require('node:zlib').gzipSync(JSON.stringify([...nation(), row({ LotteryId: '777777', LotteryHousingUnits: '5000' })])));
    assert.throws(() => verifyOfficialSnapshot(dir, forged, { hashRows: hr }), /does not match/);
    // a snapshot no live run recorded
    const fx = write(nation().slice(0, 5), '2026-10-03T03:00:00Z', false);
    assert.throws(() => verifyOfficialSnapshot(dir, fx.file, { hashRows: hr }), /no live run/);
    // an older official snapshot is a rollback: refused unless forced
    const newer = nation(); newer[0].Winners = '101';
    const b = write(newer, '2026-10-04T03:00:00Z');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ snapshotHash: b.h, snapshotFetchedAt: '2026-10-04T03:00:00Z' }));
    assert.throws(() => verifyOfficialSnapshot(dir, a.file, { hashRows: hr }), /older/);
    assert.ok(verifyOfficialSnapshot(dir, a.file, { hashRows: hr, force: true }));
    // a file outside raw/ is never accepted
    const out = path.join(dir, 'x.json.gz'); fs.copyFileSync(a.file, out);
    assert.throws(() => verifyOfficialSnapshot(dir, out, { hashRows: hr }), /only replays an official raw snapshot/);
    // both snapshot formats read back (v1 wrote the bare rows array)
    assert.equal(readRawSnapshot(forged).rows.length, 7);
  });
  await t('HOUSING_DATA_DIR pointed at the production directory is still the production directory', () => {
    const f = path.join(tmp(), 'fixture.json'); fs.writeFileSync(f, JSON.stringify(nation()));
    const prodDir = path.join(ROOT, 'data', 'housing');
    const before = fs.existsSync(prodDir) ? fs.readdirSync(prodDir).sort().join() : null;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'housing-sync.js'), '--from', f],
      { env: { ...process.env, HOUSING_DATA_DIR: prodDir + '/', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /refused/);
    assert.equal(fs.existsSync(prodDir) ? fs.readdirSync(prodDir).sort().join() : null, before);
  });
  await t('Supabase is seeded with every record when it holds fewer than PROPX (secrets added later, or a failed write)', async () => {
    const recs = mergeRecords([], normalizeAll(nation(), CTX).records, { fetchedAt: 'T1' }).records;
    const run = (count) => { const calls = [];
      const fetchImpl = async (url, o = {}) => { const u = url.replace('https://example.supabase.co/rest/v1/', '');
        calls.push({ url: u, method: o.method || 'GET', body: o.body, prefer: o.headers && o.headers.Prefer });
        const ids = recs.slice(0, count).map((r) => ({ id: r.id }));
        return { ok: true, text: async () => '', json: async () => (u.startsWith('housing_lotteries?select=id') ? ids : []),
          headers: { get: (h) => (h === 'content-range' ? `0-0/${count}` : null) } }; };
      return { calls, store: new SupabaseHousingStore({ url: 'https://example.supabase.co', key: 'k', fetchImpl }) }; };
    const empty = run(0);
    await empty.store.write({ records: null, all: recs, run: { id: 'r2', status: 'ok' }, source: SOURCE, raw: { hash: 'h', rows: nation(), fetchedAt: 'T1' } });
    const posted = empty.calls.find((c) => c.method === 'POST' && c.url.startsWith('housing_lotteries'));
    assert.ok(posted && JSON.parse(posted.body).length === 6, 'the empty project was not seeded');
    const raw = empty.calls.find((c) => c.url.startsWith('raw_snapshots'));
    assert.ok(raw && /ignore-duplicates/.test(raw.prefer), 'the raw snapshot keeps its first fetch time');
    const full = run(6);
    await full.store.write({ records: null, all: recs, run: { id: 'r3', status: 'ok' }, source: SOURCE, raw: { hash: 'h', rows: nation(), fetchedAt: 'T1' } });
    assert.ok(!full.calls.some((c) => c.method === 'POST' && c.url.startsWith('housing_lotteries')), 'an up-to-date project was rewritten');
    assert.ok(full.calls.some((c) => c.method === 'PATCH'), 'last_seen_at not moved');
  });

  console.log('store of record — Supabase first, the bundled snapshot as fallback');
  {
    const ENV = { SUPABASE_URL: 'https://store-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const files = Q.load(DIR);
    const fmeta = files.meta, frecs = files.records;
    /* a PostgREST double holding `recs` with the run meta `meta` */
    const rest = ({ meta = fmeta, recs = frecs, history = [], fail = null, slow = false, cap = 1000 } = {}) => {
      const calls = [];
      const fetchImpl = async (url, o = {}) => {
        const u = String(url).replace(ENV.SUPABASE_URL + '/rest/v1/', ''); calls.push(u);
        if (slow) await new Promise((res, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        if (fail) return { ok: false, status: fail, json: async () => ({}), text: async () => 'no' };
        const [a, b0] = String((o.headers && o.headers.Range) || '0-999').split('-').map(Number), b = Math.min(b0, a + cap - 1);   // a project row cap
        const all = u.startsWith('housing_lotteries') ? recs.map((record) => ({ record })) : u.startsWith('housing_status_history') ? history : null;
        const body = u.startsWith('sync_runs') ? (meta ? [{ finished_at: meta.checkedAt, snapshot_hash: meta.snapshotHash, details: { meta } }] : [])
          : all ? all.slice(a, b + 1) : [];
        const range = all ? `${a}-${a + body.length - 1}/${all.length}` : null;
        return { ok: true, status: 200, json: async () => body, headers: { get: (h) => (h === 'content-range' ? range : null) } };
      };
      return { calls, fetchImpl };
    };
    let clock = Date.parse('2026-10-01T12:00:00Z');
    const prime = (opt) => Q.prime({ env: ENV, dataDir: DIR, now: (clock += 10 * 60e3), ...opt });
    const sum = () => Q.summary(F('period=all'), { dataDir: DIR });
    await t('not configured: the bundled snapshot answers and says so', async () => {
      await Q.prime({ env: {}, dataDir: DIR });
      const S = sum(); assert.equal(S.freshness.store, 'git'); assert.equal(S.freshness.storeReason, 'store-not-configured');
    });
    await t('a whole store snapshot is read first and gives the same answers', async () => {
      const base = sum();
      const r = rest({ meta: { ...fmeta, historyEvents: 1 },
        history: [{ record_id: 'lottery:990001', field: 'LotteryStatusValue', from_value: 'א', to_value: 'ב', observed_at: '2026-09-01T00:00:00Z', run_key: 'h1' }] });
      await prime({ fetchImpl: r.fetchImpl });
      const S = sum();
      assert.equal(S.freshness.store, 'supabase'); assert.equal(S.freshness.storeReason, null);
      assert.deepEqual(S.kpis, base.kpis); assert.deepEqual(S.coverage, base.coverage);
      assert.equal(Q.records(F('period=all'), { dataDir: DIR }).total, frecs.filter((x) => x.recordType === 'lottery').length);
      assert.equal(Q.record('lottery:990001', { dataDir: DIR }).history[0].to, 'ב', 'the history comes from the store');
      assert.ok(r.calls.some((c) => /^housing_lotteries\?select=record/.test(c)) && r.calls.every((c) => !/apikey|service/.test(c)));
    });
    await t('a project row cap below the page size is still read whole; concurrent requests share one read', async () => {
      const r = rest({ cap: 2 });
      await prime({ fetchImpl: r.fetchImpl });
      assert.equal(sum().freshness.store, 'supabase', sum().freshness.storeReason);
      assert.equal(r.calls.filter((c) => c.startsWith('housing_lotteries')).length, 3, '6 records in pages of 2');
      const r2 = rest(); clock += 10 * 60e3;
      await Promise.all([1, 2, 3].map(() => Q.prime({ env: ENV, dataDir: DIR, now: clock, fetchImpl: r2.fetchImpl })));
      assert.equal(r2.calls.filter((c) => c.startsWith('sync_runs')).length, 1, 'concurrent requests each read the store');
    });
    await t('a store that is incomplete, behind, failing or slow is never served — the bundled snapshot is, with the reason', async () => {
      await prime({ fetchImpl: rest({ recs: frecs.slice(1) }).fetchImpl });
      assert.match(sum().freshness.storeReason, /store-unavailable: store holds 5 records, its last run 6/);
      await prime({ fetchImpl: rest({ meta: { ...fmeta, checkedAt: '2026-01-01T00:00:00Z' } }).fetchImpl });
      assert.equal(sum().freshness.store, 'git'); assert.match(sum().freshness.storeReason, /^store-behind/);
      await prime({ fetchImpl: rest({ meta: null }).fetchImpl });
      assert.match(sum().freshness.storeReason, /no completed housing sync run/);
      await prime({ fetchImpl: rest({ meta: { ...fmeta, historyEvents: 1 }, history: [] }).fetchImpl });
      assert.match(sum().freshness.storeReason, /store holds 0 history events, its last run 1/, 'a store missing its history was served');
      await prime({ fetchImpl: rest({ fail: 500 }).fetchImpl });
      assert.match(sum().freshness.storeReason, /store-unavailable: store 500/);
      await prime({ fetchImpl: rest({ slow: true }).fetchImpl, timeoutMs: 30 });
      assert.match(sum().freshness.storeReason, /did not answer within 30 ms/);
      assert.equal(sum().freshness.store, 'git'); assert.ok(sum().kpis.lotteries > 0, 'the fallback still answers');
    });
    await t('a store whose last run was of other content is rewritten whole (recovery), a current one only touched', async () => {
      const recs = mergeRecords([], normalizeAll(nation(), CTX).records, { fetchedAt: 'T1' }).records;
      const mk = (lastHash, { ids = recs.map((r) => r.id), histCount = 0 } = {}) => { const calls = [];
        const fetchImpl = async (url, o = {}) => { const u = url.replace('https://example.supabase.co/rest/v1/', '');
          calls.push({ url: u, method: o.method || 'GET', body: o.body, prefer: o.headers && o.headers.Prefer });
          const body = u.startsWith('housing_lotteries?select=id') ? ids.map((id) => ({ id })) : u.startsWith('sync_runs?select=snapshot_hash') ? [{ snapshot_hash: lastHash }] : [];
          const total = u.startsWith('housing_status_history') ? histCount : u.startsWith('housing_lotteries') ? ids.length : 0;
          return { ok: true, text: async () => '', json: async () => body, headers: { get: (h) => (h === 'content-range' ? `0-0/${total}` : null) } }; };
        return { calls, store: new SupabaseHousingStore({ url: 'https://example.supabase.co', key: 'k', fetchImpl }) }; };
      const stale = mk('older-hash');
      await stale.store.write({ records: null, all: recs, run: { id: 'r4', status: 'ok', snapshotHash: 'current-hash' }, source: SOURCE, meta: { checkedAt: 'T2' } });
      assert.ok(stale.calls.some((c) => c.method === 'POST' && c.url.startsWith('housing_lotteries')), 'a stale store with the right count was not repaired');
      const runRow = JSON.parse(stale.calls.find((c) => c.method === 'POST' && c.url.startsWith('sync_runs')).body)[0];
      assert.deepEqual(runRow.details.meta, { checkedAt: 'T2' }, 'the run carries the meta the read side needs');
      const current = mk('current-hash');
      await current.store.write({ records: null, all: recs, run: { id: 'r5', status: 'ok', snapshotHash: 'current-hash' }, source: SOURCE, meta: { checkedAt: 'T3' } });
      assert.ok(!current.calls.some((c) => c.method === 'POST' && c.url.startsWith('housing_lotteries')), 'a current store was rewritten');
      /* extra official rows in the store (ids, not counts): no rewrite on every run */
      const extra = mk('current-hash', { ids: [...recs.map((r) => r.id), 'lottery:999999'] });
      await extra.store.write({ records: null, all: recs, run: { id: 'r6', status: 'ok', snapshotHash: 'current-hash' }, source: SOURCE, meta: {} });
      assert.ok(!extra.calls.some((c) => c.method === 'POST' && c.url.startsWith('housing_lotteries')), 'a store with extra rows is rewritten every run');
      /* the store lost status history (a failed write): every event is posted again, each stored once */
      const ev = [{ id: recs[0].id, field: 'LotteryStatusValue', from: 'א', to: 'ב', observedAt: 'T1', syncRunId: 'r1' }, { id: recs[1].id, field: 'Winners', from: 1, to: 2, observedAt: 'T1', syncRunId: 'r1' }];
      const lost = mk('current-hash', { histCount: 1 });
      await lost.store.write({ records: null, all: recs, history: [], allHistory: ev, run: { id: 'r7', status: 'ok', snapshotHash: 'current-hash' }, source: SOURCE, meta: {} });
      const hp = lost.calls.find((c) => c.method === 'POST' && c.url.startsWith('housing_status_history'));
      assert.ok(hp && JSON.parse(hp.body).length === 2, 'the missing history was not re-posted');
      assert.match(hp.url, /on_conflict=record_id,field,observed_at,run_key$/); assert.match(hp.prefer, /ignore-duplicates/);
      const whole = mk('current-hash', { histCount: 2 });
      await whole.store.write({ records: null, all: recs, history: [], allHistory: ev, run: { id: 'r8', status: 'ok', snapshotHash: 'current-hash' }, source: SOURCE, meta: {} });
      assert.ok(!whole.calls.some((c) => c.method === 'POST' && c.url.startsWith('housing_status_history')), 'a whole history was re-posted');
    });
    await Q.prime({ env: {}, dataDir: DIR });
  }

  console.log('production boundary');
  await t('no government-housing fixture leaks into Production (data, page, standalone, server code)', () => {
    const files = [path.join(ROOT, 'index.html'), path.join(ROOT, 'standalone', 'israel-new-homes-v2.html'), path.join(ROOT, 'api', 'housing.js'),
      ...fs.readdirSync(path.join(ROOT, 'lib', 'housing')).map((f) => path.join(ROOT, 'lib', 'housing', f))];
    const dataDir = path.join(ROOT, 'data', 'housing');
    if (fs.existsSync(dataDir)) for (const f of fs.readdirSync(dataDir)) if (/\.jsonl?$/.test(f)) files.push(path.join(dataDir, f));
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      assert.ok(!/TEST FIXTURE|"LotteryId":99\d{4}|lottery:99\d{4}/.test(s), 'fixture content in ' + path.relative(ROOT, f));
      if (/\.js$/.test(f)) assert.ok(!/require\([^)]*test\//.test(s), 'server code reads from test/: ' + path.relative(ROOT, f));
    }
  });
  await t('the production records (once synced) are official rows only, with provenance', () => {
    const f = path.join(ROOT, 'data', 'housing', 'lotteries.json');
    if (!fs.existsSync(f)) return;                                    // not synced in this checkout
    const recs = JSON.parse(fs.readFileSync(f, 'utf8'));
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'housing', 'meta.json'), 'utf8'));
    assert.ok(recs.length > 0);
    assert.equal(new Set(recs.map((r) => r.id)).size, recs.length, 'duplicate ids');
    for (const r of recs) {
      assert.equal(r.id, 'lottery:' + r.lotteryId);
      assert.equal(r.provenance.source, SOURCE.id); assert.equal(r.provenance.resourceId, SOURCE.resourceId);
      assert.ok(['live-api', 'replay-official-snapshot'].includes(r.provenance.retrievalMethod), r.id + ' ' + r.provenance.retrievalMethod);
      assert.match(r.provenance.snapshotHash, /^[0-9a-f]{40}$/);
      assert.ok(r.provenance.sourceRowId != null && r.firstSeenAt && (r.inLatestSource !== false || r.lastSeenAt));
      assert.equal(r.signedSales, null); assert.equal(r.availableInventory, null); assert.equal(r.coordinates, null);
      for (const k of ['unitsInLottery', 'winners', 'applicants']) assert.ok(r[k] == null || (Number.isInteger(r[k]) && r[k] >= 0), r.id + ' ' + k);
    }
    assert.equal(meta.source.id, SOURCE.id);
    assert.equal(meta.records, recs.length);
  });

  console.log('geography — lottery localities join the canonical registry');
  await t('every lottery locality code is one official locality in the registry (נוף הגליל 1061 included)', () => {
    const { loadGeo, searchGeo } = require('../lib/geo/registry');
    const G = loadGeo();
    const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'housing', 'lotteries.json'), 'utf8')).filter((r) => r.recordType === 'lottery');
    const codes = [...new Set(R.map((r) => r.localityCode))];
    assert.deepEqual(codes.filter((c) => !G.byCode.has(c)), [], 'lottery locality codes missing from the registry');
    const nof = G.byCode.get(1061);
    assert.equal(nof.he, 'נוף הגליל'); assert.equal(nof.en, 'NOF HAGALIL'); assert.equal(nof.district, 'd-north'); assert.deepEqual(nof.aliases, ['נצרת עילית']);
    assert.ok(R.filter((r) => r.localityCode === 1061).every((r) => r.city === nof.he), 'the source and the registry name code 1061 differently');
    assert.equal(G.localities.filter((l) => l.code === 1061 || l.n === 'נצרת עילית').length, 1, 'a second Nazareth Illit / Nof HaGalil entity');
    for (const q of ['נוף הגליל', 'נצרת עילית']) assert.equal(searchGeo(q, 3).matches.find((m) => m.kind === 'locality').id, 'loc:1061', q);
    /* the housing filter by code and by the official name select the same rows */
    const n1061 = R.filter((r) => r.localityCode === 1061).length;
    const byCode = Q.records(Q.parseFilters(new URLSearchParams('period=all&city=1061'), NOW).filters);
    const byName = Q.records(Q.parseFilters(new URLSearchParams('period=all&city=' + encodeURIComponent('נוף הגליל')), NOW).filters);
    assert.ok(n1061 > 0); assert.equal(byCode.total, n1061); assert.equal(byName.total, n1061);
  });

  console.log('page — the government housing section (run with the page\'s own strings)');
  const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const matched = (anchor) => {
    const i = INDEX.indexOf(anchor); assert.ok(i >= 0, 'missing ' + anchor);
    const open = INDEX.indexOf('{', i + anchor.length - 1); let depth = 0;
    for (let k = open; k < INDEX.length; k++) { if (INDEX[k] === '{') depth++; else if (INDEX[k] === '}' && --depth === 0) return INDEX.slice(i, k + 1); }
    throw new Error('unbalanced ' + anchor);
  };
  const HO_SRC = INDEX.slice(INDEX.indexOf('const HO_PAGE='), INDEX.indexOf('function initHousing('));
  const UI = require('node:vm').runInNewContext(matched('const I18N={') + `;
    const T=()=>I18N[state.lang];
    const calcEsc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
    const nf=new Intl.NumberFormat("en-US");const fmtInt=n=>nf.format(Math.round(n));const fmtNIS=n=>"₪"+fmtInt(n);
    const vcTag=c=>'<span class="vc '+c+'">'+T().vcName[c]+'</span>';
    function coveredIdByName(){return null}
    ` + HO_SRC + ';({hoN,hoDash,hoKpisHTML,hoChartHTML,hoGeoHTML,hoTableHTML,hoCovHTML,I18N,state,hoState})',
  { state: { lang: 'he', locId: null }, LOC: {}, MKT: { nh: null, boi: null }, location: { protocol: 'https:', host: 'x' }, Intl });
  const stripTags = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  await t('the section exists, is in the rail, and carries the specified titles', () => {
    assert.match(INDEX, /<section class="blk" id="housing">/);
    assert.match(INDEX, /<a href="#housing" class="ri" data-sec="housing">/);
    assert.equal(UI.I18N.he.hoTitle, 'דיור מסובסד');
    assert.equal(UI.I18N.he.hoSub, 'מחיר למשתכן · מחיר מטרה · דירה בהנחה');
    assert.equal(UI.I18N.en.hoTitle, 'Government Housing / Subsidized Housing Intelligence');
  });
  await t('missing factual values render as "—" (with the source tooltip); a real zero stays 0', () => {
    const dash = UI.hoN(null);
    assert.match(dash, />—</); assert.match(dash, /הנתון אינו קיים כרגע במקור הרשמי המחובר/);
    assert.match(UI.hoN(0), />0</);
    const none = stripTags(UI.hoKpisHTML({ kpis: null }));
    assert.equal((none.match(/—/g) || []).length, 7, 'every KPI of an uncovered period is "—"');
    assert.ok(!/\d/.test(none), 'a number appeared for an uncovered period: ' + none);
    /* what a user can read: every page string (both languages) and the markup outside scripts, styles and comments */
    const leaves = (o) => Object.values(o).flatMap((v) => typeof v === 'string' ? [v] : typeof v === 'function' ? [String(v)] : v && typeof v === 'object' ? leaves(v) : []);
    const visible = [...leaves(UI.I18N.he), ...leaves(UI.I18N.en)].join('\n') + INDEX.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/לא זמין|UNAVAILABLE|\bUnavailable\b/.test(visible), 'an "unavailable" value label is back');
    assert.equal(UI.I18N.he.naShort, '—'); assert.equal(UI.I18N.en.naShort, '—');
    assert.equal(UI.I18N.he.vcName.na, 'חסר'); assert.equal(UI.I18N.en.vcName.na, 'Missing');
  });
  await t('winners are never labelled as sales; units are never labelled as inventory', () => {
    for (const L of ['he', 'en']) {
      const s = UI.I18N[L];
      assert.ok(!/מכיר|נמכר|עסק|sale|sold|deal/i.test(s.hoKWin), L + ' winners label: ' + s.hoKWin);
      assert.match(s.hoKWinS, L === 'he' ? /אינו רוכש/ : /not a buyer/);
      for (const k of ['hoKUnits', 'hoKMkt', 'hoKUnitsS', 'hoKMktS']) {
        const v = typeof s[k] === 'function' ? s[k]('1') : s[k];
        assert.ok(!/מלאי|inventory|מכיר|sale/i.test(v), `${L}.${k}: ${v}`);
      }
      assert.ok(s.hoNoPub.length === 5, 'the not-published list');
    }
    const K = Q.summary(Q.parseFilters(new URLSearchParams('city=9000&period=all'), NOW).filters).kpis;
    if (K) {   // with the synced production data
      const html = stripTags(UI.hoKpisHTML({ kpis: K }));
      assert.ok(html.includes(new Intl.NumberFormat('en-US').format(K.winners)) && html.includes(new Intl.NumberFormat('en-US').format(K.unitsFirst)));
      assert.equal(K.signedSales, null); assert.equal(K.availableInventory, null);
    }
  });
  await t('the coverage band shows four separate facts and never reads the source update as currency', () => {
    const fr = { synced: true, sourceUpdatedAt: '2026-08-16T15:30:41Z', latestEventDate: '2025-01-27', checkedAt: '2026-10-01T02:45:00Z' };
    const sq = (h) => stripTags(h).replace(/\s+/g, '');
    const band = (state, period, f = fr) => sq(UI.hoCovHTML({ freshness: f, filters: { period },
      coverage: { state, coveredFrom: '2016-02-29', coveredTo: '2025-01-27' }, kpis: state === 'none' ? null : { lotteries: 3 } }));
    for (const L of ['he', 'en']) {
      UI.state.lang = L; const s = UI.I18N[L];
      const all = band('within', 'all');
      for (const [label, val] of [[s.hoF.upd, '16.08.2026'], [s.hoF.latest, '27.01.2025'], [s.hoF.chk, '01.10.2026'], [s.hoF.per, '29.02.2016–27.01.2025']])
        assert.ok(all.includes(sq(label + val)), `${L}: ${label}`);
      const stale = sq(s.hoCovStale('16.08.2026', '27.01.2025'));
      assert.ok(all.includes(stale), L + ': an update after the newest lottery is not said out loud');
      assert.ok(!band('within', 'all', { ...fr, sourceUpdatedAt: '2025-01-27T09:00:00Z' }).includes(sq(s.hoCovStale('27.01.2025', '27.01.2025'))), 'stale note without a later update');
      assert.ok(band('none', '6m').includes(sq(s.hoF.per + s.hoFPer.none)) && band('none', '6m').includes(sq(s.hoCovNone('27.01.2025'))));
      assert.ok(band('partial', '24m').includes(sq(s.hoF.per + s.hoFPer.partial('27.01.2025'))));
      assert.ok(band('within', 'custom').includes(sq(s.hoF.per + s.hoFPer.within)));
    }
    UI.state.lang = 'he';
    assert.equal(UI.I18N.he.hoPer.all, 'כל הרשומות במקור'); assert.equal(UI.I18N.en.hoPer.all, 'All source records');
    const words = (L) => [L.hoF, L.hoFPer, L.hoCovAll, L.hoCovStale, L.hoCovWithin, L.hoCovNone, L.hoCovPartial, L.hoPer, L.hoProv]
      .map((v) => typeof v === 'function' ? String(v) : JSON.stringify(v, (k, x) => typeof x === 'function' ? String(x) : x)).join(' ');
    assert.ok(!/עדכני|נכון ל|מעודכן עד|כל ההיסטוריה|כל התקופה|(^|[^א-ת])מלא([^א-ת]|$)/.test(words(UI.I18N.he)), 'he wording implies currency or completeness');
    assert.ok(!/current (through|to|as of)|up to date|complete|all history|\bfull\b/i.test(words(UI.I18N.en)), 'en wording implies currency or completeness');
  });
  await t('official text from the source is escaped before it enters the page', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = UI.hoTableHTML({ rows: [{ id: 'lottery:1', lotteryId: 1, projectId: 2, lotteryDate: '2024-01-01', city: evil, neighborhood: evil, projectName: evil, developer: evil,
      program: 'other', programHe: evil, lotteryType: 'first', unitsInLottery: 1, winners: 1, pricePerSqm: null, permitStatusHe: evil, projectStatusHe: evil }] });
    assert.ok(!html.includes('<img'), 'unescaped source text'); assert.ok(html.includes('&lt;img'));
  });
  await t('the page queries the API one page at a time and embeds no housing records', () => {
    assert.match(INDEX, /fetch\("\/api\/housing\?"\+q/);
    assert.match(INDEX, /const HO_PAGE=25;/);
    const sa = fs.readFileSync(path.join(ROOT, 'standalone', 'israel-new-homes-v2.html'), 'utf8');
    for (const src of [INDEX, sa]) assert.ok(!/"lotteryId":\d|lottery:\d{3,}|LotteryHousingUnits/.test(src), 'housing records embedded in a page');
  });
  await t('transaction freshness: the specified note, a configurable maturity window, no claimed average delay', () => {
    assert.equal(UI.I18N.he.txFreshNote, 'נתוני העסקאות מבוססים על עסקאות שדווחו ונקלטו במקורות הרשמיים. עסקאות חדשות עשויות להופיע בעיכוב, ולכן נתוני התקופות האחרונות ממשיכים להתעדכן.');
    assert.equal(UI.I18N.en.txFreshNote, 'Transaction data reflects deals reported and available in official sources. Recent transactions may appear with a reporting delay, so recent periods continue to update.');
    assert.match(INDEX, /const TX_MATURITY_DAYS=120;/);
    assert.equal(UI.I18N.he.txMatUpd, 'מתעדכן'); assert.equal(UI.I18N.en.txMatUpd, 'Still updating');
    for (const L of ['he', 'en']) for (const k of ['txFreshNote', 'txMatTip', 'txMatHist', 'txMatUpd', 'hoMatTip', 'hoMatHist']) {
      assert.ok(!/ממוצע|average/i.test(UI.I18N[L][k]), `${L}.${k} claims an average delay`);
    }
    // a historical period is never called complete
    assert.match(UI.I18N.he.txMatTip, /אינה בהכרח סגורה/); assert.match(UI.I18N.en.txMatTip, /not guaranteed complete/);
    assert.ok(!/complete|סגור/.test(UI.I18N.en.txMatHist + UI.I18N.he.txMatHist));
  });
  await t('drill-down and series carry no coordinates and no zeros outside coverage', () => {
    const S = Q.summary(Q.parseFilters(new URLSearchParams('period=6m'), NOW).filters);
    if (S.freshness.synced) {
      assert.equal(S.coverage.state, 'none'); assert.equal(S.kpis, null);
      assert.ok(!/<rect/.test(UI.hoChartHTML(S)), 'bars drawn for an uncovered period');
    }
    const geo = UI.hoGeoHTML({ breakdown: { level: 'city', rows: [{ key: '1', label: 'x', lotteries: 1, unitsFirst: 1, winners: 1, lastLotteryDate: '2024-01-01' }] }, facets: {}, kpis: {} });
    assert.ok(!/lat|lng|coord/i.test(geo.replace(/קואורדינטות|coordinates/g, '')));
  });

  console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
})();
