# LIVE THESIS — persistence today, and the future store contract (18.10.2026)

**Status: the feature runs fully on the current PROPX architecture.** Theses are kept where the saved deals are kept —
in the browser (`localStorage`, key `altaris:thesis:v1`), through a thin adapter (`{ get(key), set(key, value) }`) that
`altaris/thesis.js createRepository(adapter)` wraps. **Supabase is NOT activated, no migration was written to
`supabase/migrations/`, no table exists, nothing in ALTARIS imports or calls a Supabase client.** This document is the
integration contract for the day the PROPX store is connected — so that the move is a storage adapter, not a redesign.

> Hard rule carried from the build brief: never let store preparation slow, reshape or destabilise the feature. If
> anything below conflicts with the running code, the code (and its tests) wins; update this contract.

## 1 · Logical entities (as the code already keys them)

| entity | stable id | where it lives today | immutability |
|---|---|---|---|
| `decision_snapshot` | `(dealId, versionN)` + content `hash` | `record.versions[n].snapshot` | **immutable** — hashed (FNV-1a over canonical JSON); `init` refuses a different snapshot for the same saved version |
| `live_thesis` (record) | `dealId` (= the saved deal's id, a UUID the page mints) | `records[dealId]` | mutable envelope: `monitor`, `status`, `lastCheck` |
| `thesis_version` | `(dealId, n)` | `record.versions[]` | append-only (`REUNDERWRITE` / `REDECIDE`) |
| `thesis_contract` · `thesis_watch` · `next_best_evidence` | with the version | `versions[n].contract / watch / nbe` | derived from the snapshot, frozen with it |
| `thesis_event` | `(dealId, n)` | `record.events[]` | append-only: `BASELINE` · `REUNDERWRITE` · `REDECIDE` · `CHECK` · `PAUSE` · `RESUME` |
| `decision_delta` (a check) | the `CHECK` event + `record.lastCheck` | event summary + the full last result | the event is immutable; `lastCheck` is the latest full result |
| `thesis_status_history` | `(dealId, i)` | `record.statusHistory[]` | append-only |

Ids reused from the read models (never re-minted): the deal id (`altaris:deals:v1`), the saved version number, the
locality code (`cityCode`, the geo registry), the CBS geography code (`d-…` / `il`), signal ids (`lib/radar/scan.js`),
rule ids (`F0–F5`, `TH-*`), registry term ids (`lib/explain/registry.js`).

## 2 · Required fields

`decision_snapshot` (schema `altaris-decision-snapshot-v1`, produced by `snapshot()`): `schema`, `version{thesis, decision,
market, engine, metricMethodology}`, `dealId`, `versionN`, `decidedAt` (ISO date), `savedAt`, `createdAt`, `basis`
(`DECISION_SAVE` · `RECONSTRUCTED` · `BASELINE_TODAY`), `stampAtSave`, `name`, `geography{city, cityCode, district, street}`,
`developer`, `project`, `assumptions{dealHash, settingsHash, supportedValue, valueSource, basis, sqm, status, developerRating,
selected, spread, sources}`, `economic{verdict, basis, score, descriptor, recommended, second, lead, structures{k: {ok, verdict,
irr, irrDown, moic, capitalAtRisk, profit, months, mos, coverage, hurdles, gates[], soft[], criticalFail[], evidence, groups}},
evidence{score, level, conflict, insufficient, items[]}, missing[], strengths[], risks[]}`, `market{status, convergence,
factors[], freshness, notes}`, `final{verdict, changed, from, to, rule, reason, marketCondition, whatWouldRemove}`,
`conditions[]`, `flips[] | null`, `breakdown`, `conflicts[]`, `freshness[]`, `context{market, cbs, indicators,
indicatorsCheckedAt, readAt}`, `rulesFired`, `registry[]`, `hash`.

`thesis_event` (`CHECK`): `n`, `at`, `kind`, `version`, `state`, `materiality`, `rule`, `verdict`, `market`,
`conditions{active, resolved, added}`, `changes[{id, rule, materiality, impact, from, to}]`, `attention`, `snapshotHash`,
`basis{retrievedAt, dossierGeneratedAt, radarBuiltAt}`.

## 3 · Date semantics

- `decidedAt` — the decision date (the page's `today` when the version was saved; for a reconstruction, the saved
  version's date; for a baseline created today, today). **Observation**, not publication.
- `createdAt` — when the record / version / event was written. **PROPX check** time.
- `context.market.retrievedAt`, `dossier.generatedAt`, `radar.builtAt`, `cbs.latest / sourceUpdate / checkedAt` — the
  three dates of every source (observation ≠ publication ≠ check) travel inside the snapshot and are never rewritten.
- A check's `checkedAt` is the page's `today` (date); the event's `at` is the write timestamp.

## 4 · Versioning

- `versions[].n` increments on every appended version; the first is the baseline.
- `REUNDERWRITE` = `assumptions.dealHash` or `settingsHash` differs from the previous version (the user changed an
  input or the fund settings): economics legitimately recomputed, a new decision snapshot, the original kept.
- `REDECIDE` = the same assumptions decided again (the market context was loaded after the first save, a later
  decision stamp): a new snapshot, the original kept.
- `init` with an identical hash → `unchanged`; with a different snapshot for the same `versionN` and the same hashes →
  `refused` (the original is immutable).
- The repository never deletes. Archiving a deal hides it from the monitor; the thesis record stays.

## 5 · Ownership and row-level assumptions (future)

- Every row belongs to one `owner_id` (the authenticated PROPX user). Theses are **per user** like saved deals; there
  is no sharing model yet. RLS: `owner_id = auth.uid()` on every table; the service role is never used from the page.
- The page is the only writer today (through the adapter). When a server adapter exists, writes go through PROPX's
  own API (session-gated by `middleware.js`), never from the browser to the store directly.

## 6 · Draft relational shape (DOCUMENTATION ONLY — not a migration, not executed)

```sql
-- DRAFT · NOT APPLIED · lives in this markdown only. Schema `user_state` (per-user state, kept apart from `market`).
create table user_state.live_thesis (
  deal_id        text primary key,            -- the saved deal's id (altaris:deals:v1)
  owner_id       uuid not null,
  monitor        text not null default 'LIVE' check (monitor in ('LIVE','PAUSED')),
  status         text not null default 'NOT_CHECKED',
  created_at     timestamptz not null,
  last_check     jsonb                         -- the latest full reassess result (denormalised for the monitor)
);
create table user_state.thesis_version (
  deal_id        text not null references user_state.live_thesis(deal_id),
  n              integer not null,
  owner_id       uuid not null,
  version_n      integer,                      -- the saved deal version it was taken from
  basis          text not null check (basis in ('DECISION_SAVE','RECONSTRUCTED','BASELINE_TODAY')),
  hash           text not null,
  snapshot       jsonb not null,               -- altaris-decision-snapshot-v1 · IMMUTABLE (no update grant)
  contract       jsonb not null,
  watch          jsonb not null,
  nbe            jsonb not null,
  created_at     timestamptz not null,
  primary key (deal_id, n)
);
create table user_state.thesis_event (
  deal_id        text not null references user_state.live_thesis(deal_id),
  n              integer not null,
  owner_id       uuid not null,
  at             timestamptz,
  kind           text not null check (kind in ('BASELINE','REUNDERWRITE','REDECIDE','CHECK','PAUSE','RESUME')),
  version        integer,
  payload        jsonb not null,               -- the event summary exactly as the browser record keeps it
  primary key (deal_id, n)
);
create table user_state.thesis_status_history (
  deal_id text not null, i integer not null, owner_id uuid not null, at timestamptz, status text not null, reason text,
  primary key (deal_id, i)
);
-- expected indexes: (owner_id), (owner_id, status), thesis_event (owner_id, at desc), thesis_version (hash)
-- grants: insert-only on thesis_version / thesis_event / thesis_status_history for the owner; update only on live_thesis
--         (monitor, status, last_check). No delete grant anywhere.
```

## 7 · Migration considerations

- The browser record is the source: `records[dealId]` → one `live_thesis` row + its versions / events / history.
  Hashes are recomputed on import and must match (`verify(snapshot).ok`); a mismatch is imported with
  `basis = 'BASELINE_TODAY'`? **No** — a mismatch is refused and reported; nothing is rewritten.
- Deals and theses move together (a thesis without its deal is meaningless); the import order is deals → theses.
- The adapter contract stays `{ get, set }` on the page (whole-record read / write); a server adapter implements the same
  two calls over PROPX's API with optimistic concurrency on `events.length`.

## 8 · What a server adapter must NOT change

The logic. `snapshot`, `contract`, `nextBestEvidence`, `watchlist`, `reassess`, `portfolio` take and return plain data;
the repository is the only piece that touches storage. The tests in `test/altaris-thesis.test.js` run the repository over
the in-memory adapter and must pass unchanged against any adapter.
