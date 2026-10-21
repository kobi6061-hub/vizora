# Street surroundings (`lib/surroundings`)

Added 21.10.2026 under the master data directive (M5 / §6.9), from the 21.10 source universe
(`lib/trust/discovery/2026-10-21-source-universe.json`): official open registers of what lies around a street, read whole weekly from
data.gov.il's keyless CKAN datastore (`lib/reference`'s reader and store — complete or the source fails, schema-guarded) by
`scripts/surroundings-sync.js` (`.github/workflows/surroundings-sync.yml`) into `data/surroundings/<id>/`.

| id | resource | what | licence |
|---|---|---|---|
| `contaminated` | `cbb2ed28-310d-4389-a1ec-64bb538fc090` | the Ministry of Environmental Protection's contaminated / suspected land register: name, address, block / parcel, ITM point, the register's LEGEND and status words | Other (Open) |
| `edu-points` | `5c5d6bb0-755d-470d-84b6-d7dd3135ba9c` | the Ministry of Education's institution entrance coordinates (ITM, the source's accuracy grade) — published 04.2022 | Other (Open) |
| `edu-info` | `5548fd63-5868-4053-ad81-98caddc5e232` | institution characteristics by school year (type, frame, sector, supervision, students, grades) — ONE record per institution: its latest school year in the source (an older year superseded and counted; the source's rows per year in `meta.profile`) | Other (Open) |

The register rows carry no unique official key: a record is keyed by its content (`ct:<org_id>:<block>:<parcel>`), identical keys numbered
in the source's order (`keyOccurrence`, `lib/reference`) — never by the datastore's row number.

## Street report

`around(points)` from the street's located points (the GovMap-layer file's parcel / building points, each with its block / parcel):

- contaminated land — EXACT: a register row whose block / parcel equals a parcel of the street's own points (`ON_A_PARCEL_OF_THE_STREET`);
  SPATIAL: register points within 300 m (`NEARBY`, straight-line metres). The legend and status words are shown VERBATIM — "היתכנות לזיהום
  קרקע" (potential) is never shown as contaminated; a listed site is not a health finding; a nearby site says nothing about the street's soil.
- education — institutions with a published entrance point within 500 m; their characteristics from the latest school year, joined by the
  institution code only; an institution absent from the latest year is shown with its own year, never as current; an institution opened after
  04.2022 has no point and is not shown.

Context only — never a value, never a price effect, never in the street assessment. Missing states: `surroundings-not-synced`,
`street-not-located`. Not used: the Ministry of Education's `mosdot_edu` coordinates (licence not stated — LICENSE_REVIEW_REQUIRED).
