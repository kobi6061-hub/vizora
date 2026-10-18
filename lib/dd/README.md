# PROPX · Institutional due diligence (lib/dd, 18.10.2026)

Who the developer legally is, what the public corporate record says about that legal person, who executes the
construction, and what a municipality publishes about permits and sites — each fact with its source, class, period,
coverage label and, for every link between two entities, an explicit **match state**. No score, no probability, no
recommendation. Additive: Developer Intelligence 2.0, Project Intelligence 2.0, the Trust Center, Live Thesis, ALTARIS and
the explainability registry are unchanged except for additive registry terms and Trust entries.

## Sources (audit: `lib/trust/discovery/2026-10-18.json` + `findings-2026-10-18.md`)

| source id | what PROPX keeps | key | coverage |
|---|---|---|---|
| `datagov:ica:companies` | registry rows that resolve from developer names (+ spelling variants, joint-string parties) and registered contractors' company numbers | company number | national |
| `datagov:ica:changes` | filing events of the kept companies: charge registered / removed / updated, annual reports, officers, breach updates | company number | national · rolling ~12 months |
| `datagov:ica:partnerships` | as companies, for partnership-kind developers | partnership number | national |
| `datagov:moj:official-receiver:liquidation` | court liquidation cases of kept companies | company number (0 = unusable) | national |
| `datagov:ica:voluntary-liquidation-fast-track` | fast-track voluntary liquidations of kept companies | company number | national |
| `datagov:moch:contractors-register` | every registration row (slim) | contractor number · entity number = company number | national |
| `datagov:labor:active-construction-sites` (+ closed) | every active site (slim) with PROPX first / last seen; closure notices | work id · executor id = contractor number | national, by city name |
| `tlv:iview2:permits-772` + `tlv:iview2:sites-499` | every permit request and supervised site | request / permit number · building file · tik · block/parcel | **Tel Aviv-Yafo only** |

Rejected / blocked: the pledges register (no debtor on the row), court / enforcement datasets (nothing at the debtor
level), TASE / MAYA / MAGNA (403 to a non-browser client — never bypassed). Sync: `scripts/dd-sync.js` on
`.github/workflows/dd-sync.yml` (every working day) → `data/dd/` (bot-written); run states per lane in
`data/dd/sync-runs.jsonl`; what changed between two PROPX reads in `data/dd/history.jsonl` (append-only; the first read
of a row — or of a newly kept company — is never an event); `lib/dd/retractions.js` lists events a PROPX defect produced
(kept in the ledger, skipped by every read).

## Entity model and match states (`lib/entities/resolve.js`)

18 entity types (`ENTITY_MODEL`): LEGAL_COMPANY · DEVELOPER_BRAND · PARENT_COMPANY · SUBSIDIARY · PROJECT_SPV · LAND_WINNER ·
PROJECT_OWNER · CONTRACTOR · EXECUTING_CONTRACTOR · PROJECT · MARKETING_NAME · PLAN · TENDER · LOT · BLOCK_PARCEL · ADDRESS ·
BUILDING_SITE · PERMIT_RECORD. Parent / subsidiary / SPV / guarantor: **not resolvable in current coverage** (no open source
carries ownership) — said, never inferred.

| state | rule |
|---|---|
| VERIFIED | an official number on both sides — a source record's, or a USER-PROVIDED company number whose registered name is the observed name (identical / same letters / same skeleton); a user number under a different registered name → POSSIBLE_MATCH (`USER_KEY_NAME_MISMATCH`), never attached |
| STRONG_MATCH | the identical registered legal name after typographic normalization (`regKey`: quotes, `~`, dots, hyphens, spacing) and exactly one row |
| POSSIBLE_MATCH | the same letters only, or the same consonant skeleton (plene / defective Hebrew spelling), and one row — never chosen |
| AMBIGUOUS | more than one candidate at the same tier — none picked, candidates shown |
| UNRESOLVED | no candidate, or no key (no legal form, a joint string as a whole, registry not synced, a malformed user number) |

