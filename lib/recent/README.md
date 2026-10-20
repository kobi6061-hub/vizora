# Recent transactions layer (`lib/recent`, 20.10.2026)

The register copy PROPX reads (the Tax Authority register republished by over.org.il, `data/streets/evidence/`) stopped
changing on 19.09.2026; its latest deal is 17.09.2026. A NEWER copy exists: the GovMap deals layer (lay=16), republished by
the same publisher (dataset `4174aac2…`, loaded 08.10.2026, version 4, latest deal 28.09.2026). This layer reads that copy as
a **separate recent-evidence source** — never a replacement for the register copy:

- the register copy stays the primary universe: the street median, the sample state, the 12-month change, the freshness
  strip and the Street Value Model read **only** the register (`lib/streets/evidence.js`, the model files and
  `scripts/street-model-build.js` never require this module);
- the recent layer shows only the deals the register copy does **not** hold yet, in their own dashed block.

## Files

| File | What it is |
|---|---|
| `window.js` | the window: 75 days before the register copy's latest deal → the GovMap copy's load day |
| `reconcile.js` | the deterministic reconciliation (every fetched row → one class), the build, the exact replay of the 2,293 |
| `read.js` | the read the API and the page use (`forStreet`, `forLocality`, `summary`, `readsCopy`) + the safety gate |
| `../../scripts/street-recent-sync.js` | `--fetch` (runner, read-only), `--audit-replay` (runner, once), `--reconcile [--force]` (offline) |
| `../../.github/workflows/street-recent-sync.yml` | daily 04:07 UTC: fetch if the copy changed → reconcile → `test/recent.test.js` → commit |
| `../../data/streets/recent/` | `raw/<sha16>.jsonl.gz` + `raw/index.json` (the window verbatim, hash + paging proof) · `audit/replay-v4.*` · `meta.json` · `layer.json` · `reconciliation.json` · `audit-2293.json` · `sync-runs.jsonl` |

## Reading the copy

GET only, one request a second, an honest User-Agent. Any date filter makes the source answer HTTP 500, so the window is read
newest first (`sort=date_desc`, 200 rows a page, 50-row overlap between pages — every overlap must agree, and the first page
is read again at the end and must be identical; otherwise nothing is stored). The read stops at the first page that ends 6
days before the window (context rows for matching). First read 20.10.2026: 11,900 rows, 79 pages, 78 overlap checks, 0
disagreements, 81 requests. When the copy's `loaded_at` / version are unchanged the daily run reads nothing.

## The reconciliation (each fetched row exactly one class)

Placement: the settlement name (the register's own spellings per locality code, the official locality name, four documented
GovMap spellings — `GOVMAP_NAMES`); a row whose name places nothing is placed by its block · parcel when exactly one
locality's register copy lists that parcel.

