'use strict';
/* PROPX · What Changed Here? (lib/changes) — the gates, on the real stored data.
 *
 * The change feed is composed only from stored evidence; every item carries its event date, the date PROPX saw it, its source,
 * its class and its scope; NEW vs NEWLY OBSERVED is decided by a rule (the first ingestion of a source is a baseline); a district
 * series is never labelled as a street's fact; a POSSIBLE DUPLICATE is never counted; an empty kind says NO_CHANGES_IN_PERIOD,
 * NOT_COVERED or SOURCE_STALE — never interchangeably; the API refuses bad input (400) and unknown places (404). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const CH = require('../lib/changes');
const RU = require('../lib/changes/rules');
const X = require('../lib/explain/registry');
const VERBS = require('../lib/radar/verbs');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const TESTS = [];
const t = (name, fn) => TESTS.push([name, fn]);
const at = t;
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const day = (x) => String(x || '').slice(0, 10);
const feed = (q) => { const r = CH.view('changes', q); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
/** every item of a feed, page by page */
const allItems = (q) => { const out = []; let offset = 0; for (;;) { const b = feed({ ...q, limit: '200', offset: String(offset) }); out.push(...b.items); if (!b.more) return out; offset += 200; } };
const STREET = 'st:7900:213';   // הרצל, פתח תקווה

console.log('changes: the geographic change feed');

t('the anchor is the newest PROPX observation in the stored data — the latest check of any source the feed reads, never the wall clock', () => {
  const m = CH.view('changesMeta', {}).body;
  assert.ok(isDay(m.anchor.day), 'anchor day');
  const newest = m.anchor.checks.map((c) => c.at).sort().pop();
  assert.equal(m.anchor.at, new Date(Date.parse(newest)).toISOString());
  assert.equal(m.anchor.day, day(m.anchor.at));
  assert.deepEqual(m.vocabulary.periods, [30, 90, 180, 365]);
  assert.deepEqual(m.vocabulary.kinds.map((k) => k.id), RU.KINDS);
  assert.equal(m.districts.length, 7);
  assert.ok(m.neighbourhoods.length > 0 && m.neighbourhoods.every((n) => /^nb:/.test(n.id) && Number.isFinite(n.localityCode)), 'verified neighbourhoods with their locality');
  const b = feed({ geo: STREET, period: '30' });
  assert.equal(b.period.to, m.anchor.day); assert.equal(b.period.days, 30);
  assert.equal(b.period.from, new Date(Date.parse(m.anchor.day + 'T00:00:00Z') - 30 * 864e5).toISOString().slice(0, 10));
});

t('a street with recent deals (הרצל, פתח תקווה): every item carries eventDate · observedAt · source · class · scope · newness · verb · materiality', () => {
  for (const period of ['30', '90', '365']) {
    const b = feed({ geo: STREET, period });
    assert.equal(b.geo.kind, 'street'); assert.equal(b.geo.locality.code, 7900); assert.equal(b.geo.name.he, 'הרצל');
    const items = allItems({ geo: STREET, period });
    assert.ok(items.length > 0, 'items in ' + period);
    for (const it of items) {
      assert.ok(isDay(it.eventDate), it.id + ' eventDate');
      assert.ok(it.observedAt && Number.isFinite(Date.parse(it.observedAt)), it.id + ' observedAt');
      assert.ok(it.source && it.source.id, it.id + ' source');
      assert.ok(Object.keys(X.CLASSES).includes(it.cls), it.id + ' class ' + it.cls);
      assert.ok(RU.SCOPES.includes(it.scope), it.id + ' scope');
      assert.ok(RU.NEWNESS.includes(it.newness), it.id + ' newness');
      assert.ok(VERBS.ORDER.includes(it.verb), it.id + ' verb ' + it.verb);
      assert.ok([1, 2, 3].includes(it.m), it.id + ' materiality');
      assert.ok(RU.RULES[it.rule] && RU.RULES[it.rule].kind === it.kind, it.id + ' rule');
      assert.ok(it.title && it.title.he && it.title.en, it.id + ' title he/en');
    }
  }
  const b = feed({ geo: STREET, period: '365' });
  assert.ok(b.kinds.TRANSACTION.counts.total >= 20, 'the street\'s deals in a year: ' + b.kinds.TRANSACTION.counts.total);
  const tx = allItems({ geo: STREET, period: '365', kinds: 'TRANSACTION' });
  assert.ok(tx.every((it) => it.scope === 'EXACT_STREET' && it.matchedStreet && it.matchedStreet.id === STREET), 'a street\'s deals are on the street');
  assert.ok(tx.some((it) => it.source.id === 'over:deals-register') && tx.some((it) => it.source.id === 'over:govmap-recent'), 'register deals and recent-layer deals, each labelled by its source');
  assert.ok(tx.filter((it) => it.source.id === 'over:govmap-recent').every((it) => it.values.recentLayer === true && it.values.priceUsed === false), 'a recent-layer deal is separate evidence: its price is never used');
});

