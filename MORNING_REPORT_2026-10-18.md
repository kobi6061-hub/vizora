# PROPX — MORNING REPORT v2 (Master Overnight v2, 17 → 18.10.2026)

**State at 06:00 Asia/Jerusalem:** Production = `39371bf` (code identical to `7f26765`; the last commit is the ledger + resume). Working tree clean, every push verified on Vercel, Production smoke green on the final code. Full regression: **815 tests / 35 suites, all green** (baseline was 723 / 30).

## 1. WHAT IS FUNDAMENTALLY DIFFERENT THIS MORNING

PROPX no longer stops at describing a market. Three things changed in kind, not degree:

1. **Intelligence now reaches the investment decision through named rules.** Every ALTARIS deal carries three verdicts side by side: the ECONOMIC verdict (unchanged, byte-identical to last night), a MARKET & EXECUTION ASSESSMENT (STRONG / NEUTRAL / CAUTION / INSUFFICIENT), and the FINAL verdict composed by rules F0–F5. A good market never rescues bad economics; a converging set of material negatives turns TAKE into TAKE WITH CONDITIONS, with the condition named and "what would remove it" printed.
2. **PROPX reads official construction for the first time.** Building permits, starts, completions and active construction for Israel and the 7 districts are synced from the CBS API, ledgered with revisions, wired into the dossier, the supply pipeline (nine universes, never summed), the Pulse and the registry. A locality shows its district's figures labelled as such; nothing is allocated to a city.
3. **Every locality with a live tender is now scanned, and silence is a stated finding.** 441 localities (was 40) carry SIGNALS / NO SIGNAL / INSUFFICIENT DATA with a written reason; the knowledge graph connects 111,523 entities through exact keys only; the first nightly dossier snapshot exists, so "what changed since" has a baseline from today.

## 2. SHAs, COMMITS, DEPLOYS, TESTS

| | |
|---|---|
| Starting SHA | `ac2632b` (723 tests / 30 suites) |
| Final SHA | `39371bf` (code = `7f26765`) |
| Production | `39371bf`, Vercel success; prod-smoke runs 39082878920, 39083999880, 39084161192 success |
| Commits | 16 since the baseline: 13 feature / fix, 3 bot (construction sync `18a6974`, dossier snapshot `ac5f0fe`, plus the sync data) |
| Files | 59 changed, +28,776 / −93 (forward-only: nothing removed, no formula changed) |
| Tests | 815 / 35 suites (+92 tests, +5 suites) |
| Deploys verified | `57d03e8`, `3388ca8`, `18a6974`, `118446b`, `bf97056`, `7f26765`, `39371bf` |
| Deploys failed | `c8f69f1`, `fede331`, `f567609` — a `vercel.json` includeFiles change (details in §16) |

Commit list: `2472fd8` ALTARIS loop · `464fc60` knowledge graph · `57d03e8` construction lane · `f14fbcb` Radar 2.0 · `3388ca8` / `26de489` construction rounds 2–3 · `18a6974` real CBS sync (bot) · `118446b` construction wiring · `1830791` review fixes · `c8f69f1` dossier history · `ac5f0fe` first snapshot (bot) · `fede331` / `bf97056` / `f567609` / `7f26765` deploy isolation · `39371bf` ledger.

## 3. KNOWLEDGE GRAPH REPORT

- `lib/graph/` + `GET /api/intel?view=graph&entity=<id>` and `view=graphStats`: 12 entity types with the ids the read models already use; 13 relations, each only where a stored record carries the exact key, each edge with `{ key, value, source }`.
- Scale: **111,523 nodes / 198,397 edges**, built in ≈ 1.6 s, memoised per data stamp.
- Join coverage (numerator / store denominator): tenders located 10,278 / 10,649 · with a parcel 8,578 / 10,649 · with an exact plan reference 7,697 / 10,649 · whose plan XPlan holds 1,110 / 10,649 · re-marketed through the lot file 4,841 / 10,649 · lottery projects with a developer 1,353 / 1,354 · renewal complexes with an exact XPlan edge 766 / 970 · rental notices joined 140 / 142.
- Never an edge: a name match, geometry, an ambiguous XPlan join (1 renewal complex kept as a conflict), district data on a locality. POSSIBLY_SAME = the registry's 908 links over 573 developers, flagged, never merged. 22,997 private-person winners counted, never listed.
- Not yet surfaced in the drawers or the Trust Center (API only).

