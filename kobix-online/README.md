# Kobix.online — deploy folder

Static, self-contained build of the Kobix.online new-homes intelligence board
(password-gated, internal use only). This folder is the Vercel project root:

- `index.html` — the entire application (copy of `standalone/israel-new-homes-v2.html`)
- `vercel.json` — noindex + no-store headers so the internal page stays out of
  search engines and caches

## Deploy (Vercel)
1. vercel.com → **Add New… → Project** → Import `kobi6061-hub/vizora`
2. **Root Directory**: `kobix-online` (Framework Preset: Other; no build command)
3. Deploy. To use the kobix.online domain: Project → Settings → Domains → add `kobix.online`.

CLI alternative from a local clone: `cd kobix-online && npx vercel --prod`
