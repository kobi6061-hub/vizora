// POST /api/jobs/tx-refresh?mode=probe|run — the transaction refresh inside
// PROPX's own server runtime (Vercel), for when the official source refuses
// the GitHub runner. Machine-only: middleware.js lets exactly this path past
// the browser session gate, and this function authenticates instead with a
// bearer token: either PROPX_JOB_TOKEN (set only in the Vercel project's
// environment and in the caller's secret store), or a GitHub Actions OIDC
// token minted for audience "propx-jobs" by .github/workflows/tx-refresh.yml
// of this repository on its production branch (lib/gov/oidc.js — signature and
// every identity claim verified; nothing to configure, nothing shared).
// Fail-closed: a non-JWT bearer with no PROPX_JOB_TOKEN configured (or one
// shorter than 32 characters) → 503, a wrong, missing or unverifiable token →
// 401, anything but POST → 405.
//
//   mode=probe  one official request — the address lookup every refresh starts
//               with — answering "does the source accept this runtime?", with
//               the status, the serving edge's headers and, on a refusal, a
//               short excerpt of what it said. Nothing is written.
//   mode=sample the page's own transaction path (/api/gov/transactions's
//               service and providers) for a few cities (?cities=a,b — Hebrew
//               names, at most 6): what each answered, why when empty, the
//               newest official rows. Read-only.
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
const { refreshTargets, recordRunsSupabase, summarize } = require('../../lib/gov/tx-refresh');
const { storeConfig, redact } = require('../../lib/store-config');
const { verifyGithubOidc, isJwt } = require('../../lib/gov/oidc');
const { probeSource, sampleCities } = require('../../lib/gov/tx-probe');
const { createDefaultService } = require('../../lib/gov/service');

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

/** the static token, or a verified GitHub OIDC token of this repository's job workflow */
async function authorize(req, env, fetchImpl) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String((req.headers && req.headers.authorization) || ''));
  if (m && isJwt(m[1])) {
    try { await verifyGithubOidc(m[1], { fetchImpl }); return 'ok'; } catch { return 'denied'; }
  }
  return authorized(req, env);
}

const send = (res, code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
const DEFAULT_CITIES = ['באר שבע', 'תל אביב-יפו', 'ירושלים', 'חיפה'];
const CITY = /^[\u0590-\u05FF][\u0590-\u05FF \-'"׳״]{1,39}$/;

function makeHandler({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date(), budgetMs = SWEEP_MS } = {}) {
  /* an error text never carries the project's address, a key or the token — redacted first, then cut */
  const clean = (msg) => redact(msg, env).slice(0, 300);
  const runtime = { platform: env.VERCEL ? 'vercel' : 'node', region: env.VERCEL_REGION || null, env: env.VERCEL_ENV || null,
    commit: env.VERCEL_GIT_COMMIT_SHA || null };
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method-not-allowed' }); }
    const auth = await authorize(req, env, fetchImpl);
    if (auth === 'not-configured') return send(res, 503, { error: 'job-not-configured' });
    if (auth !== 'ok') return send(res, 401, { error: 'unauthorized' });
    const q = new URL(req.url, 'http://x').searchParams;
    const mode = q.get('mode') || 'run';
    if (!['probe', 'sample', 'run'].includes(mode)) return send(res, 400, { error: 'unknown-mode' });
    if (mode === 'sample') {
      const asked = (q.get('cities') || '').split(',').map((c) => c.trim()).filter(Boolean);
      const cities = asked.length ? asked.slice(0, 6) : DEFAULT_CITIES;
      if (!cities.every((c) => CITY.test(c))) return send(res, 400, { error: 'bad-cities' });
      const at = now().toISOString();
      const service = createDefaultService({ fetchImpl: timed(fetchImpl, REQUEST_MS) });
      const results = await sampleCities(service, cities, { budgetMs: SWEEP_MS, deadline: Date.now() + AREA_START_MS });
      return send(res, 200, { mode, at, runtime, source: probeSourceName(), cities: results });
    }
    const targets = JSON.parse(fs.readFileSync(WATCH, 'utf8')).targets;
    const provider = new GovMapProvider({ store: new MemoryStore(), fetchImpl: timed(fetchImpl, REQUEST_MS) });
    if (mode === 'probe') {   // the raw request: did the source accept this runtime? (an empty answer is still an answer)
      const tg = targets[0], at = now().toISOString();
      const http = await probeSource({ fetchImpl, city: tg.city, timeoutMs: REQUEST_MS });
      const status = http.accepted ? 'accepted' : http.status === 401 || http.status === 403 ? 'refused' : http.status == null ? 'unreachable' : 'failed';
      return send(res, 200, { mode, at, runtime, target: tg.id, reachable: http.accepted, status, http });
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

function probeSourceName() {
  return { authority: 'רשות המסים (Israel Tax Authority) — reported real-estate deals', deliveredVia: 'GovMap (govmap.gov.il, the State of Israel mapping portal)',
    endpoints: ['POST /api/search-service/autocomplete', 'GET /api/real-estate/deals/{x},{y}/{radius}', 'GET /api/real-estate/street-deals/{polygonId}'] };
}

module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
module.exports.authorized = authorized;
module.exports.authorize = authorize;
