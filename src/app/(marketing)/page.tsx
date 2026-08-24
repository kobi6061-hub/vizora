import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Camera,
  Clapperboard,
  Globe2,
  HardHat,
  Image as ImageIcon,
  Images,
  Sparkle,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hero } from "@/components/marketing/hero";
import { BeforeAfter } from "@/components/marketing/before-after";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Section, SectionHeading } from "@/components/marketing/sections";
import { MiniPlayer } from "@/components/player/mini-player";
import { artById } from "@/lib/data/art-manifest";

export const metadata: Metadata = {
  title: "Vizora — Turn property images into marketing videos in 5 minutes",
  description:
    "The AI video studio built for real estate. Upload renders or photos, direct the style, and publish a polished property marketing video in about 5 minutes.",
};

const STEPS = [
  {
    number: "1",
    title: "Upload",
    copy: "Add renders, photos or property images — one hero shot or the whole gallery.",
    art: "grove-plan",
  },
  {
    number: "2",
    title: "Direct",
    copy: "Choose the style and tell Vizora what you want. No editing vocabulary needed.",
    art: "azure-living",
  },
  {
    number: "3",
    title: "Publish",
    copy: "Get your finished marketing video in minutes, in every format your campaign needs.",
    art: "azure-exterior",
  },
] as const;

const METHODS: readonly {
  icon: typeof ImageIcon;
  title: string;
  copy: string;
  href: string;
  recommended?: boolean;
}[] = [
  {
    icon: ImageIcon,
    title: "Image to Video",
    copy: "Turn one property image into cinematic footage.",
    href: "/image-to-video",
  },
  {
    icon: Images,
    title: "Images to Video",
    copy: "Create a complete marketing video from your property gallery.",
    href: "/product",
    recommended: true,
  },
  {
    icon: Type,
    title: "Text to Video",
    copy: "Describe the property and let Vizora create the concept.",
    href: "/product",
  },
] as const;

