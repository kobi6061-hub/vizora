"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clapperboard, Play, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { GenerationOverlay } from "@/components/studio/generation-overlay";
import { ResultView } from "@/components/studio/result-view";
import { SetupWizard } from "@/components/studio/setup-wizard";
import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { getVideoGenerationProvider } from "@/lib/generation";
import { useProject, useProjectAssets, useWorkspaceStore } from "@/lib/stores/workspace-store";

export function Studio({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const assets = useProjectAssets(project);
  const updateProject = useWorkspaceStore((state) => state.updateProject);
  const recordVideoCreated = useWorkspaceStore((state) => state.recordVideoCreated);
  const { toast } = useToast();
  const router = useRouter();

  /** "result" once ready; "edit" after the user chooses Edit. */
  const [view, setView] = React.useState<"result" | "edit">("edit");
  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    if (project && !initializedRef.current) {
      initializedRef.current = true;
      setView(project.status === "ready" ? "result" : "edit");
    }
  }, [project]);

  if (!project) {
    return (
      <div className="container-page max-w-2xl py-20">
        <EmptyState
          icon={<Clapperboard className="size-5" aria-hidden />}
          title="This project doesn't exist anymore"
          description="It may have been deleted, or the link is from a different workspace."
          action={
            <Link href="/app/projects">
              <Button>
                <ArrowLeft className="size-4" aria-hidden />
                Back to projects
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const setupDone = project.scenes.length > 0;

  const startGeneration = async () => {
    const visibleScenes = project.scenes.filter((scene) => !scene.hidden);
    if (visibleScenes.length === 0) {
      toast({
        title: "Your storyboard is empty",
        description: "Unhide or add at least one scene before generating.",
        variant: "error",
      });
      return;
    }
    if (!project.styleId) {
      toast({
        title: "Pick a style first",
        description: "Choose a video style in the Direct panel.",
        variant: "error",
      });
      return;
    }
    const provider = getVideoGenerationProvider();
    const { generationId } = await provider.createGeneration({
      projectId: project.id,
      sceneCount: visibleScenes.length,
      durationSec: project.durationSec,
      aspectRatio: project.aspectRatio,
    });
    updateProject(project.id, {
      status: "generating",
      generation: {
        id: generationId,
        projectId: project.id,
        phase: "QUEUED",
        progress: 0,
        startedAt: new Date().toISOString(),
      },
    });
  };

  const handleGenerationComplete = async () => {
    const provider = getVideoGenerationProvider();
    const generationId = project.generation?.id;
    const result = generationId ? await provider.getResult(generationId) : null;
    updateProject(project.id, {
      status: "ready",
      result: result ?? {
        id: `vid_${generationId}`,
        renderedAt: new Date().toISOString(),
        durationSec: project.durationSec,
        aspectRatio: project.aspectRatio,
        kind: "storyboard-preview",
      },
      generation: project.generation
        ? { ...project.generation, phase: "COMPLETED", progress: 100, completedAt: new Date().toISOString() }
        : undefined,
    });
    recordVideoCreated();
    setView("result");
  };

  const handleGenerationCancelled = () => {
    updateProject(project.id, {
      status: "draft",
      generation: undefined,
    });
    toast({ title: "Generation cancelled", description: "No credits were used." });
  };

  return (
    <>
      {!setupDone ? (
        <SetupWizard project={project} assets={assets} />
      ) : project.status === "ready" && view === "result" ? (
        <ResultView
          project={project}
          assets={assets}
          onEdit={() => setView("edit")}
          onCreateVersion={(copyId) => {
            initializedRef.current = false;
            router.push(`/app/projects/${copyId}`);
          }}
        />
      ) : (
        <StudioWorkspace
          project={project}
          assets={assets}
          onGenerate={startGeneration}
          onShowResult={project.result ? () => setView("result") : undefined}
        />
      )}

      {project.status === "generating" && project.generation && (
        <GenerationOverlay
          project={project}
          generationId={project.generation.id}
          onComplete={handleGenerationComplete}
          onCancelled={handleGenerationCancelled}
        />
      )}

      {project.status === "failed" && project.generation?.error && view === "edit" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-6 lg:ps-60">
          <div className="pointer-events-auto flex max-w-lg items-start gap-3 rounded-2xl border border-danger/30 bg-raised p-4 shadow-pop">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Last generation failed</p>
              <p className="mt-0.5 text-[13px] leading-snug text-stone">{project.generation.error}</p>
            </div>
            <Button size="sm" onClick={startGeneration}>
              <Play className="size-3.5" aria-hidden />
              Retry
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
