# PROPX overnight build, 22.10.2026: execution journal

This journal tracks the overnight build. A lead integrator coordinates six workstreams. The journal records what was
actually done and with what evidence. It does not record plans as if they were results.

## Baseline (21.10.2026, 22:00 UTC)

| | |
|---|---|
| Production | `2d48c24`, Vercel Production `kobixrealestate-blktqcnzr` (21:14 UTC) |
| Production evidence | 190/190 acceptance checks (run 39677130339) and 42/42 signed-in checks (run 39681812301) on propx.live and kobix.online |
| Rollback target | `kobixrealestate-armggnbwl` (commit `95dcbef`) |
| Integration branch | `claude/street-report-preview` |
| Identity | `PROPX_IDENTITY` is off. The private Supabase secrets are missing (preflight run 39676017719), so Stage 2 is blocked on the founder. |

## Workstreams

The scaffolding commit is `406f4db`. Each workstream owns its own files.

| | Workstream | Owns |
|---|---|---|
| A | Transactions, prices, authoritative data | Pipeline code, `lib/trust/freshness-audit.js`, `docs/DATA-FRESHNESS-2026-10-22.md` |
| B | Explain Everything | `lib/explain/**`, the ⓘ popover in `index.html`, `scripts/explain-coverage.js` |
| C | Deal Decision Lab | `lib/deal/**`, `#dealLab` |
| D | What Changed Here? | `lib/changes/**`, `#changes` |
| E | UX and product | The CSS, accessibility, launchpad and performance of `index.html` |
| F | QA, security, integration | Independent tests on the integrated candidate |

The scaffolding (`406f4db`) provides:
- Section shells `#changes` and `#dealLab`, with rail entries. Both are wrapped in `live:begin` / `live:end`, so the offline build strips them.
- The events `propx:lang` and `propx:geo`.
- The API routes `view=deal…`, handled by `lib/deal`, and `view=changes…`, handled by `lib/changes`.
- Registry groups and insertion markers for each workstream.
- The script hook for `lib/explain/attach.js`.

## Log

- 22:04 UTC: the scaffolding is committed (`406f4db`). Workstreams A–E have started in isolated worktrees.
- `9ea6df3`: the ALTARIS gate now counts 18 scroll-spy items. The scaffolding's two rail entries had broken it.
- `4056235`: workstream A is merged.
  - **New audit.** `lib/trust/freshness-audit.js` and `docs/DATA-FRESHNESS-2026-10-22.md`.
  - **Fix 1.** The national detector's check record is now read from its run log. Before, `git log` ran in a shallow checkout and answered with the branch head, so unchanged checks went unrecorded.
  - **Fix 2.** The finance lane's check date now reaches the catalogue.
  - **Fix 3.** The coverage audit counts the 304 rows folded into register deals as folded. They were reported as missed.
  - **Fix 4.** The street-geography push places the build on the newest head instead of rebasing binary files.
  - **Fix 5.** The national file's latest date is never a future-dated row. It showed 2048-05-29.
  - **Latest defensible deals.**
    - Register: 17.09.2026 (copy 19.09.2026, STALE).
    - GovMap layer: 28.09.2026 (load 08.10.2026).
    - Union: 28.09.2026.
    - No newer copy exists at either source.
  - **Integrity.** 0 violations over 380,547 events.
- `bc22159`: workstream C, the Deal Decision Lab, is merged.
  - **Code.** `lib/deal/engine.js`, `index.js`, `ui.js`, plus 27 registry terms and 13 rules.
  - **Tests.** 23 unit gates and a 32-check browser journey.
  - **Real result.** הרצל, Petah Tikva: 23 comparables (SUPPORTED), median ₪24,690/m², the asking price at the 52nd percentile.
- `6e7c546`: workstream D, What Changed Here?, is merged.
  - **Code.** `lib/changes/**`, plus 8 terms and 28 rules.
  - **Tests.** 15 unit gates and a 68-check browser journey.
  - **Real results.**
    - Tel Aviv, 365 days: 6,104 new events, equal to the transactions union.
    - Central District, 90 days: 22,028 deals by date and 3,585 older deals first observed in the period.
- Workstream F (QA, security, integration) has started on `6e7c546`.
