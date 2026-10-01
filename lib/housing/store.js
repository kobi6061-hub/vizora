// PROPX · government housing — persistence.
//
// Upsert-only, history-keeping storage of the normalized lottery records:
//   · upsert on the official id (lottery:<LotteryId>);
//   · firstSeenAt is set once (first observation by PROPX). A record's
//     provenance is that of its current VERSION (the fetch and raw snapshot in
//     which these values first appeared), so an unchanged record is never
//     rewritten. Every record with inLatestSource:true was observed at
//     meta.checkedAt; lastSeenAt is stored only for a record the source has
//     stopped listing (the last check that still contained it). A run whose
//     content hash is unchanged rewrites nothing but meta.json and the run log;
//   · a change in an official SOURCE field (HISTORY_FIELDS) appends a
//     status-history event; derived keys are re-derived silently;
//   · a record the source stops returning is NEVER deleted — it is kept and
//     marked inLatestSource:false (with a history event);
//   · the raw official payload is snapshotted whenever its content changes.
//
// FileHousingStore — data/housing/ in the repository (written by the
//   scheduled job, read by the session-gated API): lotteries.json (one record
//   per line, diff-friendly), meta.json, history.jsonl, sync-runs.jsonl,
//   raw/<date>-<hash>.json.gz.
// SupabaseHousingStore — the same rows in the PROPX Supabase project
//   (market.housing_lotteries / housing_status_history / sync_runs /
//   raw_snapshots), used in addition when SUPABASE_URL and
//   SUPABASE_SERVICE_ROLE_KEY are set server-side.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { HISTORY_FIELDS, historyValue } = require('./normalize');

/* bookkeeping, not official values */
const NOT_FACTS = new Set(['id', 'provenance', 'missing', 'firstSeenAt', 'lastSeenAt', 'inLatestSource']);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const factKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !NOT_FACTS.has(k)).sort();

/** Pure merge of a fresh normalized fetch into the stored records.
 *  presentIds: every record id the source response LISTED, including rows that
 *  failed normalization — such a record is kept as it was, never marked delisted. */
function mergeRecords(prev, next, { fetchedAt, syncRunId = null, prevCheckedAt = null, presentIds = null }) {
  const byId = new Map(prev.map((r) => [r.id, r]));
  const out = [], history = [];
  const stats = { inserted: 0, updated: 0, unchanged: 0, rederived: 0, missingFromSource: 0, keptUnparsed: 0 };
  const seen = new Set();
  for (const rec of next) {
    seen.add(rec.id);
    const old = byId.get(rec.id);
    if (!old) {
      out.push({ ...rec, firstSeenAt: fetchedAt, inLatestSource: true });
      stats.inserted++;
      continue;
    }
    const changed = HISTORY_FIELDS.filter((k) => !same(historyValue(old, k), historyValue(rec, k)));
    for (const k of changed) history.push({ id: rec.id, field: k, from: historyValue(old, k), to: historyValue(rec, k), observedAt: fetchedAt, syncRunId });
    if (old.inLatestSource === false) history.push({ id: rec.id, field: 'inLatestSource', from: false, to: true, observedAt: fetchedAt, syncRunId });
    const { lastSeenAt, ...keep } = old;
    if (changed.length) { out.push({ ...rec, firstSeenAt: old.firstSeenAt, inLatestSource: true }); stats.updated++; }
    else if (factKeys(keep, rec).some((k) => !same(keep[k], rec[k]))) {
      /* the same source values, derived differently (a normalizer change): no event, the version's provenance kept */
      out.push({ ...rec, provenance: old.provenance, firstSeenAt: old.firstSeenAt, inLatestSource: true }); stats.rederived++;
    } else { out.push({ ...keep, inLatestSource: true }); stats.unchanged++; }   // the same version: provenance kept
  }
  for (const old of prev) {
    if (seen.has(old.id)) continue;
    if (presentIds && presentIds.has(old.id)) { out.push(old); stats.keptUnparsed++; continue; }   // listed, but its row was rejected this time
    stats.missingFromSource++;
    if (old.inLatestSource !== false) {
      history.push({ id: old.id, field: 'inLatestSource', from: true, to: false, observedAt: fetchedAt, syncRunId });
      out.push({ ...old, inLatestSource: false, lastSeenAt: prevCheckedAt || old.lastSeenAt || null });   // kept, never deleted
    } else out.push(old);
  }
  out.sort((a, b) => a.lotteryId - b.lotteryId);
  return { records: out, history, stats };
}

