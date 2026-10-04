// PROPX · Land & Tender — persistence.
//
// Upsert-only, history-keeping storage of the normalized tender records
// (the same discipline as lib/housing/store.js):
//   · upsert on the Authority's MichrazID (rmi:<id>); firstSeenAt set once;
//   · a change in a source field (HISTORY_FIELDS of lib/land/normalize.js —
//     status, lifecycle, dates, units, winners, lot/bid counts …) appends a
//     history event; nothing is ever deleted — a tender the list stops
//     returning is kept with inLatestSource:false;
//   · the list payload is snapshotted whenever its content changes
//     (data/land/raw/<date>-<hash>.json.gz); the detail payloads a run fetched
//     go to the Supabase raw_snapshots table when the project is configured
//     (each record carries its detail's content hash and fetch time either way).
//
// FileLandStore — data/land/ in the repository: tenders.json (one record per
//   line), plans.json (the xplan / inventory plans the tenders reference),
//   meta.json, history.jsonl, sync-runs.jsonl, raw/.
// SupabaseLandStore — market.land_tenders / land_lots / land_tender_history /
//   land_plans (+ sources, sync_runs, raw_snapshots) in the PROPX project.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { HISTORY_FIELDS, historyValue } = require('./normalize');

const NOT_FACTS = new Set(['id', 'provenance', 'missing', 'firstSeenAt', 'lastSeenAt', 'inLatestSource']);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const factKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !NOT_FACTS.has(k)).sort();

/** Pure merge of this run's records into the stored ones. presentIds: every id the list answer carried, even rows that failed normalization. */
function mergeRecords(prev, next, { fetchedAt, syncRunId = null, prevCheckedAt = null, presentIds = null }) {
  const byId = new Map(prev.map((r) => [r.id, r]));
  const out = [], history = [];
  const stats = { inserted: 0, updated: 0, unchanged: 0, rederived: 0, missingFromSource: 0, keptUnparsed: 0 };
  const seen = new Set();
  for (const rec of next) {
    seen.add(rec.id);
    const old = byId.get(rec.id);
    if (!old) { out.push({ ...rec, firstSeenAt: fetchedAt, inLatestSource: true }); stats.inserted++; continue; }
    const changed = HISTORY_FIELDS.filter((k) => !same(historyValue(old, k), historyValue(rec, k)));
    for (const k of changed) history.push({ id: rec.id, field: k, from: historyValue(old, k), to: historyValue(rec, k), observedAt: fetchedAt, syncRunId });
    if (old.inLatestSource === false) history.push({ id: rec.id, field: 'inLatestSource', from: false, to: true, observedAt: fetchedAt, syncRunId });
    const { lastSeenAt, ...keep } = old;
    if (changed.length) { out.push({ ...rec, firstSeenAt: old.firstSeenAt, inLatestSource: true }); stats.updated++; }
    else if (factKeys(keep, rec).some((k) => !same(keep[k], rec[k]))) { out.push({ ...rec, firstSeenAt: old.firstSeenAt, inLatestSource: true }); stats.rederived++; }
    else { out.push({ ...keep, inLatestSource: true }); stats.unchanged++; }
  }
  for (const old of prev) {
    if (seen.has(old.id)) continue;
    if (presentIds && presentIds.has(old.id)) { out.push(old); stats.keptUnparsed++; continue; }
    stats.missingFromSource++;
    if (old.inLatestSource !== false) {
      history.push({ id: old.id, field: 'inLatestSource', from: true, to: false, observedAt: fetchedAt, syncRunId });
      out.push({ ...old, inLatestSource: false, lastSeenAt: prevCheckedAt || old.lastSeenAt || null });
    } else out.push(old);
  }
  out.sort((a, b) => b.michrazId - a.michrazId);
  return { records: out, history, stats };
}

