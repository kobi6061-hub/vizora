"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MiniPlayer, type MiniScene } from "@/components/player/mini-player";
import { artById } from "@/lib/data/art-manifest";
import { cn } from "@/lib/utils";

const HERO_STILL = artById("azure-exterior");

const HERO_SCENES: MiniScene[] = [
  { src: artById("azure-exterior").src, alt: artById("azure-exterior").alt, caption: "Discover a new way of living.", motion: "push" },
  { src: artById("azure-living").src, alt: artById("azure-living").alt, caption: "Designed around space, light and comfort.", motion: "pan-right" },
  { src: artById("azure-terrace").src, alt: artById("azure-terrace").alt, caption: "Wake up to uninterrupted sea views.", motion: "rise" },
  { src: artById("azure-pool").src, alt: artById("azure-pool").alt, caption: "Everything you need, right at home.", motion: "pan-left" },
];

const PIPELINE_STEPS = [
  { label: "Property analyzed", done: true },
  { label: "Scenes composed", done: true },
  { label: "Adding cinematic motion", done: false },
] as const;

export function Hero() {
  return (
    <div className="relative overflow-hidden">
      <div className="container-page pb-16 pt-32 md:pb-24 md:pt-40">
        {/* Statement */}
        <div className="max-w-3xl">
          <p className="text-eyebrow animate-fade-up">
            The AI video studio built for real estate
          </p>
          <h1 className="text-display mt-5 animate-fade-up text-[40px] text-ink [animation-delay:80ms] sm:text-6xl md:text-7xl">
            Turn property images into marketing videos —{" "}
            <em className="text-serif-accent">in 5 minutes.</em>
          </h1>
          <p className="mt-6 max-w-xl animate-fade-up text-lg leading-relaxed text-stone [animation-delay:160ms]">
            Upload your renders, photos or property visuals. Vizora transforms
            them into polished real-estate videos, ready to publish.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 animate-fade-up [animation-delay:240ms]">
            <Link href="/signup">
              <Button size="xl">Create your video</Button>
            </Link>
            <Link href="/examples">
              <Button size="xl" variant="outline">
                <Play className="size-4" aria-hidden />
                Watch an example
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-faint animate-fade-up [animation-delay:300ms]">
            No editing skills required.
          </p>
        </div>

        {/* IMAGE → VIZORA → VIDEO */}
        <div className="mt-16 animate-fade-up [animation-delay:360ms] md:mt-24">
          <div className="grid items-center gap-6 md:grid-cols-[1fr_auto_auto] md:gap-10">
            {/* Still */}
            <figure className="relative hidden overflow-hidden rounded-2xl border border-seam md:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={HERO_STILL.src}
                alt={HERO_STILL.alt}
                className="aspect-[16/10] w-full object-cover"
              />
              {/* The transformation seam — VIZORA's signature */}
              <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-full motion-reduce:hidden">
                <div className="absolute inset-y-0 w-0.5 animate-seam-sweep bg-signal-bright/90 shadow-[0_0_18px_0_rgba(138,138,244,0.55)]" />
              </div>
              <figcaption className="absolute left-3 top-3 flex items-center gap-2">
                <span className="rounded-md bg-ground/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mid backdrop-blur">
                  Your still
                </span>
                <span className="rounded-md bg-ground/80 px-2 py-1 font-mono text-[10px] text-stone backdrop-blur">
                  seafront-render.png · 4.2 MB
                </span>
              </figcaption>
            </figure>

            {/* Vizora at work */}
            <div className="hidden w-56 shrink-0 flex-col gap-3 md:flex">
              <div className="rounded-2xl border border-seam bg-surface p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-stone">
                  Vizora at work
                </p>
                <ul className="mt-3 space-y-2.5">
                  {PIPELINE_STEPS.map((step) => (
                    <li key={step.label} className="flex items-center gap-2.5 text-[13px]">
                      {step.done ? (
                        <span className="flex size-4 items-center justify-center rounded-full bg-success/15">
                          <Check className="size-2.5 text-success" aria-hidden />
                        </span>
                      ) : (
                        <span className="relative flex size-4 items-center justify-center">
                          <span className="size-2 animate-pulse-soft rounded-full bg-amber" />
                        </span>
                      )}
                      <span className={cn(step.done ? "text-ink-mid" : "text-ink")}>{step.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-center font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                Upload → Create → Publish
              </p>
            </div>

            {/* Video */}
            <div className="relative mx-auto w-full max-w-64 md:mx-0">
              {/* Mobile: show the source still as an overlapping chip */}
              <figure className="absolute -left-4 -top-6 z-10 w-24 overflow-hidden rounded-lg border border-seam-strong shadow-pop md:hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={HERO_STILL.src} alt="" aria-hidden className="aspect-[16/10] w-full object-cover" />
                <figcaption className="bg-ground/90 px-1.5 py-1 text-center font-mono text-[8px] uppercase tracking-widest text-stone">
                  From 1 still
                </figcaption>
              </figure>
              <div className="overflow-hidden rounded-2xl border border-seam-strong shadow-panel">
                <MiniPlayer
                  scenes={HERO_SCENES}
                  aspect="9:16"
                  endCard={{ brand: "Azure Residences", cta: "Book your private viewing" }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between px-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone">
                  Your video
                </span>
                <span className="font-mono text-[10px] text-faint">9:16 · 0:30</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
