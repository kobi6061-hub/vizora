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