/** A raw snapshot file: {contentHash, fetchedAt, sourceUpdatedAt, endpoint, rows} (or, before v2, the bare rows array). */
function readRawSnapshot(file) {
  const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  return Array.isArray(j) ? { rows: j, contentHash: null, fetchedAt: null, sourceUpdatedAt: null, endpoint: null } : j;
}

/**
 * An official raw snapshot that may be replayed into a data directory: inside
 * <dir>/raw/, its rows hash to the hash in its name (and in the file), a
 * live-api run of <dir>/sync-runs.jsonl recorded it, and it is not older than
 * the directory's current content unless `force`. Returns {snap, run}; throws otherwise.
 */
function verifyOfficialSnapshot(dir, file, { force = false, hashRows } = {}) {
  const abs = path.resolve(file), name = path.basename(abs);
  const m = /^\d{4}-\d{2}-\d{2}-([0-9a-f]{12})\.json\.gz$/.exec(name);
  if (!abs.startsWith(path.resolve(dir, 'raw') + path.sep) || !m) {
    throw new Error('refused: into the production data directory --from only replays an official raw snapshot from data/housing/raw/');
  }
  const snap = readRawSnapshot(abs), hash = hashRows(snap.rows);
  if (!hash.startsWith(m[1]) || (snap.contentHash && snap.contentHash !== hash)) throw new Error('refused: the snapshot content does not match its recorded hash');
  let runs = [];
  try { runs = fs.readFileSync(path.join(dir, 'sync-runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* none */ }
  const run = runs.find((r) => r.rawSnapshot === name && r.retrievalMethod === 'live-api' && r.snapshotHash === hash);
  if (!run) throw new Error('refused: no live run recorded this snapshot in sync-runs.jsonl');
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { /* none */ }
  const when = snap.fetchedAt || run.finishedAt;
  if (meta && meta.snapshotHash !== hash && meta.snapshotFetchedAt && when < meta.snapshotFetchedAt && !force) {
    throw new Error('refused: this snapshot is older than the current content — rerun with --force to roll back on purpose');
  }
  return { snap, run, when };
}

/* one record per line: valid JSON, minimal git diffs */
const linesJson = (arr) => '[\n' + arr.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n';

class FileHousingStore {
  constructor(dir) { this.dir = dir; }
  p(f) { return path.join(this.dir, f); }
  readRecords() { try { return JSON.parse(fs.readFileSync(this.p('lotteries.json'), 'utf8')); } catch { return []; } }
  readMeta() { try { return JSON.parse(fs.readFileSync(this.p('meta.json'), 'utf8')); } catch { return null; } }
  /** Write the raw payload (with when/where it came from) if its content hash is new; returns the file name or null. */
  snapshotRaw(rows, hash, fetchedAt, meta = {}) {
    const dir = this.p('raw');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).some((f) => f.includes(hash.slice(0, 12)))) return null;
    const name = `${fetchedAt.slice(0, 10)}-${hash.slice(0, 12)}.json.gz`;
    const doc = { contentHash: hash, fetchedAt, sourceUpdatedAt: meta.sourceUpdatedAt || null, endpoint: meta.endpoint || null, rows };
    fs.writeFileSync(path.join(dir, name), zlib.gzipSync(JSON.stringify(doc), { level: 9 }));
    return name;
  }
  /** records === null: the content is unchanged — only meta and the run log are written */
  write({ records, history = [], meta, run }) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (records) fs.writeFileSync(this.p('lotteries.json'), linesJson(records));
    fs.writeFileSync(this.p('meta.json'), JSON.stringify(meta, null, 1) + '\n');
    if (history.length) fs.appendFileSync(this.p('history.jsonl'), history.map((h) => JSON.stringify(h)).join('\n') + '\n');
    fs.appendFileSync(this.p('sync-runs.jsonl'), JSON.stringify(run) + '\n');
  }
}

