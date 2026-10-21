# PROPX data freshness and completeness audit, 22.10.2026

Workstream A of the overnight build. The audit ran on 21.10.2026 at about 22:30 UTC (22.10 at about 01:30 Israel time). It used the
commit the preview lane was based on (406f4db, which contains production 2d48c24) and GitHub Actions run evidence read through `gh api`.
That evidence was limited to GET requests for run status, dates, run ids and failed-job logs. Nothing was triggered, re-run or cancelled.

**Machine-readable output:** `lib/trust/discovery/2026-10-22-freshness-audit.json`, written by `scripts/freshness-audit.js --fetch-github --integrity`.
It holds the per-source rows from `lib/trust/freshness-audit.js`, the GitHub run evidence, the root-cause table and the deep integrity pass.

Each source keeps four dates apart:
- **observation:** the newest event or period PROPX holds.
- **publication:** the source's own date, where one is stated.
- **ingestion:** when PROPX last stored new content.
- **check:** when PROPX last asked the source.

Each source then gets one state, applied in this order: REFUSED, FAILING, CHECK_STALE, SOURCE_STALE, EXPECTED_LAG, CURRENT, DATED_BUILD, NO_RUN.

## 1. Summary

- **Transactions:** no newer copy exists that PROPX has failed to ingest.
  - The register copy is the republisher's scrape of **19.09.2026**. Its latest deal is dated **17.09.2026**. The copy is **STALE (32 days old)**.
  - The GovMap-layer copy is v4, loaded **08.10.2026**, with its latest deal on **28.09.2026**. It is read and reconciled.
  - The monitor's check at 20:44 UTC and the version check at 21:48 UTC on 21.10 both see the same two versions (register v5, GovMap v4).
  - **No transaction workflow needs to be dispatched.**
- **Integrity invariants hold on the stored universe.** The deep pass over 1,066 localities and 380,547 events found 0 violations (section 3).
- **Official series are current under their documented lag.**
  - CBS sales and inventory: 2026-08.
  - Construction: 2026-06 / Q2.
  - CPI, rent and construction-inputs indices: 2026-09.
  - Dwelling-price indices: the July–August 2026 window.
  - Bank of Israel housing finance: 2026-09.
  - The Bank of Israel rate is **EXPECTED_LAG**. A decision was scheduled for 21.10.2026, and the snapshot was read at 08:30 UTC that day, before the announcement. The next daily sync reads it.
- **Five defects were found in the repository and fixed, with tests** (section 5):
  1. The national missed-deal detector's checks were never recorded, so the Trust Center showed a false **STALE**.
  2. The Trust Center showed the finance lane with no check date.
  3. The coverage audit reported 304 false **"missed"** deals.
  4. The street-geography build could lose its push to a rebase conflict, which left an older build in place.
  5. The Trust Center gave a future-dated row (2048-05-29) as the national file's latest observation.
- **Source-side staleness that PROPX cannot fix** (section 6):
  - The register republisher has not produced a newer scrape since 19.09.
  - Every official deals channel refuses the runner.
  - The housing-lottery resource's newest lottery is 27.01.2025.
  - The ILA planning inventory dates from 2022.
  - MoCH construction progress dates from 2024-03.

## 2. Per-source inventory

Columns:
- **Latest observation:** the newest date or period in the stored data.
- **Publication:** the source's own date (data.gov.il `last_modified`, the CBS series update, or the republisher's dataset-version detection).
- **Ingestion:** when PROPX last stored new content.
- **Last check:** taken from the committed run log unless marked otherwise. Times are UTC.

