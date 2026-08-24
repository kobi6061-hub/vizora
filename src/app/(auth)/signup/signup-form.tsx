"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthLink, AuthShell, PasswordInput } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-context";
import { writeJson } from "@/lib/storage/local";

export function SignupForm() {
  const { signUp } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<{ name?: string; email?: string; password?: string }>({});

  const template = searchParams.get("template");

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    const email = String(data.get("email")).trim();
    const password = String(data.get("password"));

    const next: typeof errors = {};
    if (name.length < 2) next.name = "Tell us what to call you.";
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter a valid work email.";
    if (password.length < 8) next.password = "Use at least 8 characters.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    if (template) writeJson("pending-template", template);
    await signUp(name, email, password);
    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  };

  return (
    <AuthShell
      title="Create your account"
      description={
        template
          ? "Your template is waiting — one step and you're in the studio."
          : "Your first property video is about five minutes away."
      }
      footer={
        <>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Full name" htmlFor="signup-name" error={errors.name}>
          <Input
            id="signup-name"
            name="name"
            autoComplete="name"
            placeholder="Dana Levi"
            aria-invalid={Boolean(errors.name)}
            autoFocus
          />
        </Field>
        <Field label="Work email" htmlFor="signup-email" error={errors.email}>
          <Input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={Boolean(errors.email)}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="signup-password"
          error={errors.password}
          hint="At least 8 characters."
        >
          <PasswordInput
            id="signup-password"
            name="password"
            autoComplete="new-password"
            placeholder="Create a password"
            aria-invalid={Boolean(errors.password)}
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {submitting ? "Creating your studio…" : "Create account"}
        </Button>
        <p className="text-[12px] leading-relaxed text-faint">
          By continuing you agree to Vizora&apos;s terms of service and privacy
          policy.
        </p>
      </form>
    </AuthShell>
  );
}
