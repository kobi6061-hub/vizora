"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TemplateCard } from "@/components/cards/template-card";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS } from "@/lib/data/templates";
import type { TemplateCategory } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const CATEGORIES = Object.entries(TEMPLATE_CATEGORY_LABELS) as [TemplateCategory, string][];

export function TemplateGallery() {
  const [category, setCategory] = React.useState<TemplateCategory | "all">("all");

  const templates =
    category === "all" ? TEMPLATES : TEMPLATES.filter((t) => t.category === category);

  return (
    <div>
      <div role="group" aria-label="Filter templates" className="flex flex-wrap gap-2">
        <button
          onClick={() => setCategory("all")}
          aria-pressed={category === "all"}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
            category === "all"
              ? "border-ivory bg-ivory text-ground"
              : "border-seam text-stone hover:border-seam-strong hover:text-ink",
          )}
        >
          All templates
        </button>
        {CATEGORIES.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setCategory(id)}
            aria-pressed={category === id}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              category === id
                ? "border-ivory bg-ivory text-ground"
                : "border-seam text-stone hover:border-seam-strong hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            action={
              <Link href={`/signup?template=${template.id}`} className="block">
                <Button variant="outline" className="w-full">
                  Use template
                </Button>
              </Link>
            }
          />
        ))}
      </div>
    </div>
  );
}
