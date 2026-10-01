# Government (subsidized) housing — `lib/housing/`

The official lottery records of the **מחיר למשתכן / מחיר מטרה** programs
(דירה בהנחה), ingested on a schedule, persisted with history and served to the
page through a session-gated, paginated API. Nothing here is synthesized.

```
data.gov.il (CKAN datastore, every row, paged)        source.js
  → schema guard · content hash · raw snapshot        scripts/housing-sync.js
  → normalized records (one per official LotteryId)   normalize.js
  → upsert-merge, status history, never delete        store.js  → data/housing/ (+ Supabase)
  → filters · periods · KPIs · series · drill-down    query.js  → api/housing.js → #housing
```

## Source

| | |
| --- | --- |
| Owner | משרד הבינוי והשיכון (Ministry of Construction and Housing) |
| Dataset | `mechir-lamishtaken` — "נתונים תקופתיים - תכנית דירה בהנחה" (https://data.gov.il/dataset/mechir-lamishtaken) |
| Resource | `7c8255d0-49ef-49db-8904-4cf917586031` — "מעקב אחר הגרלות דירה בהנחה" |
| Format | CKAN `datastore_search` (JSON), paged 1,000 rows; `resource_show.last_modified` = the source's update time |
| Class | CONFIRMED STRUCTURED SOURCE · stated cadence: weekly |
| Identity | `LotteryId` (unique per row, verified over the whole table); `ProjectId` groups a project's lotteries |
| Geography | `LamasCode` (CBS locality code) + `LamasName`, `Neighborhood` as published — no coordinates, no address, no parcel |

Verified with `scripts/housing-discover.js` on a GitHub runner (gov.il is not
reachable from every environment): 2,352 rows, lottery dates 2016-02-29 →
2025-01-27, source modified 2026-08-16.

Other sources checked and **not** joined (see the GH-1 report): the program's
GIS layer (download refused, 403 → no coordinates, no map markers); the
"sales without lottery" resource (empty); construction-progress data (stale,
no join key to `ProjectId`/`LotteryId`). There is no official relationship
between these lotteries and the national unsold-inventory figures.

## The normalized record (`normalize.js`)

One record per official lottery, `id = 'lottery:<LotteryId>'`. Values are the
source's own (**OFFICIAL**); blanks (`''`, `'-'`) and impossible values (price
0, invalid dates) stay `null` and are listed in `missing`. Labels are kept
verbatim next to normalized keys (`program`/`programHe`, `permitStage`/
`permitStatusHe`, `projectStage`/`projectStatusHe`). A row whose `LotteryId`,
`ProjectId` or `LamasCode` is not a positive integer is rejected (logged).

The quantities keep their meaning and are never added into one another:

| Field | Source column | Meaning |
| --- | --- | --- |
| `unitsInLottery` | LotteryHousingUnits | units drawn in this lottery |
| `unitsAtSignup` | LotterySignupHousingUnits | units marketed at signup |
| `applicants` | Subscribers | applicants registered for this lottery — one person can register for many lotteries, so a sum is **registrations**, not people |
| `winnersHomeless` | WinnersHasryDiur | winners who own no home (חסרי דירה) — not "homeless" |
| `winners` | Winners | lottery winners — **not** buyers or signed sales |
| `signedSales`, `availableInventory`, `totalProjectUnits`, `coordinates` | — | not published → always `null` → "—" |

A **continuation** lottery (`LotteryType = המשך`) re-offers units of its
project's first lottery and may draw more winners than it has units. Unit
totals therefore count **first lotteries only**; re-offers are reported
separately — and the same units can be re-offered in several continuation
lotteries, so the re-offer sum is not a count of distinct units.

Not every official row is a housing lottery in a locality: the table also
lists a national grants program ("מענקים לרוכשי דירות יד שנייה", LamasCode
9999 = "כלל הישובים", placeholder ProjectId 1234567). It is kept as an
OFFICIAL record with `recordType: 'grant-program'` and is never counted as a
lottery, a project, units, winners or a locality; the page discloses it.

