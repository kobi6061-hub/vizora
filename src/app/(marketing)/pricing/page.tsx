import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Section, SectionHeading } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple plans for agents, agencies and developers. Every plan includes commercial usage, real-estate templates and all three creation methods.",
};

const FAQ = [
  {
    question: "What is a video credit?",
    answer:
      "One credit generates one finished video. Re-editing scenes, captions, branding or music before you generate doesn't cost anything — you only spend a credit when Vizora renders.",
  },
  {
    question: "Can I use the videos commercially?",
    answer:
      "Yes. Every plan includes commercial usage for the properties you market — listings, portals, social campaigns and presentations.",
  },
  {
    question: "Do unused credits roll over?",
    answer:
      "Credits refresh monthly on Starter and Pro. Business plans can arrange quarterly pools with our team.",
  },
  {
    question: "Can I change plans later?",
    answer:
      "Anytime. Upgrades apply immediately; downgrades apply from your next billing period.",
  },
  {
    question: "What happens to my projects if I pause?",
    answer:
      "Projects and brand kits stay in your workspace. You can pick up exactly where you left off when you return.",
  },
] as const;

export default function PricingPage() {
  return (
    <>
      <Section className="pt-36 md:pt-44">
        <div className="container-page">
          <SectionHeading
            align="center"
            eyebrow="Pricing"
            title={
              <>
                One listing pays for a{" "}
                <em className="text-serif-accent">year of video.</em>
              </>
            }
            description="A single agency production quote covers years of Vizora. Pick the plan that matches your pipeline."
          />
          <div className="mt-12">
            <PricingCards />
          </div>
          <p className="mt-6 text-center text-sm text-faint">
            Prices in USD. Payment processing connects at launch — plans shown for evaluation.
          </p>
        </div>
      </Section>

      <Section className="hairline-t">
        <div className="container-page grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <SectionHeading
            eyebrow="Questions"
            title="The details that matter."
          />
          <dl className="space-y-8">
            {FAQ.map((item) => (
              <div key={item.question}>
                <dt className="font-medium text-ink">{item.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-stone">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section className="hairline-t">
        <div className="container-page text-center">
          <h2 className="text-display mx-auto max-w-xl text-4xl text-ink">
            Start with your next listing.
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
