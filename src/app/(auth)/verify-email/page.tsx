import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailPanel } from "./verify-panel";

export const metadata: Metadata = {
  title: "Verify your email",
  robots: { index: false },
};

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailPanel />
    </Suspense>
  );
}
