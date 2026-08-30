"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Film, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { DirectionPanel } from "@/components/studio/direction-panel";
import { PreviewPlayer, type PlayerScene } from "@/components/studio/preview-player";
import { SceneRail } from "@/components/studio/scene-rail";
import { useAssetUrl, useAssetUrls } from "@/lib/hooks/use-asset-url";
import type { Asset, Project } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export function usePlayerScenes(project: Project, assets: Asset[]): PlayerScene[] {
  const urls = useAssetUrls(assets);
  return project.scenes
    .filter((scene) => !scene.hidden)
    .map((scene) => {
      const asset = scene.assetId ? assets.find((a) => a.id === scene.assetId) : null;
      return {
        id: scene.id,
        kind: scene.kind,
        url: asset ? (urls[asset.id] ?? null) : null,
        alt: asset?.name ?? "",
        caption: scene.kind === "endcard" ? "" : scene.caption,
        motion: scene.motion,
      };
    });
}

export function StudioWorkspace({
  project,
  assets,
  onGenerate,
  onShowResult,
}: {
  project: Project;
  assets: Asset[];
  onGenerate: () => void;
  onShowResult?: () => void;
}) {
  const updateProject = useWorkspaceStore((state) => state.updateProject);
  const allAssets = useWorkspaceStore((state) => state.assets);
  const playerScenes = usePlayerScenes(project, assets);
  const logoAsset = project.branding.logoAssetId
    ? allAssets.find((asset) => asset.id === project.branding.logoAssetId) ?? null
    : null;
  const logoUrl = useAssetUrl(logoAsset?.src ?? null);

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col lg:h-[calc(100dvh)] lg:min-h-0">
      {/* Project bar */}
      <div className="flex items-center justify-between gap-3 border-b border-seam bg-surface/40 px-4 py-3 lg:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/app/projects"
            aria-label="Back to projects"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-stone transition-colors hover:bg-raised hover:text-ink"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <input
            value={project.name}
            onChange={(event) => updateProject(project.id, { name: event.target.value })}
            aria-label="Project name"
            className="w-full min-w-0 max-w-64 truncate rounded-md bg-transparent px-1.5 py-1 font-display text-[15px] font-medium text-ink outline-none transition-colors hover:bg-raised focus:bg-raised"
          />
          <div className="hidden sm:block">
            <StatusBadge status={project.status} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden font-mono text-[11px] text-faint md:block">
            {project.aspectRatio} · {project.durationSec}s ·{" "}
            {playerScenes.length} scene{playerScenes.length === 1 ? "" : "s"}
          </span>
          {onShowResult && (
            <Button variant="ghost" size="sm" onClick={onShowResult}>
              <Film className="size-4" aria-hidden />
              <span className="hidden sm:inline">Last render</span>
            </Button>
          )}
          <Button onClick={onGenerate}>
            <Play className="size-4" aria-hidden />
            Generate video
          </Button>
        </div>
      </div>

      {/* Workspace */}
      <div className="flex flex-1 flex-col gap-4 overflow-visible p-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)_330px] lg:gap-4 lg:overflow-hidden lg:p-4">
        {/* Center preview — first on mobile */}
        <div className="order-1 flex min-h-0 items-start justify-center lg:order-2 lg:items-center">
          <PreviewPlayer
            scenes={playerScenes}
            durationSec={project.durationSec}
            aspect={project.aspectRatio}
            branding={project.branding}
            brandLogoUrl={logoUrl}
            music={project.music}
            voiceover={project.voiceover}
            chromeLabel={project.result ? "Preview render" : "Storyboard preview"}
            className={
              project.aspectRatio === "9:16"
                ? "w-full max-w-[300px] lg:max-h-full"
                : project.aspectRatio === "1:1"
                  ? "w-full max-w-[440px]"
                  : "w-full max-w-3xl"
            }
          />
        </div>

        {/* Scenes / assets rail */}
        <div className="order-2 min-h-0 lg:order-1 lg:overflow-y-auto">
          <SceneRail project={project} assets={assets} />
        </div>

        {/* Direction panel */}
        <div className="order-3 min-h-0 lg:overflow-y-auto">
          <DirectionPanel project={project} />
        </div>
      </div>
    </div>
  );
}
