'use strict';
/* PRIVATE WORKSPACE · IDENTITY FOUNDATION (STEP 2A, 19.10.2026) — the two-organization isolation gate (HARD BLOCKER: no
   private persistence is activated while any of these fails).

   Static gates (always): the migration's shape — RLS on every table, every SECURITY DEFINER function pinned to an empty
   search_path, no DELETE / UPDATE / INSERT grant, no actor parameter, the shim is test-only.
   Database gates (when PROPX_PG_URL names a THROWAWAY PostgreSQL 16 superuser connection — scripts/private-pg-local.sh, or
   the postgres:16 service in .github/workflows/private-identity.yml): a fresh database, the Supabase role shim with
   deliberately permissive platform defaults, the migration applied by a NON-superuser owner, then every call made the way
   the API makes it — connected as `authenticator`, SET LOCAL ROLE + request.jwt.claims (PostgREST semantics). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/private/migrations/20261019120000_identity_foundation.sql');
const SHIM = path.join(ROOT, 'supabase/private/test/supabase-roles-shim.sql');
const SQL = fs.readFileSync(MIGRATION, 'utf8');

let n = 0;
const at = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

/* ───────────── static gates ───────────── */
console.log('private identity: static');
at('the private migration lives apart from the public `market` migrations and is the only one', () => {
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'supabase/private/migrations')), ['20261019120000_identity_foundation.sql']);
  for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations'))) assert.ok(!/\bws\./.test(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')), f);
  assert.ok(!/\bmarket\./.test(SQL.replace(/--.*$/gm, '')), 'the private schema never names the public market schema');
});
at('identity tables only: users, organizations, members, sessions (+ the credential half of users and the event log, unexposed)', () => {
  const tables = [...SQL.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(tables, ['private.identity_events', 'private.user_credentials', 'ws.organization_members', 'ws.organizations', 'ws.sessions', 'ws.users']);
  assert.ok(!/evidence|deal|thesis|bucket|storage\./i.test(SQL.replace(/--.*$/gm, '')), 'no evidence / deal / thesis / storage object (D3 · D5 · D6)');
});
at('RLS is enabled on every table; no table privilege beyond column SELECT; no DELETE / INSERT / UPDATE grant anywhere', () => {
  const tables = [...SQL.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]);
  for (const t of tables) assert.ok(new RegExp('alter table ' + t.replace('.', '\\.') + ' enable row level security').test(SQL), t);
  const grants = [...SQL.matchAll(/^grant ([^;]+);/gm)].map((m) => m[1]);
  for (const g of grants) assert.ok(!/\b(insert|update|delete|truncate|all)\b/i.test(g), g);
  assert.ok(!/force row level security/i.test(SQL));
});
at('every SECURITY DEFINER function pins search_path to empty; no API function (ws.*) takes an actor / created_by argument', () => {
  const fns = SQL.split(/\ncreate function /).slice(1);
  for (const f of fns) {
    const head = f.slice(0, f.indexOf('$$'));
    if (/security definer/.test(head)) assert.ok(/set search_path = ''/.test(head), head.slice(0, 60));
    if (/^ws\./.test(f)) assert.ok(!/\bp_(created_by|added_by|invited_by|actor|uid|caller|updated_by|revoked_by)\b/.test(head), head.slice(0, 60));
  }
  assert.ok(fns.length >= 30, 'functions ' + fns.length);
});
at('the role shim is a TEST HARNESS file, never a migration', () => {
  assert.match(fs.readFileSync(SHIM, 'utf8'), /^-- TEST HARNESS ONLY/);
  assert.ok(!fs.readdirSync(path.join(ROOT, 'supabase/private/migrations')).some((f) => /shim/.test(f)));
});

/* ───────────── database gates ───────────── */
const PG = process.env.PROPX_PG_URL;
if (!PG) {
  console.log('  · database gates SKIPPED: PROPX_PG_URL is not set (they run in .github/workflows/private-identity.yml; locally: scripts/private-pg-local.sh start)');
  console.log(`private identity: ${n} passed (static only)`);
  process.exit(0);
}

const PW = 'local-test-' + crypto.randomBytes(6).toString('hex');
const DB = 'propx_ws_test_' + process.pid;
const urlFor = (user, db = DB, pw) => { const u = new URL(PG); u.username = user; u.password = pw === undefined ? (user === new URL(PG).username ? decodeURIComponent(new URL(PG).password) : PW) : pw; u.pathname = '/' + db; return u.toString(); };
const SUPER = urlFor(new URL(PG).username);
const OWNER = urlFor('ws_owner');
const API = urlFor('authenticator');

function psql(url, text, vars = {}) {
  const args = [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  const r = spawnSync('psql', [...args, '-f', '-'], { input: text, encoding: 'utf8' });
  const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(r.stderr || '');
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '', code: m && m[1], message: m && m[2] };
}
const lit = (v) => v === null || v === undefined ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const call = (fn, args = {}) => `ws.${fn}(${Object.entries(args).map(([k, v]) => `${k} := ${lit(v)}`).join(', ')})`;

