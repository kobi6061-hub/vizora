#!/usr/bin/env node
// PROPX · verify the dedicated PROPX Supabase project after its migrations
// and first syncs. Read-only; prints a checklist, never a secret.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… [SUPABASE_ANON_KEY=…] node scripts/supabase-verify.js
//   … --snapshot <file>   also write the store's counts to <file> (JSON)
//   … --same-as <file>    and check they equal an earlier --snapshot (idempotency:
//                         a second sync of unchanged content adds nothing)
//
// Expected values come from the repository's own synced data (data/housing/),
// never from constants. Exit 0 only if every check passes.
// (.github/workflows/supabase-verify.yml runs sync → verify → sync → verify.)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SOURCE } = require('../lib/housing/source');
const { storeConfig, redact } = require('../lib/store-config');

const STORE = storeConfig(process.env);
const { url: URL_, key: KEY } = STORE;
const ANON = String(process.env.SUPABASE_ANON_KEY || '').trim();
const arg = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const ROOT = path.join(__dirname, '..');
let fail = 0;
const check = (name, ok, detail = '') => { if (!ok) fail++; console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`); };

async function rest(pathq, { key = KEY, count = false } = {}) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/rest/v1/' + pathq, {
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Accept-Profile': 'market', ...(count ? { Prefer: 'count=exact', Range: '0-0' } : {}) } });
  let body = null; try { body = await r.json(); } catch { /* empty */ }
  const total = count ? Number((/\/(\d+)$/.exec(r.headers.get('content-range') || '') || [])[1]) : null;
  return { status: r.status, body, total };
}
const n = async (q) => (await rest(q, { count: true })).total;

(async () => {
  if (!STORE.ok) { console.error(`${STORE.reason}: SUPABASE_URL (https://<project>.supabase.co) and SUPABASE_SERVICE_ROLE_KEY are required (server-side secrets).`); process.exit(2); }
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'housing', 'meta.json'), 'utf8'));
  const recs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'housing', 'lotteries.json'), 'utf8'));
  const want = { records: recs.length, lottery: recs.filter((r) => (r.recordType || 'lottery') === 'lottery').length,
    other: recs.filter((r) => (r.recordType || 'lottery') !== 'lottery').length, delisted: recs.filter((r) => r.inLatestSource === false).length };

  console.log('schema · migrations applied, market schema exposed to the service role');
  for (const t of ['sources', 'sync_runs', 'raw_snapshots', 'geo_links', 'transactions', 'housing_lotteries', 'housing_status_history',
    'housing_projects', 'housing_provenance', 'transaction_reporting_lag']) {
    const r = await rest(`${t}?limit=1`);
    check(`market.${t} readable by the service role`, r.status === 200, r.status === 200 ? '' : `HTTP ${r.status} ${redact(JSON.stringify(r.body)).slice(0, 120)}`);
  }
  const m4 = await rest('sync_runs?select=target,window_check&limit=1');
  check('migration 20261001120300 (run target + window check) applied', m4.status === 200, m4.status === 200 ? '' : redact(JSON.stringify(m4.body)).slice(0, 120));

  console.log('access · nothing is public');
  if (ANON) {
    for (const t of ['housing_lotteries', 'transactions', 'sync_runs']) {
      const r = await rest(`${t}?limit=1`, { key: ANON });
      check(`anon key refused on market.${t}`, r.status === 401 || r.status === 403 || (r.body && r.body.code === '42501'), `HTTP ${r.status}`);
    }
  } else console.log('  · SUPABASE_ANON_KEY not given — the anon refusal is not checked');

  console.log('housing · the store holds what PROPX synced');
  const got = { records: await n('housing_lotteries?select=id'), lottery: await n('housing_lotteries?select=id&record_type=eq.lottery'),
    other: await n('housing_lotteries?select=id&record_type=neq.lottery'), delisted: await n('housing_lotteries?select=id&in_latest_source=eq.false'),
    history: await n('housing_status_history?select=id'), runs: await n(`sync_runs?select=id&source_id=eq.${encodeURIComponent(SOURCE.id)}`),
    raw: await n(`raw_snapshots?select=id&source_id=eq.${encodeURIComponent(SOURCE.id)}`) };
  check(`records = ${want.records} (data/housing)`, got.records === want.records, `store ${got.records}`);
  check(`lotteries = ${want.lottery}`, got.lottery === want.lottery, `store ${got.lottery}`);
  check(`non-lottery official rows (grants program) = ${want.other}, kept apart`, got.other === want.other, `store ${got.other}`);
  check(`no longer listed by the source = ${want.delisted} (kept, never deleted)`, got.delisted === want.delisted, `store ${got.delisted}`);
  const [last] = (await rest(`sync_runs?select=run_key,status,snapshot_hash,details&source_id=eq.${encodeURIComponent(SOURCE.id)}&status=eq.ok&order=finished_at.desc&limit=1`)).body || [];
  check('the latest housing run is ok and carries its meta (the read side needs it)', !!(last && last.details && last.details.meta), last ? last.run_key : 'no run');
  check('its snapshot hash is the content PROPX synced', !!last && last.snapshot_hash === meta.snapshotHash, last ? String(last.snapshot_hash).slice(0, 12) : '');
  const raw = (await rest(`raw_snapshots?select=row_count&source_id=eq.${encodeURIComponent(SOURCE.id)}&content_hash=eq.${meta.snapshotHash}`)).body || [];
  check('the raw official payload of that content is stored once', raw.length === 1 && raw[0].row_count === meta.rows, raw.length ? `${raw[0].row_count} rows` : 'missing');

  const snap = arg('snapshot'), same = arg('same-as');
  if (snap) fs.writeFileSync(snap, JSON.stringify(got));
  if (same) {
    console.log('idempotency · a second sync of unchanged content');
    const before = JSON.parse(fs.readFileSync(same, 'utf8'));
    for (const k of ['records', 'lottery', 'other', 'delisted', 'history', 'raw']) check(`${k} unchanged (${before[k]})`, before[k] === got[k], `now ${got[k]}`);
    check('one more sync run recorded', got.runs === before.runs + 1, `${before.runs} → ${got.runs}`);
  }
  console.log(fail ? `\nSUPABASE VERIFY: ${fail} FAILED` : '\nSUPABASE VERIFY: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('verify failed:', redact(e.message)); process.exit(1); });
