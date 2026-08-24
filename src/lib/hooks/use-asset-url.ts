"use client";

import * as React from "react";
import type { Asset } from "@/lib/domain/types";
import { blobStore, IDB_PREFIX } from "@/lib/storage/local";

/**
 * Resolve an asset `src` to a displayable URL.
 * Bundled art is served as-is; uploaded blobs resolve through IndexedDB.
 */
export function useAssetUrl(src: string | null | undefined): string | null {
  const isBlob = Boolean(src?.startsWith(IDB_PREFIX));
  const [resolved, setResolved] = React.useState<string | null>(isBlob ? null : (src ?? null));

  React.useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    if (!src.startsWith(IDB_PREFIX)) {
      setResolved(src);
      return;
    }
    let active = true;
    void blobStore.resolveUrl(src.slice(IDB_PREFIX.length)).then((url) => {
      if (active) setResolved(url);
    });
    return () => {
      active = false;
    };
  }, [src]);

  return resolved;
}

export function useAssetUrlOf(asset: Asset | null | undefined) {
  return useAssetUrl(asset?.src ?? null);
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
