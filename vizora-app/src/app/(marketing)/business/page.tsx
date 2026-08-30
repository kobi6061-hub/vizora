import type { Metadata } from "next";
import Link from "next/link";
import {
  Building2,
  FolderKanban,
  Landmark,
  LayoutTemplate,
  Palette,
  Plug,
  UsersRound,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/marketing/sections";
import { StudioPreview } from "@/components/marketing/studio-preview";
import { ContactSalesDialog } from "./contact-sales-dialog";

export const metadata: Metadata = {
  title: "Vizora for Business",
  description:
    "Team workspaces, centralized brand control and high-volume video generation for developers, agencies, marketing teams and real-estate networks.",
};

const FEATURES = [
  {
    icon: UsersRound,
    title: "Team workspace",
    copy: "Shared projects and assets, with everyone working from the same source of truth.",
  },
  {
    icon: Palette,
    title: "Centralized brand kit",
    copy: "Logo, contact details and end cards applied automatically — every video on brand.",
  },
  {
    icon: Zap,
    title: "High-volume generation",
    copy: "Credit pools and priority rendering sized for portfolios, not single listings.",
  },
  {
    icon: LayoutTemplate,
    title: "Reusable templates",
    copy: "Turn your best-performing video into the template your whole team starts from.",
  },
  {
    icon: FolderKanban,
    title: "Multiple projects",
    copy: "Run every development, phase and campaign side by side without losing track.",
  },
  {
    icon: Building2,
    title: "Brand consistency",
    copy: "One visual language across offices, agents and markets.",
  },
  {
    icon: Landmark,
    title: "Enterprise support",
    copy: "A named contact, onboarding for your team, and priority response.",
  },
  {
    icon: Plug,
    title: "API access",
    copy: "Generate videos from your own systems. Coming later — join the waitlist through sales.",
  },
] as const;

export default function BusinessPage() {
  return (
    <>
      <Section className="pt-36 md:pt-44">
        <div className="container-page">
          <div className="max-w-3xl">
            <SectionHeading
              eyebrow="Vizora for Business"
              title={
                <>
                  Video for the whole portfolio,{" "}
                  <em className="text-serif-accent">not just one listing.</em>
                </>
              }
              description="For developers, agencies, marketing teams and real-estate networks that need dozens of on-brand videos a month — without a production bottleneck."
            />
            <div className="mt-8 flex flex-wrap gap-3">
              <ContactSalesDialog>
                <Button size="xl">Talk to sales</Button>
              </ContactSalesDialog>
              <Link href="/pricing">
                <Button size="xl" variant="outline">
                  Compare plans
                </Button>
              </Link>
            </div>
          </div>
          <div className="mt-16">
            <StudioPreview />
          </div>
        </div>
      </Section>

      <Section className="hairline-t">
        <div className="container-page">
          <SectionHeading
            eyebrow="Built for teams"
            title="Scale the studio across your organization."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="rounded-2xl border border-seam bg-surface/60 p-6">
                <feature.icon className="size-5 text-stone" aria-hidden />
                <h3 className="mt-4 font-medium text-ink">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone">{feature.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </Section>

      <Section className="hairline-t">
        <div className="container-page text-center">
          <h2 className="text-display mx-auto max-w-2xl text-4xl text-ink">
            Let&apos;s scope it for your team.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-stone">
            Tell us about your portfolio and workflows — we&apos;ll map Vizora onto them.
          </p>
          <div className="mt-8">
            <ContactSalesDialog>
              <Button size="xl">Talk to sales</Button>
            </ContactSalesDialog>
          </div>
        </div>
      </Section>
    </>
  );
}