## 4. DEVELOPER REPORT

Developer Intelligence stayed as shipped last night; tonight added the graph edges (HAS_WINNER / WON / DEVELOPS / POSSIBLY_SAME) and the ALTARIS assessment's "developer not in the PROPX activity registry" informational factor. **Not started:** the contractors register and public-company financial discovery (sandbox network; out of time). Every developer still shows OBSERVED PROPX ACTIVITY only; no financial claim exists anywhere.

## 5. PROJECT REPORT

Project Intelligence 2.0 unchanged. Tonight: project / site / tender / parcel / plan nodes in the graph with their exact joins; the ALTARIS project card reads the FINAL verdict (review fix M2). No project passport page yet.

## 6. CONSTRUCTION REPORT (new tonight)

- Source: CBS time-series API branches 44,11 (permits), 44,2 (starts), 44,3 (completions), 44,4 (active construction). Geography keyed by the CBS code, the NAME verifying the code on every run (level-4 listing of subject 44, 124 nodes over 2 pages; a contradiction between name and code = mismatch, not read). 64 data requests per run; raw responses kept by hash; append-only ledger with revisions; run states SUCCESS / UNCHANGED / PARTIAL / FAILED / REFUSED / SCHEMA_CHANGED.
- Two dry-runs on the runner found the real catalogue shape (named leaves for permits; unnamed leaves for the by-district branches; quarterly time kind = 2 "רבע"); the lane adapted twice, then the real sync landed **4,688 observations** (bot commit `18a6974`).
- Wired: dossier `sections.construction`, supply universes `permits` · `starts` · `activeConstruction`, Pulse group "official construction (CBS)" with NEW / REVISED events (the first ingestion produces none), registry terms `building_permits` · `construction_starts` · `construction_completions` · `active_construction`, Trust Center `cbs:construction` (SUCCESS, CURRENT), the dossier tile and three supply cards. Freshness is quarter-based on a documented reporting-lag assumption (one observed release: Q2-2026 data → series update 2026-09-10).
- Not built: Ministry of Labour active sites, municipal permits, Tel Aviv IView2, the execution-gap signal.

## 7. GEOGRAPHY REPORT

Radar 2.0: `lib/radar/scan.js` scans Israel, the 7 districts and every registry locality with at least one ILA tender in the latest list — 441 localities (was the top 40). States tonight: **SIGNALS 169 · NO SIGNAL 155 · INSUFFICIENT DATA 125**, each with a reason (e.g. "no stored record in the current scope — history only" for 125 localities whose tenders are all older than 24 months). The dossier shows "Radar state (strict geography)" for every geography. Demographics, neighbourhood and infrastructure layers: not started.

## 8. LAND & PLANNING REPORT

Unchanged read models; tonight's additions are the graph's AFFECTS / ON_PARCEL / REFERENCES / RE_MARKETS edges and the dossier history's 12 land facts + the competitive-bid median per snapshot. Land Economics by district (competitive-bid open-market lots, 36 months, nominal ₪ per unit): Tel Aviv district median 1,570,000 over 51 lots (44 % of tenders published in the window failed) · Centre 903,226 over 128 lots (19 %) · North 1,286,099 over 245 lots (17 %) · South 450,770 over 751 lots (29 %) · Jerusalem 290,052 over 28 lots (19 %) · Haifa 256,225 over 118 lots (35 %).

## 9. DEMAND REPORT

Official sales unchanged (national + district series only). New: starts and completions beside them as execution evidence (national starts T12 76,042, −7 % vs the prior 12 months; completions T12 60,970, +7.9 %). The ALTARIS assessment reads the district sales momentum as a DEMAND factor labelled "district", never relabelled as the locality's.

