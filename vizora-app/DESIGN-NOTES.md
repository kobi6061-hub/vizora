# VIZORA — Design Notes

Living record of design decisions. Read this before touching UI. Keep it updated.

## 1. Subject

VIZORA is an AI video studio purpose-built for real estate: developers, agencies and
property marketers upload renders or photos and get a cinematic marketing video in about
five minutes. Every screen serves one legibility test — a visitor must understand
"property images → marketing video → 5 minutes" within three seconds, and every page
funnels toward **Create Video**.

## 2. Palette

Derived from the product's world: architectural materials at dusk — graphite structure,
ivory plaster, glass catching the last light. Not from AI-tool fashion.

| Token       | Hex       | Role |
|-------------|-----------|------|
| Graphite    | `#0B0B0F` | Page ground. Near-black with a cool cast — the screening room. |
| Iron        | `#15151C` | Panels, cards, studio surfaces. Brushed steel in shadow. |
| Seam        | `#26262F` | Hairline borders (used at 100%), elevated hover surfaces. |
| Ivory       | `#F2F0EA` | Primary text and inverted surfaces. Warm architectural plaster — never pure white. |
| Stone       | `#8F8D96` | Secondary text, captions. Premium neutral grey. |
| Signal      | `#5B5BEA` | The one accent. Deep electric indigo — screen-glow at dusk, not AI purple. |

Status: success `#3FB57C` · generating (amber) `#D9A13B` · danger `#DF4B4E`.

Rules:
- Signal appears on at most one element per viewport (primary CTA, live progress, focus).
- **No gradients in UI chrome.** Color richness comes from property imagery only.
- No glows, no glassmorphism. Elevation = 1px seam borders + soft black shadow.
- Light surfaces (ivory) are reserved for print-like moments: end cards, email states.

## 3. Type

- **Display — Bricolage Grotesque** (500/600, tracking −2…−4%, optical size high).
  Angular ink-trap grotesk: architectural, confident, not rounded-startup.
- **Editorial accent — Instrument Serif Italic.** One or two words per hero, max
  ("*cinematic*", "*in 5 minutes*"). Never for UI.
- **Body/UI — Geist Sans** (400/500/600). Clean, excellent numerals.
- **Utility — Geist Mono** for durations, timestamps, file sizes, aspect labels.

Hierarchy through size and spacing, not weight stacking.

## 4. Layout

Marketing: full-bleed cinematic dark; a 12-col grid holds tight text blocks between
full-width imagery bands. App: left rail navigation on graphite; Studio is a tri-pane —
scenes/assets rail, large center preview, intelligent direction panel right.

```
┌────────────────────────────────────────────────────────┐
│ VIZORA  Product HowItWorks Templates …  Sign in [Create]│
│                                                        │
│  Turn property images into                             │
│  marketing videos — in *5 minutes*.                    │
│  [Create your video]   ▷ Watch an example              │
│                                                        │
│  ┌─────────┐    ──── SEAM ────▶    ┌────┐              │
│  │ still   │    scene chips        │9:16│              │
│  │ render  │    VIZORA at work     │vid │              │
│  └─────────┘                       └────┘              │
└────────────────────────────────────────────────────────┘
```

## 5. Signature

**The transformation seam.** The moment a still becomes motion is always rendered the
same way: a thin vertical Signal-indigo scanline sweeps across a property image and
leaves cinematic motion (slow Ken Burns) behind it. It appears at exactly three
emotional peaks: the homepage hero (looping), the before/after section (draggable), and
the Studio's Generate moment (on the user's own project). All other motion stays quiet.

## Self-critique (recorded)

- *Generic-check, palette:* indigo accent is category-adjacent — kept because the brief
  mandates the electric violet/indigo direction, but disciplined: flat only, no
  gradients, ≤1 accent element per viewport; warm ivory + material greys anchor it in
  architecture rather than AI. Dropped the dusk-gradient idea for UI chrome entirely.
- *Generic-check, type:* default reach would be Inter/Space Grotesk alone. Bricolage +
  Instrument Serif italic accents is a deliberate, ownable pairing.
- *Generic-check, layout:* Studio tri-pane follows the product spec (§9). Marketing
  layout avoids the floating-dashboard-screenshot cliché via the seam composition.
- *Generic-check, signature:* the seam is derived from this product's core transformation
  (still → motion). Not transferable to a generic SaaS. Kept.

## Imagery system

Network policy blocks external CDNs, and stock would fracture the grade anyway. All
property imagery is generated locally: deterministic SVG architectural renders
(`scripts/generate-property-art.mjs` → `public/art/`), one collection, one cinematic
grade (dusk indigo skies, warm window light, atmospheric haze, film grain, vignette).
Flat geometric masses with realistic proportions — archviz poster art, never clip art.

## Motion rules

- 200–300ms, `cubic-bezier(0.32, 0.72, 0, 1)` for UI; scene motion (Ken Burns) is
  8–12s linear and only inside players.
- One orchestrated moment per screen. Respect `prefers-reduced-motion` everywhere
  (stills instead of Ken Burns, no seam sweep, instant transitions).

## Copy rules

- The promise, verbatim, is "Create a real-estate marketing video in 5 minutes." Do not
  multiply slogans. UPLOAD → CREATE → PUBLISH is the structural story.
- Buttons say what they do: "Create video", "Generate video", "Save brand kit".
- No lorem ipsum, no "unlock/supercharge/revolutionize", no sparkle-AI language.
- Trust language stays honest: "Your projects stay in your workspace" (true — local
  storage), never security claims the architecture can't back.

## Rejected directions

- Stock photography (blocked network; inconsistent grade).
- Purple gradient hero, glassmorphism cards, floating dashboard screenshot (banned).
- Light-mode marketing site (product is a screening room; dark is the deliberate,
  single look — app surfaces stay dark too, with ivory print-moments for contrast).
- Full timeline editor (product is an AI creative director, not an NLE).

## Assaf-estate v2 — master design round (30.08.2026)
- Tokens added: --navy #16345c (chrome, selection, L3), --brass #9a742a (kickers, leader star, est-tags); paper/panel unchanged; data ramps untouched.
- Surface levels: L1 broadsheet sections on canvas under a 2px ink rule (table, rankings); L2 modules (map, chart) with deepened borders; L3 asset profile with navy top bar + pop shadow.
- Signature: the Israel map as an architectural survey object — degree grid + ticks, cast shadow (feDropShadow), constant-screen-size labels (fs=14.5·vb/520), elevation on hover (translateY + drop-shadow), navy dashed survey ring on selection, scope chip in the side column.
- Market tape replaces colored bulletin boxes; retrieved-date cell inset. KPI row: hero metric (span 2, Heebo 800, 37-mo spark) + 5 supporting tiles.
- Provenance: PROV rows per metric rendered in a profile popover (official/derived/estimate per location flags o:/e:), retrieved 30.08.2026.
- Rejected: colorful wash cards (kept only in tape semantics), hero gradient (mirror rule), per-zoom fixed font sizes.
