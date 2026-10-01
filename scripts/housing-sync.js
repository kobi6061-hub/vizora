#!/usr/bin/env node
// PROPX · government (subsidized) housing — scheduled sync.
//
//   official CKAN datastore (every row, paged; an incomplete read fails)
//     → schema guard (the identifiers the normalizer needs must exist)
//     → content hash → raw snapshot, only when the content changed
//     → normalize (lib/housing/normalize.js; malformed rows rejected, logged)
//     → upsert-merge into the store: never delete, firstSeenAt kept, every
//       change of an official field appended to the status history
//     → meta (source update time, PROPX check time, coverage) + run log
//
//   node scripts/housing-sync.js                   live (GitHub runner; gov.il is reachable there)
//   node scripts/housing-sync.js --dry-run         fetch + normalize + report, write nothing
//   node scripts/housing-sync.js --from <file>     replay a saved payload (.json / .json.gz:
//                                                  an array of rows or {rows, sourceUpdatedAt})
//   --summary-file <path>                          append a one-line summary (commit message)
//   --allow-shrink                                 accept a response under half the listed rows
//
// No fake record can reach the production data directory: there, --from only
// replays an official raw snapshot that a live run wrote to data/housing/raw/
// (a test fixture is replayed only into a separate HOUSING_DATA_DIR).
//
// Storage: data/housing/ (committed by .github/workflows/data-sync.yml); in
// addition the PROPX Supabase project when SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set as server-side secrets of the workflow.
// Exit: 0 ok · 2 written to the file store but the Supabase write failed · 1 failed (nothing written but the run log).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { SOURCE, fetchLotteries } = require('../lib/housing/source');
const { normalizeAll, hashRows, NORMALIZER_VERSION } = require('../lib/housing/normalize');
const { mergeRecords, FileHousingStore, SupabaseHousingStore } = require('../lib/housing/store');

const DIR = process.env.HOUSING_DATA_DIR || path.join(__dirname, '..', 'data', 'housing');
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const has = (f) => process.argv.includes('--' + f);
/* the columns the normalizer cannot work without — a renamed column fails the run instead of nulling a field */
const REQUIRED_COLUMNS = ['LotteryId', 'ProjectId', 'LamasCode', 'LamasName', 'LotteryExecutionDate', 'LotteryType',
  'MarketingMethodDesc', 'LotteryHousingUnits', 'Winners', 'Subscribers', 'ProjectStatus', 'ConstructionPermitName'];
const SHRINK_GUARD = 0.5;

function guardReplay(file) {
  if (process.env.HOUSING_DATA_DIR || has('dry-run')) return 'replay';
  const raw = path.resolve(DIR, 'raw') + path.sep;
  if (!path.resolve(file).startsWith(raw)) throw new Error('refused: into the production data directory --from only replays an official raw snapshot from data/housing/raw/');
  return 'replay-official-snapshot';
}

function readPayload(file, method) {
  const buf = fs.readFileSync(file);
  const j = JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8'));
  const rows = Array.isArray(j) ? j : j.rows;
  return { rows, total: rows.length, sourceUpdatedAt: (!Array.isArray(j) && j.sourceUpdatedAt) || argVal('source-updated') || null,
    endpoint: 'file:' + path.basename(file), retrievalMethod: method };
}

function coverage(records) {
  const d = records.filter((r) => r.inLatestSource !== false).map((r) => r.lotteryDate).filter(Boolean).sort();
  const s = records.filter((r) => r.inLatestSource !== false).map((r) => r.signupEndDate).filter(Boolean).sort();
  return { lotteryDateFrom: d[0] || null, lotteryDateTo: d[d.length - 1] || null, signupEndDateTo: s[s.length - 1] || null };
}

