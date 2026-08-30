"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-5.5 w-9.5 shrink-0 rounded-full border border-seam-strong bg-overlay transition-colors",
        "data-[state=checked]:border-signal data-[state=checked]:bg-signal",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block size-4 translate-x-0.5 rounded-full bg-ivory shadow-press transition-transform",
          "data-[state=checked]:translate-x-[18px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export function Slider({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex w-full touch-none select-none items-center py-2",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-seam">
        <SliderPrimitive.Range className="absolute h-full bg-signal" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label="Value"
        className="block size-3.5 rounded-full bg-ivory shadow-press transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40"
      />
    </SliderPrimitive.Root>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-lg bg-[linear-gradient(100deg,var(--color-surface)_40%,var(--color-raised)_50%,var(--color-surface)_60%)] bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

export function Divider({ className, label }: { className?: string; label?: string }) {
  if (!label) return <div role="separator" className={cn("h-px w-full bg-seam", className)} />;
  return (
    <div role="separator" className={cn("flex items-center gap-3", className)}>
      <div className="h-px flex-1 bg-seam" />
      <span className="text-xs text-faint">{label}</span>
      <div className="h-px flex-1 bg-seam" />
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-seam-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-stone">
      {children}
    </kbd>
  );
}
