/**
 * Pricing configuration — single editable source of truth.
 * Values here are provisional product constants; change them freely,
 * every pricing surface reads from this file.
 */

import type { PlanId } from "@/lib/domain/types";

export interface PricingPlan {
  id: PlanId;
  name: string;
  audience: string;
  monthlyUsd: number;
  yearlyUsd: number;
  highlight?: boolean;
  cta: string;
  features: string[];
  limits: {
    videoCredits: number;
    maxResolution: string;
    seats: number;
    storageGb: number;
  };
}

export const YEARLY_DISCOUNT_LABEL = "2 months free";

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    audience: "For individual agents",
    monthlyUsd: 29,
    yearlyUsd: 290,
    cta: "Start with Starter",
    features: [
      "10 video credits every month",
      "All three creation methods",
      "Full HD 1080p export",
      "9:16, 1:1 and 16:9 formats",
      "Core real-estate templates",
      "Music library",
      "Commercial usage",
    ],
    limits: { videoCredits: 10, maxResolution: "1080p", seats: 1, storageGb: 10 },
  },
  {
    id: "pro",
    name: "Pro",
    audience: "For active marketers and agencies",
    monthlyUsd: 79,
    yearlyUsd: 790,
    highlight: true,
    cta: "Start with Pro",
    features: [
      "40 video credits every month",
      "4K export",
      "Custom branding and end cards",
      "AI voiceover",
      "Full template library",
      "Brand kit",
      "Priority rendering",
      "3 team seats",
    ],
    limits: { videoCredits: 40, maxResolution: "4K", seats: 3, storageGb: 100 },
  },
  {
    id: "business",
    name: "Business",
    audience: "For teams, developers and large-scale marketing",
    monthlyUsd: 199,
    yearlyUsd: 1990,
    cta: "Talk to sales",
    features: [
      "Unlimited standard renders",
      "4K export with priority queue",
      "Team workspace with 10 seats",
      "Centralized brand control",
      "Reusable project templates",
      "Advanced voiceover languages",
      "Dedicated support",
      "API access — coming later",
    ],
    limits: { videoCredits: 150, maxResolution: "4K", seats: 10, storageGb: 500 },
  },
] as const;

export const planById = (id: PlanId) => {
  const plan = PRICING_PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
};
