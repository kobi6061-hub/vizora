import type { Template } from "@/lib/domain/types";

/**
 * Template library. Blueprints seed a project's story; the story engine
 * still adapts captions to the user's property details.
 */
export const TEMPLATES: readonly Template[] = [
  {
    id: "luxury-apartment",
    name: "Luxury Apartment",
    tagline: "Elegant, slow cinematic storytelling.",
    category: "luxury",
    styleId: "luxury",
    aspectRatio: "16:9",
    durationSec: 45,
    coverSrc: "/art/park-penthouse.svg",
    sceneBlueprints: [
      { title: "Arrival", caption: "An address that speaks quietly.", motion: "push" },
      { title: "Living space", caption: "Proportions that feel effortless.", motion: "pan-right" },
      { title: "The view", caption: "The horizon, from your window.", motion: "rise" },
      { title: "Details", caption: "Considered in every detail.", motion: "pull" },
    ],
  },
  {
    id: "new-development",
    name: "New Development",
    tagline: "Perfect for architectural renders.",
    category: "development",
    styleId: "cinematic",
    aspectRatio: "16:9",
    durationSec: 30,
    coverSrc: "/art/grove-aerial.svg",
    sceneBlueprints: [
      { title: "Establishing shot", caption: "A landmark takes shape.", motion: "push" },
      { title: "Masterplan", caption: "A neighbourhood, considered as a whole.", motion: "pan-left" },
      { title: "Living space", caption: "Interiors shaped by natural light.", motion: "pan-right" },
      { title: "Amenities", caption: "Everything you need, right at home.", motion: "rise" },
    ],
  },
  {
    id: "property-listing",
    name: "Property Listing",
    tagline: "Fast, clear property promotion.",
    category: "listing",
    styleId: "modern",
    aspectRatio: "16:9",
    durationSec: 30,
    coverSrc: "/art/tower-marine.svg",
    sceneBlueprints: [
      { title: "Opening exterior", caption: "{name}. {location}.", motion: "push" },
      { title: "Living area", caption: "Light, volume and nothing wasted.", motion: "pan-right" },
      { title: "Interior", caption: "Detail resolved down to the millimetre.", motion: "pan-left" },
      { title: "Outdoor living", caption: "Outside, brought in.", motion: "rise" },
    ],
  },
  {
    id: "instagram-reel",
    name: "Instagram Reel",
    tagline: "Vertical social-first edit.",
    category: "social",
    styleId: "social",
    aspectRatio: "9:16",
    durationSec: 15,
    coverSrc: "/art/azure-pool.svg",
    sceneBlueprints: [
      { title: "Hook", caption: "You need to see this one.", motion: "push" },
      { title: "Living space", caption: "Interiors that photograph themselves.", motion: "pan-right" },
      { title: "The view", caption: "That view is real.", motion: "rise" },
    ],
  },
  {
    id: "investor-presentation",
    name: "Investor Presentation",
    tagline: "Professional project overview.",
    category: "investor",
    styleId: "investor",
    aspectRatio: "16:9",
    durationSec: 60,
    coverSrc: "/art/meridian-exterior.svg",
    sceneBlueprints: [
      { title: "Establishing shot", caption: "{name} — {location}.", motion: "push" },
      { title: "Masterplan", caption: "A rare opportunity in {location}.", motion: "pan-right" },
      { title: "Interior", caption: "Specified for lasting value.", motion: "pan-left" },
      { title: "Amenities", caption: "Managed to hotel standards.", motion: "rise" },
      { title: "Site progress", caption: "Delivery on track.", motion: "pull" },
    ],
  },
  {
    id: "villa-showcase",
    name: "Villa Showcase",
    tagline: "Luxury lifestyle narrative.",
    category: "villa",
    styleId: "lifestyle",
    aspectRatio: "16:9",
    durationSec: 45,
    coverSrc: "/art/marina-villa.svg",
    sceneBlueprints: [
      { title: "Arrival", caption: "Imagine coming home to this.", motion: "push" },
      { title: "Living space", caption: "Made for long dinners and easy evenings.", motion: "pan-right" },
      { title: "Terrace", caption: "Sunsets included.", motion: "rise" },
      { title: "The pool", caption: "Weekends without leaving home.", motion: "pan-left" },
    ],
  },
  {
    id: "construction-progress",
    name: "Construction Progress",
    tagline: "Turn progress images into a professional update.",
    category: "construction",
    styleId: "investor",
    aspectRatio: "16:9",
    durationSec: 30,
    coverSrc: "/art/grove-construction.svg",
    sceneBlueprints: [
      { title: "Site progress", caption: "Construction progress — {name}.", motion: "push" },
      { title: "Milestone", caption: "Structure complete. Facade next.", motion: "pan-right" },
      { title: "The vision", caption: "From vision to structure.", motion: "rise" },
    ],
  },
] as const;

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null;

export const TEMPLATE_CATEGORY_LABELS: Record<Template["category"], string> = {
  luxury: "Luxury",
  development: "Developments",
  listing: "Listings",
  social: "Social",
  investor: "Investor",
  villa: "Villas",
  construction: "Construction",
};
