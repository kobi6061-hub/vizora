"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Image as ImageIcon, Images, Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { artById } from "@/lib/data/art-manifest";
import type { CreationMethod } from "@/lib/domain/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

const METHODS: {
  method: CreationMethod;
  icon: typeof ImageIcon;
  title: string;
  copy: string;
  art: string;
  recommended?: boolean;
}[] = [
  {
    method: "image",
    icon: ImageIcon,
    title: "Image to Video",
    copy: "Turn one property image into cinematic footage.",
    art: "meridian-exterior",
  },
  {
    method: "images",
    icon: Images,
    title: "Images to Video",
    copy: "Create a complete marketing video from your property gallery.",
    art: "azure-exterior",
    recommended: true,
  },
  {
    method: "text",
    icon: Type,
    title: "Text to Video",
    copy: "Describe the property and let Vizora create the concept.",
    art: "grove-plan",
  },
];

export function CreateFlow() {
  const createProject = useWorkspaceStore((state) => state.createProject);
  const createSampleProject = useWorkspaceStore((state) => state.createSampleProject);
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselected = searchParams.get("method") as CreationMethod | null;

  const start = (method: CreationMethod) => {
    const project = createProject({ method });
    router.push(`/app/projects/${project.id}`);
  };

  React.useEffect(() => {
    if (preselected && ["image", "images", "text"].includes(preselected)) {
      start(preselected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container-page max-w-5xl py-10 lg:py-16">
      <div className="max-w-2xl">
        <p className="text-eyebrow">Create</p>
        <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-ink">
          How do you want to start?
        </h1>
        <p className="mt-3 text-[15px] text-stone">
          Every path ends in a finished marketing video — pick the one that
          matches the material you have.
        </p>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {METHODS.map((item) => (
          <button
            key={item.method}
            onClick={() => start(item.method)}
            className={cn(
              "group relative overflow-hidden rounded-2xl border text-start transition-colors",
              item.recommended
                ? "border-signal/50 bg-surface"
                : "border-seam bg-surface/60 hover:border-seam-strong hover:bg-surface",
            )}
          >
            <div className="relative overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artById(item.art).src}
                alt=""
                aria-hidden
                className="aspect-[16/9] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
              />
              {item.recommended && (
                <span className="absolute right-3 top-3 rounded-full bg-signal px-2.5 py-0.5 text-[11px] font-semibold text-ivory">
                  Recommended
                </span>
              )}
            </div>
            <div className="p-6">
              <item.icon className="size-5 text-stone transition-colors group-hover:text-signal-bright" aria-hidden />
              <h2 className="mt-4 font-display text-xl font-medium text-ink">{item.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-stone">{item.copy}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-mid transition-colors group-hover:text-ink">
                Start here
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-seam bg-surface/40 px-6 py-5">
        <div className="flex items-center gap-3.5">
          <Sparkles className="size-5 text-signal-bright" aria-hidden />
          <div>
            <p className="text-sm font-medium text-ink">No property images at hand?</p>
            <p className="text-[13px] text-stone">
              Walk the whole flow with Azure Residences, a ready-made sample property.
            </p>
          </div>
        </div>
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
    </div>
  );
}
