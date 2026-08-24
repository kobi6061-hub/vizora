"use client";

/**
 * The generation moment. Not a spinner — a staged, narrated render pass
 * with the transformation seam sweeping the project's own imagery.
 */

import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssetThumb } from "@/components/studio/upload-zone";
import { getVideoGenerationProvider } from "@/lib/generation";
import type { GenerationSnapshot } from "@/lib/generation";
import type { GenerationPhase, Project } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

const PHASE_ORDER: { phase: GenerationPhase; label: string }[] = [
  { phase: "ANALYZING", label: "Preparing your property story" },
  { phase: "CREATING_SCENES", label: "Building your scenes" },
  { phase: "GENERATING_MOTION", label: "Creating cinematic motion" },
  { phase: "ASSEMBLING", label: "Adding transitions" },
  { phase: "FINALIZING", label: "Finishing your marketing video" },
];

function phaseIndex(phase: GenerationPhase) {
  const index = PHASE_ORDER.findIndex((entry) => entry.phase === phase);
  if (phase === "QUEUED") return -1;
  if (phase === "COMPLETED" || phase === "FAILED") return PHASE_ORDER.length;
  return index;
}

export function GenerationOverlay({
  project,
  generationId,
  onComplete,
  onCancelled,
}: {
  project: Project;
  generationId: string;
  onComplete: () => void;
  onCancelled: () => void;
}) {
  const assets = useWorkspaceStore((state) => state.assets);
  const [snapshot, setSnapshot] = React.useState<GenerationSnapshot | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const completedRef = React.useRef(false);

  const projectAssets = project.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
    .slice(0, 5);

  React.useEffect(() => {
    const provider = getVideoGenerationProvider();
    const unsubscribe = provider.subscribe(generationId, (next) => {
      setSnapshot(next);
      if (next.phase === "COMPLETED" && !completedRef.current) {
        completedRef.current = true;
        // Hold the 100% frame for a beat before the reveal.
        window.setTimeout(onComplete, 900);
      }
      if (next.phase === "FAILED" && !completedRef.current) {
        completedRef.current = true;
        onCancelled();
      }
    });
    return unsubscribe;
  }, [generationId, onComplete, onCancelled]);

  const progress = snapshot?.progress ?? 0;
  const activeIndex = snapshot ? phaseIndex(snapshot.phase) : -1;

  const cancel = async () => {
    setCancelling(true);
    await getVideoGenerationProvider().cancelGeneration(generationId);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Generating your video"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ground/97 px-6 backdrop-blur-sm"
    >
      {/* Filmstrip with the sweeping seam */}
      <div className="relative w-full max-w-md">
        <div className="flex justify-center gap-2">
          {projectAssets.map((asset, index) => (
            <div
              key={asset.id}
              className="h-16 w-24 overflow-hidden rounded-lg border border-seam opacity-80"
              style={{ transform: `translateY(${Math.sin(index * 1.9) * 6}px)` }}
            >
              <AssetThumb asset={asset} className="size-full" />
            </div>
          ))}
        </div>
        <div aria-hidden className="pointer-events-none absolute -inset-y-2 inset-x-0 overflow-hidden motion-reduce:hidden">
          <div className="absolute inset-y-0 w-0.5 animate-seam-sweep bg-signal-bright shadow-[0_0_18px_0_rgba(138,138,244,0.6)]" />
        </div>
      </div>

      <div className="mt-10 w-full max-w-sm text-center">
        <p
          key={snapshot?.message ?? "starting"}
          className="animate-fade-up font-display text-xl font-medium tracking-tight text-ink"
          aria-live="polite"
        >
          {snapshot?.message ?? "Reserving studio time"}
        </p>

        <div className="mt-6 h-1 overflow-hidden rounded-full bg-seam">
          <div
            className="h-full rounded-full bg-signal transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-faint">
          <span>{project.name}</span>
          <span className="tabular-nums">{progress}%</span>
        </div>

        <ol className="mx-auto mt-8 w-fit space-y-2.5 text-start">
          {PHASE_ORDER.map((entry, index) => {
            const done = activeIndex > index;
            const active = activeIndex === index;
            return (
              <li key={entry.phase} className="flex items-center gap-2.5 text-[13px]">
                {done ? (
                  <span className="flex size-4.5 items-center justify-center rounded-full bg-success/15">
                    <Check className="size-2.5 text-success" aria-hidden />
                  </span>
                ) : active ? (
                  <span className="flex size-4.5 items-center justify-center">
                    <span className="size-2 animate-pulse-soft rounded-full bg-amber" />
                  </span>
                ) : (
                  <span className="flex size-4.5 items-center justify-center">
                    <span className="size-1.5 rounded-full bg-seam-strong" />
                  </span>
                )}
                <span
                  className={cn(
                    done ? "text-ink-mid" : active ? "text-ink" : "text-faint",
                  )}
                >
                  {entry.label}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-8 text-[13px] text-stone">
          Your video will be ready in about 5 minutes — usually much sooner.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-faint"
          onClick={cancel}
          loading={cancelling}
        >
          {cancelling ? "Cancelling…" : "Cancel generation"}
        </Button>
      </div>
    </div>
  );
}
