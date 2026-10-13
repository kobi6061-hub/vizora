# XPlan housing-unit fields — what they mean (audit 13.10.2026)

One definition for every PROPX module: `xplan-units.js` (`interpretUnits`, `unitsOfAttributes`, `unitsOfStored`, `sumUnits`, `SEMANTICS`).

| source field (layer `PlanningPublic/Xplan/MapServer/1`) | alias published by the layer | meaning | PROPX name | HE / EN label |
| --- | --- | --- | --- | --- |
| `pq_authorised_quantity_120` | מגורים מאושר יח"ד | housing units already authorised in the plan area **before** this plan (the approved state the plan starts from) | `existingAuthorisedUnits` | יח״ד מאושרות לפני התוכנית / Previously Authorized Units |
| `quantity_delta_120` | שינוי מס' יח' דיור | the **change** this plan makes to that state (0 or negative possible) | `planUnitDelta` | תוספת יח״ד בתוכנית / Plan Unit Delta |
| — (not published for code 120) | — | `pq_authorised_quantity_120 + quantity_delta_120` — **DERIVED** | `unitsAfterPlan` | סה״כ יח״ד לאחר התוכנית / Units After Plan |

Missing either value → `unitsAfterPlan` is `null` (shown "—"); a negative sum → `null`, flagged `negative-after-plan`.
The raw pair is always kept as published (`raw.pq_authorised_quantity_120`, `raw.quantity_delta_120`). Nothing is read
from plan names or text.

## Evidence

1. **The layer's own metadata** — the aliases pair an *approved* quantity ("מגורים מאושר") with a *change* ("שינוי מס' יח'
   דיור"), the two columns of the quantities table every plan's instructions carry (approved state · change · total
   proposed); the layer publishes the first two for code 120. (The code-110 triple is not usable as a cross-check: its
   aliases mix m² and units, and its "proposed" field equals approved + change in only 39 of 707 plans.)
2. **Every plan of the layer** — `scripts/land-discover.js --xplan-semantics`, GitHub Actions run 38421239199, 37,573 plans
   read (POST, paged by objectid):
   - the plans' own objectives text, used as VALIDATION ONLY:
     - "from X units to Y units" (312 plans): X = `pq_authorised_quantity_120` in 265, Y = authorised + delta in 267, both in 251;
     - "adds N units" (1,307): N = `quantity_delta_120` in 986 (75%), N = `pq_authorised_quantity_120` in 186 (14%);
     - "total N units" (1,235): N = authorised + delta in 956 (77%), N = `pq_authorised_quantity_120` in 84 (7%);
   - distribution: both 0 — 15,177 (no housing quantities: infrastructure, 77/78 notices, distribution networks);
     authorised 0 & delta > 0 — 1,818 (new neighbourhoods: nothing authorised before them; 93 of the 170 approved
     preferred-housing plans); authorised > 0 & delta 0 — 8,802; both > 0 — 11,036; delta < 0 — 740;
     authorised + delta < 0 — 1. A change applied to a base, not a total.
3. **Validation sets** (evidence, not the definition):
   - MoCH urban renewal, 766 exact joins: existing units = authorised in 615 of 760; additional = delta in 500 of 767;
     proposed = authorised + delta in 480 of 761 (= authorised alone in 2);
   - ILA planning inventory (state land), 100 plans with both: marketing potential = authorised + delta 26, = delta 21,
     = authorised 2.
4. **Mavat** — the guessed public JSON path (`/rest/api/SV4/1?mid=…`) answered 404; no Mavat page was used.

## Correction trail

Until 13.10.2026 the Land & Tender section read `pq_authorised_quantity_120` as the plans' "approved housing units"
(pipeline "יח״ד מאושרות בתוכניות", tender drawer "יח״ד מאושרות", API `approvedUnitsInPlans` / `referencedPlans.approvedUnits`).
That value is the state **before** each plan. The stored records (`data/land/plans.json`, `tenders.json`) and their Supabase
copy were **not** rewritten: they keep the raw value under the legacy key `approvedUnits` (and the delta under
`unitsDelta`); every read goes through `xplan-units.js`, and the API serves the explicit pair + the derived sum instead.
