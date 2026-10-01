// POST /api/jobs/tx-refresh?mode=probe|run — the transaction refresh inside
// PROPX's own server runtime (Vercel), for when the official source refuses
// the GitHub runner. Machine-only: middleware.js lets exactly this path past
// the browser session gate, and this function authenticates instead with a
// bearer token — PROPX_JOB_TOKEN, set only in the Vercel project's environment
// and in the caller's secret store (.github/workflows/tx-refresh.yml).
// Fail-closed: no token configured (or one shorter than 32 characters) → 503,
// a wrong or missing token → 401, anything but POST → 405.
//
//   mode=probe  one official request — the address lookup every refresh starts
//               with — answering "does the source accept this runtime?".
//               Nothing is written.
//   mode=run    every watched area (data/transactions/watch.json), the rolling
//               re-check window, upsert into the PROPX Supabase ledger
//               (server-side SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) and one
//               sync run per area with its window check (lib/gov/tx-refresh.js).
//               Without a store it refuses (503): nothing is fetched that could
//               not be kept. A refused, timed-out, capped or cut sweep is never
//               recorded as complete. Each area is recorded "running" before it
//               starts and with its result after, so a run the platform kills at
//               its time limit leaves a "running" row, not a silent gap. Every
//               official request has its own timeout and no area starts after
//               the job deadline, keeping the job inside maxDuration (60 s).
// The answer carries run records only — never transaction rows, never a secret
// (texts are redacted before they are cut).

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { GovMapProvider } = require('../../lib/gov/providers/govmap');
const { MemoryStore } = require('../../lib/gov/store');
const { TxLedger, SupabaseLedgerStore } = require('../../lib/gov/ledger');
const { refreshTargets, recordRunsSupabase, summarize, failureOf } = require('../../lib/gov/tx-refresh');
const { storeConfig, redact } = require('../../lib/store-config');

const WATCH = path.join(__dirname, '..', '..', 'data', 'transactions', 'watch.json');
const MIN_TOKEN = 32;
/* time budget inside maxDuration 60 s: an area starts only before AREA_START_MS; it then needs at most
   lookup + polygons (REQUEST_MS each) + the sweep budget (SWEEP_MS) + one last request ≈ 34 s */
const REQUEST_MS = 8000, SWEEP_MS = 10000, AREA_START_MS = 20000;
const timed = (fetchImpl, ms) => (url, init = {}) => fetchImpl(url, { ...init, signal: init.signal || AbortSignal.timeout(ms) });

/** 'ok' | 'denied' | 'not-configured' — constant-time, on digests of equal length */
function authorized(req, env) {
  const want = String(env.PROPX_JOB_TOKEN || '');
  if (want.length < MIN_TOKEN) return 'not-configured';
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String((req.headers && req.headers.authorization) || ''));
  const got = m ? m[1] : '';
  const h = (x) => crypto.createHash('sha256').update(x).digest();
  return crypto.timingSafeEqual(h(got), h(want)) && got.length >= MIN_TOKEN ? 'ok' : 'denied';
}

const send = (res, code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };

function makeHandler({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date(), budgetMs = SWEEP_MS } = {}) {
  /* an error text never carries the project's address, a key or the token — redacted first, then cut */
  const clean = (msg) => redact(msg, env).slice(0, 300);
  const runtime = { platform: env.VERCEL ? 'vercel' : 'node', region: env.VERCEL_REGION || null, env: env.VERCEL_ENV || null,
    commit: env.VERCEL_GIT_COMMIT_SHA || null };
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method-not-allowed' }); }
    const auth = authorized(req, env);
    if (auth === 'not-configured') return send(res, 503, { error: 'job-not-configured' });
    if (auth !== 'ok') return send(res, 401, { error: 'unauthorized' });
    const mode = new URL(req.url, 'http://x').searchParams.get('mode') || 'run';
    if (mode !== 'probe' && mode !== 'run') return send(res, 400, { error: 'unknown-mode' });
    const targets = JSON.parse(fs.readFileSync(WATCH, 'utf8')).targets;
    const provider = new GovMapProvider({ store: new MemoryStore(), fetchImpl: timed(fetchImpl, REQUEST_MS) });
    if (mode === 'probe') {
      const tg = targets[0], at = now().toISOString(), request = 'govmap search-service/autocomplete';
      try {   // the raw request: did the source accept this runtime? (an empty answer is still an answer)
        const results = await provider.autocomplete(tg.city);
        return send(res, 200, { mode, at, runtime, target: tg.id, request, reachable: true, results: results.length });
      } catch (e) {
        return send(res, 200, { mode, at, runtime, target: tg.id, request, reachable: false, status: failureOf(e), error: clean(e.message) });
      }
    }
    const cfg = storeConfig(env);   // store-not-configured | store-misconfigured: said, never echoed
    if (!cfg.ok) return send(res, 503, { error: cfg.reason });
    const started = now();
    const runKey = 'txjob-' + started.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const deadline = Date.now() + Math.min(Number(env.TX_JOB_BUDGET_MS) || AREA_START_MS, AREA_START_MS);
    const store = { url: cfg.url, key: cfg.key, fetchImpl: timed(fetchImpl, REQUEST_MS) };
    let first = true;
    const record = async (r) => { await recordRunsSupabase({ ...store, withSource: first }, [r]); first = false; };
    const result = await refreshTargets({ provider, ledger: new TxLedger(new SupabaseLedgerStore(store)), targets, now: started, runKey,
      deadline, budgetMs, onStart: record, onRun: record, redactText: (m) => redact(m, env) });
    const runs = result.runs.map((r) => (r.error ? { ...r, error: clean(r.error) } : r));
    const recordError = result.recordErrors.length ? clean(result.recordErrors.join(' · ')) : null;
    return send(res, 200, { mode, runKey, runtime, window: result.window, summary: summarize(result, started), recorded: !recordError, recordError, runs });
  };
}

module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
module.exports.authorized = authorized;