/* the tender's year, from the Authority's id (2026xxxx) */
const shardYear = (r) => String(r.michrazId).slice(0, 4);
/* a stored record carries no null-valued keys: a missing key reads as null everywhere (saves ~40% of tenders.json) */
const dropNulls = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
const linesJson = (arr) => '[\n' + arr.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n';

class FileLandStore {
  constructor(dir) { this.dir = dir; }
  p(f) { return path.join(this.dir, f); }
  readJson(f, dflt) { try { return JSON.parse(fs.readFileSync(this.p(f), 'utf8')); } catch { return dflt; } }
  /** the slim records with their lots re-attached from the per-year shards (lots-<year>.json) */
  readRecords() {
    const recs = this.readJson('tenders.json', []);
    const years = new Set(recs.filter((r) => r.lotsCount != null && !r.lots).map((r) => shardYear(r)));
    for (const y of years) { const lots = this.readJson(`lots-${y}.json`, {}); for (const r of recs) if (shardYear(r) === y && lots[r.id]) r.lots = lots[r.id]; }
    return recs;
  }
  readLots(year) { return this.readJson(`lots-${year}.json`, {}); }
  readPlans() { return this.readJson('plans.json', { xplan: [], inventory: [] }); }
  readMeta() { return this.readJson('meta.json', null); }
  readHistory() {
    let t = ''; try { t = fs.readFileSync(this.p('history.jsonl'), 'utf8'); } catch { return []; }
    return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  readRuns() {
    let t = ''; try { t = fs.readFileSync(this.p('sync-runs.jsonl'), 'utf8'); } catch { return []; }
    return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  snapshotRaw(rows, hash, fetchedAt, meta = {}) {
    const dir = this.p('raw');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).some((f) => f.includes(hash.slice(0, 12)))) return null;
    const name = `${fetchedAt.slice(0, 10)}-${hash.slice(0, 12)}.json.gz`;
    fs.writeFileSync(path.join(dir, name), zlib.gzipSync(JSON.stringify({ contentHash: hash, fetchedAt, endpoint: meta.endpoint || null, rows }), { level: 9 }));
    return name;
  }
  /** records / plans === null: unchanged, not rewritten */
  write({ records, plans = null, history = [], meta, run }) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (records) {
      fs.writeFileSync(this.p('tenders.json'), linesJson(records.map(({ lots, ...slim }) => dropNulls(slim))));
      const shards = new Map();
      for (const r of records) if (r.lots) { const y = shardYear(r); if (!shards.has(y)) shards.set(y, {}); shards.get(y)[r.id] = r.lots; }
      for (const [y, lots] of shards) fs.writeFileSync(this.p(`lots-${y}.json`), '{\n' + Object.entries(lots).map(([id, l]) => JSON.stringify(id) + ':' + JSON.stringify(l)).join(',\n') + '\n}\n');
    }
    if (plans) fs.writeFileSync(this.p('plans.json'), JSON.stringify(plans, null, 0).replace(/\},\{/g, '},\n{') + '\n');
    fs.writeFileSync(this.p('meta.json'), JSON.stringify(meta, null, 1) + '\n');
    if (history.length) fs.appendFileSync(this.p('history.jsonl'), history.map((h) => JSON.stringify(h)).join('\n') + '\n');
    fs.appendFileSync(this.p('sync-runs.jsonl'), JSON.stringify(run) + '\n');
  }
  appendRun(run) { fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(this.p('sync-runs.jsonl'), JSON.stringify(run) + '\n'); }
}

