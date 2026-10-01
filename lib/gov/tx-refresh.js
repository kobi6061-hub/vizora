// PROPX · one transaction refresh: every watched area, the rolling re-check
// window, the ledger upsert, and an honest record of how much of the window
// was actually re-checked. Shared by the scheduled GitHub job
// (scripts/tx-sync.js) and the server-side job (api/jobs/tx-refresh.js), so
// both record coverage the same way.
//
// A window is "complete" only when the sweep proves it: every polygon around
// the area was planned (no cap), every planned request ran (no time budget
// cut), every planned polygon answered, no page was cut at its row limit and
// no request failed. Anything less is "partial"; no or broken diagnostics are
// "unknown"; a refused, failed, timed-out or skipped area is "not-checked" —
// also when the area's lookups answered but none of its deals requests did.
// Nothing is ever recorded as complete by default. Error texts are redacted
// (lib/store-config.js) before they are kept anywhere.

'use strict';

const { backfillWindow } = require('./ledger');
const { redact } = require('../store-config');

const SOURCE_ID = 'govmap:tax-authority-deals';
const SOURCE = {
  id: SOURCE_ID, authority: 'רשות המסים (שכבת העסקאות ב-GovMap)', dataset: 'עסקאות נדל"ן — real-estate deals layer',
  endpoint: 'https://www.govmap.gov.il/api/real-estate/', format: 'json-api', sourceClass: 'CONFIRMED_STRUCTURED',
};
const DIAG_KEYS = ['polygonsAvailable', 'polygonsPlanned', 'polygonsQueried', 'requestsPlanned', 'requestsRun', 'pageLimitHits', 'polyErrors', 'requestsRefused'];

/** {windowCheck, gaps} from a sweep's diagnostics (providers/govmap.js). */
function windowCheckOf(d) {
  if (!d || typeof d !== 'object') return { windowCheck: 'unknown', gaps: ['no-diagnostics'] };
  if (DIAG_KEYS.some((k) => typeof d[k] !== 'number' || !Number.isFinite(d[k]))) return { windowCheck: 'unknown', gaps: ['diagnostics-incomplete'] };
  if (d.polygonsAvailable === 0) return { windowCheck: 'unknown', gaps: ['no-polygons'] };   // nothing to prove anything with
  const gaps = [];
  if (d.polygonsPlanned < d.polygonsAvailable) gaps.push('polygon-cap');
  if (d.requestsRun < d.requestsPlanned) gaps.push('time-budget');
  if (d.polygonsQueried < d.polygonsPlanned) gaps.push('polygons-unanswered');
  if (d.pageLimitHits) gaps.push('page-limit');
  if (d.requestsRefused) gaps.push('requests-refused');
  if (d.polyErrors > d.requestsRefused) gaps.push('request-errors');
  return { windowCheck: gaps.length ? 'partial' : 'complete', gaps };
}

/* the area's lookups answered but not one deals request did: nothing was re-checked */
function unanswered(d) {
  if (!d || !(d.requestsPlanned > 0) || d.polygonsQueried !== 0) return null;
  if (!d.requestsRun) return { status: 'timeout', gaps: ['time-budget'] };
  return d.requestsRefused && d.requestsRefused === d.polyErrors ? { status: 'refused', gaps: ['requests-refused'] } : { status: 'failed', gaps: ['request-errors'] };
}

/** refused (HTTP 401/403) · timeout · failed — none of them re-checked anything. */
function failureOf(e) {
  const m = String((e && e.message) || e);
  if (/\bHTTP 40[13]\b/.test(m)) return 'refused';
  if ((e && e.name === 'AbortError') || /time budget|timed? ?out|timeout|deadline|ETIMEDOUT/i.test(m)) return 'timeout';
  return 'failed';
}

/**
 * Refresh every target. `deadline` (epoch ms) stops before the next area —
 * an area that was not reached is recorded as "skipped", never as checked.
 * onStart(run) is awaited before an area starts (status "running"), onRun(run)
 * with its final record — so a process killed mid-area leaves a "running" row,
 * never a silent gap. Their failures are collected, not thrown.
 * @returns {{window, runs, recordErrors}} one run record per target
 */