/** run one expression the way the API would: as `role`, with the token's claims; returns the parsed JSON value or the error */
function as(ctx, expr) {
  const claims = JSON.stringify(ctx.claims || { role: ctx.role });
  const r = psql(API, `begin;\nset local role ${ctx.role};\nselect set_config('request.jwt.claims', ${lit(claims)}, true) is null;\nselect '@@' || coalesce((${expr})::text, 'null');\ncommit;\n`);
  if (!r.ok) return { error: true, code: r.code, message: r.message, raw: r.err };
  const line = r.out.split('\n').find((l) => l.startsWith('@@'));
  const txt = line.slice(2);
  try { return { value: JSON.parse(txt) }; } catch { return { value: txt }; }
}
/** a raw statement (a write) as an API role */
function asStmt(ctx, stmt) {
  const claims = JSON.stringify(ctx.claims || { role: ctx.role });
  const r = psql(API, `begin;\nset local role ${ctx.role};\nselect set_config('request.jwt.claims', ${lit(claims)}, true) is null;\n${stmt};\ncommit;\n`);
  return r.ok ? { value: r.out } : { error: true, code: r.code, message: r.message, raw: r.err };
}
const owner = (text) => psql(OWNER, text);
const ownerVal = (expr) => { const r = owner(`select '@@' || coalesce((${expr})::text, 'null');`); assert.ok(r.ok, r.err); const t = r.out.split('\n').find((l) => l.startsWith('@@')).slice(2); try { return JSON.parse(t); } catch { return t; } };
const ok = (r, what) => { assert.ok(!r.error, (what || '') + ' → ' + (r.raw || '')); return r.value; };
const denied = (r, what) => { assert.ok(r.error, (what || '') + ' was allowed: ' + JSON.stringify(r.value)); assert.equal(r.code, '42501', (what || '') + ' ' + r.raw); return r; };
const failsWith = (r, word, what) => { assert.ok(r.error, (what || '') + ' was allowed'); assert.equal(r.message, word, (what || '') + ' ' + r.raw); };

const AUTH = { role: 'propx_auth', claims: { role: 'propx_auth' } };
const tok = () => crypto.randomBytes(32).toString('base64url');
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const perim = () => crypto.randomBytes(16).toString('hex');
/** a signed-in user = a live session opened by the sign-in plane; ctx carries the claims the server would mint */
function session(userId) {
  const s = ok(as(AUTH, call('auth_session_open', { p_user_id: userId, p_token_hash: sha(tok()), p_perimeter_hash: perim(), p_ttl_seconds: 28800 })), 'session');
  return { role: 'authenticated', userId, sid: s.session_id, claims: { role: 'authenticated', sub: userId, sid: s.session_id, sv: s.session_version } };
}
function activate(rawToken, name) {
  return ok(as(AUTH, call('auth_activate', { p_token_hash: sha(rawToken), p_password_hash: 'scrypt$test$' + name, p_display_name: name })), 'activate ' + name).user_id;
}
function invite(ctx, org, email, role) {
  const t = tok();
  ok(as(ctx, call('invite_member', { p_org: org, p_email: email, p_role: role, p_token_hash: sha(t) })), `invite ${email} as ${role}`);
  return t;
}

// fresh database + shim + migration (as the non-superuser owner)
{
  const c = psql(urlFor(new URL(PG).username, new URL(PG).pathname.slice(1) || 'postgres'), `create database ${DB};`);
  assert.ok(c.ok, c.err);
  const s = psql(SUPER, fs.readFileSync(SHIM, 'utf8'), { pw: `'${PW}'`, DBNAME: DB });
  assert.ok(s.ok, s.err);
  const m = psql(OWNER, SQL);
  assert.ok(m.ok, 'migration: ' + m.err);
}
const cleanup = () => { if (!process.env.PROPX_PG_KEEP) psql(urlFor(new URL(PG).username, new URL(PG).pathname.slice(1) || 'postgres'), `drop database if exists ${DB} with (force);`); };
process.on('exit', cleanup);

console.log('private identity: database (' + DB + ')');

at('the migration applies as a NON-superuser owner and is the owner of every object in ws / private', () => {
  assert.equal(ownerVal(`(select rolsuper from pg_roles where rolname = current_user)`), false);
  assert.equal(ownerVal(`(select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname in ('ws','private') and c.relkind in ('r','p') and pg_get_userbyid(c.relowner) <> 'ws_owner')`), 0);
});

// ── setup: bootstrap → the platform admin; two independent organizations A and B with every role ──
const T0 = ownerVal(`private.bootstrap('admin@propx.test', 'Platform Admin', 'PROPX')`);
const PADMIN = activate(T0, 'Platform Admin');
const P = session(PADMIN);
const PROPX_ORG = ok(as(P, call('me'))).organizations.find((o) => o.kind === 'team').id;

