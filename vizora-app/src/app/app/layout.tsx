import type { Metadata } from "next";
import { AppGuard } from "@/components/app/app-guard";

export const metadata: Metadata = {
  title: {
    default: "Vizora Studio",
    template: "%s — Vizora Studio",
  },
  robots: { index: false },
};

export default function AppRootLayout({ children }: LayoutProps<"/app">) {
  return <AppGuard>{children}</AppGuard>;
}
