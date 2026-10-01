// PROPX · transaction ledger — offline tests (rolling backfill, identity, idempotency).
// `node test/ledger.test.js`

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeTransaction } = require('../lib/gov/schema');
const { TxLedger, MemoryLedgerStore, FileLedgerStore, SupabaseLedgerStore, backfillWindow } = require('../lib/gov/ledger');

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
};
/* a GovMap-like official row (stable objectid) as one request returned it */
const deal = (id, date, extra = {}, url = 'https://www.govmap.gov.il/api/real-estate/street-deals/1') => makeTransaction(
  { txId: id == null ? null : 'govmap:' + id, date, city: 'באר שבע', street: 'רגר', houseNumber: 10, price: 1400000, areaSqm: 95, ...extra },
  { source: 'govmap', sourceUrl: url, retrievedAt: 'r' });

(async () => {
  console.log('rolling window');
  await t('a refresh re-checks the last 120 days by default', () => {
    const w = backfillWindow(new Date('2026-10-01T03:00:00Z'));
    assert.deepEqual([w.from, w.to, w.days], ['2026-06-03', '2026-10-01', 120]);
  });

  console.log('upsert — Scenario D: late-arriving deals, no duplicates');
  await t('re-checking the same window is idempotent; a late deal is added once; first_seen_at never moves', async () => {
    const store = new MemoryLedgerStore(), L = new TxLedger(store);
    const day1 = await L.upsert('govmap', [deal(1, '2026-08-10'), deal(2, '2026-08-20')], { fetchedAt: '2026-09-01T03:00:00Z' });
    assert.deepEqual(day1, { inserted: 2, updated: 0, unchanged: 0, rejected: 0 });
    // the next refresh re-checks the window: the old rows again + one deal dated
    // August 5 that the source only published now (reporting lag)
    const day2 = await L.upsert('govmap', [deal(1, '2026-08-10'), deal(2, '2026-08-20'), deal(3, '2026-08-05')], { fetchedAt: '2026-09-02T03:00:00Z' });
    assert.deepEqual(day2, { inserted: 1, updated: 0, unchanged: 2, rejected: 0 });
    const day3 = await L.upsert('govmap', [deal(1, '2026-08-10'), deal(2, '2026-08-20'), deal(3, '2026-08-05')], { fetchedAt: '2026-09-03T03:00:00Z' });
    assert.deepEqual(day3, { inserted: 0, updated: 0, unchanged: 3, rejected: 0 });
    const rows = await store.all('govmap');
    assert.equal(rows.length, 3, 'no duplicate rows');
    const late = rows.find((r) => r.record_key === 'id:govmap:3');
    assert.equal(late.transaction_date, '2026-08-05');
    assert.equal(late.first_seen_at, '2026-09-02T03:00:00Z', 'first observed on the 2nd → a 28-day reporting lag is measurable');
    assert.equal(late.last_seen_at, '2026-09-03T03:00:00Z');
    assert.equal(rows.find((r) => r.record_key === 'id:govmap:1').first_seen_at, '2026-09-01T03:00:00Z');
  });
  await t('a row the source changed is updated in place, keeping its first sighting', async () => {
    const store = new MemoryLedgerStore(), L = new TxLedger(store);
    await L.upsert('govmap', [deal(7, '2026-07-01')], { fetchedAt: 'a' });
    const s = await L.upsert('govmap', [deal(7, '2026-07-01', { price: 1450000 })], { fetchedAt: 'b' });
    assert.deepEqual(s, { inserted: 0, updated: 1, unchanged: 0, rejected: 0 });
    const [r] = await store.all('govmap');
    assert.equal(r.price, 1450000); assert.equal(r.first_seen_at, 'a'); assert.equal(r.last_seen_at, 'b');
    // the source's earlier version is kept, not overwritten
    assert.equal(r.revisions.length, 1);
    assert.deepEqual([r.revisions[0].price, r.revisions[0].replaced_at, r.revisions[0].last_seen_at], [1400000, 'b', 'a']);
    await L.upsert('govmap', [deal(7, '2026-07-01', { price: 1460000 })], { fetchedAt: 'c' });
    const [r2] = await store.all('govmap');
    assert.deepEqual(r2.revisions.map((x) => x.price), [1450000, 1400000], 'newest revision first');
  });
  await t('a row missing from a later response is never deleted', async () => {
    const store = new MemoryLedgerStore(), L = new TxLedger(store);
    await L.upsert('govmap', [deal(1, '2026-03-01'), deal(2, '2026-08-01')], { fetchedAt: 'a' });
    await L.upsert('govmap', [deal(2, '2026-08-01')], { fetchedAt: 'b' });   // the March deal fell out of the window
    assert.equal((await store.all('govmap')).length, 2);
  });
  await t('overlapping requests of one refresh are deduplicated before the upsert', async () => {
    const store = new MemoryLedgerStore(), L = new TxLedger(store);
    const s = await L.upsert('govmap', [deal(1, '2026-08-01', {}, 'u1'), deal(1, '2026-08-01', {}, 'u2')], { fetchedAt: 'a' });
    assert.equal(s.inserted, 1);
  });

  console.log('identity — legitimate separate deals survive');
  await t('two identical flats sold the same day (two official ids) stay two deals', async () => {
    const store = new MemoryLedgerStore(), L = new TxLedger(store);
    await L.upsert('govmap', [deal(11, '2026-09-01'), deal(12, '2026-09-01')], { fetchedAt: 'a' });
    assert.equal((await store.all('govmap')).length, 2);
  });
  await t('id-less source: identical rows in one response are separate deals; re-fetching them adds nothing', async () => {
    const store = new MemoryLedgerStore(), L = new TxLedger(store);
    const twins = () => [deal(null, '2026-09-01', {}, 'u'), deal(null, '2026-09-01', {}, 'u')];
    assert.equal((await L.upsert('taxauth', twins(), { fetchedAt: 'a' })).inserted, 2);
    assert.deepEqual(await L.upsert('taxauth', twins(), { fetchedAt: 'b' }), { inserted: 0, updated: 0, unchanged: 2, rejected: 0 });
    assert.deepEqual((await store.all('taxauth')).map((r) => r.ordinal).sort(), [1, 2]);
  });
  await t('through the real GovMap normalizer: two identical id-less deals of one response stay two, whatever the clock', async () => {
    const { GovMapProvider } = require('../lib/gov/providers/govmap');
    const { MemoryStore } = require('../lib/gov/store');
    let tick = 0;
    const gm = new GovMapProvider({ store: new MemoryStore(), now: () => new Date(Date.UTC(2026, 8, 1, 3, 0, 0, tick++)).toISOString() });
    gm.now = () => new Date(Date.UTC(2026, 8, 1, 3, 0, 0, tick++)).toISOString();   // every row normalized a millisecond apart
    const raw = { dealDate: '2026-08-20T00:00:00', dealAmount: 1500000, assetArea: 90, assetRoomNum: 4, floorNumber: 3,
      settlementNameHeb: 'באר שבע', streetNameHeb: 'רגר', houseNumber: 10, propertyTypeDescription: 'דירה בבית קומות' };
    const ctx = { dealType: 2, sourceUrl: 'https://www.govmap.gov.il/api/real-estate/street-deals/9?dealType=2', retrievedAt: 'r1', responseId: 'resp-1' };
    const twins = [gm.normalizeDeal({ ...raw }, ctx), gm.normalizeDeal({ ...raw }, ctx)];
    const store = new MemoryLedgerStore(), L = new TxLedger(store);
    assert.equal((await L.upsert('govmap', twins, { fetchedAt: 'a' })).inserted, 2, 'legitimate identical deals were collapsed');
    // the same response fetched again (a new response id) re-observes the same two deals — nothing new
    const again = [gm.normalizeDeal({ ...raw }, { ...ctx, responseId: 'resp-2' }), gm.normalizeDeal({ ...raw }, { ...ctx, responseId: 'resp-2' })];
    assert.deepEqual(await L.upsert('govmap', again, { fetchedAt: 'b' }), { inserted: 0, updated: 0, unchanged: 2, rejected: 0 });
  });
  await t('a row with no transaction date is rejected, not guessed', async () => {
    const L = new TxLedger(new MemoryLedgerStore());
    assert.equal((await L.upsert('govmap', [deal(5, null)], { fetchedAt: 'a' })).rejected, 1);
  });

  console.log('backends');
  await t('the file ledger persists across runs with the same idempotent result', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    try {
      const L1 = new TxLedger(new FileLedgerStore(dir));
      await L1.upsert('govmap', [deal(1, '2026-08-10'), deal(2, '2026-08-20')], { fetchedAt: 'a' });
      const L2 = new TxLedger(new FileLedgerStore(dir));        // a new process
      assert.deepEqual(await L2.upsert('govmap', [deal(1, '2026-08-10'), deal(3, '2026-08-01')], { fetchedAt: 'b' }),
        { inserted: 1, updated: 0, unchanged: 1, rejected: 0 });
      assert.equal((await new FileLedgerStore(dir).all('govmap')).length, 3);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await t('the Supabase ledger upserts on (source_id, record_key) without rewriting first_seen_at', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (!init.method) return { ok: true, json: async () => [{ record_key: 'id:govmap:1', first_seen_at: 'old', content_hash: 'x', source_id: 'govmap' }] };
      return { ok: true, text: async () => '' };
    };
    const L = new TxLedger(new SupabaseLedgerStore({ url: 'https://example.supabase.co', key: 'k', fetchImpl }));
    await L.upsert('govmap', [deal(1, '2026-08-10')], { fetchedAt: 'new' });
    const post = calls.find((c) => c.init.method === 'POST');
    assert.match(post.url, /\/rest\/v1\/transactions\?on_conflict=source_id,record_key$/);
    assert.equal(post.init.headers['Content-Profile'], 'market');
    assert.match(post.init.headers.Prefer, /resolution=merge-duplicates/);
    const [row] = JSON.parse(post.init.body);
    assert.equal(row.first_seen_at, 'old', 'the first sighting is carried over');
    assert.equal(row.last_seen_at, 'new');
    assert.ok(!('previous' in row));
    // the stored row's hash differs → an update: its earlier version travels to the database
    assert.equal(row.revisions.length, 1); assert.equal(row.revisions[0].content_hash, 'x');
  });

  console.log('identity through the real GovMap normalizer — A–E');
  {
    const { GovMapProvider } = require('../lib/gov/providers/govmap');
    const { MemoryStore } = require('../lib/gov/store');
    const gm = new GovMapProvider({ store: new MemoryStore() });
    const base = { dealDate: '2026-08-20T00:00:00', dealAmount: 1500000, assetArea: 90, assetRoomNum: 4, floorNumber: 3,
      settlementNameHeb: 'באר שבע', streetNameHeb: 'רגר', houseNumber: 10, propertyTypeDescription: 'דירה בבית קומות' };
    const url = 'https://www.govmap.gov.il/api/real-estate/street-deals/9?dealType=2';
    const resp = (id, rows) => rows.map((r) => gm.normalizeDeal({ ...r }, { dealType: 2, sourceUrl: url, retrievedAt: 'at-' + id, responseId: 'resp-' + id }));
    await t('A · the same objectid in a later response is the same deal — updated in place, never a second row', async () => {
      const store = new MemoryLedgerStore(), L = new TxLedger(store);
      await L.upsert('govmap', resp(1, [{ ...base, objectid: 501 }]), { fetchedAt: '2026-09-01T03:00:00Z', target: 'area-a', runKey: 'r1' });
      // the source re-spelled the street: the objectid wins over the address fingerprint
      const s = await L.upsert('govmap', resp(2, [{ ...base, objectid: 501, streetNameHeb: 'רגר יצחק' }]), { fetchedAt: '2026-09-02T03:00:00Z' });
      assert.deepEqual(s, { inserted: 0, updated: 1, unchanged: 0, rejected: 0 });
      const rows = await store.all('govmap');
      assert.equal(rows.length, 1); assert.equal(rows[0].record_key, 'id:govmap:501'); assert.equal(rows[0].street, 'רגר יצחק');
    });
    await t('B · different objectids with identical fields are two deals', async () => {
      const store = new MemoryLedgerStore(), L = new TxLedger(store);
      assert.equal((await L.upsert('govmap', resp(1, [{ ...base, objectid: 601 }, { ...base, objectid: 602 }]), { fetchedAt: 'a' })).inserted, 2);
      assert.deepEqual((await store.all('govmap')).map((r) => r.record_key).sort(), ['id:govmap:601', 'id:govmap:602']);
    });
    await t('C · identical id-less rows of one response are two deals', async () => {
      const store = new MemoryLedgerStore(), L = new TxLedger(store);
      assert.equal((await L.upsert('govmap', resp(1, [base, base]), { fetchedAt: 'a' })).inserted, 2);
      assert.deepEqual((await store.all('govmap')).map((r) => r.ordinal).sort(), [1, 2]);
    });
    await t('D · re-fetching the same deals (a new response) adds nothing', async () => {
      const store = new MemoryLedgerStore(), L = new TxLedger(store);
      const rows = (id) => resp(id, [{ ...base, objectid: 701 }, { ...base, objectid: 702 }, base, base]);
      assert.equal((await L.upsert('govmap', rows(1), { fetchedAt: '2026-09-01T03:00:00Z' })).inserted, 4);
      for (const id of [2, 3]) assert.deepEqual(await L.upsert('govmap', rows(id), { fetchedAt: `2026-09-0${id}T03:00:00Z` }), { inserted: 0, updated: 0, unchanged: 4, rejected: 0 });
      assert.equal((await store.all('govmap')).length, 4);
    });
    await t('E · revised official fields keep the earlier version as a revision; the first sighting never moves', async () => {
      const store = new MemoryLedgerStore(), L = new TxLedger(store);
      await L.upsert('govmap', resp(1, [{ ...base, objectid: 801 }]), { fetchedAt: '2026-09-01T03:00:00Z', target: 'area-a', runKey: 'r1' });
      await L.upsert('govmap', resp(2, [{ ...base, objectid: 801, dealAmount: 1550000, assetArea: 92 }]), { fetchedAt: '2026-09-05T03:00:00Z', target: 'area-b', runKey: 'r2' });
      const [row] = await store.all('govmap');
      assert.equal(row.price, 1550000); assert.equal(row.area_sqm, 92);
      assert.equal(row.revisions.length, 1); assert.equal(row.revisions[0].price, 1500000); assert.equal(row.revisions[0].area_sqm, 90);
      assert.equal(row.revisions[0].replaced_at, '2026-09-05T03:00:00Z');
      assert.deepEqual([row.first_seen_at, row.first_seen_target, row.first_seen_run], ['2026-09-01T03:00:00Z', 'area-a', 'r1']);
      assert.equal(row.last_seen_at, '2026-09-05T03:00:00Z');
    });
  }

  console.log('window check — an incomplete sweep is never complete');
  {
    const { windowCheckOf, failureOf, refreshTargets, toSyncRunRow, exitCodeOf } = require('../lib/gov/tx-refresh');
    const full = { polygonsAvailable: 12, polygonsPlanned: 12, polygonsQueried: 12, requestsPlanned: 24, requestsRun: 24, pageLimitHits: 0, polyErrors: 0, requestsRefused: 0 };
    await t('complete only when every polygon was planned and answered, every request ran and no page was cut', () => {
      assert.deepEqual(windowCheckOf(full), { windowCheck: 'complete', gaps: [] });
      const cases = [[{ polygonsPlanned: 8, polygonsQueried: 8, requestsPlanned: 16, requestsRun: 16 }, 'polygon-cap'],
        [{ requestsRun: 10 }, 'time-budget'], [{ polygonsQueried: 11 }, 'polygons-unanswered'], [{ pageLimitHits: 1 }, 'page-limit'], [{ polyErrors: 2 }, 'request-errors'],
        [{ polyErrors: 2, requestsRefused: 2 }, 'requests-refused']];
      for (const [over, gap] of cases) {
        const w = windowCheckOf({ ...full, ...over });
        assert.equal(w.windowCheck, 'partial', gap); assert.ok(w.gaps.includes(gap), gap);
      }
      for (const d of [null, undefined, {}, { ...full, requestsRun: undefined }, { ...full, polygonsAvailable: NaN }, { ...full, pageLimitHits: undefined },
        { ...full, polyErrors: undefined }, { ...full, requestsRefused: undefined }]) assert.equal(windowCheckOf(d).windowCheck, 'unknown', JSON.stringify(d));
      assert.equal(windowCheckOf({ ...full, polygonsAvailable: 0, polygonsPlanned: 0, polygonsQueried: 0, requestsPlanned: 0, requestsRun: 0 }).windowCheck, 'unknown', 'no polygons proves nothing');
    });
    await t('refused, timed-out, failed and skipped areas are recorded as not checked; the run log never says ok for them', async () => {
      assert.equal(failureOf(new Error('HTTP 403 from https://www.govmap.gov.il/api/search-service/autocomplete')), 'refused');
      assert.equal(failureOf(new Error('HTTP 401 from x')), 'refused');
      assert.equal(failureOf(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'timeout');
      assert.equal(failureOf(new Error('time budget exhausted')), 'timeout');
      assert.equal(failureOf(new Error('HTTP 500 from x')), 'failed');
      /* the lookups answered but no deals request did: refused (all 401/403), failed, or cut before any ran */
      const none = { polygonsQueried: 0, requestsRun: 4, polyErrors: 4, requestsRefused: 4 };
      const diagOf = { ok: full, capped: { ...full, polygonsPlanned: 4, polygonsQueried: 4, requestsPlanned: 8, requestsRun: 8 },
        'deals-refused': { ...full, ...none }, 'deals-failed': { ...full, ...none, requestsRefused: 1 }, 'budget-gone': { ...full, polygonsQueried: 0, requestsRun: 0 } };
      const provider = { getTransactions: async (loc) => {
        if (loc.city === 'refused') throw new Error('HTTP 403 from https://www.govmap.gov.il/api/search-service/autocomplete');
        if (loc.city === 'slow') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const rows = []; rows.diagnostics = diagOf[loc.city];
        return rows;
      } };
      const L = new TxLedger(new MemoryLedgerStore());
      const targets = ['ok', 'capped', 'refused', 'slow', 'deals-refused', 'deals-failed', 'budget-gone'].map((c) => ({ id: c, city: c }));
      const { runs } = await refreshTargets({ provider, ledger: L, targets, now: new Date('2026-10-01T03:00:00Z'), runKey: 'r' });
      const by = Object.fromEntries(runs.map((r) => [r.target, r]));
      assert.deepEqual([by.ok.status, by.ok.windowCheck], ['ok', 'complete']);
      assert.deepEqual([by.capped.status, by.capped.windowCheck, by.capped.gaps], ['ok', 'partial', ['polygon-cap']]);
      assert.deepEqual([by.refused.status, by.refused.windowCheck], ['refused', 'not-checked']);
      assert.deepEqual([by.slow.status, by.slow.windowCheck], ['timeout', 'not-checked']);
      assert.deepEqual([by['deals-refused'].status, by['deals-refused'].windowCheck], ['refused', 'not-checked'], 'refused deals requests recorded as ok');
      assert.deepEqual([by['deals-failed'].status, by['budget-gone'].status], ['failed', 'timeout']);
      assert.deepEqual(runs.map((r) => toSyncRunRow(r).status), ['ok', 'partial', 'refused', 'failed', 'refused', 'failed', 'failed']);
      assert.equal(exitCodeOf([by['deals-refused']]), 3, 'an all-refused sweep must not exit 0');
      assert.ok(runs.every((r) => r.window.from === '2026-06-03' && r.window.to === '2026-10-01' && r.window.days === 120));
      const late = await refreshTargets({ provider, ledger: L, targets, now: new Date('2026-10-01T03:00:00Z'), deadline: Date.now() - 1 });
      assert.ok(late.runs.every((r) => r.status === 'skipped' && r.windowCheck === 'not-checked'));
      assert.equal(exitCodeOf(runs), 2); assert.equal(exitCodeOf([by.refused]), 3); assert.equal(exitCodeOf([by.slow]), 1);
    });
    await t('the window is configurable (TX_BACKFILL_DAYS / days)', async () => {
      const provider = { getTransactions: async (loc, f) => { assert.equal(f.months, Math.ceil(30 / 30) + 1); const r = []; r.diagnostics = full; return r; } };
      const { runs } = await refreshTargets({ provider, ledger: new TxLedger(new MemoryLedgerStore()), targets: [{ id: 'x', city: 'x' }], now: new Date('2026-10-01T03:00:00Z'), days: 30 });
      assert.deepEqual(runs[0].window, { from: '2026-09-01', to: '2026-10-01', days: 30 });
    });
  }

  console.log('reporting lag — the measurement foundation (no published average)');
  await t('a lag is observable only after a complete check of the same area covered the date; the first backfill is censored', () => {
    const { reportingLag } = require('../lib/gov/ledger');
    const runs = [
      { target: 'A', status: 'ok', windowCheck: 'complete', window: { from: '2026-05-31', to: '2026-09-28' }, finishedAt: '2026-09-28T03:01:00Z' },
      { target: 'B', status: 'refused', windowCheck: 'not-checked', window: { from: '2026-05-31', to: '2026-09-28' }, finishedAt: '2026-09-28T03:01:00Z' },
      { target: 'C', status: 'ok', windowCheck: 'partial', window: { from: '2026-05-31', to: '2026-09-28' }, finishedAt: '2026-09-28T03:01:00Z' },
    ];
    const rows = [
      { transaction_date: '2026-09-20', first_seen_at: '2026-09-30T03:00:00Z', first_seen_target: 'A' },   // observable: 10 days at most
      { transaction_date: '2026-07-01', first_seen_at: '2026-09-30T03:00:00Z', first_seen_target: 'A' },   // observable: 91 days at most
      { transaction_date: '2026-08-01', first_seen_at: '2026-09-28T03:00:30Z', first_seen_target: 'A' },   // seen BY the complete check: censored
      { transaction_date: '2026-09-20', first_seen_at: '2026-09-30T03:00:00Z', first_seen_target: 'B' },   // area never completely checked
      { transaction_date: '2026-09-20', first_seen_at: '2026-09-30T03:00:00Z', first_seen_target: 'C' },   // only a partial check
      { transaction_date: null, first_seen_at: '2026-09-30T03:00:00Z', first_seen_target: 'A' },
    ];
    const lag = reportingLag(rows, runs);
    assert.equal(lag.observable, 2); assert.equal(lag.censored, 3); assert.equal(lag.undated, 1);
    assert.equal(lag.buckets['≤14'], 1); assert.equal(lag.buckets['≤120'], 1);
    assert.ok(!Object.keys(lag).some((k) => /avg|average|mean|median/i.test(k)), 'an average is computed');
  });

  console.log('server-side job — api/jobs/tx-refresh.js');
  {
    const { makeHandler, authorized } = require('../api/jobs/tx-refresh');
    const TOKEN = 'unit-test-token-' + 'x'.repeat(40);
    const call = async (h, { method = 'POST', mode, auth } = {}) => {
      const res = { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
      await h({ method, url: '/api/jobs/tx-refresh' + (mode ? '?mode=' + mode : ''), headers: auth ? { authorization: auth } : {} }, res);
      let json = null; try { json = JSON.parse(res.body); } catch { /* not json */ }
      return { status: res.statusCode, json, raw: res.body };
    };
    await t('fail-closed: no token configured → 503; wrong or missing token → 401; GET → 405', async () => {
      const unset = makeHandler({ env: {} });
      assert.equal((await call(unset, { auth: 'Bearer ' + TOKEN })).status, 503);
      assert.equal((await call(makeHandler({ env: { PROPX_JOB_TOKEN: 'short' } }), { auth: 'Bearer short' })).status, 503, 'a short token is no token');
      const h = makeHandler({ env: { PROPX_JOB_TOKEN: TOKEN } });
      assert.equal((await call(h, {})).status, 401);
      assert.equal((await call(h, { auth: 'Bearer ' + TOKEN.slice(0, -1) + 'y' })).status, 401);
      assert.equal((await call(h, { auth: TOKEN })).status, 401, 'a token without the Bearer scheme');
      assert.equal((await call(h, { method: 'GET', auth: 'Bearer ' + TOKEN })).status, 405);
      assert.equal(authorized({ headers: { authorization: 'Bearer ' + TOKEN } }, { PROPX_JOB_TOKEN: TOKEN }), 'ok');
    });
    await t('probe: one official request, reported as reachable or refused — nothing written', async () => {
      const seen = [];
      const refuse = async (u) => { seen.push(String(u)); return { ok: false, status: 403, json: async () => ({}), text: async () => 'Forbidden' }; };
      const p1 = await call(makeHandler({ env: { PROPX_JOB_TOKEN: TOKEN }, fetchImpl: refuse }), { mode: 'probe', auth: 'Bearer ' + TOKEN });
      assert.equal(p1.status, 200); assert.deepEqual([p1.json.reachable, p1.json.status], [false, 'refused']);
      assert.equal(seen.length, 1); assert.match(seen[0], /govmap\.gov\.il\/api\/search-service\/autocomplete$/);
      const answer = async () => ({ ok: true, status: 200, json: async () => ({ results: [{ text: 'באר שבע', shape: 'POINT(3874799 3766263)' }] }),
        text: async () => JSON.stringify({ results: [{ text: 'באר שבע', shape: 'POINT(3874799 3766263)' }] }) });
      const p2 = await call(makeHandler({ env: { PROPX_JOB_TOKEN: TOKEN }, fetchImpl: answer }), { mode: 'probe', auth: 'Bearer ' + TOKEN });
      assert.equal(p2.json.reachable, true);
      assert.equal((await call(makeHandler({ env: { PROPX_JOB_TOKEN: TOKEN } }), { mode: 'drop', auth: 'Bearer ' + TOKEN })).status, 400);
    });
    await t('run: refuses without a store; with one, upserts and records one sync run per area — no rows or secrets in the answer', async () => {
      assert.equal((await call(makeHandler({ env: { PROPX_JOB_TOKEN: TOKEN } }), { mode: 'run', auth: 'Bearer ' + TOKEN })).json.error, 'store-not-configured');
      const KEY = 'service-role-secret-' + 'k'.repeat(30), SB = 'https://unit-test-project.supabase.co';
      const d = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
      const posts = [];
      const fetchImpl = async (u, init = {}) => {
        u = String(u);
        const j = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => '' });
        if (u.startsWith(SB)) { if (init.method === 'POST') posts.push({ u, body: JSON.parse(init.body) }); return j([]); }
        if (u.includes('/search-service/autocomplete')) return j({ results: [{ text: 'x', shape: 'POINT(3874799 3766263)' }] });
        if (/\/real-estate\/deals\//.test(u)) return j([{ polygon_id: 'P1' }]);
        if (u.includes('/real-estate/street-deals/')) return j({ data: [{ objectid: u.includes('dealType=1') ? 1 : 2, dealDate: d, dealAmount: 1000000, assetArea: 80,
          settlementNameHeb: 'באר שבע', streetNameHeb: 'רגר', houseNumber: 1, propertyTypeDescription: 'דירה בבית קומות' }] });
        return { ok: false, status: 404, json: async () => ({}) };
      };
      const r = await call(makeHandler({ env: { PROPX_JOB_TOKEN: TOKEN, SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: KEY }, fetchImpl }), { mode: 'run', auth: 'Bearer ' + TOKEN });
      assert.equal(r.status, 200, r.raw); assert.equal(r.json.recorded, true);
      assert.equal(r.json.runs.length, 3); assert.ok(r.json.runs.every((x) => x.status === 'ok' && x.windowCheck === 'complete' && x.inserted === 2), JSON.stringify(r.json.runs[0]));
      const tx = posts.filter((p) => /\/transactions\?/.test(p.u)).flatMap((p) => p.body);
      assert.ok(tx.length >= 2 && tx.every((x) => x.first_seen_target && x.first_seen_run === r.json.runKey));
      const runsRow = posts.filter((p) => /\/sync_runs\?/.test(p.u)).flatMap((p) => p.body);
      assert.deepEqual(runsRow.map((x) => [x.status, x.window_check]), [['running', 'not-checked'], ['ok', 'complete'], ['running', 'not-checked'], ['ok', 'complete'],
        ['running', 'not-checked'], ['ok', 'complete']], 'each area is recorded running, then with its result');
      assert.equal(posts.filter((p) => /\/sources\?/.test(p.u)).length, 1, 'the source row once per job');
      assert.ok(!r.raw.includes(KEY) && !r.raw.includes(TOKEN) && !r.raw.includes('unit-test-project'), 'a secret or the store address in the answer');
      assert.ok(!/"price"|dealAmount|"street"/.test(r.raw), 'transaction rows in the answer');
    });
    await t('R1 · a malformed store address is refused unechoed; store hosts, keys and the token are redacted before any cut', async () => {
      const { redact, storeConfig } = require('../lib/store-config');
      const HOST = 'abcdefghijklmnop.supabase.co', KEY = 'service-role-secret-' + 'k'.repeat(30);
      assert.equal(storeConfig({ SUPABASE_URL: HOST, SUPABASE_SERVICE_ROLE_KEY: KEY }).reason, 'store-misconfigured');
      assert.equal(storeConfig({ SUPABASE_URL: 'http://' + HOST, SUPABASE_SERVICE_ROLE_KEY: KEY }).reason, 'store-misconfigured');
      assert.equal(storeConfig({}).reason, 'store-not-configured');
      assert.ok(storeConfig({ SUPABASE_URL: ' https://' + HOST + '/ ', SUPABASE_SERVICE_ROLE_KEY: KEY }).ok);
      const r = await call(makeHandler({ env: { PROPX_JOB_TOKEN: TOKEN, SUPABASE_URL: HOST, SUPABASE_SERVICE_ROLE_KEY: KEY } }), { mode: 'run', auth: 'Bearer ' + TOKEN });
      assert.deepEqual([r.status, r.json.error], [503, 'store-misconfigured']); assert.ok(!r.raw.includes(HOST) && !r.raw.includes(KEY));
      const env = { SUPABASE_URL: HOST, SUPABASE_SERVICE_ROLE_KEY: KEY, PROPX_JOB_TOKEN: TOKEN };
      const msg = 'x'.repeat(290) + 'Failed to parse URL from ' + HOST + '/rest/v1/sources?on_conflict=id key=' + KEY + ' token ' + TOKEN;
      const out = redact(msg, env).slice(0, 300);
      assert.ok(!out.includes('abcdefgh') && !out.includes('service-role') && !out.includes('unit-test-token'), out.slice(280));
      assert.equal(redact('see other-project.supabase.co/rest', {}), 'see <store>/rest', 'an unconfigured project host is still removed');
      const { refreshTargets } = require('../lib/gov/tx-refresh');
      const leak = { getTransactions: async () => { throw new Error('Failed to parse URL from ' + HOST + '/rest/v1/transactions'); } };
      const { runs } = await refreshTargets({ provider: leak, ledger: new TxLedger(new MemoryLedgerStore()), targets: [{ id: 'a', city: 'a' }], redactText: (m) => redact(m, env) });
      assert.ok(!JSON.stringify(runs).includes(HOST), 'the run record (committed to the public repository) carries the store host');
    });
    await t('R6 · every official request carries its own timeout; no area starts after the job deadline', async () => {
      const KEY = 'service-role-secret-' + 'k'.repeat(30), SB = 'https://unit-test-project.supabase.co';
      const signals = [];
      const fetchImpl = async (u, init = {}) => { signals.push(!!init.signal);
        if (String(u).startsWith(SB)) return { ok: true, status: 200, json: async () => [], text: async () => '' };
        return { ok: false, status: 403, json: async () => ({}), text: async () => '' }; };
      const r = await call(makeHandler({ env: { PROPX_JOB_TOKEN: TOKEN, SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: KEY, TX_JOB_BUDGET_MS: '600000' }, fetchImpl }),
        { mode: 'run', auth: 'Bearer ' + TOKEN });
      assert.equal(r.status, 200); assert.ok(signals.length && signals.every(Boolean), 'a request without a timeout');
      assert.ok(r.json.runs.every((x) => x.status === 'refused' && x.windowCheck === 'not-checked'));
      const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'jobs', 'tx-refresh.js'), 'utf8');
      assert.match(src, /Math\.min\(Number\(env\.TX_JOB_BUDGET_MS\) \|\| AREA_START_MS, AREA_START_MS\)/, 'the env can stretch the deadline past maxDuration');
    });
    await t('R7 · a page the source reports as cut (totalCount above the rows) is never complete — through the real GovMap sweep', async () => {
      const { GovMapProvider } = require('../lib/gov/providers/govmap');
      const { MemoryStore } = require('../lib/gov/store');
      const { windowCheckOf } = require('../lib/gov/tx-refresh');
      const d = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
      const sweep = async (totalCount) => {
        const j = (o) => ({ ok: true, status: 200, json: async () => o });
        const fetchImpl = async (u) => { u = String(u);
          if (u.includes('/search-service/autocomplete')) return j({ results: [{ text: 'x', shape: 'POINT(3874799 3766263)' }] });
          if (/\/real-estate\/deals\//.test(u)) return j([{ polygon_id: 'P1' }]);
          return j({ totalCount, data: [{ objectid: u.includes('dealType=1') ? 1 : 2, dealDate: d, dealAmount: 1000000, assetArea: 80, propertyTypeDescription: 'דירה בבית קומות' }] }); };
        const rows = await new GovMapProvider({ store: new MemoryStore(), fetchImpl }).getTransactions({ city: 'באר שבע' }, { months: 5 });
        return windowCheckOf(rows.diagnostics);
      };
      assert.deepEqual(await sweep(1), { windowCheck: 'complete', gaps: [] });
      const cut = await sweep(250);
      assert.equal(cut.windowCheck, 'partial'); assert.ok(cut.gaps.includes('page-limit'));
    });
    /* GitHub OIDC: a signing key of our own stands in for GitHub's; its JWKS is served by the fetch double */
    const crypto = require('node:crypto');
    const { verifyGithubOidc, EXPECT, ISSUER, JWKS_URL } = require('../lib/gov/oidc');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'unit-kid', alg: 'RS256', use: 'sig' };
    const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
    const nowS = Math.floor(Date.now() / 1000);
    const goodClaims = { iss: ISSUER, aud: 'propx-jobs', iat: nowS - 5, nbf: nowS - 5, exp: nowS + 300, repository: EXPECT.repository,
      repository_id: EXPECT.repositoryId, ref: EXPECT.ref, event_name: 'workflow_dispatch', workflow_ref: `${EXPECT.repository}/.github/workflows/tx-refresh.yml@${EXPECT.ref}` };
    const jwt = (claims = {}, { header = {}, key = privateKey } = {}) => {
      const h = b64({ alg: 'RS256', kid: 'unit-kid', typ: 'JWT', ...header }), pl = b64({ ...goodClaims, ...claims });
      return `${h}.${pl}.${crypto.sign('RSA-SHA256', Buffer.from(h + '.' + pl), key).toString('base64url')}`;
    };
    const withJwks = (rest) => async (u, init) => (String(u) === JWKS_URL ? { ok: true, status: 200, json: async () => ({ keys: [jwk] }) } : rest(u, init));
    const noNet = withJwks(async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' }));
    await t('GitHub OIDC: only this repository, its production branch and its job workflow — every other token is refused', async () => {
      const claims = await verifyGithubOidc(jwt(), { fetchImpl: noNet });
      assert.equal(claims.repository, 'kobi6061-hub/vizora');
      const bad = [
        [jwt({ aud: 'other' }), /audience/], [jwt({ repository_id: '1' }), /repository/], [jwt({ repository: 'someone/vizora' }), /repository/],
        [jwt({ ref: 'refs/heads/main' }), /ref/], [jwt({ ref: 'refs/pull/1/merge' }), /ref/], [jwt({ event_name: 'pull_request' }), /event/],
        [jwt({ workflow_ref: `${EXPECT.repository}/.github/workflows/evil.yml@${EXPECT.ref}` }), /workflow/],
        [jwt({ exp: nowS - 120 }), /expired/], [jwt({ iss: 'https://evil.example' }), /issuer/],
        [jwt({}, { key: other.privateKey }), /bad signature/], [jwt({}, { header: { kid: 'nope' } }), /unknown signing key/],
        [jwt({}, { header: { alg: 'none' } }), /algorithm/], [jwt({}, { header: { alg: 'HS256' } }), /algorithm/], ['a.b', /not a JWT/],
      ];
      for (const [tok, why] of bad) await assert.rejects(verifyGithubOidc(tok, { fetchImpl: noNet }), why);
      // the endpoint: a verified OIDC token passes without PROPX_JOB_TOKEN; an unverifiable one is 401, never 503
      const answer = withJwks(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ results: [] }), text: async () => '{"results":[]}' }));
      const ok = await call(makeHandler({ env: {}, fetchImpl: answer }), { mode: 'probe', auth: 'Bearer ' + jwt() });
      assert.equal(ok.status, 200, ok.raw); assert.deepEqual([ok.json.reachable, ok.json.status, ok.json.http.status], [true, 'accepted', 200]);
      assert.equal((await call(makeHandler({ env: {}, fetchImpl: answer }), { mode: 'probe', auth: 'Bearer ' + jwt({ ref: 'refs/heads/main' }) })).status, 401);
    });
    await t('probe reports a refusal as the source sent it; sample runs the page path per city with official rows', async () => {
      const refuse = withJwks(async () => ({ ok: false, status: 403, headers: { get: (k) => ({ server: 'edge-x', 'content-type': 'text/html' })[k] || null },
        json: async () => ({}), text: async () => '<html><title>Access denied</title><body>Request blocked. <script>x()</script></body></html>' }));
      const pr = await call(makeHandler({ env: {}, fetchImpl: refuse }), { mode: 'probe', auth: 'Bearer ' + jwt() });
      assert.deepEqual([pr.json.reachable, pr.json.status, pr.json.http.status, pr.json.http.headers.server], [false, 'refused', 403, 'edge-x']);
      assert.match(pr.json.http.bodyExcerpt, /Access denied Request blocked/); assert.ok(!/script|x\(\)/.test(pr.json.http.bodyExcerpt));
      const d = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10);
      const gm = withJwks(async (u) => { u = String(u); const j = (o) => ({ ok: true, status: 200, json: async () => o });
        if (u.includes('/search-service/autocomplete')) return j({ results: [{ text: 'x', shape: 'POINT(3874799 3766263)' }] });
        if (/\/real-estate\/deals\//.test(u)) return j([{ polygon_id: 'P1' }]);
        if (u.includes('/real-estate/street-deals/')) return j({ totalCount: 1, data: [{ objectid: u.includes('dealType=1') ? 11 : 12, dealDate: d, dealAmount: 2100000,
          assetArea: 100, assetRoomNum: 4, floorNumber: 5, settlementNameHeb: 'באר שבע', streetNameHeb: 'רגר', houseNumber: 7, propertyTypeDescription: 'דירה בבית קומות' }] });
        return { ok: false, status: 404, json: async () => ({}) }; });
      const sm = await call(makeHandler({ env: {}, fetchImpl: gm }), { mode: 'sample', auth: 'Bearer ' + jwt() });
      assert.equal(sm.status, 200, sm.raw); assert.equal(sm.json.cities.length, 4);
      const c0 = sm.json.cities[0];
      assert.deepEqual([c0.city, c0.status, c0.counts.official, c0.counts.residential, c0.latestTransactionDate], ['באר שבע', 'ok', 2, 2, d]);
      assert.deepEqual(Object.keys(c0.rows[0]), ['date', 'city', 'street', 'houseNumber', 'block', 'parcel', 'subParcel', 'rooms', 'areaSqm', 'floor', 'price', 'newness', 'dealType', 'partialSale']);
      assert.equal(c0.rows[0].price, 2100000); assert.ok(c0.unavailable.some((u) => /taxes\.gov\.il/.test(u)), 'the Tax Authority connector state is reported');
      assert.equal((await call(makeHandler({ env: {}, fetchImpl: gm }), { mode: 'sample', auth: 'Bearer ' + jwt(), url: 'x' })).status, 200);
      const bad = await call(makeHandler({ env: {}, fetchImpl: gm }), { mode: 'sample&cities=' + encodeURIComponent('<script>'), auth: 'Bearer ' + jwt() });
      assert.equal(bad.status, 400);
    });
    await t('the session gate lets past only the login, crawler files and exactly /api/jobs/tx-refresh', async () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'middleware.js'), 'utf8');
      const m = /matcher:\s*\['([^']+)'\]/.exec(src); assert.ok(m, 'matcher not found');
      const matched = new RegExp('^' + m[1].replace(/\\\\/g, '\\') + '$');
      /* run the real middleware (ES module → a function) on the paths the matcher sends it */
      const body = src.replace(/export const config/, 'const config').replace(/export default async function middleware/, 'async function middleware');
      const mw = new Function('process', 'crypto', 'Response', 'URL', 'TextEncoder', body + '\nreturn middleware;')(
        { env: { SESSION_SECRET: 'unit-test-session-secret' } }, globalThis.crypto, Response, URL, TextEncoder);
      const gated = async (p) => { if (!matched.test(p)) return false; const r = await mw(new Request('https://propx.example' + p)); return !!r && r.status === 302; };
      for (const open of ['/api/login', '/login.html', '/robots.txt', '/favicon.ico', '/api/jobs/tx-refresh']) assert.equal(await gated(open), false, open + ' is gated');
      for (const p of ['/', '/index.html', '/api/housing', '/api/gov/transactions', '/api/geo/search', '/api/logout', '/data/market/x.json', '/standalone/x.html',
        '/api/jobs', '/api/jobs/', '/api/jobsx', '/api/jobs/tx-refresh/', '/api/jobs/tx-refreshx', '/api/jobs/other', '/api/jobs/%2e%2e/housing', '/api/jobs/tx-refresh/..%2fhousing',
        '/x/api/jobs/tx-refresh']) assert.equal(await gated(p), true, p + ' escaped the gate');
    });
  }

  console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
})();
