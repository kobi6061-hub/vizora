// PROPX · the Tax Authority deals register as republished by גרסאות לעם
// (over.org.il) — offline tests (fetch doubles in the source's own shapes, as
// probed on a GitHub runner 01.10.2026). `node test/republished.test.js`
//
// What is pinned here: the rows pass through verbatim and say which channel
// delivered them; an address is the parcel's link, never the register's;
// a share of a property is never priced per m²; every spelling of a locality
// is found; a later page never re-walks the ladder; the API claims a sync only
// when a source answered; the page never calls these rows "official source".

'use strict';

process.env.GOV_DEV_FIXTURE = '1';   // the API handler below runs on the labelled SAMPLE fixture

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { OverDealsProvider, splitAddress } = require('../lib/gov/providers/overDeals');
const { GovMapProvider } = require('../lib/gov/providers/govmap');
const { TaxAuthorityProvider } = require('../lib/gov/providers/taxAuthority');
const { GovDataService } = require('../lib/gov/service');
const { GovSourceUnavailableError } = require('../lib/gov/providers/base');

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(
  () => { passed++; console.log('  ✓', name); },
  (e) => { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; },
);
const res = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
const NOW = Date.parse('2026-10-02T09:00:00Z');

const deal = (o = {}) => ({ date: '2026-07-27', date_src: '27/07/2026', amount: 1860000, declared_amount: 1860000, nature: 'דירה בבית קומות',
  area_sqm: 155, rooms: 6, year_built: 1960, portion: '1.000', portion_fraction: 1, price_per_sqm: 12000, sub_parcel: '007',
  settlement: 'באר שבע', settlement_code: '9000', gush: '38070', helka: '31', addresses: ['גרץ 5', 'גרץ 5א'], addresses_total: 2, ...o });
const SETTLEMENTS = { data: [
  { settlement: 'תל אביב -יפו', settlement_code: '5000', deals: 250853, last_deal: '2026-07-26', resolved_code: 5000 },
  { settlement: 'באר שבע', settlement_code: '9000', deals: 114012, last_deal: '2026-07-27', resolved_code: 9000 },
  { settlement: 'נוף הגליל', settlement_code: '1061', deals: 9000, last_deal: '2026-08-01', resolved_code: 1061 },
  { settlement: 'נצרת עילית', settlement_code: '', deals: 21000, last_deal: '2019-01-01', resolved_code: 1061 },
  { settlement: 'באר-שבע ', settlement_code: '9000', deals: 12, last_deal: '2001-01-01', resolved_code: 9000 },
], count: 5 };
const STATS = { deals: 3844200, first_deal: '1998-01-01', last_deal: '2026-09-17', scraped_at: '2026-09-19 11:07:39.013275+00',
  source_url: 'https://nadlan.taxes.gov.il/svinfonadlan2010/startpage.aspx' };

/** a fetch double answering in over.org.il's shapes; every search URL is recorded */
function overFetch({ rows = [deal()], total = 10000, capped = true, address = null, failSearch = false } = {}) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(String(url));
    if (u.hostname.includes('govmap')) return res({ message: 'Request blocked' }, 403);
    if (u.pathname === '/api/deals/settlements') return res(SETTLEMENTS);
    if (u.pathname === '/api/deals/stats') return res(STATS);
    if (u.pathname === '/api/deals/search') {
      calls.push(u);
      if (failSearch) return res({ detail: 'down' }, 503);
      return res({ data: rows, total, total_capped: capped, limit: Number(u.searchParams.get('limit')), offset: Number(u.searchParams.get('offset')),
        sort: 'date_desc', address });
    }
    return res({}, 404);
  };
  f.calls = calls;
  return f;
}
const mk = (opts) => { const fetchImpl = overFetch(opts); const p = new OverDealsProvider({ fetchImpl, clock: () => NOW, now: () => new Date(NOW).toISOString() }); return { p, fetchImpl }; };

