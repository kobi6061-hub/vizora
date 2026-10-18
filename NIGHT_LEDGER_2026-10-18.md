# PROPX · NIGHT LEDGER · 2026-10-18 (Master Overnight v2)

Baseline accepted and verified at 01:06 Asia/Jerusalem: branch `claude/vizora-project-isolation-6lbq3g`, HEAD = origin = Production
`ac2632b` (Vercel success, prod-smoke 39070318583 success), working tree clean, 723 tests / 30 suites green.
Rules in force: forward only, additive, no Supabase change, no secret, ALTARIS economics immutable, no fabricated data.

Updated 03:35 Asia/Jerusalem: 57d03e8 live + smoke green (ALTARIS loop · graph · construction lane 1); Radar 2.0 + construction round 2 committed next.

| LANE | OBJECTIVE | STATUS | SOURCE | LAST SAFE STEP | COMMIT | TESTS | DEPLOYMENT | NEXT STEP | BLOCKER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 Baseline | verify branch / HEAD / status / Production / tests / deploy; freeze outputs | DONE | — | ac2632b verified; BEFORE evidence in `scratchpad/before-*.json` | ac2632b | 723/30 green | ac2632b live | — | — |
| N Night control | ledger + resume files kept current | ACTIVE | — | files created | — | — | — | update after every lane | — |
| M ALTARIS decision loop (P0) | audit market-context ambiguity; Market & Execution Assessment; final decision policy; MARKET IMPACT section; what removes the condition; §72 gates; §73 acceptance set | DONE | existing PROPX context (dossier, radar, land economics, supply, tx, developer registry) | audit in altaris/README.md; market-assessment.js; POLICY.final F0–F5; UI card / basis / IC / Excel; registry terms; browser QA green | 2472fd8 | altaris 96 · decision 38 · market 12 · explain 8 | 57d03e8 live (Vercel success, prod-smoke 39080775035 success) | wire construction / graph context into the assessment once those lanes land | — |
| E CBS starts / completions (P0) | lib/construction + sync + workflow + tests + Trust entry; data via GitHub Actions | IN PROGRESS (round 2 committed; dry-run 2 pending) | CBS series API 44,11,2 · 44,2,3 · 44,3,3 · 44,4,3 | dry-run 1 (run 39080649194): permits 7 districts read (+952 obs), total named "סך כולל"; by-district branches list only leaves → resolver now takes names from the level-4 listing or the response path (GeoNameError = mismatch); 37 gates | 57d03e8 + (this commit) | construction 37 · cbs-sales 25 · integrity 33 | — | dispatch dry-run 2 → sync → verify data → wire into dossier / supply / pulse / trust / ALTARIS | sandbox cannot reach apis.cbs.gov.il (workflow only) |
| A Knowledge graph (P0) | lib/graph read layer + view=graph / graphStats + tests | DONE | existing read models | reviewed + committed; 111 k nodes / 198 k edges | 464fc60 | graph 13 | 57d03e8 live | registry terms (join coverage / possible match); Trust / drawer surface if time | — |
| R Radar 2.0 | scan over every locality with live tenders; explicit NO SIGNAL / INSUFFICIENT DATA; quiet-pipeline precondition | DONE (pending deploy) | lib/radar/scan.js · lib/dossier/query.js | 441 localities (was 40); states SIGNALS 169 · NO_SIGNAL 155 · INSUFFICIENT_DATA 125; `no-recent-changes` needs ≥ 3 tracked records (BEFORE 297/400 flagged); Pulse scope line + dossier state line; browser QA he/en green | (this commit) | scan 14 · dossier 14 · radar 14 · narrative 13 · explain 8 · integrity 33 | — | — | — |
| T Dossier history / time machine | nightly snapshot of decision-relevant facts + "what changed since" | PLANNED | lib/dossier | — | — | — | — | after R | — |
| S Screener | deterministic filters over dossier index / scan / developers | PLANNED | — | — | — | — | — | if time | — |
| D Developer universe / financials | contractors register + public-company discovery (read-only) | PLANNED | data.gov.il contractors register; TASE/MAYA | — | — | — | — | discovery workflow only | sandbox network |
