# ALTARIS — Capital Allocation Engine (מנוע חיתום והקצאת הון)

An isolated institutional underwriting module inside PROPX. For one residential
opportunity it compares three forms of capital — **BUY** (רכישה), **FINANCE** (מימון
מובטח) and **HYBRID** (מבנה משולב) — and answers five questions:

1. What is the real supported value?
2. How much capital is ALTARIS risking?
3. What can ALTARIS earn?
4. What happens if the expected exit does not happen?
5. Is BUY, FINANCE or HYBRID the best use of capital?

## Isolation (what this module touches in PROPX)

| PROPX file | Change | Why |
|---|---|---|
| `index.html` | one `<a class="ri">` in the rail, after "קרקעות" | the navigation item the brief asks for; no existing item moves, changes or resizes; the scroll-spy reads only `.ri[data-sec]`, which this link does not carry |
| `standalone/` | rebuilt from `index.html` | the offline build hides the link (no server offline) |
| `scripts/build-standalone.py` | one CSS selector added to the offline-only hide rule | an offline file has no `/altaris` route |
| `vercel.json` | a `rewrites` entry `/altaris → /altaris/index.html` + no-store headers for the page | the route; nothing else is rewritten |
| `scripts/kobix-dev-server.mjs` | the same rewrite + `.css`/`.svg` MIME | local QA parity with Vercel |

Nothing else in PROPX changes: no PROPX calculation, data flow, API, middleware, test or
style. `middleware.js` already gates every path, so `/altaris` and its assets sit behind
the same session gate as the rest of PROPX.

**Read-only data.** ALTARIS only issues `GET` requests to existing PROPX endpoints and
never writes to them:

| Source | Used for | Label on the page |
|---|---|---|
| `/api/geo/search` | locality / street picker (canonical CBS codes) | official registry |
| `/api/gov/transactions` | median ₪/m² of residential deals in the locality / street, comparable deals | "רשומות רשות המסים · באמצעות גרסאות לעם — פרסום עצמאי, לא ערוץ ממשלתי" + count + date range (DERIVED) |
| `/data/market/latest.js` | Bank of Israel rate, CBS new-homes index (reference next to rate inputs) | official, dated |
| `/api/land?view=summary` | state-land tender supply in the locality; observed public tender wins of the developer (exact name) | state land only, scope stated |
| `/api/housing?view=summary` | subsidized-housing lotteries in the locality | official lottery records |

A pre-filled value is a suggestion with its basis; the underwriting value is always an
explicit choice, and every valuation input can be overridden with a note. The developer's
list price is never assumed to be market value.

**Storage.** Deals, versions and fund settings are kept in this browser
(`localStorage`, keys `altaris:*`); a deal can be exported as JSON and imported elsewhere.
The only PROPX key ALTARIS reads and writes is the shared theme preference
(`kobix:theme`), so both pages keep one look. There is no server-side ALTARIS store yet.

## Files

| File | Role |
|---|---|
| `altaris/index.html` | page shell (PROPX header + rail, ALTARIS modes) |
| `altaris/altaris.css` | PROPX tokens (copied, not shared — the PROPX page is untouched) + module styles |
| `altaris/engine.js` | the calculation engine: pure functions, no DOM, loadable in Node (`test/altaris.test.js`) |
| `altaris/methodology.js` | the metric conventions (pure bilingual data, versioned; documents the engine, computes nothing) |
| `altaris/cases.js` | five illustrative investment cases (synthetic inputs only; the engine computes every figure) |
| `altaris/decision.js` | the investment decision layer: deterministic policy over the engine output + PROPX context (verdict, attractiveness, evidence quality, structure, gates, conditions, flips, breakdown, narrative) |
| `altaris/app.js` | UI: inputs, live underwriting ledger, compare, stress, portfolio, saved deals, settings |
| `altaris/charts.js` | inline-SVG institutional charts with hover tooltips and table twins |
| `altaris/export.js` | CSV, XLSX (dependency-free writer), print-to-PDF views, JSON import/export |

## Calculation rules