const A1 = activate(invite(P, PROPX_ORG, 'a1@a.test', 'viewer'), 'A One'); const cA1 = session(A1);
const orgA = ok(as(cA1, call('create_team', { p_name: 'Org A' }))).org_id;
const A2 = activate(invite(cA1, orgA, 'a2@a.test', 'viewer'), 'A Two'); const cA2 = session(A2);
const B1 = activate(invite(P, PROPX_ORG, 'b1@b.test', 'viewer'), 'B One'); const cB1 = session(B1);
const orgB = ok(as(cB1, call('create_team', { p_name: 'Org B' }))).org_id;
const B2 = activate(invite(cB1, orgB, 'b2@b.test', 'analyst'), 'B Two'); const cB2 = session(B2);
const B3 = activate(invite(cB1, orgB, 'b3@b.test', 'admin'), 'B Three'); const cB3 = session(B3);
const B4 = activate(invite(cB1, orgB, 'b4@b.test', 'viewer'), 'B Four'); const cB4 = session(B4);
const NOWHERE = crypto.randomUUID();
const snapshotB = () => ownerVal(`(select jsonb_agg(to_jsonb(m) order by m.user_id) from ws.organization_members m where m.org_id = '${orgB}')`)
  .map(({ updated_at, ...r }) => r);

at('setup: a bootstrap platform admin, team A (owner + viewer) and team B (owner + admin + analyst + viewer); everyone has a personal workspace', () => {
  const me = ok(as(cB1, call('me')));
  assert.equal(me.user.email, 'b1@b.test');
  assert.deepEqual(me.organizations.map((o) => [o.kind, o.role]), [['personal', 'owner'], ['team', 'owner'], ['team', 'viewer']]);
  assert.deepEqual(ok(as(cB1, call('org_members', { p_org: orgB }))).map((m) => [m.email, m.role, m.status]).sort(),
    [['b1@b.test', 'owner', 'active'], ['b2@b.test', 'analyst', 'active'], ['b3@b.test', 'admin', 'active'], ['b4@b.test', 'viewer', 'active']]);
});

const B_BEFORE = snapshotB();

at('A cannot read B — through the functions, through direct table reads, through the user table', () => {
  for (const c of [cA1, cA2]) {
    denied(as(c, call('org_members', { p_org: orgB })), 'org_members(B)');
    assert.equal(ok(as(c, `(select count(*) from ws.organizations where id = '${orgB}')`)), 0);
    assert.equal(ok(as(c, `(select count(*) from ws.organization_members where org_id = '${orgB}')`)), 0);
    assert.ok(!ok(as(c, call('me'))).organizations.some((o) => o.id === orgB));
    assert.equal(ok(as(c, `(select count(*) from ws.users)`)), 1, 'a user reads only their own user row');
    assert.equal(ok(as(c, `(select count(*) from ws.users where email like 'b%')`)), 0);
  }
  const own = ok(as(cA1, `(select count(*) from ws.organizations)`));
  assert.equal(own, ok(as(cA1, call('me'))).organizations.length, 'direct reads = exactly the active memberships');
});

at('A cannot write B — invite, change a role, revoke, revoke an invitation, archive: all denied, B unchanged', () => {
  for (const c of [cA1, cA2]) {
    denied(as(c, call('invite_member', { p_org: orgB, p_email: 'x@x.test', p_role: 'viewer', p_token_hash: sha(tok()) })));
    denied(as(c, call('set_member_role', { p_org: orgB, p_user: B2, p_role: 'viewer' })));
    denied(as(c, call('revoke_member', { p_org: orgB, p_user: B4 })));
    denied(as(c, call('revoke_invitation', { p_org: orgB, p_user: B4 })));
    denied(as(c, call('set_org_archived', { p_org: orgB, p_archived: true })));
    denied(as(c, call('revoke_member', { p_org: orgB, p_user: c.userId })), 'leave an org one is not in');
  }
  assert.deepEqual(snapshotB(), B_BEFORE);
});

at('no direct write path exists: INSERT / UPDATE / DELETE on every table are refused for every API role', () => {
  for (const c of [cA1, cB1, P]) {
    denied(asStmt(c, `insert into ws.organizations (name, kind) values ('forged', 'team')`), 'insert org');
    denied(asStmt(c, `insert into ws.organization_members (org_id, user_id, role, status) values ('${orgB}', '${c.userId}', 'owner', 'active')`), 'insert member');
    denied(asStmt(c, `update ws.organization_members set role = 'owner' where org_id = '${orgA}'`), 'update member');
    denied(asStmt(c, `delete from ws.organization_members where org_id = '${orgA}'`), 'delete member');
    denied(asStmt(c, `update ws.users set is_platform_admin = true`), 'update user');
    denied(as(c, `(select count(*) from ws.sessions)`), 'sessions');
  }
  assert.deepEqual(snapshotB(), B_BEFORE);
});

