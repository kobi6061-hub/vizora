# Transaction events (`lib/txevents`, 20.10.2026)

**The first question PROPX answers about transactions is "did a real transaction occur, and does PROPX hold a defensible record of
it?"** — for any locality, street, address (building) or block · parcel, from every source PROPX reads, newest first. The second
question — which of its fields may enter a statistic — is the event's **state**, and never decides whether the event is shown.

## Sources (each kept apart; provenance never destroyed)

| id | what | window |
|---|---|---|
| `over:deals-register` | the Tax Authority register, republished copy (over.org.il) — the stored sweep (`data/streets/evidence/`) | 36 months to the copy's latest deal |
| `over:govmap-recent` | the GovMap deals layer, republished copy — the recent window (`lib/recent`), shown only while reconciled against the register copy PROPX holds | 75 days before the register's latest deal → the copy's load day |
| `over:govmap-national` | the same GovMap-layer copy, its **whole published file** (`scripts/txevents-national.js`) — rows of the register's window the register copy does not hold, under the recent layer's own reconciliation rules | the register's window, before the recent window |
| `register-live` | the register copy's live search (the transactions section) — the republisher's own address link and history older than the sweep | all years |

The source inventory (every candidate channel, reachable or not, and why) is `lib/trust/discovery/2026-10-20-transaction-sources.json`.

## One event per deal

A deal both copies hold is ONE event — the register's — with the GovMap row as its `evidence` (`data/txevents/links.json`). Every
field the two copies print differently is kept beside both values; a difference that is not the layer's documented format (amount
truncated to ₪1,000 · a share printed as the whole value) marks the event **SOURCE CONFLICT**. **Display precedence:** the register's
values over the layer's. A GovMap row the reconciliation calls a *possible* duplicate is shown, flagged **POSSIBLE DUPLICATE**, and
never counted.

## States (what an event may be used for)

| state | meaning |
|---|---|
| `PRICED_IN_STATISTICS` | a register dwelling deal priced by the register's rules (whole property, ≥ ₪100,000, one unit), placed in the scope with certainty — what a median of the scope reads |
| `VERIFIED_DWELLING` | a register dwelling deal not priced (a partial share, below ₪100,000, several units for one consideration, no amount) or placed without certainty |
| `RECORDED_EVENT` | a reported transaction that is not a dwelling, or whose property type the source does not state |
| `LIMITED_SHARE_NOT_STATED` | a GovMap-layer dwelling deal the register copy does not hold — real, dated, price as reported; the copy states no ownership share, so the price is never used |
| `CONFLICT` | the sources contradict each other on where the deal is |
| `POSSIBLE_DUPLICATE` | maybe a second print of a listed deal — shown, never counted |

## Geography (`geo.match`, street scope)

`STREET` (every address of the parcel on the street, or the published address and the parcel agreeing) · `STREET_POSSIBLE` (a corner /
multi-street parcel; a loose spelling of a published address — a spelling difference never hides a deal) · `STREET_VIA_PARCEL` (the
register's parcel had no address; the GovMap layer's addresses of the same parcel, run through the register's own street-matching
rule, put it on this street — `data/txevents/national/parcel-streets.json` + `data/txevents/parcel-streets.json`) ·
`STREET_VIA_PARCEL_POSSIBLE` · `STREET_PUBLISHED_ADDRESS` (the GovMap row's own address resolved in the official directory) ·
`STREET_REPUBLISHER_LINK` (the live search placed it here by the republisher's own address link). Only `STREET` (and `BUILDING`,
`PARCEL`, `LOCALITY`) is certain — the others are shown and never priced in the scope's statistics.

## Periods and absence

`days` / `months` / `all` filter the union; an empty period **never falls back** to older deals. Its statement is never
interchangeable (`statementOf`):

- `NONE_IN_PERIOD` — **NO RECORDED TRANSACTIONS FOUND IN THIS PERIOD**: the freshest copy CURRENT / RECENT and the evidence covering
  ≥ half the period;
- `NOT_IN_AVAILABLE_COVERAGE` — **NO TRANSACTION FOUND IN CURRENTLY AVAILABLE COVERAGE**: covered, but the copies are not current;
- `COVERAGE_INCOMPLETE` — **RECENT TRANSACTION COVERAGE INCOMPLETE**: the evidence does not reach half the period, or a source could
  not be read;
- with rows, the period's uncovered tail (after the date the evidence is checked through) is named.

## Recency summary (every scope)

LATEST KNOWN TRANSACTION (the union, not the register) · RECENT TRANSACTION SOURCES CHECKED · FRESHEST SOURCE SNAPSHOT · PRIMARY
REGISTER SNAPSHOT · "Transaction evidence checked through" (the newest date any read source reaches) — and "PROPX combines multiple
transaction sources. Some recent transactions may appear before all pricing details are fully verified."

## Files

| file | what |
|---|---|
| `index.js` | `query()` (scope · period · paging), `resolveScope`, `coverageOf`, `recencyOf`, `statementOf`, `liveEvents`, `wire` |
| `build.js` + `../../scripts/txevents-build.js` | the offline build → `data/txevents/` (`links.json`, `recent-extra.json`, `parcel-streets.json`, `latest.json`, `completeness.json`) |
| `../../scripts/txevents-national.js` + `txevents-gpkg.py` + `.github/workflows/txevents-national.yml` | the national missed-deal detector: version check every three hours; on a new GovMap-layer version, one GET of its GeoPackage, validated against the API window, reconciled nationally → `data/txevents/national/` |
| `../../scripts/txevents-audit.js` | the national stratified coverage audit → `data/txevents/coverage-audit.json` |
| `../../scripts/tx-sources-discover.js` + `.github/workflows/tx-sources-discover.yml` | the source inventory and the regression-case capture (read-only) |

API: `GET /api/gov/transactions` (the page's transactions section — the unified read for a swept locality, `unified=0` for the live
path alone), `GET /api/intel?view=txEvents&code=|sid=|block=&parcel=&days=|months=|all=1`, `view=street` → `events`,
`view=txCompleteness`, `view=txLatest[&district=][&days=|months=]` (a district's / the country's newest events of every source, the period's exact
count from the per-day tally and its statement by `statementOf` — the page lists them and never prices them as the area). Trust: `over:govmap-national`, `propx:transaction-events`. Gates:
`test/txevents.test.js` (the P0's 14 hard gates + the regression case).

The Street Value Model and the street statistics never read this module.
