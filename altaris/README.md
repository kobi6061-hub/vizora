# ALTARIS — Capital Allocation Engine (מנוע חיתום והקצאת הון)

An isolated institutional underwriting module inside PROPX. For one residential
opportunity it compares three forms of capital — **BUY** (רכישה), **FINANCE** (מימון
מובטח) and **HYBRID** (מבנה משולב) — and answers five questions:

1. What is the real supported value?
2. How much capital is ALTARIS risking?
3. What can ALTARIS earn?
4. What happens if the expected exit does not happen?
5. Is BUY, FINANCE or HYBRID the best use of capital?

## Isolation (what this module touches in PROPX)

| PROPX file | Change | Why |
|---|---|---|
| `index.html` | one `<a class="ri">` in the rail, after "קרקעות" | the navigation item the brief asks for; no existing item moves, changes or resizes; the scroll-spy reads only `.ri[data-sec]`, which this link does not carry |
| `standalone/` | rebuilt from `index.html` | the offline build hides the link (no server offline) |
| `scripts/build-standalone.py` | one CSS selector added to the offline-only hide rule | an offline file has no `/altaris` route |
| `vercel.json` | a `rewrites` entry `/altaris → /altaris/index.html` + no-store headers for the page | the route; nothing else is rewritten |
| `scripts/kobix-dev-server.mjs` | the same rewrite + `.css`/`.svg` MIME | local QA parity with Vercel |

Nothing else in PROPX changes: no PROPX calculation, data flow, API, middleware, test or
style. `middleware.js` already gates every path, so `/altaris` and its assets sit behind
the same session gate as the rest of PROPX.

**Read-only data.** ALTARIS only issues `GET` requests to existing PROPX endpoints and
never writes to them:

| Source | Used for | Label on the page |
|---|---|---|
| `/api/geo/search` | locality / street picker (canonical CBS codes) | official registry |
| `/api/gov/transactions` | median ₪/m² of residential deals in the locality / street, comparable deals | "רשומות רשות המסים · באמצעות גרסאות לעם — פרסום עצמאי, לא ערוץ ממשלתי" + count + date range (DERIVED) |
| `/data/market/latest.js` | Bank of Israel rate, CBS new-homes index (reference next to rate inputs) | official, dated |
| `/api/land?view=summary` | state-land tender supply in the locality; observed public tender wins of the developer (exact name) | state land only, scope stated |
| `/api/housing?view=summary` | subsidized-housing lotteries in the locality | official lottery records |

A pre-filled value is a suggestion with its basis; the underwriting value is always an
explicit choice, and every valuation input can be overridden with a note. The developer's
list price is never assumed to be market value.

**Storage.** Deals, versions and fund settings are kept in this browser
(`localStorage`, keys `altaris:*`); a deal can be exported as JSON and imported elsewhere.
The only PROPX key ALTARIS reads and writes is the shared theme preference
(`kobix:theme`), so both pages keep one look. There is no server-side ALTARIS store yet.

## Files

| File | Role |
|---|---|
| `altaris/index.html` | page shell (PROPX header + rail, ALTARIS modes) |
| `altaris/altaris.css` | PROPX tokens (copied, not shared — the PROPX page is untouched) + module styles |
| `altaris/engine.js` | the calculation engine: pure functions, no DOM, loadable in Node (`test/altaris.test.js`) |
| `altaris/app.js` | UI: inputs, live underwriting ledger, compare, stress, portfolio, saved deals, settings |
| `altaris/charts.js` | inline-SVG institutional charts with hover tooltips and table twins |
| `altaris/export.js` | CSV, XLSX (dependency-free writer), print-to-PDF views, JSON import/export |

## Calculation rules

* Every strategy is a dated monthly cash-flow series from ALTARIS' side (T0 = the deal's
  funding date). IRR is XIRR over the actual dates (Actual/365); MOIC = total distributions ÷
  total invested capital; capital required = the peak cumulative outflow.
* Market value, purchase price, investment basis, capital invested, debt, profit and cash
  returned are separate fields and are never substituted for each other.
* BUY profit is the true underwriting result: supported value − exit haircut − purchase
  price − purchase tax − transaction costs − financing − holding costs + rental carry −
  exit costs. The engine asserts that the bridge equals the cash-flow sum.
