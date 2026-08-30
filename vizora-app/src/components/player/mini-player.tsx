"use client";

/**
 * Self-playing storyboard preview — the "video" the product shows before a
 * production render engine exists. Cycles scenes with Ken Burns motion,
 * captions and stories-style progress. Pauses off-screen; honours
 * prefers-reduced-motion with a still frame.
 */

import * as React from "react";
import type { AspectRatio, SceneMotion } from "@/lib/domain/types";
import { usePrefersReducedMotion } from "@/lib/hooks/use-asset-url";
import { cn } from "@/lib/utils";

export interface MiniScene {
  src: string;
  alt: string;
  caption?: string;
  motion?: SceneMotion;
}

export interface MiniEndCard {
  brand: string;
  cta: string;
}

interface MiniPlayerProps {
  scenes: MiniScene[];
  aspect?: AspectRatio;
  sceneDurationMs?: number;
  captions?: boolean;
  progress?: boolean;
  endCard?: MiniEndCard | null;
  className?: string;
  playing?: boolean;
}

const MOTION_ANIMATION: Record<SceneMotion, string> = {
  push: "kb-push",
  pull: "kb-pull",
  "pan-left": "kb-pan-left",
  "pan-right": "kb-pan-right",
  rise: "kb-rise",
};

const ASPECT_CSS: Record<AspectRatio, string> = {
  "9:16": "9 / 16",
  "1:1": "1 / 1",
  "16:9": "16 / 9",
};

export function MiniPlayer({
  scenes,
  aspect = "9:16",
  sceneDurationMs = 3000,
  captions = true,
  progress = true,
  endCard = null,
  className,
  playing,
}: MiniPlayerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [inView, setInView] = React.useState(false);
  const [frame, setFrame] = React.useState(0);
  const [cycle, setCycle] = React.useState(0);

  const totalFrames = scenes.length + (endCard ? 1 : 0);
  const isPlaying = (playing ?? inView) && !reducedMotion && totalFrames > 1;

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setFrame((current) => {
        if (current + 1 >= totalFrames) {
          setCycle((c) => c + 1);
          return 0;
        }
        return current + 1;
      });
    }, sceneDurationMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, sceneDurationMs, totalFrames]);

  const isEndCard = endCard && frame === scenes.length;
  const scene = isEndCard ? null : scenes[Math.min(frame, scenes.length - 1)];
  const previousIndex = frame === 0 ? (cycle > 0 ? totalFrames - 1 : -1) : frame - 1;
  const previousScene =
    previousIndex >= 0 && previousIndex < scenes.length ? scenes[previousIndex] : null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full select-none overflow-hidden bg-surface",
        className,
      )}
      style={{ aspectRatio: ASPECT_CSS[aspect] }}
    >
      {/* Previous frame keeps its motion beneath the crossfade. */}
      {isPlaying && previousScene && (
        <div key={`prev-${previousIndex}-${cycle}`} className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previousScene.src}
            alt=""
            aria-hidden
            className="size-full object-cover"
          />
        </div>
      )}

      {scene && (
        <div key={`scene-${frame}-${cycle}`} className="absolute inset-0 animate-fade-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={scene.src}
            alt={scene.alt}
            className="size-full object-cover"
            style={
              isPlaying
                ? {
                    animationName: MOTION_ANIMATION[scene.motion ?? "push"],
                    animationDuration: `${sceneDurationMs + 900}ms`,
                    animationTimingFunction: "linear",
                    animationFillMode: "both",
                  }
                : undefined
            }
          />
          {captions && scene.caption && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ground/85 via-ground/35 to-transparent px-4 pb-4 pt-14">
              <p
                key={`caption-${frame}-${cycle}`}
                className="animate-fade-up text-center font-display text-[13px] font-medium tracking-wide text-ivory [animation-delay:180ms] sm:text-sm"
              >
                {scene.caption}
              </p>
            </div>
          )}
        </div>
      )}

      {isEndCard && endCard && (
        <div
          key={`end-${cycle}`}
          className="absolute inset-0 flex animate-fade-in flex-col items-center justify-center gap-4 bg-ground px-6 text-center"
        >
          <p className="font-display text-lg font-medium tracking-tight text-ivory">
            {endCard.brand}
          </p>
          <span className="rounded-full bg-ivory px-4 py-1.5 text-xs font-semibold text-ground">
            {endCard.cta}
          </span>
        </div>
      )}

      {progress && totalFrames > 1 && (
        <div aria-hidden className="absolute inset-x-3 top-3 flex gap-1">
          {Array.from({ length: totalFrames }).map((_, index) => (
            <div key={index} className="h-0.5 flex-1 overflow-hidden rounded-full bg-ivory/25">
              <div
                key={`fill-${frame}-${cycle}`}
                className="h-full origin-left rounded-full bg-ivory/90"
                style={
                  index < frame
                    ? { transform: "scaleX(1)" }
                    : index === frame && isPlaying
                      ? {
                          animationName: "fill-x",
                          animationDuration: `${sceneDurationMs}ms`,
                          animationTimingFunction: "linear",
                          animationFillMode: "both",
                        }
                      : { transform: "scaleX(0)" }
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
