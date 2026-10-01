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
  });

  console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
})();