const USE_CASES = [
  {
    icon: Building2,
    title: "New Developments",
    copy: "Turn architectural renders into marketing campaigns before construction is complete.",
    art: "grove-aerial",
  },
  {
    icon: Camera,
    title: "Property Listings",
    copy: "Create listing videos from photography in minutes.",
    art: "tower-marine",
  },
  {
    icon: Sparkle,
    title: "Luxury Real Estate",
    copy: "Transform premium properties into cinematic stories.",
    art: "park-penthouse",
  },
  {
    icon: Clapperboard,
    title: "Social Media",
    copy: "Generate vertical marketing videos for Reels and Stories.",
    art: "azure-pool",
  },
  {
    icon: HardHat,
    title: "Construction Updates",
    copy: "Turn project-progress images into polished client updates.",
    art: "grove-construction",
  },
  {
    icon: Globe2,
    title: "International Marketing",
    copy: "Quickly adapt property content for different campaigns and audiences.",
    art: "meridian-skyline",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <Hero />

      {/* How it works */}
      <Section id="how-it-works" className="hairline-t">
        <div className="container-page">
          <SectionHeading
            eyebrow="How it works"
            title={
              <>
                From still image to <em className="text-serif-accent">moving story.</em>
              </>
            }
            description="Three steps between the material you already have and a video that sells the property."
          />
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {STEPS.map((step) => (
              <article
                key={step.number}
                className="group overflow-hidden rounded-2xl border border-seam bg-surface/60"
              >
                <div className="relative overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={artById(step.art).src}
                    alt={artById(step.art).alt}
                    className="aspect-[16/10] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                  />
                  <span className="absolute left-4 top-4 flex size-8 items-center justify-center rounded-full bg-ground/85 font-mono text-xs text-ink backdrop-blur">
                    {step.number}
                  </span>
                </div>
                <div className="p-6">
                  <h3 className="font-display text-lg font-medium text-ink">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone">{step.copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </Section>

      {/* Before / After */}
      <Section className="hairline-t">
        <div className="container-page">
          <SectionHeading
            eyebrow="The difference"
            title={
              <>
                One image. <em className="text-serif-accent">Completely different impact.</em>
              </>
            }
            description="Drag the seam. The left side is the still you already have — the right side is what your audience sees after Vizora."
          />
          <BeforeAfter className="mt-12" />
        </div>
      </Section>

      {/* Creation methods */}
      <Section className="hairline-t">
        <div className="container-page">
          <SectionHeading
            eyebrow="Three ways in"
            title="Start from whatever you have."
            description="A single render, a full shoot, or just a written brief — each path ends in a finished video."
          />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {METHODS.map((method) => (
              <Link
                key={method.title}
                href={method.href}
                className="group relative rounded-2xl border border-seam bg-surface/60 p-7 transition-colors hover:border-seam-strong hover:bg-surface"
              >
                {method.recommended && (
                  <span className="absolute right-5 top-5 rounded-full bg-signal/15 px-2.5 py-0.5 text-[11px] font-medium text-signal-bright">
                    Recommended
                  </span>
                )}
                <method.icon className="size-6 text-stone transition-colors group-hover:text-signal-bright" aria-hidden />
                <h3 className="mt-5 font-display text-lg font-medium text-ink">{method.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone">{method.copy}</p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-mid transition-colors group-hover:text-ink">
                  Learn more
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </Section>

      {/* Use cases */}
      <Section className="hairline-t">
        <div className="container-page">
          <SectionHeading
            eyebrow="Use cases"
            title={
              <>
                Built for <em className="text-serif-accent">real estate.</em>
              </>
            }
            description="Not a generic video tool with a property preset — every workflow starts from how property gets marketed."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((useCase) => (
              <article
                key={useCase.title}
                className="group overflow-hidden rounded-2xl border border-seam bg-surface/60"
              >
                <div className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={artById(useCase.art).src}
                    alt={artById(useCase.art).alt}
                    className="aspect-[16/9] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                  />
                </div>
                <div className="flex items-start gap-3.5 p-5">
                  <useCase.icon className="mt-0.5 size-5 shrink-0 text-stone" aria-hidden />
                  <div>
                    <h3 className="font-medium text-ink">{useCase.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-stone">{useCase.copy}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </Section>

      {/* Showcase teaser */}
      <Section className="hairline-t">
        <div className="container-page">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading
              eyebrow="Examples"
              title="What Vizora produces."
              description="Every example below started as still images — no filming, no editor, no production team."
            />
            <Link href="/examples">
              <Button variant="outline">
                Browse all examples
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </Link>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {[
              {
                aspect: "16:9" as const,
                scenes: [
                  { src: artById("park-exterior").src, alt: artById("park-exterior").alt, caption: "An address that speaks quietly.", motion: "push" as const },
                  { src: artById("park-penthouse").src, alt: artById("park-penthouse").alt, caption: "The horizon, from your window.", motion: "pan-right" as const },
                ],
                label: "Luxury listing · 0:45",
              },
              {
                aspect: "9:16" as const,
                scenes: [
                  { src: artById("azure-pool").src, alt: artById("azure-pool").alt, caption: "You need to see this one.", motion: "push" as const },
                  { src: artById("azure-terrace").src, alt: artById("azure-terrace").alt, caption: "That view is real.", motion: "rise" as const },
                ],
                label: "Instagram Reel · 0:15",
              },
              {
                aspect: "16:9" as const,
                scenes: [
                  { src: artById("grove-construction").src, alt: artById("grove-construction").alt, caption: "Rising above London.", motion: "push" as const },
                  { src: artById("grove-aerial").src, alt: artById("grove-aerial").alt, caption: "From vision to structure.", motion: "pan-left" as const },
                ],
                label: "Construction update · 0:30",
              },
            ].map((example) => (
              <figure key={example.label} className="space-y-2.5">
                <div className="overflow-hidden rounded-2xl border border-seam">
                  <MiniPlayer
                    scenes={example.scenes}
                    aspect={example.aspect}
                    sceneDurationMs={3400}
                  />
                </div>
                <figcaption className="px-1 font-mono text-[11px] uppercase tracking-[0.12em] text-stone">
                  {example.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </Section>

      {/* Pricing teaser */}
      <Section className="hairline-t">
        <div className="container-page">
          <SectionHeading
            align="center"
            eyebrow="Pricing"
            title="Plans that pay for themselves in one listing."
            description="Start free of production costs. Upgrade when your pipeline grows."
          />
          <div className="mt-12">
            <PricingCards compact />
          </div>
        </div>
      </Section>

      {/* Final CTA */}
      <Section className="hairline-t">
        <div className="container-page">
          <div className="relative overflow-hidden rounded-3xl border border-seam">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artById("meridian-skyline").src}
              alt=""
              aria-hidden
              className="absolute inset-0 size-full object-cover opacity-50"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ground via-ground/70 to-ground/30" />
            <div className="relative px-6 py-20 text-center md:py-28">
              <h2 className="text-display mx-auto max-w-2xl text-4xl text-ink md:text-5xl">
                Your property. Your video.{" "}
                <em className="text-serif-accent">In 5 minutes.</em>
              </h2>
              <p className="mx-auto mt-4 max-w-md text-base text-ink-mid">
                Upload your property images. Get a video ready to publish.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/signup">
                  <Button size="xl">Create your video</Button>
                </Link>
                <Link href="/examples">
                  <Button size="xl" variant="outline">
                    See examples
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