## 10. RENTAL REPORT

Unchanged; the rental notice → tender join is now a graph edge (JOINED_TO, 140 / 142) and the rental track is a supply universe as before. No rent, yield or occupancy estimated anywhere.

## 11. INFRASTRUCTURE REPORT

Not started. Nothing on the page claims infrastructure context.

## 12. LOCATION REPORT

Not started beyond the geography registry already in place.

## 13. DEVELOPER FINANCIAL REPORT

Not started. No public-company statement, rating or financial figure exists in PROPX; nothing says otherwise.

## 14. MACRO REPORT

Unchanged inputs (Bank of Israel rate, CBS indices). The construction-inputs index (+3.6 % y/y) is a MACRO factor in the ALTARIS assessment, national scope, informational by rule.

## 15. NEW PRODUCT REPORT

- **Dossier history / time machine**: `lib/dossier/history.js`, 43 stable facts per geography with value · class · source · period; append-only daily file; `diff()` with NEW · CHANGED · REMOVED · STATE and the radar verbs; `view=dossierHistory&city=|district=&since=` and `view=dossierSnapshots`; nightly workflow (03:17 UTC). First snapshot: 449 geographies, 325 KB, committed by the workflow (`data/dossier/snapshots/2026-10-18.json`). On Vercel the view answers NO_SNAPSHOT until the file is bundled (see §16).
- Screener, Ask PROPX, Search 3.0, map: not started.

## 16. ALTARIS REPORT

- **Contradiction audit (BEFORE evidence in `altaris/README.md`).** The market reached ALTARIS by three paths while the page said "read-only": the decision layer's documented market factor group (weight 10) and evidence deductions; display-only dossier / radar / narrative; the engine's exit-liquidity component of the explained risk score (±5 / −10). None was changed.
- **Assessment layer** `altaris/market-assessment.js` (`altaris-market-assessment-v1`): nine dimensions (demand · supply · land market · transaction liquidity · execution · developer · macro · data quality · rental); every factor value · comparison · period · source · class · rule · scope · material? · impact. Material only with a direction, class OFFICIAL / OBSERVED, evidence HIGH / MEDIUM, own locality or district, read ≤ 30 days, materiality ≥ 2. CAUTION = ≥ 2 material negatives from ≥ 2 independent source families; STRONG = 2 material positives, none negative; NEUTRAL otherwise; INSUFFICIENT without dossier + radar.
- **Final policy** F0–F5: no / INSUFFICIENT assessment → economic stands; PASS → PASS; TAKE + CAUTION → TAKE WITH CONDITIONS with the market condition and what would remove it; TWC + CAUTION adds the condition; STRONG / NEUTRAL → unchanged; never an upgrade.
- **UI**: ECONOMIC · MARKET / EXECUTION · FINAL on the card and basis head; "MARKET IMPACT ON DECISION" section (he RTL / en LTR); IC rows; Excel / CSV rows; the portfolio, saved list and version compare print the FINAL verdict.
- **Zero regression**: engine hash and frozen baseline unchanged; IRR, MOIC, cash flows, capital at risk and the economic verdict byte-identical with and without the assessment (gated). BEFORE / AFTER economics for the five cases: park-18 TAKE 83 · hanassi-42 PASS 79 · ganei-hapark TWC 61 · hagefen-renewal TWC 58 · coastal-portfolio-i PASS 75 — identical.
- **Acceptance set (§73)**, 5 cases × none / STRONG / CAUTION: park-18 TAKE → TAKE (F0) / TAKE (F5) / TAKE WITH CONDITIONS (F3); hanassi-42 PASS → PASS (F0 / F2 / F2); ganei-hapark TWC → TWC (F0 / F5 / F4 + condition); hagefen-renewal the same; coastal-portfolio-i PASS → PASS. Written to `test/fixtures/altaris-acceptance-2026-10-18.json`.
- **Independent review** (14 findings) fixed in `1830791`: final conditions in the conditions section and Excel; final verdict in portfolio / saved deals; fail-closed freshness (undated, future or missing reference date is not fresh); transaction depth fresh by the page's retrievedAt; unmapped radar rule informational; FAMILY_OF anchored; honest NO SIGNAL reasons; docs corrected (nine dimensions, the "read-only" sentence).

