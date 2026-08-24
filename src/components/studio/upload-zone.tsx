"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  CloudUpload,
  FolderOpen,
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
import { useToast } from "@/components/ui/toast";
import { useAssetUrl } from "@/lib/hooks/use-asset-url";
import type { Asset } from "@/lib/domain/types";
import { blobStore } from "@/lib/storage/local";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn, createId, formatBytes } from "@/lib/utils";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/avif"];
const MAX_SIZE = 25 * 1024 * 1024;
const MAX_IMAGES = 12;

interface UploadingFile {
  id: string;
  name: string;
  progress: number;
}

export function useUploadAssets() {
  const registerUploadedAsset = useWorkspaceStore((state) => state.registerUploadedAsset);
  const { toast } = useToast();
  const [uploading, setUploading] = React.useState<UploadingFile[]>([]);

  const upload = React.useCallback(
    async (files: FileList | File[], onDone: (assets: Asset[]) => void, kind: Asset["kind"] = "image") => {
      const list = Array.from(files);
      const valid: File[] = [];
      for (const file of list) {
        if (!ACCEPTED.includes(file.type)) {
          toast({
            title: `“${file.name}” isn't a supported image`,
            description: "Use JPG, PNG, WebP, AVIF or SVG.",
            variant: "error",
          });
          continue;
        }
        if (file.size > MAX_SIZE) {
          toast({
            title: `“${file.name}” is over 25 MB`,
            description: "Export a lighter version and try again.",
            variant: "error",
          });
          continue;
        }
        valid.push(file);
      }
      if (valid.length === 0) return;

      const staged = valid.map((file) => ({ id: createId("up"), name: file.name, progress: 8 }));
      setUploading((current) => [...current, ...staged]);

      const done: Asset[] = [];
      await Promise.all(
        valid.map(async (file, index) => {
          const stagedId = staged[index].id;
          // Local writes are fast; pace the progress so the state is legible.
          const ticker = window.setInterval(() => {
            setUploading((current) =>
              current.map((u) =>
                u.id === stagedId ? { ...u, progress: Math.min(88, u.progress + 14) } : u,
              ),
            );
          }, 110);
          try {
            const blobId = createId("blob");
            await blobStore.put(blobId, file);
            const asset = registerUploadedAsset({
              name: file.name.replace(/\.[a-z4]+$/i, ""),
              blobId,
              sizeBytes: file.size,
              kind,
            });
            done.push(asset);
          } catch {
            toast({
              title: `Couldn't store “${file.name}”`,
              description: "Your browser blocked local storage. Try again or use sample images.",
              variant: "error",
            });
          } finally {
            window.clearInterval(ticker);
            setUploading((current) => current.filter((u) => u.id !== stagedId));
          }
        }),
      );
      if (done.length > 0) onDone(done);
    },
    [registerUploadedAsset, toast],
  );

  return { upload, uploading };
}

