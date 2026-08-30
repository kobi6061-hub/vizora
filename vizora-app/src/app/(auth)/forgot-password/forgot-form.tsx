"use client";

import * as React from "react";
import { MailQuestion } from "lucide-react";
import Link from "next/link";
import { AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const [submitting, setSubmitting] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter the email you signed up with.");
      return;
    }
    setError(null);
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    setSubmitting(false);
    setSentTo(email);
  };

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email"
        description={`If an account exists for ${sentTo}, a reset link is on its way. In this preview build you can continue directly.`}
      >
        <div className="flex flex-col items-center rounded-2xl border border-seam bg-surface/60 px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl border border-seam bg-raised">
            <MailQuestion className="size-5 text-signal-bright" aria-hidden />
          </span>
          <p className="mt-4 text-sm text-stone">Ready to set a new password?</p>
          <Link href="/reset-password" className="mt-6 w-full">
            <Button size="lg" className="w-full">
              Set a new password
            </Button>
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter your email and we'll send you a link to set a new one."
      footer={
        <>
          Remembered it? <AuthLink href="/login">Back to sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Email" htmlFor="forgot-email" error={error ?? undefined}>
          <Input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={Boolean(error)}
            autoFocus
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {submitting ? "Sending link…" : "Send reset link"}
        </Button>
      </form>
    </AuthShell>
  );
}
