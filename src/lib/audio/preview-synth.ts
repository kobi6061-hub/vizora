"use client";

/**
 * In-browser music preview synth.
 *
 * Renders short generative chord pads from each track's synth parameters —
 * original material, so previews carry zero licensing exposure. A licensed
 * music provider replaces this with real audio files behind the same calls.
 */

import type { MusicTrack } from "@/lib/data/music";

let context: AudioContext | null = null;
let masterGain: GainNode | null = null;
let activeNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
let loopTimer: number | null = null;
let currentTrackId: string | null = null;

function ensureContext() {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    context = new Ctor();
    masterGain = context.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(context.destination);
  }
  return context;
}

const MAJOR = [0, 4, 7, 11];
const MINOR = [0, 3, 7, 10];

function midiToFreq(semitoneFromA3: number) {
  return 220 * 2 ** (semitoneFromA3 / 12);
}

function scheduleChord(
  ctx: AudioContext,
  destination: GainNode,
  rootSemitone: number,
  intervals: number[],
  start: number,
  duration: number,
  brightness: number,
) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500 + brightness * 2600;
  filter.Q.value = 0.6;
  filter.connect(destination);

  intervals.forEach((interval, voice) => {
    for (const detune of [-4, 4]) {
      const osc = ctx.createOscillator();
      osc.type = voice === 0 ? "sine" : "triangle";
      osc.frequency.value = midiToFreq(rootSemitone + interval - (voice === 0 ? 12 : 0));
      osc.detune.value = detune;

      const gain = ctx.createGain();
      const peak = (voice === 0 ? 0.16 : 0.07) / 2;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + duration * 0.3);
      gain.gain.linearRampToValueAtTime(peak * 0.7, start + duration * 0.8);
      gain.gain.linearRampToValueAtTime(0, start + duration + 0.05);

      osc.connect(gain);
      gain.connect(filter);
      osc.start(start);
      osc.stop(start + duration + 0.1);
      activeNodes.push({ osc, gain });
    }
  });
}

function scheduleCycle(track: MusicTrack, startTime: number) {
  const ctx = context;
  if (!ctx || !masterGain) return 0;
  const beatSeconds = 60 / track.bpm;
  const chordDuration = beatSeconds * 4;
  const intervals = track.synth.mode === "major" ? MAJOR : MINOR;
  track.synth.progression.forEach((degree, index) => {
    scheduleChord(
      ctx,
      masterGain!,
      track.synth.root + degree,
      intervals,
      startTime + index * chordDuration,
      chordDuration,
      track.synth.brightness,
    );
  });
  return track.synth.progression.length * chordDuration;
}

export const previewSynth = {
  /** Play (or switch to) a track preview loop. Volume 0–100. */
  async play(track: MusicTrack, volume: number) {
    const ctx = ensureContext();
    if (!ctx || !masterGain) return false;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    this.stop();
    currentTrackId = track.id;
    masterGain.gain.value = Math.max(0, Math.min(1, volume / 100)) * 0.8;

    const cycle = scheduleCycle(track, ctx.currentTime + 0.05);
    if (cycle > 0) {
      loopTimer = window.setInterval(() => {
        if (context) scheduleCycle(track, context.currentTime + 0.05);
      }, cycle * 1000);
    }
    return true;
  },

  setVolume(volume: number) {
    if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, volume / 100)) * 0.8;
  },

  stop() {
    if (loopTimer !== null) {
      window.clearInterval(loopTimer);
      loopTimer = null;
    }
    const now = context?.currentTime ?? 0;
    for (const node of activeNodes) {
      try {
        node.gain.gain.cancelScheduledValues(now);
        node.gain.gain.linearRampToValueAtTime(0, now + 0.08);
        node.osc.stop(now + 0.12);
      } catch {
        /* already stopped */
      }
    }
    activeNodes = [];
    currentTrackId = null;
  },

  playingTrackId() {
    return currentTrackId;
  },
};

/* ------------------------------- voiceover ------------------------------- */

export const VOICE_LANGUAGES = [
  { id: "English", bcp47: "en-US" },
  { id: "Hebrew", bcp47: "he-IL" },
  { id: "Spanish", bcp47: "es-ES" },
  { id: "French", bcp47: "fr-FR" },
  { id: "German", bcp47: "de-DE" },
  { id: "Arabic", bcp47: "ar-SA" },
] as const;

export const voiceoverPreview = {
  supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  },

  /** Best-effort voice preview via the browser's built-in speech engine. */
  speak(script: string, language: string, gender: "female" | "male", onEnd?: () => void) {
    if (!this.supported()) return false;
    const synth = window.speechSynthesis;
    synth.cancel();
    const bcp47 = VOICE_LANGUAGES.find((l) => l.id === language)?.bcp47 ?? "en-US";
    const utterance = new SpeechSynthesisUtterance(script.slice(0, 260));
    utterance.lang = bcp47;
    utterance.rate = 0.96;
    utterance.pitch = gender === "female" ? 1.08 : 0.88;

    const voices = synth.getVoices().filter((voice) => voice.lang.startsWith(bcp47.split("-")[0]));
    const genderHints =
      gender === "female"
        ? ["female", "woman", "samantha", "victoria", "karen", "zira", "carmit"]
        : ["male", "man", "daniel", "alex", "david", "fred"];
    const match =
      voices.find((voice) => genderHints.some((hint) => voice.name.toLowerCase().includes(hint))) ??
      voices[0];
    if (match) utterance.voice = match;
    if (onEnd) utterance.onend = onEnd;
    synth.speak(utterance);
    return true;
  },

  stop() {
    if (this.supported()) window.speechSynthesis.cancel();
  },
};
