"use client";

/**
 * One image, two impacts — draggable transformation seam between the
 * original still and the Vizora treatment of the same frame.
 */

import * as React from "react";
import { ChevronsLeftRight } from "lucide-react";
import { MiniPlayer } from "@/components/player/mini-player";
import { artById } from "@/lib/data/art-manifest";
import { clamp, cn } from "@/lib/utils";

const STILL = artById("marina-villa");

export function BeforeAfter({ className }: { className?: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState(46);
  const [dragging, setDragging] = React.useState(false);

  const updateFromClientX = React.useCallback((clientX: number) => {
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition(clamp(((clientX - rect.left) / rect.width) * 100, 6, 94));
  }, []);

  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => updateFromClientX(event.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, updateFromClientX]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") setPosition((p) => clamp(p - 4, 6, 94));
    if (event.key === "ArrowRight") setPosition((p) => clamp(p + 4, 6, 94));
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative select-none overflow-hidden rounded-2xl border border-seam",
        className,
      )}
      onPointerDown={(event) => {
        setDragging(true);
        updateFromClientX(event.clientX);
      }}
    >
      {/* Vizora side (full, beneath) */}
      <MiniPlayer
        scenes={[
          { src: STILL.src, alt: STILL.alt, caption: "Imagine coming home to this.", motion: "push" },
          { src: artById("marina-terrace").src, alt: artById("marina-terrace").alt, caption: "Sunsets included.", motion: "rise" },
          { src: artById("marina-kitchen").src, alt: artById("marina-kitchen").alt, caption: "Made for long dinners.", motion: "pan-right" },
        ]}
        aspect="16:9"
        progress={false}
        className="pointer-events-none"
      />

      {/* Still side (clipped on top) */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={STILL.src} alt="" className="size-full object-cover" />
        <div className="absolute inset-0 bg-ground/25" />
      </div>

      {/* Labels */}
      <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-ground/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mid backdrop-blur">
        The still you have
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-ground/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-signal-bright backdrop-blur">
        The video Vizora makes
      </span>

      {/* Seam handle */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Compare still image with Vizora video"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 z-10 w-10 -translate-x-1/2 cursor-ew-resize outline-none"
        style={{ left: `${position}%` }}
        onPointerDown={(event) => {
          event.stopPropagation();
          setDragging(true);
        }}
      >
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-signal-bright shadow-[0_0_18px_0_rgba(138,138,244,0.6)]" />
        <div className="absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-seam-strong bg-ground/90 shadow-pop backdrop-blur transition-transform hover:scale-105">
          <ChevronsLeftRight className="size-4 text-ink" aria-hidden />
        </div>
      </div>
    </div>
  );
}
