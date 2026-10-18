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

## Construction block (18.10.2026)

`sections.construction` (OFFICIAL, `cbs:construction`) reads `data/construction/latest.json` (lib/construction): the four CBS measures —
permits (44,11) · starts (44,2) · completions (44,3) as monthly flows with their trailing-12 and change vs the prior 12 (DERIVED), and
active construction (44,4) as a quarterly STOCK (never summed) with its change vs the previous quarter and a year earlier — for the
country and the seven districts ONLY. A locality's dossier shows its district's figures with the scope "district level, not the
locality's figure" (`ownGeography: false`) and prints the `construction-locality` missing reason; nothing is allocated to a city. The
freshness entry `construction` carries the latest published period, the CBS update date, the PROPX check and the quarter-based state
(the reporting-lag assumption is documented in lib/construction). Before the first sync the section is absent and `construction-series`
is listed as missing. Evidence quality and the signal rules are unchanged by the block.

## Dossier history / time machine (18.10.2026) — `lib/dossier/history.js`

**What a snapshot is.** A PROPX read on one day — not a source publication date. `scripts/dossier-snapshot.js` (the nightly
`.github/workflows/dossier-snapshot.yml`, 03:17 UTC) runs the dossier for every geography it describes — Israel, the seven districts
and every locality in the Opportunity / Risk scan (`D.index({ limit: Infinity })` ∪ `data/radar/scan.json`, ≈ 449) — and keeps, per
geography, the decision-relevant FACTS the dossier already holds, each `{ value, cls, source, period }` taken from the sections as
they are: official sales (latest month · T12 · 3-month momentum — a locality carries its DISTRICT series with the dossier's scope
label verbatim and `geoScope: district`, never relabelled as the locality's), inventory + months of supply (national; elsewhere null
with the dossier's reason), construction (CBS permits · starts · completions · active where the section exists; a locality labelled
district level), land KPIs (tenders · published · open · closed · decided · awarded · frozen · cancelled · units open / pending /
awarded / failed — the current 24-month window to the snapshot day), the land-economics median ₪/unit (DERIVED; null below 5 lots with
the module's own reason; nominal consideration, not a land value), renewal (complexes · proposed units · declared), lotteries
(lotteries · projects · first-lottery units · applicants per unit; a district's units are null — not summed across localities), the
rental pipeline (tenders · tender units = tender totals), developers (total · lots here · the top 5 exact names · entries), macro (BoI
rate · construction inputs y/y · new-homes index y/y — national level only; the district dwellings index on a district), evidence
quality (score · level), the signal ids that fired (watch / risk) and the Radar 2.0 state (`signalState` · `stateReason` · `tracked`)
from the committed scan. A missing value is `null` with the dossier's own missing reason — never 0; nothing is computed or estimated.
`FACTS` is the registry (stable ids; class · source · kind · bilingual label · what the period means · levels); `snapshotOf(dossier,
scanGeo)` is pure; `build({ dataDir, now })` takes the clock as an argument and never reads it.

**Append-only.** One file per day, `data/dossier/snapshots/<YYYY-MM-DD>.json` (positional values per level in the file's own
`order`, interned strings; ≈ 340 KB for 449 geographies) + `index.json` (dates, counts, bytes, sha256, the fact ids). A day that
exists is never rewritten — `write()` returns `UNCHANGED` and the file is created with an exclusive flag — and nothing is ever deleted.
The file carries the PROPX check dates of every source (`sources`, from the national dossier's freshness) and the scan it read
(`scan.builtAt`), so a reader can tell a read from a publication. The workflow runs `test/dossier-history.test.js` first and commits
ONLY `data/dossier/snapshots/` (bot-written; it never rebuilds the radar). `--date` (never in the future) re-labels a missed day on the
same checkout — the data read is the checkout's, said by the check dates.

**The diff** (`diff({ level, code, since, until })`; `GET /api/intel?view=dossierHistory&city=|district=&since=YYYY-MM-DD[&until=]`):
`from` = the latest snapshot at or before `since`, `to` = the latest at or before `until` (default: the latest day; no `since` = the
previous snapshot). Per fact: `NEW` (null → value), `CHANGED` (value → value, `delta` for numeric facts), `REMOVED` (value → null, with
the reason it is missing now), `STATE` (the Radar 2.0 state moved, both reasons kept); `unchanged` lists the rest. A SERIES fact (sales,
inventory, construction, macro) whose period moved is CHANGED with the radar verb NEW — the source published a new period — even when
the value is the same; a READ-WINDOW fact (the land model's 24-month scope, the economics window, the snapshot day) moves by
construction and is never a change by itself. `signals.added / removed` by rule id; `radarState` and `quality` from → to. The verbs are
`lib/radar/verbs.js`'s (NEW · CHANGED) with their labels. `NO_SNAPSHOT` (with the available dates) when nothing exists at or before
`since` — never a fabricated baseline; `NOT_COVERED` ("not covered on <date>") when one read lacks the geography; 404 for an unknown
geography. `view=dossierSnapshots` lists the days with their counts and the fact registry.

**Not inferred.** A difference between two PROPX reads is DERIVED — it is not an event the source reported (the Market Radar is the
event engine), not a publication date, not a trend, never a recommendation, probability or score; a changed land count inside the
moving 24-month window is a change of the window's content, said as such by the periods beside it; the snapshot never allocates a
district series to a locality, never sums unit universes, never fills a missing day, never re-reads a source. Gates:
`test/dossier-history.test.js`.
