// PROPX · transaction freshness — the ONE contract for how fresh the transaction universe is (P0 audit, 19.10.2026).
//
// Five dates are kept apart and never collapsed into one "updated":
//   transaction_date        the deal's own date, as the source prints it
//   source_snapshot_date    when the copy PROPX reads was taken from the register (over.org.il `scraped_at`)
//   source_publication_date when the source published the deal — no channel PROPX reads states it (null + reason)
//   propx_ingested_at       when PROPX stored the row (the locality shard's `fetchedAt`)
//   propx_checked_at        when PROPX last asked the source whether a newer copy exists (a run that reached it)
//
// FRESHNESS STATE — of the copy, by its age (today − source_snapshot_date). The thresholds come from the source's measured
// behaviour, not from a guess (lib/trust/discovery/2026-10-19-transactions.json):
//   · the register fills slowly: the copy of 19.09.2026 held ≈ 13 % of August 2026's dwelling deals and ≈ 41 % of July's
//     (national monthly volume ≈ 7,500); deals reach the register weeks to months after signing;
//   · a copy 19 days newer (the GovMap-layer copy of 08.10.2026) held 2,342 more July–September 2026 deals in the eight largest
//     cities — ≈ 123 late-reported deals a day there, ≈ 1.4 % of those cities' final 90-day volume per day of copy age.
//   So a copy's age converts into the share of the latest 90 days it cannot contain:
//     CURRENT     ≤ 7 days  (< 10 % of the latest 90 days missing for copy age; one weekly publisher cycle)
//     RECENT      ≤ 21 days (< 30 %)
//     STALE       ≤ 45 days (< 65 %)
//     VERY_STALE  > 45 days (most of the latest 90 days absent)
//     SOURCE_LAG_UNKNOWN  the copy states no snapshot date, or PROPX has not reached the source for 8 days (it cannot say
//                         whether a newer copy exists)
//   On top of the copy's age the register's own reporting lag always thins the most recent weeks — that is LAG, stated beside
//   every recent count, never a state of its own.
//
// "NO RECENT TRANSACTIONS" (a street / locality with nothing in a recent period) is said ONLY when the copy is CURRENT or
// RECENT, PROPX reached the source within 8 days, and the copy covers at least half of the period (the copy's latest deal is
// at least half a period after its start). Otherwise the period's emptiness says nothing about the market: "Recent transaction coverage has not been refreshed."
// A stale source is never zero transactions — a period the copy does not cover has no count ("—"), never 0.

'use strict';

const DAY = 864e5;
const STATES = ['CURRENT', 'RECENT', 'STALE', 'VERY_STALE', 'SOURCE_LAG_UNKNOWN'];
const THRESHOLDS = { CURRENT: 7, RECENT: 21, STALE: 45 };      // days of copy age (inclusive upper bounds)
const CHECK_MAX_DAYS = 8;                                         // a check older than this: SOURCE_LAG_UNKNOWN
const PERIODS = [7, 30, 60, 90, 180, 365];
const BASIS = {
  measuredOn: '2026-10-19',
  registerFill: { copy: '2026-09-19', july2026Share: 0.41, august2026Share: 0.13, nationalMonthlyDwellings: 7500 },
  lateIntake: { newerCopy: 'govmap-layer 2026-10-08', olderCopy: 'register 2026-09-19', cities: 8, extraJulSepDeals: 2342, days: 19, perDay: 123, shareOf90DaysPerDay: 0.014 },
  source: 'lib/trust/discovery/2026-10-19-transactions.json',
};

