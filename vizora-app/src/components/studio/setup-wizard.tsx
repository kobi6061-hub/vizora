"use client";

/**
 * Guided project setup: material → property → style → format.
 * Ends by generating the proposed story and dropping into the full studio.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, FolderOpen, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { AssetStrip, LibraryPickerDialog, UploadZone } from "@/components/studio/upload-zone";
import { artById } from "@/lib/data/art-manifest";
import {
  ASPECT_OPTIONS,
  DURATION_OPTIONS,
  OBJECTIVE_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  VIDEO_STYLES,
} from "@/lib/data/video-styles";
import { generateStory } from "@/lib/story/generate-story";
import type { Asset, Project, PropertyType, VideoDuration } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

const CONCEPT_ART: Record<PropertyType, string[]> = {
  apartment: ["park-exterior", "interior-living-2", "park-bedroom", "terrace-2"],
  villa: ["marina-villa", "marina-kitchen", "marina-terrace", "villa-night"],
  "residential-project": ["azure-exterior", "azure-coast", "azure-living", "azure-pool"],
  penthouse: ["park-penthouse", "penthouse-2", "terrace-2", "park-exterior"],
  office: ["meridian-exterior", "office-2", "lobby-2", "meridian-skyline"],
  commercial: ["office-2", "meridian-exterior", "lobby-2", "aerial-2"],
  hotel: ["lobby-2", "meridian-pool", "terrace-2", "tower-marine"],
  land: ["aerial-2", "coast-marine", "grove-plan", "grove-construction"],
  other: ["azure-exterior", "interior-living-2", "terrace-2", "aerial-2"],
};

export function SetupWizard({ project, assets }: { project: Project; assets: Asset[] }) {
  const updateProject = useWorkspaceStore((state) => state.updateProject);
  const transformProject = useWorkspaceStore((state) => state.transformProject);
  const ensureArtAssets = useWorkspaceStore((state) => state.ensureArtAssets);
  const { toast } = useToast();

  const isText = project.method === "text";
  const stepLabels = isText
    ? ["Describe", "Property", "Style", "Format"]
    : ["Upload", "Property", "Style", "Format"];

  const [step, setStep] = React.useState(0);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [building, setBuilding] = React.useState(false);

  /* ------------------------------ step handlers ------------------------------ */

  const addAssets = (added: Asset[]) => {
    transformProject(project.id, (current) => ({
      ...current,
      assetIds: [...current.assetIds, ...added.map((asset) => asset.id).filter((id) => !current.assetIds.includes(id))],
    }));
  };

  const removeAsset = (id: string) => {
    transformProject(project.id, (current) => ({
      ...current,
      assetIds: current.assetIds.filter((assetId) => assetId !== id),
    }));
  };

  const moveAsset = (id: string, direction: -1 | 1) => {
    transformProject(project.id, (current) => {
      const ids = [...current.assetIds];
      const index = ids.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ids.length) return current;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      return { ...current, assetIds: ids };
    });
  };

  const canContinue = () => {
    if (step === 0) {
      return isText ? project.brief.trim().length >= 20 : assets.length >= 1;
    }
    if (step === 1) return project.name.trim().length >= 2;
    if (step === 2) return Boolean(project.styleId);
    return true;
  };

  const continueLabel = () => {
    if (step === 0 && isText && project.brief.trim().length < 20)
      return "Describe the property to continue";
    if (step === 0 && !isText && assets.length === 0) return "Add at least one image";
    if (step === 1 && project.name.trim().length < 2) return "Name the project to continue";
    if (step === 2 && !project.styleId) return "Pick a style to continue";
    return null;
  };

  const finish = () => {
    setBuilding(true);
    // Give the moment a beat — the story reveal lands better.
    window.setTimeout(() => {
      let projectAssets = assets;
      if (isText && assets.length === 0) {
        const artIds = CONCEPT_ART[project.propertyType ?? "other"];
        projectAssets = ensureArtAssets(artIds);
      }
      transformProject(project.id, (current) => {
        const withAssets = {
          ...current,
          assetIds: projectAssets.map((asset) => asset.id),
        };
        return {
          ...withAssets,
          scenes: generateStory(withAssets, projectAssets),
        };
      });
      toast({
        title: "Storyboard ready",
        description: isText
          ? "Vizora drafted concept scenes — swap in your own images anytime."
          : "Vizora proposed a story from your images. Every scene is editable.",
      });
    }, 900);
  };

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="container-page max-w-4xl py-8 lg:py-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/app/create"
          className="inline-flex items-center gap-1.5 text-[13px] text-stone transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </Link>
        <ol className="flex items-center gap-1.5" aria-label="Setup progress">
          {stepLabels.map((label, index) => (
            <li key={label} className="flex items-center gap-1.5">
              <button
                onClick={() => index < step && setStep(index)}
                disabled={index > step}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                  index === step
                    ? "bg-overlay text-ink"
                    : index < step
                      ? "text-ink-mid hover:bg-raised"
                      : "text-faint",
                )}
              >
                {index < step && <Check className="size-3 text-success" aria-hidden />}
                {label}
              </button>
              {index < stepLabels.length - 1 && <span className="h-px w-4 bg-seam" aria-hidden />}
            </li>
          ))}
        </ol>
      </div>

      <div key={step} className="mt-10 animate-fade-up">
        {/* STEP 0 — Upload / Describe */}
        {step === 0 && !isText && (
          <section>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              {project.method === "image" ? "Add your property image" : "Add your property images"}
            </h1>
            <p className="mt-2 text-[15px] text-stone">
              {project.method === "image"
                ? "One strong render or photo is enough — Vizora gives it motion."
                : "Renders, photos, plans — Vizora sequences them into a story. Order them roughly as you'd tour the property."}
            </p>
            <div className="mt-8 space-y-5">
              {assets.length > 0 && (
                <AssetStrip assets={assets} onRemove={removeAsset} onMove={moveAsset} />
              )}
              <UploadZone
                onAssets={addAssets}
                multiple={project.method !== "image"}
                currentCount={assets.length}
                compact={assets.length > 0}
              />
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setLibraryOpen(true)}>
                  <FolderOpen className="size-4" aria-hidden />
                  Add from library
                </Button>
                {assets.length > 0 && (
                  <p className="font-mono text-[11px] text-faint">
                    {assets.length} image{assets.length === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            </div>
            <LibraryPickerDialog
              open={libraryOpen}
              onOpenChange={setLibraryOpen}
              excludeIds={project.assetIds}
              onPick={addAssets}
            />
          </section>
        )}

        {step === 0 && isText && (
          <section>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Describe the video you need
            </h1>
            <p className="mt-2 text-[15px] text-stone">
              Property, audience, feeling — plain language is perfect. Vizora
              drafts the concept and scene structure from it.
            </p>
            <div className="mt-8">
              <Textarea
                value={project.brief}
                onChange={(event) => updateProject(project.id, { brief: event.target.value })}
                placeholder="e.g. Create a cinematic 30-second video for a luxury beachfront residential development in Cyprus targeting international investors."
                className="min-h-40 text-[15px]"
                aria-label="Describe the property or campaign"
                autoFocus
              />
              <p className="mt-2 text-[12px] text-faint">
                {project.brief.trim().length < 20
                  ? `${Math.max(0, 20 - project.brief.trim().length)} more characters to go`
                  : "Vizora will propose concept visuals you can replace with real images later."}
              </p>
            </div>
          </section>
        )}

        {/* STEP 1 — Property */}
        {step === 1 && (
          <section>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Tell Vizora about the property
            </h1>
            <p className="mt-2 text-[15px] text-stone">
              A few details shape the story, the copy and the call to action.
            </p>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              <Field label="Property / project name" htmlFor="setup-name" className="sm:col-span-2">
                <Input
                  id="setup-name"
                  value={project.name === "Untitled property" ? "" : project.name}
                  onChange={(event) =>
                    updateProject(project.id, { name: event.target.value || "Untitled property" })
                  }
                  placeholder="e.g. Azure Residences"
                  autoFocus
                />
              </Field>
              <Field label="Property type" htmlFor="setup-type">
                <Select
                  value={project.propertyType ?? undefined}
                  onValueChange={(value) =>
                    updateProject(project.id, { propertyType: value as PropertyType })
                  }
                >
                  <SelectTrigger id="setup-type">
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROPERTY_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Location" htmlFor="setup-location">
                <Input
                  id="setup-location"
                  value={project.location}
                  onChange={(event) => updateProject(project.id, { location: event.target.value })}
                  placeholder="e.g. Limassol, Cyprus"
                />
              </Field>
              <Field label="Marketing objective" htmlFor="setup-objective" className="sm:col-span-2">
                <Select
                  value={project.objective ?? undefined}
                  onValueChange={(value) =>
                    updateProject(project.id, {
                      objective: value as Project["objective"],
                    })
                  }
                >
                  <SelectTrigger id="setup-objective">
                    <SelectValue placeholder="What should this video achieve?" />
                  </SelectTrigger>
                  <SelectContent>
                    {OBJECTIVE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {!isText && (
                <Field
                  label="What should viewers feel or know?"
                  htmlFor="setup-brief"
                  optional
                  className="sm:col-span-2"
                >
                  <Textarea
                    id="setup-brief"
                    value={project.brief}
                    onChange={(event) => updateProject(project.id, { brief: event.target.value })}
                    placeholder="e.g. Calm seafront living, five minutes from the marina. Aimed at international buyers."
                  />
                </Field>
              )}
            </div>
          </section>
        )}

        {/* STEP 2 — Style */}
        {step === 2 && (
          <section>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Choose a video style
            </h1>
            <p className="mt-2 text-[15px] text-stone">
              The style sets pacing, tone of voice and music direction.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {VIDEO_STYLES.map((style) => {
                const selected = project.styleId === style.id;
                return (
                  <button
                    key={style.id}
                    onClick={() => updateProject(project.id, { styleId: style.id })}
                    aria-pressed={selected}
                    className={cn(
                      "group overflow-hidden rounded-2xl border text-start transition-colors",
                      selected
                        ? "border-signal bg-surface"
                        : "border-seam bg-surface/60 hover:border-seam-strong hover:bg-surface",
                    )}
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={artById(style.coverId).src}
                        alt=""
                        aria-hidden
                        className="aspect-[16/9] w-full object-cover"
                      />
                      {selected && (
                        <span className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-full bg-signal">
                          <Check className="size-3.5 text-ivory" aria-hidden />
                        </span>
                      )}
                    </div>
                    <div className="p-4">
                      <h3 className="font-display text-[15px] font-medium text-ink">{style.name}</h3>
                      <p className="mt-1 text-[12px] leading-relaxed text-stone">{style.tagline}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* STEP 3 — Format & length */}
        {step === 3 && (
          <section>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Format and length
            </h1>
            <p className="mt-2 text-[15px] text-stone">
              Where will this video live? You can render other formats later.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {ASPECT_OPTIONS.map((option) => {
                const selected = project.aspectRatio === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => updateProject(project.id, { aspectRatio: option.id })}
                    aria-pressed={selected}
                    className={cn(
                      "flex flex-col items-center rounded-2xl border p-6 transition-colors",
                      selected
                        ? "border-signal bg-surface"
                        : "border-seam bg-surface/60 hover:border-seam-strong",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "rounded-md border-2",
                        selected ? "border-signal-bright" : "border-faint",
                        option.id === "9:16" && "h-14 w-8",
                        option.id === "1:1" && "size-11",
                        option.id === "16:9" && "h-8 w-14",
                      )}
                    />
                    <span className="mt-4 font-mono text-sm text-ink">{option.id}</span>
                    <span className="mt-1 text-center text-[12px] text-stone">{option.useFor}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {DURATION_OPTIONS.map((option) => {
                const selected = project.durationSec === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() =>
                      updateProject(project.id, { durationSec: option.value as VideoDuration })
                    }
                    aria-pressed={selected}
                    className={cn(
                      "relative rounded-xl border px-5 py-3 text-start transition-colors",
                      selected
                        ? "border-signal bg-surface"
                        : "border-seam bg-surface/60 hover:border-seam-strong",
                    )}
                  >
                    <span className="block font-mono text-sm text-ink">{option.label}</span>
                    <span className="block text-[11px] text-stone">{option.hint}</span>
                    {option.recommended && (
                      <span className="absolute -top-2 right-3 rounded-full bg-signal/15 px-2 py-0.5 text-[10px] font-medium text-signal-bright">
                        Recommended
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Footer nav */}
      <div className="mt-12 flex items-center justify-between border-t border-seam pt-6">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
        <div className="flex items-center gap-4">
          {continueLabel() && <p className="hidden text-[12px] text-faint sm:block">{continueLabel()}</p>}
          {step < 3 ? (
            <Button size="lg" onClick={() => setStep((s) => s + 1)} disabled={!canContinue()}>
              Continue
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button size="lg" onClick={finish} loading={building}>
              {building ? (
                "Composing your story…"
              ) : (
                <>
                  <Sparkles className="size-4" aria-hidden />
                  Build my storyboard
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Cancel affordance */}
      <div className="mt-4 text-end">
        <Link
          href="/app"
          className="inline-flex items-center gap-1 text-[12px] text-faint transition-colors hover:text-ink"
        >
          <X className="size-3" aria-hidden />
          Save draft and exit
        </Link>
      </div>
    </div>
  );
}
