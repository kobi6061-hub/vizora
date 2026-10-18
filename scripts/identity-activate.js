#!/usr/bin/env node
// PROPX · STEP 2A.1 — activate the identity foundation on the REAL private Supabase project (run by hand through
// .github/workflows/identity-activate.yml; the sandbox cannot reach Supabase). Modes:
//
//   preflight  read-only: which settings exist (names only), the target project verified through the Management API
//              (exactly one project named `propx-private`, region eu-central-1, healthy, NOT the public SUPABASE_URL
//              project, the same ref as PROPX_WS_URL when that is set), the executing role, and that the database is
//              empty of PROPX objects and business data.
//   apply      preflight + the confirmation input must equal the target's fingerprint printed by the preflight; applies
//              the repository migration unchanged (sha-256 recorded) AS the project's non-superuser `postgres` role, records
//              it in supabase_migrations.schema_migrations, exposes schema `ws` only through the Data API and turns public
//              sign-up off. Refused if any PROPX object already exists.
//   audit      read-only: the catalogue (tables · functions · RLS · every privilege against the allow-list · owners ·
//              default privileges), business-data emptiness and the Supabase security advisors.
//   probe      the two-organization isolation scenario on the real database, inside ONE statement that always ends in
//              an exception — PostgreSQL rolls all of it back; a separate read then proves nothing was left behind.
//
// Reads only server-side secrets and prints none of them. The repository is PUBLIC, so its run logs are too: the project
// ref is printed masked (first 4 + last 2 characters) with a fingerprint (sha-256 of the ref), never the API host; names of
// other projects are not printed. Results are workflow annotations (≤ 10 per type per step) and the job summary.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const MIGRATION = 'supabase/private/migrations/20261019120000_identity_foundation.sql';
const VERSION = '20261019120000';
const EXPECT = Object.freeze({ name: 'propx-private', region: 'eu-central-1' });
const API = String(process.env.SUPABASE_API_BASE || 'https://api.supabase.com/v1');   /* override: local tests against a mock only */
const ROLE = String(process.env.PROPX_ACTIVATE_DB_ROLE || 'postgres');                   /* the project's owner role (local tests: ws_owner) */
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ROLE)) { console.error('bad PROPX_ACTIVATE_DB_ROLE'); process.exit(1); }
const env = process.env;
const TOKEN = String(env.SUPABASE_ACCESS_TOKEN || '').trim();
const mode = String(env.MODE || process.argv[2] || 'preflight').trim();
const PROBE = 'supabase/private/test/real-project-probe.sql';
const mask = (ref) => (ref ? `${ref.slice(0, 4)}…${ref.slice(-2)}` : '?');
const fpOf = (ref) => crypto.createHash('sha256').update('propx-ref|' + ref).digest('hex').slice(0, 12);