## 17. SOURCE REPORT

Trust Center now lists `cbs:construction` with its first SUCCESS run. Deploy incident: adding `data/construction/*` (or the then-empty `data/dossier/snapshots/*.json` glob) to the intel function's includeFiles failed three Vercel builds; Vercel logs are not reachable from the sandbox. Resolved by restoring the last-good include list and bundling the construction payload through a static `require` in `lib/dossier/query.js` (deploy + smoke green). Still not bundled on Vercel: the dossier snapshots and `data/land/plans.json` (plan nodes incomplete there, pre-existing).

## 18. QUALITY REPORT

- Tests 815 / 35 suites; new suites: `altaris-market` (14), `graph` (13), `construction` (38), `construction-wiring` (9), `dossier-history` (15); extended: `scan` (+3), `supply`, `altaris-decision`, `explain`.
- Browser QA (Playwright, he / en × desktop / phone × light / dark): ALTARIS card, basis section, IC; Pulse scope line and NO SIGNAL popover; dossier radar-state line; construction tile and supply cards; no page errors, no horizontal overflow.
- Two independent review passes (one adversarial reviewer agent on the ALTARIS loop + Radar 2.0; the construction lane reviewed twice against real runner output).
- One correctness fix with BEFORE evidence: 297 of 400 indexed localities carried the "quiet pipeline" risk with as little as one old tender; the rule now needs ≥ 3 stored records (text, threshold, materiality unchanged; the precondition printed in the signal).

## 19. REAL EXAMPLES

**10 cities (Radar 2.0 state · opportunities / risks · stored records):** Kiryat Gat SIGNALS 6 / 1 (82; 33 current tenders, 1,040 units open, 4,573 awarded, 8 renewal complexes) · Tel Aviv-Yafo SIGNALS 5 / 1 (195; 130 tenders, 7,468 units awarded, 55 complexes, competitive-bid median ₪1,706,650 per unit) · Jerusalem SIGNALS 4 / 1 (320; 5,122 units open, 213 complexes, 73,808 proposed units) · Be'er Sheva SIGNALS 4 / 1 (85) · Ashkelon SIGNALS 4 / 1 (141) · Be'er Ya'akov SIGNALS 4 / 1 (41) · Ramla SIGNALS 3 / 1 (53) · Netanya SIGNALS 4 / 0 (82) · Sderot SIGNALS 4 / 0 (53) · Ashdod SIGNALS 3 / 1 (46). Modi'in-Makkabbim-Re'ut: NO SIGNAL, 43 stored records, "the data is there and no documented threshold was crossed". Yad Binyamin: INSUFFICIENT DATA, 19 tenders in the latest list, 0 in the current scope, "history only".

**10 developers (observed ILA activity, lots won · residential units):** Keren Paz 78 · 452 (last 2011) · Y.H. Dimri 75 · 5,836 (2026-08) · Rami Shbiro 70 · 8,366 (2025-12) · Amram Avraham 61 · 9,131 (2026-04) · Dona 51 · 7,656 (2022-07) · Ahim Ozen 41 · 2,300 (2025-01) · Yossi Avrahami 39 · 1,116 (2025-06) · Ahim Buskila 36 · 3,372 (2025-12) · Reisdor 34 · 5,361 (2026-09) · Asom 26 · 1,568 (2019-12).

**10 tenders:** awarded in 2026 — 311/2025 Sderot 2,868 units, subsidized, 22 winners (decided 2026-08-05) · 5/2026 Nof HaGalil 1,670 units open-market (2026-01-28) · 80/2026 Nof HaGalil 1,093 (2026-05-03) · 478/2025 Dimona 1,093 subsidized, 4 winners (2026-02-02) · 156/2026 Ofakim 1,002 (2026-08-05) · 508/2025 Afula 846 subsidized (2026-01-26); open now — 488/2025 Ashkelon 3,972 units (closes 2026-11-30) · 152/2026 Be'er Ya'akov 2,409 (2026-11-16) · 336/2025 Netivot 2,292 (2026-12-07) · 460/2025 Ma'ale Adumim 2,167 (2026-12-21).