| Class | Rule | Shown |
|---|---|---|
| CONTEXT_BEFORE_WINDOW | dated before the window — matching context only | no |
| FUTURE_DATED | dated after the copy's load day (the copy publishes dates up to 2048) | no |
| NO_SETTLEMENT / UNMAPPED_SETTLEMENT | not placeable | no |
| DUPLICATE_IN_SOURCE | an untyped row (the copy's second deal-id series `1136…`, no property type) repeating ONE typed row: same locality · block · parcel, amount within ₪1,000, area within 5 %, rooms within ½, the same day or one day earlier — or (`via: register-amount`) its exact amount is a register deal on the same parcel within a day that another row already holds | no |
| AMBIGUOUS_DUPLICATE / POSSIBLE_DUPLICATE_IN_SOURCE | several candidate twins / a typed row of the same parcel, amount within ₪1,000, within 3 days whatever the area and rooms | no |
| IN_REGISTER | the same unit (the row's or its twin's) within one day, the amounts agreeing | no |
| IN_REGISTER_OTHER_UNIT | the same block · parcel within one day, the amounts agreeing (₪1,000 truncation or a share, the area to the metre; or equal to the shekel) | no |
| POSSIBLY_IN_REGISTER | the same unit with another amount · the same parcel with a rounded amount · another parcel the same day with the same amount · area · rooms | no |
| RECENT_NEW | placed, valid, recent, not in the register copy | **yes** (DWELLING · TYPE NOT STATED · NON-DWELLING apart) |

The registers searched: the row's own locality, then every other locality whose register copy holds a deal on the same block ·
parcel (30 rows sit in a neighbour's register). Two passes — every amount-agreeing match first, the weak ones after — so a
"possibly" never takes a deal a sure match needs; a register deal absorbs at most one row; rows are processed in one
canonical order (date newest first, then object id), so the result does not depend on the source's order (gate). The
register's fields are never overwritten: every disagreement is recorded beside both values (`conflicts`: sub-parcel 1,984 ·
amount truncated 906 · amount = a share 246 · date 74 · rooms 73 · locality 30 · amount differs 11 · parcel 4 · area 2).

**20.10.2026 — 11,900 rows:** CONTEXT 2,199 · FUTURE_DATED 36 · NO_SETTLEMENT 37 · UNMAPPED 1 · DUPLICATE 1,919 · AMBIGUOUS 30 ·
POSSIBLE DUPLICATE 63 · IN_REGISTER 1,249 · IN_REGISTER_OTHER_UNIT 1,953 · POSSIBLY_IN_REGISTER 10 · **RECENT_NEW 4,403**
(dwelling 3,400 · type not stated 866 · non-dwelling 137) in 133 localities, latest 28.09.2026; on a street 2,645 (address
1,542 · address + parcel 1,048 · parcel 55), 1,738 streets. (DUPLICATE includes 16 `register-share` rows: the copy prints a partial
sale twice — once as the share's amount, once as the whole property's value — and only one of them is the register's deal.)

Dates: the typed series carries the register's date (3,160 of 3,172 verified pairs the same day); the untyped series is one
day earlier in 30 of 30 — stated beside every "type not stated" row.

## The 2,293 (exact)

The 19.10.2026 eight-city comparison (`scripts/tx-freshness-discover.js --compare`, run 39329664397) counted 2,293 GovMap
deals dated ≥ 04.07.2026 missing from the register copy. `--audit-replay` stored that comparison's own input (per city, per
settlement spelling, newest first, down to 28.06.2026 — an older row matches only register deals within a day of its own
date, so it can never take a deal a late row needs) and `auditClassify` replays its classifier verbatim:

| City | Compare | Replay | New dwelling | Type not stated | Non-dwelling | In-source duplicate | Ambiguous / possible dup. | In register |
|---|---|---|---|---|---|---|---|---|
| Petah Tikva | 251 | 251 | 190 | 20 | 1 | 37 | 2 | 1 |
| Tel Aviv-Yafo | 334 | 334 | 159 | 96 | 6 | 72 | 1 | 0 |
| Jerusalem | 311 | 311 | 230 | 20 | 12 | 48 | 1 | 0 |
| Haifa | 420 | 420 | 299 | 10 | 4 | 97 | 8 | 2 |
| Be'er Sheva | 351 | 351 | 273 | 17 | 0 | 58 | 3 | 0 |
| Rishon LeZion | 200 | 200 | 129 | 42 | 7 | 17 | 1 | 4 |
| Netanya | 211 | 211 | 122 | 32 | 5 | 51 | 1 | 0 |
| Ashdod | 215 | 215 | 152 | 13 | 0 | 49 | 0 | 1 |
| **Total** | **2,293** | **2,293** | **1,554** | **250** | **35** | **429** | **17** | **8** |

The 8 the comparison called missing that ARE in the register: 4 filed under a neighbouring locality (Rishon LeZion → Be'er
Ya'akov), 3 whose register deal the comparison's one greedy pass gave to another row's weaker match, 1 with a rounded amount
(POSSIBLY_IN_REGISTER). `audit-2293.json` lists every one of the 2,293 with its class and, where it is in the register, why.

## Safety gate

`read.js` shows the layer only while `meta.register` (scrapedAt + latestDeal) equals the register copy PROPX holds now. A new
register sweep makes the stored layer stale → the page lists nothing ("reconciled against another register copy") until the
reconciliation runs again — the evidence workflow reconciles right after a sweep, and the daily recent workflow does too. A
build with the same inputs (snapshot, register copy, replay, engine code) writes nothing.

## Surfaces

`GET /api/intel?view=street` → `recent` (the street's block); `view=recentLayer` (summary) · `view=recentLayer&city=<code>`;
the Street Intelligence page: a dashed SEPARATE LAYER line under the freshness strip + its own table in the five-minute read
(dwelling deals; "no property type" and "non-dwelling" folded apart); the freshness strip's newer-copy note says the copy is
read as a separate layer; Trust `over:govmap-recent` (integrates `discovery:over:govmap-layer`); registry terms
`recent_transaction_layer`, `recent_transaction_type_not_stated`, missing reason `recent_layer_unavailable`; the daily
freshness monitor marks the copy `readByPropx` and raises MATERIAL_LAG `newer-copy` only for a copy the layer has not read.
Gates: `test/recent.test.js` (22).

## Promotion (20.10.2026, `lib/recent/promote.js` → `promotion.json`)

Which shown rows may take part in PROPX's factual statistics — decided per row, stored beside it, read by NO statistic yet. The
first rule a row meets decides its state:

| State | Rule | 20.10.2026 |
|---|---|---|
| RECENT_CONFLICT | settlement name vs the register's parcel list (9) · published address vs the parcel crosswalk (31) · POSSIBLE DUPLICATE of a register deal in the same-parcel audit (10) | 50 |
| RECENT_UNRESOLVED | no property type (858) · an address that resolves to no street / several / only loosely (55) | 907 |
| RECENT_CONTEXT_ONLY | not a dwelling (136) · no street key at all (1,041 — no address and no single-street parcel) | 1,098 |
| RECENT_OBSERVED_LIMITED | a dwelling deal on a street, but: the street from ONE key (the published address alone — 1,381) and / or the price semantics not established (share sold not stated — every row; below ₪100,000 — 2) | 2,348 |
| RECENT_OBSERVED_VERIFIED | locality · street (two keys, or the register's own OBSERVED parcel rule) · date · dwelling · price · area for ₪/m² · no duplicate / possible duplicate / conflict · **whole-property sale stated** · parcel coherent · provenance | **0** |

**Why nothing is VERIFIED — the share.** The register states the share sold (portion) and never prices a partial sale. The GovMap-layer
copy has no such field. Over the 2,934 dwelling deals both copies hold, 301 (10.3 %) are partial sales in the register, and the copy
prints them as the share's amount (76), as the whole property's value (184) or otherwise (41) — no field, id series, parcel activity
or amount pattern tells them apart (measured: partial-sale share 6.5–11.6 % in every parcel-activity band and every id series). So no
recent-only row can show it is a whole-property sale; none enters a median or a ₪/m² while the copy states no share.

**What each use may read** (`eligible` per row):

| Use | VERIFIED rows | Why |
|---|---|---|
| street transaction count | 0 VERIFIED · **967 RECORDED TRANSACTION EVENTS** | no VERIFIED row. 967 LIMITED rows pass every event gate (`EVENT_GATES`: state · duplicate · dwelling · locality · street · date · provenance — each checked on its own, a failed gate named in `eventFailed`) and are limited only by price semantics — they enter the RECORDED TRANSACTION EVENTS count (`eligible.event`), never the verified or priced counts (see "The three counts") |
| street median / ₪ per m² | 0 | a median needs a whole-property market price — the share is not stated |
| 12-month change | 0 | the change compares two windows of ONE universe; the recent layer covers only its own ~95 days, never the prior window |
| Street Value Model inputs | 0 | a model row needs a whole-property price AND a build year (age band, PROBABLE NEW, off-plan) — the copy states neither |

**The same-parcel audit** (every shown row with a register deal on its block · parcel within one day, 232 rows): per register deal,
amounts that fit the deal's printed form → POSSIBLE DUPLICATE; amount > 2 % and area > 2 % apart → CONFIRMED SEPARATE; one of them
> 2 % → LIKELY SEPARATE; closer → POSSIBLE DUPLICATE, unless another row already prints that register deal (→ LIKELY SEPARATE); the
largest difference between the copies over the 2,723 whole-property deals both hold is 1.85 % (amount) / 1.92 % (area) — no same-deal
pair exceeds the 2 % tolerances. The 49 cases reported on 20.10.2026 (a register deal no row prints, at another price): case verdicts
CONFIRMED SEPARATE 19 · LIKELY SEPARATE 26 · POSSIBLE DUPLICATE 4 · UNRESOLVED 0 — every case listed in `AUDIT-same-parcel.md`
(`node scripts/recent-audit-report.js --md`). POSSIBLE DUPLICATE / UNRESOLVED rows are CONFLICT / UNRESOLVED, never in a statistic.

The page's recent table carries the state per deal ("PROPX state", ⓘ `recent_promotion_state`).

## Ownership share — the audit (20.10.2026, `scripts/recent-share-audit.js` → `share-audit.json`, `AUDIT-ownership-share.md`)

Can anything PROPX can read tell whether a recent-only deal sold the WHOLE property, a PARTIAL share, several units for one
consideration — or nothing can (UNKNOWN)? Not today:

* **The GovMap-layer copy** publishes 19 fields (`objectid` · `deal_id` · `deal_date` · `deal_date_raw` · `deal_amount` · `settlement` ·
  `street` · `house_num` · `floor` · `asset_area` · `rooms` · `property_type` · `deal_nature` · `gush` · `parcel` · `sub_parcel` · `polygon_id`
  · `lon` · `lat`) — no portion, no declared amount, no build year; no per-deal or history endpoint. Four versions (08.07 partial · 04.08
  capped at 1,000,000 · 03.10 · 08.10.2026), full snapshots, not a row archive.
* **Field test** over the 2,934 dwelling deals both copies hold (301 partial in the register): no permitted field — series, floor, rooms,
  property type, nature, sub-parcel, address, polygon form, settlement, in-source twin, id length / parity, weekday — has a value holding
  whole-property sales only (support ≥ 30), and no pair of permitted fields does (105 pairs). The only pure leaves use the unit's or the
  parcel's ACTIVITY in the copy (excluded by rule — activity, price and size are never a basis for the share) and were found by searching.
* **Transaction identity**: the register publishes no deal id — no shared key; linkage = block · parcel (the layer numbers sub-parcels its
  own way) · date (± 1 day, known series offset) · amount representation · area.
* **The register** states the portion (`portion` "1.000" / "0.500" …, `portion_fraction`) for every row — it RESOLVES the share of every
  deal it holds. It exists as ONE scrape (dataset versions v1–v5, 18–19.09.2026), and its publisher's change log (13.10.2026) says the
  Tax Authority site is blocked to its scraper and the database has not been updated since 19.09.2026. `/api/nadlan/parcel/…/deals` and
  the MCP endpoint serve the same rows. nadlan.gov.il (reCAPTCHA), GovMap (403), the Tax Authority (identification screen) — never bypassed.

So the only defensible resolution is the LATE CONFIRMATION below — and its source is currently not refreshing.

## The promotion lifecycle (`lib/recent/lifecycle.js` → `promotion-history.jsonl`, append-only)

Every shown deal is OBSERVED once (its state, the copy, PROPX's first read, the register copy it was read against, the verbatim row's hash
and fields). When a NEWER register copy holds the same transaction (the reconciliation's strong match: IN_REGISTER / IN_REGISTER_OTHER_UNIT
— the same unit or parcel, ± 1 day, the amounts agreeing, the area to the metre), the deal is decided again from the register's own fields:
portion 1 → WHOLE_PROPERTY (or MULTI_UNIT: one consideration on several sub-parcels that day) · portion < 1 → PARTIAL_SHARE ("0.000" is
a share rounded at source) · no portion → UNKNOWN; another locality / not a dwelling → CONFLICT. The state becomes VERIFIED when identity
holds (two-key street) and the semantics are stated; a price is used only for WHOLE_PROPERTY ≥ ₪100,000. A confirmed deal is COUNTED
THROUGH THE REGISTER DEAL (it leaves the layer) — never twice. Events: OBSERVED · RESTATED (same copy / engine — never a confirmation) ·
CONFIRMED · CONFLICTED (incl. a later duplicate / possible-duplicate print) · LEFT_COPY (a deal the newer GovMap copy no longer holds —
carried from the copy that first showed it, evaluated, never shown) · WITHDRAWN. Nothing is ever rewritten: the observation stays the one
first recorded and the confirmation is a new, dated event. `meta.json → lifecycle` summarises the ledger (states, transitions,
confirmations by semantics, the lag from first read to the confirming copy). 20.10.2026: 4,403 OBSERVED · 0 confirmed — no newer register
copy exists.

## The three counts (`lib/recent/counts.js`, `view=street` → `transactionCounts`, `view=recentLayer&city=`)

Never one number, each with its parts (register · recent) and its period (the register window extended to the latest recent event; and
the recent window):

| Count | Register part | Recent part |
|---|---|---|
| RECORDED TRANSACTION EVENTS | observed dwelling deals (partial and unpriced included) | rows passing every event gate (967) |
| VERIFIED DWELLING TRANSACTIONS | observed dwelling deals | VERIFIED rows (0) |
| PRICED TRANSACTIONS USED IN MARKET STATISTICS | priced deals (whole property ≥ ₪100,000) | VERIFIED whole-property rows (0) |

User-facing: "Recent recorded transactions include transactions whose ownership share is not stated by the recent source. These
transactions are excluded from price statistics until their pricing semantics can be verified." The street page shows the three counts
(street + locality line); every recent deal shows its price as published with "PRICE NOT USED IN MARKET STATISTICS · Reason: OWNERSHIP
SHARE NOT STATED" (or its state's reason), no ₪/m² on a price that is not used, and its source fields. The observed card, the median,
the sample state, the change and the Street Value Model are unchanged.

