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
2. **Root Directory:** `kobix-online` · Framework preset: **Other** · no build command
3. **Environment variables** (Project → Settings → Environment Variables):
   - `SITE_PASSWORD` — the access password you choose
   - `SESSION_SECRET` — random string, e.g. output of `openssl rand -hex 32`
4. Deploy. Custom domain: Project → Settings → Domains → add `kobix.online`.

With `SITE_PASSWORD` unset, login always fails (the site stays closed) — set both vars before sharing the URL.

CLI alternative: `cd kobix-online && npx vercel --prod` (after `vercel login`), then
`npx vercel env add SITE_PASSWORD` / `SESSION_SECRET` and redeploy.

## Local development

```bash
SITE_PASSWORD=<your-password> SESSION_SECRET=dev PORT=3200 \
  node ../scripts/kobix-dev-server.mjs   # or the copy in the session scratchpad
```

## Data

All figures are calibrated to official Israeli publications (CBS, Tax Authority,
Chief Economist, Bank of Israel) as of the retrieval date shown in the in-app
market tape; every metric carries provenance (official / derived / estimate)
surfaced via the "מקור הנתון" panel. Neighborhood rows are labeled relative
estimates. The recent-sales table is a labeled structural illustration.
