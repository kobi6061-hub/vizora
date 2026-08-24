import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Temporary VIZORA mark until a final identity is designed.
 * Two converging light-beams form a V inside a viewfinder tile —
 * still (ivory) meeting motion (signal). Keep implementation replaceable.
 */
export function Monogram({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <rect width="32" height="32" rx="8" fill="var(--color-surface)" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        stroke="var(--color-seam-strong)"
      />
      <path d="M9 9.5 L14.4 22.5 L17.1 22.5 L11.7 9.5 Z" fill="var(--color-ivory)" />
      <path d="M20.3 9.5 L17.4 16.5 L18.8 19.9 L23 9.5 Z" fill="var(--color-signal-bright)" />
    </svg>
  );
}

export function Wordmark({
  className,
  withMark = true,
  markSize = 28,
}: {
  className?: string;
  withMark?: boolean;
  markSize?: number;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {withMark && <Monogram size={markSize} />}
      <span className="font-display text-[17px] font-semibold uppercase leading-none tracking-[0.18em] text-ink">
        Vizora
      </span>
    </span>
  );
}
