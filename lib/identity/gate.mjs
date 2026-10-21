// PROPX · the access gate (Enterprise pilot, 21.10.2026) — ONE module for the Vercel Edge middleware (middleware.js) and the
// local dev server (scripts/kobix-dev-server.mjs). Web APIs only (crypto.subtle, TextEncoder, fetch): it runs at the Edge.
//
// Two modes, chosen by the server environment and nothing else:
//   PERIMETER  PROPX_IDENTITY is not "on": the shared site password's signed cookie (kobix_session) opens every path —
//              exactly the gate PROPX had before.
//   IDENTITY   PROPX_IDENTITY is "on" and fully configured: the shared password opens NOTHING. Every gated path needs an
//              INDIVIDUAL session: the perimeter cookie minted by /api/login at that user's sign-in, the identity cookie bound to
//              it (__Host-propx_id: HMAC-signed, unexpired, carrying the perimeter cookie's hash), and a LIVE server-side
//              session in the private store (ws.auth_session_check — a sign-out, sign-out everywhere, admin revocation, password
//              change or disabled user ends access; checked here at most every POSITIVE_TTL_MS per session and isolate).
//   CLOSED     PROPX_IDENTITY is "on" but a setting is missing or invalid: every gated path answers 503 — never a silent
//              fallback to the shared password.
//
// The exclusions are EXACT paths (never a prefix). Roles and organizations are never decided here: the gate answers only
// "is this a live, individual session" — what a user may do inside is the store's (lib/identity/service.js).

export const PERIMETER_COOKIE = 'kobix_session';
export const ID_COOKIE = '__Host-propx_id';
export const PUBLIC_PATHS = new Set(['/api/login', '/login.html', '/robots.txt', '/favicon.ico']);
export const MACHINE_PATHS = new Set(['/api/jobs/tx-refresh']);
export const POSITIVE_TTL_MS = 60 * 1000;         // a live session is re-checked against the store at most once a minute
export const STALE_GRACE_MS = 10 * 60 * 1000;     // a store that does not answer: a session seen live within 10 min passes
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/;
const enc = new TextEncoder();
const hostOf = (u) => ((/^(?:[a-z]+:\/\/)?([^/\s?#:]+)/i.exec(String(u || '').trim()) || [])[1] || '').toLowerCase();

/** PERIMETER | IDENTITY | CLOSED — the same rules as lib/identity/config.js identityConfig (test/pilot-access.test.js
 *  proves the two agree on every combination). With an injected store (dev / tests) the private project's URL / keys are
 *  not needed. */
export function accessMode(env = {}, { injectedStore = false } = {}) {
  if (String(env.PROPX_IDENTITY || '').trim() !== 'on') return { mode: 'perimeter' };
  const sessionSecret = String(env.SESSION_SECRET || '').trim();
  const cookieSecret = String(env.PROPX_ID_SECRET || '').trim();
  if (!cookieSecret) return { mode: 'closed', reason: 'not-configured' };
  if (cookieSecret.length < 32 || cookieSecret === sessionSecret) return { mode: 'closed', reason: 'misconfigured' };
  if (!sessionSecret) return { mode: 'closed', reason: 'not-configured' };
  if (injectedStore) return { mode: 'identity', cookieSecret, sessionSecret };
  const url = String(env.PROPX_WS_URL || '').trim(), apikey = String(env.PROPX_WS_APIKEY || '').trim();
  const jwtSecret = String(env.PROPX_WS_JWT_SECRET || '').trim();
  if (!url || !apikey || !jwtSecret) return { mode: 'closed', reason: 'not-configured' };
  if (!URL_RE.test(url) || jwtSecret.length < 32) return { mode: 'closed', reason: 'misconfigured' };
  if (env.SUPABASE_URL && hostOf(env.SUPABASE_URL) === hostOf(url)) return { mode: 'closed', reason: 'same-project' };
  return { mode: 'identity', cookieSecret, sessionSecret, url: url.replace(/\/$/, ''), apikey, jwtSecret };
}

/* ── crypto (Web Crypto) ── */
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
export async function sha256hex(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(String(s)))); }
function same(a, b) {   // constant time over equal lengths
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

/** the perimeter cookie `<exp ms>.<hex HMAC(SESSION_SECRET, "kobix|"+exp)>` (api/login.js) — valid and unexpired? */
export async function perimeterValid(value, sessionSecret, now = Date.now()) {
  try {
    if (!sessionSecret) return false;   // no signing secret → no cookie can be trusted (fail closed)
    const [exp, sig] = String(value || '').split('.');
    if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
    return same(sig, hex(await hmac(sessionSecret, 'kobix|' + exp)));
  } catch { return false; }
}

/** the identity cookie, verified exactly as lib/identity/cookie.js parse(): v1.<payload>.<secret>.<sig>, HMAC with
 *  PROPX_ID_SECRET over "propx-id|v1.<payload>.<secret>", unexpired, well-formed claims — or null */
export async function identityClaims(raw, key, now = Date.now()) {
  try {
    if (!raw || raw.length > 1024) return null;
    const parts = raw.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const body = parts.slice(0, 3).join('.');
    if (!same(parts[3], b64url(await hmac(key, 'propx-id|' + body)))) return null;
    const c = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (!c || !UUID.test(String(c.sid)) || !UUID.test(String(c.uid)) || !Number.isInteger(c.sv) || !Number.isInteger(c.exp)
        || !/^[0-9a-f]{32}$/.test(String(c.ph)) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
    if (c.exp * 1000 <= now) return null;
    return { sid: c.sid, uid: c.uid, sv: c.sv, exp: c.exp, ph: c.ph, secret: parts[2] };
  } catch { return null; }
}

/** a 60-second HS256 token for the sign-in plane role `propx_auth` ONLY (the gate never mints a user token) */
async function mintAuthToken(jwtSecret, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))) + '.'
    + b64url(enc.encode(JSON.stringify({ iss: 'propx', aud: 'authenticated', role: 'propx_auth', iat, exp: iat + 60 })));
  return head + '.' + b64url(await hmac(jwtSecret, head));
}

/** the live-session check against the PRIVATE project (ws.auth_session_check, role propx_auth):
 *  → { ok:true, value:<session|null> } | { ok:false } (store unreachable / refused) */
export function restSessionCheck(cfg, { fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  return async (sessionId, tokenHash) => {
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(`${cfg.url}/rest/v1/rpc/auth_session_check`, {
          method: 'POST',
          headers: { apikey: cfg.apikey, authorization: 'Bearer ' + (await mintAuthToken(cfg.jwtSecret)), 'content-type': 'application/json', 'content-profile': 'ws', 'accept-profile': 'ws' },
          body: JSON.stringify({ p_session_id: sessionId, p_token_hash: tokenHash }),
          signal: ctl.signal,
        });
      } finally { clearTimeout(timer); }
      if (!res.ok) return { ok: false };
      const text = await res.text();
      return { ok: true, value: text ? JSON.parse(text) : null };
    } catch { return { ok: false }; }
  };
}

