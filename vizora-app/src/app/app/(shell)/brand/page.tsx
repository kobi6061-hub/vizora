import type { Metadata } from "next";
import { BrandKitView } from "./brand-view";

export const metadata: Metadata = {
  title: "Brand Kit",
};

export default function BrandKitPage() {
  return <BrandKitView />;
}
