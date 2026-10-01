# KobiX RealEstate — Israeli Market Intelligence (private)

Production-ready Vercel project for the KobiX new-homes intelligence platform.
Password-protected server-side; internal use only.

## What's in here

| File | Role |
|---|---|
| `index.html` | The entire application (single file): dashboard, map, drill hierarchy, filters, compare, insights, provenance, HE/EN, light/dark |
| `login.html` | Access screen (posts to `/api/login`; no password in client code) |
| `middleware.js` | Vercel Edge Middleware — verifies the signed `kobix_session` cookie on every request, otherwise redirects to `/login.html` |
| `api/login.js` | Checks `SITE_PASSWORD` (env), sets a 12-hour HMAC-signed HttpOnly cookie |
| `api/logout.js` | Clears the session |
| `vercel.json` | `noindex` + security headers, `no-store` on the app |
| `robots.txt` | Disallow all |

## Deploy (Vercel)

1. vercel.com → **Add New… → Project** → import `kobi6061-hub/vizora`
2. **Root Directory:** leave EMPTY (the repo root is the project) · Framework preset: **Other** · no build command
3. **Environment variables** (Project → Settings → Environment Variables):
   - `SITE_PASSWORD` — the access password you choose
   - `SESSION_SECRET` — random string, e.g. output of `openssl rand -hex 32`
4. Deploy. Custom domain: Project → Settings → Domains → add `kobix.online`.

With `SITE_PASSWORD` unset, login always fails (the site stays closed) — set both vars before sharing the URL.

CLI alternative: `npx vercel --prod` from the repo root (after `vercel login`), then
`npx vercel env add SITE_PASSWORD` / `SESSION_SECRET` and redeploy.

## Local development

```bash
SITE_PASSWORD=<your-password> SESSION_SECRET=dev PORT=3200 \
  node scripts/kobix-dev-server.mjs
```

## Data

All figures are calibrated to official Israeli publications (CBS, Tax Authority,
Chief Economist, Bank of Israel) as of the retrieval date shown in the in-app
market tape; every metric carries provenance (official / derived / estimate)
surfaced via the "מקור הנתון" panel. Neighborhood rows are labeled relative
estimates. The recent-sales table shows official government transactions only.

### Data integrity

Every figure on screen carries a class plus the period it describes:
רשמי (official — only values whose source, period and check time are stored,
today the daily-synced CBS/Bank of Israel indicators), סטטי (static — typed in
from a cited, dated publication), נגזר (derived), מודל (modelled) or לא זמין
(unavailable). Nothing generated is presented as observed: there are no
synthetic street transactions, no generated price history, no invented medians
and no sample-size "confidence". Places are never ranked (#1/#2/#3, "leader",
value sort) unless every ranked value is official — with one labelled
exception, the capital section below.

The capital module (L4 · הון — "where should I deploy my capital?") is an
investment MODEL over the classified board data and the investor's own,
visible and editable assumptions: equity capital ₪5M–₪100M, strategy, horizon,
leverage, rate, term, a Conservative / Base / Upside appreciation
assumption (no approximate price history is read) and a rent-growth
assumption (default: each area's own last 1-year change). It shows a six-factor model
score, a MODEL RANKING (דירוג מודל) that stays inside the section, per-area
analysis (price targets, the price that meets a required IRR, bulk, scenarios,
exit, refinance) and an equity-based portfolio allocation: debt, purchase tax
and acquisition costs are accounted for, so the portfolio answers "with ₪X of
equity at Y% leverage, what can I acquire?". Every return is a true IRR from the
deal calculator's engine. Each area's data basis is the class of its inputs
(never the historical o-flags). The ranking's outside surfaces — command-bar
signal, map layer, gold markers, profile shortcut, insights teaser — stay off
(`CI_EXTERNAL=false`).

The deal calculator (מחשבון עסקה · Deal Lab — "does this specific deal work?")
is separate from that model: every input is the investor's own assumption, an
empty field leaves every result that needs it unavailable, and no appreciation
or rent growth is ever assumed.

`node test/integrity.test.js`, `node test/capital.test.js` and
`node test/calculator.test.js` enforce this; they run with the other offline
suites in the daily workflow.

The offline build (`scripts/build-standalone.py` → `standalone/`) embeds no
password or credential: the repository is public, so a client-side gate could
only leak one. Production access is the server-side gate alone.

### Daily official-indicator sync

The Bank of Israel rate and the CBS new-homes price index are re-checked every
day by `.github/workflows/market-sync.yml` (`scripts/market-sync.js`), committed
to `data/market/`, and loaded by the page — see `lib/market/README.md`.
