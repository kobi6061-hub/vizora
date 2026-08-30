"use client";

import * as React from "react";
import { MiniPlayer, type MiniScene } from "@/components/player/mini-player";
import { artById } from "@/lib/data/art-manifest";
import type { AspectRatio } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

type ExampleCategory = "apartments" | "villas" | "developments" | "interiors" | "luxury" | "social";

const CATEGORY_LABELS: Record<ExampleCategory, string> = {
  apartments: "Apartments",
  villas: "Villas",
  developments: "Developments",
  interiors: "Interiors",
  luxury: "Luxury",
  social: "Social",
};

interface Example {
  id: string;
  title: string;
  categories: ExampleCategory[];
  aspect: AspectRatio;
  duration: string;
  sourceArt: string;
  scenes: { art: string; caption?: string; motion: MiniScene["motion"] }[];
  endCard?: { brand: string; cta: string };
}

const EXAMPLES: Example[] = [
  {
    id: "azure",
    title: "Azure Residences — development film",
    categories: ["developments", "apartments"],
    aspect: "16:9",
    duration: "0:30",
    sourceArt: "azure-exterior",
    scenes: [
      { art: "azure-exterior", caption: "Discover a new way of living.", motion: "push" },
      { art: "azure-living", caption: "Designed around space, light and comfort.", motion: "pan-right" },
      { art: "azure-terrace", caption: "Wake up to uninterrupted sea views.", motion: "rise" },
      { art: "azure-pool", caption: "Everything you need, right at home.", motion: "pan-left" },
    ],
    endCard: { brand: "Azure Residences", cta: "Book your private viewing" },
  },
  {
    id: "park",
    title: "Park Avenue Residence — luxury listing",
    categories: ["luxury", "apartments", "interiors"],
    aspect: "16:9",
    duration: "0:45",
    sourceArt: "park-penthouse",
    scenes: [
      { art: "park-exterior", caption: "An address that speaks quietly.", motion: "push" },
      { art: "park-penthouse", caption: "The horizon, from your living room.", motion: "pan-right" },
      { art: "park-bedroom", caption: "Proportions that feel effortless.", motion: "rise" },
      { art: "park-lobby", caption: "Arrive home like a guest of honour.", motion: "pull" },
    ],
    endCard: { brand: "Park Avenue Residence", cta: "Arrange a viewing" },
  },
  {
    id: "marina-reel",
    title: "Casa Marina — Instagram Reel",
    categories: ["social", "villas"],
    aspect: "9:16",
    duration: "0:15",
    sourceArt: "marina-villa",
    scenes: [
      { art: "marina-villa", caption: "You need to see this one.", motion: "push" },
      { art: "marina-terrace", caption: "Sunsets included.", motion: "rise" },
      { art: "marina-kitchen", caption: "Interiors that photograph themselves.", motion: "pan-right" },
    ],
    endCard: { brand: "Casa Marina", cta: "Save this one" },
  },
  {
    id: "grove",
    title: "The Grove — construction update",
    categories: ["developments"],
    aspect: "16:9",
    duration: "0:30",
    sourceArt: "grove-construction",
    scenes: [
      { art: "grove-construction", caption: "Rising above London.", motion: "push" },
      { art: "grove-aerial", caption: "From vision to structure.", motion: "pan-left" },
      { art: "grove-living", caption: "First residences revealed.", motion: "pan-right" },
    ],
    endCard: { brand: "The Grove", cta: "Follow the journey" },
  },
  {
    id: "meridian",
    title: "Meridian Tower — investor overview",
    categories: ["developments", "luxury"],
    aspect: "16:9",
    duration: "0:60",
    sourceArt: "meridian-exterior",
    scenes: [
      { art: "meridian-exterior", caption: "Meridian Tower — Dubai.", motion: "push" },
      { art: "meridian-skyline", caption: "A defining address.", motion: "pan-right" },
      { art: "meridian-pool", caption: "Managed to hotel standards.", motion: "rise" },
    ],
    endCard: { brand: "Meridian Tower", cta: "Request the investment brief" },
  },
  {
    id: "interior-story",
    title: "Show apartment — interior story",
    categories: ["interiors", "apartments"],
    aspect: "1:1",
    duration: "0:15",
    sourceArt: "interior-living-2",
    scenes: [
      { art: "interior-living-2", caption: "Light, volume and nothing wasted.", motion: "push" },
      { art: "interior-bed-2", caption: "Calm, by design.", motion: "pan-right" },
    ],
  },
  {
    id: "villa-night",
    title: "Villa nocturne — luxury teaser",
    categories: ["villas", "luxury", "social"],
    aspect: "9:16",
    duration: "0:15",
    sourceArt: "villa-night",
    scenes: [
      { art: "villa-night", caption: "After dark, it glows.", motion: "push" },
      { art: "penthouse-2", caption: "Evenings begin out here.", motion: "rise" },
    ],
  },
  {
    id: "coastal",
    title: "Coastal morning — lifestyle film",
    categories: ["developments", "social"],
    aspect: "16:9",
    duration: "0:30",
    sourceArt: "coast-marine",
    scenes: [
      { art: "coast-marine", caption: "Mornings feel slower here.", motion: "pan-right" },
      { art: "terrace-2", caption: "Fresh air, all to yourself.", motion: "rise" },
      { art: "tower-marine", caption: "Your next chapter by the sea.", motion: "push" },
    ],
  },
];

export function ExamplesGallery() {
  const [category, setCategory] = React.useState<ExampleCategory | "all">("all");

  const examples =
    category === "all"
      ? EXAMPLES
      : EXAMPLES.filter((example) => example.categories.includes(category));

  return (
    <div>
      <div role="group" aria-label="Filter examples" className="flex flex-wrap gap-2">
        {(["all", ...Object.keys(CATEGORY_LABELS)] as (ExampleCategory | "all")[]).map((id) => (
          <button
            key={id}
            onClick={() => setCategory(id)}
            aria-pressed={category === id}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              category === id
                ? "border-ivory bg-ivory text-ground"
                : "border-seam text-stone hover:border-seam-strong hover:text-ink",
            )}
          >
            {id === "all" ? "All" : CATEGORY_LABELS[id as ExampleCategory]}
          </button>
        ))}
      </div>

      <div className="mt-8 columns-1 gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
        {examples.map((example) => (
          <figure
            key={example.id}
            className="overflow-hidden rounded-2xl border border-seam bg-surface/60"
          >
            <MiniPlayer
              scenes={example.scenes.map((scene) => ({
                src: artById(scene.art).src,
                alt: artById(scene.art).alt,
                caption: scene.caption,
                motion: scene.motion,
              }))}
              aspect={example.aspect}
              endCard={example.endCard ?? null}
              sceneDurationMs={3400}
            />
            <figcaption className="flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artById(example.sourceArt).src}
                  alt=""
                  aria-hidden
                  className="h-9 w-12 shrink-0 rounded-md border border-seam object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{example.title}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                    From stills · {example.aspect} · {example.duration}
                  </p>
                </div>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
