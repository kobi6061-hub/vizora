"use client";

/**
 * Right panel: creative settings and AI direction.
 * Direct (style/format/length/direction) · Brand · Music · Voice.
 */

import * as React from "react";
import { CloudUpload, Mic, Pause, Play, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Slider, Switch } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, SegmentedList, SegmentedTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { AssetThumb } from "@/components/studio/upload-zone";
import { useUploadAssets } from "@/components/studio/upload-zone";
import { previewSynth, voiceoverPreview, VOICE_LANGUAGES } from "@/lib/audio/preview-synth";
import { artById } from "@/lib/data/art-manifest";
import { MUSIC_CATEGORIES, MUSIC_TRACKS, trackById } from "@/lib/data/music";
import {
  ASPECT_OPTIONS,
  DURATION_OPTIONS,
  VIDEO_STYLES,
} from "@/lib/data/video-styles";
import { draftVoiceoverScript } from "@/lib/story/generate-story";
import type { BrandingSettings, Project, VideoDuration } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn, formatDuration } from "@/lib/utils";

export function DirectionPanel({ project }: { project: Project }) {
  return (
    <div className="rounded-2xl border border-seam bg-surface/40">
      <Tabs defaultValue="direct">
        <div className="border-b border-seam p-2.5">
          <SegmentedList className="w-full justify-between border-none bg-transparent p-0">
            <SegmentedTrigger value="direct">Direct</SegmentedTrigger>
            <SegmentedTrigger value="brand">Brand</SegmentedTrigger>
            <SegmentedTrigger value="music">Music</SegmentedTrigger>
            <SegmentedTrigger value="voice">Voice</SegmentedTrigger>
          </SegmentedList>
        </div>
        <TabsContent value="direct">
          <DirectTab project={project} />
        </TabsContent>
        <TabsContent value="brand">
          <BrandTab project={project} />
        </TabsContent>
        <TabsContent value="music">
          <MusicTab project={project} />
        </TabsContent>
        <TabsContent value="voice">
          <VoiceTab project={project} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* --------------------------------- Direct --------------------------------- */

function DirectTab({ project }: { project: Project }) {
  const updateProject = useWorkspaceStore((state) => state.updateProject);

  return (
    <div className="space-y-6 p-4">
      <section>
        <h3 className="text-[13px] font-medium text-ink-mid">Style</h3>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {VIDEO_STYLES.map((style) => {
            const selected = project.styleId === style.id;
            return (
              <button
                key={style.id}
                onClick={() => updateProject(project.id, { styleId: style.id })}
                aria-pressed={selected}
                className={cn(
                  "overflow-hidden rounded-xl border text-start transition-colors",
                  selected
                    ? "border-signal bg-raised"
                    : "border-seam bg-raised/50 hover:border-seam-strong",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artById(style.coverId).src}
                  alt=""
                  aria-hidden
                  className="aspect-[16/7] w-full object-cover"
                />
                <span className="block px-2.5 py-1.5 text-[12px] font-medium text-ink">
                  {style.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-ink-mid">Format</h3>
        <div className="mt-2.5 flex gap-2">
          {ASPECT_OPTIONS.map((option) => {
            const selected = project.aspectRatio === option.id;
            return (
              <button
                key={option.id}
                onClick={() => updateProject(project.id, { aspectRatio: option.id })}
                aria-pressed={selected}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-3 transition-colors",
                  selected
                    ? "border-signal bg-raised"
                    : "border-seam bg-raised/50 hover:border-seam-strong",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "rounded-[3px] border-2",
                    selected ? "border-signal-bright" : "border-faint",
                    option.id === "9:16" && "h-7 w-4",
                    option.id === "1:1" && "size-5.5",
                    option.id === "16:9" && "h-4 w-7",
                  )}
                />
                <span className="font-mono text-[11px] text-ink">{option.id}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-ink-mid">Length</h3>
        <div className="mt-2.5 flex gap-1.5">
          {DURATION_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => updateProject(project.id, { durationSec: option.value as VideoDuration })}
              aria-pressed={project.durationSec === option.value}
              className={cn(
                "flex-1 rounded-lg border px-2 py-2 font-mono text-[12px] transition-colors",
                project.durationSec === option.value
                  ? "border-signal bg-raised text-ink"
                  : "border-seam bg-raised/50 text-stone hover:border-seam-strong hover:text-ink",
              )}
            >
              {option.value}s
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-ink-mid">
          <Sparkles className="size-3.5 text-signal-bright" aria-hidden />
          Direct your video
        </h3>
        <Textarea
          value={project.direction}
          onChange={(event) => updateProject(project.id, { direction: event.target.value })}
          placeholder="“Make it feel luxurious and calm. Focus on the sea view and finish with the project logo.”"
          className="mt-2.5 min-h-24 text-[13px]"
          aria-label="Direct your video"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Plain language is enough — your direction guides pacing, framing and
          copy on the next generation.
        </p>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-ink-mid">What should viewers feel or know?</h3>
        <Textarea
          value={project.brief}
          onChange={(event) => updateProject(project.id, { brief: event.target.value })}
          placeholder="e.g. Calm seafront living, five minutes from the marina."
          className="mt-2.5 min-h-20 text-[13px]"
          aria-label="What should viewers feel or know"
        />
      </section>
    </div>
  );
}

/* ---------------------------------- Brand ---------------------------------- */

const PLACEMENTS: { id: BrandingSettings["placement"]; label: string }[] = [
  { id: "top-start", label: "Top left" },
  { id: "top-end", label: "Top right" },
  { id: "bottom-start", label: "Bottom left" },
  { id: "bottom-end", label: "Bottom right" },
];

function BrandTab({ project }: { project: Project }) {
  const transformProject = useWorkspaceStore((state) => state.transformProject);
  const allAssets = useWorkspaceStore((state) => state.assets);
  const { upload, uploading } = useUploadAssets();
  const logoInputRef = React.useRef<HTMLInputElement>(null);

  const patch = (patchValue: Partial<BrandingSettings>) => {
    transformProject(project.id, (current) => ({
      ...current,
      branding: { ...current.branding, ...patchValue },
    }));
  };

  const branding = project.branding;
  const logoAsset = branding.logoAssetId
    ? allAssets.find((asset) => asset.id === branding.logoAssetId) ?? null
    : null;

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium text-ink">Show branding</h3>
          <p className="text-[11px] text-faint">Name overlay and end card on the video.</p>
        </div>
        <Switch
          checked={branding.showBranding}
          onCheckedChange={(checked) => patch({ showBranding: checked })}
          aria-label="Show branding"
        />
      </div>

      <div className={cn("space-y-4", !branding.showBranding && "pointer-events-none opacity-40")}>
        <section>
          <h4 className="mb-2 text-[13px] font-medium text-ink-mid">Logo</h4>
          {logoAsset ? (
            <div className="flex items-center gap-3 rounded-xl border border-seam bg-raised p-2.5">
              <div className="flex h-10 w-16 items-center justify-center overflow-hidden rounded-md bg-ground">
                <AssetThumb asset={logoAsset} className="max-h-full max-w-full object-contain" />
              </div>
              <p className="min-w-0 flex-1 truncate text-[12px] text-ink-mid">{logoAsset.name}</p>
              <button
                aria-label="Remove logo"
                onClick={() => patch({ logoAssetId: null })}
                className="rounded-md p-1.5 text-faint transition-colors hover:bg-overlay hover:text-danger"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => logoInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-seam-strong px-3 py-4 text-[12px] text-stone transition-colors hover:border-faint hover:text-ink"
            >
              <CloudUpload className="size-4" aria-hidden />
              {uploading.length > 0 ? "Uploading…" : "Upload logo (PNG or SVG)"}
            </button>
          )}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/svg+xml,image/webp"
            className="sr-only"
            onChange={(event) => {
              if (event.target.files?.length) {
                void upload(
                  event.target.files,
                  (assetsAdded) => patch({ logoAssetId: assetsAdded[0]?.id ?? null }),
                  "logo",
                );
              }
              event.target.value = "";
            }}
          />
        </section>

        <Field label="Brand name" htmlFor="brand-name">
          <Input
            id="brand-name"
            value={branding.brandName}
            onChange={(event) => patch({ brandName: event.target.value })}
            placeholder="e.g. Northview Estates"
          />
        </Field>
        <Field label="Call to action" htmlFor="brand-cta">
          <Input
            id="brand-cta"
            value={branding.cta}
            onChange={(event) => patch({ cta: event.target.value })}
            placeholder="e.g. Book a viewing"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" htmlFor="brand-phone">
            <Input
              id="brand-phone"
              value={branding.phone}
              onChange={(event) => patch({ phone: event.target.value })}
              placeholder="+357 25 000 000"
            />
          </Field>
          <Field label="Website" htmlFor="brand-website">
            <Input
              id="brand-website"
              value={branding.website}
              onChange={(event) => patch({ website: event.target.value })}
              placeholder="yourbrand.com"
            />
          </Field>
        </div>

        <section>
          <h4 className="mb-2 text-[13px] font-medium text-ink-mid">Name placement</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {PLACEMENTS.map((placement) => (
              <button
                key={placement.id}
                onClick={() => patch({ placement: placement.id })}
                aria-pressed={branding.placement === placement.id}
                className={cn(
                  "rounded-lg border px-2.5 py-2 text-[12px] transition-colors",
                  branding.placement === placement.id
                    ? "border-signal bg-raised text-ink"
                    : "border-seam bg-raised/50 text-stone hover:border-seam-strong",
                )}
              >
                {placement.label}
              </button>
            ))}
          </div>
        </section>

        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-[13px] font-medium text-ink">Legal disclaimer</h4>
            <p className="text-[11px] text-faint">Small print on the end card.</p>
          </div>
          <Switch
            checked={branding.showDisclaimer}
            onCheckedChange={(checked) => patch({ showDisclaimer: checked })}
            aria-label="Show disclaimer"
          />
        </div>
        {branding.showDisclaimer && (
          <Textarea
            value={branding.disclaimer}
            onChange={(event) => patch({ disclaimer: event.target.value })}
            className="min-h-16 text-[12px]"
            aria-label="Disclaimer text"
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Music ---------------------------------- */

function MusicTab({ project }: { project: Project }) {
  const transformProject = useWorkspaceStore((state) => state.transformProject);
  const [category, setCategory] = React.useState(
    trackById(project.music.trackId ?? "")?.category ?? "cinematic",
  );
  const [previewingId, setPreviewingId] = React.useState<string | null>(null);
  const { toast } = useToast();

  React.useEffect(() => () => previewSynth.stop(), []);

  const patchMusic = (value: Partial<Project["music"]>) => {
    transformProject(project.id, (current) => ({
      ...current,
      music: { ...current.music, ...value },
    }));
  };

  const tracks = MUSIC_TRACKS.filter((track) => track.category === category);

  const togglePreview = async (trackId: string) => {
    if (previewingId === trackId) {
      previewSynth.stop();
      setPreviewingId(null);
      return;
    }
    const track = trackById(trackId);
    if (!track) return;
    const ok = await previewSynth.play(track, project.music.volume);
    if (!ok) {
      toast({
        title: "Audio preview unavailable",
        description: "Your browser blocked audio playback.",
        variant: "error",
      });
      return;
    }
    setPreviewingId(trackId);
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-1.5">
        {MUSIC_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            aria-pressed={category === cat.id}
            className={cn(
              "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
              category === cat.id
                ? "border-ivory bg-ivory text-ground"
                : "border-seam text-stone hover:border-seam-strong hover:text-ink",
            )}
          >
            {cat.name}
          </button>
        ))}
      </div>

      <ul className="space-y-1.5">
        {tracks.map((track) => {
          const selected = project.music.trackId === track.id;
          const previewing = previewingId === track.id;
          return (
            <li
              key={track.id}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border p-2 transition-colors",
                selected ? "border-signal bg-raised" : "border-seam bg-raised/50",
              )}
            >
              <button
                onClick={() => void togglePreview(track.id)}
                aria-label={previewing ? `Stop preview of ${track.name}` : `Preview ${track.name}`}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  previewing
                    ? "bg-signal text-ivory"
                    : "bg-overlay text-ink-mid hover:text-ink",
                )}
              >
                {previewing ? <Pause className="size-3.5" /> : <Play className="ms-0.5 size-3.5" />}
              </button>
              <button
                onClick={() => patchMusic({ trackId: track.id })}
                className="min-w-0 flex-1 text-start"
              >
                <p className="truncate text-[13px] font-medium text-ink">{track.name}</p>
                <p className="font-mono text-[10px] text-faint">
                  {formatDuration(track.durationSec)} · {track.bpm} BPM
                </p>
              </button>
              {selected && (
                <span className="shrink-0 rounded-full bg-signal/15 px-2 py-0.5 text-[10px] font-medium text-signal-bright">
                  Selected
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <button
        onClick={() => {
          patchMusic({ trackId: null });
          previewSynth.stop();
          setPreviewingId(null);
        }}
        aria-pressed={project.music.trackId === null}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-[13px] transition-colors",
          project.music.trackId === null
            ? "border-signal bg-raised text-ink"
            : "border-seam bg-raised/50 text-stone hover:border-seam-strong",
        )}
      >
        <Square className="size-3.5" aria-hidden />
        No music
      </button>

      <div>
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-medium text-ink-mid">Music volume</h4>
          <span className="font-mono text-[11px] text-faint">{project.music.volume}%</span>
        </div>
        <Slider
          value={[project.music.volume]}
          max={100}
          step={1}
          onValueChange={([value]) => {
            patchMusic({ volume: value });
            previewSynth.setVolume(value);
          }}
          aria-label="Music volume"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        Previews are generated in-browser. Licensed tracks connect with the
        production music provider.
      </p>
    </div>
  );
}

/* ---------------------------------- Voice ---------------------------------- */

function VoiceTab({ project }: { project: Project }) {
  const transformProject = useWorkspaceStore((state) => state.transformProject);
  const [speaking, setSpeaking] = React.useState(false);
  const supported = voiceoverPreview.supported();

  React.useEffect(() => () => voiceoverPreview.stop(), []);

  const patchVoice = (value: Partial<Project["voiceover"]>) => {
    transformProject(project.id, (current) => ({
      ...current,
      voiceover: { ...current.voiceover, ...value },
    }));
  };

  const voiceover = project.voiceover;

  const preview = () => {
    if (speaking) {
      voiceoverPreview.stop();
      setSpeaking(false);
      return;
    }
    const script = voiceover.script || draftVoiceoverScript(project, project.scenes);
    const ok = voiceoverPreview.speak(script, voiceover.language, voiceover.voice, () =>
      setSpeaking(false),
    );
    if (ok) setSpeaking(true);
  };

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium text-ink">AI voiceover</h3>
          <p className="text-[11px] text-faint">Narrate the story over your video.</p>
        </div>
        <Switch
          checked={voiceover.enabled}
          onCheckedChange={(checked) => {
            patchVoice({ enabled: checked });
            if (checked && !voiceover.script) {
              patchVoice({ script: draftVoiceoverScript(project, project.scenes) });
            }
          }}
          aria-label="Enable AI voiceover"
        />
      </div>

      <div className={cn("space-y-4", !voiceover.enabled && "pointer-events-none opacity-40")}>
        <div className="grid grid-cols-2 gap-2">
          {(["female", "male"] as const).map((voice) => (
            <button
              key={voice}
              onClick={() => patchVoice({ voice })}
              aria-pressed={voiceover.voice === voice}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border py-4 transition-colors",
                voiceover.voice === voice
                  ? "border-signal bg-raised"
                  : "border-seam bg-raised/50 hover:border-seam-strong",
              )}
            >
              <Mic
                className={cn(
                  "size-4",
                  voiceover.voice === voice ? "text-signal-bright" : "text-stone",
                )}
                aria-hidden
              />
              <span className="text-[13px] font-medium capitalize text-ink">{voice}</span>
              <span className="text-[10px] text-faint">
                {voice === "female" ? "Warm, assured" : "Deep, confident"}
              </span>
            </button>
          ))}
        </div>

        <Field label="Language" htmlFor="voice-language">
          <Select
            value={voiceover.language}
            onValueChange={(value) => patchVoice({ language: value })}
          >
            <SelectTrigger id="voice-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICE_LANGUAGES.map((language) => (
                <SelectItem key={language.id} value={language.id}>
                  {language.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="voice-script" className="text-[13px] font-medium text-ink-mid">
              Script
            </label>
            <button
              onClick={() => patchVoice({ script: draftVoiceoverScript(project, project.scenes) })}
              className="text-[11px] font-medium text-signal-bright transition-colors hover:text-ink"
            >
              Draft from story
            </button>
          </div>
          <Textarea
            id="voice-script"
            value={voiceover.script}
            onChange={(event) => patchVoice({ script: event.target.value })}
            placeholder="Vizora can draft this from your scenes."
            className="min-h-28 text-[13px]"
          />
        </div>

        <Button variant="outline" size="sm" className="w-full" onClick={preview} disabled={!supported}>
          {speaking ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {speaking ? "Stop preview" : "Preview voice"}
        </Button>
        <p className="text-[11px] leading-relaxed text-faint">
          {supported
            ? "Previews use your browser's built-in voices. Studio-grade AI voices connect with the production provider."
            : "Voice preview isn't available in this browser. Studio-grade AI voices connect with the production provider."}
        </p>
      </div>
    </div>
  );
}