t('NEW vs NEWLY OBSERVED on real data: every source\'s FIRST ingestion is the baseline — the register sweep, the GovMap recent layer\'s first read and the GovMap file\'s first build are never "newly observed"', () => {
  for (const period of ['30', '90', '180', '365']) {
    const b = feed({ geo: STREET, period }), P = b.period;
    for (const it of allItems({ geo: STREET, period })) {
      const obs = day(it.observedAt);
      if (it.newness === 'NEW_EVENT') assert.ok(it.eventDate > P.from && it.eventDate <= P.to, it.id + ' NEW_EVENT inside the period');
      if (it.newness === 'NEWLY_OBSERVED_OLDER_EVENT') { assert.ok(it.eventDate <= P.from && obs > P.from && obs <= P.to && !it.baseline, it.id + ' newly observed'); assert.notEqual(it.kind, 'TRANSACTION', 'every deal held now was held since its source\'s first read'); }
      if (it.newness === 'REVISION' || it.newness === 'STATE_CHANGE') assert.ok(obs > P.from && obs <= P.to, it.id + ' observed inside the period');
      if (it.kind === 'TRANSACTION') { assert.equal(it.baseline, true, it.id + ' baseline'); assert.equal(it.observedBasis, 'BASELINE_READ', it.id); }
    }
  }
  /* the GovMap-file deal of 28.10.2025 at הרצל 74: first held in the file's FIRST build (20.10.2026) — the baseline: outside a 90-day period
     (older, and never "newly observed"); inside 365 days it is a NEW_EVENT by its own date */
  const find = (period) => allItems({ geo: STREET, period, kinds: 'TRANSACTION' }).find((it) => it.source.id === 'over:govmap-national' && it.eventDate === '2025-10-28');
  assert.equal(find('90'), undefined, 'an older baseline deal is not a change of a 90-day period');
  const b = find('365');
  assert.ok(b, 'the 2025-10-28 GovMap-file deal on the street'); assert.equal(b.newness, 'NEW_EVENT'); assert.equal(day(b.observedAt), '2026-10-20'); assert.equal(b.observedBasis, 'BASELINE_READ');
  assert.ok(!allItems({ geo: STREET, period: '30' }).some((it) => it.source.id === 'over:deals-register'), 'no register deal in 30 days: the copy ends 2026-09-17 and is the baseline');
});

/* the days of a period the copies cover — the period ends at the newest PROPX check in the data, so it moves with every sync (was a
   literal 7 while the anchor was 21.10.2026; the 22.10.2026 syncs made it 6) */
