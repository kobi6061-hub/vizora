-- TEST HARNESS ONLY — the two-organization isolation probe for the REAL private project (STEP 2A.1).
-- One statement. It always ends by raising PROBE_RESULT <json>, so PostgreSQL rolls ALL of it back: the bootstrap, the probe
-- users, organizations, sessions and any role grant it needed to impersonate the API roles. Nothing is ever committed.
-- scripts/identity-activate.js (mode probe) runs it through the Management API and then reads the tables again to prove
-- they are still empty. Refuses to run on a project that already has a user (bootstrap would refuse anyway).
-- Every call is made the way the Data API makes it: SET LOCAL ROLE to the token's role + request.jwt.claims.
do $probe$
declare
  res jsonb := '[]'::jsonb;  roles jsonb := '{}'::jsonb;  rl text;  r jsonb;  e jsonb;
  t0 text;  t text;  padmin uuid;  pteam uuid;  a1 uuid;  b1 uuid;  b2 uuid;  orgA uuid;  orgB uuid;
  cP jsonb;  cA1 jsonb;  cB1 jsonb;  cB2 jsonb;
begin
  if exists (select 1 from ws.users) then raise exception 'PROBE_REFUSED the project already has users'; end if;

  -- helpers (pg_temp, created inside this statement → rolled back with it)
  execute $h$
    create function pg_temp.c(p_role text, p_claims jsonb, p_expr text) returns jsonb language plpgsql as $f$
    declare v jsonb;
    begin
      begin
        execute format('set local role %I', p_role);
        perform set_config('request.jwt.claims', coalesce(p_claims, jsonb_build_object('role', p_role))::text, true);
        execute 'select to_jsonb((' || p_expr || '))' into v;
        reset role;
        return jsonb_build_object('ok', true, 'v', v);
      exception when others then
        return jsonb_build_object('ok', false, 'code', sqlstate, 'msg', sqlerrm);
      end;
    end $f$ $h$;
  execute $h$
    create function pg_temp.s(p_role text, p_claims jsonb, p_stmt text) returns jsonb language plpgsql as $f$
    begin
      begin
        execute format('set local role %I', p_role);
        perform set_config('request.jwt.claims', coalesce(p_claims, jsonb_build_object('role', p_role))::text, true);
        execute p_stmt;
        reset role;
        return jsonb_build_object('ok', true);
      exception when others then
        return jsonb_build_object('ok', false, 'code', sqlstate, 'msg', sqlerrm);
      end;
    end $f$ $h$;
  execute $h$ create function pg_temp.h(p text) returns text language sql as $f$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $f$ $h$;
  execute $h$ create function pg_temp.tok() returns text language sql as $f$
    select translate(rtrim(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_') $f$ $h$;
  execute $h$ create function pg_temp.ses(p_user uuid) returns jsonb language plpgsql as $f$
    declare r jsonb;
    begin
      r := pg_temp.c('propx_auth', null, format('ws.auth_session_open(%L::uuid, %L, %L, 28800)', p_user, pg_temp.h(pg_temp.tok()), substr(md5(random()::text), 1, 32)));
      if not (r->>'ok')::boolean then raise exception 'PROBE_SETUP session %', r; end if;
      return jsonb_build_object('role', 'authenticated', 'sub', p_user, 'sid', r->'v'->>'session_id', 'sv', (r->'v'->>'session_version')::int);
    end $f$ $h$;

  -- the executing role must be able to act as each API role (SET ROLE). Grant it for this statement only if needed.
  foreach rl in array array['authenticated', 'propx_auth', 'anon', 'service_role'] loop
    begin
      execute format('set local role %I', rl); reset role;
      roles := roles || jsonb_build_object(rl, 'switchable');
    exception when others then
      begin
        execute format('grant %I to %I', rl, current_user);
        execute format('set local role %I', rl); reset role;
        roles := roles || jsonb_build_object(rl, 'granted for the probe (rolled back)');
      exception when others then
        roles := roles || jsonb_build_object(rl, 'NOT TESTABLE: ' || sqlerrm);
      end;
    end;
  end loop;
  if roles->>'authenticated' like 'NOT TESTABLE%' or roles->>'propx_auth' like 'NOT TESTABLE%' then
    raise exception 'PROBE_RESULT %', jsonb_build_object('roles', roles, 'results', res, 'error', 'the executing role cannot act as the API roles')::text;
  end if;

  -- ── setup: the platform admin, two independent organizations, one analyst ──
  t0 := private.bootstrap('admin@probe.invalid', 'Probe Admin', 'Probe Team');
  r := pg_temp.c('propx_auth', null, format('ws.auth_activate(%L, %L, %L)', pg_temp.h(t0), 'scrypt$fake$admin', 'Probe Admin'));
  if not (r->>'ok')::boolean then raise exception 'PROBE_SETUP activate admin %', r; end if;
  padmin := (r->'v'->>'user_id')::uuid;  pteam := (r->'v'->>'org_id')::uuid;  cP := pg_temp.ses(padmin);
  res := res || jsonb_build_object('id', 'setup: bootstrap + activation through the server-minted propx_auth plane', 'pass', true);

  t := pg_temp.tok(); r := pg_temp.c('authenticated', cP, format('ws.invite_member(%L::uuid, %L, %L, %L)', pteam, 'a1@probe.invalid', 'viewer', pg_temp.h(t)));
  a1 := (pg_temp.c('propx_auth', null, format('ws.auth_activate(%L, %L, %L)', pg_temp.h(t), 'scrypt$fake$a1', 'A One'))->'v'->>'user_id')::uuid;  cA1 := pg_temp.ses(a1);
  t := pg_temp.tok(); r := pg_temp.c('authenticated', cP, format('ws.invite_member(%L::uuid, %L, %L, %L)', pteam, 'b1@probe.invalid', 'viewer', pg_temp.h(t)));
  b1 := (pg_temp.c('propx_auth', null, format('ws.auth_activate(%L, %L, %L)', pg_temp.h(t), 'scrypt$fake$b1', 'B One'))->'v'->>'user_id')::uuid;  cB1 := pg_temp.ses(b1);
  orgA := (pg_temp.c('authenticated', cA1, 'ws.create_team(''Org A'')')->'v'->>'org_id')::uuid;
  orgB := (pg_temp.c('authenticated', cB1, 'ws.create_team(''Org B'')')->'v'->>'org_id')::uuid;
  t := pg_temp.tok(); r := pg_temp.c('authenticated', cB1, format('ws.invite_member(%L::uuid, %L, %L, %L)', orgB, 'b2@probe.invalid', 'analyst', pg_temp.h(t)));
  r := pg_temp.c('propx_auth', null, format('ws.auth_activate(%L, %L, %L)', pg_temp.h(t), 'scrypt$fake$b2', 'B Two'));
  res := res || jsonb_build_object('id', 'a member-created identity waits for the platform admin (pending_approval)', 'pass', r->>'msg' = 'pending_approval', 'got', r);
  b2 := (select id from ws.users where email = 'b2@probe.invalid');
  r := pg_temp.c('authenticated', cP, format('ws.admin_approve_user(%L::uuid)', b2));
  r := pg_temp.c('propx_auth', null, format('ws.auth_activate(%L, %L, %L)', pg_temp.h(t), 'scrypt$fake$b2', 'B Two'));
  cB2 := pg_temp.ses(b2);
  res := res || jsonb_build_object('id', 'setup: org A (owner a1), org B (owner b1 + analyst b2)', 'pass', a1 is not null and b1 is not null and b2 is not null and orgA is not null and orgB is not null and (r->>'ok')::boolean);

  -- ── isolation ──
  r := pg_temp.c('authenticated', cA1, format('ws.org_members(%L::uuid)', orgB));
  e := pg_temp.c('authenticated', cA1, format('ws.org_members(%L::uuid)', gen_random_uuid()));
  res := res || jsonb_build_object('id', 'A cannot read B through the functions (uniform 42501 denied)', 'pass', r->>'code' = '42501' and r->>'msg' = 'denied', 'got', r);
  res := res || jsonb_build_object('id', 'a hidden organization answers exactly like a missing one', 'pass', r = e);
  r := pg_temp.c('authenticated', cA1, format('jsonb_build_array((select count(*) from ws.organizations where id = %L), (select count(*) from ws.organization_members where org_id = %L), (select count(*) from ws.users))', orgB, orgB));
  res := res || jsonb_build_object('id', 'A reads no B row directly (RLS) and only its own user row', 'pass', r->'v' = '[0, 0, 1]'::jsonb, 'got', r);
  res := res || jsonb_build_object('id', 'A cannot write B (invite · role · revoke · archive)', 'pass',
    pg_temp.c('authenticated', cA1, format('ws.invite_member(%L::uuid, %L, %L, %L)', orgB, 'x@probe.invalid', 'viewer', pg_temp.h(pg_temp.tok())))->>'code' = '42501'
    and pg_temp.c('authenticated', cA1, format('ws.set_member_role(%L::uuid, %L::uuid, %L)', orgB, b2, 'viewer'))->>'code' = '42501'
    and pg_temp.c('authenticated', cA1, format('ws.revoke_member(%L::uuid, %L::uuid)', orgB, b2))->>'code' = '42501'
    and pg_temp.c('authenticated', cA1, format('ws.set_org_archived(%L::uuid, true)', orgB))->>'code' = '42501');
  res := res || jsonb_build_object('id', 'no direct write path: INSERT / UPDATE / DELETE refused, sessions unreadable', 'pass',
    pg_temp.s('authenticated', cA1, 'insert into ws.organizations (name, kind) values (''forged'', ''team'')')->>'code' = '42501'
    and pg_temp.s('authenticated', cA1, format('update ws.organization_members set role = ''owner'' where org_id = %L', orgA))->>'code' = '42501'
    and pg_temp.s('authenticated', cA1, format('delete from ws.organization_members where org_id = %L', orgA))->>'code' = '42501'
    and pg_temp.c('authenticated', cA1, '(select count(*) from ws.sessions)')->>'code' = '42501');
  res := res || jsonb_build_object('id', 'forged identity: another user''s sub on my session, an invented session, no session — not signed in', 'pass',
    pg_temp.c('authenticated', jsonb_build_object('role', 'authenticated', 'sub', b1, 'sid', cA1->>'sid', 'sv', 1), 'ws.me()')->>'code' = '42501'
    and pg_temp.c('authenticated', jsonb_build_object('role', 'authenticated', 'sub', b1, 'sid', gen_random_uuid(), 'sv', 1), 'ws.me()')->>'code' = '42501'
    and pg_temp.c('authenticated', jsonb_build_object('role', 'authenticated', 'sub', b1), 'ws.me()')->>'code' = '42501');
  if roles->>'anon' not like 'NOT TESTABLE%' and roles->>'service_role' not like 'NOT TESTABLE%' then
    res := res || jsonb_build_object('id', 'anon and service_role hold nothing', 'pass',
      pg_temp.c('anon', null, '(select count(*) from ws.organizations)')->>'code' = '42501'
      and pg_temp.c('anon', null, 'ws.me()')->>'code' = '42501'
      and pg_temp.c('anon', null, 'ws.auth_signin_lookup(''b1@probe.invalid'')')->>'code' = '42501'
      and pg_temp.c('service_role', null, 'ws.me()')->>'code' = '42501'
      and pg_temp.c('service_role', null, '(select count(*) from private.user_credentials)')->>'code' = '42501');
  else
    res := res || jsonb_build_object('id', 'anon and service_role hold nothing', 'pass', null, 'note', 'NOT TESTED — the executing role cannot act as anon / service_role');
  end if;
  res := res || jsonb_build_object('id', 'the planes cannot cross: propx_auth → member plane, user → sign-in plane, user → bootstrap', 'pass',
    pg_temp.c('propx_auth', null, 'ws.me()')->>'code' = '42501'
    and pg_temp.c('propx_auth', null, '(select count(*) from ws.users)')->>'code' = '42501'
    and pg_temp.c('authenticated', cA1, 'ws.auth_signin_lookup(''b1@probe.invalid'')')->>'code' = '42501'
    and pg_temp.c('authenticated', cA1, 'private.bootstrap(''x@probe.invalid'', ''x'', ''x'')')->>'code' = '42501');
  res := res || jsonb_build_object('id', 'role escalation refused: an analyst cannot promote itself or invite', 'pass',
    pg_temp.c('authenticated', cB2, format('ws.set_member_role(%L::uuid, %L::uuid, %L)', orgB, b2, 'owner'))->>'code' = '42501'
    and pg_temp.c('authenticated', cB2, format('ws.invite_member(%L::uuid, %L, %L, %L)', orgB, 'y@probe.invalid', 'viewer', pg_temp.h(pg_temp.tok())))->>'code' = '42501');
  res := res || jsonb_build_object('id', 'at least one OWNER: the last owner cannot step down or leave', 'pass',
    pg_temp.c('authenticated', cB1, format('ws.set_member_role(%L::uuid, %L::uuid, %L)', orgB, b1, 'admin'))->>'msg' = 'last_owner'
    and pg_temp.c('authenticated', cB1, format('ws.revoke_member(%L::uuid, %L::uuid)', orgB, b1))->>'msg' = 'last_owner');

  -- a stale inviter's link dies (security review HIGH): a1 joins B as admin, invites an analyst; b1 revokes a1
  t := pg_temp.tok(); r := pg_temp.c('authenticated', cB1, format('ws.invite_member(%L::uuid, %L, %L, %L)', orgB, 'a1@probe.invalid', 'admin', pg_temp.h(t)));
  r := pg_temp.c('authenticated', cA1, format('ws.accept_invitation(%L)', pg_temp.h(t)));
  res := res || jsonb_build_object('id', 'role escalation refused: an ADMIN cannot make itself or anyone an OWNER / ADMIN', 'pass',
    (r->>'ok')::boolean
    and pg_temp.c('authenticated', cA1, format('ws.set_member_role(%L::uuid, %L::uuid, %L)', orgB, a1, 'owner'))->>'code' = '42501'
    and pg_temp.c('authenticated', cA1, format('ws.invite_member(%L::uuid, %L, %L, %L)', orgB, 'z@probe.invalid', 'owner', pg_temp.h(pg_temp.tok())))->>'code' = '42501'
    and pg_temp.c('authenticated', cA1, format('ws.set_member_role(%L::uuid, %L::uuid, %L)', orgB, b1, 'viewer'))->>'code' = '42501');
  t := pg_temp.tok(); r := pg_temp.c('authenticated', cA1, format('ws.invite_member(%L::uuid, %L, %L, %L)', orgB, 'c1@probe.invalid', 'analyst', pg_temp.h(t)));
  r := pg_temp.c('authenticated', cB1, format('ws.revoke_member(%L::uuid, %L::uuid)', orgB, a1));
  res := res || jsonb_build_object('id', 'a removed inviter''s open link dies with their membership', 'pass',
    pg_temp.c('propx_auth', null, format('ws.auth_invite_peek(%L)', pg_temp.h(t)))->'v' = 'null'::jsonb
    and (select m.status from ws.organization_members m join ws.users u on u.id = m.user_id where m.org_id = orgB and u.email = 'c1@probe.invalid') = 'revoked');

  -- revocation is immediate
  r := pg_temp.c('authenticated', cB1, format('ws.revoke_member(%L::uuid, %L::uuid)', orgB, b2));
  res := res || jsonb_build_object('id', 'a revoked member loses access on the next call (same token)', 'pass',
    (r->>'ok')::boolean and pg_temp.c('authenticated', cB2, format('ws.org_members(%L::uuid)', orgB))->>'code' = '42501'
    and pg_temp.c('authenticated', cB2, format('(select count(*) from ws.organization_members where org_id = %L)', orgB))->'v' = '0'::jsonb);

  -- whatever code writes a row: no cross-organization attribution, nothing deleted
  begin
    insert into ws.organization_members (org_id, user_id, role, status, accepted_at, invited_by) values (orgA, b2, 'viewer', 'active', now(), b1);   -- b1 is no member of A
    res := res || jsonb_build_object('id', 'a cross-organization reference cannot be written (composite key)', 'pass', false);
  exception when others then
    res := res || jsonb_build_object('id', 'a cross-organization reference cannot be written (composite key)', 'pass', sqlstate = '23503', 'got', sqlstate);
  end;
  begin
    delete from ws.users;
    res := res || jsonb_build_object('id', 'nothing is deleted, even by the owning role', 'pass', false);
  exception when others then
    res := res || jsonb_build_object('id', 'nothing is deleted, even by the owning role', 'pass', sqlerrm like '%never deleted%');
  end;

  -- a check whose comparison came out NULL (an expected error that did not happen) is a FAILURE, never a pass; only a check
  -- marked NOT TESTED (with its reason) keeps a null
  res := (select jsonb_agg(case when x ? 'note' then x else jsonb_set(x, '{pass}', to_jsonb(coalesce((x->>'pass')::boolean, false))) end) from jsonb_array_elements(res) x);
  -- the end: everything above is rolled back
  raise exception 'PROBE_RESULT %', jsonb_build_object('roles', roles, 'results', res)::text;
end
$probe$;
