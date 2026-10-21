'use strict';
/* ENTERPRISE PILOT · INDIVIDUAL ACCESS (21.10.2026) — with PROPX_IDENTITY=on the shared site password opens NOTHING: every gated
   path needs an individual, live session; a partial configuration closes the site; the gate is ONE module (lib/identity/gate.mjs)
   for the Edge middleware and the dev server; /api/login is the one sign-in (individual sign-in · invitation activation ·
   password reset · per-client rate limit). With PROPX_PG_URL naming a THROWAWAY PostgreSQL 16 the flows run end to end against
   the private migration (the CI workflow private-identity.yml provides one). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { Readable } = require('node:stream');

const ROOT = path.join(__dirname, '..');
const C = require('../lib/identity/cookie');
const { identityConfig } = require('../lib/identity/config');
const { createLogin, modeOf } = require('../api/login');
const { loadMiddleware } = require('./helpers/middleware');

let n = 0;
const at = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const SESSION = 'perimeter-session-secret-0123456789';
const IDKEY = 'i'.repeat(48), JWT = 'j'.repeat(48);
const ENV_ID = { PROPX_IDENTITY: 'on', SESSION_SECRET: SESSION, PROPX_ID_SECRET: IDKEY, PROPX_WS_URL: 'https://private-ws.supabase.co', PROPX_WS_APIKEY: 'anon-key-123456', PROPX_WS_JWT_SECRET: JWT };
const hmacHex = (k, m) => crypto.createHmac('sha256', k).update(m).digest('hex');
const perimeterValue = (exp = Date.now() + 3600e3) => `${exp}.${hmacHex(SESSION, 'kobix|' + exp)}`;
const ph = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 32);

/** a minimal req / res pair, the way Vercel hands them to a function */
function call(handler, { method = 'GET', url = '/api/login', cookie = '', body, headers = {}, ip = '203.0.113.9' } = {}) {
  const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(raw === undefined ? [] : [Buffer.from(raw)]);
  Object.assign(req, { method, url, headers: { host: 'propx.example', 'x-forwarded-proto': 'https', 'x-real-ip': ip, cookie,
    ...(method === 'POST' ? { 'content-type': 'application/json', 'x-propx-intent': '1', origin: 'https://propx.example', 'sec-fetch-site': 'same-origin' } : {}), ...headers } });
  return new Promise((resolve) => {
    const h = {}; let status = 200;
    const res = { setHeader: (k, v) => { h[k.toLowerCase()] = v; }, getHeader: (k) => h[k.toLowerCase()], set statusCode(v) { status = v; }, get statusCode() { return status; },
      end: (b) => { let json = null; try { json = JSON.parse(b || 'null'); } catch { json = b; } resolve({ status, headers: h, body: json }); } };
    handler(req, res);
  });
}
const cookiesOf = (r) => [].concat(r.headers['set-cookie'] || []);
const valueOf = (r, name) => { const c = cookiesOf(r).find((x) => x.startsWith(name + '=')); return c ? /^[^=]+=([^;]*)/.exec(c)[1] : null; };

