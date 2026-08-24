/**
 * The automatic story engine — VIZORA's creative director.
 *
 * Given a project's assets and intent, it proposes a scene structure with
 * written captions. Deterministic given (project, variant), so "Regenerate"
 * cycles believable alternatives. A production model can replace this module
 * behind the same function signature.
 */

import type {
  Asset,
  MarketingObjective,
  Project,
  Scene,
  SceneMotion,
  VideoStyleId,
} from "@/lib/domain/types";
import type { ArtKind } from "@/lib/data/art-manifest";
import { ART } from "@/lib/data/art-manifest";
import { createId } from "@/lib/utils";

/* ------------------------------- copy banks ------------------------------- */

type Slot = "opening" | "space" | "view" | "amenity" | "detail" | "progress";

type Tone = "elegant" | "warm" | "sharp" | "factual" | "bold";

const TONE_BY_STYLE: Record<VideoStyleId, Tone> = {
  cinematic: "elegant",
  luxury: "elegant",
  modern: "sharp",
  lifestyle: "warm",
  investor: "factual",
  social: "bold",
};

/** {name} {location} {type} are substituted. Keep every line shippable. */
const CAPTIONS: Record<Slot, Record<Tone, string[]>> = {
  opening: {
    elegant: [
      "Discover a new way of living.",
      "Introducing {name}.",
      "An address that speaks quietly.",
      "Where {location} meets the horizon.",
    ],
    warm: [
      "Welcome to {name}.",
      "Imagine coming home to this.",
      "Life looks different from here.",
      "Your next chapter starts in {location}.",
    ],
    sharp: [
      "{name}. {location}.",
      "Architecture with intent.",
      "Designed for the way you live now.",
      "A landmark takes shape in {location}.",
    ],
    factual: [
      "{name} — {location}.",
      "A defining address in {location}.",
      "A rare opportunity in {location}.",
      "Presenting {name}.",
    ],
    bold: [
      "You need to see {name}.",
      "This is {location}'s next landmark.",
      "Stop scrolling. Start imagining.",
      "The one everyone will ask about.",
    ],
  },
  space: {
    elegant: [
      "Designed around space, light and comfort.",
      "Proportions that feel effortless.",
      "Every room composed like a photograph.",
      "Interiors shaped by natural light.",
    ],
    warm: [
      "Room to live, breathe and gather.",
      "Mornings feel slower here.",
      "Made for long dinners and easy evenings.",
      "Space that adapts to your day.",
    ],
    sharp: [
      "Clean lines. Considered materials.",
      "Light, volume and nothing wasted.",
      "Detail resolved down to the millimetre.",
      "Form that follows how you live.",
    ],
    factual: [
      "Generous floor plans with premium finishes.",
      "Specified for lasting value.",
      "Quality visible in every finish.",
      "Layouts designed for modern living.",
    ],
    bold: [
      "Look at this light.",
      "Interiors that photograph themselves.",
      "This is the living room.",
      "Finishes you can feel through the screen.",
    ],
  },
  view: {
    elegant: [
      "Wake up to uninterrupted views.",
      "The horizon, from your terrace.",
      "Evenings begin out here.",
      "A front-row seat to the sky.",
    ],
    warm: [
      "Sunsets included.",
      "Your morning coffee, with this view.",
      "The terrace becomes the favourite room.",
      "Fresh air, all to yourself.",
    ],
    sharp: [
      "Framed views by design.",
      "The skyline is part of the plan.",
      "Glass from floor to ceiling.",
      "Outside, brought in.",
    ],
    factual: [
      "Protected views across {location}.",
      "Private outdoor space on every residence.",
      "South-facing terraces throughout.",
      "Panoramic frontage.",
    ],
    bold: [
      "That view is real.",
      "Imagine this every evening.",
      "Terrace goals, unlocked.",
      "No filter needed.",
    ],
  },
  amenity: {
    elegant: [
      "Everything you need, right at home.",
      "Amenities that feel like a resort.",
      "Arrive home like a guest of honour.",
      "A lobby that sets the tone.",
    ],
    warm: [
      "Weekends without leaving home.",
      "The pool is always this quiet.",
      "Your building, your club.",
      "Come down as you are.",
    ],
    sharp: [
      "Facilities engineered for daily use.",
      "Wellness, fitness and work — on site.",
      "Services that remove friction.",
      "Every convenience, planned in.",
    ],
    factual: [
      "Residents' pool, gym and lounge.",
      "Concierge and secure parking.",
      "Full amenity programme on site.",
      "Managed to hotel standards.",
    ],
    bold: [
      "Yes, that's the residents' pool.",
      "Amenities that end arguments.",
      "The gym you'll actually use.",
      "Hotel life, permanent address.",
    ],
  },
  detail: {
    elegant: [
      "Considered in every detail.",
      "Materials chosen to age beautifully.",
      "Craft you notice slowly.",
      "Quiet luxury, built in.",
    ],
    warm: [
      "The little things, done right.",
      "Details that make it yours.",
      "Built with care you can feel.",
      "Home, down to the handles.",
    ],
    sharp: [
      "Precision as standard.",
      "Detail is the design.",
      "Nothing decorative. Everything deliberate.",
      "Engineered, then refined.",
    ],
    factual: [
      "Premium European specification.",
      "Delivered fully finished.",
      "Built by an established developer.",
      "Warranty-backed construction.",
    ],
    bold: [
      "Zoom in. It holds up.",
      "Specs that sell themselves.",
      "This finish, everywhere.",
      "Quality you can screenshot.",
    ],
  },
  progress: {
    elegant: [
      "Taking shape, on schedule.",
      "From vision to structure.",
      "Rising above {location}.",
      "The skyline, under construction.",
    ],
    warm: [
      "Watch your future home rise.",
      "Progress you can visit.",
      "Every week, closer to keys.",
      "Built in the open.",
    ],
    sharp: [
      "Milestones, delivered.",
      "Structure complete. Facade next.",
      "On programme. On budget.",
      "Construction, documented.",
    ],
    factual: [
      "Construction progress — {name}.",
      "Core complete; handover ahead.",
      "Delivery on track.",
      "Latest site progress.",
    ],
    bold: [
      "It's really happening.",
      "From render to reality.",
      "Progress update: unreal.",
      "Cranes mean momentum.",
    ],
  },
};

