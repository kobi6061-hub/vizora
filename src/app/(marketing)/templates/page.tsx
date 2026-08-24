import type { Metadata } from "next";
import { Section, SectionHeading } from "@/components/marketing/sections";
import { TemplateGallery } from "./template-gallery";

export const metadata: Metadata = {
  title: "Real-Estate Video Templates",
  description:
    "Start from a proven structure: listing videos, development launches, Instagram Reels, investor presentations, villa showcases and construction updates.",
};

export default function TemplatesPage() {
  return (
    <Section className="pt-36 md:pt-44">
      <div className="container-page">
        <SectionHeading
          eyebrow="Templates"
          title={
            <>
              Start from a structure that{" "}
              <em className="text-serif-accent">already works.</em>
            </>
          }
          description="Each template carries a proven scene order, pacing and copy tone. Your images and property details make it yours."
        />
        <div className="mt-12">
          <TemplateGallery />
        </div>
      </div>
    </Section>
  );
}
