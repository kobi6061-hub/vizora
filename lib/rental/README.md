# PROPX · long-term rental — what the official sources say, kept apart

Audit 14.10.2026. PROPX's long-term rental intelligence lives in the land section (`#land`, shown with the rental
track) and in the tender drawer. It keeps five things apart, each with its own source and dates — and estimates none
of the things no source publishes (a project's rent, a yield, occupancy).

| Layer | Source | Class | What it is — and is not |
| --- | --- | --- | --- |
| PIPELINE | Israel Land Authority tender site (`lib/land`) | OFFICIAL | tenders on the rental track: tender type 6 "דיור להשכרה" or purpose 20 / 21 (`lib/land/codes.js trackOf`). Their `YechidotDiur` is the **tender's total units** — never "long-term rental units": a rental-track tender may also sell units |
| TERMS | Dira Lehaskir — the Government Company for Housing and Rental (`lib/rental/dira.js`) | OFFICIAL (CMS_PUBLIC_API) | the company's own notice for the same tender: total units, **long-term rental units**, units for sale, the rental period — only where the notice writes them out |
| PLANNING SITES | the same company | OFFICIAL (CMS_PUBLIC_API) | sites it promotes in planning before any tender; no plan number is published → never joined to XPlan |
| PROJECTS | the same company | OFFICIAL_PAGE_ONLY | project-status counts (its own taxonomy: in construction / apartments available / occupied) and the public project pages — no per-project fields |
| MARKET | CBS — the rent component of the CPI (`data/market`, series 120460) | OFFICIAL · GENERAL RENT MARKET BENCHMARK | private, public and regulated long-term rentals, national, an index — never a project's rent, never "institutional" or Dira Lehaskir rent, never a city rent, never a level in ₪ |

## The Dira Lehaskir source (verified on a GitHub runner, 13.10.2026)

The company's official website is **www.renten.co.il** (`aprent.co.il` — the address Wikipedia and Wikidata list —
redirects there). It is WordPress; its public REST API (`/wp-json/wp/v2/…`) answers any client and `robots.txt`
allows every path. Read with `GET` only, one request at a time, an honest User-Agent (`scripts/rental-discover.js`
`--wiki` / `--site` / `--wp`, runs 38472683060, 38473430920, 38474108973; `scripts/rental-sync.js --dry-run`).

| Content | Endpoint | Records | Notes |
| --- | --- | --- | --- |
| `michraz` "מכרזי יזמים" | `wp/v2/michraz` | 230 notices · 141 developer tenders | the same type also holds services procurement (engineering control, consulting) — counted, never treated as tenders. Status: taxonomy `tax_status_et` (open 23 / closed 120) |
| `planning` "קידום תכנון" | `wp/v2/planning` | 45 sites | status: taxonomy `statuss` (approved plan 22 · statutory 14 · in planning 9) |
| projects | `project-sitemap.xml` | 93 pages | the type is not exposed by the REST API → OFFICIAL_PAGE_ONLY. Status counts: taxonomy `tax_status` (in construction 59 · available 6 · occupied 26) |

**The join** — a developer notice prints the tender number as the ILA does, with the region prefix:
`ים/137/2026`. The Authority's `MichrazID` is `year × 10000 + number` (`20260137`), so the join is exact on the
official number. A different total-unit figure is shown beside the ILA one; neither is overwritten.

**The terms are explicit only** (`rentalTerms`): a number is read only from a recognised phrasing, and the words it
came from are kept (`evidence`). Recognised: "הכולל 234 יח"ד", "(סה"כ 246 דירות)", "מתוכן / מתוכם 67 יח"ד למטרת
השכרה…", "למטרת השכרה לטווח ארוך (186 יח"ד) ולמכירה (62 יח"ד)", "338 יח"ד להשכרה למשך 20 שנים ו–112 יח"ד
למכירה", "…לבניה רוויה, למטרת השכרה לטווח ארוך" (all rental), a whole project described as rental with no units for
sale ("project-rental"), "השכרה לצמיתות" (permanent), "(כ-50 יח"ד*)" (approximate). The rental period is never the
lease term ("חוזה חכירה … 98 שנים"). A population-reserved rental ("600 יח"ד להשכרה לסגל רפואי") is its own
category. Several different rental figures in one notice (one per compound) → no single number. A contradiction
(rental + sale > total; an "all rental" phrase beside units for sale) → the field stays empty and the notice is marked.

## What the 87 means (the rental track, current scope, 14.10.2026)

87 = the ILA tenders on the rental track that are still in play or were decided within the last 24 months (the land
section's default "current" scope); 171 over the whole source. Their 15,365 units are the tenders' **total** units.
Dira Lehaskir published a notice for 70 of the 87; 68 state the rental units. Over the 56 tenders that carry both the
ILA figure and a stated rental figure: 14,244 total units → **10,593 long-term rental units (74%)**, 2,870 units for
sale stated in 28 tenders, 600 units reserved for medical staff. Rental periods: 15 years × 30, 20 × 26, 10 × 5, 25 × 1;
2 permanent.

## Files

| File | Role |
| --- | --- |
| `dira.js` | the source, the explicit-terms parser, normalization, the GET-only reader |
| `query.js` | the read model (`GET /api/land?view=rental`, the tender drawer's `dira` block) |
| `scripts/rental-sync.js` | the sync: upsert on the notice id (never deleted), every changed field in `history.jsonl`, raw responses per content hash |
| `.github/workflows/rental-sync.yml` | every working day 05:41 UTC; dispatch modes sync / dry-run |
| `scripts/rental-discover.js` + `.github/workflows/rental-discover.yml` | read-only discovery (Wikipedia / Wikidata, a site's robots.txt + sitemap + public CMS endpoints, data.gov.il, the CBS index and time-series catalogues) |
| `data/rental/` | `dira-tenders.json`, `dira-planning.json`, `dira-projects.json`, `dira-terms.json`, `history.jsonl`, `raw/`, `runs.jsonl` — bot-written |
| `test/rental.test.js` | the gates |

## Not found / not ingested

- **CBS average rent in ₪** (by district, city, rooms): not in the CBS price-index API (13 chapters; the only rent
  series is the CPI rent component 120460) nor in the time-series catalogue (38 subjects; only "rent tribunals"
  matched) — runs 38474113942, 38476328680. Trust Center: `cbs:average-rent`, NOT_MACHINE_READABLE.
- A project's rent, occupancy, operator or reduced-rent allocation as data — the company publishes none; a notice's
  sentence about a reduced / regulated rent share is quoted as text (a percentage only when written "N% מהדירות").
- Permits, completion, occupancy per tender — no source joined: those stages show "—".
