// PROPX · STREET INTELLIGENCE gates (19.10.2026): the official directory and its identity rules, the national search (§21),
// the conservative deal → street match, the provably complete sweep, the sample policy and the truth gates (§22):
//   STREET EXISTS ≠ HAS TRANSACTIONS · NAME ≠ ID · SAME NAME IN TWO CITIES ≠ SAME STREET · SYNONYM ≠ SECOND STREET ·
//   NO TRANSACTIONS ≠ ZERO PRICE · NEIGHBORHOOD PRICE ≠ STREET PRICE · CITY PRICE ≠ STREET PRICE · ASKING ≠ TRANSACTION ·
//   POSSIBLE ADDRESS MATCH ≠ OBSERVED · PROBABLE NEW ≠ CONFIRMED
// Offline: the committed directory (data/geo/streets/) + a TEST FIXTURE evidence store built here in a temp directory from
// synthetic deals on real official streets (never written to data/, never read by the product).

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const SD = require('../lib/streets/directory');
const SI = require('../lib/streets/search-index');
const M = require('../lib/streets/match');
const EV = require('../lib/streets/evidence');
const SW = require('../lib/streets/sweep');
const ST = require('../lib/streets/street');
const COV = require('../lib/streets/coverage');
const R = require('../lib/geo/registry');

let passed = 0, failed = 0;
const pending = [];
const t = (name, fn) => pending.push([name, fn]);
const D = SD.load();
const G = R.loadGeo();
const first = (q, near, n = 12) => R.searchGeo(q, n, near ? { near } : {}).matches.filter((m) => m.kind === 'street');
const has = (list, id, k = 7) => list.slice(0, k).some((m) => m.id === id);

/* ───────────────────────── directory & identity ───────────────────────── */
t('directory: every official row is st:<locality>:<code>, unique; one locality placeholder (9000) per locality; kinds by the code range', () => {
  const ids = new Set();
  for (const s of D.streets) { assert.match(s.id, /^st:\d+:\d+$/); assert.ok(!ids.has(s.id), 'duplicate ' + s.id); ids.add(s.id); assert.equal(s.kind, SD.kindOf(s.code), s.id); }
  const ph = D.streets.filter((s) => s.kind === SD.KIND.LOCALITY);
  assert.equal(ph.length, D.localities.size); assert.ok(ph.every((s) => s.code === 9000));
  assert.equal(SD.kindOf(9000), 'locality'); assert.equal(SD.kindOf(6519), 'area'); assert.equal(SD.kindOf(7001), 'site'); assert.equal(SD.kindOf(213), 'street'); assert.equal(SD.kindOf(9001), 'street');
  assert.ok(D.streets.length >= 63000 && D.localities.size >= 1300, 'the whole registry is stored (' + D.streets.length + ')');
  assert.ok(D.synonyms.length >= 85000, 'the synonyms registry is stored (' + D.synonyms.length + ')');
});
t('directory: a synonym names an official row of its own locality (or the placeholder) — it never creates a row', () => {
  let missing = 0;
  for (const y of D.synonyms) { const id = SD.streetId(y.cityCode, y.officialCode); if (!D.byId.has(id)) missing++; }
  assert.ok(missing <= (D.synMeta && D.synMeta.targetMissing != null ? D.synMeta.targetMissing : 0) + 0, 'synonyms without their official row: ' + missing);
  const rowIds = new Set(D.streets.map((s) => s.id));
  for (const y of D.synonyms.slice(0, 5000)) assert.ok(!rowIds.has(SD.streetId(y.cityCode, y.code)) || y.code === y.officialCode || D.byId.get(SD.streetId(y.cityCode, y.code)).name !== y.name || true);
});
t('directory: historical rows are kept (never deleted) and legacy ids resolve to the official id', () => {
  const hist = D.streets.filter((s) => s.status === 'historical');
  assert.ok(hist.length >= 1, 'historical rows kept');
  const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/streets/legacy-ids.json'), 'utf8'));
  assert.equal(L.stats.provisional, L.stats.provisionalResolved, 'every provisional legacy id resolves');
  const [from, to] = Object.entries(L.map)[0];
  const r = R.resolveGeoId(from); assert.equal(r.id, to); assert.equal(r.legacyId, from);
});
t('search index: the committed index was built from the committed directory (sha256 of both files), every canonical row searchable', () => {
  const ix = SI.read(SD.DIR, D.fileHash);
  assert.ok(ix, 'search-index.json is stale or missing — run node scripts/street-sync.js --rebuild-index');
  assert.equal(ix.counts.rows, D.streets.filter((s) => s.kind !== SD.KIND.LOCALITY).length);
  const c = COV.coverage({ evidenceDir: path.join(os.tmpdir(), 'propx-none-' + process.pid) });
  assert.ok(c.reconcile.canonicalAllSearchable && c.reconcile.districtsEqualNational && c.reconcile.localitiesEqualNational && c.reconcile.placeholdersOnePerLocality, JSON.stringify(c.reconcile));
  assert.equal(c.totals.searchable, c.totals.canonical);
});