const CLOSING_BY_OBJECTIVE: Record<MarketingObjective, string[]> = {
  sell: ["Book your private viewing.", "Arrange a viewing today.", "Your viewing awaits."],
  leads: ["Register your interest.", "Request the brochure.", "Be first to know."],
  promote: ["Coming soon to {location}.", "Follow the journey.", "Discover {name}."],
  social: ["Tap to see more.", "Follow for the reveal.", "Save this one."],
  presentation: ["Presented by {brand}.", "Let's walk through it.", "See it in person."],
  investor: ["Request the investment brief.", "Schedule an investor call.", "Review the opportunity."],
};

const TITLES: Record<Slot | "closing", string[]> = {
  opening: ["Opening exterior", "Establishing shot", "Arrival"],
  space: ["Living space", "Interior", "Living area"],
  view: ["Terrace", "The view", "Outdoor living"],
  amenity: ["Amenities", "Residents' club", "The lobby"],
  detail: ["Details", "Finishes", "Close-up"],
  progress: ["Site progress", "Construction", "Milestone"],
  closing: ["Closing card", "End card", "Call to action"],
};

/* ------------------------------ scene builder ------------------------------ */

const MOTION_CYCLE: SceneMotion[] = ["push", "pan-right", "rise", "pan-left", "pull"];

function slotForKind(kind: ArtKind | undefined, index: number, total: number): Slot {
  if (index === 0) return "opening";
  switch (kind) {
    case "aerial":
      return index === 0 ? "opening" : "view";
    case "exterior":
      return index === 0 ? "opening" : "detail";
    case "interior":
      return "space";
    case "terrace":
      return "view";
    case "amenity":
      return "amenity";
    case "construction":
      return "progress";
    case "plan":
      return "detail";
    default:
      // Uploads without classification: rotate through a natural arc.
      return (["space", "view", "detail", "amenity"] as Slot[])[index % 4] ?? (index === total - 1 ? "view" : "space");
  }
}

