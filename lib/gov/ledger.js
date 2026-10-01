// PROPX · transaction ledger — the persistent record of every official
// transaction PROPX has observed.
//
// Transactions reach the official source AFTER they happen (reporting and
// publication lag), so a recent period is never treated as closed: every
// refresh asks for the newest rows AND re-checks a rolling window of recent
// transaction dates (default 120 days), and the ledger UPSERTS what comes
// back. Rules:
//   · identity = recordKey (fingerprint.js): the official id, or an id-less
//     row's fingerprint + its occurrence number in one response;
//   · first_seen_at is set once — when PROPX first observed the row — and
//     never rewritten; last_seen_at moves on every observation; together
//     with transaction_date they let reporting lag be MEASURED later;
//   · a changed row (same identity, different facts) is updated in place and
//     its earlier facts are kept in `revisions` (newest first, last 20);
//   · nothing is ever deleted because a later response did not return it.
//
// Backends implement get/put/all: MemoryLedgerStore (tests),
// FileLedgerStore (a JSON ledger the scheduled job commits),
// SupabaseLedgerStore (market.transactions via PostgREST, service role).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { dedupe, addressFingerprint } = require('./fingerprint');
const { fieldValue } = require('./schema');

const DAY = 86400000;
const BACKFILL_DAYS = Number(process.env.TX_BACKFILL_DAYS) || 120;

/** The transaction-date window a refresh re-checks: [today − days, today]. */
function backfillWindow(now = new Date(), days = BACKFILL_DAYS) {
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(now.getTime() - days * DAY)), to: iso(now), days };
}

const REVISION_FIELDS = ['transaction_date', 'city', 'street', 'house_number', 'block', 'parcel', 'sub_parcel', 'price', 'area_sqm',
  'rooms', 'floor', 'deal_type', 'newness'];
const FACT_FIELDS = ['date', 'city', 'street', 'houseNumber', 'block', 'parcel', 'subParcel', 'price', 'areaSqm',
  'rooms', 'floor', 'dealType', 'sourceClassification', 'newness'];
const facts = (tx) => Object.fromEntries(FACT_FIELDS.map((k) => [k, fieldValue(tx[k]) ?? null]));
const hashFacts = (tx) => createHash('sha1').update(JSON.stringify(facts(tx))).digest('hex');
const provList = (tx) => (Array.isArray(tx.provenance) ? tx.provenance : [tx.provenance]).filter(Boolean);

/** One ledger row from a normalized transaction (raw echo kept server-side). */
function toLedgerRow(sourceId, tx, fetchedAt) {
  const f = facts(tx), p = provList(tx);
  const [fp, ordinal] = tx.recordKey.startsWith('fp:') ? tx.recordKey.split('#') : [addressFingerprint(tx), null];
  return {
    source_id: sourceId, record_key: tx.recordKey,
    source_record_id: tx.txId || null, fingerprint: fp, ordinal: ordinal ? Number(ordinal) : null,
    transaction_date: f.date, first_seen_at: fetchedAt, last_seen_at: fetchedAt,
    source_published_at: p.map((x) => x.sourcePublishedAt).find(Boolean) || null,
    city: f.city, street: f.street, house_number: f.houseNumber == null ? null : String(f.houseNumber),
    block: f.block, parcel: f.parcel, sub_parcel: f.subParcel, price: f.price, area_sqm: f.areaSqm,
    rooms: f.rooms, floor: f.floor, deal_type: f.dealType ?? f.sourceClassification, newness: f.newness,
    content_hash: hashFacts(tx),
    provenance: p.map(({ raw, ...rest }) => rest),
    raw: p.map((x) => x.raw).filter((x) => x !== undefined),
  };
}

class TxLedger {
  constructor(store) { this.store = store; }