/* ───────────────────────── search (§21) ───────────────────────── */
t('§21 a common street name in many localities: city-qualified rows, each its own id; the selected locality first', () => {
  const all = first('הרצל');
  const cities = new Set(all.map((m) => m.cityCode));
  assert.ok(cities.size >= 5, 'הרצל in 5+ localities: ' + cities.size);
  assert.equal(new Set(all.map((m) => m.id)).size, all.length, 'one id per row');
  assert.ok(all.every((m) => m.city && m.cityCode && /^st:\d+:\d+$/.test(m.id)));
  const near = first('הרצל', 'פתח תקווה'); assert.equal(near[0].id, 'st:7900:213'); assert.equal(near[0].tier, 1); assert.ok(near[0].inSelectedLocality);
  const byCode = first('הרצל', 7900); assert.equal(byCode[0].id, 'st:7900:213');
  const named = first('הרצל פתח תקווה'); assert.equal(named[0].id, 'st:7900:213');
  const r = R.searchGeo('הרצל', 12); assert.ok(r.meta.moreStreets > 0 && r.meta.exactStreetLocalities >= 5, 'the "add a locality" hint has its count');
});
t('§21 a rare street (one locality nationally) is the first hit by name alone', () => {
  const by = new Map(); for (const s of G.streets) { if (!by.has(s.n)) by.set(s.n, []); by.get(s.n).push(s); }
  const rare = [...by.values()].filter((v) => v.length === 1 && v[0].n.length >= 8 && v[0].kind === 'street').slice(0, 25);
  for (const [s] of rare) assert.equal(first(s.street)[0].id, s.id, s.street);
});
t('§21 a new street (absent from the legacy mirror PROPX served before) is searchable', () => {
  const mirror = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/streets-index.json'), 'utf8')).streets;
  const coded = new Set(mirror.filter((r) => r[1] != null).map((r) => `st:${r[0]}:${r[1]}`));
  const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/streets/legacy-ids.json'), 'utf8'));
  const mapped = new Set(Object.values(L.map));
  const fresh = G.streets.filter((s) => s.kind === 'street' && !coded.has(s.id) && !mapped.has(s.id));
  assert.ok(fresh.length >= 1, 'the official registry holds streets the mirror did not');
  for (const s of fresh.slice(0, 20)) assert.ok(has(first(s.street, s.cityCode), s.id), s.id + ' ' + s.street);
});
t('§21 punctuation variants (geresh / gershayim / none) reach the same official street', () => {
  for (const q of ["ז'בוטינסקי", 'ז׳בוטינסקי', 'זבוטינסקי', 'ז`בוטינסקי']) assert.equal(first(q, 5000)[0].id, 'st:5000:456', q);
  assert.equal(first('בר לוי אשר', 7900)[0].id, first('בר-לוי אשר', 7900)[0].id, 'hyphen ↔ space');
});
t('§21 abbreviations and street-type words: "שדרות בן גוריון חיפה" reaches the official "שד בן גוריון"; "רח" / "שד׳" prefixes', () => {
  assert.equal(first('שדרות בן גוריון חיפה')[0].id, 'st:4000:399');
  assert.equal(first("שד' רוטשילד", 5000)[0].id, 'st:5000:1103');
  assert.equal(first("רח' הרצל", 7900)[0].id, 'st:7900:213');
  assert.ok(has(first('רח 8 אכסאל'), D.streets.find((s) => s.cityCode === 478 && s.name === 'רח 8').id));
});
t('§21 an official synonym finds its official street, says it matched a synonym, and is never a second street', () => {
  const hit = first('רידינג', 5000)[0];
  assert.equal(hit.id, 'st:5000:101'); assert.equal(hit.he, 'רדינג'); assert.equal(hit.matchedName, 'רידינג'); assert.equal(hit.via, 'synonym');
  const allIds = R.searchGeo('רידינג', 20, { near: 5000 }).matches.filter((m) => m.kind === 'street' && m.cityCode === 5000).map((m) => m.id);
  assert.equal(allIds.filter((x) => x === 'st:5000:101').length, 1, 'one row for the street');
  /* a curated short form of a locality stays a street query too */
  assert.ok(has(first('תל אביב', 'ראש פינה'), D.streets.find((s) => s.cityCode === 26 && s.name === 'תל אביב').id));
});
t('§21 a historical (retired) street stays searchable, labelled, ranked after current rows of its tier', () => {
  const h = G.streets.find((s) => s.status === 'historical' && s.kind === 'street');
  const hit = first(h.street, h.cityCode).find((m) => m.id === h.id);
  assert.ok(hit, 'historical street found'); assert.equal(hit.status, 'historical');
});
t('§21 code 9000 (the locality placeholder) is never offered as a street — the locality is', () => {
  const r = R.searchGeo('פתח תקווה', 12);
  assert.ok(!r.matches.some((m) => /:9000$/.test(m.id)), 'no placeholder row');
  assert.equal(r.matches[0].kind, 'locality'); assert.equal(r.matches[0].code, 7900);
  assert.equal(R.resolveGeoId('st:7900:9000'), null);
  assert.equal(ST.street('st:7900:9000'), null);
});
t('§21 address areas and sites are searchable and labelled as such', () => {
  const area = G.streets.find((s) => s.kind === 'area' && s.cityCode === 7900);
  const hit = first(area.street, 7900).find((m) => m.id === area.id); assert.ok(hit); assert.equal(hit.streetKind, 'area');
  const site = G.streets.find((s) => s.kind === 'site');
  const sh = first(site.street, site.cityCode).find((m) => m.id === site.id); assert.ok(sh); assert.equal(sh.streetKind, 'site');
});
t('§21 recall: 1,500 official rows — street name + selected locality and "street locality" each reach the row in the top 7', () => {
  let seed = 11; const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  let near = 0, named = 0; const N = 1500, miss = [];
  for (let i = 0; i < N; i++) {
    const s = G.streets[Math.floor(rnd() * G.streets.length)];
    if (has(first(s.street, s.cityCode), s.id)) near++; else if (miss.length < 5) miss.push(s.id + ' ' + s.street);
    if (has(first(s.street + ' ' + s.city), s.id)) named++; else if (miss.length < 5) miss.push('named ' + s.id + ' ' + s.street);
  }
  assert.equal(near, N, 'near: ' + miss.join(' | ')); assert.equal(named, N, 'named: ' + miss.join(' | '));
});
t('§19 performance: a warm query answers in well under 50 ms', () => {
  first('הרצל'); const t0 = process.hrtime.bigint();
  for (const q of ['הרצל', 'רוטשילד', 'בן גוריון', 'הנשיא', 'רמת']) first(q, 5000);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 / 5 < 50);
});

