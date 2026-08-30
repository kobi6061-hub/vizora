"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";

export function ContactSalesDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!String(data.get("name")).trim() || !String(data.get("email")).includes("@")) {
      setError("Add your name and a valid work email so we can reach you.");
      return;
    }
    setError(null);
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    setSubmitting(false);
    setSubmitted(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSubmitted(false);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        {submitted ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
            <DialogTitle className="mt-4">Request saved</DialogTitle>
            <DialogDescription className="mx-auto mt-2 max-w-sm">
              Your details are saved in this evaluation build. Email delivery to
              our sales team connects at launch — nothing has been sent yet.
            </DialogDescription>
            <Button className="mt-6" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>Talk to sales</DialogTitle>
              <DialogDescription>
                Tell us about your team and portfolio. We&apos;ll come back with a
                plan and pricing that fit.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="sales-name">
                  <Input id="sales-name" name="name" autoComplete="name" placeholder="Dana Levi" />
                </Field>
                <Field label="Company" htmlFor="sales-company">
                  <Input id="sales-company" name="company" autoComplete="organization" placeholder="Northview Group" />
                </Field>
              </div>
              <Field label="Work email" htmlFor="sales-email">
                <Input id="sales-email" name="email" type="email" autoComplete="email" placeholder="dana@company.com" />
              </Field>
              <Field label="What are you marketing?" htmlFor="sales-message" optional>
                <Textarea
                  id="sales-message"
                  name="message"
                  placeholder="e.g. 3 active developments, 40 listings a month across two offices…"
                />
              </Field>
              {error && (
                <p role="alert" className="text-[13px] text-danger">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" loading={submitting} className="w-full sm:w-auto">
                {submitting ? "Saving request…" : "Send request"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
