-- PROPX · store integrity under repair and concurrency.
--
-- 1 · A housing status-history event is stored once. The sync re-posts the
--     whole history when the project holds a different number of events than
--     PROPX (a failed write, a first seeding); the unique key makes that
--     idempotent (PostgREST on_conflict + ignore-duplicates).
-- 2 · A transaction's first sighting is the EARLIEST one, whatever order
--     concurrent writers commit in (the GitHub job and the server-side job can
--     overlap): an update never moves first_seen_at later (the area and run of
--     the earliest sighting travel with it), and a write observed before what
--     is stored (an older last_seen_at) does not roll the row back.

create unique index if not exists housing_status_history_event
  on market.housing_status_history (record_id, field, observed_at, run_key) nulls not distinct;

create or replace function market.keep_first_sighting() returns trigger
language plpgsql set search_path = '' as $$
declare fs timestamptz; ft text; fr text;
begin
  -- a write observed BEFORE what is stored (a slower concurrent writer) changes nothing,
  -- except that an earlier first sighting it carries is kept
  if old.last_seen_at is not null and new.last_seen_at is not null and new.last_seen_at < old.last_seen_at then
    fs := old.first_seen_at; ft := old.first_seen_target; fr := old.first_seen_run;
    if new.first_seen_at is not null and (fs is null or new.first_seen_at < fs) then
      fs := new.first_seen_at; ft := new.first_seen_target; fr := new.first_seen_run;
    end if;
    new := old;
    new.first_seen_at := fs; new.first_seen_target := ft; new.first_seen_run := fr;
    return new;
  end if;
  -- an ordinary later write: the first sighting never moves later
  if old.first_seen_at is not null and (new.first_seen_at is null or old.first_seen_at <= new.first_seen_at) then
    new.first_seen_at := old.first_seen_at;
    new.first_seen_target := coalesce(old.first_seen_target, new.first_seen_target);
    new.first_seen_run := coalesce(old.first_seen_run, new.first_seen_run);
  end if;
  return new;
end $$;
revoke all on function market.keep_first_sighting() from public, anon, authenticated;

drop trigger if exists transactions_keep_first_sighting on market.transactions;
create trigger transactions_keep_first_sighting before update on market.transactions
  for each row execute function market.keep_first_sighting();
