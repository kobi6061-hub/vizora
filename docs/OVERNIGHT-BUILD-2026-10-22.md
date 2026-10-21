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