(async () => {
  let replay = null;
  if (argVal('from')) {
    try { replay = guardReplay(argVal('from')); }
    catch (e) { console.error(e.message); process.exitCode = 1; return; }   // refused before anything is written
  }
  const startedAt = new Date().toISOString();
  const dry = has('dry-run');
  const store = new FileHousingStore(DIR);
  const run = { id: 'housing-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: SOURCE.id, startedAt, status: 'failed' };
  let code = 0, summary = '';
  try {
    const got = replay ? readPayload(argVal('from'), replay) : { ...(await fetchLotteries()), retrievalMethod: 'live-api' };
    const fetchedAt = new Date().toISOString();
    Object.assign(run, { endpoint: got.endpoint, retrievalMethod: got.retrievalMethod, fetched: got.rows.length, sourceUpdatedAt: got.sourceUpdatedAt });
    if (!got.rows.length) throw new Error('the source returned no rows');
    const cols = new Set(got.rows.flatMap((r) => Object.keys(r)));
    const lost = REQUIRED_COLUMNS.filter((c) => !cols.has(c));
    if (lost.length) throw new Error('schema changed — missing column(s): ' + lost.join(', '));

    const prevMeta = store.readMeta();
    const prev = store.readRecords();
    const listed = prev.filter((r) => r.inLatestSource !== false).length;
    if (listed && got.rows.length < listed * SHRINK_GUARD && !has('allow-shrink')) {
      throw new Error(`the source returned ${got.rows.length} rows, under half of the ${listed} it listed last time — not applied (check the source, then rerun with --allow-shrink)`);
    }
    const hash = hashRows(got.rows);
    const changed = !prevMeta || prevMeta.snapshotHash !== hash;
    /* same content, new normalizer: re-derive the records, keep their observation times, no history events */
    const reDerive = !changed && prevMeta.normalizerVersion !== NORMALIZER_VERSION;
    const ctx = { source: SOURCE, sourceUpdatedAt: got.sourceUpdatedAt, snapshotHash: hash, retrievalMethod: got.retrievalMethod,
      fetchedAt: changed ? fetchedAt : prevMeta.snapshotFetchedAt || fetchedAt };
    const { records: fresh, rejected } = normalizeAll(got.rows, ctx);
    if (!fresh.length) throw new Error(`no row passed normalization (${rejected.length} rejected)`);

    let merged = null, history = [], stats = { inserted: 0, updated: 0, unchanged: fresh.length, missingFromSource: 0 };
    if (changed) ({ records: merged, history, stats } = mergeRecords(prev, fresh, { fetchedAt, syncRunId: run.id }));
    else if (reDerive) {
      const old = new Map(prev.map((r) => [r.id, r])), ids = new Set(fresh.map((r) => r.id));
      merged = fresh.map((r) => { const o = old.get(r.id) || {}; return { ...r, firstSeenAt: o.firstSeenAt || fetchedAt, lastSeenAt: o.lastSeenAt || fetchedAt, inLatestSource: true }; })
        .concat(prev.filter((r) => !ids.has(r.id))).sort((a, b) => a.lotteryId - b.lotteryId);
    }
    const all = merged || prev;
    Object.assign(run, { status: 'ok', contentChanged: changed, reDerived: reDerive, normalizerVersion: NORMALIZER_VERSION, snapshotHash: hash,
      ...stats, rejected: rejected.length, rejectedSample: rejected.slice(0, 5), historyEvents: history.length });
    const meta = {
      source: { ...SOURCE },
      endpoint: got.endpoint,
      sourceUpdatedAt: got.sourceUpdatedAt,                        // the source's own last-modified time
      snapshotHash: hash,
      snapshotFetchedAt: changed ? fetchedAt : prevMeta.snapshotFetchedAt, // when PROPX first fetched this content
      normalizerVersion: NORMALIZER_VERSION,
      checkedAt: fetchedAt,                                        // the latest successful check
      rows: got.rows.length, records: all.length, rejected: rejected.length,
      inLatestSource: all.filter((r) => r.inLatestSource !== false).length,
      notInLatestSource: all.filter((r) => r.inLatestSource === false).length,
      coverage: coverage(all),
      lastRun: run.id,
    };
    summary = `Housing: ${got.rows.length} official rows · source updated ${String(got.sourceUpdatedAt || '—').slice(0, 10)} · `
      + (changed ? `+${stats.inserted} new, ${stats.updated} changed, ${stats.missingFromSource} no longer listed` : 'content unchanged')
      + (rejected.length ? ` · ${rejected.length} rejected` : '');
    if (!dry) {
      const rawName = changed ? store.snapshotRaw(got.rows, hash, fetchedAt) : null;
      run.rawSnapshot = rawName;
      run.finishedAt = new Date().toISOString();
      store.write({ records: merged, history, meta, run });
      const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
      if (url && key) {
        try {
          await new SupabaseHousingStore({ url, key }).write({ records: merged, history, run, source: SOURCE,
            raw: changed ? { hash, rows: got.rows, fetchedAt } : null });
          summary += ' · Supabase ✓';
        } catch (e) { code = 2; summary += ' · Supabase write failed'; console.error('supabase:', e.message); }
      }
    }
    console.log(JSON.stringify({ run: { ...run, rejectedSample: undefined }, meta: { ...meta, source: SOURCE.id } }, null, 1));
  } catch (e) {
    run.error = e.message;
    run.finishedAt = new Date().toISOString();
    code = 1;
    summary = 'Housing sync failed: ' + e.message;
    console.error('housing-sync failed:', e.message);
    if (!dry) { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(path.join(DIR, 'sync-runs.jsonl'), JSON.stringify(run) + '\n'); }
  }
  console.log(summary);
  const sf = argVal('summary-file');
  if (sf) fs.appendFileSync(sf, summary + '\n');
  process.exitCode = code;
})();