* Every strategy is a dated monthly cash-flow series from ALTARIS' side (T0 = the deal's
  funding date). IRR is XIRR over the actual dates (Actual/365); MOIC = total distributions ÷
  total invested capital; capital required = the peak cumulative outflow.
* Market value, purchase price, investment basis, capital invested, debt, profit and cash
  returned are separate fields and are never substituted for each other.
* BUY profit is the true underwriting result: supported value − exit haircut − purchase
  price − purchase tax − transaction costs − financing − holding costs + rental carry −
  exit costs. The engine asserts that the bridge equals the cash-flow sum.
* Taxes are editable underwriting assumptions, never conclusions. Headline returns are
  before profit taxes; after-tax lines appear when tax inputs are entered.
* Scenarios (downside / base / upside) change assumptions independently; stress presets
  overlay the base case. FINANCE and HYBRID run a repayment-capacity waterfall: a borrower
  repays in full when realization covers the claim; otherwise ALTARIS receives what the
  collateral yields (and, under default, after an enforcement period and costs).
* The risk score is eight explained components (piecewise-linear maps over stated
  inputs), weighted by the fund settings. The structure signal applies the fund hurdles,
  ranks eligible structures by a stated risk-adjusted return
  ((1 − w)·base IRR + w·downside IRR) and always says why.
* Every default is labelled as an assumption until edited.
* Capital at risk is the peak cumulative outflow; for HYBRID it is the larger of that, the maximum commitment, and
  capital + backstop price + option price. When a scenario funds no capital (a backstop that is not called — legal and
  monitoring costs are not capital), IRR and MOIC are stated on the committed capital and labelled so — never as a
  −100% loss; when capital is funded but the flows have no IRR (NPV positive at every rate), the IRR is stated on the
  committed capital and labelled so.
* Known limits of the maths: a series that changes sign more than once (fee in, inventory bought, inventory resold) can
  have more than one IRR; the engine solves every root on a grid over ln(1 + r) and reports the one nearest 0%, while
  profit and MOIC are unambiguous.
  In the FINANCE / HYBRID upside a negative delay means earlier repayment, so profit in shekels can be lower than the
  base while IRR is higher.

## Metric conventions (calculation basis)

`altaris/methodology.js` documents every decision metric the page shows — 32 entries in six groups (A returns ·
B capital & exposure · C credit & collateral · D value & protection · E fund decision rules · F scenarios), each with
what ALTARIS measures, the calculation basis, a formula, the per-structure treatment (BUY / FINANCE / HYBRID), how to
read it, the convention and its data basis (OFFICIAL · PROPX-DERIVED · MODEL · USER ASSUMPTION · USER OVERRIDE). It is
written from the engine as implemented; the engine stays the source of truth and is not changed by it.

* **Three levels.** (1) a subtle ⓘ mark next to a metric; (2) a popover — the metric name, one ALTARIS line, how this
  deal's figure was formed, and "View calculation basis" (desktop: hover previews, click pins; phone: tap opens a bottom
  sheet; Escape / the close button / a click outside close it and focus returns to the mark); (3) the **Metric
  Conventions** view (`/altaris#method`, `#method/<id>` deep-links an entry), in Hebrew (RTL) or English (LTR), with
  Latin acronyms isolated in Hebrew text and Hebrew in English text (`<bdi>`), formulas left-to-right.
* **Comparison cards** carry IRR, capital at risk, MOIC and the risk score (labelled MODEL — a 0–100 score, higher =
  lower assessed risk, never a probability) and the fund-hurdle line "passed/total · what failed"; the hurdle popover
  lists every hurdle with its threshold, the actual value and pass / fail in words.
* **Exports.** IC and full PDFs keep their pages and add a one-line footer; an optional methodology appendix
  ("ALTARIS Metric Conventions") follows the report (checkbox next to the export buttons, on by default). Excel gains a
  last sheet "Metric Conventions" and CSV a last section — the existing sheets are unchanged. JSON exports and every
  saved version carry the methodology id (now `altaris-metric-methodology-v2`; versions saved under v1 keep showing
  `altaris-metric-methodology-v1`); versions saved before it read "not stamped".