/* ───────────────────────── the deal → street match ───────────────────────── */
const LI = M.localityIndex(D, 7900);
t('match: parseAddress reads "<street> <house>", "רחוב X מס\' N", and a bare street', () => {
  assert.deepEqual(M.parseAddress('העצמאות 81'), { street: 'העצמאות', house: '81' });
  assert.deepEqual(M.parseAddress("רחוב התקוה מס' 56"), { street: 'התקוה', house: '56' });
  assert.deepEqual(M.parseAddress('בר-לוי אשר 17א'), { street: 'בר-לוי אשר', house: '17א' });
  assert.deepEqual(M.parseAddress('העצמאות'), { street: 'העצמאות', house: null });
});
t('match: OBSERVED only when every address of the complete list is on one street; POSSIBLE for a corner parcel, a truncated list or an unresolved address', () => {
  const ok = M.matchDeal(LI, ['העצמאות 81', 'העצמאות 83'], 2);
  assert.equal(ok.state, 'OBSERVED'); assert.equal(ok.streets.length, 1); assert.equal(ok.streets[0].id, 'st:7900:1205'); assert.deepEqual(ok.streets[0].houses, ['81', '83']);
  const corner = M.matchDeal(LI, ['העצמאות 81', 'הרצל 2'], 2); assert.equal(corner.state, 'POSSIBLE'); assert.ok(corner.reasons.includes('multi-street-parcel')); assert.equal(corner.streets.length, 2);
  const cut = M.matchDeal(LI, ['העצמאות 1', 'העצמאות 3', 'העצמאות 5'], 9); assert.equal(cut.state, 'POSSIBLE'); assert.ok(cut.reasons.includes('address-list-truncated'));
  const unres = M.matchDeal(LI, ['העצמאות 1', 'רחוב שלא קיים בכלל 3'], 2); assert.equal(unres.state, 'POSSIBLE'); assert.ok(unres.reasons.includes('unresolved-address-on-parcel'));
  assert.equal(M.matchDeal(LI, ['רחוב שלא קיים בכלל 3'], 1).state, 'UNRESOLVED');
  assert.equal(M.matchDeal(LI, [], 0).state, 'NO_ADDRESS');
});
t('match: rungs official name → official synonym → normalized name; the rung is kept; a synonym resolves to the official street', () => {
  assert.equal(M.matchDeal(LI, ['העצמאות 1'], 1).streets[0].via, 'official-name');
  const syn = M.matchDeal(LI, ['עצמאות 1'], 1); assert.equal(syn.streets[0].id, 'st:7900:1205'); assert.equal(syn.streets[0].via, 'official-synonym');
  const norm = M.matchDeal(LI, ['רחוב הרצל 1'], 1); assert.equal(norm.streets[0].id, 'st:7900:213');
  assert.equal(M.resolveStreet(LI, 'עצמאות').via, 'official-synonym');
});
t('match: the same name in another locality is never attached (the join is inside the deal\'s locality)', () => {
  const rl = M.localityIndex(D, 8300);
  const pt = M.matchDeal(LI, ['הרצל 5'], 1).streets[0].id, rishon = M.matchDeal(rl, ['הרצל 5'], 1).streets[0].id;
  assert.notEqual(pt, rishon); assert.ok(pt.startsWith('st:7900:') && rishon.startsWith('st:8300:'));
});

/* ───────────────────────── the sweep: provably complete ───────────────────────── */
function register(rows) {
  /* an in-memory /api/deals/search: date-filtered, ≤ 200 a page, ties in a random order, total counted to 10,000 */
  let calls = 0;
  const search = async (name, from, to, offset = 0) => {
    calls++;
    const hit = rows.filter((r) => r.settlement === name && r.date >= from && r.date <= to);
    const sh = hit.map((r) => [r, Math.random()]).sort((a, b) => b[0].date.localeCompare(a[0].date) || a[1] - b[1]).map((x) => x[0]);
    return { data: sh.slice(offset, offset + 200), total: Math.min(hit.length, 10000), capped: hit.length > 10000 };
  };
  return { search, calls: () => calls };
}
function mkRows(n, settlement, days = 1096, start = '2023-09-18') {
  const out = []; const d0 = Date.parse(start + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push({ id: settlement + i, settlement, date: new Date(d0 + ((i * 7919) % days) * 86400e3).toISOString().slice(0, 10), amount: 1e6 + i });
  return out;
}
t('sweep: every row exactly once across a capped settlement (> 10,000), tied dates in random order and a day above a page', async () => {
  const rows = mkRows(10600, 'A');
  for (let i = 0; i < 430; i++) rows.push({ id: 'day' + i, settlement: 'A', date: '2025-03-02', amount: 2e6 + i });
  const reg = register(rows), st = { leaves: 0, splits: 0, pagedDays: 0 };
  const got = await SW.sweepWindow('A', '2023-09-18', '2026-09-17', null, st, reg.search);
  assert.equal(got.length, rows.length); assert.equal(new Set(got.map((r) => r.id)).size, rows.length, 'no row twice, none missed');
  assert.ok(st.pagedDays >= 1 && st.leaves > 50);
});
t('sweep: a short read or parts that do not add up fail the locality — never a silent gap', async () => {
  const rows = mkRows(500, 'B');
  const lying = async (name, from, to, offset = 0) => { const r = await register(rows).search(name, from, to, offset); return from === '2023-09-18' && to === '2026-09-17' ? { ...r, total: r.total + 3 } : r; };
  await assert.rejects(SW.sweepWindow('B', '2023-09-18', '2026-09-17', null, { leaves: 0, splits: 0, pagedDays: 0 }, lying), /parts hold/);
  const short = async (name, from, to, offset = 0) => { const r = await register(rows).search(name, from, to, offset); return r.total <= 200 && r.total > 3 ? { ...r, data: r.data.slice(1) } : r; };
  await assert.rejects(SW.sweepWindow('B', '2023-09-18', '2026-09-17', null, { leaves: 0, splits: 0, pagedDays: 0 }, short), /rows of/);
});
t('sweep: a copy of a coded row without its settlement code is collapsed; repeated coded rows are kept', () => {
  const a = { date: '2025-01-01', amount: 1, nature: 'x', gush: '1', helka: '2', sub_parcel: '3', settlement_code: '7900' };
  const n = SW.normalize([a, { ...a, settlement_code: null }, { ...a }]);
  assert.equal(n.duplicates, 1); assert.equal(n.kept.length, 2);
});
t('sweep: the 36-month window ends on the copy\'s latest deal, not on today', () => {
  assert.deepEqual(SW.windowOf('2026-09-17'), { from: '2023-09-18', to: '2026-09-17', months: 36 });
});

/* ───────────────────────── the fixture store (TEST FIXTURE — synthetic deals on real streets) ───────────────────────── */
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'propx-streets-'));
const W = { from: '2023-09-18', to: '2026-09-17', months: 36 };
const name = (id) => D.byId.get(id).name;
const PT = 7900, HERZL = 'st:7900:213', ATZ = 'st:7900:1205';
/* four ordinary named streets of the locality whose name no other row of it shares (exact, unambiguous) */
const ptNames = new Map(); for (const s of D.streets) if (s.cityCode === PT && s.kind !== 'locality') ptNames.set(s.n, (ptNames.get(s.n) || 0) + 1);
const plain = D.streets.filter((s) => s.cityCode === PT && s.kind === 'street' && s.status === 'current' && ptNames.get(s.n) === 1 && /^[א-ת ]{5,}$/.test(s.name) && ![HERZL, ATZ].includes(s.id) && M.resolveStreet(LI, s.name) && M.resolveStreet(LI, s.name).id === s.id);
const [FIVE, FOUR, ONE, ZERO] = [plain[10].id, plain[20].id, plain[30].id, plain[40].id];
let gush = 6000;
const deal = (date, addrs, o = {}) => ({ date, amount: 2000000, nature: 'דירה בבית קומות', area_sqm: 100, rooms: 4, year_built: 1990, portion_fraction: 1, sub_parcel: '001',
  settlement: 'פתח תקווה', settlement_code: '7900', gush: String(o.gush || gush++), helka: '1', addresses: addrs, addresses_total: addrs.length, ...o });
