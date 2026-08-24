"use client";

import * as React from "react";
import Link from "next/link";
import { Clapperboard, MapPin } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { ProjectActionsMenu } from "@/components/app/project-actions";
import { useAssetUrl } from "@/lib/hooks/use-asset-url";
import type { Project } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn, formatRelativeTime } from "@/lib/utils";

export function ProjectCover({
  project,
  className,
}: {
  project: Project;
  className?: string;
}) {
  const assets = useWorkspaceStore((state) => state.assets);
  const cover = project.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .find(Boolean);
  const url = useAssetUrl(cover?.src ?? null);

  if (!url) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-raised text-faint",
          className,
        )}
      >
        <Clapperboard className="size-6" aria-hidden />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={cn("object-cover", className)} />
  );
}

export function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-seam bg-surface/60 transition-colors hover:border-seam-strong hover:bg-surface">
      <Link
        href={`/app/projects/${project.id}`}
        className="absolute inset-0 z-0"
        aria-label={`Open ${project.name}`}
      />
      <div className="pointer-events-none relative">
        <ProjectCover
          project={project}
          className="aspect-[16/10] w-full transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        />
        <div className="absolute left-3 top-3">
          <StatusBadge status={project.status} />
        </div>
        <span className="absolute bottom-3 right-3 rounded-md bg-ground/80 px-2 py-0.5 font-mono text-[10px] text-ink-mid backdrop-blur">
          {project.aspectRatio} · {project.durationSec}s
        </span>
      </div>
      <div className="relative z-10 pointer-events-none flex items-start justify-between gap-2 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-ink">{project.name}</h3>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-stone">
            {project.location && (
              <>
                <MapPin className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{project.location}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span className="shrink-0">{formatRelativeTime(project.updatedAt)}</span>
          </p>
        </div>
        <div className="pointer-events-auto -me-1 -mt-1">
          <ProjectActionsMenu project={project} />
        </div>
      </div>
    </article>
  );
}
