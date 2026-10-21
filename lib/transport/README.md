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

## The layer's date and the stop registry (21.10.2026)

The light-rail layer states a month per row (`YEARMONTH`); every station carries it (`statusAsOf`) and the page prints "status as of
MM.YYYY". The layer is OLDER than the stop registry for some lines — 21.10.2026: the Tel Aviv Red Line's surface stations (Petah Tikva,
Bnei Brak, Ramat Gan, Bat Yam, Jaffa) are "מתוכננת" as of 2024-11 although the registry (updated 2026-10-01) lists light-rail stops beside
24 of them. PROPX never changes the layer's status. Instead, as SEPARATE evidence:

- `lrt.registry` — the registry's light-rail stops (types 4 "רכבת קלה" / 18 "רכבת קלה - רציפים") within 1,000 m of the street (count +
  nearest); the registry carries no line, no station name and no service status;
- per station, `registryStopM` = the distance from the station's nearest entrance to the nearest registry light-rail stop when it is
  ≤ 150 m — the radius EVERY existing station of the layer meets (`registryMatch`, measured at load: 33 / 33 on 21.10.2026); for a station
  the layer does not mark existing, `registryNote` states both values. An interchange station of a planned line can find the operating
  line's stop (the registry states no line) — the note says so; nothing is promoted.

Rail station stops = registry types 7 "רכבת ישראל" + 19 "רכבת ישראל - רציפים" (platforms).
