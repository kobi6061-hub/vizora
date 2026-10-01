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
// replays an official raw snapshot that a live run wrote to data/housing/raw/ —
// its content must match the hash in its name, a live-api run must have
// recorded it in sync-runs.jsonl, and an older snapshot is refused unless
// --force. A fixture is replayed only into a separate HOUSING_DATA_DIR.
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
const { normalizeAll, hashRows, recordTypeOf, NORMALIZER_VERSION } = require('../lib/housing/normalize');
const { mergeRecords, FileHousingStore, SupabaseHousingStore, readRawSnapshot, verifyOfficialSnapshot } = require('../lib/housing/store');
const { storeConfig, redact } = require('../lib/store-config');

const PROD_DIR = path.join(__dirname, '..', 'data', 'housing');
const DIR = process.env.HOUSING_DATA_DIR || PROD_DIR;
const IS_PROD = path.resolve(DIR) === path.resolve(PROD_DIR);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const has = (f) => process.argv.includes('--' + f);
/* the columns the normalizer cannot work without — a renamed column fails the run instead of nulling a field */
const REQUIRED_COLUMNS = ['LotteryId', 'ProjectId', 'LamasCode', 'LamasName', 'LotteryExecutionDate', 'LotteryType',
  'MarketingMethodDesc', 'LotteryHousingUnits', 'Winners', 'Subscribers', 'ProjectStatus', 'ConstructionPermitName'];
const SHRINK_GUARD = 0.5;
const findRaw = (dir, hash) => { try { const f = fs.readdirSync(path.join(dir, 'raw')).find((x) => hash && x.includes(hash.slice(0, 12))); return f ? readRawSnapshot(path.join(dir, 'raw', f)) : null; } catch { return null; } };

/* What may be replayed where (see the header). Returns the payload to ingest. */
function guardReplay(file) {
  if (has('dry-run') || !IS_PROD) {
    const buf = fs.readFileSync(file);
    const j = JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8'));
    const rows = Array.isArray(j) ? j : j.rows;
    return { rows, sourceUpdatedAt: (!Array.isArray(j) && j.sourceUpdatedAt) || argVal('source-updated') || null,
      endpoint: 'file:' + path.basename(file), retrievalMethod: 'replay' };
  }
  const { snap, run: wrote, when } = verifyOfficialSnapshot(PROD_DIR, file, { force: has('force'), hashRows });
  return { rows: snap.rows, sourceUpdatedAt: snap.sourceUpdatedAt || wrote.sourceUpdatedAt || null, fetchedAt: when,
    endpoint: snap.endpoint || wrote.endpoint || 'file:' + path.basename(file), retrievalMethod: 'replay-official-snapshot' };
}

/* the dates the source's LOTTERIES span (a national grants row does not widen them) */
function coverage(records) {
  const lot = records.filter((r) => r.inLatestSource !== false && (r.recordType || recordTypeOf(r)) === 'lottery');
  const d = lot.map((r) => r.lotteryDate).filter(Boolean).sort();
  const s = lot.map((r) => r.signupEndDate).filter(Boolean).sort();
  return { lotteryDateFrom: d[0] || null, lotteryDateTo: d[d.length - 1] || null, signupEndDateTo: s[s.length - 1] || null };
}

