-- TEST HARNESS ONLY — never applied to a real project.
-- Recreates, on a throwaway PostgreSQL 16, the roles a Supabase project has and how its API switches between them:
--   authenticator (the API's login: no privileges of its own, NOINHERIT) → SET ROLE anon | authenticated | service_role |
--   propx_auth, with the verified JWT's claims in request.jwt.claims (PostgREST semantics).
--   ws_owner stands in for the project's `postgres` role: NOT a superuser, CREATEROLE, owns what the migration creates.
-- It also installs DELIBERATELY PERMISSIVE platform defaults (every new table / function / sequence / schema granted to
-- anon, authenticated and service_role) so the gates prove the migration takes them back explicitly.
-- Run as a superuser on an empty database: psql -v ON_ERROR_STOP=1 -v pw="'…'" -f supabase-roles-shim.sql

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'ws_owner') then create role ws_owner login createrole; end if;
end $$;
alter role authenticator password :pw;
alter role ws_owner password :pw;
grant anon, authenticated, service_role to authenticator;
grant create, connect, temporary on database :"DBNAME" to ws_owner;

alter default privileges for role ws_owner grant all on tables to anon, authenticated, service_role;
alter default privileges for role ws_owner grant all on sequences to anon, authenticated, service_role;
alter default privileges for role ws_owner grant all on functions to anon, authenticated, service_role;
alter default privileges for role ws_owner grant usage on schemas to anon, authenticated, service_role;
