"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Monogram } from "@/components/brand/logo";
import { useAuth } from "@/lib/auth/auth-context";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Client-side gate for /app: restores the session, seeds the workspace,
 * and routes unauthenticated visitors to sign-in.
 */
export function AppGuard({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const hydrated = useWorkspaceStore((state) => state.hydrated);
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (session === null) {
      router.replace("/login");
      return;
    }
    if (session && !session.user.onboarded && pathname !== "/app/onboarding") {
      router.replace("/app/onboarding");
    }
  }, [session, pathname, router]);

  const booting =
    session === undefined ||
    session === null ||
    !hydrated ||
    (!session.user.onboarded && pathname !== "/app/onboarding");

  if (booting) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ground">
        <div className="flex flex-col items-center gap-4">
          <Monogram size={40} className="animate-pulse-soft" />
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
            Opening your studio
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
