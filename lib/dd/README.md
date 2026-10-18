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
| VERIFIED | an official number on both sides (a source record or a USER-PROVIDED company number, labelled) |
| STRONG_MATCH | the identical registered legal name after typographic normalization (`regKey`: quotes, `~`, dots, hyphens, spacing) and exactly one row |
| POSSIBLE_MATCH | the same letters only, or the same consonant skeleton (plene / defective Hebrew spelling), and one row — never chosen |
| AMBIGUOUS | more than one candidate at the same tier — none picked, candidates shown |
| UNRESOLVED | no candidate, or no key (no legal form, a joint string as a whole, registry not synced, a malformed user number) |

A chain is as strong as its weakest link (`weakest`). A joint winner string is never one entity: each party is resolved
on its own (`parties[]`).

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
  (several plan|lot pairs) / excluded (non-residential site). The verified dated timeline (a PROPX observation is labelled),
  the stage ladder with a coverage label per rung (only STRONG / VERIFIED links move it), the EXECUTION GAP rule (≥ 18 months
  since the last dated public evidence below completion) and "NO LATER PUBLIC EVIDENCE FOUND" — never stalled / failed /
  delayed; the first-minute summary.
- `brief.js` — RISK & GAP BRIEF in six categories (VERIFIED_FACT · DERIVED_SIGNAL · MISSING_EVIDENCE · SOURCE_LIMITATION ·
  ENTITY_AMBIGUITY · SOURCE_CONFLICT), each item why · confirms · disproves · verify next; NEXT BEST EVIDENCE ranked by
  usefulness (a constant per kind) with retrievable-by-PROPX / user-provided / monitorable flags.
- `watch.js` — the WATCH contract: detectable events per key and source, what cannot be detected, the last check, changes
  since a date. No autonomous agent, no alerts; the page keeps the user's list in `propx:watch:v1`.
- `evidence.js` — the per-entity evidence graph: every edge type · source · source id · dates · class · match state ·
  reasons · limitations; POSSIBLE / AMBIGUOUS edges never promoted; PARCEL_HISTORY its own edge type.
- `index.js` — orchestration + `company(number)`, `permit(id)`, `searchHits(q)`, `status()`.

API (`api/intel.js`): `view=dd&developer=|project=[&company=<number>&confirm=1][&since=]`, `view=ddCompany&number=|kablan=`,
`view=ddPermit&id=`, `view=ddStatus`; `view=search` returns typed LEGAL COMPANY / CONTRACTOR / PERMIT hits beside the developer
(brand) hits. Page: the DD panel at the top of the developer / project drawer (one-minute card · five-minute sections · deep
dive), the company and permit drawers, the watchlist row in `#intel`. Registry: 24 terms (group `dd`), 14 signal rules, 9
missing reasons. Tests: `test/entities-resolve.test.js` (16), `test/dd.test.js` (33, the brief's test matrix on the labelled
fixture `test/fixtures/dd-fixture.js` + real-data gates).

## Hard truths enforced by code and gates

MISSING ≠ ZERO · NOT OBSERVED ≠ DOES NOT EXIST · NO LATER PUBLIC EVIDENCE ≠ PROJECT STOPPED · CHARGE ≠ DISTRESS · BREACH /
LIEN ≠ INSOLVENCY · VOLUNTARY LIQUIDATION ≠ INSOLVENCY · PERMIT ≠ CONSTRUCTION START ≠ COMPLETION · ACTIVE SITE ≠ COMPLETED UNITS ·
DEVELOPER NAME ≠ LEGAL COMPANY · BRAND ≠ SPV · PARENT ≠ GUARANTOR · CONTRACTOR ≠ DEVELOPER · MARKETING NAME ≠ PLANNING IDENTITY ·
NAME SIMILARITY ≠ VERIFIED · PARCEL MATCH ≠ SAME PROJECT · MUNICIPAL ≠ NATIONAL · PUBLIC COMPANY FINANCIALS ≠ SPV FINANCIALS ·
SOURCE SILENCE ≠ NEGATIVE EVIDENCE. The language gate in `test/dd.test.js` refuses distress / insolvent / stalled / delayed /
probability-of-default wording unless it is negated.
