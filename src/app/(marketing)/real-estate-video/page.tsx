import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MiniPlayer } from "@/components/player/mini-player";
import { Section, SectionHeading } from "@/components/marketing/sections";
import { artById } from "@/lib/data/art-manifest";

export const metadata: Metadata = {
  title: "AI Real Estate Video Generator",
  description:
    "Make real-estate marketing videos from images and text. Listing videos, development campaigns, social clips and investor presentations — in about 5 minutes.",
};

const FORMATS = [
  {
    title: "Listing videos",
    copy: "From photography to a publishable tour in one sitting — captions, music and contact card included.",
    art: "tower-marine",
    scenes: ["tower-marine", "interior-living-2"],
  },
  {
    title: "Development campaigns",
    copy: "Market from renders long before handover. Masterplan, interiors, amenities — one coherent story.",
    art: "grove-aerial",
    scenes: ["grove-aerial", "grove-exterior"],
  },
  {
    title: "Social clips",
    copy: "Vertical, fast and caption-first. Made for the feed, sized for Reels, Stories and TikTok.",
    art: "azure-pool",
    scenes: ["azure-pool", "azure-terrace"],
  },
  {
    title: "Investor presentations",
    copy: "A confident overview with the key facts on screen — progress, position, opportunity.",
    art: "meridian-exterior",
    scenes: ["meridian-exterior", "grove-construction"],
  },
] as const;

export default function RealEstateVideoPage() {
  return (
    <>
      <Section className="pt-36 md:pt-44">
        <div className="container-page">
          <SectionHeading
            eyebrow="Real-estate video"
            title={
              <>
                Every video your property needs.{" "}
                <em className="text-serif-accent">One studio.</em>
              </>
            }
            description="Vizora is an AI video generator built only for real estate — which is why the output looks like property marketing, not generic motion graphics."
          />
          <div className="mt-8">
            <Link href="/signup">
              <Button size="xl">Create your video</Button>
            </Link>
          </div>
        </div>
      </Section>

      <Section className="hairline-t">
        <div className="container-page grid gap-5 md:grid-cols-2">
          {FORMATS.map((format) => (
            <article
              key={format.title}
              className="overflow-hidden rounded-2xl border border-seam bg-surface/60"
            >
              <MiniPlayer
                scenes={format.scenes.map((id) => ({
                  src: artById(id).src,
                  alt: artById(id).alt,
                  motion: "push",
                }))}
                aspect="16:9"
                captions={false}
                sceneDurationMs={3600}
              />
              <div className="p-6">
                <h3 className="font-display text-lg font-medium text-ink">{format.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone">{format.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section className="hairline-t">
        <div className="container-page text-center">
          <h2 className="text-display mx-auto max-w-2xl text-4xl text-ink">
            From property images to{" "}
            <em className="text-serif-accent">cinematic video</em> in 5 minutes.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="xl">Create your video</Button>
            </Link>
            <Link href="/templates">
              <Button size="xl" variant="outline">
                Browse templates
              </Button>
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
