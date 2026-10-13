# PROPX · Official market indicators — daily sync

The market tape, the national annual change and the national insights follow
official figures that are re-checked **every day**, instead of a one-time
retrieval baked into the page.

```
GitHub Actions (daily 03:17 UTC, .github/workflows/market-sync.yml)
  └─ node scripts/market-sync.js
       ├─ lib/market/sources.js   Bank of Israel  www.boi.org.il/PublicApi/GetInterest
       │                          CBS index API   api.cbs.gov.il/index/data/price{_all}
       ├─ lib/market/snapshot.js  merge · stale marking · no backwards periods
       └─ writes data/market/latest.json + latest.js (+ snapshots/ history)
  └─ commits data/market/ → Vercel redeploys → index.html loads /data/market/latest.js
```

| Indicator | Source | Shown in |
|---|---|---|
| `boiRate` | Bank of Israel public API (`currentInterest`, `nextInterestDate`) | tape tile, national insight |
| `newHomesIndex` | CBS new-homes price index (series 70000) — y/y over a two-month window, dated by its first month | tape tile, national annual change (KPI), insights, provenance panel |
| `dwellingsIndex` | CBS dwelling-price index, all dwellings (series 40010) | stored for history; not displayed yet |
| `constructionInputsIndex` *(optional)* | CBS "מדד מחירי תשומה בבנייה למגורים" (series 200010) — monthly, y/y | reference line in the new-home indexation tool; ALTARIS context; Trust Center |
| `cpi` *(optional)* | CBS "מדד המחירים לצרכן - כללי" (series 120010) — monthly, y/y | ALTARIS context; Trust Center |
| `rentIndex` *(optional)* | CBS CPI component "שכר דירה פרטי, ציבורי ושכירות ארוכת טווח בפיקוח ממשלתי" (series 120460) — an index, not a rent level | Trust Center |

Optional series (added 13.10.2026, verified by the workflow's own dry run / `--discover` the same night) are found by
name like the others and dated monthly (`periodKind: 'monthly'`, their own staleness limit). A failure is recorded in
`failures` with `optional: true` and a held value is kept and marked stale — but the run stays "ok" and the daily job
does not turn red for them. A series never held is absent, never 0.

District indices (`dwellingsByDistrict`, all dwellings by CBS district) are merged one district at a time: a district
that fails keeps its last good value marked `stale` with `lastError` / `lastGoodAt`, the indicator carries
`partial: true` + `failedDistricts`, and the run lists a `partial` failure. Every y/y carries `yoyBasis`:
`published` (the CBS percentYear) or `computed` (PROPX's level ÷ level 12 months earlier) — the page tags a computed
district y/y DERIVED, never official.

## Rules the code enforces

- **Official endpoints only** — the purity gate in `test/market.test.js` fails the
  build if `data/market/latest.json` carries any other source.
- **Discovered, not hardcoded** — CBS series are found by name in the CBS index
  API; district, subsidized ("דירה בהנחה") and second-hand variants are rejected.
- **Validated** — implausible values, dead series (no point in 9 months) and
  periods that move backwards are refused.
- **Fail visible, never fake-fresh** — a source that fails keeps its last good
  value marked `stale` with the reason; the page then shows the date it was last
  checked, and the run turns red. The tape's "checked" date is the *oldest*
  check among the values on screen.
- **Page fallback** — with no valid snapshot the page keeps its own dated
  published figures; a live CBS period older than the published one never
  replaces it.
- **History** — `data/market/snapshots/indicators/` gains an entry only when the
  data itself changes; the daily commit otherwise just refreshes `checkedAt`.

## Not automated yet

City / district / neighborhood figures, unsold inventory, contractor sales and
the trend note come from periodic reports without a stable official API; they
keep their published dates (e.g. "נשלף: 30.08.2026") until updated.

## Run it

```bash
node scripts/market-sync.js --dry-run --discover   # fetch + print, list CBS series
node scripts/market-sync.js                        # write data/market/
node test/market.test.js                           # offline suite
```

Needs a machine that can reach `boi.org.il` and `api.cbs.gov.il` — GitHub
Actions, Vercel or a workstation. (The Claude sandbox cannot: its egress policy
blocks both hosts.) To run the workflow by hand: GitHub → Actions → "Daily
market data sync" → Run workflow (tick *dry run* to fetch without committing).