const coveredTo = (period, through) => Math.max(0, Math.round((Date.parse(through) - Date.parse(period.from)) / 864e5));
t('REGRESSION (QA 22.10.2026) — Haifa / Israel, 30 days: the GovMap rows held since each source\'s first read are the baseline, not 2,131 / 29,079 "newly observed" deals', () => {
  const C = require('../lib/changes/collect');
  const h = feed({ geo: 'loc:4000', period: '30' });
  assert.equal(h.kinds.TRANSACTION.counts.NEWLY_OBSERVED_OLDER_EVENT, 0, 'Haifa: was 2,131 deals dated 2023-09-18…2026-09-02, all from one first read');
  assert.equal(h.kinds.TRANSACTION.counts.total, 0);
  assert.equal(h.kinds.TRANSACTION.statement.code, 'NOT_COVERED', 'the copies reach 2026-09-28: a week of the 30 days — not "no deals"'); assert.equal(h.kinds.TRANSACTION.statement.coveredDays, coveredTo(h.period, '2026-09-28'));
  const il = feed({ geo: 'il', period: '30' });
  const L = require('../lib/txevents').stores().latest.national;
  const exact = Object.entries(L.perDay).reduce((a, [d, v]) => a + (d > il.period.from && d <= il.period.to ? v : 0), 0);
  assert.equal(il.kinds.TRANSACTION.counts.NEWLY_OBSERVED_OLDER_EVENT, 0, 'Israel: was 29,079 of 29,080 transaction changes');
  assert.equal(il.kinds.TRANSACTION.counts.NEW_EVENT, exact, 'the deals dated inside the period — the events index\'s exact per-day tally');
  assert.equal(il.kinds.TRANSACTION.counts.total, exact);
  assert.ok(!allItems({ geo: 'il', period: '30', kinds: 'TRANSACTION' }).some((it) => it.rule === 'chg-tx-batch'), 'no batch of baseline rows');
  /* the coverage says where each source\'s history starts and that its first read is the baseline */
  for (const id of ['over:govmap-recent', 'over:govmap-national']) {
    const part = h.kinds.TRANSACTION.coverage.parts.find((x) => x.id === id);
    assert.ok(part && part.history && /^history starts 2026-10-20/.test(part.history.note.en) && /rows from the first read are the baseline/.test(part.history.note.en), id + ' coverage note');
    assert.match(part.history.note.he, /קו הבסיס/);
  }
  /* the rule itself: a recent-layer row first read in a LATER copy is newly observed; the national file keeps no per-row first read */
  const reads = C.txReads();
  assert.equal(reads.recent.firstRead.at, '2026-10-20T07:58:19.990Z'); assert.equal(reads.national.firstBuild.at, '2026-10-20T14:35:50.691Z');
  const R = (firstReadAt) => C.govmapBaseline({ sourceId: 'over:govmap-recent', firstReadAt }, reads);
  assert.equal(R('2026-10-20T08:00:55.599Z'), true, 'the first read');
  assert.equal(R('2026-11-04T08:00:00.000Z'), false, 'a later copy\'s read');
  assert.equal(R(null), true, 'no first read recorded — never claimed newly observed');
  assert.equal(C.govmapBaseline({ sourceId: 'over:govmap-national' }, reads), true);
  assert.equal(CH.newnessOf({ mode: 'DATED', eventDate: '2025-03-01', observedAt: '2026-11-04T08:00:00Z', baseline: !R('2026-11-04T08:00:00Z') ? false : true }, '2026-10-21', '2026-11-20'), 'NEWLY_OBSERVED_OLDER_EVENT');
});

t('NEW vs NEWLY OBSERVED — the rule on a constructed fixture (period (2026-09-21, 2026-10-21])', () => {
  const from = '2026-09-21', A = '2026-10-21';
  const it = (o) => Object.assign({ mode: 'DATED', baseline: false }, o);
  assert.equal(CH.newnessOf(it({ eventDate: '2026-10-01', observedAt: '2026-10-19T10:00:00Z', baseline: true }), from, A), 'NEW_EVENT', 'a baseline deal dated inside the period is new');
  assert.equal(CH.newnessOf(it({ eventDate: '2026-09-22', observedAt: '2026-10-20T08:00:00Z' }), from, A), 'NEW_EVENT');
  assert.equal(CH.newnessOf(it({ eventDate: '2025-03-01', observedAt: '2026-10-20T08:00:00Z' }), from, A), 'NEWLY_OBSERVED_OLDER_EVENT', 'an older deal first read in a newer copy');
  assert.equal(CH.newnessOf(it({ eventDate: '2026-09-21', observedAt: '2026-10-20T08:00:00Z' }), from, A), 'NEWLY_OBSERVED_OLDER_EVENT', 'the period start is exclusive');
  assert.equal(CH.newnessOf(it({ eventDate: '2025-03-01', observedAt: '2026-10-19T10:00:00Z', baseline: true }), from, A), null, 'the first ingestion is never "newly observed"');
  assert.equal(CH.newnessOf(it({ eventDate: '2025-03-01', observedAt: '2026-09-01T10:00:00Z' }), from, A), null, 'older, observed before the period');
  assert.equal(CH.newnessOf(it({ eventDate: '2026-11-02', observedAt: '2026-10-20T08:00:00Z' }), from, A), null, 'a future-dated record is not an event');
  assert.equal(CH.newnessOf({ mode: 'STATE_CHANGE', eventDate: '2026-08-03', observedAt: '2026-10-19T08:52:48Z' }, from, A), 'STATE_CHANGE', 'a change seen inside the period, whatever the source date');
  assert.equal(CH.newnessOf({ mode: 'STATE_CHANGE', eventDate: '2026-10-01', observedAt: '2026-09-02T08:00:00Z' }, from, A), null);
  assert.equal(CH.newnessOf({ mode: 'REVISION', eventDate: '2026-10-07', observedAt: '2026-10-14T17:23:32Z' }, from, A), 'REVISION');
  assert.equal(CH.newnessOf({ mode: 'REVISION', eventDate: '2026-10-07', observedAt: '2026-10-22T00:00:01Z' }, from, A), null, 'after the anchor');
});

