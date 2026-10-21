# Housing finance (`lib/finance`) — Bank of Israel SDMX

Added 21.10.2026 under the master data directive (M5): the official housing-credit figures of the whole banking system, read from
the Bank of Israel's own SDMX service (`edge.boi.gov.il/FusionEdgeServer/sdmx/v2/`, keyless, GET only). Discovered and verified on a
GitHub runner the same day (`lib/trust/discovery/2026-10-21-universe/boi2.json.gz`, run 39605350990).

## What is read

| flow | measures |
|---|---|
| `BIR_MRTG_99` — new housing loans | amount (+ seasonally adjusted) · number · average payment-to-income · interest: fixed unindexed, fixed CPI-indexed, CPI-indexed (all) · variable tracks as their ANCHOR and MARGIN (published apart, never summed) · amount by track · loans for an investment dwelling · loans for reduced-price housing · refinanced loans · loan-to-value bands (≤ 30 % … > 90 %, without collateral) · payment-to-income bands |
| `BMB_99` — balances | outstanding housing credit (households) · number of loans · in arrears ≥ 90 days · outstanding by track |

Not read: `REAL_ES_DF` (the CBS dwelling-price indices republished — REDUNDANT with the CBS sync), `BR` (the policy rate — the same
3.25 % the market sync reads from the Bank's public API: a second channel, REDUNDANT), `DEBT_AGG` (household debt aggregates — macro, not
housing-specific). The variable UNINDEXED (prime) track's rate is not published in `BIR_MRTG_99` (only its balloon sub-track) — the two
measures are NOT PUBLISHED, shown as such, never 0.

## Rules

- **Codes select, names verify.** Each measure is a set of dimension codes (`series.js`); every code is checked every run against the name
  the Bank's published codelist gives it (`VERIFY`). A changed name, a missing code, no series or several series under the codes →
  the measure is not read (SCHEMA_CHANGED / NOT_PUBLISHED, named in the run) and its stored data is kept.
- **Units.** Amounts in ₪ after the series' own unit multiplier (thousands × 1,000); counts; rates and ratios in % (changes in
  percentage points). A missing observation is skipped, never 0.
- **Ledger.** `data/finance/observations.jsonl` — append-only; a revised value is a new revision with the value it replaces (the CBS
  ledger logic, `lib/cbs-sales/ledger.js`). `latest.json` per measure: latest month, the month before, a year earlier, the change.
  Raw CSV per content hash (`raw/`), `sync-runs.jsonl` (SUCCESS · UNCHANGED · PARTIAL · FAILED · REFUSED · SCHEMA_CHANGED).
- **Derived, named.** Loan-to-value / payment-to-income shares inside ONE month over the published bands; investment-dwelling and
  reduced-price shares of new loans, arrears share of the stock, average new loan — each on the latest month BOTH series hold, class
  DERIVED with its formula.
- **Freshness** on a documented lag (not an official calendar): CURRENT ≤ 75 days after the month · EXPECTED_REPORTING_LAG ≤ 120 ·
  STALE beyond.
- **Scope.** National banking-system figures only — never shown as a locality or district figure; a rate is the average on loans
  issued in the month, never an offer to a borrower.

## Sync

`scripts/finance-sync.js` (`--dry-run`, `--summary-file`) via `.github/workflows/finance-sync.yml` (Sun–Thu, and on a push to the
preview lane that changes this code); the offline gates (`test/finance.test.js`, on the labelled fixture
`test/fixtures/boi-finance-2026-10-21.json`) run first; only `data/finance/` is committed; one request a second.
