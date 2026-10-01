# PROPX · Government Real Estate Data Layer

Government data as a **canonical PROPX source** — retrieved from primary
government endpoints, normalized into one internal schema, stored with full
provenance, and consumed by analytics through a single service. No consumer
real-estate sites in the data path.

```
PROPX analytics ──▶ GovDataService (lib/gov/service.js)
                        │  routing · geographic fallback ladder · dedup
                        │  newness partition · snapshots · error surfacing
        ┌───────────────┼──────────────────┐
        ▼               ▼                  ▼
 TaxAuthorityProvider  DataGovProvider   CbsProvider     ← GovernmentRealEstateProvider
 (nadlan/KARMAN —      (data.gov.il      (api.cbs.gov.il  (lib/gov/providers/base.js)
  transactions,         registries:       official price-
  cadastre; transport   cities+streets)   index API)
  awaits authorized
  connector)
```

## The provider contract

Every source implements `GovernmentRealEstateProvider`:

`searchLocation(query)` · `resolveAddress(city, street, houseNumber)` ·
`resolveBlockParcel(address)` · `getTransactions(location, filters)` ·
`getStreetTransactions(street)` · `getNearbyTransactions(lat, lng, radiusM)` ·
`getMarketTrends(location)` · `getGovernmentMarketSummary(location)`

A provider declares what it serves via `capabilities()`; anything it cannot
serve fails with `GovSourceUnavailableError` carrying a human-actionable
reason. Adding a source = writing one provider and registering it in
`createDefaultService` — the analytics layer never changes.

## Canonical transaction schema (`schema.js`)

date, price, price/m², area, rooms, floor, floors-in-building, year built,
city, street, house number, block (גוש), parcel (חלקה), sub-parcel,
coordinates, government transaction id, deal type, newness + evidence — plus
mandatory provenance `{source, sourceUrl, sourceTimestamp, retrievedAt, raw}`.

Hard rules, enforced by code and tests:

- a field the source did not supply stays `null` and is listed in `missing`;
- a derived value is wrapped `{value, estimated:true, method}` — never a bare
  number (e.g. price/m² computed from price÷area);
- fixture/sample rows carry `provenance.sample:true` and can never
  masquerade as live records;
- nothing is ever fabricated.

## New-construction integrity (`classify.js`)

- `confirmed_new` — the source states it (deal nature "דירה חדשה מקבלן",
  explicit new-sale flag);
- `probable_new` — indirect evidence (building year ≈ deal year, named
  developer project);
- `unknown` — everything else.

`GovDataService.getConfirmedNewTransactions()` is the only door into
new-construction analytics — `probable_new`/`unknown` never contaminate it.
Every classification carries its evidence strings for audit.

## Geographic fallback ladder (`service.js`)

`exact building → street → 250m → 500m → 1000m` — the first rung with data
wins, and the result's `scope` object always states which rung produced the
numbers (`level`, `radiusM`, `description`). An all-rungs miss returns an
**explained** empty result (`unavailable[]`), never a silent one.

## Transaction identity & deduplication (`fingerprint.js`)

Every row gets a stable `recordKey`:

