"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AuthLink, AuthShell, PasswordInput } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-context";

export function LoginForm() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<{ email?: string; password?: string; form?: string }>({});

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email")).trim();
    const password = String(data.get("password"));

    const next: typeof errors = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter the email you signed up with.";
    if (password.length < 8) next.password = "Passwords are at least 8 characters.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const session = await signIn(email, password);
      router.push(session.user.onboarded ? "/app" : "/app/onboarding");
    } catch {
      setErrors({ form: "We couldn't sign you in. Check your details and try again." });
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to pick up your projects where you left them."
      footer={
        <>
          New to Vizora? <AuthLink href="/signup">Create an account</AuthLink>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Email" htmlFor="login-email" error={errors.email}>
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={Boolean(errors.email)}
            autoFocus
          />
        </Field>
        <Field label="Password" htmlFor="login-password" error={errors.password}>
          <PasswordInput
            id="login-password"
            name="password"
            autoComplete="current-password"
            placeholder="Your password"
            aria-invalid={Boolean(errors.password)}
          />
        </Field>
        <div className="flex justify-end">
          <AuthLink href="/forgot-password">Forgot password?</AuthLink>
        </div>
        {errors.form && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {errors.form}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
