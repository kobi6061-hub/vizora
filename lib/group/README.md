# PROPX · Sponsor X-Ray — Developer Group Intelligence (lib/group, 19.10.2026)

"Show me the entire real-estate group." The user enters a developer brand, a legal company, a company number, a project or an
SPV; PROPX answers with one institutional read of the GROUP behind it — the companies, SPVs, pipeline, execution, leverage,
exposures and evidence gaps — composed ONLY from the read models PROPX already has and the user's own documents. No group
score, no probability, no recommendation. Additive: Developer Intelligence 2.0, Project Intelligence 2.0, due diligence
(`lib/dd`), entity resolution, ALTARIS, Live Thesis, the explainability registry and the private identity work are unchanged
(the registry gains the `group` group; `lib/dd/index.js` exports existing internals read-only).

```
group({ developer | company | project }, { now, companyNumber, confirmedCandidate, userDocs, live })
GET  /api/intel?view=group&developer=<id>[&company=<user-provided number>] | company=<number> | project=<id>
POST /api/intel?view=group&…   { userDocs: [...] }   (≤ 256 KB, re-validated, used for that read only — never stored or logged)
```

## Modules

| file | what |
|---|---|
| `model.js` | version, tiers, identity / structure statuses, the 8 stage buckets, every documented threshold (`RULES`), the 14 truths, programme mapping from the source's track |
| `facts.js` | `recordFacts(p, K)` — ONE project record (ILA awarded lot or MoCH lottery project) read with the due-diligence ladder (`lib/dd/project.js`): furthest verified stage, dated permit / start / completion, durations, censoring flags, the 18-month evidence-gap rule, STRONG executors |
| `cohort.js` | the NATIONAL COHORT: the same `recordFacts` over every lot / project (≈ 6,900 records, memoised per data stamp) — the comparison basis of every group signal |
| `identity.js` | the GROUP IDENTITY GRAPH: membership tiers, nodes (brand · legal company · contractor · named party), edges with state · class · source · date · reasons · why · what it does not prove |
| `portfolio.js` | rows (each project once), stage distribution, observed execution load, historical execution record, signals, activity, geography, programme, land pipeline, concentration matrix, project events |
| `finance.js` | per-entity financial profiles (`lib/dd/financial.js`), THEN → NOW on the comparable period, the leverage explainer, bond maturities, pipeline vs financial position, public / private from the registry type |
| `brief.js` | legal / corporate timeline (exact entity), group timeline, risk & gap brief, next best evidence, SPV exposure, first read · one minute · top block |
| `index.js` | `group()` — composes the read; `deep` carries the sources, cohort comparables, formulas (registry ids), raw refs and rules |

## Group identity methodology

| tier | how a member gets there | in totals |
|---|---|---|
| CORE | a developer brand spelling resolves VERIFIED / STRONG MATCH to the core legal company (`lib/entities/resolve.js`; a name alone is never VERIFIED; a user-provided number = VERIFIED labelled USER_ASSUMPTION) | yes |
| DOCUMENTED | a USER DOCUMENT (ownership chart · company extract) states CONTROL — a share above 50 % — or a developer declaration names a declared parent, AND both parties are found in the registry by number with the registered name stated in the document (STRONG; a number alone is POSSIBLE); expanded only through such edges (depth ≤ 4, ≤ 40 companies); brands resolving STRONG to a documented company follow. A minority stake or a holding without a stated share is shown (structure, excluded list) — never a member, a parent or a reporting entity | yes — rows labelled LOW evidence (document chain) |
| SHARED | a joint-award string names a group company as ONE party (each party resolved separately); a joint string as the ANCHOR is JOINT_AWARD_ONLY — no group, its lots shared, its parties linked to their own groups | never — listed apart |
| POSSIBLE / AMBIGUOUS | registry candidates, the registry's "possibly the same" spellings, a document party not found by number or whose name differs | never — listed with the evidence, never expanded |

