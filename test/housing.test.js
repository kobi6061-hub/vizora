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
const { mergeRecords, FileHousingStore, SupabaseHousingStore } = require('../lib/housing/store');
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
    assert.equal(m2.records.length, 6); assert.deepEqual(m2.stats, { inserted: 0, updated: 0, unchanged: 6, missingFromSource: 0 });
    assert.equal(new Set(m2.records.map((r) => r.id)).size, 6);
    assert.ok(m2.records.every((r) => r.firstSeenAt === 'T1' && r.lastSeenAt === 'T2'));
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
    const m2 = mergeRecords(m1.records, normalizeAll(nation().slice(1), CTX).records, { fetchedAt: 'T2' });
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
    assert.equal(s.series.points[3].partialMonth, true);
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
  await t('data maturity: results pending or a recent lottery is "updating"', () => {
    const r = normalizeLottery(row({ LotteryStatusValue: 'הגרלה נסגרה לרישום' }), CTX).record;
    assert.equal(Q.maturityOf(r, '2026-10-01'), 'updating');
    assert.equal(Q.maturityOf({ ...r, lotteryStatus: 'פורסמו תוצאות', lotteryDate: '2026-09-01' }, '2026-10-01'), 'updating');
    assert.equal(Q.maturityOf({ ...r, lotteryStatus: 'פורסמו תוצאות', lotteryDate: '2025-01-27' }, '2026-10-01'), 'settled');
  });

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
      assert.ok(r.provenance.sourceRowId != null && r.firstSeenAt && r.lastSeenAt);
      assert.equal(r.signedSales, null); assert.equal(r.availableInventory, null); assert.equal(r.coordinates, null);
      for (const k of ['unitsInLottery', 'winners', 'applicants']) assert.ok(r[k] == null || (Number.isInteger(r[k]) && r[k] >= 0), r.id + ' ' + k);
    }
    assert.equal(meta.source.id, SOURCE.id);
    assert.equal(meta.records, recs.length);
  });

  console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
})();
