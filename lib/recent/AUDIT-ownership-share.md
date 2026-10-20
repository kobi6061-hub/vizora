# Ownership-share audit — recent-only deals (20.10.2026)

**Question.** For a deal the GovMap-layer copy publishes and the register copy does not hold yet, can PROPX tell whether it sold the
WHOLE property, a PARTIAL share, several units for ONE consideration — or nothing can (UNKNOWN)?

**Answer today: UNKNOWN for every recent-only deal.** Nothing PROPX can read states the share for such a deal; the only source that
states it — the register — exists as one copy (18–19.09.2026) whose publisher reports its scraper blocked since. Every recent-only deal
stays at most RECENT_OBSERVED_LIMITED; RECENT_OBSERVED_VERIFIED = 0; no recent price enters a statistic or the Street Value Model.

Evidence: `data/streets/recent/share-audit.json` (`node scripts/recent-share-audit.js`), runner probes
`tx-freshness-discover --share` (run 39418100089) and `--share-history` (run 39418597161). GET only, one request a second; nothing behind
an identification, CAPTCHA or bot screen was touched.

## Sources

| Source | Share stated? | What it is | Verdict |
|---|---|---|---|
| Register copy (over.org.il `/api/deals/*`, `/api/append/<register>/…`) | **Yes** — `portion` ("1.000", "0.500", "0.000" = a share rounded at source) + `portion_fraction`, every row | the Tax Authority register, republished; no deal id; ONE scrape (dataset versions v1–v5, 18.09 10:03 → 19.09.2026 11:20, city by city); per-row `first_seen` all 18–19.09; weekly poll, last 17.10.2026 — no new version. Publisher's log, 13.10.2026: "the scraping of the Tax Authority site is blocked at the moment and the database has not been updated since 19/09/2026" | resolves the share of a deal it HOLDS — only after it holds it; no later copy exists |
| GovMap-layer copy (`/api/deals/govmap/*`) | **No** | 19 fields: `objectid` `deal_id` `deal_date` `deal_date_raw` `deal_amount` `settlement` `street` `house_num` `floor` `asset_area` `rooms` `property_type` `deal_nature` `gush` `parcel` `sub_parcel` `polygon_id` `lon` `lat`; versions v1 08.07 (313,696, partial) · v2 04.08 (1,000,000, capped) · v3 03.10 (2,501,231) · v4 08.10.2026 (2,500,941); full snapshots, not a row archive; no per-deal endpoint | cannot state the share |
| `/api/nadlan/parcel/{gush}/{helka}/deals`, `/deals/mcp` | register rows | the same register rows, served by the same function | not a third source |
| nadlan.gov.il · GovMap API · nadlan.taxes.gov.il · data.gov.il | — | reCAPTCHA Enterprise · CloudFront 403 · identification screen since 29.09.2026 · no transaction dataset | not read, never bypassed |

## Linkages

| Linkage | Verdict |
|---|---|
| transaction id | NONE — the register publishes no deal id |
| block · parcel · sub-parcel | partial key — the layer numbers sub-parcels its own way (1,984 sub-parcel differences); the reconciliation matches the unit or the parcel |
| date | key with a known offset — typed series same day (3,160 / 3,172), untyped `1136…` series one day earlier (30 / 30) |
| amount | a representation, not a key — typed truncated to ₪1,000; a partial sale printed as the share's amount (76), the whole value (184) or neither (41) |
| in-source twin (`1136…`) | duplicate detection only |
| a partial sale printed twice (share + whole) | evidence only through the register deal's portion (16 rows) |
| later register rows | the ONLY resolution (`lib/recent/lifecycle.js`) — none exists |

## Field test — the deals both copies hold

2,934 dwelling deals; 301 (10.3 %) partial sales in the register. A discriminator would be a GovMap field value holding whole-property
sales only (support ≥ 30). **None.** Lowest partial share per permitted field: series `1136…` 3.8 % (132) · floor "קומה 3" 3.2 % (31) ·
in-source twin 5.5 % (1,015) · rooms 4 7.9 % (1,003) · every other field 8.6–10.3 %. Pairs of permitted fields (105 combinations, leaves
≥ 50): no pure leaf. The only pure leaves (std series × the same unit printed ≥ 3 times — 338; std series × 4–5 rows on the parcel that
day — 286 + 54) use the unit's / parcel's ACTIVITY, excluded by rule (activity, price and size are never a basis for the share), and were
found by a search over 105 combinations — a pattern of developer sales of new units, not a stated fact.

## What would change the answer

A newer register copy (the lifecycle confirms then, deal by deal, from the register's own portion) — or any channel that states the share
of a recent deal. Until then the recent layer counts deals (RECORDED TRANSACTION EVENTS) and never uses their prices.
