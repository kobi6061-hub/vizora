# VIZORA

**The AI video studio built for real estate.**
Upload property images. Turn them into cinematic marketing videos. Publish — in about 5 minutes.

Vizora is a standalone SaaS product: a complete public marketing website plus a
logged-in creation studio. Everything runs today except deliberately
disconnected external services (AI generation vendors, payments, email,
analytics, cloud media) — the architecture keeps each behind a single swap
point.

## Running

```bash
npm install
npm run dev        # http://localhost:3000
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run art` | Regenerate the SVG property-art collection + manifest |
| `npm run test:e2e` | Playwright end-to-end flows |

## Product map

- **Marketing site** — `/`, `/product`, `/image-to-video`, `/real-estate-video`,
  `/templates`, `/examples`, `/pricing`, `/business`
- **Auth** — `/login`, `/signup`, `/forgot-password`, `/reset-password`,
  `/verify-email` (mock auth; sessions persist in the browser)
- **App** — `/app` (dashboard), `/app/onboarding`, `/app/create`,
  `/app/projects`, `/app/projects/[id]` (Vizora Studio), `/app/templates`,
  `/app/assets`, `/app/brand`, `/app/settings`

First run seeds a demo workspace (sample properties in every status) so the
product is alive before any upload. The **Try a sample property** journey walks
the full flow: upload review → property details → style → format → automatic
storyboard → generation → result.

## Architecture

```
src/
  app/                    Routes (marketing) / (auth) / app
  components/
    ui/                   Primitives (button, dialog, toast, …)
    marketing/ studio/ app/ player/ cards/ brand/
  lib/
    domain/types.ts       Framework-free domain model
    data/                 Styles, music, pricing, templates, demo seed, art manifest
    story/                Automatic story engine (captions per style/objective)
    generation/           VideoGenerationProvider + MockVideoGenerationProvider
    audio/                In-browser music synth + voiceover preview
    stores/               Zustand workspace store (localStorage persisted)
    storage/              localStorage helpers + IndexedDB blob store
    auth/                 Mock auth provider + session store
scripts/
  generate-property-art.mjs   Deterministic SVG archviz renders → public/art
```

### Provider boundaries (connect-later by design)

| Service | Boundary | Today |
| --- | --- | --- |
| Video generation | `lib/generation/provider.ts` → registry in `lib/generation/index.ts` | `MockVideoGenerationProvider` (time-derived phases, survives reload) |
| File storage | `lib/storage/local.ts` (+ `useAssetUrl`) | localStorage metadata + IndexedDB blobs |
| Auth | `lib/auth/` | Local mock sessions |
| Music | `lib/data/music.ts` + `lib/audio/preview-synth.ts` | Original generative previews |
| Voiceover | `lib/audio/preview-synth.ts` | Browser SpeechSynthesis preview |
| Payments | `lib/data/pricing.ts` (single source of pricing truth) | UI states only |

Replacing the mock generation engine means implementing
`VideoGenerationProvider` and changing one line in
`lib/generation/index.ts` — the studio, generation experience and result
screens stay untouched.

### Imagery

All property imagery is generated locally as graded SVG architectural renders
(one cinematic collection — dusk, golden hour, night, marine). Regenerate with
`npm run art`; the manifest (`lib/data/art-manifest.ts`) is the only coupling.

## Design

Tokens, type pairing, signature motion and rationale live in
[`DESIGN-NOTES.md`](./DESIGN-NOTES.md). Read it before touching UI.
