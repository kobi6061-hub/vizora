"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "print" | "outline" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg" | "xl" | "icon" | "icon-sm";

const variantClasses: Record<Variant, string> = {
  /* The one Signal element per viewport. */
  primary:
    "bg-signal text-ivory hover:bg-signal-bright active:bg-signal-deep shadow-press",
  /* Ivory "print" button — the premium secondary on dark. */
  print:
    "bg-ivory text-ground hover:bg-white active:bg-ink-mid shadow-press",
  outline:
    "border border-seam-strong bg-transparent text-ink hover:bg-raised hover:border-faint",
  ghost: "bg-transparent text-ink-mid hover:bg-raised hover:text-ink",
  danger:
    "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
  link: "bg-transparent text-ink underline-offset-4 hover:underline px-0",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
  xl: "h-14 px-8 text-base gap-2.5 rounded-xl",
  icon: "size-10 rounded-[10px]",
  "icon-sm": "size-8 rounded-lg",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", loading, disabled, children, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium",
          "transition-[background-color,border-color,color,transform,opacity] duration-200",
          "disabled:pointer-events-none disabled:opacity-45",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