* **Versioning.** `VERSION.engine` pins the engine version and the sha256 of `altaris/engine.js`; a test fails when the
  engine changes until the methodology is reviewed and re-stamped. `test/fixtures/altaris-baseline.json` freezes the
  engine outputs of six deals × two fund settings and a portfolio (sha256 of each full result + headline figures);
  the tests prove they are reproduced bit for bit.
* **v2 (13.10.2026, engine 2).** After the independent engine review: IRR picks the root nearest 0% on ln(1 + r) when a
  series has several (never a −100% stand-in for a profitable deal) and has no upper search cap; HYBRID is measured on
  committed capital whenever it funds no capital (legal / monitoring costs are not capital) or its funded flows have no
  IRR — `irrBasisOf(result)` names the basis and the page labels it; the default month (when not set) is the first
  principal payment due (bullet maturity, amortizing first instalment, HYBRID window start) and HYBRID keeps payments
  made before it; the FINANCE extension fee is on the principal outstanding at maturity, a repaid loan is not extended,
  the extension-rate default is the contract rate + 2 pp; the full-claim break-even uses the claim at recovery; WAL is
  over the principal repaid; the HYBRID option is exercised when it raises profit and option / backstop prices reach the
  waterfall when paid; a participation without a threshold is a missing input; BUY sources & uses include a loan repaid
  from equity; stresses, solvers, the extension case and the attribution start from the deal's own base scenario; the
  portfolio concentration context repeats until stable and unnamed developers / localities are not one counterparty.
  `MD.CHANGES` lists the same in both languages; the baseline fixture was regenerated (its `generatedWith.note` says so).

## Investment decision (altaris/decision.js — ALTARIS Investment Decision Methodology v1)

A deterministic decision layer ON TOP of the engine (16.10.2026). It consumes `run(...)` — facts, the three structures'
base / downside / stress results, hurdles, risk components, solvers — and the PROPX context the page already loaded
(read-only), and never recalculates a return: every figure it judges is read through `irrOf` / `moicOf` / `capOf`.
The engine stays the source of truth; `test/altaris-decision.test.js` proves the frozen baseline and the engine hash
are unchanged.

* **Four verdicts** — TAKE (לקחת) · TAKE WITH CONDITIONS (לקחת בכפוף לתנאים) · PASS (לא לקחת) · INSUFFICIENT EVIDENCE
  (אין מספיק מידע להחלטה). The policy is `POLICY` / `POLICY_TEXT`: TAKE = every critical gate met, no near miss or open
  non-critical gate, attractiveness ≥ 65, downside protection ≥ 45, evidence ≥ MEDIUM; TAKE WITH CONDITIONS = no critical
  failure, attractiveness ≥ 50 and at least one of a near miss (within 20% of a threshold), an open non-critical gate,
  downside < 45, LOW evidence or attractiveness < 65; PASS = a critical gate clearly failed (IRR, MOIC, coverage, LTV,
  concentration, downside capital loss > 50% of capital at risk) or attractiveness < 50; INSUFFICIENT EVIDENCE = no
  independent underwriting value (the developer's price is never one), no structure computed, or an evidence score < 25.
  A high IRR alone is never a TAKE; a missing value is never zero and never raises a rating.
* **Two separate ratings.** INVESTMENT ATTRACTIVENESS 0–100 (≥80 VERY ATTRACTIVE · 65 ATTRACTIVE · 50 MARGINAL · <50 WEAK)
  = the weighted mean of the available factor groups (return 30 · downside 30 · structure 15 · execution 15 · market 10)
  minus 5 per near-miss / open non-critical gate; a group without data is left out, never replaced by a neutral value.
  EVIDENCE QUALITY HIGH / MEDIUM / LOW (≥70 / ≥45 / below) = 100 minus documented deductions — value source, appraisal,
  source spread, status, developer, material defaults, PROPX data, observation age, retrieval age, conflicts, CBS
  freshness. It is the quality of the information, never a probability.
* **Gates** = the fund hurdles (existing) with pass / near miss / fail, plus the downside-loss gate and the supported-value
  evidence gate. **Factor groups** reuse the engine's own figures and tables (COVERAGE, VALUE_BASIS, risk components)
  and state every sub-score's map. **Structure** = the eligible structure with the highest attractiveness (ties on
  downside protection); the comparison explains why not the other two on consistent dimensions.
