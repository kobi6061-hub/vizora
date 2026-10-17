# PROPX Knowledge Graph — `lib/graph/`

A canonical, deterministic **graph view** over the read models PROPX already serves. It creates no fact: it exposes
the entities PROPX stores and the relationships the stored records carry by an **exact official key**, each edge with
the key it rests on, the value of that key and the source that delivered it — so the product can behave as one
connected system while every link stays auditable. What no record carries is not an edge: it is counted (unmatched)
or listed (conflicts).

```
lib/entities/query.js  load()  → developers · moch:<ProjectID> projects · ila:<MichrazID>:<lot> sites · the registry's possibleSame links
lib/land/query.js      load()  → live tender records (lotRefs, plans[], parcels[], winners[]) · stored XPlan plans · lineageOf() through the lot file
lib/renewal/query.js   load()  → live complexes + the exact XPlan join (exact · ambiguous · not-found · no-identifier · not-checked)
lib/rental/query.js    load()  → Dira Lehaskir developer-tender notices by MichrazID
lib/dossier/query.js   DISTRICTS · data/geo/localities.json (code · he · en · district)
        ↓
lib/graph/index.js     build once per data stamp → node(id) · edges(id) · neighbours(id) · degree(id) · stats()
api/intel.js           view=graph&entity=<id> · view=graphStats
```

Basis (bilingual, on every `stats()` and `view=graph` answer): *a read over stored records; every edge carries the
exact key it rests on, its value and the source that delivered it; nothing is inferred — not by name, not by
geometry, not from an ambiguous join.*

## Entity types and ids

The ids are the ones the read models already use — a graph id resolves in the section that owns the entity.