/* positive results only, per isolate: key = session id + token hash → when it was last seen live */
const SEEN = new Map();
const MAX_SEEN = 5000;
function remember(key, now) { SEEN.delete(key); SEEN.set(key, now); if (SEEN.size > MAX_SEEN) SEEN.delete(SEEN.keys().next().value); }
export function _forgetSessions() { SEEN.clear(); }

const isDocument = (method, headers) => method === 'GET' && (headers.get('sec-fetch-dest') === 'document' || /text\/html/.test(headers.get('accept') || ''));

/**
 * The decision for one request.
 *   req        { url, method, headers }  (a Request, or the same shape)
 *   env        the server environment
 *   opts       { checkSession(sessionId, tokenHash) → {ok, value}, injectedStore, now }
 * → { action: 'pass' } | { action: 'login', clear } | { action: 'bounce' } | { action: 'closed', reason } | { action: 'store-unavailable' }
 */
export async function decide(req, env, { checkSession = null, injectedStore = false, now = Date.now() } = {}) {
  const pathname = new URL(req.url).pathname;
  if (MACHINE_PATHS.has(pathname)) return { action: 'pass', why: 'machine' };   // its own token gate, fail-closed
  if (PUBLIC_PATHS.has(pathname)) return { action: 'pass', why: 'public' };     // exactly these paths — never a prefix
  const M = accessMode(env, { injectedStore });
  const headers = req.headers;
  const cookie = headers.get('cookie') || '';
  const perimeter = readCookie(cookie, PERIMETER_COOKIE);
  if (M.mode === 'closed') return { action: 'closed', reason: M.reason };
  const perimeterOk = Boolean(perimeter) && (await perimeterValid(perimeter, M.mode === 'identity' ? M.sessionSecret : String(env.SESSION_SECRET || ''), now));
  if (M.mode === 'perimeter') return perimeterOk ? { action: 'pass', why: 'perimeter' } : { action: 'login', clear: false };

  /* IDENTITY: the shared password's cookie alone opens nothing */
  const raw = readCookie(cookie, ID_COOKIE);
  if (!perimeterOk) return { action: 'login', clear: Boolean(perimeter || raw) };
  if (!raw) {
    // the identity cookie is SameSite=Strict: a browser arriving from another site (a link in an e-mail or a message) does
    // not send it on that first request. A same-origin reload does — so a cross-site document navigation is bounced once.
    if (isDocument(req.method, headers) && headers.get('sec-fetch-site') === 'cross-site') return { action: 'bounce' };
    return { action: 'login', clear: true };
  }
  const c = await identityClaims(raw, M.cookieSecret, now);
  if (!c) return { action: 'login', clear: true };
  const ph = (await sha256hex(perimeter)).slice(0, 32);
  if (!same(ph, c.ph)) return { action: 'login', clear: true };   // bound to the perimeter cookie it was issued with
  if (typeof checkSession !== 'function') return { action: 'store-unavailable' };
  const tokenHash = await sha256hex(c.secret);
  const key = c.sid + '|' + tokenHash;
  const seen = SEEN.get(key);
  if (seen && now - seen < POSITIVE_TTL_MS) return { action: 'pass', why: 'identity-cached', uid: c.uid };
  const r = await checkSession(c.sid, tokenHash);
  if (!r || !r.ok) {
    if (seen && now - seen < STALE_GRACE_MS) return { action: 'pass', why: 'identity-stale', uid: c.uid };
    return { action: 'store-unavailable' };
  }
  const v = r.value;
  if (!v || v.user_id !== c.uid || v.session_version !== c.sv || v.perimeter_hash !== c.ph) { SEEN.delete(key); return { action: 'login', clear: true }; }
  remember(key, now);
  return { action: 'pass', why: 'identity-live', uid: c.uid };
}