A chain is as strong as its weakest link (`weakest`). A comma string is first resolved as ONE registered name (some
registered names carry a comma — `COMMA_IN_REGISTERED_NAME`); only when that fails and EVERY part carries a legal-form marker
(balanced brackets) is it a joint winner string, each party resolved on its own (`parties[]`); otherwise
`JOINT_STRING_NOT_SPLITTABLE` — nothing guessed. The registry status class reads the status AND the sub-status (`תת סטטוס`):
an order opening proceedings / rehabilitation / a stay of proceedings → INSOLVENCY_PROCEEDINGS, a creditors' arrangement /
provisional liquidation → ARRANGEMENT_OR_PROVISIONAL_LIQUIDATION, then court / voluntary liquidation, strike-off pending,
struck off, dissolved, active — the registrar's words always shown beside the class.

## Read models

- `developer.js` — identity (+ candidates, parties, possibly-same), corporate record of the resolved company (registry
  status class + verbatim, breach flag, last annual report, charges as dated filing events, Receiver cases, voluntary
  liquidation), financial-data coverage class from the registry TYPE only (PUBLIC FINANCIAL DATA NOT AVAILABLE IN CURRENT
  COVERAGE for every company), contractor registration + active sites + enforcement + closure notices, Tel Aviv
  permit-holder sites, execution record over the DD ladder, execution velocity (≥ 3 dated pairs, beside the same rule over
  every lot), signals (each with its rule in the registry), missing, hard truths, coverage, freshness.
- `project.js` — links with match states, sites / permits: a parcel identifies LAND, not a project — STRONG only with a
  second key (permit holder / executor company = the developer) and dates on / after the award; parcel-only → POSSIBLE (never
  on the ladder); all dated activity before the award → PARCEL HISTORY; a lot number in a site name → POSSIBLE / AMBIGUOUS
  (several plan|lot pairs) / excluded (non-residential site); a Ministry of Labour site PROPX already saw listed before the
  award → POSSIBLE (`LISTED_BEFORE_AWARD`). The verified dated timeline (a PROPX observation is labelled; pre-award entries
  flagged), the stage ladder with a coverage label per rung (only STRONG / VERIFIED links move it, and only with dates on /
  after the award), the EXECUTION EVIDENCE GAP rule (≥ 18 months since the last dated public evidence below completion, and
  ONLY where a source in coverage could have shown later evidence — a Tel Aviv lot, a MoCH project; elsewhere `coverageGap`:
  a SOURCE LIMITATION, never a signal) and "NO LATER PUBLIC EVIDENCE FOUND" — never stalled / failed / delayed; the executing
  contractors from STRONG sites only (`contractors`), POSSIBLE sites' executors apart (`possibleContractors`); the
  first-minute summary.
- `brief.js` — RISK & GAP BRIEF in six categories (VERIFIED_FACT · DERIVED_SIGNAL · MISSING_EVIDENCE · SOURCE_LIMITATION ·
  ENTITY_AMBIGUITY · SOURCE_CONFLICT), each item why · confirms · disproves · verify next; NEXT BEST EVIDENCE ranked by
  usefulness (a constant per kind) with retrievable-by-PROPX / user-provided / monitorable flags.
