# Transaction source inventory — 20.10.2026

Runner runs: inventory `39437378661`, regression case BEFORE `39437364661` (`scripts/tx-sources-discover.js`, GET only, never bypassed).
Machine-readable ledger: `2026-10-20-transaction-sources.json`.

## Read by PROPX

| Source | Class | Latest deal | Copy |
|---|---|---|---|
| Tax Authority register — republished copy (over.org.il, dataset fd06f5ae…) | THIRD-PARTY REPUBLICATION OF OFFICIAL DATA | 17.09.2026 | scraped 19.09.2026 (v5); the publisher reports its scraper blocked since; central-Jerusalem blocks missing by its own log (13.10.2026) |
| GovMap deals layer 16 — republished copy (over.org.il, dataset 4174aac2…), API window + the version's whole GeoPackage | THIRD-PARTY REPUBLICATION OF OFFICIAL MAP / GIS LAYER · DOCUMENT / FILE SOURCE | 28.09.2026 | v4 loaded 08.10.2026; file 709,758,976 bytes, 2,500,941 rows, validated 11,900 / 11,900 against the API window |
| נדל"ן לעם address ↔ parcel crosswalk (over.org.il /api/nadlan/*) | OTHER PUBLIC TRANSACTION EVIDENCE | as the register | the register's own rows — not a third source of deals |

## Reached, not read (and why)

| Source | Answer today | Why not read |
|---|---|---|
| nadlan.taxes.gov.il (the Tax Authority's own register) | fetch failed from the runner (identification screen since 29.09.2026) | access control — never bypassed |
| nadlan.gov.il (+ its REST path) | 200, a static page with reCAPTCHA Enterprise | anti-bot screen — never bypassed |
| gov.il service page | 403 Cloudflare | bot screen |
| GovMap layer 16 page + API, ags.govmap.gov.il | 403 CloudFront · fetch failed | the edge refuses — read through its republication instead |
| data.gov.il | 0 packages for every transaction query | no deal-level dataset is published |
| odata.org.il "nadlan" (התמנון) | 3 parts ≈ 1.07 M deals, latest deal 31.12.2023, modified 28.04.2026 | stale — adds no recent deal |
| odata.org.il [Versions] register pointer (967c44db-4918-…) | 0 resources | a pointer only |
| the register version's per-locality CSV files (R2) | listed | the same copy the sweep holds; older history comes through the live search |
| municipal GIS (Tel Aviv · Jerusalem · Haifa) | 9 services none deal-like · 403 · 404 | no municipal transaction layer |
| Apify GovMap / nadlan.gov.il scrapers, BYNDbiz | not called | paid / commercial; a third party reading channels that refuse PROPX would route around those refusals |
| Madlan / Yad2 | not called | asking prices — never transaction evidence |

## Regression case (BEFORE, production code on the runner)

Petah Tikva / Shaham (`st:7900:156`): 24 months → 39 rows, newest **05.07.2026**; 30 and 90 days → 0 rows and no statement; 6 months →
1 row. The GovMap layer on the same street: 30.08 · 12.08 · 03.08 · 29.07 · 14.07.2026. Why: the section read only the register's live
search; the new towers' parcels (6393/344 · /346 · /347 · /348 · /350 · /351 · /353) have no address in the register's crosswalk.
