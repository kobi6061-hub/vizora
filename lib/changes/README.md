# What Changed Here? (`lib/changes`, 21.10.2026)

**The geographic change feed**: one read of a street, a verified neighbourhood, a locality, a district or Israel that lists what
changed in a period — composed **only** from evidence PROPX already stores. Nothing is fetched, nothing estimated, nothing
defaulted; no score, no probability, no recommendation.

```
GET /api/intel?view=changes&geo=<geo>&period=30|90|180|365[&kinds=][&newness=][&scope=][&source=][&batch=0|1][&offset=][&limit=]
GET /api/intel?view=changesMeta      the vocabulary, the 7 districts, the verified neighbourhoods, the anchor
```

`geo` = `st:<locality>:<street>` · `nb:<id>` (verified neighbourhoods only) · `loc:<code>` · `d-…` / `js-area` · `il` (default);
aliases `street=` · `nb=` · `city=` · `district=`. A malformed parameter is **400** (`bad-geo`, `bad-period`, `bad-kinds`,
`bad-newness`, `bad-scope`, `bad-source`, `bad-batch`, `bad-offset`, `bad-limit`); an unknown place or `view=changes…` is **404**.

## Every item

| field | meaning |
|---|---|
| `kind` | TRANSACTION · PLANNING · LAND_TENDER · URBAN_RENEWAL · HOUSING · RENTAL · CONSTRUCTION · SALES · SOURCE_REVISION · SOURCE_STATE |
| `rule` | the rule that produced it (`rules.js` RULES — each with its verb, class and a materiality constant 1–3; every rule has a "why am I seeing this?" entry in the registry's SIGNAL_RULES) |
| `eventDate` + `eventDateBasis` | the real-world date (the deal, the plan milestone, the tender decision, the publication); when the source dates no change: `SOURCE_UPDATE` (the record's update) or `OBSERVED` |
| `observedAt` + `observedBasis` | when PROPX first held it: `BASELINE_READ` (a source's first ingestion) · `FIRST_READ` · `FIRST_READ_OF_A_NEWER_COPY` · `CHANGE_READ` (a change between two reads) · `SNAPSHOT_READ` (a snapshot source — earlier reads not kept) |
| `newness` | `NEW_EVENT` (eventDate inside the period) · `NEWLY_OBSERVED_OLDER_EVENT` (older than the period, first held inside it, **not the baseline**) · `REVISION` · `STATE_CHANGE` |
| `verb` | lib/radar/verbs.js (NEW · ADVANCED · CHANGED · REVISED · STALE · RECOVERED · CONFLICT) |
| `source` | `{ id, label, copyDate, publicationDate }` · `cls` (OFFICIAL · OBSERVED · DERIVED) |
| `scope` | `EXACT_STREET` (an official key: the street's parcel, an address naming it, a deal the register places on it, a plan boundary including a located point) · `NEAR_STREET` (+ `distanceM`, ≤ 300 m; a rail plan ≤ 1,000 m) · `LOCALITY` · `DISTRICT` / `NATIONAL` (the geography's own series) · `DISTRICT_CONTEXT` / `NATIONAL_CONTEXT` (a wider series shown for a smaller place — never its own fact) |
| `placement` | `CERTAIN` · `POSSIBLE` (a corner parcel, a street recovered through the parcel — the txevents match code in `values.match`) |
| `link` | street report · tender · renewal complex · permit · plan (Mavat) · dossier · revisions · Trust Center · `expand` (a batch) |
| `n` | the events an item stands for (1, or a batch's deal count) — every count is in events |

The period is `(anchor − N days, anchor]`; the **anchor** is the newest PROPX check stored in the data (the run logs and meta files of
the sources the feed reads) — never the wall clock.

## Sources (what is dated, what history is kept)

| kind | source(s) | dated by the source | history between reads | geography |
|---|---|---|---|---|
| TRANSACTION | lib/txevents (register sweep · GovMap recent window · GovMap whole file) | the deal date | register: ONE copy (the baseline — a deal added in a later copy cannot be detected yet); GovMap rows: their first read (lifecycle) — a row the register copy does not hold is first observed in a newer copy | street (txevents placement) · locality · district / Israel (the events index: exact per-day count + newest 300 / 500, older GovMap rows batched per locality) |
| LAND_TENDER | data/land/tenders.json + the radar's lifecycle events | publication · committee / decision; open / close dates for observed transitions | since the first tender-list read (2026-10-04) | locality code; a street only through block / parcel (a parcel of the street, or one the GovMap file places ≤ 300 m away) |
| URBAN_RENEWAL | data/renewal/complexes.json + radar | declaration date | since 2026-10-13 (first read = baseline) | locality code; a street only through its plan number (the plan's boundary) |
| PLANNING | data/planning/national (every Xplan plan) · renewal-plan history (radar `plan-status`, merged per plan per day) · VATMAL | received · deposit · approval hearing · gazette | national layer: **snapshot only** (dated milestones are shown; status changes between reads are not kept); renewal-joined plans: since 2026-10-14 | street: spatial relation (lib/streets/report.js `planning`); locality: the plan's own locality field when it is exactly one official name with an official code (31,046 of 37,701 plans on 21.10.2026); VATMAL never mapped to a locality (spatial only) |
| HOUSING | data/housing/lotteries.json | lottery date | since 2026-10-01 (0 status events) — **STALE**: the dataset's newest lottery is 2025-01-27 | locality code; never a street (no address) — locality context only |
| RENTAL | data/rental/dira-tenders.json + radar | notice publication | since 2026-10-13 | through the printed ILA tender number (→ the tender's locality / parcels); planning sites: Israel only |
| CONSTRUCTION | CBS construction ledger · Tel Aviv-Yafo permits (data/dd/tlv.json) + the due-diligence history | series update date · permit / start / completion dates | CBS ledger (every version); TLV since 2026-10-18 (retracted events skipped) | CBS: national / district (a locality reads its district as context); TLV: the street its address names |
| SALES | CBS sales ledger (new · all · second-hand dwellings sold, inventory) | series update date | every version | national / district only |
| SOURCE_REVISION | both CBS ledgers | the revising update | every version (old value kept) | as the series |
| SOURCE_STATE | the radar's `source-state` / `source-stale` (Trust run logs) | — | the radar window | source-wide (NATIONAL_CONTEXT) |

Not in the feed (documented, not hidden): the dossier snapshots (`lib/dossier/history.js` — aggregate facts of the same records, a
second count of the same change); macro indices and the Bank of Israel rate (national, in the Market Pulse); developer wins / market
entries (the tender's award item names its winners); Ministry of Labour construction sites (city names, no locality code);
transactions in a street's LOCALITY context (open the locality's feed).

## Coverage and statements

Each kind's `coverage.state`: `COVERED` (dated records or kept history) · `SNAPSHOT_ONLY` · `NOT_APPLICABLE` · `NOT_IN_COVERAGE`
(the source does not reach the place — an unswept locality, a street not located in the layer file) · `STALE` (the freshest copy's
freshness state, or the content: lotteries) — with `parts` (each source: copy · covered through · history since · checked).

Each kind's `statement` (never interchangeable): `CHANGES` · `NO_CHANGES_IN_PERIOD` (covered, fresh, the evidence reaches ≥ half the
period) · `NOT_COVERED` (a selected scope the kind never reaches · not applicable · not in coverage · the evidence covers < half the
period — e.g. a 30-day transaction period the copies reach for 7 days) · `SOURCE_STALE`. Counts are in the selected **scopes**,
before the kind / newness facets. `possibleDuplicatesExcluded` states the POSSIBLE DUPLICATE events never counted.

## Page (`ui.js`)

Mounted in `#chRoot` (live build only): orientation + "how to read" (registry SECTIONS), its own geography search (`/api/geo/search`
combobox), district list, verified-neighbourhood list; follows `propx:geo`, `propx:lang`, the board's selection (country · district ·
city by exact name · verified neighbourhood — never during a street navigation) and the `[data-chgeo]` links of the street report and
the dossier. Period · scope · kind · newness chips (scope defaults: the geography's own; every CONTEXT scope one click away); summary
tiles per kind (count, or the statement); a month-grouped timeline (event date · seen by PROPX · verb · newness · scope · source +
copy date · class chip · "why am I seeing this?"); older newly observed deals collapsed per copy read (`batch=1`, expandable); the
coverage panel. `window.PropxChanges` exposes `setGeo` / `state` (used by the acceptance journey).

## Files

`index.js` (view · feed · anchor · newness · statements · params) · `collect.js` (one collector per kind) · `stores.js` (the stored
files, memoised per file stamp; literal paths for the deployment's file tracing) · `geo.js` (geography resolution) · `rules.js`
(vocabulary + rules) · `ui.js` (page) · `journey.js` (the Playwright acceptance journey — needs a dev server and Playwright; not part
of the node suite). Gates: `test/changes.test.js`. Performance: a large city answers in ≈ 0.9–1.0 s on its first read after the
shared stores are warm, then from the memo (≈ 10 ms); a cold process's first read of Israel builds every store (≈ 6 s).
