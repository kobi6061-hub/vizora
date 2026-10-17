# PROPX · Market Dossier — one institutional read of a geography

`lib/dossier/query.js` composes the read models PROPX already serves into one dossier for **Israel**, a **district**
(`d-jm · d-north · d-haifa · d-center · d-ta · d-south · js-area`) or a **locality** (CBS locality code):
`GET /api/intel?view=dossier` (`city=<code>` | `district=<d-…>` | none = national); `view=dossierIndex` lists the
geographies. The page shows it as the "תיק שוק" section (`#dossier`); the dossier follows the board's own selection (country /
district / city — an exact name match against the dossier index, typographic hyphen and quote variants only, never a
similarity match) and a registry locality picked in the geo search opens its dossier. Signal thresholds and periods
are bilingual; the registry's lower-case English locality names are shown title-cased (display only).

Every figure keeps its source, class and dates:

| Section | Source | Class | Geography rule |
| --- | --- | --- | --- |
| official sales | CBS series 44,10 (`data/cbs-sales`) | OFFICIAL | national, or the **district** series — a locality shows its district's figure labelled "district level, not the locality's figure"; there is no official locality series |
| inventory, months of supply | the same series | OFFICIAL | national only; a district or locality names it missing |
| land & tenders | ILA (`lib/land`) current scope | OFFICIAL | locality: the land read model; district: the same KPI function over the live records of its localities; national: all |
| subsidized housing | MoCH lotteries (`lib/housing`) | OFFICIAL | locality / national: the housing KPIs; district: lottery counts per locality (units and applicants are not summed across localities) |
| urban renewal | MoCH complexes (`lib/renewal`) + the exact XPlan join | OFFICIAL | district: exact over the complexes file |
| long-term rental | ILA rental track + Dira Lehaskir terms (`lib/rental`) | OFFICIAL | tender units = the tender total; rental units only as the company wrote them; the rent index is a general benchmark |
| developers | the activity registry (`lib/entities`) | OBSERVED | exact names, never merged; district: developers with a market in the district; "lots here" vs total |
| macro | BoI rate, CBS indices (`data/market`) | OFFICIAL | national context — never a local figure (the dwellings index has a district level where published) |
| recent changes | the Market Radar (`lib/radar`) | per event | the same geography, 30 days (7 nationally) |

**Not in the dossier, said so:** transactions (a live republication read in the Transactions section — the dossier
never fetches), permits / starts / completions by locality (no joined machine-readable source).

**Unit universes are never added together** (tender ≠ lottery ≠ renewal ≠ rental units).

**Signals** ("what to watch" / "what could go wrong") are explainable triggers — trigger, value, threshold, period,
source, class — never a recommendation: sales momentum ≥ +10% / ≤ −10% (district or national, no signal on a small
sample), months of supply ≥ 18 (national), ≥ 30% of ≥ 5 current tenders decided without a winner or cancelled, ≥ 500
units in open tenders, ≥ 1,000 awarded units, ≥ 500 units awaiting decision, ≥ 2,000 proposed renewal units, ≥ 3
rental-track tenders, ≥ 3 rental tenders in play only through a status older than 36 months, ≥ 2 developer entries,
one developer holding ≥ 50% of ≥ 5 leading lots, no observed events in the window, construction inputs ≥ +3% y/y.

**Evidence quality** HIGH / MEDIUM / LOW = 100 minus documented deductions (no official sales series −15, district-only
sales −8, stale series −8, no inventory −5, tender details read for < 70% −8, no tenders −6, no developers −5, no renewal
−3, a source checked more than 7 days ago −4 each, transactions not included −5, no permits source −6). Not a
probability. **Freshness** keeps observation, publication and PROPX-check dates apart per source.

**Supply pipeline (`lib/supply/pipeline.js`, `view=supply`):** the page's dossier also shows the geography's six parallel
supply universes — plan units (XPlan: units after plan, delta; the plans of the renewal complexes and the plans the tenders
reference; the stale 2022 state-land inventory), ILA tender units (open · awaiting decision · awarded · failed), renewal
complex units (proposed, additional ≠ net, by stage), rental-track tender units (total; stated rental units only as the
company wrote), lottery units (first lotteries; projects by stage), construction evidence (buildings started / completed,
stale 2024) — never summed — plus DERIVED momentum indicators (last 12 vs prior 12 months; a small sample or an uncovered
window → null with its reason) and supply pressure (awarded state-land units ÷ official monthly sales pace; national and
district only — null for a locality). Every indicator opens its formula, period and limitations. See `lib/supply/README.md`.

Tests: `test/dossier.test.js`, `test/supply.test.js`.

## "Why this market?" — `lib/dossier/narrative.js` (17.10.2026)

`narrative(D, { scan, supply })` composes ordered bilingual sentences from a dossier already computed, the geography's
Opportunity / Risk radar items (`lib/radar/scan.js` `forGeo`) and its supply pipeline (`lib/supply/pipeline.js`). The
dossier view carries it as `narrative` (`lead` = the 2–3 sentence ids that open: position · demand · the radar line that
fired, risks first; `sentences` = the full read in order; `counts`). Every sentence: `kind` (fact · derived · watch · risk ·
context · gap), `cls` (OFFICIAL · OBSERVED · DERIVED · MISSING), `source` (Trust Center ids / module aliases), `period`,
`geoScope` (own · district · national) and `term` — the explainability-registry id its ⓘ opens. Rules: only figures the read
models hold (a missing input makes the sentence a *gap* — never a default); universes never summed (tenders, renewal and
lotteries each in their own sentence, the renewal sentence says so); a locality's demand sentence names the DISTRICT
series and is scoped `district`; comparisons only inside one series (district vs national momentum of the same CBS series,
share of the national figure of the same universe — the scan's own comparisons); exact developer names; Hebrew signed numbers
isolated (LRI … PDI); never a recommendation, probability or attractiveness score. Pure and deterministic — no model call.
The page renders it as the "למה השוק הזה?" block at the top of `#dossier` (the lead open, the full read in a `<details>`);
the offline build has no server narrative. Gates: `test/narrative.test.js`.
