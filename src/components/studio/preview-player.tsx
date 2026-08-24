"use client";

/**
 * The Vizora Studio preview player.
 *
 * Time-driven storyboard playback: Ken Burns motion per scene, captions,
 * branding overlays, branded end card, generative music and voiceover
 * preview. Before a production render exists this IS the video — afterwards
 * the same chrome hosts the rendered file.
 */

import * as React from "react";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Slider } from "@/components/ui/misc";
import { WithTooltip } from "@/components/ui/tooltip";
import { previewSynth, voiceoverPreview } from "@/lib/audio/preview-synth";
import { trackById } from "@/lib/data/music";
import { usePrefersReducedMotion } from "@/lib/hooks/use-asset-url";
import type {
  AspectRatio,
  BrandingSettings,
  MusicSelection,
  SceneMotion,
  VoiceoverSettings,
} from "@/lib/domain/types";
import { cn, clamp, formatDuration } from "@/lib/utils";

export interface PlayerScene {
  id: string;
  kind: "footage" | "endcard";
  url: string | null;
  alt: string;
  caption: string;
  motion: SceneMotion;
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

const PLACEMENT_CLASSES: Record<BrandingSettings["placement"], string> = {
  "bottom-start": "bottom-3 start-3",
  "bottom-end": "bottom-3 end-3",
  "top-start": "top-3 start-3",
  "top-end": "top-3 end-3",
};

interface PreviewPlayerProps {
  scenes: PlayerScene[];
  durationSec: number;
  aspect: AspectRatio;
  branding: BrandingSettings;
  brandLogoUrl?: string | null;
  music: MusicSelection;
  voiceover: VoiceoverSettings;
  chromeLabel: string;
  autoPlay?: boolean;
  className?: string;
}

export function PreviewPlayer({
  scenes,
  durationSec,
  aspect,
  branding,
  brandLogoUrl,
  music,
  voiceover,
  chromeLabel,
  autoPlay = false,
  className,
}: PreviewPlayerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const containerRef = React.useRef<HTMLDivElement>(null);

  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [volume, setVolume] = React.useState(music.volume);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [seekNonce, setSeekNonce] = React.useState(0);

  const total = durationSec;
  const per = scenes.length > 0 ? total / scenes.length : total;
  const index = scenes.length > 0 ? Math.min(scenes.length - 1, Math.floor(time / per)) : 0;
  const offset = time - index * per;
  const ended = time >= total - 0.02;
  const scene = scenes[index];
  const previous = index > 0 ? scenes[index - 1] : null;

  /* ------------------------------ time engine ------------------------------ */

  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let reachedEnd = false;
      setTime((t) => {
        const next = Math.min(total, t + dt);
        if (next >= total) reachedEnd = true;
        return next;
      });
      if (reachedEnd) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  /* --------------------------------- audio --------------------------------- */

  const track = music.trackId ? trackById(music.trackId) : null;
  React.useEffect(() => {
    if (playing && track && !muted) {
      void previewSynth.play(track, volume);
    } else {
      previewSynth.stop();
    }
    return () => previewSynth.stop();
  }, [playing, track, muted]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    previewSynth.setVolume(muted ? 0 : volume);
  }, [volume, muted]);