| Source | Latest observation | Publication | Ingestion | Last check | Workflow · cron (UTC) | State |
|---|---|---|---|---|---|---|
| govmap:tax-authority-deals (official) | — | — | never served | 21.10 07:59 (HTTP 403) | data-sync.yml `41 2 * * *` | **REFUSED** |
| over:street-evidence (register copy) | 2026-09-17 | v5 detected 19.09 11:20 (scrape 19.09 11:07) | 19.10 12:40 (sweep 1,036/1,036) | 21.10 08:52 | street-evidence-sync.yml `41 3 * * *` | **SOURCE_STALE** (32 d) |
| datagov:moch:dira-behanacha-lotteries | 2025-01-27 | 16.08.2026 | 01.10 16:44 | 21.10 07:59 | data-sync.yml `41 2 * * *` | **SOURCE_STALE** |
| datagov:rmi:planning-inventory | (2022 inventory) | 17.02.2022 | — | 21.10 08:42 | land-sync.yml `17 3 * * *` | **SOURCE_STALE** |
| datagov:moch:construction-progress | (2024-03) | 01.03.2024 | — | 21.10 08:42 | land-sync.yml `17 3 * * *` | **SOURCE_STALE** |
| boi:policy-rate | 3.25 % | API `lastPublishedDate` 01.09.2026 | 21.10 08:30 | 21.10 08:30 | market-sync.yml `17 3 * * *` | **EXPECTED_LAG** (decision 21.10) |
| over:govmap-recent (GovMap copy, recent window) | 2026-09-28 | v4 detected 08.10 01:47 | 20.10 08:00 | 21.10 09:19 | street-recent-sync.yml `7 4 * * *` | CURRENT (copy RECENT, 13 d) |
| over:govmap-national (GovMap whole file) | 2026-07-13 shown (file max 2048-05-29 = future-dated, INVALID) | v4 detected 08.10 01:47 | 20.10 18:55 | **21.10 21:48 (GitHub run 39681669082)**; run log 20.10 17:58 | txevents-national.yml `23 */3 * * *` | CURRENT with GitHub evidence; the committed run log alone reads CHECK_STALE (the defect in §5.1) |
| propx:tx-freshness (monitor) | 2026-09-17 | register copy served: 19.09 11:07 | — | 21.10 20:44 | tx-freshness.yml `23 5,17 * * *` | CURRENT |
| propx:transaction-events (union) | 2026-09-28 | — | 21.10 09:20 | 21.10 09:20 | rebuilt by the three transaction syncs | CURRENT (as fresh as its sources) |
| propx:street-model | as of 2026-09-17 | — | 20.10 08:53 | 20.10 08:53 | street-evidence-sync.yml (--if-stale) | CURRENT |
| cbs:new-home-sales (+ inventory, whole market) | 2026-08 (next due from 04.11) | series update 07.10 | 21.10 14:18 | 21.10 17:26 | cbs-sales-sync.yml `23 12 * * 0-4` | CURRENT |
| cbs:construction | 2026-06 / 2026-Q2 (Q3 due from 29.11) | series update 10.09 | 18.10 00:18 | 21.10 17:37 | construction-sync.yml `41 12 * * 0-4` | CURRENT |
| cbs:cpi · cbs:rentIndex · cbs:constructionInputsIndex | 2026-09 | not stored | 21.10 08:30 | 21.10 08:30 | market-sync.yml `17 3 * * *` | CURRENT (assumption: about the 15th of the next month) |
| cbs:newHomesIndex · cbs:dwellingsIndex · cbs:dwellingsByDistrict | Jul–Aug 2026 window | not stored | 21.10 08:30 | 21.10 08:30 | market-sync.yml `17 3 * * *` | CURRENT (assumption: about the 15th, two months after the window) |
| boi:housing-finance | 2026-09 | none stated | 21.10 13:34 | 21.10 13:34 (preview run) | finance-sync.yml `41 5 * * 0-4` | CURRENT; **first production run 22.10 05:41** |
| cbs:average-dwelling-price (Table 2.2, `PRICE_SRC`) | 2026-Q2 (provisional) | Price Statistics Monthly No. 7/2026 | transcribed 19.10.2026 | — | by hand | DATED_BUILD (Q3 not expected before mid-November, assumption) |
| rmi:michrazim (ILA tenders) | published to 2026-10-19 (committee to 20.10) | — | 21.10 08:34 | 21.10 08:42 | land-sync.yml `17 3 * * *` | CURRENT (PARTIAL = the daily detail request cap; detail 10,650/10,650) |
| datagov:moch:urban-renewal-complexes | declarations to 2026-06-11 | 15.08.2026 | 13.10 01:15 | 21.10 08:54 | renewal-sync.yml `47 3 * * *` | CURRENT |
| iplan:xplan:renewal | layer read 21.10 08:54 | — | 21.10 08:54 | 21.10 08:54 | renewal-sync.yml | CURRENT |
| dira-lehaskir:tenders | newest notice 2026-10-14 | 14.10 | 15.10 10:18 | 21.10 10:35 | rental-sync.yml `41 5 * * 0-4` | CURRENT |
| iplan:vatmal | newest declaration 2025-05-28 | none stated | 21.10 14:39 | 21.10 15:08 (preview run) | vatmal-sync.yml `47 5 * * 2` | CURRENT; first production run 27.10 |
| propx:plan-boundaries (37,701 / 37,701 plans) | read 21.10 07:21 | — | 21.10 07:21 | — | street-planning-sync.yml (**no schedule**) | DATED_BUILD |
| propx:street-geo | built 21.10 07:10 from GovMap file a410a522… | v4 | 21.10 07:10 | — | street-geo-build.yml (**no schedule**) | DATED_BUILD (**older script**, §5.4) |
| datagov:streets | 2026-10-19 | 19.10 00:30 | 19.10 09:35 | 19.10 09:35 | street-sync.yml `23 4 * * 1` | CURRENT (next run 26.10) |
| datagov:geo-registry | built 31.08.2026 | — | 31.08 | — | on demand | DATED_BUILD |
| census 2022 · residents (weekly, 12.10) | 2022 · 12.10.2026 | 03.06.2024 · 12.10.2026 | 21.10 13:24 | 21.10 14:49 (preview run) | reference-sync.yml `23 4 * * 1` | CURRENT; first production run 26.10 |
| MoT bus stops · LRT · rail · metro | 01.10 · 22.03 · 12.07.2026 · 24.06.2024 | same | 21.10 13:56 | 21.10 14:03 (preview run) | transport-sync.yml `37 4 * * 2` | CURRENT; first production run 27.10 |
| MoEP contaminated land · MoE institutions · points | 21.10 · 11.05.2026 · 06.04.2022 | same | 21.10 14:34–14:49 | 21.10 15:04–15:08 (preview run) | surroundings-sync.yml `17 5 * * 2` | CURRENT; first production run 27.10 |
| dd: companies · changes · partnerships · strike-off · receiver · contractors · sites · TLV permits | 18.10–21.10 (contractors 17.08) | same | 18.10–21.10 | 21.10 09:27 | dd-sync.yml `23 4 * * 0-4` | CURRENT (RECOVERED after 20.10) |

