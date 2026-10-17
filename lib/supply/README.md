# SUPPLY PIPELINE — `lib/supply/pipeline.js`

One pure read model, one call: the housing supply of a geography — Israel, one CBS district (`d-jm · d-north ·
d-haifa · d-center · d-ta · d-south`, and `js-area` as the dossier maps it) or one locality (CBS locality code) — as
**parallel universes** that are **never added together**.

```js
const { supply, UNIVERSES } = require('./lib/supply/pipeline');
supply({ level: 'il' })                                   // national
supply({ level: 'district', code: 'd-ta' })               // one district = the same computation over its localities
supply({ level: 'locality', code: '5000', now })          // one locality (string CBS code); null for an unknown geography
```

Nothing is fetched or modelled. The module reads the committed files through the read models PROPX already serves
(`lib/land/query`, `lib/renewal/query` + `lib/renewal/planning`, `lib/rental/query`, `lib/entities/query`,
`lib/planning/xplan-units`, `data/housing/lotteries.json`, `data/cbs-sales/latest.json`), memoizes per geography and data
stamp (the stores' `meta.json` mtimes + the day), and recomputes with `fresh: true`. After warm-up a locality or district
call takes ~10 ms. Determinism: same data + same `now` → the same answer.

## Output (schema 1)

```
{ schema: 1, geo: { level, code, name: {he, en}, district, districtName }, generatedAt, today,
  windows: { last12, prior12, last24, basis },            // dated from `now` (Israel time) and reported
  basis: {he, en},                                        // "universes are never added together …"
  universes: { planning, land, renewal, rental, lotteries, construction },   // in the order of UNIVERSES
  indicators: [ … ],                                      // DERIVED, each explainable (below)
  freshness: [ { id, label: {he, en}, observed, published, checked, state } … ],
  missing: [ { id, he, en } … ],
  universeOrder: [ … ] }
```

Every figure keeps its source id, its class (`OFFICIAL` for the sources, `DERIVED` for the indicators), its period or
window and a bilingual basis (`{he, en}`, Hebrew first). An unknown value is `null`, never 0; a count over a scope that
really has nothing is 0. **There is no key named `total`, `allUnits` or `pipelineUnits` anywhere, and no sum across
universes exists in the source** — `test/supply.test.js` gates both.

## The universes — and why they are never summed

The same homes travel through several universes: a plan authorises them, an ILA tender markets the lot, a lottery
offers them, a construction report counts the building. Adding the universes would count the same apartments two,
three or four times, so the module exposes no figure across them. `UNIVERSES` is the one ordered list (id, class,
source, label, what it counts, why it is not the others).

| id | source | what it holds | not the others because |
|---|---|---|---|
| `planning` | `iplan:xplan` (+ `datagov:rmi:planning-inventory`, STALE 2022, state land) | the plans PROPX holds for the geography — the renewal complexes' plans (exact join: plan number, then the Mavat id in MoCH's own link) and the plans the geography's **current** tenders reference (exact plan number) — each plan once, by stage, with `existingAuthorisedUnits` (pq_authorised_quantity_120), `planUnitDelta` (quantity_delta_120) and `unitsAfterPlan` (their sum, DERIVED — `lib/planning/xplan-units.js`); `overlap` counts plans reached both ways (not added); `stateLandInventory` = the ILA's 2022 potential-units list, labelled STALE and state land only | a plan's area is usually wider than one lot or complex; an approved plan is not a tender, a permit or construction; a plan with delta 0 only re-arranges an approved state |
| `land` | `rmi:michrazim` | the land read model's own `kpis()` over the live records of the geography in the **current** scope (in play, or decided within 24 months): `unitsOpen` · `unitsPendingDecision` · `unitsAwarded` · `unitsFailed` · `unitsDecidedNotRead` — four meanings of units that are never added — plus the unique lot pipeline (one count per lot file id), the lifecycle counts and the detail coverage; `momentum.published` / `momentum.awarded` over every live residential record by publication / decision date | state land only; awarded units are lot capacity, not homes built; the rental tenders sit here too |
| `renewal` | `datagov:moch:urban-renewal` | the Ministry's complexes in the geography: declared / not yet declared / not stated, by the Ministry's stage, `proposedUnits` / `existingUnits` / `additionalUnits` as `{sum, of}` (a sum only over the complexes that publish the column) — **additional ≠ net** (`unitsAddUp` says in how many rows proposed = existing + additional); `momentum.declarations` (count) and `declaredProposedUnits` (units) by declaration date | a declared complex is not construction; the complex's plan is counted in `planning` |
| `rental` | `rmi:michrazim · dira-lehaskir:wp` | the ILA rental track (type 6 / purpose 20–21), current scope: `tenders`, `tenderUnits` = the tenders' **TOTAL** units (a rental tender may also sell), `rentalUnitsStated` only as Dira Lehaskir wrote them and only over the same tenders on both sides — locality / national only, `null` for a district (its `rows` are the localities' rows) | the same tenders as in `land`, another angle; the rent index is a market benchmark, never a project rent |
| `lotteries` | `datagov:moch:dira-behanacha-lotteries` | lotteries and **first** lotteries in the geography, `unitsFirstLotteries` `{sum, of}`, `firstLotteryUnits` momentum by lottery date, `projectsByStage` from the entities registry (marketed · permitted · occupied … the furthest stage with direct evidence; `no-evidence` where none) | lottery homes are usually the same homes as an awarded lot — no shared key, never joined |
| `construction` | `datagov:moch:construction-progress` | MoCH progress rows joined to **awarded** lots by exact block + parcel, over every live awarded tender in the geography (not only the current scope): `tenders`, `lots`, `buildings` (one row = one building), `units` `{sum, of}`, `started` (excavation or foundations), `completed` (completion or form 4), first start / last completion, `asOf` — `stale: true` | only lots with a block/parcel and a matching row; the source stops at 2024-03-01 |