- `watch.js` — the WATCH contract: detectable events per key and source, what cannot be detected, the last check, changes
  since a date — matched by exact keys only (the event's key; a contractor's registry number as executor or previous
  executor; a watched parcel written on a site event; a closure notice under the contractor's registered name, normalized).
  No autonomous agent, no alerts; the page keeps the user's list in `propx:watch:v1`.
- `sync.js` history events: `charge-registered` · `charge-removed` · `charge-removal-cancelled` (the charge stands again) ·
  `charge-updated` · `annual-report-filed` (the bare report) · `annual-report-update` (a change reported with it) ·
  `attachment-order-filing` (≠ insolvency) · `voluntary-liquidation-filing` · `breach-update` · `filing-observed`;
  `company-status-changed` · `company-sub-status-changed` · `company-breach-flag-changed` · `annual-report-year-advanced`
  (a later year only) / `annual-report-year-changed`; site events carry `executorId` / `oldExecutorId` / `parcel` /
  `executorKey`. Paging fails a lane on a SHORT READ (fewer rows than the source's own total — CKAN `total`, ArcGIS
  `returnCountOnly`), so a row that was not read is never recorded as gone; an estimated CKAN total is not enforced.
- `evidence.js` — the per-entity evidence graph: every edge type · source · source id · dates · class · match state ·
  reasons · limitations; POSSIBLE / AMBIGUOUS edges never promoted; PARCEL_HISTORY its own edge type.
- `index.js` — orchestration + `company(number)`, `permit(id)`, `searchHits(q)`, `status()`. A Tel Aviv permit RECORD is
  keyed by its request number (`permit:tlv:<request>`; every row of the request kept — permit numbers, stages, units per row,
  never summed); a bare number that is one record's request and another's permit returns BOTH search hits (each saying by
  which) and `permit(<number>)` answers `ambiguous` with the candidates — "היתר" / "בקשה" narrow it.

API (`api/intel.js`): `view=dd&developer=|project=[&company=<number>&confirm=1][&since=]`, `view=ddCompany&number=|kablan=`,
`view=ddPermit&id=`, `view=ddStatus`; `view=search` returns typed LEGAL COMPANY / CONTRACTOR / PERMIT hits beside the developer
(brand) hits. Page: the DD panel at the top of the developer / project drawer (one-minute card · five-minute sections · deep
dive), the company and permit drawers, the watchlist row in `#intel`. Registry: 24 terms (group `dd`), 15 signal rules, 9
missing reasons. Tests: `test/entities-resolve.test.js` (19), `test/dd.test.js` (42, the brief's test matrix on the labelled
fixture `test/fixtures/dd-fixture.js` + real-data gates + the sync's paging guards on a stub answer).

## Premium Diligence 2.0 (18.10.2026)

Source audit: `lib/trust/discovery/2026-10-18-premium.json` (32 candidates, runs 39130709010 + 39130975687 of
`dd-discover.yml`). Financial filings (MAYA API / static reports, TASE Data Hub, ISA MAGNA, XBRL), credit ratings (Maalot,
Midroog), ownership (the Registrar extract), litigation (class-actions registry, court decisions) and 13 municipal permit
channels are classified INTEGRATE / BROWSER-AUTOMATION ONLY / DOCUMENT-ONLY / BLOCKED / REJECT with the run evidence; nothing
is scraped, no anti-bot control is bypassed. Integrated: the Registrar's companies-designated-for-strike-off list (lane
`strikeoff`, exact company number) and the MoCH construction-progress join already in the land read model.

- `userdocs.js` (UMD — the page and the server share it) — USER DOCUMENT: 13 document types (financial statements, ownership
  chart, company extract, permit, bank guarantee, sales report, financing agreement, appraisal, land-rights document, bond
  covenants, purchase agreement, developer declaration, litigation disclosure), typed fields, provenance REQUIRED (file name or
  issuer; the file's SHA-256 when the user attaches one — the file never leaves the browser), no future dates, at most 60
  documents, `registryCheck` of every company number (REGISTRY_ROW_FOUND · NAME_DIFFERS · NOT_IN_COVERAGE · NO_NUMBER), CSV
  template / import. Class USER_DOCUMENT always; a document never overrides an official record (a different company = CONFLICT).
- `financial.js` — PUBLIC FINANCIAL PROFILE for ONE legal entity (statements are read only for the resolved company number —
  none without one): figures with period · report date · source · document id · currency · units · restated · class; ratios
  within one statement only (net debt / equity, debt / assets, current ratio, cash / current liabilities, OCF / debt, interest
  cover, near-term debt / cash), each with its inputs or the reason it is withheld; total debt = the reported total, else
  short + long (DERIVED) — the bond balance is a component, never added; restatement supersedes (both kept); an un-marked
  disagreement = CONFLICT (no pick, no ratios); flags (LEVERAGE INCREASED · LIQUIDITY WEAKENED · CASH IMPROVED · NEAR-TERM DEBT
  CONCENTRATION · OPERATING CASH FLOW NEGATIVE · GOING-CONCERN LANGUAGE PRESENT · RATING DOWNGRADE · RATING OUTLOOK NEGATIVE ·
  INSUFFICIENT FINANCIAL DATA) only against the comparable period (same kind, basis, currency; a year ± 45 days), each with
  rule · threshold · inputs · periods. No score, no probability of default. A project read shows the project company's
  statements when provided, else the developer company's — labelled (developer / public-company financials ≠ SPV financials).
- `structure.js` — CORPORATE STRUCTURE GRAPH: HOLDS / SHAREHOLDER_OF / GUARANTEES only from a user document (each party
  checked by number: both found → STRONG, else POSSIBLE / UNRESOLVED); CO_WINNER from the official joint award (not
  ownership). Every edge: what it proves · source · date · scope · what it does NOT prove.
- `projectco.js` — PROJECT COMPANY / SPV: roles developer brand · land winner / programme developer · project company · permit
  holder · executing contractor · parent · guarantor (only from an explicit document). States: VERIFIED needs an official
  project-level record with the company number (none in coverage) · STRONG (one or more records resolve to ONE company; the
  wording says how many) · POSSIBLE (a candidate not resolved, or records naming different companies — CONFLICT, none picked)
  · UNRESOLVED; the resolving documents feed NEXT BEST EVIDENCE. Only documents carrying THIS project's id (or whose subject is
  this project company) lend it a parent / guarantor; an expired guarantee is marked.
- `legal.js` — LEGAL EXPOSURE — PUBLICLY DISCLOSED ONLY: liquidation cases, insolvency / court-liquidation status, voluntary
  liquidation, strike-off designation, attachment filings (by company number) + disclosed litigation from a user document;
  civil / regulatory NOT IN COVERAGE. ABSENCE OF A PUBLIC ROW ≠ NO LITIGATION.
- `sales.js` — SALES PROGRESS: OFFICIAL programme lotteries (offered ≠ sold) and tender capacity; reported sales from a user
  document labelled by who reported them (DEVELOPER-REPORTED → SELF_REPORTED in the summary); a DERIVED pace only between two
  dated reports; never mixed with official transactions.
- `coverage.js` + `lib/permits/connectors.js` — the MUNICIPAL PERMIT CONNECTOR registry (14 municipalities: Tel Aviv-Yafo LIVE,
  Jerusalem BLOCKED, Kfar Saba DOCUMENTED, 11 NO MACHINE ACCESS; every other locality NOT AUDITED; one common permit schema a
  future connector maps to) and the PROJECT EXECUTION COVERAGE MAP (permit · start · active site · completion · occupancy:
  project-live / project-stale / national-no-dates / district-only / none — a district series never fills a project cell).
- `live.js` — LIVE REGISTRY LOOKUP for a company number the user supplies that the kept rows do not hold: exact CKAN `filters`
  on five registry resources, at most 3 numbers per read, 6 s per request, used for that read only (a per-read overlay — the
  memoised cache is never mutated), labelled LIVE READ; a refusal is "did not answer", never "no company".
- `summary.js` — the INSTITUTIONAL DILIGENCE SUMMARY: 11 fixed rows (identity · resolution · project stage · execution ·
  financial · corporate / legal · sales · risks · gaps · next best evidence · watch), one sentence and ONE class each
  (VERIFIED · DERIVED · SELF_REPORTED · USER_DOCUMENT · MISSING · CONFLICT), each with its registry term.

API: `POST /api/intel?view=dd&developer=|project=` with `{ userDocs: [...] }` (≤ 256 KB — since 19.10.2026 enforced for real: the Edge
middleware refuses a declared length over 256 KB before the function runs, the function refuses a declared length before it
touches the platform-parsed body and measures a body without a length after parsing, and `userdocs.normalizeAll` caps the
normalized evidence at 256 KB in total; the platform's own ceiling for a chunked body is 4.5 MB; POST is refused on every other view;
the documents are validated again, used for that read, never stored or logged) → `premium`, `summary`, `userDocs { used,
rejected }`, `live`; `view=ddCoverage&city=<code>`. Page: the summary at the top of the DD panel, the premium sections in the
five-minute view, "Evidence you provided" (form per type, CSV import, file fingerprint, `propx:dd:docs:v1` in the browser), an
"Add a document" button on every NEXT BEST EVIDENCE item that names a document type. Registry: group `dd2` (22 terms with
"what would strengthen it" / "what to verify next"), 9 financial signal rules, classes SELF_REPORTED / USER_DOCUMENT.
Tests: `test/dd-premium.test.js` (52 gates incl. the brief's 20 acceptance cases and one gate per independent-review finding,
R1–R14; `DD_PREMIUM_ACCEPTANCE_OUT=<file>` writes the cases).

Independent review (18.10.2026) — fixed: documents about another project never lend a parent / guarantor / guarantee (only this
project's id, or a document whose subject is this project company; a company is never its own parent; an expired guarantee is
said); live lanes that did not answer are NOT CHECKED (never "no record"); a STRONG project company is a DERIVED signal and a
document makes a relation STRONG at most; the SPV note on every project read whose statements are not a VERIFIED project
company's; the summary reads the latest sales report, rates a stage moved by a STRONG link DERIVED, reads the project company's
own record and says CONFLICT when every statement conflicts; a user-disclosed insolvency is said beside "no OFFICIAL record";
document ids = file fingerprint + facts; a lot number + executor stays POSSIBLE (`LOT_NUMBER_PLAN_SCOPED`); money compared to
the agora; every superseded version kept; '1,5' / 2025-02-31 refused; live answers for another number ignored and the shared
memos never hold live rows; a Tel Aviv permit holder is not an independent record; an attachment filing is a filing; a
shareholder without a number is scoped to its document.

### Adapter contract — a licensed financial feed (not activated)

A licensed feed (e.g. a TASE / MAYA data licence or a rating agency's feed) enters ONLY through the statement shape
`financial.js` already reads — never through scraping — and keeps its own class:

```
{ id, entityNumber, entityName, period: { end: 'YYYY-MM-DD', kind: 'annual'|'half'|'quarter' }, reportDate, basis:
  'consolidated'|'separate', audited, currency, units: 'units'|'thousands'|'millions', restated: bool, cls: 'OFFICIAL',
  source: '<licensed-feed id>', filingId: '<the filing reference>', figures: { <FIELD>: { value, nis } }, notes, rating,
  limitations }
```

Rules for the adapter: one entity per statement (keyed by the company number, never a name); XBRL facts mapped by concept id
with the context's period / unit / decimals checked (a duration fact never read as a balance); restatements carried as
separate statements with `restated: true` and a later `reportDate`; nothing summed across entities or periods; a missing
concept is absent — never 0. A persistence adapter for user documents (Supabase `user_state`) is likewise NOT activated: the
browser store is the only store; the server never keeps them.

## Hard truths enforced by code and gates

MISSING ≠ ZERO · NOT OBSERVED ≠ DOES NOT EXIST · NO LATER PUBLIC EVIDENCE ≠ PROJECT STOPPED · CHARGE ≠ DISTRESS · BREACH /
LIEN ≠ INSOLVENCY · VOLUNTARY LIQUIDATION ≠ INSOLVENCY · PERMIT ≠ CONSTRUCTION START ≠ COMPLETION · ACTIVE SITE ≠ COMPLETED UNITS ·
DEVELOPER NAME ≠ LEGAL COMPANY · BRAND ≠ SPV · PARENT ≠ GUARANTOR · CONTRACTOR ≠ DEVELOPER · MARKETING NAME ≠ PLANNING IDENTITY ·
NAME SIMILARITY ≠ VERIFIED · PARCEL MATCH ≠ SAME PROJECT · MUNICIPAL ≠ NATIONAL · PUBLIC COMPANY FINANCIALS ≠ SPV FINANCIALS ·
SOURCE SILENCE ≠ NEGATIVE EVIDENCE · NO FINANCIALS ≠ FINANCIAL WEAKNESS · PUBLIC COMPANY ≠ PROJECT SPV · SHAREHOLDER ≠ PROJECT
SUPPORT · DEVELOPER-REPORTED SALES ≠ OFFICIAL SALES · MARKETING CLAIM ≠ VERIFIED FACT · ADDRESS MATCH ≠ COMPANY OWNERSHIP · DISTRICT
CONSTRUCTION DATA ≠ PROJECT CONSTRUCTION DATA · NO COURT ROW ≠ NO LITIGATION · NO PUBLIC OWNERSHIP DATA ≠ NO OWNER ·
USER-UPLOADED DOCUMENT ≠ OFFICIAL SOURCE. The language gate in `test/dd.test.js` refuses distress / insolvent / stalled / delayed /
probability-of-default wording unless it is negated.
