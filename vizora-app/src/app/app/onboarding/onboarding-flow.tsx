"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clapperboard, Sparkles } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import type { OnboardingProfile } from "@/lib/domain/types";
import { readJson, removeKey } from "@/lib/storage/local";
import { templateById } from "@/lib/data/templates";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

type StepId = 0 | 1 | 2 | 3;

const QUESTIONS = [
  {
    title: "What best describes you?",
    key: "role" as const,
    options: [
      { value: "developer", label: "Real-estate developer" },
      { value: "agency", label: "Agency" },
      { value: "broker", label: "Broker / Agent" },
      { value: "marketer", label: "Marketing professional" },
      { value: "architect", label: "Architect / Designer" },
      { value: "other", label: "Other" },
    ],
  },
  {
    title: "What do you mainly want to create?",
    key: "goal" as const,
    options: [
      { value: "listings", label: "Property listing videos" },
      { value: "development", label: "Development marketing" },
      { value: "social", label: "Social media" },
      { value: "investor", label: "Investor presentations" },
      { value: "other", label: "Other" },
    ],
  },
  {
    title: "How often do you expect to create videos?",
    key: "frequency" as const,
    options: [
      { value: "occasionally", label: "Occasionally" },
      { value: "weekly", label: "Weekly" },
      { value: "several-weekly", label: "Several times per week" },
      { value: "daily", label: "Daily" },
    ],
  },
] as const;

export function OnboardingFlow() {
  const { session, completeOnboarding, updateUser } = useAuth();
  const createProject = useWorkspaceStore((state) => state.createProject);
  const createSampleProject = useWorkspaceStore((state) => state.createSampleProject);
  const router = useRouter();
  const [step, setStep] = React.useState<StepId>(0);
  const [answers, setAnswers] = React.useState<Partial<OnboardingProfile>>({});

  const pendingTemplateId = readJson<string | null>("pending-template", null);
  const pendingTemplate = pendingTemplateId ? templateById(pendingTemplateId) : null;

  const firstName = session?.user.name.split(" ")[0] ?? "there";

  const answer = (key: keyof OnboardingProfile, value: string) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    if (step < 2) {
      setStep((s) => (s + 1) as StepId);
    } else {
      completeOnboarding({
        role: (answers.role ?? "other") as OnboardingProfile["role"],
        goal: (answers.goal ?? "other") as OnboardingProfile["goal"],
        frequency: value as OnboardingProfile["frequency"],
      });
      setStep(3);
    }
  };

  const skip = () => {
    updateUser({ onboarded: true });
    setStep(3);
  };

  const startWithTemplate = () => {
    if (!pendingTemplate) return;
    removeKey("pending-template");
    const project = createProject({ method: "images", templateId: pendingTemplate.id, name: "" });
    router.push(`/app/projects/${project.id}`);
  };

  const startSample = () => {
    const project = createSampleProject();
    router.push(`/app/projects/${project.id}`);
  };

  return (
    <div className="flex min-h-dvh flex-col px-6 py-8">
      <div className="flex items-center justify-between">
        <Wordmark />
        {step < 3 && (
          <Button variant="ghost" size="sm" onClick={skip}>
            Skip for now
          </Button>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-xl">
          {step < 3 ? (
            (() => {
              const question = QUESTIONS[step as 0 | 1 | 2];
              return (
            <div key={step} className="animate-fade-up">
              <p className="text-eyebrow">
                {firstName} · Question {step + 1} of 3
              </p>
              <h1 className="mt-4 font-display text-3xl font-medium tracking-tight text-ink">
                {question.title}
              </h1>
              <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
                {question.options.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => answer(question.key, option.value)}
                    className={cn(
                      "rounded-xl border border-seam bg-surface/60 px-5 py-4 text-start text-[15px] font-medium text-ink-mid",
                      "transition-[border-color,background-color,color,transform] duration-200",
                      "hover:border-seam-strong hover:bg-surface hover:text-ink active:scale-[0.99]",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {step > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-8"
                  onClick={() => setStep((s) => (s - 1) as StepId)}
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  Back
                </Button>
              )}
            </div>
              );
            })()
          ) : (
            <div className="animate-fade-up text-center">
              <p className="text-eyebrow">You&apos;re in, {firstName}</p>
              <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-ink">
                Let&apos;s create your{" "}
                <em className="text-serif-accent">first video.</em>
              </h1>
              <p className="mx-auto mt-4 max-w-md text-base text-stone">
                {pendingTemplate
                  ? `Your “${pendingTemplate.name}” template is ready to go.`
                  : "Start with your own property images, or explore with a ready-made sample property."}
              </p>
              <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                {pendingTemplate ? (
                  <Button size="xl" onClick={startWithTemplate}>
                    <Clapperboard className="size-4" aria-hidden />
                    Start with your template
                  </Button>
                ) : (
                  <Button size="xl" onClick={() => router.push("/app/create")}>
                    <Clapperboard className="size-4" aria-hidden />
                    Create a video
                  </Button>
                )}
                <Button size="xl" variant="outline" onClick={startSample}>
                  <Sparkles className="size-4" aria-hidden />
                  Try a sample property
                </Button>
              </div>
              <button
                onClick={() => router.push("/app")}
                className="mt-8 text-sm text-faint underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                Take me to the dashboard instead
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Progress */}
      {step < 3 && (
        <div className="mx-auto flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className={cn(
                "h-1 w-10 rounded-full transition-colors",
                index <= step ? "bg-signal" : "bg-seam",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