* Taxes are editable underwriting assumptions, never conclusions. Headline returns are
  before profit taxes; after-tax lines appear when tax inputs are entered.
* Scenarios (downside / base / upside) change assumptions independently; stress presets
  overlay the base case. FINANCE and HYBRID run a repayment-capacity waterfall: a borrower
  repays in full when realization covers the claim; otherwise ALTARIS receives what the
  collateral yields (and, under default, after an enforcement period and costs).
* The risk score is eight explained components (piecewise-linear maps over stated
  inputs), weighted by the fund settings. The structure signal applies the fund hurdles,
  ranks eligible structures by a stated risk-adjusted return
  ((1 − w)·base IRR + w·downside IRR) and always says why.
* Every default is labelled as an assumption until edited.

## Design notes

**Subject.** An underwriting terminal for ALTARIS' investment team: enter one residential
deal once and see, in seconds, which form of capital to use and what happens if the exit
fails.

**Palette.** PROPX's own tokens, unchanged: paper `#f3f5f9` / panel `#ffffff` / ink
`#101b30` / navy `#12294f` / accent `#2563eb` (interaction) / brass `#a4791c` (the single
ALTARIS accent: the wordmark rule and the signal line); dark: `#0b1322` / `#121d34` /
`#eef2fa` / `#8fb1e8` / `#3b82f6` / `#d4af37`. Strategy series (validated with the dataviz
palette checker, light on `#ffffff`, dark on `#121d34` and `#0b1322`): BUY `#2563eb`/`#3b82f6`,
FINANCE `#eb6834`/`#d2693a`, HYBRID `#1baf7a`/`#22a87a` (the light green is below 3:1, so
every strategy mark carries a text label and every chart a table twin).

**Type.** PROPX's pairing: Heebo for headings and key figures, Assistant for body and
inputs; Montserrat 300 with wide tracking only for the ALTARIS wordmark, mirroring the
PROPX wordmark. Tabular figures only in ledgers and tables.

**Layout.** "Ledger and verdict": the underwriting workflow (deal → value → structure →
stress → decision) runs down the main column; a sticky ledger on the right answers the
five questions live. Below 1100px the ledger becomes a compact bottom card that expands.

```
PROPX header ───────────────────────────────────────────────┐ rail
ALTARIS · מנוע חיתום והקצאת הון            [הגדרות קרן]      │  ▢
[עסקה חדשה] [השוואת מבנים] [פורטפוליו] [עסקאות שמורות]       │  ▢
1 עסקה › 2 שווי › 3 מבנה › 4 לחץ › 5 החלטה                    │  ▢
┌ main ─────────────────────────────┐ ┌ ledger (sticky) ──┐ │  ▢
│ 1 פרטי העסקה · יחידות · סה״כ       │ │ 1 שווי נתמך       │ │
│ 2 שווי נתמך · מקורות → בחירה       │ │ 2 הון בסיכון      │ │
│ 3 [BUY][FINANCE][HYBRID][COMPARE] │ │ 3 IRR · MOIC      │ │
│   inputs │ ledger rows · bridge   │ │ 4 אם היציאה נכשלת │ │
│ 4 תרחישים · מבחני לחץ             │ │ 5 SIGNAL · למה    │ │
│ 5 מרווח ביטחון · מהירות · ציר זמן │ │ ציון סיכון        │ │
│   סיכום ועדת השקעות               │ │ [שמירה] [PDF]     │ │
└───────────────────────────────────┘ └───────────────────┘ │
```

**Signature.** The five-questions ledger: the sticky column is literally the product's
five questions, each answered by one figure and one plain-language line, closing with
the structure signal on a brass rule. One bold visual supports it: the margin-of-safety
ladder (supported value → expected exit → break-even → entry basis, loss zone shaded).

**Self-critique of the plan.** Palette and type are PROPX's by requirement, so the module
reads native rather than generic. The inputs-left / summary-right layout is mandated, so
the distinctiveness is carried by the ledger: results are written as credit-memo rows
(label · figure · how it is calculated) under PROPX's broadsheet rule, not as a grid of
KPI tiles — the first draft used tiles and was revised. Step numbers are used only for
the underwriting workflow, which is a real sequence.
