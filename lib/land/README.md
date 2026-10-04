# Land & Tender Intelligence — `lib/land/`

The Israel Land Authority's residential land tenders — what land is marketed,
which tenders are open or decided, who won, at what land price, with what
development cost, for how many units — traced, where exact evidence exists,
to planning capacity and to construction. A separate layer from Government
Housing (subsidized lotteries) and from Transactions: a tender is a land
marketing event, never an apartment sale. Nothing here is synthesized.

```
ILA tender site API (list · detail · map)              rmi.js, codes.js (the Authority's code tables, verbatim)
  → both lists merged (the "all" answer omits active)   scripts/land-sync.js
  → detail on a daily budget, remembered 404s, maps
  → one record per MichrazID: lifecycle, track, lots,   normalize.js
    winners (with evidence), economics with basis, geometry
  → exact joins: xplan plan number · RMI inventory ·    planning.js
    MoCH construction progress by block/parcel
  → upsert-merge, history, never delete                 store.js → data/land/ (+ Supabase land_*)
  → filters · periods · KPIs · cities · developers ·    query.js → api/land.js → #land
    pipeline · map points · one tender
```

## Sources (`sources.js` — the registry with classification, cadence, ids, limitations)

| id | what | class | use |
| --- | --- | --- | --- |
| `rmi:michrazim` | ILA tender site API: `SearchApi/Search` (whole list; `ActiveMichraz` true/false — merged), `MichrazDetailsApi/Get` (lots, bids, winners, parcels, plan numbers, documents), `GetMichrazMapaDetails` (ITM polygons), `GeneralTablesApi/Get` (code tables), `YeshuvimApi/Get` | CONFIRMED_STRUCTURED_API | the tender records |
| `iplan:xplan` | Planning Administration ArcGIS blue-lines layer (`PlanningPublic/Xplan/MapServer/1`, ~37k plans): station, approval date, approved units (`pq_authorised_quantity_120`) | CONFIRMED_GIS | joined by the **exact** plan number (whitespace removed) |
| `datagov:rmi:planning-inventory` | "מלאי תכנוני למגורים" (`99aad98f…`), 1,112 plans, potential units for marketing | **STALE** (2022-02-17) · **STATE LAND ONLY** | the pipeline view, dated; joined by exact plan number |
| `datagov:moch:construction-progress` | "דיווחי התקדמות הבניה" (`1ec45809…`), building-level stage dates by GUSH/HELKA | STALE (2024-03-01) | the only construction evidence: exact block **and** parcel join (parcel "0" never joins) |
| `datagov:moch:development-costs` | "עלויות פיתוח בבניה העירונית" (`bf164a03…`) | CONFIRMED_STRUCTURED_FILE | locality reference only — no exact key to a tender, never attached to one |
| `datagov:moch:development-tenders` / `-bids` | MoCH infrastructure tenders (enabling signal) / bid sums with blank ids | FILE / **UNJOINABLE** | not joined |
| `rmi:results-press`, `gov:tenders-portal` | result pages, the government tenders portal | OFFICIAL_PAGE_ONLY | not read |

## Semantics (`codes.js`, `normalize.js`)

* **Lifecycle** = the Authority's status code (TableID 237): 1 published · 2 open · 3 closed (decision pending) · 4 frozen ·
  5 decided → `awarded` only when a lot carries a winner **name and** an award sum or a winning bid, else
  `decided-no-award` · 6 lottery pending · 7 cancelled. A note the source writes into the winner column
  ("אין הצעות למתחם זה", "בחירת מתחם תערך במרחב") is a note, never a winner. **Contract, permit and construction start are
  not in this source** and are never inferred from an award.
* **Track** from type (TableID 215) + purpose (TableID −1, group מגורים/אחר) + priority populations: open-market
  (types 1, 9, 10, 11) · subsidized (5 מחיר מטרה, 7 מחיר למשתכן, 8 מופחת) · rental (6 / purposes 20, 21) ·
  special-population / residential-lottery (2, 3, 4) · mixed-use (purpose 12) · commercial-other. Never from text.
* **Price basis** per tender: `competitive-bid` (SugTacharut 1 — a total land price) · `price-per-sqm-bid` (type 7 or
  SugMechirMufchat 1 — ₪ per built m² under `MechirMaximum`; never divided into units) · `fixed-price-allocation`
  (types 2, 3, 4) · `unknown`. `MechirSaf = 1` is a token minimum (no premium computed). **VAT: not stated by the source.**
* **Economics** per lot only when numerator and denominator are the lot's own: land/unit = winning sum ÷ lot units;
  development/unit = `HotzaotPituach` ÷ units; total basis = both; premium vs minimum / appraisal; bids received
  (null when no bid list is published — not zero). Tender-level figures sum **awarded lots only** (`scope`).
* **Positions**: the tender polygon's centroid, ITM → WGS84 exactly (`lib/geo/itm.js`); otherwise locality-level
  presentation from the registry — never a synthetic pin.
* **Developers** = observed public tender wins on this site, grouped by the exact winner string. Never merged by name
  similarity; never a "land bank".

## Storage (`store.js`, `data/land/`)

`tenders.json` (one slim record per line, null keys dropped) · `lots-<year>.json` (the lots, bids, parcels of each tender
with detail) · `plans.json` (xplan plans + RMI inventory + xplan misses) · `reference.json` (MoCH development costs) ·
`meta.json` · `history.jsonl` (every change of a source field: status, lifecycle, dates, units, winners, lot/bid counts,
documents, listing) · `sync-runs.jsonl` · `raw/<date>-<hash>.json.gz` (the list payload when its content changed).
Upsert on `rmi:<MichrazID>`, `firstSeenAt` kept, a delisted tender kept with `inLatestSource:false`. The Supabase project
(`market.land_tenders / land_lots / land_tender_history / land_plans`, view `land_winners`) receives the same rows and the
detail payloads of each run (`raw_snapshots`, source `rmi:michrazim:detail`).