at('A cannot forge org_id / created_by: the actor always comes from the session; a forged sub / sid / sv is not signed in', () => {
  const t = ok(as(cA1, call('create_team', { p_name: 'A second' })));
  assert.equal(ownerVal(`(select created_by::text from ws.organizations where id = '${t.org_id}')`), A1);
  assert.ok(as(cA1, `ws.create_team(p_name := 'x', p_created_by := '${B1}')`).error, 'no created_by parameter exists');
  const forged = [
    { role: 'authenticated', sub: B1, sid: cA1.sid, sv: 1 },            // A's session, B's id
    { role: 'authenticated', sub: B1, sid: crypto.randomUUID(), sv: 1 }, // invented session
    { role: 'authenticated', sub: A1, sid: cA1.sid, sv: 2 },            // wrong session version
    { role: 'authenticated', sub: B1 },                                 // no session at all
    { role: 'service_role', sub: B1, sid: cB1.sid, sv: 1 },             // a role claim that is not the signed-in role
    { role: 'authenticated', sub: 'not-a-uuid', sid: "x' or '1'='1", sv: '1; drop' },
  ];
  for (const claims of forged) {
    denied(as({ role: 'authenticated', claims }, call('me')), JSON.stringify(claims));
    assert.equal(ok(as({ role: 'authenticated', claims }, `(select count(*) from ws.organizations)`)), 0);
  }
});

at('a revoked member loses access at once (same token); a disabled user, a global sign-out, an admin revocation and a sign-out end every read', () => {
  ok(as(cB1, call('revoke_member', { p_org: orgB, p_user: B4 })));
  denied(as(cB4, call('org_members', { p_org: orgB })), 'revoked member');
  assert.equal(ok(as(cB4, `(select count(*) from ws.organization_members where org_id = '${orgB}')`)), 0);
  assert.ok(ok(as(cB4, call('me'))).organizations.every((o) => o.id !== orgB));
  // disabled user
  ok(as(P, call('admin_set_user_status', { p_user: A2, p_status: 'disabled' })));
  denied(as(cA2, call('me')), 'disabled user');
  assert.equal(ok(as(cA2, `(select count(*) from ws.organizations)`)), 0);
  assert.equal(ok(as(AUTH, call('auth_signin_lookup', { p_email: 'a2@a.test' }))), null, 'a disabled user cannot sign in');
  ok(as(P, call('admin_set_user_status', { p_user: A2, p_status: 'active' })));
  denied(as(cA2, call('me')), 're-enabling does not revive an old session');
  // global sign-out
  const s1 = session(B2), s2 = session(B2);
  ok(as(s1, call('signout_all')));
  denied(as(s1, call('me'))); denied(as(s2, call('me'))); denied(as(cB2, call('me')));
  // admin revocation
  const s3 = session(B3);
  ok(as(P, call('admin_revoke_sessions', { p_user: B3 })));
  denied(as(s3, call('me'))); denied(as(cB3, call('me')));
  // sign-out of one session needs that session's secret
  const t = tok(); const o = ok(as(AUTH, call('auth_session_open', { p_user_id: B1, p_token_hash: sha(t), p_perimeter_hash: perim(), p_ttl_seconds: 600 })));
  const s4 = { role: 'authenticated', userId: B1, claims: { role: 'authenticated', sub: B1, sid: o.session_id, sv: o.session_version } };
  assert.equal(ok(as(AUTH, call('auth_session_revoke', { p_session_id: o.session_id, p_token_hash: sha(tok()) }))).revoked, false, 'a wrong secret revokes nothing');
  ok(as(s4, call('me')));
  assert.equal(ok(as(AUTH, call('auth_session_revoke', { p_session_id: o.session_id, p_token_hash: sha(t) }))).revoked, true);
  denied(as(s4, call('me')));
  assert.equal(ok(as(AUTH, call('auth_session_check', { p_session_id: o.session_id, p_token_hash: sha(t) }))), null);
  ok(as(cB1, call('me')), 'other sessions of the same user are untouched');
});

// fresh sessions for the users whose sessions the previous gate ended
const cB2b = session(B2), cB3b = session(B3), cA2b = session(A2);

at('an expired session is not signed in', () => {
  const s = session(A1);
  const r = psql(SUPER, `set session_replication_role = replica; update ws.sessions set issued_at = now() - interval '9 hours', expires_at = now() - interval '1 hour' where id = '${s.sid}';`);
  assert.ok(r.ok, r.err);
  denied(as(s, call('me')));
  assert.equal(ok(as(AUTH, `ws.auth_session_check('${s.sid}', 'x')`)), null);
});

at('VIEWER cannot write: invite, role change, revoke, archive are denied', () => {
  denied(as(cA2b, call('invite_member', { p_org: orgA, p_email: 'v@a.test', p_role: 'viewer', p_token_hash: sha(tok()) })));
  denied(as(cA2b, call('set_member_role', { p_org: orgA, p_user: A1, p_role: 'viewer' })));
  denied(as(cA2b, call('revoke_member', { p_org: orgA, p_user: A1 })));
  denied(as(cA2b, call('set_org_archived', { p_org: orgA, p_archived: true })));
  ok(as(cA2b, call('org_members', { p_org: orgA })), 'a viewer reads');
});