Never a link from a shared brand, address, director, similar name, contractor or parcel. Identity status: LEGAL_CORE_VERIFIED /
LEGAL_CORE_STRONG (as strong as the WEAKEST core brand link) · LEGAL_CORE_USER_KEY (by a company number the user provided — a USER
ASSUMPTION, never "verified") · COMPANY_ONLY (a company with no developer brand — e.g. a contractor) · BRAND_ONLY (no legal company
resolved) · JOINT_AWARD_ONLY (a joint winner string) · NOT_IN_COVERAGE (a number PROPX does not keep — says nothing about the company).
A developer declaration naming a PROJECT COMPANY never imports that company: it is attached to the declared project only, and only
when that project is one of the group's observed projects (otherwise listed as "not applied").
Structure: DOCUMENTED only with a STRONG holding edge; else NOT_IN_COVERAGE (there is no open ownership source). Roles: PARENT /
SUBSIDIARY / PROJECT_SPV (a declaration naming a project) / AFFILIATE from the document path; HOLDS ≠ GUARANTEES — a guarantee
edge only from an explicit parent guarantee in a declaration.

## Project aggregation

Rows = the projects of every CORE / DOCUMENTED brand, merged on the record id (a project reached through two group brands is ONE
row, its members listed). Two universes, never added: ILA awarded lots (capacity units) and MoCH lottery projects (first-lottery
units). Each row is read exactly as the project due diligence reads it (the registry record + its Project Intelligence timeline and
ladder — gated against `DD.project` row by row). Each row: legal entity, project company (the DD rule, `lib/dd/projectco.js` — VERIFIED
needs an official project-level number, none in coverage; a document naming another company = CONFLICT; IDENTIFIED only with ≥ 2
independent records — the land winner of record alone is "not identified — winner of record"; the core is never listed as an SPV), roles (land winner · programme developer · permit holders ·
STRONG executors · parent · guarantor), furthest verified stage + class, units, land award, lotteries, permit / start / completion,
latest dated evidence, evidence quality HIGH / MEDIUM / LOW with named reasons (about the EVIDENCE, never the project), programme,
plan approval (exact XPlan join), durations.

Stage buckets (each project once, at its furthest verified stage; only STRONG / VERIFIED links move it): LAND · MARKETED · PERMIT ·
CONSTRUCTION (start evidence, not on a current list) · ACTIVE_SITE (a STRONG Ministry of Labour site on the current list, or a
STRONG Tel Aviv site in an active state) · COMPLETION · OCCUPANCY · NO_LATER_EVIDENCE (below permit and 18+ months since the
award / lottery). Parallel evidence (every evidenced rung) is in the row.

## Execution, history and signals

OBSERVED EXECUTION LOAD — never "capacity utilization": lots with construction-start evidence and no completion evidence (current
active vs start evidence only vs stale MoCH rows), early-stage lots, recent awards (12 / 24 months), records without later
evidence, open records and simultaneous localities, beside the cohort's distribution over groups (P50 / P90).

Historical record (`historyOf`): award → permit, award → start, permit → start, start → completion, plan approval → start — n,
median, P25 / P75, tenders, coverage, period. Comparisons only with a basis, ALWAYS without the group's own records: vs the national
cohort (start within 36 months of the award, among COVERED lots — Tel Aviv-Yafo or a MoCH construction-progress join — whose 36
months end before the coverage end: censoring- and coverage-aware), vs own prior history (tenders split at the median award date,
each half ≥ 3 tenders with a start), vs the locality (≥ 10, the group's own lots removed). One tender = one observation (medians over
tenders); SHORTER / LONGER / SIMILAR need ≥ 3 own and ≥ 30 cohort observations, else NO_COMPARISON_BASIS.

