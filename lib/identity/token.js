// PROPX · private workspace identity — the short-lived database token (STEP 2A).
//
// For every call to the private project the server mints an HS256 JWT that lives 120 seconds: role `authenticated` with
// the user's id (sub), the live session id (sid) and the session version (sv) — the database re-checks that session on
// every call (private.current_user_id) — or role `propx_auth` for the sign-in plane (no user yet). No other role is ever
// minted: not service_role, not anon. The token never reaches the browser.
//
// Mechanism note (documented before activation, supabase/private/README.md § Token mechanism): PostgREST verifies the
// token with the project's JWT secret and switches to the role in its `role` claim. If the project's signing setup no
// longer accepts a server-minted HS256 token, the adapter (lib/identity/rest.js) is the one place to change — the
// database rules do not move.

'use strict';

const { createHmac } = require('node:crypto');

const ROLES = new Set(['authenticated', 'propx_auth']);
const TTL_S = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function mint(claims, secret, { now = Date.now(), ttl = TTL_S } = {}) {
  const role = claims && claims.role;
  if (!ROLES.has(role)) throw new Error('token: refused role');
  if (!secret || String(secret).length < 32) throw new Error('token: no signing secret');
  const iat = Math.floor(now / 1000);
  const body = { iss: 'propx', aud: 'authenticated', role, iat, exp: iat + Math.min(ttl, TTL_S) };
  if (role === 'authenticated') {
    if (!UUID.test(String(claims.sub)) || !UUID.test(String(claims.sid)) || !Number.isInteger(claims.sv)) throw new Error('token: incomplete user claims');
    Object.assign(body, { sub: claims.sub, sid: claims.sid, sv: claims.sv });
  }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify(body));
  return head + '.' + createHmac('sha256', String(secret)).update(head).digest('base64url');
}

module.exports = { mint, ROLES, TTL_S };