const secretsOf = () => [TOKEN, env.PROPX_WS_APIKEY, env.PROPX_WS_JWT_SECRET].map((v) => String(v || '').trim()).filter((v) => v.length >= 8);
const scrub = (s) => { let t = String(s == null ? '' : s); for (const v of secretsOf()) t = t.split(v).join('<redacted>'); return t.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>').replace(/sbp_[A-Za-z0-9]+/g, '<token>'); };
const esc = (s) => scrub(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
const lines = [];
const note = (title, msg, level = 'notice') => { lines.push(`### ${title}\n\n${scrub(msg)}\n`); console.log(`::${level} title=${esc(title)}::${esc(msg)}`); };
const summary = () => { if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## identity-activate · ${mode}\n\n${lines.join('\n')}\n`); };
const fail = (title, msg) => { note(title, msg, 'error'); summary(); process.exit(1); };
const refOfUrl = (u) => ((/^https?:\/\/([a-z0-9]{20})\.supabase\.(?:co|in)\b/i.exec(String(u || '').trim()) || [])[1] || '').toLowerCase();

async function api(p, { method = 'GET', body } = {}) {
  const r = await fetch(API + p, { method, headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}
/** one SQL text through the Management API (it runs as the project's database role); returns rows or throws */
async function sql(query, ref) {
  const r = await api(`/projects/${ref}/database/query`, { method: 'POST', body: { query } });
  if (r.status >= 300) { const e = new Error(`SQL HTTP ${r.status}: ${scrub((r.json && (r.json.message || r.json.error)) || r.text).slice(0, 30000)}`); e.status = r.status; e.body = r.json || r.text; throw e; }
  return r.json;
}
const one = async (query, ref) => {
  const rows = await sql(query, ref); const row = Array.isArray(rows) ? rows[0] : rows; const v = row && Object.values(row)[0];
  return typeof v === 'string' && /^[{[]/.test(v) ? JSON.parse(v) : v;   /* a jsonb column may come back as text */
};

/* ── the read-only facts every mode starts from ── */
async function preflight() {
  const present = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_URL', 'PROPX_WS_URL', 'PROPX_WS_APIKEY', 'PROPX_WS_JWT_SECRET'].map((k) => `${k}: ${String(env[k] || '').trim() ? 'set' : 'MISSING'}`).join(' · ');
  if (!TOKEN) fail('target NOT verified', `${present} — SUPABASE_ACCESS_TOKEN is not set: the project name and region cannot be verified, so nothing is read or written`);
  const r = await api('/projects');
  if (r.status !== 200 || !Array.isArray(r.json)) fail('target NOT verified', `${present} — Management API /projects answered HTTP ${r.status}`);
  const named = r.json.filter((p) => p.name === EXPECT.name);
  if (named.length !== 1) fail('target NOT verified', `${present} — ${r.json.length} project(s) visible; expected exactly one named "${EXPECT.name}", found ${named.length} — STOP`);
  const P = named[0], ref = String(P.ref || P.id || '').toLowerCase();
  const pub = refOfUrl(env.SUPABASE_URL), ws = refOfUrl(env.PROPX_WS_URL);
  const others = r.json.filter((p) => String(p.ref || p.id || '').toLowerCase() !== ref);
  const wsSay = ws ? (ws === ref ? 'PROPX_WS_URL names this project' : 'PROPX_WS_URL names ANOTHER project') : 'PROPX_WS_URL not set';
  const pubSay = pub ? (pub === ref ? 'SUPABASE_URL (public) IS this project' : 'SUPABASE_URL (public) is another project') : 'SUPABASE_URL not set — the public project is excluded by name (it is not named "propx-private")';
  note('target project', `${present}\nref ${mask(ref)} · fingerprint ${fpOf(ref)} · name ${P.name} · region ${P.region} · status ${P.status} · Postgres ${(P.database && P.database.version) || '?'} · created ${P.created_at || '?'}\n${others.length} other project(s) on the account, none named "${EXPECT.name}" · ${pubSay} · ${wsSay}`);
  if (P.region !== EXPECT.region) fail('target NOT verified', `region is ${P.region}, expected ${EXPECT.region} — STOP`);
  if (!/ACTIVE_HEALTHY/.test(String(P.status))) fail('target NOT verified', `status is ${P.status}, expected ACTIVE_HEALTHY — STOP`);
  if (pub && pub === ref) fail('target NOT verified', 'the named project IS the public SUPABASE_URL project — STOP');
  if (ws && ws !== ref) fail('target NOT verified', 'PROPX_WS_URL names a different project than "propx-private" — STOP');
  const db = await one(`select jsonb_build_object(
      'current_user', current_user, 'session_user', session_user,
      'superuser', (select rolsuper from pg_roles where rolname = current_user),
      'postgres_superuser', (select rolsuper from pg_roles where rolname = '${ROLE}'),
      'server_version', current_setting('server_version'),
      'ws_schema', to_regnamespace('ws') is not null, 'private_schema', to_regnamespace('private') is not null,
      'propx_auth_role', exists (select 1 from pg_roles where rolname = 'propx_auth'),
      /* a pre-existing propx_auth must hold NOTHING here (no login / superuser / createrole, no privilege on any object of this
         database) — roles are cluster-wide, so a throwaway test cluster can carry one from another database */
      'propx_auth_holds', (select jsonb_build_object('flags', exists (select 1 from pg_roles where rolname = 'propx_auth' and (rolcanlogin or rolsuper or rolcreaterole or rolcreatedb or rolbypassrls)),
          'objects', (select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee where r.rolname = 'propx_auth')
                   + (select count(*) from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee where r.rolname = 'propx_auth')
                   + (select count(*) from pg_namespace n cross join lateral aclexplode(n.nspacl) a join pg_roles r on r.oid = a.grantee where r.rolname = 'propx_auth'))),
      'user_tables', (select coalesce(jsonb_object_agg(n, c), '{}'::jsonb) from (select n.nspname n, count(*) c from pg_class k join pg_namespace n on n.oid = k.relnamespace
          where k.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','auth','storage','realtime','supabase_functions','extensions','graphql','graphql_public','pgsodium','pgsodium_masks','vault','net','cron','supabase_migrations','pgbouncer','_realtime','_analytics','pg_toast')
          and n.nspname not like 'pg_temp%' group by 1) t),
      'storage_buckets', (select count(*) from storage.buckets), 'storage_objects', (select count(*) from storage.objects),
      'auth_users', (select count(*) from auth.users),
      'migrations_table', to_regclass('supabase_migrations.schema_migrations') is not null) as facts`, ref);
  /* a missing table cannot be named in the same statement (resolved at parse time), so the history is read only when it exists */
  db.migrations_recorded = db.migrations_table ? await one(`select coalesce(jsonb_agg(version order by version), '[]'::jsonb) from supabase_migrations.schema_migrations`, ref) : null;
  note('database (read)', JSON.stringify(db));
  return { ref, P, db };
}

/* ── the catalogue, emptiness and advisors (read-only) ── */
async function audit(ref) {
  const cat = await one(`select jsonb_build_object(
      'tables', (select jsonb_agg(format('%s.%s', n.nspname, c.relname) order by 1) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('ws','private') and c.relkind in ('r','p')),
      'rls_off', (select coalesce(jsonb_agg(format('%s.%s', n.nspname, c.relname)), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('ws','private') and c.relkind in ('r','p') and not c.relrowsecurity),
      'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('ws','private')),
      'ws_functions', (select jsonb_agg(p.proname order by 1) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ws'),
      'definer_without_empty_search_path', (select coalesce(jsonb_agg(format('%s.%s', n.nspname, p.proname)), '[]'::jsonb) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('ws','private') and p.prosecdef and not coalesce(p.proconfig, '{}') @> array['search_path=""']),
      'owners', (select jsonb_agg(distinct r.rolname) from (select relowner o from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('ws','private')
          union select proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('ws','private')) x join pg_roles r on r.oid = x.o),
      'owner_is_superuser', (select bool_or(r.rolsuper) from (select relowner o from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('ws','private')
          union select proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('ws','private')) x join pg_roles r on r.oid = x.o),
      'privileges', (select jsonb_agg(x order by x) from (
          select format('%s|%s.%s|%s', grantee, table_schema, table_name, privilege_type) x from information_schema.role_table_grants
           where table_schema in ('ws','private') and grantee not in ('${ROLE}','postgres','supabase_admin')
          union select format('%s|%s.%s(col)|%s', grantee, table_schema, table_name, privilege_type) from information_schema.column_privileges
           where table_schema in ('ws','private') and grantee not in ('${ROLE}','postgres','supabase_admin')
          union select format('%s|%s.%s|EXECUTE', coalesce(r.rolname, 'PUBLIC'), n.nspname, p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles r on r.oid = a.grantee
           where n.nspname in ('ws','private') and coalesce(r.rolname, 'PUBLIC') not in ('${ROLE}','postgres','supabase_admin')
          union select format('%s|%s.%s(seq)|%s', coalesce(r.rolname, 'PUBLIC'), n.nspname, c.relname, a.privilege_type) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a left join pg_roles r on r.oid = a.grantee
           where c.relkind = 'S' and n.nspname in ('ws','private') and coalesce(r.rolname, 'PUBLIC') not in ('${ROLE}','postgres','supabase_admin')
          union select format('%s|%s|%s', coalesce(r.rolname, 'PUBLIC'), n.nspname, a.privilege_type) from pg_namespace n
            cross join lateral aclexplode(n.nspacl) a left join pg_roles r on r.oid = a.grantee
           where n.nspname in ('ws','private') and coalesce(r.rolname, 'PUBLIC') not in ('${ROLE}','postgres','supabase_admin')) t),
      'default_acl_postgres', (select coalesce(jsonb_agg(format('%s|%s|%s', coalesce(n.nspname, '*'), d.defaclobjtype, d.defaclacl::text)), '[]'::jsonb)
          from pg_default_acl d join pg_roles r on r.oid = d.defaclrole left join pg_namespace n on n.oid = d.defaclnamespace where r.rolname = '${ROLE}'),
      'rows', jsonb_build_object('users', (select count(*) from ws.users), 'organizations', (select count(*) from ws.organizations),
          'members', (select count(*) from ws.organization_members), 'sessions', (select count(*) from ws.sessions),
          'credentials', (select count(*) from private.user_credentials), 'events', (select count(*) from private.identity_events)),
      'business', jsonb_build_object('storage_buckets', (select count(*) from storage.buckets), 'storage_objects', (select count(*) from storage.objects),
          'public_tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')),
          'tables_outside_ws_private', (select coalesce(jsonb_agg(format('%s.%s', n.nspname, c.relname)), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relkind in ('r','p') and n.nspname not in ('ws','private','pg_catalog','information_schema','auth','storage','realtime','supabase_functions','extensions','graphql',
              'graphql_public','pgsodium','pgsodium_masks','vault','net','cron','supabase_migrations','pgbouncer','_realtime','_analytics','pg_toast')),
          'evidence_like', (select coalesce(jsonb_agg(format('%s.%s', n.nspname, c.relname)), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relkind in ('r','p','v','m') and c.relname ~* '(evidence|document|watch|deal|thesis|altaris|upload|file)' and n.nspname not in ('pg_catalog','information_schema','storage')))) as catalogue`, ref);
  return cat;
}

/* the allow-list (the same one test/private-identity.test.js enforces on a throwaway PostgreSQL) */
function checkPrivileges(rows) {
  const bad = [];
  for (const r of rows || []) {
    const [who, obj, priv] = r.split('|');
    if (/\(seq\)/.test(obj)) { bad.push(r); continue; }
    if (priv === 'EXECUTE') { if (who === 'propx_auth' && /^ws\.auth_/.test(obj)) continue; if (who === 'authenticated' && ((/^ws\./.test(obj) && !/^ws\.auth_/.test(obj)) || /^private\.(current_user_id|my_org_ids)$/.test(obj))) continue; bad.push(r); continue; }
    if (/^(ws|private)$/.test(obj)) { if (['authenticated|ws|USAGE', 'authenticated|private|USAGE', 'propx_auth|ws|USAGE'].includes(r)) continue; bad.push(r); continue; }
    if (/\(col\)$/.test(obj)) { if (who === 'authenticated' && priv === 'SELECT' && /^ws\.(users|organizations|organization_members)\(col\)$/.test(obj)) continue; bad.push(r); continue; }
    if (who === 'authenticated' && priv === 'SELECT' && /^ws\./.test(obj)) continue;   /* column-level SELECT shows as a table grant in some catalogues */
    bad.push(r);
  }
  return bad;
}

async function advisors(ref) {
  const out = {};
  for (const kind of ['security', 'performance']) {
    const r = await api(`/projects/${ref}/advisors/${kind}`);
    const lints = r.json && (r.json.lints || r.json.result || r.json);
    out[kind] = r.status === 200 && Array.isArray(lints) ? lints.map((l) => ({ name: l.name, level: l.level, title: l.title, detail: String(l.detail || '').slice(0, 300), metadata: l.metadata || null })) : { http: r.status, body: scrub(r.text).slice(0, 300) };
  }
  return out;
}

(async () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, MIGRATION))).digest('hex');
  note('migration (repository)', `${MIGRATION} · version ${VERSION} · sha256 ${sha}`);
  const { ref, db } = await preflight();
  if (mode === 'preflight') { note('preflight', 'target verified; nothing was written'); summary(); return; }
  if (mode === 'apply') {
    if (String(env.CONFIRM_REF || '').trim() !== fpOf(ref)) fail('apply refused', `confirm_ref must equal the target's fingerprint ${fpOf(ref)} (printed by the preflight) — nothing written`);
    if (db.ws_schema || db.private_schema || (db.migrations_recorded || []).includes(VERSION)) fail('apply refused', 'PROPX objects already exist (schema ws / private or the recorded version) — nothing written; run audit instead');
    if (db.propx_auth_role && (db.propx_auth_holds.flags || db.propx_auth_holds.objects)) fail('apply refused', `a role propx_auth already exists and holds something here (${JSON.stringify(db.propx_auth_holds)}) — nothing written`);
    if (Object.keys(db.user_tables || {}).length) fail('apply refused', `the database already holds user tables outside the platform schemas: ${JSON.stringify(db.user_tables)} — nothing written`);
    if (db.postgres_superuser !== false) fail('apply refused', `the project role \`${ROLE}\` is a superuser here (or missing) — the SECURITY DEFINER functions would run as a superuser; STOP`);
    /* the migration runs AS `postgres` (non-superuser): every object it creates is owned by postgres and its default-privilege
       revocations apply to postgres. A superuser API session switches to it; any other role is refused. */
    const prefix = db.current_user === ROLE ? '' : db.superuser ? `set role ${ROLE};\n` : null;
    if (prefix === null) fail('apply refused', `the Management API runs as ${db.current_user}, neither postgres nor a superuser that can act as it — STOP`);
    const text = fs.readFileSync(path.join(ROOT, MIGRATION), 'utf8');
    if (text.includes('$propx_mig$')) fail('apply refused', 'the migration text contains the recording delimiter');
    try { await sql(prefix + text, ref); } catch (e) { fail('migration FAILED (the migration is one transaction: nothing of it was kept)', e.message); }
    await sql(`${prefix}create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);
      insert into supabase_migrations.schema_migrations (version, name, statements) values ('${VERSION}', 'identity_foundation', array[$propx_mig$${text}$propx_mig$]) on conflict (version) do nothing;`, ref);
    const after = await one(`select jsonb_build_object('recorded', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
      'owner_of_ws', (select nspowner::regrole::text from pg_namespace where nspname = 'ws'), 'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('ws','private')))`, ref);
    /* Data API: expose ws only (private never); Auth: no public sign-up (PROPX does not use Supabase Auth users) */
    const pg0 = await api(`/projects/${ref}/postgrest`);
    const pg1 = await api(`/projects/${ref}/postgrest`, { method: 'PATCH', body: { db_schema: 'ws' } });
    const au0 = await api(`/projects/${ref}/config/auth`);
    const au1 = await api(`/projects/${ref}/config/auth`, { method: 'PATCH', body: { disable_signup: true } });
    note('migration APPLIED', `version ${VERSION} · sha256 ${sha} · run as ${prefix ? ROLE + ' (switched from ' + db.current_user + ')' : ROLE} · ${JSON.stringify(after)}\nData API exposed schemas: ${pg0.json && pg0.json.db_schema} → ${pg1.json && pg1.json.db_schema} (HTTP ${pg1.status})\nAuth sign-up disabled: ${au0.json && au0.json.disable_signup} → ${au1.json && au1.json.disable_signup} (HTTP ${au1.status})`);
  }
  if (mode === 'probe') {
    if (!db.ws_schema) fail('probe', 'schema ws does not exist yet — apply first');
    const before = await one(`select jsonb_build_object('users', (select count(*) from ws.users), 'memberships_of_runner', (select coalesce(jsonb_agg(roleid::regrole::text order by 1), '[]'::jsonb) from pg_auth_members where member = current_user::regrole))`, ref);
    if (before.users !== 0) fail('probe refused', 'the project already has users — the probe runs only on an empty foundation');
    let msg = '';
    try { await sql(fs.readFileSync(path.join(ROOT, PROBE), 'utf8'), ref); fail('probe', 'the probe statement ended WITHOUT its closing exception — inspect the project at once'); }
    catch (e) { msg = String(e.message || ''); }
    const m = /PROBE_RESULT (\{[^\n]*\})/.exec(msg.replace(/\\"/g, '"'));
    const after = await one(`select jsonb_build_object('users', (select count(*) from ws.users), 'organizations', (select count(*) from ws.organizations), 'members', (select count(*) from ws.organization_members),
      'sessions', (select count(*) from ws.sessions), 'credentials', (select count(*) from private.user_credentials), 'events', (select count(*) from private.identity_events),
      'memberships_of_runner', (select coalesce(jsonb_agg(roleid::regrole::text order by 1), '[]'::jsonb) from pg_auth_members where member = current_user::regrole))`, ref);
    const clean = ['users', 'organizations', 'members', 'sessions', 'credentials', 'events'].every((k) => after[k] === 0) && JSON.stringify(after.memberships_of_runner) === JSON.stringify(before.memberships_of_runner);
    if (!m) fail('probe gave no result', `${msg.slice(0, 1500)} · after: ${JSON.stringify(after)}`);
    let J; try { J = JSON.parse(m[1]); } catch { fail('probe result unreadable', m[1].slice(0, 1500)); }
    const res = J.results || [], bad = res.filter((x) => x.pass !== true && !x.note), nt = res.filter((x) => x.note);
    note('two-organization isolation probe (real project, rolled back)', `${res.length - bad.length - nt.length}/${res.length} pass · ${nt.length} not tested · roles: ${JSON.stringify(J.roles)}${J.error ? ' · ' + J.error : ''}\n` + res.map((x) => `${x.pass === true ? 'PASS' : x.note ? 'N/T ' : 'FAIL'} ${x.id}${x.note ? ' — ' + x.note : ''}`).join('\n'), bad.length || J.error ? 'error' : 'notice');
    note('nothing left behind', `${clean ? 'clean' : 'NOT CLEAN'} · after: ${JSON.stringify(after)}`, clean ? 'notice' : 'error');
    summary(); process.exit(bad.length || J.error || !clean ? 1 : 0);
  }
  if (mode === 'audit' || mode === 'apply') {
    if (mode === 'audit' && !db.ws_schema) fail('audit', 'schema ws does not exist yet — nothing to audit');
    const cat = await audit(ref); const bad = checkPrivileges(cat.privileges);
    note('catalogue', JSON.stringify({ tables: cat.tables, rls_off: cat.rls_off, functions: cat.functions, ws_functions: cat.ws_functions, definer_without_empty_search_path: cat.definer_without_empty_search_path, owners: cat.owners, owner_is_superuser: cat.owner_is_superuser })
      + `\nprivileges outside the allow-list: ${bad.length ? JSON.stringify(bad) : 'none'}\ndefault privileges of the applying role: ${JSON.stringify(cat.default_acl_postgres)}\nrows: ${JSON.stringify(cat.rows)}\nbusiness data: ${JSON.stringify(cat.business)}`,
      bad.length || (cat.rls_off || []).length || (cat.definer_without_empty_search_path || []).length || cat.owner_is_superuser ? 'error' : 'notice');
    const adv = await advisors(ref);
    const ours = (l) => JSON.stringify(l.metadata || {}).match(/"(ws|private)"/) || /\b(ws|private)\./.test(l.detail || '');
    const sec = Array.isArray(adv.security) ? adv.security : [];
    note('advisors (security)', Array.isArray(adv.security) ? `${sec.length} finding(s); on ws / private: ${sec.filter(ours).length}\n` + sec.map((l) => `${l.level} ${l.name} — ${l.detail}`).join('\n').slice(0, 7000) : JSON.stringify(adv.security),
      sec.some((l) => ours(l) && /ERROR|WARN/.test(l.level)) ? 'error' : 'notice');
    note('advisors (performance)', Array.isArray(adv.performance) ? `${adv.performance.length} finding(s)\n` + adv.performance.map((l) => `${l.level} ${l.name} — ${l.detail}`).join('\n').slice(0, 3000) : JSON.stringify(adv.performance));
    summary(); process.exit(bad.length || (cat.rls_off || []).length || cat.owner_is_superuser ? 1 : 0);
  }
  fail('mode', `unknown mode ${mode}`);
})().catch((e) => fail('identity-activate stopped', e && e.message));
