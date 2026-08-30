/**
 * Demo workspace content — believable sample properties, clearly fictional.
 * Seeded once into local storage so the product is alive on first login.
 */

import type {
  Asset,
  BrandKit,
  BrandingSettings,
  MusicSelection,
  Project,
  Usage,
  VoiceoverSettings,
} from "@/lib/domain/types";
import { artById } from "@/lib/data/art-manifest";
import { generateStory } from "@/lib/story/generate-story";
import { createId } from "@/lib/utils";

export const DEFAULT_BRANDING: BrandingSettings = {
  showBranding: true,
  logoAssetId: null,
  brandName: "",
  cta: "Book a viewing",
  phone: "",
  website: "",
  placement: "bottom-start",
  showDisclaimer: false,
  disclaimer: "Images are indicative. Final specification may vary.",
};

export const DEFAULT_MUSIC: MusicSelection = { trackId: "first-light", volume: 70 };

export const DEFAULT_VOICEOVER: VoiceoverSettings = {
  enabled: false,
  voice: "female",
  language: "English",
  script: "",
};

export function defaultBrandKit(workspaceId: string): BrandKit {
  return {
    workspaceId,
    brandName: "",
    logoAssetId: null,
    brandStyle: "cinematic",
    fontPreference: "modern",
    defaultCta: "Book a viewing",
    website: "",
    phone: "",
    endCardText: "Your next address awaits.",
    updatedAt: new Date().toISOString(),
  };
}

export function defaultUsage(workspaceId: string): Usage {
  const periodStart = new Date();
  periodStart.setDate(1);
  return {
    workspaceId,
    periodStart: periodStart.toISOString(),
    videosCreated: 12,
    creditsIncluded: 40,
    creditsUsed: 17,
    storageUsedBytes: 2.3 * 1024 ** 3,
    storageIncludedBytes: 100 * 1024 ** 3,
  };
}

/* ------------------------------ sample assets ------------------------------ */

interface SampleAssetSpec {
  artId: string;
  name: string;
  tags: string[];
}

const SAMPLE_ASSETS: SampleAssetSpec[] = [
  { artId: "azure-exterior", name: "Azure — seafront exterior", tags: ["azure-residences", "exterior"] },
  { artId: "azure-coast", name: "Azure — coastal masterplan", tags: ["azure-residences", "aerial"] },
  { artId: "azure-living", name: "Azure — living room", tags: ["azure-residences", "interior"] },
  { artId: "azure-terrace", name: "Azure — sea-view terrace", tags: ["azure-residences", "terrace"] },
  { artId: "azure-pool", name: "Azure — rooftop pool", tags: ["azure-residences", "amenity"] },
  { artId: "park-exterior", name: "Park Avenue — tower at night", tags: ["park-avenue", "exterior"] },
  { artId: "park-penthouse", name: "Park Avenue — penthouse", tags: ["park-avenue", "interior"] },
  { artId: "park-bedroom", name: "Park Avenue — bedroom", tags: ["park-avenue", "interior"] },
  { artId: "park-lobby", name: "Park Avenue — lobby", tags: ["park-avenue", "amenity"] },
  { artId: "marina-villa", name: "Casa Marina — villa at dusk", tags: ["casa-marina", "exterior"] },
  { artId: "marina-villa-golden", name: "Casa Marina — golden hour", tags: ["casa-marina", "exterior"] },
  { artId: "marina-kitchen", name: "Casa Marina — kitchen", tags: ["casa-marina", "interior"] },
  { artId: "marina-terrace", name: "Casa Marina — terrace", tags: ["casa-marina", "terrace"] },
  { artId: "grove-aerial", name: "The Grove — aerial masterplan", tags: ["the-grove", "aerial"] },
  { artId: "grove-exterior", name: "The Grove — residential quarter", tags: ["the-grove", "exterior"] },
  { artId: "grove-construction", name: "The Grove — site progress", tags: ["the-grove", "construction"] },
  { artId: "grove-living", name: "The Grove — show apartment", tags: ["the-grove", "interior"] },
  { artId: "grove-plan", name: "The Grove — floor plan", tags: ["the-grove", "plan"] },
  { artId: "meridian-exterior", name: "Meridian Tower — curtain wall", tags: ["meridian-tower", "exterior"] },
  { artId: "meridian-skyline", name: "Meridian Tower — skyline", tags: ["meridian-tower", "exterior"] },
  { artId: "meridian-pool", name: "Meridian Tower — pool deck", tags: ["meridian-tower", "amenity"] },
];

export function buildSampleAssets(workspaceId: string): Asset[] {
  const base = Date.now() - 1000 * 60 * 60 * 24 * 21;
  return SAMPLE_ASSETS.map((spec, index) => {
    const art = artById(spec.artId);
    return {
      id: `asset_sample_${spec.artId}`,
      workspaceId,
      kind: "image",
      name: spec.name,
      src: art.src,
      sizeBytes: 1.6 * 1024 * 1024 + index * 120_000,
      source: "sample",
      tags: spec.tags,
      createdAt: new Date(base + index * 1000 * 60 * 47).toISOString(),
    };
  });
}

/* ----------------------------- sample projects ----------------------------- */

