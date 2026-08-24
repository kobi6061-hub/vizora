"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

type Side = "right" | "bottom" | "left";

const sideClasses: Record<Side, string> = {
  right:
    "inset-y-0 end-0 h-full w-full max-w-sm border-s border-seam animate-sheet-right",
  left:
    "inset-y-0 start-0 h-full w-full max-w-sm border-e border-seam animate-sheet-right [animation-name:sheet-left]",
  bottom:
    "inset-x-0 bottom-0 max-h-[86dvh] w-full rounded-t-2xl border-t border-seam animate-sheet-bottom",
};

export function SheetContent({
  className,
  children,
  side = "right",
  hideClose,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: Side;
  hideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ground/80 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden bg-raised shadow-panel focus:outline-none",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {side === "bottom" && (
          <div aria-hidden className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-seam-strong" />
        )}
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute end-4 top-4 rounded-lg p-1.5 text-stone transition-colors hover:bg-overlay hover:text-ink"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