| type | id | from |
| --- | --- | --- |
| `country` | `il` | — |
| `district` | `d-jm · d-north · d-haifa · d-center · d-ta · d-south · js-area` | `lib/dossier/query.js` `DISTRICTS` (the CBS districts, a constant table) |
| `locality` | `loc:<CBS locality code>` | `data/geo/localities.json` (51 registry rows without an official code are no entity — counted) |
| `developer` | `dev-<sha1 of the canonical name>` | `lib/entities/registry.js` — one canonical legal name, typographic variants only |
| `project` | `moch:<ProjectID>` | the registry's MoCH lottery projects |
| `site` | `ila:<MichrazID>:<lot file id (TikID)>` | every lot file (`lotRefs[]`) of every live tender; the registry site (a listed developer's residential lot) adds its fields |
| `tender` | `rmi:<MichrazID>` | `data/land/tenders.json`, live records |
| `plan` | `plan:<plan number, whitespace removed>` | the plan numbers the ILA lot files print (`join: 'exact-plan-number'`); the stored XPlan record when one exists (land `plans.json` / renewal `planning.json`) |
| `parcel` | `parcel:<block>/<parcel>` | `parcels[]` of the tenders, `lotRefs[].parcels` |
| `renewal_complex` | `renewal:<complex number>` | `data/renewal/complexes.json`, live records |
| `rental_project` | `rental:<MichrazID>` | a Dira Lehaskir developer-tender notice whose printed tender number names a live ILA record (the notice id is kept as `attrs.noticeId`) |
| `source` | `source:<trust id>` | `rmi:michrazim · iplan:xplan · datagov:moch:dira-behanacha-lotteries · datagov:moch:urban-renewal-complexes · iplan:xplan:renewal · dira-lehaskir:wp · geo:registry · propx:districts (CONSTANT) · propx:entities-registry (DERIVED)` |

A node is `{ id, type, label: {he, en}, attrs, source, degree }` — slim, typed attributes copied from the read model
(a site without a listed developer carries **no winner name**: private persons are counted, never listed).

## Relations and their evidence keys

Every edge is `{ relation, from, to, evidence: { key, value, source }, …detail }`; `edges(id)` adds `direction`
(`out` / `in`). One edge per (relation, from, to).

| relation | from → to | evidence key (the stored field) | source |
| --- | --- | --- | --- |
| `CONTAINS` | country → district | `DISTRICTS` | propx:districts |
| `CONTAINS` | district → locality | `localities.json district` | geo:registry |
| `CONTAINS` | tender → site | `lotRefs[].id` (TikID, the Authority's lot file id) | rmi:michrazim |
| `IN` | district → country · locality → district | the inverse of the two geography pairs | |
| `LOCATED_IN` | tender / project / renewal_complex → locality | `localityCode` (the CBS code the source prints; the locality must be in the registry) | the record's source |
| `HAS_WINNER` | site → developer | the registry site's `developerId` ← `winners[].name` (canonical, listed legal names only) | rmi:michrazim |
| `WON` | developer → site | the inverse of `HAS_WINNER` | rmi:michrazim |
| `DEVELOPS` | developer → project | the registry project's `developerIds` ← the lottery rows' developer string (canonical) | datagov:moch:dira-behanacha-lotteries |
| `REFERENCES` | tender → plan | `plans[].plan` with `join: 'exact-plan-number'` (the number printed on the lot file; `xplan: found / not-found / not-checked` on the edge) | rmi:michrazim |
| `REFERENCES` | renewal_complex → plan | the exact XPlan join of `lib/renewal/planning.js`: `plan-number` (= `pl_number`) and / or `mavat-id` (MoCH's own link = `mp_id`); the edge carries `mpId` + `joinEvidence` | iplan:xplan:renewal |
| `ON_PARCEL` | tender → parcel | `parcels[].block/parcel` (GushHelka) | rmi:michrazim |
| `AFFECTS` | plan → parcel | **one** stored lot file (`lotRefs[]`) carrying both a `plan\|lot` key and a `block/parcel` — the only stored record in PROPX that carries a plan and a parcel together (XPlan publishes no parcels); the edge names the tender and the lot | rmi:michrazim |
| `RE_MARKETS` | tender → tender (earlier → later) | a lot file id (TikID) shared by both tenders (`lib/land/lineage.js`); `kind` = re-tender · unawarded-lot-re-marketed · awarded-lot-re-marketed · round-after-closing · successive-marketing. **`same-parcel`** (site-level only) and **`parallel-marketing`** (same publication date) are not edges | rmi:michrazim |
| `JOINED_TO` | rental_project → tender | the tender number Dira Lehaskir prints (region/number/year) → MichrazID = year × 10000 + number | dira-lehaskir:wp |
| `POSSIBLY_SAME` | developer → developer | the registry's `possibleSame` link: `strict-prefix` or `same-letters` — **flagged, never merged** (`merged: false` on the edge and on both nodes) | propx:entities-registry |
| `SOURCED_FROM` | tender / project / renewal_complex / rental_project / plan → source | the record's `provenance.source` or the store's declared source; the value is the record id (a plan: its `mp_id`) | |

## What is NOT an edge

* **A name match of any kind.** Developers are linked only through the registry's own id written on the site /
  project; the graph module never calls a name-likeness helper (`test/graph.test.js` greps its source). Two
  developers that may be one entity are `POSSIBLY_SAME` — shown, never merged, never combined in any count.
* **Geometry.** No distance, no centroid, no polygon overlap links anything (the Authority's centroids and the XPlan
  outlines stay attributes of their own records).
* **An ambiguous join.** A renewal complex whose MoCH plan number and Mavat link name different plans (or whose number
  names several plans) has no plan edge; it is listed under `stats().conflicts.ambiguousRenewalJoins` with the
  reason and the candidates.
* **District data on a locality.** A locality's edges are its own records; the district series never descends.
* **A cross-source join without a shared key.** A MoCH lottery project is never attached to an ILA lot (the lottery
  rows carry no tender, plan or parcel).
* **A not-a-plan-number.** The site-link numbers the ILA prints (`join: 'not-a-plan-number'`) are not plans.
* **A lot that no record indexes.** A winner lot is a site only through the lot file id (`lotRefs[]`) or the winner
  entry of its tender — never by a locality + units match.

## `stats()`

* `nodes.byType`, `edges.byRelation`.
* `coverage` — each `{ num, den, ratio, basis }` with the store's own denominator: tenders with ≥ 1 exact plan edge
  / live tenders; tenders with ≥ 1 plan found in XPlan; tenders located; tenders with a parcel; tenders on a
  `RE_MARKETS` edge; **lots with a `HAS_WINNER` edge / awarded lots** (lots with a recorded winner); projects with a
  developer; projects located; complexes with an exact plan edge / live complexes; complexes located; notices joined /
  developer-tender notices; localities in a district / coded localities.
* `unmatched` — tenders whose plan references found no XPlan plan (+ `planRefs` by status); complexes with no plan
  join by status; **winners without a listed developer** — `unlisted` (unmarked strings, usually private persons =
  the registry's `unmarkedLots`), `nonResidentialTrack` (a listed developer on a non-residential track, for which the
  registry builds no site), `emptyString`; tenders / projects / complexes whose locality code is missing or not in the
  registry; registry rows without a code or a district; notices without a tender number / without a live ILA record /
  duplicate; lineage links excluded by rule.
* `conflicts` — `ambiguousRenewalJoins` (id · reason · candidates · `planNumberDiffers`), `possiblySameDevelopers`
  (developers · links · byEvidence), `plansResolvedDifferently` (a plan key the land XPlan store and the renewal XPlan
  store resolve to different `mp_id`s — checked over the plans both reference and over every key both stores hold;
  `planKeysInBothXplanStores` says how many were compared).
* `planAffectsParcel` — lots carrying both keys, pairs, the basis; says so when no record carries both.
* `store` — the raw counts the denominators come from; `sources`; `notEdges`; `basis`; `build` (stamp, time, ms).

## Memoisation and cost

The graph is built once per data stamp — the entities, land, renewal and rental caches' stamps plus the geo
registry's mtime — in one linear pass over the stored records (≈ 1.6 s on the bundled data for ≈ 111 k nodes and
≈ 198 k edges, after the read models themselves are loaded). `node()` is a map lookup, `edges()` / `neighbours()`
walk the node's adjacency list and stop at `limit` (default 200, max 1000). `load({ force: true })` rebuilds.

## API (`api/intel.js`, session-gated, GET)

* `view=graph&entity=<id>` → `{ node, edges, edgesTotal, neighbours, relation, limit, basis }`; `relation=<RELATION>`
  narrows (an unknown relation is 400), `limit=` default 200 max 1000; 404 for an unknown id, 400 without one.
* `view=graphStats` → `stats()` + `vocabulary` (entity types and relations with their evidence keys).

Tests: `node test/graph.test.js` (over the committed data, read-only).