- **`id:<official id>`** when the source publishes a transaction id (GovMap's
  deal `objectid`, the registry's id). Two rows with different official ids are
  **never** merged, however alike they look.
- **`fp:<sha1>#<k>`** otherwise: the SHA-1 of city|street|house|date|price|area,
  plus `k` = the occurrence number of that fingerprint **inside one source
  response** (`batchOf` = source | request URL | `responseId`, which the
  provider stamps once per request — never per row). Two identical id-less
  rows in one response are two deals (e.g. two identical apartments sold the
  same day) and stay two; the same response fetched again yields the same
  keys, so re-checks are idempotent.

`dedupe()` merges rows that share a `recordKey` (null fields fill, every
provenance entry is kept), then folds a bare row into an id'd row across
sources only when the match is unambiguous (exactly one id'd and one bare row
for that fingerprint). Legitimate duplicates are never collapsed.

## Transaction ledger & rolling backfill (`ledger.js`, `tx-refresh.js`)

Deals reach the official source weeks after their transaction date, so recent
periods are never treated as closed. A refresh asks the source for the
freshest deals **and re-checks the last `TX_BACKFILL_DAYS` (default 120) days of
transaction dates** for every watched area (`data/transactions/watch.json`),
then upserts into the ledger:

- key `(source_id, record_key)` — the official `objectid` wins over any
  fingerprint; a new key is inserted with `first_seen_at` = the fetch that first
  saw it, plus the area and run that saw it (`first_seen_target`,
  `first_seen_run`); an unchanged row only moves `last_seen_at`; a changed row
  is updated (facts hash `content_hash`), keeps its first sighting, and its
  earlier facts go to `revisions` (newest first, last 20);
- nothing is ever deleted because a later response omitted it;
- undated rows are rejected (a ledger row needs `transaction_date`).

Identity is tested through the real GovMap normaliser (`test/ledger.test.js`,
A–E): the same objectid in a later response is updated in place (A); different
objectids with identical fields are two deals (B); identical id-less rows of one
response are two deals (C); re-fetching adds nothing (D); revised official
fields keep the earlier version as a revision (E).

**Coverage of the window** (`tx-refresh.js`, shared by both runtimes): each
area's run records `windowCheck` with its `gaps` —
`complete` only when the sweep proves it (every polygon planned and answered,
every request run, no page cut at its limit, no failed request); `partial` when
capped (`polygon-cap`), cut by the time budget (`time-budget`), short of
answers, page-limited or with failed requests; `unknown` without diagnostics or
polygons; `not-checked` when the area was refused (HTTP 401/403), timed out,
failed or skipped at the job deadline — and also when its lookups answered but
none of its deals requests did (all refused → `refused`). A page counts as cut
when it reaches the request limit or holds fewer rows than the `totalCount` the
source reports. In `market.sync_runs` an area that was not completely
re-checked is never `ok` (`partial` / `refused` / `failed`, or `running` while
it is in progress). Error texts are redacted (`lib/store-config.js`: the
store's address, its host, the keys and the token are removed before any cut)
before they reach a run record, a log or an answer.

**Where it runs.** The daily GitHub job (`scripts/tx-sync.js` in
`data-sync.yml`) is refused by the source (HTTP 403 → status `refused`, exit 3,
a warning — never worked around). The same refresh can run inside PROPX's own
Vercel runtime: `POST /api/jobs/tx-refresh` (`api/jobs/tx-refresh.js`) — the
one exact path the browser session gate lets through (decided on the parsed
pathname in `middleware.js`) — authenticated by a bearer token: `PROPX_JOB_TOKEN`
(server-side env; fail-closed: unset → 503, wrong → 401), or a GitHub Actions
OIDC token minted by `tx-refresh.yml` for audience `propx-jobs` — GitHub's
signature and the repository id, production branch, workflow and event are all
verified (`lib/gov/oidc.js`), so no shared secret is needed.
`mode=sample` runs the page's own transaction path (`/api/gov/transactions`'s
service and providers) for a few cities and returns what each answered, why
when empty, and the newest official rows (`lib/gov/tx-probe.js`); `mode=probe`
reports the source's raw answer to the runtime (status, edge headers, a short
excerpt of a refusal).
`mode=probe` sends the raw address-lookup request and reports whether that
runtime is accepted; `mode=run` refreshes into the Supabase ledger and records
each area `running` before it starts and with its result after. Every official
request has its own timeout and no area starts after 20 s, keeping the job
inside its 60 s limit; it refuses without a valid store
(`store-not-configured` / `store-misconfigured`).
`.github/workflows/tx-refresh.yml` calls it daily (and on demand) once the
secrets `PROPX_BASE_URL` + `PROPX_JOB_TOKEN` are set — it fetches nothing
itself, and it shares the `data-sync` concurrency group, so the two ledger
writers never overlap. The database keeps the earliest first sighting anyway:
a trigger (migration `20261001120400`) never moves `first_seen_at` later and
ignores a write observed before what is stored. Whether the source accepts the
Vercel runtime is unknown until the probe has run; no continuous refresh is
claimed before.