Signals (deterministic, `RULES`, each with projects · dates · comparison · sample size · source · class · rule · limitations; the
registry's SIGNAL_RULES document each): EXECUTION_TIME_IMPROVING / LENGTHENING · HIGH_SIMULTANEOUS_PROJECT_LOAD (≥ 5 lots, ≥ 2
tenders, ≥ cohort P90) · HIGH_EARLY_STAGE_PIPELINE · HIGH_UNFINISHED_OBSERVED_PIPELINE · COMPLETION_EVIDENCE_STRONG (over lots with a
dated start ≥ 36 months before the coverage end, vs every other such lot) · LIMITED_COMPLETION_EVIDENCE (a COVERAGE statement: fewer
than half of the lots awarded 72+ months ago are in a source that could show a completion — never an execution finding) ·
RECENT_PROJECT_ACTIVITY_ACCELERATING / SLOWING (distinct TENDERS won, last 12 vs prior 12; lotteries apart) ·
NO_LATER_PUBLIC_EVIDENCE_FOUND (covered geography only — elsewhere a coverage gap) · GROUP_GEOGRAPHIC_CONCENTRATION (top locality
≥ 70 % of ≥ 5 lots from ≥ 3 tenders) · matrix cells (MATRIX_CELL_CONCENTRATION). One tender = one observation everywhere; the two
universes are never added in a ranking (geography by lots, then lottery projects; the leading programme per universe). Stage × geography and stage × programme matrices; a group timeline (12m / 24m / 5y / all).

## Geography · programme · land

Geography by district and locality (lots, units, lottery projects, first / last date), the largest city's unit share, market
entries in 12 / 24 / 36 months, and the exact statement: "High concentration means the observed portfolio depends more heavily on
one market. It does not by itself indicate financial weakness." Programme from the source's own track only: OPEN MARKET ·
SUBSIDIZED · LONG-TERM RENTAL · OTHER partition the lots; STATE LAND is an overlay (every ILA lot); URBAN RENEWAL and PRIVATE LAND
are "not observed" (public channels only) — never inferred from a name. Land pipeline: lots / units / consideration in 12 / 24 /
36 months by market, ₪ per unit, re-tenders through the lot file only — LAND WON ≠ PROJECT UNDER CONSTRUCTION, LAND PIPELINE ≠
REVENUE, UNITS AWARDED ≠ UNITS SOLD.

## Financial, leverage, pipeline vs financial position

