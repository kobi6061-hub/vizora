# PROPX · National Geography Layer

Complete, canonical Israeli geography — independent of whether a place has
any market data. **Geography and transactions are two separate layers**: a
street exists in PROPX because the official registry says it exists, never
because a deal was reported on it.

```
ISRAEL → locality → neighborhood (where resolvable) → street → address
```

## Geographic scope — the atlas (22.10.2026)

`lib/geo/scope.js` (UMD, the page and the server) is the ONE definition of the navigable hierarchy and of what every intelligence
module can say at every level:

```
Israel → district (7, incl. Judea and Samaria) → subdistrict (נפה, 25 — the official street directory's region_code / region_name)
       → locality (1,316) → verified neighbourhood (53, names only) | CBS statistical area (2,193 census-2022 rows, no address key)
       → street (57,162 current) → [building / address / parcel — evidence inside the street report] → [property — the Deal Lab]
```

Ids are the official keys the read models already use (`il` · `d-…` / `js-area` · `napa:<code>` · `loc:<code>` · `nb:<id>` ·
`sa:<locality>:<area>` · `st:<locality>:<street>`). No level without a source is constructed: no subdistrict / neighbourhood /
statistical-area BOUNDARY is held, a street belongs to its locality (never to a neighbourhood). The module × level matrix states one
mode per module per level — EXACT · AGGREGATED (its own child records, each once, coverage stated) · CONTEXT (the nearest wider
geography, labelled) · NOT_AVAILABLE · NOT_APPLICABLE — it documents, it never computes.

`lib/geo/scope-read.js` → `GET /api/intel?view=scope&id=…`: the chain (breadcrumbs, one level up), the children, LATEST KNOWN
TRANSACTION (the newest counted event of any state) kept apart from LATEST PRICED RESIDENTIAL TRANSACTION (the newest dwelling
priced in statistics — a price is shown only then), counts, census 2022 demographics, the matrix; Israel adds the district comparison
(CBS sales / starts, trailing 12 months as published), the major cities by census population, the verified neighbourhoods and the
coverage per level. `lib/geo/atlas-ui.js` (live build only) renders it at the top of the Overview, moves every section through the
page's own doors, follows the page when the geography changes elsewhere, and puts a CONTEXT banner on every section whose geography
is not the selected one. "Reset to Israel" (`resetToIsrael` in index.html) clears the geography and every section's geographic
filters; language, theme, navigation order and saved work are kept. Gates: `test/geo-scope.test.js`; journey: `test/geo-scope.browser.js`.

## Streets — the official directory (19.10.2026)

Streets now come from the Population and Immigration Authority's official street registry + its synonyms registry
(`data/geo/streets/`, weekly `scripts/street-sync.js`; see `lib/streets/README.md`): 62,265 searchable rows (street · address
area · site; code 9000 is the locality itself) and 86,108 synonyms, served from a prebuilt index with selected-locality ranking.
`data/geo/streets-index.json` below is the 2026-08-31 mirror, kept as the input of the legacy-id reconciliation
(`data/geo/streets/legacy-ids.json`); the search no longer reads it.

## Files

| File | Role |
| --- | --- |
| `scripts/build-geo-registry.py` | refresh pipeline: ingests the official locality + street registries, emits `data/geo/*`, writes the set-difference proof |
| `data/geo/localities.json` | 1,304 localities: canonical id, official code, names, district, coordinates, regional council |
| `data/geo/streets-index.json` | 63,559 official streets: `[cityCode, streetCode, street, city]` |
| `data/geo/neighborhoods.json` | neighborhood registry + verified street links |
| `lib/geo/aliases.js` | deterministic spelling-variant expansion (the search keys) |
| `lib/geo/registry.js` | inverted alias index + national search + id resolution |
| `lib/geo/neighborhoods.js` | neighborhood resolution layer (verified → observed → unresolved) |
| `lib/geo/itm.js` | ITM (EPSG:2039) and Web Mercator (EPSG:3857) ↔ WGS84, haversine, Israel bounds |
| `api/geo/search.js` | `GET /api/geo/search?q=` |
| `scripts/geo-audit.js` | national coverage audit + randomized/adversarial QA |