* **Conditions** come only from the gates and the engine's solvers (`buyPriceLimits` max price, the coverage formula, the
  entered status, the fund caps). **Flip points** (`flips`, on demand, ~1 s) re-run the engine on modified copies of the
  deal and bisect on the verdict: "PASS if the supported value falls below ₪X", "TAKE WITH CONDITIONS if the loan rate
  exceeds Y%". **Source / assumption breakdown** counts OFFICIAL · OBSERVED · DERIVED · MODEL · USER ASSUMPTION · USER
  OVERRIDE · MISSING facts; **source conflicts** (value sources > 15% apart; the PROPX median vs the chosen value) are shown
  side by side, never silently resolved; **freshness** keeps observation, publication and PROPX-check dates apart.
* **Rental** context stays context: a rental-track tender is a pipeline fact, never an operating project; the CBS rent
  index is a general benchmark; no rent assumption is read or written.
* **Narrative** (`narrative`) is deterministic text from the decision object — the AI role is explanation only, and the
  page makes no model call. The disclaimer sits under every card.
* **Page.** The compact card at the top of the ledger (and the mobile bar); "הצגת בסיס ההחלטה" opens `#decision`
  (Hebrew RTL / English LTR) with DECISION · WHY THIS STRUCTURE · comparison · RETURN · DOWNSIDE · STRUCTURE · MARKET ·
  EXECUTION · gates · EVIDENCE · CONDITIONS · WHAT WOULD CHANGE THE DECISION · SOURCE / ASSUMPTION · CONFLICTS · FRESHNESS
  · THE POLICY · narrative. The IC snapshot gains a seven-row block, the full PDF an executive "Investment Decision" page,
  Excel / CSV an "Investment Decision" sheet / section, the portfolio and saved deals four sortable columns; saved
  versions, JSON exports and imports carry `decision` = `{ v, verdict, score, evidence, structure, at }` (older versions
  read "not stamped").

## Live Thesis — post-decision intelligence (altaris/thesis.js — 18.10.2026)

**What it is.** PROPX does not stop helping after an investment decision is made. `altaris/thesis.js` (UMD `AltarisThesis`,
`altaris-live-thesis-v1`) keeps the ORIGINAL decision and the evidence behind it, derives what had to remain true, ranks the
missing evidence by decision relevance, names what to watch, and compares THEN against NOW whenever a fresh PROPX read exists —
through the SAME documented decision policy (`POLICY.final`, rules F0–F5, via the additively exported `DX.finalOf`) and the SAME
market & execution assessment (`AltarisMarket.assess`). Product copy (one source, `COPY`): *PROPX remembers why you made the
decision — and tells you when the facts behind it materially change.*

**Architecture (pure module → page wiring).**
- `snapshot({ D, R, deal, ctx, meta })` → the DECISION SNAPSHOT (`altaris-decision-snapshot-v1`): normalized facts only —
  verdicts (economic · final · rule), the lead structure's IRR / MOIC / capital at risk / gates / evidence, conditions, flip
  points (when computed), the market assessment's factors, the context (market read, CBS, indicators) with its dates, conflicts,
  freshness, missing, rules fired, registry refs; deep-frozen, hashed (`verify`). `basis`: DECISION_SAVE · RECONSTRUCTED ·
  BASELINE_TODAY (`stampMatches` is the reconstruction gate — never a fabricated past state).
- `contract(snapshot)` → THESIS CONTRACT: `dependsOn` (every passed gate "moves only with a deal assumption", the evidence
  level, "no CAUTION" F3 / F4, noted negatives without a partner), `activeConditions` (each with `resolvedBy` and its path
  REASSESS / RE_UNDERWRITE), `breakers` (flip points, market convergence, evidence drop, condition failure). Nothing invented.
- `nextBestEvidence(snapshot)` → missing facts ranked HIGH · MEDIUM · LOW · INFORMATIONAL by decision relevance (verdict >
  condition > evidence level > assessment > informational; ties by id) with "if verified / if not / expected source / path";
  commercial terms are not evidence; never a probability or a guarantee of availability.
