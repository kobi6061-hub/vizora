"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/empty-state";
import { TemplateCard } from "@/components/cards/template-card";
import { useToast } from "@/components/ui/toast";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS } from "@/lib/data/templates";
import type { TemplateCategory } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

const CATEGORIES = Object.entries(TEMPLATE_CATEGORY_LABELS) as [TemplateCategory, string][];

export function AppTemplatesView() {
  const createProject = useWorkspaceStore((state) => state.createProject);
  const router = useRouter();
  const { toast } = useToast();
  const [category, setCategory] = React.useState<TemplateCategory | "all">("all");

  const templates =
    category === "all" ? TEMPLATES : TEMPLATES.filter((t) => t.category === category);

  const startFromTemplate = (templateId: string, templateName: string) => {
    const project = createProject({ method: "images", templateId });
    toast({
      title: `Starting from “${templateName}”`,
      description: "Add your property images — the structure is set.",
    });
    router.push(`/app/projects/${project.id}`);
  };

  return (
    <div className="container-page max-w-6xl space-y-6 py-8 lg:py-10">
      <PageHeader
        title="Templates"
        description="Proven structures for real-estate video. Your images and details make them yours."
      />

      <div role="group" aria-label="Filter templates" className="flex flex-wrap gap-1.5">
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
          All
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            action={
              <Button
                variant="outline"
                className="w-full"
                onClick={() => startFromTemplate(template.id, template.name)}
              >
                Use template
              </Button>
            }
          />
        ))}
      </div>
    </div>
  );
}