Backends: `SupabaseLedgerStore` (`market.transactions` in the PROPX Supabase
project when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are set server-side —
the store of record), `FileLedgerStore` (`data/transactions/ledger/`, the GitHub
job's fallback when the project is not configured), `MemoryLedgerStore` (tests,
dry runs). Runs are logged in `data/transactions/sync-runs.jsonl` (GitHub job)
and `market.sync_runs` (both runtimes, when the store is configured).

**Reporting lag — foundation only.** `reportingLag(rows, runs)` and the view
`market.transaction_reporting_lag` treat a deal's lag as observable only when,
before PROPX first saw it, a *complete* check of the same area covered its
transaction date; the lag is then at most `first_seen_at − transaction_date`
(uncertain by the time since the latest such check). Deals of the first backfill are censored. Counts per
bucket only — no average or median is computed or published until enough deals
are observed and the method is reviewed; the page claims no reporting delay.

## Caching & historical snapshots (`store.js`)

`MemoryStore` (default; per warm lambda) and `FileStore`
(`data/gov/snapshots/<key>/<timestamp>-<hash>.json` + `latest.json`).
A snapshot is written only when the content hash changed — retrieval
timestamps and raw echoes are excluded from hashing, so diffs mean the
SOURCE changed. Other backends (KV, DB) implement the same four methods.

## Sources & their current status