Lifecycle comes only from explicit official status fields: the permit stage
(`ConstructionPermitName`) and the ministry's process stage (`ProjectStatus`,
where only "בקרה לאחר אכלוס" evidences occupancy). Construction start and
completion are not in this source: `null` → "—". Nothing is inferred from a
lottery's age.

Every record carries `provenance` {source, authority, dataset, resourceId,
sourceRecordId (= LotteryId), sourceRowId (datastore `_id`), sourceUpdatedAt,
fetchedAt, snapshotHash, retrievalMethod, classification: OFFICIAL}.

## Persistence (`store.js`)

- Upsert on `lottery:<LotteryId>`; `firstSeenAt` set once. A record's
  provenance is that of its current version (the fetch and raw snapshot in
  which these values first appeared), so an unchanged record is never
  rewritten. A listed record was observed at `meta.checkedAt`; `lastSeenAt` is
  stored once the source stops listing it. A run whose content hash is
  unchanged writes only `meta.json` and the run log.
- A change in an official **source** field (`HISTORY_FIELDS`: the values that
  map from a source column) appends a status-history event (`history.jsonl` /
  `market.housing_status_history`); derived keys (permitStage, lifecycle …)
  are re-derived silently, and a project-level change repeated on each of the
  project's lottery rows is shown once in the drawer.
- A lottery the source stops listing is kept with `inLatestSource:false`
  (event logged) — never deleted.
- The raw payload is stored once per distinct content (`raw/<date>-<hash>.json.gz`
  / `market.raw_snapshots`).
- A response with a renamed required column, more than 2% (min. 5) rows that
  fail normalization, or fewer than half the listed records is not applied
  (the run fails and is logged). A listed row that failed normalization keeps
  its stored record — it is never marked delisted.
- `--from` replays into the production directory (however it is named) only an
  official raw snapshot from `data/housing/raw/` whose rows hash to the hash
  in its name, that a live-api run recorded in `sync-runs.jsonl`, and that is
  not older than the current content (unless `--force`); fixtures go to a
  separate `HOUSING_DATA_DIR`. Snapshots store `{contentHash, fetchedAt,
  sourceUpdatedAt, endpoint, rows}`.
- Supabase: when the project holds fewer records than PROPX (secrets added
  after the first sync, or a failed write), the next run writes all of them and
  the raw snapshot; raw snapshots keep their first fetch time.
- `NORMALIZER_VERSION`: a mapping change re-derives the records from the same
  content without writing history events.

Files: `data/housing/lotteries.json` (one record per line), `meta.json`
(source, `sourceUpdatedAt`, `checkedAt`, coverage), `history.jsonl`,
`sync-runs.jsonl`, `raw/`. Supabase: `supabase/migrations/` (schema `market`:
`sources`, `sync_runs`, `raw_snapshots`, `geo_links`, `housing_lotteries`,
`housing_status_history`, views `housing_projects`, `housing_provenance`).
User-specific state lives in the separate `user_state` schema.

## Read model (`query.js`, `api/housing.js`)

`GET /api/housing?view=summary|records|record|status` with filters `period`
(`6m` · `12m` · `24m` · `all` · `custom`+`from`/`to`), `city` (CBS code or
official name), `neighborhood`, `project`, `developer`, `program`, `status`,
`permit`, `lotteryStatus`, `type`, `q`.

- A period the source does not cover (after its newest lottery date) is
  `null` → "—", never 0. Inside the covered range a month with no lottery is
  a real 0. A partly covered period says so.
- KPIs are DERIVED counts/sums over official rows; the median official price
  per m² and applicants-per-unit carry their basis (first lotteries with a
  value).
- Data maturity: a lottery with no winners recorded yet, or held in the last
  `HOUSING_MATURITY_DAYS` (default 90) days, is "updating"; a period that runs
  past the source's newest lottery is "partial coverage"; otherwise
  "historical period" (never "complete"). Status texts are shown verbatim.
- "Today" is the date in Israel; filter counts are for the selected period
  (none when the source does not cover it).
- Drill-down: country → locality (CBS code) → neighborhood (as published) →
  project (ProjectId). No coordinates exist; nothing is placed on the map.

Tests: `node test/housing.test.js`.
