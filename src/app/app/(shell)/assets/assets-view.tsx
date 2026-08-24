"use client";

import * as React from "react";
import { CloudUpload, Images, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { AssetThumb, UploadZone } from "@/components/studio/upload-zone";
import { useAssetUrlOf } from "@/lib/hooks/use-asset-url";
import type { Asset } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";

type SourceFilter = "all" | "upload" | "sample";

export function AssetsView() {
  const assets = useWorkspaceStore((state) => state.assets);
  const projects = useWorkspaceStore((state) => state.projects);
  const deleteAsset = useWorkspaceStore((state) => state.deleteAsset);
  const { toast } = useToast();

  const [query, setQuery] = React.useState("");
  const [source, setSource] = React.useState<SourceFilter>("all");
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [showUpload, setShowUpload] = React.useState(false);

  const filtered = assets
    .filter((asset) => (source === "all" ? true : asset.source === source))
    .filter((asset) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        asset.name.toLowerCase().includes(q) ||
        asset.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });

  const detail = assets.find((asset) => asset.id === detailId) ?? null;
  const confirmTarget = assets.find((asset) => asset.id === confirmDeleteId) ?? null;
  const usedIn = (assetId: string) =>
    projects.filter((project) => project.assetIds.includes(assetId));

  return (
    <div className="container-page max-w-6xl space-y-6 py-8 lg:py-10">
      <PageHeader
        title="Assets"
        description="Property images, logos and project material for your workspace."
        actions={
          <Button onClick={() => setShowUpload((s) => !s)}>
            <CloudUpload className="size-4" aria-hidden />
            Upload images
          </Button>
        }
      />

      {showUpload && (
        <UploadZone
          onAssets={(added) => {
            toast({
              title: `${added.length} image${added.length === 1 ? "" : "s"} added to your library`,
            });
            setShowUpload(false);
          }}
          currentCount={0}
        />
      )}

      {assets.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or tag"
              aria-label="Search assets"
              className="ps-9"
            />
          </div>
          <div role="group" aria-label="Filter by source" className="flex gap-1.5">
            {(
              [
                { id: "all", label: "All" },
                { id: "upload", label: "Uploads" },
                { id: "sample", label: "Samples" },
              ] as { id: SourceFilter; label: string }[]
            ).map((filter) => (
              <button
                key={filter.id}
                onClick={() => setSource(filter.id)}
                aria-pressed={source === filter.id}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                  source === filter.id
                    ? "border-ivory bg-ivory text-ground"
                    : "border-seam text-stone hover:border-seam-strong hover:text-ink",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <p className="ms-auto font-mono text-[11px] text-faint">
            {filtered.length} asset{filtered.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {assets.length === 0 ? (
        <EmptyState
          icon={<Images className="size-5" aria-hidden />}
          title="Your property library starts here."
          description="Upload renders, photos and logos once — reuse them across every project."
          action={
            <Button size="lg" onClick={() => setShowUpload(true)}>
              Upload your first images
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="size-5" aria-hidden />}
          title="No assets match"
          description="Try a different search or filter."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setSource("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((asset) => (
            <li key={asset.id}>
              <button
                onClick={() => setDetailId(asset.id)}
                className="group w-full overflow-hidden rounded-2xl border border-seam bg-surface/60 text-start transition-colors hover:border-seam-strong hover:bg-surface"
              >
                <div className="relative overflow-hidden">
                  <AssetThumb
                    asset={asset}
                    className="aspect-[4/3] w-full transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                  />
                  {asset.kind === "logo" && (
                    <Badge className="absolute left-2 top-2" variant="outline">
                      Logo
                    </Badge>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-[13px] font-medium text-ink">{asset.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-faint">
                    {asset.sizeBytes ? `${formatBytes(asset.sizeBytes)} · ` : ""}
                    {formatRelativeTime(asset.createdAt)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Detail dialog */}
      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          {detail && (
            <AssetDetail
              asset={detail}
              usedIn={usedIn(detail.id).length}
              onDelete={() => {
                setConfirmDeleteId(detail.id);
                setDetailId(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={Boolean(confirmTarget)} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <DialogContent>
          {confirmTarget && (
            <>
              <DialogHeader>
                <DialogTitle>Delete “{confirmTarget.name}”?</DialogTitle>
                <DialogDescription>
                  {usedIn(confirmTarget.id).length > 0
                    ? `It's used in ${usedIn(confirmTarget.id).length} project${usedIn(confirmTarget.id).length === 1 ? "" : "s"} — those scenes will need a replacement image.`
                    : "This removes the image from your library permanently."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                  Keep asset
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    deleteAsset(confirmTarget.id);
                    setConfirmDeleteId(null);
                    toast({ title: "Asset deleted" });
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Delete asset
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssetDetail({
  asset,
  usedIn,
  onDelete,
}: {
  asset: Asset;
  usedIn: number;
  onDelete: () => void;
}) {
  const url = useAssetUrlOf(asset);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="pe-6">{asset.name}</DialogTitle>
      </DialogHeader>
      <div className="overflow-hidden rounded-xl border border-seam bg-ground">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={asset.name} className="max-h-80 w-full object-contain" />
        ) : (
          <div className="aspect-[4/3] w-full animate-pulse-soft bg-raised" />
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-faint">Type</dt>
          <dd className="mt-0.5 capitalize text-ink-mid">{asset.kind}</dd>
        </div>
        <div>
          <dt className="text-faint">Source</dt>
          <dd className="mt-0.5 capitalize text-ink-mid">{asset.source}</dd>
        </div>
        <div>
          <dt className="text-faint">Size</dt>
          <dd className="mt-0.5 text-ink-mid">
            {asset.sizeBytes ? formatBytes(asset.sizeBytes) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Used in</dt>
          <dd className="mt-0.5 text-ink-mid">
            {usedIn} project{usedIn === 1 ? "" : "s"}
          </dd>
        </div>
      </dl>
      {asset.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {asset.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}
      <DialogFooter>
        <Button variant="danger" onClick={onDelete}>
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </DialogFooter>
    </>
  );
}
