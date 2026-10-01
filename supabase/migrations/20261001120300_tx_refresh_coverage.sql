-- PROPX · transaction refresh coverage + the reporting-lag foundation.
--
-- 1 · a sync run records WHICH area it re-checked and whether its rolling window
--     was really covered (lib/gov/tx-refresh.js): complete only when the sweep
--     proves it; partial (polygon cap, time budget, page limit, failed
--     requests), unknown (no diagnostics) or not-checked (refused, timeout,
--     failed, skipped) otherwise. A source refusal is its own status.
-- 2 · a transaction keeps the area and run that first saw it, next to
--     first_seen_at (set once, never rewritten).
-- 3 · market.transaction_reporting_lag: per deal, the most its reporting lag
--     can be, and whether that lag is OBSERVABLE — only when a complete check of
--     the same area covered the deal's date before PROPX first saw it. Deals of
--     the first backfill are censored. No average is computed or published here.

alter table market.sync_runs drop constraint if exists sync_runs_status_check;
alter table market.sync_runs add constraint sync_runs_status_check
  check (status in ('running','ok','partial','failed','refused'));
alter table market.sync_runs add column if not exists target text;
alter table market.sync_runs add column if not exists window_check text
  check (window_check in ('complete','partial','unknown','not-checked'));
create index if not exists sync_runs_target_window on market.sync_runs (source_id, target, finished_at)
  where window_check = 'complete';

alter table market.transactions add column if not exists first_seen_target text;
alter table market.transactions add column if not exists first_seen_run text;

create or replace view market.transaction_reporting_lag with (security_invoker = true) as
select t.source_id,
       t.record_key,
       t.transaction_date,
       t.first_seen_at,
       t.first_seen_target,
       (t.first_seen_at at time zone 'UTC')::date - t.transaction_date as lag_days_at_most,
       exists (
         select 1 from market.sync_runs r
          where r.source_id = t.source_id
            and r.target = t.first_seen_target
            and r.status = 'ok' and r.window_check = 'complete'
            and r.finished_at < t.first_seen_at
            and t.transaction_date between r.window_from and r.window_to
       ) as observable
  from market.transactions t;

revoke all on market.transaction_reporting_lag from anon, authenticated;
grant select on market.transaction_reporting_lag to service_role;
