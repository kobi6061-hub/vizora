"use client";

/**
 * Left rail: the story (scenes) and the project's images.
 * Reorder, edit copy, regenerate, hide, duplicate, replace — the whole
 * §12 scene toolbox.
 */

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  MoreHorizontal,
  PencilLine,
  RefreshCcw,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, SegmentedList, SegmentedTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { AssetStrip, AssetThumb, LibraryPickerDialog, UploadZone } from "@/components/studio/upload-zone";
import { generateStory, regenerateCaption } from "@/lib/story/generate-story";
import type { Asset, Project, Scene, SceneMotion } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn, createId } from "@/lib/utils";

const MOTION_LABELS: Record<SceneMotion, string> = {
  push: "Slow push in",
  pull: "Pull back",
  "pan-left": "Pan left",
  "pan-right": "Pan right",
  rise: "Rise",
};

export function SceneRail({ project, assets }: { project: Project; assets: Asset[] }) {
  const transformProject = useWorkspaceStore((state) => state.transformProject);
  const { toast } = useToast();
  const [editingSceneId, setEditingSceneId] = React.useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const regenVariant = React.useRef(1);

  const editingScene = project.scenes.find((scene) => scene.id === editingSceneId) ?? null;

  /* ------------------------------ scene actions ------------------------------ */

  const patchScene = (sceneId: string, patch: Partial<Scene>) => {
    transformProject(project.id, (current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, ...patch } : scene,
      ),
    }));
  };

  const moveScene = (sceneId: string, direction: -1 | 1) => {
    transformProject(project.id, (current) => {
      const scenes = [...current.scenes];
      const index = scenes.findIndex((scene) => scene.id === sceneId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= scenes.length) return current;
      [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
      return { ...current, scenes };
    });
  };

  const duplicateScene = (sceneId: string) => {
    transformProject(project.id, (current) => {
      const index = current.scenes.findIndex((scene) => scene.id === sceneId);
      if (index < 0) return current;
      const copy = { ...current.scenes[index], id: createId("scene") };
      const scenes = [...current.scenes];
      scenes.splice(index + 1, 0, copy);
      return { ...current, scenes };
    });
  };

  const deleteScene = (sceneId: string) => {
    transformProject(project.id, (current) => ({
      ...current,
      scenes: current.scenes.filter((scene) => scene.id !== sceneId),
    }));
  };

  const regenerateSceneCaption = (scene: Scene) => {
    regenVariant.current += 1;
    patchScene(scene.id, {
      caption: regenerateCaption(project, scene, regenVariant.current),
    });
  };

  const regenerateWholeStory = () => {
    regenVariant.current += 1;
    const variant = regenVariant.current;
    transformProject(project.id, (current) => ({
      ...current,
      scenes: generateStory(current, assets, variant),
    }));
    toast({
      title: "Story regenerated",
      description: "New structure and copy. Regenerate again for another take.",
    });
  };

  /* ------------------------------ asset actions ------------------------------ */

  const addAssets = (added: Asset[]) => {
    transformProject(project.id, (current) => ({
      ...current,
      assetIds: [
        ...current.assetIds,
        ...added.map((asset) => asset.id).filter((id) => !current.assetIds.includes(id)),
      ],
    }));
  };

  const removeAsset = (id: string) => {
    transformProject(project.id, (current) => ({
      ...current,
      assetIds: current.assetIds.filter((assetId) => assetId !== id),
      scenes: current.scenes.map((scene) =>
        scene.assetId === id ? { ...scene, assetId: null, hidden: true } : scene,
      ),
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

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="rounded-2xl border border-seam bg-surface/40">
      <Tabs defaultValue="scenes">
        <div className="flex items-center justify-between gap-2 border-b border-seam p-2.5">
          <SegmentedList className="border-none bg-transparent p-0">
            <SegmentedTrigger value="scenes">Scenes</SegmentedTrigger>
            <SegmentedTrigger value="images">Images</SegmentedTrigger>
          </SegmentedList>
          <Button variant="ghost" size="sm" onClick={regenerateWholeStory}>
            <Wand2 className="size-3.5" aria-hidden />
            Regenerate
          </Button>
        </div>

        <TabsContent value="scenes" className="p-2.5">
          <ol className="space-y-2">
            {project.scenes.map((scene, index) => {
              const asset = scene.assetId
                ? assets.find((a) => a.id === scene.assetId) ?? null
                : null;
              return (
                <li
                  key={scene.id}
                  className={cn(
                    "group flex gap-2.5 rounded-xl border border-seam bg-raised p-2 transition-opacity",
                    scene.hidden && "opacity-45",
                  )}
                >
                  <button
                    onClick={() => setEditingSceneId(scene.id)}
                    className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-seam"
                    aria-label={`Edit ${scene.title}`}
                  >
                    {scene.kind === "endcard" ? (
                      <span className="flex size-full items-center justify-center bg-ground font-display text-[9px] uppercase tracking-widest text-stone">
                        End card
                      </span>
                    ) : asset ? (
                      <AssetThumb asset={asset} className="size-full" />
                    ) : (
                      <span className="flex size-full items-center justify-center bg-overlay text-[9px] text-faint">
                        No image
                      </span>
                    )}
                    <span className="absolute left-1 top-1 rounded bg-ground/85 px-1 font-mono text-[9px] text-ink-mid">
                      {index + 1}
                    </span>
                  </button>

                  <div className="min-w-0 flex-1 py-0.5">
                    <p className="truncate text-[12px] font-medium text-ink">{scene.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-stone">
                      {scene.caption}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end justify-between">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={`Scene ${index + 1} actions`}
                          className="rounded-md p-1 text-faint opacity-0 transition-opacity hover:bg-overlay hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditingSceneId(scene.id)}>
                          <PencilLine className="size-4" aria-hidden />
                          Edit scene
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => regenerateSceneCaption(scene)}>
                          <RefreshCcw className="size-4" aria-hidden />
                          Regenerate copy
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => duplicateScene(scene.id)}>
                          <Copy className="size-4" aria-hidden />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => patchScene(scene.id, { hidden: !scene.hidden })}>
                          {scene.hidden ? (
                            <Eye className="size-4" aria-hidden />
                          ) : (
                            <EyeOff className="size-4" aria-hidden />
                          )}
                          {scene.hidden ? "Show scene" : "Hide scene"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => deleteScene(scene.id)}>
                          <Trash2 className="size-4" aria-hidden />
                          Delete scene
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div className="flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        aria-label="Move scene up"
                        disabled={index === 0}
                        onClick={() => moveScene(scene.id, -1)}
                        className="rounded-md p-1 text-faint transition-colors hover:bg-overlay hover:text-ink disabled:opacity-30"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        aria-label="Move scene down"
                        disabled={index === project.scenes.length - 1}
                        onClick={() => moveScene(scene.id, 1)}
                        className="rounded-md p-1 text-faint transition-colors hover:bg-overlay hover:text-ink disabled:opacity-30"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="px-1 pt-3 text-[11px] leading-relaxed text-faint">
            Scenes share the video length evenly. Hidden scenes are skipped.
          </p>
        </TabsContent>

        <TabsContent value="images" className="space-y-3 p-2.5">
          {assets.length > 0 ? (
            <AssetStrip assets={assets} onRemove={removeAsset} onMove={moveAsset} />
          ) : (
            <p className="px-1 py-2 text-[12px] text-stone">No images in this project yet.</p>
          )}
          <UploadZone onAssets={addAssets} currentCount={assets.length} compact />
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setLibraryOpen(true)}>
            <FolderOpen className="size-4" aria-hidden />
            Add from library
          </Button>
        </TabsContent>
      </Tabs>

      {/* Scene editor */}
      <Dialog open={Boolean(editingScene)} onOpenChange={(open) => !open && setEditingSceneId(null)}>
        <DialogContent className="max-w-lg">
          {editingScene && (
            <SceneEditor
              key={editingScene.id}
              scene={editingScene}
              assets={assets}
              onSave={(patch) => {
                patchScene(editingScene.id, patch);
                setEditingSceneId(null);
              }}
              onRegenerate={() => regenerateSceneCaption(editingScene)}
            />
          )}
        </DialogContent>
      </Dialog>

      <LibraryPickerDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        excludeIds={project.assetIds}
        onPick={addAssets}
      />
    </div>
  );
}

function SceneEditor({
  scene,
  assets,
  onSave,
  onRegenerate,
}: {
  scene: Scene;
  assets: Asset[];
  onSave: (patch: Partial<Scene>) => void;
  onRegenerate: () => void;
}) {
  const [title, setTitle] = React.useState(scene.title);
  const [caption, setCaption] = React.useState(scene.caption);
  const [motion, setMotion] = React.useState<SceneMotion>(scene.motion);
  const [assetId, setAssetId] = React.useState(scene.assetId);

  // Reflect external regeneration while the dialog is open (render-time adjust).
  const [lastExternalCaption, setLastExternalCaption] = React.useState(scene.caption);
  if (scene.caption !== lastExternalCaption) {
    setLastExternalCaption(scene.caption);
    setCaption(scene.caption);
  }

  const isEndcard = scene.kind === "endcard";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit scene</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <Field label="Scene title" htmlFor="scene-title">
          <Input id="scene-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field
          label={isEndcard ? "Closing line" : "On-screen caption"}
          htmlFor="scene-caption"
        >
          <div className="relative">
            <Textarea
              id="scene-caption"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              className="min-h-20 pe-10"
            />
            <button
              type="button"
              onClick={onRegenerate}
              aria-label="Regenerate caption"
              title="Regenerate caption"
              className="absolute end-2 top-2 rounded-md p-1.5 text-stone transition-colors hover:bg-overlay hover:text-signal-bright"
            >
              <RefreshCcw className="size-4" />
            </button>
          </div>
        </Field>
        {!isEndcard && (
          <>
            <Field label="Camera motion" htmlFor="scene-motion">
              <Select value={motion} onValueChange={(value) => setMotion(value as SceneMotion)}>
                <SelectTrigger id="scene-motion">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MOTION_LABELS) as SceneMotion[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {MOTION_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-mid">Image</p>
              <div className="grid max-h-40 grid-cols-4 gap-2 overflow-y-auto pe-1">
                {assets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => setAssetId(asset.id)}
                    aria-pressed={assetId === asset.id}
                    aria-label={`Use ${asset.name}`}
                    className={cn(
                      "overflow-hidden rounded-lg border-2 transition-colors",
                      assetId === asset.id
                        ? "border-signal"
                        : "border-transparent hover:border-seam-strong",
                    )}
                  >
                    <AssetThumb asset={asset} className="aspect-[4/3] w-full" />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSave({ title, caption, motion, assetId })}
          disabled={title.trim().length === 0}
        >
          Save scene
        </Button>
      </DialogFooter>
    </>
  );
}
