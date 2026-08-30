"use client";

import * as React from "react";
import type { Asset } from "@/lib/domain/types";
import { blobStore, IDB_PREFIX } from "@/lib/storage/local";

/**
 * Resolve an asset `src` to a displayable URL.
 * Bundled art is served as-is; uploaded blobs resolve through IndexedDB.
 */
export function useAssetUrl(src: string | null | undefined): string | null {
  const [resolved, setResolved] = React.useState<{ src: string; url: string | null } | null>(null);

  React.useEffect(() => {
    if (!src || !src.startsWith(IDB_PREFIX)) return;
    let active = true;
    void blobStore.resolveUrl(src.slice(IDB_PREFIX.length)).then((url) => {
      if (active) setResolved({ src, url });
    });
    return () => {
      active = false;
    };
  }, [src]);

  if (!src) return null;
  if (!src.startsWith(IDB_PREFIX)) return src;
  return resolved?.src === src ? resolved.url : null;
}

export function useAssetUrlOf(asset: Asset | null | undefined) {
  return useAssetUrl(asset?.src ?? null);
}

/** Resolve many assets at once — returns a map of asset id → display URL. */
export function useAssetUrls(assets: Asset[]): Record<string, string | null> {
  const key = assets.map((asset) => `${asset.id}:${asset.src}`).join("|");
  const [blobUrls, setBlobUrls] = React.useState<{ key: string; urls: Record<string, string | null> }>(
    { key: "", urls: {} },
  );

  const blobAssets = assets.filter((asset) => asset.src.startsWith(IDB_PREFIX));

  React.useEffect(() => {
    if (blobAssets.length === 0) return;
    let active = true;
    void Promise.all(
      blobAssets.map(async (asset) => {
        const url = await blobStore.resolveUrl(asset.src.slice(IDB_PREFIX.length));
        return [asset.id, url] as const;
      }),
    ).then((entries) => {
      if (active) setBlobUrls({ key, urls: Object.fromEntries(entries) });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const urls: Record<string, string | null> = {};
  for (const asset of assets) {
    if (asset.src.startsWith(IDB_PREFIX)) {
      urls[asset.id] = blobUrls.key === key ? (blobUrls.urls[asset.id] ?? null) : null;
    } else {
      urls[asset.id] = asset.src;
    }
  }
  return urls;
}

const noopSubscribe = () => () => {};

/** True once mounted on the client — SSR-safe via useSyncExternalStore. */
export function useMounted() {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    React.useCallback((onChange: () => void) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }, []),
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}