**Schedules fire, but late.** Daily crons fire 4–7 hours after their cron time, for example `41 2 * * *` at 07:10–09:43 UTC. The three-hourly
detector fired every 4.5–7 hours: on 20.10 at 19:20 and 23:56, and on 21.10 at 04:58, 11:59, 17:19 and 21:48. These delays come from
GitHub's scheduler, not from the code.

Since each was added, no scheduled production workflow has missed a day that its cron covers.

**Weekly lanes and their first scheduled production runs.** The reference, transport, surroundings, VATMAL and finance lanes reached the
production branch at 19:32 UTC on 21.10 (7d7796d). So far their data comes from push-triggered runs on the preview lane. Their first
scheduled production runs are:
- finance: 22.10
- reference: 26.10
- transport, surroundings and VATMAL: 27.10

## 3. Latest defensible transaction dates

| Date kind | Register copy (over:deals-register) | GovMap copy, recent window (over:govmap-recent) | Union (lib/txevents) |
|---|---|---|---|
| Latest transaction (event date) | **2026-09-17** (Ashkelon) | **2026-09-28** (one Bnei Brak row, property type not stated). Latest DWELLING row: 2026-09-03 | **2026-09-28** for any counted event. Latest dwelling: 2026-09-17 |
| Source copy | scraped 19.09.2026 11:07 UTC | loaded 08.10.2026 01:50 UTC | — |
| Republisher version detected | v5, 19.09.2026 11:20 UTC | v4, 08.10.2026 01:47 UTC | — |
| PROPX ingestion | COMPLETE sweep 19.10.2026 12:40 UTC | window read 20.10.2026 08:00 UTC | built 21.10.2026 09:20 UTC |
| PROPX latest check | 21.10.2026 20:44 UTC (monitor); 08:52 (evidence check) | 21.10.2026 09:19 UTC; version check 21:48 | — |
| State | **STALE**, 32 days (lib/gov/freshness.js) | RECENT, 13 days | — |