(async () => {
  let replay = null;
  if (argVal('from')) {
    try { replay = guardReplay(argVal('from')); }
    catch (e) { console.error(e.message); process.exitCode = 1; return; }   // refused before anything is written
  }
  const now = new Date().toISOString();
  const startedAt = new Date().toISOString();
  const dry = has('dry-run');
  const store = new FileHousingStore(DIR);
  const run = { id: 'housing-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: SOURCE.id, startedAt, status: 'failed' };
  let code = 0, summary = '';
  try {
    const got = replay || { ...(await fetchLotteries()), retrievalMethod: 'live-api' };
    const live = got.retrievalMethod === 'live-api';
    const fetchedAt = got.fetchedAt || new Date().toISOString();       // when this content was fetched from the source
    Object.assign(run, { endpoint: got.endpoint, retrievalMethod: got.retrievalMethod, fetched: got.rows.length, sourceUpdatedAt: got.sourceUpdatedAt });
    if (!got.rows.length) throw new Error('the source returned no rows');
    const cols = new Set(got.rows.flatMap((r) => Object.keys(r)));
    const lost = REQUIRED_COLUMNS.filter((c) => !cols.has(c));
    if (lost.length) throw new Error('schema changed — missing column(s): ' + lost.join(', '));

    const prevMeta = store.readMeta();
    let prev = store.readRecords();
    const listed = prev.filter((r) => r.inLatestSource !== false).length;
    const hash = hashRows(got.rows);
    const changed = !prevMeta || prevMeta.snapshotHash !== hash;
    /* same content, new normalizer: re-derive the records, keep their observation times, no history events */
    const reDerive = !changed && prevMeta.normalizerVersion !== NORMALIZER_VERSION;
    const ctx = { source: SOURCE, sourceUpdatedAt: got.sourceUpdatedAt, snapshotHash: hash, retrievalMethod: got.retrievalMethod,
      fetchedAt: changed ? fetchedAt : prevMeta.snapshotFetchedAt || fetchedAt };
    const { records: fresh, rejected } = normalizeAll(got.rows, ctx);
    Object.assign(run, { rejected: rejected.length, rejectedSample: rejected.slice(0, 5) });
    if (!fresh.length) throw new Error(`no row passed normalization (${rejected.length} rejected)`);
    /* a response that mostly fails normalization is a source or schema problem, not news */
    const maxRejected = Math.max(5, Math.ceil(got.rows.length * 0.02));
    if (rejected.length > maxRejected && !has('allow-rejects')) {
      throw new Error(`${rejected.length} of ${got.rows.length} rows failed normalization (allowed ${maxRejected}) — not applied; see rejectedSample`);
    }
    if (listed && fresh.length < listed * SHRINK_GUARD && !has('allow-shrink')) {
      throw new Error(`only ${fresh.length} valid rows, under half of the ${listed} listed last time — not applied (check the source, then rerun with --allow-shrink)`);
    }
    /* every id the source LISTED, including rows that failed normalization: those are never marked delisted */
    const presentIds = new Set(got.rows.map((r) => Number(String(r.LotteryId ?? '').replace(/,/g, ''))).filter((n) => Number.isInteger(n) && n > 0).map((n) => 'lottery:' + n));
    /* a new normalizer and new content in one run: re-derive the stored version from ITS raw snapshot first,
       so history shows only what the source changed */
    if (changed && prevMeta && prevMeta.normalizerVersion !== NORMALIZER_VERSION && prev.length) {
      const old = findRaw(DIR, prevMeta.snapshotHash);
      if (old) {
        const byId = new Map(prev.map((r) => [r.id, r]));
        const re = normalizeAll(old.rows, { source: SOURCE, sourceUpdatedAt: prevMeta.sourceUpdatedAt, fetchedAt: prevMeta.snapshotFetchedAt,
          snapshotHash: prevMeta.snapshotHash, retrievalMethod: 'live-api' }).records;
        const reIds = new Set(re.map((r) => r.id));
        prev = re.map((r) => { const o = byId.get(r.id) || {};
          return { ...r, provenance: o.provenance || r.provenance, firstSeenAt: o.firstSeenAt || r.provenance.fetchedAt, inLatestSource: o.inLatestSource !== false,
            ...(o.inLatestSource === false ? { lastSeenAt: o.lastSeenAt } : {}) }; })
          .concat(prev.filter((r) => !reIds.has(r.id)));
        run.rederivedPrevious = true;
      }
    }

    let merged = null, history = [], stats = { inserted: 0, updated: 0, unchanged: fresh.length, missingFromSource: 0 };
    if (changed) ({ records: merged, history, stats } = mergeRecords(prev, fresh, { fetchedAt, syncRunId: run.id, prevCheckedAt: prevMeta && prevMeta.checkedAt, presentIds }));
    else if (reDerive) {
      const old = new Map(prev.map((r) => [r.id, r])), ids = new Set(fresh.map((r) => r.id));
      merged = fresh.map((r) => { const o = old.get(r.id) || {}; return { ...r, firstSeenAt: o.firstSeenAt || fetchedAt, inLatestSource: true }; })
        .concat(prev.filter((r) => !ids.has(r.id))).sort((a, b) => a.lotteryId - b.lotteryId);
    }
    const all = merged || prev;
    Object.assign(run, { status: 'ok', contentChanged: changed, reDerived: reDerive, normalizerVersion: NORMALIZER_VERSION, snapshotHash: hash,
      ...stats, historyEvents: history.length });
    const meta = {
      source: { ...SOURCE },
      endpoint: got.endpoint,
      sourceUpdatedAt: got.sourceUpdatedAt,                        // the source's own last-modified time
      snapshotHash: hash,
      snapshotFetchedAt: changed ? fetchedAt : prevMeta.snapshotFetchedAt, // when PROPX first fetched this content
      normalizerVersion: NORMALIZER_VERSION,
      checkedAt: live ? now : (prevMeta && prevMeta.checkedAt) || fetchedAt,   // the latest successful check of the LIVE source
      rows: got.rows.length, records: all.length, rejected: rejected.length,
      inLatestSource: all.filter((r) => r.inLatestSource !== false).length,
      notInLatestSource: all.filter((r) => r.inLatestSource === false).length,
      coverage: coverage(all),
      historyEvents: store.readHistory().length + history.length,   // every status-history event once this run is written
      lastRun: run.id,
    };
    summary = `Housing: ${got.rows.length} official rows · source updated ${String(got.sourceUpdatedAt || '—').slice(0, 10)} · `
      + (changed ? `+${stats.inserted} new, ${stats.updated} changed, ${stats.missingFromSource} no longer listed` : 'content unchanged')
      + (reDerive ? ` · records re-derived (normalizer v${NORMALIZER_VERSION})` : '')
      + (rejected.length ? ` · ${rejected.length} rejected` : '');
    if (!dry) {
      const rawName = changed ? store.snapshotRaw(got.rows, hash, fetchedAt, { sourceUpdatedAt: got.sourceUpdatedAt, endpoint: got.endpoint }) : null;
      run.rawSnapshot = rawName;
      run.finishedAt = new Date().toISOString();
      store.write({ records: merged, history, meta, run });
      const cfg = storeConfig(process.env);
      if (cfg.ok) {
        try {
          await new SupabaseHousingStore({ url: cfg.url, key: cfg.key }).write({ records: merged, all, history, allHistory: store.readHistory(),
            run, source: SOURCE, meta, raw: { hash, rows: got.rows, fetchedAt } });
          summary += ' · Supabase ✓';
        } catch (e) { code = 2; summary += ' · Supabase write failed'; console.error('supabase:', redact(e.message)); }
      } else if (cfg.reason === 'store-misconfigured') {
        code = 2; summary += ' · Supabase misconfigured'; console.error('supabase: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set but malformed (https://<project>.supabase.co expected)');
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
