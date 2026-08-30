"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClasses = cn(
  "h-10 w-full rounded-[10px] border border-seam bg-surface px-3.5 text-sm text-ink",
  "placeholder:text-faint",
  "transition-[border-color,box-shadow] duration-200",
  "hover:border-seam-strong",
  "focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/25",
  "disabled:cursor-not-allowed disabled:opacity-45",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25",
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input ref={ref} type={type} className={cn(inputClasses, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(inputClasses, "h-auto min-h-24 resize-y py-2.5 leading-relaxed", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ label, htmlFor, hint, error, optional, children, className }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-mid">
          {label}
        </label>
        {optional && <span className="text-xs text-faint">Optional</span>}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-stone">{hint}</p>
      ) : null}
    </div>
  );
}