- `watchlist(snapshot)` → the WATCHTOWER: only the dimensions the thesis depends on (demand · land market · supply ·
  transactions · execution · developer · macro · freshness · revisions · dossier history); project execution is marked
  **unwatchable** (no public per-project permit source — `no_permits_source`).
- `reassess(snapshot, now)` → the DECISION DELTA. `now` = a fresh page-shaped market read + CBS context + indicators +
  `dealHash` / `settingsHash` + the dossier-history diff since the decision + the district's revision rows. Rules:
  changed assumptions → `DEAL_CHANGED` (TH-DEAL, a re-underwrite, never a reassessment); no fresh read (dossier + radar ≤ 30
  days) → `INSUFFICIENT_NEW_EVIDENCE`, every condition stays (missing evidence is not positive evidence); otherwise the FROZEN
  economic verdict ∘ the new assessment through `finalOf` → states NO_MATERIAL_THESIS_CHANGE · THESIS_STRENGTHENED ·
  CONDITION_RESOLVED (TH-F5-RESOLVE) · NEW_CONDITION_TRIGGERED (TH-F4) · THESIS_WEAKENED (one material negative, noted) ·
  DECISION_REQUIRES_REVIEW (TH-F3). Every change carries category (DEAL_ASSUMPTION · MARKET_EVIDENCE · PROJECT_EXECUTION ·
  DEVELOPER · SOURCE_EVIDENCE · MACRO · GEOGRAPHY), materiality (a constant per TH-* rule: INFORMATIONAL · RELEVANT ·
  MATERIAL_THESIS · DECISION_IMPACTING), impact, source · period · class · evidence, the rule text and its limitation. A PASS /
  INSUFFICIENT economic verdict leaves the market no path (F2 / F1): its factor changes are context. Evidence aging
  (TH-AGING, > 90 days) and a STALE source are reported as aging, never as a negative signal; the PROPX-median conflict keeps
  both values; revisions of pre-decision periods list original · revised with a retrospective impact judged only through the
  momentum factor. Output: `changes`, `geoChanges`, `revisions`, `current` (decision under the same policy), `conditions`
  {active · resolved · added}, `thenVsNow`, `retrospective` (NO · YES · YES_CONDITION · CANNOT_DETERMINE), `narrative`
  (deterministic sentences, no model call), `attention`.
- `portfolio(list)` → the PORTFOLIO THESIS MONITOR: counts by state and a deterministic attention order (review > new condition >
  worsened > assumptions changed > sources > condition resolved > new information > no change > not checked > paused), next best
  evidence across deals (one count per deal). No score.
- `createRepository(adapter)` → append-only records over `{ get, set }` (`altaris:thesis:v1`; `memoryAdapter` in tests):
  `init` (created · unchanged · appended REUNDERWRITE / REDECIDE · refused — the original snapshot is never replaced),
  `recordCheck`, `setMonitor` (LIVE / PAUSED), `integrity`. See `altaris/THESIS_PERSISTENCE.md` for the future store contract
  (documentation only; Supabase is not activated).

**Page wiring (`altaris/app.js`).** Saving a deal that carries a decision keeps its thesis automatically (`thesisOnSave`: the
saved-deal architecture already stamps the decision on every version). `fetchMarket(info)` is the read-only PROPX read shared
by the market panel (which applies it to the deal) and by the thesis check (which never touches the deal). "Check now" /
"check all" (`thesisCheck` / `thesisCheckAll`, one read per locality × developer per run) → `reassess` → `recordCheck`.
Old saved deals are reconstructed on first sight (`thesisEnsure`: the version's decision stamp must match the recomputation,
else BASELINE CREATED TODAY). UI: the compact LIVE THESIS card under the decision card (status · original · today under the
same policy · changes since · next evidence · last checked; check / then-vs-now / pause), the "תזה חיה" column of the saved
deals, the PORTFOLIO THESIS MONITOR at the top of the portfolio (tiles, attention-ordered table, next best evidence across the
portfolio, check all), and the THEN VS NOW view (`#thesis/<dealId>`, he RTL / en LTR): plain-language narrative, what changed
(material first, informational folded), what did not change, why it matters, what must remain true, conditions (active /
resolved, resolved-by), what would break the thesis, next best evidence, the watchtower, geography dossier changes, official
revisions, the retrospective, the history (events), and the explanatory copy. Registry terms (ⓘ): `live_thesis`,
`decision_snapshot`, `thesis_contract`, `thesis_status`, `decision_delta`, `next_best_evidence`, `watchtower`,
`retrospective_decision`, `evidence_aging`, `change_category`, `reassess_vs_reunderwrite`, `portfolio_thesis_monitor`; every
TH-* rule is a SIGNAL_RULES entry.