A locality is ⊆ its district ⊆ national in every count, and a district is literally the sum of its localities (the test
proves both). A district is never a national fallback.

## Windows and the small-sample rule

`windows` are dated from `now` (Israel date): `last12 = (today − 12 months, today]`, `prior12 = (today − 24, today − 12]`,
`last24 = (today − 24, today]`. Every momentum block reports `last12`, `prior12`, `pct`, `small`, `unit` (`units` or
`count`), the item counts, the windows and the source's coverage of each window.

* `pct = (last12 − prior12) ÷ prior12 × 100`, rounded to 0.1.
* `small: true` and `pct: null` when the prior window holds fewer than **3** items (tenders, complexes, lotteries, plans)
  or — for a unit figure — fewer than **100** units; also when `prior12` is 0.
* A window the source does not cover is `null`, never 0 (`coverage: 'none'`); a window the source covers only in part is
  computed and flagged `partial`; inside coverage a window without items is a real 0. Coverage follows each store's own
  rule: land by the source's newest publication / committee date, housing by its newest lottery date (the lottery source
  ends 2025-01-27, so its last-12 window is `null` and `missing` says so), renewal by its publication date, planning by the
  older of the two plan stores' read dates.

## Indicators (all `DERIVED`; `value: null` with a bilingual `reason` when inputs are missing or the sample is small)

| id | formula | limitations |
|---|---|---|
| `planning-momentum` (%) | Σ `planUnitDelta` of plans approved in the last 12 months vs the prior 12. "Approved in" = the layer's own dates: renewal plans — the gazette date (`pl_date_8`) of an EFFECTIVE plan, else the approval hearing date (`pl_date7`); tender plans — the gazette date only. Plans distinct by plan number across both stores; undated approved plans are not counted (`inputs.dated` / `datedBy` say how many are). `inputs.unitsAfterPlan` shows the same windows for units after the plan | only the plans PROPX holds for the geography (renewal complexes + current tenders), not every approval in it; delta may be 0 or negative; no dated stage transitions beyond the layer's fields — PROPX's own stage history (`data/renewal/planning-history.jsonl`) starts on 2026-10-13 |
| `land-marketing-momentum` (%) | Σ units published to tender (residential tracks) by publication date, last 12 vs prior 12 | state land only; published ≠ sold ≠ built; a re-tendered lot counts again |
| `tender-award-momentum` (%) | Σ units of lots with a recorded winner by decision date (committee / lottery / close), last 12 vs prior 12 | an award is not a contract, a permit or construction; detail-read tenders only |
| `renewal-declaration-momentum` (%) | complexes declared, last 12 vs prior 12 (count; the declared proposed units ride along in `inputs.proposedUnits`) | a declaration is not an approval, a permit or construction; the source covers up to its publication date |
| `lottery-momentum` (%) | Σ units in first lotteries, last 12 vs prior 12 | first lotteries only; a window after the source's newest lottery is `null` |
| `supply-pressure` (months) | **national / district only**: residential units awarded in the last 24 months ÷ (official T12 new-home sales ÷ 12) = months of awarded state land at the current official sales pace. District = the CBS district series (`data/cbs-sales/latest.json`, keyed by the dossier's district → CBS mapping). `null` for a locality (no official locality sales series) and when the sales metrics are a small sample | state land only; awarded ≠ built; tenders vs sales are different universes — a ratio, not an inventory |

## Freshness and what is missing

`freshness` keeps three dates apart per source — `observed` (the newest event the data describes: last published
tender, last declaration, newest lottery, latest CBS month, the plans' last update), `published` (when the source
published / updated it), `checked` (when PROPX last read it) — for `land`, `renewal`, `planning`, `inventory` (STALE),
`rental`, `housing`, `construction` (STALE) and `sales`.

`missing` names, bilingually: permits / starts / completions by locality (no joined machine-readable source — only the
stale progress rows on awarded lots); at locality level the official sales series and the supply-pressure indicator;
outside the national level the unsold inventory; at district level the stated rental units; the lottery windows the
source does not cover; private-land plans outside renewal and ILA tenders.

## Tests

`node test/supply.test.js` — read-only module; the three levels and unknown geographies; the six universes in order;
no total across universes (output keys and source); locality ⊆ district ⊆ national and district = Σ localities; the
land universe equals `lib/land/query`'s own KPIs; the momentum / small-sample / coverage rules (synthetic items and real
data); every indicator's formula · inputs · period · limitations in he + en and the value following the formula;
supply pressure null at locality level; the three freshness dates; missing items; every `{he, en}` pair; determinism;
speed.
