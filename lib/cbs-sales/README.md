# PROPX · CBS new-home sales — the official monthly series

PROPX's new-home sales figures for the **country and its 7 districts** come from the Central Bureau of Statistics
time-series API. This folder reads that series, keeps every published value, and derives the metrics the board shows.

## What CBS publishes (verified 13.10.2026 on a GitHub runner, `scripts/cbs-sales-discover.js`)

| | |
| --- | --- |
| API | `https://apis.cbs.gov.il/series/data/path?id=<path>&startperiod=MM-YYYY&endperiod=MM-YYYY&format=json&lang=he` |
| Catalogue | subject 44 "בינוי ונדל"ן" → 44,10 "דירות בעסקאות נדל"ן" |
| New dwellings sold | `44,10,2,1,<geo>` — 5069 total (incl. unknown district), 5070 Jerusalem, 5071 North, 5072 Haifa, 5073 Center, 5074 Tel Aviv, 5075 South, 5076 Judea & Samaria (Israeli localities) |
| Of which subsidized | `44,10,2,2,5069` |
| Remaining for sale | `44,10,4,,5069` (national only) |
| Months of supply | `44,10,5,,5069` (national only; CBS's own measure, average based on trend data) |
| Fields | per series: `id`, `time` (3 month / 1 year), `data` (1 original / 2 seasonally adjusted / 3 trend / 371 trend average), `unit`, `path.name_id` (the CBS geography code), `update` (series update date), `obs[{TimePeriod:"YYYY-MM", Value}]` |
| Unit | number of new dwellings sold in the month (original data) — the first sale of a new dwelling, government-subsidized sales included; compiled from the deals reported to the Tax Authority |
| Cadence | monthly; a media release about six weeks after the month ends (2026: Jan → 12.03 … Jul → 10.09, Aug → 14.10) |
| Depth | monthly from 2016-01 in PROPX's read (annual totals too) |
| Revisions | recent months are revised in later releases; the API carries only the current value — PROPX keeps every version it has seen |

**There is no city series.** CBS publishes new-home sales by locality only inside the monthly media-release PDF
("לוח ב — היישובים שבהם נמכרו יותר מ-150 דירות"): rolling three-month windows, only localities above 150 sales,
locality names rather than codes, no Excel or API equivalent found, and release pages that do not list their
attachments to a non-browser client. That is not a machine-readable source, so it is **not ingested** (Trust Center:
`cbs:new-home-sales-by-city-pdf`, NOT_MACHINE_READABLE). The one city figure on the board — Tel Aviv-Yafo H1 2026,
release 252/2026 (820 + 1,236) — is a labelled transcription (`TX_BASIS` in `index.html`).

## Files

| File | Role |
| --- | --- |
| `series.js` | the source, the geographies (CBS code → board row), the measures, the request plan (2016 →, ≤ 6-year windows) |
| `parse.js` | one response → observations; checks branch and geography against the request; missing ≠ 0 |
| `ledger.js` | append-only ledger: revision 0 on first publication, revision n+1 when CBS changes a value; nothing deleted |
| `metrics.js` | T3 / T6 / T12, YTD and prior-year YTD, annualised pace, momentum, acceleration, volatility, low sample, freshness, reconciliation |
| `snapshot.js` | the page payload (`data/cbs-sales/latest.json` + `latest.js`); a failed series keeps its last payload, marked stale |
| `scripts/cbs-sales-sync.js` | the sync (`--dry-run`, `--validate` re-reads CBS and compares the stored values) |
| `.github/workflows/cbs-sales-sync.yml` | every working day 12:23 UTC; dispatch modes sync / dry-run / validate |
| `data/cbs-sales/` | `observations.jsonl` (ledger), `raw/` (response bundles per content hash), `latest.json` / `latest.js`, `runs.jsonl` — written by the workflow, never by hand |
| `test/cbs-sales.test.js` | the lane's gates; `test/sales-metrics.test.js` gates the page |

## Metrics (all over the published original monthly counts)

- **OFFICIAL** — a month as published.
- **DERIVED** — 3 / 6 / 12-month totals and YTD (every month present, else unavailable with the month named);
  prior-year YTD (the same months a year earlier); annualised pace = YTD × 12 ÷ months (from March; earlier T3 × 4) —
  a rate, never shown as a count; momentum (T3 vs the 3 months before, T6, T12 vs a year earlier, YTD vs prior YTD),
  acceleration (3-month momentum now − 3 months ago), volatility (coefficient of variation of the last 12 months).
- **Low sample** — under 30 sales in three months: the count and period stay, no trend signal.
- **Freshness** — CURRENT (the next month cannot be out yet: ≤ 35 days after it ends) · EXPECTED_REPORTING_LAG (its
  release is due: 35–75 days) · STALE (later). A normal publication delay is never "stale".
- **Reconciliation** — national (which includes an unknown district) vs the sum of the 7 districts; the residual is
  reported, never forced. CBS 2025 = 33,833 against the Tax Authority / Chief Economist 34,000 (same population).

## What the board does with it

Country and district rows show the 12-month total (OFFICIAL, months named); the evidence view adds the monthly values,
YTD, pace, momentum, reconciliation and the three dates (observation period · source update · PROPX check). Cities,
neighbourhoods and every filtered view show "—" (Tel Aviv-Yafo: the labelled transcription). The capital model reads no
sales pace at all. ALTARIS shows the national and the deal's district context, read-only.