export function UploadZone({
  onAssets,
  multiple = true,
  currentCount = 0,
  compact = false,
}: {
  onAssets: (assets: Asset[]) => void;
  multiple?: boolean;
  currentCount?: number;
  compact?: boolean;
}) {
  const { upload, uploading } = useUploadAssets();
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const remaining = MAX_IMAGES - currentCount;

  const handleFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length > remaining) {
      toast({
        title: `Up to ${MAX_IMAGES} images per project`,
        description: `You can add ${Math.max(0, remaining)} more.`,
        variant: "error",
      });
    }
    void upload(list.slice(0, Math.max(0, remaining)), onAssets);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload property images"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors",
          compact ? "px-4 py-6" : "px-6 py-14",
          dragging
            ? "border-signal bg-signal/8"
            : "border-seam-strong bg-surface/40 hover:border-faint hover:bg-surface/70",
        )}
      >
        <span
          className={cn(
            "flex items-center justify-center rounded-xl border border-seam bg-raised",
            compact ? "size-9" : "size-12",
          )}
        >
          <CloudUpload className={cn("text-stone", compact ? "size-4" : "size-5")} aria-hidden />
        </span>
        <p className={cn("mt-3 font-medium text-ink", compact ? "text-[13px]" : "text-[15px]")}>
          {dragging ? "Drop your images" : "Drag property images here"}
        </p>
        <p className={cn("mt-1 text-stone", compact ? "text-[11px]" : "text-[13px]")}>
          or <span className="text-signal-bright">browse files</span> · JPG, PNG, WebP · up to 25 MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          multiple={multiple}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files?.length) handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {uploading.length > 0 && (
        <ul className="mt-3 space-y-2">
          {uploading.map((file) => (
            <li key={file.id} className="rounded-xl border border-seam bg-surface px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-[13px] text-ink-mid">{file.name}</p>
                <span className="font-mono text-[11px] text-stone">{file.progress}%</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-seam">
                <div
                  className="h-full rounded-full bg-signal transition-[width] duration-150"
                  style={{ width: `${file.progress}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AssetThumb({
  asset,
  className,
}: {
  asset: Asset;
  className?: string;
}) {
  const url = useAssetUrl(asset.src);
  if (!url) return <div className={cn("animate-pulse-soft bg-raised", className)} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={asset.name} className={cn("object-cover", className)} />;
}

export function AssetStrip({
  assets,
  onRemove,
  onMove,
}: {
  assets: Asset[];
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {assets.map((asset, index) => (
        <li
          key={asset.id}
          className="group relative overflow-hidden rounded-xl border border-seam bg-surface"
        >
          <AssetThumb asset={asset} className="aspect-[4/3] w-full" />
          <span className="absolute left-2 top-2 rounded bg-ground/80 px-1.5 py-0.5 font-mono text-[10px] text-ink-mid backdrop-blur">
            {index + 1}
          </span>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-ground/90 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <div className="flex gap-1">
              <button
                aria-label={`Move ${asset.name} earlier`}
                disabled={index === 0}
                onClick={() => onMove(asset.id, -1)}
                className="rounded-md bg-overlay/90 p-1.5 text-ink-mid transition-colors hover:text-ink disabled:opacity-30"
              >
                <ArrowLeft className="size-3.5" />
              </button>
              <button
                aria-label={`Move ${asset.name} later`}
                disabled={index === assets.length - 1}
                onClick={() => onMove(asset.id, 1)}
                className="rounded-md bg-overlay/90 p-1.5 text-ink-mid transition-colors hover:text-ink disabled:opacity-30"
              >
                <ArrowRight className="size-3.5" />
              </button>
            </div>
            <button
              aria-label={`Remove ${asset.name}`}
              onClick={() => onRemove(asset.id)}
              className="rounded-md bg-overlay/90 p-1.5 text-danger transition-colors hover:bg-danger/20"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <p className="truncate px-2.5 py-2 text-[11px] text-stone">
            {asset.name}
            {asset.sizeBytes ? ` · ${formatBytes(asset.sizeBytes)}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Pick existing images from the workspace library. */
export function LibraryPickerDialog({
  open,
  onOpenChange,
  excludeIds,
  onPick,
  title = "Add from your library",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeIds: string[];
  onPick: (assets: Asset[]) => void;
  title?: string;
}) {
  const assets = useWorkspaceStore((state) => state.assets);
  const [selected, setSelected] = React.useState<string[]>([]);
  const available = assets.filter(
    (asset) => asset.kind === "image" && !excludeIds.includes(asset.id),
  );

  // Clear the selection whenever the dialog closes (render-time adjust).
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setSelected([]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {available.length === 0
              ? "Everything in your library is already in this project."
              : "Select images from your asset library."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 grid-cols-3 gap-2.5 overflow-y-auto pe-1 sm:grid-cols-4">
          {available.map((asset) => {
            const isSelected = selected.includes(asset.id);
            return (
              <button
                key={asset.id}
                aria-pressed={isSelected}
                onClick={() =>
                  setSelected((current) =>
                    isSelected ? current.filter((id) => id !== asset.id) : [...current, asset.id],
                  )
                }
                className={cn(
                  "relative overflow-hidden rounded-lg border-2 transition-colors",
                  isSelected ? "border-signal" : "border-transparent hover:border-seam-strong",
                )}
              >
                <AssetThumb asset={asset} className="aspect-[4/3] w-full" />
                {isSelected && (
                  <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-signal text-[11px] font-bold text-ivory">
                    {selected.indexOf(asset.id) + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => {
              onPick(selected.map((id) => assets.find((asset) => asset.id === id)!).filter(Boolean));
              onOpenChange(false);
            }}
          >
            <FolderOpen className="size-4" aria-hidden />
            Add {selected.length > 0 ? `${selected.length} ` : ""}image{selected.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
