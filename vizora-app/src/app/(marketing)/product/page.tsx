import type { Metadata } from "next";
import Link from "next/link";
import {
  AudioLines,
  Captions,
  Clapperboard,
  Layers,
  LockKeyhole,
  Mic,
  Music,
  Palette,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/marketing/sections";
import { StudioPreview } from "@/components/marketing/studio-preview";
import { artById } from "@/lib/data/art-manifest";

export const metadata: Metadata = {
  title: "Product",
  description:
    "Inside Vizora Studio: upload property images, direct the style in plain language, and publish real-estate marketing videos in minutes.",
};

const CAPABILITIES = [
  {
    icon: Layers,
    title: "Automatic story",
    copy: "Vizora sequences your images into scenes with pacing, transitions and written captions — a full storyboard before you touch anything.",
  },
  {
    icon: Wand2,
    title: "Plain-language direction",
    copy: "“Make it feel luxurious and calm.” No editing vocabulary — describe the outcome and the studio adjusts.",
  },
  {
    icon: Palette,
    title: "Six real-estate styles",
    copy: "Cinematic, Luxury, Modern, Lifestyle, Investor and Social — tuned for property, not generic video moods.",
  },
  {
    icon: Captions,
    title: "Captions that sell",
    copy: "Every scene carries copy written for property marketing. Edit any line, or regenerate alternatives.",
  },
  {
    icon: Music,
    title: "Music that fits",
    copy: "A licensed-ready library organized by mood, from quiet luxury to social-feed energy.",
  },
  {
    icon: Mic,
    title: "AI voiceover",
    copy: "Draft a narration script from your story, pick a voice and language, and preview it in the studio.",
  },
  {
    icon: Clapperboard,
    title: "Every format at once",
    copy: "9:16 for Reels, 1:1 for feeds, 16:9 for YouTube and presentations — one project, every placement.",
  },
  {
    icon: AudioLines,
    title: "Branding built in",
    copy: "Logo, contact details, call to action and end card — applied from your brand kit on every video.",
  },
] as const;

export default function ProductPage() {
  return (
    <>
      <Section className="pt-36 md:pt-44">
        <div className="container-page">
          <SectionHeading
            eyebrow="Product"
            title={
              <>
                An AI creative director,{" "}
                <em className="text-serif-accent">not another editor.</em>
              </>
            }
            description="Traditional video tools hand you a timeline and a hundred controls. Vizora asks for your property images and your intent — and handles the complexity."
          />
          <div className="mt-14">
            <StudioPreview />
          </div>
        </div>
      </Section>

      {/* How it works */}
      <Section id="how-it-works" className="hairline-t">
        <div className="container-page">
          <SectionHeading
            eyebrow="How it works"
            title="Upload. Direct. Publish."
            description="The whole workflow, from material to marketing video."
          />
          <ol className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              {
                step: "Upload",
                copy: "Drag in renders, photos, plans or site images. One hero shot is enough to start; a gallery makes a full tour.",
              },
              {
                step: "Direct",
                copy: "Tell Vizora about the property, pick a style, choose format and length. Review the story it proposes and adjust any scene.",
              },
              {
                step: "Publish",
                copy: "Generate. In about five minutes you have a polished video with captions, music and your branding — ready for every channel.",
              },
            ].map((item, index) => (
              <li key={item.step} className="rounded-2xl border border-seam bg-surface/60 p-7">
                <span className="font-mono text-xs text-faint">Step {index + 1}</span>
                <h3 className="mt-3 font-display text-xl font-medium text-ink">{item.step}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-stone">{item.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Capabilities */}
      <Section className="hairline-t">
        <div className="container-page">
          <SectionHeading
            eyebrow="Inside the studio"
            title="Everything a production team does, without the production team."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((capability) => (
              <article key={capability.title} className="rounded-2xl border border-seam bg-surface/60 p-6">
                <capability.icon className="size-5 text-stone" aria-hidden />
                <h3 className="mt-4 font-medium text-ink">{capability.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone">{capability.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </Section>

      {/* Trust */}
      <Section className="hairline-t">
        <div className="container-page grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Your material, protected"
              title="Commercial content, treated commercially."
              description="Renders and campaign material are valuable. Vizora is built around keeping them yours."
            />
            <ul className="mt-8 space-y-4">
              {[
                "Your project files stay private to your workspace.",
                "Everything you create is licensed for commercial use.",
                "Your branding stays under your control — on every export.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-3 text-sm text-ink-mid">
                  <LockKeyhole className="mt-0.5 size-4 shrink-0 text-stone" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="overflow-hidden rounded-2xl border border-seam">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artById("park-lobby").src}
              alt={artById("park-lobby").alt}
              className="aspect-[16/10] w-full object-cover"
            />
          </div>
        </div>
      </Section>

      {/* CTA */}
      <Section className="hairline-t">
        <div className="container-page text-center">
          <h2 className="text-display mx-auto max-w-2xl text-4xl text-ink">
            See it with your own property.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-stone">
            Or try the built-in sample property — no uploads needed.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="xl">Create your video</Button>
            </Link>
            <Link href="/pricing">
              <Button size="xl" variant="outline">
                View pricing
              </Button>
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
