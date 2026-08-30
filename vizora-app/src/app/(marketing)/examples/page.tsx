import type { Metadata } from "next";
import { Section, SectionHeading } from "@/components/marketing/sections";
import { ExamplesGallery } from "./examples-gallery";

export const metadata: Metadata = {
  title: "Examples",
  description:
    "See what Vizora produces: property marketing videos generated from still images — apartments, villas, developments, interiors, luxury and social formats.",
};

export default function ExamplesPage() {
  return (
    <Section className="pt-36 md:pt-44">
      <div className="container-page">
        <SectionHeading
          eyebrow="Examples"
          title={
            <>
              Still images in.{" "}
              <em className="text-serif-accent">Marketing videos out.</em>
            </>
          }
          description="Every example started as the images on the left of its player — no filming, no editor. These are sample properties rendered with Vizora's demo engine."
        />
        <div className="mt-12">
          <ExamplesGallery />
        </div>
      </div>
    </Section>
  );
}