t('no district or national figure is labelled as the street\'s own: CBS series are DISTRICT_CONTEXT, source states NATIONAL_CONTEXT; only street-keyed records are EXACT_STREET', () => {
  const items = allItems({ geo: STREET, period: '365' });
  for (const it of items) {
    if (['SALES', 'SOURCE_REVISION'].includes(it.kind) || it.rule === 'chg-cbs-construction-period') assert.equal(it.scope, 'DISTRICT_CONTEXT', it.id);
    if (it.kind === 'SOURCE_STATE') assert.equal(it.scope, 'NATIONAL_CONTEXT', it.id);
    if (it.scope === 'EXACT_STREET' || it.scope === 'NEAR_STREET') { assert.ok(['TRANSACTION', 'PLANNING', 'LAND_TENDER', 'URBAN_RENEWAL', 'RENTAL', 'CONSTRUCTION'].includes(it.kind), it.id); assert.ok(it.matchedStreet && it.matchedStreet.id === STREET, it.id + ' names the street'); }
    if (it.scope === 'NEAR_STREET') assert.ok(Number.isFinite(it.distanceM) && it.distanceM >= 0 && it.distanceM <= 1000, it.id + ' near = a distance');
    if (it.kind === 'HOUSING') assert.equal(it.scope, 'LOCALITY', 'a lottery has no address — locality context only');
  }
  assert.ok(items.some((it) => it.scope === 'DISTRICT_CONTEXT') && items.some((it) => it.scope === 'NEAR_STREET'), 'both context and near-street items exist');
  const loc = allItems({ geo: 'loc:7900', period: '365' });
  assert.ok(!loc.some((it) => it.scope === 'EXACT_STREET' || it.scope === 'NEAR_STREET'), 'a locality feed has no street scope');
  assert.ok(loc.filter((it) => it.kind === 'SALES').every((it) => it.scope === 'DISTRICT_CONTEXT' && /not this place/.test(it.detail.en)), 'a locality reads its district series as context, said so');
  const dist = allItems({ geo: 'd-center', period: '365', kinds: 'SALES,SOURCE_REVISION' });
  assert.ok(dist.length && dist.every((it) => it.scope === 'DISTRICT'), 'the district\'s own series is DISTRICT');
  const il = allItems({ geo: 'il', period: '90', kinds: 'SALES' });
  assert.ok(il.length && il.every((it) => it.scope === 'NATIONAL'));
});

t('POSSIBLE_DUPLICATE is never counted: the feed\'s transaction count equals the transaction events union\'s own count (possible duplicates excluded) — Tel Aviv-Yafo, 365 days', () => {
  const TX = require('../lib/txevents');
  const b = feed({ geo: 'loc:5000', period: '365' });
  const q = TX.query({ code: 5000, days: 365, today: b.anchor.day });
  assert.ok(q.counts.possibleDuplicates > 0, 'the union holds possible duplicates here');
  assert.equal(b.kinds.TRANSACTION.counts.NEW_EVENT, q.counts.events, 'NEW_EVENT = the union\'s counted events of the period');
  assert.equal(b.counts.possibleDuplicatesExcluded, q.counts.possibleDuplicates, 'and the excluded count is stated');
  const tx = allItems({ geo: 'loc:5000', period: '365', kinds: 'TRANSACTION' });
  assert.ok(!tx.some((it) => it.values && it.values.state === 'POSSIBLE_DUPLICATE'));
  assert.equal(tx.reduce((a, it) => a + it.n, 0), b.kinds.TRANSACTION.counts.total);
});

t('a large city responds within ~1.5 s after warm-up (Tel Aviv-Yafo 5000, Jerusalem 3000), and from the memo after that', () => {
  feed({ geo: 'il', period: '90' }); feed({ geo: 'd-ta', period: '90' });   /* warm the shared stores */
  for (const g of ['loc:5000', 'loc:3000']) {
    let t0 = Date.now(); const b = feed({ geo: g, period: '365' }); const first = Date.now() - t0;
    t0 = Date.now(); feed({ geo: g, period: '30', kinds: 'TRANSACTION' }); const again = Date.now() - t0;
    assert.ok(first < 1500, `${g} first read ${first} ms`); assert.ok(again < 300, `${g} memoised ${again} ms`);
    assert.ok(b.kinds.TRANSACTION.counts.total > 1000 && b.kinds.PLANNING.counts.total > 0 && b.kinds.LAND_TENDER.counts.total > 0, g + ' has changes of several kinds');
  }
});

