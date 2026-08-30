"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRICING_PLANS, YEARLY_DISCOUNT_LABEL } from "@/lib/data/pricing";
import { cn } from "@/lib/utils";

export function PricingCards({ compact = false }: { compact?: boolean }) {
  const [yearly, setYearly] = React.useState(false);

  return (
    <div>
      <div className="mb-10 flex items-center justify-center gap-1 rounded-full border border-seam bg-surface p-1 text-sm w-fit mx-auto">
        <button
          onClick={() => setYearly(false)}
          aria-pressed={!yearly}
          className={cn(
            "rounded-full px-4 py-1.5 font-medium transition-colors",
            !yearly ? "bg-overlay text-ink" : "text-stone hover:text-ink",
          )}
        >
          Monthly
        </button>
        <button
          onClick={() => setYearly(true)}
          aria-pressed={yearly}
          className={cn(
            "rounded-full px-4 py-1.5 font-medium transition-colors",
            yearly ? "bg-overlay text-ink" : "text-stone hover:text-ink",
          )}
        >
          Yearly
          <span className="ms-2 text-xs text-signal-bright">{YEARLY_DISCOUNT_LABEL}</span>
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {PRICING_PLANS.map((plan) => {
          const price = yearly ? Math.round(plan.yearlyUsd / 12) : plan.monthlyUsd;
          const features = compact ? plan.features.slice(0, 5) : plan.features;
          return (
            <article
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-2xl border p-7",
                plan.highlight
                  ? "border-signal/60 bg-surface shadow-panel"
                  : "border-seam bg-surface/60",
              )}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-7 rounded-full bg-signal px-3 py-1 text-[11px] font-semibold tracking-wide text-ivory">
                  Most popular
                </span>
              )}
              <h3 className="font-display text-xl font-medium text-ink">{plan.name}</h3>
              <p className="mt-1 text-sm text-stone">{plan.audience}</p>
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="font-display text-[40px] font-medium leading-none tracking-tight text-ink">
                  ${price}
                </span>
                <span className="text-sm text-stone">/ month</span>
              </p>
              {yearly && (
                <p className="mt-1 text-xs text-faint">Billed ${plan.yearlyUsd} yearly</p>
              )}
              <ul className="mt-7 flex-1 space-y-2.5">
                {features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-ink-mid">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-signal-bright" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link href={plan.id === "business" ? "/business" : "/signup"} className="mt-8">
                <Button
                  className="w-full"
                  variant={plan.highlight ? "primary" : "outline"}
                  size="lg"
                >
                  {plan.cta}
                </Button>
              </Link>
            </article>
          );
        })}
      </div>
    </div>
  );
}
