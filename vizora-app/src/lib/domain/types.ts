/**
 * VIZORA domain model.
 *
 * Everything the product knows about is defined here, framework-free.
 * Provider integrations (video generation, storage, voice, music, payments)
 * depend on these types — never the other way around.
 */

/* ---------------------------------- users --------------------------------- */

export interface User {
  id: string;
  name: string;
  email: string;
  onboarded: boolean;
  persona?: OnboardingProfile;
  createdAt: string;
}

export interface OnboardingProfile {
  role:
    | "developer"
    | "agency"
    | "broker"
    | "marketer"
    | "architect"
    | "other";
  goal: "listings" | "development" | "social" | "investor" | "other";
  frequency: "occasionally" | "weekly" | "several-weekly" | "daily";
}

export interface Workspace {
  id: string;
  name: string;
  plan: PlanId;
  createdAt: string;
}

/* --------------------------------- assets --------------------------------- */

export type AssetKind = "image" | "logo";

export interface Asset {
  id: string;
  workspaceId: string;
  kind: AssetKind;
  name: string;
  /** `/art/...` for bundled demo art, `idb:<id>` for user uploads (IndexedDB). */
  src: string;
  sizeBytes?: number;
  source: "upload" | "sample";
  tags: string[];
  createdAt: string;
}

/* --------------------------------- project -------------------------------- */

export type CreationMethod = "image" | "images" | "text";

export type PropertyType =
  | "apartment"
  | "villa"
  | "residential-project"
  | "penthouse"
  | "office"
  | "commercial"
  | "hotel"
  | "land"
  | "other";

export type MarketingObjective =
  | "sell"
  | "leads"
  | "promote"
  | "social"
  | "presentation"
  | "investor";

export type VideoStyleId =
  | "cinematic"
  | "luxury"
  | "modern"
  | "lifestyle"
  | "investor"
  | "social";

export type AspectRatio = "9:16" | "1:1" | "16:9";

export type VideoDuration = 15 | 30 | 45 | 60;

export type ProjectStatus = "draft" | "generating" | "ready" | "failed";

export type SceneMotion = "push" | "pull" | "pan-left" | "pan-right" | "rise";

export interface Scene {
  id: string;
  kind: "footage" | "endcard";
  /** Null for the end card, which is rendered from branding. */
  assetId: string | null;
  title: string;
  caption: string;
  motion: SceneMotion;
  hidden: boolean;
}

export interface BrandingSettings {
  showBranding: boolean;
  logoAssetId: string | null;
  brandName: string;
  cta: string;
  phone: string;
  website: string;
  placement: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  showDisclaimer: boolean;
  disclaimer: string;
}

export interface MusicSelection {
  /** Null means no music. */
  trackId: string | null;
  volume: number;
}

export interface VoiceoverSettings {
  enabled: boolean;
  voice: "female" | "male";
  language: string;
  script: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  method: CreationMethod;
  propertyType: PropertyType | null;
  location: string;
  objective: MarketingObjective | null;
  /** "What should viewers feel or know?" */
  brief: string;
  /** Natural-language creative direction ("Direct your video"). */
  direction: string;
  styleId: VideoStyleId | null;
  aspectRatio: AspectRatio;
  durationSec: VideoDuration;
  assetIds: string[];
  scenes: Scene[];
  branding: BrandingSettings;
  music: MusicSelection;
  voiceover: VoiceoverSettings;
  status: ProjectStatus;
  templateId?: string;
  generation?: VideoGeneration;
  result?: VideoResult;
  isSample?: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------- generation ------------------------------- */

export type GenerationPhase =
  | "QUEUED"
  | "ANALYZING"
  | "CREATING_SCENES"
  | "GENERATING_MOTION"
  | "ASSEMBLING"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED";

export interface VideoGeneration {
  id: string;
  projectId: string;
  phase: GenerationPhase;
  /** 0–100 across the whole run. */
  progress: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface VideoResult {
  id: string;
  renderedAt: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  /**
   * The mock provider produces a storyboard preview rendered by the in-app
   * player. A production provider adds a `fileUrl` without touching the UI.
   */
  kind: "storyboard-preview";
  fileUrl?: string;
}

/* -------------------------------- templates -------------------------------- */

export type TemplateCategory =
  | "luxury"
  | "development"
  | "listing"
  | "social"
  | "investor"
  | "villa"
  | "construction";

export interface SceneBlueprint {
  title: string;
  caption: string;
  motion: SceneMotion;
}

export interface Template {
  id: string;
  name: string;
  tagline: string;
  category: TemplateCategory;
  styleId: VideoStyleId;
  aspectRatio: AspectRatio;
  durationSec: VideoDuration;
  coverSrc: string;
  sceneBlueprints: SceneBlueprint[];
}

/* -------------------------------- brand kit -------------------------------- */

export interface BrandKit {
  workspaceId: string;
  brandName: string;
  logoAssetId: string | null;
  brandStyle: VideoStyleId;
  fontPreference: "modern" | "editorial" | "technical";
  defaultCta: string;
  website: string;
  phone: string;
  endCardText: string;
  updatedAt: string;
}

/* ------------------------------- subscription ------------------------------ */

export type PlanId = "starter" | "pro" | "business";

export interface Subscription {
  workspaceId: string;
  plan: PlanId;
  status: "active" | "trialing";
  renewsAt: string;
  seats: number;
}

export interface Usage {
  workspaceId: string;
  periodStart: string;
  videosCreated: number;
  creditsIncluded: number;
  creditsUsed: number;
  storageUsedBytes: number;
  storageIncludedBytes: number;
}
