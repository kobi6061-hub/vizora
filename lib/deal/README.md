# Deal Decision Lab (`lib/deal`)

The page's `#dealLab` section (live build only): one contemplated purchase on one official street — the price against the
street's observed deals and the PROPX model, the financing, the cash flow, the yields, the sensitivity, the scenarios and the
deal's risk flags. A composition over read models PROPX already has plus a pure arithmetic engine over the user's own
assumptions. It creates no fact, values no dwelling, and never recommends.

| File | Role |
|---|---|
| `engine.js` | Pure UMD engine (`require('lib/deal/engine')` · `window.PropxDealEngine`). No data, no network, no defaults. |
| `index.js` | The read model behind `GET /api/intel?view=deal…` (`view(name, params) → { status, body }`), memoised per data stamp. |
| `ui.js` | The page module mounted in `#dlRoot`; strings in Hebrew and English; CSS in one injected `<style id="dlStyle">`. |

## Engine (`engine.js`)

* **Loan** — `price × LTV`, or `price − down payment`, or none (cash). LTV = loan ÷ price.
* **Payment** — the annuity `P·r / (1 − (1 + r)^−n)`, `r` = nominal annual rate ÷ 12, `n` = years × 12; `r = 0 → P ÷ n`. A fixed,
  unindexed rate: a CPI-indexed or variable track is not modelled (its payments move). ₪1,000,000 at 4.5 % over 25 years = ₪5,558.32.
* **Amortisation** — a monthly schedule summed by year; the last payment closes the balance exactly. Total interest = PMT × n − P.
* **Purchase costs** — purchase tax · legal · broker · renovation · other: each a ₪ amount the user enters. `bracketTax(price, table)`
  applies a bracket table the caller passes; the page passes its own cited STATIC table (`NH_TAX`, Tax Authority simulator, checked date),
  and the filled tax is labelled DERIVED · STATIC until the user changes it. The engine carries no tax table.
* **Rent → NOI → cash flow** — gross rent − vacancy % = effective income; − maintenance (₪/month) − management (% of collected rent)
  − insurance (₪/year) − other (₪/month) = NOI; − 12 × PMT = pre-tax cash flow.
* **Metrics** — gross yield = 12·rent ÷ price · net yield = NOI ÷ (price + costs) · cash-on-cash = cash flow ÷ (down payment + costs) ·
  DSCR = NOI ÷ debt service (no loan → not applicable, never ∞) · break-even rent (closed form, needs no rent) · break-even price for a
  target cash-on-cash (bisection on the engine; costs held at their ₪ amounts; the same LTV or the same down payment).
* **Sensitivity** — rent ±10/20 %, rate ±1/2 pp (never below 0 %), price ±5/10 %, one driver at a time + a rent × rate grid.
* **Scenarios** — base = the inputs; downside / upside = the base with the user's explicit shocks (rent %, vacancy pp, rate pp, costs %).
  No shock → no scenario. The page's "fill an example stress" fills visible, editable values on request — still the user's assumptions.
* **Missing / invalid** — a blank field is *not entered* (0 is a value). A result needing it is `null`, and `missing[key]` names the
  inputs; `notApplicable[key]` says why a result does not apply (`no-loan`, `no-equity`, `target-not-reachable` …); `invalid` lists
  refused values and `invalidWhy[key]` the rule (`not-positive` · `negative` · `above-max` · `above-price` · `range`, with the bound).
  Bounds (`LIMITS`): a ₪ amount paid once (price, down payment, each purchase cost) ≤ ₪1,000,000,000 · a ₪ amount a month (rent, maintenance,
  other) ≤ ₪10,000,000 · insurance ≤ ₪100,000,000 a year · area ≤ 100,000 m² · rate 0–30 % · LTV 0–100 % · term over half a month to 40 years ·
  target −100 % to 1,000 % · a scenario shock: rent / costs −100 % to +1,000 %, vacancy / rate ±100 pp (else the scenario is `invalid-shock`).
  A sensitivity step that crosses a bound is `out-of-bounds`; a value that is not finite is never returned (`not-finite`). The page names the
  refusal under the field and in every result that needs it — never an overflow, never a bare "—".
* **Rules** (`flags`) — deterministic, each with value · threshold · source · class · term: `DL-ASK-ABOVE-P75` / `DL-ASK-BELOW-P25`
  (only at a SUPPORTED level, named), `DL-COMPS-THIN`, `DL-NEGATIVE-CASHFLOW`, `DL-DSCR-BELOW-1` / `DL-DSCR-BELOW-1-2`,
  `DL-LTV-ABOVE-LIMIT`, `DL-EVIDENCE-STALE`, `DL-MODEL-UNAVAILABLE` / `DL-MODEL-LIMITED`, `DL-ASK-ABOVE-MODEL-RANGE`,
  `DL-RATE-VS-OFFICIAL`, `DL-CONCENTRATION`. Never a score, a probability or a recommendation.
  The LTV limits (75 % single home · 70 % replacement · 50 % additional) are stated as **a rule** naming Bank of Israel Proper Conduct of
  Banking Business Directive 329 — not a synced source; the page tells the user to check the directive in force.