(async () => {
  console.log('normalization — verbatim values, the channel named, nothing estimated');
  await t('a register row keeps its own values and says it came through the republication', () => {
    const { p } = mk();
    const tx = p.normalizeDeal(deal(), { sourceUrl: 'https://www.over.org.il/api/deals/search?x', snapshotAt: STATS.scraped_at, retrievedAt: 'now' });
    assert.equal(tx.date, '2026-07-27'); assert.equal(tx.price, 1860000); assert.equal(tx.areaSqm, 155); assert.equal(tx.rooms, 6);
    assert.equal(tx.yearBuilt, 1960); assert.equal(tx.city, 'באר שבע'); assert.equal(tx.cityCode, '9000');
    assert.deepEqual([tx.block, tx.parcel, tx.subParcel], ['38070', '31', '007']);
    assert.equal(tx.sourceFamily, 'OFFICIAL_GOVERNMENT');
    assert.equal(tx.deliveredVia, 'over.org.il'); assert.equal(tx.channel, 'independent-republication');
    assert.equal(tx.provenance.source, 'over.org.il'); assert.match(tx.provenance.sourceAuthority, /רשות המסים/); assert.match(tx.provenance.sourceAuthority, /גרסאות לעם/);
    assert.equal(tx.provenance.sourceUpdatedAt, STATS.scraped_at, 'the copy date is the source timestamp');
    assert.equal(tx.neighborhood, null, 'a neighborhood was inferred'); assert.equal(tx.floor, null, 'a floor was invented');
    assert.equal(tx.lat, null); assert.equal(tx.txId, null);
    assert.ok(tx.pricePerSqm && tx.pricePerSqm.estimated === true, 'a derived price per m² must be marked estimated');
    assert.deepEqual(tx.provenance.raw, deal(), 'the raw row is kept server-side');
  });
  await t('an address is the parcel\'s link (crosswalk) with every candidate; none linked → no street', () => {
    const { p } = mk();
    const a = p.normalizeDeal(deal(), {});
    assert.deepEqual([a.street, a.houseNumber, a.addressBasis, a.addressesTotal], ['גרץ', '5', 'parcel-crosswalk', 2]);
    assert.deepEqual(a.addressCandidates, ['גרץ 5', 'גרץ 5א']);
    const none = p.normalizeDeal(deal({ addresses: [], addresses_total: 0 }), {});
    assert.equal(none.street, null); assert.equal(none.houseNumber, null); assert.equal(none.addressBasis, undefined);
    // on a street query, the parcel's address ON that street is the one shown
    const corner = p.normalizeDeal(deal({ addresses: ['הרצל 2', 'שד רגר יצחק 95'] }), { street: 'רגר' });
    assert.deepEqual([corner.street, corner.houseNumber], ['שד רגר יצחק', '95']);
    assert.deepEqual(splitAddress('גרץ 5א'), { street: 'גרץ', house: '5א' });
    assert.deepEqual(splitAddress('דרך מצדה'), { street: 'דרך מצדה', house: null });
  });
  await t('a share of a property is kept, marked, and never priced per m²', () => {
    const { p } = mk();
    const tx = p.normalizeDeal(deal({ amount: 590000, portion: '0.500', portion_fraction: 0.5 }), {});
    assert.equal(tx.partialSale, true); assert.deepEqual(tx.portion, { text: '0.500', fraction: 0.5 });
    assert.equal(tx.price, 590000, 'the reported amount stays as reported');
    assert.equal(tx.pricePerSqm, null); assert.ok(tx.missing.includes('pricePerSqm'));
  });
  await t('zeros the register uses for "none" stay missing; newness only from year built; property type from the nature', () => {
    const { p } = mk();
    const store = p.normalizeDeal(deal({ nature: 'מחסנים', rooms: 0, area_sqm: 0, amount: 66160, year_built: 0 }), {});
    assert.equal(store.rooms, null); assert.equal(store.areaSqm, null); assert.equal(store.yearBuilt, null);
    assert.equal(store.propertyClass, 'commercial');
    assert.equal(store.newness, 'unknown', 'no year built → no newness claimed');
    assert.equal(p.normalizeDeal(deal({ year_built: 2026 }), {}).newness, 'probable_new');
    assert.equal(p.normalizeDeal(deal({ year_built: 2025 }), {}).newness, 'probable_new');
    assert.equal(p.normalizeDeal(deal({ year_built: 1960 }), {}).newness, 'second_hand');
    assert.ok(!['confirmed_new'].includes(p.normalizeDeal(deal({ year_built: 2026 }), {}).newness), 'the register has no first-hand flag');
    assert.equal(p.normalizeDeal(deal(), {}).sourceClassification, null);
    // the register publishes plurals: a final letter never hides a non-residential row
    for (const [nature, cls] of [['מחסנים', 'commercial'], ['חנויות', 'commercial'], ['חניה', 'commercial'], ['חנייה', 'commercial'],
      ['משרדים', 'commercial'], ['בתי מלון', 'commercial'], ['אולמות', 'commercial'], ['מגרש למגורים', 'land'], ['דירה בבית קומות', 'residential'],
      ['דירת גן', 'residential'], ["קוטג' דו משפחתי", 'residential']]) {
      assert.equal(p.normalizeDeal(deal({ nature }), {}).propertyClass, cls, nature);
    }
  });

  console.log('locality names — every spelling the register uses');
  await t('a hyphen spelling, the CBS code and an official former name all find the locality', async () => {
    const { p } = mk();
    const ta = await p.settlementNames('תל אביב-יפו', 'getTransactions');
    assert.deepEqual(ta.names, ['תל אביב -יפו']);
    const bs = await p.settlementNames('באר שבע', 'getTransactions');
    assert.deepEqual(bs.names, ['באר שבע', 'באר-שבע '], 'the same CBS code under another spelling is found');
    assert.equal(bs.code, '9000');
    const ng = await p.settlementNames('נוף הגליל', 'getTransactions');
    assert.deepEqual(ng.names.sort(), ['נוף הגליל', 'נצרת עילית'].sort(), 'the former name (registry alias) is found');
  });
  await t('a locality the register does not hold is an explained gap, never a zero', async () => {
    const { p } = mk();
    await assert.rejects(p.settlementNames('עיר שאינה קיימת', 'getTransactions'),
      (e) => e instanceof GovSourceUnavailableError && /no settlement/.test(e.reason));
  });

  console.log('queries — the period, the level, the page');
  await t('locality: the period becomes date_from, newest first, the page capped at 200, no street sent', async () => {
    const { p, fetchImpl } = mk();
    await p.getTransactions({ city: 'תל אביב-יפו', street: undefined }, { months: 12, limit: 500 });
    const u = fetchImpl.calls[0];
    assert.equal(u.searchParams.get('settlement'), 'תל אביב -יפו');
    assert.equal(u.searchParams.get('date_from'), '2025-10-02');
    assert.equal(u.searchParams.get('sort'), 'date_desc');
    assert.equal(u.searchParams.get('limit'), '200', 'the source refuses more than 200');
    assert.equal(u.searchParams.get('offset'), '0');
    assert.ok(!u.searchParams.has('street') && !u.searchParams.has('house'));
  });
  await t('street and building: the street (and house) are sent; a locality query never carries them', async () => {
    const { p, fetchImpl } = mk({ address: { status: 'ok', addresses: 2, linked: 2, parcels: ['38070-31'] }, total: 6, capped: false });
    const st = await p.getStreetTransactions({ city: 'באר שבע', street: 'גרץ' }, { months: 24 });
    assert.equal(fetchImpl.calls[0].searchParams.get('street'), 'גרץ'); assert.ok(!fetchImpl.calls[0].searchParams.has('house'));
    assert.equal(st.diagnostics.level, 'street');
    assert.deepEqual(st.diagnostics.addressLink, { status: 'ok', addresses: 2, linked: 2, parcels: 1 });
    const b = await p.getTransactions({ city: 'באר שבע', street: 'גרץ', houseNumber: 5 }, { months: 24 });
    const ub = fetchImpl.calls.find((u) => u.searchParams.get('house'));
    assert.equal(ub.searchParams.get('house'), '5'); assert.equal(b.diagnostics.level, 'building');
  });
  await t('the register\'s counts, the copy date and whether more pages exist are reported', async () => {
    const { p } = mk({ rows: [deal(), deal({ date: '2026-07-01' })], total: 10000, capped: true });
    const r = await p.getTransactions({ city: 'תל אביב-יפו' }, { months: 24, limit: 2 });
    const d = r.diagnostics;
    assert.equal(d.kind, 'register-search'); assert.equal(d.deliveredVia, 'over.org.il');
    assert.equal(d.totalReported, 10000); assert.equal(d.totalCapped, true); assert.equal(d.more, true);
    assert.equal(d.snapshotAt, STATS.scraped_at); assert.equal(d.latestInRegister, '2026-09-17');
    assert.equal(d.rowsRetrieved, 2);
    const last = await mk({ rows: [deal()], total: 3, capped: false }).p.getTransactions({ city: 'תל אביב-יפו' }, { months: 24, limit: 2, offset: 2 });
    assert.equal(last.diagnostics.more, false, 'the last page says so');
  });
  await t('a failing source is an error, not an empty answer', async () => {
    const { p } = mk({ failSearch: true });
    await assert.rejects(p.getTransactions({ city: 'באר שבע' }, {}), /HTTP 503/);
  });
  await t('an answer is cached for its URL only — a different period is a new request', async () => {
    const { p, fetchImpl } = mk();
    await p.getTransactions({ city: 'באר שבע' }, { months: 24 });
    await p.getTransactions({ city: 'באר שבע' }, { months: 24 });
    const n = fetchImpl.calls.length;
    await p.getTransactions({ city: 'באר שבע' }, { months: 12 });
    assert.equal(fetchImpl.calls.length, n + 2, 'a new period was served from another period\'s answer'); // two spellings of באר שבע
  });

  console.log('the service — GovMap refused, the republication answers; pages never re-walk the ladder');
  const svcWith = (opts) => { const fetchImpl = overFetch(opts);
    return { fetchImpl, svc: new GovDataService({ providers: [new TaxAuthorityProvider({ endpoint: null }), new GovMapProvider({ fetchImpl }),
      new OverDealsProvider({ fetchImpl, clock: () => NOW })] }) }; };
  await t('GovMap refused (403): rows come through the republication, the refusal stays visible', async () => {
    const { svc } = svcWith();
    const r = await svc.getTransactions({ city: 'באר שבע' }, { months: 24, limit: 120 });
    assert.equal(r.answered, true); assert.equal(r.scope.level, 'locality');
    assert.ok(r.transactions.length > 0 && r.transactions.every((x) => x.deliveredVia === 'over.org.il'));
    assert.ok(r.unavailable.some((u) => u.provider === 'govmap.gov.il' && /403/.test(u.reason)));
    const keys = r.unavailable.map((u) => u.provider + u.capability + u.reason);
    assert.equal(new Set(keys).size, keys.length, 'reasons repeated');
  });
  await t('a street with no linked parcel falls back to the locality — and the scope says so', async () => {
    const fetchImpl = overFetch();
    const real = fetchImpl;
    const f = async (url) => { const u = new URL(String(url)); if (u.searchParams.get('street')) return res({ data: [], total: 0, total_capped: false, address: { status: 'not_found' } }); return real(url); };
    const svc = new GovDataService({ providers: [new GovMapProvider({ fetchImpl: f }), new OverDealsProvider({ fetchImpl: f, clock: () => NOW })] });
    const r = await svc.getTransactions({ city: 'באר שבע', street: 'אין כזה' }, { months: 24 });
    assert.equal(r.scope.level, 'locality'); assert.equal(r.scope.fallbackReason, 'no transactions found at the narrower level');
  });
  await t('a later page asks only providers that page, on the same rung', async () => {
    const { svc, fetchImpl } = svcWith();
    const r = await svc.getTransactions({ city: 'באר שבע', street: 'גרץ' }, { months: 24, limit: 120, offset: 120, level: 'locality' });
    assert.equal(r.scope.level, 'locality');
    assert.ok(fetchImpl.calls.every((u) => u.searchParams.get('offset') === '120' && !u.searchParams.has('street')), 'the ladder was re-walked');
    assert.ok(r.unavailable.some((u) => u.provider === 'govmap.gov.il' && /later page/.test(u.reason)), 'GovMap was asked for a page it cannot serve');
  });
  await t('nothing answered → answered:false (an attempt, never a sync)', async () => {
    const f = async () => res({}, 503);
    const svc = new GovDataService({ providers: [new GovMapProvider({ fetchImpl: f }), new OverDealsProvider({ fetchImpl: f, clock: () => NOW })] });
    const r = await svc.getTransactions({ city: 'באר שבע' }, { months: 24 });
    assert.equal(r.answered, false); assert.equal(r.transactions.length, 0);
  });

  console.log('the API — who delivered, when the copy was taken, a sync only when answered');
  const handler = require('../api/gov/transactions');
  const call = (qs) => new Promise((resolve) => {
    const out = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b || '{}') }); } };
    handler({ method: 'GET', url: '/api/gov/transactions?' + qs }, out);
  });
  await t('register rows: deliveredVia, the channel, the copy date and the coverage come with the answer', async () => {
    const r = await call('city=' + encodeURIComponent('באר שבע') + '&months=240&limit=120');
    assert.equal(r.status, 200);
    const m = r.body.meta;
    assert.equal(m.deliveredVia, 'over.org.il'); assert.equal(m.channel, 'independent-republication');
    assert.equal(m.sourceAnswered, true); assert.ok(m.syncedAt && m.attemptedAt);
    assert.equal(m.snapshotAt, '2026-09-19 11:07:39+00');
    assert.equal(m.sourceCoverage.kind, 'register-search');
    assert.ok(r.body.transactions.length > 0 && r.body.transactions.every((x) => x.provenance.every((pv) => pv.raw === undefined)), 'raw rows left the server');
  });
  await t('no source answered: no sync is claimed — only an attempt', async () => {
    const r = await call('city=' + encodeURIComponent('עיר שאינה קיימת') + '&months=24');
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.sourceAnswered, false); assert.equal(r.body.meta.syncedAt, null); assert.ok(r.body.meta.attemptedAt);
    assert.equal(r.body.meta.deliveredVia, null); assert.equal(r.body.transactions.length, 0);
  });
  await t('bad paging input is refused', async () => {
    assert.equal((await call('city=x&offset=-1')).status, 400);
    assert.equal((await call('city=x&offset=1.5')).status, 400);
    assert.equal((await call('city=x&level=radius')).status, 400);
  });

  console.log('the page — never "official source" for these rows; no sync claimed without an answer');
  const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fnBody = (src, name) => { const i = src.indexOf('function ' + name + '('); assert.ok(i > -1, name); let d = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(j, k + 1); } return ''; };
  const body = fnBody(INDEX, 'renderTx');
  await t('the header: the republication badge, the copy date, a sync only for an answering government channel', () => {
    assert.match(body, /viaRepub&&!fx\?t\.txRepubBadge:noAnswer&&!fx\?t\.txNoAnswer/);
    assert.match(body, /M&&M\.syncedAt&&!viaRepub\?/);
    assert.match(INDEX, /txRepubBadge:"רשומות רשות המסים · באמצעות גרסאות לעם \(over\.org\.il\) — פרסום עצמאי, לא ערוץ ממשלתי"/);
    assert.match(INDEX, /txRepubBadge:"Israel Tax Authority records · via גרסאות לעם \(over\.org\.il\) — an independent republication, not a government channel"/);
    for (const k of ['txRepubBadge', 'txSrcRepub', 'txRegNote']) {
      const m = INDEX.match(new RegExp('\\s' + k + ':[^\\n]*', 'g')) || [];   // definitions, not uses (t.' + k + ':')
      assert.equal(m.length, 2, k + ' in both languages');
      assert.ok(m.every((x) => !/מקור רשמי|Official source/.test(x)), k + ' calls the republication official');
    }
  });
  await t('a frozen copy is not "still updating": its date and limits replace the maturity line', () => {
    assert.match(body, /el\("txFresh"\)\.innerHTML=viaRepub&&M\.snapshotAt\?`<span class="note">\$\{t\.txRegNote\(dmy\(M\.snapshotAt\)\)\}<\/span>`/);
  });
  await t('statistics: a share of a property is never priced; no average over register rows; medians stay', () => {
    assert.match(INDEX, /const txPsm=t=>\{if\(t\.partialSale\)return null;/);
    assert.match(body, /const priced=statRows\.filter\(r=>!r\.partialSale\);/);
    assert.match(body, /\[t\.txSumAvgPsm,viaRepub\?/);
  });
  await t('empty states: no answer, no match and a real zero are three different messages', () => {
    assert.match(body, /M&&M\.sourceAnswered===false\s*\?\(txState\.unavailable\.some\(u=>\/no settlement\/\.test\(u\.reason\|\|""\)\)\?t\.txNoMatch:t\.txNoAnswerEmpty\)\s*:M&&M\.sourceAnswered===true\?t\.txZero/);
  });
  await t('source text is escaped before it enters the page; the pager continues the same scope', () => {
    assert.match(body, /return calcEsc\(a\)\+more;/);
    assert.match(body, /const sub=r=>calcEsc\(/);
    assert.match(body, /\$\{r\.dealType\?`<div class="sub">\$\{calcEsc\(r\.dealType\)\}<\/div>`:""\}/);
    const more = fnBody(INDEX, 'txMore');
    assert.match(more, /offset:String\(txState\.nextOffset\),level:txState\.scope\.level/);
    assert.match(more, /if\(txState\.key!==key\)return;/);
  });
  await t('the capital view\'s comparables carry the deals section\'s own channel label', () => {
    assert.match(fnBody(INDEX, 'ciComparables'), /viaRepub:!!\(txState\.meta&&txState\.meta\.deliveredVia==="over\.org\.il"\)/);
    assert.match(fnBody(INDEX, 'ciDetailInHTML'), /\$\{cp\.viaRepub\?t\.txRepubBadge:t\.txOfficialBadge\} — /);
    assert.ok(!/ciComp:[^\n]*(שכבת נתונים ממשלתית|government data layer)/.test(INDEX), 'the comparables still claim a government layer');
  });
  await t('the SAMPLE fixture is labelled and stays out of the production data paths', () => {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'gov', 'fixtures', 'over-deals-sample.json'), 'utf8'));
    assert.match(fx._note, /SAMPLE/); assert.match(fx._note, /NOT real deals/);
    assert.ok(fx.deals.every((d) => /^0000\d$/.test(d.gush)), 'a fixture row could pass for a real parcel');
    const svcSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'gov', '_service.js'), 'utf8');
    assert.match(svcSrc, /serviceMode\(\) === 'dev-fixture'\s*\? createDefaultService\(\{ fetchImpl: fixtureFetch\(\) \}\)/);
  });

  console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
})();