function narrativeOrder(assets: Asset[]): Asset[] {
  const rank: Record<string, number> = {
    aerial: 0,
    exterior: 1,
    interior: 2,
    terrace: 3,
    amenity: 4,
    plan: 5,
    construction: 6,
  };
  const kindOf = (asset: Asset) => ART.find((a) => a.src === asset.src)?.kind;
  return [...assets].sort((a, b) => {
    const ka = kindOf(a);
    const kb = kindOf(b);
    if (ka === undefined && kb === undefined) return 0;
    if (ka === undefined) return 1;
    if (kb === undefined) return -1;
    return (rank[ka] ?? 9) - (rank[kb] ?? 9);
  });
}

function fill(template: string, project: Pick<Project, "name" | "location" | "branding">) {
  return template
    .replaceAll("{name}", project.name || "this address")
    .replaceAll("{location}", project.location || "the city")
    .replaceAll("{brand}", project.branding.brandName || "your team");
}

export function sceneCountFor(durationSec: number, assetCount: number) {
  const byDuration = durationSec <= 15 ? 3 : durationSec <= 30 ? 4 : durationSec <= 45 ? 6 : 7;
  return Math.max(1, Math.min(byDuration, assetCount));
}

/**
 * Build the proposed story. `variant` cycles alternative copy on regenerate.
 */
export function generateStory(
  project: Project,
  assets: Asset[],
  variant = 0,
): Scene[] {
  const tone = TONE_BY_STYLE[project.styleId ?? "cinematic"];
  const ordered = narrativeOrder(assets);
  const count = sceneCountFor(project.durationSec, ordered.length);
  const chosen = ordered.slice(0, count);

  const usedSlots = new Map<Slot, number>();
  const scenes: Scene[] = chosen.map((asset, index) => {
    const kind = ART.find((a) => a.src === asset.src)?.kind;
    let slot = slotForKind(kind, index, chosen.length);
    // Avoid three of the same slot in a row reading repetitive.
    const seen = usedSlots.get(slot) ?? 0;
    if (seen >= 2 && slot !== "opening") slot = "detail";
    usedSlots.set(slot, seen + 1);

    const bank = CAPTIONS[slot][tone];
    const caption = fill(bank[(index + variant) % bank.length], project);
    const titleBank = TITLES[slot];
    return {
      id: createId("scene"),
      kind: "footage",
      assetId: asset.id,
      title: titleBank[seen % titleBank.length],
      caption,
      motion: index === 0 ? "push" : MOTION_CYCLE[(index + variant) % MOTION_CYCLE.length],
      hidden: false,
    };
  });

  const closingBank = CLOSING_BY_OBJECTIVE[project.objective ?? "promote"];
  scenes.push({
    id: createId("scene"),
    kind: "endcard",
    assetId: null,
    title: "Closing card",
    caption: fill(closingBank[variant % closingBank.length], project),
    motion: "push",
    hidden: false,
  });

  return scenes;
}

/** Regenerate copy for one scene, keeping its asset and position. */
export function regenerateCaption(
  project: Project,
  scene: Scene,
  variant: number,
): string {
  if (scene.kind === "endcard") {
    const bank = CLOSING_BY_OBJECTIVE[project.objective ?? "promote"];
    return fill(bank[variant % bank.length], project);
  }
  const tone = TONE_BY_STYLE[project.styleId ?? "cinematic"];
  // Infer slot from the current title.
  const slot =
    (Object.entries(TITLES).find(([, titles]) => titles.includes(scene.title))?.[0] as Slot | undefined) ??
    "space";
  if (slot === ("closing" as never)) return scene.caption;
  const bank = CAPTIONS[slot as Slot]?.[tone] ?? CAPTIONS.space[tone];
  return fill(bank[variant % bank.length], project);
}

/** Draft a voiceover script from the visible story. */
export function draftVoiceoverScript(project: Project, scenes: Scene[]): string {
  const visible = scenes.filter((scene) => !scene.hidden);
  const lines = visible.map((scene) => fill(scene.caption, project));
  const intro =
    project.name && project.location
      ? `${project.name}, ${project.location}.`
      : project.name
        ? `${project.name}.`
        : "";
  return [intro, ...lines].filter(Boolean).join(" ");
}
