import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateFlow } from "./create-flow";

export const metadata: Metadata = {
  title: "Create",
};

export default function CreatePage() {
  return (
    <Suspense>
      <CreateFlow />
    </Suspense>
  );
}