## Sync (`scripts/land-sync.js`, `.github/workflows/land-sync.yml`, daily 03:17 UTC)

Detail budget per run (default 1,500; `--ids` first, then list rows whose status changed or are new, active tenders not
re-read for 7 days, decided in the last year not re-read for 30 days, never-read newest first, then the oldest read).
Every record says when its detail was read (`provenance.detail.fetchedAt`); a tender whose detail answered 404 is re-asked
only after every read tender (lowest priority) for 60 days. Map budget 400. The joins run on their own budget
(`--joins-minutes`, default 15): the xplan join asks for plan numbers not known or older than 30 days (misses re-asked after
90 days) in batches of 10, up to `--xplan-requests` (150) per run; a failed batch leaves its plans "not checked" (never
"not found"); when the MoCH progress source does not answer, each tender keeps the construction evidence of its last
successful join. Into `data/land/` only an official raw list snapshot from `data/land/raw/` recorded by a live run may be
replayed (`--from`, to restate the records under a new normalizer). Exit 0 ok · 2 Supabase write failed · 1 failed.
The read side serves the bundled files (`freshness.store: 'git'`).

Price basis: the detail's competition code first (`SugTacharut` 1 = price competition, also seen on lottery types 2 and 3);
a lottery / priority type without it allocates at a fixed price (the allottee is named, the sum may not be published);
an open-market type whose older detail carries no code is a price tender by the Authority's type (`basisEvidence`).
Land per unit on the page: competitive bids only, open-market track unless a track is selected. Construction evidence is
attached only to an awarded tender and only from rows whose contract year is not before the award.

## Coverage, scope, unit semantics, lineage (`coverage.js`, `lineage.js`, `query.js`)

* **Coverage** is counted over the stored records, never estimated: `retrieved` (detail read), `unavailable` (the site
  answered 404), `refused` (403/429), `pending`; `checked = retrieved + unavailable + refused`; per year of the
  tender id, with the newest years that are complete. Every API answer carries it (`detailCoverage`), and the page's
  coverage strip tags each figure **FULL LIST** (the whole tender list) · **PARTIAL DETAIL** (depends on detail read on a
  budget) · **DERIVED SUBSET** (derived only from detail-read tenders). Winner / lot / developer analytics are never
  presented as full-market statistics while coverage is partial.
* **Scope** `scope=current` (the page's default) = tenders still in play (published / open / closed / awaiting
  lottery / frozen) plus every decision — award, no award, cancellation — of the last 24 months (`decisionDate` =
  committee ∥ lottery ∥ close ∥ publication date); `scope=all` = every source record since 2000 (lifetime totals, not a
  pipeline).
* **Units** keep four meanings apart and are never summed into one another: *published tender units* (the Authority's
  YechidotDiur on every tender in scope — includes re-tenders, cancelled and failed ones; not unique supply) · *currently
  open units* (published / open) · *pending decision* (closed / awaiting lottery) · *awarded* (units of lots with a
  recorded winner; the published units of awarded tenders are reported beside it) · *failed / cancelled* (cancelled,
  frozen, decided with no winner) · *decided, detail not read* (outcome unknown). The **unique pipeline** counts a lot
  once by the Authority's lot file id (TikID) with the units of its latest marketing in scope, over detail-read tenders
  only; the tenders it cannot deduplicate (detail not read) are reported with their units, never silently included or
  excluded.
* **Lineage** links two tenders only when they share a lot file id (TikID — the same id returns when a lot is marketed
  again), corroborated by the plan+lot numbers printed on the lot. The relationship follows the earlier tender's own
  outcome: `re-tender` (it failed: cancelled / frozen / no winner) · `unawarded-lot-re-marketed` · `awarded-lot-re-marketed`
  · `round-after-closing` · `parallel-marketing` (same publication date) · `successive-marketing`. A shared block/parcel
  without a shared lot is a `same-parcel` site-level link, never used to merge or deduplicate. Names and localities
  never link anything. Each tender's drawer lists its predecessors and successors with the evidence.
* **Land per unit** states its population on every answer (`landBasis`): competitive bids only, open-market track unless
  a track is selected, the lots / units / tenders counted, the tender types included, the median lot figure, the
  period and scope, development cost excluded, nominal ₪ at award, VAT not stated.
* **Construction** evidence is an explicit chain — tender → block/parcel → MoCH progress record (site, building, units)
  → latest stage → source and as-of date — only on awarded tenders; everything else is "—".
* **Store truth** (`view=status` → `store`): the page reads the bundled `data/land/` files; the Supabase tables exist in
  the migration and are written only when the Actions secrets exist (each run records its store outcome in its own
  `<runId>:store` entry of `sync-runs.jsonl`, and `store.supabase` reports that recorded value — `not-configured` until the
  secrets exist — with the run it comes from); DB-first reads are not implemented.

## API (`api/land.js`, session-gated)

`view=summary|tenders|tender|pipeline|map|status` · `period=6m|12m|24m|5y|all|custom` over `dateField=published|close|committee` ·
`city` (CBS code or name) · `region` · `track` · `lifecycle` · `type` · `purpose` · `basis` · `winner` (exact) · `plan` ·
`residential=1` · `awarded=1` · `q`. Every answer carries `freshness` (checked at, latest publication, detail coverage) and
`summary.methodology`. Missing values are null → "—" on the page.
