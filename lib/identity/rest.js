// PROPX · private workspace identity — the store adapter for the PRIVATE Supabase project (STEP 2A).
//
// One method: rpc(fn, args, claims) → POST <PROPX_WS_URL>/rest/v1/rpc/<fn> in schema `ws`, with the gateway key and a
// 120-second token minted for exactly these claims (lib/identity/token.js). Only the functions named below can be called;
// no table is ever read or written directly by the server. A refusal comes back as { ok:false, status, code, message }
// with nothing from the store's address or keys (lib/identity/config.js redact()).

'use strict';

const { mint } = require('./token');
const { redact } = require('./config');

const FUNCTIONS = new Set([
  'auth_signin_lookup', 'auth_signin_failed', 'auth_session_open', 'auth_session_check', 'auth_session_revoke', 'auth_invite_peek', 'auth_activate',
  'me', 'org_members', 'invite_member', 'revoke_invitation', 'accept_invitation', 'set_member_role', 'revoke_member', 'create_team',
  'set_org_archived', 'signout_all', 'admin_users', 'admin_set_user_status', 'admin_revoke_sessions', 'admin_approve_user',
]);

function restAdapter(cfg, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  return {
    kind: 'rest',
    async rpc(fn, args, claims) {
      if (!FUNCTIONS.has(fn)) throw new Error('identity store: unknown function');
      const token = mint(claims, cfg.jwtSecret);   // throws for any role but authenticated / propx_auth
      let res, text;
      try {
        res = await fetchImpl(`${cfg.url}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: {
            apikey: cfg.apikey,
            authorization: 'Bearer ' + token,
            'content-type': 'application/json',
            'content-profile': 'ws',
            'accept-profile': 'ws',
          },
          body: JSON.stringify(args || {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
        text = await res.text();
      } catch (e) {
        return { ok: false, status: 0, code: 'unreachable', message: redact(e && e.message) };
      }
      if (res.ok) { try { return { ok: true, value: text ? JSON.parse(text) : null }; } catch { return { ok: false, status: res.status, code: 'bad_response', message: null }; } }
      let j = {};
      try { j = JSON.parse(text); } catch { /* not JSON */ }
      return { ok: false, status: res.status, code: j.code || null, message: j.message ? redact(String(j.message)).slice(0, 80) : null };
    },
  };
}

module.exports = { restAdapter, FUNCTIONS };
