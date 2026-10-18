# PROPX · Market Radar — the deterministic "what changed" engine

`lib/radar/events.js` turns the ledgers PROPX already commits into **events**; `lib/radar/query.js` serves them as the
windowed feed (`GET /api/intel?view=radar`) and the **Market Pulse** (`view=pulse`); `scripts/radar-build.js`
compiles `data/radar/events.json` (last 120 days) at the end of every sync workflow, so the serverless function reads
one small file (a fresh checkout builds it on read). The page shows it as the "דופק השוק" section (`#pulse`).

## What is an event

A change observed between two PROPX reads of a source record · a new period a source published · a revision of an
official figure (old value kept beside the new) · a change in a source's check state. **Not** an event: a dataset's
first ingestion (a record whose history starts the day PROPX first saw it, or a day on which a dataset gained > 2% of
its records), PROPX's first *detail* read of a tender (the list state `decided` → `awarded` / `no award`), a PROPX
parser upgrade (rental terms re-parsed from an unchanged notice), a replay.

Every event carries: its rule (`kind`), group, data class (OFFICIAL · OBSERVED · DERIVED — from the rule, never
reclassified), source id, `at` (when PROPX observed it) and `sourceDate` (the source's own date, kept apart), the
geography (locality code, names, district from the registry), the entity (tender / developer / renewal complex / plan /
rental notice / lottery / CBS series / indicator / source), a bilingual title and detail, and the values that changed.
**Materiality** (1–3) is a constant per rule — an awarded tender of ≥ 100 units, a cancellation, a ≥ 5% CBS revision, a
rate change or a source refusal are 3; housekeeping is 1. It is never a model.

| Group | Rules | Read from |
| --- | --- | --- |
| land | tender published / open / closed / awarded / no award / cancelled / frozen / new | `data/land/history.jsonl` + `tenders.json` |
| developers | developer wins land (per winner name, as published — never merged) · market entry (DERIVED, from `lib/entities`) | the same + the activity registry |
| planning | renewal complex declared / stage changed / new · plan status (XPlan station, stage, event) | `data/renewal/history.jsonl`, `planning-history.jsonl` |
| rental | new Dira Lehaskir notice (joined to its ILA tender by the printed number) · notice / planning site updated | `data/rental/dira-tenders.json`, `history.jsonl` |
| sales | CBS published a new month (with the district breakdown) · CBS revised N months (per series, with each change) | `data/cbs-sales/observations.jsonl` |
| macro | Bank of Israel rate changed · an index published a new period | `data/market/snapshots/indicators/*.json` |
| housing | new lottery · lottery due within 14 days | `data/housing/lotteries.json` |
| sources | a source's check state changed (REFUSED / FAILED / SCHEMA_CHANGED / PARTIAL / RECOVERED) · a source is STALE | `lib/trust/catalog` run summaries |

## The feed and the pulse

`feed(params)` — `window=today|7d|30d|90d|all`, `group`, `kind`, `city` (locality code), `district`, `q`, `m` (minimum
materiality), `page`, `size` — intersecting filters, newest first then materiality; `counts` per group and `cities`
describe the other facet's choices. `pulse()` — the compact sections (official sales with districts, national inventory
and months of supply, land, developers, planning & renewal, rental, housing, macro, source health), each with its
source, class and dates, plus deterministic one-line **facts** built only from those sections and the 12 latest
events. Nothing in the pulse is estimated.

Tests: `test/radar.test.js` (a synthetic data directory proves every rule and every exclusion; the live repository
builds; the API, the Vercel bundle and the six workflows are wired).

## "What changed?" — the seven verbs (`lib/radar/verbs.js`, 17.10.2026)

Every event carries one **verb** — `NEW` · `ADVANCED` · `CHANGED` · `REVISED` · `STALE` · `RECOVERED` · `CONFLICT` — a
deterministic classification by its rule id (a first publication → NEW; a move in the source's own lifecycle — opened,
closed, awarded, declared, a lottery due — → ADVANCED; a value or status change with no direction PROPX can assert — decided
without a winner, cancelled, frozen, a plan status, a notice, a rate — → CHANGED; an official revision → REVISED; stale
source content → STALE) and, for a `source-state` event, by the transition the run logs recorded (→ SCHEMA_CHANGED =
CONFLICT; → STALE = STALE; from REFUSED / FAILED / SCHEMA_CHANGED to SUCCESS / UNCHANGED = RECOVERED; else CHANGED). The
verb says what kind of change PROPX observed — never whether it is good or bad (materiality 1–3 carries the weight).
`GET /api/intel?view=radar&verb=<VERB>` narrows the feed; the response carries `verb`, `verbs` (counts over the set the
group facet describes), `verbLabels`, `verbOrder`; the Pulse shows the verb on every event and a verb filter. Registry term
`change_verb`. Gates: `test/verbs.test.js`.

## Opportunity Radar / Risk Radar (`lib/radar/scan.js`)

