# PROPX · Explainability & Context — one registry, one ⓘ system

`lib/explain/registry.js` is the single registry of what PROPX shows: **terms** (metrics and concepts with stable ids),
**signal rules** (every signal id the product emits), **missing-data reasons** (why a "—" is shown and what would unlock
it), the **data classes** (OFFICIAL · OBSERVED · DERIVED · MODEL · USER ASSUMPTION · USER OVERRIDE · MISSING), the
**sources** it may cite (the Trust Center ids plus the runtime aliases the read models print) and the **three dates**
(observation ≠ publication ≠ PROPX check). Pure bilingual data (he + en), UMD: the page loads `/lib/explain/registry.js`
(`window.PropxExplain`, inlined in the offline build), ALTARIS loads the same file, Node tests `require` it. It
documents — it never computes. Version `propx-explain-v1` (17.10.2026).

## Two levels

| Level | What | Where |
| --- | --- | --- |
| 1 | title · one sentence · class chip | the ⓘ popover as it opens |
| 2 | why it matters · unit · geography · period · source(s) · class + its definition · methodology · formula · inputs · interpretation · **do not interpret as** · limitations · where the evidence lives · the three dates | "institutional detail" inside the same popover |

## "Why am I seeing this?"

Every signal (dossier watch / risk, Opportunity / Risk radar item, developer-intelligence signal) carries a button that
opens the signal's **rule** from the registry plus the runtime values the caller passes: trigger · value · threshold ·
comparison · period · source · class · evidence quality — and the term's "do not interpret as". Nothing is phrased as a
recommendation; every field can be challenged.

## "Why missing?"

A "—" in the dossier's missing list or the supply pipeline's gaps carries a ⓘ that opens the reason (e.g. *no official
locality sales series*, *inventory national only*, *no permits source*, *the lottery source stops at 2025-01*, *private
land is not observed*) and what would make the figure available.

## Where the marks are

Dossier tiles (sales → `official_new_home_sales` or `district_series_for_locality`, inventory + `months_of_supply`,
land `tender_units_open`, lotteries `applicants_per_unit`, renewal `renewal_proposed_units`, rental
`rental_tender_units_vs_stated`, developers `developer_observed_activity` + `market_entry`, macro `boi_rate` +
`construction_inputs_index`), dossier signals, evidence quality, freshness, missing list; the supply block
(`supply_universes`, each indicator `supply_pressure` / `momentum_12m`, gaps); the Market Pulse radar columns
(`opportunity_signal` / `risk_signal`), each item, the revision ledger (`data_revision`); the Trust Center alerts
(`source_freshness`); the developer drawer (`developer_observed_activity`, `geographic_concentration`, each signal);
ALTARIS: the decision card (`decision_verdict`, `investment_attractiveness`, `evidence_quality`) and the basis view
sections (`irr`, `capital_at_risk`, `evidence_quality`, `decision_condition`, `flip_point`, `source_conflict`,
`source_freshness`).

## Gates (`test/explain.test.js`)

Every term has every level-2 field in both languages; no invented source (a cited id must exist in the Trust Center
catalogue or be a PROPX / ALTARIS module alias); a DERIVED / MODEL term states its formula; every signal id the product
emits (dossier, scan, developer intelligence) has a rule; every missing-data id a read model prints has a reason; no
recommendation / probability wording; a do-not-interpret-as on every term; the page, ALTARIS and the offline build load
the registry.

## Independent review (17.10.2026) — what moved

The registry was reviewed against the code it documents (read-only, every formula and threshold traced). Corrections:
`months_of_supply` is the **CBS series 44,10,5** ("months of supply, new dwellings — average based on trend data"), class
OFFICIAL, no PROPX formula (inventory ÷ a 12-month pace would give 28.8, CBS says 26.7 for August 2026); `unsold_inventory`
no longer describes that ratio; `probable_new_transaction` states the register rule as coded (build year = deal year or
deal year − 1 → probably new; 2+ years earlier → second-hand; a deal-nature text → confirmed new; a later build year →
unclassified); `evidence_quality`, `decision_verdict`, `investment_attractiveness` and `capital_at_risk` formulas restate the
dossier's and ALTARIS's own rules and order; `momentum_12m` carries the 6-month anchoring rule; `land_per_unit` names the
open-market track; `sales_momentum_3m` names the 30-sale small-sample rule; `source_freshness` names the CBS state boundaries;
`materiality` matches the event rules; the `developer-concentration` and `sales-momentum-up` rules read as coded; the
`cbs:price-index` alias is the market sync's umbrella id (`propx:market-sync`), not one index, and the construction-inputs
signal cites `cbs:constructionInputsIndex`. Rendering: every signed number in a Hebrew string is isolated (LRI … PDI) at the
one place every string is born (`bi`) — a Hebrew prefix hyphen (ב-12) is never wrapped; "why am I seeing this?" shows a
formatted value (the dossier and developer-intelligence signals carry `valueLabel`; never a raw fraction), labels every source
segment, and carries the dossier's evidence quality on dossier signals; the page's evidence pointer is a `<bdi>`; the runtime
map is pruned; ALTARIS's popover follows the module language (he RTL / en LTR). Gates in `test/explain.test.js`.
