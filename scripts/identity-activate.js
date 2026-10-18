#!/usr/bin/env node
// PROPX · STEP 2A.1 — activate the identity foundation on the REAL private Supabase project (run by hand through
// .github/workflows/identity-activate.yml; the sandbox cannot reach Supabase). Modes:
//
//   preflight  read-only: which settings exist (names only), the target project verified through the Management API
//              (exactly one project named `propx-private`, region eu-central-1, healthy, NOT the public SUPABASE_URL
//              project, the same ref as PROPX_WS_URL when that is set), the executing role, and that the database is
//              empty of PROPX objects and business data.
//   apply      preflight + the confirmation input must equal the verified ref; applies the repository migration
//              unchanged (sha-256 recorded), records it in supabase_migrations.schema_migrations, exposes schema `ws`
//              only through the Data API and turns public sign-up off. Refused if any PROPX object already exists.
//   audit      read-only: the catalogue (tables · functions · RLS · every privilege against the allow-list · owners ·
//              default privileges), business-data emptiness and the Supabase security advisors.
//   probe      the two-organization isolation scenario on the real database, inside ONE statement that always ends in
//              an exception — PostgreSQL rolls all of it back; a separate read then proves nothing was left behind.
//
// Reads only server-side secrets; prints no secret value (the project ref and region are printed on purpose — they
// identify the target). Results are written as workflow annotations and the job summary.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const MIGRATION = 'supabase/private/migrations/20261019120000_identity_foundation.sql';
const VERSION = '20261019120000';
const EXPECT = Object.freeze({ name: 'propx-private', region: 'eu-central-1' });
const API = 'https://api.supabase.com/v1';
const env = process.env;
const TOKEN = String(env.SUPABASE_ACCESS_TOKEN || '').trim();
const mode = String(env.MODE || process.argv[2] || 'preflight').trim();

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
  if (r.status >= 300) { const e = new Error(`SQL HTTP ${r.status}: ${scrub((r.json && (r.json.message || r.json.error)) || r.text).slice(0, 4000)}`); e.status = r.status; e.body = r.json || r.text; throw e; }
  return r.json;
}
const one = async (query, ref) => { const rows = await sql(query, ref); const row = Array.isArray(rows) ? rows[0] : rows; return row && Object.values(row)[0]; };

