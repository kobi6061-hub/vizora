-- PROPX · government (subsidized) housing — normalized lottery records.
--
-- Source: data.gov.il, Ministry of Construction and Housing, resource
-- 7c8255d0-49ef-49db-8904-4cf917586031 ("מעקב אחר הגרלות דירה בהנחה"): one
-- row per lottery of the מחיר למשתכן / מחיר מטרה programs. Written by
-- scripts/housing-sync.js (lib/housing/store.js · SupabaseHousingStore) with
-- the service-role key, server-side. Rows are upserted on the official
-- LotteryId and never deleted; a lottery the source stops listing keeps its
-- row with in_latest_source = false.
--
-- The quantities keep the source's own meanings and are never summed into
-- one another:  units_in_lottery ≠ winners ≠ signed sales ≠ available
-- inventory. This source publishes no signed sales, no available inventory,
-- no construction start / completion and no coordinates — there are no
-- columns for them here, so nothing can be filled in by mistake.

-- ---------------------------------------------------------------- lotteries
create table if not exists market.housing_lotteries (
  id                       text primary key,         -- 'lottery:<LotteryId>'
  lottery_id               integer not null unique,  -- the source's LotteryId
  project_id               integer not null,         -- the source's ProjectId
  parent_lottery_id        integer,
  continuation_lottery_id  integer,
  lottery_type             text check (lottery_type in ('first','continuation')),
  round                    text,                     -- CentralizationType, verbatim
  program                  text,                     -- 'mechir-lamishtaken' | 'mechir-matara' | 'dira-behanacha' | 'other'
  program_he               text,                     -- MarketingMethodDesc, verbatim
  marketing_method_code    text,
  marketing_body           text,                     -- 'moch' | 'rmi' | 'other'
  eligibility              text,
  lottery_status           text,                     -- LotteryStatusValue, verbatim
  signup_end_date          date,
  lottery_date             date,
  locality_code            integer not null,         -- CBS semel yeshuv (LamasCode)
  city                     text,
  neighborhood             text,                     -- as published; never assigned by PROPX
  project_name             text,
  developer                text,
  project_status           text,                     -- ProjectStatus, verbatim (the ministry's process stage)
  permit_status            text,                     -- ConstructionPermitName, verbatim
  price_per_sqm            numeric,                  -- official price per m²; null when blank or 0
  units_in_lottery         integer,
  units_at_signup          integer,
  units_local_residents    integer,
  applicants               integer,
  winners                  integer,
  first_seen_at            timestamptz not null,     -- first observed by PROPX
  last_seen_at             timestamptz not null,     -- last fetch whose content contained it
  in_latest_source         boolean not null default true,
  provenance               jsonb not null,           -- source, resource, row id, snapshot hash, fetched_at
  record                   jsonb not null            -- the full normalized record (every official field)
);
create index if not exists housing_lotteries_locality_date on market.housing_lotteries (locality_code, lottery_date desc);
create index if not exists housing_lotteries_project on market.housing_lotteries (project_id);
create index if not exists housing_lotteries_date on market.housing_lotteries (lottery_date desc);

-- ---------------------------------------------------------------- status history
-- every change the SOURCE made to a lottery after PROPX first saw it (status,
-- permit, units, winners, price, dates …), and every disappearance/return
create table if not exists market.housing_status_history (
  id           bigint generated always as identity primary key,
  record_id    text not null references market.housing_lotteries(id),
  field        text not null,
  from_value   jsonb,
  to_value     jsonb,
  observed_at  timestamptz not null,
  sync_run_id  text
);
create index if not exists housing_status_history_record on market.housing_status_history (record_id, observed_at desc);

-- ---------------------------------------------------------------- projects (derived, never stored twice)
-- a project = every lottery that carries its official ProjectId. Units are
-- counted over FIRST lotteries only: a continuation lottery re-offers units of
-- its project's first lottery, so adding them would double-count.
create or replace view market.housing_projects with (security_invoker = true) as
select
  project_id,
  min(project_name)                                         as project_name,
  min(city)                                                 as city,
  min(locality_code)                                        as locality_code,
  min(neighborhood)                                         as neighborhood,
  min(developer)                                            as developer,
  count(*)                                                  as lotteries,
  count(*) filter (where lottery_type = 'first')            as first_lotteries,
  sum(units_in_lottery) filter (where lottery_type = 'first') as units_first_lotteries,
  sum(winners)                                              as winners_all_lotteries,
  min(lottery_date)                                         as first_lottery_date,
  max(lottery_date)                                         as last_lottery_date,
  bool_or(in_latest_source)                                 as in_latest_source
from market.housing_lotteries
group by project_id;

-- ---------------------------------------------------------------- provenance (per record)
create or replace view market.housing_provenance with (security_invoker = true) as
select
  id,
  provenance->>'source'          as source_id,
  provenance->>'resourceId'      as resource_id,
  provenance->>'sourceRecordId'  as source_record_id,
  provenance->>'sourceRowId'     as source_row_id,
  provenance->>'snapshotHash'    as snapshot_hash,
  (provenance->>'fetchedAt')::timestamptz        as fetched_at,
  (provenance->>'sourceUpdatedAt')::timestamptz  as source_updated_at,
  provenance->>'retrievalMethod' as retrieval_method
from market.housing_lotteries;

alter table market.housing_lotteries      enable row level security;
alter table market.housing_status_history enable row level security;
-- the views run with the caller's rights (security_invoker) and are revoked
-- from the API roles; only the server-side service role reads or writes
revoke all on market.housing_lotteries, market.housing_status_history,
  market.housing_projects, market.housing_provenance from anon, authenticated;
grant select, insert, update on market.housing_lotteries, market.housing_status_history to service_role;
grant select on market.housing_projects, market.housing_provenance to service_role;
-- no anon/authenticated policies: read through the session-gated server API.