**A latest deal is not a complete month.** The register copy holds the following dwelling deals per month:

| Month (2026) | Apr | May | Jun | Jul | Aug | Sep |
|---|---|---|---|---|---|---|
| Dwelling deals | 4,541 | 6,968 | 6,156 | 3,101 | 981 | 72 |

Deals reach the register weeks to months after signing. The GovMap-layer copy adds 4,403 recent-only rows: 3,400 dwelling, 866 with no
property type stated and 137 non-dwelling. None of these rows is priced, because the copy states no ownership share. 0 of them are VERIFIED.

**By district, latest counted event of any kind (latest register dwelling deal):**

| District | Latest counted event (any kind) | Latest register dwelling deal |
|---|---|---|
| South | 2026-09-17 | 2026-09-17 |
| Center | 2026-09-10 | 2026-09-10 |
| North | 2026-09-09 | 2026-09-09 |
| Jerusalem | 2026-09-07 | 2026-09-07 |
| Haifa | 2026-09-07 | 2026-08-27 |
| Tel Aviv | 2026-09-28 (dwelling 2026-09-03) | 2026-08-13 |
| Judea and Samaria | 2026-09-02 | 2026-08-12 |

**The ten localities with the most registered residents** (latest union event of any kind, latest register dwelling deal, latest recent-layer row):

| Locality | Latest union event (any kind) | Latest register dwelling deal | Latest recent-layer row |
|---|---|---|---|
| Jerusalem | 2026-09-01 | 2026-08-24 | 2026-09-01 |
| Tel Aviv-Yafo | 2026-08-30 | 2026-07-26 | 2026-08-30 |
| Haifa | 2026-09-02 | 2026-08-23 | 2026-09-02 |
| Rishon LeZion | 2026-09-02 | 2026-07-21 | 2026-09-02 |
| Netanya | 2026-09-02 | 2026-08-05 | 2026-09-02 |
| Petah Tikva | 2026-09-02 | 2026-07-18 | 2026-09-02 |
| Ashdod | 2026-09-07 | 2026-09-07 | 2026-08-30 |
| Bnei Brak | 2026-09-28 (dwelling 2026-08-31) | 2026-08-02 | 2026-09-28 |
| Beer Sheva | 2026-09-03 | 2026-07-27 | 2026-09-03 |
| Holon | 2026-09-02 | 2026-07-21 | 2026-09-02 |