t('a district: transactions are the events index\'s exact per-day count, the list its newest events (truncation stated); the GovMap rows the register copy does not hold are batched per locality', () => {
  const b = feed({ geo: 'd-center', period: '90' });
  const L = require('../lib/txevents').stores().latest.districts['d-center'];
  const exact = Object.entries(L.perDay).reduce((a, [d, v]) => a + (d > b.period.from && d <= b.period.to ? v : 0), 0);
  assert.equal(b.kinds.TRANSACTION.counts.NEW_EVENT, exact);
  assert.equal(b.kinds.TRANSACTION.listing.exact, exact); assert.equal(b.kinds.TRANSACTION.listing.truncated, b.kinds.TRANSACTION.listing.listed < exact);
  const batches = allItems({ geo: 'd-center', period: '90', newness: 'NEWLY_OBSERVED_OLDER_EVENT', kinds: 'TRANSACTION' });
  assert.ok(batches.every((it) => it.rule === 'chg-tx-batch' && it.n > 0 && it.scope === 'LOCALITY' && it.eventDateRange.to <= b.period.from), 'a batch = older deals first held in a later read, one per locality, source and read');
  assert.equal(batches.reduce((a, it) => a + it.n, 0), b.kinds.TRANSACTION.counts.NEWLY_OBSERVED_OLDER_EVENT);
  assert.equal(b.kinds.TRANSACTION.counts.NEWLY_OBSERVED_OLDER_EVENT, 0, 'every GovMap row held now comes from its source\'s first read — the baseline');
  /* a batch from a constructed later read: only the rows dated before the period count, and only when read inside it */
  const B = [{ code: 4000, name: { he: 'חיפה', en: 'Haifa' }, sourceId: 'over:govmap-recent', dates: ['2025-01-02', '2025-05-06', '2026-11-01'], observedAt: '2026-11-04T08:00:00Z', copyDate: '2026-11-01' }];
  const bi = require('../lib/changes/collect').batchItems(B, '2026-10-21', '2026-11-20');
  assert.equal(bi.length, 1); assert.equal(bi[0].n, 2); assert.deepEqual(bi[0].eventDateRange, { from: '2025-01-02', to: '2025-05-06' });
  assert.equal(require('../lib/changes/collect').batchItems(B, '2026-11-05', '2026-11-20').length, 0, 'read before the period');
  const items = allItems({ geo: 'd-center', period: '90' });
  assert.ok(items.every((it) => ['LOCALITY', 'DISTRICT', 'NATIONAL_CONTEXT'].includes(it.scope)), 'a district reads localities, its own series and national context');
});

t('batch=1 folds a locality\'s older newly observed deals into one row per copy read — the counts do not move (real data + a constructed later read)', () => {
  const plain = feed({ geo: 'loc:5000', period: '365' }), batched = feed({ geo: 'loc:5000', period: '365', batch: '1' });
  assert.deepEqual(batched.kinds.TRANSACTION.counts, plain.kinds.TRANSACTION.counts);
  assert.equal(batched.total, plain.total, 'nothing to fold: no deal was first held in a later read');
  const it = (id, src, d, obs) => ({ id, kind: 'TRANSACTION', newness: 'NEWLY_OBSERVED_OLDER_EVENT', rule: 'chg-tx-govmap-recent', n: 1, eventDate: d, observedAt: obs, scope: 'LOCALITY', m: 2, source: { id: src, label: { he: 'א', en: 'a' } }, values: {} });
  const xs = [it('a', 'over:govmap-recent', '2025-02-01', '2026-11-04T08:00:00Z'), it('b', 'over:govmap-recent', '2024-07-01', '2026-11-04T09:00:00Z'), it('c', 'over:govmap-recent', '2025-09-01', '2026-11-11T08:00:00Z'),
    { ...it('d', 'over:deals-register', '2026-10-30', '2026-10-30T08:00:00Z'), newness: 'NEW_EVENT' }];
  const out = CH.batchOlder(xs, { id: 'loc:5000' });
  const rows = out.filter((x) => x.rule === 'chg-tx-batch');
  assert.equal(rows.length, 2, 'one row per source copy read (day)'); assert.equal(rows.reduce((a, x) => a + x.n, 0), 3);
  const r4 = rows.find((x) => x.n === 2); assert.deepEqual(r4.eventDateRange, { from: '2024-07-01', to: '2025-02-01' }); assert.equal(r4.link.type, 'expand'); assert.equal(r4.values.expand.source, 'over:govmap-recent');
  assert.ok(out.some((x) => x.id === 'd'), 'a NEW_EVENT is never folded');
});

