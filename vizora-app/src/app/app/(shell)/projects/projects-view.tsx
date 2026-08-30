"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp,
  Clapperboard,
  LayoutGrid,
  List,
  MapPin,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectCard, ProjectCover } from "@/components/app/project-card";
import { ProjectActionsMenu } from "@/components/app/project-actions";
import type { ProjectStatus } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn, formatRelativeTime } from "@/lib/utils";

type SortKey = "updated" | "name" | "created";

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Last edited",
  name: "Name",
  created: "Newest first",
};

const STATUS_FILTERS: { id: ProjectStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "generating", label: "Generating" },
  { id: "ready", label: "Ready" },
  { id: "failed", label: "Failed" },
];

export function ProjectsView() {
  const projects = useWorkspaceStore((state) => state.projects);
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<ProjectStatus | "all">("all");
  const [sort, setSort] = React.useState<SortKey>("updated");
  const [layout, setLayout] = React.useState<"grid" | "list">("grid");

  const filtered = projects
    .filter((project) => (status === "all" ? true : project.status === status))
    .filter((project) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        project.name.toLowerCase().includes(q) || project.location.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const isEmpty = projects.length === 0;
  const isFilteredEmpty = !isEmpty && filtered.length === 0;

  return (
    <div className="container-page max-w-6xl space-y-6 py-8 lg:py-10">
      <PageHeader
        title="Projects"
        description="Every property video in your workspace."
        actions={
          <Link href="/app/create">
            <Button>
              <Plus className="size-4" aria-hidden />
              Create project
            </Button>
          </Link>
        }
      />

      {!isEmpty && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or location"
              aria-label="Search projects"
              className="ps-9"
            />
          </div>

          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                onClick={() => setStatus(filter.id)}
                aria-pressed={status === filter.id}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                  status === filter.id
                    ? "border-ivory bg-ivory text-ground"
                    : "border-seam text-stone hover:border-seam-strong hover:text-ink",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="ms-auto flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <ArrowDownUp className="size-3.5" aria-hidden />
                  {SORT_LABELS[sort]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <DropdownMenuItem key={key} onSelect={() => setSort(key)}>
                    {SORT_LABELS[key]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex rounded-lg border border-seam p-0.5">
              <button
                onClick={() => setLayout("grid")}
                aria-label="Grid view"
                aria-pressed={layout === "grid"}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  layout === "grid" ? "bg-overlay text-ink" : "text-faint hover:text-ink",
                )}
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                onClick={() => setLayout("list")}
                aria-label="List view"
                aria-pressed={layout === "list"}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  layout === "list" ? "bg-overlay text-ink" : "text-faint hover:text-ink",
                )}
              >
                <List className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {isEmpty ? (
        <EmptyState
          icon={<Clapperboard className="size-5" aria-hidden />}
          title="Your next property deserves more than a slideshow."
          description="Turn renders and photos into a marketing video in about five minutes."
          action={
            <Link href="/app/create">
              <Button size="lg">Create your first video</Button>
            </Link>
          }
        />
      ) : isFilteredEmpty ? (
        <EmptyState
          icon={<Search className="size-5" aria-hidden />}
          title="No projects match"
          description="Try a different search or clear the status filter."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : layout === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-seam">
          {filtered.map((project, index) => (
            <li
              key={project.id}
              className={cn(
                "group relative flex cursor-pointer items-center gap-4 bg-surface/40 px-4 py-3 transition-colors hover:bg-surface",
                index > 0 && "border-t border-seam",
              )}
              onClick={() => router.push(`/app/projects/${project.id}`)}
            >
              <div className="h-12 w-18 shrink-0 overflow-hidden rounded-lg border border-seam">
                <ProjectCover project={project} className="size-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{project.name}</p>
                {project.location && (
                  <p className="mt-0.5 flex items-center gap-1 text-[12px] text-stone">
                    <MapPin className="size-3" aria-hidden />
                    {project.location}
                  </p>
                )}
              </div>
              <span className="hidden font-mono text-[11px] text-faint md:block">
                {project.aspectRatio} · {project.durationSec}s
              </span>
              <StatusBadge status={project.status} />
              <span className="hidden w-20 text-end text-[12px] text-faint sm:block">
                {formatRelativeTime(project.updatedAt)}
              </span>
              <div onClick={(event) => event.stopPropagation()}>
                <ProjectActionsMenu project={project} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
