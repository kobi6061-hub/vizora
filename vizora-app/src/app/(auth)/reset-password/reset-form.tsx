"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { AuthShell, PasswordInput } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";

export function ResetPasswordForm() {
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [errors, setErrors] = React.useState<{ password?: string; confirm?: string }>({});

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    const confirm = String(data.get("confirm"));

    const next: typeof errors = {};
    if (password.length < 8) next.password = "Use at least 8 characters.";
    if (confirm !== password) next.confirm = "Passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    setSubmitting(false);
    setDone(true);
  };

  if (done) {
    return (
      <AuthShell title="Password updated" description="Your new password is set. Sign in to continue.">
        <div className="flex flex-col items-center rounded-2xl border border-seam bg-surface/60 px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl border border-seam bg-raised">
            <ShieldCheck className="size-5 text-success" aria-hidden />
          </span>
          <Link href="/login" className="mt-6 w-full">
            <Button size="lg" className="w-full">
              Back to sign in
            </Button>
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" description="Choose something you don't use anywhere else.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="New password" htmlFor="reset-password" error={errors.password} hint="At least 8 characters.">
          <PasswordInput
            id="reset-password"
            name="password"
            autoComplete="new-password"
            placeholder="New password"
            aria-invalid={Boolean(errors.password)}
            autoFocus
          />
        </Field>
        <Field label="Confirm password" htmlFor="reset-confirm" error={errors.confirm}>
          <PasswordInput
            id="reset-confirm"
            name="confirm"
            autoComplete="new-password"
            placeholder="Repeat new password"
            aria-invalid={Boolean(errors.confirm)}
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {submitting ? "Updating…" : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