t('statements are never interchangeable — the rule (fixture): CHANGES · NO_CHANGES_IN_PERIOD · NOT_COVERED (scope, coverage, half the period) · SOURCE_STALE', () => {
  const P = { days: 30, from: '2026-09-21', to: '2026-10-21' };
  assert.equal(CH.statementOf(3, { state: 'COVERED' }, P).code, 'CHANGES');
  assert.equal(CH.statementOf(0, { state: 'COVERED', coveredThrough: '2026-10-21' }, P).code, 'NO_CHANGES_IN_PERIOD');
  const half = CH.statementOf(0, { state: 'COVERED', coveredThrough: '2026-09-28' }, P);
  assert.equal(half.code, 'NOT_COVERED'); assert.equal(half.coveredDays, 7); assert.match(half.reason.en, /7 of the period's 30 days/);
  assert.equal(CH.statementOf(0, { state: 'COVERED', coveredFrom: '2026-10-14' }, P).code, 'NOT_COVERED', 'history kept for 7 of 30 days');
  assert.equal(CH.statementOf(0, { state: 'STALE', reason: { he: 'א', en: 'a' } }, P).code, 'SOURCE_STALE');
  for (const s of ['NOT_APPLICABLE', 'NOT_IN_COVERAGE', 'SNAPSHOT_ONLY']) assert.equal(CH.statementOf(0, { state: s }, P).code, 'NOT_COVERED', s);
  assert.equal(CH.statementOf(0, { state: 'COVERED' }, P, false, ['DISTRICT_CONTEXT']).code, 'NOT_COVERED', 'a scope the kind never reaches');
  assert.equal(CH.statementOf(0, { state: 'STALE' }, P, false, ['LOCALITY']).code, 'NOT_COVERED');
  for (const [k, v] of Object.entries(RU.STATEMENTS)) assert.ok(v.he && v.en, k);
});

t('statements on real data: housing lotteries are SOURCE_STALE (the dataset\'s newest lottery 2025-01-27); a street\'s lotteries are NOT_COVERED; a covered empty kind says NO_CHANGES_IN_PERIOD; a 30-day period the transaction copies reach for 7 days is NOT_COVERED', () => {
  const j = feed({ geo: 'loc:3000', period: '365' });
  assert.equal(j.kinds.HOUSING.coverage.state, 'STALE'); assert.equal(j.kinds.HOUSING.statement.code, 'SOURCE_STALE'); assert.match(j.kinds.HOUSING.statement.reason.en, /2025-01-27/);
  const s = feed({ geo: STREET, period: '90', scope: 'EXACT_STREET,NEAR_STREET' });
  assert.equal(s.kinds.HOUSING.statement.code, 'NOT_COVERED'); assert.match(s.kinds.HOUSING.statement.reason.en, /never placed on a street/);
  assert.equal(s.kinds.RENTAL.statement.code, 'NO_CHANGES_IN_PERIOD'); assert.equal(s.kinds.RENTAL.counts.total, 0);
  assert.equal(s.kinds.SALES.statement.code, 'NOT_COVERED', 'the district series is context — not the street\'s scope'); assert.match(s.kinds.SALES.statement.reason.en, /District context/);
  assert.equal(s.kinds.TRANSACTION.statement.code, 'CHANGES');
  /* תירוש (10): swept, no GovMap-layer row — 30 days: the copies reach 2026-09-28 → 7 of 30 days → NOT_COVERED, never "no deals" */
  const tz = feed({ geo: 'loc:10', period: '30' });
  assert.equal(tz.kinds.TRANSACTION.counts.total, 0); assert.equal(tz.kinds.TRANSACTION.statement.code, 'NOT_COVERED'); assert.equal(tz.kinds.TRANSACTION.statement.coveredDays, coveredTo(tz.period, '2026-09-28'));
  for (const k of RU.KINDS) assert.ok(['CHANGES', 'NO_CHANGES_IN_PERIOD', 'NOT_COVERED', 'SOURCE_STALE'].includes(tz.kinds[k].statement.code), k);
  for (const k of RU.KINDS) assert.ok(RU.COVERAGE.includes(tz.kinds[k].coverage.state), k + ' coverage state');
});

t('a verified neighbourhood: its streets are the verified links resolved in the locality; every street-scoped item names one of them', () => {
  const b = feed({ geo: 'nb:old-north', period: '365' });
  assert.equal(b.geo.kind, 'neighbourhood'); assert.equal(b.geo.verified, true); assert.equal(b.geo.locality.code, 5000);
  const ids = new Set(b.geo.streets.map((s) => s.id));
  assert.ok(ids.size >= 2);
  for (const it of allItems({ geo: 'nb:old-north', period: '365' })) if (it.scope === 'EXACT_STREET' || it.scope === 'NEAR_STREET') assert.ok(ids.has(it.matchedStreet.id), it.id);
  assert.equal(CH.view('changes', { geo: 'nb:no-such-place' }).status, 404);
});

at('the API: GET /api/intel?view=changes… — 200, 400 for bad input, 404 for an unknown place or view', async () => {
  const h = require('../api/intel');
  const call = (q) => new Promise((ok) => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { ok({ status: this.statusCode, body: JSON.parse(b) }); } }; h({ method: 'GET', url: '/api/intel?' + new URLSearchParams(q) }, res); });
  const ok = await call({ view: 'changes', geo: STREET, period: '90' });
  assert.equal(ok.status, 200); assert.equal(ok.body.geo.id, STREET);
  assert.equal((await call({ view: 'changes' })).body.geo.id, 'il', 'no geography = Israel');
  assert.equal((await call({ view: 'changes', city: '5000', period: '30' })).body.geo.id, 'loc:5000', 'city= alias');
  assert.equal((await call({ view: 'changesMeta' })).status, 200);
  const bad = [{ period: '45' }, { period: '30d' }, { geo: 'tel aviv' }, { geo: 'st:7900' }, { geo: "loc:1'; drop" }, { kinds: 'TRANSACTION,NOPE' }, { kinds: ',' }, { newness: 'NEW' }, { scope: 'STREET' }, { limit: '0' }, { limit: '500' }, { offset: '-1' }, { batch: '2' }, { source: 'Over Deals' }];
  for (const q of bad) { const r = await call({ view: 'changes', geo: STREET, ...q }); assert.equal(r.status, 400, JSON.stringify(q) + ' → ' + r.status); assert.ok(r.body.error, 'an error code'); }
  for (const g of ['st:7900:999999', 'loc:999999', 'd-nowhere', 'nb:nowhere', 'st:5000:9000']) { const r = await call({ view: 'changes', geo: g }); assert.equal(r.status, 404, g + ' → ' + r.status); }
  assert.equal((await call({ view: 'changesNope' })).status, 404);
});

