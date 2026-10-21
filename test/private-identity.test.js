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
at('identity tables only: users, organizations, members, sessions (+ the credential half of users, the event log, the sign-in rate limit and reset links, unexposed)', () => {
  const tables = [...SQL.matchAll(/create table (\w+\.\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(tables, ['private.auth_rate', 'private.identity_events', 'private.password_resets', 'private.user_credentials', 'ws.organization_members', 'ws.organizations', 'ws.sessions', 'ws.users']);
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

at('the real-project tooling is fail-closed: probe always rolls back; activation verifies the target, needs the fingerprint, applies the repository file as the non-superuser owner, prints no host or secret', () => {
  const probe = fs.readFileSync(path.join(ROOT, 'supabase/private/test/real-project-probe.sql'), 'utf8');
  assert.match(probe, /^-- TEST HARNESS ONLY/);
  assert.ok(!/^\s*(commit|rollback|begin\s*;|end\s+transaction)/im.test(probe.replace(/--.*$/gm, '')), 'no transaction control in the probe');
  assert.equal((probe.replace(/--.*$/gm, '').match(/^do \$probe\$/gm) || []).length, 1, 'one statement');
  assert.match(probe, /raise exception 'PROBE_RESULT %', jsonb_build_object\('roles', roles, 'results', res\)::text;\nend\n\$probe\$;\s*$/, 'the probe ends by raising its result');
  assert.match(probe, /if exists \(select 1 from ws\.users\) then raise exception 'PROBE_REFUSED/);
  const act = fs.readFileSync(path.join(ROOT, 'scripts/identity-activate.js'), 'utf8');
  assert.match(act, /const EXPECT = Object\.freeze\(\{ name: 'propx-private', region: 'eu-central-1' \}\);/);
  assert.match(act, /if \(named\.length !== 1\) fail\('target NOT verified'/);
  assert.match(act, /if \(String\(env\.CONFIRM_REF \|\| ''\)\.trim\(\) !== fpOf\(ref\)\) fail\('apply refused'/);
  assert.match(act, /if \(db\.postgres_superuser !== false\) fail\('apply refused'/);
  assert.match(act, /const text = fs\.readFileSync\(path\.join\(ROOT, MIGRATION\), 'utf8'\);\n[^\n]*\n    try \{ await sql\(prefix \+ text, ref\); \}/, 'the repository migration, unchanged');
  assert.ok(!/console\.log\([^)]*(PROPX_WS_URL|PROPX_WS_APIKEY|PROPX_WS_JWT_SECRET|SUPABASE_ACCESS_TOKEN)\b/.test(act), 'no setting is printed');
  assert.ok(!/note\([^\n]*\$\{ref\}/.test(act), 'the full ref is never printed (public run logs): mask() + fingerprint only');
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/identity-activate.yml'), 'utf8');
  assert.match(wf, /workflow_dispatch:/); assert.ok(!/\n  (push|schedule|pull_request)/.test(wf), 'run by hand only');
  assert.ok(!/contents: write|git push|PROPX_IDENTITY|PROPX_ID_SECRET/.test(wf));
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
const userId = (email) => ownerVal(`(select id::text from ws.users where email = '${email}')`);

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

/** a NEW identity a member (not the platform admin) creates waits for the platform admin's approval */
const approve = (email) => ok(as(P, call('admin_approve_user', { p_user: userId(email) })), 'approve ' + email);
const inviteNew = (ctx, org, email, role) => { const t = invite(ctx, org, email, role); approve(email); return t; };
const A1 = activate(invite(P, PROPX_ORG, 'a1@a.test', 'viewer'), 'A One'); const cA1 = session(A1);
const orgA = ok(as(cA1, call('create_team', { p_name: 'Org A' }))).org_id;
const A2 = activate(inviteNew(cA1, orgA, 'a2@a.test', 'viewer'), 'A Two'); const cA2 = session(A2);
const B1 = activate(invite(P, PROPX_ORG, 'b1@b.test', 'viewer'), 'B One'); const cB1 = session(B1);
const orgB = ok(as(cB1, call('create_team', { p_name: 'Org B' }))).org_id;
const B2 = activate(inviteNew(cB1, orgB, 'b2@b.test', 'analyst'), 'B Two'); const cB2 = session(B2);
const B3 = activate(inviteNew(cB1, orgB, 'b3@b.test', 'admin'), 'B Three'); const cB3 = session(B3);
const B4 = activate(inviteNew(cB1, orgB, 'b4@b.test', 'viewer'), 'B Four'); const cB4 = session(B4);
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
      union select format('%s|%s.%s(seq)|%s', coalesce(r.rolname, 'PUBLIC'), n.nspname, c.relname, a.privilege_type) from pg_class c
        join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
        left join pg_roles r on r.oid = a.grantee where c.relkind = 'S' and n.nspname in ('ws','private') and coalesce(r.rolname, 'PUBLIC') <> 'ws_owner'
      union select format('%s|%s|%s', coalesce(r.rolname, 'PUBLIC'), n.nspname, a.privilege_type) from pg_namespace n
        cross join lateral aclexplode(n.nspacl) a left join pg_roles r on r.oid = a.grantee
       where n.nspname in ('ws','private') and coalesce(r.rolname, 'PUBLIC') <> 'ws_owner') t)`);
  assert.deepEqual(rows.filter((r) => /\(seq\)/.test(r)), [], 'no role holds anything on a sequence');
  const tables = rows.filter((r) => !/\(col\)|\(seq\)|EXECUTE|\|(ws|private)\|/.test(r));
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
  const tN = inviteNew(cA1, orgA, 'new@a.test', 'viewer');
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
  // the failure is booked by the email as typed, and the answer is the same for every address (the server calls it on EVERY failure)
  const answers = ['missing@m.test', 'nobody@n.test', 'a2@a.test'].map((e) => ok(as(AUTH, call('auth_signin_failed', { p_email: e }))));
  for (const a of answers) assert.deepEqual(a, { ok: true });
  for (let i = 0; i < 4; i++) { assert.deepEqual(ok(as(AUTH, call('auth_signin_failed', { p_email: ' A1@a.test ' }))), { ok: true }); assert.equal(ok(as(AUTH, call('auth_signin_lookup', { p_email: 'a1@a.test' }))).locked, false); }
  assert.deepEqual(ok(as(AUTH, call('auth_signin_failed', { p_email: 'a1@a.test' }))), { ok: true });
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
    'signout', 'signout_all', 'revoke_sessions', 'user_disabled', 'user_active', 'archive', 'restore', 'signin_locked', 'approve_user']) assert.ok(actions.includes(a), a);
  denied(as(cA1, call('admin_approve_user', { p_user: A2 })), 'approval is the platform admin\'s only');
  assert.ok(!ownerVal(`(select bool_or(detail::text ~ 'scrypt|token') from private.identity_events)`), 'no credential or token in the log');
});

/* ───────────── enterprise pilot (21.10.2026): rate limit · password change · display name · admin reset link ───────────── */
at('PILOT · the sign-in rate limit: counted per client key (an HMAC, never an address), refused past the limit with a retry time, restarted after the window; sign-in plane only', () => {
  const key = sha('client-1|signin');
  for (let i = 1; i <= 3; i++) assert.deepEqual(ok(as(AUTH, call('auth_rate_hit', { p_key_hash: key, p_limit: 3, p_window_seconds: 900 }))), { allowed: true, retry_after: 0 }, 'hit ' + i);
  const over = ok(as(AUTH, call('auth_rate_hit', { p_key_hash: key, p_limit: 3, p_window_seconds: 900 })));
  assert.equal(over.allowed, false); assert.ok(over.retry_after > 0 && over.retry_after <= 900, JSON.stringify(over));
  assert.equal(ok(as(AUTH, call('auth_rate_hit', { p_key_hash: sha('client-2|signin'), p_limit: 3, p_window_seconds: 900 }))).allowed, true, 'another client is not affected');
  assert.ok(psql(SUPER, `update private.auth_rate set window_start = now() - interval '16 minutes' where key_hash = '${key}';`).ok);
  assert.deepEqual(ok(as(AUTH, call('auth_rate_hit', { p_key_hash: key, p_limit: 3, p_window_seconds: 900 }))), { allowed: true, retry_after: 0 }, 'a new window restarts');
  failsWith(as(AUTH, call('auth_rate_hit', { p_key_hash: '203.0.113.7', p_limit: 3, p_window_seconds: 900 })), 'invalid_token', 'a raw address is refused: keys are hashes');
  for (const c of [cA1, P]) assert.ok(as(c, call('auth_rate_hit', { p_key_hash: key, p_limit: 3, p_window_seconds: 900 })).error, 'member plane cannot count');
  assert.ok(!ownerVal(`(select bool_or(key_hash !~ '^[0-9a-f]{64}$') from private.auth_rate)`), 'only hashes are stored');
  denied(as(cA1, `(select count(*) from private.auth_rate)`), 'unreadable');
});

at('PILOT · change my password: a live session only; the new hash replaces the old, the lock clears, EVERY session of that user ends, nobody else is touched', () => {
  const D1 = activate(invite(P, PROPX_ORG, 'd1@d.test', 'viewer'), 'D One');
  const d1a = session(D1), d1b = session(D1), other = session(A2);
  failsWith(as(d1a, call('change_password', { p_password_hash: 'plaintext' })), 'invalid_credential');
  denied(as(AUTH, call('change_password', { p_password_hash: 'scrypt$x' })), 'sign-in plane has no member functions');
  denied(as({ role: 'authenticated', claims: { role: 'authenticated', sub: D1 } }, call('change_password', { p_password_hash: 'scrypt$forged' })), 'no live session, no change');
  assert.ok(psql(SUPER, `update private.user_credentials set failed_count = 3 where user_id = '${D1}';`).ok);
  const r = ok(as(d1a, call('change_password', { p_password_hash: 'scrypt$test$D One v2' })));
  assert.equal(r.user_id, D1); assert.equal(r.sessions_revoked, 2);
  assert.equal(ownerVal(`(select password_hash from private.user_credentials where user_id = '${D1}')`), 'scrypt$test$D One v2');
  assert.equal(ownerVal(`(select failed_count from private.user_credentials where user_id = '${D1}')`), 0);
  denied(as(d1a, call('me')), 'the session that changed it ends too (the server opens a new one)');
  denied(as(d1b, call('me')), 'the other browser ends');
  ok(as(other, call('me')), 'another user is untouched');
  ok(as(session(D1), call('me')), 'a new session works');
  assert.equal(ownerVal(`(select count(*) from ws.sessions where user_id = '${D1}' and revoked_reason = 'password')`), 2);
});

at('PILOT · my display name: mine only, validated; the address never changes', () => {
  const c = session(A2);
  assert.deepEqual(ok(as(c, call('set_display_name', { p_display_name: '  A Two (Analyst)  ' }))), { display_name: 'A Two (Analyst)' });
  assert.equal(ok(as(c, call('me'))).user.display_name, 'A Two (Analyst)');
  failsWith(as(c, call('set_display_name', { p_display_name: '   ' })), 'invalid_name');
  failsWith(as(c, call('set_display_name', { p_display_name: 'x'.repeat(121) })), 'invalid_name');
  assert.ok(as(c, `ws.set_display_name(p_display_name := 'x', p_user := '${B1}')`).error, 'no target-user parameter exists');
  assert.equal(ok(as(cB1, call('me'))).user.display_name, 'B One', 'nobody else changes');
  assert.equal(ok(as(c, call('me'))).user.email, 'a2@a.test');
});

at('PILOT · password reset: the platform admin issues a one-time 72 h link for an ACTIVE user; the holder sets the password; every session ends; single use; superseded by a newer link', () => {
  const E1 = activate(invite(P, PROPX_ORG, 'e1@e.test', 'viewer'), 'E One'); const e1 = session(E1);
  denied(as(cA1, call('admin_reset_link', { p_user: E1, p_token_hash: sha(tok()) })), 'members never issue resets');
  denied(as(AUTH, call('admin_reset_link', { p_user: E1, p_token_hash: sha(tok()) })), 'sign-in plane never issues resets');
  failsWith(as(P, call('admin_reset_link', { p_user: crypto.randomUUID(), p_token_hash: sha(tok()) })), 'not_found');
  invite(P, PROPX_ORG, 'never@n.test', 'viewer');
  failsWith(as(P, call('admin_reset_link', { p_user: userId('never@n.test'), p_token_hash: sha(tok()) })), 'invalid_status', 'an invited identity uses its invitation');
  const t1 = tok(), t2 = tok();
  const issued = ok(as(P, call('admin_reset_link', { p_user: E1, p_token_hash: sha(t1) })));
  assert.equal(issued.email, 'e1@e.test');
  ok(as(P, call('admin_reset_link', { p_user: E1, p_token_hash: sha(t2) })), 'a newer link');
  assert.equal(ok(as(AUTH, call('auth_reset_peek', { p_token_hash: sha(t1) }))), null, 'the older link is superseded');
  denied(as(AUTH, call('auth_reset_complete', { p_token_hash: sha(t1), p_password_hash: 'scrypt$old-link' })), 'superseded link refused');
  const peek = ok(as(AUTH, call('auth_reset_peek', { p_token_hash: sha(t2) })));
  assert.equal(peek.email, 'e1@e.test'); assert.ok(peek.expires_at);
  denied(as(e1, call('me')) && as(AUTH, call('auth_reset_complete', { p_token_hash: sha(tok()), p_password_hash: 'scrypt$x' })), 'an unknown link opens nothing');
  failsWith(as(AUTH, call('auth_reset_complete', { p_token_hash: sha(t2), p_password_hash: 'plain' })), 'invalid_credential');
  assert.ok(psql(SUPER, `update private.user_credentials set locked_until = now() + interval '10 minutes' where user_id = '${E1}';`).ok);
  const done = ok(as(AUTH, call('auth_reset_complete', { p_token_hash: sha(t2), p_password_hash: 'scrypt$test$E One reset' })));
  assert.equal(done.user_id, E1); assert.ok(done.sessions_revoked >= 1);
  denied(as(e1, call('me')), 'every session of the user ended');
  assert.equal(ownerVal(`(select password_hash from private.user_credentials where user_id = '${E1}')`), 'scrypt$test$E One reset');
  assert.equal(ok(as(AUTH, call('auth_signin_lookup', { p_email: 'e1@e.test' }))).locked, false, 'the lock clears');
  denied(as(AUTH, call('auth_reset_complete', { p_token_hash: sha(t2), p_password_hash: 'scrypt$again' })), 'single use');
  assert.equal(ok(as(AUTH, call('auth_reset_peek', { p_token_hash: sha(t2) }))), null);
  const t3 = tok(); ok(as(P, call('admin_reset_link', { p_user: E1, p_token_hash: sha(t3) })));
  ok(as(P, call('admin_set_user_status', { p_user: E1, p_status: 'disabled' })));
  assert.equal(ok(as(AUTH, call('auth_reset_peek', { p_token_hash: sha(t3) }))), null, 'a disabled user\'s link opens nothing');
  denied(as(AUTH, call('auth_reset_complete', { p_token_hash: sha(t3), p_password_hash: 'scrypt$x' })), 'nor completes');
  ok(as(P, call('admin_set_user_status', { p_user: E1, p_status: 'active' })));
  assert.ok(psql(SUPER, `set session_replication_role = replica; update private.password_resets set created_at = now() - interval '72 hours', expires_at = now() - interval '1 second' where token_hash = '${sha(t3)}';`).ok, 'simulate an expired link (the guard refuses this for every role but a trigger-less superuser)');
  assert.equal(ok(as(AUTH, call('auth_reset_peek', { p_token_hash: sha(t3) }))), null, 'an expired link opens nothing');
  denied(as(cA1, `(select count(*) from private.password_resets)`), 'unreadable');
  assert.ok(!psql(OWNER, `delete from private.password_resets;`).ok, 'never deleted');
  assert.ok(!psql(OWNER, `update private.password_resets set used_at = null where used_at is not null;`).ok, 'a used link stays used');
  const actions = ownerVal(`(select jsonb_agg(distinct action) from private.identity_events)`);
  for (const a of ['reset_link', 'password_reset', 'password_change', 'set_display_name']) assert.ok(actions.includes(a), a);
  assert.ok(!ownerVal(`(select bool_or(detail::text ~ 'scrypt|token') from private.identity_events)`), 'no credential or token in the log');
});

/* ───────────── independent security review (19.10.2026): the confirmed findings, each a gate ───────────── */
const C1 = activate(invite(P, PROPX_ORG, 'c1@c.test', 'viewer'), 'C One'); const cC1 = session(C1);
const orgC = ok(as(cC1, call('create_team', { p_name: 'Org C' }))).org_id;
const C2 = activate(invite(P, PROPX_ORG, 'c2@c.test', 'viewer'), 'C Two'); const cC2 = session(C2);
ok(as(cC2, call('accept_invitation', { p_token_hash: sha(invite(cC1, orgC, 'c2@c.test', 'owner')) })), 'C2 joins C as a second owner');
const memberRow = (org, email) => ownerVal(`(select to_jsonb(m) - 'invite_token_hash' from ws.organization_members m join ws.users u on u.id = m.user_id where m.org_id = '${org}' and u.email = '${email}')`);

at('HIGH · a revoked inviter\'s links die with their membership: the sock-puppet owner never activates, the existing user never joins', () => {
  const tSock = inviteNew(cC2, orgC, 'sock@evil.test', 'owner');          // approved — the attack needs nothing else
  const tExist = invite(cC2, orgC, 'a1@a.test', 'analyst');               // an existing user, through the same inviter
  assert.equal(ok(as(cC1, call('org_members', { p_org: orgC }))).find((m) => m.email === 'sock@evil.test').invited_by_email, 'c2@c.test', 'the remaining owner sees who invited');
  ok(as(cC1, call('revoke_member', { p_org: orgC, p_user: C2 })));
  for (const t of [tSock, tExist]) assert.equal(ok(as(AUTH, call('auth_invite_peek', { p_token_hash: sha(t) }))), null, 'the link opens nothing');
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tSock), p_password_hash: 'scrypt$sock', p_display_name: 'Sock' })), 'sock activation');
  denied(as(cA1, call('accept_invitation', { p_token_hash: sha(tExist) })), 'existing user accepts a dead link');
  assert.equal(memberRow(orgC, 'sock@evil.test').status, 'revoked', 'the invitation itself was revoked');
  assert.equal(memberRow(orgC, 'sock@evil.test').revoked_by, C1, 'by the actor who revoked the inviter');
  assert.deepEqual(ok(as(cC1, call('me'))).organizations.find((o) => o.id === orgC).role, 'owner', 'C1 keeps the workspace');
  assert.ok(ownerVal(`(select count(*) from private.identity_events where action = 'expire_invitations' and subject_user_id = '${C2}')`) >= 1, 'the expiry is in the event log');
});

at('HIGH · even without the expiry (a lost standing however it happened), an invitation activates / is accepted only while its inviter stands', () => {
  ok(as(cC2, call('accept_invitation', { p_token_hash: sha(invite(cC1, orgC, 'c2@c.test', 'owner')) })), 'C2 back as owner');
  const tSock = invite(cC2, orgC, 'sock@evil.test', 'owner');             // re-invite the (approved, never activated) identity
  const tExist = invite(cC2, orgC, 'a1@a.test', 'analyst');
  const raw = (sql) => { const r = psql(SUPER, `set session_replication_role = replica; ${sql}`); assert.ok(r.ok, r.err); };
  raw(`update ws.organization_members set status = 'revoked', revoked_at = now() where org_id = '${orgC}' and user_id = '${C2}';`);   // no expiry path ran
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tSock), p_password_hash: 'scrypt$sock', p_display_name: 'Sock' })), 'inviter revoked');
  denied(as(cA1, call('accept_invitation', { p_token_hash: sha(tExist) })), 'inviter revoked (accept)');
  raw(`update ws.organization_members set status = 'active', revoked_at = null where org_id = '${orgC}' and user_id = '${C2}';`);
  raw(`update ws.organization_members set role = 'admin' where org_id = '${orgC}' and user_id = '${C2}';`);                  // an admin may not have sent an owner link
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tSock), p_password_hash: 'scrypt$sock', p_display_name: 'Sock' })), 'inviter demoted below the role');
  assert.equal(ok(as(AUTH, call('auth_invite_peek', { p_token_hash: sha(tExist) }))).role, 'analyst', 'an admin\'s analyst link still stands');
  raw(`update ws.organization_members set role = 'owner' where org_id = '${orgC}' and user_id = '${C2}';`);
  raw(`update ws.users set status = 'disabled' where id = '${C2}';`);
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tSock), p_password_hash: 'scrypt$sock', p_display_name: 'Sock' })), 'inviter disabled');
  raw(`update ws.users set status = 'active' where id = '${C2}';`);
  ok(as(cC1, call('revoke_invitation', { p_org: orgC, p_user: userId('sock@evil.test') })));
  ok(as(cC1, call('revoke_invitation', { p_org: orgC, p_user: A1 })));
});

at('HIGH · demoting or disabling the inviter revokes their links above the new standing; re-enabling does not revive them', () => {
  const cC2b = session(C2);
  const tAdm = inviteNew(cC2b, orgC, 'adm@c.test', 'admin');
  const tAn = inviteNew(cC2b, orgC, 'an@c.test', 'analyst');
  ok(as(cC1, call('set_member_role', { p_org: orgC, p_user: C2, p_role: 'admin' })));
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tAdm), p_password_hash: 'scrypt$x', p_display_name: 'x' })), 'owner → admin: the admin link died');
  assert.equal(memberRow(orgC, 'adm@c.test').status, 'revoked');
  assert.equal(ok(as(AUTH, call('auth_invite_peek', { p_token_hash: sha(tAn) }))).role, 'analyst', 'the analyst link an admin may send stands');
  ok(as(P, call('admin_set_user_status', { p_user: C2, p_status: 'disabled' })));
  assert.equal(memberRow(orgC, 'an@c.test').status, 'revoked', 'disabled: every link they sent is revoked');
  assert.equal(memberRow(orgC, 'an@c.test').revoked_by, null, 'by the platform admin, who is not a member of C (never attributed to someone outside)');
  ok(as(P, call('admin_set_user_status', { p_user: C2, p_status: 'active' })));
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tAn), p_password_hash: 'scrypt$x', p_display_name: 'x' })), 're-enabled: still dead');
});

at('MEDIUM · no member can claim an address for someone else: a new identity waits for the platform admin, and only the creating workspace\'s link activates it', () => {
  // §1: a VIEWER creates a team and invites the CEO's address
  const cA2c = session(A2);
  const orgX = ok(as(cA2c, call('create_team', { p_name: 'Squat' }))).org_id;
  const tSq = invite(cA2c, orgX, 'ceo@corp.test', 'viewer');
  const peek = ok(as(AUTH, call('auth_invite_peek', { p_token_hash: sha(tSq) })));
  assert.deepEqual([peek.needs_activation, peek.pending_approval], [true, true]);
  failsWith(as(AUTH, call('auth_activate', { p_token_hash: sha(tSq), p_password_hash: 'scrypt$attacker', p_display_name: 'CEO' })), 'pending_approval');
  assert.equal(ownerVal(`(select status from ws.users where email = 'ceo@corp.test')`), 'invited');
  const row = ok(as(P, call('admin_users'))).find((u) => u.email === 'ceo@corp.test');
  assert.deepEqual([row.approved, row.origin_org_name, row.origin_invited_by_email], [false, 'Squat', 'a2@a.test'], 'the platform admin sees what to decide on');
  // §2: org B invites a new hire as OWNER; the attacker invites the same address and would activate first
  const tB = invite(cB1, orgB, 'newhire@b.test', 'owner');
  const tAtt = invite(cA2c, orgX, 'newhire@b.test', 'viewer');
  approve('newhire@b.test');
  assert.equal(ok(as(AUTH, call('auth_invite_peek', { p_token_hash: sha(tAtt) }))).needs_activation, false, 'the attacker\'s link did not create the identity');
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tAtt), p_password_hash: 'scrypt$attacker', p_display_name: 'x' })), 'the attacker\'s link never sets the password');
  const NH = activate(tB, 'New Hire');
  assert.equal(ownerVal(`(select password_hash from private.user_credentials where user_id = '${NH}')`), 'scrypt$test$New Hire');
  // an unapproved identity also cannot be activated through ANOTHER workspace's link once approved
  const tOther = invite(cB1, orgB, 'ceo@corp.test', 'viewer');
  approve('ceo@corp.test');
  denied(as(AUTH, call('auth_activate', { p_token_hash: sha(tOther), p_password_hash: 'scrypt$b', p_display_name: 'x' })), 'not the creating workspace');
  // look-alike addresses are refused, not made into a second identity
  for (const e of ['ceo​@corp.test', 'сeo@corp.test', 'ceo@corp.tеst']) failsWith(as(cB1, call('invite_member', { p_org: orgB, p_email: e, p_role: 'viewer', p_token_hash: sha(tok()) })), 'invalid_email', JSON.stringify(e));
  // the platform admin's own invitations are approved at once
  const tP = invite(P, PROPX_ORG, 'direct@propx.test', 'viewer');
  assert.equal(ok(as(AUTH, call('auth_invite_peek', { p_token_hash: sha(tP) }))).pending_approval, false);
});

at('MEDIUM · the member list never reveals the account behind an invited address (name, state, or whether it exists)', () => {
  invite(cA1, orgA, 'b2@b.test', 'viewer');                 // exists, active, has a name
  invite(cA1, orgA, 'never@seen.test', 'viewer');           // does not exist
  const rows = ok(as(cA1, call('org_members', { p_org: orgA })));
  const known = rows.find((m) => m.email === 'b2@b.test'), unknown = rows.find((m) => m.email === 'never@seen.test');
  const shape = (m) => ({ ...m, user_id: '', email: '', invited_at: '', invite_expires_at: '' });
  assert.deepEqual(shape(known), shape(unknown), 'an invited row reads the same for a known and an unknown address');
  assert.equal(known.display_name, null); assert.equal(known.user_status, null);
  const active = rows.find((m) => m.email === 'a1@a.test');
  assert.equal(active.display_name, 'A One', 'a member who joined is shown by name');
});

at('LOW · an owner who is a disabled user does not count: the last usable owner cannot step down (functions and the commit-time check)', () => {
  // orgC: owners C1 and C2; disable C2
  ok(as(cC1, call('set_member_role', { p_org: orgC, p_user: C2, p_role: 'owner' })));
  ok(as(P, call('admin_set_user_status', { p_user: C2, p_status: 'disabled' })));
  failsWith(as(cC1, call('set_member_role', { p_org: orgC, p_user: C1, p_role: 'admin' })), 'last_owner');
  failsWith(as(cC1, call('revoke_member', { p_org: orgC, p_user: C1 })), 'last_owner');
  const r = owner(`update ws.organization_members set role = 'admin' where org_id = '${orgC}' and user_id = '${C1}';`);
  assert.ok(!r.ok && /last_owner/.test(r.err), 'commit-time check: ' + r.err);
  ok(as(P, call('admin_set_user_status', { p_user: C2, p_status: 'active' })));
  ok(as(cC1, call('set_member_role', { p_org: orgC, p_user: C1, p_role: 'admin' })), 'with a usable second owner, stepping down is allowed again');
  ok(as(session(C2), call('set_member_role', { p_org: orgC, p_user: C1, p_role: 'owner' })));
});

at('INFO · objects created later start closed: a new function, table and sequence in ws grant nothing to any API role', () => {
  const r = owner(`begin;
    create function ws.zz_probe() returns int language sql as 'select 1';
    create table ws.zz_probe_t (id bigint generated always as identity primary key);
    select '@@' || jsonb_build_object(
      'fn', (select bool_or(has_function_privilege(r, 'ws.zz_probe()', 'execute')) from unnest(array['anon','authenticated','service_role','propx_auth']) r),
      'tbl', (select bool_or(has_table_privilege(r, 'ws.zz_probe_t', 'select,insert,update,delete')) from unnest(array['anon','authenticated','service_role','propx_auth']) r),
      'seq', (select bool_or(has_sequence_privilege(r, 'ws.zz_probe_t_id_seq', 'usage,select,update')) from unnest(array['anon','authenticated','service_role','propx_auth']) r))::text;
    rollback;`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(JSON.parse(r.out.split('\n').find((l) => l.startsWith('@@')).slice(2)), { fn: false, tbl: false, seq: false });
});

at('the real-project activation sequence (against a local stand-in of the Management API): preflight · refusals · apply · audit · probe — and the probe leaves nothing', () => {
  const ADB = 'propx_ws_act_' + process.pid, root = urlFor(new URL(PG).username, new URL(PG).pathname.slice(1) || 'postgres');
  assert.ok(psql(root, `create database ${ADB};`).ok);
  const aSuper = urlFor(new URL(PG).username, ADB);
  try {
    assert.ok(psql(aSuper, fs.readFileSync(SHIM, 'utf8'), { pw: `'${PW}'`, DBNAME: ADB }).ok);
    assert.ok(psql(aSuper, 'create schema storage; create table storage.buckets (id text); create table storage.objects (id text); create schema auth; create table auth.users (id uuid);').ok);
    const port = 20000 + (process.pid % 20000);
    const mock = require('node:child_process').spawn(process.execPath, [path.join(ROOT, 'supabase/private/test/management-api-mock.js')], { env: { PATH: process.env.PATH, MOCK_DB_URL: aSuper, MOCK_PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      const t0 = Date.now(); while (Date.now() - t0 < 10000) { const r = spawnSync('bash', ['-c', `exec 3<>/dev/tcp/127.0.0.1/${port}`]); if (r.status === 0) break; spawnSync('sleep', ['0.2']); }
      const run = (vars) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/identity-activate.js')], { encoding: 'utf8', timeout: 240000,
        env: { PATH: process.env.PATH, SUPABASE_API_BASE: `http://127.0.0.1:${port}/v1`, PROPX_ACTIVATE_DB_ROLE: 'ws_owner', ...vars } });
        return { code: r.status, out: (r.stdout || '').split('\n').filter((l) => /^::(notice|error)/.test(l)).join('\n').replace(/%0A/g, '\n') }; };
      const TOKEN = { SUPABASE_ACCESS_TOKEN: 'sbp_localmocktoken' };
      const FP = crypto.createHash('sha256').update('propx-ref|abcdefghijklmnopqrst').digest('hex').slice(0, 12);
      let r = run({ MODE: 'preflight' });
      assert.equal(r.code, 1); assert.match(r.out, /target NOT verified::.*SUPABASE_ACCESS_TOKEN is not set/);
      r = run({ ...TOKEN, MODE: 'preflight' });
      assert.equal(r.code, 0, r.out); assert.match(r.out, /ref abcd…st · fingerprint [0-9a-f]{12} · name propx-private · region eu-central-1/); assert.ok(!/abcdefghijklmnopqrst/.test(r.out), 'the full ref is not printed');
      r = run({ ...TOKEN, MODE: 'apply', CONFIRM_REF: 'wrong' });
      assert.equal(r.code, 1); assert.match(r.out, /apply refused::confirm_ref must equal/);
      assert.equal(ownerVal(`(select count(*) from pg_namespace where nspname = 'ws')`), 1, 'the gate database itself (sanity)');
      r = run({ ...TOKEN, MODE: 'apply', CONFIRM_REF: FP });
      assert.equal(r.code, 0, r.out); assert.match(r.out, /migration APPLIED::version 20261019120000 · sha256 [0-9a-f]{64} · run as ws_owner \(switched from /);
      assert.match(r.out, /Data API exposed schemas: public,graphql_public → ws/); assert.match(r.out, /Auth sign-up disabled: false → true/);
      assert.match(r.out, /privileges outside the allow-list: none/); assert.match(r.out, /"owner_is_superuser":false/);
      r = run({ ...TOKEN, MODE: 'apply', CONFIRM_REF: FP });
      assert.equal(r.code, 1); assert.match(r.out, /apply refused::PROPX objects already exist/);
      r = run({ ...TOKEN, MODE: 'probe' });
      assert.equal(r.code, 0, r.out); assert.match(r.out, /isolation probe \(real project, rolled back\)::18\/18 pass · 0 not tested/); assert.match(r.out, /nothing left behind::clean/);
      const left = psql(aSuper, `select (select count(*) from ws.users) + (select count(*) from ws.organizations) + (select count(*) from private.identity_events);`);
      assert.equal(left.out.trim(), '0', 'nothing was kept by the probe');
    } finally { mock.kill(); }
  } finally { psql(root, `drop database if exists ${ADB} with (force);`); }
});

at('bootstrap runs once', () => {
  const r = owner(`select private.bootstrap('second@propx.test', 'x', 'y');`);
  assert.ok(!r.ok && /already bootstrapped/.test(r.err));
});

console.log(`private identity: ${n} passed`);
