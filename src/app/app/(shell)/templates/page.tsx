import type { Metadata } from "next";
import { AppTemplatesView } from "./templates-view";

export const metadata: Metadata = {
  title: "Templates",
};

export default function AppTemplatesPage() {
  return <AppTemplatesView />;
}
