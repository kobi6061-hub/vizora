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
