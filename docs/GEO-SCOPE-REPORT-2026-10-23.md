# PROPX — Israel National Overview & Geographic Drill-Down · Preview report (23.10.2026)

**Lane:** `claude/street-report-preview` · **commit:** `fd7e9ba` · **Vercel Preview:** deployment `7279713666`, READY at 13:41 UTC
(`kobixrealestate-qri0jlioe-iboks-projects.vercel.app`, behind Vercel Protection like every Preview). **Production untouched** —
`claude/vizora-project-isolation-6lbq3g` carries only today's bot data syncs; nothing from this work is on it. The founder decides.

## What was built

1. **"🇮🇱 ישראל — חזרה למבט ארצי / Israel — National Overview"** at the top of the Overview. One action: clears the selected geography
   (board place, opened street / locality, atlas scope, transactions area) and every section's *geographic* filter (land, housing,
   developers & renewal, pulse), points the dossier, the change feed and the transactions at Israel. Keeps language, theme, the
   navigation order (`propx:nav:v1`), sale / rent, the property filters (rooms · type · area · stage), saved deals, watchlists, theses —
   the journey asserts every `localStorage` key is byte-identical before and after. No reload. The scope chip in the command bar is the
   same reset and now leaves *any* selection (before: an opened street anchored at Israel could not be left from it — a real bug).
2. **One official hierarchy** (`lib/geo/scope.js`, UMD — the page and the server share it):
   Israel → district (7, incl. Judea and Samaria) → subdistrict (נפה, 25 — the official street directory's `region_code` /
   `region_name`, shown "נפת …") → locality (1,316) → verified neighbourhood (53, names only) | CBS statistical area (2,193 census-2022
   rows) → street (57,162 current). Building / address / parcel = evidence *inside* the street report; property = the Deal Lab.
   Neither is a navigable level. Ids are the keys the read models already use (`il` · `d-…` / `js-area` · `napa:<code>` · `loc:<code>`
   · `nb:<id>` · `sa:<loc>:<area>` · `st:<loc>:<street>`). **Nothing is invented:** no subdistrict / neighbourhood / statistical-area
   boundary is held or drawn (the map shows the six Natural Earth district boundaries and locality *points*); a street belongs to its
   locality, never to a neighbourhood; a statistical area has no address key.
3. **The module × level matrix** — the central requirement. Each of 13 modules states, per level, exactly one mode:
   **EXACT** (its own figures) · **AGGREGATED** (its own child records, each once, coverage stated) · **CONTEXT** (the nearest
   wider geography, *named*) · **NOT AVAILABLE** (no source at this level, reason stated) · **NOT APPLICABLE**. A CONTEXT cell must
   name a *wider* level (gated). The matrix documents; it never computes. It is shown under the atlas at every level.
4. **`GET /api/intel?view=scope&id=`** (`lib/geo/scope-read.js`; 400 bad id · 404 unknown · `no-store`): the chain (breadcrumbs,
   one level up), the children, **LATEST KNOWN TRANSACTION** (newest counted event of any source and state — a price only when it is
   priced in statistics) kept apart from **LATEST PRICED RESIDENTIAL TRANSACTION** (newest dwelling priced in statistics), counts,
   census-2022 demographics, the matrix. Israel adds the district comparison (CBS new-home sales and construction starts, trailing
   12 months as published), the 15 largest cities by census population, the verified neighbourhoods and the coverage per level.
5. **The atlas** (`lib/geo/atlas-ui.js`, live build only; the offline build keeps the reset button): breadcrumbs, "one level up",
   the district map (click / keyboard), children tables through the one table standard (sortable, filterable), a street search
   inside the locality, the matrix. It moves every section through the page's *own* doors (board, `openGeoView`, dossier, change
   feed, land / housing / developers / pulse filters, transactions) and follows the page when the geography changes elsewhere
   (search, board, crumbs). **Every section whose geography is not the selected one gets a banner:** "Selected: X · Shown here: Y —
   why" (e.g. a subdistrict: the dossier shows its district; Judea and Samaria: the board has no card). Never a silent substitute.
6. Registry group `geography`: `latest_known_transaction`, `latest_priced_residential_transaction`, `geographic_scope_mode` — each
   with plain words + a worked example in both languages; ⓘ on every new figure. Explain-coverage stays 100 % (962 / 962 labels).

## The national figures (as the API states them on this data)

