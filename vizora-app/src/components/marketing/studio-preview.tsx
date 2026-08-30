import { Play, SlidersHorizontal, Sparkles } from "lucide-react";
import { MiniPlayer } from "@/components/player/mini-player";
import { artById } from "@/lib/data/art-manifest";

const SCENES = [
  { art: "azure-exterior", title: "Scene 1 · Arrival", caption: "Discover a new way of living." },
  { art: "azure-living", title: "Scene 2 · Living space", caption: "Designed around space and light." },
  { art: "azure-terrace", title: "Scene 3 · The view", caption: "Wake up to uninterrupted sea views." },
] as const;

/** Decorative, faithful miniature of Vizora Studio for marketing pages. */
export function StudioPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-seam bg-surface shadow-panel">
      {/* Project bar */}
      <div className="flex items-center justify-between border-b border-seam px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-display text-sm font-medium text-ink">Azure Residences</span>
          <span className="hidden rounded-full bg-overlay px-2 py-0.5 text-[10px] font-medium text-ink-mid sm:inline">
            Draft
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 text-xs font-semibold text-ivory">
          <Play className="size-3" aria-hidden />
          Generate video
        </span>
      </div>

      <div className="grid md:grid-cols-[190px_1fr_190px]">
        {/* Scenes rail */}
        <div aria-hidden className="hidden flex-col gap-2 border-e border-seam p-3 md:flex">
          <p className="px-1 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">Scenes</p>
          {SCENES.map((scene) => (
            <div key={scene.title} className="flex gap-2 rounded-lg border border-seam bg-raised p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artById(scene.art).src}
                alt=""
                className="h-9 w-14 shrink-0 rounded object-cover"
              />
              <div className="min-w-0">
                <p className="truncate text-[10px] font-medium text-ink-mid">{scene.title}</p>
                <p className="truncate text-[9px] text-faint">{scene.caption}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Preview */}
        <div className="flex items-center justify-center bg-ground/60 p-4 md:p-6">
          <div className="w-full max-w-sm overflow-hidden rounded-xl border border-seam-strong">
            <MiniPlayer
              scenes={SCENES.map((scene) => ({
                src: artById(scene.art).src,
                alt: artById(scene.art).alt,
                caption: scene.caption,
                motion: "push",
              }))}
              aspect="16:9"
              sceneDurationMs={3200}
            />
          </div>
        </div>

        {/* Direction panel */}
        <div aria-hidden className="hidden flex-col gap-3 border-s border-seam p-3 md:flex">
          <p className="px-1 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">Direction</p>
          <div className="rounded-lg border border-seam bg-raised p-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-medium text-ink-mid">
              <SlidersHorizontal className="size-3" /> Style
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded-full bg-signal/15 px-2 py-0.5 text-[9px] font-medium text-signal-bright">Cinematic</span>
              <span className="rounded-full bg-overlay px-2 py-0.5 text-[9px] text-stone">Luxury</span>
              <span className="rounded-full bg-overlay px-2 py-0.5 text-[9px] text-stone">Social</span>
            </div>
          </div>
          <div className="rounded-lg border border-seam bg-raised p-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-medium text-ink-mid">
              <Sparkles className="size-3" /> Direct your video
            </p>
            <p className="mt-1.5 text-[9px] leading-relaxed text-faint">
              “Make it feel luxurious and calm. Focus on the sea view and finish
              with the project logo.”
            </p>
          </div>
          <div className="rounded-lg border border-seam bg-raised p-2.5">
            <p className="text-[10px] font-medium text-ink-mid">Format</p>
            <div className="mt-2 flex gap-1.5">
              <span className="rounded bg-overlay px-1.5 py-0.5 font-mono text-[9px] text-stone">9:16</span>
              <span className="rounded bg-signal/15 px-1.5 py-0.5 font-mono text-[9px] text-signal-bright">16:9</span>
              <span className="rounded bg-overlay px-1.5 py-0.5 font-mono text-[9px] text-stone">1:1</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
