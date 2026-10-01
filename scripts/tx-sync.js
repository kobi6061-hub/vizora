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
// Exit: 0 all targets OK · 2 partial · 1 nothing usable · 3 the source
// refused this environment (HTTP 401/403 on every target): recorded as
// "refused", nothing written to the ledger, never worked around.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { GovMapProvider } = require('../lib/gov/providers/govmap');
const { MemoryStore } = require('../lib/gov/store');
const { TxLedger, FileLedgerStore, SupabaseLedgerStore, MemoryLedgerStore, backfillWindow } = require('../lib/gov/ledger');

const ROOT = path.join(__dirname, '..', 'data', 'transactions');
const has = (f) => process.argv.includes('--' + f);
const SOURCE_ID = 'govmap:tax-authority-deals';

function ledgerStore() {
  if (has('dry-run')) return new MemoryLedgerStore();
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  return url && key ? new SupabaseLedgerStore({ url, key }) : new FileLedgerStore(path.join(ROOT, 'ledger'));
}

(async () => {
  const now = new Date();
  const win = backfillWindow(now);
  const targets = JSON.parse(fs.readFileSync(path.join(ROOT, 'watch.json'), 'utf8')).targets;
  const provider = new GovMapProvider({ store: new MemoryStore() });
  const ledger = new TxLedger(ledgerStore());
  const runs = [];
  for (const tg of targets) {
    const started = new Date().toISOString();
    try {
      // months spans the re-check window plus the current month
      const rows = await provider.getTransactions({ city: tg.city, street: tg.street || null, houseNumber: tg.house ?? null },
        { months: Math.ceil(win.days / 30) + 1, radiusM: tg.radiusM, limit: tg.limit });
      const fetchedAt = new Date().toISOString();
      const st = await ledger.upsert(SOURCE_ID, rows, { fetchedAt });
      const dates = rows.map((r) => r.date).filter(Boolean).sort();
      /* was the window really re-checked? not if the sweep was capped, cut by its time budget, hit a page limit or lost requests */
      const d = rows.diagnostics || null;
      const complete = d ? d.polygonsQueried >= d.polygonsPlanned && d.polygonsPlanned >= d.polygonsAvailable
        && d.requestsRun >= d.requestsPlanned && !d.polyErrors && !d.pageLimitHits : null;
      runs.push({ target: tg.id, status: 'ok', startedAt: started, finishedAt: new Date().toISOString(),
        window: { from: win.from, to: win.to }, windowCheck: complete === true ? 'complete' : complete === false ? 'partial' : 'unknown',
        fetched: rows.length, ...st, newestTransactionDate: dates[dates.length - 1] || null, coverage: d });
    } catch (e) {
      const refused = /\bHTTP 40[13]\b/.test(e.message);
      runs.push({ target: tg.id, status: refused ? 'refused' : 'failed', startedAt: started, finishedAt: new Date().toISOString(),
        window: { from: win.from, to: win.to }, error: e.message });
    }
  }
  for (const r of runs) console.log(JSON.stringify(r));
  if (!has('dry-run')) {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.appendFileSync(path.join(ROOT, 'sync-runs.jsonl'), runs.map((r) => JSON.stringify({ source: SOURCE_ID, ...r })).join('\n') + '\n');
  }
  const ok = runs.filter((r) => r.status === 'ok').length;
  const sum = (k) => runs.reduce((a, r) => a + (r[k] || 0), 0);
  const refused = runs.filter((r) => r.status === 'refused').length;
  const partial = runs.filter((r) => r.windowCheck === 'partial').length;
  const summary = `Transactions ${now.toISOString().slice(0, 10)} — ${ok}/${runs.length} targets · window ${win.from}…${win.to} · +${sum('inserted')} new · ${sum('updated')} changed · ${sum('unchanged')} unchanged`
    + (partial ? ` · window only partly re-checked on ${partial} (polygon cap / time budget / page limit)` : '')
    + (refused ? ` · source refused access on ${refused}` : '');
  console.log(summary);
  const sf = process.argv.indexOf('--summary-file');
  if (sf > -1) fs.appendFileSync(process.argv[sf + 1], summary + '\n');
  process.exitCode = ok === runs.length ? 0 : ok ? 2 : refused === runs.length ? 3 : 1;
})().catch((e) => { console.error('tx-sync failed:', e.message); process.exitCode = 1; });
