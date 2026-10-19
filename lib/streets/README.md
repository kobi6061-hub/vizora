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

`lib/geo/registry.js` `searchGeo(query, limit, {near})`, served by `GET /api/geo/search?q=&near=&limit=`. The index (165,427
keys, 392,038 postings) is prebuilt from the directory (`aliasKeys` per official name and per synonym — street-type words,
honorifics, geresh / gershayim, hyphen ↔ space, final letters, doubled vav / yud, an optional leading ה; a later word of a
name is a discovery key). Postings reference official codes (`locality × 100000 + code`), so a directory change touches only
its own postings; a stale index (directory files' sha256 differ) is refused and rebuilt in memory.

Ranking — the selected locality is `near` (the page sends the locality in view) or a locality named inside the query
("הרצל פתח תקווה", "פתח תקווה הרצל", while typing "הרצל פתח ת"):

1. exact official name in the selected locality · 2. exact synonym there · 3. prefix there
4. exact official name elsewhere · 5. exact synonym elsewhere · 6. normalized / discovery matches (never an identity change)

Inside a tier: the typed full name before a variant key of it, the selected locality first, the larger locality (its number
of official named streets) first, the shorter name. An exact locality name leads the list; a query that is itself a locality
name is not split; a query that is itself an official street name keeps that street first and the split reading right after
it. Historical rows rank after current ones of the same tier and are labelled. `meta.moreStreets` drives the page's "add a
locality" hint.

Measured (19.10.2026, all 62,265 searchable rows): name + selected locality top-7 62,261 → 62,265 after the review fixes
(top-1 100 % on a 1-in-20 sample); "street locality" top-7 100 %; synonym + locality top-7 100 %. Cold load ≈ 1.0 s (was
3.9 s), warm queries 1–20 ms.

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
| POSSIBLE | the parcel touches the street but: several streets (corner parcel) · list truncated (3 of N) · an address unresolved | **no** — listed apart |
| UNRESOLVED | addresses, none resolved | no |
| NO_ADDRESS | no address in the crosswalk | no — locality level only |

**Universe and metrics** (`evidence.js`). Dwelling deals: `דירה בבית קומות` · `דירת גן` · `דירת גג` · the cottage types · `בית
בודד` (the publisher's own advice for "flats"; `מגורים` / `ד. מגורים` are mostly land or rights and are excluded, counted
apart). PRICED = the whole property (portion = 1) for a positive amount; ₪/m² only with a positive area; a partial sale is
never priced. Median first (P10–P90, mean beside it, labelled); 12 / 24 / 36-month counts; latest deal; rooms and size mix;
change = the latest 12 months' median vs the 12 before, only when each half holds ≥ 10 priced deals. PROBABLE NEW from the
build year (≥ deal year − 1) — never CONFIRMED.

**Sample policy** (priced OBSERVED dwelling deals in the window):

| state | priced deals | shown |
|---|---|---|
| SUPPORTED STREET MARKET | ≥ 10 | median price, median ₪/m² (own count ≥ 10), P10–P90, mix, change (10 + 10) |
| LIMITED STREET EVIDENCE | 5–9 | median price (and ₪/m² with ≥ 5), labelled LIMITED; no percentiles, no change |
| INSUFFICIENT STREET SAMPLE | 1–4 (or observed, none priced) | street price "—"; the deals are listed |
| NO OBSERVED TRANSACTIONS | 0 | "no observed transactions" — never a zero price |

10 matches PROPX's small-sample rule elsewhere (fewer than 10 deals is a small sample); 5 is the smallest sample whose
median is not one or two deals' value. The thresholds are re-read against the national distribution after each full sweep
(`coverage.js`).

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