at('ANALYST cannot manage membership: invite / role / revoke / revoke invitation are denied', () => {
  for (const role of ['viewer', 'analyst', 'admin', 'owner']) denied(as(cB2b, call('invite_member', { p_org: orgB, p_email: 'n@b.test', p_role: role, p_token_hash: sha(tok()) })), 'invite ' + role);
  denied(as(cB2b, call('set_member_role', { p_org: orgB, p_user: B3, p_role: 'viewer' })));
  denied(as(cB2b, call('revoke_member', { p_org: orgB, p_user: B3 })));
  denied(as(cB2b, call('revoke_invitation', { p_org: orgB, p_user: B4 })));
  assert.equal(ok(as(cB2b, call('org_members', { p_org: orgB }))).length, 4, 'an analyst reads');
});

at('ADMIN cannot grant or remove OWNER (nor admin); manages analysts and viewers only', () => {
  denied(as(cB3b, call('invite_member', { p_org: orgB, p_email: 'o@b.test', p_role: 'owner', p_token_hash: sha(tok()) })), 'invite owner');
  denied(as(cB3b, call('invite_member', { p_org: orgB, p_email: 'o@b.test', p_role: 'admin', p_token_hash: sha(tok()) })), 'invite admin');
  denied(as(cB3b, call('set_member_role', { p_org: orgB, p_user: B2, p_role: 'owner' })), 'grant owner');
  denied(as(cB3b, call('set_member_role', { p_org: orgB, p_user: B2, p_role: 'admin' })), 'grant admin');
  denied(as(cB3b, call('set_member_role', { p_org: orgB, p_user: B1, p_role: 'viewer' })), 'demote owner');
  denied(as(cB3b, call('revoke_member', { p_org: orgB, p_user: B1 })), 'remove owner');
  denied(as(cB3b, call('set_org_archived', { p_org: orgB, p_archived: true })), 'archive');
  assert.equal(ok(as(cB3b, call('set_member_role', { p_org: orgB, p_user: B2, p_role: 'viewer' }))).changed, true);
  assert.equal(ok(as(cB3b, call('set_member_role', { p_org: orgB, p_user: B2, p_role: 'analyst' }))).changed, true);
  invite(cB3b, orgB, 'v2@b.test', 'viewer');
  ok(as(cB3b, call('revoke_invitation', { p_org: orgB, p_user: ownerVal(`(select id::text from ws.users where email = 'v2@b.test')`) })));
});

at('at least one active OWNER: the last owner cannot step down or leave; the commit-time constraint backs it even for direct writes', () => {
  failsWith(as(cB1, call('set_member_role', { p_org: orgB, p_user: B1, p_role: 'admin' })), 'last_owner');
  failsWith(as(cB1, call('revoke_member', { p_org: orgB, p_user: B1 })), 'last_owner');
  const r = owner(`update ws.organization_members set role = 'admin' where org_id = '${orgB}' and user_id = '${B1}';`);
  assert.ok(!r.ok && /last_owner/.test(r.err), r.err);
  failsWith(as(P, call('admin_set_user_status', { p_user: B1, p_status: 'disabled' })), 'sole_owner');
  // with a second owner the first may step down
  ok(as(cB1, call('set_member_role', { p_org: orgB, p_user: B3, p_role: 'owner' })));
  ok(as(cB1, call('set_member_role', { p_org: orgB, p_user: B1, p_role: 'admin' })));
  ok(as(cB3b, call('set_member_role', { p_org: orgB, p_user: B1, p_role: 'owner' })));
  ok(as(cB1, call('set_member_role', { p_org: orgB, p_user: B3, p_role: 'admin' })));
  failsWith(as(cA1, call('revoke_member', { p_org: ok(as(cA1, call('me'))).organizations.find((o) => o.kind === 'personal').id, p_user: A1 })), 'personal_org');
});

at('cross-organization references cannot be created, whatever code writes the row (composite keys)', () => {
  let r = owner(`insert into ws.organization_members (org_id, user_id, role, status, accepted_at, invited_by) values ('${orgB}', '${A2}', 'viewer', 'active', now(), '${A1}');`);
  assert.ok(!r.ok && r.code === '23503', 'inviter outside the org: ' + r.err);
  r = owner(`update ws.organization_members set updated_by = '${A1}' where org_id = '${orgB}' and user_id = '${B2}';`);
  assert.ok(!r.ok && r.code === '23503', 'updater outside the org: ' + r.err);
  r = owner(`update ws.organization_members set revoked_by = '${A1}', revoked_at = now(), status = 'revoked' where org_id = '${orgB}' and user_id = '${B4}';`);
  assert.ok(!r.ok && r.code === '23503', 'revoker outside the org: ' + r.err);
  r = owner(`update ws.organization_members set org_id = '${orgA}' where org_id = '${orgB}' and user_id = '${B2}';`);
  assert.ok(!r.ok, 'a membership never moves to another organization');
});