  /**
   * Upsert one refresh's rows. `txs` may hold overlapping duplicates (several
   * requests covering the same deals) — they are deduplicated by identity
   * first. Returns {inserted, updated, unchanged, rejected}.
   */
  async upsert(sourceId, txs, { fetchedAt = new Date().toISOString() } = {}) {
    const rows = dedupe(txs.slice());
    const stats = { inserted: 0, updated: 0, unchanged: 0, rejected: 0 };
    const keep = [];
    for (const tx of rows) {
      if (!tx.date || !/^\d{4}-\d{2}-\d{2}/.test(tx.date)) { stats.rejected++; continue; }   // no date → cannot be placed in time
      keep.push(toLedgerRow(sourceId, tx, fetchedAt));
    }
    const existing = await this.store.getMany(sourceId, keep.map((r) => r.record_key));
    const writes = [];
    for (const r of keep) {
      const old = existing.get(r.record_key);
      if (!old) { stats.inserted++; writes.push(r); continue; }
      r.first_seen_at = old.first_seen_at;                                  // set once, never rewritten
      if (old.content_hash === r.content_hash) { stats.unchanged++; writes.push({ ...old, last_seen_at: fetchedAt }); continue; }
      stats.updated++;
      const was = { replaced_at: fetchedAt, content_hash: old.content_hash, last_seen_at: old.last_seen_at };
      for (const k of REVISION_FIELDS) was[k] = old[k] ?? null;
      writes.push({ ...r, revisions: [was, ...(old.revisions || [])].slice(0, 20) });
    }
    await this.store.putMany(sourceId, writes);
    return stats;
  }
}

class MemoryLedgerStore {
  constructor() { this.m = new Map(); }
  async getMany(sourceId, keys) {
    const out = new Map();
    for (const k of keys) { const r = this.m.get(sourceId + '\u0000' + k); if (r) out.set(k, r); }
    return out;
  }
  async putMany(sourceId, rows) { for (const r of rows) this.m.set(sourceId + '\u0000' + r.record_key, r); }
  async all(sourceId) { return [...this.m.values()].filter((r) => r.source_id === sourceId); }
}

/** A JSON ledger per source on disk — what the scheduled job commits. */
class FileLedgerStore {
  constructor(dir) { this.dir = dir; }
  file(sourceId) { return path.join(this.dir, sourceId.replace(/[^a-zA-Z0-9._-]+/g, '_') + '.json'); }
  load(sourceId) {
    try { return JSON.parse(fs.readFileSync(this.file(sourceId), 'utf8')); } catch { return { source_id: sourceId, rows: {} }; }
  }
  async getMany(sourceId, keys) {
    const doc = this.load(sourceId), out = new Map();
    for (const k of keys) if (doc.rows[k]) out.set(k, doc.rows[k]);
    return out;
  }
  async putMany(sourceId, rows) {
    const doc = this.load(sourceId);
    for (const r of rows) doc.rows[r.record_key] = r;
    fs.mkdirSync(this.dir, { recursive: true });
    // stable order → minimal diffs in the committed ledger
    const sorted = Object.fromEntries(Object.entries(doc.rows).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    fs.writeFileSync(this.file(sourceId), JSON.stringify({ source_id: sourceId, rows: sorted }, null, 1) + '\n');
  }
  async all(sourceId) { return Object.values(this.load(sourceId).rows); }
}

/** market.transactions in the PROPX Supabase project (PostgREST, service role). */
class SupabaseLedgerStore {
  constructor({ url, key, fetchImpl = globalThis.fetch }) {
    if (!url || !key) throw new Error('SupabaseLedgerStore needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    this.url = url.replace(/\/$/, '') + '/rest/v1/transactions';
    this.key = key; this.fetch = fetchImpl;
  }
  headers(extra) {
    return { apikey: this.key, Authorization: 'Bearer ' + this.key, 'Accept-Profile': 'market', 'Content-Profile': 'market',
      'Content-Type': 'application/json', ...extra };
  }
  async getMany(sourceId, keys) {
    const out = new Map();
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = keys.slice(i, i + 200).map((k) => '"' + k.replace(/"/g, '\\"') + '"').join(',');
      const q = `?select=*&source_id=eq.${encodeURIComponent(sourceId)}&record_key=in.(${encodeURIComponent(chunk)})`;
      const r = await this.fetch(this.url + q, { headers: this.headers() });
      if (!r.ok) throw new Error(`ledger read ${r.status}: ${(await r.text()).slice(0, 200)}`);
      for (const row of await r.json()) out.set(row.record_key, row);
    }
    return out;
  }
  async putMany(sourceId, rows) {
    for (let i = 0; i < rows.length; i += 500) {
      const body = rows.slice(i, i + 500).map((r) => ({ ...r, revisions: r.revisions || [] }));
      const r = await this.fetch(this.url + '?on_conflict=source_id,record_key', {
        method: 'POST', headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`ledger write ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  }
}

module.exports = { TxLedger, MemoryLedgerStore, FileLedgerStore, SupabaseLedgerStore, backfillWindow, toLedgerRow, BACKFILL_DAYS };