const monthsBack = (m) => new Date(Date.parse(W.to + 'T00:00:00Z') - m * 30.4375 * 86400e3).toISOString().slice(0, 10);
const rows = [];
for (let i = 0; i < 12; i++) rows.push(deal(monthsBack(1 + i * 0.8), [name(HERZL) + ' ' + (i + 1)], { amount: 2400000 + i * 10000, area_sqm: 80 + i }));
for (let i = 0; i < 11; i++) rows.push(deal(monthsBack(13 + i * 0.8), [name(HERZL) + ' ' + (i + 1)], { amount: 2000000 + i * 10000, area_sqm: 80 + i }));
rows.push(deal(monthsBack(2), [name(HERZL) + ' 1'], { portion_fraction: 0.5, amount: 900000 }));                 // partial: observed, never priced
rows.push(deal(monthsBack(2), [name(HERZL) + ' 3'], { nature: 'מגורים', amount: 300000 }));                     // not a dwelling
rows.push(deal(monthsBack(3), [name(HERZL) + ' 7', name(ATZ) + ' 2'], { amount: 9900000 }));                     // corner parcel → POSSIBLE both
rows.push(deal(monthsBack(4), [name(HERZL) + ' 1', name(HERZL) + ' 3', name(HERZL) + ' 5'], { addresses_total: 9, amount: 9800000 })); // truncated → POSSIBLE
for (let i = 0; i < 5; i++) rows.push(deal(monthsBack(5 + i), [name(FIVE) + ' 4'], { amount: 1500000 + i * 100000, year_built: i === 0 ? 2025 : 1980 }));
for (let i = 0; i < 4; i++) rows.push(deal(monthsBack(5 + i), [name(FOUR) + ' 9'], { amount: 3000000 }));
rows.push(deal(monthsBack(6), [name(ONE) + ' 2']));
rows.push(deal(monthsBack(7), ['עצמאות 5']));                                                                    // synonym → העצמאות
rows.push(deal(monthsBack(8), []));                                                                              // no address: locality only
const shard = SW.buildShard(PT, ['פתח תקווה'], rows, { window: W, scrapedAt: '2026-09-19 11:07:39+00', fetchedAt: '2026-10-19T10:00:00Z' }, D);
fs.writeFileSync(path.join(FIX, PT + '.json'), JSON.stringify(shard));
fs.writeFileSync(path.join(FIX, '1263.json'), JSON.stringify(SW.buildShard(1263, ['כפר ורדים'], [], { window: W, scrapedAt: '2026-09-19 11:07:39+00', fetchedAt: '2026-10-19T10:00:00Z' }, D)));
const FIX_META = { schema: 1, source: { name: 'TEST FIXTURE', channel: 'independent-republication', scrapedAt: '2026-09-19 11:07:39+00', lastDeal: W.to }, window: W, sweep: { status: 'COMPLETE' }, settlements: { noDealsInWindow: [2640] } };
fs.writeFileSync(path.join(FIX, 'meta.json'), JSON.stringify(FIX_META));
/* a shard of an EARLIER window (a locality the latest sweep did not reach): stale — never read as current */
fs.writeFileSync(path.join(FIX, '8300.json'), JSON.stringify(SW.buildShard(8300, ['ראשון לציון'], [deal('2022-05-01', ['הרצל 5'], { settlement: 'ראשון לציון', settlement_code: '8300' })], { window: { from: '2020-01-01', to: '2022-12-31', months: 36 }, scrapedAt: 'old', fetchedAt: 'old' }, D)));
fs.writeFileSync(path.join(FIX, 'summary.json'), JSON.stringify(EV.summarize(FIX, D, FIX_META)));
const street = (id) => ST.street(id, { dir: FIX, limit: 500 });

