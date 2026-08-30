// PROPX · government data layer — offline test suite (no network: every
// provider runs against injected fetch fakes backed by fixtures, exactly how
// the sandbox and CI must run it). `node test/gov.test.js`

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { makeTransaction, validateTransaction, NEWNESS, isEstimated, toIsoDate } = require('../lib/gov/schema');
const { classifyNewness, partitionByNewness } = require('../lib/gov/classify');
const { dedupe, addressFingerprint } = require('../lib/gov/fingerprint');
const { MemoryStore, FileStore } = require('../lib/gov/store');
const { DataGovProvider } = require('../lib/gov/providers/datagov');
const { CbsProvider } = require('../lib/gov/providers/cbs');
const { TaxAuthorityProvider } = require('../lib/gov/providers/taxAuthority');
const { GovSourceUnavailableError } = require('../lib/gov/providers/base');
const { GovDataService } = require('../lib/gov/service');

const FIX = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'gov', 'fixtures', f), 'utf8'));
const registry = FIX('registry-azor.json');
const azor = FIX('azor-jabotinsky7.json');

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(
  () => { passed++; console.log('  ✓', name); },
  (e) => { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; },
);
const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj });

(async () => {
  console.log('schema');
  await t('missing fields stay null and are listed — never filled', () => {
    const tx = makeTransaction({ price: 1000000, city: 'אזור' }, { source: 's', retrievedAt: 'now' });
    assert.equal(tx.rooms, null);
    assert.ok(tx.missing.includes('rooms') && tx.missing.includes('block'));
    assert.equal(validateTransaction(tx).length, 0);
  });
  await t('derived price/sqm is explicitly marked estimated', () => {
    const tx = makeTransaction({ price: 2000000, areaSqm: 100 }, { source: 's', retrievedAt: 'now' });
    assert.ok(isEstimated(tx.pricePerSqm));
    assert.equal(tx.pricePerSqm.value, 20000);
    assert.equal(tx.pricePerSqm.method, 'price/areaSqm');
  });
  await t('date parsing: dd.mm.yyyy and bare year', () => {
    assert.equal(toIsoDate('15.05.2026'), '2026-05-15');
    assert.equal(toIsoDate('2026'), null); // year-only is NOT silently expanded
  });

  console.log('classification');
  await t('"דירה חדשה מקבלן" → confirmed_new with evidence', () => {
    const c = classifyNewness({ dealNature: 'דירה חדשה מקבלן' });
    assert.equal(c.newness, NEWNESS.CONFIRMED_NEW);
    assert.ok(c.evidence[0].includes('דירה חדשה מקבלן'));
  });
  await t('building year ≈ deal year → probable_new, never confirmed', () => {
    const c = classifyNewness({ yearBuilt: 2026, dealYear: 2026 });
    assert.equal(c.newness, NEWNESS.PROBABLE_NEW);
  });
  await t('no evidence → unknown; partitions never mix', () => {
    const c = classifyNewness({ dealNature: 'דירה בבית קומות', yearBuilt: 1998, dealYear: 2026 });
    assert.equal(c.newness, NEWNESS.UNKNOWN);
    const parts = partitionByNewness([
      { newness: NEWNESS.CONFIRMED_NEW }, { newness: NEWNESS.UNKNOWN }, { newness: NEWNESS.PROBABLE_NEW },
    ]);
    assert.deepEqual([parts.confirmed.length, parts.probable.length, parts.unknown.length], [1, 1, 1]);
  });

  console.log('deduplication');
  await t('same government id → one merged record with both provenances', () => {
    const mk = (src, extra) => makeTransaction({ txId: 'K1', price: 1500000, city: 'אזור', ...extra },
      { source: src, retrievedAt: 'now' });
    const out = dedupe([mk('a', {}), mk('b', { rooms: 3 })]);
    assert.equal(out.length, 1);
    assert.equal(out[0].rooms, 3); // merged fill
    assert.equal(out[0].provenance.length, 2);
  });
  await t('no id → address/date/price fingerprint dedupes', () => {
    const mk = () => makeTransaction({ city: 'אזור', street: 'ז\'בוטינסקי', houseNumber: 7, date: '2026-05-15', price: 2380000, areaSqm: 104 },
      { source: 's', retrievedAt: 'now' });
    assert.equal(addressFingerprint(mk()), addressFingerprint(mk()));
    assert.equal(dedupe([mk(), mk()]).length, 1);
  });

  console.log('data.gov.il provider (fixture-backed fetch)');
  await t('searchLocation("אזור") finds the city via the registries', async () => {
    const p = new DataGovProvider({ fetchImpl: async (url) => jsonRes({ success: true, result: String(url).includes('9ad3862c') ? registry.streets : registry.cities }), store: new MemoryStore() });
    const r = await p.searchLocation('אזור');
    const city = r.matches.find((m) => m.kind === 'city');
    assert.equal(city.city, 'אזור');
    assert.equal(city.cityCode, 565);
    assert.ok(r.provenance.source === 'data.gov.il');
  });
  await t('resolveAddress(אזור, ז\'בוטינסקי, 7): city code 565, house number echoed unverified', async () => {
    const p = new DataGovProvider({ fetchImpl: async (url) => jsonRes({ success: true, result: String(url).includes('9ad3862c') ? registry.streets : registry.cities }), store: new MemoryStore() });
    const r = await p.resolveAddress('אזור', "ז'בוטינסקי", 7);
    assert.equal(r.cityCode, 565);
    assert.equal(r.street, "ז'בוטינסקי");
    assert.equal(r.houseNumber, 7);
    assert.equal(r.houseNumberVerified, false); // registry has streets, not buildings — stated, not hidden
  });
  console.log('Tax Authority provider');
  await t('without an authorized connector every tx call fails gracefully & actionably', async () => {
    const p = new TaxAuthorityProvider({ endpoint: null });
    assert.equal(p.enabled(), false);
    assert.ok(p.capabilities().includes('getTransactions')); // interface declared even while transport is off
    await assert.rejects(() => p.getTransactions({ city: 'אזור' }), (e) => {
      assert.ok(e instanceof GovSourceUnavailableError);
      assert.ok(e.reason.includes('GOV_TAXAUTH_ENDPOINT'));
      return true;
    });
  });
  await t('normalizeRawDeal maps the full KARMAN-shaped record (sample values, real shape)', () => {
    const p = new TaxAuthorityProvider({ endpoint: null });
    const tx = p.normalizeRawDeal(azor.raw[0], { city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7, sample: true });
    assert.equal(tx.txId, 'SAMPLE-AZOR-0001');
    assert.equal(tx.date, '2026-05-15');
    assert.equal(tx.price, 2380000);
    assert.equal(tx.areaSqm, 104);
    assert.equal(tx.rooms, 4);
    assert.equal(tx.floor, '3');
    assert.equal(tx.floorsInBuilding, 9);
    assert.equal(tx.yearBuilt, 2026);
    assert.deepEqual([tx.block, tx.parcel, tx.subParcel], ['6024', '88', '12']);
    assert.equal(tx.city, 'אזור');
    assert.equal(tx.houseNumber, 7);
    assert.equal(tx.newness, NEWNESS.CONFIRMED_NEW);
    assert.ok(isEstimated(tx.pricePerSqm) && tx.pricePerSqm.value === Math.round(2380000 / 104));
    assert.equal(tx.provenance.sample, true); // fixture rows can never masquerade as live data
    assert.equal(validateTransaction(tx).length, 0);
  });

  console.log('ACCEPTANCE · ז\'בוטינסקי 7, אזור');
  const mkAuthorizedService = () => {
    const taxFetch = async (url) => {
      const u = String(url);
      if (u.includes('/transactions')) return jsonRes({ records: azor.raw });
      throw new Error('unexpected authorized call ' + u);
    };
    const tax = new TaxAuthorityProvider({ endpoint: 'https://authorized.example/gov', fetchImpl: taxFetch });
    const dg = new DataGovProvider({ fetchImpl: async (url) => jsonRes({ success: true, result: String(url).includes('9ad3862c') ? registry.streets : registry.cities }) });
    const store = new MemoryStore();
    return { svc: new GovDataService({ providers: [tax, dg], store }), store };
  };
  await t('ladder resolves at building scope and the scope is exposed', async () => {
    const { svc } = mkAuthorizedService();
    const r = await svc.getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    assert.equal(r.scope.level, 'building');
    assert.ok(r.scope.description.includes("ז'בוטינסקי 7"));
    assert.equal(r.transactions.length, 2);
  });
  await t('new-construction analytics receive ONLY the confirmed_new deal', async () => {
    const { svc } = mkAuthorizedService();
    const r = await svc.getConfirmedNewTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    assert.equal(r.transactions.length, 1);
    assert.equal(r.transactions[0].txId, 'SAMPLE-AZOR-0001');
    assert.equal(r.partitions.unknown.length, 1); // the 1998 building stays out
  });
  await t('snapshots detect change vs no-change over time', async () => {
    const { svc, store } = mkAuthorizedService();
    await svc.getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    await svc.getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    const key = "tx:ז'בוטינסקי 7, אזור";
    assert.equal(store.history(key).length, 1); // identical payload → one snapshot
  });
  await t('without the connector the same query degrades to an EXPLAINED empty result', async () => {
    const tax = new TaxAuthorityProvider({ endpoint: null });
    const svc = new GovDataService({ providers: [tax] });
    const r = await svc.getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    assert.equal(r.scope, null);
    assert.equal(r.transactions.length, 0);
    assert.ok(r.unavailable.some((u) => u.reason.includes('officially supported')));
  });
  await t('normalized output matches the observed government-derived reference record', () => {
    const p = new TaxAuthorityProvider({ endpoint: null });
    const ref = azor.observedReference;
    const tx = p.normalizeRawDeal(ref.raw, { sourceUrl: ref.sourceUrl });
    assert.equal(tx.price, ref.expected.price);
    assert.equal(tx.areaSqm, ref.expected.areaSqm);
    assert.equal(tx.rooms, ref.expected.rooms);
    assert.equal(tx.floor, ref.expected.floor);
    assert.equal(tx.floorsInBuilding, ref.expected.floorsInBuilding);
    assert.equal(tx.city, ref.expected.city);
    assert.equal(tx.street, ref.expected.street);
    assert.equal(tx.newness, ref.expected.newness);
    assert.equal(tx.pricePerSqm.value, ref.expected.pricePerSqmEstimated); // 39,130 — matches the published ₪/m²
    assert.ok(isEstimated(tx.pricePerSqm));
    assert.equal(tx.date, null); // source published year-only → no invented date
    assert.ok(tx.missing.includes('date'));
  });

  console.log('CBS provider (fixture-backed fetch)');
  await t('catalog discovery finds the new-homes series; points are national-scoped', async () => {
    const cbsFetch = async (url) => {
      const u = String(url);
      if (u.includes('catalog')) return jsonRes({ chapters: [{ name: 'דיור', subjects: [{ code: 40010, name: 'מדדי דיור', series: [{ id: 400777, name: 'מדד מחירי דירות חדשות' }] }] }] });
      if (u.includes('/index/data/price')) return jsonRes({ month: [
        { date: '2026-04', currBase: { value: 512.3 } }, { date: '2026-05', currBase: { value: 511.1 } }] });
      throw new Error('unexpected ' + u);
    };
    const p = new CbsProvider({ fetchImpl: cbsFetch, store: new MemoryStore() });
    const r = await p.getMarketTrends('תל אביב-יפו');
    assert.equal(r.scope, 'national');
    assert.equal(r.requestedLocation, 'תל אביב-יפו');
    assert.equal(r.series.id, 400777);
    assert.equal(r.points.length, 2);
    assert.equal(r.points[1].value, 511.1);
  });

  console.log('stores');
  await t('FileStore writes timestamped snapshots + latest, change-detected', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'propx-gov-'));
    const st = new FileStore(dir);
    const a = st.snapshot('k', { v: 1 });
    const b = st.snapshot('k', { v: 1 });
    const c = st.snapshot('k', { v: 2 });
    assert.deepEqual([a.changed, b.changed, c.changed], [true, false, true]);
    assert.equal(st.history('k').length, 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\n${passed} passed${process.exitCode ? ' — WITH FAILURES' : ', all green'}`);
})();
