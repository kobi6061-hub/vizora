// PROPX · private workspace identity — the identity cookie (STEP 2A).
//
//   __Host-propx_id = v1.<payload>.<secret>.<signature>
//     payload   = base64url JSON { sid, uid, sv, iat, exp, ph } — session id, user id, session version, issued / expires
//                 (seconds), and ph = the first 32 hex of sha-256 of the PERIMETER cookie (kobix_session) it was issued with
//     secret    = 32 random bytes; the database stores only its sha-256 (ws.sessions.token_hash)
//     signature = HMAC-SHA256(PROPX_ID_SECRET, "propx-id|v1.<payload>.<secret>")
//   Path=/ · HttpOnly · Secure · SameSite=Strict · no Domain (the __Host- prefix makes the browser enforce all three).
//
// The cookie is never trusted alone: a forged user id breaks the signature; a replayed cookie after sign-out, a global
// sign-out, a disabled user or an expired session fails the database check (ws.auth_session_check); a cookie used with
// another perimeter session (a different browser login) fails the ph binding. Roles and organizations are NEVER in the
// cookie — they are read from the database on every request.

'use strict';

const { createHmac, createHash, randomBytes, timingSafeEqual } = require('node:crypto');

const NAME = '__Host-propx_id';
const PERIMETER = 'kobix_session';
const TTL_S = 8 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256hex = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const sign = (body, key) => createHmac('sha256', key).update('propx-id|' + body).digest('base64url');

function readCookie(header, name) {
  for (const part of String(header || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

/** the binding to the perimeter session: null when there is none */
function perimeterHash(cookieHeader) {
  const v = readCookie(cookieHeader, PERIMETER);
  return v ? sha256hex(v).slice(0, 32) : null;
}

/** a new cookie value for an opened session; returns { value, secret } (the secret's sha-256 goes to the database) */
function issue({ sid, uid, sv, iat, exp, ph }, key, secret = randomBytes(32).toString('base64url')) {
  const payload = Buffer.from(JSON.stringify({ sid, uid, sv, iat, exp, ph })).toString('base64url');
  const body = `v1.${payload}.${secret}`;
  return { value: `${body}.${sign(body, key)}`, secret };
}

/** the verified cookie content, or null (absent · malformed · bad signature · expired) */
function parse(cookieHeader, key, now = Date.now()) {
  const raw = readCookie(cookieHeader, NAME);
  if (!raw || raw.length > 1024) return null;
  const parts = raw.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const body = parts.slice(0, 3).join('.');
  const want = Buffer.from(sign(body, key)), got = Buffer.from(parts[3]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let c;
  try { c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!c || !UUID.test(String(c.sid)) || !UUID.test(String(c.uid)) || !Number.isInteger(c.sv) || !Number.isInteger(c.exp)
      || !/^[0-9a-f]{32}$/.test(String(c.ph)) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
  if (c.exp * 1000 <= now) return null;
  return { sid: c.sid, uid: c.uid, sv: c.sv, iat: c.iat, exp: c.exp, ph: c.ph, secret: parts[2] };
}

const serialize = (value, maxAge = TTL_S) => `${NAME}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Strict`;
const clear = () => `${NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

module.exports = { NAME, PERIMETER, TTL_S, issue, parse, serialize, clear, perimeterHash, readCookie, sha256hex };