/** The same upserts against the PROPX Supabase project (PostgREST, service role). */
class SupabaseHousingStore {
  constructor({ url, key, fetchImpl = globalThis.fetch }) {
    if (!url || !key) throw new Error('SupabaseHousingStore needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    this.base = url.replace(/\/$/, '') + '/rest/v1/'; this.key = key; this.fetch = fetchImpl;
  }
  async patch(path, body) {
    const r = await this.fetch(this.base + path, { method: 'PATCH', body: JSON.stringify(body),
      headers: { apikey: this.key, Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json', 'Content-Profile': 'market', Prefer: 'return=minimal' } });
    if (!r.ok) throw new Error(`supabase PATCH ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  async post(table, rows, conflict, resolution = 'merge-duplicates') {
    for (let i = 0; i < rows.length; i += 500) {
      const r = await this.fetch(this.base + table + (conflict ? '?on_conflict=' + conflict : ''), {
        method: 'POST', body: JSON.stringify(rows.slice(i, i + 500)),
        headers: { apikey: this.key, Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json', 'Content-Profile': 'market',
          Prefer: (conflict ? `resolution=${resolution},` : '') + 'return=minimal' } });
      if (!r.ok) throw new Error(`supabase ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  }
  /** rows the project already holds for this table (exact count; null if unknown) */
  async count(table) {
    const r = await this.fetch(this.base + table + '?select=id&limit=1', { headers: { apikey: this.key, Authorization: 'Bearer ' + this.key,
      'Accept-Profile': 'market', Prefer: 'count=exact' } });
    if (!r.ok) throw new Error(`supabase count ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const m = /\/(\d+)$/.exec((r.headers && r.headers.get && r.headers.get('content-range')) || '');
    return m ? Number(m[1]) : null;
  }
  /**
   * records === null: content unchanged. `all` = every stored record and `raw`
   * the current payload: when the project holds fewer records than PROPX (its
   * secrets were added after the first sync, or an earlier write failed), all
   * of them and the raw snapshot are written — the project is never left empty.
   */
  async write({ records, all = null, history = [], run, source, raw = null }) {
    await this.post('sources', [{ id: source.id, authority: source.authority, dataset: source.dataset, endpoint: run.endpoint || source.page,
      format: source.format, source_class: source.sourceClass, update_cadence: source.cadence, last_source_update: run.sourceUpdatedAt,
      updated_at: new Date().toISOString() }], 'id');
    const behind = all && (await this.count('housing_lotteries')) !== all.length;
    const rows = behind ? all : records;
    if (raw && (records || behind)) await this.post('raw_snapshots', [{ source_id: source.id, content_hash: raw.hash, fetched_at: raw.fetchedAt,
      source_updated_at: run.sourceUpdatedAt, row_count: raw.rows.length, payload: raw.rows, run_key: run.id }], 'source_id,content_hash', 'ignore-duplicates');
    const checkedAt = run.finishedAt || run.startedAt;
    if (rows) await this.post('housing_lotteries', rows.map((r) => toRow(r, checkedAt)), 'id');
    else await this.patch('housing_lotteries?in_latest_source=eq.true', { last_seen_at: checkedAt });
    if (history.length) await this.post('housing_status_history', history.map((h) => ({ record_id: h.id, field: h.field,
      from_value: h.from, to_value: h.to, observed_at: h.observedAt, run_key: h.syncRunId })));
    await this.post('sync_runs', [{ run_key: run.id, source_id: source.id, started_at: run.startedAt, finished_at: run.finishedAt,
      status: run.status === 'ok' ? 'ok' : run.status === 'partial' ? 'partial' : 'failed',
      rows_fetched: run.fetched || 0, rows_inserted: run.inserted || 0, rows_updated: run.updated || 0, rows_unchanged: run.unchanged || 0,
      rows_rejected: run.rejected || 0, source_updated_at: run.sourceUpdatedAt || null, snapshot_hash: run.snapshotHash || null,
      error: run.error || null, details: run }]);
  }
}
/* normalized record → market.housing_lotteries row */
const toRow = (r, checkedAt) => ({
  id: r.id, lottery_id: r.lotteryId, record_type: r.recordType || 'lottery', project_id: r.projectId, parent_lottery_id: r.parentLotteryId, continuation_lottery_id: r.continuationLotteryId,
  lottery_type: r.lotteryType, round: r.round, program: r.program, program_he: r.programHe, marketing_method_code: r.marketingMethodCode,
  marketing_body: r.marketingBody, eligibility: r.eligibility, lottery_status: r.lotteryStatus, signup_end_date: r.signupEndDate,
  lottery_date: r.lotteryDate, locality_code: r.localityCode, city: r.city, neighborhood: r.neighborhood, project_name: r.projectName,
  developer: r.developer, project_status: r.projectStatusHe, permit_status: r.permitStatusHe, price_per_sqm: r.pricePerSqm,
  units_in_lottery: r.unitsInLottery, units_at_signup: r.unitsAtSignup, units_local_residents: r.unitsLocalResidents,
  applicants: r.applicants, winners: r.winners, first_seen_at: r.firstSeenAt,
  last_seen_at: r.inLatestSource === false ? r.lastSeenAt || r.firstSeenAt : checkedAt || r.firstSeenAt,
  in_latest_source: r.inLatestSource, provenance: r.provenance, record: r,
});

module.exports = { mergeRecords, FileHousingStore, SupabaseHousingStore, NOT_FACTS, linesJson, toRow, readRawSnapshot, verifyOfficialSnapshot };
