"use client";

/**
 * Workspace store — projects, assets, brand kit, usage.
 *
 * Persisted to localStorage (metadata) + IndexedDB (uploaded blobs).
 * Server state / client state separation arrives with the real backend;
 * the store's action surface is the contract the UI codes against.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Asset,
  BrandKit,
  CreationMethod,
  Project,
  Usage,
} from "@/lib/domain/types";
import { artById } from "@/lib/data/art-manifest";
import {
  DEFAULT_BRANDING,
  DEFAULT_MUSIC,
  DEFAULT_VOICEOVER,
  buildSampleAssets,
  buildSampleJourneyProject,
  buildSampleProjects,
  defaultBrandKit,
  defaultUsage,
} from "@/lib/data/demo";
import { templateById } from "@/lib/data/templates";
import { blobStore, IDB_PREFIX } from "@/lib/storage/local";
import { createId } from "@/lib/utils";

const WORKSPACE_ID = "workspace_local";

interface WorkspaceState {
  hydrated: boolean;
  seeded: boolean;
  projects: Project[];
  assets: Asset[];
  brandKit: BrandKit;
  usage: Usage;

  markHydrated: () => void;
  createProject: (input: {
    method: CreationMethod;
    name?: string;
    templateId?: string;
  }) => Project;
  createSampleProject: () => Project;
  updateProject: (id: string, patch: Partial<Project>) => void;
  transformProject: (id: string, transform: (project: Project) => Project) => void;
  duplicateProject: (id: string) => Project | null;
  deleteProject: (id: string) => void;
  registerUploadedAsset: (input: { name: string; blobId: string; sizeBytes: number; kind?: Asset["kind"] }) => Asset;
  /** Ensure workspace assets exist for the given art ids; returns them in order. */
  ensureArtAssets: (artIds: string[]) => Asset[];
  addSampleAssetsToLibrary: () => void;
  deleteAsset: (id: string) => void;
  updateBrandKit: (patch: Partial<BrandKit>) => void;
  recordVideoCreated: () => void;
  resetWorkspace: () => void;
}

function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

