'use strict';
/* PRIVATE WORKSPACE · IDENTITY SERVER (STEP 2A, 19.10.2026) — sessions, cookie, database token, passwords, the kill switch,
   the POST guard, and (with PROPX_PG_URL naming a THROWAWAY PostgreSQL 16) every /api/identity flow end to end against
   the private migration through the local psql adapter: invite → activate → sign in → organizations / roles → sign out,
   with replay, forgery, fixation, perimeter binding, lockout, revocation and the kill switch. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { identityConfig, redact } = require('../lib/identity/config');
const { mint } = require('../lib/identity/token');
const PW = require('../lib/identity/password');
const C = require('../lib/identity/cookie');
const { restAdapter, FUNCTIONS } = require('../lib/identity/rest');
const { createHandler } = require('../api/identity');
const { createLogout } = require('../api/logout');

let n = 0;
const at = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const KEY = 'k'.repeat(40), JWT = 'j'.repeat(48);
const ENV_ON = { PROPX_IDENTITY: 'on', PROPX_ID_SECRET: KEY, SESSION_SECRET: 'perimeter-secret-0123456789' };
const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/* a minimal req / res pair, the way Vercel hands them to a function */
function call(handler, { method = 'GET', url = '/api/identity?op=status', cookie = '', body, headers = {} } = {}) {
  const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const req = require('node:stream').Readable.from(raw === undefined ? [] : [Buffer.from(raw)]);
  Object.assign(req, { method, url, headers: { host: 'propx.example', 'x-forwarded-proto': 'https', cookie,
    ...(method === 'POST' ? { 'content-type': 'application/json', 'x-propx-intent': '1', origin: 'https://propx.example', 'sec-fetch-site': 'same-origin' } : {}), ...headers } });
  return new Promise((resolve) => {
    const h = {}; let status = 200;
    const res = { setHeader: (k, v) => { h[k.toLowerCase()] = v; }, getHeader: (k) => h[k.toLowerCase()], set statusCode(v) { status = v; }, get statusCode() { return status; },
      end: (b) => { let json = null; try { json = JSON.parse(b || 'null'); } catch { json = b; } resolve({ status, headers: h, body: json }); } };
    handler(req, res);
  });
}
const setCookieOf = (r) => [].concat(r.headers['set-cookie'] || []).find((c) => c.startsWith(C.NAME + '=')) || null;
const valueOf = (sc) => sc && /^[^=]+=([^;]*)/.exec(sc)[1];

