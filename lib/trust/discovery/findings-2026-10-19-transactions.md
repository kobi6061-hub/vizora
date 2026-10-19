# P0 transaction freshness & real-deal audit — 19.10.2026

Read-only, from the repository's GitHub runner (the sandbox reaches no Israeli host). Runs: official channels 39327144424 ·
republished copies 39327147436 · city comparison 39329664397 (`scripts/tx-freshness-discover.js`); first daily monitor
39333533849 (`scripts/tx-freshness.js` → `data/transactions/freshness.json`). Structured ledger: `2026-10-19-transactions.json`.

## 1 · Current state (stored universe)

| | |
|---|---|
| Register source | Tax Authority deals register, republished by over.org.il (dataset `fd06f5ae…`, table `append_taxes_nadlan_full_…`) — not a government channel |
| Source snapshot date | `scraped_at` 2026-09-19 11:07 UTC — unchanged at every check since (latest 19.10.2026) |
| Latest transaction in the copy | 2026-09-17 |
| Latest transaction ingested by PROPX | 2026-09-17 (sweep COMPLETE 1,036 / 1,036 localities, stored 19.10.2026) |
| Publication date of a deal | not stated by any channel PROPX reads |
| Copy age / latest-deal lag on 19.10.2026 | 30 days / 32 days → state **STALE** |

Latest observed dwelling deal — Israel 17.09.2026 · districts: South 17.09 · Center 10.09 · North 09.09 · Jerusalem 07.09 ·
Haifa 27.08 · Tel Aviv 13.08 · cities: Ashdod 07.09 · Jerusalem 24.08 · Haifa 23.08 · Netanya 05.08 · Be'er Sheva 27.07 ·
Tel Aviv-Yafo 26.07 · Rishon LeZion 21.07 · Petah Tikva 18.07. Streets: the busiest streets' latest deals fall in May–July 2026.

Dwelling deals by transaction date — to today (19.10): 7 d — · 30 d — (after the copy: no count) · 60 d 249 · 90 d 1,821 ·
180 d 19,239 · 365 d 64,211; to the copy's end (17.09): 7 d 2 · 30 d 294 · 60 d 1,936 · 90 d 6,202 · 180 d 25,217 · 365 d 68,921.
Monthly (reporting lag inside the copy): Apr 4,541 · May 6,968 · Jun 6,156 · **Jul 3,101 · Aug 981 · Sep 72** (normal ≈ 7,500).

## 2 · Official channels

| Channel | Answer on the runner | Verdict |
|---|---|---|
| nadlan.taxes.gov.il (the register) | connection fails ("fetch failed"); identification screen since 29.09.2026 | BLOCKED — not bypassed |
| nadlan.gov.il | HTTP 200, loads Google reCAPTCHA Enterprise in front of its data | BLOCKED — CAPTCHA not bypassed |
| govmap.gov.il (deals layer 16) | CloudFront 403 "Request blocked" (site + API); daily tx-sync REFUSED 60 / 60 runs since 01.10 | BLOCKED — not worked around |
| data.gov.il | 0 datasets for 7 searches | none exists |

No official channel is machine-readable for PROPX, so no deal could be checked against it directly. The comparison below uses
the second independent extraction that IS readable: the GovMap layer-16 copy republished by over.org.il (loaded 08.10.2026,
latest deal 28.09.2026, 2,500,941 deals, version 4).

## 3 · Register copy (PROPX) vs GovMap-layer copy — 8 cities, 18.09.2025 → 19.10.2026

Key: block · parcel · date (±1 day) · amount (₪1,000 truncation) · area. 29,410 GovMap rows · 22,560 PROPX dwelling rows.

| Class | Count |
|---|---|
| Same deal, every field equal | 7,787 |
| Same deal, amount truncated to ₪1,000 by GovMap | 508 |
| Same deal, FIELD DIFFERENCE | 11,236 — sub-parcel numbering 8,721 · amount = a share of the property 1,669 · rooms 900 · amount 74 · area 39 · date ±1 36 |
| Possibly the same deal (another parcel) | 48 |
| MISSING IN PROPX — reported late (dated ≥ 04.07.2026) | **2,293** |
| MISSING IN PROPX — older | 7,523 (dwelling-typed 2,002 · untyped 5,013, largely the GovMap copy's second id series · land / building 508) |
| Future-dated at source (as published) | 15 |
| EXTRA IN PROPX (register dwelling deals not in the GovMap copy) | 4,387 (sampled 96 → 79 not in the copy at all) |

Latest deal (GovMap copy / PROPX): Petah Tikva 02.09 / 18.07 · Tel Aviv-Yafo 30.08 / 26.07 · Jerusalem 01.09 / 24.08 · Haifa
02.09 / 23.08 · Be'er Sheva 03.09 / 27.07 · Rishon LeZion 02.09 / 21.07 · Netanya 02.09 / 05.08 · Ashdod 30.08 / 07.09.
Last 90 days to today (GovMap / PROPX): 189/0 · 209/1 · 200/10 · 384/55 · 263/6 · 133/0 · 185/18 · 159/7.

Neither copy is a superset of the other. The GovMap copy is newer and fuller for July–September 2026; it has defects
PROPX would have to handle before reading it (a second deal-id series one day earlier without a property type, future dates,
₪1,000 truncation, its own sub-parcel numbering, ≈84,000 rows without a settlement, 500 deals per point).

## 4 · Root cause

SOURCE SNAPSHOT STALE + SOURCE REPUBLICATION LAG: the only readable copy of the register has not changed since 19.09.2026,
and every official channel refuses automated reading (the register's identification screen of 29.09.2026 is the likely reason
the republisher has not refreshed — not proven). On top: the register's own REPORTING LAG (deals arrive weeks to months after
signing). Not the cause: date filters, the shard window (it ends on the copy's latest deal by design), street matching, dedup,
locality mapping, caching. Contributing PROPX defects, fixed: no freshness on transaction surfaces; an empty recent period read
as "no deals"; the sweep's storage date labelled a "check"; offline re-matches shown as a FAILED check in the Trust Center; a
weekly (now daily) copy check.

## 5 · What changed in PROPX

`lib/gov/freshness.js` (five dates apart, states CURRENT ≤ 7 d · RECENT ≤ 21 · STALE ≤ 45 · VERY STALE > 45 · SOURCE LAG
UNKNOWN, "no recent" semantics, never-backwards guard), the daily monitor, daily evidence check, freshness strip + STALE banner
on Street Intelligence and the transactions section, 30 / 90-day periods, deal table property type + block/parcel/sub + source,
Trust Center state / alerts, 21 gates + 96 pinned real deals (`test/tx-freshness.test.js`).