at('nothing is ever deleted or truncated — not even by the owner role', () => {
  for (const t of ['ws.users', 'ws.organizations', 'ws.organization_members', 'ws.sessions', 'private.user_credentials', 'private.identity_events']) {
    let r = owner(`delete from ${t};`); assert.ok(!r.ok && /never deleted/.test(r.err), t + ' delete ' + r.err);
    r = owner(`truncate ${t} cascade;`); assert.ok(!r.ok, t + ' truncate');
  }
  assert.ok(!owner(`update private.identity_events set action = 'x';`).ok, 'the event log is append-only');
});

at('no inference through errors: a hidden organization and a missing one give the identical error, authorization comes before validation', () => {
  const pairs = [
    [call('org_members', { p_org: orgB }), call('org_members', { p_org: NOWHERE })],
    [call('invite_member', { p_org: orgB, p_email: 'bad', p_role: 'bogus', p_token_hash: 'zz' }), call('invite_member', { p_org: NOWHERE, p_email: 'bad', p_role: 'bogus', p_token_hash: 'zz' })],
    [call('set_member_role', { p_org: orgB, p_user: B2, p_role: 'bogus' }), call('set_member_role', { p_org: NOWHERE, p_user: crypto.randomUUID(), p_role: 'bogus' })],
    [call('revoke_member', { p_org: orgB, p_user: B2 }), call('revoke_member', { p_org: NOWHERE, p_user: crypto.randomUUID() })],
    [call('revoke_invitation', { p_org: orgB, p_user: B2 }), call('revoke_invitation', { p_org: NOWHERE, p_user: crypto.randomUUID() })],
    [call('set_org_archived', { p_org: orgB, p_archived: true }), call('set_org_archived', { p_org: NOWHERE, p_archived: true })],
  ];
  const strip = (raw) => raw.replace(/^psql:[^:]*:\d+: /gm, '').replace(/LOCATION:.*$/gm, '').replace(/CONTEXT:[\s\S]*?(?=\n[A-Z]+:|$)/g, '').trim();
  for (const [hidden, missing] of pairs) {
    const a = denied(as(cA1, hidden)), b = denied(as(cA1, missing));
    assert.equal(a.message, 'denied'); assert.equal(strip(a.raw), strip(b.raw), hidden);
    assert.ok(!/detail|hint/i.test(strip(a.raw)), 'no detail / hint on a denial');
  }
});

at('no inference through counts: a hidden organization reads exactly like a missing one; invitations answer the same for known and unknown emails', () => {
  for (const q of ['ws.organizations where id = ', 'ws.organization_members where org_id = ']) {
    assert.equal(ok(as(cA1, `(select count(*) from ${q}'${orgB}')`)), ok(as(cA1, `(select count(*) from ${q}'${NOWHERE}')`)));
  }
  const known = ok(as(cA1, call('invite_member', { p_org: orgA, p_email: 'b2@b.test', p_role: 'viewer', p_token_hash: sha(tok()) })));
  const unknown = ok(as(cA1, call('invite_member', { p_org: orgA, p_email: 'nobody@n.test', p_role: 'viewer', p_token_hash: sha(tok()) })));
  assert.deepEqual(Object.keys(known).sort(), Object.keys(unknown).sort());
  assert.deepEqual({ ...known, email: '', expires_at: '' }, { ...unknown, email: '', expires_at: '' });
  const members = ok(as(cA1, call('org_members', { p_org: orgA })));
  const b2row = members.find((m) => m.email === 'b2@b.test');
  assert.equal(b2row.status, 'invited');
  assert.ok(!Object.keys(b2row).some((k) => /token/.test(k)), 'no token hash is ever read back');
  const cols = ok(as(cA1, `(select string_agg(column_name, ',') from information_schema.column_privileges where table_schema = 'ws' and table_name = 'organization_members' and grantee = 'authenticated')`));
  assert.ok(!/token/.test(cols), cols);
});

at('anon and service_role hold nothing; the sign-in plane and the member plane cannot call each other\'s functions', () => {
  for (const role of ['anon', 'service_role']) {
    denied(as({ role }, `(select count(*) from ws.organizations)`), role + ' table');
    denied(as({ role }, call('me')), role + ' me');
    denied(as({ role }, call('auth_signin_lookup', { p_email: 'b1@b.test' })), role + ' auth');
    denied(as({ role }, `(select count(*) from private.user_credentials)`), role + ' credentials');
  }
  denied(as(cA1, call('auth_signin_lookup', { p_email: 'b1@b.test' })), 'authenticated → sign-in plane');
  denied(as(cA1, call('auth_session_open', { p_user_id: B1, p_token_hash: sha(tok()), p_perimeter_hash: perim(), p_ttl_seconds: 60 })), 'authenticated → open a session for someone');
  denied(as(cA1, `(select count(*) from private.user_credentials)`), 'credentials');
  denied(as(cA1, `(select count(*) from private.identity_events)`), 'event log');
  denied(as(AUTH, `(select count(*) from ws.users)`), 'propx_auth reads no table');
  denied(as(AUTH, call('me')), 'propx_auth → member plane');
  denied(as(cA1, `private.bootstrap('x@x.test', 'x', 'x')`), 'bootstrap');
  denied(as(P, call('auth_activate', { p_token_hash: sha(tok()), p_password_hash: 'scrypt$x', p_display_name: 'x' })), 'activate from the member plane');
});

