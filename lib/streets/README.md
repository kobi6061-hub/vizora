# PROPX · Street Intelligence

Every official street in Israel is searchable, whether or not PROPX holds a transaction, a project or a permit on it. The
**street directory** (identity) and the **street market evidence** (what the deals register shows on the street) are two
layers that never stand in for each other.

| File | Role |
|---|---|
| `directory.js` | the stored official directory (`data/geo/streets/`): rows, kinds, synonyms, localities, file hashes |
| `search-index.js` | the prebuilt search index (written by the sync, checked against the directory files' sha256) |
| `match.js` | a register deal's parcel addresses → its official street (match state + rung) |
| `sweep.js` | the provably complete sweep of a settlement's window, normalization, the locality shard |
| `evidence.js` | the evidence read model: universe, statistics, sample states, locality / neighbourhood context, summary |
| `street.js` | Street Intelligence: identity + evidence + context + exact links + knows / does not know |
| `coverage.js` | the coverage audit (national · district · locality, reconciled) |
| `../../scripts/street-sync.js` + `street-sync.yml` | weekly directory sync (+ `--rebuild-index`, `--reconcile-legacy`) |
| `../../scripts/street-evidence-sync.js` + `street-evidence-sync.yml` | the evidence sweep (weekly check; a sweep when the copy changes) |
| `../../scripts/street-discover.js` + `street-discover.yml` | read-only discovery (catalogue, profile, the register's shapes) |
| `../../test/streets.test.js` | search (§21), match, sweep, sample policy and truth gates (§22) |
| `value-model.js` · `value-validate.js` · `value-read.js` | the STREET VALUE MODEL (§6): fit, validation, request-time read |
| `../../scripts/street-model-build.js` | validate + fit + estimate every searchable street → `data/streets/model/` |
| `../../test/street-model.test.js` | the model's truth, leakage, reproduction and 16 acceptance gates |

## 1 · The official directory

Source: the Population and Immigration Authority on data.gov.il — `רשימת רחובות בישראל - מתעדכן` (resource
`9ad3862c-8391-4b2f-84a4-2d4c68625f4b`, 63,577 rows, 1,316 localities) and `… קובץ עם סינונימיים` (resource
`bf185c7f-1a4e-4662-88c5-fa118a244bda`: every official row again + 88,556 synonym rows "synonym of N"). Both resources are
read **whole** on every run (paged; a short read fails the run), behind a schema guard.

Stored per row: locality code · locality name · street code · official name · kind · status (current / historical) · first
seen · retired at · origin; the registry's own update date and PROPX's check date in `meta.json`; a raw snapshot per resource
when its content changed (`raw/`); every ADDED / RENAMED / RETIRED / RESTORED in `history.jsonl`. Nothing is deleted: a code
that leaves the registry stays `historical` and keeps resolving.

**Identity** — `st:<locality code>:<official street code>`. A name is never an identity: the same name in two localities is
two streets; a synonym is a second name of one street (it resolves to the official code). The ids PROPX served before
(`stp:` provisional ids of the 2026-08-31 mirror) map to the official id through `legacy-ids.json` (12,959 of 12,959 resolved:
city code, else the official city name; then the official name, else a synonym). A coded legacy id keeps its code: where the
mirror's name differs from today's official name and synonyms (8 rows — a rename or a code the registry reused; PROPX cannot
tell which), the id resolves to the official row and the pair is listed in `legacy-ids.json` `nameDiffers`, never hidden.

**Special rows** (audited over every row, 19.10.2026 — `street-discover.js --profile`). The registry is an ADDRESS registry:

| codes | kind | policy |
|---|---|---|
| 100–5999, 9001–9999 | `street` (57,162) | searchable street |
| 6000–6999 | `area` (5,005) | searchable, labelled ADDRESS AREA (a neighbourhood / zone used as an address — never a street) |
| 7000–8999 | `site` (94) | searchable, labelled SITE (a base, a college, a marina …) |
| 9000 | `locality` (1,316, one per locality) | the locality itself — stored, never offered as a street (the locality is searchable as a locality) |

Synonyms of code 9000 (2,448) name a place inside the locality, not a street: counted, not offered. 498 localities have only
the placeholder (no named street) — they are searchable as localities.

## 2 · Search

`lib/geo/registry.js` `searchGeo(query, limit, {near})`, served by `GET /api/geo/search?q=&near=&limit=`. The index (169,275
keys, 428,408 postings; schema 3) is prebuilt from the directory (`aliasKeys` per official name and per synonym — street-type
words incl. שכונת / שכ, honorifics, geresh / gershayim, hyphen ↔ space, final letters, doubled vav / yud, an optional leading
ה, the Arabic article אל- / א- as an optional prefix; a later word of a name is a discovery key). The query is normalized the
same way, and also loses niqqud, bidi marks and list separators (`, ; / \ |`). A house number typed with the street ("הרצל 12
פתח תקווה") names no street: when no street matched the query exactly, it is read again without the number
(`meta.houseNumber`), and the number picks nothing. Postings reference official codes (`locality × 100000 + code`), so a directory change touches only
its own postings; a stale index (directory files' sha256 differ) is refused and rebuilt in memory.

Ranking — the selected locality is `near` (the page sends the locality in view) or a locality named inside the query
("הרצל פתח תקווה", "פתח תקווה הרצל", while typing "הרצל פתח ת"):

1. exact official name in the selected locality · 2. exact synonym there · 3. prefix there
4. exact official name elsewhere · 5. exact synonym elsewhere · 6. normalized / discovery matches (never an identity change)

Inside a tier: the typed name, then the same name with its type word spelled another way ("שד" = "שדרות"), then the name
without its type word, then any other variant key; the selected locality first; in discovery (tier 6) a name that starts
with the query first; the larger locality (its number of official named streets) first; the shorter name. A query ending in
a non-final letter ("הגנ" while typing) never meets a final-letter name as exact (tier 6). A split part that is only a
street-type word or an honorific is no street; a locality still being typed scopes its three largest completions.
`inSelectedLocality` says `near` (the locality in view) or `named` (named in the query). An exact locality name leads the list; a query that is itself a locality
name is not split; a query that is itself an official street name keeps that street first and the split reading right after
it. Historical rows rank after current ones of the same tier and are labelled. `meta.moreStreets` drives the page's "add a
locality" hint.

Measured (19.10.2026, after the four reviews, every one of the 62,265 searchable rows): name + selected locality — top-7
62,265 (100 %), top-1 62,257; "street locality" typed together — top-7 62,265 (100 %); the name alone — top-7 49,014 (a name
shared by many localities needs its locality: the "add a locality" hint). Synonyms (every second one, 43,054): + selected
locality 43,053, + locality name 43,052 — the two left are a one-letter synonym ("ג") and a truncated one ("…הל-"). Cold load
≈ 0.8 s (was 3.9 s), warm queries 1–20 ms.

## 3 · Street market evidence

**Source.** The Tax Authority deals register as republished by over.org.il (`/api/deals/*`; not a government channel —
labelled so). The register publishes no address: over.org.il links each deal's parcel to the addresses its crosswalk knows
(`addresses`, at most 3 shown, and `addresses_total`).

**Sweep** (`scripts/street-evidence-sync.js`, GitHub runner, one request a second). For every settlement name with a deal in
the window, grouped by its CBS code (`settlement_code`, else the publisher's `resolved_code`; names with no code in the
directory are listed, not swept): the 36 months that end on the copy's latest deal (`stats.last_deal`), split by date until
every query answers in ONE page — every leaf proves fetched = total, every split proves its parts add up; a single day above
a page is paged again until its distinct rows reach the day's total (offset pages over a tied sort may overlap). Any short
read fails that locality (its previous shard is kept; the run is PARTIAL; the next run retries it). The copy repeats some
coded deals without their settlement code — those copies are collapsed (counted in `duplicatesCollapsed`). A sweep runs only
when the publisher's copy changes (`scraped_at`); an unfinished sweep resumes from `progress.json`. Shards are canonical
(an unchanged register gives byte-identical files). Each shard records the directory it was matched against
(`directory` = the directory's content hash): when the copy is unchanged but the directory changed, the weekly run re-matches
those shards offline (`rematched` in the run log; `--rebuild` re-matches all of them).

**Storage.** `data/streets/evidence/<locality code>.json` — every row of the window with the source's fields in columns
(date · amount · nature · area · rooms · year built · portion · sub-parcel · declared amount · settlement) and a parcel table
(gush · helka · addresses_total · addresses · match state · streets · reasons); `summary.json` (per street: observed · priced ·
with ₪/m² · latest · possible; per locality: address-state counts); `meta.json` (source, window, natures, settlements mapped /
unmapped, sweep state); `sync-runs.jsonl`.

**Match** (`match.js`) — inside the deal's own locality only; rungs (the first that answers wins, the rung is kept):
1 official street code — *not available on this channel* (the rows carry address text) · 2 official name · 3 official
synonym · 4 normalized name (a deterministic variant key of exactly one street). Two streets on a rung = ambiguous, none
picked. States:

| state | rule | in the street statistics? |
|---|---|---|
| OBSERVED | every address of the parcel is shown (`addresses_total` = shown) and all resolve to ONE street | yes |
| POSSIBLE | the parcel touches the street but: several streets (corner parcel) · list truncated (3 of N, or no total stated with 3 shown) · an address unresolved · a name met only without its street-type word | **no** — listed apart |
| UNRESOLVED | addresses, none resolved | no |
| NO_ADDRESS | no address in the crosswalk | no — locality level only |

**Universe and metrics** (`evidence.js`). Dwelling deals: `דירה בבית קומות` · `דירת גן` · `דירת גג` · the cottage types · `בית
בודד` (the publisher's own advice for "flats"; `מגורים` / `ד. מגורים` are mostly land or rights and are excluded, counted
apart). PRICED = the whole property (portion = 1) for at least ₪100,000 (a smaller amount is a nominal consideration — observed,
not priced); ₪/m² only with a positive area and at least ₪2,000 / m²; a partial sale is never priced; identical rows are one
transaction; units of one parcel sold the same day for one amount are observed and not priced (the register may print one
total on every unit). Median first (P10–P90, mean beside it, labelled); 12 / 24 / 36-month calendar counts; latest deal; rooms
and size mix; change = median ₪/m² of the latest 12 months vs the 12 before, only with ≥ 30 deals in each half, with a seeded
95 % bootstrap interval and each half's median area and probably-new share (a mix shift is not a price change). PROBABLE NEW =
the product's one rule (`lib/gov/classify.js`: build year = deal year or deal year − 1) — never CONFIRMED; a build year AFTER
the deal year (an off-plan sale, or a register error) is not classified and is counted and tagged on its own. CONCENTRATION:
when one parcel holds ≥ 50 % of a street's priced deals (≥ 5), the page says so beside the median (1,690 of the 4,221 streets
with ≥ 5 priced deals on 19.10.2026 — e.g. Jerusalem, Jaffa Road: 248 of 270 at no. 161, 247 of them before the build year).

**Sample policy** (priced OBSERVED dwelling deals in the window):

| state | priced deals | shown |
|---|---|---|
| SUPPORTED STREET MARKET | ≥ 10 | median price, median ₪/m² (own count ≥ 10; 5–9 labelled LIMITED), P10–P90, mix, change (30 + 30 ₪/m²) |
| LIMITED STREET EVIDENCE | 5–9 | median price (and ₪/m² with ≥ 5) with min–max, labelled LIMITED; no percentiles, no change |
| INSUFFICIENT STREET SAMPLE | 1–4 (or observed, none priced) | street price "—"; the deals are listed |
| NO OBSERVED TRANSACTIONS | 0 | "no observed transactions" — never a zero price |

10 matches PROPX's small-sample rule elsewhere (fewer than 10 deals is a small sample); 5 is the smallest sample whose
median is not one or two deals' value. Checked on the first full sweep (19.10.2026): streets by priced deals — 0: 6,187 ·
1–4: 6,429 · 5–9: 1,926 · 10–19: 1,324 · 20–49: 788 · 50–99: 135 · 100+: 48; on 291 streets with ≥ 40 priced deals, the median
of n resampled deals sits from the street's full median by (median · P90): n = 3 → 7.0 % · 26.7 %, n = 5 → 5.5 % · 20.9 %,
n = 10 → 3.9 % · 14.5 %, n = 20 → 2.8 % · 10.7 %. Hence: below 5 no price; 5–9 a median labelled LIMITED with its min–max;
≥ 10 the median with P10–P90. The thresholds are re-read after each full sweep (`coverage.js`).

**Context — never the street's price.** The locality's priced dwelling deals in the same window (every address state — the
locality is certain), DERIVED; the CBS Table 2.2 all-dwellings average where the city has its own row (OFFICIAL, the page's
`PRICE_BASIS`, never a district row); a neighbourhood only through a VERIFIED street → neighbourhood link
(`lib/geo/neighborhoods.js`) — never inferred from a name, proximity or a statistical area; its figure is the OBSERVED
dwelling deals on the streets the links name (whole streets — a link names a street, not a stretch of it), with the streets
listed beside it. Printed under "These figures
describe the surrounding market, not observed prices on this street."

**Links.** Tel Aviv-Yafo building permits and construction sites (`data/dd/tlv.json`, IView2) whose own address names the
street — by the same exact rungs (a record naming several streets links to each and says so). No other municipality
publishes permits by address in a form PROPX reads; land tenders, plans and renewal complexes carry no street address — the
locality's dossier is linked as locality context, never as a street fact.

## 4 · Truth gates (`test/streets.test.js`)

STREET EXISTS ≠ HAS TRANSACTIONS · NAME ≠ ID · SAME NAME IN TWO CITIES ≠ SAME STREET · SYNONYM ≠ SECOND STREET · NO
TRANSACTIONS ≠ ZERO PRICE · NEIGHBORHOOD PRICE ≠ STREET PRICE · CITY PRICE ≠ STREET PRICE · ASKING ≠ TRANSACTION · POSSIBLE
ADDRESS MATCH ≠ OBSERVED · PROBABLE NEW ≠ CONFIRMED — each a gate over a TEST FIXTURE store (synthetic deals on real official
streets, built in a temp directory, never read by the product).

## 5 · API

- `GET /api/geo/search?q=&near=&limit=` — localities + streets / areas / sites, city-qualified, with `streetKind`, `status`,
  `matchedName` (synonym), `tier`, `inSelectedLocality`; `meta.moreStreets`, `meta.exactStreetLocalities`, `meta.scopes`
- `GET /api/intel?view=street&id=st:<l>:<s>[&limit≤500]` — Street Intelligence (404 for an id the directory does not hold)
- `GET /api/intel?view=streetCoverage` — the coverage audit

## 6 · Street Value Model (MODEL — 19.10.2026, `psvm-1.1.0`)

A separate MODEL layer beside the observed street market. The observed read (§3) is never replaced, re-labelled or
re-thresholded: SUPPORTED ≥ 10 · LIMITED 5–9 · INSUFFICIENT 1–4 (price "—") · NONE stay exactly as they are. The model answers a
different question — *what does a reference dwelling on this street sell for per m², estimated from the street's own deals and the
most relevant surrounding evidence?* — and says **MODEL UNAVAILABLE** whenever the evidence does not support a street-level
answer. It is a PROPX ESTIMATE: never an appraisal, an official value, a fair value, an asking price or a guaranteed sale price.

### Field audit (`data/streets/model/audit.json`, 342,471 swept deals · 194,141 priced dwelling deals · 191,786 model rows)

| Field | Priced dwelling coverage | Decision |
|---|---|---|
| date · price · locality · block / parcel · nature | 100 % | used (quarter of the index · target · locality level · block level, parcel weights, grouped holdout · dwelling type) |
| area | 99.0 % | used (log area; < 20 m² is a placeholder — the shared cleaning rule now refuses a ₪/m² below 20 m², `EV.MIN_AREA`) |
| rooms | 95.4 % | used (area per room; missing → its own indicator) |
| build year | 99.3 % | used (age band, PROBABLE NEW, built after the deal = off-plan) |
| probable new | 16.3 % | used (premium term — PROBABLE, never confirmed) |
| street (OBSERVED) | 42.0 % | used — the street level; POSSIBLE / UNRESOLVED deals never price a street |
| street number | 65.0 % | rejected as a feature (the parcel already identifies the building) |
| subsidized-programme parcel | 11.4 % | used — ILA subsidized / lottery-track tender parcels (exact block + parcel): a coefficient, never a finding that a sale was subsidized |
| verified neighbourhood | 72 links, 7 cities | used where linked (official name / synonym / spelling only) |
| floor · coordinates · verified project | 0 % | unavailable (not in the register copy) — no floor input, no distance feature; a development proxy (block + build year ± 1, built ≤ 10 years before the deal) is used for leakage control only |

### Method

1. **Target**: log ₪/m² of one transaction. The street estimate = the value per m² of the REFERENCE DWELLING (an existing flat in
   a multi-unit building, 85 m², ≈ 3.5 rooms = 25 m² per room, the district's typical existing-home age mix, not a
   subsidized-track parcel) at its district index's ANCHOR quarter.
2. **Hedonic + time index per district**: weighted least squares of log ₪/m² on log area, area per room, PROBABLE NEW, off-plan,
   age band, dwelling type, subsidized-track parcel and one effect per calendar quarter, with a fixed effect per cadastral BLOCK
   absorbed by within-block demeaning. Outliers beyond 4 robust SD are flagged and refitted without (a national-fallback district
   takes only the national flags of its own rows). A district under 3,000 rows takes the national fit, labelled. The index is
   PROPX's own (DERIVED, district level) — not a CBS series, never a city trend; each comparable keeps its date, quarter,
   adjustment and source. Every new / off-plan / age-banded row is centred on the district's existing-home age mix (an existing
   flat of unstated age IS the reference mix).
3. **Anchor**: the latest quarter the register has REPORTED — a quarter with < 60 % of the mean count of the four before it is
   still filling (the copy lags: 2026Q3 held 3,559 rows against ≈ 13,000 a quarter, and early-reported deals are not a random
   sample) and the anchor steps back. In production every district anchors at 2026Q2; in the back-filled validation folds the
   cutoff quarter stays the anchor.
4. **Comparable → reference value**: z = log ₪/m² − β·(features − reference) + (anchor − quarter effect).
5. **Levels**: the STREET (its OBSERVED deals), its BLOCKS (other deals in the cadastral blocks of the parcels that touch the street
   — OBSERVED or POSSIBLE parcels give the location, never a price on the street; a street matched only on the loose
   `normalized-name` rung never locates a parcel), the VERIFIED NEIGHBOURHOOD, the LOCALITY. Parcel design weights: one parcel's n
   deals count n / (1 + (n − 1)·ρ), ρ = 0.26 (one-way ANOVA on block-demeaned log ₪/m² — slightly conservative against ρ ≈ 0.22
   on hedonic residuals) — a 200-sale tower ≈ 3.8 effective observations.
6. **Credibility shrinkage** locality → neighbourhood → block → street, weight n_eff / (n_eff + k), k = σ²_within / τ²_between by
   method of moments (σ² with the n_eff / (n_eff − 1) correction; a street's parent = the OTHER deals of its blocks): k_street
   3.38, k_block 0.95 (k_neighbourhood = k_block — immaterial).
7. **Availability**: a locality with n_eff < 8 cannot anchor; a street with no own deals, < 5 effective observations in its
   blocks and no verified neighbourhood is MODEL UNAVAILABLE — a locality or district figure alone is never a street's value.
8. **Evidence tiers** (`TIER_RULE`, no confidence percentage) describe the EVIDENCE BASE, not the accuracy: STRONG = own n_eff ≥
   1.5 from ≥ 2 parcels, latest own deal ≤ 18 months, locality n_eff ≥ 300 · STANDARD = own n_eff ≥ 1.5 or block n_eff ≥ 20 ·
   LIMITED = some own deals, block n_eff ≥ 5 or a verified neighbourhood · else UNAVAILABLE. A locality with ≥ 50 held-out deals
   whose own MdAPE > 25 % publishes nothing (Katzrin); MdAPE > 15 % or P80 > 30 % caps it at LIMITED (Sderot, Nof HaGalil, Kiryat
   Shmona, Yeruham). STRONG and STANDARD are equally accurate per deal (below): deal-level noise (a street's own deals spread ≈ 0.16–0.23 in
   log) swamps the street-level error, and STRONG's locality condition selects large mixed-stock cities. Kept as stated evidence
   states — the page says "the evidence base, not the accuracy".
9. **Validation range** = the 10th–90th percentile of log(actual / model) of held-out deals of the tier (≥ 200), widened (never
   narrowed) to the locality's own band where it holds ≥ 300 held-out deals (39 localities) — a measure of the model's typical
   error, not a confidence interval and not a guaranteed sale range.
10. **Apartment estimate** (`view=streetApartment`): the stored street level re-priced for a flat in a building / garden flat /
    roof flat of 25–250 m², rooms (or the reference 25 m² per room), second-hand with a build year (or the district's age mix) or
    new (stated, or a build year of the as-of year or the year before); a garden / roof effect only where ≥ 100 within-block
    sales of that type fitted it; cottages and detached houses are not estimated (plot value, not in the register). Value to
    ₪10,000, ₪/m² to ₪100, each input's effect stated per m². No floor.
11. Gradient boosting / other ML was not adopted: the remaining error is dominated by what the register does not carry (floor,
    condition, aspect, exact location), and an opaque fit would lose the comparable-by-comparable explanation.

### Validation (`data/streets/model/validation.json`, `psvm-validation-2`)

Three forward folds (cutoffs 18.03.2025 · 18.09.2025 · 18.03.2026, each tested on the 6 months after it — a month-arithmetic
overflow once cut fold B to 3.5 months); every parameter, comparable and location link dated before the cutoff; test = the OBSERVED
street deals priced as of the cutoff; GROUPED HOLDOUT — the test deal's parcel and its development (same block, build year ± 1,
built ≤ 10 years before) are removed from every level and every baseline. 35,599 held-out deals, 33,854 published (95.1 %; the
national figures count the structural tiers BEFORE the locality caps — Katzrin's deals stay in, conservative).

| Same held-out deals | MdAPE | P80 | P90 | MdAE ₪/m² |
|---|---|---|---|---|
| **PROPX model** (33,854) | **9.7 %** | **20.2 %** | **28.0 %** | **₪2,029** (₪183,459 per deal) |
| hedonic + index, locality level only (33,854) | 12.1 % | 25.3 % | | ₪2,504 |
| recent similar comparables (33,686; model 9.7) | 12.9 % | 26.9 % | | ₪2,642 |
| same-street median, 12 months (27,780; model 9.6) | 14.0 % | 28.6 % | | ₪2,909 |
| locality median (33,854) | 15.1 % | 29.4 % | | ₪3,077 |
| verified-neighbourhood median (575; model 13.6) | 17.9 % | 41.2 % | | ₪6,317 |

The hedonic + index locality-only line is the honest incremental baseline: the street / block / neighbourhood structure adds 2.4
points of MdAPE; the raw medians mostly measure the dwelling translation. By fold: A 9.5 % · B 10.2 % · C 9.4 %. By tier (all
folds): STRONG 9.6 % · STANDARD 9.1 % · LIMITED 12.2 %; fold C with caps and bands from A + B: STRONG 9.3 % · STANDARD 9.1 % ·
LIMITED 12.8 %, and the 80 % band held 83.0 % · 83.5 % · 83.2 % of unseen deals (85.4 % · 84.3 % · 85.5 % with the locality
widening). By district: Central ≈ 8 % · Tel Aviv ≈ 9 % · Jerusalem ≈ 10 % · South / Haifa ≈ 10.5 % · North ≈ 11.5 %. Bias by
the MODEL's value is small (< ₪12,000/m² −0.3 %, ≥ ₪45,000 −1.8 %; banding by the actual price shows −11 % / +9 % — regression to
the mean, `byActualPriceBand`). By newness: existing −1.4 %, probable new −0.8 % (was −3.8 % before the age-mix centring fix),
OFF-PLAN +4.4 % (the model under-prices sales before completion — stated, not corrected). The tier rule, the caps, the rooms
feature and the anchor rule were chosen with folds A–C in view; only the fold-C band check is held out from those choices — the
next register copy's six months are the lock-box test. Subsidy parcels, OBSERVED matches and neighbourhood links are read from
current data, not as of each cutoff.

Ablation (`psvm-1.1.0`; the same 29,841 held-out deals every variant predicts; all three folds):

| Variant | MdAPE | P80 | P90 | Deals it can price | Note |
|---|---|---|---|---|---|
| full model | 9.66 % | 19.97 % | 27.73 % | 34,374 | |
| no hedonic translation | 13.04 % | 25.71 % | 34.70 % | 34,374 | the dwelling translation is worth 3.4 points |
| no time adjustment | 9.65 % | 19.82 % | 27.39 % | 34,374 | median bias fold A +2.64 % (full −0.18 %), fold C +0.03 % (full −1.53 %) |
| no block level | 10.05 % | 20.73 % | 28.96 % | 29,852 | blocks add 0.4 points and 15.1 % more priceable deals |
| no neighbourhood level | 9.66 % | 19.97 % | 27.73 % | 34,374 | no measurable effect (72 verified links) |
| recency weighting, 12-month half-life | 9.57 % | 19.91 % | 27.75 % | 34,356 | ≤ 0.1 point — not adopted |

The time adjustment is KEPT: it costs nothing in MdAPE and removes the +2.6 % bias a three-year-old comparable carries into a rising
market (fold A); in the flattening fold C it leaves −1.5 %. Stated, not hidden.

### Coverage

Of 62,265 searchable rows, 15,433 (24.8 %) receive an estimate; of the 57,162 STREETS (address areas and sites excluded), 15,383
(26.9 %). MODEL UNAVAILABLE: no street-specific evidence 26,976 · locality evidence thin 16,413 (a coverage limit of the register
copy: few priced deals) · street evidence thin 1,331 · the locality is not in the register copy 1,192 · no deals in the window 882 ·
failed validation 38. The binding constraint is LOCATION LINKAGE: a street with no deal of its own has no coordinates and no parcel
to tie it to a block. Judea and Samaria (3,053 rows): the register copy holds almost no priced dwelling deals there — no estimate.
By district, locality (≥ 100 rows), observed state, row kind and tier: `validation.json` → `coverage`.

### Artifacts, refresh, versioning

`model.json` (parameters at full precision, anchor quarters, tier rule, ranges + locality ranges, caps, outlier keys, subsidy
parcels, type sample counts, counts, inputs) · `estimates.json` (one row per searchable street + the street's own mix for the
reconciliation) · `validation.json` · `audit.json` · `history.jsonl` (append-only: one record per build with its reason
FIRST_BUILD / DATA / MODEL / DATA+MODEL, and every street whose estimate moved ≥ 5 % or changed tier, before → after; the 1.0.0 →
1.1.0 review rebuild is recorded as MODEL). The evidence workflow runs `street-model-build.js --if-stale` after a COMPLETE sweep, runs
`test/street-model.test.js`, and restores the previous model if either fails. At request time nothing is fitted: the estimate is the
stored row; WHY THIS ESTIMATE and the comparables are recomputed from one locality shard with the stored parameters and shown only
when they reproduce the stored level (`consistent`) and the evidence copy / summary / directory are the build's.

### Dependencies — what makes the model stale (`lib/streets/model-deps.js`, 20.10.2026)

The model is stale only when something it READS moved — each dependency is the projection the build reads, never a whole file:

```
versions        value-model.js MODEL_VERSION · FEATURE_VERSION · VALIDATION_VERSION
code            require closure of value-model · value-validate · street-model-build (minus its @deps blocks):
                  lib/streets/{value-model,value-validate,evidence,match,directory}.js · lib/gov/{classify,schema}.js · lib/geo/aliases.js
evidence        data/streets/evidence/meta.json source.scrapedAt + window · summary.json sha256
directory       data/geo/streets (directory.js) → enumerated rows [id · kind · status] + localities [code · district · Hebrew name]
neighbourhoods  data/geo/neighborhoods.json × directory names / synonyms × match.js → (locality:street → neighbourhood) pairs
land            data/land/tenders.json (track ∈ subsidized | residential-lottery → parcels) + data/land/lots-*.json (their lot
                parcels) → the SET of block/parcel keys (value-model.js subsidizedParcels)
```

Not dependencies: every other field of `data/land` (statuses, dates, prices, winners, other tracks), `data/transactions`,
`data/streets/recent`, `data/market`, `data/housing`, … Before 20.10.2026 the build hashed `tenders.json` whole: the daily land sync
made the model stale and it was rebuilt at 08:53 that day with byte-identical outputs (7,476 subsidized parcels, unchanged) — and the
lot shards, which DO feed the subsidized set, were not tracked at all. The old code list also missed `directory.js`, `schema.js`,
`aliases.js`. A build records its dependencies in `model.json` `inputs.deps` and `dependencies.json`; the build that predates the record
is covered by a one-time baseline in `dependencies.json` with its proof (the old code hash recomputed at b23c4ed equals the build's;
directory content hash, evidence and the subsidized-parcel set equal to what it read). `--check` prints `STALE (<moved dependencies>)`.
Gates: `test/model-deps.test.js`.

### API

- `GET /api/intel?view=street&id=` — Street Intelligence + `model` (the stored estimate, class MODEL, with levels, weights, range,
  validation (fold C for the tier), price-level quarter and versioning)
- `GET /api/intel?view=streetModel&id=[&limit≤300]` — WHY THIS ESTIMATE: comparables by level (no personal data), weight, time
  and dwelling adjustments, ₪/m² as the reference flat, `consistent`
- `GET /api/intel?view=streetApartment&id=&sqm=[&rooms=&newness=existing|new&built=&type=flat|garden|roof]` — the apartment estimate
- `GET /api/intel?view=streetModelValidation` — the validation + coverage report