| | |
|---|---|
| Latest **known** transaction (Israel) | 28.09.2026 · Bnei Brak · 4 rooms · 90 m² · property type not stated · **price not shown** (not used in statistics) · GovMap layer copy 08.10.2026 · state RECORDED_EVENT |
| Latest **priced residential** transaction (Israel) | 17.09.2026 · Sderot Yerushalayim 159, Ashkelon · 4 rooms · 131 m² · ₪2,275,000 · register copy 19.09.2026 · PRICED_IN_STATISTICS |
| Recorded transaction events, stored union | 377,458 (since 14.01.1998) · 88,681 in the last 12 months |
| Population, census 2022 (national row) | 9,601,720 · 3,053,450 households |
| New dwellings sold, Sep 2025 – Aug 2026 (CBS) | 35,721 · construction starts Jul 2025 – Jun 2026: 76,042 |

District comparison, major cities, verified neighbourhoods (53 in 17 localities) and coverage per level are on the page.

## Verified coverage and gaps per level

| Level | Count | EXACT | AGGREGATED | CONTEXT | NOT AVAILABLE | Gaps stated on the page |
|---|---|---|---|---|---|---|
| Israel | 1 | 11 | 0 | 0 | 1 | transport (read around a street only) |
| District | 7 | 10 | 1 | 0 | 1 | Judea and Samaria: no board card, no CBS Table 2.2 row, no boundary — stated; transport |
| Subdistrict | 25 | 1 | 3 | 6 | 2 | no official boundary; prices / trends / supply / planning / risks / changes = the district, labelled; 56 localities carry no subdistrict in the official file |
| Locality | 1,316 | 10 | 0 | 1 | 1 | trends = CBS district series ("not the locality's figure"); board card only for the 40 curated cities |
| Verified neighbourhood | 53 | 2 | 0 | 6 | 2 | names only; transactions / prices / demographics = the locality, labelled |
| Statistical area | 2,193 | 2 | 0 | 2 | 6 | census figures only; no address key → no transactions |
| Street | 57,162 | 11 | 0 | 1 | 1 | demographics = locality context; supply not keyed to a street |

(Deal Lab is NOT APPLICABLE above street level; "sources & freshness" is EXACT everywhere.)

## Tests

- `test/geo-scope.test.js` — **24 gates**: the matrix rules (one mode per cell, CONTEXT names a wider level, no invented precision),
  every official locality in exactly one district and the districts' children covering the directory once, Israel = the stored
  union's national newest event, priced ≤ known at every level, a subdistrict's pruned search = reading every locality, the
  neighbourhood → locality CONTEXT, the statistical area → NOT AVAILABLE, census sums with n of N, no polygon in any read, the API
  (200 · 400 · 404 · no-store), the reset's semantics in the page source, the offline build (atlas stripped, reset kept).
- `test/geo-scope.browser.js` — **11 journeys** (Playwright on the dev server, this commit): the eight listed tests —
  1 reset from a street · 2 reset from a city (chip) and a neighbourhood (button) · 3 the national level is Israel in every section
  · 4 district → subdistrict → city → neighbourhood → street with every section following · 5 Judea and Samaria + a statistical area
  (stated, never substituted) · 6 latest known ≠ latest priced residential, as the API states · 7 search, the navigation editor,
  the Deal Lab, one level up, no page error · 8 Hebrew / English × desktop / phone (a mobile layout viewport that widens = failure).
- The whole suite: **73 / 73 files pass**. Two files had drifted with the 22.10 data syncs (`changes`, `freshness-audit` — literal
  day counts / a frozen run date) and were made to derive from the stored data; `overnight-qa` caught the reset's change-feed call
  in the offline build → wrapped in `/* live:begin … live:end */`.

## Screenshots (sent with this report; not committed — the repo is public)

`he-desktop-1-israel` · `2-district` · `3-subdistrict` · `4-locality` · `5-neighbourhood` · `6-street` · `7-after-reset` ·
`8-judea-samaria` · `en-desktop-israel` · `en-desktop-locality` · `he-phone-israel` · `he-phone-locality` · `en-phone-israel` ·
`en-phone-locality`.

## Not done / honest limits

- Statistical areas carry **census figures only** — no boundary, no address key, so no transactions / prices at that level.
- A subdistrict has **no period count** (the per-day tally exists for Israel and the districts only) — shown as "—", never estimated.
- The Preview deployment could not be probed from this session: the sandbox network policy refuses `*.vercel.app` (CONNECT 403 from the
  proxy), and Previews also sit behind Vercel Protection. GitHub records deployment `7279713666` for `fd7e9ba` as **success / READY**;
  the 24 gates and the 11 browser journeys ran against the local build of that same commit.
- The preview lane is behind Production by today's bot data syncs only (merge before release, as before).