**Gates (`test/altaris-thesis.test.js`, 50 + the 20 acceptance cases frozen in
`test/fixtures/altaris-thesis-acceptance-2026-10-18.json`).** Snapshot immutability; the original never rewritten; a market
update cannot change IRR / MOIC / capital at risk / gates / cash-flow figures / the economic verdict / economic conditions /
flip points; a user assumption change creates a new version; same evidence + same rules = same result; an irrelevant change
creates no delta; a material change creates the documented delta; a condition is resolved only by its rule and never by missing
or stale data; weak evidence never overrides; stale reads never masquerade as current; conflicts and revisions preserve both
values; then-vs-now and the retrospective are historically correct; NBE ranking and the portfolio order are deterministic; no
Supabase code path; the existing ALTARIS suites (engine hash, frozen baseline, decision, market) are unchanged.

**Known limitations.** Theses live in this browser only (like the saved deals) until the PROPX store is connected. Evidence
quality is frozen in the snapshot: read aging is reported, the deduction applies only on a re-underwrite. Project execution
cannot be watched (no public per-project permit source); developer construction evidence is developer-level. The register's
transaction-depth negative (< 10 deals) is LOW evidence by design and never material. Reconstructed baselines read the CBS
context and the indicators at reconstruction time (labelled). Checks run on request and when the portfolio opens — there is no
scheduler and no notification channel.

## Investment cases (illustrative, synthetic)