(async () => {
  const G = await import(pathToFileURL(path.join(ROOT, 'lib/identity/gate.mjs')).href);
  const req = (p, { method = 'GET', cookie = '', headers = {} } = {}) => ({ url: 'https://propx.example' + p, method, headers: new Headers({ ...(cookie ? { cookie } : {}), ...headers }) });

  console.log('pilot access: units');

  await at('MODE: the gate (Edge) and /api/login decide PERIMETER / IDENTITY / CLOSED identically on every combination; a partial identity configuration CLOSES (never falls back to the shared password)', async () => {
    const keys = ['PROPX_IDENTITY', 'SESSION_SECRET', 'PROPX_ID_SECRET', 'PROPX_WS_URL', 'PROPX_WS_APIKEY', 'PROPX_WS_JWT_SECRET'];
    const values = { PROPX_IDENTITY: ['on', 'ON', ''], SESSION_SECRET: [SESSION, ''], PROPX_ID_SECRET: [IDKEY, 'short', SESSION, ''], PROPX_WS_URL: [ENV_ID.PROPX_WS_URL, 'http://plain.example', ''],
      PROPX_WS_APIKEY: ['anon-key-123456', ''], PROPX_WS_JWT_SECRET: [JWT, 'short', ''] };
    let combos = 0;
    const rec = (i, env) => {
      if (i === keys.length) {
        for (const injected of [false, true]) {
          combos++;
          const g = G.accessMode(env, { injectedStore: injected }).mode, l = modeOf(env, injected).mode;
          assert.equal(g, l, JSON.stringify({ env, injected }));
          if (String(env.PROPX_IDENTITY || '').trim() !== 'on') assert.equal(g, 'perimeter');
          else assert.equal(g === 'identity', identityConfig(env, { injectedStore: injected }).enabled && Boolean(env.SESSION_SECRET), JSON.stringify(env));
        }
        return;
      }
      for (const v of values[keys[i]]) rec(i + 1, { ...env, [keys[i]]: v });
    };
    rec(0, {});
    assert.ok(combos >= 864, 'combinations ' + combos);
    assert.equal(G.accessMode({ ...ENV_ID, SUPABASE_URL: 'https://PRIVATE-WS.supabase.co' }).mode, 'closed', 'the public project is never the private one');
  });

  await at('COOKIES: the gate verifies the identity cookie exactly as lib/identity/cookie.js mints it; a tampered payload / signature, another key or an expired cookie is refused; the perimeter cookie likewise', async () => {
    const sid = crypto.randomUUID(), uid = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const { value, secret } = C.issue({ sid, uid, sv: 2, iat: now, exp: now + 3600, ph: 'a'.repeat(32) }, IDKEY);
    assert.deepEqual(await G.identityClaims(value, IDKEY), { sid, uid, sv: 2, exp: now + 3600, ph: 'a'.repeat(32), secret });
    assert.equal(await G.identityClaims(value, 'x'.repeat(48)), null, 'another key');
    const parts = value.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sid, uid: crypto.randomUUID(), sv: 2, iat: now, exp: now + 3600, ph: 'a'.repeat(32) })).toString('base64url');
    assert.equal(await G.identityClaims([parts[0], forgedPayload, parts[2], parts[3]].join('.'), IDKEY), null, 'a forged user id');
    assert.equal(await G.identityClaims(value.slice(0, -2) + 'AA', IDKEY), null, 'a tampered signature');
    const old = C.issue({ sid, uid, sv: 2, iat: now - 7200, exp: now - 1, ph: 'a'.repeat(32) }, IDKEY).value;
    assert.equal(await G.identityClaims(old, IDKEY), null, 'expired');
    assert.equal(await G.identityClaims('v1.x.y', IDKEY), null);
    assert.equal(await G.perimeterValid(perimeterValue(), SESSION), true);
    assert.equal(await G.perimeterValid(perimeterValue(Date.now() - 1), SESSION), false, 'expired');
    assert.equal(await G.perimeterValid(perimeterValue(), 'another-secret'), false);
    assert.equal(await G.perimeterValid(perimeterValue(), ''), false, 'no secret → nothing is trusted');
    assert.equal(await G.sha256hex('abc'), crypto.createHash('sha256').update('abc').digest('hex'));
  });

  /* an individual session for the gate: a perimeter cookie + the identity cookie bound to it */
  const individual = (o = {}) => {
    const per = o.per || perimeterValue();
    const sid = o.sid || crypto.randomUUID(), uid = o.uid || crypto.randomUUID(), now = Math.floor(Date.now() / 1000);
    const { value, secret } = C.issue({ sid, uid, sv: o.sv || 1, iat: now, exp: now + 3600, ph: o.ph || ph(per) }, o.key || IDKEY);
    return { per, id: value, sid, uid, secret, cookie: `kobix_session=${per}; ${C.NAME}=${value}`, live: { session_id: sid, user_id: uid, session_version: o.sv || 1, perimeter_hash: o.ph || ph(per) } };
  };

  await at('GATE · IDENTITY: no cookie → sign-in; the SHARED PASSWORD\'s cookie alone → sign-in (cookies cleared); a cookie bound to another perimeter session → sign-in; a live individual session → through', async () => {
    G._forgetSessions();
    const live = individual();
    const store = { calls: 0, answer: { ok: true, value: live.live } };
    const check = async () => { store.calls++; return store.answer; };
    const D = (p, o = {}) => G.decide(req(p, o), ENV_ID, { checkSession: check, ...o.opts });
    assert.deepEqual(await D('/'), { action: 'login', clear: false });
    assert.deepEqual(await D('/', { cookie: 'kobix_session=' + perimeterValue() }), { action: 'login', clear: true }, 'the shared password opens nothing');
    const other = individual({ per: perimeterValue(), ph: 'b'.repeat(32) });
    assert.deepEqual(await D('/', { cookie: `kobix_session=${perimeterValue()}; ${C.NAME}=${other.id}` }), { action: 'login', clear: true }, 'bound to another perimeter cookie');
    assert.equal(store.calls, 0, 'nothing reached the store before the cookies proved themselves');
    const r = await D('/api/intel?view=street', { cookie: live.cookie });
    assert.equal(r.action, 'pass'); assert.equal(r.why, 'identity-live'); assert.equal(r.uid, live.uid);
    assert.equal(store.calls, 1);
    assert.equal((await D('/index.html', { cookie: live.cookie })).why, 'identity-cached', 'a live session is re-checked at most once a minute');
    assert.equal(store.calls, 1);
    const forged = individual({ key: 'z'.repeat(48) });
    assert.equal((await D('/', { cookie: forged.cookie })).action, 'login', 'signed with another key');
  });

  await at('GATE · REVOCATION: a session the store no longer knows (sign-out · sign-out everywhere · admin · password change · disabled) is refused on its next check and its cookies cleared; another user\'s or another version\'s session never passes', async () => {
    G._forgetSessions();
    const s = individual();
    let answer = { ok: true, value: s.live };
    const check = async () => answer;
    const D = (now) => G.decide(req('/api/gov/transactions', { cookie: s.cookie }), ENV_ID, { checkSession: check, now });
    const t0 = Date.now();
    assert.equal((await D(t0)).action, 'pass');
    answer = { ok: true, value: null };
    assert.equal((await D(t0 + 1000)).action, 'pass', 'within the minute the isolate trusts its last check');
    assert.deepEqual(await D(t0 + G.POSITIVE_TTL_MS + 1), { action: 'login', clear: true }, 'revoked → out');
    for (const v of [{ ...s.live, user_id: crypto.randomUUID() }, { ...s.live, session_version: 2 }, { ...s.live, perimeter_hash: 'c'.repeat(32) }]) {
      G._forgetSessions(); answer = { ok: true, value: v };
      assert.equal((await D(Date.now())).action, 'login', JSON.stringify(v));
    }
  });

  await at('GATE · STORE DOWN: a session seen live within 10 minutes passes (stale grace); otherwise 503 — never "open"', async () => {
    G._forgetSessions();
    const s = individual();
    let answer = { ok: true, value: s.live };
    const D = (now) => G.decide(req('/', { cookie: s.cookie }), ENV_ID, { checkSession: async () => answer, now });
    const t0 = Date.now();
    assert.equal((await D(t0)).action, 'pass');
    answer = { ok: false };
    assert.equal((await D(t0 + G.POSITIVE_TTL_MS + 5)).why, 'identity-stale');
    assert.deepEqual(await D(t0 + G.STALE_GRACE_MS + 5), { action: 'store-unavailable' });
    G._forgetSessions();
    assert.deepEqual(await D(Date.now()), { action: 'store-unavailable' }, 'never seen + store down → closed');
    assert.deepEqual(await G.decide(req('/', { cookie: s.cookie }), ENV_ID, {}), { action: 'store-unavailable' }, 'no store checker at all → closed');
  });

  await at('GATE · ARRIVING FROM ANOTHER SITE: the SameSite=Strict identity cookie is not sent on a cross-site navigation — a document request is bounced once to the same URL; an API request, a same-site request or a missing perimeter session is not', async () => {
    G._forgetSessions();
    const per = 'kobix_session=' + perimeterValue();
    const D = (h, method = 'GET', p = '/') => G.decide(req(p, { cookie: per, method, headers: h }), ENV_ID, { checkSession: async () => ({ ok: true, value: null }) });
    assert.deepEqual(await D({ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' }), { action: 'bounce' });
    assert.deepEqual(await D({ 'sec-fetch-site': 'cross-site', accept: 'text/html,application/xhtml+xml' }), { action: 'bounce' });
    assert.equal((await D({ 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'document' })).action, 'login', 'the reload carries the cookie — no loop');
    assert.equal((await D({ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'empty' }, 'GET', '/api/intel')).action, 'login');
    assert.equal((await D({ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' }, 'POST')).action, 'login');
    assert.equal((await G.decide(req('/', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' } }), ENV_ID, {})).action, 'login', 'no perimeter session → sign in');
    assert.match(G.BOUNCE_HTML, /location\.replace\(location\.href\)/); assert.ok(!/cookie|secret/i.test(G.BOUNCE_HTML));
  });

  await at('GATE · EXACT exclusions in every mode: the login page, the sign-in endpoint, the crawler files and the one machine path pass; every look-alike and every other path is gated; a CLOSED site still serves its sign-in page', async () => {
    const closed = { PROPX_IDENTITY: 'on', SESSION_SECRET: SESSION };
    for (const env of [{ SESSION_SECRET: SESSION }, ENV_ID, closed]) {
      for (const p of ['/api/login', '/login.html', '/robots.txt', '/favicon.ico', '/api/jobs/tx-refresh']) assert.equal((await G.decide(req(p), env, {})).action, 'pass', p);
      for (const p of ['/', '/index.html', '/altaris', '/api/identity', '/api/logout', '/api/login/', '/api/loginx', '/login.html.bak', '/api/jobs/tx-refresh/', '/data/dd/latest.json', '/lib/identity/gate.mjs']) {
        const a = (await G.decide(req(p), env, {})).action;
        assert.ok(env === closed ? a === 'closed' : a === 'login', `${p} → ${a}`);
      }
    }
  });

  await at('GATE · PERIMETER MODE is the gate PROPX had: the shared password\'s signed cookie opens every path; nothing reaches a store', async () => {
    const env = { SESSION_SECRET: SESSION };
    let calls = 0;
    const r = await G.decide(req('/api/intel', { cookie: 'kobix_session=' + perimeterValue() }), env, { checkSession: async () => { calls++; return { ok: true, value: null }; } });
    assert.deepEqual([r.action, r.why, calls], ['pass', 'perimeter', 0]);
    assert.equal((await G.decide(req('/', { cookie: 'kobix_session=' + perimeterValue(Date.now() - 1) }), env, {})).action, 'login');
  });

  await at('MIDDLEWARE · IDENTITY: every API endpoint and page is refused without an individual session (the shared password\'s cookie included); the live-session check goes to the PRIVATE project as `propx_auth` only (a 60-s token), in schema ws, with the cookie secret\'s hash — never the secret', async () => {
    const mw = await loadMiddleware(ENV_ID);
    mw.gate._forgetSessions();
    const apis = [];
    const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const r = d + '/' + e.name; if (e.isDirectory()) walk(r); else if (/\.js$/.test(e.name) && !e.name.startsWith('_')) apis.push('/' + r.replace(/\.js$/, '')); } };
    walk('api');
    assert.ok(apis.length >= 12 && apis.includes('/api/intel') && apis.includes('/api/gov/transactions') && apis.includes('/api/geo/search'), apis.join(' '));
    const shared = 'kobix_session=' + perimeterValue();
    for (const p of [...apis.filter((a) => !['/api/login', '/api/jobs/tx-refresh'].includes(a)), '/', '/index.html', '/altaris', '/data/streets/model/model.json']) {
      for (const cookie of ['', shared]) {
        const r = await mw.middleware(new Request('https://propx.example' + p + (p.startsWith('/api/') ? '?view=street' : ''), { headers: cookie ? { cookie } : {} }));
        assert.ok(r && r.status === 302 && /\/login\.html$/.test(r.headers.get('location')), `${p} (${cookie ? 'shared password' : 'no cookie'}) escaped: ${r && r.status}`);
      }
    }
    const s = individual();
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, init) => { seen.push({ u: String(u), init }); return new Response(JSON.stringify(s.live), { status: 200 }); };
    try {
      assert.equal(await mw.middleware(new Request('https://propx.example/api/intel?view=street', { headers: { cookie: s.cookie } })), undefined, 'a live individual session passes');
      assert.equal(seen.length, 1);
      const call0 = seen[0], hdr = call0.init.headers;
      assert.equal(call0.u, 'https://private-ws.supabase.co/rest/v1/rpc/auth_session_check');
      assert.equal(hdr['content-profile'], 'ws'); assert.equal(hdr.apikey, 'anon-key-123456');
      const claims = JSON.parse(Buffer.from(hdr.authorization.split(' ')[1].split('.')[1], 'base64url').toString());
      assert.equal(claims.role, 'propx_auth'); assert.ok(claims.exp - claims.iat <= 60); assert.equal(claims.sub, undefined);
      const [h64, b64, sig] = hdr.authorization.split(' ')[1].split('.');
      assert.equal(sig, crypto.createHmac('sha256', JWT).update(h64 + '.' + b64).digest('base64url'), 'signed with the private project\'s JWT secret');
      const body = JSON.parse(call0.init.body);
      assert.deepEqual(body, { p_session_id: s.sid, p_token_hash: crypto.createHash('sha256').update(s.secret).digest('hex') });
      assert.ok(!call0.init.body.includes(s.secret), 'the cookie secret never leaves the server');
      mw.gate._forgetSessions();
      globalThis.fetch = async () => { throw new Error('unreachable'); };
      const down = await mw.middleware(new Request('https://propx.example/', { headers: { cookie: s.cookie } }));
      assert.equal(down.status, 503); assert.match(await down.text(), /PROPX/);
      const downApi = await mw.middleware(new Request('https://propx.example/api/intel', { headers: { cookie: s.cookie } }));
      assert.equal(downApi.status, 503); assert.equal((await downApi.json()).error, 'identity-store-unavailable');
    } finally { globalThis.fetch = realFetch; }
    const big = await mw.middleware(new Request('https://propx.example/api/intel?view=dd', { method: 'POST', headers: { cookie: s.cookie, 'content-length': String(300 * 1024) } }));
    assert.ok(big === undefined || big.status === 413 || big.status === 503, 'the evidence limit still applies after the gate');
    const closed = await (await loadMiddleware({ PROPX_IDENTITY: 'on', SESSION_SECRET: SESSION })).middleware(new Request('https://propx.example/', { headers: { cookie: shared } }));
    assert.equal(closed.status, 503, 'a partial configuration closes the site');
  });

  await at('LOGIN · modes: GET ?op=mode names the mode (nothing else); IDENTITY refuses the shared password ("individual_login_required"), any POST without the intent header / JSON / same origin; CLOSED answers 503; PERIMETER keeps the shared password', async () => {
    const id = createLogin({ env: ENV_ID });
    assert.deepEqual((await call(id, { url: '/api/login?op=mode' })).body, { mode: 'identity' });
    assert.equal((await call(id, { url: '/api/login' })).status, 405);
    const shared = await call(id, { method: 'POST', body: { password: 'the-shared-password' } });
    assert.deepEqual([shared.status, shared.body.error], [400, 'individual_login_required']);
    assert.equal(cookiesOf(shared).length, 0, 'no cookie of any kind');
    for (const headers of [{ 'x-propx-intent': '' }, { 'content-type': 'text/plain' }, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
      const r = await call(id, { method: 'POST', body: { op: 'signin', email: 'a@b.c', password: 'x' }, headers });
      assert.equal(r.status, 403, JSON.stringify(headers));
    }
    const closed = createLogin({ env: { PROPX_IDENTITY: 'on', SESSION_SECRET: SESSION, SITE_PASSWORD: 'pw' } });
    assert.deepEqual((await call(closed, { url: '/api/login?op=mode' })).body, { mode: 'closed' });
    const c = await call(closed, { method: 'POST', body: { password: 'pw' } });
    assert.deepEqual([c.status, c.body.error, cookiesOf(c).length], [503, 'identity-misconfigured', 0], 'never the shared password');
    const per = createLogin({ env: { SESSION_SECRET: SESSION, SITE_PASSWORD: 'pw' } });
    assert.deepEqual((await call(per, { url: '/api/login?op=mode' })).body, { mode: 'perimeter' });
    const ok = await call(per, { method: 'POST', body: { password: 'pw' }, headers: { 'x-propx-intent': '' } });
    assert.equal(ok.status, 200); assert.ok(await G.perimeterValid(valueOf(ok, 'kobix_session'), SESSION));
    assert.equal((await call(per, { method: 'POST', body: { password: 'wrong' } })).status, 401);
    const text = JSON.stringify([shared.body, c.body, ok.body]);
    for (const v of [SESSION, IDKEY, JWT, 'anon-key-123456', 'private-ws']) assert.ok(!text.includes(v), v);
  });

  await at('SURFACES: the login page offers individual sign-in, invitation activation and password reset in identity mode (and the shared password otherwise); the page and the offline build carry no identity setting', async () => {
    const page = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');
    for (const re of [/\/api\/login\?op=mode/, /op:'signin'/, /op:'activate'/, /op:'invite-info'/, /op:'reset'/, /op:'reset-info'/, /'x-propx-intent':'1'/, /#invite=/, /#reset=/, /individual_login_required/, /rate_limited/,
      /if\(inv\|\|rst\)\{try\{history\.replaceState\(null,'',location\.pathname\+location\.search\)\}catch\(e\)\{\}\}/]) assert.match(page, re, String(re));   // the one-time token leaves the address bar at once
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    // the workspace drawer (ws:begin … ws:end, stripped from the offline build): profile name, password change, the admin's
    // one-time reset link, and a sign-out that ends the named session and then leaves through /api/logout
    for (const re of [/wsDo\("change-password",\{current:v\.current,password:v\.password\}/, /wsDo\("set-name",\{displayName:/, /wsDo\("admin-reset-link",\{user:u\}/,
      /wsDo\("signout",\{\},[^;]*\);if\(r\)location\.href="\/api\/logout"/, /wsDo\("signout-all",\{\},[^;]*\);if\(r\)location\.href="\/api\/logout"/]) assert.match(idx, re, String(re));
    const off = fs.readFileSync(path.join(ROOT, 'standalone', 'israel-new-homes-v2.html'), 'utf8');
    for (const k of ['change-password', 'admin-reset-link', 'wsDrawer']) assert.ok(!off.includes(k), `the offline build carries ${k}`);
    for (const f of ['index.html', 'login.html', ...fs.readdirSync(path.join(ROOT, 'standalone')).map((x) => 'standalone/' + x)]) {
      const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const k of ['PROPX_WS_JWT_SECRET', 'PROPX_ID_SECRET', 'PROPX_WS_APIKEY', 'SESSION_SECRET=']) assert.ok(!t.includes(k + '='), `${f} names ${k}`);
    }
  });

  /* ───────────── end to end against the private migration ───────────── */
  const PG = process.env.PROPX_PG_URL;
  if (!PG) {
    console.log('  · database flows SKIPPED: PROPX_PG_URL is not set (they run in .github/workflows/private-identity.yml)');
    console.log(`pilot access: ${n} passed (units only)`);
    return;
  }
  const { psqlAdapter } = require('../scripts/identity-psql-adapter');
  const { createHandler } = require('../api/identity');
  const { createLogout } = require('../api/logout');
  const PWD = 'local-test-' + crypto.randomBytes(6).toString('hex');
  const DB = 'propx_ws_pilot_' + process.pid;
  const base = new URL(PG);
  const urlFor = (user, pw, db = DB) => { const u = new URL(PG); u.username = user; u.password = pw; u.pathname = '/' + db; return u.toString(); };
  const SUPERPW = decodeURIComponent(base.password);
  const psql = (url, text, vars = {}) => spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), '-f', '-'], { input: text, encoding: 'utf8' });
  let r = psql(urlFor(base.username, SUPERPW, base.pathname.slice(1) || 'postgres'), `create database ${DB};`); assert.equal(r.status, 0, r.stderr);
  r = psql(urlFor(base.username, SUPERPW), fs.readFileSync(path.join(ROOT, 'supabase/private/test/supabase-roles-shim.sql'), 'utf8'), { pw: `'${PWD}'`, DBNAME: DB }); assert.equal(r.status, 0, r.stderr);
  r = psql(urlFor('ws_owner', PWD), fs.readFileSync(path.join(ROOT, 'supabase/private/migrations/20261019120000_identity_foundation.sql'), 'utf8')); assert.equal(r.status, 0, r.stderr);
  process.on('exit', () => { if (!process.env.PROPX_PG_KEEP) psql(urlFor(base.username, SUPERPW, base.pathname.slice(1) || 'postgres'), `drop database if exists ${DB} with (force);`); });
  const db = psqlAdapter(urlFor('authenticator', PWD));
  const owner = (sql) => { const x = psql(urlFor('ws_owner', PWD), sql); assert.equal(x.status, 0, x.stderr); return x.stdout.trim(); };
  const ENV = { PROPX_IDENTITY: 'on', SESSION_SECRET: SESSION, PROPX_ID_SECRET: IDKEY };   // the store is injected (the local adapter)
  const LOGIN = createLogin({ adapter: db, env: ENV });
  const API = createHandler({ adapter: db, env: ENV });
  const LOGOUT = createLogout({ adapter: db, env: ENV });
  const storeCheck = async (sid, th) => { const x = await db.rpc('auth_session_check', { p_session_id: sid, p_token_hash: th }, { role: 'propx_auth' }); return x.ok ? { ok: true, value: x.value } : { ok: false }; };
  /** what the gate says for this browser on a path (a fresh isolate: no cached check) */
  const gateFor = async (b, p = '/api/intel', fresh = true) => { if (fresh) G._forgetSessions(); return (await G.decide(req(p, { cookie: b.cookie }), ENV, { checkSession: storeCheck, injectedStore: true })).action; };
  const browser = (ip = '198.51.100.' + (1 + Math.floor(Math.random() * 200))) => ({ ip, per: null, id: null, get cookie() { return [this.per && 'kobix_session=' + this.per, this.id && `${C.NAME}=${this.id}`].filter(Boolean).join('; '); } });
  const keep = (b, x) => { const p = valueOf(x, 'kobix_session'), i = valueOf(x, C.NAME); if (p !== null) b.per = p || null; if (i !== null) b.id = i || null; return x; };
  const login = (b, body) => call(LOGIN, { method: 'POST', body, cookie: b.cookie, ip: b.ip }).then((x) => keep(b, x));
  const api = (b, op, body) => call(API, body === undefined ? { url: '/api/identity?op=' + op, cookie: b.cookie } : { method: 'POST', url: '/api/identity?op=' + op, body, cookie: b.cookie }).then((x) => keep(b, x));
  console.log('pilot access: end to end (' + DB + ')');

  const T0 = owner(`select private.bootstrap('founder@propx.test', 'Founder', 'PROPX');`);
  const founder = browser();

  await at('E2E · the first administrator activates through the invitation link on the sign-in page — no shared password anywhere; both cookies are set, bound together, and the gate lets that browser through', async () => {
    const info = await login(founder, { op: 'invite-info', token: T0 });
    assert.deepEqual([info.status, info.body.invite.email, info.body.invite.needsActivation], [200, 'founder@propx.test', true]);
    assert.equal((await login(founder, { op: 'activate', token: T0, password: 'short', displayName: 'Founder' })).body.error, 'password_too_short');
    const a = await login(founder, { op: 'activate', token: T0, password: 'a long founder passphrase', displayName: 'Founder' });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const pc = cookiesOf(a).find((x) => x.startsWith('kobix_session=')), ic = cookiesOf(a).find((x) => x.startsWith(C.NAME + '='));
    assert.ok(/HttpOnly/.test(pc) && /Secure/.test(pc) && /SameSite=Lax/.test(pc) && /Path=\//.test(pc), pc);
    assert.ok(/HttpOnly/.test(ic) && /Secure/.test(ic) && /SameSite=Strict/.test(ic) && !/Domain=/i.test(ic), ic);
    assert.equal((await G.identityClaims(founder.id, IDKEY)).ph, ph(founder.per), 'the identity cookie is bound to the perimeter cookie minted for this sign-in');
    assert.equal(await gateFor(founder), 'pass');
    assert.equal(await gateFor({ cookie: 'kobix_session=' + founder.per }), 'login', 'the perimeter half alone is not a session');
    const st = (await api(founder, 'status')).body;
    assert.deepEqual([st.signedIn, st.user.email, st.user.platformAdmin], [true, 'founder@propx.test', true]);
  });

  const team = (await api(founder, 'status')).body.organizations.find((o) => o.kind === 'team').id;
  const analyst = browser();

  await at('E2E · an invited analyst activates from the link on the sign-in page, then signs in with email + password; wrong passwords get one answer; the shared password signs nobody in', async () => {
    const inv = await api(founder, 'invite', { org: team, email: 'analyst@fund.test', role: 'analyst' });
    assert.equal(inv.status, 200, JSON.stringify(inv.body));
    const token = /#invite=([A-Za-z0-9_-]{43})$/.exec(inv.body.invite.link)[1];
    assert.equal((await login(analyst, { op: 'activate', token, password: 'analyst passphrase 1', displayName: 'Ana Lyst' })).status, 200);
    assert.equal(await gateFor(analyst), 'pass');
    assert.equal((await call(LOGOUT, { url: '/api/logout', cookie: analyst.cookie }).then((x) => keep(analyst, x))).status, 302);
    assert.equal(await gateFor(analyst), 'login', 'signed out');
    const second = browser();
    for (const body of [{ op: 'signin', email: 'analyst@fund.test', password: 'wrong passphrase 1' }, { op: 'signin', email: 'nobody@fund.test', password: 'whatever passphrase' }]) {
      const x = await login(second, body);
      assert.deepEqual([x.status, x.body.error, cookiesOf(x).filter((c) => !/Max-Age=0/.test(c)).length], [401, 'signin_failed', 0], body.email);
    }
    assert.equal((await login(second, { password: 'the shared site password' })).body.error, 'individual_login_required');
    const ok = await login(second, { op: 'signin', email: ' Analyst@Fund.test ', password: 'analyst passphrase 1' });
    assert.equal(ok.status, 200);
    assert.equal(await gateFor(second), 'pass');
    const st = (await api(second, 'status')).body;
    assert.deepEqual([st.user.displayName, st.organizations.find((o) => o.id === team).role], ['Ana Lyst', 'analyst'], 'WHO and WHAT ROLE from the store');
    Object.assign(analyst, { ip: second.ip, per: second.per, id: second.id });
  });

  await at('E2E · RBAC through the gate: an analyst reads the workspace but cannot invite or change roles; the founder can; the platform list is the founder\'s only', async () => {
    assert.equal((await api(analyst, 'members&org=' + team)).status, 200);
    assert.equal((await api(analyst, 'invite', { org: team, email: 'x@fund.test', role: 'viewer' })).status, 403);
    assert.equal((await api(analyst, 'admin-users')).status, 403);
    assert.equal((await api(founder, 'admin-users')).status, 200);
  });

  await at('E2E · profile: my display name changes; my password changes only with the current one — and EVERY other session of mine ends while this browser gets a new one', async () => {
    assert.equal((await api(analyst, 'set-name', { displayName: 'Ana Lyst (Fund)' })).body.result.displayName, 'Ana Lyst (Fund)');
    const phone = browser();
    assert.equal((await login(phone, { op: 'signin', email: 'analyst@fund.test', password: 'analyst passphrase 1' })).status, 200);
    assert.equal(await gateFor(phone), 'pass');
    assert.equal((await api(analyst, 'change-password', { current: 'not my password', password: 'analyst passphrase 2' })).body.error, 'current_password_wrong');
    assert.equal((await api(analyst, 'change-password', { current: 'analyst passphrase 1', password: 'analyst passphrase 1' })).body.error, 'password_unchanged');
    const ch = await api(analyst, 'change-password', { current: 'analyst passphrase 1', password: 'analyst passphrase 2' });
    assert.equal(ch.status, 200, JSON.stringify(ch.body));
    assert.equal(await gateFor(analyst), 'pass', 'this browser continues on its new session');
    assert.equal(await gateFor(phone), 'login', 'the other device is signed out');
    assert.equal((await login(browser(), { op: 'signin', email: 'analyst@fund.test', password: 'analyst passphrase 1' })).status, 401, 'the old password is gone');
    assert.equal((await login(browser(), { op: 'signin', email: 'analyst@fund.test', password: 'analyst passphrase 2' })).status, 200);
  });

  await at('E2E · password reset: the founder issues a one-time link (shown once); its holder sets a new password on the sign-in page; every session of the user ends; the link works once', async () => {
    const uid = (await api(analyst, 'status')).body.user.id;
    assert.equal((await api(analyst, 'admin-reset-link', { user: uid })).status, 403, 'only the platform administrator');
    const rl = await api(founder, 'admin-reset-link', { user: uid });
    assert.equal(rl.status, 200, JSON.stringify(rl.body));
    assert.match(rl.body.reset.link, /^https:\/\/propx\.example\/login\.html#reset=[A-Za-z0-9_-]{43}$/);
    const token = /#reset=([A-Za-z0-9_-]{43})$/.exec(rl.body.reset.link)[1];
    const holder = browser();
    const info = await login(holder, { op: 'reset-info', token });
    assert.deepEqual([info.status, info.body.reset.email], [200, 'analyst@fund.test']);
    assert.equal((await login(holder, { op: 'reset', token, password: 'tiny' })).body.error, 'password_too_short');
    const done = await login(holder, { op: 'reset', token, password: 'analyst passphrase 3' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(await gateFor(holder), 'pass');
    assert.equal(await gateFor(analyst), 'login', 'the earlier session ended');
    assert.equal((await login(browser(), { op: 'reset', token, password: 'analyst passphrase 4' })).status, 403, 'single use');
    assert.equal((await login(browser(), { op: 'reset-info', token })).status, 404);
    Object.assign(analyst, { ip: holder.ip, per: holder.per, id: holder.id });
  });

  await at('E2E · revocation reaches the gate on the next check: sign out everywhere, an administrator\'s revocation and a disabled user each end access; re-enabling needs a new sign-in', async () => {
    const b = browser();
    assert.equal((await login(b, { op: 'signin', email: 'analyst@fund.test', password: 'analyst passphrase 3' })).status, 200);
    assert.equal(await gateFor(b), 'pass');
    assert.equal((await api(b, 'signout-all', {})).status, 200);
    assert.equal(await gateFor(b, '/api/intel'), 'login');
    const c = browser();
    assert.equal((await login(c, { op: 'signin', email: 'analyst@fund.test', password: 'analyst passphrase 3' })).status, 200);
    const uid = (await api(c, 'status')).body.user.id;
    assert.equal((await api(founder, 'admin-revoke-sessions', { user: uid })).status, 200);
    assert.equal(await gateFor(c), 'login');
    const d = browser();
    assert.equal((await login(d, { op: 'signin', email: 'analyst@fund.test', password: 'analyst passphrase 3' })).status, 200);
    assert.equal((await api(founder, 'admin-user-status', { user: uid, status: 'disabled' })).status, 200);
    assert.equal(await gateFor(d), 'login');
    assert.equal((await login(browser(), { op: 'signin', email: 'analyst@fund.test', password: 'analyst passphrase 3' })).status, 401, 'a disabled user cannot sign in');
    assert.equal((await api(founder, 'admin-user-status', { user: uid, status: 'active' })).status, 200);
    assert.equal(await gateFor(d), 'login', 'old sessions stay ended');
    assert.equal((await login(browser(), { op: 'signin', email: 'analyst@fund.test', password: 'analyst passphrase 3' })).status, 200);
  });

  await at('E2E · rate limit per client: past 20 sign-in attempts in 15 minutes the client gets 429 with Retry-After (the right password included); another client is unaffected; the store keeps only HMAC keys', async () => {
    const ip = '192.0.2.77';
    for (let i = 0; i < 20; i++) assert.equal((await login(browser(ip), { op: 'signin', email: 'nobody' + i + '@x.test', password: 'wrong passphrase x' })).status, 401, 'attempt ' + (i + 1));
    const blocked = await login(browser(ip), { op: 'signin', email: 'founder@propx.test', password: 'a long founder passphrase' });
    assert.equal(blocked.status, 429); assert.equal(blocked.body.error, 'rate_limited'); assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal((await login(browser('192.0.2.78'), { op: 'signin', email: 'founder@propx.test', password: 'a long founder passphrase' })).status, 200, 'another client');
    assert.equal(owner(`select count(*) from private.auth_rate where key_hash !~ '^[0-9a-f]{64}$';`), '0');
    assert.ok(!owner(`select string_agg(key_hash, ',') from private.auth_rate;`).includes('192.0.2'), 'no address stored');
  });

  await at('E2E · no answer, cookie or log line carries a secret, a password, a hash or a store detail', async () => {
    const all = JSON.stringify([(await api(founder, 'status')).body, (await api(founder, 'admin-users')).body, (await login(browser(), { op: 'signin', email: 'founder@propx.test', password: 'wrong passphrase y' })).body]);
    for (const v of [IDKEY, SESSION, 'scrypt$', 'token_hash', 'password_hash', PWD]) assert.ok(!all.includes(v), v);
    assert.ok(!/scrypt|token/.test(owner(`select coalesce(string_agg(detail::text, ' '), '') from private.identity_events;`)));
  });

  console.log(`pilot access: ${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
