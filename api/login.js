// /api/login — the one sign-in endpoint (public: the gate lets exactly this path through).
//
// PERIMETER mode (PROPX_IDENTITY unset): POST {password} → verified against the SITE_PASSWORD environment variable and a
// signed, HttpOnly session cookie set. The password never appears in any client-delivered code. With SITE_PASSWORD or
// SESSION_SECRET unset the deployment stays closed and answers 503 {error:"config"}.
//
// IDENTITY mode (PROPX_IDENTITY=on, Enterprise pilot 21.10.2026): the shared password signs nobody in. POST {op, …} with
// `x-propx-intent: 1`, JSON and same origin:
//   signin {email, password}               an individual sign-in
//   invite-info {token} · activate {token, password, displayName}      the one-time invitation link (#invite=…)
//   reset-info {token} · reset {token, password}                       the one-time password-reset link (#reset=…)
// A successful sign-in / activation / reset sets BOTH cookies: a perimeter cookie minted for this sign-in only, and the
// identity cookie bound to it (lib/identity/cookie.js) — the gate needs the pair plus a live session in the private store.
// Every attempt is counted per client (an HMAC of the client address and the operation class — the store never sees an
// address): 20 sign-ins / 15 minutes, 20 link operations / 15 minutes; past the limit → 429 with Retry-After. The per-account
// lock (5 failures → 15 minutes) stays.
// GET ?op=mode → { mode: perimeter | identity | closed } (no setting, no secret).
// A partial identity configuration (PROPX_IDENTITY=on without every setting) answers 503 — never the shared password.

'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { identityConfig, redact } = require('../lib/identity/config');
const { restAdapter } = require('../lib/identity/rest');
const S = require('../lib/identity/service');
const C = require('../lib/identity/cookie');

const COOKIE = 'kobix_session';
const MAX_AGE_S = 60 * 60 * 12;   // perimeter mode: a 12-hour session
const MAX_BODY = 8 * 1024;
const IDENTITY_OPS = new Set(['signin', 'invite-info', 'activate', 'reset-info', 'reset']);
const LIMITS = { signin: [20, 900], link: [20, 900] };

const hmacHex = (secret, msg) => createHmac('sha256', String(secret)).update(msg).digest('hex');

/** perimeter | identity | closed — the same rules as lib/identity/gate.mjs accessMode (test/pilot-access.test.js) */
function modeOf(env, injectedStore) {
  if (String(env.PROPX_IDENTITY || '').trim() !== 'on') return { mode: 'perimeter' };
  const cfg = identityConfig(env, { injectedStore });
  if (!cfg.enabled) return { mode: 'closed', reason: cfg.reason };
  if (!String(env.SESSION_SECRET || '').trim()) return { mode: 'closed', reason: 'not-configured' };
  return { mode: 'identity', cfg };
}

function send(res, status, body, cookies, extra = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (Number(req.headers && req.headers['content-length']) > MAX_BODY) return { tooLarge: true };
  if (req.body !== undefined) {   // Vercel may parse a JSON body before the function runs
    const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? String(req.body) : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BODY) return { tooLarge: true };
    if (typeof req.body === 'object' && req.body && !Buffer.isBuffer(req.body)) return { body: req.body };
    try { return { body: JSON.parse(raw || '{}') }; } catch { return { body: {} }; }
  }
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) return { tooLarge: true }; chunks.push(c); }
  try { return { body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }; } catch { return { body: {} }; }
}

function originOf(req) {
  const h = req.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
  const proto = String(h['x-forwarded-proto'] || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')).split(',')[0].trim();
  return host ? `${proto}://${host}` : null;
}

/** same-origin JSON with the intent header — or the reason it is refused (the same rule as /api/identity) */
function postGuard(req) {
  const h = req.headers || {};
  if (h['x-propx-intent'] !== '1') return 'intent';
  if (!/^application\/json\b/i.test(String(h['content-type'] || ''))) return 'content-type';
  if (h.origin && h.origin !== originOf(req)) return 'origin';
  if (h['sec-fetch-site'] && h['sec-fetch-site'] !== 'same-origin') return 'origin';
  return null;
}

/** the client address as the platform states it (Vercel sets x-real-ip / the first x-forwarded-for entry) */
function clientOf(req) {
  const h = req.headers || {};
  const ip = String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || 'unknown').trim();
  return ip.slice(0, 64) || 'unknown';
}

/** a fresh perimeter cookie value for one sign-in: `<exp ms>.<hex HMAC(SESSION_SECRET, "kobix|"+exp)>` */
function perimeterValue(sessionSecret, ttlS, now) {
  const exp = String(now + ttlS * 1000);
  return `${exp}.${hmacHex(sessionSecret, 'kobix|' + exp)}`;
}

