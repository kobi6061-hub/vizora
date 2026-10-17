# Developers & Projects — `lib/entities/` (+ Data & Trust Center, `lib/trust/`)

A deterministic entity layer over records PROPX already stores. Everything here is
**OBSERVED PROPX ACTIVITY**: what the official sources show — never a land bank, a
total pipeline, a market share or a complete list of developers. Nothing is fetched.

```
data/land/tenders.json (ILA awarded lots: winner string, units, sum, plan/parcel keys, MoCH progress links)
data/housing/lotteries.json (MoCH lottery rows: ProjectID, developer, units, ₪/m², permit, stage, applicants)
  → names.js     canonical name (typographic variants only) · legal form · same-letters / cut-prefix keys
  → registry.js  developers · projects (moch:<ProjectID>) · sites (ila:<MichrazID>:<lot>) · market entries · coverage
  → query.js     pages · entity views · signals · one search that routes to an entity
  → api/intel.js (session-gated, GET) → the page's #intel section and the command-bar search
lib/trust/catalog.js → every source, its latest check (run logs) in one vocabulary → #trust in #sources
```

## Identity rules (never relaxed)

* **One developer = one canonical name**: the source string with Unicode NFC, Hebrew gershayim / geresh and curly
  quotes written as ASCII quotes, a doubled apostrophe as a quote, bidi marks removed and whitespace collapsed.
  Nothing else — "בע"מ" vs "בעמ", "בניה" vs "בנייה", "י.ח. דמרי" vs "י.ח.דמרי" stay separate entities.
* An **identical legal name** (with a legal-form marker) in the ILA and MoCH records is one entity: the Registrar of
  Companies does not register two companies under one name. 321 entities carry both roles.
* **Possible same entity — never merged**: names with the same letters in the same order (punctuation / spacing
  differ; 237 groups) and a name the source cut that is a strict prefix of exactly one other name (9 pairs) are linked
  with their evidence and shown as "possibly the same". Counts are never combined.
* **Listing**: an ILA tender winner is listed only with a legal-form marker (בע"מ, Ltd, שותפות, אגודה, עמותה, public
  body; Hebrew-safe word edges). An unmarked string — usually a private person on a self-build lot — is counted
  (21,497 strings, 23,085 lots), never listed. A MoCH lottery developer is listed by its source role.
* Only status-coded awards count (`lifecycle === 'awarded'`); a published tender's stale winner column is not a win,
  and a source note in the winner column is never a party (land normalizer v5).
* `companyId` is null: no source PROPX reads publishes a company number.

## Figures

* Units are per source and **never added across sources**: ILA = the Authority's units of residential lots won
  (capacity, not homes built); MoCH = units offered in the project's first lottery — often the same apartments.
* Land totals: competitive-bid lots only, VAT not stated by the source; land per unit = Σ sums ÷ Σ units over the
  same lots that publish units. ₪/m² bids and fixed-price allocations are counted apart.
* Construction evidence: MoCH construction-progress rows (as of 01.03.2024, STALE) joined to an awarded lot by exact
  block **and** parcel, attached to that lot only.
* Recent = decided / lotteried in the 24 months before the build date (Israel time).
* **DEVELOPER MARKET ENTRY** (derived): a city whose first observed activity of a developer falls in the recent window,
  for a developer already active elsewhere before it. Components shown; no score.

## Projects

Two kinds with their own official ids, **never joined across sources** (the lottery records carry no tender, plan
or parcel): `moch:<ProjectID>` (lotteries, units, official program ₪/m², permit and project stage, applicants per
unit — derived) and `ila:<MichrazID>:<lot file id>` (an awarded residential lot won by a listed developer: units,
land sum / per unit or ₪/m² bid, plan|lot keys, parcels, construction evidence). Each carries the furthest stage with
direct evidence (`land-awarded · marketed · permitted · construction-started · completed · occupied`); an earlier
stage may simply lack evidence.

## Search (`view=search&q=`)

Exact keys first — tender number (`158/2026`, `מכרז 158/26`), MichrazID, plan number (whitespace removed), block /
parcel (`גוש 10426 חלקה 621`, `10426/621`; a `n/yyyy` with a year is a tender) — then a locality named exactly by the
query, an address (street + house number → the transactions section), developers and projects by substring (all
tokens), localities and streets (lib/geo). A hit is a route, never a merge.