NOT an investment recommendation. `build()` runs the Market Dossier's explainable signals over Israel, the seven CBS
districts and the localities with the most live ILA tenders (40) and sorts them by rule into OPPORTUNITIES (worth
investigating: official sales momentum ≥ +10 % at district / national level, ≥ 500 units in open tenders, ≥ 1,000 awarded
units, ≥ 500 units awaiting decision, ≥ 2,000 proposed renewal units, ≥ 3 rental-track tenders, ≥ 2 developer entries) and
RISKS (momentum ≤ −10 %, national months of supply ≥ 18, ≥ 30 % of ≥ 5 tenders without a winner / cancelled, ≥ 3 stale
rental statuses, one developer ≥ 50 % of ≥ 5 lots, no observed events, construction inputs ≥ +3 %). Every item answers
"why was this flagged?": trigger · value · threshold · comparison (the national figure of the same rule, or the share of
it) · period · source · class · the dossier's evidence quality. Geography is strict: a locality never carries a district
or national series; macro rules are national only. Materiality is a constant per rule (1–3). Two DERIVED convergence
items are named as such (demand-with-supply; inventory-plus-pipeline). `scripts/radar-build.js` writes
`data/radar/scan.json` with the events; `GET /api/intel?view=scan` (kind, level, city, district, m, limit) and
`view=scanGeo` (one geography; an uncovered locality is computed with the same rules) serve it. The page shows the two
lists at the top of the Market Pulse; a geography opens its dossier.

## Revision Intelligence (`lib/radar/revisions.js`)

CBS revises recent months in later releases; PROPX appends every published value with its revision number and the value
it replaces (`data/cbs-sales/observations.jsonl`). `revisions()` (`view=revisions`: window=30d|90d|365d|all, material=1,
measure, geo) lists each revision as OLD VALUE · NEW VALUE · OBSERVATION PERIOD · PUBLICATION (the CBS series update date) ·
PROPX CHECK (when the revision was read), grouped by release with the net change per geography; "material" = |Δ| ≥ 5 %,
a constant. The Market Pulse shows the window's count, the material rows and the net change by geography.

## Trust 2.0 (`lib/trust/catalog.js`)

Each source's run summary now also states its latest success and latest failure (state + error) apart, a RECOVERED flag
(a good check after a failure, shown for 7 days), the last 14 check states, a good / total tally and the expected
cadence; the catalogue carries `alerts` — every source PROPX reads whose shown state is REFUSED / FAILED / SCHEMA_CHANGED /
STALE / PARTIAL, every source that recovered this week, and every source whose own content is stale — ordered by
severity. A run that answered and found nothing new (`status: unchanged`) is UNCHANGED, never FAILED; the working-day
syncs (CBS sales, Dira Lehaskir) are stale only after 100 hours, so a weekend is not a missed check.

## Radar 2.0 (18.10.2026) — every locality, an explicit state

- **Scope.** `scan.build()` now scans Israel, the seven districts and **every registry locality with at least one live ILA
  tender** (441 on 18.10.2026; `D.index({ limit: Infinity })`), not the top 40. A number still limits to the top-N by live tenders.
  `scope.localitiesWithLiveTenders` and `scope.localityRule` say which.
- **Signal state.** Every geography in `scan.json → geographies[]` carries `signalState` + `stateReason`: `SIGNALS` (≥ 1 rule fired),
  `NO_SIGNAL` (the data is there and no documented threshold was crossed — a valid, counted read, never "fine" or "stable"),
  `INSUFFICIENT_DATA` (evidence quality LOW, or no stored record — e.g. a locality whose tenders are all older than the 24-month
  current window and which has no complex, lottery project or rental tender, "history only"). A NO_SIGNAL locality with fewer than 3
  stored records says that the quiet-pipeline rule was not applicable. `counts.states` and the vocabulary `states` ship with the view;
  `forGeo()` answers the state for a covered geography and for one computed on demand. The Pulse scope line shows the counts;
  the dossier's "no signals" line carries the `no_signal` registry term.
- **Quiet pipeline needs a pipeline (precondition, not a new threshold).** `no-recent-changes` fires on a locality only when it carries
  ≥ 3 stored records (tenders in the current scope + rental tenders; renewal complexes + lottery projects as published, any date;
  `lib/dossier/query.js` `trackedRecords` / `TRACKED_MIN`). BEFORE: 297 of the 400 indexed localities carried the "risk" with as
  little as one old tender — an untracked locality is not quiet, it is unmeasured. Districts and the country always qualify. The
  signal's text, threshold and materiality are unchanged; the precondition is printed in its limitations.
- Cost: ≈ 16 s per build (one dossier per geography), run by `scripts/radar-build.js` at the end of every sync.

## Construction events (18.10.2026)

Group `construction` (label "official construction (CBS)"): `cbs-construction-published` (NEW, OFFICIAL, m 3 — a new period of
permits / starts / completions / active construction after the first ingestion; the national value in the title, the districts in
the detail) and `cbs-construction-revised` (REVISED, OFFICIAL, m 1–3 by the largest relative change; the old value kept beside the
new), read from `data/construction/observations.jsonl` (lib/construction). The first ingestion produces no event.
