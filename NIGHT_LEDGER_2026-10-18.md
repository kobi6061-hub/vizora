# PROPX · NIGHT LEDGER · 2026-10-18 (Master Overnight v2)

Baseline accepted and verified at 01:06 Asia/Jerusalem: branch `claude/vizora-project-isolation-6lbq3g`, HEAD = origin = Production
`ac2632b` (Vercel success, prod-smoke 39070318583 success), working tree clean, 723 tests / 30 suites green.
Rules in force: forward only, additive, no Supabase change, no secret, ALTARIS economics immutable, no fabricated data.

Updated 02:55 Asia/Jerusalem: MO-1 (ALTARIS loop) done and QA'd; graph lane reviewed; construction lane finishing its gates.

| LANE | OBJECTIVE | STATUS | SOURCE | LAST SAFE STEP | COMMIT | TESTS | DEPLOYMENT | NEXT STEP | BLOCKER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 Baseline | verify branch / HEAD / status / Production / tests / deploy; freeze outputs | DONE | — | ac2632b verified; BEFORE evidence in `scratchpad/before-*.json` | ac2632b | 723/30 green | ac2632b live | — | — |
| N Night control | ledger + resume files kept current | ACTIVE | — | files created | — | — | — | update after every lane | — |
| M ALTARIS decision loop (P0) | audit market-context ambiguity; Market & Execution Assessment; final decision policy; MARKET IMPACT section; what removes the condition; §72 gates; §73 acceptance set | DONE (pending deploy) | existing PROPX context (dossier, radar, land economics, supply, tx, developer registry) | audit written (altaris/README.md); `altaris/market-assessment.js`; `decision.js` POLICY.final F0–F5; UI card / basis / IC / Excel; registry terms; browser QA he/en × desktop/mobile green; 3 presentation fixes | (this commit) | altaris 96 · decision 38 · market 12 · explain 8 · integrity 33 | — | wire construction / graph context into the assessment once those lanes land | — |
| E CBS starts / completions (P0) | lib/construction + sync + workflow + tests + Trust entry; data via GitHub Actions | IN PROGRESS (agent) | CBS series API 44,2 · 44,3 · 44,4 · 44,11 | lib/construction/{series,resolve,parse,ledger,metrics,snapshot,sync}.js + README + workflow + 33-gate test written; agent fixing the last 3 gates (README wording, Trust entry) | — | construction 30/33 (agent fixing) | — | review → commit → dispatch workflow → verify data → wire into dossier / supply / pulse / trust / ALTARIS | sandbox cannot reach apis.cbs.gov.il (workflow only) |
| A Knowledge graph (P0) | lib/graph read layer + view=graph / graphStats + tests | DONE (reviewed; pending commit) | existing read models (entities, land, renewal + XPlan, rental, geo, DISTRICTS) | agent delivered; reviewed: exact keys only, POSSIBLY_SAME never merged, ambiguous XPlan join = conflict; 111 k nodes / 198 k edges in ≈ 1.6 s | (next commit) | graph 13 · entities 17 · land 35 · renewal 10 | — | registry terms (join coverage / possible match); Trust / drawer surface if time | — |
| R Radar 2.0 | scan over every locality with live tenders | PLANNED | lib/radar/scan.js | — | — | — | — | after M | — |
| T Dossier history / time machine | nightly snapshot of decision-relevant facts + "what changed since" | PLANNED | lib/dossier | — | — | — | — | after R | — |
| S Screener | deterministic filters over dossier index / scan / developers | PLANNED | — | — | — | — | — | if time | — |
| D Developer universe / financials | contractors register + public-company discovery (read-only) | PLANNED | data.gov.il contractors register; TASE/MAYA | — | — | — | — | discovery workflow only | sandbox network |
