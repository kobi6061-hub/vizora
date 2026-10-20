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

## ALL = the whole history (closure P0, 20.10.2026)

The stored window (36 months) is an optimization boundary, never the meaning of ALL. `all=1` (the page sends it for "all available")
pages a place's history newest first, **by date** (`lib/txevents/history.js`, `api/gov/transactions.js` `historyPage`):

- the **register copy** through its own live search with no lower date bound — a page shows its rows dated in (L, C]; L is the
  highest day the settlement spellings that still hold older rows reached (`floors`); a day holding more than a page is read whole;
  the search's 100,000-row offset cap is never reached (offset stays 0);
- the **GovMap layer's history** (every row of the published file before the window: `data/txevents/history/gm-<year>.json.gz`,
  regrouped per locality in `history/loc/<code>.json.gz` by `scripts/txevents-history-index.js`, read lazily) — its rows dated in
  (L + 1, C + 1], each **folded** into the register deal it repeats (`fold`: the same unit, then the same block · parcel, ±1 day, the
  amount equal · the layer's ₪1,000 truncation · a share); a near miss is shown as POSSIBLE DUPLICATE, never counted;
- past the register's oldest deal the layer's rows continue in pages of whole days (≈ 500 rows, a `…g` cursor); the register rows
  read there are fold references only (all of them were shown already);
- a register read that does not answer is an error and a retry cursor (`olderError`), never "no older deals"; the register's own
  "no settlement" answer is a real zero (a locality only the GovMap layer holds);
- `area=il|d-<district>` pages the register's national search the same way, with the area's GovMap events; Israel adds the
  UNPLACED events;
- a later offset page whose live parts did not answer is refused (HTTP 503, `retry: true`) — the list would be shorter than the
  page before and an event could slide past unseen; a shifted page is never served;
- the live register read takes every name the register files the locality's deals under: its own code, the republisher's resolution
  of a code-less name (`resolved_code`: קרית חיים → Haifa, as the stored sweep reads it), the locality's names;
- a register deal filed under an unmapped settlement name (placed by parcel) with no street of its own stands on the street its
  GovMap print names (POSSIBLE, `address-of-the-govmap-print-of-this-deal`); a print naming another street than the deal's own address
  is a CONFLICT attached to the one event (`street:differs`, register precedence, both values kept).

## Every source row accounted for (`scripts/txevents-completeness.js` → `data/txevents/completeness-audit.json`)

Every row of the GovMap file is in one bucket — SURFACED · SURFACED OR FOLDED (history) · SURFACED FLAGGED (possible duplicate) ·
DUPLICATE OF SURFACED · UNPLACED · INVALID (future-dated / no date: kept in the evidence, never shown) — history + window + invalid =
the file; each bucket is proven reachable through a user path (`reachability`); DEFENSIBLE KNOWN SOURCE EVENTS NOT SURFACED = the rows
no path reaches (target 0). The register side: its own count, the deals under official localities, under settlement names no official
locality carries (`scripts/txevents-register-unmapped.js`: every deal read, placed by its parcel — `history/register-unmapped.json`,
the register's per-name counts and last deal in `history/register-settlements.json`) and under no settlement name (Israel's list,
through the national search). Also: the locality recovery (`lib/txevents/recover.js`: RESOLVED EXACTLY — the row's own official code
or its exact register twin · RESOLVED STRONGLY — its parcel / polygon filed under one locality by both copies · POSSIBLE LOCATION ·
UNPLACED; only the first two enter a geography), the street-string audit of both copies, the parcel recovery, and LATEST-DATE PARITY:
the newest event the sources hold vs the first the user sees, for Israel, every district, locality and street with an event. The
places whose newest deal predates the window are checked live by `scripts/txevents-all-check.js` (`.github/workflows/txevents-all-check.yml`
→ `data/txevents/all-check.json`: full ALL pagings — a small locality and the regression street deal by deal against the register's
own search —, period filters, the latest event through the page's own read for every locality the stored union does not cover, and a
sample of streets whose every event predates the window: their first ALL event vs the register's street search + the GovMap history;
the republisher's rate limit is waited out, never read as an answer).

UNPLACED TRANSACTION EVENTS (`lib/txevents/unplaced.js`, `view=txUnplaced`): the rows whose locality cannot be determined — in Israel's
list and the Trust Center's unplaced list, never a locality, street or district; every source field kept; a POSSIBLE LOCATION lists
its candidates, never picks one; never priced.

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
| `history.js` + `../../scripts/txevents-history.js` + `txevents-history-index.js` | the GovMap layer's history (year + locality partitions), `fold`, `span` |
| `unplaced.js` · `recover.js` · `kit.js` | the unplaced events; the locality recovery; the shared extract readers |
| `../../scripts/txevents-register-unmapped.js` | the register's deals under unmapped settlement names (runner, one request a second; skipped when neither copy changed) |
| `../../scripts/txevents-completeness.js` · `txevents-all-check.js` | the full-universe audit (offline) · the live ALL / latest check (runner) |
| `../../scripts/tx-sources-discover.js` + `.github/workflows/tx-sources-discover.yml` | the source inventory and the regression-case capture (read-only) |

API: `GET /api/gov/transactions` (the page's transactions section — the unified read for a swept locality, `unified=0` for the live
path alone), `GET /api/intel?view=txEvents&code=|sid=|block=&parcel=&days=|months=|all=1`, `view=street` → `events`,
`view=txCompleteness` (+ `audit`), `view=txUnplaced[&state=][&offset=]`, `view=txLatest[&district=][&days=|months=]` (a district's / the country's newest events of every source, the period's exact
count from the per-day tally and its statement by `statementOf` — the page lists them and never prices them as the area). Trust: `over:govmap-national`, `propx:transaction-events`. Gates:
`test/txevents.test.js` (the P0's 14 hard gates + the regression case), `test/txevents-closure.test.js` (ALL paging against a fake register, the
fold, unanswered-register handling, areas, unplaced, periods, the full universe, latest-date parity, the regression geographies).

The Street Value Model and the street statistics never read this module.
