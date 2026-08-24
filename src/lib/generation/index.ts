/**
 * Provider registry — the single place a production vendor gets wired in.
 *
 * Later:
 *   const provider = new ProductionVideoGenerationProvider({ apiKey: ... })
 */

import { MockVideoGenerationProvider } from "./mock-provider";
import type { VideoGenerationProvider } from "./provider";

let instance: VideoGenerationProvider | null = null;

export function getVideoGenerationProvider(): VideoGenerationProvider {
  if (!instance) instance = new MockVideoGenerationProvider();
  return instance;
}

export { PHASE_MESSAGES } from "./provider";
export type { GenerationRequest, GenerationSnapshot, VideoGenerationProvider } from "./provider";
