# KobiX RealEstate — Israeli Market Intelligence (private)

Production-ready Vercel project for the KobiX new-homes intelligence platform.
Password-protected server-side; internal use only.

## What's in here

| File | Role |
|---|---|
| `index.html` | The entire application (single file): dashboard, map, drill hierarchy, filters, compare, insights, provenance, HE/EN, light/dark |
| `login.html` | Access screen (posts to `/api/login`; no password in client code) |
| `middleware.js` | Vercel Edge Middleware — verifies the signed `kobix_session` cookie on every request, otherwise redirects to `/login.html` |
| `api/login.js` | Checks `SITE_PASSWORD` (env), sets a 12-hour HMAC-signed HttpOnly cookie |
| `api/logout.js` | Clears the session |
| `vercel.json` | `noindex` + security headers, `no-store` on the app |
| `robots.txt` | Disallow all |

## Deploy (Vercel)

1. vercel.com → **Add New… → Project** → import `kobi6061-hub/vizora`
2. **Root Directory:** leave EMPTY (the repo root is the project) · Framework preset: **Other** · no build command
3. **Environment variables** (Project → Settings → Environment Variables):
   - `SITE_PASSWORD` — the access password you choose
   - `SESSION_SECRET` — random string, e.g. output of `openssl rand -hex 32`
4. Deploy. Custom domain: Project → Settings → Domains → add `kobix.online`.

With `SITE_PASSWORD` unset, login always fails (the site stays closed) — set both vars before sharing the URL.

CLI alternative: `npx vercel --prod` from the repo root (after `vercel login`), then
`npx vercel env add SITE_PASSWORD` / `SESSION_SECRET` and redeploy.

## Local development

```bash
SITE_PASSWORD=<your-password> SESSION_SECRET=dev PORT=3200 \
  node scripts/kobix-dev-server.mjs
```

## Data

All figures are calibrated to official Israeli publications (CBS, Tax Authority,
Chief Economist, Bank of Israel) as of the retrieval date shown in the in-app
market tape; every metric carries provenance (official / derived / estimate)
surfaced via the "מקור הנתון" panel. Neighborhood rows are labeled relative
estimates. The recent-sales table shows official government transactions only.

### Data integrity

Every figure on screen carries a class plus the period it describes:
רשמי (official — only values whose source, period and check time are stored,
today the daily-synced CBS/Bank of Israel indicators), סטטי (static — typed in
from a cited, dated publication), נגזר (derived), מודל (modelled) or לא זמין
(unavailable). Nothing generated is presented as observed: there are no
synthetic street transactions, no generated price history, no invented medians
and no sample-size "confidence". Places are never ranked (#1/#2/#3, "leader",
value sort) unless every ranked value is official — with one labelled
exception, the capital section below.

