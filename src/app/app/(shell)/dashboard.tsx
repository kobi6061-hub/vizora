"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Image as ImageIcon,
  Images,
  Plus,
  Sparkles,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/components/app/project-card";
import { TemplateCard } from "@/components/cards/template-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/lib/auth/auth-context";
import { TEMPLATES } from "@/lib/data/templates";
import { useMounted } from "@/lib/hooks/use-asset-url";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { greetingForHour } from "@/lib/utils";

const QUICK_CREATE = [
  {
    method: "image" as const,
    icon: ImageIcon,
    title: "Image → Video",
    copy: "One property image becomes cinematic footage.",
  },
  {
    method: "images" as const,
    icon: Images,
    title: "Images → Video",
    copy: "Your gallery becomes a complete marketing video.",
    recommended: true,
  },
  {
    method: "text" as const,
    icon: Type,
    title: "Text → Video",
    copy: "Describe the property; Vizora drafts the concept.",
  },
];

export function Dashboard() {
  const { session } = useAuth();
  const projects = useWorkspaceStore((state) => state.projects);
  const createSampleProject = useWorkspaceStore((state) => state.createSampleProject);
  const createProject = useWorkspaceStore((state) => state.createProject);
  const router = useRouter();
  const mounted = useMounted();
  const greeting = mounted ? greetingForHour(new Date().getHours()) : "Welcome back";

  const firstName = session?.user.name.split(" ")[0] ?? "";
  const recent = [...projects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);

  const startFromTemplate = (templateId: string) => {
    const project = createProject({ method: "images", templateId });
    router.push(`/app/projects/${project.id}`);
  };

  return (
    <div className="container-page max-w-6xl space-y-12 py-8 lg:py-10">
      {/* Greeting */}
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1.5 text-[15px] text-stone">
            What property are we turning into a video today?
          </p>
        </div>
        <Link href="/app/create">
          <Button size="lg">
            <Plus className="size-4" aria-hidden />
            Create video
          </Button>
        </Link>
      </header>

      {/* Quick create */}
      <section aria-labelledby="quick-create-heading">
        <h2 id="quick-create-heading" className="text-eyebrow">
          Quick create
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {QUICK_CREATE.map((item) => (
            <Link
              key={item.method}
              href={`/app/create?method=${item.method}`}
              className="group relative rounded-2xl border border-seam bg-surface/60 p-6 transition-colors hover:border-seam-strong hover:bg-surface"
            >
              {item.recommended && (
                <span className="absolute right-4 top-4 rounded-full bg-signal/15 px-2 py-0.5 text-[10px] font-medium text-signal-bright">
                  Recommended
                </span>
              )}
              <item.icon
                className="size-5 text-stone transition-colors group-hover:text-signal-bright"
                aria-hidden
              />
              <h3 className="mt-4 font-display text-[17px] font-medium text-ink">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-stone">{item.copy}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent projects */}
      <section aria-labelledby="recent-heading">
        <div className="flex items-center justify-between">
          <h2 id="recent-heading" className="text-eyebrow">
            Recent projects
          </h2>
          {projects.length > 0 && (
            <Link
              href="/app/projects"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-stone transition-colors hover:text-ink"
            >
              View all
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={<Sparkles className="size-5" aria-hidden />}
            title="Your next property deserves more than a slideshow."
            description="Create your first video, or explore with a ready-made sample property."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/app/create">
                  <Button>Create your first video</Button>
                </Link>
                <Button
                  variant="outline"
                  onClick={() => {
                    const project = createSampleProject();
                    router.push(`/app/projects/${project.id}`);
                  }}
                >
                  Try a sample property
                </Button>
              </div>
            }
          />
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {recent.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      {/* Templates */}
      <section aria-labelledby="templates-heading">
        <div className="flex items-center justify-between">
          <h2 id="templates-heading" className="text-eyebrow">
            Start from a template
          </h2>
          <Link
            href="/app/templates"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-stone transition-colors hover:text-ink"
          >
            All templates
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {TEMPLATES.slice(0, 3).map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              action={
                <Button variant="outline" className="w-full" onClick={() => startFromTemplate(template.id)}>
                  Use template
                </Button>
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}
