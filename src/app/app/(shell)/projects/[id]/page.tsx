import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = {
  title: "Studio",
};

export default async function ProjectPage(props: PageProps<"/app/projects/[id]">) {
  const { id } = await props.params;
  return <Studio projectId={id} />;
}