t('the registry: every rule has a "why am I seeing this?" entry; every term the feed names exists with both languages, a plain-language sentence and a worked example', () => {
  const isBi = (v, w) => { assert.ok(v && typeof v.he === 'string' && typeof v.en === 'string' && v.he.trim() && v.en.trim(), w); assert.ok(/[֐-׿]/.test(v.he), w + ' he'); assert.ok(!/[֐-׿]/.test(v.en), w + ' en'); };
  for (const id of Object.keys(RU.RULES)) { const r = X.SIGNAL_RULES[id]; assert.ok(r, 'rule ' + id); assert.ok(X.term(r.term), id + ' → ' + r.term); isBi(r.rule, id); }
  const b = feed({ geo: STREET, period: '30' });
  for (const id of b.terms) { const T = X.term(id); assert.ok(T, id); assert.equal(T.group, 'changes'); isBi(T.simple, id + '.simple'); isBi(T.example, id + '.example'); isBi(T.short, id + '.short'); for (const s of T.source.ids) assert.ok(X.canonicalSource(s), id + ' source ' + s); }
  for (const id of ['changes_not_covered', 'changes_source_stale', 'changes_snapshot_only', 'changes_not_applicable', 'changes_not_in_coverage']) assert.ok(X.missing(id, 'en'), id);
  const S = X.section('changes', 'en'); assert.ok(S && S.what && S.read.length >= 3);
});