**Integrity of the current data**, from the deep pass in the JSON's `integrity` section and the stored audits:
- **Pricing:** 214,620 register deals are priced. None of them is a partial share, below ₪100,000, a multi-unit consideration or missing its portion. The union holds 194,141 events PRICED IN STATISTICS, all from the register. No GovMap-layer row is priced or VERIFIED.
- **Ownership share:** 112,587 register deals are partial sales, and none of them is priced. In the recent layer, the promotion states are VERIFIED 0, LIMITED 2,348, CONTEXT_ONLY 1,098, CONFLICT 50 and UNRESOLVED 907. No deal has been confirmed by a newer register copy.
- **Duplicates:** no event id appears twice in any locality. 3,233 possible duplicates are shown and never counted. The recent window holds 1,919 in-source duplicates, 63 possible and 30 ambiguous duplicates.
- **Future dates:** 36 rows are FUTURE_DATED (INVALID, the file's maximum is 2048-05-29). 0 events fall after the copy's load day or after today.
- **Geography:**
  - 2,577 events have unresolved geography, and 710 GovMap-window rows are UNPLACED or POSSIBLE_LOCATION, never attributed.
  - 6,061 register parcels were placed on a street through the GovMap layer: 5,810 OBSERVED and 251 POSSIBLE, and none of them is priced.
- **Completeness:** 0 unexplained union rows, and 0 defensible known source events not surfaced (completeness audit of 20.10.2026 23:14). The stored coverage audit still says **missed 304**. All 304 are folded rows, not missed deals (§5.3).

## 4. Workflow health

| Workflow | Latest production run | Last failure (production) | Root cause | Class |
|---|---|---|---|---|
| txevents-national.yml | 21.10 21:48 success | 20.10 14:14 / 14:25 (39437351911, 39439075385) | The file's camelCase columns did not reproduce the API window, so the build refused to write. A column map was added the same day. | in repo, fixed earlier |
| txevents-national.yml (silent) | — | 21.10 11:59 / 17:19 / 21:48 (39596014029, 39642748425, 39681669082), all reported success | Unchanged checks were never recorded (§5.1), so the Trust Center showed a false STALE. | **in repo, fixed now** |
| street-geo-build.yml | preview only: 21.10 07:09 failure (39560045045) | — | A second push-triggered build conflicted rebasing binary `.json.gz` files, so the build for script 4d7adb2 was never committed (§5.4). | **in repo, fixed now** |
| street-recent-sync.yml | 21.10 09:19 success | 20.10 08:42 (39395354370) | The model-untouched gate went stale after a `tenders.json` change. Fixed the same day by `lib/streets/model-deps.js`. | in repo, fixed earlier |
| cbs-sales-sync.yml | 21.10 17:25 success | 18.10 16:00 (39143071361) | The CBS API returned HTTP 500 to 12 of 22 requests. The run was PARTIAL and the data was kept. It recovered on 19.10. | external |
| dd-sync.yml | 21.10 09:26 success | 20.10 09:31 (39401290154) | data.gov.il `datastore_search` returned HTTP 404 (HTML) for 5 lanes. The data was kept. It recovered on 21.10. | external |
| construction-sync.yml | 21.10 17:36 success | 17.10 23:52 (39080649194), the first manual run | The geography resolution was corrected before the first successful run (39082195857). | in repo, fixed earlier |
| data-sync.yml / tx-refresh.yml | 21.10 07:58 / 08:31 success | — | GovMap returns HTTP 403 every day. nadlan.gov.il shows a reCAPTCHA. nadlan.taxes.gov.il is unreachable. Never bypassed. | external |
| identity-verify.yml / identity-activate.yml | 21.10 21:06 failure | the same runs | The private-identity secrets are not set (SUPABASE_ACCESS_TOKEN, SUPABASE_URL, PROPX_WS_*). This is not activated by design. | configuration (founder) |
| supabase-verify.yml | never run | — | The PROPX Supabase store is not configured. Land runs record `store: not-configured`, and the bundled `data/` serves. | configuration (founder) |
| street-planning-sync.yml · street-geo-build.yml | preview only | — | **No schedule.** The plan statuses and boundaries are as of 21.10 07:21. The street points are not rebuilt when the GovMap layer publishes a new version. | design gap |

Since each was added, all other scheduled production workflows have run on every day that their cron covers. Those workflows are market, data, land,
renewal, tx-refresh, dossier-snapshot, cbs-sales, construction, rental, dd, street-evidence, street-recent, tx-freshness and
txevents-national.

## 5. Fixes made, with tests in `test/freshness-audit.test.js` (18 gates)

1. **The national detector's checks were never recorded.**
   - **Cause:** the commit step measured the last record with `git log -1 -- data/txevents/national/runs.jsonl` in a depth-1 checkout, which returns the branch head for any path. On a branch the syncs write several times a day, that head was always less than 12 hours old, so every unchanged check was skipped. The last record is the build of 20.10 18:55. The Trust Center's 12-hour allowance then read the detector as STALE although it checked on schedule.
   - **Fix:** `lib/txevents/runlog.js` reads the last record from the run log itself, through `scripts/txevents-national.js --record-decision`. The Trust catalogue now allows 24 hours: the 12-hour recording gap plus the observed 4.5–7 hour schedule interval.
   - **Expected effect:** the first scheduled check after merge records a line, and the Trust Center shows the detector as current.
2. **The finance lane had no Trust check date.**
   - **Cause:** its run log dates each run once, with `at`, and `runSummary` never read that field. The lane could therefore never go STALE.
   - **Fix:** `lib/trust/catalog.js` now reads `at` as well.
3. **The coverage audit reported 304 "missed" deals.**
   - **Cause:** since 20.10 17:56, `data/txevents/coverage-audit.json` has reported missed 304. Each of those rows is a GovMap row FOLDED into one of 304 register deals that are filed under unmapped settlement names, placed by parcel and shown in the same read.
   - **Fix:** `scripts/txevents-audit.js` counts folded rows apart, using `lib/txevents/kit.js` `surfaceAccount`.
   - **Result:** recomputed on the stored data, the audit gives **missed 0 · folded 304**. The data file is regenerated by the next street-evidence-sync run, not by hand.
4. **The street-geography build lost its push.**
   - **Cause:** the commit step rebased the binary build onto another build's commit.
   - **Fix:** it now places the run's whole build on the newest branch head. Runs are serialized, so the latest build wins.
   - **Data still to align:** the stored street geography was built by the previous script (c41968b). 22,571 source-neighbourhood street keys in 79 locality files keep the layer's raw `locality × 10,000 + code` form. No reader uses that field today.
5. **A future-dated row was shown as the latest observation.**
   - **Cause:** the Trust catalogue gave the GovMap file's own maximum date, **2048-05-29**, as `over:govmap-national`'s latest observation. That row is future-dated and INVALID.
   - **Fix:** the catalogue now gives the copy's latest deal for the same dataset version, **2026-09-28**, and names the invalid maximum beside it.

New read model: `lib/trust/freshness-audit.js`, which is pure and deterministic, and is exported for the Trust Center and the explain
popovers. New script: `scripts/freshness-audit.js`.

## 6. Workflows to dispatch

- **No transaction dispatch is needed.** There is no NEW_COPY_NOT_SWEPT, NEW_COPY_NOT_READ or NEW_VERSION_NOT_BUILT. The register is v5 (19.09), and the GovMap copy is v4 (08.10) and has been read. The recent layer is reconciled against the register copy PROPX holds.
- **`street-geo-build.yml` (workflow_dispatch on the production branch), optional and low priority.** It aligns `data/geo/street-geo` with the current build script. It makes one GET of the public GovMap-layer file the national detector already reads.
- **Decisions rather than dispatches:**
  - Give `street-planning-sync.yml` a schedule. Plan statuses change continuously, and the boundaries are a one-off build of 21.10.
  - Start `street-geo-build.yml` after a new GovMap-layer version has been built and read by the recent sync. The audit raises STREET_GEO_OLDER_FILE when the file hashes differ.

## 7. Blockers that need the founder

1. **The transaction register is stale at its source.**
   - Evidence:
     - The republished register copy is one scrape, versions v1–v5 between 18.09 and 19.09.2026, and its publisher reports its scraper blocked since then (`lib/recent/AUDIT-ownership-share.md`, `lib/trust/discovery/findings-2026-10-20-transaction-sources.md`).
     - Every version check up to 21.10 21:48 UTC still sees register v5.
     - The official channels refuse the runner: GovMap returns HTTP 403, nadlan.gov.il shows a reCAPTCHA, and nadlan.taxes.gov.il is unreachable (`data/transactions/freshness.json`).
   - Effect: deals after mid-September 2026 reach PROPX only through the GovMap-layer copy, which is unpriced and has no stated share.
   - Decision needed: a licensed or official deals channel.
2. **The housing-lottery source lags.** The MoCH resource was modified on 16.08.2026, but its newest lottery is 27.01.2025.
3. **Store and identity configuration.** The Supabase store is not configured, and the private-identity secrets are not set. Both are by design until activation.
4. **For the integrator: `test/altaris.test.js` fails at 406f4db, before this workstream's changes.** It expects 16 scroll-spy rail items, and the scaffolding commit adds `#changes` and `#dealLab`, which makes 18. This is not a data lane. The owner of `index.html` or the ALTARIS test should update the count.