(async () => {
  console.log('identity server: units');

  await at('kill switch: OFF unless PROPX_IDENTITY is exactly "on"; a same-project, short or reused secret is refused', async () => {
    for (const v of [undefined, '', 'true', '1', 'ON', 'yes']) assert.equal(identityConfig({ PROPX_IDENTITY: v }).enabled, false, String(v));
    assert.deepEqual(identityConfig({ PROPX_IDENTITY: 'on' }), { enabled: false, reason: 'not-configured' });
    const full = { ...ENV_ON, PROPX_WS_URL: 'https://private-ws.supabase.co', PROPX_WS_APIKEY: 'anon-key-123456', PROPX_WS_JWT_SECRET: JWT };
    assert.equal(identityConfig(full).enabled, true);
    assert.equal(identityConfig({ ...full, SUPABASE_URL: 'https://PRIVATE-WS.supabase.co/' }).reason, 'same-project');
    assert.equal(identityConfig({ ...full, PROPX_ID_SECRET: 'short' }).reason, 'misconfigured');
    assert.equal(identityConfig({ ...full, PROPX_ID_SECRET: full.SESSION_SECRET.padEnd(40, 'x'), SESSION_SECRET: full.SESSION_SECRET.padEnd(40, 'x') }).reason, 'misconfigured');
    assert.equal(identityConfig({ ...full, PROPX_WS_URL: 'http://plain.example' }).reason, 'misconfigured');
    assert.equal(identityConfig({ ...full, PROPX_WS_JWT_SECRET: 'short' }).reason, 'misconfigured');
    const env = { ...full };
    const text = `x ${env.PROPX_WS_URL}/rest ${env.PROPX_WS_APIKEY} ${JWT} ${KEY} other.supabase.co eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoieCJ9.c2ln`;
    const red = redact(text, env);
    for (const v of [env.PROPX_WS_URL, 'private-ws', env.PROPX_WS_APIKEY, JWT, KEY, 'other.supabase.co', 'eyJhbGci']) assert.ok(!red.includes(v), v);
  });

  await at('database token: HS256, 120 s, only `authenticated` (with sub · sid · sv) or `propx_auth` — never service_role / anon', async () => {
    const sub = crypto.randomUUID(), sid = crypto.randomUUID();
    const t = mint({ role: 'authenticated', sub, sid, sv: 3 }, JWT, { now: 1_700_000_000_000 });
    const [h, p, s] = t.split('.');
    assert.deepEqual(b64json(h), { alg: 'HS256', typ: 'JWT' });
    const c = b64json(p);
    assert.deepEqual({ role: c.role, sub: c.sub, sid: c.sid, sv: c.sv, iss: c.iss }, { role: 'authenticated', sub, sid, sv: 3, iss: 'propx' });
    assert.equal(c.exp - c.iat, 120);
    assert.equal(s, crypto.createHmac('sha256', JWT).update(h + '.' + p).digest('base64url'));
    assert.equal(b64json(mint({ role: 'propx_auth' }, JWT).split('.')[1]).sub, undefined);
    for (const role of ['service_role', 'anon', 'postgres', 'supabase_admin', 'authenticator', undefined]) assert.throws(() => mint({ role, sub, sid, sv: 1 }, JWT), /refused role/);
    assert.throws(() => mint({ role: 'authenticated', sub }, JWT), /incomplete/);
    assert.throws(() => mint({ role: 'authenticated', sub, sid, sv: 1 }, 'short'), /secret/);
    assert.equal(b64json(mint({ role: 'propx_auth' }, JWT, { ttl: 99999 }).split('.')[1]).exp - b64json(mint({ role: 'propx_auth' }, JWT).split('.')[1]).iat <= 121, true);
  });

  await at('passwords: scrypt with a random salt, constant-time check, a policy, foreign parameters never trusted', async () => {
    const h1 = await PW.hash('correct horse battery'), h2 = await PW.hash('correct horse battery');
    assert.match(h1, /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    assert.notEqual(h1, h2, 'salted');
    assert.equal(await PW.verify('correct horse battery', h1), true);
    assert.equal(await PW.verify('correct horse batterx', h1), false);
    assert.equal(await PW.verify('anything', null), false, 'unknown user → dummy, false');
    assert.equal(await PW.verify('correct horse battery', h1.replace('$32768$', '$1024$')), false);
    assert.equal(PW.policy('short'), 'password_too_short');
    assert.equal(PW.policy('aaaaaaaaaaaaaaaa'), 'password_too_weak');
    assert.equal(PW.policy('x'.repeat(300) + 'y'), 'password_too_long');
    assert.equal(PW.policy('a fine passphrase'), null);
  });

  await at('identity cookie: __Host- · Secure · HttpOnly · SameSite=Strict · Path=/; tampering, another key and expiry are refused', async () => {
    const claims = { sid: crypto.randomUUID(), uid: crypto.randomUUID(), sv: 1, iat: 1, exp: Math.floor(Date.now() / 1000) + 600, ph: 'a'.repeat(32) };
    const { value } = C.issue(claims, KEY);
    const sc = C.serialize(value);
    assert.match(sc, /^__Host-propx_id=v1\./);
    for (const a of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(sc.includes(a), a);
    assert.ok(!/Domain=/i.test(sc));
    const ok = C.parse(`a=b; ${C.NAME}=${value}`, KEY);
    assert.equal(ok.uid, claims.uid);
    const [v, p, s, sig] = value.split('.');
    const forged = `${v}.${Buffer.from(JSON.stringify({ ...claims, uid: crypto.randomUUID() })).toString('base64url')}.${s}.${sig}`;
    assert.equal(C.parse(`${C.NAME}=${forged}`, KEY), null, 'forged user id');
    assert.equal(C.parse(`${C.NAME}=${v}.${p}.${'A'.repeat(43)}.${sig}`, KEY), null, 'swapped secret');
    assert.equal(C.parse(`${C.NAME}=${value}`, 'x'.repeat(40)), null, 'other key');
    assert.equal(C.parse(`${C.NAME}=${C.issue({ ...claims, exp: 5 }, KEY).value}`, KEY), null, 'expired');
    assert.equal(C.parse(`${C.NAME}=garbage`, KEY), null);
    assert.match(C.clear(), /Max-Age=0/);
    assert.equal(C.perimeterHash('x=1'), null);
    assert.match(C.perimeterHash('kobix_session=123.abc'), /^[0-9a-f]{32}$/);
  });

  await at('store adapter: only the ws functions, gateway key + a minted user token, schema ws; never the public project or a service key', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: false, status: 403, text: async () => JSON.stringify({ code: '42501', message: 'denied https://private-ws.supabase.co' }) }; };
    const cfg = { url: 'https://private-ws.supabase.co', apikey: 'anon-key-123456', jwtSecret: JWT };
    const db = restAdapter(cfg, { fetchImpl });
    const sub = crypto.randomUUID(), sid = crypto.randomUUID();
    const r = await db.rpc('org_members', { p_org: sub }, { role: 'authenticated', sub, sid, sv: 1 });
    assert.deepEqual({ ok: r.ok, code: r.code }, { ok: false, code: '42501' });
    assert.ok(!r.message.includes('private-ws'), 'store host redacted');
    const { url, init } = seen[0];
    assert.equal(url, 'https://private-ws.supabase.co/rest/v1/rpc/org_members');
    assert.equal(init.headers.apikey, 'anon-key-123456');
    assert.equal(init.headers['content-profile'], 'ws');
    assert.equal(b64json(init.headers.authorization.split(' ')[1].split('.')[1]).role, 'authenticated');
    await assert.rejects(() => db.rpc('auth_x', {}, { role: 'propx_auth' }), /unknown function/);
    await assert.rejects(() => db.rpc('me', {}, { role: 'service_role' }), /refused role/);
    assert.equal(FUNCTIONS.size, 20);
    const src = ['lib/identity/rest.js', 'lib/identity/service.js', 'lib/identity/config.js', 'api/identity.js', 'api/logout.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|service_role'|storeConfig|SUPABASE_URL\b(?!.*same-project)/.test(src.replace(/\/\/.*$/gm, '')), 'the identity code never reads the public store settings or a service key');
  });

  await at('kill switch OFF: status says {enabled:false}, every other operation 503, no store is touched', async () => {
    let touched = 0;
    const spy = { rpc: async () => { touched++; return { ok: true, value: null }; } };
    const off = createHandler({ adapter: null, env: {} });
    assert.deepEqual((await call(off)).body, { enabled: false });
    for (const op of ['signin', 'activate', 'invite', 'signout']) assert.equal((await call(off, { method: 'POST', url: '/api/identity?op=' + op, body: {} })).status, 503);
    const offInjected = createHandler({ adapter: spy, env: { PROPX_ID_SECRET: KEY } });
    assert.deepEqual((await call(offInjected)).body, { enabled: false });
    assert.equal((await call(offInjected, { method: 'POST', url: '/api/identity?op=signin', body: { email: 'a@b.c', password: 'x' } })).status, 503);
    assert.equal(touched, 0);
  });

  await at('POST guard: the intent header, JSON, same origin and an 8 KB body are required before anything is read', async () => {
    let touched = 0;
    const h = createHandler({ adapter: { rpc: async () => { touched++; return { ok: true, value: null }; } }, env: ENV_ON });
    const post = (headers, body = { email: 'a@b.c', password: 'x' }) => call(h, { method: 'POST', url: '/api/identity?op=signin', body, headers, cookie: 'kobix_session=1.a' });
    assert.equal((await post({ 'x-propx-intent': undefined })).body.reason, 'intent');
    assert.equal((await post({ 'content-type': 'text/plain' })).body.reason, 'content-type');
    assert.equal((await post({ 'content-type': 'application/x-www-form-urlencoded' })).body.reason, 'content-type');
    assert.equal((await post({ origin: 'https://evil.example' })).body.reason, 'origin');
    assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).body.reason, 'origin');
    assert.equal((await post({}, { email: 'x'.repeat(9000) })).status, 413);
    assert.equal((await post({ 'content-length': '9000' })).status, 413);
    assert.equal((await post({}, '[1,2]')).status, 400);
    assert.equal(touched, 0, 'refused before the store');
    assert.equal((await call(h, { method: 'DELETE' })).status, 405);
    assert.equal((await call(h, { url: '/api/identity?op=signin' })).status, 404, 'a POST operation is not reachable by GET');
  });

  /* ───────────── end to end against the private migration ───────────── */
  const PG = process.env.PROPX_PG_URL;
  if (!PG) {
    console.log('  · database flows SKIPPED: PROPX_PG_URL is not set (they run in .github/workflows/private-identity.yml)');
    console.log(`identity server: ${n} passed (units only)`);
    return;
  }
  const { psqlAdapter } = require('../scripts/identity-psql-adapter');
  const PWD = 'local-test-' + crypto.randomBytes(6).toString('hex');
  const DB = 'propx_ws_srv_' + process.pid;
  const base = new URL(PG);
  const urlFor = (user, pw, db = DB) => { const u = new URL(PG); u.username = user; u.password = pw; u.pathname = '/' + db; return u.toString(); };
  const SUPERPW = decodeURIComponent(base.password);
  const psql = (url, text, vars = {}) => spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), '-f', '-'], { input: text, encoding: 'utf8' });
  let r = psql(urlFor(base.username, SUPERPW, base.pathname.slice(1) || 'postgres'), `create database ${DB};`); assert.equal(r.status, 0, r.stderr);
  r = psql(urlFor(base.username, SUPERPW), fs.readFileSync(path.join(ROOT, 'supabase/private/test/supabase-roles-shim.sql'), 'utf8'), { pw: `'${PWD}'`, DBNAME: DB }); assert.equal(r.status, 0, r.stderr);
  r = psql(urlFor('ws_owner', PWD), fs.readFileSync(path.join(ROOT, 'supabase/private/migrations/20261019120000_identity_foundation.sql'), 'utf8')); assert.equal(r.status, 0, r.stderr);
  process.on('exit', () => { if (!process.env.PROPX_PG_KEEP) psql(urlFor(base.username, SUPERPW, base.pathname.slice(1) || 'postgres'), `drop database if exists ${DB} with (force);`); });
  const db = psqlAdapter(urlFor('authenticator', PWD));
  const H = createHandler({ adapter: db, env: ENV_ON });
  const LOGOUT = createLogout({ adapter: db, env: ENV_ON });
  const owner = (sql) => { const x = psql(urlFor('ws_owner', PWD), sql); assert.equal(x.status, 0, x.stderr); return x.stdout.trim(); };

  console.log('identity server: end to end (' + DB + ')');
  const perimeter = () => 'kobix_session=' + Date.now() + '.' + crypto.randomBytes(32).toString('hex');
  const browser = () => ({ per: perimeter(), id: null, get cookie() { return this.per + (this.id ? `; ${C.NAME}=${this.id}` : ''); } });
  const post = (b, op, body, extra = {}) => call(H, { method: 'POST', url: '/api/identity?op=' + op, body, cookie: b.cookie, ...extra }).then((x) => { const sc = setCookieOf(x); if (sc) b.id = valueOf(sc) || null; return x; });
  const get = (b, q) => call(H, { url: '/api/identity?' + q, cookie: b.cookie }).then((x) => { const sc = setCookieOf(x); if (sc) b.id = valueOf(sc) || null; return x; });
  const tokenOf = (link) => /#invite=([A-Za-z0-9_-]{43})$/.exec(link)[1];

  const T0 = owner(`select private.bootstrap('admin@propx.test', 'Platform Admin', 'PROPX');`);
  const admin = browser();

  await at('activation through the invitation link: the link opens what it is for; a weak password is refused; then a signed-in session', async () => {
    const info = await post(admin, 'invite-info', { token: T0 });
    assert.deepEqual({ ...info.body.invite, expiresAt: 0 }, { orgName: 'PROPX', role: 'owner', email: 'admin@propx.test', needsActivation: true, expiresAt: 0 });
    assert.equal((await post(admin, 'activate', { token: T0, password: 'short', displayName: 'Admin' })).body.error, 'password_too_short');
    assert.equal((await post(admin, 'invite-info', { token: 'A'.repeat(43) })).status, 404);
    const act = await post(admin, 'activate', { token: T0, password: 'admin passphrase 1', displayName: 'Platform Admin' });
    assert.equal(act.status, 200, JSON.stringify(act.body));
    assert.ok(admin.id && /^v1\./.test(admin.id));
    const st = (await get(admin, 'op=status')).body;
    assert.equal(st.signedIn, true);
    assert.equal(st.user.email, 'admin@propx.test'); assert.equal(st.user.platformAdmin, true);
    assert.deepEqual(st.organizations.map((o) => [o.kind, o.role, o.name]), [['personal', 'owner', 'Platform Admin'], ['team', 'owner', 'PROPX']]);
    assert.ok(Date.parse(st.session.expiresAt) - Date.parse(st.session.issuedAt) <= 8 * 3600e3);
    assert.equal((await post(browser(), 'activate', { token: T0, password: 'another passphrase', displayName: 'x' })).body.error, 'invite_invalid', 'single use');
  });

  const propxOrg = (await get(admin, 'op=status')).body.organizations.find((o) => o.kind === 'team').id;
  const ana = browser();
  await at('an OWNER invites; the link (fragment, shown once) activates a new user; WHO / WHICH ORGS / WHAT ROLE come from the store', async () => {
    const inv = await post(admin, 'invite', { org: propxOrg, email: 'Analyst@Example.TEST', role: 'analyst' });
    assert.equal(inv.status, 200, JSON.stringify(inv.body));
    assert.match(inv.body.invite.link, /^https:\/\/propx\.example\/#invite=[A-Za-z0-9_-]{43}$/);
    assert.equal(inv.body.invite.email, 'analyst@example.test');
    assert.equal((await post(ana, 'activate', { token: tokenOf(inv.body.invite.link), password: 'analyst passphrase', displayName: 'Ana Lyst' })).status, 200);
    const st = (await get(ana, 'op=status')).body;
    assert.deepEqual(st.organizations.map((o) => [o.kind, o.role]), [['personal', 'owner'], ['team', 'analyst']]);
    const members = (await get(ana, 'op=members&org=' + propxOrg)).body.result;
    assert.deepEqual(members.map((m) => [m.email, m.role]).sort(), [['admin@propx.test', 'owner'], ['analyst@example.test', 'analyst']]);
    assert.equal((await post(ana, 'invite', { org: propxOrg, email: 'x@x.test', role: 'viewer' })).status, 403, 'an analyst cannot invite');
    assert.equal((await post(ana, 'set-role', { org: propxOrg, user: st.user.id, role: 'owner' })).status, 403, 'nor promote themself');
  });

  await at('sign-in: one answer for unknown email / wrong password / locked; 5 failures lock; the right password while locked still fails', async () => {
    const b = browser();
    const bad = await post(b, 'signin', { email: 'analyst@example.test', password: 'wrong passphrase' });
    const unknown = await post(b, 'signin', { email: 'nobody@example.test', password: 'wrong passphrase' });
    assert.deepEqual([bad.status, bad.body], [401, { ok: false, error: 'signin_failed' }]);
    assert.deepEqual([unknown.status, unknown.body], [bad.status, bad.body]);
    for (let i = 0; i < 4; i++) await post(b, 'signin', { email: 'analyst@example.test', password: 'wrong passphrase ' + i });
    const locked = await post(b, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    assert.deepEqual([locked.status, locked.body], [bad.status, bad.body]);
    assert.equal(b.id, null);
    owner(`update private.user_credentials set locked_until = now() - interval '1 second' where user_id = (select id from ws.users where email = 'analyst@example.test');`);
    assert.equal((await post(b, 'signin', { email: ' ANALYST@example.test ', password: 'analyst passphrase' })).status, 200);
    assert.equal((await get(b, 'op=status')).body.signedIn, true);
  });

  await at('session fixation: a cookie the browser brings is never adopted — sign-in mints a new session and ends the old one', async () => {
    const b = browser();
    await post(b, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    const first = b.id;
    await post(b, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    assert.notEqual(b.id, first);
    const replay = { per: b.per, id: first, get cookie() { return this.per + `; ${C.NAME}=${this.id}`; } };
    assert.equal((await get(replay, 'op=status')).body.signedIn, false, 'the previous session of that browser ended');
  });

  await at('replay after sign-out, a forged user id, another key and another perimeter session are not signed in', async () => {
    const b = browser();
    await post(b, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    const kept = b.id;
    // perimeter binding: the identity cookie alone, with another browser login, is nothing
    const other = { per: perimeter(), id: kept, get cookie() { return this.per + `; ${C.NAME}=${this.id}`; } };
    const st = await get(other, 'op=status');
    assert.equal(st.body.signedIn, false); assert.match(setCookieOf(st), /Max-Age=0/, 'an unusable identity cookie is cleared');
    // forged user id: re-signed with a wrong key / unsigned
    const [v, p, s] = kept.split('.');
    const adminId = (await get(admin, 'op=status')).body.user.id;
    const claims = { ...b64json(p), uid: adminId };
    const body = `${v}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`;
    for (const forged of [`${body}.${crypto.createHmac('sha256', 'wrong-key-'.repeat(4)).update('propx-id|' + body).digest('base64url')}`, `${body}.x`]) {
      assert.equal((await get({ per: b.per, id: forged, get cookie() { return this.per + `; ${C.NAME}=${this.id}`; } }, 'op=status')).body.signedIn, false);
    }
    // even a correctly SIGNED cookie naming someone else's id fails the store check (sid ↔ sub)
    const signed = `${body}.${crypto.createHmac('sha256', KEY).update('propx-id|' + body).digest('base64url')}`;
    assert.equal((await get({ per: b.per, id: signed, get cookie() { return this.per + `; ${C.NAME}=${this.id}`; } }, 'op=status')).body.signedIn, false);
    // sign-out ends it on the server: the old cookie replayed is nothing
    const out = await post(b, 'signout', {});
    assert.match(setCookieOf(out), /Max-Age=0/);
    assert.equal((await get({ per: b.per, id: kept, get cookie() { return this.per + `; ${C.NAME}=${this.id}`; } }, 'op=status')).body.signedIn, false);
  });

  await at('sign out everywhere ends the user\'s other browsers; a platform-admin revocation and a disabled user end them too', async () => {
    const b1 = browser(), b2 = browser();
    await post(b1, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    await post(b2, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    assert.equal((await post(b1, 'signout-all', {})).status, 200);
    assert.equal((await get(b2, 'op=status')).body.signedIn, false);
    await post(b2, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    const uid = (await get(b2, 'op=status')).body.user.id;
    assert.equal((await post(b2, 'admin-revoke-sessions', { user: uid })).status, 403, 'not a platform admin');
    assert.equal((await post(admin, 'admin-revoke-sessions', { user: uid })).status, 200);
    assert.equal((await get(b2, 'op=status')).body.signedIn, false);
    await post(b2, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    assert.equal((await post(admin, 'admin-user-status', { user: uid, status: 'disabled' })).status, 200);
    assert.equal((await get(b2, 'op=status')).body.signedIn, false);
    assert.equal((await post(browser(), 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' })).body.error, 'signin_failed');
    assert.equal((await post(admin, 'admin-user-status', { user: uid, status: 'active' })).status, 200);
    const list = (await get(admin, 'op=admin-users')).body.result;
    assert.ok(list.length >= 2 && list.every((u) => !JSON.stringify(u).includes('scrypt')));
  });

  await at('team workspaces: create, invite an EXISTING user (sign in + accept with the link), roles, revoke, archive', async () => {
    const team = (await post(admin, 'create-team', { name: 'Deal Team' })).body.result.org_id;
    const inv = await post(admin, 'invite', { org: team, email: 'analyst@example.test', role: 'viewer' });
    const t = tokenOf(inv.body.invite.link);
    assert.equal((await post(browser(), 'invite-info', { token: t })).body.invite.needsActivation, false);
    assert.equal((await post(browser(), 'activate', { token: t, password: 'attacker passphrase', displayName: 'x' })).body.error, 'invite_invalid', 'no password reset through an invitation');
    const b = browser();
    await post(b, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    assert.equal((await post(admin, 'accept', { token: t })).body.error, 'invite_invalid', 'nobody else accepts it');
    assert.equal((await post(b, 'accept', { token: t })).status, 200);
    assert.ok((await get(b, 'op=status')).body.organizations.some((o) => o.id === team && o.role === 'viewer'));
    const uid = (await get(b, 'op=status')).body.user.id;
    assert.equal((await post(admin, 'set-role', { org: team, user: uid, role: 'admin' })).status, 200);
    assert.equal((await post(b, 'set-role', { org: team, user: (await get(admin, 'op=status')).body.user.id, role: 'viewer' })).status, 403, 'an admin never demotes the owner');
    assert.equal((await post(admin, 'set-role', { org: team, user: (await get(admin, 'op=status')).body.user.id, role: 'admin' })).body.error, 'last_owner');
    assert.equal((await post(admin, 'revoke-member', { org: team, user: uid })).status, 200);
    assert.equal((await get(b, 'op=members&org=' + team)).status, 403, 'revoked: immediately');
    assert.equal((await post(admin, 'archive', { org: team, archived: true })).status, 200);
    assert.equal((await post(admin, 'invite', { org: team, email: 'z@z.test', role: 'viewer' })).body.error, 'archived');
    assert.equal((await post(admin, 'archive', { org: team, archived: false })).status, 200);
    assert.equal((await post(admin, 'set-role', { org: 'not-a-uuid', user: uid, role: 'viewer' })).body.error, 'invalid_input');
  });

  await at('logout ends the named session on the server and clears both cookies', async () => {
    const b = browser();
    await post(b, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    const kept = b.id;
    const res = await call(LOGOUT, { url: '/api/logout', cookie: b.cookie });
    assert.equal(res.status, 302); assert.equal(res.headers.location, '/login.html');
    const cookies = [].concat(res.headers['set-cookie']);
    assert.ok(cookies.some((c) => /^kobix_session=;.*Max-Age=0/.test(c)) && cookies.some((c) => c.startsWith(C.NAME + '=;') && /Max-Age=0/.test(c)));
    assert.equal((await get({ per: b.per, id: kept, get cookie() { return this.per + `; ${C.NAME}=${this.id}`; } }, 'op=status')).body.signedIn, false);
    const off = await call(createLogout({ env: {} }), { url: '/api/logout', cookie: b.cookie });
    assert.equal(off.status, 302, 'with the switch off logout behaves as before');
  });

  await at('no answer carries a token hash, a password hash, the cookie secret or a store detail', async () => {
    const all = JSON.stringify([(await get(admin, 'op=status')).body, (await get(admin, 'op=members&org=' + propxOrg)).body, (await get(admin, 'op=admin-users')).body]);
    assert.ok(!/scrypt|token_hash|invite_token|secret|perimeter/i.test(all), all.slice(0, 200));
    const fresh = browser();
    await post(fresh, 'signin', { email: 'analyst@example.test', password: 'analyst passphrase' });
    const denied = await post(fresh, 'set-role', { org: crypto.randomUUID(), user: crypto.randomUUID(), role: 'viewer' });
    assert.deepEqual(denied.body, { ok: false, error: 'denied' });
  });

  console.log(`identity server: ${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
