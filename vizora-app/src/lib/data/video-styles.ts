import type { VideoStyleId } from "@/lib/domain/types";

export interface VideoStyle {
  id: VideoStyleId;
  name: string;
  tagline: string;
  /** Longer description used in pickers and template pages. */
  description: string;
  /** Cover art id from the manifest. */
  coverId: string;
  /** Relative pacing — scales scene length in the preview. */
  pace: "slow" | "medium" | "fast";
  /** Default music category for this style. */
  musicCategory: string;
}

export const VIDEO_STYLES: readonly VideoStyle[] = [
  {
    id: "cinematic",
    name: "Cinematic",
    tagline: "Emotional, premium, elegant.",
    description:
      "Slow camera moves, long dissolves and restrained titles. The default for properties that deserve an audience.",
    coverId: "azure-exterior",
    pace: "medium",
    musicCategory: "cinematic",
  },
  {
    id: "luxury",
    name: "Luxury",
    tagline: "Slow, refined, high-end storytelling.",
    description:
      "Unhurried pacing and quiet confidence. Built for penthouses, villas and addresses that sell themselves.",
    coverId: "park-penthouse",
    pace: "slow",
    musicCategory: "luxury",
  },
  {
    id: "modern",
    name: "Modern",
    tagline: "Clean, sharp, architectural.",
    description:
      "Precise cuts and structural framing. Lets the architecture do the talking.",
    coverId: "meridian-exterior",
    pace: "medium",
    musicCategory: "modern",
  },
  {
    id: "lifestyle",
    name: "Lifestyle",
    tagline: "Warm, aspirational and human.",
    description:
      "Golden light, lived-in moments and captions that speak to how it feels to be home.",
    coverId: "azure-terrace",
    pace: "medium",
    musicCategory: "emotional",
  },
  {
    id: "investor",
    name: "Investor",
    tagline: "Professional, confident, informative.",
    description:
      "Clear structure, key facts on screen, and a tone that belongs in a boardroom.",
    coverId: "grove-aerial",
    pace: "medium",
    musicCategory: "corporate",
  },
  {
    id: "social",
    name: "Social",
    tagline: "Faster pacing for social platforms.",
    description:
      "Quick scene changes and bold captions, tuned for Reels, TikTok and Stories.",
    coverId: "marina-villa",
    pace: "fast",
    musicCategory: "upbeat",
  },
] as const;

export const videoStyleById = (id: VideoStyleId): VideoStyle => {
  const style = VIDEO_STYLES.find((s) => s.id === id);
  if (!style) throw new Error(`Unknown video style: ${id}`);
  return style;
};

export interface AspectOption {
  id: "9:16" | "1:1" | "16:9";
  name: string;
  useFor: string;
  /** width/height */
  ratio: number;
}

export const ASPECT_OPTIONS: readonly AspectOption[] = [
  { id: "9:16", name: "Vertical", useFor: "Reels · TikTok · Stories", ratio: 9 / 16 },
  { id: "1:1", name: "Square", useFor: "Social feeds", ratio: 1 },
  { id: "16:9", name: "Wide", useFor: "YouTube · presentations · websites", ratio: 16 / 9 },
] as const;

export const DURATION_OPTIONS: readonly { value: 15 | 30 | 45 | 60; label: string; hint: string; recommended?: boolean }[] = [
  { value: 15, label: "15 sec", hint: "Teaser" },
  { value: 30, label: "30 sec", hint: "Standard spot", recommended: true },
  { value: 45, label: "45 sec", hint: "Full tour" },
  { value: 60, label: "60 sec", hint: "Extended story" },
] as const;

export const PROPERTY_TYPE_OPTIONS: readonly { value: NonNullable<import("@/lib/domain/types").PropertyType>; label: string }[] = [
  { value: "apartment", label: "Apartment" },
  { value: "villa", label: "Villa" },
  { value: "residential-project", label: "Residential Project" },
  { value: "penthouse", label: "Penthouse" },
  { value: "office", label: "Office" },
  { value: "commercial", label: "Commercial" },
  { value: "hotel", label: "Hotel" },
  { value: "land", label: "Land" },
  { value: "other", label: "Other" },
] as const;

export const OBJECTIVE_OPTIONS: readonly { value: import("@/lib/domain/types").MarketingObjective; label: string }[] = [
  { value: "sell", label: "Sell property" },
  { value: "leads", label: "Generate leads" },
  { value: "promote", label: "Promote project" },
  { value: "social", label: "Social media" },
  { value: "presentation", label: "Property presentation" },
  { value: "investor", label: "Investor campaign" },
] as const;
