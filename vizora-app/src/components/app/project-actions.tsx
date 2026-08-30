"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  ExternalLink,
  MoreHorizontal,
  PencilLine,
  Share2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Project } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

type DialogKind = "rename" | "delete" | "download" | "share" | null;

export function useProjectActions(project: Project) {
  const router = useRouter();
  const { toast } = useToast();
  const duplicateProject = useWorkspaceStore((state) => state.duplicateProject);
  const deleteProject = useWorkspaceStore((state) => state.deleteProject);
  const updateProject = useWorkspaceStore((state) => state.updateProject);
  const [dialog, setDialog] = React.useState<DialogKind>(null);

  const open = () => router.push(`/app/projects/${project.id}`);

  const duplicate = () => {
    const copy = duplicateProject(project.id);
    if (copy) {
      toast({ title: "Project duplicated", description: `“${copy.name}” is ready to edit.` });
      router.push(`/app/projects/${copy.id}`);
    }
  };

  const confirmDelete = () => {
    deleteProject(project.id);
    setDialog(null);
    toast({ title: "Project deleted", description: `“${project.name}” was removed.` });
  };

  const rename = (name: string) => {
    updateProject(project.id, { name });
    setDialog(null);
    toast({ title: "Project renamed" });
  };

  return { dialog, setDialog, open, duplicate, confirmDelete, rename };
}

export function ProjectActionDialogs({
  project,
  actions,
}: {
  project: Project;
  actions: ReturnType<typeof useProjectActions>;
}) {
  const { toast } = useToast();
  const [downloading, setDownloading] = React.useState<string | null>(null);

  return (
    <>
      {/* Rename */}
      <Dialog open={actions.dialog === "rename"} onOpenChange={(open) => !open && actions.setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(new FormData(event.currentTarget).get("name")).trim();
              if (name) actions.rename(name);
            }}
          >
            <Field label="Project name" htmlFor={`rename-${project.id}`}>
              <Input
                id={`rename-${project.id}`}
                name="name"
                defaultValue={project.name}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => actions.setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit">Save name</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={actions.dialog === "delete"} onOpenChange={(open) => !open && actions.setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{project.name}”?</DialogTitle>
            <DialogDescription>
              This removes the project and its story from your workspace. Uploaded
              assets stay in your library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => actions.setDialog(null)}>
              Keep project
            </Button>
            <Button variant="danger" onClick={actions.confirmDelete}>
              <Trash2 className="size-4" aria-hidden />
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Download */}
      <Dialog open={actions.dialog === "download"} onOpenChange={(open) => !open && actions.setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Download video</DialogTitle>
            <DialogDescription>
              Choose a format for “{project.name}”.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {[
              { id: "mp4-hd", label: "MP4 · 1080p", note: "Portals, WhatsApp, presentations" },
              { id: "mp4-4k", label: "MP4 · 4K", note: "Broadcast and large screens" },
              { id: "mp4-social", label: `MP4 · ${project.aspectRatio} social cut`, note: "Reels, Stories, TikTok" },
            ].map((format) => (
              <button
                key={format.id}
                onClick={() => {
                  setDownloading(format.id);
                  window.setTimeout(() => {
                    setDownloading(null);
                    toast({
                      title: "Render queued in preview",
                      description:
                        "File export ships with the production render engine. Your preview stays watchable in the studio.",
                    });
                  }, 1200);
                }}
                className="flex w-full items-center justify-between rounded-xl border border-seam bg-surface/60 px-4 py-3 text-start transition-colors hover:border-seam-strong hover:bg-surface"
              >
                <span>
                  <span className="block text-sm font-medium text-ink">{format.label}</span>
                  <span className="block text-[12px] text-faint">{format.note}</span>
                </span>
                <Download
                  className={`size-4 ${downloading === format.id ? "animate-pulse-soft text-signal-bright" : "text-stone"}`}
                  aria-hidden
                />
              </button>
            ))}
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-faint">
            This evaluation build renders previews in-app; downloadable files
            arrive when the production engine is connected.
          </p>
        </DialogContent>
      </Dialog>

      {/* Share */}
      <Dialog open={actions.dialog === "share"} onOpenChange={(open) => !open && actions.setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share “{project.name}”</DialogTitle>
            <DialogDescription>
              Copy a link to this project in your studio.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={typeof window !== "undefined" ? `${window.location.origin}/app/projects/${project.id}` : ""}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Project link"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${window.location.origin}/app/projects/${project.id}`,
                  );
                  toast({ title: "Link copied" });
                } catch {
                  toast({ title: "Couldn't copy", description: "Select the link and copy it manually.", variant: "error" });
                }
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-faint">
            Public share pages go live with the hosted release — this link opens
            the project for you in this workspace.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProjectActionsMenu({
  project,
  align = "end",
}: {
  project: Project;
  align?: "start" | "end";
}) {
  const actions = useProjectActions(project);
  const ready = project.status === "ready";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${project.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem onSelect={actions.open}>
            <ExternalLink className="size-4" aria-hidden />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={actions.duplicate}>
            <Copy className="size-4" aria-hidden />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.setDialog("rename")}>
            <PencilLine className="size-4" aria-hidden />
            Rename
          </DropdownMenuItem>
          {ready && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => actions.setDialog("download")}>
                <Download className="size-4" aria-hidden />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.setDialog("share")}>
                <Share2 className="size-4" aria-hidden />
                Share
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => actions.setDialog("delete")}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProjectActionDialogs project={project} actions={actions} />
    </>
  );
}
