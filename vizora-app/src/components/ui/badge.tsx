import * as React from "react";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/domain/types";

type BadgeVariant = "neutral" | "signal" | "success" | "amber" | "danger" | "outline";

const badgeVariants: Record<BadgeVariant, string> = {
  neutral: "bg-overlay text-ink-mid",
  signal: "bg-signal/15 text-signal-bright",
  success: "bg-success/12 text-success",
  amber: "bg-amber/12 text-amber",
  danger: "bg-danger/12 text-danger",
  outline: "border border-seam-strong text-stone",
};

export function Badge({
  className,
  variant = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide",
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

const statusConfig: Record<
  ProjectStatus,
  { label: string; variant: BadgeVariant; dot: string; pulse?: boolean }
> = {
  draft: { label: "Draft", variant: "neutral", dot: "bg-stone" },
  generating: { label: "Generating", variant: "amber", dot: "bg-amber", pulse: true },
  ready: { label: "Ready", variant: "success", dot: "bg-success" },
  failed: { label: "Failed", variant: "danger", dot: "bg-danger" },
};

export function StatusBadge({
  status,
  className,
}: {
  status: ProjectStatus;
  className?: string;
}) {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} className={className}>
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", config.dot, config.pulse && "animate-pulse-soft")}
      />
      {config.label}
    </Badge>
  );
}