| Provider | Basis | Status |
| --- | --- | --- |
| `taxes.gov.il/nadlan` | KARMAN transaction registry (the record vocabulary of nadlan.gov.il) | **Interface + normalizer complete; transport disabled.** The registry has no officially supported public API (verified again 31.08.2026: no API/open dataset on data.gov.il; the legacy `nadlan.taxes.gov.il` system offers manual Excel export only), and PROPX will not build on CAPTCHA bypasses or private third-party APIs. Configure `GOV_TAXAUTH_ENDPOINT` (+ optional `GOV_TAXAUTH_TOKEN`) when an authorized mechanism exists — an ITA data-sharing agreement, an official API, or a licensed feed — and the connector activates with zero mapping work. Until then every call fails gracefully with that exact reason. |
| `govmap.gov.il` | **Refuses PROPX's server since late 09.2026** (CloudFront HTTP 403 "Request blocked" to Vercel `iad1` and to the GitHub runner — probe/sample runs 36934488453 / 36934568527); stays first in line in case it answers again. Previously the live transactions provider. GovMap — the official State mapping portal — publicly serves the Tax Authority's reported-deals layer ("עסקאות נדל"ן") through its API: `POST /api/search-service/autocomplete` (address → ITM point), `GET /api/real-estate/deals/{x},{y}/{r}` (deal-polygon metadata), `GET /api/real-estate/street-deals/{polygonId}?dealType=` (transaction rows; `dealType` 1=first hand / 2=second hand — the government's own classification, stored verbatim in `sourceClassification`), `POST /api/layers-catalog/entitiesByPoint` (cadastre). Contract cross-verified against the open-source GovmapClient (github.com/nitzpo/nadlan-mcp). Coordinates are ITM/EPSG:2039 (`itmX`/`itmY`; WGS84 is never silently reprojected; distances are exact ITM meters). Public but not formally documented as a stable contract → honest UA, bounded fan-out, graceful degradation, kill-switch `GOV_GOVMAP_DISABLED=1`, base overridable via `GOV_GOVMAP_BASE`. |
| `over.org.il` | **The Tax Authority's deals register as REPUBLISHED by גרסאות לעם** — an independent transparency project, *not* a government channel (`providers/overDeals.js`). | **Live transactions provider since 02.10.2026, by decision of PROPX's owner**, while no official channel answers: the Tax Authority put an identification screen in front of its register on 29.09.2026 (against automated reading) and GovMap refuses the server. A copy of the register taken from nadlan.taxes.gov.il on 19.09.2026 (`/api/deals/stats` → `scraped_at`; 3,844,200 deals 1998-01-01 → 2026-09-17), served by a public, documented API with no key: `GET /api/deals/settlements` (every spelling, its CBS code), `GET /api/deals/search?settlement&street&house&date_from&sort=date_desc&limit≤200&offset` (`total` counted to 10,000, then `total_capped`). Rows pass through verbatim with `deliveredVia:'over.org.il'`, `channel:'independent-republication'`; the register has **no address** — street/house come from over.org.il's address ↔ parcel crosswalk (`addressBasis:'parcel-crosswalk'`, every candidate kept); no neighborhood, floor or coordinates; newness only from year built; a sold share (`portion` < 1) is `partialSale` and never priced per m². A locality is matched by its CBS code and its names (registry aliases included). The page labels these rows "רשומות רשות המסים · באמצעות גרסאות לעם — פרסום עצמאי, לא ערוץ ממשלתי", states the copy date, shows medians only and pages through every deal of the scope. Kill-switch `GOV_OVER_DISABLED=1`, base `GOV_OVER_BASE`. Tests: `test/republished.test.js`. |
| `data.gov.il` | CKAN `datastore_search` over the State cities + streets registries | **Live.** Resource ids overridable via `GOV_DATAGOV_CITIES_RESOURCE` / `GOV_DATAGOV_STREETS_RESOURCE`. House numbers are not in the national registry — they are echoed `houseNumberVerified:false`, never faked. |
| `cbs.gov.il` | Official CBS index API (mandatory User-Agent; series discovered from the catalog by name, overridable via `GOV_CBS_NEWHOMES_SERIES`) | **Live.** Trends are the national new-homes index; `scope:'national'` is explicit and a requested city is only echoed. |

**Provenance contract (every transaction):** `{sourceAuthority, sourceDataset,
sourceRecordId, sourceUrl, fetchedAt, sourceUpdatedAt, retrievalMethod}` —
`retrievalMethod` ∈ `live-api` · `authorized-api` · `manual-curation` ·
`fixture`. Newness classes: `confirmed_new` · `probable_new` · `second_hand` ·
`unknown`, with the source's own classification kept verbatim in
`sourceClassification`, separate from PROPX's derived `newness`.

**Gate-4 acceptance (ז'בוטינסקי 7, אזור):** `node scripts/gov-sync.js
--verify-azor` retrieves the address LIVE through the provider chain and
verifies against independently observed reference records
(`data/gov/fixtures/azor-jabotinsky7.json → observedComparison`) via
`lib/gov/verify.js` — nothing hard-coded; the run PASSes only if the
authoritative source itself returns matching records.

## Surfaces

- **HTTP (session-gated by the site middleware):**
  `GET /api/gov/status` · `GET /api/gov/search?q=` /
  `?city=&street=&house=` · `GET /api/gov/transactions?city=&street=&house=&lat=&lng=&newOnly=1` ·
  `GET /api/gov/trends`
- **CLI:** `node scripts/gov-sync.js --city "אזור" --street "ז'בוטינסקי" --house 7 | --trends | --status`
  — runs live where gov.il is reachable and persists durable snapshots.
- **Tests:** `node test/gov.test.js` — fully offline (injected fetch +
  fixtures), including the acceptance flow for **ז'בוטינסקי 7, אזור**:
  registry resolution, ladder scope, newness partition purity, snapshot
  change detection, graceful degradation, and normalization compared against
  a government-derived record observed in research
  (`data/gov/fixtures/azor-jabotinsky7.json`).

## Adding a source later

1. `class MyProvider extends GovernmentRealEstateProvider` implementing the
   subset it serves (+ honest `capabilities()`).
2. Register it in `createDefaultService`.
3. Add an offline fixture + tests.
Nothing in PROPX analytics changes.
