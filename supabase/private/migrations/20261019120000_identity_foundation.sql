-- PROPX PRIVATE WORKSPACE · identity foundation (STEP 2A, 19.10.2026)
--
-- For the SEPARATE private Supabase project ONLY (decision D1). It is never applied to the project that holds the public
-- `market` schema (supabase/migrations/), and nothing public ever reads it.
--
-- What it holds: named, invite-only users (D2), organizations (one personal workspace per user + team workspaces), their
-- members with a role (owner · admin · analyst · viewer), and server-side sessions so a sign-out, a global sign-out, a
-- disabled user or a revoked membership takes effect on the very next request. No evidence, no files, no ALTARIS deals,
-- no Live Thesis (D3 · D5 · D6). Nothing is ever deleted (D4): a membership is revoked, an invitation expires or is
-- revoked, an organization is archived, a session is revoked.
--
-- Trust boundary:
--  * Every write goes through a SECURITY DEFINER function in schema `ws` (search_path = ''); no role holds INSERT /
--    UPDATE / DELETE on any table. The acting user comes from the server-minted JWT (claims sub · sid · sv), checked
--    against a LIVE session row on every call (private.current_user_id) — never from a parameter: no function takes a
--    created_by / added_by / actor argument, and an organization id is only ever a target that is checked.
--  * Every authorization failure is the same error (SQLSTATE 42501, message 'denied', no detail, no hint) and is raised
--    BEFORE any other validation, so a caller cannot tell an organization that does not exist from one it may not see.
--  * Direct reads (RLS): a user sees their own user row, the organizations they are an active member of and those
--    organizations' membership rows — column grants leave out the invitation token hash. Sessions, credentials and the
--    identity event log are not readable by any API role.
--  * `anon` and `service_role` hold nothing here: the private project is not reached with the service key at all.
--  * Roles: `authenticated` = a named user; `propx_auth` = the PROPX server's sign-in plane before a user exists (it may
--    only EXECUTE the ws.auth_* functions — no table).
--  * An invitation is only as good as its inviter's standing: it activates or is accepted only while the inviter is still
--    an active member, an active user and senior enough for the role invited; revoking, demoting or disabling the inviter
--    also revokes what they had sent. A NEW identity is created by one workspace's invitation, is activated only through
--    that workspace's link, and only once the platform administrator approved it (identities the platform administrator
--    invites are approved at creation) — a member can never claim an address for someone else.
--
-- Enterprise pilot (21.10.2026, before any real project applied this file — extended in place): the account plane a pilot
-- needs once the individual sign-in IS the site's gate — a per-client rate limit on the sign-in plane (keys are HMACs the
-- server computes; no address is stored), a password change that ends every other session, a display-name change, and a
-- platform-administrator password-reset link (one-time, 72 h, single use, ends every session when used).
--
-- Bootstrap: the project owner runs, once, in the SQL editor:  select private.bootstrap('<email>', '<name>', '<team>');
-- It returns a one-time activation token (72 h) for the first platform administrator, who becomes the first OWNER.
-- See supabase/private/README.md.

begin;

create schema if not exists ws;
create schema if not exists private;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'propx_auth') then
    create role propx_auth nologin noinherit;
  end if;
end $$;
grant propx_auth to authenticator;

-- ───────────────────────────── tables ─────────────────────────────

create table ws.users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique
                    check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  display_name      text check (display_name is null or length(btrim(display_name)) between 1 and 120),
  status            text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  session_version   integer not null default 1 check (session_version >= 1),
  is_platform_admin boolean not null default false,
  idp               text not null default 'propx' check (idp in ('propx')),   -- SSO adds a provider here; the subject stays per provider
  idp_subject       text,
  origin_org        uuid,             -- the workspace whose invitation created this identity: only its link activates it
  approved_at       timestamptz,      -- a new identity activates only once the platform administrator approved it
  approved_by       uuid references ws.users (id),
  created_at        timestamptz not null default now(),
  activated_at      timestamptz,
  disabled_at       timestamptz,
  updated_at        timestamptz not null default now(),
  unique (idp, idp_subject)
);

-- the credential half of a user, kept out of the exposed schema (1 : 1 with ws.users)
create table private.user_credentials (
  user_id         uuid primary key references ws.users (id),
  password_hash   text not null check (password_hash ~ '^scrypt\$'),
  password_set_at timestamptz not null default now(),
  failed_count    integer not null default 0 check (failed_count >= 0),
  locked_until    timestamptz,
  last_failed_at  timestamptz
);

create table ws.organizations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 120),
  kind           text not null check (kind in ('personal', 'team')),
  personal_owner uuid unique references ws.users (id),
  created_by     uuid references ws.users (id),            -- null only for the bootstrap organization
  created_at     timestamptz not null default now(),
  archived_at    timestamptz,
  archived_by    uuid references ws.users (id),
  check ((kind = 'personal') = (personal_owner is not null)),
  check ((archived_at is null) = (archived_by is null))
);
alter table ws.users add foreign key (origin_org) references ws.organizations (id);