Per legal entity only (`lib/dd/financial.js` over USER DOCUMENT statements); never aggregated across entities; SPV liabilities never
rolled into the parent. The reporting entity of the view: a CONTROLLING parent (> 50 % or declared) whose latest statement is
consolidated, else the core company, else NONE — a subsidiary's / SPV's / affiliate's statements are shown each on its own, never as
the group's. Statement selection: the most recent period end; consolidated preferred only within it; what was not used is said.
THEN → NOW only on the comparable period (same entity, kind, basis, currency, about a year apart) AND on one calculation basis: debt
and net debt computed the same way on both sides (from the components, or as reported) — a different basis shows no change and no
flag. The group's leverage flag: net debt / equity decides (up ≥ 0.25); debt / assets alone only when net debt / equity is not
comparable; debt / assets up while net debt / equity did not rise = GROSS_LEVERAGE_INCREASED (info). A covenant reported as not met
(the latest schedule of its series) = COVENANT_NOT_MET. Bond maturities: upcoming apart from past dates, older schedules of a series
superseded, amounts as entered (the schedule records no currency or units).
"Understanding leverage": the spec texts (level 1 · why · not a prediction of default), ND/E, D/A, current ratio, cash / current
liabilities, OCF / debt, interest cover, near-term debt share, bond maturities by year (per series, in the document's units) — each
missing input named; no scenario on invented inputs. Pipeline vs financial position: factual quantities side by side — no ratio
across official land sums and document cash, no solvency verdict; "large" only against the cohort (≥ 5 lots in execution, or ≥ 5
lots awarded in 36 months, at or above the groups' 90th percentile); "rising" only when the activity trend rule says accelerating;
statements LARGE_PIPELINE_NO_FINANCIALS ("Large visible pipeline;
current public financial coverage is insufficient to assess funding capacity.") · LIMITED_PIPELINE_NO_FINANCIALS ·
PIPELINE_WITH_RISING_LEVERAGE ("High observed pipeline alongside increasing leverage.") · PIPELINE_BESIDE_FINANCIAL_POSITION.

## Structure, legal, brief, next best evidence

Corporate structure: a layered map of the nodes and edges above — every edge clickable (match state · source · date · class ·
why · what it does not prove); no guessed graph. Legal / corporate timeline: the exact entity by number only — registry status
changes, charges (CHARGE ≠ DISTRESS; registrations and removals with their window, collapsed per month on the group timeline),
Official Receiver cases labelled OPEN / CLOSED (a closed case ≠ current insolvency; DISSOLVED BY THE COURT is a terminal status, never
an "open record"), attachment filings, breach updates, Official Receiver liquidation cases, voluntary
liquidation, strike-off designation, disclosed proceedings and ratings from documents. Risk & gap brief: six categories (verified
fact · derived signal · missing evidence · source limitation · entity ambiguity · source conflict), each item: why it matters ·
what it does not mean · what would confirm · what would disprove · what to verify next. Next best evidence: ten kinds ranked by
a documented usefulness rule, each with why · what it could change · can PROPX retrieve it · does the user provide it (with no
legal core, the company number / extract comes first). First read (5 lines: group · portfolio · execution with its coverage context ·
main observed exposure · main unknown → verify next), one minute (9 questions), top block. Main exposure order: an open official
insolvency record · a court dissolution · going-concern language / a covenant not met / a rating downgrade / a negative outlook (the
reporting entity, named) · the portfolio signals · leverage / maturity / liquidity flags · else "no exposure rule fired" with the
largest market and the threshold.

## UI

The PROPX page's entity drawer, kind `group` (wide panel): one-minute → five-minute → deep dive; entries "VIEW DEVELOPER GROUP"
on a developer / project drawer, "VIEW GROUP / SPONSOR" on a company drawer, and a "Group ↗" action on developer / company /
project search hits. Every ⓘ reads `lib/explain/registry.js` (group `group`); sortable tables through `PT_DOM` (`gxport` · `gxdist`
· `gxloc` · `gxspv` · `gxedges` · `gxmem`).

## The 14 truths (enforced by `test/group.test.js`)

BRAND ≠ LEGAL COMPANY · PARENT ≠ GUARANTOR · SUBSIDIARY ≠ SPV · LAND WINNER ≠ PROJECT COMPANY · CONTRACTOR ≠ DEVELOPER · ACTIVE SITE
≠ COMPLETED PROJECT · LAND PIPELINE ≠ ACTIVE CONSTRUCTION · AWARDED UNITS ≠ SOLD UNITS · PIPELINE SIZE ≠ FINANCIAL CAPACITY · HIGH
LEVERAGE ≠ DEFAULT · CHARGE ≠ DISTRESS · NO FINANCIALS ≠ FINANCIAL WEAKNESS · NO LATER EVIDENCE ≠ PROJECT STALLED · POSSIBLE
RELATION ≠ GROUP CONTROL.

## Independent review (19.10.2026)

Three reviews (entity / group correctness · financial interpretation · UX / comprehension) found, among others: a timeline read
without the project's Project Intelligence block (false "no later evidence"), a joint string counted as a group, a one-project
declaration importing a whole company, minority stakes treated as parents / subsidiaries, an SPV's statements standing in for the
group, the land winner presented as the identified project company, the two universes added in rankings, single-tender signals, a
group compared with itself, execution shares measuring coverage, a basis change read as a leverage change, net vs gross leverage,
a dissolved company counted as an open record, charges without removals, ratio pairs scrambled in RTL and raw codes in the Hebrew
view. Every one is fixed and pinned by a gate in `test/group.test.js` ("independent review gates").

Tests: `test/group.test.js` (truth gates, review gates, API, page wiring, zero regression, 19 acceptance cases →
`test/fixtures/group-acceptance-2026-10-19.json` with `GROUP_ACCEPTANCE_OUT`); documents: the labelled TEST FIXTURE
`test/fixtures/group-fixture.js` (fictional relations and figures).

## Limitations

Ownership, financials, guarantees and project companies exist only where the user provides a document (no open source; MAYA /
TASE / MAGNA refuse a non-browser client). Dated construction starts / completions come from the MoCH progress rows (to their
as-of date) and Tel Aviv-Yafo's permits / sites; elsewhere the Ministry of Labour list is undated (current / not current only).
Private-land and urban-renewal activity is not observed. Sales are not observed. The cohort is every lot PROPX holds — not the
whole market.
