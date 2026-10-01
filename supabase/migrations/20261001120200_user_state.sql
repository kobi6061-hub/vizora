-- PROPX · user-specific state — kept apart from market truth.
--
-- Foundation only: no feature reads these tables yet and GH-1 does not depend
-- on authentication. Saved places, projects, filters, Capital scenarios,
-- alerts and preferences will live here once accounts exist; market tables
-- (schema "market") never reference a user, and these never hold market data.

create schema if not exists user_state;

create table if not exists user_state.profiles (
  user_id            uuid primary key,              -- auth.users.id once accounts exist
  created_at         timestamptz not null default now(),
  locale             text check (locale in ('he','en')),
  theme              text check (theme in ('light','dark','system'))
);

create table if not exists user_state.watchlist_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references user_state.profiles(user_id) on delete cascade,
  kind               text not null check (kind in ('city','neighborhood','street','project')),
  ref                text not null,                 -- registry id / official record key
  created_at         timestamptz not null default now(),
  unique (user_id, kind, ref)
);

create table if not exists user_state.saved_filters (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references user_state.profiles(user_id) on delete cascade,
  surface            text not null,                 -- e.g. 'housing', 'transactions'
  name               text not null,
  filters            jsonb not null,
  created_at         timestamptz not null default now()
);

create table if not exists user_state.capital_scenarios (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references user_state.profiles(user_id) on delete cascade,
  name               text not null,
  assumptions        jsonb not null,                -- the investor's own inputs (USER ASSUMPTION)
  created_at         timestamptz not null default now()
);

create table if not exists user_state.alerts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references user_state.profiles(user_id) on delete cascade,
  kind               text not null,
  params             jsonb not null,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

alter table user_state.profiles          enable row level security;
alter table user_state.watchlist_items   enable row level security;
alter table user_state.saved_filters     enable row level security;
alter table user_state.capital_scenarios enable row level security;
alter table user_state.alerts            enable row level security;
-- per-user policies (user_id = auth.uid()) are added together with accounts.