/** The same rows in the PROPX Supabase project (PostgREST, service role, server-side only). */
class SupabaseLandStore {
  constructor({ url, key, fetchImpl = globalThis.fetch }) {
    if (!url || !key) throw new Error('SupabaseLandStore needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    this.base = url.replace(/\/$/, '') + '/rest/v1/'; this.key = key; this.fetch = fetchImpl;
  }
  h(extra = {}) { return { apikey: this.key, Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json', 'Content-Profile': 'market', 'Accept-Profile': 'market', ...extra }; }
  async post(table, rows, conflict, resolution = 'merge-duplicates') {
    for (let i = 0; i < rows.length; i += 500) {
      const r = await this.fetch(this.base + table + (conflict ? '?on_conflict=' + conflict : ''), { method: 'POST', body: JSON.stringify(rows.slice(i, i + 500)),
        headers: this.h({ Prefer: (conflict ? `resolution=${resolution},` : '') + 'return=minimal' }) });
      if (!r.ok) throw new Error(`supabase ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  }
  async patch(path, body) {
    const r = await this.fetch(this.base + path, { method: 'PATCH', body: JSON.stringify(body), headers: this.h({ Prefer: 'return=minimal' }) });
    if (!r.ok) throw new Error(`supabase PATCH ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  async count(table) {
    const r = await this.fetch(this.base + table + '?select=id&limit=1', { headers: this.h({ Prefer: 'count=exact' }) });
    if (!r.ok) throw new Error(`supabase count ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const m = /\/(\d+)$/.exec((r.headers && r.headers.get && r.headers.get('content-range')) || '');
    return m ? Number(m[1]) : null;
  }
  /**
   * records: the records this run changed (null: list unchanged); all: every stored record.
   * When the project holds fewer tenders than PROPX, every record is written (a project configured late is never left behind).
   */
  async write({ records, all, history = [], allHistory = null, plans = null, run, source, raw = null, rawDetails = null, meta = null }) {
    /* market.sources keeps the foundation's coarse classes; the registry's finer class travels in notes */
    const src = (id, endpoint, note) => ({ id, authority: source.publisher, dataset: source.name, endpoint, format: 'json-api', source_class: 'CONFIRMED_STRUCTURED',
      update_cadence: source.cadence, last_source_update: run.sourceUpdatedAt || null, notes: `${source.classification}${note ? ' · ' + note : ''}`, updated_at: new Date().toISOString() });
    await this.post('sources', [src(source.id, source.endpoints.search), src(source.id + ':detail', source.endpoints.detail, 'per-tender detail payloads fetched on a budget')], 'id');
    const have = await this.count('land_tenders');
    const behind = have == null || have < all.length;
    const rows = behind ? all : records;
    if (raw && (records || behind)) await this.post('raw_snapshots', [{ source_id: source.id, content_hash: raw.hash, fetched_at: raw.fetchedAt, source_updated_at: null,
      row_count: raw.rows.length, payload: raw.rows, run_key: run.id }], 'source_id,content_hash', 'ignore-duplicates');
    if (rawDetails && rawDetails.rows.length) await this.post('raw_snapshots', [{ source_id: source.id + ':detail', content_hash: rawDetails.hash, fetched_at: rawDetails.fetchedAt,
      source_updated_at: null, row_count: rawDetails.rows.length, payload: rawDetails.rows, run_key: run.id }], 'source_id,content_hash', 'ignore-duplicates');
    const checkedAt = run.finishedAt || run.startedAt;
    if (rows && rows.length) {
      await this.post('land_tenders', rows.map((r) => toTenderRow(r, checkedAt)), 'id');
      const lots = rows.flatMap((r) => (r.lots || []).map((l) => toLotRow(r, l)));
      if (lots.length) await this.post('land_lots', lots, 'tender_id,lot_id');
    } else await this.patch('land_tenders?in_latest_source=eq.true', { last_seen_at: checkedAt });
    if (plans) {
      const prow = [...plans.xplan.map((p) => ({ plan_key: p.planKey, plan_number: p.plan, source_id: 'iplan:xplan', station: p.station, approved_units: p.approvedUnits, approval_date: p.approvalDate,
        potential_units: null, as_of: p.lastUpdate, record: p })), ...plans.inventory.map((p) => ({ plan_key: p.planKey, plan_number: p.plan, source_id: p.provenance.source, station: p.stage,
        approved_units: null, approval_date: p.approvalDate, potential_units: p.potentialUnits, as_of: p.asOf, record: p }))];
      if (prow.length) await this.post('land_plans', prow, 'plan_key,source_id');
    }
    const events = allHistory && (await this.count('land_tender_history')) !== allHistory.length ? allHistory : history;
    if (events.length) await this.post('land_tender_history', events.map((h) => ({ record_id: h.id, field: h.field, from_value: h.from, to_value: h.to, observed_at: h.observedAt, run_key: h.syncRunId })),
      'record_id,field,observed_at,run_key', 'ignore-duplicates');
    await this.post('sync_runs', [{ run_key: run.id, source_id: source.id, started_at: run.startedAt, finished_at: run.finishedAt,
      status: run.status === 'ok' ? 'ok' : run.status === 'partial' ? 'partial' : 'failed', rows_fetched: run.fetched || 0, rows_inserted: run.inserted || 0,
      rows_updated: run.updated || 0, rows_unchanged: run.unchanged || 0, rows_rejected: run.rejected || 0, source_updated_at: null, snapshot_hash: run.snapshotHash || null,
      error: run.error || null, details: meta ? { ...run, meta } : run }]);
  }
}
const toTenderRow = (r, checkedAt) => ({
  id: r.id, michraz_id: r.michrazId, name: r.name ?? null, status_code: r.statusCode ?? null, lifecycle: r.lifecycle ?? null, award_scope: r.awardScope ?? null, type_code: r.typeCode ?? null,
  purpose_code: r.purposeCode ?? null, track: r.track ?? null, region_code: r.regionCode ?? null, locality_code: r.localityCode ?? null, neighborhood: r.neighborhood ?? null, units: r.units ?? null,
  published_date: r.publishedDate ?? null, open_date: r.openDate ?? null, close_date: r.closeDate ?? null, committee_date: r.committeeDate ?? null, lottery_date: r.lotteryDate ?? null,
  price_basis: r.priceBasis ?? null, lots: r.lotsCount ?? null, awarded_lots: r.economics ? r.economics.awardedLots ?? null : null, awarded_units: r.economics ? r.economics.awardedUnits ?? null : null,
  awarded_land_total: r.economics ? r.economics.awardedLandTotal ?? null : null, land_per_unit: r.economics ? r.economics.landPerUnit ?? null : null,
  lat: r.geometry ? r.geometry.lat : null, lng: r.geometry ? r.geometry.lng : null, geo_basis: r.geometry ? 'tender-polygon-centroid' : r.localityCode ? 'locality' : null,
  detail_level: r.lotsCount != null ? 'detail' : 'list', detail_fetched_at: r.provenance && r.provenance.detail ? r.provenance.detail.fetchedAt : null, first_seen_at: r.firstSeenAt,
  last_seen_at: r.inLatestSource === false ? r.lastSeenAt || r.firstSeenAt : checkedAt || r.firstSeenAt, in_latest_source: r.inLatestSource !== false, provenance: r.provenance, record: { ...r, lots: undefined },
});
const toLotRow = (r, l) => ({
  tender_id: r.id, lot_id: l.lotId, name: l.name ?? null, area_sqm: l.areaSqm ?? null, units: l.units ?? null, development_cost: l.developmentCost ?? null, minimum_price: l.minimumPrice ?? null,
  appraisal: l.appraisal ?? null, ceiling_per_sqm: l.ceilingPerSqm ?? null, winner_name: l.winner ? l.winner.name : null, winner_amount: l.winner ? l.winner.amount : null,
  winner_evidence: l.winner ? l.winner.evidence : null, bids: (l.bids || []).length, price_basis: l.economics ? l.economics.basis ?? null : null,
  land_per_unit: l.economics ? l.economics.landPerUnit ?? null : null, source_note: l.sourceNote ?? null, record: l,
});

module.exports = { mergeRecords, FileLandStore, SupabaseLandStore, NOT_FACTS, linesJson, toTenderRow, toLotRow, shardYear };
