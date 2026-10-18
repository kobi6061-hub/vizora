# PROPX · CBS construction — the official permits · starts · completions · active-construction series

PROPX's construction figures for the **country and its 7 districts** come from the Central Bureau of Statistics
time-series API (subject 44 "בינוי ונדל"ן") — the same API, response shape and request format as the new-home sales
lane (`lib/cbs-sales`). This folder reads four branches, keeps every published value, and derives the metrics the
product will show. Added 17.10.2026; it integrates the discovery candidate `cbs:series:construction-by-district`
(`lib/trust/discovery/2026-10-17.json`, verdict INTEGRATE).

## What CBS publishes (audited 17.10.2026 on a GitHub runner, read-only discovery)

| | |
| --- | --- |
| API | `https://apis.cbs.gov.il/series/data/path?id=<path>&startperiod=MM-YYYY&endperiod=MM-YYYY&format=json&lang=he` |
| Catalogue | `https://apis.cbs.gov.il/series/catalog/path?id=<path>` (walked every run) · level listing `catalog/level?id=5&subject=44` |
| Building permits | `44,11,2,,<name_id>` — dwellings in building permits issued in the period; geography = `name_id` 271–277 (CBS district order: ירושלים, הצפון, חיפה, המרכז, תל אביב, הדרום, יו"ש), total = 1. Verified on the runner: `44,11,2,,275` (Tel Aviv, monthly + annual), `44,11,2,,1` (total — the seasonally adjusted series came FIRST in the response). |
| Construction starts | `44,2,3,<district>,<leaf>` — dwellings whose construction began in the period; geography = level-4 code 1–7, total = 8; the leaf (level 5) is "סך הכל" (2 for the total, verified `44,2,3,8,2`, monthly). |
| Completions | `44,3,3,<district>,<leaf>` — dwellings whose construction was completed in the period; same codes (verified `44,3,3,8,2`, monthly). |
| Active construction | `44,4,3,<district>,<leaf>` — dwellings under construction at the END of the period: a **stock**, not a flow (verified `44,4,3,8,2`, quarterly). |
| Fields | per series: `id`, `time` (3 month / **4 quarter** / 1 year), `data` (1 original / 2 seasonally adjusted / 3 trend), `unit`, `path.level1..level4` + `path.name_id`, `update` (series update date), `obs[{TimePeriod, Value}]` — a quarterly observation is dated by the quarter's last month ("2026-06" = Q2 2026) |
| Unit | number of dwellings, original data — never floor area, never buildings |
| Cadence | a quarterly construction release about ten weeks after the quarter ends; the monthly figures appear with the quarter; `update` dates each series (observed 2026-09-10 for Q2 2026 data) |
| Depth | PROPX reads from 2016-01 (≤ 6-year windows); the API serves earlier periods on request |
| Revisions | recent months and quarters are revised in later releases; the API carries only the current value — PROPX keeps every version |

**There is no locality (city) series.** Level 5 of subject 44 holds 269 nodes, every one of them a total or a district.
Permits / starts / completions by locality exist only in the quarterly release tables and the yearbook (PDF / XLSX,
names not codes — Trust Center `discovery:cbs:construction-by-locality`, DOCUMENT-ONLY). A district figure is
**never allocated to a city**: the payload's keys are the 8 geographies and nothing else.

**Four universes, never summed.** Permits ≠ starts ≠ completions ≠ active construction. Active construction is a level
at period end and is never summed over periods (the metrics give it a change vs the previous period and vs a year
earlier, no trailing total).

## Geography resolution (lib/construction/resolve.js)

The geography code sets differ per branch, so the sync never trusts a table alone: **the name verifies the code, the
code keys the data**, and a name alone never keys anything. What the real catalogue answers (first dry-run on the
runner, 18.10.2026, workflow run 39080649194):

- `catalog/path?id=44,11,2` (permits) — 8 **named** leaves `44,11,2,,<code>`: 1 "סך כולל" (not "סך הכל"), 271 ירושלים,
  272 הצפון, 273 חיפה, 274 המרכז, 275 תל אביב, 276 הדרום, 277 "אזור יהודה והשומרון (עד 2005 כולל חבל עזה)".
- `catalog/path?id=44,2,3` and `44,3,3` — 16 leaves and **no district name**: `…,<k>,2` "סך הכל" plus a separator
  `…,<k>,4141` named "----------------------------------" (listed, counted, never resolved). `44,4,3` — 8 leaves `…,<k>,2`.
- The district names of those branches come from the subject's **level-4 listing**
  `catalog/level?id=4&subject=44` (paged; the listing the discovery's "1 ירושלים … 8 סך הכל" came from) — fetched once
  per run and shared by the three branches.

Every run, per measure and geography:

| status | meaning | effect |
| --- | --- | --- |
| `resolved` | permits: a leaf named like the district, with the expected code · by-district: the leaf `…,<k>,2` exists and the level-4 node `…,<k>` is named like the district (`nameSource: 'catalogue'`) | requested; keyed by the code |
| `pending` | the leaf exists but the level-4 listing is unavailable or lacks the node | requested; **applied only once a data response names it** (`nameSource: 'response'`) — never named → nothing applied |
| `mismatch` | the name sits under another code (catalogue), or the data response names the code otherwise (`GeoNameError`) | **not applied** — a human checks `series.js` against the names recorded |
| `unresolved` | no leaf for the code, several leaves and none the total, or (permits) no / several nodes with the name | not requested |

In every case the parser checks the name in the data response's own path (`path.level4.name` /
`path.name_id.name`) against the geography asked — a mismatch there disqualifies the geography whatever another window
answered. The resolution of every run is written to `data/construction/geo-resolution.json` (every node listed with its
`pathDesc`, the codes, the names, their source, the reasons) and summarised in the run-log line
(`resolution.<measure>: resolved · byCatalogue · byResponse · pending · mismatch · unresolved · separators · paths`).
A run with any geography not applied is PARTIAL — the last valid data of that geography stays, marked stale.
One run = 2–3 level-4 pages + 4 branch listings + 64 data requests (≈ 70).

**Unmapped series kinds.** A series whose `time.value` / `data.value` is not in `TIME_KIND` / `DATA_KIND` is skipped
and listed with its raw kind (the dry-run prints `SKIPPED(time … / data …)`). The runner showed a third permits series
`9538xx` beside the monthly `5538xx` and the annual `6538xx` for every geography; its kind is read from the next
dry-run and mapped in `series.js` only on purpose — until then it is ignored explicitly.

## Period kind (lib/construction/parse.js)

Never assumed. Each series says what it is (`time.value`): monthly observations are stored as `freq: "M"` / `"YYYY-MM"`,
quarterly as `freq: "Q"` / `"YYYY-Qn"`, annual as `freq: "Y"` / `"YYYY"`; the source's own `TimePeriod` string is kept
as `sourcePeriod`. Only the original series (`data.value = 1`) is read — the seasonally adjusted series that the API
sometimes returns first is skipped. A period the response does not carry is MISSING, never 0; a published 0 stays 0.

## Files

| File | Role |
| --- | --- |
| `series.js` | the source, the 8 geographies (one table), the 4 measures with their branch, codes, semantics and kind (flow / stock), the request plan over a resolution |
| `resolve.js` | the catalogue walk and the code ↔ name verification; `summarize()` for the run log |
| `parse.js` | one response → observations (period kind per series; branch / geography / leaf checked; missing ≠ 0) — reuses the sales lane's `SchemaError` |
| `ledger.js` | the append-only ledger — the sales ledger's revision logic reused, plus the construction fields (path, leaf, name label, source period, kind) |
| `metrics.js` | flows: T3 / T12 (monthly) or T4 (quarterly), YTD vs prior YTD, change; stocks: level vs previous / year earlier; quarter-based freshness; reconciliation |
| `snapshot.js` | `data/construction/latest.json`; a failed geography keeps its last payload marked stale; a measure without observations is MISSING with its reason |
| `sync.js` | one run (the fetcher injected — tested offline on the fixture); run states; what is written when |
| `scripts/construction-sync.js` | the CLI (`--dry-run` prints the catalogue nodes, the resolution table and the series found; `--out`, `--summary-file`) |
| `.github/workflows/construction-sync.yml` | every working day 12:41 UTC; dispatch modes `sync` / `dry-run`; runs `test/construction.test.js` and `test/integrity.test.js` before committing |
| `data/construction/` | `observations.jsonl` (ledger), `raw/` (response bundles per content hash — catalogue and data), `latest.json`, `geo-resolution.json`, `sync-runs.jsonl` — written by the workflow, never by hand |
| `test/construction.test.js` | the lane's gates, on `test/fixtures/cbs-construction-sample.json` (a labelled TEST FIXTURE, never read by the product) |

## Metrics (lib/construction/metrics.js)

- **OFFICIAL** — a period as published (month or quarter, whichever the series has).
- **DERIVED (flows)** — monthly: T3, T12, YTD (Jan → latest), prior-year YTD, change T12 vs the 12 months before and
  YTD vs prior YTD; quarterly: T4, YTD (Q1 → latest), prior YTD, change T4 vs the 4 quarters before. Every window
  needs every period present, else it is unavailable with the period named — never filled, never 0. CBS's own
  quarterly series, where it exists beside the monthly one, is shown as `quarterly`.
- **DERIVED (stock)** — active construction: the latest level, vs the previous period and vs the same period a year
  earlier (abs and %). No trailing total exists for a stock.
- **Reconciliation** — the national row as published vs the sum of the 7 district rows, period by period (12 months /
  4 quarters for a flow; the latest period for a stock); the residual is reported, never forced, never explained.
- **Freshness** — see the assumption below.

## The reporting-lag ASSUMPTION (freshness)

CBS publishes no machine-readable release calendar for the construction release. The freshness states rest on an
**assumption, documented in `SOURCE.lagAssumption` and carried in every payload**: the quarterly construction release
appears about 10 weeks after the quarter ends (observed once: Q2 2026 data → series update 2026-09-10, 72 days after
30.06). With the latest observation's quarter Qn, the next quarter Qn+1 ends at E:

| state | rule |
| --- | --- |
| `CURRENT` | now ≤ E + 60 days — the next release cannot normally be out yet |
| `EXPECTED_REPORTING_LAG` | E + 60 < now ≤ E + 120 days — the release is due; a normal delay, never "stale" |
| `STALE` | later, and the next quarter is still not published |

The thresholds (60 / 120 days) are in `metrics.js` (`CURRENT_DAYS`, `STALE_DAYS`); revise them when more releases have
been observed (`SOURCE.lagAssumption.observed` is the list to extend). The overall freshness is the least fresh of
the measures that have data, with every measure listed.

## Run states (data/construction/sync-runs.jsonl)

`SUCCESS` (new or revised values) · `UNCHANGED` · `PARTIAL` (some geographies not read — catalogue mismatch /
unresolved, or a request failed; their last data kept, marked) · `FAILED` (nothing usable — nothing but the run log
written) · `REFUSED` (HTTP 401 / 403 / 429 everywhere) · `SCHEMA_CHANGED` (the catalogue or a response in a shape PROPX
does not recognize — nothing applied). The Trust Center (`lib/trust/catalog.js`, `cbs:construction`) reads this log:
NO_RUN until the first run; STALE after 100 hours without a good check (working days).

## What the first workflow run must verify

Dispatch `construction-sync.yml` with `mode: dry-run` first and read the log:

1. the level-4 listing answers (`== level-4 listing of subject 44: N nodes over P page(s)`) and every by-district
   geography is `resolved … (catalogue)` with the expected code (1–7 + 8, leaf 2); permits `resolved … (catalogue)`
   with 271–277 + 1 (total "סך כולל") — a `mismatch` names the code the catalogue gives the district: correct
   `series.js` to it after reading the node's name; a `pending` means the level listing lacks the node: the response
   must then name it (`named "…"` on the request line);
2. the series found per request: an original (`original`) series for every geography on the kind expected (starts /
   completions / permits monthly `M` + annual; active quarterly `Q`) — if starts or completions come only quarterly for
   the districts, that is fine: the lane stores the kind it finds; every request line ends with `named "<district>"`;
3. the permits `9538xx` series prints as `SKIPPED(time … / data …)` — decide whether to map that kind;
4. no `SchemaError` / `geography name mismatch` anywhere; ≈ 70 requests.
Then dispatch `sync`. The commit message names the measures and their latest periods.

## Hook points (not wired yet — by design)

Nothing in the dossier, the supply pipeline, the pulse or the page reads this lane tonight. When they do, they read
**`data/construction/latest.json`** (schema 1):

```
measures.<permits|starts|completions|active>
  .state                      'OK' | 'MISSING' (+ .reason {he,en,kind}) — never 0
  .kind                       'flow' | 'stock'
  .freq                       'M' | 'Q' (the finest kind the national series has)
  .geos.<il|d-jm|d-north|d-haifa|d-center|d-ta|d-south|jsr>
      .cbs / .pathId / .nameId    the CBS codes (the key), .sourceName the label
      .latest                     { freq, period, value, label{he,en} }            OFFICIAL
      .series                     { M: [[period, value]…], Q: [[…]], Y: {year: value} }
      .metrics                    flows: t3/t12 or t4, ytd, prevYtd, change{…}; stock: vsPrevious, vsYearEarlier   DERIVED
      .sourceUpdate               the CBS series update date (publication)
      .stale / .lastError         when this run did not read it (last data kept)
  .reconciliation              rows + window (residual reported)
  .freshness                   { state, latestQuarter, nextQuarter, nextDueFrom, staleAfter, assumption }
freshness                      the overall state + byMeasure
missing[]                      { measure, geo, reason }
```

- **Dossier** (`lib/dossier`): a national / district block "היתרים · התחלות · גמר · בנייה פעילה" from `measures.*.geos[geo]`
  — the district series, labelled as the district's figure, never a locality's; the locality dossier keeps its
  `permits` missing entry (there is no locality series).
- **Supply pipeline** (`lib/supply/pipeline.js`): three more parallel universes (permits, starts, active stock) — shown
  beside the existing six, never summed with them; momentum from `metrics.change`.
- **Pulse / radar** (`lib/radar/events.js`): a rule over `data/construction/observations.jsonl` like the CBS sales block
  — a new period published (NEW), a revision (REVISED, old value kept beside the new); and the workflow then adds
  `node scripts/radar-build.js && git add data/radar` before its commit, as the sales workflow does.
- **Explainability** (`lib/explain/registry.js`): terms `building_permits`, `construction_starts`, `completions`,
  `active_construction` with the semantics above, and the source `cbs:construction` (alias `cbs:timeseries:44`).
- **Trust Center**: already listed (`cbs:construction`).