/** the shared-password sign-in (perimeter mode) — unchanged */
async function perimeterLogin(req, res, env) {
  const { body } = await readBody(req);
  const password = String((body && body.password) || '').trim();
  // tolerate paste artifacts in the env value: stray whitespace/newlines and one pair of surrounding quotes
  const expected = String(env.SITE_PASSWORD || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (!expected || !env.SESSION_SECRET) return send(res, 503, { ok: false, error: 'config' });
  const a = Buffer.from(password.padEnd(256, '\0').slice(0, 256));
  const b = Buffer.from(expected.padEnd(256, '\0').slice(0, 256));
  const ok = expected.length > 0 && password.length > 0 && timingSafeEqual(a, b);
  if (!ok) return send(res, 401, { ok: false });
  const exp = String(Date.now() + MAX_AGE_S * 1000);
  return send(res, 200, { ok: true }, [`${COOKIE}=${exp}.${hmacHex(env.SESSION_SECRET, 'kobix|' + exp)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`]);
}

function createLogin({ adapter = null, env = process.env, now = () => Date.now() } = {}) {
  return async function login(req, res) {
    const url = new URL(req.url, 'http://local');
    const M = modeOf(env, Boolean(adapter));
    if (req.method === 'GET') {
      if (url.searchParams.get('op') === 'mode') return send(res, 200, { mode: M.mode });
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'method' });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'method' }); }
    if (M.mode === 'perimeter') return perimeterLogin(req, res, env);
    if (M.mode === 'closed') return send(res, 503, { ok: false, error: 'identity-misconfigured' });

    /* IDENTITY */
    const why = postGuard(req);
    if (why) return send(res, 403, { ok: false, error: 'refused', reason: why });
    const b = await readBody(req);
    if (b.tooLarge) return send(res, 413, { ok: false, error: 'body too large', limitBytes: MAX_BODY });
    const body = b.body && typeof b.body === 'object' && !Array.isArray(b.body) ? b.body : {};
    const op = String(body.op || '');
    if (!IDENTITY_OPS.has(op)) {
      // the shared password is not a sign-in any more: say so plainly (never "wrong password")
      return send(res, 400, { ok: false, error: body.password && !body.email ? 'individual_login_required' : 'invalid_input' });
    }
    const cfg = M.cfg;
    const db = adapter || restAdapter(cfg);
    try {
      const [limit, windowS] = op === 'signin' ? LIMITS.signin : LIMITS.link;
      const key = hmacHex(cfg.cookieSecret, `rate|${op === 'signin' ? 'signin' : 'link'}|${clientOf(req)}`);
      const rate = await db.rpc('auth_rate_hit', { p_key_hash: key, p_limit: limit, p_window_seconds: windowS }, S.AUTH);
      if (!rate.ok) return send(res, 503, { ok: false, error: 'store' });
      if (!rate.value || !rate.value.allowed) {
        const after = Math.max(1, Number(rate.value && rate.value.retry_after) || windowS);
        return send(res, 429, { ok: false, error: 'rate_limited', retryAfter: after }, null, { 'retry-after': String(after) });
      }
      // a perimeter cookie for THIS sign-in only; the identity session is bound to it. The browser's current identity cookie
      // (if any) travels along so the old session is ended (no fixation).
      const t = now();
      const per = perimeterValue(env.SESSION_SECRET, C.TTL_S + 60, t);
      const old = C.readCookie(String((req.headers && req.headers.cookie) || ''), C.NAME);
      const cookieHeader = `${COOKIE}=${per}` + (old ? `; ${C.NAME}=${old}` : '');
      const r = await S.dispatch({ db, cfg, method: 'POST', op, body, query: {}, cookieHeader, origin: originOf(req) });
      const idCookie = [].concat(r.setCookie || []).find((c) => String(c).startsWith(C.NAME + '=') && !/Max-Age=0\b/.test(c));
      if (r.status === 200 && idCookie) {
        const expMs = Date.parse(r.body && r.body.expiresAt) || t + C.TTL_S * 1000;
        const maxAge = Math.max(60, Math.floor((expMs - t) / 1000));
        return send(res, 200, { ok: true, expiresAt: r.body.expiresAt },
          [`${COOKIE}=${per}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`, idCookie]);
      }
      return send(res, r.status, r.body, r.setCookie ? [].concat(r.setCookie) : null);
    } catch (e) {
      console.error('login: ' + redact(e && e.message, env));
      return send(res, 500, { ok: false, error: 'internal' });
    }
  };
}

module.exports = createLogin();
module.exports.createLogin = createLogin;
module.exports.modeOf = modeOf;
module.exports.LIMITS = LIMITS;