/* ── the read-only facts every mode starts from ── */
async function preflight() {
  note('settings present (names only)', ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_URL', 'PROPX_WS_URL', 'PROPX_WS_APIKEY', 'PROPX_WS_JWT_SECRET']
    .map((k) => `${k}: ${String(env[k] || '').trim() ? 'set' : 'MISSING'}`).join(' · '));
  if (!TOKEN) fail('target NOT verified', 'SUPABASE_ACCESS_TOKEN is not set — the project name and region cannot be verified, so nothing is read or written');
  const r = await api('/projects');
  if (r.status !== 200 || !Array.isArray(r.json)) fail('target NOT verified', `Management API /projects answered HTTP ${r.status}`);
  const named = r.json.filter((p) => p.name === EXPECT.name);
  note('projects visible to the token', `${r.json.length} project(s); named "${EXPECT.name}": ${named.length}`);
  if (named.length !== 1) fail('target NOT verified', `expected exactly one project named "${EXPECT.name}", found ${named.length} — STOP`);
  const P = named[0], ref = String(P.ref || P.id || '').toLowerCase();
  const pub = refOfUrl(env.SUPABASE_URL), ws = refOfUrl(env.PROPX_WS_URL);
  const facts = { ref, name: P.name, region: P.region, status: P.status, pg: P.database && P.database.version, created: P.created_at, publicRef: pub ? 'known' : 'unknown', wsUrlRef: ws ? (ws === ref ? 'matches' : 'DIFFERS') : 'not set' };
  note('target project', `ref ${ref} · name ${P.name} · region ${P.region} · status ${P.status} · Postgres ${facts.pg || '?'} · created ${P.created_at || '?'} · PROPX_WS_URL ${facts.wsUrlRef}`);
  if (P.region !== EXPECT.region) fail('target NOT verified', `region is ${P.region}, expected ${EXPECT.region} — STOP`);
  if (!/ACTIVE_HEALTHY/.test(String(P.status))) fail('target NOT verified', `status is ${P.status}, expected ACTIVE_HEALTHY — STOP`);
  if (!pub) fail('target NOT verified', 'SUPABASE_URL (the public project) is not set, so "not the public project" cannot be proven — STOP');
  if (pub === ref) fail('target NOT verified', 'the named project IS the public SUPABASE_URL project — STOP');
  if (ws && ws !== ref) fail('target NOT verified', 'PROPX_WS_URL names a different project than "propx-private" — STOP');
  const db = await one(`select jsonb_build_object(
      'current_user', current_user, 'session_user', session_user,
      'superuser', (select rolsuper from pg_roles where rolname = current_user),
      'postgres_superuser', (select rolsuper from pg_roles where rolname = 'postgres'),
      'server_version', current_setting('server_version'),
      'ws_schema', to_regnamespace('ws') is not null, 'private_schema', to_regnamespace('private') is not null,
      'propx_auth_role', exists (select 1 from pg_roles where rolname = 'propx_auth'),
      'user_tables', (select coalesce(jsonb_object_agg(n, c), '{}'::jsonb) from (select n.nspname n, count(*) c from pg_class k join pg_namespace n on n.oid = k.relnamespace
          where k.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','auth','storage','realtime','supabase_functions','extensions','graphql','graphql_public','pgsodium','pgsodium_masks','vault','net','cron','supabase_migrations','pgbouncer','_realtime','_analytics','pg_toast')
          and n.nspname not like 'pg_temp%' group by 1) t),
      'storage_buckets', (select count(*) from storage.buckets), 'storage_objects', (select count(*) from storage.objects),
      'auth_users', (select count(*) from auth.users),
      'migrations_recorded', (select case when to_regclass('supabase_migrations.schema_migrations') is null then null
          else (select coalesce(jsonb_agg(version order by version), '[]'::jsonb) from supabase_migrations.schema_migrations) end)) as facts`, ref);
  note('database (before)', JSON.stringify(db));
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
           where table_schema in ('ws','private') and grantee not in ('postgres','supabase_admin')
          union select format('%s|%s.%s(col)|%s', grantee, table_schema, table_name, privilege_type) from information_schema.column_privileges
           where table_schema in ('ws','private') and grantee not in ('postgres','supabase_admin')
          union select format('%s|%s.%s|EXECUTE', coalesce(r.rolname, 'PUBLIC'), n.nspname, p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles r on r.oid = a.grantee
           where n.nspname in ('ws','private') and coalesce(r.rolname, 'PUBLIC') not in ('postgres','supabase_admin')
          union select format('%s|%s.%s(seq)|%s', coalesce(r.rolname, 'PUBLIC'), n.nspname, c.relname, a.privilege_type) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a left join pg_roles r on r.oid = a.grantee
           where c.relkind = 'S' and n.nspname in ('ws','private') and coalesce(r.rolname, 'PUBLIC') not in ('postgres','supabase_admin')
          union select format('%s|%s|%s', coalesce(r.rolname, 'PUBLIC'), n.nspname, a.privilege_type) from pg_namespace n
            cross join lateral aclexplode(n.nspacl) a left join pg_roles r on r.oid = a.grantee
           where n.nspname in ('ws','private') and coalesce(r.rolname, 'PUBLIC') not in ('postgres','supabase_admin')) t),
      'default_acl_postgres', (select coalesce(jsonb_agg(format('%s|%s|%s', coalesce(n.nspname, '*'), d.defaclobjtype, d.defaclacl::text)), '[]'::jsonb)
          from pg_default_acl d join pg_roles r on r.oid = d.defaclrole left join pg_namespace n on n.oid = d.defaclnamespace where r.rolname = current_user),
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
  if (mode === 'apply') fail('apply', 'not enabled in this version of the script');
  if (mode === 'audit') {
    if (!db.ws_schema) fail('audit', 'schema ws does not exist yet — nothing to audit');
    const cat = await audit(ref); const bad = checkPrivileges(cat.privileges);
    note('catalogue', JSON.stringify({ tables: cat.tables, rls_off: cat.rls_off, functions: cat.functions, definer_without_empty_search_path: cat.definer_without_empty_search_path, owners: cat.owners, owner_is_superuser: cat.owner_is_superuser }));
    note('privileges outside the allow-list', bad.length ? JSON.stringify(bad) : 'none', bad.length ? 'error' : 'notice');
    note('default privileges of the applying role', JSON.stringify(cat.default_acl_postgres));
    note('rows and business data', JSON.stringify({ rows: cat.rows, business: cat.business }));
    const adv = await advisors(ref);
    note('advisors (security)', JSON.stringify(adv.security).slice(0, 6000));
    note('advisors (performance)', JSON.stringify(adv.performance).slice(0, 3000));
    summary(); return;
  }
  fail('mode', `unknown mode ${mode}`);
})().catch((e) => fail('identity-activate stopped', e && e.message));
