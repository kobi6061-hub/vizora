import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MiniPlayer } from "@/components/player/mini-player";
import { Section, SectionHeading } from "@/components/marketing/sections";
import { artById } from "@/lib/data/art-manifest";

export const metadata: Metadata = {
  title: "Image to Video for Real Estate",
  description:
    "Turn one property image into cinematic footage. Vizora animates renders and photos with camera moves built for real-estate marketing.",
};

const MOTIONS = [
  { name: "Slow push", copy: "The camera moves gently into the frame — the classic opening shot." },
  { name: "Reveal pan", copy: "A lateral drift that lets a facade or interior unfold." },
  { name: "Rise", copy: "A vertical lift that gives towers and views their scale." },
  { name: "Depth pull", copy: "Pulling back to place the property in its setting." },
] as const;

export default function ImageToVideoPage() {
  return (
    <>
      <Section className="pt-36 md:pt-44">
        <div className="container-page grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Image to video"
              title={
                <>
                  One still. <em className="text-serif-accent">Cinematic footage.</em>
                </>
              }
              description="An architectural render, a listing photo, a construction shot — Vizora gives a single image believable camera movement and turns it into a scene worth publishing."
            />
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup">
                <Button size="lg">Animate your image</Button>
              </Link>
              <Link href="/examples">
                <Button size="lg" variant="outline">
                  See examples
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-sm text-faint">Works with renders, photos and CGI.</p>
          </div>

          <div className="relative">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <figure className="overflow-hidden rounded-2xl border border-seam">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artById("meridian-exterior").src}
                  alt={artById("meridian-exterior").alt}
                  className="aspect-[3/4] w-full object-cover"
                />
                <figcaption className="border-t border-seam bg-surface px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-stone">
                  Your still
                </figcaption>
              </figure>
              <ArrowRight className="size-5 text-faint" aria-hidden />
              <figure className="overflow-hidden rounded-2xl border border-seam-strong shadow-panel">
                <MiniPlayer
                  scenes={[
                    { src: artById("meridian-exterior").src, alt: artById("meridian-exterior").alt, motion: "push" },
                    { src: artById("meridian-exterior").src, alt: "", motion: "rise" },
                    { src: artById("meridian-exterior").src, alt: "", motion: "pan-right" },
                  ]}
                  aspect="9:16"
                  sceneDurationMs={3600}
                  captions={false}
                  className="aspect-[3/4]"
                />
                <figcaption className="border-t border-seam bg-surface px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-signal-bright">
                  With Vizora
                </figcaption>
              </figure>
            </div>
          </div>
        </div>
      </Section>

      <Section className="hairline-t">
        <div className="container-page">
          <SectionHeading
            eyebrow="Motion library"
            title="Camera moves, chosen for property."
            description="Vizora picks the movement that flatters the image — or you ask for a different one in plain language."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {MOTIONS.map((motion) => (
              <article key={motion.name} className="rounded-2xl border border-seam bg-surface/60 p-6">
                <h3 className="font-medium text-ink">{motion.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone">{motion.copy}</p>
              </article>
            ))}
          </div>
          <p className="mt-8 max-w-2xl text-sm leading-relaxed text-faint">
            Coming to the same workflow: environmental motion, lighting animation
            and subtle life simulation — the architecture is ready for them.
          </p>
        </div>
      </Section>

      <Section className="hairline-t">
        <div className="container-page text-center">
          <h2 className="text-display mx-auto max-w-2xl text-4xl text-ink">
            Start with the image you already have.
          </h2>
          <div className="mt-8">
            <Link href="/signup">
              <Button size="xl">Create your video</Button>
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