## Data & Trust Center (`lib/trust/catalog.js`, `view=sources`)

Every source read or audited — publisher, class (OFFICIAL / THIRD_PARTY_REPUBLICATION / DERIVED …), channel, cadence,
coverage, latest observation, source update date, limitations, retention — with the latest real check from its run log
(a replay or a store-outcome entry is not a check): `SUCCESS · UNCHANGED · PARTIAL · REFUSED · FAILED · SCHEMA_CHANGED ·
STALE` (last good check older than 50 h for a daily job) `· NO_RUN`. A source that is unavailable never becomes 0.

Tests: `node test/entities.test.js`.

## Developer Intelligence 2.0 (`lib/entities/intel.js`, `developer(id).intel`)

`devIntel(entity, cache, { now })` — one institutional read of a developer entity, composed only from what the
registry already built (the entity, its `ila:` sites and `moch:` projects) plus two exact joins PROPX already
stores: the tender record's XPlan plans (exact plan number) and Dira Lehaskir's notice for a tender (printed tender
number). Pure: nothing fetched, nothing random, never a merge, **no score of any kind**. `query.js` `developer(id)`
adds it as one new field `intel`; every pre-existing field is unchanged.

Minimal cache: `{ projById: Map<id, site | project>, landById: Map<tenderId, tender record> (optional — empty →
no XPlan join), R: { entries: [] } }`; `opt.diraFor(tenderId)` may replace the rental read model (tests).

Every block carries `source` + `cls` (OFFICIAL / OBSERVED / DERIVED) and a bilingual `basis`; a number appears only
where the sources carry it, null otherwise (a share with a zero denominator is null, never 0):

* **identity** — canonical, kind, roles, aliases, `possibleSame` (each with its evidence and `merged: false`),
  `companyId: null` + note.
* **activity** — windows from `now`: `last6 · last12 · prior12 · prior24to36` → `{ lotsWon, residentialUnits,
  lotteries, firstLotteries }` from the sites' decision dates and the developer's projects' lottery dates; first /
  last activity, `monthsSinceLast`, `lotsOutsideWindows` (lots on non-residential tracks have no site). `trend`:
  a = last-12 lots + lotteries, b = prior-12 → `inactive` (a = b = 0 — nothing observed in PROPX's public channels,
  not a statement about the company) · `insufficient` (a < 2 and b < 2) · `accelerating` (a ≥ 2b) · `slowing`
  (a ≤ b/2) · `steady`.
* **markets** — the entity's markets ranked by lots + lotteries; `geographicConcentration` = top market's residential
  lots ÷ all residential lots won (ILA sites; lotteries are a different universe).
* **programs** — tracks + shares, `subsidizedShare` = subsidized + residential-lottery + special-population lots ÷
  all residential-track lots, and the **observation-channel statement**: PROPX observes public channels only (ILA
  tenders, MoCH lotteries); private-land activity is not observed, so "public-land dependence" cannot be measured —
  only stated.
* **landBasis** — the entity's competitive totals, land per unit (+ basis), ₪/m² and fixed-price lot counts,
  `vat: 'not-stated-by-source'`, `byTrack` land per unit over competitive-bid lots with both a sum and units.
* **rental** — rental-track lots (tender units = the tender total, never "rental units"), Dira Lehaskir notices joined
  by tender id, `statedRentalUnits` summed only where the notice states them; a rental-track lot is not an operating
  rental project; no rent, occupancy or yield.
* **planning** — distinct plans over the sites' `plan|lot` keys, `xplanJoined` through the stored tender record only,
  `byStation`; exact plan number, never name or geometry; a plan's status is the plan's, not the lot's.
* **construction** — the entity's exact block/parcel joins (STALE, as of 2024-03-01) or null.
* **housing** — lotteries, projects, first-lottery units / applicants, `applicantsPerUnit` (Σ applicants ÷ Σ units
  over first lotteries that publish both), permitted / occupied project counts from MoCH's published stage.
* **entries** — the developer's market entries in the last 24 months.
* **signals** — `SIGNALS`, the deterministic rule table; each fired signal = `{ id, kind, text, trigger, value,
  threshold, period, source, cls, limitations[], components }` in Hebrew and English. A risk signal describes
  observed activity — never a judgement on the company, never a recommendation.

