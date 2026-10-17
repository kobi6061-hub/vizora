# PROPX · OVERNIGHT RESUME · 2026-10-18

For a fresh Claude instance continuing the Master Overnight v2 build without this conversation.

## Where things stand
- Branch `claude/vizora-project-isolation-6lbq3g`; every push deploys Production (Vercel). Verify a deploy with
  `gh api repos/kobi6061-hub/vizora/commits/<sha>/status` and the smoke with
  `gh api -X POST repos/kobi6061-hub/vizora/actions/workflows/prod-smoke.yml/dispatches -f ref=claude/vizora-project-isolation-6lbq3g`.
- Accepted baseline: `ac2632b` (723 tests / 30 suites). Run the suite with `for f in test/*.test.js; do node $f; done`.
- Rules: forward only; additive; no Supabase change; no secret in git / page / standalone; ALTARIS economics immutable
  (`altaris/engine.js` hash + `test/fixtures/altaris-baseline.json` frozen); no fabricated data; district never allocated to a city.
- Commit identity: `git config user.email noreply@anthropic.com && git config user.name Claude`; commit trailers:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01PBPARmvK8bDUqieHNEtZkc`.
- Local QA: `cd scratchpad/g1 && SITE_PASSWORD="$(cat .qa_pw)" SESSION_SECRET=<throwaway> PORT=3801 node scripts/kobix-dev-server.mjs`
  (the password file is local only; never print it); Playwright scripts `qa*.mjs` in the session scratchpad; rebuild the
  offline build with `python3 scripts/build-standalone.py` after any `index.html` change, then `node test/integrity.test.js`.

## Lanes (see NIGHT_LEDGER_2026-10-18.md for status)
1. ALTARIS intelligence → decision loop (P0): `altaris/market-assessment.js` (deterministic Market & Execution Assessment over
   the PROPX context the page already holds), `altaris/decision.js` composes the FINAL verdict = economics + market/execution +
   evidence + fund gates through documented rules only (a good market never rescues bad economics; CAUTION turns TAKE into TAKE
   WITH CONDITIONS with a named market condition and what would remove it); UI section "MARKET IMPACT ON DECISION" and IC lines;
   gates in `test/altaris-market.test.js` (§72) + acceptance set (§73).
2. CBS starts / completions (P0): `lib/construction/` + `scripts/construction-sync.js` + `.github/workflows/construction-sync.yml`
   + `test/construction.test.js`; data is fetched by the workflow (dispatch it; the sandbox cannot reach CBS). After data lands:
   wire `data/construction/latest.json` into the dossier, the supply pipeline, the Pulse and the ALTARIS context.
3. Knowledge graph (P0): `lib/graph/` + `view=graph` / `view=graphStats` + `test/graph.test.js`; then surface in drawers.
4. Radar 2.0: `scripts/radar-build.js` localities → every locality with live tenders.
5. Dossier history: nightly snapshot of decision-relevant facts + "what changed since".
6. Screener, developer universe / financial discovery (read-only workflows), as time allows.

## Convergence (06:45–07:00 Asia/Jerusalem)
Stop starting lanes; finish safe work; full regression; browser QA (he/en × desktop/mobile × light/dark); rebuild standalone;
commit; push; verify deploy + smoke; update this file and the ledger; write the morning report.
