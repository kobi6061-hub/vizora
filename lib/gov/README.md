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
  response** (`batchOf` = source | request URL | retrieval). Two identical
  id-less rows in one response are two deals (e.g. two identical apartments
  sold the same day) and stay two; the same response fetched again yields the
  same keys, so re-checks are idempotent.

`dedupe()` merges rows that share a `recordKey` (null fields fill, every
provenance entry is kept), then folds a bare row into an id'd row across
sources only when the match is unambiguous (exactly one id'd and one bare row
for that fingerprint). Legitimate duplicates are never collapsed.

## Transaction ledger & rolling backfill (`ledger.js`, `scripts/tx-sync.js`)

Deals reach the official source weeks after their transaction date, so recent
periods are never treated as closed. The scheduled refresh
(`.github/workflows/data-sync.yml`, daily) asks the source for the freshest
deals **and re-checks the last `TX_BACKFILL_DAYS` (default 120) days of
transaction dates** for every watched area (`data/transactions/watch.json`),
then upserts into the ledger:

- key `(source_id, record_key)`; a new key is inserted with `first_seen_at`
  = the fetch that first saw it; an unchanged row only moves `last_seen_at`;
  a changed row is updated (facts hash `content_hash`) and keeps its
  `first_seen_at`;
- nothing is ever deleted because a later response omitted it;
- undated rows are rejected (a ledger row needs `transaction_date`).

Backends: `FileLedgerStore` (`data/transactions/ledger/`, committed by the
workflow), `SupabaseLedgerStore` (`market.transactions` in the PROPX Supabase
project when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are set server-side),
`MemoryLedgerStore` (tests, dry runs). `first_seen_at − transaction_date`
measured over time is how PROPX will calibrate its data-maturity window; no
reporting delay is claimed until it is measured. Each run is logged in
`data/transactions/sync-runs.jsonl`.

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
| `govmap.gov.il` | **Live transactions provider.** GovMap — the official State mapping portal — publicly serves the Tax Authority's reported-deals layer ("עסקאות נדל"ן") through its API: `POST /api/search-service/autocomplete` (address → ITM point), `GET /api/real-estate/deals/{x},{y}/{r}` (deal-polygon metadata), `GET /api/real-estate/street-deals/{polygonId}?dealType=` (transaction rows; `dealType` 1=first hand / 2=second hand — the government's own classification, stored verbatim in `sourceClassification`), `POST /api/layers-catalog/entitiesByPoint` (cadastre). Contract cross-verified against the open-source GovmapClient (github.com/nitzpo/nadlan-mcp). Coordinates are ITM/EPSG:2039 (`itmX`/`itmY`; WGS84 is never silently reprojected; distances are exact ITM meters). Public but not formally documented as a stable contract → honest UA, bounded fan-out, graceful degradation, kill-switch `GOV_GOVMAP_DISABLED=1`, base overridable via `GOV_GOVMAP_BASE`. |
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