t('the page: the section is live-only, the street report and the dossier link to it, the module renders through the registry and the page\'s own search — no other host', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), ui = fs.readFileSync(path.join(ROOT, 'lib/changes/ui.js'), 'utf8');
  assert.match(page, /<!-- live:begin --><!-- What Changed Here\? — lib\/changes \(read model \+ UI\) -->\s*<section class="blk" id="changes">/);
  assert.match(page, /data-chgeo="\$\{ldE\(R\.id\)\}"/, 'the street report link');
  assert.match(page, /data-chgeo="\$\{ldE\(D\.geo\.level==="district"\?D\.geo\.code:"loc:"\+D\.geo\.code\)\}"/, 'the dossier link');
  assert.ok(!/https?:\/\//.test(ui.replace(/\/\*[\s\S]*?\*\//g, '')), 'no external host in the module');
  assert.match(ui, /\/api\/intel\?/); assert.match(ui, /\/api\/geo\/search\?/); assert.match(ui, /propx:geo/); assert.match(ui, /propx:lang/);
  assert.match(ui, /role="combobox"/); assert.match(ui, /aria-pressed/); assert.match(ui, /xpSig/); assert.match(ui, /data-xpsec="changes"/);
  for (const k of ['NEW_EVENT', 'NEWLY_OBSERVED_OLDER_EVENT', 'REVISION', 'STATE_CHANGE']) assert.ok(ui.includes(k), k);
  const sa = path.join(ROOT, 'standalone', 'israel-new-homes-v2.html');
  if (fs.existsSync(sa)) { const s = fs.readFileSync(sa, 'utf8'); assert.ok(!/id="chRoot"/.test(s) && !/lib\/changes\/ui\.js/.test(s), 'the offline build carries no change feed'); }
});

t('the page module (QA 22.10.2026): words before the vocabulary is read, focus kept across re-renders, no read until the section is on screen, the 500 body generic', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'lib/changes/ui.js'), 'utf8');
  /* the chips' words before the first read = the rules' own labels (never the raw kind / newness code) */
  const L0 = JSON.parse(ui.match(/var LABEL0 = (\{.*\});/)[1]);
  assert.deepEqual(L0.kinds, JSON.parse(JSON.stringify(RU.KIND_LABEL))); assert.deepEqual(L0.newness, JSON.parse(JSON.stringify(RU.NEWNESS_LABEL)));
  assert.match(ui, /esc\(K && K\[k\] \? pick\(K\[k\]\.label\) : vocab\('kinds', k\)\)/, 'a kind chip never prints its code');
  /* focus: the focused control is found again by its data attribute; the filters come before the geography bar, so Tab goes on from a chip to the picker */
  assert.match(ui, /var a = document\.activeElement, key = focusKey\(a\)/); assert.match(ui, /f\.focus\(\{ preventScroll: true \}\)/);
  assert.match(ui, /'<div class="card ch-card">' \+ chips\(\) \+ picker\(\) \+ body/);
  /* the first read: the section itself on screen for a moment (threshold > 0), the rail / launchpad, a link — a geography the page opens off screen is remembered, not read */
  assert.match(ui, /threshold: \[0\.01\]/); assert.ok(!/rootMargin: '600px/.test(ui), 'no read because the section is near');
  assert.match(ui, /if \(opts\.follow && !opts\.scroll && !onScreen\(\)\) \{[^}]*ST\.pending = true/);
  assert.match(ui, /a\.ri\[data-sec="changes"\],\[data-lp="changes"\]/);
  /* never a raw geography id as a name; codes only in data attributes */
  assert.match(ui, /var name = G \? pick\(G\.name\) : geoFallback\(\);/);
  assert.match(ui, /data-promo="/); assert.ok(!/title="' \+ esc\(v\.promotionState\)/.test(ui) && !/title="' \+ esc\(it\.verb/.test(ui), 'no code in a tooltip');
  /* hardening: an internal failure answers a generic body; the detail goes to the server log */
  const ce = console.error, logged = []; console.error = (...a) => logged.push(a);
  let r; try { r = CH.view('changes', { get geo() { throw new Error('secret detail /home/x'); } }); } finally { console.error = ce; }
  assert.equal(r.status, 500); assert.deepEqual(r.body, { error: 'changes-failed' });
  assert.ok(logged.length === 1 && /secret detail/.test(String(logged[0][1] && logged[0][1].message)), 'the detail went to the server log');
});

(async () => {
  for (const [name, fn] of TESTS) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); }
  }
  console.log(`changes: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
