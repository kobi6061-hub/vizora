/**
 * Video generation service boundary.
 *
 * The application talks ONLY to this interface. `MockVideoGenerationProvider`
 * implements it today; a `ProductionVideoGenerationProvider` (external AI
 * vendor) replaces it in `lib/generation/index.ts` without UI changes.
 */

import type { AspectRatio, GenerationPhase, VideoResult } from "@/lib/domain/types";

export interface GenerationRequest {
  projectId: string;
  sceneCount: number;
  durationSec: number;
  aspectRatio: AspectRatio;
}

export interface GenerationSnapshot {
  id: string;
  projectId: string;
  phase: GenerationPhase;
  /** 0–100 across the whole run. */
  progress: number;
  /** Human line for the generation experience. */
  message: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface VideoGenerationProvider {
  createGeneration(request: GenerationRequest): Promise<{ generationId: string }>;
  getGenerationStatus(generationId: string): Promise<GenerationSnapshot | null>;
  cancelGeneration(generationId: string): Promise<void>;
  getResult(generationId: string): Promise<VideoResult | null>;
  /** Convenience over polling; returns an unsubscribe function. */
  subscribe(generationId: string, listener: (snapshot: GenerationSnapshot) => void): () => void;
}

export const PHASE_MESSAGES: Record<GenerationPhase, string> = {
  QUEUED: "Reserving studio time",
  ANALYZING: "Preparing your property story",
  CREATING_SCENES: "Building your scenes",
  GENERATING_MOTION: "Creating cinematic motion",
  ASSEMBLING: "Adding transitions",
  FINALIZING: "Finishing your marketing video",
  COMPLETED: "Your video is ready",
  FAILED: "Generation failed",
};