| id | kind | fires when | cls |
|---|---|---|---|
| NEW_MARKET_ENTRY | watch | ≥ 1 market entry in 24 months | DERIVED |
| ACCELERATING_LAND_ACTIVITY | watch | last-12 residential lots ≥ 3 and ≥ 2 × prior-12 | DERIVED |
| RECENT_WIN_MOMENTUM | watch | ≥ 3 residential lots in the last 6 months | OBSERVED |
| HIGH_GEOGRAPHIC_CONCENTRATION | risk | top market ≥ 70% of ≥ 5 residential lots | DERIVED |
| PROGRAM_CONCENTRATION | info | one track ≥ 70% of ≥ 5 lots | DERIVED |
| LOW_RECENT_PUBLIC_ACTIVITY | info | ≥ 3 lifetime lots + lotteries and none in 24 months ("no activity observed in PROPX's public channels") | DERIVED |
| RENTAL_EXPANSION | watch | ≥ 1 rental-track lot in 24 months | OBSERVED |
| PLANNING_EVIDENCE | info | ≥ 2 distinct XPlan-joined plans | OBSERVED |
| CONSTRUCTION_EVIDENCE | info | construction started on ≥ 1 joined lot (period = the rows' as-of date, STALE) | OBSERVED |
| POSSIBLE_SAME_ENTITY | info | ≥ 1 possible-same link — "possibly the same entity — not merged" | DERIVED |

Tests: `node test/entities-intel.test.js` (rules at and just below their thresholds on synthetic entities, he/en
parity, shares, trend, the committed data read-only).


## Search 2.0 (17.10.2026)

`search(q)` also routes **geographies with a dossier**: a district by its official name — exact, with or without the
prefix (`מחוז תל אביב`, `הצפון`, `Northern district`); a substring only when the query itself says `מחוז` / `district` — and
the country (`ישראל` / `Israel`, full name only) → `{ type: 'district' | 'country', route: { section: 'dossier', district } }`.
A bare district name that is also a city name (`תל אביב`, `חיפה`) ranks AFTER the locality hits. A locality hit the
Opportunity / Risk scan covers carries `radar: { opportunities, risks, quality, builtAt }` — the counts of rules that fired
and the dossier's evidence level, never a score. The page shows them under the hit and opens the Market Dossier for a
district / country hit (`inRoute`); the command bar lets the two new types through. Names still match by string and are
never merged.

## Project Intelligence 2.0 — `lib/entities/project-intel.js` (17.10.2026)

`project(id).intel` (additive — every existing field unchanged) is a deterministic read of ONE project / awarded lot from its
stored official records: a **timeline** (ILA: tender published → bid deadline → lot awarded with units and the winning sum,
the exact XPlan plan join with its dated approval and units after the plan, the MoCH construction-progress join by
block/parcel; MoCH: every lottery with units / applicants / winners, the permit and project stage as published — undated,
shown as of the source update), the **stage ladder** (`land-awarded → marketed → permitted → construction-started →
completed → occupied`: every rung with its direct evidence or the reason PROPX has none — a rung without evidence is not a
stage that did not happen), the lot's **₪/unit beside the locality's own competitive-bid lots** of the same track over 36
months by decision date (the land read model's quartiles, this tender excluded, a position only with ≥ 5 lots), the
project's **applicants per unit beside the locality's other first lotteries** (this project excluded, ≥ 5), **signals**
(`LAND_COST_ABOVE_LOCALITY` · `LAND_COST_BELOW_LOCALITY` · `LOTTERY_DEMAND_ABOVE_LOCALITY` · `LOTTERY_DEMAND_BELOW_LOCALITY` ·
`LOTTERY_UNDERSUBSCRIBED` · `STAGE_EVIDENCE_STALE` (ILA lots only — a MoCH record carries a current status) · `PLAN_JOINED` ·
`CONSTRUCTION_EVIDENCE` · `RE_TENDERED_LOT` (through the Authority's lot file id only) — each with trigger · value ·
threshold · period · source · class · limitations; a description, never a judgement), **what is missing** (permits, a
construction join, the lottery ↔ lot join, a permit date, project sales, occupancy / rent — each with its registry reason)
and freshness. Never a join by name or geometry, never an estimate, never a project sales / occupancy / rent figure. Shown
as the "מודיעין פרויקט" block of the project drawer; every signal and gap opens its registry entry. Gates:
`test/project-intel.test.js`.