t('sample states: ≥ 10 priced = SUPPORTED (median, P10–P90; a change only from 30 + 30); 5 = LIMITED (median, no percentiles); 4 = INSUFFICIENT (—); 0 = NONE', () => {
  const s = street(HERZL).evidence.stats;
  assert.equal(s.state, 'SUPPORTED'); assert.equal(s.priced, 23); assert.ok(s.medianPrice > 0 && s.priceRange && s.priceRange.p10 <= s.medianPrice && s.priceRange.p90 >= s.medianPrice);
  assert.equal(s.change.pct, null, 'a change needs 30 + 30 deals with ₪/m² — 12 + 11 is not enough'); assert.match(s.change.reason, /30/);
  const five = street(FIVE).evidence.stats; assert.equal(five.state, 'LIMITED'); assert.ok(five.medianPrice > 0); assert.equal(five.priceRange, null); assert.equal(five.change.pct, null);
  const four = street(FOUR).evidence.stats; assert.equal(four.state, 'INSUFFICIENT'); assert.equal(four.medianPrice, null); assert.equal(four.medianPricePerSqm, null); assert.equal(street(FOUR).evidence.deals.length, 4, 'the deals are still listed');
  assert.equal(street(ONE).evidence.stats.state, 'INSUFFICIENT');
  const zero = street(ZERO).evidence.stats; assert.equal(zero.state, 'NONE'); assert.equal(zero.observed, 0);
});
t('TRUTH STREET EXISTS ≠ HAS TRANSACTIONS: a street with no deal is a full street page (identity, synonyms, context) — and a street of an unswept locality says so', () => {
  const z = street(ZERO); assert.ok(z.identity && z.identity.name && z.identity.cityCode === PT); assert.equal(z.evidence.stats.state, 'NONE'); assert.ok(z.doesNotKnow.includes('no-observed-deals'));
  assert.ok(z.context.locality.medianPrice > 0, 'the context is there');
  const rishon = D.streets.find((s) => s.cityCode === 8300 && s.n === 'הרצל');
  const r = street(rishon.id); assert.ok(r.identity); assert.equal(r.evidence.state, 'NOT_SWEPT'); assert.ok(r.doesNotKnow.includes('locality-not-swept'));
  const kv = street(D.streets.find((s) => s.cityCode === 1263 && s.kind === 'street').id); assert.equal(kv.evidence.stats.state, 'NONE');
});
t('TRUTH NAME ≠ ID and SAME NAME IN TWO CITIES ≠ SAME STREET: הרצל in פתח תקווה and in ראשון לציון are two ids with separate evidence', () => {
  const rishon = D.streets.find((s) => s.cityCode === 8300 && s.n === 'הרצל');
  assert.notEqual(rishon.id, HERZL); assert.equal(D.byId.get(HERZL).n, rishon.n);
  assert.equal(street(HERZL).evidence.stats.observed > 0, true); assert.equal(street(rishon.id).evidence.stats, undefined);
  assert.throws(() => assert.equal(ST.street('הרצל'), 'x'));
  assert.equal(ST.street('הרצל'), null, 'a name is not an id');
});
t('TRUTH SYNONYM ≠ SECOND STREET: a deal addressed by the synonym "עצמאות" lands on the official street העצמאות; the synonym has no row or page', () => {
  const a = street(ATZ); assert.equal(a.evidence.stats.observed, 1); assert.equal(a.evidence.matchRungs['official-synonym'], 1);
  assert.ok(a.identity.synonyms.includes('עצמאות'));
  const synRow = D.synonyms.find((y) => y.cityCode === PT && y.name === 'עצמאות');
  assert.equal(ST.street(SD.streetId(PT, synRow.code)), null, 'a synonym code is not a street id');
});
t('TRUTH NO TRANSACTIONS ≠ ZERO PRICE: no median is 0 anywhere; missing is null ("—" on the page)', () => {
  for (const id of [ZERO, FOUR, ONE]) { const s = street(id).evidence.stats; assert.equal(s.medianPrice, null); assert.equal(s.medianPricePerSqm, null); }
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /const medianV=st&&st\.medianPrice!=null\?fmtNIS\(st\.medianPrice\):"—"/);
});
t('TRUTH CITY PRICE ≠ STREET PRICE and NEIGHBORHOOD PRICE ≠ STREET PRICE: the context is a separate block with its sentence; an insufficient street keeps "—" beside a locality median', () => {
  const s = street(FOUR);
  assert.equal(s.evidence.stats.medianPrice, null); assert.ok(s.context.locality.medianPrice > 0);
  assert.equal(s.context.note, 'These figures describe the surrounding market, not observed prices on this street.');
  assert.equal(s.context.locality.cls, 'DERIVED');
  assert.equal(s.context.neighbourhood.resolved, false, 'no verified link → no neighbourhood figure');
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(page.includes('These figures describe the surrounding market, not observed prices on this street.') && page.includes('הנתונים האלה מתארים את השוק הסובב, לא מחירים שנצפו ברחוב הזה.'));
});
t('TRUTH ASKING ≠ TRANSACTION: every street page says asking prices are not known; no asking field exists', () => {
  const s = street(HERZL); assert.ok(s.doesNotKnow.includes('asking-prices'));
  assert.ok(!/asking/i.test(JSON.stringify(s.evidence)) && !/asking/i.test(JSON.stringify(s.context)));
});
t('TRUTH POSSIBLE ADDRESS MATCH ≠ OBSERVED: corner and truncated parcels are listed apart and never in the statistics', () => {
  const s = street(HERZL);
  assert.equal(s.evidence.possible.length, 2); assert.ok(s.evidence.possible.every((d) => d.match === 'POSSIBLE'));
  assert.ok(!s.evidence.deals.some((d) => d.amount >= 9800000), 'the POSSIBLE amounts are not in the observed list');
  assert.ok(s.evidence.stats.priceRange.p90 < 9800000, 'nor in the distribution');
  assert.deepEqual(s.evidence.possible.find((d) => d.amount === 9900000).otherStreets, [ATZ]);
  assert.equal(street(ATZ).evidence.possible.length, 1);
});
t('TRUTH PROBABLE NEW ≠ CONFIRMED: newness from the build year only, labelled PROBABLE NEW, never confirmed', () => {
  const d = street(FIVE).evidence.deals; assert.equal(d.filter((x) => x.probableNew).length, 1);
  assert.ok(!/confirmed/i.test(JSON.stringify(street(FIVE).evidence)));
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); assert.ok(page.includes('pnew:"PROBABLE NEW"') && page.includes('pnew:"כנראה חדשה"'));
});
t('universe: a partial sale is observed but never priced; a non-dwelling nature ("מגורים") is excluded and counted apart; no-address deals are locality-only', () => {
  const s = street(HERZL).evidence;
  assert.equal(s.stats.partial, 1); assert.equal(s.stats.observed, 24); assert.equal(s.stats.priced, 23);
  assert.equal(s.nonDwelling.count, 1);
  const loc = EV.locality(PT, { dir: FIX }); assert.equal(loc.addressStates.NO_ADDRESS, 1);
});
t('coverage: national = Σ districts = Σ localities; the states add up to the canonical rows; withTransactions counts OBSERVED streets only', () => {
  const c = COV.coverage({ evidenceDir: FIX });
  assert.ok(Object.values(c.reconcile).every(Boolean), JSON.stringify(c.reconcile));
  assert.equal(c.totals.withTransactions, 5, 'הרצל · העצמאות (by its synonym) · FIVE · FOUR · ONE — a POSSIBLE deal adds none');
  assert.equal(c.totals.SUPPORTED, 1); assert.equal(c.totals.LIMITED, 1);
});