/* ── responses (Edge: Response; the dev server translates them) ── */
export const CLEAR_COOKIES = [
  `${PERIMETER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  `${ID_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
];
export const BOUNCE_HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>PROPX</title>'
  + '<noscript><meta http-equiv="refresh" content="0"></noscript></head><body><script>location.replace(location.href)</script></body></html>';
export const CLOSED_HTML = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>PROPX</title></head>'
  + '<body style="font-family:system-ui,sans-serif;background:#0b1322;color:#f2f5fb;display:grid;place-items:center;min-height:100vh;margin:0">'
  + '<main style="max-width:440px;padding:24px;text-align:center"><h1 style="font-size:18px">PROPX אינה זמינה כרגע</h1>'
  + '<p style="color:#aab6cf">הכניסה האישית מוגדרת בשרת באופן חלקי, ולכן הגישה סגורה. אין צורך לפעול — הצוות מטפל בכך.</p>'
  + '<p style="color:#aab6cf" dir="ltr">PROPX is temporarily unavailable: individual sign-in is not fully configured on the server, so access is closed.</p></main></body></html>';

/** the Edge response for a decision (undefined = continue to the asset / function) */
export function respond(d, req) {
  if (d.action === 'pass') return undefined;
  const api = new URL(req.url).pathname.startsWith('/api/');
  const noStore = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
  if (d.action === 'bounce') return new Response(BOUNCE_HTML, { status: 200, headers: { ...noStore, 'content-type': 'text/html; charset=utf-8' } });
  if (d.action === 'closed' || d.action === 'store-unavailable') {
    const body = api ? JSON.stringify({ ok: false, error: d.action === 'closed' ? 'access-closed' : 'identity-store-unavailable' }) : CLOSED_HTML;
    return new Response(body, { status: 503, headers: { ...noStore, 'content-type': api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'retry-after': '30' } });
  }
  const h = new Headers({ location: new URL('/login.html', req.url).toString(), ...noStore });
  if (d.clear) for (const c of CLEAR_COOKIES) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
}
