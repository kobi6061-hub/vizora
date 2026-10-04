# PROPX Supabase project — setup and verification

PROPX's long-term store of record is **one dedicated Supabase project for
PROPX**. Never point it at another product's database (OSALE or any other),
another person's project or a temporary database. The repository holds the
schema (`migrations/`) and the code; the project, its keys and its data live
outside the repository.

| Migration | What it creates |
| --- | --- |
| `20261001120000_market_foundation.sql` | schema `market`: `sources`, `sync_runs`, `raw_snapshots`, `geo_links`, `transactions`; RLS on, service role only |
| `20261001120100_housing.sql` | `housing_lotteries`, `housing_status_history`, views `housing_projects`, `housing_provenance` |
| `20261004120000_land_tenders.sql` | `land_tenders`, `land_lots`, `land_tender_history`, `land_plans`, view `land_winners` (Land & Tender Intelligence; written by `land-sync.yml`) |
| `20261001120200_user_state.sql` | schema `user_state` (profiles, watchlists, saved filters, capital scenarios, alerts) — separate from market data |
| `20261001120300_tx_refresh_coverage.sql` | `sync_runs.target` / `window_check` / status `refused`; `transactions.first_seen_target` / `first_seen_run`; view `transaction_reporting_lag` |
| `20261001120400_store_integrity.sql` | a status-history event is stored once (unique key — the sync's history repair is idempotent); a trigger keeps a transaction's earliest first sighting whatever order concurrent writers commit in |

The five files apply cleanly in order, and a second application changes
nothing. RLS is on for every `market` table, only `service_role` holds grants,
and `anon` is refused at the schema. The trigger keeps the earliest sighting in
both commit orders, and duplicate history events are stored once. All of this
was checked on a throwaway local PostgreSQL 16, not on Supabase.

## Activation — what only the project owner can do

1. **Create the project** (Supabase dashboard → New project), dedicated to
   PROPX. A region near Israel, e.g. Frankfurt (eu-central-1), is a sensible
   choice.
2. **Apply the migrations**, in order, with either:
   ```bash
   supabase link --project-ref <project-ref> && supabase db push
   # or, with the database connection string (Settings → Database), used once and never stored:
   for f in supabase/migrations/*.sql; do psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"; done
   ```
3. **Expose the `market` schema** to the Data API (Settings → Data API →
   Exposed schemas → add `market`). The grants keep it service-role only.
   Leave `user_state` unexposed until user features exist.
4. **Set the secrets** (values never go in the repository, the page or a log):

   | Name | Where | Used by |
   | --- | --- | --- |
   | `SUPABASE_URL` (`https://<project>.supabase.co` — anything else is rejected as `store-misconfigured`) | GitHub → Settings → Secrets and variables → Actions → *secret*, **and** Vercel → Project → Settings → Environment Variables (Production) | sync writes (`data-sync.yml`), verification, `api/housing.js` reads, `api/jobs/tx-refresh.js` |
   | `SUPABASE_SERVICE_ROLE_KEY` | the same two places (server-side only — never a `NEXT_PUBLIC_*` / client variable) | the same |
   | `SUPABASE_ANON_KEY` | GitHub secret (optional) | the verification proves the anon key is refused |
   | `PROPX_JOB_TOKEN` | Vercel env **and** GitHub secret, the same random value (`openssl rand -hex 32`) | the server-side transaction refresh |
   | `PROPX_BASE_URL` | GitHub → Actions → *secret* (the production URL; a secret, so the public logs never show it) | `tx-refresh.yml` |

   Redeploy on Vercel after adding environment variables.
5. **Verify**:
   - Actions → **Supabase — verify the PROPX project** → Run workflow. It first
     confirms that the live source still equals the committed snapshot (if not,
     it stops: let `data-sync.yml` commit the change first). Then it runs a
     sync and `scripts/supabase-verify.js` (schema, access, counts taken from
     `data/housing/`, the stored snapshot and its raw payload), a second sync,
     and a check that the unchanged content added nothing.
     Locally:
     `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/supabase-verify.js`.
   - Actions → **Transactions — server-side refresh** → `mode: probe`. This
     shows whether the official source accepts the Vercel runtime. Then use
     `mode: run`; the daily schedule uses run.
   - Signed in to the site, `/api/housing?view=status` → `freshness.store` is
     `"supabase"`. If it shows `"git"`, `storeReason` says why.

Until these steps are done, the sync keeps writing the git snapshot
(`data/housing/`), the housing API serves it and says so
(`freshness.store: "git"`, `storeReason: "store-not-configured"`), and the
server-side transaction job answers `503`. No local substitute stands in for
the project.