async function refreshTargets({ provider, ledger, targets, now = new Date(), days, runKey = null, deadline = Infinity,
  clock = () => new Date(), sourceId = SOURCE_ID, budgetMs, onStart = null, onRun = null, redactText = (m) => redact(m) }) {
  const win = backfillWindow(now, days);
  const runs = [], recordErrors = [];
  const note = async (fn, r) => { if (!fn) return; try { await fn(r); } catch (e) { recordErrors.push(redactText(e && e.message).slice(0, 200)); } };
  for (const tg of targets) {
    const startedAt = clock().toISOString();
    const base = { source: sourceId, runKey, target: tg.id, startedAt, window: { from: win.from, to: win.to, days: win.days } };
    let run;
    if (Date.now() >= deadline) {
      run = { ...base, status: 'skipped', windowCheck: 'not-checked', gaps: ['job-deadline'], finishedAt: startedAt };
    } else {
      await note(onStart, { ...base, status: 'running', windowCheck: 'not-checked', gaps: [] });
      try {
        // months spans the re-check window plus the current month
        const rows = await provider.getTransactions({ city: tg.city, street: tg.street || null, houseNumber: tg.house ?? null },
          { months: Math.ceil(win.days / 30) + 1, radiusM: tg.radiusM, limit: tg.limit, ...(budgetMs ? { budgetMs } : {}) });
        const d = rows.diagnostics || null, none = unanswered(d);
        if (none) {
          run = { ...base, ...none, windowCheck: 'not-checked', finishedAt: clock().toISOString(), fetched: 0, coverage: d,
            error: `no deals request answered (${d.requestsRefused || 0} refused, ${d.polyErrors || 0} failed of ${d.requestsRun} run, ${d.requestsPlanned} planned)` };
        } else {
          const fetchedAt = clock().toISOString();
          const st = await ledger.upsert(sourceId, rows, { fetchedAt, target: tg.id, runKey });
          const dates = rows.map((r) => r.date).filter(Boolean).sort();
          run = { ...base, status: 'ok', finishedAt: clock().toISOString(), ...windowCheckOf(d),
            fetched: rows.length, ...st, newestTransactionDate: dates[dates.length - 1] || null, coverage: d };
        }
      } catch (e) {
        const status = failureOf(e);
        run = { ...base, status, windowCheck: 'not-checked', gaps: [status], finishedAt: clock().toISOString(),
          error: redactText((e && e.message) || e).slice(0, 300) };
      }
    }
    runs.push(run);
    await note(onRun, run);
  }
  return { window: win, runs, recordErrors };
}

/** the one-line summary (commit message / job log) */
function summarize({ window: win, runs }, now = new Date()) {
  const n = (s) => runs.filter((r) => r.status === s).length;
  const sum = (k) => runs.reduce((a, r) => a + (r[k] || 0), 0);
  const partial = runs.filter((r) => r.status === 'ok' && r.windowCheck !== 'complete').length;
  const notChecked = runs.length - n('ok');
  return `Transactions ${now.toISOString().slice(0, 10)} — ${n('ok')}/${runs.length} areas · window ${win.from}…${win.to} · +${sum('inserted')} new · ${sum('updated')} changed · ${sum('unchanged')} unchanged`
    + (partial ? ` · window only partly re-checked on ${partial} (${[...new Set(runs.flatMap((r) => (r.status === 'ok' && r.windowCheck !== 'complete' ? r.gaps : [])))].join(', ')})` : '')
    + (notChecked ? ` · not checked on ${notChecked} (${['refused', 'timeout', 'failed', 'skipped'].filter((s) => n(s)).map((s) => `${s} ${n(s)}`).join(', ')})` : '');
}

/** 0 every area ok · 2 some ok · 3 every area refused · 1 nothing usable */
function exitCodeOf(runs) {
  const ok = runs.filter((r) => r.status === 'ok').length, refused = runs.filter((r) => r.status === 'refused').length;
  return ok === runs.length ? 0 : ok ? 2 : refused === runs.length ? 3 : 1;
}

/* a run record → market.sync_runs (Supabase). The table's status vocabulary is
   ok | partial | failed | refused: an area whose window was not completely
   re-checked is never "ok". */
function toSyncRunRow(r) {
  const status = r.status === 'running' ? 'running' : r.status === 'ok' ? (r.windowCheck === 'complete' ? 'ok' : 'partial')
    : r.status === 'refused' ? 'refused' : 'failed';
  return { run_key: `${r.runKey || 'tx'}:${r.target}`, source_id: r.source, target: r.target, started_at: r.startedAt, finished_at: r.finishedAt || null,
    status, window_check: r.windowCheck, rows_fetched: r.fetched || 0, rows_inserted: r.inserted || 0, rows_updated: r.updated || 0,
    rows_unchanged: r.unchanged || 0, rows_rejected: r.rejected || 0, window_from: r.window.from, window_to: r.window.to,
    error: r.error || null, details: r };
}

/** market.sources + market.sync_runs in the PROPX Supabase project (service role, server-side). */
async function recordRunsSupabase({ url, key, fetchImpl = globalThis.fetch, withSource = true }, runs, source = SOURCE) {
  const base = url.replace(/\/$/, '') + '/rest/v1/';
  const post = async (table, rows, conflict) => {
    const r = await fetchImpl(base + table + '?on_conflict=' + conflict, { method: 'POST', body: JSON.stringify(rows),
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Profile': 'market',
        Prefer: 'resolution=merge-duplicates,return=minimal' } });
    if (!r.ok) throw new Error(`supabase ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  };
  if (withSource) await post('sources', [{ id: source.id, authority: source.authority, dataset: source.dataset, endpoint: source.endpoint, format: source.format,
    source_class: source.sourceClass, updated_at: new Date().toISOString() }], 'id');
  if (runs.length) await post('sync_runs', runs.map(toSyncRunRow), 'run_key');
}

module.exports = { SOURCE_ID, SOURCE, windowCheckOf, failureOf, refreshTargets, summarize, exitCodeOf, toSyncRunRow, recordRunsSupabase };