`altaris/cases.js` holds five fully worked institutional cases — Park 18 (distressed bulk BUY, Petah Tikva),
HaNassi 42 (senior secured bridge, Haifa), Ganei HaPark (preferred capital + option + backstop, Be'er Sheva), HaGefen
Renewal (pre-construction urban renewal, Ramat Gan) and Coastal Portfolio I (30 let units, Netanya · Bat Yam · Ashdod).
Every project, developer and counterparty is fictional; the localities are real settings only; values are labelled
"הנחת תרחיש (סינתטית)" and never PROPX data. The file holds INPUTS only — deal details, unit rows, an explicit
underwriting value, terms for BUY / FINANCE / HYBRID, scenario assumptions and a five-part IC memo — and names no
preferred structure: the ordinary engine computes every figure.

* **Entry.** "מקרי השקעה" next to "עסקה חדשה ריקה" (and in the empty-deal intro) opens a compact selector (title,
  structure, location, scale, one-line thesis); a phone gets a bottom sheet. A case loads into the existing deal screen
  with a notice ("מקרה השקעה להמחשה · הנתונים סינתטיים ונבנו לצורך הדגמת מודל החיתום.") and the IC memo.
* **Isolation.** A case is never saved, never enters the portfolio and is judged without saved deals as concentration
  context; "save" is replaced by "יצירת עותק עבודה", which saves the case as the user's own deal tagged with its origin
  (`origin.kind = 'illustrative-case'`). An imported case file becomes such a working copy. "יציאה לעסקה חדשה" returns
  to a clean blank deal.
* **Exports.** File names carry `ILLUSTRATIVE`; every Excel sheet, the CSV, the JSON and every report page of the PDFs
  open with "ILLUSTRATIVE CASE · מקרה השקעה להמחשה"; a working copy is marked "BASED ON AN ILLUSTRATIVE CASE".
* **Known modelling limit.** The engine models one BUY exit event, so staged disposals are entered as the weighted-average
  sale date (stated in each memo).

## Design notes

**Subject.** An underwriting terminal for ALTARIS' investment team: enter one residential
deal once and see, in seconds, which form of capital to use and what happens if the exit
fails.

**Palette.** PROPX's own tokens, unchanged: paper `#f3f5f9` / panel `#ffffff` / ink
`#101b30` / navy `#12294f` / accent `#2563eb` (interaction) / brass `#a4791c` (the single
ALTARIS accent: the wordmark rule and the signal line); dark: `#0b1322` / `#121d34` /
`#eef2fa` / `#8fb1e8` / `#3b82f6` / `#d4af37`. Strategy series (validated with the dataviz
palette checker, light on `#ffffff`, dark on `#121d34` and `#0b1322`): BUY `#2563eb`/`#3b82f6`,
FINANCE `#eb6834`/`#d2693a`, HYBRID `#1baf7a`/`#22a87a` (the light green is below 3:1, so
every strategy mark carries a text label and every chart a table twin).

**Type.** PROPX's pairing: Heebo for headings and key figures, Assistant for body and
inputs; Montserrat 300 with wide tracking only for the ALTARIS wordmark, mirroring the
PROPX wordmark. Tabular figures only in ledgers and tables.

**Layout.** "Ledger and verdict": the underwriting workflow (deal → value → structure →
stress → decision) runs down the main column; a sticky ledger on the right answers the
five questions live. Below 1100px the ledger becomes a compact bottom card that expands.

```
PROPX header ───────────────────────────────────────────────┐ rail
ALTARIS · מנוע חיתום והקצאת הון            [הגדרות קרן]      │  ▢
[עסקה חדשה] [השוואת מבנים] [פורטפוליו] [עסקאות שמורות]       │  ▢
1 עסקה › 2 שווי › 3 מבנה › 4 לחץ › 5 החלטה                    │  ▢
┌ main ─────────────────────────────┐ ┌ ledger (sticky) ──┐ │  ▢
│ 1 פרטי העסקה · יחידות · סה״כ       │ │ 1 שווי נתמך       │ │
│ 2 שווי נתמך · מקורות → בחירה       │ │ 2 הון בסיכון      │ │
│ 3 [BUY][FINANCE][HYBRID][COMPARE] │ │ 3 IRR · MOIC      │ │
│   inputs │ ledger rows · bridge   │ │ 4 אם היציאה נכשלת │ │
│ 4 תרחישים · מבחני לחץ             │ │ 5 SIGNAL · למה    │ │
│ 5 מרווח ביטחון · מהירות · ציר זמן │ │ ציון סיכון        │ │
│   סיכום ועדת השקעות               │ │ [שמירה] [PDF]     │ │
└───────────────────────────────────┘ └───────────────────┘ │
```

**Signature.** The five-questions ledger: the sticky column is literally the product's
five questions, each answered by one figure and one plain-language line, closing with
the structure signal on a brass rule. One bold visual supports it: the margin-of-safety
ladder (supported value → expected exit → break-even → entry basis, loss zone shaded).

**Self-critique of the plan.** Palette and type are PROPX's by requirement, so the module
reads native rather than generic. The inputs-left / summary-right layout is mandated, so
the distinctiveness is carried by the ledger: results are written as credit-memo rows
(label · figure · how it is calculated) under PROPX's broadsheet rule, not as a grid of
KPI tiles — the first draft used tiles and was revised. Step numbers are used only for
the underwriting workflow, which is a real sequence.

## Market context 2.0 (17.10.2026)

The deal's market panel also shows, read-only (altaris/decision.js reads none of it — no verdict, rating or number can move):
the locality's **"Why this market?"** lead sentences from the PROPX dossier narrative (`lib/dossier/narrative.js`, each with its
class and source) and the **Land Economics 2.0** line (`lib/land/economics.js`: median ₪/unit of competitive-bid open-market lots
decided in 36 months with p25 / p75 and the unit-weighted figure, the change vs the prior window with the lot-mix warning, the
failed-tender ratio and re-tenders) — "nominal state-land consideration, not a land value and not a deal input". Both arrive in
the one `view=dossier` GET the panel already makes.

## Final decision & Market / Execution Assessment (altaris/market-assessment.js — 18.10.2026)