interface SampleProjectSpec {
  name: string;
  location: string;
  propertyType: Project["propertyType"];
  objective: Project["objective"];
  styleId: Project["styleId"];
  aspectRatio: Project["aspectRatio"];
  durationSec: Project["durationSec"];
  method: Project["method"];
  status: Project["status"];
  brandName: string;
  assetTag: string;
  brief: string;
  hoursAgo: number;
  failReason?: string;
}

const SAMPLE_PROJECTS: SampleProjectSpec[] = [
  {
    name: "Azure Residences",
    location: "Limassol, Cyprus",
    propertyType: "residential-project",
    objective: "leads",
    styleId: "cinematic",
    aspectRatio: "16:9",
    durationSec: 30,
    method: "images",
    status: "ready",
    brandName: "Aegean Development Group",
    assetTag: "azure-residences",
    brief: "Seafront living for international buyers. Calm, premium, sunlit.",
    hoursAgo: 3,
  },
  {
    name: "Park Avenue Residence",
    location: "New York",
    propertyType: "apartment",
    objective: "sell",
    styleId: "luxury",
    aspectRatio: "16:9",
    durationSec: 45,
    method: "images",
    status: "ready",
    brandName: "Meridian Partners",
    assetTag: "park-avenue",
    brief: "A quiet penthouse above the park. Understated, established wealth.",
    hoursAgo: 26,
  },
  {
    name: "Casa Marina",
    location: "Marbella, Spain",
    propertyType: "villa",
    objective: "social",
    styleId: "lifestyle",
    aspectRatio: "9:16",
    durationSec: 15,
    method: "images",
    status: "draft",
    brandName: "Sierra Estates",
    assetTag: "casa-marina",
    brief: "Golden-hour villa content for Instagram. Warm and aspirational.",
    hoursAgo: 50,
  },
  {
    name: "The Grove",
    location: "London",
    propertyType: "residential-project",
    objective: "promote",
    styleId: "modern",
    aspectRatio: "16:9",
    durationSec: 30,
    method: "images",
    status: "draft",
    brandName: "Grove & Partners",
    assetTag: "the-grove",
    brief: "Launch teaser for a new masterplan. Confident and architectural.",
    hoursAgo: 96,
  },
  {
    name: "Meridian Tower",
    location: "Dubai",
    propertyType: "commercial",
    objective: "investor",
    styleId: "investor",
    aspectRatio: "16:9",
    durationSec: 60,
    method: "images",
    status: "failed",
    brandName: "Meridian Partners",
    assetTag: "meridian-tower",
    brief: "Investor overview for the commercial floors.",
    hoursAgo: 8,
    failReason: "Render queue timed out. Your credits were not used.",
  },
];

export function buildSampleProjects(workspaceId: string, assets: Asset[]): Project[] {
  return SAMPLE_PROJECTS.map((spec) => {
    const projectAssets = assets.filter((asset) => asset.tags.includes(spec.assetTag));
    const updatedAt = new Date(Date.now() - spec.hoursAgo * 3_600_000).toISOString();
    const createdAt = new Date(Date.now() - (spec.hoursAgo + 40) * 3_600_000).toISOString();
    const project: Project = {
      id: `project_sample_${spec.assetTag}`,
      workspaceId,
      name: spec.name,
      method: spec.method,
      propertyType: spec.propertyType,
      location: spec.location,
      objective: spec.objective,
      brief: spec.brief,
      direction: "",
      styleId: spec.styleId,
      aspectRatio: spec.aspectRatio,
      durationSec: spec.durationSec,
      assetIds: projectAssets.map((asset) => asset.id),
      scenes: [],
      branding: { ...DEFAULT_BRANDING, brandName: spec.brandName },
      music: { ...DEFAULT_MUSIC },
      voiceover: { ...DEFAULT_VOICEOVER },
      status: spec.status,
      isSample: true,
      createdAt,
      updatedAt,
    };
    project.scenes = generateStory(project, projectAssets);
    if (spec.status === "ready") {
      project.result = {
        id: createId("vid"),
        renderedAt: updatedAt,
        durationSec: spec.durationSec,
        aspectRatio: spec.aspectRatio,
        kind: "storyboard-preview",
      };
    }
    if (spec.status === "failed" && spec.failReason) {
      project.generation = {
        id: createId("gen"),
        projectId: project.id,
        phase: "FAILED",
        progress: 62,
        startedAt: updatedAt,
        error: spec.failReason,
      };
    }
    return project;
  });
}

/** The "Try a sample property" journey — a fresh Azure draft, ready to direct. */
export function buildSampleJourneyProject(workspaceId: string, assets: Asset[]): Project {
  const azure = assets.filter((asset) => asset.tags.includes("azure-residences"));
  const now = new Date().toISOString();
  return {
    id: createId("project"),
    workspaceId,
    name: "Azure Residences",
    method: "images",
    propertyType: "residential-project",
    location: "Limassol, Cyprus",
    objective: "leads",
    brief: "",
    direction: "",
    styleId: null,
    aspectRatio: "16:9",
    durationSec: 30,
    assetIds: azure.map((asset) => asset.id),
    scenes: [],
    branding: { ...DEFAULT_BRANDING, brandName: "Aegean Development Group" },
    music: { ...DEFAULT_MUSIC },
    voiceover: { ...DEFAULT_VOICEOVER },
    status: "draft",
    isSample: true,
    createdAt: now,
    updatedAt: now,
  };
}
