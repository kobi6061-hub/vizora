'use strict';
/* PROPX · P0 TRANSACTION FRESHNESS & REAL-DEAL AUDIT (19.10.2026) — the gates.
 *
 * Product promise: when PROPX shows an actual transaction it is a real transaction from the source, and the user knows how
 * fresh the transaction universe is. These tests refuse: one "updated" date standing for five; a stale copy labelled current;
 * an empty recent period read as a quiet market; a period the copy does not reach counted as 0; a model date shown as a deal
 * date; a late-reported deal lost or duplicated; an older mirror copy replacing a newer one; a transaction surface without its
 * freshness; and any pinned real deal (test/fixtures/tx-acceptance-2026-10-19.json — found identically in two independent
 * extractions of the Tax Authority's deals) missing from or duplicated in the stored universe. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../lib/gov/freshness');
const EV = require('../lib/streets/evidence');
const ROOT = path.join(__dirname, '..');
const FX = require('./fixtures/tx-acceptance-2026-10-19.json');
let passed = 0, failed = 0;
const results = [];
const t = (name, fn) => results.push([name, fn]);
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SNAP = '2026-09-19 11:07:39.013275+00';

console.log('tx-freshness: the transaction layer');

/* ── the freshness contract ── */
t('FIVE DATES APART: transaction date · source snapshot · source publication (null + reason) · PROPX ingestion · PROPX check — never one "updated"', () => {
  const c = F.contract({ date: '2026-07-18', match: 'OBSERVED' }, { snapshotAt: SNAP, ingestedAt: '2026-10-19T10:13:08.961Z', checkedAt: '2026-10-19T12:45:09.554Z', sourceId: 'over:deals-register', sourceClass: 'REPUBLISHED' });
  assert.deepEqual(Object.keys(c).filter((k) => !/_reason$/.test(k)), ['transaction_date', 'source_snapshot_date', 'source_publication_date', 'propx_ingested_at', 'propx_checked_at', 'source_id', 'source_class', 'match_state']);
  assert.equal(c.transaction_date, '2026-07-18'); assert.equal(c.source_snapshot_date, SNAP); assert.equal(c.source_publication_date, null); assert.ok(c.source_publication_reason);
  assert.notEqual(c.transaction_date, c.propx_ingested_at.slice(0, 10), 'TRANSACTION DATE ≠ INGESTION DATE');
  assert.notEqual(c.propx_ingested_at, c.propx_checked_at, 'ingestion ≠ check');
});
t('TRANSACTION DATE ≠ INGESTION DATE on the stored universe: the street read calls the sweep date "ingestedAt", never a check', () => {
  const s = require('../lib/streets/street').street('st:7900:124').evidence;
  assert.ok(s && s.swept && s.source.ingestedAt, 'ingestedAt present'); assert.equal(s.source.checkedAt, undefined, 'the ingestion date is no longer called a check');
  assert.ok(s.deals.every((d) => d.date !== String(s.source.ingestedAt).slice(0, 10)), 'no deal date equals the ingestion date by construction');
  assert.match(page, /ingested:"stored by PROPX"/); assert.match(page, /\$\{t\.ingested\} \$\{siDate\(src\.ingestedAt\)\}/);
});
t('SOURCE SNAPSHOT DATE ≠ TRANSACTION DATE: the freshness block carries both, apart (copy 19.09.2026 · latest deal 17.09.2026)', () => {
  const S = EV.store(), b = F.evidenceFreshness({ meta: S.meta, runs: [], today: '2026-10-19' });
  assert.equal(b.snapshotDate, String(S.meta.source.scrapedAt).slice(0, 10)); assert.equal(b.latestTransactionDate, S.meta.source.lastDeal);
  assert.ok(b.snapshotDate !== b.latestTransactionDate || S.meta.source.lastDeal === String(S.meta.source.scrapedAt).slice(0, 10));
  assert.equal(b.publicationDate, null); assert.ok(b.publicationNote);
});