**5 construction (CBS, to June 2026, CURRENT):** Israel starts 6,273 in June, T12 76,042 (−7 %), permits T12 83,338 (+2 %), completions T12 60,970 (+7.9 %), active construction 217,237 dwellings at Q2-2026 (+7.7 % y/y) · Tel Aviv district starts T12 17,396 (+9.8 %), active 54,501 · Central district starts T12 19,237 (−4.5 %), active 52,129 · Jerusalem district starts T12 6,357 (−36.2 %), active 26,337 · Haifa district active 20,782 (+20.7 % y/y). National vs district sums reconcile to ±1 per month.

**5 land:** the six district medians in §8.

**5 infrastructure / 5 public-developer financial / 5 Ask PROPX:** none — those lanes were not built; no example is claimed.

**5 ALTARIS:** the acceptance rows in §16 (park-18 under CAUTION is the one deal whose verdict moves, TAKE → TAKE WITH CONDITIONS by F3, condition "district sales momentum −10.5 % + failed tenders 44 %", removed when either factor falls below its threshold).

## 20. TOP 30 CAPABILITIES NOW LIVE

1 final-verdict composition F0–F5 · 2 Market & Execution Assessment with nine dimensions · 3 "what would remove the condition" · 4 MARKET IMPACT ON DECISION section · 5 final verdict in portfolio / saved / compare · 6 CBS permits sync · 7 starts · 8 completions · 9 active construction (quarterly stock) · 10 construction revisions ledger · 11 quarter-based freshness with a stated lag assumption · 12 national-vs-district reconciliation · 13 dossier construction section · 14 nine supply universes · 15 district context on a locality, never allocated · 16 Pulse construction events · 17 four construction registry terms · 18 Radar 2.0 over 441 localities · 19 NO SIGNAL as a counted state · 20 INSUFFICIENT DATA with its reason · 21 quiet-pipeline precondition · 22 dossier radar-state line · 23 knowledge graph API · 24 graph stats with coverage and conflicts · 25 POSSIBLY_SAME never merged · 26 nightly dossier snapshots · 27 "what changed since" diff API · 28 construction workflow rebuilding the radar · 29 fail-closed freshness in the assessment · 30 acceptance set as a fixture.

## 21. TOP 30 FACTS LEARNED

