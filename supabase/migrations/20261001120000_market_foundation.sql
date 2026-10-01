-- PROPX · market-data foundation (public market truth).
--
-- RAW OFFICIAL DATA → NORMALIZED ENTITIES → TIME-SERIES / SNAPSHOTS → DERIVED
-- METRICS → PRODUCT UI. Nothing here is user-specific (that lives in the
-- separate user_state schema) and nothing is ever synthesized: every row
-- carries its source, the source's own record id, when PROPX fetched it and
-- the raw snapshot it came from. Rows are upserted on stable official ids and
-- never deleted because a later source response omitted them.
--
-- Target: the dedicated PROPX Supabase project only (never another product's
-- database). The sync job writes with the service-role key, server-side.

create schema if not exists market;

-- ---------------------------------------------------------------- sources
create table if not exists market.sources (
  id                 text primary key,              -- e.g. 'datagov:moch:dira-lotteries'
  authority          text not null,                 -- e.g. 'משרד הבינוי והשיכון'
  dataset            text not null,                 -- dataset name/title at the authority
  endpoint           text not null,                 -- API / file URL actually used
  format             text not null,                 -- 'ckan-datastore' | 'csv' | 'xlsx' | 'json-api' …
  source_class       text not null check (source_class in
                       ('CONFIRMED_STRUCTURED','OFFICIAL_FILE','OFFICIAL_PAGE','UNVERIFIED','UNUSABLE')),
  update_cadence     text,                          -- as stated by the source, if stated
  last_source_update timestamptz,                   -- the source's own last-modified time
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------- sync runs
create table if not exists market.sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  source_id          text not null references market.sources(id),
  started_at         timestamptz not null,
  finished_at        timestamptz,
  status             text not null check (status in ('running','ok','partial','failed')),
  rows_fetched       integer not null default 0,
  rows_inserted      integer not null default 0,
  rows_updated       integer not null default 0,
  rows_unchanged     integer not null default 0,
  rows_rejected      integer not null default 0,
  window_from        date,                          -- re-check window (rolling backfill)
  window_to          date,
  source_updated_at  timestamptz,
  snapshot_hash      text,
  error              text,
  details            jsonb not null default '{}'::jsonb
);
create index if not exists sync_runs_source_started on market.sync_runs (source_id, started_at desc);

-- ---------------------------------------------------------------- raw snapshots
-- one row per distinct content (hash-change detection): the raw official
-- payload exactly as received, so every normalized value can be traced back
create table if not exists market.raw_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  source_id          text not null references market.sources(id),
  content_hash       text not null,
  fetched_at         timestamptz not null,
  source_updated_at  timestamptz,
  row_count          integer not null,
  payload            jsonb not null,
  sync_run_id        uuid references market.sync_runs(id),
  unique (source_id, content_hash)
);

-- ---------------------------------------------------------------- geography links
-- an official record linked to the canonical PROPX registry (lib/geo): only
-- by an official code or an exact registry name match — never guessed
create table if not exists market.geo_links (
  source_id          text not null,
  source_record_id   text not null,
  locality_code      integer,                       -- CBS semel yeshuv
  neighborhood       text,                          -- as published by the source
  street             text,
  lat                double precision,              -- only when the source publishes coordinates
  lng                double precision,
  method             text not null check (method in ('official-code','registry-name','source-coordinates')),
  linked_at          timestamptz not null default now(),
  primary key (source_id, source_record_id)
);

-- ---------------------------------------------------------------- transactions
-- every observed official transaction; first_seen_at records when PROPX first
-- saw it (late reporting is measured from transaction_date → first_seen_at)
create table if not exists market.transactions (
  source_id          text not null,
  record_key         text not null,                 -- 'id:<official id>' or 'fp:<fingerprint>#<ordinal>'
  source_record_id   text,                          -- the official transaction id, when the source has one
  fingerprint        text,
  ordinal            integer,                       -- k-th identical id-less row in one source response
  transaction_date   date not null,
  first_seen_at      timestamptz not null,
  last_seen_at       timestamptz not null,
  source_published_at timestamptz,                  -- only if the source states it
  city               text,
  street             text,
  house_number       text,
  block              text,
  parcel             text,
  sub_parcel         text,
  price              numeric,
  area_sqm           numeric,
  rooms              numeric,
  floor              text,
  deal_type          text,                          -- the source's own classification, verbatim
  newness            text,
  content_hash       text not null,                 -- facts only: a change means the SOURCE changed the row
  provenance         jsonb not null,
  raw                jsonb not null,
  primary key (source_id, record_key)
);
create index if not exists transactions_city_date on market.transactions (city, transaction_date desc);
create index if not exists transactions_first_seen on market.transactions (first_seen_at desc);

alter table market.sources        enable row level security;
alter table market.sync_runs      enable row level security;
alter table market.raw_snapshots  enable row level security;
alter table market.geo_links      enable row level security;
alter table market.transactions   enable row level security;
-- no anon/authenticated policies: the site reads through its own
-- session-gated server API with the service role; nothing is public.

-- privileges: the server-side sync job and API use the service role only.
-- Nothing in this schema is granted to anon/authenticated (and the schema is
-- exposed to the Data API only so the service role can reach it).
grant usage on schema market to service_role;
grant select, insert, update on all tables in schema market to service_role;
grant usage, select on all sequences in schema market to service_role;
alter default privileges in schema market grant select, insert, update on tables to service_role;
alter default privileges in schema market grant usage, select on sequences to service_role;
revoke all on all tables in schema market from anon, authenticated;
alter default privileges in schema market revoke all on tables from anon, authenticated;