The capital module (L4 · הון — "where should I deploy my capital?") is an
investment MODEL over the classified board data and the investor's own,
visible and editable assumptions: equity capital ₪5M–₪100M, strategy, horizon,
leverage, rate, term, a Conservative / Base / Upside appreciation
assumption (no approximate price history is read) and a rent-growth
assumption (default: each area's own last 1-year change). It shows a six-factor model
score, a MODEL RANKING (דירוג מודל) that stays inside the section, per-area
analysis (price targets, the price that meets a required IRR, bulk, scenarios,
exit, refinance) and an equity-based portfolio allocation: debt, purchase tax
and acquisition costs are accounted for, so the portfolio answers "with ₪X of
equity at Y% leverage, what can I acquire?". Every return is a true IRR from the
deal calculator's engine. Each area's data basis is the class of its inputs
(never the historical o-flags). The ranking's outside surfaces — command-bar
signal, map layer, gold markers, profile shortcut, insights teaser — stay off
(`CI_EXTERNAL=false`).

The deal calculator (מחשבון עסקה · Deal Lab — "does this specific deal work?")
is separate from that model: every input is the investor's own assumption, an
empty field leaves every result that needs it unavailable, and no appreciation
or rent growth is ever assumed.

`node test/integrity.test.js`, `node test/capital.test.js` and
`node test/calculator.test.js` enforce this; they run with the other offline
suites in the daily workflow.

The offline build (`scripts/build-standalone.py` → `standalone/`) embeds no
password or credential: the repository is public, so a client-side gate could
only leak one. Production access is the server-side gate alone.

### Daily official-indicator sync

The Bank of Israel rate and the CBS new-homes price index are re-checked every
day by `.github/workflows/market-sync.yml` (`scripts/market-sync.js`), committed
to `data/market/`, and loaded by the page — see `lib/market/README.md`.

### Government (subsidized) housing — דיור מסובסד

The section `#housing` (מחיר למשתכן · מחיר מטרה · דירה בהנחה) shows the
official lottery records of the Ministry of Construction and Housing
(data.gov.il, resource `7c8255d0…`): filters (locality, neighborhood, program,
developer, process stage, permit status, lottery type, free text), periods (last
6 / 12 / 24 months, all source records, custom range), DERIVED KPIs over the OFFICIAL
rows, activity over time, a country → locality → neighborhood → project
drill-down, a paginated table and a per-lottery drawer with the project's
lotteries, the observed change history and full provenance.

Lottery units, units marketed at signup, registrations and winners are shown
separately and never relabelled; a winner is not a buyer. The source publishes
no signed sales, available inventory, construction start/completion or
coordinates — those show "—" (nothing is inferred, nothing is placed on the
map), and the subsidized share of unsold inventory is "—" because no official
join exists.

The section keeps four dates apart: when the source last re-published its file
(16.08.2026 — an automated weekly upload), the newest lottery that file contains
(27.01.2025), when PROPX last checked it, and how much of the selected period
the source covers. A period after the newest lottery shows "—", never 0. The
source does not say whether it lists every lottery of its range, so its widest
period is "all source records", not "all history". A 2026 source-completeness
audit found no successor or parallel official dataset with later lotteries
(`lib/housing/README.md`).

The page reads `GET /api/housing?view=…` (session-gated, one summary and one
page of rows at a time), served from the store of record (below). Details:
`lib/housing/README.md`; tests: `node test/housing.test.js`.

### Transaction freshness

Deals reach the official source after they happen, so recent periods are
never treated as closed: the deals section states this and marks the last
`TX_MATURITY_DAYS` (120) as "מתעדכן / Still updating" and older dates as
"תקופה היסטורית / Historical period" — a reporting-lag notion, not
confidence; no reporting delay is claimed until PROPX has measured one. The
scheduled refresh re-checks the same 120-day window and upserts into the
transaction ledger (`lib/gov/ledger.js`, `scripts/tx-sync.js`): first_seen_at is
kept, earlier versions are kept as revisions, nothing is deleted, legitimate
identical deals stay separate, and each run records whether the window was
re-checked completely (`lib/gov/README.md`). The transaction source currently
refuses the GitHub runner (HTTP 403); the run records that and stores nothing.
It is never worked around. The same refresh can run inside PROPX's own Vercel
runtime (`api/jobs/tx-refresh.js`, token-protected, called by
`.github/workflows/tx-refresh.yml`) once its token and the Supabase project are
configured. A probe shows whether the source accepts that runtime. Until then
no continuous refresh is claimed.

### Where the data lives (source of truth)

Git snapshots are not the long-term primary database. The store of record is
the dedicated PROPX Supabase project (`supabase/README.md`); the git snapshot
bundled with each deployment is the fallback and the audit trail.

| Data | Store of record | Fallback / trail | What the app reads first | Recovery |
| --- | --- | --- | --- | --- |
| Government housing lotteries (+ status history, raw payloads, sync runs) | Supabase `market.housing_*`, `raw_snapshots`, `sync_runs` | `data/housing/` (written by the same sync, bundled with the deployment) | `api/housing.js`: Supabase, when the store is whole and not behind the bundled snapshot; otherwise the bundled files. `freshness.store` / `storeReason` name the store that answered | every sync writes both. A store with a different record count, or whose last run was of other content, is rewritten whole on the next sync. A store that is behind is never served |
| Transactions (ledger, first sightings, revisions, run coverage) | Supabase `market.transactions`, `sync_runs` | `data/transactions/ledger/` (GitHub job without Supabase) · `data/transactions/sync-runs.jsonl` | the deals section asks the official source live, server-side. The ledger feeds the reporting-lag foundation and is not shown on the page | idempotent upserts; nothing deleted; `first_seen_at` never rewritten |
| Official market indicators | `data/market/` (git, daily) | — | the page loads it | the next daily run |
| Geography registry | `data/geo/` (git, built by `scripts/build-geo-registry.py`) | — | `api/geo/search.js` | rebuild from the official registries |
| User state | Supabase `user_state` (reserved, unused) | — | — | — |

Until the Supabase project is configured, every row of this table runs on its
fallback. The answers say so (`freshness.store: "git"`).

Missing factual values everywhere in the app read "—"; the class of such a
value is MISSING (חסר).
