#!/usr/bin/env node
// PROPX · verify the PRIVATE workspace project after its migration (STEP 2A activation check). Read-only: it writes nothing,
// creates no user, and prints no value of any setting (lib/identity/config.js redact()).
//
// It proves, against the live API, what test/private-identity.test.js proves on a throwaway PostgreSQL:
//   1. the settings name a project that is NOT the public one (SUPABASE_URL);
//   2. the gateway key alone reads nothing in schema ws (anon holds no privilege);
//   3. schema `private` is not exposed;
//   4. a server-minted HS256 token for the custom role `propx_auth` is accepted and can call the sign-in plane
//      (the token mechanism of lib/identity/token.js works on this project);
//   5. a minted `authenticated` token for an invented session is refused with the uniform 'denied' and reads no row;
//   6. the roles cannot cross: propx_auth cannot call the member plane.
// Exit 0 only when every check passes. Usage (env from the server-side secrets): node scripts/identity-verify.js

'use strict';

const crypto = require('node:crypto');
const { identityConfig, redact } = require('../lib/identity/config');
const { mint } = require('../lib/identity/token');

const env = { ...process.env, PROPX_IDENTITY: 'on', PROPX_ID_SECRET: process.env.PROPX_ID_SECRET || 'verify-only-'.padEnd(40, 'x') };
const cfg = identityConfig(env);
const results = [];
// each result is also a workflow annotation (readable through the checks API; no value of any setting is in it)
const ann = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
const check = (name, pass, note = '') => { results.push({ name, pass }); const line = `${pass ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + redact(note, env) : ''}`;
  console.log(line); if (process.env.GITHUB_ACTIONS) console.log(`::${pass ? 'notice' : 'error'} title=identity-verify ${results.length}::${ann(line)}`); };

async function req(path, { method = 'GET', token, profile = 'ws', body } = {}) {
  const headers = { apikey: cfg.apikey, 'accept-profile': profile, 'content-profile': profile, 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(cfg.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json };
}

(async () => {
  if (!cfg.enabled) { check('settings', false, cfg.reason); process.exit(1); }
  check('settings name a separate private project (not the public SUPABASE_URL)', true);
  const user = { role: 'authenticated', sub: crypto.randomUUID(), sid: crypto.randomUUID(), sv: 1 };

  let r = await req('/rest/v1/organizations?select=id&limit=1');
  check('the gateway key alone reads nothing in ws', r.status === 401 || r.status === 403 || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0), 'HTTP ' + r.status);

  r = await req('/rest/v1/user_credentials?select=user_id&limit=1', { profile: 'private', token: mint(user, cfg.jwtSecret) });
  check('schema private is not exposed', r.status === 406 || (r.json && r.json.code === 'PGRST106'), 'HTTP ' + r.status + ' ' + ((r.json && r.json.code) || ''));

  r = await req('/rest/v1/rpc/auth_signin_lookup', { method: 'POST', token: mint({ role: 'propx_auth' }, cfg.jwtSecret), body: { p_email: `verify-${crypto.randomUUID()}@invalid.test` } });
  check('a server-minted propx_auth token is accepted and reaches the sign-in plane', r.status === 200 && r.json === null, 'HTTP ' + r.status + ' ' + ((r.json && r.json.code) || ''));

  r = await req('/rest/v1/rpc/me', { method: 'POST', token: mint(user, cfg.jwtSecret), body: {} });
  check('an invented session is not signed in (uniform denied)', r.status === 403 && r.json && r.json.code === '42501' && r.json.message === 'denied', 'HTTP ' + r.status);

  r = await req('/rest/v1/organizations?select=id', { token: mint(user, cfg.jwtSecret) });
  check('an invented session reads no organization (RLS)', r.status === 200 && Array.isArray(r.json) && r.json.length === 0, 'HTTP ' + r.status);

  r = await req('/rest/v1/rpc/me', { method: 'POST', token: mint({ role: 'propx_auth' }, cfg.jwtSecret), body: {} });
  check('propx_auth cannot call the member plane', r.status === 401 || r.status === 403, 'HTTP ' + r.status);

  r = await req('/rest/v1/rpc/auth_signin_lookup', { method: 'POST', token: mint(user, cfg.jwtSecret), body: { p_email: 'x@invalid.test' } });
  check('a user token cannot call the sign-in plane', r.status === 401 || r.status === 403, 'HTTP ' + r.status);

  const failed = results.filter((x) => !x.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (process.env.GITHUB_ACTIONS) console.log(`::${failed ? 'error' : 'notice'} title=identity-verify summary::${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL  ' + redact(e && e.message, env)); process.exit(1); });