at('the catalogue holds exactly the allow-listed privileges (no platform default survives)', () => {
  const rows = ownerVal(`(select jsonb_agg(x order by x) from (
      select format('%s|%s.%s|%s', grantee, table_schema, table_name, privilege_type) x from information_schema.role_table_grants
       where table_schema in ('ws','private') and grantee <> 'ws_owner'
      union select format('%s|%s.%s(col)|%s', grantee, table_schema, table_name, privilege_type) from information_schema.column_privileges
       where table_schema in ('ws','private') and grantee <> 'ws_owner'
      union select format('%s|%s.%s|EXECUTE', r.rolname, n.nspname, p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a join pg_roles r on r.oid = a.grantee
       where n.nspname in ('ws','private') and r.rolname <> 'ws_owner'
      union select format('%s|%s|%s', coalesce(r.rolname, 'PUBLIC'), n.nspname, a.privilege_type) from pg_namespace n
        cross join lateral aclexplode(n.nspacl) a left join pg_roles r on r.oid = a.grantee
       where n.nspname in ('ws','private') and coalesce(r.rolname, 'PUBLIC') <> 'ws_owner') t)`);
  const tables = rows.filter((r) => !/\(col\)|EXECUTE|\|(ws|private)\|/.test(r));
  assert.deepEqual(tables.filter((r) => !/\|SELECT$/.test(r) || !/^authenticated\|ws\./.test(r)), [], 'table grants: ' + tables.join(' '));
  const fns = rows.filter((r) => /EXECUTE$/.test(r));
  assert.ok(fns.every((r) => /^(authenticated|propx_auth)\|/.test(r)), fns.filter((r) => !/^(authenticated|propx_auth)\|/.test(r)).join(' '));
  assert.ok(fns.filter((r) => /^propx_auth/.test(r)).every((r) => /\|ws\.auth_/.test(r)), 'propx_auth executes only ws.auth_*');
  assert.ok(fns.filter((r) => /^authenticated/.test(r)).every((r) => !/\|ws\.auth_/.test(r) && (/\|ws\./.test(r) || /private\.(current_user_id|my_org_ids)\|/.test(r))));
  const schemas = rows.filter((r) => /\|(ws|private)\|/.test(r));
  assert.deepEqual(schemas.sort(), ['authenticated|private|USAGE', 'authenticated|ws|USAGE', 'propx_auth|ws|USAGE']);
  const cols = rows.filter((r) => /\(col\)/.test(r));
  assert.ok(cols.every((r) => /^authenticated\|ws\.(users|organizations|organization_members)\(col\)\|SELECT$/.test(r)), cols.join(' '));
});

at('invitations: single-use, expire, never re-activate an existing user, never accepted by anyone else or by email alone', () => {
  const tA = invite(cA1, orgA, 'b1@b.test', 'analyst');   // an EXISTING active user
  const peek = ok(as(AUTH, call('auth_invite_peek', { p_token_hash: sha(tA) })));
  assert.equal(peek.needs_activation, false);
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tA), p_password_hash: 'scrypt$attacker', p_display_name: 'x' })), 'an inviter can never set an existing user\'s password');
  assert.equal(ownerVal(`(select password_hash from private.user_credentials where user_id = '${B1}')`), 'scrypt$test$B One');
  denied(as(cB2b, call('accept_invitation', { p_token_hash: sha(tA) })), 'someone else accepts');
  denied(as(cB1, call('accept_invitation', { p_token_hash: sha(tok()) })), 'without the link');
  ok(as(cB1, call('accept_invitation', { p_token_hash: sha(tA) })));
  denied(as(cB1, call('accept_invitation', { p_token_hash: sha(tA) })), 'single use');
  assert.equal(ok(as(cB1, call('me'))).organizations.find((o) => o.id === orgA).role, 'analyst');
  ok(as(cB1, call('revoke_member', { p_org: orgA, p_user: B1 })), 'a member may leave');
  // a new user's link: single use, expiry
  const tN = invite(cA1, orgA, 'new@a.test', 'viewer');
  activate(tN, 'New User');
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tN), p_password_hash: 'scrypt$x', p_display_name: 'x' })), 'reused link');
  assert.equal(ok(as(AUTH, call('auth_invite_peek', { p_token_hash: sha(tN) }))), null);
  const tE = invite(cA1, orgA, 'late@a.test', 'viewer');
  assert.ok(psql(SUPER, `update ws.organization_members set invite_expires_at = now() - interval '1 minute' where invite_token_hash = '${sha(tE)}';`).ok);
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tE), p_password_hash: 'scrypt$x', p_display_name: 'x' })), 'expired link');
  // a revoked invitation is dead
  const tR = invite(cA1, orgA, 'gone@a.test', 'viewer');
  ok(as(cA1, call('revoke_invitation', { p_org: orgA, p_user: ownerVal(`(select id::text from ws.users where email = 'gone@a.test')`) })));
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tR), p_password_hash: 'scrypt$x', p_display_name: 'x' })), 'revoked link');
});