## Read model (`index.js`)

| View | Parameters | Answer |
|---|---|---|
| `dealContext` | — | Bank of Israel rate context, the register copy's freshness, the rules' thresholds, the filter's starting values |
| `dealLab` | `id=st:<locality>:<street>` + `sqm rooms sizeTol roomsTol months min ask newness built type limit` | identity · comparables · model · rates · freshness · recency |
| `dealComps` | the same | the comparables only |
| `dealStreet` | `id` | the street report's assessment (supports · against · could change · due diligence), planning / transport / surroundings summaries, sources, missing |

Strict parameters: a malformed id or value → **400** `{ error: 'invalid-param', param, rule }` (never silently replaced); an id the
official directory does not hold → **404**.

**Comparables** — the register copy's stored sweep (`lib/streets/evidence.js` `dealsOf`: one record per deal, the sweep's own priced /
partial / same-consideration flags). Levels, each transaction in exactly one (the narrowest that holds it):

1. `STREET` — OBSERVED deals of this street (every address of the parcel on it). A POSSIBLE / corner deal is counted as excluded.
2. `BLOCKS` — the cadastral blocks of the parcels that touch the street (the value model's own location link; a loose name never
   locates) — LOCATION-LINKED, not the street.
3. `NEIGHBOURHOOD` — OBSERVED deals on the streets verified-linked to the same neighbourhood (verified links only).
4. `LOCALITY` — every other deal of the locality.

A wider level is read only while the narrower ones hold fewer than `min` comparables (default 10). The funnel — the first rule a deal
fails is the one it is counted under: not observed on the street · not a dwelling · future-dated · partial share · share not stated ·
several units for one consideration · under ₪100,000 / no amount · not priced · no usable area · outside the period · size outside ±% ·
rooms not stated · rooms outside ±. Per level `universe = included + Σ excluded`; the unfiltered street level equals the street
evidence's own priced sample with a ₪/m². Statistics per level, never pooled: n · median ₪/m² · P25–P75 (SUPPORTED ≥ 10 only) ·
min–max (LIMITED 5–9) · the asking ₪/m² percentile (SUPPORTED only) — the street evidence's thresholds. `primary` = the narrowest
SUPPORTED / LIMITED level, named; `percentileLevel` = the narrowest SUPPORTED one. The register carries no floor: every comparable's
floor is "—" with that reason (a GovMap print's floor is never joined onto a register deal). Deals the GovMap-layer copy prints that the
register copy does not hold are listed apart (`recency.notInRegister`) — their price never enters a comparable.

**Model** — `lib/streets/value-read.js` `apartment()` for the described flat (MODEL, its validation range and tier), or the reason
(`area-not-entered`, `type-not-modelled`, …). **Rates** — `lib/finance` (Bank of Israel, new housing loans by track, the latest
published month; national, OFFICIAL); the user's rate is a USER ASSUMPTION computed with, the official figure shown beside it.
**Freshness** — `lib/gov/freshness`; **recency** — `lib/txevents` (the street's newest event of every source).

## Page (`ui.js`)

Street picker over `/api/geo/search` (combobox: arrows, Enter, Escape) and the page's `propx:geo` event; the street report's
"Analyse this deal in the Deal Lab" (`data-srdeal` in `index.html` `srHTML`) and `window.PropxDealLab.open({ id, askingPrice, sqm, rooms … })`
prefill only what the caller holds. Every field carries its class chip; every metric an ⓘ (`xpBtn`, registry group `dealLab`); every "—"
the inputs it needs or its reason (`xpMiss`). The memo: a print view (`@media print`, `body.dl-printing`) and an `.html` download with
every input and its class, every output, the comparables, the sources and dates, and "not an appraisal, not investment advice".
Saved deals: `localStorage['propx:deallab:v1']` (this browser only; every access in try / catch). Language: the page's `propx:lang`.
No internal code is ever visible text: every event state (`LIMITED_SHARE_NOT_STATED` …), reason (`type-not-modelled` …), source id and model
tier has a Hebrew and an English label in `STR` (codes may sit in `data-*` attributes on the page; the memo strips every `data-*` attribute).
The class chips (OFFICIAL · OBSERVED · DERIVED · MODEL · USER ASSUMPTION · MISSING) are deliberate labels.

## Tests

* `node test/deal-lab.test.js` — engine golden cases, real-data comparables (st:7900:213 · st:3000:612 · st:5000:813 · st:3000:1941),
  API 400 / 404 / shape, registry, page module.
* `test/deal-lab.browser.js` — the Playwright journey (search → form → results → memo → save; he / en × desktop / phone; the street-report
  hook). Needs a running dev server; reads `PW_MODULE`, `PW_CHROMIUM`, `DEAL_LAB_BASE`, `DEAL_LAB_PASSWORD`, `DEAL_LAB_SHOTS` (outside the
  repository) from the environment; skips when they are not set.
