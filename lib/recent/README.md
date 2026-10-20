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

**20.10.2026 — 11,900 rows:** CONTEXT 2,199 · FUTURE_DATED 36 · NO_SETTLEMENT 37 · UNMAPPED 1 · DUPLICATE 1,903 · AMBIGUOUS 30 ·
POSSIBLE DUPLICATE 63 · IN_REGISTER 1,249 · IN_REGISTER_OTHER_UNIT 1,953 · POSSIBLY_IN_REGISTER 10 · **RECENT_NEW 4,419**
(dwelling 3,404 · type not stated 878 · non-dwelling 137) in 133 localities, latest 28.09.2026; on a street 2,649 (address
1,544 · address + parcel 1,050 · parcel 55), 1,741 streets.

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
| Haifa | 420 | 420 | 299 | 11 | 4 | 96 | 8 | 2 |
| Be'er Sheva | 351 | 351 | 273 | 17 | 0 | 58 | 3 | 0 |
| Rishon LeZion | 200 | 200 | 129 | 42 | 7 | 17 | 1 | 4 |
| Netanya | 211 | 211 | 122 | 32 | 5 | 51 | 1 | 0 |
| Ashdod | 215 | 215 | 152 | 13 | 0 | 49 | 0 | 1 |
| **Total** | **2,293** | **2,293** | **1,554** | **251** | **35** | **428** | **17** | **8** |

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
Gates: `test/recent.test.js` (17).