/* ── staleness states ── */
t('OLD SNAPSHOT CANNOT BE LABELLED CURRENT: states from the copy\'s age (≤ 7 CURRENT · ≤ 21 RECENT · ≤ 45 STALE · > 45 VERY STALE); a copy without a date or a source not reached for 8 days is SOURCE LAG UNKNOWN', () => {
  const st = (snap, chk = '2026-10-19') => F.stateOf({ snapshotAt: snap, checkedAt: chk, today: '2026-10-19' }).state;
  assert.equal(st('2026-10-19'), 'CURRENT'); assert.equal(st('2026-10-12'), 'CURRENT'); assert.equal(st('2026-10-11'), 'RECENT'); assert.equal(st('2026-09-28'), 'RECENT');
  assert.equal(st('2026-09-27'), 'STALE'); assert.equal(st(SNAP), 'STALE'); assert.equal(st('2026-09-04'), 'STALE'); assert.equal(st('2026-09-03'), 'VERY_STALE');
  assert.equal(st(null), 'SOURCE_LAG_UNKNOWN'); assert.equal(st('2026-10-18', '2026-10-01'), 'SOURCE_LAG_UNKNOWN', 'a fresh copy PROPX has not re-checked for 18 days is not CURRENT');
  for (let k = 8; k <= 400; k++) assert.notEqual(st(new Date(Date.parse('2026-10-19') - k * 864e5).toISOString().slice(0, 10)), 'CURRENT', `a ${k}-day-old copy is never CURRENT`);
  assert.ok(F.isStale('STALE') && F.isStale('VERY_STALE') && F.isStale('SOURCE_LAG_UNKNOWN') && !F.isStale('RECENT') && !F.isStale('CURRENT'));
  /* the thresholds are documented from measured source behaviour, not a guess */
  assert.ok(F.BASIS.registerFill && F.BASIS.lateIntake && F.BASIS.lateIntake.extraJulSepDeals > 0 && /discovery\/2026-10-19-transactions\.json/.test(F.BASIS.source));
  assert.ok(fs.existsSync(path.join(ROOT, F.BASIS.source)), 'the measurement ledger exists');
});
t('the stored copy today (30 days old on 19.10.2026) reads STALE with a stated age — the page banner says so', () => {
  const S = EV.store(), b = F.evidenceFreshness({ meta: S.meta, runs: [{ requests: 3, status: 'unchanged', finishedAt: '2026-10-19T12:45:09.554Z' }], today: '2026-10-19' });
  assert.equal(b.state, 'STALE'); assert.equal(b.ageDays, 30); assert.equal(b.stale, true); assert.equal(b.lagDaysLatestDeal, 32);
  assert.match(page, /TRANSACTION DATA MAY BE STALE · Latest source snapshot: \$\{d\}/); assert.match(page, /F\.stale\?`<span class="txf-banner"/);
});

/* ── "no recent transactions" semantics ── */
t('NO RECENT STREET DEALS ≠ STALE SOURCE: "no recent transactions" only when the copy is CURRENT / RECENT, checked ≤ 8 days and covers ≥ half the period; otherwise "coverage has not been refreshed"', () => {
  const r = (state, lastDeal, n = 0, k = 90) => F.recent({ n, periodDays: k, today: '2026-10-19', lastDeal, state }).kind;
  assert.equal(r('STALE', '2026-09-17'), 'COVERAGE_NOT_REFRESHED'); assert.equal(r('VERY_STALE', '2026-09-17'), 'COVERAGE_NOT_REFRESHED');
  assert.equal(r('SOURCE_LAG_UNKNOWN', '2026-10-18'), 'COVERAGE_NOT_REFRESHED');
  assert.equal(r('RECENT', '2026-10-10'), 'NO_RECENT_TRANSACTIONS'); assert.equal(r('CURRENT', '2026-10-18', 0, 30), 'NO_RECENT_TRANSACTIONS');
  assert.equal(r('RECENT', '2026-09-17', 0, 30), 'COVERAGE_NOT_REFRESHED', 'a 30-day period after the copy\'s end is not covered');
  assert.equal(r('STALE', '2026-09-17', 4), 'HAS_TRANSACTIONS');
  const s = require('../lib/streets/street').street('st:7900:124');
  assert.ok(s.freshness && s.freshness.recent && s.freshness.recent[90], 'the street read states what an empty recent period means');
  if (s.freshness.stale) assert.equal(s.freshness.recent[90].kind === 'NO_RECENT_TRANSACTIONS', false, 'a stale copy never says "no recent transactions"');
  assert.match(page, /Recent transaction coverage has not been refreshed\./);
});
t('STALE SOURCE ≠ ZERO TRANSACTIONS: a period the copy does not reach has no count (null), never 0; the transactions section shows "not refreshed", never "no transactions found"', () => {
  const p = F.periods(['2026-09-17', '2026-08-01', '2026-07-01'], { today: '2026-10-19', lastDeal: '2026-09-17' });
  assert.equal(p[7].n, null); assert.equal(p[30].n, null); assert.equal(p[7].coverage, 'NOT_COVERED'); assert.equal(p[30].coverage, 'NOT_COVERED');
  assert.equal(p[60].coverage, 'PARTLY_COVERED'); assert.equal(p[60].n, 1); assert.equal(p[90].coveredDays, 58);
  assert.match(page, /txPeriodUncovered\(M\.freshness\)\?t\.txNotRefreshed\(/, 'the empty state checks coverage before "no transactions"');
  assert.match(page, /function txPeriodUncovered\(F\)\{\s*if\(!F\)return true;\s*if\(F\.stale\|\|!F\.latestTransactionDate\)return true;/);
});
t('MODEL DATE ≠ REAL DEAL DATE: the street\'s latest observed transaction is the newest OBSERVED deal (≤ the copy\'s latest deal), never the model\'s as-of / build date', () => {
  const s = require('../lib/streets/street').street('st:7900:124');
  const newest = s.evidence.deals.map((d) => d.date).sort().pop();
  assert.equal(s.freshness.latestObservedTransaction, newest); assert.ok(newest <= EV.store().meta.source.lastDeal);
  const M = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'streets', 'model', 'model.json'), 'utf8')); } catch { return null; } })();
  if (M) { assert.notEqual(s.freshness.latestObservedTransaction, String(M.builtAt).slice(0, 10)); assert.ok(!('asOf' in s.freshness) && !('builtAt' in s.freshness), 'no model date travels in the freshness block'); }
});

/* ── upsert / never backwards ── */
t('LATE-REPORTED TRANSACTION MUST BE UPSERTED: a deal dated before the old copy\'s end that arrives in the next copy is in the rebuilt shard — once', () => {
  const SW = require('../lib/streets/sweep'), SD = require('../lib/streets/directory');
  const D = SD.load();
  const row = (date, amount, sub, extra = {}) => ({ date, amount, nature: 'דירה בבית קומות', area_sqm: 90, rooms: 4, year_built: 2000, portion_fraction: 1, sub_parcel: sub, gush: '6362', helka: '59', addresses: ['אורלוב זאב 5'], addresses_total: 1, declared_amount: amount, settlement: 'פתח תקווה', settlement_code: '7900', ...extra });
  const meta = { window: { from: '2023-09-18', to: '2026-10-15', months: 36 }, scrapedAt: '2026-10-17 10:00:00+00', fetchedAt: '2026-10-18T00:00:00Z' };
  const A = SW.buildShard(7900, ['פתח תקווה'], SW.normalize([row('2026-09-01', 2000000, '001'), row('2026-08-01', 1900000, '002')]).kept, meta, D);
  const late = row('2026-08-20', 2100000, '003');   // reported after copy A was taken, dated inside it
  const B = SW.buildShard(7900, ['פתח תקווה'], SW.normalize([row('2026-09-01', 2000000, '001'), row('2026-08-01', 1900000, '002'), late, { ...late }]).kept, meta, D);
  assert.equal(EV.dealsOf(A).length, 2);
  const deals = EV.dealsOf(B);
  assert.equal(deals.length, 3, 'the late deal is upserted; its duplicate row is one transaction');
  assert.equal(deals.filter((x) => x.deal.date === '2026-08-20').length, 1);
  assert.equal(deals.find((x) => x.deal.date === '2026-08-20').deal.copies, 2, 'identical rows collapse into one transaction (copies counted)');
});
t('LATE-REPORTED in the ledger: an upsert of a later read inserts the late deal once and keeps every earlier row\'s first_seen_at', async () => {
  const { TxLedger } = require('../lib/gov/ledger');
  const mem = new Map();
  const store = { async getMany(src, keys) { const m = new Map(); for (const k of keys) if (mem.has(src + k)) m.set(k, mem.get(src + k)); return m; }, async putMany(src, rows) { for (const r of rows) mem.set(src + r.record_key, r); } };
  const L = new TxLedger(store);
  const tx = (id, date, price) => ({ txId: id, date, price, areaSqm: 90, rooms: 4, city: 'פתח תקווה', provenance: [{ source: 'x', retrievedAt: '2026-10-01T00:00:00Z' }] });
  const a = await L.upsert('over:deals-register', [tx('k1', '2026-09-01', 2000000)], { fetchedAt: '2026-10-01T00:00:00Z' });
  const b = await L.upsert('over:deals-register', [tx('k1', '2026-09-01', 2000000), tx('k2', '2026-08-20', 2100000), tx('k2', '2026-08-20', 2100000)], { fetchedAt: '2026-10-08T00:00:00Z' });
  assert.equal(a.inserted, 1); assert.equal(b.inserted, 1); assert.equal(b.unchanged, 1); assert.equal(mem.size, 2);
  const k1 = [...mem.values()].find((r) => r.transaction_date === '2026-09-01'); assert.equal(k1.first_seen_at, '2026-10-01T00:00:00Z');
});
t('NEWER RECORD CANNOT BE OVERRIDDEN BY AN OLDER MIRROR COPY: the sweep refuses a copy with an earlier snapshot or an earlier latest deal (whatever --force says)', () => {
  const stored = { scrapedAt: SNAP, lastDeal: '2026-09-17' };
  assert.ok(F.olderCopy(stored, { scrapedAt: '2026-09-01 10:00:00+00', lastDeal: '2026-08-30' }));
  assert.ok(F.olderCopy(stored, { scrapedAt: '2026-10-01 10:00:00+00', lastDeal: '2026-09-10' }), 'a later scrape with an EARLIER latest deal is still older content');
  assert.ok(F.olderCopy(stored, { scrapedAt: null, lastDeal: '2026-10-01' }));
  assert.equal(F.olderCopy(stored, { scrapedAt: '2026-10-19 08:00:00+00', lastDeal: '2026-10-15' }), null);
  assert.equal(F.olderCopy(stored, { scrapedAt: SNAP, lastDeal: '2026-09-17' }), null, 'the same copy is not older');
  const sync = fs.readFileSync(path.join(ROOT, 'scripts', 'street-evidence-sync.js'), 'utf8');
  const guard = sync.indexOf('FR.olderCopy('), progress = sync.indexOf("let progress = readJson('progress.json')");
  assert.ok(guard > 0 && guard < progress, 'the guard runs before any progress / force path');
  assert.match(sync, /status: 'refused'/);
  /* two sources never overwrite each other in the ledger: rows are keyed per source id */
  assert.match(fs.readFileSync(path.join(ROOT, 'lib', 'gov', 'ledger.js'), 'utf8'), /getMany\(sourceId, keep\.map/);
});

/* ── real deals: the pinned acceptance set ── */
t('ACCEPTANCE SET: ≥ 50 real recent deals, ≥ 8 cities, ≥ 20 streets, several property types, each with its source identity pinned', () => {
  assert.ok(FX.deals.length >= 50, 'deals'); assert.ok(new Set(FX.deals.map((d) => d.cityCode)).size >= 8, 'cities');
  assert.ok(new Set(FX.deals.map((d) => d.cityCode + ':' + d.street)).size >= 20, 'streets');
  assert.ok(new Set(FX.deals.map((d) => d.natureRegister)).size >= 3, 'property types');
  const v = FX.verification; assert.ok(v.sources.register.datasetId && v.sources.register.scrapedAt && v.sources.govmapLayer.datasetId && v.sources.govmapLayer.loadedAt);
  assert.match(v.notAs, /NOT a direct read of the official site/);
  for (const d of FX.deals) for (const k of ['city', 'cityCode', 'street', 'date', 'block', 'parcel', 'amount', 'govmapDealId']) assert.ok(d[k] != null && d[k] !== '', k + ' pinned');
});
t('REGRESSION: every pinned real deal is in the stored universe EXACTLY ONCE with the same date · block · parcel · sub-parcel · amount · area · rooms', () => {
  const S = EV.store();
  assert.ok(F.ts(S.meta.source.scrapedAt) >= F.ts(FX.verification.sources.register.scrapedAt), 'the stored copy is never older than the fixture\'s');
  const miss = [];
  for (const f of FX.deals) {
    const sh = EV.shardOf(f.cityCode);
    const hits = sh ? EV.dealsOf(sh).filter((x) => { const d = x.deal; return d.date === f.date && Number(d.gush) === f.block && Number(d.helka) === f.parcel && Number(d.subParcel || 0) === (f.subParcel || 0) && d.amount === f.amount && (f.areaSqm == null || d.areaSqm === f.areaSqm) && (f.rooms == null || d.rooms == null || d.rooms === f.rooms); }) : [];
    if (hits.length !== 1) miss.push(`${f.city} · ${f.street} ${f.house} · ${f.date} · ${f.block}/${f.parcel}/${f.subParcel} · ₪${f.amount} → ${hits.length}`);
  }
  assert.deepEqual(miss, [], 'missing or duplicated pinned deals');
});
t('a pinned OBSERVED deal is listed on its street\'s page with its real date and amount (the page shows the real deal, never a model value)', () => {
  const dwelling = new Set(EV.store().meta.dwellingNatures);
  const obs = FX.deals.filter((d) => d.propxMatch === 'OBSERVED' && dwelling.has(d.natureRegister) && d.propxStreetCodes && d.propxStreetCodes.length === 1).slice(0, 15);
  assert.ok(obs.length >= 10);
  for (const f of obs) {
    const s = EV.street(`st:${f.cityCode}:${f.propxStreetCodes[0]}`);
    assert.ok(s.deals.some((d) => d.date === f.date && d.amount === f.amount && Number(d.gush) === f.block), `${f.city} ${f.street} ${f.date}`);
  }
});

/* ── the daily monitor ── */
t('DAILY MONITOR (read-only): register copy · GovMap-layer copy · official channels · PROPX latest / counts · lag · alerts (MATERIAL_LAG, NEW_COPY_NOT_SWEPT, OLDER_COPY_SERVED, VOLUME_DROP)', async () => {
  /* the monitor is exercised as a child process with a fetch shim (no network): one module, its own argv */
  const shim = path.join(require('node:os').tmpdir(), 'propx-txf-shim-' + process.pid + '.js');
  fs.writeFileSync(shim, `global.setTimeout=(f)=>f();global.fetch=async(url)=>{const u=new URL(url);let body,status=200,text;
    if(u.pathname==='/api/deals/stats')body=JSON.parse(process.env.TXF_REG);else if(u.pathname==='/api/deals/govmap/stats')body=JSON.parse(process.env.TXF_GOV);
    else if(u.host==='www.govmap.gov.il'){status=403;text='Request blocked.'}else if(u.host==='www.nadlan.gov.il')text='<script src="https://www.google.com/recaptcha/enterprise.js"></script>';
    else throw new Error('fetch failed');return{status,url,text:async()=>text||JSON.stringify(body),headers:{get:()=>null}}};`);
  const exec = (reg, gov) => JSON.parse(require('node:child_process').execFileSync(process.execPath, ['-r', shim, path.join(ROOT, 'scripts', 'tx-freshness.js'), '--dry-run', '--today', '2026-10-19'], { env: { ...process.env, TXF_REG: JSON.stringify(reg), TXF_GOV: JSON.stringify(gov) }, encoding: 'utf8', maxBuffer: 1 << 24 }));
  try {
    const S = EV.store();
    const o = exec({ deals: 3844200, last_deal: S.meta.source.lastDeal, scraped_at: S.meta.source.scrapedAt }, { deals: 2500941, last_deal: '2026-09-28', loaded_at: '2026-10-08T01:50:12.803824+00:00', version: 4 });
    /* the GovMap-layer copy the stored RECENT layer read (lib/recent) is read — listed apart, no lag alert for it */
    assert.equal(o.register.answered, true); assert.equal(o.govmapLayer.readByPropx, true); assert.equal(o.newerCopies[0].readByPropx, true);
    assert.deepEqual(o.officialChannels.map((c) => c.answered), [false, false, false], 'every official channel recorded as not readable — none bypassed');
    assert.equal(o.officialChannels[1].antiBot, 'recaptcha'); assert.equal(o.officialChannels[2].refused, true);
    assert.equal(o.propx.copyLatestDeal, S.meta.source.lastDeal); assert.equal(o.propx.periodsToToday[30].n, null, 'a period after the copy has no count');
    assert.ok(o.propx.countsToCopyEnd[90] > 0); assert.equal(o.lagDays.snapshotAge, 30); assert.equal(o.lagDays.latestTransaction, 32);
    const kinds = o.alerts.filter((a) => !a.informational).map((a) => a.reason || a.kind);
    assert.ok(kinds.includes('copy-age') && !kinds.includes('newer-copy'), 'MATERIAL_LAG for the copy\'s age; the newer copy PROPX reads as its recent layer is no lag alert');
    assert.equal(o.newerCopies[0].daysNewerLatestDeal, 11);
    /* a NEWER GovMap-layer copy than the one the recent layer read: not read yet → MATERIAL_LAG newer-copy */
    const g2 = exec({ deals: 3844200, last_deal: S.meta.source.lastDeal, scraped_at: S.meta.source.scrapedAt }, { deals: 2600000, last_deal: '2026-10-12', loaded_at: '2026-10-18T01:00:00+00:00', version: 5 });
    assert.equal(g2.govmapLayer.readByPropx, false); assert.equal(g2.newerCopies[0].readByPropx, false);
    assert.ok(g2.alerts.some((a) => a.reason === 'newer-copy'), 'a GovMap-layer copy the recent layer has not read is a lag alert');
    const n = exec({ deals: 3900000, last_deal: '2026-10-15', scraped_at: '2026-10-18 09:00:00+00' }, { deals: 1, last_deal: '2026-09-28', loaded_at: '2026-10-08T00:00:00Z' });
    assert.ok(n.alerts.some((a) => a.kind === 'NEW_COPY_NOT_SWEPT'), 'a changed register copy not yet swept is an alert');
    const old = exec({ deals: 3800000, last_deal: '2026-08-30', scraped_at: '2026-09-01 09:00:00+00' }, { deals: 1, last_deal: '2026-08-01', loaded_at: '2026-08-02T00:00:00Z' });
    assert.ok(old.alerts.some((a) => a.kind === 'OLDER_COPY_SERVED'), 'an older copy served is named, never applied');
    assert.equal(old.newerCopies.length, 0, 'an older GovMap copy is not a "newer copy"');
  } finally { try { fs.unlinkSync(shim); } catch { /* gone */ } }
});
t('the monitor workflow runs twice a day (the copies\' versions every three hours: txevents-national.yml), read-only toward the sources and commits only data/transactions/freshness*; the evidence check is daily too', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'tx-freshness.yml'), 'utf8');
  assert.match(wf, /cron: '23 5,17 \* \* \*'/);
  assert.match(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'txevents-national.yml'), 'utf8'), /cron: '23 \*\/3 \* \* \*'/); assert.match(wf, /git add data\/transactions\/freshness\.json data\/transactions\/freshness-runs\.jsonl/);
  const ev = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'street-evidence-sync.yml'), 'utf8');
  assert.match(ev, /cron: '41 3 \* \* \*'/, 'a new register copy is swept the day it appears');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'tx-freshness.js'), 'utf8');
  assert.ok(!/method:\s*'(POST|PUT|DELETE)'/i.test(src), 'GET only'); assert.ok(!/captcha.*solve|bypass\(/i.test(src));
});

/* ── every transaction surface states its freshness ── */
t('USER-FACING: the street page and the transactions section render the freshness strip — latest observed transaction · source checked · source · state · the reporting-lag ⓘ', () => {
  assert.match(page, /\$\{txFreshHTML\(D\.freshness,\{locality:true\}\)\}/, 'Street Intelligence');
  assert.match(page, /el\("txFresh"\)\.innerHTML=viaRepub&&M\.snapshotAt\?`\$\{txFreshHTML\(M\.freshness\)\}/, 'the transactions section');
  for (const k of ['Latest observed transaction', 'Source checked', 'Latest in the locality']) assert.ok(page.includes(`"${k}"`), k);
  assert.match(page, /xpBtn\("transaction_reporting_lag"\)/); assert.match(page, /xpBtn\("transaction_freshness"\)/);
  const R = require('../lib/explain/registry');
  assert.equal(R.level1('transaction_reporting_lag', 'en').short, 'Transactions may appear after the transaction date because real-estate transactions are reported and processed after signing.');
  assert.ok(R.missing('tx_coverage_not_refreshed', 'en') && R.missing('tx_period_not_covered', 'en'));
  for (const st of ['CURRENT', 'RECENT', 'STALE', 'VERY_STALE', 'SOURCE_LAG_UNKNOWN']) assert.ok(new RegExp(`${st}:"`).test(page), 'state label ' + st);
});
t('PERIOD FILTERS: last 30 days · last 90 days (by days) · 6 · 12 · 24 months · all available; the API reads days as days', () => {
  assert.match(page, /const TX_PERIODS=t=>\[\["d30",t\.txP30d\],\["d90",t\.txP90d\],\["m6",t\.txP6\],\["m12",t\.txP12\],\["m24",t\.txP24\],\["m240",t\.txPAll\]\];/);
  assert.match(page, /txP30d:"Last 30 days", txP90d:"Last 90 days"/);
  const prov = fs.readFileSync(path.join(ROOT, 'lib', 'gov', 'providers', 'overDeals.js'), 'utf8');
  assert.match(prov, /const dateFrom = filters\.dateFrom \? String\(filters\.dateFrom\)\.slice\(0, 10\) : days \? new Date\(this\.clock\(\) - days \* 86400e3\)/, 'an explicit lower day (the history pager) first, else days as days');
  assert.match(fs.readFileSync(path.join(ROOT, 'api', 'gov', 'transactions.js'), 'utf8'), /days: num\('days'\) \|\| undefined/);
});
t('REAL DEAL DETAIL on the street page: date · house · rooms · m² · price · ₪/m² · build year · property type · block/parcel/sub · source — "—" when missing, never modelled', () => {
  assert.match(page, /cols:\["Date","House","Rooms","m²","Price","₪ per m²","Built","Property type","Block\/parcel\/sub",""\]/);
  assert.match(page, /<td class="w">\$\{ldE\(d\.nature\|\|"—"\)\}<\/td>/); assert.match(page, /stdeals:"date,text,number,number,currency,currency,number,text,text,-"/);
  assert.match(page, /five\+=`<p class="gv-note">\$\{tf\.source\}: \$\{tf\.srcName\(/, 'the source line under the deal table');
});
t('TRUST: the evidence lane carries the copy\'s state and raises SOURCE_STALE when it is stale; offline re-matches are not "checks"; the monitor is a catalogue source', () => {
  const C = require('../lib/trust/catalog').catalog({ now: Date.parse('2026-10-19T20:00:00Z') });
  const ev = C.sources.find((s) => s.id === 'over:street-evidence');
  assert.ok(ev.freshness && ev.freshness.state); assert.equal(ev.sourceStale, F.isStale(ev.freshness.state));
  assert.notEqual(ev.sync.state, 'FAILED', 'a "rebuilt" (offline, no request) run is not a failed check');
  assert.ok(C.sources.find((s) => s.id === 'propx:tx-freshness'));
  for (const id of ['taxes:nadlan-register', 'nadlan.gov.il:deals', 'govmap:deals-layer', 'datagov:tax-deals', 'over:govmap-layer']) assert.ok(C.sources.find((s) => s.id === 'discovery:' + id), id + ' audited');
  if (ev.sourceStale) assert.ok(C.alerts.some((a) => a.id === 'over:street-evidence' && a.kind === 'SOURCE_STALE'));
});
t('the standalone (offline) build carries the same freshness strip', () => {
  const sa = path.join(ROOT, 'standalone', 'index.html');
  if (!fs.existsSync(sa)) return;
  const s = fs.readFileSync(sa, 'utf8');
  assert.ok(s.includes('function txFreshHTML(') && s.includes('TRANSACTION DATA MAY BE STALE'));
});

(async () => {
  for (const [name, fn] of results) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); }
  }
  console.log(`tx-freshness: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