## Canonical identity

Display names are never identifiers.

- locality — `loc:<official code>`; `locp:<slug>` while an official code is pending
- street — `st:<localityCode>:<streetCode>`; `stp:<…>` while pending
- neighborhood — `nb:<id>`

`locality_code + street_code` is the street's identity, so the many
same-named streets across Israel can never collide: search always returns
city-qualified rows.

## Aliases

Each official name expands once into normalized search keys: street-type
prefixes (רחוב/שד׳/דרך/סמטת/משעול/כיכר), honorifics (הרב/ד״ר/ע״ש), geresh &
gershayim, final-letter folding, doubled yud/vav, hyphen↔space, optional
leading ה. The canonical display name is never altered — the keys only make a
typed variant reach the right record. `שדרות בן גוריון` finds the registry's
own `שד בן גוריון`.

## Neighborhoods — resilient by design

Israel has no single authoritative nationwide neighborhood registry, so the
layer resolves in priority order and states which applied:

1. `verified-street-link` — a verified street→neighborhood mapping
2. `observed-on-official-deal-records` — the neighborhood published on official
   government transaction records for that street
3. `unresolved` — no authoritative mapping

**A street is never hidden, dropped or downgraded because its neighborhood is
unresolved.** It stays fully searchable, attached to its locality, and the
transaction fallback simply continues to the city level. Neighborhoods are
never invented, and a statistical area is never relabelled as a named
neighborhood.

## Transaction fallback ladder

```
building → street → neighborhood → locality → 250m → 500m → 1km
```

The rung that produced the rows is always reported (`scope.level`,
`scope.sampleSize`, `scope.fallbackReason`), and a wider rung is never
presented as the narrower one. A thin street sample is shown as-is —
street rows are never swapped out for neighborhood rows, and any wider
benchmark is labelled separately and never blended into street statistics.

## Refresh

`scripts/build-geo-registry.py` takes the official sources as arguments, so a
government update is ingested by re-running it — no product rebuild. It
records source counts and a build date, and its set-difference proof fails
loudly if anything in the source is missing from the index. Canonical ids are
stable across refreshes; pending ids heal to official codes when a
code-bearing snapshot arrives.

## Audit

`node scripts/geo-audit.js` — counts vs build meta, set-difference proof,
orphans, duplicate canonical ids, alias resolution, mandated locality list
(every locality type), adversarial sample (Arab localities, kibbutzim,
moshavim, Bedouin towns, peripheral councils), random 100 localities + 500
streets, streets with no transactions, unresolved-neighborhood streets, and
the street-collision test.

## Map boundaries (18.10.2026) — `lib/geo/boundaries.js`

The page's map (`#map`) draws the six CBS districts, the country outline and the West Bank / Gaza areas from
`lib/geo/boundaries.js` (`window.PROPX_GEO`), generated by `scripts/build-geo-boundaries.py` from Natural Earth 1:10m
(`ne_10m_admin_1_states_provinces` · `ne_10m_admin_0_countries` · `ne_10m_admin_0_disputed_areas`, public domain; the GeoJSON
inputs are not committed — ≈ 55 MB). Geometry only: `[lat, lng]` rings rounded to 4 decimals, every Natural Earth vertex kept
(district rings 89–338 vertices, the country 470), the Natural Earth district names mapped to the PROPX ids
(`HaDarom → d-south`, `HaMerkaz → d-center`, `HaZafon → d-north`, `Haifa → d-haifa`, `Jerusalem → d-jm`, `Tel Aviv → d-ta`).
No market value lives in the module; the West Bank and Gaza are drawn hatched and labelled, never clickable, because PROPX
holds no district value for them. The page's projection is equirectangular with the true aspect at 31.45° N (one degree of
longitude = cos 31.45° of a degree of latitude); the hand-drawn constants in `index.html` (`ISRAEL_PTS`, `DISTRICT_POLY`)
remain as the fallback when the module is absent. The offline build inlines the module. Gates: `test/geo-boundaries.test.js`.
