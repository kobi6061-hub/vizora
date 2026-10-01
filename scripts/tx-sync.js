#!/usr/bin/env node
// PROPX · scheduled transaction refresh with a rolling backfill.
//
// For every watch target (data/transactions/watch.json) it asks the official
// source (the Tax Authority deals layer served by GovMap) for the freshest
// deals AND re-checks the last BACKFILL_DAYS of transaction dates — deals
// reach the source weeks after they happen, so recent periods are never
// treated as closed — and upserts the result into the transaction ledger
// (lib/gov/ledger.js): new rows are added with first_seen_at, changed rows
// are updated, nothing is deleted. Every run is logged.
//
// Ledger backend: the PROPX Supabase project when SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set (server-side secrets), otherwise the
// JSON ledger under data/transactions/ledger/ that the workflow commits.
//
//   node scripts/tx-sync.js                 refresh every target, write
//   node scripts/tx-sync.js --dry-run       fetch and report, write nothing
//
// Every area's run records whether its re-check window was really covered
// (windowCheck complete / partial / unknown / not-checked, with the gaps —
// lib/gov/tx-refresh.js); a capped, cut, refused or timed-out sweep is never
// recorded as complete. The same core runs server-side in
// api/jobs/tx-refresh.js.
//
// Exit: 0 all targets OK · 2 partial · 1 nothing usable · 3 the source
// refused this environment (HTTP 401/403 on every target): recorded as
// "refused", nothing written to the ledger, never worked around.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { GovMapProvider } = require('../lib/gov/providers/govmap');
const { MemoryStore } = require('../lib/gov/store');
const { TxLedger, FileLedgerStore, SupabaseLedgerStore, MemoryLedgerStore } = require('../lib/gov/ledger');
const { refreshTargets, summarize, exitCodeOf, recordRunsSupabase } = require('../lib/gov/tx-refresh');
const { storeConfig, redact } = require('../lib/store-config');

const ROOT = path.join(__dirname, '..', 'data', 'transactions');
const has = (f) => process.argv.includes('--' + f);
const STORE = storeConfig(process.env);     // a malformed value stops the run — it is never echoed

function ledgerStore() {
  if (has('dry-run')) return new MemoryLedgerStore();
  return STORE.ok ? new SupabaseLedgerStore({ url: STORE.url, key: STORE.key }) : new FileLedgerStore(path.join(ROOT, 'ledger'));
}

(async () => {
  if (STORE.reason === 'store-misconfigured' && !has('dry-run')) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set but malformed (https://<project>.supabase.co expected) — nothing was written');
  }
  const now = new Date();
  const runKey = 'tx-' + now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const targets = JSON.parse(fs.readFileSync(path.join(ROOT, 'watch.json'), 'utf8')).targets;
  const result = await refreshTargets({ provider: new GovMapProvider({ store: new MemoryStore() }), ledger: new TxLedger(ledgerStore()),
    targets, now, runKey });
  for (const r of result.runs) console.log(JSON.stringify(r));
  if (!has('dry-run')) {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.appendFileSync(path.join(ROOT, 'sync-runs.jsonl'), result.runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    if (STORE.ok) {
      try { await recordRunsSupabase({ url: STORE.url, key: STORE.key }, result.runs); }
      catch (e) { console.error('run log not written to Supabase:', redact(e.message)); process.exitCode = 1; }
    }
  }
  const summary = summarize(result, now);
  console.log(summary);
  const sf = process.argv.indexOf('--summary-file');
  if (sf > -1) fs.appendFileSync(process.argv[sf + 1], summary + '\n');
  process.exitCode = process.exitCode || exitCodeOf(result.runs);
})().catch((e) => { console.error('tx-sync failed:', redact(e.message)); process.exitCode = 1; });
