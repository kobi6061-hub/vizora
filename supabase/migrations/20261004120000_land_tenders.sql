-- PROPX · Land & Tender — the Israel Land Authority tenders, their lots and
-- winners, the plans they reference, and every change the source made.
--
-- Source: the Authority's tender site API (apps.land.gov.il/MichrazimSite/api;
-- lib/land/sources.js 'rmi:michrazim'). Written by scripts/land-sync.js
-- (lib/land/store.js · SupabaseLandStore) with the service-role key,
-- server-side. Rows are upserted on the Authority's MichrazID and never
-- deleted; a tender the list stops returning keeps its row with
-- in_latest_source = false.
--
-- Lifecycle stages are the Authority's status codes read through its own
-- code table: published ≠ open ≠ closed ≠ decided ≠ awarded. "awarded" needs
-- a lot with a winner name AND an award sum or a winning bid. Contract
-- signing, permits and construction starts are NOT in this source: there are
-- no columns for them on the tender; construction evidence lives only in the
-- record's `construction.links` (exact block/parcel joins to the MoCH
-- progress reports). Economics carry their basis (competitive bid total ·
-- ₪/m² bid under a ceiling · fixed-price allocation) and VAT is "not stated
-- by the source". Nothing here is an apartment-sale transaction.

-- ---------------------------------------------------------------- tenders
create table if not exists market.land_tenders (
  id                 text primary key,            -- 'rmi:<MichrazID>'
  michraz_id         integer not null unique,     -- the Authority's MichrazID
  name               text,                        -- MichrazName, e.g. '158/2026'
  status_code        integer,                     -- TableID 237, verbatim code
  lifecycle          text check (lifecycle in ('published','open','closed','lottery-pending','decided','awarded','decided-no-award','frozen','cancelled')),
  award_scope        text check (award_scope in ('all-lots','some-lots')),
  type_code          integer,                     -- TableID 215 (marketing method)
  purpose_code       integer,                     -- TableID -1 (purpose)
  track              text check (track in ('open-market','subsidized','rental','special-population','residential-lottery','lottery','mixed-use','commercial-other','unknown')),
                                                  -- 'lottery': a lottery / priority type whose population list (in the detail) has not been read yet
  region_code        integer,
  locality_code      integer,                     -- CBS semel yeshuv (KodYeshuv)
  neighborhood       text,                        -- as published; never assigned by PROPX
  units              integer,                     -- YechidotDiur, when > 0
  published_date     date,
  open_date          date,
  close_date         date,
  committee_date     date,
  lottery_date       date,
  price_basis        text check (price_basis in ('competitive-bid','price-per-sqm-bid','fixed-price-allocation','unknown')),
  lots               integer,                     -- null: detail not read yet
  awarded_lots       integer,
  awarded_units      integer,
  awarded_land_total numeric,                     -- Σ winning sums over awarded lots (competitive / fixed basis only)
  land_per_unit      numeric,                     -- awarded_land_total / awarded_units, same lots
  lat                double precision,            -- tender polygon centroid (exact ITM → WGS84); null = locality-level presentation
  lng                double precision,
  geo_basis          text check (geo_basis in ('tender-polygon-centroid','locality')),
  detail_level       text not null check (detail_level in ('list','detail')),
  detail_fetched_at  timestamptz,
  first_seen_at      timestamptz not null,
  last_seen_at       timestamptz not null,
  in_latest_source   boolean not null default true,
  provenance         jsonb not null,
  record             jsonb not null               -- the full normalized record (lots, bids, winners, parcels, plans, economics, construction links)
);
create index if not exists land_tenders_locality_date on market.land_tenders (locality_code, published_date desc);
create index if not exists land_tenders_lifecycle on market.land_tenders (lifecycle);
create index if not exists land_tenders_close on market.land_tenders (close_date desc);

-- ---------------------------------------------------------------- lots (one row per Tik)
create table if not exists market.land_lots (
  tender_id          text not null references market.land_tenders(id),
  lot_id             text not null,               -- the Authority's TikID
  name               text,
  area_sqm           numeric,
  units              integer,
  development_cost   numeric,
  minimum_price      numeric,                     -- null when the minimum is the ₪1 token
  appraisal          numeric,
  ceiling_per_sqm    numeric,
  winner_name        text,                        -- only with evidence (winner_evidence)
  winner_amount      numeric,
  winner_evidence    text,
  bids               integer not null default 0,
  price_basis        text,
  land_per_unit      numeric,
  source_note        text,                        -- a note the source wrote into the winner column
  record             jsonb not null,
  primary key (tender_id, lot_id)
);
create index if not exists land_lots_winner on market.land_lots (winner_name);

-- ---------------------------------------------------------------- history
create table if not exists market.land_tender_history (
  id           bigint generated always as identity primary key,
  record_id    text not null references market.land_tenders(id),
  field        text not null,
  from_value   jsonb,
  to_value     jsonb,
  observed_at  timestamptz not null,
  run_key      text,
  unique (record_id, field, observed_at, run_key)
);
create index if not exists land_tender_history_record on market.land_tender_history (record_id, observed_at desc);

-- ---------------------------------------------------------------- plans (exact plan-number joins)
create table if not exists market.land_plans (
  plan_key         text not null,                 -- the plan number with whitespace removed
  plan_number      text not null,
  source_id        text not null,                 -- 'iplan:xplan' | 'datagov:rmi:planning-inventory'
  station          text,
  approved_units   numeric,                       -- xplan pq_authorised_quantity_120
  approval_date    date,
  potential_units  numeric,                       -- inventory "יחד פוטנציאל לשיווק" (STATE LAND ONLY, dated as_of)
  as_of            date,
  record           jsonb not null,
  primary key (plan_key, source_id)
);

-- ---------------------------------------------------------------- winners (derived view: observed public tender wins)
create or replace view market.land_winners with (security_invoker = true) as
select
  l.winner_name,
  count(*)                                   as lots_won,
  count(distinct l.tender_id)                as tenders_won,
  sum(l.units)                               as units_in_lots_won,
  sum(l.winner_amount) filter (where l.price_basis in ('competitive-bid','fixed-price-allocation')) as land_total_competitive,
  min(t.committee_date)                      as first_win_date,
  max(t.committee_date)                      as last_win_date
from market.land_lots l
join market.land_tenders t on t.id = l.tender_id
where l.winner_name is not null
group by l.winner_name;

alter table market.land_tenders        enable row level security;
alter table market.land_lots           enable row level security;
alter table market.land_tender_history enable row level security;
alter table market.land_plans          enable row level security;
revoke all on market.land_tenders, market.land_lots, market.land_tender_history, market.land_plans, market.land_winners from anon, authenticated;
grant select, insert, update on market.land_tenders, market.land_lots, market.land_tender_history, market.land_plans to service_role;
grant select on market.land_winners to service_role;
-- no anon/authenticated policies: read through the session-gated server API.
