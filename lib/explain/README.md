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

## Explain Everything (21.10.2026) — plain words, one dialog, every label

**Plain-language layer.** Every term carries `simple` (one or two everyday sentences, no jargon) and `example` (always opens
"For example" / "לדוגמה", illustrative round numbers — never a real current figure; a live value is shown only from the data
at render time). `LEGEND` and `SECTIONS` entries carry `simple`. `level1()` returns `simple`; `level2()` adds `simple` + `example`.

**The dialog** (`xpOpen` in `index.html`, one `#xpPop`): title + class chip → *In simple words* → *Why it matters* → *How it's
calculated* (formula · method · inputs) → *Example* → *Source & date* → *Limitations* + *Do not read it as* → a collapsed
*Full methodology (for analysts)* (the level-2 fields). Source & date reads the Trust catalogue once (`view=sources`, cached;
the Trust Center's own copy when loaded): latest observation at the source + latest PROPX check + its state; a PROPX module
says so; offline / failed → the registry's own freshness text — never a made-up date. `role="dialog"` labelled by its title,
focus moves in and returns to the ⓘ, Escape closes only the explanation (a drawer under it stays open), Tab cycles inside,
under 760 px a bottom sheet with a 44 px close button and a scrim, `dir` / `lang` follow the page, light + dark. Every ⓘ is
a `<button>` named "Explain: <title>" / "הסבר: <title>".

**Every label.** `ANCHORS` (registry, between `@anchors:begin` / `@anchors:end`) maps each page label to a term:
`i:<data-i key>`, `TABLE.path` (a string-table entry the renderers print — `I18N.medPrice`, `SRT.cols.3`), or
`lit:<en>|<he>`; an optional scope (a CSS selector the label must sit inside) separates the same words with different
meanings. `lib/explain/attach.js` (loaded after the main script, inlined offline) adds the ⓘ to every anchored label not
already explained in place: markup by `data-i`, text labels by their words in the current language inside a label
container (th · h2–h5 · summary · dt · .l / .k / .lbl · freshness facts · DD rows · recency cells); the closest scope wins
and a tie between different terms attaches nothing. Debounced `MutationObserver` (drawers, tables, the street report),
idempotent, re-run on `propx:lang`; it skips `#xpPop`, the rail, the workspace, `#dealLab` and `#changes` (their own modules).

**Measured coverage.** `node scripts/explain-coverage.js` extracts every label site from `index.html` by explicit rules
(R1 markup `data-i` · R2 table heads · R3 column configs + factories · R4 KPI cards · R5 label helpers — a top-level helper
for every call · R6 headings · R7 summaries · R8 `<dt>`), resolves each to its string-table entry, classifies it MEANINGFUL
or CHROME by an explicit reviewed list (`@chrome:begin` … — reasons nav · action · furniture · heading · descriptor · prose
· workspace · legend · field) and writes `lib/explain/coverage.json`: coverage in total and by section, INLINE / ANCHOR /
ORIENTATION, the baseline without the attacher, every label with its term, term completeness. 21.10.2026: 960 / 960
meaningful labels (1,268 measured; baseline without the attacher 172, 17.9 %); 262 / 262 terms complete. Not in the
universe (stated): form-input labels, button texts, sentences and notes, status messages, lib/deal/ui.js, lib/changes/ui.js
and ALTARIS.

**Gates** (`test/explain-coverage.test.js`): coverage ≥ 95 % and no label that was covered is uncovered; the committed
`coverage.json` is not stale; every term complete (`simple` ≤ 360 chars, a labelled example, no real figures from a
deny-list, no recommendation wording, Hebrew sign isolation); every anchor targets a term, a label the page shows and is not
CHROME; every text anchor resolves in both languages (computed labels by a ≥ 3-character prefix); the same words with
different terms carry different scopes; the dialog's order, focus, Escape, Tab, bottom sheet and naming; the attacher's
contract. **When a module adds a page label or a term**: give the term `simple` + `example`, decide the label (anchor or
CHROME), and run `node scripts/explain-coverage.js`.
