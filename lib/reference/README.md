# Official reference datasets (`lib/reference`)

Whole-resource reads of official open datasets that describe a PLACE rather than a market event. Added 21.10.2026 under the master
data directive (M5/M6): the two locality datasets the 17.10.2026 discovery ledger marked INTEGRATE but never wired.

| id | publisher | resource | what | cadence | universe |
|---|---|---|---|---|---|
| `census-2022` | CBS (via data.gov.il) | `9a9e085f-3bc8-41df-b15f-be0daaf99e30` | Population and Housing Census 2022: population, households, household size, owner / renter shares, median wages, age, education, vehicles, parking — national · each locality · each statistical area | once per census (2022 observation, published 2024) | census population (de-facto) |
| `residents` | Population and Immigration Authority (via data.gov.il) | `64edd0ee-3d5d-43ce-8562-c336c24dbc1f` | registered residents per locality and age band | weekly — the resource is replaced in place; PROPX keeps its own dated history | the population REGISTER |

## Rules

- **Complete or nothing.** `fetchAll` pages `datastore_search` by `_id` until it holds `total` distinct rows; a short read, a non-JSON
  answer or `success: false` throws and the run fails (the stored data stays).
- **Schema guard.** A resource that lost a required field (`LocalityCode` / `pop_approx`; `סמל_ישוב` / `סהכ`) fails the run — never a
  silent null column.
- **Official codes only.** Keys: `il` (the census national row), `loc:<CBS locality code>`, `sa:<locality>:<statistical area>`. A row
  without an official code is rejected and counted — never placed by its name. Duplicate keys fail the write.
- **History.** `data/reference/<id>/rows.json.gz` + `meta.json` (source update time · PROPX read time = the last content change · check
  time · content hash · counts by level · fields) + `history/<date>-<hash8>.json.gz` (one copy per content change) + `runs.jsonl`.
- **Two universes, never mixed.** Census 2022 is one observation, never "current"; registered residents are the population register,
  not CBS population estimates. A locality figure describes the locality, never one street; a statistical area is listed by its CBS
  number — PROPX has no statistical-area geometry, so it is never placed on a street.
- **Missing reasons.** `reference-not-synced` (no read yet) · `locality-not-in-census-table` · `locality-not-in-register-table`.

## Sync

`scripts/reference-sync.js` (`--source`, `--dry-run`, `--summary-file`) via `.github/workflows/reference-sync.yml` — weekly (default
branch) and on a push to the preview lane that changes this code; the offline gates (`test/reference.test.js`) run first; only
`data/reference/` is committed; GET only, keyless, no credential.