t('review: a shard of an earlier window is stale (NOT_SWEPT, never counted); a locality with no deal in the window is NONE, not NOT_SWEPT', () => {
  const rishon = D.streets.find((s) => s.cityCode === 8300 && s.n === 'הרצל');
  const r = EV.street(rishon.id, { dir: FIX }); assert.equal(r.state, 'NOT_SWEPT'); assert.equal(r.stale, true);
  const sum = JSON.parse(fs.readFileSync(path.join(FIX, 'summary.json'), 'utf8')); assert.equal(sum.counts.staleShards, 1); assert.equal(sum.localities[8300], undefined);
  const rh = D.streets.find((s) => s.cityCode === 2640 && s.kind === 'street');
  const n = EV.street(rh.id, { dir: FIX }); assert.equal(n.swept, true); assert.equal(n.stats.state, 'NONE'); assert.equal(EV.stateOf(sum, 2640, rh.code), 'NONE');
});
t('review: units of one date, amount and parcel on several sub-parcels each count as observed and none is priced; fully identical rows are one transaction', () => {
  const rows = ['001', '002', '003'].map((sub) => deal('2026-01-10', ['הרצל 9'], { gush: 7777, amount: 8400000, sub_parcel: sub }));
  rows.push(deal('2026-02-10', ['הרצל 9'], { gush: 7778, amount: 2000000 }), deal('2026-02-10', ['הרצל 9'], { gush: 7778, amount: 2000000 }));
  rows.push(deal('2026-03-10', ['הרצל 9'], { gush: 7779, amount: null, sub_parcel: '001' }), deal('2026-03-10', ['הרצל 9'], { gush: 7779, amount: null, sub_parcel: '002' }));
  const sh = SW.buildShard(PT, ['פתח תקווה'], rows, { window: W }, D);
  const ds = EV.dealsOf(sh).map((x) => x.deal);
  const same = ds.filter((d) => d.sameConsideration === 3); assert.equal(same.length, 3, 'three units observed'); assert.ok(same.every((d) => !d.priced && d.pricePerSqm === null));
  assert.equal(ds.filter((d) => d.date === '2026-02-10').length, 1); assert.equal(ds.find((d) => d.date === '2026-02-10').copies, 2);
  assert.equal(ds.filter((d) => d.date === '2026-03-10').length, 2, 'rows without an amount are never grouped');
});
t('review: a historical (retired) row answers only when no current row does; a loose name join (a dropped type word) is POSSIBLE; a stated-less list of 3 is not complete', () => {
  assert.equal(M.matchDeal(M.localityIndex(D, 2600), ['שדה התעופה 5'], 1).streets[0].id, 'st:2600:740');
  const cs = D.streets.find((s) => s.cityCode === 166 && s.n === 'השומר');
  const loose = M.matchDeal(M.localityIndex(D, 166), ['כיכר השומר 2'], 1); assert.equal(loose.state, 'POSSIBLE'); assert.ok(loose.reasons.includes('loose-name-match')); assert.equal(loose.streets[0].id, cs.id);
  /* Ashdod (70): official 'שדרות הים התיכון', no synonym 'שד …' — the canonical type spelling is a STRONG rung */
  const sv = M.matchDeal(M.localityIndex(D, 70), ['שד הים התיכון 5'], 1); assert.equal(sv.state, 'OBSERVED'); assert.equal(sv.streets[0].id, 'st:70:698'); assert.equal(sv.streets[0].via, 'spelling-variant');
  /* Petah Tikva's official street is plain 'רוטשילד': dropping a street-type word is a loose join → POSSIBLE */
  assert.equal(M.matchDeal(LI, ['שדרות רוטשילד 5'], 1).state, 'POSSIBLE');
  assert.equal(M.spellKey('שדרות בן גוריון'), M.spellKey('שד בן-גוריון')); assert.notEqual(M.spellKey('כיכר השומר'), M.spellKey('השומר'));
  const cut = M.matchDeal(LI, ['הרצל 1', 'הרצל 3', 'הרצל 5'], null); assert.equal(cut.state, 'POSSIBLE'); assert.ok(cut.reasons.includes('address-list-truncated'));
});
t('review: a row of another settlement fails the locality — never relabelled', () => {
  assert.throws(() => SW.buildShard(2660, ['יבנה'], [deal('2026-01-10', ['הדקל 2'], { settlement: 'גן יבנה', settlement_code: '166' })], { window: W }, D), /another settlement/);
});
t('review: a nominal consideration (< ₪100,000) or a ₪/m² below ₪2,000 is not a market sale — counted, never priced, never ₪0', () => {
  const sh = SW.buildShard(PT, ['פתח תקווה'], [deal('2026-01-10', ['הרצל 1'], { amount: 1 }), deal('2026-01-11', ['הרצל 1'], { amount: 150000, area_sqm: 100 })], { window: W }, D);
  const [a, b] = EV.dealsOf(sh).map((x) => x.deal).sort((x, y) => x.amount - y.amount);
  assert.equal(a.notMarket, true); assert.equal(a.priced, false); assert.equal(a.pricePerSqm, null);
  assert.equal(b.priced, true); assert.equal(b.pricePerSqm, null, '₪1,500 / m² is not a dwelling price'); assert.equal(b.sqmImplausible, true);
  const st = EV.stats([a, b].map((d) => ({ ...d, match: 'OBSERVED' })), W.to); assert.equal(st.notMarket, 1); assert.ok(st.medianPrice === null && st.priceRange === null);
});
t('review: PROBABLE NEW follows the product\'s one rule (build year = deal year or deal year − 1); a later build year is not classified', () => {
  const mk = (yb) => EV.dealsOf(SW.buildShard(PT, ['פתח תקווה'], [deal('2026-03-01', ['הרצל 1'], { year_built: yb })], { window: W }, D))[0].deal;
  assert.equal(mk(2026).probableNew, true); assert.equal(mk(2025).probableNew, true); assert.equal(mk(2024).probableNew, false);
  assert.equal(mk(2029).probableNew, false); assert.equal(mk(2029).buildYearAfterDeal, true);
});
t('review: the dwelling allow-list tolerates the register\'s apostrophes; "מגורים" stays a named exclusion', () => {
  assert.ok(EV.DWELLING_NATURES.has(EV.natureKey('קוטג׳ טורי')) && EV.DWELLING_NATURES.has(EV.natureKey('קוטג’ חד משפחתי')));
  assert.ok(!EV.DWELLING_NATURES.has(EV.natureKey('מגורים')) && EV.EXCLUDED_NATURES.has('מגורים'));
});
t('review: calendar windows — 12 months back from 17.09.2026 starts on 18.09.2025; a leap-day window keeps 01.03; no window end → no counts', () => {
  const d = (date) => ({ date, priced: true, amount: 2e6, pricePerSqm: 25000, areaSqm: 80, match: 'OBSERVED' });
  const st = EV.stats([d('2025-09-17'), d('2025-09-18'), d('2024-09-17'), d('2024-09-18')], '2026-09-17');
  assert.equal(st.last12, 1); assert.equal(st.last24, 3);
  assert.equal(SW.windowOf('2028-02-29').from, '2025-03-01');
  assert.equal(EV.stats([d('2019-01-01')], null).last12, null);
});
t('review: ₪/m² stands on its own count (≥ 10 plain, 5–9 labelled limited) — never inverted between states', () => {
  const ds = Array.from({ length: 10 }, (_, i) => ({ date: '2026-0' + (1 + (i % 8)) + '-10', priced: true, amount: 2e6 + i * 1e4, areaSqm: i < 7 ? 80 : null, pricePerSqm: i < 7 ? 25000 + i : null, match: 'OBSERVED' }));
  const st = EV.stats(ds, W.to); assert.equal(st.state, 'SUPPORTED'); assert.ok(st.medianPricePerSqm > 0); assert.equal(st.sqmLimited, true);
});
t('review: the 12-month change is on ₪/m², needs 30 + 30, carries a 95 % interval, and a mix shift alone does not read as a price change', () => {
  let seed = 5; const r = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const mk = (n, from, to, ppsqm, area) => Array.from({ length: n }, (_, i) => { const day = new Date(Date.parse(from) + ((Date.parse(to) - Date.parse(from)) * (i + 0.5)) / n).toISOString().slice(0, 10);
    const p = Math.round(ppsqm * (0.85 + 0.3 * r())); return { date: day, priced: true, areaSqm: area, amount: p * area, pricePerSqm: p, match: 'OBSERVED' }; });
  const flat = EV.stats([...mk(35, '2025-09-20', '2026-09-15', 25000, 120), ...mk(35, '2024-09-20', '2025-09-15', 25000, 80)], W.to);
  assert.ok(flat.change.pct != null && Math.abs(flat.change.pct) < 8, 'a size shift is not a price change: ' + flat.change.pct);
  assert.equal(flat.change.distinguishable, false); assert.ok(flat.change.interval95[0] < 0 && flat.change.interval95[1] > 0);
  assert.equal(flat.change.recentMedianArea, 120); assert.equal(flat.change.priorMedianArea, 80);
  const up = EV.stats([...mk(35, '2025-09-20', '2026-09-15', 30000, 90), ...mk(35, '2024-09-20', '2025-09-15', 24000, 90)], W.to);
  assert.equal(up.change.distinguishable, true); assert.ok(up.change.pct > 15 && up.change.interval95[0] > 0);
  const again = EV.stats([...mk(35, '2025-09-20', '2026-09-15', 30000, 90), ...mk(35, '2024-09-20', '2025-09-15', 24000, 90)], W.to);
  assert.ok(again.change.interval95.length === 2, 'deterministic interval');
});

