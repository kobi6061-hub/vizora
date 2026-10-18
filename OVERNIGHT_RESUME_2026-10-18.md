# PROPX · OVERNIGHT RESUME · 2026-10-18 (final, 05:40 Asia/Jerusalem)

For a fresh Claude instance continuing after the Master Overnight v2 build.

## Where things stand
- Branch `claude/vizora-project-isolation-6lbq3g`; PRODUCTION = `7f26765` (Vercel success, prod-smoke run 39084161192 success).
  Every push deploys Production. Verify a deploy with `gh api repos/kobi6061-hub/vizora/commits/<sha>/status`; dispatch the smoke with
  `gh api -X POST repos/kobi6061-hub/vizora/actions/workflows/prod-smoke.yml/dispatches -f ref=claude/vizora-project-isolation-6lbq3g`.
- Baseline was `ac2632b` (723 tests / 30 suites). Now 35 suites; run `for f in test/*.test.js; do node $f; done`.
- Rules in force: forward only; additive; no Supabase change; no secret in git / page / standalone; ALTARIS economics immutable
  (`altaris/engine.js` hash + `test/fixtures/altaris-baseline.json` frozen); no fabricated data; district never allocated to a city.
- Commit identity: `git config user.email noreply@anthropic.com && git config user.name Claude`; trailers
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01PBPARmvK8bDUqieHNEtZkc`.
- Local QA: `SITE_PASSWORD="$(cat scratchpad/g1/.qa_pw)" SESSION_SECRET=<throwaway> PORT=3801 node scripts/kobix-dev-server.mjs` from the
  session scratchpad (the password file is local only; never print it); rebuild the offline build with `python3 scripts/build-standalone.py`
  after any `index.html` or `lib/explain/registry.js` change, then `node test/integrity.test.js`.

## Shipped tonight (see NIGHT_LEDGER_2026-10-18.md)
1. ALTARIS intelligence → decision loop: `altaris/market-assessment.js` + `POLICY.final` F0–F5 in `altaris/decision.js`; MARKET IMPACT ON
   DECISION section; §72 gates + §73 acceptance set (`test/altaris-market.test.js`, 14 gates); review fixes (final conditions, final verdict in
   portfolio / saved deals, fail-closed freshness).
2. Knowledge graph `lib/graph/` (`view=graph`, `view=graphStats`; 111,523 nodes / 198,397 edges, exact keys only).
3. CBS construction `lib/construction/` — permits · starts · completions · active construction, country + 7 districts; first real sync
   (run 39082195857) landed; WIRED into the dossier, the supply pipeline (nine universes), the Pulse (group construction), the registry and the page.
4. Radar 2.0: 441 localities scanned, signalState SIGNALS / NO_SIGNAL / INSUFFICIENT_DATA with reasons; quiet-pipeline precondition.
5. Dossier history / time machine `lib/dossier/history.js` + nightly workflow; first snapshot `data/dossier/snapshots/2026-10-18.json`.

## Known open items (next session)
- `vercel.json` includeFiles: adding `data/construction/*` or `data/dossier/snapshots/*.json` failed three Vercel builds (no logs from the
  sandbox); the construction payload is bundled through a static `require` in `lib/dossier/query.js` instead. `view=dossierHistory` on
  Production answers NO_SNAPSHOT until the snapshots are bundled (try the glob again now that the directory exists, or the same require
  trick); `data/land/plans.json` is still not bundled (plan nodes incomplete on Vercel — pre-existing).
- The construction workflow now rebuilds the radar; the dossier-snapshot cron (03:17 UTC) runs before the night's syncs commit — consider 05:17.
- Not started: screener, developer universe / public-company financial discovery, infrastructure, demographics, Ask PROPX.
- Page block "what changed since <date>" in `#dossier` once a second snapshot exists (the API is ready).