function seedState() {
  const assets = buildSampleAssets(WORKSPACE_ID);
  return {
    seeded: true,
    assets,
    projects: buildSampleProjects(WORKSPACE_ID, assets),
    brandKit: defaultBrandKit(WORKSPACE_ID),
    usage: defaultUsage(WORKSPACE_ID),
  };
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      seeded: false,
      projects: [],
      assets: [],
      brandKit: defaultBrandKit(WORKSPACE_ID),
      usage: defaultUsage(WORKSPACE_ID),

      markHydrated: () => {
        set((state) => (state.seeded ? { hydrated: true } : { hydrated: true, ...seedState() }));
      },

      createProject: ({ method, name, templateId }) => {
        const { brandKit } = get();
        const template = templateId ? templateById(templateId) : null;
        const now = new Date().toISOString();
        const project: Project = {
          id: createId("project"),
          workspaceId: WORKSPACE_ID,
          name: name?.trim() || "Untitled property",
          method,
          propertyType: null,
          location: "",
          objective: null,
          brief: "",
          direction: "",
          styleId: template?.styleId ?? null,
          aspectRatio: template?.aspectRatio ?? (method === "image" ? "9:16" : "16:9"),
          durationSec: template?.durationSec ?? 30,
          assetIds: [],
          scenes: [],
          branding: {
            ...DEFAULT_BRANDING,
            brandName: brandKit.brandName,
            cta: brandKit.defaultCta,
            phone: brandKit.phone,
            website: brandKit.website,
            logoAssetId: brandKit.logoAssetId,
          },
          music: { ...DEFAULT_MUSIC },
          voiceover: { ...DEFAULT_VOICEOVER },
          status: "draft",
          templateId: template?.id,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ projects: [project, ...state.projects] }));
        return project;
      },

      createSampleProject: () => {
        const project = buildSampleJourneyProject(WORKSPACE_ID, get().assets);
        set((state) => ({ projects: [project, ...state.projects] }));
        return project;
      },

      updateProject: (id, patch) => {
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id ? touch({ ...project, ...patch }) : project,
          ),
        }));
      },

      transformProject: (id, transform) => {
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id ? touch(transform(project)) : project,
          ),
        }));
      },

      duplicateProject: (id) => {
        const source = get().projects.find((project) => project.id === id);
        if (!source) return null;
        const now = new Date().toISOString();
        const copy: Project = {
          ...source,
          id: createId("project"),
          name: `${source.name} copy`,
          scenes: source.scenes.map((scene) => ({ ...scene, id: createId("scene") })),
          generation: undefined,
          isSample: false,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ projects: [copy, ...state.projects] }));
        return copy;
      },

      deleteProject: (id) => {
        set((state) => ({ projects: state.projects.filter((project) => project.id !== id) }));
      },

      registerUploadedAsset: ({ name, blobId, sizeBytes, kind = "image" }) => {
        const asset: Asset = {
          id: createId("asset"),
          workspaceId: WORKSPACE_ID,
          kind,
          name,
          src: `${IDB_PREFIX}${blobId}`,
          sizeBytes,
          source: "upload",
          tags: kind === "logo" ? ["logo"] : ["upload"],
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ assets: [asset, ...state.assets] }));
        return asset;
      },

      ensureArtAssets: (artIds) => {
        const state = get();
        const created: Asset[] = [];
        const additions: Asset[] = [];
        for (const artId of artIds) {
          const art = artById(artId);
          const existing =
            state.assets.find((asset) => asset.src === art.src) ??
            additions.find((asset) => asset.src === art.src);
          if (existing) {
            created.push(existing);
            continue;
          }
          const asset: Asset = {
            id: `asset_art_${artId}`,
            workspaceId: WORKSPACE_ID,
            kind: "image",
            name: art.alt.slice(0, 60),
            src: art.src,
            source: "sample",
            tags: ["concept", art.kind],
            createdAt: new Date().toISOString(),
          };
          additions.push(asset);
          created.push(asset);
        }
        if (additions.length > 0) {
          set((current) => ({ assets: [...additions, ...current.assets] }));
        }
        return created;
      },

      addSampleAssetsToLibrary: () => {
        set((state) => {
          if (state.assets.some((asset) => asset.source === "sample")) return state;
          return { assets: [...buildSampleAssets(WORKSPACE_ID), ...state.assets] };
        });
      },

      deleteAsset: (id) => {
        const asset = get().assets.find((a) => a.id === id);
        if (asset?.src.startsWith(IDB_PREFIX)) {
          void blobStore.delete(asset.src.slice(IDB_PREFIX.length));
        }
        set((state) => ({
          assets: state.assets.filter((a) => a.id !== id),
          projects: state.projects.map((project) =>
            project.assetIds.includes(id)
              ? touch({
                  ...project,
                  assetIds: project.assetIds.filter((assetId) => assetId !== id),
                  scenes: project.scenes.map((scene) =>
                    scene.assetId === id ? { ...scene, assetId: null, hidden: true } : scene,
                  ),
                })
              : project,
          ),
        }));
      },

      updateBrandKit: (patch) => {
        set((state) => ({
          brandKit: { ...state.brandKit, ...patch, updatedAt: new Date().toISOString() },
        }));
      },

      recordVideoCreated: () => {
        set((state) => ({
          usage: {
            ...state.usage,
            videosCreated: state.usage.videosCreated + 1,
            creditsUsed: Math.min(state.usage.creditsIncluded, state.usage.creditsUsed + 1),
          },
        }));
      },

      resetWorkspace: () => {
        set({ ...seedState(), hydrated: true });
      },
    }),
    {
      name: "vizora:workspace",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        seeded: state.seeded,
        projects: state.projects,
        assets: state.assets,
        brandKit: state.brandKit,
        usage: state.usage,
      }),
      onRehydrateStorage: () => (state) => {
        state?.markHydrated();
      },
    },
  ),
);

/* ------------------------------ derived hooks ------------------------------ */

export function useProject(id: string | null) {
  return useWorkspaceStore((state) =>
    id ? state.projects.find((project) => project.id === id) ?? null : null,
  );
}

export function useProjectAssets(project: Project | null): Asset[] {
  const assets = useWorkspaceStore((state) => state.assets);
  if (!project) return [];
  return project.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => Boolean(asset));
}
