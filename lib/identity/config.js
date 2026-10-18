// PROPX · private workspace identity — server-side configuration (STEP 2A).
//
// KILL SWITCH: PROPX_IDENTITY must be exactly "on". Anything else is OFF — the API answers {enabled:false}, the page shows
// nothing, no private store is contacted. Turning it off never touches a browser's local state.
//
//   PROPX_WS_URL         the PRIVATE Supabase project (decision D1). Refused when its host is the public project's
//                        (SUPABASE_URL) — the two never share a project.
//   PROPX_WS_APIKEY      that project's anon / publishable gateway key. It grants nothing on the private schema by itself.
//   PROPX_WS_JWT_SECRET  that project's JWT signing secret. Server only: mints 120-second tokens for the roles
//                        `authenticated` (a named user, with a live session) and `propx_auth` (the sign-in plane) — never any
//                        other role (lib/identity/token.js refuses).
//   PROPX_ID_SECRET      the HMAC key of the identity cookie (≥ 32 characters, different from SESSION_SECRET).
//
// The private project's service-role key is NOT a PROPX runtime setting: nothing in PROPX uses it.
// Nothing here is ever sent to the browser, written to a log or to the standalone build (test/private-boundary.test.js).

'use strict';

const URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/;
const NAMES = ['PROPX_WS_URL', 'PROPX_WS_APIKEY', 'PROPX_WS_JWT_SECRET', 'PROPX_ID_SECRET'];

const hostOf = (u) => ((/^(?:[a-z]+:\/\/)?([^/\s?#:]+)/i.exec(String(u || '').trim()) || [])[1] || '').toLowerCase();

/** {enabled:false, reason} | {enabled:true, url, apikey, jwtSecret, cookieSecret}. With an injected store (dev / tests) only
 *  the switch and the cookie secret are required. */
function identityConfig(env = process.env, { injectedStore = false } = {}) {
  if (String(env.PROPX_IDENTITY || '').trim() !== 'on') return { enabled: false, reason: 'off' };
  const url = String(env.PROPX_WS_URL || '').trim(), apikey = String(env.PROPX_WS_APIKEY || '').trim();
  const jwtSecret = String(env.PROPX_WS_JWT_SECRET || '').trim(), cookieSecret = String(env.PROPX_ID_SECRET || '').trim();
  if (!cookieSecret) return { enabled: false, reason: 'not-configured' };
  if (cookieSecret.length < 32 || cookieSecret === String(env.SESSION_SECRET || '').trim()) return { enabled: false, reason: 'misconfigured' };
  if (injectedStore) return { enabled: true, cookieSecret };
  if (!url || !apikey || !jwtSecret) return { enabled: false, reason: 'not-configured' };
  if (!URL_RE.test(url) || jwtSecret.length < 32) return { enabled: false, reason: 'misconfigured' };
  if (env.SUPABASE_URL && hostOf(env.SUPABASE_URL) === hostOf(url)) return { enabled: false, reason: 'same-project' };
  return { enabled: true, url: url.replace(/\/$/, ''), apikey, jwtSecret, cookieSecret };
}

/** text without any identity setting's value or the private project's host */
function redact(text, env = process.env) {
  let s = String(text == null ? '' : text);
  const url = String(env.PROPX_WS_URL || '').trim();
  const values = [url, url.replace(/\/$/, ''), hostOf(url), ...NAMES.map((k) => String(env[k] || '').trim())]
    .filter((v) => v && v.length >= 6).sort((a, b) => b.length - a.length);
  for (const v of values) s = s.split(v).join('<redacted>');
  return s.replace(/\b[a-z0-9-]+\.supabase\.(?:co|in|net)\b/gi, '<store>').replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>');
}

module.exports = { identityConfig, redact, NAMES };