  React.useEffect(() => {
    if (playing && voiceover.enabled && voiceover.script && !muted) {
      voiceoverPreview.speak(voiceover.script, voiceover.language, voiceover.voice);
    } else {
      voiceoverPreview.stop();
    }
    return () => voiceoverPreview.stop();
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------- fullscreen ------------------------------- */

  React.useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch {
      /* Unsupported (e.g. iPhone Safari) — the inline player remains. */
    }
  };

  /* -------------------------------- controls -------------------------------- */

  const togglePlay = () => {
    if (ended) {
      setTime(0);
      setSeekNonce((n) => n + 1);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  };

  const seek = (value: number) => {
    setTime(clamp(value, 0, total));
    setSeekNonce((n) => n + 1);
  };

  React.useEffect(() => {
    if (autoPlay && !reducedMotion) {
      const timer = window.setTimeout(() => setPlaying(true), 350);
      return () => window.clearTimeout(timer);
    }
  }, [autoPlay, reducedMotion]);

  const showMotion = playing && !reducedMotion;

  /* --------------------------------- render --------------------------------- */

  return (
    <div
      ref={containerRef}
      className={cn(
        "group/player relative flex max-h-full flex-col overflow-hidden rounded-2xl border border-seam-strong bg-black",
        fullscreen && "rounded-none border-none",
        className,
      )}
    >
      {/* Stage */}
      <div
        className="relative mx-auto w-full max-w-full flex-1 overflow-hidden"
        style={{ aspectRatio: ASPECT_CSS[aspect] }}
        onClick={togglePlay}
        role="button"
        aria-label={playing ? "Pause preview" : "Play preview"}
        tabIndex={-1}
      >
        {scenes.length === 0 ? (
          <div className="flex size-full items-center justify-center text-sm text-faint">
            Add images to see your storyboard.
          </div>
        ) : (
          <>
            {/* Previous scene beneath, frozen at its end state */}
            {previous && offset < 0.5 && previous.kind === "footage" && previous.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previous.url}
                alt=""
                aria-hidden
                className="absolute inset-0 size-full object-cover"
                style={{
                  animationName: MOTION_ANIMATION[previous.motion],
                  animationDuration: `${per}s`,
                  animationTimingFunction: "linear",
                  animationFillMode: "both",
                  animationDelay: `-${per}s`,
                  animationPlayState: "paused",
                }}
              />
            )}

            {/* Active scene */}
            <div key={`${scene.id}-${seekNonce}`} className="absolute inset-0 animate-fade-in">
              {scene.kind === "endcard" ? (
                <EndCard branding={branding} logoUrl={brandLogoUrl} />
              ) : scene.url ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={scene.url}
                    alt={scene.alt}
                    className="size-full object-cover"
                    style={{
                      animationName: MOTION_ANIMATION[scene.motion],
                      animationDuration: `${per}s`,
                      animationTimingFunction: "linear",
                      animationFillMode: "both",
                      animationDelay: `-${offset}s`,
                      animationPlayState: showMotion ? "running" : "paused",
                    }}
                  />
                  {scene.caption && (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-6 pb-6 pt-16">
                      <p
                        key={`caption-${scene.id}-${seekNonce}`}
                        className="animate-fade-up text-center font-display text-base font-medium tracking-wide text-ivory [animation-delay:150ms] sm:text-lg"
                      >
                        {scene.caption}
                      </p>
                    </div>
                  )}
                  {branding.showBranding && branding.brandName && (
                    <span
                      className={cn(
                        "absolute rounded bg-black/45 px-2 py-1 font-display text-[11px] font-medium uppercase tracking-[0.14em] text-ivory/90 backdrop-blur-sm",
                        PLACEMENT_CLASSES[branding.placement],
                      )}
                    >
                      {branding.brandName}
                    </span>
                  )}
                </>
              ) : (
                <div className="flex size-full items-center justify-center bg-raised text-sm text-faint">
                  Image removed — replace it in Scenes.
                </div>
              )}
            </div>

            {/* Big play affordance when idle */}
            {!playing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                <span className="flex size-16 items-center justify-center rounded-full bg-ground/80 backdrop-blur transition-transform group-hover/player:scale-105">
                  {ended ? (
                    <RotateCcw className="size-6 text-ivory" aria-hidden />
                  ) : (
                    <Play className="ms-1 size-6 text-ivory" aria-hidden />
                  )}
                </span>
              </div>
            )}
          </>
        )}

        {/* Chrome label */}
        <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ivory/80 backdrop-blur-sm">
          {chromeLabel}
        </span>
      </div>

      {/* Control bar */}
      <div className="border-t border-seam-strong bg-ground/95 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <WithTooltip label={playing ? "Pause" : ended ? "Replay" : "Play"}>
            <button
              onClick={togglePlay}
              aria-label={playing ? "Pause" : ended ? "Replay" : "Play"}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-overlay text-ink transition-colors hover:bg-seam"
            >
              {playing ? (
                <Pause className="size-4" />
              ) : ended ? (
                <RotateCcw className="size-4" />
              ) : (
                <Play className="ms-0.5 size-4" />
              )}
            </button>
          </WithTooltip>

          <span className="shrink-0 font-mono text-[11px] tabular-nums text-stone">
            {formatDuration(time)} / {formatDuration(total)}
          </span>

          <div className="flex-1 px-1">
            <Slider
              value={[time]}
              max={total}
              step={0.05}
              onValueChange={([value]) => seek(value)}
              aria-label="Seek"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <WithTooltip label={muted ? "Unmute" : "Mute"}>
              <button
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute" : "Mute"}
                className="flex size-8 items-center justify-center rounded-lg text-stone transition-colors hover:bg-overlay hover:text-ink"
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
            </WithTooltip>
            <div className="hidden w-20 sm:block">
              <Slider
                value={[muted ? 0 : volume]}
                max={100}
                step={1}
                onValueChange={([value]) => {
                  setVolume(value);
                  if (muted && value > 0) setMuted(false);
                }}
                aria-label="Volume"
              />
            </div>
            <WithTooltip label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
              <button
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="flex size-8 items-center justify-center rounded-lg text-stone transition-colors hover:bg-overlay hover:text-ink"
              >
                {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
            </WithTooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

function EndCard({
  branding,
  logoUrl,
}: {
  branding: BrandingSettings;
  logoUrl?: string | null;
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 bg-ground px-6 text-center">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="max-h-14 max-w-36 object-contain" />
      ) : (
        branding.brandName && (
          <p className="font-display text-2xl font-medium tracking-tight text-ivory">
            {branding.brandName}
          </p>
        )
      )}
      {branding.cta && (
        <span className="rounded-full bg-ivory px-5 py-2 text-sm font-semibold text-ground">
          {branding.cta}
        </span>
      )}
      {(branding.phone || branding.website) && (
        <p className="font-mono text-[11px] tracking-wide text-stone">
          {[branding.phone, branding.website].filter(Boolean).join(" · ")}
        </p>
      )}
      {branding.showDisclaimer && branding.disclaimer && (
        <p className="absolute bottom-3 left-1/2 w-full max-w-md -translate-x-1/2 px-4 text-[9px] leading-snug text-faint">
          {branding.disclaimer}
        </p>
      )}
    </div>
  );
}