/** a timestamp as the sources print it ("2026-09-19 11:07:39.013275+00", ISO, a date) → epoch ms, or null */
function ts(v) {
  if (v == null || v === '') return null;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(' ', 'T');
  if (/T\d/.test(s)) s = s.replace(/([+-]\d{2})$/, '$1:00');           // "+00" → "+00:00" (a time part only — never a date's "-19")
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
const isoDay = (t) => (t == null ? null : new Date(t).toISOString().slice(0, 10));
const dayStart = (v) => { const t = ts(v); return t == null ? null : Date.parse(isoDay(t) + 'T00:00:00Z'); };
/** whole days from a to b (calendar days, UTC) */
const daysBetween = (a, b) => { const x = dayStart(a), y = dayStart(b); return x == null || y == null ? null : Math.round((y - x) / DAY); };

/** the state of a copy: {state, ageDays, checkAgeDays, reason} */
function stateOf({ snapshotAt, checkedAt, today }) {
  const ageDays = daysBetween(snapshotAt, today);
  const checkAgeDays = daysBetween(checkedAt, today);
  if (ageDays == null) return { state: 'SOURCE_LAG_UNKNOWN', ageDays: null, checkAgeDays, reason: 'the copy states no snapshot date' };
  if (checkAgeDays == null || checkAgeDays > CHECK_MAX_DAYS) return { state: 'SOURCE_LAG_UNKNOWN', ageDays, checkAgeDays, reason: `PROPX has not reached the source for more than ${CHECK_MAX_DAYS} days — a newer copy may exist` };
  const state = ageDays <= THRESHOLDS.CURRENT ? 'CURRENT' : ageDays <= THRESHOLDS.RECENT ? 'RECENT' : ageDays <= THRESHOLDS.STALE ? 'STALE' : 'VERY_STALE';
  return { state, ageDays, checkAgeDays, reason: null };
}
const isStale = (state) => state === 'STALE' || state === 'VERY_STALE' || state === 'SOURCE_LAG_UNKNOWN';

/** the last k days before `ref` (inclusive of ref): (ref − k, ref] */
const after = (ref, k) => isoDay(dayStart(ref) - k * DAY);

/**
 * Counts of a list of transaction dates over the standard periods, relative to `today` — with each period's coverage by
 * the copy: a period that ends after the copy's latest deal is PARTLY uncovered and says so; one that starts after it is
 * NOT COVERED and has no count (null), never 0.
 */
function periods(dates, { today, lastDeal }) {
  const out = {};
  for (const k of PERIODS) {
    const from = after(today, k);
    const covered = lastDeal ? Math.max(0, Math.min(k, daysBetween(from, lastDeal))) : null;
    const n = dates.filter((d) => d && d > from && d <= today).length;
    out[k] = covered === 0 ? { n: null, coveredDays: 0, coverage: 'NOT_COVERED' }
      : { n, coveredDays: covered, coverage: covered == null ? 'UNKNOWN' : covered >= k ? 'COVERED' : 'PARTLY_COVERED' };
  }
  return out;
}

/**
 * What an empty / non-empty recent period means.
 *   HAS_TRANSACTIONS · NO_RECENT_TRANSACTIONS (only: copy CURRENT / RECENT, checked ≤ 8 days, the period starts before the
 *   copy's latest deal) · COVERAGE_NOT_REFRESHED (every other empty period)
 */
function recent({ n, periodDays, today, lastDeal, state }) {
  if (n != null && n > 0) return { kind: 'HAS_TRANSACTIONS' };
  /* the copy must cover at least half the period: an empty fortnight after the copy's end is not a quiet market */
  const startsInside = lastDeal ? daysBetween(after(today, periodDays), lastDeal) >= periodDays / 2 : false;
  if ((state === 'CURRENT' || state === 'RECENT') && startsInside) return { kind: 'NO_RECENT_TRANSACTIONS' };
  return { kind: 'COVERAGE_NOT_REFRESHED', reason: !lastDeal ? 'the copy states no latest deal' : !startsInside ? `the copy (latest deal ${lastDeal}) covers less than half of the period` : `the transaction copy is ${state}` };
}

/** the freshness contract of one stored deal — every date apart */
function contract(deal, { snapshotAt, ingestedAt, checkedAt, sourceId, sourceClass }) {
  return {
    transaction_date: deal && deal.date ? String(deal.date).slice(0, 10) : null,
    source_snapshot_date: snapshotAt || null,
    source_publication_date: null,
    source_publication_reason: 'no channel PROPX reads states when a deal was published in the register',
    propx_ingested_at: ingestedAt || null,
    propx_checked_at: checkedAt || null,
    source_id: sourceId || null,
    source_class: sourceClass || null,
    match_state: deal && deal.match ? deal.match : null,
  };
}

/* ── the stored street-evidence copy ── */

/** the latest run that reached the register (a run with requests) — the PROPX check date */
function lastCheckOf(runs) {
  const r = (runs || []).filter((x) => x && Number(x.requests) > 0 && x.status !== 'failed').map((x) => x.finishedAt || x.startedAt).filter(Boolean).sort();
  return r.length ? r[r.length - 1] : null;
}

/**
 * The freshness block of the stored transaction universe (street evidence): the source, its five dates, the state, the
 * reporting-lag note and — from the daily monitor (data/transactions/freshness.json) — a newer copy elsewhere, if any.
 */
function evidenceFreshness({ meta, runs, monitor, today }) {
  const src = (meta && meta.source) || {};
  const day = today || isoDay(Date.now());
  const runCheck = lastCheckOf(runs);
  const monCheck = monitor && monitor.register && monitor.register.answered ? monitor.checkedAt : null;
  const checkedAt = [runCheck, monCheck].filter(Boolean).sort().pop() || null;
  const st = stateOf({ snapshotAt: src.scrapedAt, checkedAt, today: day });
  const newer = monitor && monitor.newerCopies ? monitor.newerCopies : [];
  return {
    sourceId: 'over:deals-register', sourceClass: 'REPUBLISHED · Tax Authority register (independent republication, over.org.il)',
    registerUrl: src.registerUrl || null, datasetId: src.datasetId || null,
    snapshotAt: src.scrapedAt || null, snapshotDate: isoDay(ts(src.scrapedAt)), latestTransactionDate: src.lastDeal || null,
    checkedAt, publicationDate: null, publicationNote: 'the register does not state when a deal was published',
    state: st.state, ageDays: st.ageDays, checkAgeDays: st.checkAgeDays, stateReason: st.reason, stale: isStale(st.state),
    lagDaysLatestDeal: daysBetween(src.lastDeal, day),
    thresholds: THRESHOLDS, checkMaxDays: CHECK_MAX_DAYS, basis: BASIS,
    reportingLag: 'Deals reach the register weeks to months after signing: the most recent weeks are always thin, whatever the copy\'s age.',
    newerCopies: newer,
    today: day,
  };
}

/* ── the stored universe, read from disk (the API's view): memoised for a minute — the files change once a day ── */
let MEMO = null;
function fromDisk({ evidenceDir, transactionsDir, today } = {}) {
  const fs = require('fs'), path = require('path');
  const root = path.join(__dirname, '..', '..');
  const ev = evidenceDir || path.join(root, 'data', 'streets', 'evidence');
  const tx = transactionsDir || path.join(root, 'data', 'transactions');
  const day = today || isoDay(Date.now());
  const key = `${ev}|${tx}|${day}`;
  if (MEMO && MEMO.key === key && Date.now() - MEMO.at < 60e3) return MEMO.value;
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const runs = (() => { try { return fs.readFileSync(path.join(ev, 'sync-runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } })();
  const meta = readJson(path.join(ev, 'meta.json'));
  const value = meta && meta.source ? evidenceFreshness({ meta, runs, monitor: readJson(path.join(tx, 'freshness.json')), today: day }) : null;
  /* a newer copy PROPX now reads as its separate recent layer (lib/recent/read.js — the same copy, reconciled against this register
     copy) is no longer "not read": its deals are listed apart, never in the register figures */
  if (value && !evidenceDir) value.newerCopies = value.newerCopies.map((n) => (n.id === 'over:govmap-layer' && require('../recent/read').readsCopy(n.snapshotAt)
    ? { ...n, readByPropx: true, readAs: 'recent-layer', why: 'read as a separate recent layer: its deals the register copy does not hold yet are listed apart (lib/recent)' } : n));
  MEMO = { key, at: Date.now(), value };
  return value;
}

/**
 * The freshness of one scope (a street, a locality, a query): the universe's block + the scope's own latest observed
 * transaction, its counts per period with the copy's coverage, and what an empty recent period means.
 */
function scope(base, dates, extra = {}) {
  if (!base) return null;
  const ds = (dates || []).filter(Boolean).map((d) => String(d).slice(0, 10));
  const latest = ds.reduce((m, d) => (d > m ? d : m), '') || null;
  const per = periods(ds, { today: base.today, lastDeal: base.latestTransactionDate });
  const meaning = Object.fromEntries([30, 90].map((k) => [k, recent({ n: per[k].n, periodDays: k, today: base.today, lastDeal: base.latestTransactionDate, state: base.state })]));
  return { ...base, latestObservedTransaction: latest, periods: per, recent: meaning, ...extra };
}

/**
 * The freshness of a LIVE read of the register copy (GET /api/gov/transactions): the copy's dates as the source stated them on
 * this request, the state, the newest row returned and what an empty recent period means. Rows arrive newest first and paged,
 * so only "is there any deal in the period" is stated — never a period count from one page.
 */
function live({ snapshotAt, lastDeal, checkedAt, dates, today, sourceId, sourceClass }) {
  const day = today || isoDay(Date.now());
  const st = stateOf({ snapshotAt, checkedAt, today: day });
  const disk = fromDisk({ today: day });
  const ds = (dates || []).filter(Boolean).map((d) => String(d).slice(0, 10));
  const latest = ds.reduce((m, d) => (d > m ? d : m), '') || null;
  const meaning = Object.fromEntries([30, 90].map((k) => [k, recent({ n: ds.filter((d) => d > after(day, k) && d <= day).length, periodDays: k, today: day, lastDeal, state: st.state })]));
  return {
    sourceId: sourceId || 'over:deals-register', sourceClass: sourceClass || 'REPUBLISHED · Tax Authority register (independent republication, over.org.il)',
    snapshotAt: snapshotAt || null, snapshotDate: isoDay(ts(snapshotAt)), latestTransactionDate: lastDeal || null, checkedAt: checkedAt || null,
    publicationDate: null, publicationNote: 'the register does not state when a deal was published',
    state: st.state, ageDays: st.ageDays, checkAgeDays: st.checkAgeDays, stateReason: st.reason, stale: isStale(st.state),
    lagDaysLatestDeal: daysBetween(lastDeal, day), thresholds: THRESHOLDS, checkMaxDays: CHECK_MAX_DAYS,
    reportingLag: 'Deals reach the register weeks to months after signing: the most recent weeks are always thin, whatever the copy\'s age.',
    newerCopies: disk ? disk.newerCopies : [], latestObservedTransaction: latest, recent: meaning, today: day,
  };
}

/**
 * NEVER BACKWARDS: is the offered copy OLDER than the stored one (an earlier snapshot, or an earlier latest deal)? A newer
 * record is never replaced by an older mirror row — the sweep refuses such a copy whatever --force says.
 * @returns {null when the offered copy may replace the stored one | the reason it may not}
 */
function olderCopy(stored, offered) {
  if (!stored || !stored.scrapedAt) return null;
  const a = ts(stored.scrapedAt), b = ts(offered && offered.scrapedAt);
  if (b == null) return 'the offered copy states no snapshot date';
  if (a != null && b < a) return `older snapshot (${offered.scrapedAt}) than the stored one (${stored.scrapedAt})`;
  const la = stored.lastDeal ? String(stored.lastDeal).slice(0, 10) : null, lb = offered.lastDeal ? String(offered.lastDeal).slice(0, 10) : null;
  if (la && lb && lb < la) return `earlier latest deal (${lb}) than the stored copy's (${la})`;
  return null;
}

module.exports = { STATES, THRESHOLDS, CHECK_MAX_DAYS, PERIODS, BASIS, ts, isoDay, daysBetween, stateOf, isStale, periods, recent, contract, lastCheckOf, evidenceFreshness, fromDisk, scope, live, olderCopy };
