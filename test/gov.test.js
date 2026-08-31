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
const { GovMapProvider } = require('../lib/gov/providers/govmap');
const { verifyAgainstReference } = require('../lib/gov/verify');
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
  await t('old building year → second_hand; NO evidence at all → unknown; partitions never mix', () => {
    const aged = classifyNewness({ dealNature: 'דירה בבית קומות', yearBuilt: 1998, dealYear: 2026 });
    assert.equal(aged.newness, NEWNESS.SECOND_HAND);
    const bare = classifyNewness({ dealNature: 'דירה בבית קומות' });
    assert.equal(bare.newness, NEWNESS.UNKNOWN);
    const parts = partitionByNewness([
      { newness: NEWNESS.CONFIRMED_NEW }, { newness: NEWNESS.UNKNOWN },
      { newness: NEWNESS.PROBABLE_NEW }, { newness: NEWNESS.SECOND_HAND },
    ]);
    assert.deepEqual(
      [parts.confirmed.length, parts.probable.length, parts.secondHand.length, parts.unknown.length],
      [1, 1, 1, 1]);
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
    assert.equal(r.partitions.secondHand.length, 1); // the 1998 building is second_hand — and stays out
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

  console.log('second-hand class & source classification');
  await t('government second-hand marker → second_hand, never mixed into new', () => {
    const c = classifyNewness({ sourceClassification: 'govmap dealType=2 (second hand / יד שנייה)' });
    assert.equal(c.newness, NEWNESS.SECOND_HAND);
    const c1 = classifyNewness({ sourceClassification: 'govmap dealType=1 (first hand / יד ראשונה מקבלן)' });
    assert.equal(c1.newness, NEWNESS.CONFIRMED_NEW);
    const parts = partitionByNewness([{ newness: NEWNESS.SECOND_HAND }, { newness: NEWNESS.CONFIRMED_NEW }]);
    assert.equal(parts.secondHand.length, 1);
    assert.equal(parts.confirmed.length, 1);
  });
  await t('building predating the deal by 2+ years → second_hand by evidence', () => {
    const c = classifyNewness({ yearBuilt: 1998, dealYear: 2026 });
    assert.equal(c.newness, NEWNESS.SECOND_HAND);
    assert.ok(c.evidence[0].includes('predates'));
  });

  console.log('GovMap provider (fixture-backed fetch — live contract shape)');
  const gm = azor.govmapFixtures;
  const govmapFetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/search-service/autocomplete')) return jsonRes(gm.autocomplete);
    if (u.match(/\/real-estate\/deals\/[\d.]+,[\d.]+\/\d+$/)) return jsonRes(gm.polygons);
    if (u.includes('/real-estate/street-deals/POLY-AZ-16')) {
      return jsonRes(u.includes('dealType=1') ? gm.streetDeals1 : gm.streetDeals2);
    }
    throw new Error('unexpected govmap call ' + u + ' ' + JSON.stringify(init || {}));
  };
  const mkGovmap = () => new GovMapProvider({ fetchImpl: govmapFetch, store: new MemoryStore() });
  await t('resolveAddress returns the source-projected point verbatim (EPSG:3857)', async () => {
    const r = await mkGovmap().resolveAddress('אזור', "ז'בוטינסקי", 7);
    assert.equal(r.itmX, 3874799);
    assert.equal(r.itmY, 3766263);
  });
  await t('getTransactions: address → polygons → deals of BOTH government classes', async () => {
    const rows = await mkGovmap().getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    assert.equal(rows.length, 3);
    const first = rows.find((r) => r.txId === 'govmap:30001');
    assert.equal(first.price, 3370000);
    assert.equal(first.date, '2026-06-15');
    assert.equal(first.newness, NEWNESS.CONFIRMED_NEW);           // served under dealType=1
    assert.ok(first.sourceClassification.includes('dealType=1'));  // raw class stored separately
    const used = rows.find((r) => r.txId === 'govmap:30003');
    assert.equal(used.newness, NEWNESS.SECOND_HAND);
    assert.ok(used.sourceClassification.includes('dealType=2'));
  });
  await t('provenance carries the full 7-field contract', async () => {
    const rows = await mkGovmap().getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    const p = rows[0].provenance;
    for (const k of ['sourceAuthority', 'sourceDataset', 'sourceRecordId', 'sourceUrl', 'fetchedAt', 'retrievalMethod']) {
      assert.ok(p[k] !== undefined, 'provenance missing ' + k);
    }
    assert.equal(p.retrievalMethod, 'live-api');
    assert.equal(p.sourceUpdatedAt, null); // GovMap publishes no per-record update time — stays null, not invented
    assert.ok(p.sourceAuthority.includes('רשות המיסים'));
  });
  await t('coordinates land in Israel and distances are true ground metres', async () => {
    const rows = await mkGovmap().getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    const same = rows.find((r) => r.txId === 'govmap:30001');
    assert.equal(same.projCrs, 'EPSG:3857');           // stored verbatim, CRS named
    assert.ok(same.lat > 31.9 && same.lat < 32.1, 'lat ' + same.lat);
    assert.ok(same.lng > 34.7 && same.lng < 34.9, 'lng ' + same.lng);
    assert.equal(same.distanceM, 0);
    assert.ok(same.distanceBasis.includes('same building'));
    const other = rows.find((r) => r.txId === 'govmap:30003'); // house 5, ~100m away
    assert.ok(other.distanceM > 20 && other.distanceM < 300, 'got ' + other.distanceM);
  });
  await t('property type is classified; land never counts as residential', async () => {
    const rows = await mkGovmap().getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    assert.ok(rows.every((r) => r.propertyClass === 'residential'), rows.map((r) => r.propertyClass).join(','));
    const { classifyPropertyType } = require('../lib/gov/propertyType');
    assert.equal(classifyPropertyType('קרקע').propertyClass, 'land');
    assert.equal(classifyPropertyType('קרקע').residential, false);
    assert.equal(classifyPropertyType('חנות').propertyClass, 'commercial');
  });
  await t('degree input to getNearbyTransactions is refused, not silently reprojected', async () => {
    await assert.rejects(() => mkGovmap().getNearbyTransactions(32.02, 34.8, 250), (e) => {
      assert.ok(e instanceof GovSourceUnavailableError);
      assert.ok(e.reason.includes('ITM'));
      return true;
    });
  });

  console.log('GATE-4 verification harness');
  await t('retrieved records match both independently observed references', async () => {
    const rows = await mkGovmap().getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    const report = verifyAgainstReference(rows, azor.observedComparison.records);
    assert.equal(report.verdict, 'ALL_MATCHED');
    assert.equal(report.matched, 2);
    const blockCheck = report.results[0].best.checks.block;
    assert.ok(blockCheck.notComparable); // street-deals serves no cadastre — reported, not faked
  });
  await t('a non-matching set yields NO_MATCH, never a forced match', () => {
    const report = verifyAgainstReference([], azor.observedComparison.records);
    assert.equal(report.verdict, 'NO_MATCH');
  });
  await t('service routes through GovMap when Tax Authority is not authorized; scope has sample size', async () => {
    const svc = new GovDataService({ providers: [new TaxAuthorityProvider({ endpoint: null }), mkGovmap()] });
    const r = await svc.getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    assert.equal(r.scope.level, 'building');
    assert.equal(r.scope.sampleSize, 3);
    assert.equal(r.partitions.confirmed.length, 2);
    assert.equal(r.partitions.secondHand.length, 1);
    assert.ok(r.unavailable.some((u) => u.provider === 'taxes.gov.il/nadlan')); // the canonical source's state stays visible
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

  console.log('HARD BUILD GATE — data purity & count reconciliation');
  await t('every retrieved row is OFFICIAL_GOVERNMENT (build fails otherwise)', async () => {
    const rows = await mkGovmap().getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    const impure = rows.filter((r) => r.sourceFamily !== 'OFFICIAL_GOVERNMENT');
    assert.equal(impure.length, 0, 'impure rows: ' + JSON.stringify(impure.map((r) => r.sourceFamily)));
  });
  await t('tab counts reconcile exactly with their datasets', async () => {
    const rows = await mkGovmap().getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    const res = rows.filter((r) => r.propertyClass === 'residential');
    const nw = res.filter((r) => r.newness === 'confirmed_new' || r.newness === 'probable_new');
    const sec = res.filter((r) => r.newness === 'second_hand');
    const unk = res.filter((r) => r.newness === 'unknown');
    assert.equal(nw.length + sec.length + unk.length, res.length, 'partitions must cover ALL exactly once');
    assert.ok(res.length > 0);
  });
  await t('rows are sorted strictly by ISO transaction date, newest first', async () => {
    const rows = await mkGovmap().getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 });
    const dates = rows.map((r) => r.date).filter(Boolean);
    assert.deepEqual(dates, [...dates].sort((a, b) => b.localeCompare(a)), dates.join(','));
    assert.ok(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), 'dates must be canonical ISO');
  });
  await t('the period window is enforced even when the endpoint ignores it', async () => {
    const stale = JSON.parse(JSON.stringify(azor.govmapFixtures));
    stale.streetDeals2.data[0].dealDate = '2019-01-05';        // far outside a 24-month window
    const gm = new GovMapProvider({ store: new MemoryStore(), fetchImpl: async (url, init) => {
      const u = String(url);
      if (u.includes('/search-service/autocomplete')) return jsonRes(stale.autocomplete);
      if (u.match(/\/real-estate\/deals\/[\d.]+,[\d.]+\/\d+$/)) return jsonRes(stale.polygons);
      return jsonRes(u.includes('dealType=1') ? stale.streetDeals1 : stale.streetDeals2);
    } });
    const rows = await gm.getTransactions({ city: 'אזור', street: "ז'בוטינסקי", houseNumber: 7 }, { months: 24 });
    assert.ok(rows.every((r) => !r.date || r.date >= '2024'), rows.map((r) => r.date).join(','));
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
