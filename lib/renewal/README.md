# Urban renewal — MoCH complexes

**Source.** data.gov.il dataset `urban_renewal` (Ministry of Construction and Housing), resource "מתחמי התחדשות
עירונית" (`f65a0daf-f737-49c5-9424-d378d52104f5`, CKAN datastore). One row per complex of the municipal and tax
urban-renewal tracks. Verified by `scripts/land-discover.js --supply` (Actions run 38330753512, 13.10.2026): 970
rows, resource last modified 2026-08-15. Classification CONFIRMED_STRUCTURED_API.

**What a row is — and is not.** A complex (מתחם) with its locality (name + CBS code), name, existing / additional /
proposed housing units, declaration date, plan number, links, track, approval year, an execution flag and the
Ministry's status. It is *not* construction (the status says how far planning / licensing went), not every renewal
project (TAMA 38 building permits are not complexes) and not a developer record.

## Modules

| file | role |
| --- | --- |
| `source.js` | `SOURCE` descriptor; `fetchComplexes()` — paged CKAN read, complete or fail |
| `normalize.js` | row → record: trimmed text, plain numbers only (text / "" → null, never 0), status verbatim + mapped `stage`, `declaration` (`declared` / `not-yet-declared` / `not-stated`), `unitsAddUp`, http(s) links only; required columns checked (`schema changed` fails the run) |
| `store.js` | `mergeRecords()` (upsert on the complex number, `firstSeenAt` kept, `inLatestSource` false when a row leaves, field history) + `FileRenewalStore` (`data/renewal/`) |
| `query.js` | read model for `api/intel.js`: `summary`, `records` (filters: city, stage, track, declaration, q; sorts), `record`, `searchHits` |

## Rules

- **Status verbatim.** The stage map covers only the exact status strings observed on 13.10.2026; anything else maps
  to `unknown` and is shown as the Ministry wrote it.
- **Units as published.** Existing + additional = proposed is checked per row (`unitsAddUp`); a row where it does not
  add up is shown as published with "≠", never corrected. Summed KPIs say over how many complexes they sum and are
  tagged DERIVED.
- **Nothing deleted.** A complex that leaves the source stays, marked `inLatestSource: false`, with the change in the
  history.
- **No join to developers or land.** A complex is linked to nothing it does not name itself (its plan number is shown,
  not joined).

## Files (bot-written by `.github/workflows/renewal-sync.yml`, daily 03:47 UTC)

`data/renewal/complexes.json` · `meta.json` · `history.jsonl` · `sync-runs.jsonl` · `raw/` (one snapshot per content
hash). Run locally: `node scripts/renewal-sync.js --dry-run`; offline suite: `node test/renewal.test.js`.

## Planning — the exact XPlan join (`planning.js`, `planning-source.js`, `planning-store.js`)

**Source.** The Planning Administration's xplan service, layer 1 "קוים כחולים-תכניות מקוונות" (`ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1`,
~37.6k plans managed online). Read daily on the runner by `scripts/renewal-planning-sync.js`, right after the complexes
(`renewal-sync.yml`), by POST (a GET with a batch of Hebrew numbers overran the server's URL limit).

**Join — exact keys only, in order.**

1. The plan number MoCH prints = the layer's `pl_number`, whitespace removed on both sides (the layer writes `תמל/ 2022`
   where MoCH writes `תמל/2022`; both spellings are asked). Nothing else is normalized.
2. The Mavat main-plan id in MoCH's own site link = the layer's `mp_id`. Discovery (Actions run 38384097282): 687 of 687
   complexes found by number carry a link whose id equals `mp_id`. Alone, the id joins only when MoCH prints no plan
   number or the linked plan's number equals the printed one.
3. Block / parcel: the layer publishes none — no parcel corroboration.
4. Geometry: MoCH publishes no complex geometry; a spatial relation alone is never a join (kept as a diagnostic).

Two keys naming different plans (number vs link, or one number naming several plans) → **ambiguous**, never a pick. A key
asked and absent → **not found** (with a reason: local pre-online number, VATMAL number, national number, no link).
A key never asked successfully → **not checked** (never "not found").

**Stage** — from the layer's own strings only: the station (`station_desc`) → PREPARATION · SUBMITTED · PRE_DEPOSIT ·
DEPOSITED · OBJECTIONS · APPROVAL_PROCESS · APPROVED; EFFECTIVE only when the station is approval and the latest event
(`internet_short_status`) is the approval's publication; REJECTED on a rejection event; anything else OTHER / UNKNOWN,
shown verbatim. The layer publishes no "cancelled" status; no stage says permit, construction start or completion.

**Units** (one definition: `lib/planning/xplan-units.js`, see `lib/planning/README.md`). `existingAuthorisedUnits` =
`pq_authorised_quantity_120`, the units authorised before the plan (equals MoCH's existing units in 615 of 760 joined
complexes); `planUnitDelta` = `quantity_delta_120`, the change the plan makes (equals MoCH's additional units in 500 of
767); `unitsAfterPlan` = their sum, DERIVED. The raw pair is kept in `raw`. Records stored before 13.10.2026 named them
`unitsApprovedState` / `unitsChange` (same values; renamed on read and on the next sync, no history event). MoCH and XPlan
values sit side by side; each pair says whether they differ.

**Derived (labelled).** Maturity (stage ordinal 1–8), declaration → approval years (or "approved N years before the
declaration"), deposit → approval years, unit gap, years since the layer's last update, stale planning (not approved /
rejected and not updated > 3 years), approved without MoCH permit / execution evidence (MoCH's own columns — not proof
that nothing was built). Sums over plans count each plan once, however many complexes reference it.

**Files** (bot-written): `planning.json` (meta incl. the join summary, lookups asked, plans one per line),
`plan-geometry.json` (boundaries, WGS84, generalized ~5 m), `planning-history.jsonl`, `planning-runs.jsonl`. Upsert on
`mp_id`; a plan leaves only when its own lookup succeeded without it; nothing deleted. Offline suite:
`node test/renewal-planning.test.js`.
