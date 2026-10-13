// PROPX · CBS new-home sales — offline tests of the official-series lane (lib/cbs-sales).
// `node test/cbs-sales.test.js`
//
// Fixtures follow the exact shape the CBS series API answered on the runner (13.10.2026): one request returns the
// original, seasonally adjusted and trend monthly series plus the annual original for one catalogue path.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/cbs-sales/series');
const { parseResponse, SchemaError } = require('../lib/cbs-sales/parse');
const L = require('../lib/cbs-sales/ledger');
const MX = require('../lib/cbs-sales/metrics');
const { buildPayload, toJs } = require('../lib/cbs-sales/snapshot');

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };

/* ---------- fixtures in the API's shape ---------- */
const LEVEL3 = { new_sold: [2, 'דירות חדשות שנמכרו בתקופה ,לפי מחוז'], new_sold_subsidized: [2, ''], inventory: [4, 'דירות חדשות שנותרו למכירה בסוף התקופה'], months_supply: [5, 'חודשי היצע לדירות חדשות'] };
function series(id, measure, cbs, time, data, obs, update = '2026-09-02') {
  const M = S.MEASURES[measure];
  return { id, ffu_num: null, time: { value: time, name: time === 3 ? 'חודש' : 'שנה' }, data: { value: data, name: '' }, unit: { value: 20, name: 'מספר' },
    calc: { value: 0, name: '' }, price: { value: 0, name: '' },
    path: { level1: { value: 44, name: 'בינוי ונדל"ן' }, level2: { value: 10, name: 'דירות בעסקאות נדל"ן' }, level3: { value: LEVEL3[measure][0], name: LEVEL3[measure][1] },
      level4: M.level4 == null ? null : { value: M.level4, name: '' }, name_id: { value: cbs, name: S.GEO_BY_CBS[cbs].he } },
    precis: 0, update, obs: Object.entries(obs).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([p, v]) => ({ TimePeriod: p, Value: v })) };
}
function response(measure, cbs, monthly, annual = {}, update) {
  const M = S.MEASURES[measure];
  const sa = Object.fromEntries(Object.entries(monthly).map(([p, v]) => [p, v == null ? v : v * 1.01]));
  const list = measure === 'months_supply'
    ? [series(574500, measure, cbs, 3, 371, monthly, update)]
    : [series(574000 + cbs % 100, measure, cbs, 3, 2, sa, update), series(574100 + cbs % 100, measure, cbs, 3, 3, sa, update),
      series(574300 + cbs % 100, measure, cbs, 3, M.dataKind, monthly, update),
      series(674300 + cbs % 100, measure, cbs, 1, 1, Object.fromEntries(Object.entries(annual).map(([y, v]) => [`${y}-01`, v])), update)];
  return { DataSet: { Series: list, paging: { total_items: list.length, page_size: 100, current_page: 1, last_page: 1, next_url: null } } };
}
/* 2024-01 … 2026-07: a steady 3,000 a month nationally, districts summing to 2,950 (50 unknown) */
const months = []; for (let i = MX.idx('2024-01'); i <= MX.idx('2026-07'); i++) months.push(`${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);
const NAT = Object.fromEntries(months.map((p, i) => [p, 3000 + (i % 3) * 30]));
const req = (measure, cbs) => ({ measure, cbs, url: S.urlFor(measure, cbs, [2022, 2026]) });

console.log('source definition');
t('the catalogue is the CBS series API, national + 7 districts by CBS code — no city series', () => {
  assert.strictEqual(S.SERIES_BASE, 'https://apis.cbs.gov.il/series');
  assert.deepStrictEqual(S.GEOS.map((g) => g.cbs), [5069, 5070, 5071, 5072, 5073, 5074, 5075, 5076]);
  assert.ok(S.GEOS.every((g) => g.level === 'national' || g.level === 'district'), 'a locality level appeared in the CBS series lane');
  assert.deepStrictEqual(Object.fromEntries(S.GEOS.map((g) => [g.cbs, g.key])), { 5069: 'il', 5070: 'd-jm', 5071: 'd-north', 5072: 'd-haifa', 5073: 'd-center', 5074: 'd-ta', 5075: 'd-south', 5076: 'jsr' });
  assert.strictEqual(S.pathId('new_sold', 5074), '44,10,2,1,5074');
  assert.strictEqual(S.pathId('inventory', 5069), '44,10,4,,5069');
  assert.strictEqual(S.pathId('months_supply', 5069), '44,10,5,,5069');
  assert.ok(/דירות חדשות/.test(S.SOURCE.definition.he) && /subsidy/.test(S.SOURCE.definition.en), 'the definition says new dwellings, subsidized included');
});
t('the board districts are exactly the PROPX district rows (exact code mapping, no names)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const g of S.GEOS.filter((x) => x.level === 'district' && x.key !== 'jsr')) assert.ok(html.includes(`{id:"${g.key}",type:"district"`), 'no board district ' + g.key);
});
t('every request window ≤ 6 years, from 2016 to the current year (60+ months)', () => {
  const w = S.windows(new Date('2026-10-13'));
  assert.deepStrictEqual(w, [[2016, 2021], [2022, 2026]]);
  const P = S.plan(new Date('2026-10-13'));
  assert.strictEqual(P.length, (8 + 1 + 1 + 1) * 2);
  assert.ok(P.every((q) => /^https:\/\/apis\.cbs\.gov\.il\/series\/data\/path\?id=44,10,/.test(q.url)));
});

console.log('monthly ingestion');
t('parse: original monthly + annual read; SA / trend kept out of the observations', () => {
  const r = parseResponse(response('new_sold', 5074, { '2026-07': 485, '2026-06': 925 }, { 2025: 6137 }), req('new_sold', 5074));
  assert.strictEqual(r.obs.length, 3);
  assert.deepStrictEqual(r.obs.filter((o) => o.freq === 'M').map((o) => [o.period, o.value, o.geo]), [['2026-07', 485, 'd-ta'], ['2026-06', 925, 'd-ta']]);
  assert.deepStrictEqual(r.obs.filter((o) => o.freq === 'Y').map((o) => [o.period, o.value]), [['2025', 6137]]);
  assert.ok(r.obs.every((o) => o.dataKind === 'original' && o.update === '2026-09-02'));
  assert.strictEqual(r.series.length, 4);
});
t('parse: months of supply read in CBS\'s own measure (trend-based average)', () => {
  const r = parseResponse(response('months_supply', 5069, { '2026-07': 26.94 }), req('months_supply', 5069));
  assert.deepStrictEqual(r.obs.map((o) => [o.period, o.value, o.dataKind]), [['2026-07', 26.94, 'trend_avg']]);
});
t('parse: a series of another geography or branch is a schema change, never used', () => {
  const j = response('new_sold', 5074, { '2026-07': 485 });
  j.DataSet.Series[2].path.name_id.value = 5073;
  assert.throws(() => parseResponse(j, req('new_sold', 5074)), SchemaError);
  const k = response('new_sold', 5074, { '2026-07': 485 });
  k.DataSet.Series.forEach((s) => { s.path.level3.value = 6; });
  assert.throws(() => parseResponse(k, req('new_sold', 5074)), /not branch 44,10,2/);
  assert.throws(() => parseResponse({ DataSet: {} }, req('new_sold', 5074)), /unrecognized shape/);
  const n = response('new_sold', 5074, { '2026-07': 485 });
  n.DataSet.Series[2].obs[0].Value = -3;
  assert.throws(() => parseResponse(n, req('new_sold', 5074)), SchemaError);
});
t('zero vs missing: a published 0 is kept; an unpublished month is absent, never 0', () => {
  const j = response('new_sold', 5076, { '2026-07': 0, '2026-06': null, '2026-05': 12 });
  const r = parseResponse(j, req('new_sold', 5076));
  const m = Object.fromEntries(r.obs.filter((o) => o.freq === 'M').map((o) => [o.period, o.value]));
  assert.deepStrictEqual(m, { '2026-07': 0, '2026-05': 12 });
  assert.ok(!('2026-06' in m));
});
t('a window before the series starts (no series at all) is no data, not an error', () => {
  assert.deepStrictEqual(parseResponse({ DataSet: { Series: [] } }, req('new_sold', 5069)).obs, []);
});

console.log('ledger — immutable raw observations and revisions');
const ctx0 = { fetchedAt: '2026-09-03T12:00:00Z', snapshot: 'aaaa' };
const obsOf = (measure, cbs, m) => parseResponse(response(measure, cbs, m), req(measure, cbs)).obs;
t('first read: every value is revision 0, with fetch time, source update, snapshot and URL', () => {
  const m = L.merge([], obsOf('new_sold', 5074, { '2026-07': 485, '2026-06': 925 }), ctx0);
  assert.strictEqual(m.added, 2); assert.strictEqual(m.revised, 0);
  for (const r of m.append) {
    assert.strictEqual(r.revision, 0);
    assert.ok(r.fetchedAt && r.sourceUpdate === '2026-09-02' && r.snapshot === 'aaaa' && /apis\.cbs\.gov\.il/.test(r.url) && r.cbs === 5074 && r.geo === 'd-ta');
  }
});
t('historical revision: a changed value appends revision 1 and keeps the old one', () => {
  const a = L.merge([], obsOf('new_sold', 5074, { '2026-07': 485, '2026-06': 925 }), ctx0).append;
  const b = L.merge(a, obsOf('new_sold', 5074, { '2026-07': 502, '2026-06': 925, '2026-08': 610 }), { fetchedAt: '2026-10-14T12:00:00Z', snapshot: 'bbbb' });
  assert.strictEqual(b.added, 1); assert.strictEqual(b.revised, 1); assert.strictEqual(b.unchanged, 1);
  const rev = b.append.find((r) => r.period === '2026-07');
  assert.deepStrictEqual([rev.revision, rev.value, rev.replaces], [1, 502, 485]);
  const all = a.concat(b.append);
  assert.deepStrictEqual(L.historyOf(all, 'new_sold|5074|M|2026-07').map((r) => r.value), [485, 502]);
  assert.strictEqual(L.currentOf(all).get('new_sold|5074|M|2026-07').value, 502);
  assert.strictEqual(all.length, 4, 'nothing overwritten or deleted');
});
t('unchanged re-read appends nothing', () => {
  const a = L.merge([], obsOf('new_sold', 5069, { '2026-07': 3011 }), ctx0).append;
  assert.strictEqual(L.merge(a, obsOf('new_sold', 5069, { '2026-07': 3011 }), ctx0).append.length, 0);
});
t('a period the source stops returning is reported and kept, never deleted or zeroed', () => {
  const a = L.merge([], obsOf('new_sold', 5069, { '2026-07': 3011, '2026-06': 3497 }), ctx0).append;
  const b = L.merge(a, obsOf('new_sold', 5069, { '2026-07': 3011 }), { ...ctx0, answered: new Set(['new_sold|5069']) });
  assert.deepStrictEqual(b.missingInSource, ['new_sold|5069|M|2026-06']);
  assert.strictEqual(L.currentOf(a.concat(b.append)).get('new_sold|5069|M|2026-06').value, 3497);
});

console.log('metrics');
const flat = (from, to, v) => { const o = {}; for (let i = MX.idx(from); i <= MX.idx(to); i++) o[`${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`] = typeof v === 'function' ? v(i) : v; return o; };
t('trailing 3 / 6 / 12 months are sums of published months, with their periods', () => {
  const m = MX.metricsFor(flat('2024-01', '2026-07', 100));
  assert.strictEqual(m.latest, '2026-07'); assert.strictEqual(m.latestValue, 100);
  assert.deepStrictEqual([m.t3.value, m.t3.from, m.t3.to], [300, '2026-05', '2026-07']);
  assert.deepStrictEqual([m.t6.value, m.t6.from], [600, '2026-02']);
  assert.deepStrictEqual([m.t12.value, m.t12.from, m.t12.to], [1200, '2025-08', '2026-07']);
  assert.strictEqual(m.t12.label.he, 'אוגוסט 2025–יולי 2026');
  assert.strictEqual(m.t12.label.en, 'Aug 2025–Jul 2026');
  assert.strictEqual(m.t3.label.he, 'מאי–יולי 2026');
});
t('YTD and prior-year YTD cover the same months', () => {
  const m = MX.metricsFor(flat('2024-01', '2026-07', (i) => (i >= MX.idx('2026-01') ? 120 : 100)));
  assert.deepStrictEqual([m.ytd.value, m.ytd.from, m.ytd.to, m.ytd.months], [840, '2026-01', '2026-07', 7]);
  assert.deepStrictEqual([m.prevYtd.value, m.prevYtd.from, m.prevYtd.to], [700, '2025-01', '2025-07']);
  assert.strictEqual(m.ytdChange.pct, 20);
  assert.strictEqual(m.ytd.label.he, 'ינואר–יולי 2026');
});
t('annualization: YTD × 12 ÷ months — a rate with its formula, not a count', () => {
  const m = MX.metricsFor(flat('2024-01', '2026-07', 100));
  assert.deepStrictEqual([m.pace.value, m.pace.basis, m.pace.months, m.pace.formula], [1200, 'ytd', 7, '700 × 12 ÷ 7']);
  const feb = MX.metricsFor(flat('2024-01', '2026-02', 100));
  assert.deepStrictEqual([feb.pace.basis, feb.pace.value, feb.pace.formula], ['t3', 1200, '300 × 4'], 'under 3 months of the year: T3 × 4');
});
t('a missing month makes every window that needs it unavailable — named, never filled', () => {
  const mon = flat('2024-01', '2026-07', 100); delete mon['2026-03'];
  const m = MX.metricsFor(mon);
  assert.ok(m.t3.ok, 'T3 (May–Jul) does not need March');
  assert.ok(!m.t6.ok && m.t6.missing === '2026-03' && /מרץ 2026/.test(m.t6.why.he));
  assert.ok(!m.t12.ok && !m.ytd.ok);
  assert.ok(m.pace.basis === 't3', 'pace falls back to T3, never to a filled YTD');
});
t('momentum, acceleration and volatility are derived with their windows', () => {
  const m = MX.metricsFor(flat('2024-01', '2026-07', (i) => (i >= MX.idx('2026-05') ? 150 : 100)));
  assert.strictEqual(m.momentum.m3.pct, 50);
  assert.deepStrictEqual([m.momentum.m3.now.from, m.momentum.m3.before.from], ['2026-05', '2026-02']);
  assert.strictEqual(m.acceleration.pp, 50);
  assert.ok(m.volatility.ok && m.volatility.cv > 0 && m.volatility.n === 12);
});
t('low sample: counts and periods kept, no percentage signal', () => {
  const m = MX.metricsFor(flat('2024-01', '2026-07', (i) => (i % 2 ? 9 : 3)));
  assert.ok(m.small && m.t3.ok && m.t3.value < MX.SMALL_N);
  assert.ok(!m.momentum.m3.ok && /small sample/.test(m.momentum.m3.why.en));
  assert.ok(!m.ytdChange.ok && !m.volatility.ok && !m.acceleration.ok);
});
t('the last full year: the published annual figure beside the sum of its months', () => {
  const m = MX.metricsFor(flat('2024-01', '2026-07', 100), { 2025: 1205 });
  assert.deepStrictEqual(m.lastYear, { year: '2025', annual: 1205, sumOfMonths: 1200 });
});

console.log('freshness');
t('CURRENT through August in October; EXPECTED REPORTING LAG while the next release is due; STALE well after', () => {
  assert.strictEqual(MX.freshness('2026-08', Date.parse('2026-10-20T12:00:00Z')).state, 'CURRENT');
  assert.strictEqual(MX.freshness('2026-07', Date.parse('2026-09-20T12:00:00Z')).state, 'CURRENT');
  assert.strictEqual(MX.freshness('2026-07', Date.parse('2026-10-13T20:00:00Z')).state, 'EXPECTED_REPORTING_LAG', 'August is due 14.10 — a normal delay, not stale');
  assert.strictEqual(MX.freshness('2026-07', Date.parse('2026-11-20T12:00:00Z')).state, 'STALE');
  assert.strictEqual(MX.freshness(null).state, 'STALE');
});

console.log('payload — source failure preservation and reconciliation');
function ledgerFor(geos, extra = {}) {
  let recs = [];
  for (const g of geos) {
    const m = g.cbs === 5069 ? NAT : Object.fromEntries(months.map((p) => [p, Math.round(NAT[p] * g.share)]));
    recs = recs.concat(L.merge(recs, parseResponse(response('new_sold', g.cbs, m, { 2025: g.cbs === 5069 ? 36210 : 0 }), req('new_sold', g.cbs)).obs, ctx0).append);
  }
  for (const [measure, m] of Object.entries(extra)) recs = recs.concat(L.merge(recs, parseResponse(response(measure, 5069, m), req(measure, 5069)).obs, ctx0).append);
  return recs;
}
const SHARES = { 5070: 0.07, 5071: 0.08, 5072: 0.11, 5073: 0.22, 5074: 0.2, 5075: 0.25, 5076: 0.04 };
const ALL = [{ cbs: 5069 }, ...Object.entries(SHARES).map(([c, s]) => ({ cbs: +c, share: s }))];
t('national reconciliation: the national total vs the sum of 7 districts, residual = unknown district', () => {
  const p = buildPayload(ledgerFor(ALL), { at: '2026-10-13T12:00:00Z', status: 'SUCCESS' }, null);
  const r = p.reconciliation;
  assert.strictEqual(r.months.length, 12);
  assert.ok(r.t12 && r.t12.residual === r.t12.national - r.t12.districtSum);
  assert.ok(Math.abs(r.t12.residual) < r.t12.national * 0.05, 'residual is the unknown share, not forced to 0');
  assert.deepStrictEqual([r.year.year, r.year.taxAuthority], ['2025', 34000]);
  assert.strictEqual(r.year.cbsAnnual, 36210);
});
t('a failed series keeps its last payload, marked stale with the error — never zero, never dropped', () => {
  const prev = buildPayload(ledgerFor(ALL), { at: '2026-10-12T12:00:00Z', status: 'SUCCESS' }, null);
  const onlyNat = ledgerFor([{ cbs: 5069 }]);
  const p = buildPayload(onlyNat, { at: '2026-10-13T12:00:00Z', status: 'PARTIAL', failed: new Set(['new_sold|5074']), errors: { 'new_sold|5074': 'HTTP 503' } }, prev);
  assert.ok(p.geos['d-ta'].stale && p.geos['d-ta'].lastError === 'HTTP 503');
  assert.deepStrictEqual(p.geos['d-ta'].monthly, prev.geos['d-ta'].monthly);
  assert.ok(p.geos['d-ta'].metrics.t12.value > 0);
});
t('period labels and freshness travel with the payload; latest.js is safe to inline', () => {
  const p = buildPayload(ledgerFor(ALL, { inventory: { '2026-07': 84990, '2026-06': 84283 }, months_supply: { '2026-07': 26.94 } }), { at: '2026-10-13T12:00:00Z', status: 'SUCCESS', checkedAt: '2026-10-13T12:00:00Z' }, null);
  assert.strictEqual(p.geos.il.metrics.t12.label.he, 'אוגוסט 2025–יולי 2026');
  assert.deepStrictEqual([p.inventory.latest.period, p.inventory.latest.value], ['2026-07', 84990]);
  assert.strictEqual(p.monthsSupply.latest.value, 26.94);
  assert.strictEqual(p.freshness.state, 'EXPECTED_REPORTING_LAG');
  assert.deepStrictEqual(p.depth, { from: '2024-01', to: '2026-07' });
  const js = toJs({ ...p, x: '</script>' });
  assert.ok(!js.includes('</script>') && js.startsWith('/* generated') && /window\.PROPX_CBS_SALES=/.test(js));
});

console.log('stored data (data/cbs-sales — written by the sync on the runner)');
t('the stored payload, when present, is valid and derived from the stored ledger', () => {
  const dir = path.join(__dirname, '..', 'data', 'cbs-sales');
  if (!fs.existsSync(path.join(dir, 'latest.json'))) { console.log('    (no stored data yet)'); return; }
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  const recs = fs.readFileSync(path.join(dir, 'observations.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.strictEqual(p.schema, 1);
  assert.ok(recs.length >= p.records.current && p.records.observations === recs.length);
  const cur = L.currentOf(recs);
  for (const [k, g] of Object.entries(p.geos)) {
    for (const [per, v] of g.monthly) assert.strictEqual(cur.get(`new_sold|${g.cbs}|M|${per}`).value, v, `${k} ${per} differs from the ledger`);
  }
  assert.ok(Object.keys(p.geos).length === 8 && p.geos.il.metrics.months >= 36, 'at least 36 months nationally');
  const js = fs.readFileSync(path.join(dir, 'latest.js'), 'utf8');
  assert.ok(js.includes('window.PROPX_CBS_SALES=') && !/<\//.test(js));
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