1 Israel: 76,042 dwelling starts in the 12 months to June 2026, −7 % · 2 completions 60,970, +7.9 % · 3 permits 83,338, +2 % · 4 217,237 dwellings under construction at Q2-2026, +7.7 % · 5 Tel Aviv district starts +9.8 % · 6 Jerusalem district starts −36.2 % · 7 Haifa district active construction +20.7 % · 8 Judea and Samaria active −12.5 % · 9 CBS quarterly time kind is 2 "רבע" (the discovery ledger's "4" never existed) · 10 CBS by-district branches list only unnamed leaves (k,2) with separator rows 4141 · 11 permits total node is "סך כולל", not "סך הכל" · 12 125 of 441 scanned localities have no record in the current 24-month scope · 13 101 NO SIGNAL localities have fewer than 3 stored records · 14 Tel Aviv district: 44 % of tenders published in the window failed · 15 Centre median ₪903,226 per unit over 128 lots · 16 South 751 competitive-bid lots, median ₪450,770 · 17 graph: 72 % of live tenders carry an exact plan reference, XPlan holds 10 % · 18 4,841 tenders are on a re-marketing chain · 19 908 possible-same developer links · 20 one ambiguous renewal XPlan join · 21 Sderot 311/2025: 2,868 units, 22 winners · 22 Ashkelon 488/2025: 3,972 units open · 23 first dossier snapshot 449 geographies, 325 KB · 24 ALTARIS: only TAKE + CAUTION moves a verdict · 25 park-18 is the only acceptance case that moves · 26 the engine's exit-liquidity component was already reading the deal count · 27 Vercel rejects an includeFiles glob with no match (observed, not logged) · 28 a static require bundles data the glob would not · 29 Kiryat Gat has 6 opportunity items, the most of any locality · 30 Jerusalem has 213 renewal complexes with 73,808 proposed units.

## 22. TOP 20 QUESTIONS PROPX CAN ANSWER THIS MORNING

How many dwellings started in my district in the last 12 months, and is that up or down · how many are under construction right now · does the market change this deal's verdict, and through which rule · what would remove the market condition · which localities are quiet because untracked vs quiet with a pipeline · which localities carry no signal at all · what is the competitive-bid land median in a district and how many lots back it · what share of a district's tenders failed · which tenders re-market the same lot file · which plan a tender rests on and whether XPlan holds it · which developers are possibly the same entity · what changed in a geography since a date (from tomorrow) · what the dossier looked like today (frozen) · which supply universes exist for a locality without summing them · which construction figure is the district's, not the city's · how fresh the construction series is and why · what the Pulse will say when CBS publishes July · how many entities and edges PROPX holds and how well they join · which sources the Trust Center shows as current · what the final verdict is across a saved portfolio.

## 23. TOP 20 NEXT STEPS

1 bundle `data/dossier/snapshots` on Vercel (glob or require) · 2 bundle `data/land/plans.json` · 3 page block "what changed since" once a second snapshot exists · 4 move the snapshot cron after the night's syncs · 5 screener over scan states · 6 graph edges in the entity drawers + graph stats in the Trust Center · 7 registry terms for join coverage / possible match · 8 construction factors in the ALTARIS assessment (district starts momentum, informational) · 9 execution-gap signal with "NO LATER PUBLIC EVIDENCE FOUND" · 10 developer universe from the contractors register · 11 public-company financial discovery (read-only) · 12 Ministry of Labour active sites discovery · 13 municipal permits architecture · 14 demographics (Census 2022) · 15 infrastructure layer · 16 Ask PROPX grounded on the registry · 17 Search 3.0 · 18 mutation tests on the decision rules · 19 verify the construction section on Production with an authenticated check · 20 retention policy for snapshots (≈ 325 KB per day).

## 24. TOP 20 DATA GAPS

City-level construction · locality sales series · permits by project · occupancy · actual rents · developer financials · active sites register · municipal permits · infrastructure · demographics · population per locality in the dossier · plan geometry on Vercel · construction raw quarterly strings (now stored, not yet audited) · the CBS release calendar (assumed lag) · a second snapshot (diff needs two) · project-level starts · developer equity / debt · land all-in cost · transaction depth for small localities · neighbourhood layer.

## 25. TOP 10 RISKS

1 Vercel bundle limits and the unexplained includeFiles failure · 2 the reporting-lag assumption resting on one observed release · 3 quarterly TimePeriod convention not yet read raw (the parser fails closed) · 4 snapshot growth · 5 `scan.json` rebuilt by every sync (16 s each) · 6 stored-record counts mix current-scope tenders with all-dated complexes and lotteries (now labelled) · 7 the graph's AFFECTS edge rests on one lot file carrying both keys · 8 ALTARIS assessment depends on the page loading the market context · 9 the acceptance fixture rewritten on every test run · 10 the construction workflow commits radar files too (merge order with other syncs).

## 26. FINAL CHECK LIST

Branch = Production = `39371bf` · 815 / 35 green · standalone rebuilt and integrity green · ledger `NIGHT_LEDGER_2026-10-18.md` and resume `OVERNIGHT_RESUME_2026-10-18.md` current · no secret anywhere · no Supabase change · engine hash + baseline frozen · no formula changed · nothing deleted.

## 27. FINAL PRINCIPLE

Every number on the page this morning says where it came from, what it is not, and when it was last checked. Where PROPX does not know, it says so in words, never with a zero.