**The audit (BEFORE evidence, `scratchpad/before-altaris.json` of the night ledger).** Before this layer the market reached ALTARIS by
three paths, none of them named on the page: (1) `altaris/decision.js` reads the deal's PROPX context (transaction depth, the developer
registry, the CBS district series and the indicators) through the documented "market" factor group (weight 10 of the attractiveness
index) and through the evidence deductions (−10 when the market was not loaded, −10 on a source conflict …) — so loading the market
could move INVESTMENT ATTRACTIVENESS and EVIDENCE QUALITY by design; (2) the dossier, the radar, the "Why this market?" narrative and
Land Economics are display-only (byte-identical verdict with and without them — `test/altaris-decision.test.js`); (3) the engine's
explained risk score reads the observed deal count for its exit-liquidity component (±5 / −10 — pre-existing, documented in the
methodology). The ambiguity was that the page said "read-only" for (2) while (1) moved the number. Nothing in (1)–(3) was changed.

**The layer (additive).** `altaris/market-assessment.js` (UMD `AltarisMarket`, `altaris-market-assessment-v1`) turns the context the
page already holds (the locality's dossier watch / risk signals, the radar's opportunity / risk items, transaction depth, land
economics, the developer registry, the dossier's evidence quality) into a MARKET & EXECUTION ASSESSMENT beside the economics:
nine dimensions (demand · supply · land market · transaction liquidity · execution · developer · macro · data quality · rental), every factor with value · comparison · period · source · class · rule · scope ·
material? · impact. A factor is MATERIAL only when all hold: a direction (a count alone is context), class OFFICIAL / OBSERVED,
evidence HIGH / MEDIUM, the deal's own locality or its district (a national figure is context), a read ≤ 30 days old, materiality ≥ 2.
Status: CAUTION = ≥ 2 material negatives from ≥ 2 independent source families (CBS · ILA · MoCH · register · planning · PROPX
ledgers); STRONG = ≥ 2 material positives from 2 families and no material negative; otherwise NEUTRAL (a single negative is noted,
never enough alone); INSUFFICIENT when neither dossier nor radar is loaded. District data stays district data (scope "district",
the text names the district). It computes no return, no probability and no score.

**The final policy (`POLICY.final`, rules F0–F5 in `altaris/decision.js`).** FINAL = ECONOMIC VERDICT (unchanged, now `D.economic`)
∘ MARKET & EXECUTION ∘ EVIDENCE QUALITY ∘ FUND HARD GATES: F0 no / INSUFFICIENT assessment → the economic verdict stands (evidence
quality already deducts the missing market); F1 economic INSUFFICIENT EVIDENCE → unchanged; F2 PASS → PASS (a good market never
rescues bad economics); F3 TAKE + CAUTION → TAKE WITH CONDITIONS with a named market condition (its factors, the rule, what would
remove it); F4 TAKE WITH CONDITIONS + CAUTION → the condition is added; F5 STRONG / NEUTRAL → unchanged. Never an upgrade. `D.final`
(verdict · changed · from · to · rule · reason · marketCondition · whatWouldRemove · conditions), `D.marketImpact` (the explanation),
`stamp.final` / `stamp.market`. IRR, MOIC, cash flows, repayment, capital at risk and the economic verdict are byte-identical with
and without the assessment (`test/altaris-market.test.js`, §72 gates); the engine hash and the frozen baseline are unchanged.

**UI.** The decision card and the basis head show ECONOMIC · MARKET / EXECUTION · FINAL side by side (`.ax-dec-fin`, "changed by
rule F3" when it moved); the basis view gains "MARKET IMPACT ON DECISION" (he RTL / en LTR: the three verdicts, the factor table with
why a factor is not material, the conditions added, what would remove them, the policy note); the IC block and the Excel / CSV sheet
carry the final decision, the economic verdict and the assessment; the registry terms `market_execution_assessment`,
`final_decision`, `market_impact_on_decision` explain them (ⓘ). The acceptance set (§73, 5 cases × none / STRONG / CAUTION + a
conflicting read) is written by the test to `test/fixtures/altaris-acceptance-2026-10-18.json`.