-- a membership is also the invitation: status invited (with a one-time token hash) → active → revoked (never deleted).
-- invited_by / updated_by / revoked_by are COMPOSITE keys into the same organization's members: an action can never be
-- attributed to someone outside the organization, whatever code writes the row.
create table ws.organization_members (
  org_id            uuid not null references ws.organizations (id),
  user_id           uuid not null references ws.users (id),
  role              text not null check (role in ('owner', 'admin', 'analyst', 'viewer')),
  status            text not null check (status in ('invited', 'active', 'revoked')),
  invite_token_hash text unique check (invite_token_hash is null or invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at timestamptz,
  invited_by        uuid,
  invited_at        timestamptz,
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid,
  updated_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (org_id, user_id),
  foreign key (org_id, invited_by) references ws.organization_members (org_id, user_id),
  foreign key (org_id, revoked_by) references ws.organization_members (org_id, user_id),
  foreign key (org_id, updated_by) references ws.organization_members (org_id, user_id),
  check ((status = 'invited') = (invite_token_hash is not null and invite_expires_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

-- server-side sessions (the cookie carries the id + a secret whose sha-256 is stored here). Valid only while not revoked,
-- not expired, the user is active and the user's session_version still equals the one the session was issued under.
create table ws.sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references ws.users (id),
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  session_version integer not null,
  perimeter_hash  text not null check (perimeter_hash ~ '^[0-9a-f]{32}$'),
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_reason  text check (revoked_reason in ('signout', 'signout_all', 'admin', 'disabled', 'password')),
  check (expires_at > issued_at and expires_at <= issued_at + interval '8 hours'),
  check ((revoked_at is null) = (revoked_reason is null))
);
create index sessions_live_by_user on ws.sessions (user_id) where revoked_at is null;

-- append-only record of every identity action (who · what · where · when); no API role reads or writes it directly
create table private.identity_events (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  actor_user_id   uuid,
  action          text not null,
  org_id          uuid,
  subject_user_id uuid,
  detail          jsonb not null default '{}'::jsonb
);

-- the sign-in plane's rate limit: one row per client key (an HMAC the PROPX server computes from the client address and
-- the operation class — never the address itself), counted in a sliding window that restarts when it has passed
create table private.auth_rate (
  key_hash     text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits         integer not null check (hits >= 0)
);

-- a password-reset link the platform administrator issues for an ACTIVE user (the link is shown once, to the
-- administrator, who delivers it): only its sha-256 is stored; single use, 72 hours, superseded by a newer one
create table private.password_resets (
  token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id      uuid not null references ws.users (id),
  created_by   uuid not null references ws.users (id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  superseded_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '72 hours')
);

-- ───────────────────────────── guards ─────────────────────────────

create function private.forbid_delete() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'rows in %.% are never deleted (revoke / archive / expire instead)', tg_table_schema, tg_table_name
    using errcode = 'P0001';
end $$;

create function private.forbid_update() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'rows in %.% are append-only', tg_table_schema, tg_table_name using errcode = 'P0001';
end $$;

create function private.guard_users() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.email <> old.email or new.idp <> old.idp or new.created_at <> old.created_at
     or new.session_version < old.session_version
     or new.origin_org is distinct from old.origin_org
     or (old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by)) then
    raise exception 'immutable user field' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

create function private.guard_orgs() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.kind <> old.kind or new.personal_owner is distinct from old.personal_owner
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'immutable organization field' using errcode = 'P0001';
  end if;
  return new;
end $$;

create function private.guard_members() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id <> old.org_id or new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'immutable membership field' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

create function private.guard_sessions() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.token_hash <> old.token_hash
     or new.session_version <> old.session_version or new.perimeter_hash <> old.perimeter_hash
     or new.issued_at <> old.issued_at or new.expires_at <> old.expires_at
     or (old.revoked_at is not null and (new.revoked_at is distinct from old.revoked_at or new.revoked_reason is distinct from old.revoked_reason)) then
    raise exception 'a session is only ever revoked' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- a reset link is only ever used or superseded, once
create function private.guard_resets() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.token_hash <> old.token_hash or new.user_id <> old.user_id or new.created_by <> old.created_by
     or new.created_at <> old.created_at or new.expires_at <> old.expires_at
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'a reset link is only ever used or superseded' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- every organization with an active member keeps at least one active owner (checked at commit, after every change); a
-- disabled user is neither: an owner who cannot sign in does not keep a workspace governed
create function private.check_owner() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid := coalesce(new.org_id, old.org_id);
begin
  if exists (select 1 from ws.organization_members m join ws.users u on u.id = m.user_id
              where m.org_id = v_org and m.status = 'active' and u.status = 'active')
     and not exists (select 1 from ws.organization_members m join ws.users u on u.id = m.user_id
                      where m.org_id = v_org and m.status = 'active' and m.role = 'owner' and u.status = 'active') then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  return null;
end $$;

create trigger users_no_delete before delete on ws.users for each row execute function private.forbid_delete();
create trigger users_no_truncate before truncate on ws.users for each statement execute function private.forbid_delete();
create trigger users_guard before update on ws.users for each row execute function private.guard_users();
create trigger credentials_no_delete before delete on private.user_credentials for each row execute function private.forbid_delete();
create trigger credentials_no_truncate before truncate on private.user_credentials for each statement execute function private.forbid_delete();
create trigger orgs_no_delete before delete on ws.organizations for each row execute function private.forbid_delete();
create trigger orgs_no_truncate before truncate on ws.organizations for each statement execute function private.forbid_delete();
create trigger orgs_guard before update on ws.organizations for each row execute function private.guard_orgs();
create trigger members_no_delete before delete on ws.organization_members for each row execute function private.forbid_delete();
create trigger members_no_truncate before truncate on ws.organization_members for each statement execute function private.forbid_delete();
create trigger members_guard before update on ws.organization_members for each row execute function private.guard_members();
create constraint trigger members_keep_owner after insert or update on ws.organization_members
  deferrable initially deferred for each row execute function private.check_owner();
create trigger sessions_no_delete before delete on ws.sessions for each row execute function private.forbid_delete();
create trigger sessions_no_truncate before truncate on ws.sessions for each statement execute function private.forbid_delete();
create trigger sessions_guard before update on ws.sessions for each row execute function private.guard_sessions();
create trigger events_no_delete before delete on private.identity_events for each row execute function private.forbid_delete();
create trigger events_no_truncate before truncate on private.identity_events for each statement execute function private.forbid_delete();
create trigger events_no_update before update on private.identity_events for each row execute function private.forbid_update();
create trigger rate_no_delete before delete on private.auth_rate for each row execute function private.forbid_delete();
create trigger rate_no_truncate before truncate on private.auth_rate for each statement execute function private.forbid_delete();
create trigger resets_no_delete before delete on private.password_resets for each row execute function private.forbid_delete();
create trigger resets_no_truncate before truncate on private.password_resets for each statement execute function private.forbid_delete();
create trigger resets_guard before update on private.password_resets for each row execute function private.guard_resets();

-- ───────────────────────────── helpers (schema private — never exposed through the API) ─────────────────────────────

create function private.denied() returns void language plpgsql set search_path = '' as $$
begin
  raise exception 'denied' using errcode = '42501';
end $$;

create function private.as_uuid(p text) returns uuid language sql immutable set search_path = '' as $$
  select case when p ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then p::uuid end
$$;

create function private.claims() returns jsonb language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- the acting user: only from a LIVE session named by the token's sid, issued to the token's sub, under the user's current
-- session_version (a global sign-out or a disabled user ends every session at once). Null = not signed in.
create function private.current_user_id() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := private.claims();
  v uuid;
begin
  if coalesce(c ->> 'role', '') <> 'authenticated' or coalesce(c ->> 'sv', '') !~ '^[0-9]{1,9}$' then
    return null;
  end if;
  select s.user_id into v
    from ws.sessions s
    join ws.users u on u.id = s.user_id
   where s.id = private.as_uuid(c ->> 'sid')
     and s.user_id = private.as_uuid(c ->> 'sub')
     and s.revoked_at is null
     and s.expires_at > now()
     and u.status = 'active'
     and s.session_version = u.session_version
     and s.session_version = (c ->> 'sv')::integer;
  return v;
end $$;

create function private.my_org_ids() returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.org_id from ws.organization_members m where m.user_id = private.current_user_id() and m.status = 'active'
$$;

create function private.role_in(p_org uuid) returns text language sql stable security definer set search_path = '' as $$
  select m.role from ws.organization_members m
   where m.org_id = p_org and m.user_id = private.current_user_id() and m.status = 'active'
$$;

create function private.rank(p_role text) returns integer language sql immutable set search_path = '' as $$
  select case p_role when 'owner' then 4 when 'admin' then 3 when 'analyst' then 2 when 'viewer' then 1 else 0 end
$$;

-- the signed-in user or 'denied'
create function private.require_user() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.current_user_id();
begin
  if v is null then perform private.denied(); end if;
  return v;
end $$;

-- the caller's role in an organization, at least p_min, or 'denied' — the same answer for an organization that does not
-- exist, one the caller was never in, one they were revoked from and one where their role is too low
create function private.require_role(p_org uuid, p_min text) returns text language plpgsql stable security definer set search_path = '' as $$
declare v text := private.role_in(p_org);
begin
  if v is null or private.rank(v) < private.rank(p_min) then perform private.denied(); end if;
  return v;
end $$;

create function private.log(p_actor uuid, p_action text, p_org uuid, p_subject uuid, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into private.identity_events (actor_user_id, action, org_id, subject_user_id, detail)
  values (p_actor, p_action, p_org, p_subject, coalesce(p_detail, '{}'::jsonb))
$$;

-- printable ASCII only: a zero-width character or a look-alike letter never makes a second identity for the "same" address
create function private.norm_email(p text) returns text language plpgsql immutable set search_path = '' as $$
declare v text := lower(btrim(coalesce(p, '')));
begin
  if length(v) > 254 or v !~ '^[!-?A-~]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  return v;
end $$;

create function private.check_hash(p text) returns text language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(p, '') !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token' using errcode = 'P0001'; end if;
  return p;
end $$;

-- personal workspace of a user (created once, at activation)
create function private.ensure_personal(p_user uuid, p_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select o.id into v from ws.organizations o where o.personal_owner = p_user;
  if v is null then
    insert into ws.organizations (name, kind, personal_owner, created_by)
    values (left(coalesce(nullif(btrim(p_name), ''), 'Personal'), 120), 'personal', p_user, p_user) returning id into v;
    insert into ws.organization_members (org_id, user_id, role, status, accepted_at) values (v, p_user, 'owner', 'active', now());
  end if;
  return v;
end $$;

-- is an invitation still backed by its inviter? The inviter must still be an active member and an active user, senior
-- enough for the role invited (admin for analyst / viewer, owner for admin / owner). Only the bootstrap invitation has no
-- inviter, and only in the first team (the one workspace created by no one).
create function private.invite_backed(p_org uuid, p_inviter uuid, p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_inviter is null then exists (select 1 from ws.organizations o where o.id = p_org and o.created_by is null)
    else exists (
      select 1 from ws.organization_members x join ws.users u on u.id = x.user_id
       where x.org_id = p_org and x.user_id = p_inviter and x.status = 'active' and u.status = 'active'
         and private.rank(x.role) >= case when private.rank(p_role) >= 3 then 4 else 3 end)
  end
$$;

-- revoke the open invitations an inviter sent (in one workspace, or everywhere) at or above a role rank — called when the
-- inviter is revoked, leaves, is demoted or is disabled, so a lost standing never lives on in a link already handed out
create function private.expire_invites_by(p_inviter uuid, p_org uuid, p_min_rank integer, p_actor uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update ws.organization_members m
     set status = 'revoked', invite_token_hash = null, invite_expires_at = null, revoked_at = now(),
         revoked_by = case when exists (select 1 from ws.organization_members a where a.org_id = m.org_id and a.user_id = p_actor)
                           then p_actor end
   where m.invited_by = p_inviter and m.status = 'invited' and (p_org is null or m.org_id = p_org)
     and private.rank(m.role) >= p_min_rank;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform private.log(p_actor, 'expire_invitations', p_org, p_inviter, jsonb_build_object('invitations', v_n, 'min_rank', p_min_rank));
  end if;
  return v_n;
end $$;

-- ───────────────────────────── bootstrap (owner only, SQL editor) ─────────────────────────────

-- Creates the first platform administrator as an INVITED owner of the first team workspace and returns the one-time
-- activation token (shown once; only its sha-256 is stored). Refused once any platform administrator exists.
create function private.bootstrap(p_email text, p_display_name text, p_team_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := private.norm_email(p_email);
  v_user uuid; v_org uuid;
  -- 32 bytes (244 random bits) as 43 base64url characters — the same form as the invitation links the server mints
  v_token text := translate(rtrim(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_');
begin
  if exists (select 1 from ws.users where is_platform_admin) then
    raise exception 'already bootstrapped' using errcode = 'P0001';
  end if;
  insert into ws.organizations (name, kind, created_by) values (btrim(p_team_name), 'team', null) returning id into v_org;
  insert into ws.users (email, display_name, status, is_platform_admin, origin_org, approved_at)
  values (v_email, nullif(btrim(p_display_name), ''), 'invited', true, v_org, now()) returning id into v_user;
  insert into ws.organization_members (org_id, user_id, role, status, invite_token_hash, invite_expires_at, invited_at)
  values (v_org, v_user, 'owner', 'invited', encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now() + interval '72 hours', now());
  perform private.log(null, 'bootstrap', v_org, v_user, jsonb_build_object('email', v_email));
  return v_token;
end $$;

-- ───────────────────────────── sign-in plane (role propx_auth only) ─────────────────────────────

-- the stored password hash of an ACTIVE user (the PROPX server verifies it); null for an unknown / inactive email
create function ws.auth_signin_lookup(p_email text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'user_id', u.id,
           'locked', coalesce(c.locked_until > now(), false),
           'password_hash', case when coalesce(c.locked_until > now(), false) then null else c.password_hash end)
    from ws.users u join private.user_credentials c on c.user_id = u.id
   where u.email = lower(btrim(coalesce(p_email, ''))) and u.status = 'active'
$$;

-- a failed sign-in, keyed by the EMAIL as typed (the server makes this call on EVERY failure — unknown address, wrong
-- password, locked or inactive account — so the number of calls says nothing about the address): an active, unlocked
-- account counts it; 5 in a row lock it for 15 minutes. The answer is the same for every address.
create function ws.auth_signin_failed(p_email text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_locked boolean := false;
begin
  update private.user_credentials c
     set failed_count = case when c.failed_count + 1 >= 5 then 0 else c.failed_count + 1 end,
         locked_until = case when c.failed_count + 1 >= 5 then now() + interval '15 minutes' else c.locked_until end,
         last_failed_at = now()
    from ws.users u
   where u.id = c.user_id and u.email = lower(btrim(coalesce(p_email, ''))) and u.status = 'active'
     and (c.locked_until is null or c.locked_until <= now())
  returning c.user_id, c.locked_until > now() into v_user, v_locked;
  if coalesce(v_locked, false) then perform private.log(null, 'signin_locked', null, v_user); end if;
  return jsonb_build_object('ok', true);
end $$;

-- a verified sign-in → a new server-side session (a fresh id + token every time: no session fixation)
create function ws.auth_session_open(p_user_id uuid, p_token_hash text, p_perimeter_hash text, p_ttl_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sv integer; v_s ws.sessions;
begin
  select u.session_version into v_sv
    from ws.users u join private.user_credentials c on c.user_id = u.id
   where u.id = p_user_id and u.status = 'active' and (c.locked_until is null or c.locked_until <= now());
  if v_sv is null then perform private.denied(); end if;
  update private.user_credentials set failed_count = 0, locked_until = null where user_id = p_user_id;
  insert into ws.sessions (user_id, token_hash, session_version, perimeter_hash, expires_at)
  values (p_user_id, private.check_hash(p_token_hash), v_sv, p_perimeter_hash,
          now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 28800), 28800))))
  returning * into v_s;
  perform private.log(p_user_id, 'signin', null, p_user_id, jsonb_build_object('session_id', v_s.id));
  return jsonb_build_object('session_id', v_s.id, 'user_id', v_s.user_id, 'session_version', v_s.session_version,
                            'issued_at', v_s.issued_at, 'expires_at', v_s.expires_at);
end $$;

-- the session behind a cookie, if it is still live; null otherwise
create function ws.auth_session_check(p_session_id uuid, p_token_hash text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('session_id', s.id, 'user_id', u.id, 'session_version', s.session_version,
                            'perimeter_hash', s.perimeter_hash, 'issued_at', s.issued_at, 'expires_at', s.expires_at)
    from ws.sessions s join ws.users u on u.id = s.user_id
   where s.id = p_session_id and s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
     and u.status = 'active' and s.session_version = u.session_version
$$;

-- sign-out: only the holder of the session secret can end it
create function ws.auth_session_revoke(p_session_id uuid, p_token_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  update ws.sessions set revoked_at = now(), revoked_reason = 'signout'
   where id = p_session_id and token_hash = p_token_hash and revoked_at is null
  returning user_id into v_user;
  if v_user is not null then perform private.log(v_user, 'signout', null, v_user, jsonb_build_object('session_id', p_session_id)); end if;
  return jsonb_build_object('revoked', v_user is not null);
end $$;

-- what an invitation link opens (shown only to the holder of the link). needs_activation = this link created the identity
-- and it has never been activated; pending_approval = it still waits for the platform administrator. A link whose inviter
-- lost their standing opens nothing.
create function ws.auth_invite_peek(p_token_hash text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('org_name', o.name, 'role', m.role, 'email', u.email,
                            'needs_activation', u.status = 'invited' and u.origin_org = m.org_id,
                            'pending_approval', u.status = 'invited' and u.origin_org = m.org_id and u.approved_at is null,
                            'expires_at', m.invite_expires_at)
    from ws.organization_members m
    join ws.organizations o on o.id = m.org_id
    join ws.users u on u.id = m.user_id
   where m.invite_token_hash = p_token_hash and m.status = 'invited' and m.invite_expires_at > now()
     and o.archived_at is null and u.status <> 'disabled' and private.invite_backed(m.org_id, m.invited_by, m.role)
$$;

-- first activation of a NEW user through an invitation link: sets the password, opens the personal workspace and joins
-- the inviting organization. Only the link of the workspace that CREATED the identity activates it, only while its
-- inviter still stands, and only once the platform administrator approved the identity. An existing user is never
-- activated again (an inviter can never set someone's password): they sign in and accept.
create function ws.auth_activate(p_token_hash text, p_password_hash text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m ws.organization_members; u ws.users; v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  select * into m from ws.organization_members
   where invite_token_hash = p_token_hash and status = 'invited' and invite_expires_at > now() for update;
  if m.org_id is null then perform private.denied(); end if;
  select * into u from ws.users where id = m.user_id for update;
  if u.status <> 'invited' or u.origin_org is distinct from m.org_id
     or exists (select 1 from ws.organizations o where o.id = m.org_id and o.archived_at is not null)
     or not private.invite_backed(m.org_id, m.invited_by, m.role) then
    perform private.denied();
  end if;
  if u.approved_at is null then raise exception 'pending_approval' using errcode = 'P0001'; end if;
  if v_name is null or length(v_name) > 120 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if coalesce(p_password_hash, '') !~ '^scrypt\$' then raise exception 'invalid_credential' using errcode = 'P0001'; end if;
  insert into private.user_credentials (user_id, password_hash) values (m.user_id, p_password_hash);
  update ws.users set status = 'active', activated_at = now(), display_name = v_name where id = m.user_id;
  update ws.organization_members
     set status = 'active', accepted_at = now(), invite_token_hash = null, invite_expires_at = null
   where org_id = m.org_id and user_id = m.user_id;
  perform private.ensure_personal(m.user_id, v_name);
  perform private.log(m.user_id, 'activate', m.org_id, m.user_id, jsonb_build_object('role', m.role));
  return jsonb_build_object('user_id', m.user_id, 'org_id', m.org_id, 'role', m.role);
end $$;

-- the sign-in plane's rate limit (pilot, 21.10.2026): count one attempt for a client key and say whether it is still
-- within p_limit attempts per p_window_seconds. The key is an HMAC the server computes (client address + operation class):
-- the database never sees an address. A window that has passed restarts at 1.
create function ws.auth_rate_hit(p_key_hash text, p_limit integer, p_window_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 1000));
  v_win interval := make_interval(secs => greatest(10, least(coalesce(p_window_seconds, 900), 86400)));
  r private.auth_rate;
begin
  insert into private.auth_rate as a (key_hash, window_start, hits) values (private.check_hash(p_key_hash), now(), 1)
  on conflict (key_hash) do update
     set window_start = case when a.window_start <= now() - v_win then now() else a.window_start end,
         hits = case when a.window_start <= now() - v_win then 1 else least(a.hits + 1, 1000000) end
  returning * into r;
  return jsonb_build_object('allowed', r.hits <= v_limit,
                            'retry_after', case when r.hits <= v_limit then 0
                                                else greatest(1, ceil(extract(epoch from (r.window_start + v_win - now())))::integer) end);
end $$;

-- what a password-reset link opens (shown only to its holder): the account's address and the link's expiry; null for a
-- used, superseded, expired or unknown link, or a user who is no longer active
create function ws.auth_reset_peek(p_token_hash text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', u.email, 'expires_at', r.expires_at)
    from private.password_resets r join ws.users u on u.id = r.user_id
   where r.token_hash = p_token_hash and r.used_at is null and r.superseded_at is null and r.expires_at > now()
     and u.status = 'active'
$$;

-- a password-reset link used: the new password (hashed by the PROPX server), the account unlocked, EVERY session of the
-- user ended (session_version + 1), the link spent. The server then opens one new session for this browser.
create function ws.auth_reset_complete(p_token_hash text, p_password_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r private.password_resets; v_n integer;
begin
  select * into r from private.password_resets
   where token_hash = p_token_hash and used_at is null and superseded_at is null and expires_at > now() for update;
  if r.user_id is null or not exists (select 1 from ws.users u where u.id = r.user_id and u.status = 'active') then
    perform private.denied();
  end if;
  if coalesce(p_password_hash, '') !~ '^scrypt\$' then raise exception 'invalid_credential' using errcode = 'P0001'; end if;
  update private.user_credentials
     set password_hash = p_password_hash, password_set_at = now(), failed_count = 0, locked_until = null
   where user_id = r.user_id;
  update ws.users set session_version = session_version + 1 where id = r.user_id;
  update ws.sessions set revoked_at = now(), revoked_reason = 'password' where user_id = r.user_id and revoked_at is null;
  get diagnostics v_n = row_count;
  update private.password_resets set used_at = now() where token_hash = r.token_hash;
  perform private.log(r.user_id, 'password_reset', null, r.user_id, jsonb_build_object('sessions', v_n, 'issued_by', r.created_by));
  return jsonb_build_object('user_id', r.user_id, 'sessions_revoked', v_n);
end $$;

-- ───────────────────────────── member plane (role authenticated) ─────────────────────────────

-- WHO am I · WHICH organizations · WHAT role in each
create function ws.me() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select jsonb_build_object(
      'user', jsonb_build_object('id', u.id, 'email', u.email, 'display_name', u.display_name,
                                 'is_platform_admin', u.is_platform_admin, 'session_version', u.session_version),
      'organizations', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'role', m.role,
                                            'archived', o.archived_at is not null)
                         order by (o.kind = 'personal') desc, o.name)
          from ws.organization_members m join ws.organizations o on o.id = m.org_id
         where m.user_id = v_uid and m.status = 'active'), '[]'::jsonb))
      from ws.users u where u.id = v_uid);
end $$;

-- the members of a workspace. A row that never joined (an invitation, or one revoked before it was accepted) shows only
-- what the workspace itself wrote — email, role, status, dates, who invited — never the account behind the address (its
-- name or state lives in another workspace's world and says whether the address has an account at all).
create function ws.org_members(p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := private.require_role(p_org, 'viewer');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', m.user_id, 'email', u.email,
             'display_name', case when m.accepted_at is not null then u.display_name end,
             'role', m.role, 'status', m.status,
             'user_status', case when m.accepted_at is not null then u.status end,
             'invited_at', m.invited_at, 'invited_by', m.invited_by,
             'invited_by_email', (select i.email from ws.users i where i.id = m.invited_by),
             'invite_expires_at', case when private.rank(v_role) >= 3 then m.invite_expires_at end,
             'accepted_at', m.accepted_at, 'revoked_at', m.revoked_at)
           order by m.status, private.rank(m.role) desc, u.email)
      from ws.organization_members m join ws.users u on u.id = m.user_id
     where m.org_id = p_org), '[]'::jsonb);
end $$;

-- invite (or re-invite) an email into a team workspace. OWNER may invite any role; ADMIN only analyst / viewer. The answer
-- is the same whether or not a user with that email already exists. An unknown address becomes a NEW identity of this
-- workspace (origin_org): approved at once when the platform administrator invites it, otherwise waiting for approval.
create function ws.invite_member(p_org uuid, p_email text, p_role text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_caller text; v_email text; v_user uuid; m ws.organization_members; o ws.organizations;
begin
  perform 1 from ws.organizations where id = p_org for update;
  v_caller := private.require_role(p_org, 'admin');
  if private.rank(p_role) = 0 then raise exception 'invalid_role' using errcode = 'P0001'; end if;
  if v_caller <> 'owner' and private.rank(p_role) >= 3 then perform private.denied(); end if;
  select * into o from ws.organizations where id = p_org;
  if o.kind = 'personal' then raise exception 'personal_org' using errcode = 'P0001'; end if;
  if o.archived_at is not null then raise exception 'archived' using errcode = 'P0001'; end if;
  v_email := private.norm_email(p_email);
  perform private.check_hash(p_token_hash);
  select id into v_user from ws.users where email = v_email;
  if v_user is null then
    insert into ws.users (email, status, origin_org, approved_at, approved_by)
    select v_email, 'invited', p_org, case when a.ok then now() end, case when a.ok then v_uid end
      from (select exists (select 1 from ws.users x where x.id = v_uid and x.is_platform_admin and x.status = 'active') as ok) a
    returning id into v_user;
  end if;
  select * into m from ws.organization_members where org_id = p_org and user_id = v_user for update;
  if m.org_id is not null and m.status = 'active' then raise exception 'already_member' using errcode = 'P0001'; end if;
  if m.org_id is not null and v_caller <> 'owner' and private.rank(m.role) >= 3 then perform private.denied(); end if;
  if m.org_id is null then
    insert into ws.organization_members (org_id, user_id, role, status, invite_token_hash, invite_expires_at, invited_by, invited_at, updated_by)
    values (p_org, v_user, p_role, 'invited', p_token_hash, now() + interval '72 hours', v_uid, now(), v_uid);
  else
    update ws.organization_members
       set role = p_role, status = 'invited', invite_token_hash = p_token_hash, invite_expires_at = now() + interval '72 hours',
           invited_by = v_uid, invited_at = now(), revoked_at = null, revoked_by = null, accepted_at = null, updated_by = v_uid
     where org_id = p_org and user_id = v_user;
  end if;
  perform private.log(v_uid, 'invite', p_org, v_user, jsonb_build_object('role', p_role, 'email', v_email));
  return jsonb_build_object('org_id', p_org, 'email', v_email, 'role', p_role, 'expires_at', now() + interval '72 hours');
end $$;

create function ws.revoke_invitation(p_org uuid, p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_caller text; m ws.organization_members;
begin
  perform 1 from ws.organizations where id = p_org for update;
  v_caller := private.require_role(p_org, 'admin');
  select * into m from ws.organization_members where org_id = p_org and user_id = p_user and status = 'invited' for update;
  if m.org_id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if v_caller <> 'owner' and private.rank(m.role) >= 3 then perform private.denied(); end if;
  update ws.organization_members
     set status = 'revoked', invite_token_hash = null, invite_expires_at = null, revoked_at = now(), revoked_by = v_uid, updated_by = v_uid
   where org_id = p_org and user_id = p_user;
  perform private.log(v_uid, 'revoke_invitation', p_org, p_user, jsonb_build_object('role', m.role));
  return jsonb_build_object('revoked', true);
end $$;

-- an existing, signed-in user accepts an invitation; the link (token) is always required — an email address alone never
-- joins an organization
create function ws.accept_invitation(p_token_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); m ws.organization_members;
begin
  select * into m from ws.organization_members
   where invite_token_hash = p_token_hash and status = 'invited' and invite_expires_at > now() for update;
  if m.org_id is null or m.user_id <> v_uid
     or exists (select 1 from ws.organizations o where o.id = m.org_id and o.archived_at is not null)
     or not private.invite_backed(m.org_id, m.invited_by, m.role) then
    perform private.denied();
  end if;
  update ws.organization_members
     set status = 'active', accepted_at = now(), invite_token_hash = null, invite_expires_at = null
   where org_id = m.org_id and user_id = v_uid;
  perform private.log(v_uid, 'accept', m.org_id, v_uid, jsonb_build_object('role', m.role));
  return jsonb_build_object('org_id', m.org_id, 'role', m.role);
end $$;

-- OWNER sets any role; ADMIN only moves a member between analyst and viewer (never grants or removes admin / owner)
create function ws.set_member_role(p_org uuid, p_user uuid, p_role text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_caller text; m ws.organization_members;
begin
  perform 1 from ws.organizations where id = p_org for update;
  v_caller := private.require_role(p_org, 'admin');
  if private.rank(p_role) = 0 then raise exception 'invalid_role' using errcode = 'P0001'; end if;
  select * into m from ws.organization_members where org_id = p_org and user_id = p_user and status = 'active' for update;
  if m.org_id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if v_caller <> 'owner' and (private.rank(m.role) >= 3 or private.rank(p_role) >= 3) then perform private.denied(); end if;
  if exists (select 1 from ws.organizations where id = p_org and archived_at is not null) then
    raise exception 'archived' using errcode = 'P0001';
  end if;
  if m.role = 'owner' and p_role <> 'owner' and not exists (
       select 1 from ws.organization_members x join ws.users ux on ux.id = x.user_id
        where x.org_id = p_org and x.user_id <> p_user and x.status = 'active' and x.role = 'owner' and ux.status = 'active') then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  if m.role = p_role then return jsonb_build_object('role', p_role, 'changed', false); end if;
  update ws.organization_members set role = p_role, updated_by = v_uid where org_id = p_org and user_id = p_user;
  -- a demoted inviter's links above their new standing die with it (admin keeps analyst / viewer links; below admin, none)
  if private.rank(p_role) < private.rank(m.role) then
    perform private.expire_invites_by(p_user, p_org, case when private.rank(p_role) >= 3 then 3 else 0 end, v_uid);
  end if;
  perform private.log(v_uid, 'set_role', p_org, p_user, jsonb_build_object('from', m.role, 'to', p_role));
  return jsonb_build_object('role', p_role, 'changed', true);
end $$;

-- revoke a member (immediate: every read checks the membership). A member may leave; ADMIN revokes only analyst / viewer;
-- the last owner never leaves (archive the workspace instead); nobody leaves their personal workspace.
create function ws.revoke_member(p_org uuid, p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_caller text; m ws.organization_members; v_kind text;
begin
  perform 1 from ws.organizations where id = p_org for update;
  v_caller := private.require_role(p_org, case when p_user = v_uid then 'viewer' else 'admin' end);
  select * into m from ws.organization_members where org_id = p_org and user_id = p_user and status = 'active' for update;
  if m.org_id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_user <> v_uid and v_caller <> 'owner' and private.rank(m.role) >= 3 then perform private.denied(); end if;
  select kind into v_kind from ws.organizations where id = p_org;
  if v_kind = 'personal' then raise exception 'personal_org' using errcode = 'P0001'; end if;
  if m.role = 'owner' and not exists (
       select 1 from ws.organization_members x join ws.users ux on ux.id = x.user_id
        where x.org_id = p_org and x.user_id <> p_user and x.status = 'active' and x.role = 'owner' and ux.status = 'active') then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  update ws.organization_members set status = 'revoked', revoked_at = now(), revoked_by = v_uid, updated_by = v_uid
   where org_id = p_org and user_id = p_user;
  perform private.expire_invites_by(p_user, p_org, 0, v_uid);   -- what they sent here dies with their membership
  perform private.log(v_uid, case when p_user = v_uid then 'leave' else 'revoke_member' end, p_org, p_user, jsonb_build_object('role', m.role));
  return jsonb_build_object('revoked', true);
end $$;

create function ws.create_team(p_name text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_org uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if length(v_name) not between 1 and 120 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if (select count(*) from ws.organizations where created_by = v_uid and kind = 'team') >= 50 then
    raise exception 'too_many_teams' using errcode = 'P0001';
  end if;
  insert into ws.organizations (name, kind, created_by) values (v_name, 'team', v_uid) returning id into v_org;
  insert into ws.organization_members (org_id, user_id, role, status, accepted_at) values (v_org, v_uid, 'owner', 'active', now());
  perform private.log(v_uid, 'create_team', v_org, v_uid, jsonb_build_object('name', v_name));
  return jsonb_build_object('org_id', v_org, 'name', v_name, 'role', 'owner');
end $$;

-- OWNER archives (or restores) a team workspace — never deleted; an archived workspace takes no invitation or role change
create function ws.set_org_archived(p_org uuid, p_archived boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); o ws.organizations;
begin
  perform 1 from ws.organizations where id = p_org for update;
  perform private.require_role(p_org, 'owner');
  select * into o from ws.organizations where id = p_org;
  if o.kind = 'personal' then raise exception 'personal_org' using errcode = 'P0001'; end if;
  if coalesce(p_archived, false) = (o.archived_at is not null) then return jsonb_build_object('archived', p_archived, 'changed', false); end if;
  update ws.organizations
     set archived_at = case when p_archived then now() end, archived_by = case when p_archived then v_uid end
   where id = p_org;
  perform private.log(v_uid, case when p_archived then 'archive' else 'restore' end, p_org, null);
  return jsonb_build_object('archived', p_archived, 'changed', true);
end $$;

-- sign out everywhere: every session of the caller ends now (session_version + 1)
create function ws.signout_all() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_n integer;
begin
  update ws.users set session_version = session_version + 1 where id = v_uid;
  update ws.sessions set revoked_at = now(), revoked_reason = 'signout_all' where user_id = v_uid and revoked_at is null;
  get diagnostics v_n = row_count;
  perform private.log(v_uid, 'signout_all', null, v_uid, jsonb_build_object('sessions', v_n));
  return jsonb_build_object('sessions_revoked', v_n);
end $$;

-- change my password (pilot, 21.10.2026). The PROPX server has already verified the CURRENT password against the stored hash
-- (the same scrypt check as a sign-in, failures counted); here the new hash replaces it and EVERY session of the user ends
-- (session_version + 1) — the server then opens one new session for this browser.
create function ws.change_password(p_password_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_n integer;
begin
  if coalesce(p_password_hash, '') !~ '^scrypt\$' then raise exception 'invalid_credential' using errcode = 'P0001'; end if;
  update private.user_credentials
     set password_hash = p_password_hash, password_set_at = now(), failed_count = 0, locked_until = null
   where user_id = v_uid;
  update ws.users set session_version = session_version + 1 where id = v_uid;
  update ws.sessions set revoked_at = now(), revoked_reason = 'password' where user_id = v_uid and revoked_at is null;
  get diagnostics v_n = row_count;
  perform private.log(v_uid, 'password_change', null, v_uid, jsonb_build_object('sessions', v_n));
  return jsonb_build_object('user_id', v_uid, 'sessions_revoked', v_n);
end $$;

-- my display name (the address is the identity and never changes)
create function ws.set_display_name(p_display_name text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if v_name is null or length(v_name) > 120 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  update ws.users set display_name = v_name where id = v_uid;
  perform private.log(v_uid, 'set_display_name', null, v_uid);
  return jsonb_build_object('display_name', v_name);
end $$;

-- ───────────────────────────── platform administration (is_platform_admin only) ─────────────────────────────

create function private.require_platform_admin() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.require_user();
begin
  if not exists (select 1 from ws.users where id = v and is_platform_admin and status = 'active') then perform private.denied(); end if;
  return v;
end $$;

create function ws.admin_users() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id, 'email', u.email, 'display_name', u.display_name, 'status', u.status,
             'is_platform_admin', u.is_platform_admin, 'created_at', u.created_at, 'activated_at', u.activated_at,
             'approved', u.approved_at is not null, 'approved_at', u.approved_at,
             'origin_org_name', (select o.name from ws.organizations o where o.id = u.origin_org),
             'origin_invited_by_email', (select i.email from ws.organization_members m join ws.users i on i.id = m.invited_by
                                          where m.org_id = u.origin_org and m.user_id = u.id),
             'live_sessions', (select count(*) from ws.sessions s where s.user_id = u.id and s.revoked_at is null
                                and s.expires_at > now() and s.session_version = u.session_version),
             'organizations', (select count(*) from ws.organization_members m where m.user_id = u.id and m.status = 'active'))
           order by u.email)
      from ws.users u), '[]'::jsonb);
end $$;

-- disable / re-enable a user (a disabled user's sessions end at once). Refused for oneself and for the sole active owner
-- of a team that still has other members (ownership is handed over first).
create function ws.admin_set_user_status(p_user uuid, p_status text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_platform_admin(); v_old text;
begin
  if p_status not in ('active', 'disabled') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  if p_user = v_uid then raise exception 'self' using errcode = 'P0001'; end if;
  select status into v_old from ws.users where id = p_user for update;
  if v_old is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_status = 'disabled' then
    if v_old = 'disabled' then return jsonb_build_object('status', 'disabled', 'changed', false); end if;
    if exists (
      select 1 from ws.organization_members m join ws.organizations o on o.id = m.org_id
       where m.user_id = p_user and m.role = 'owner' and m.status = 'active' and o.kind = 'team'
         and exists (select 1 from ws.organization_members x where x.org_id = m.org_id and x.user_id <> p_user and x.status = 'active')
         and not exists (select 1 from ws.organization_members x join ws.users ux on ux.id = x.user_id
                          where x.org_id = m.org_id and x.user_id <> p_user and x.status = 'active' and x.role = 'owner' and ux.status = 'active')) then
      raise exception 'sole_owner' using errcode = 'P0001';
    end if;
    update ws.users set status = 'disabled', disabled_at = now(), session_version = session_version + 1 where id = p_user;
    update ws.sessions set revoked_at = now(), revoked_reason = 'disabled' where user_id = p_user and revoked_at is null;
    perform private.expire_invites_by(p_user, null, 0, v_uid);   -- every link they sent, in every workspace
  else
    if v_old <> 'disabled' then return jsonb_build_object('status', v_old, 'changed', false); end if;
    update ws.users set status = case when exists (select 1 from private.user_credentials c where c.user_id = p_user) then 'active' else 'invited' end,
                        disabled_at = null
     where id = p_user;
  end if;
  perform private.log(v_uid, 'user_' || p_status, null, p_user);
  return jsonb_build_object('status', (select status from ws.users where id = p_user), 'changed', true);
end $$;

create function ws.admin_revoke_sessions(p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_platform_admin(); v_n integer;
begin
  update ws.users set session_version = session_version + 1 where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  update ws.sessions set revoked_at = now(), revoked_reason = 'admin' where user_id = p_user and revoked_at is null;
  get diagnostics v_n = row_count;
  perform private.log(v_uid, 'revoke_sessions', null, p_user, jsonb_build_object('sessions', v_n));
  return jsonb_build_object('sessions_revoked', v_n);
end $$;

-- approve a NEW identity a workspace member created by invitation (the platform administrator sees the address, the
-- workspace that created it and who invited it). Approval is final; it activates nothing by itself — the creating
-- workspace's link still does that.
create function ws.admin_approve_user(p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_platform_admin(); u ws.users;
begin
  select * into u from ws.users where id = p_user for update;
  if u.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if u.approved_at is not null then return jsonb_build_object('approved', true, 'changed', false); end if;
  update ws.users set approved_at = now(), approved_by = v_uid where id = p_user;
  perform private.log(v_uid, 'approve_user', u.origin_org, p_user, jsonb_build_object('email', u.email));
  return jsonb_build_object('approved', true, 'changed', true);
end $$;

-- a password-reset link for an ACTIVE user (pilot, 21.10.2026): one-time, 72 hours; it supersedes any earlier unused link of
-- that user. The administrator never sets or sees a password — the link holder chooses it. An invited (never activated) or
-- disabled user is refused: the invitation link, or re-enabling first, is the path there.
create function ws.admin_reset_link(p_user uuid, p_token_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_platform_admin(); u ws.users; v_exp timestamptz := now() + interval '72 hours';
begin
  select * into u from ws.users where id = p_user for update;
  if u.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if u.status <> 'active' or not exists (select 1 from private.user_credentials c where c.user_id = p_user) then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  update private.password_resets set superseded_at = now() where user_id = p_user and used_at is null and superseded_at is null;
  insert into private.password_resets (token_hash, user_id, created_by, expires_at) values (private.check_hash(p_token_hash), p_user, v_uid, v_exp);
  perform private.log(v_uid, 'reset_link', null, p_user);
  return jsonb_build_object('email', u.email, 'expires_at', v_exp);
end $$;

-- ───────────────────────────── row-level security (direct reads) ─────────────────────────────

alter table ws.users enable row level security;
alter table ws.organizations enable row level security;
alter table ws.organization_members enable row level security;
alter table ws.sessions enable row level security;
alter table private.user_credentials enable row level security;
alter table private.identity_events enable row level security;
alter table private.auth_rate enable row level security;
alter table private.password_resets enable row level security;

create policy users_self on ws.users for select to authenticated using (id = (select private.current_user_id()));
create policy orgs_member on ws.organizations for select to authenticated using (id in (select private.my_org_ids()));
create policy members_member on ws.organization_members for select to authenticated using (org_id in (select private.my_org_ids()));
-- ws.sessions, private.user_credentials, private.identity_events, private.auth_rate, private.password_resets: no policy → no row
-- for any API role

-- ───────────────────────────── privileges (explicit, last — whatever the platform's defaults granted) ─────────────────────────────

revoke all on schema ws from public, anon, authenticated, service_role, propx_auth;
revoke all on schema private from public, anon, authenticated, service_role, propx_auth;
revoke all on all tables in schema ws from public, anon, authenticated, service_role, propx_auth;
revoke all on all tables in schema private from public, anon, authenticated, service_role, propx_auth;
revoke all on all sequences in schema ws from public, anon, authenticated, service_role, propx_auth;
revoke all on all sequences in schema private from public, anon, authenticated, service_role, propx_auth;
revoke all on all functions in schema ws from public, anon, authenticated, service_role, propx_auth;
revoke all on all functions in schema private from public, anon, authenticated, service_role, propx_auth;
-- and for every object this role creates LATER, anywhere (role-wide defaults, no IN SCHEMA — the only form that also takes
-- back PostgreSQL's built-in EXECUTE for PUBLIC): a future function, table, sequence or schema starts closed, and every
-- later migration grants what it needs explicitly. test/private-identity.test.js audits the catalogue (every privilege on
-- every object in ws / private must be on the allow-list below) and creates a probe function and table to prove it.
alter default privileges revoke all on functions from public, anon, authenticated, service_role, propx_auth;
alter default privileges revoke all on tables from public, anon, authenticated, service_role, propx_auth;
alter default privileges revoke all on sequences from public, anon, authenticated, service_role, propx_auth;
alter default privileges revoke all on schemas from public, anon, authenticated, service_role, propx_auth;

grant usage on schema ws to authenticated, propx_auth;
grant usage on schema private to authenticated;          -- the RLS policies call these two helpers; nothing else in private
grant execute on function private.current_user_id(), private.my_org_ids() to authenticated;

grant select (id, email, display_name, status, is_platform_admin, created_at, activated_at) on ws.users to authenticated;
grant select (id, name, kind, personal_owner, created_by, created_at, archived_at) on ws.organizations to authenticated;
grant select (org_id, user_id, role, status, invited_by, invited_at, accepted_at, revoked_at, created_at, updated_at)
  on ws.organization_members to authenticated;

grant execute on function
  ws.auth_signin_lookup(text), ws.auth_signin_failed(text), ws.auth_session_open(uuid, text, text, integer),
  ws.auth_session_check(uuid, text), ws.auth_session_revoke(uuid, text), ws.auth_invite_peek(text),
  ws.auth_activate(text, text, text), ws.auth_rate_hit(text, integer, integer), ws.auth_reset_peek(text),
  ws.auth_reset_complete(text, text)
  to propx_auth;

grant execute on function
  ws.me(), ws.org_members(uuid), ws.invite_member(uuid, text, text, text), ws.revoke_invitation(uuid, uuid),
  ws.accept_invitation(text), ws.set_member_role(uuid, uuid, text), ws.revoke_member(uuid, uuid), ws.create_team(text),
  ws.set_org_archived(uuid, boolean), ws.signout_all(), ws.admin_users(), ws.admin_set_user_status(uuid, text),
  ws.admin_revoke_sessions(uuid), ws.admin_approve_user(uuid), ws.change_password(text), ws.set_display_name(text),
  ws.admin_reset_link(uuid, text)
  to authenticated;

commit;
