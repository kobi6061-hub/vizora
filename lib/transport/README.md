# Public-transport access (`lib/transport`)

Added 21.10.2026 under the master data directive (M5 / §11): the Ministry of Transport's own open tables on data.gov.il, read whole
(keyless CKAN datastore, complete or the source fails, schema-guarded — `lib/reference`'s reader and store), weekly
(`scripts/transport-sync.js`, `.github/workflows/transport-sync.yml`).

| id | resource | what | geometry |
|---|---|---|---|
| `bus-stops` | `e873e6a2-66c1-494f-a677-f5e77348edb0` | the national public-transport stop registry (≈ 34k stops, CBS locality code, stop type — incl. "רכבת ישראל" station stops) | WGS84 |
| `lrt` | `b2ca8ac5-d7ea-41a5-8119-a30e98cf71e0` | light-rail station ENTRANCES: station, line, type, the Ministry's STATUS verbatim ("קיימת" existing · "מתוכננת" planned) | ITM → WGS84 (`lib/geo/itm.js`) |
| `rail` | `b6685ecf-2f87-4602-823e-af9790fd6aba` | heavy-rail passenger stations: name + STATUS ("נוסעים" in service · "בבניה" under construction) | none in the table |
| `metro` | `aaea25c0-1478-4ae6-9c61-1cce3cff5ae7` | planned metro stations: name + line | none in the table |

The rail / metro / line SHAPEFILES (`aws-e.data.gov.il/…/download/*.zip`) answer HTTP 403 to the runner (21.10.2026 discovery,
`lib/trust/discovery/2026-10-21-universe/mot2.json.gz`) — not bypassed. `lib/transport/shp.js` (a dependency-free ZIP + .shp + .dbf + .prj
reader, tested) is ready for the day the host answers.

## Street report

`access(points)` from the street's located points (the GovMap-layer file's parcel / building points): distinct stops within 300 m (count +
nearest), light-rail stations within 1,000 m (entrances grouped by station + line + status; nearest EXISTING and nearest PLANNED apart),
Israel Railways station stops within 1,500 m. Distances are straight-line metres (DERIVED), never walking distances. Proximity is context:
never a value, never a price effect; a planned station is never shown as operating. Missing states: `transport-not-synced`,
`street-not-located`.
