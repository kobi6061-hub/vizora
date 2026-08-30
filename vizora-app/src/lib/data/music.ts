/**
 * Music library — original placeholder tracks, no licensing exposure.
 * Previews are synthesised in-browser (see lib/audio/preview-synth.ts);
 * a licensed music provider replaces `tracks` without UI changes.
 */

export interface MusicCategory {
  id: string;
  name: string;
}

export const MUSIC_CATEGORIES: readonly MusicCategory[] = [
  { id: "cinematic", name: "Cinematic" },
  { id: "luxury", name: "Luxury" },
  { id: "modern", name: "Modern" },
  { id: "emotional", name: "Emotional" },
  { id: "upbeat", name: "Upbeat" },
  { id: "minimal", name: "Minimal" },
  { id: "corporate", name: "Corporate" },
] as const;

export interface MusicTrack {
  id: string;
  name: string;
  category: string;
  durationSec: number;
  bpm: number;
  /** Parameters for the in-browser preview synth. */
  synth: {
    /** Semitone offset of the root from A3. */
    root: number;
    mode: "major" | "minor";
    /** Chord degrees, played as a loop. */
    progression: number[];
    brightness: number;
  };
}

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { id: "first-light", name: "First Light", category: "cinematic", durationSec: 96, bpm: 72, synth: { root: -4, mode: "major", progression: [0, 5, 3, 4], brightness: 0.6 } },
  { id: "the-reveal", name: "The Reveal", category: "cinematic", durationSec: 104, bpm: 68, synth: { root: -7, mode: "minor", progression: [0, 3, 4, 5], brightness: 0.5 } },
  { id: "marble-halls", name: "Marble Halls", category: "luxury", durationSec: 112, bpm: 60, synth: { root: -2, mode: "major", progression: [0, 3, 5, 4], brightness: 0.4 } },
  { id: "quiet-luxury", name: "Quiet Luxury", category: "luxury", durationSec: 98, bpm: 58, synth: { root: -5, mode: "major", progression: [0, 4, 3, 0], brightness: 0.35 } },
  { id: "glass-and-stone", name: "Glass & Stone", category: "modern", durationSec: 92, bpm: 96, synth: { root: 0, mode: "minor", progression: [0, 5, 4, 3], brightness: 0.7 } },
  { id: "blueprint", name: "Blueprint", category: "modern", durationSec: 88, bpm: 102, synth: { root: -3, mode: "minor", progression: [0, 4, 0, 5], brightness: 0.75 } },
  { id: "golden-hour", name: "Golden Hour", category: "emotional", durationSec: 106, bpm: 76, synth: { root: -4, mode: "major", progression: [0, 4, 5, 3], brightness: 0.55 } },
  { id: "coming-home", name: "Coming Home", category: "emotional", durationSec: 100, bpm: 70, synth: { root: -9, mode: "major", progression: [0, 3, 4, 0], brightness: 0.5 } },
  { id: "skyline-drive", name: "Skyline Drive", category: "upbeat", durationSec: 84, bpm: 118, synth: { root: -2, mode: "major", progression: [0, 4, 5, 4], brightness: 0.85 } },
  { id: "momentum", name: "Momentum", category: "upbeat", durationSec: 80, bpm: 124, synth: { root: 1, mode: "minor", progression: [0, 5, 3, 4], brightness: 0.9 } },
  { id: "soft-focus", name: "Soft Focus", category: "minimal", durationSec: 110, bpm: 64, synth: { root: -6, mode: "major", progression: [0, 5, 0, 4], brightness: 0.3 } },
  { id: "horizon-line", name: "Horizon Line", category: "minimal", durationSec: 96, bpm: 66, synth: { root: -1, mode: "minor", progression: [0, 3, 0, 4], brightness: 0.35 } },
  { id: "new-heights", name: "New Heights", category: "corporate", durationSec: 94, bpm: 100, synth: { root: -3, mode: "major", progression: [0, 4, 3, 5], brightness: 0.65 } },
  { id: "signature", name: "Signature", category: "corporate", durationSec: 90, bpm: 92, synth: { root: 0, mode: "major", progression: [0, 5, 4, 0], brightness: 0.6 } },
] as const;

export const trackById = (id: string) => MUSIC_TRACKS.find((t) => t.id === id) ?? null;
