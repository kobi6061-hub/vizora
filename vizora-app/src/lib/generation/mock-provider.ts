/**
 * Simulated generation engine.
 *
 * Progress is a pure function of elapsed time since `startedAt`, persisted in
 * localStorage — a run survives reloads and completes honestly. No external
 * provider is involved; results are storyboard previews rendered in-app.
 */

import type { GenerationPhase, VideoResult } from "@/lib/domain/types";
import { readJson, writeJson } from "@/lib/storage/local";
import { createId } from "@/lib/utils";
import {
  PHASE_MESSAGES,
  type GenerationRequest,
  type GenerationSnapshot,
  type VideoGenerationProvider,
} from "./provider";

interface StoredGeneration {
  id: string;
  projectId: string;
  startedAt: string;
  totalMs: number;
  aspectRatio: GenerationRequest["aspectRatio"];
  durationSec: number;
  cancelled?: boolean;
}

const STORE_KEY = "generations";

/** Phase timeline as fractions of the whole run. */
const PHASES: { phase: GenerationPhase; until: number }[] = [
  { phase: "QUEUED", until: 0.05 },
  { phase: "ANALYZING", until: 0.16 },
  { phase: "CREATING_SCENES", until: 0.38 },
  { phase: "GENERATING_MOTION", until: 0.72 },
  { phase: "ASSEMBLING", until: 0.9 },
  { phase: "FINALIZING", until: 1 },
];

function readAll(): Record<string, StoredGeneration> {
  return readJson<Record<string, StoredGeneration>>(STORE_KEY, {});
}

function writeAll(all: Record<string, StoredGeneration>) {
  writeJson(STORE_KEY, all);
}

function snapshotOf(generation: StoredGeneration): GenerationSnapshot {
  if (generation.cancelled) {
    return {
      id: generation.id,
      projectId: generation.projectId,
      phase: "FAILED",
      progress: 0,
      message: "Generation cancelled",
      startedAt: generation.startedAt,
      error: "Cancelled before completion.",
    };
  }
  const elapsed = Date.now() - new Date(generation.startedAt).getTime();
  const t = Math.min(1, elapsed / generation.totalMs);
  if (t >= 1) {
    return {
      id: generation.id,
      projectId: generation.projectId,
      phase: "COMPLETED",
      progress: 100,
      message: PHASE_MESSAGES.COMPLETED,
      startedAt: generation.startedAt,
      completedAt: new Date(new Date(generation.startedAt).getTime() + generation.totalMs).toISOString(),
    };
  }
  // Ease progress slightly so it feels organic, never stalls at 99.
  const eased = t < 0.9 ? t * (2 - t) * 0.92 : 0.83 + (t - 0.9) * 1.7;
  const phase = PHASES.find((p) => t < p.until)?.phase ?? "FINALIZING";
  return {
    id: generation.id,
    projectId: generation.projectId,
    phase,
    progress: Math.round(Math.min(0.99, eased) * 100),
    message: PHASE_MESSAGES[phase],
    startedAt: generation.startedAt,
  };
}

export class MockVideoGenerationProvider implements VideoGenerationProvider {
  /** Base run length; scaled a little by scene count so bigger edits feel bigger. */
  private baseMs: number;

  constructor(options?: { baseMs?: number }) {
    this.baseMs = options?.baseMs ?? 34_000;
  }

  async createGeneration(request: GenerationRequest) {
    const id = createId("gen");
    const totalMs = this.baseMs + request.sceneCount * 2_400;
    const all = readAll();
    all[id] = {
      id,
      projectId: request.projectId,
      startedAt: new Date().toISOString(),
      totalMs,
      aspectRatio: request.aspectRatio,
      durationSec: request.durationSec,
    };
    writeAll(all);
    return { generationId: id };
  }

  async getGenerationStatus(generationId: string) {
    const generation = readAll()[generationId];
    return generation ? snapshotOf(generation) : null;
  }

  async cancelGeneration(generationId: string) {
    const all = readAll();
    const generation = all[generationId];
    if (generation && Date.now() - new Date(generation.startedAt).getTime() < generation.totalMs) {
      generation.cancelled = true;
      writeAll(all);
    }
  }

  async getResult(generationId: string): Promise<VideoResult | null> {
    const generation = readAll()[generationId];
    if (!generation) return null;
    const snapshot = snapshotOf(generation);
    if (snapshot.phase !== "COMPLETED") return null;
    return {
      id: createId("vid"),
      renderedAt: snapshot.completedAt ?? new Date().toISOString(),
      durationSec: generation.durationSec,
      aspectRatio: generation.aspectRatio,
      kind: "storyboard-preview",
    };
  }

  subscribe(generationId: string, listener: (snapshot: GenerationSnapshot) => void) {
    const tick = () => {
      const generation = readAll()[generationId];
      if (!generation) return;
      const snapshot = snapshotOf(generation);
      listener(snapshot);
      if (snapshot.phase === "COMPLETED" || snapshot.phase === "FAILED") {
        window.clearInterval(interval);
      }
    };
    const interval = window.setInterval(tick, 300);
    tick();
    return () => window.clearInterval(interval);
  }
}
