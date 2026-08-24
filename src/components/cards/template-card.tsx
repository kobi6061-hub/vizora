import * as React from "react";
import { Clock, Proportions } from "lucide-react";
import type { Template } from "@/lib/domain/types";
import { TEMPLATE_CATEGORY_LABELS } from "@/lib/data/templates";
import { videoStyleById } from "@/lib/data/video-styles";

export function TemplateCard({
  template,
  action,
}: {
  template: Template;
  action?: React.ReactNode;
}) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-seam bg-surface/60 transition-colors hover:border-seam-strong">
      <div className="relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={template.coverSrc}
          alt={`${template.name} template preview`}
          className="aspect-[16/10] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
        <span className="absolute left-3 top-3 rounded-md bg-ground/85 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-mid backdrop-blur">
          {TEMPLATE_CATEGORY_LABELS[template.category]}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-lg font-medium text-ink">{template.name}</h3>
        <p className="mt-1.5 flex-1 text-sm leading-relaxed text-stone">{template.tagline}</p>
        <div className="mt-4 flex items-center gap-3 font-mono text-[11px] text-faint">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            {template.durationSec}s
          </span>
          <span className="inline-flex items-center gap-1">
            <Proportions className="size-3" aria-hidden />
            {template.aspectRatio}
          </span>
          <span>{videoStyleById(template.styleId).name}</span>
        </div>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </article>
  );
}