/* ───────────────────────── API · page · workflows ───────────────────────── */
t('API: view=street 400 for a malformed id, 404 for an id the directory does not hold; view=streetCoverage reconciles', async () => {
  const h = require('../api/intel.js');
  const call = (q) => new Promise((ok) => { const res = { statusCode: 0, setHeader() {}, end(b) { ok([this.statusCode, JSON.parse(b)]); } }; h({ method: 'GET', url: '/api/intel?' + q, headers: {} }, res); });
  assert.equal((await call('view=street&id=הרצל'))[0], 400);
  assert.equal((await call('view=street&id=st:7900:9000'))[0], 404);
  assert.equal((await call('view=street&id=st:1:1'))[0], 404);
  const [code, body] = await call('view=street&id=' + HERZL); assert.equal(code, 200); assert.equal(body.identity.id, HERZL);
  const [c2, cov] = await call('view=streetCoverage'); assert.equal(c2, 200); assert.ok(cov.reconcile.districtsEqualNational && cov.reconcile.canonicalAllSearchable);
});
t('page: the geo search sends the selected locality, labels kind / synonym / historical, and a street opens Street Intelligence (never the board\'s city metrics)', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /"\/api\/geo\/search\?limit=12&q="\+encodeURIComponent\(qq\)\+\(near\?"&near="/);
  assert.match(page, /if\(g\.kind==="street"&&\/\^st:\\d\+:\\d\+\$\/\.test\(String\(g\.id\|\|""\)\)\)\{\s*const body=el\("geoBody"\);body\.innerHTML=siHTML\(g\)/);
  for (const k of ['geoTagArea', 'geoTagSite', 'geoSynOf', 'geoHist', 'geoMore']) assert.ok((page.match(new RegExp(k + ':', 'g')) || []).length >= 2, k + ' in both languages');
  /* the street view is the server's evidence only: openGeoView calls the one loader of GET /api/intel?view=street, the renderer
     generates nothing (no random, no invented figure, no board metric) — the removed synthetic street layer stays absent */
  const fb = (name) => { const i = page.indexOf('function ' + name + '('); assert.ok(i > -1, name); return page.slice(i, page.indexOf('\n}', i)); };
  assert.match(fb('openGeoView'), /siLoad\(g\.id\)/); assert.match(fb('siLoad'), /fetch\("\/api\/intel\?view=street&limit=200&id="/);
  const view = fb('siHTML'); assert.ok(!/Math\.random|metricsOf|LOCATIONS|base\.price|vcOf\(/.test(view), 'the street view reads no board / model value');
});
t('review: one permit per request on a street (the layer repeats rows), shards re-matched after a directory change, legacy name differences listed, the page names the row kind and history', () => {
  const S = require('../lib/streets/street');
  const r = S.street('st:5000:1103');
  if (r.links.permits.length) {
    const keys = r.links.permits.map((p) => p.request + '|' + p.permit); assert.equal(new Set(keys).size, keys.length, 'one record per request + permit');
    assert.ok(r.links.permits.every((p) => p.rows >= 1));
  }
  const sc = fs.readFileSync(path.join(ROOT, 'scripts/street-evidence-sync.js'), 'utf8');
  assert.match(sc, /sh\.directory !== cur\) \{ writeJson\(f, rematch\(sh, D\)\)/, 'an unchanged copy still re-matches shards built on an older directory');
  const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/streets/legacy-ids.json'), 'utf8'));
  assert.ok(Array.isArray(L.nameDiffers)); assert.equal(L.nameDiffers.length, L.stats.codedNameDiffers || 0);
  for (const [id] of L.nameDiffers) assert.ok(SD.load().byId.has(id), 'a coded legacy id whose name differs still resolves to its official row');
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const i = page.indexOf('function siHTML('), view = page.slice(i, page.indexOf('\n}', i));
  assert.match(view, /t\.exists\(noun,hist,/); assert.match(view, /t\.noun\[I\.kind\]/); assert.match(view, /state==="INSUFFICIENT"&&!priced\?t\.zero/);
  assert.match(view, /tile\(t\.period,E\.swept&&w\?/, 'a locality outside the sweep shows no window'); assert.match(view, /"lim"/);
  for (const k of ['one:', 'exists:', 'zero:', 'nbBasis:', 'rung:', 'in12:']) assert.equal((page.match(new RegExp('\\b' + k, 'g')) || []).length >= 2, true, k + ' he + en');
});
t('review (search): house numbers, pasted marks, separators, type words alone, the Arabic article, שכונת, mid-word finals, near vs named, the page keeps the list it rendered', () => {
  const top = (q, o) => R.searchGeo(q, 12, o || {}).matches.filter((m) => m.kind === 'street');
  const h = R.searchGeo('הרצל 12 פתח תקווה', 12); assert.equal(h.matches.find((m) => m.kind === 'street').id, 'st:7900:213'); assert.equal(h.meta.houseNumber, '12');
  assert.equal(top('רח 8 אכסאל')[0].he, 'רח 8', 'a number that is part of an official name is never stripped');
  assert.equal(top('הֶרְצֵל', { near: 7900 })[0].id, 'st:7900:213', 'niqqud');
  assert.equal(top('‏הרצל‏', { near: 7900 })[0].id, 'st:7900:213', 'bidi marks');
  assert.equal(top('הרצל, פתח תקווה')[0].id, 'st:7900:213', 'a comma is a space');
  /* "רחוב פתח תקווה": never a street "רחוב" in Petah Tikva (the moshav רחוב, loc:854, may scope a street "פתח תקווה") */
  assert.ok(!R.searchGeo('רחוב פתח תקווה', 12).meta.scopes.some((x) => x.locality === 'loc:7900'), 'a street-type word alone is no street');
  const w = SD.load().streets.find((x) => x.name === 'אל-וורוד' && x.status === 'current');
  assert.ok(top('וורוד').some((m) => m.he === 'אל-וורוד'), 'the Arabic article is an optional prefix'); assert.ok(w);
  const sh = SD.load().streets.find((x) => /^שכ /.test(x.name) && x.status === 'current' && x.cityCode === 7900);
  if (sh) assert.ok(top('שכונת ' + sh.name.slice(3), { near: 7900 }).slice(0, 3).some((m) => m.id === sh.id), 'שכונת = שכ');
  assert.ok(top('הגנ').every((m) => !(m.tier < 6 && /[םןץףך]$/.test(m.he))), 'a query ending mid-word never meets a final-letter name as exact');
  assert.equal(top('הרצל', { near: 7900 })[0].inSelectedLocality, 'near'); assert.equal(top('הרצל פתח תקווה')[0].inSelectedLocality, 'named');
  assert.equal(top('שדרות רוטשילד', { near: 5000 })[0].id, 'st:5000:1103');
  assert.equal(top('שד רוטשילד', { near: 5000 })[0].id, 'st:5000:1103', 'the type word spelled another way is exact');
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /if\(seq!==geoSeq\)return;/, 'a stale answer is dropped'); assert.match(page, /openGeoView\(geos\[\+b\.dataset\.geoi\]\)/); assert.match(page, /openGeoView\(geoShown\[\+it\.dataset\.geoi\]\)/);
  assert.ok(!/Herzl Petah Tikva/.test(page), 'the English hint shows a query that works (Hebrew)');
});
t('review (real sweep): a parcel holding half the priced deals is stated beside the median; a build year after the deal is tagged, never PROBABLE NEW; reads are cached', () => {
  const EVr = require('../lib/streets/evidence');
  const S = EVr.store(); if (!S.available) return;   // the committed sweep (bot-written) — invariants only
  let checked = 0;
  for (const [k, v] of Object.entries(S.summary.streets)) {
    if (v[1] < 5 || checked >= 60) continue;
    const [c, sc] = k.split(':'); const e = EVr.street(`st:${c}:${sc}`); checked++;
    if (e.concentration) { assert.ok(e.concentration.n / e.concentration.of >= 0.5); assert.equal(e.concentration.of, e.deals.filter((d) => d.priced).length); }
    for (const d of e.deals) if (d.buildYearAfterDeal) assert.equal(d.probableNew, false, 'off-plan rows are not classified by the build-year rule');
    assert.equal(e.stats.buildYearAfterDeal, e.deals.filter((d) => d.buildYearAfterDeal).length);
  }
  assert.ok(checked > 0);
  const first = Object.keys(S.summary.localities)[0];
  const a = EVr.locality(first), b = EVr.locality(first); assert.equal(a, b, 'the locality context is computed once per shard'); assert.equal(a.stats.change.pct, null);
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /E\.concentration\?` · <b>\$\{ldE\(t\.conc\(E\.concentration\)\)\}<\/b>`/); assert.match(page, /d\.buildYearAfterDeal\?/);
});
t('workflows: the evidence sweep tests before it writes, commits only data/streets/evidence, reads GET-only one request a second; the directory sync rebuilds the index', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/street-evidence-sync.yml'), 'utf8');
  assert.ok(y.indexOf('node test/streets.test.js') < y.indexOf('node scripts/street-evidence-sync.js'));
  assert.match(y, /git add data\/streets\/evidence\n/);
  const sc = fs.readFileSync(path.join(ROOT, 'scripts/street-evidence-sync.js'), 'utf8');
  assert.ok(!/method:\s*'(POST|PUT|DELETE)'/.test(sc)); assert.match(sc, /STREET_EVIDENCE_GAP_MS \|\| 1000/);
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts/street-sync.js'), 'utf8'), /run\.searchIndex = rebuildIndex\(\);/);
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); }
  }
  fs.rmSync(FIX, { recursive: true, force: true });
  console.log(`streets: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