at('archive is reversible and freezes membership changes; a personal workspace takes no invitation', () => {
  ok(as(cA1, call('set_org_archived', { p_org: orgA, p_archived: true })));
  failsWith(as(cA1, call('invite_member', { p_org: orgA, p_email: 'z@a.test', p_role: 'viewer', p_token_hash: sha(tok()) })), 'archived');
  ok(as(cA2b, call('org_members', { p_org: orgA })), 'members still read an archived workspace');
  ok(as(cA1, call('set_org_archived', { p_org: orgA, p_archived: false })));
  const personal = ok(as(cA1, call('me'))).organizations.find((o) => o.kind === 'personal').id;
  failsWith(as(cA1, call('invite_member', { p_org: personal, p_email: 'z@a.test', p_role: 'viewer', p_token_hash: sha(tok()) })), 'personal_org');
  denied(as(cA2b, call('org_members', { p_org: personal })), 'another user\'s personal workspace');
});

at('sign-in plane: lookup only for active users, 5 failures lock for 15 minutes (no hash handed out while locked)', () => {
  assert.equal(ok(as(AUTH, call('auth_signin_lookup', { p_email: 'nobody@n.test' }))), null, 'invited, never activated');
  assert.equal(ok(as(AUTH, call('auth_signin_lookup', { p_email: 'missing@m.test' }))), null);
  const l = ok(as(AUTH, call('auth_signin_lookup', { p_email: ' A1@A.TEST ' })));
  assert.equal(l.user_id, A1); assert.equal(l.locked, false); assert.match(l.password_hash, /^scrypt\$/);
  for (let i = 0; i < 4; i++) assert.equal(ok(as(AUTH, call('auth_signin_failed', { p_user_id: A1 }))).locked, false);
  assert.equal(ok(as(AUTH, call('auth_signin_failed', { p_user_id: A1 }))).locked, true);
  const locked = ok(as(AUTH, call('auth_signin_lookup', { p_email: 'a1@a.test' })));
  assert.equal(locked.locked, true); assert.equal(locked.password_hash, null);
  denied(as(AUTH, call('auth_session_open', { p_user_id: A1, p_token_hash: sha(tok()), p_perimeter_hash: perim(), p_ttl_seconds: 60 })), 'no session while locked');
  ok(as(cA1, call('me')), 'a live session is not ended by a lock');
  const s = psql(SUPER, `update private.user_credentials set locked_until = now() - interval '1 second' where user_id = '${A1}';`); assert.ok(s.ok);
  ok(as(AUTH, call('auth_session_open', { p_user_id: A1, p_token_hash: sha(tok()), p_perimeter_hash: perim(), p_ttl_seconds: 60 })));
  const ttl = ownerVal(`(select max(extract(epoch from expires_at - issued_at))::int from ws.sessions)`);
  assert.ok(ttl <= 8 * 3600, 'a session lives at most 8 hours: ' + ttl);
});

at('platform administration is the platform admin\'s only; every identity action is in the append-only event log', () => {
  denied(as(cA1, call('admin_users')));
  denied(as(cB1, call('admin_revoke_sessions', { p_user: A1 })));
  denied(as(cB1, call('admin_set_user_status', { p_user: A1, p_status: 'disabled' })));
  const users = ok(as(P, call('admin_users')));
  assert.ok(users.length >= 8 && users.every((u) => !('password_hash' in u)));
  failsWith(as(P, call('admin_set_user_status', { p_user: PADMIN, p_status: 'disabled' })), 'self');
  const actions = ownerVal(`(select jsonb_agg(distinct action) from private.identity_events)`).sort();
  for (const a of ['bootstrap', 'activate', 'signin', 'invite', 'create_team', 'set_role', 'revoke_member', 'revoke_invitation', 'accept', 'leave',
    'signout', 'signout_all', 'revoke_sessions', 'user_disabled', 'user_active', 'archive', 'restore', 'signin_locked']) assert.ok(actions.includes(a), a);
  assert.ok(!ownerVal(`(select bool_or(detail::text ~ 'scrypt|token') from private.identity_events)`), 'no credential or token in the log');
});

at('bootstrap runs once', () => {
  const r = owner(`select private.bootstrap('second@propx.test', 'x', 'y');`);
  assert.ok(!r.ok && /already bootstrapped/.test(r.err));
});

console.log(`private identity: ${n} passed`);
