"use client";

/**
 * The payoff. "Your video is ready." — large auto-playing preview,
 * download/share/duplicate/edit, and a clear path to the next version.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Download,
  Layers,
  PencilLine,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ProjectActionDialogs,
  useProjectActions,
} from "@/components/app/project-actions";
import { PreviewPlayer } from "@/components/studio/preview-player";
import { usePlayerScenes } from "@/components/studio/studio-workspace";
import { useToast } from "@/components/ui/toast";
import { videoStyleById } from "@/lib/data/video-styles";
import { useAssetUrl } from "@/lib/hooks/use-asset-url";
import type { Asset, Project } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

export function ResultView({
  project,
  assets,
  onEdit,
  onCreateVersion,
}: {
  project: Project;
  assets: Asset[];
  onEdit: () => void;
  onCreateVersion: (copyId: string) => void;
}) {
  const duplicateProject = useWorkspaceStore((state) => state.duplicateProject);
  const updateProject = useWorkspaceStore((state) => state.updateProject);
  const allAssets = useWorkspaceStore((state) => state.assets);
  const actions = useProjectActions(project);
  const { toast } = useToast();

  const playerScenes = usePlayerScenes(project, assets);
  const logoAsset = project.branding.logoAssetId
    ? allAssets.find((asset) => asset.id === project.branding.logoAssetId) ?? null
    : null;
  const logoUrl = useAssetUrl(logoAsset?.src ?? null);

  const createVersion = () => {
    const copy = duplicateProject(project.id);
    if (!copy) return;
    updateProject(copy.id, {
      name: `${project.name} — v2`,
      status: "draft",
      result: undefined,
      generation: undefined,
    });
    toast({
      title: "New version created",
      description: "Adjust anything and generate again.",
    });
    onCreateVersion(copy.id);
  };

  return (
    <div className="container-page max-w-5xl py-8 lg:py-12">
      <Link
        href="/app/projects"
        className="inline-flex items-center gap-1.5 text-[13px] text-stone transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Projects
      </Link>

      <div className="mt-6 text-center">
        <p className="text-eyebrow animate-fade-up">
          {project.name}
          {project.location ? ` · ${project.location}` : ""}
        </p>
        <h1 className="text-display mt-3 animate-fade-up text-4xl text-ink [animation-delay:80ms] md:text-5xl">
          Your video is <em className="text-serif-accent">ready.</em>
        </h1>
      </div>

      <div className="mt-10 flex animate-fade-up justify-center [animation-delay:160ms]">
        <PreviewPlayer
          scenes={playerScenes}
          durationSec={project.durationSec}
          aspect={project.aspectRatio}
          branding={project.branding}
          brandLogoUrl={logoUrl}
          music={project.music}
          voiceover={project.voiceover}
          chromeLabel="Preview render"
          autoPlay
          className={
            project.aspectRatio === "9:16"
              ? "w-full max-w-xs"
              : project.aspectRatio === "1:1"
                ? "w-full max-w-lg"
                : "w-full max-w-3xl"
          }
        />
      </div>

      <p className="mt-4 text-center font-mono text-[11px] text-faint">
        {project.aspectRatio} · {project.durationSec}s ·{" "}
        {project.styleId ? videoStyleById(project.styleId).name : "—"} ·{" "}
        {playerScenes.length} scenes
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
        <Button size="lg" onClick={() => actions.setDialog("download")}>
          <Download className="size-4" aria-hidden />
          Download
        </Button>
        <Button size="lg" variant="outline" onClick={createVersion}>
          <Layers className="size-4" aria-hidden />
          Create another version
        </Button>
        <Button size="lg" variant="outline" onClick={onEdit}>
          <PencilLine className="size-4" aria-hidden />
          Edit
        </Button>
        <Button size="lg" variant="outline" onClick={actions.duplicate}>
          <Copy className="size-4" aria-hidden />
          Duplicate
        </Button>
        <Button size="lg" variant="outline" onClick={() => actions.setDialog("share")}>
          <Share2 className="size-4" aria-hidden />
          Share
        </Button>
      </div>

      <ProjectActionDialogs project={project} actions={actions} />
    </div>
  );
}
