// PROPX · when the national missed-deal detector RECORDS a check (data/txevents/national/runs.jsonl → a commit).
//
// The detector checks the two republished copies' versions every three hours (.github/workflows/txevents-national.yml). A check that finds
// nothing new is recorded at most every RECORD_GAP_HOURS; a build, a new version or a failure is recorded always.
//
// Until 22.10.2026 the workflow measured "the last record" with `git log -1 --format=%ct -- data/txevents/national/runs.jsonl` in a
// SHALLOW checkout (actions/checkout, depth 1): there the only commit is the branch head, which `git log -- <path>` returns for every path —
// so "the last record" was the last commit of ANY sync, almost always under 12 hours old on a branch the syncs write several times a day.
// The last record is the build of 20.10.2026 18:55 UTC (commit 32d3509); the scheduled checks of 21.10.2026 at 11:59, 17:19 and 21:48 UTC
// (GitHub runs 39596014029 · 39642748425 · 39681669082) found the copies unchanged 17.1 h, 22.4 h and 26.9 h after it and each printed
// "Unchanged — recorded in the run history only." — so the Trust Center read the detector as STALE (its 12-hour threshold) although it
// checked on schedule. The decision now reads the run log itself: every line before this run's own line was committed by an earlier run.

'use strict';

const RECORD_GAP_HOURS = 12;
const HOUR = 3600e3;

const parseLines = (text) => String(text || '').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

/**
 * @param {string} text   the run log as it stands after this run appended its line
 * @param {{ now: number, gapHours?: number }} opt
 * @returns {{ record: boolean, reason: string, status: string|null, lastRecordedAt: string|null, ageHours: number|null }}
 */
function recordDecision(text, { now, gapHours = RECORD_GAP_HOURS } = {}) {
  const lines = parseLines(text);
  const last = lines.pop() || null;
  const status = last ? String(last.status || '') : null;
  if (!last) return { record: true, reason: 'no-run-line', status, lastRecordedAt: null, ageHours: null };
  if (status !== 'UNCHANGED') return { record: true, reason: 'not-unchanged', status, lastRecordedAt: null, ageHours: null };
  const prior = lines.map((r) => r.at).filter((t) => t && Number.isFinite(Date.parse(t))).sort().pop() || null;
  if (!prior) return { record: true, reason: 'first-record', status, lastRecordedAt: null, ageHours: null };
  const ageHours = Math.round(((now - Date.parse(prior)) / HOUR) * 10) / 10;
  if (!(ageHours < gapHours)) return { record: true, reason: `last-record-${ageHours}h-ago`, status, lastRecordedAt: prior, ageHours };
  return { record: false, reason: `unchanged-and-last-record-${ageHours}h-ago`, status, lastRecordedAt: prior, ageHours };
}

module.exports = { RECORD_GAP_HOURS, recordDecision, parseLines };
