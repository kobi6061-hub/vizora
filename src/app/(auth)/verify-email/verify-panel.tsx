"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth/auth-context";

export function VerifyEmailPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const { toast } = useToast();
  const [resending, setResending] = React.useState(false);

  const email = searchParams.get("email") ?? session?.user.email ?? "your inbox";

  const resend = async () => {
    setResending(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    setResending(false);
    toast({
      title: "Verification email queued",
      description: "Email delivery connects at launch — verification is instant in this preview.",
    });
  };

  return (
    <AuthShell
      title="Check your email"
      description={`We sent a verification link to ${email}. In this preview build, verification is instant — continue whenever you're ready.`}
    >
      <div className="flex flex-col items-center rounded-2xl border border-seam bg-surface/60 px-6 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl border border-seam bg-raised">
          <MailCheck className="size-5 text-signal-bright" aria-hidden />
        </span>
        <p className="mt-4 text-sm text-stone">Verified and ready to go.</p>
        <Button
          size="lg"
          className="mt-6 w-full"
          onClick={() => router.push(session && !session.user.onboarded ? "/app/onboarding" : "/app")}
        >
          Continue to Vizora
        </Button>
        <Button variant="ghost" className="mt-2 w-full" onClick={resend} loading={resending}>
          {resending ? "Sending…" : "Resend email"}
        </Button>
      </div>
    </AuthShell>
  );
}
