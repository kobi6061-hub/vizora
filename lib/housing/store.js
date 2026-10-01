// PROPX · government housing — persistence.
//
// Upsert-only, history-keeping storage of the normalized lottery records:
//   · upsert on the official id (lottery:<LotteryId>);
//   · firstSeenAt is set once (first observation by PROPX); lastSeenAt is the
//     latest fetch whose content contained the record. A run whose content
//     hash is unchanged rewrites nothing but meta.checkedAt and the run log —
//     every record with inLatestSource:true was observed at meta.checkedAt;
//   · a change in ANY official field appends a status-history event;
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

/* bookkeeping, not official facts: every other field of a record is diffed */
const NOT_FACTS = new Set(['id', 'provenance', 'missing', 'firstSeenAt', 'lastSeenAt', 'inLatestSource']);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const factKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !NOT_FACTS.has(k)).sort();

/** Pure merge of a fresh normalized fetch into the stored records. */
function mergeRecords(prev, next, { fetchedAt, syncRunId = null }) {
  const byId = new Map(prev.map((r) => [r.id, r]));
  const out = [], history = [];
  const stats = { inserted: 0, updated: 0, unchanged: 0, missingFromSource: 0 };
  const seen = new Set();
  for (const rec of next) {
    seen.add(rec.id);
    const old = byId.get(rec.id);
    if (!old) {
      out.push({ ...rec, firstSeenAt: fetchedAt, lastSeenAt: fetchedAt, inLatestSource: true });
      stats.inserted++;
      continue;
    }
    const changed = factKeys(old, rec).filter((k) => !same(old[k], rec[k]));
    for (const k of changed) history.push({ id: rec.id, field: k, from: old[k] ?? null, to: rec[k] ?? null, observedAt: fetchedAt, syncRunId });
    if (old.inLatestSource === false) history.push({ id: rec.id, field: 'inLatestSource', from: false, to: true, observedAt: fetchedAt, syncRunId });
    out.push({ ...rec, firstSeenAt: old.firstSeenAt, lastSeenAt: fetchedAt, inLatestSource: true });
    changed.length ? stats.updated++ : stats.unchanged++;
  }
  for (const old of prev) {
    if (seen.has(old.id)) continue;
    stats.missingFromSource++;
    if (old.inLatestSource !== false) history.push({ id: old.id, field: 'inLatestSource', from: true, to: false, observedAt: fetchedAt, syncRunId });
    out.push({ ...old, inLatestSource: false });        // kept, never deleted
  }
  out.sort((a, b) => a.lotteryId - b.lotteryId);
  return { records: out, history, stats };
}

/* one record per line: valid JSON, minimal git diffs */
const linesJson = (arr) => '[\n' + arr.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n';

class FileHousingStore {
  constructor(dir) { this.dir = dir; }
  p(f) { return path.join(this.dir, f); }
  readRecords() { try { return JSON.parse(fs.readFileSync(this.p('lotteries.json'), 'utf8')); } catch { return []; } }
  readMeta() { try { return JSON.parse(fs.readFileSync(this.p('meta.json'), 'utf8')); } catch { return null; } }
  /** Write the raw payload if its content hash is new; returns the file name or null. */
  snapshotRaw(rows, hash, fetchedAt) {
    const dir = this.p('raw');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).some((f) => f.includes(hash.slice(0, 12)))) return null;
    const name = `${fetchedAt.slice(0, 10)}-${hash.slice(0, 12)}.json.gz`;
    fs.writeFileSync(path.join(dir, name), zlib.gzipSync(JSON.stringify(rows), { level: 9 }));
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
  async post(table, rows, conflict) {
    for (let i = 0; i < rows.length; i += 500) {
      const r = await this.fetch(this.base + table + (conflict ? '?on_conflict=' + conflict : ''), {
        method: 'POST', body: JSON.stringify(rows.slice(i, i + 500)),
        headers: { apikey: this.key, Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json', 'Content-Profile': 'market',
          Prefer: (conflict ? 'resolution=merge-duplicates,' : '') + 'return=minimal' } });
      if (!r.ok) throw new Error(`supabase ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  }
  /** records === null: content unchanged — only the source row and the run are written */
  async write({ records, history = [], run, source, raw = null }) {
    await this.post('sources', [{ id: source.id, authority: source.authority, dataset: source.dataset, endpoint: run.endpoint || source.page,
      format: source.format, source_class: source.sourceClass, update_cadence: source.cadence, last_source_update: run.sourceUpdatedAt }], 'id');
    if (raw) await this.post('raw_snapshots', [{ source_id: source.id, content_hash: raw.hash, fetched_at: raw.fetchedAt,
      source_updated_at: run.sourceUpdatedAt, row_count: raw.rows.length, payload: raw.rows }], 'source_id,content_hash');
    if (records) await this.post('housing_lotteries', records.map(toRow), 'id');
    if (history.length) await this.post('housing_status_history', history.map((h) => ({ record_id: h.id, field: h.field,
      from_value: h.from, to_value: h.to, observed_at: h.observedAt, sync_run_id: h.syncRunId })));
    await this.post('sync_runs', [{ source_id: source.id, started_at: run.startedAt, finished_at: run.finishedAt,
      status: run.status === 'ok' ? 'ok' : run.status === 'partial' ? 'partial' : 'failed',
      rows_fetched: run.fetched || 0, rows_inserted: run.inserted || 0, rows_updated: run.updated || 0, rows_unchanged: run.unchanged || 0,
      rows_rejected: run.rejected || 0, source_updated_at: run.sourceUpdatedAt || null, snapshot_hash: run.snapshotHash || null,
      error: run.error || null, details: run }]);
  }
}
/* normalized record → market.housing_lotteries row */
const toRow = (r) => ({
  id: r.id, lottery_id: r.lotteryId, project_id: r.projectId, parent_lottery_id: r.parentLotteryId, continuation_lottery_id: r.continuationLotteryId,
  lottery_type: r.lotteryType, round: r.round, program: r.program, program_he: r.programHe, marketing_method_code: r.marketingMethodCode,
  marketing_body: r.marketingBody, eligibility: r.eligibility, lottery_status: r.lotteryStatus, signup_end_date: r.signupEndDate,
  lottery_date: r.lotteryDate, locality_code: r.localityCode, city: r.city, neighborhood: r.neighborhood, project_name: r.projectName,
  developer: r.developer, project_status: r.projectStatusHe, permit_status: r.permitStatusHe, price_per_sqm: r.pricePerSqm,
  units_in_lottery: r.unitsInLottery, units_at_signup: r.unitsAtSignup, units_local_residents: r.unitsLocalResidents,
  applicants: r.applicants, winners: r.winners, first_seen_at: r.firstSeenAt, last_seen_at: r.lastSeenAt,
  in_latest_source: r.inLatestSource, provenance: r.provenance, record: r,
});

module.exports = { mergeRecords, FileHousingStore, SupabaseHousingStore, NOT_FACTS, linesJson, toRow };
