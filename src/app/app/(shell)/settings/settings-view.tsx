"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Bell,
  CreditCard,
  Download,
  Globe,
  Languages,
  Lock,
  Palette,
  RefreshCcw,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Avatar } from "@/components/app/app-sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { PasswordInput } from "@/components/auth/auth-shell";
import { useAuth } from "@/lib/auth/auth-context";
import { PRICING_PLANS, planById } from "@/lib/data/pricing";
import { readJson, writeJson } from "@/lib/storage/local";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn, formatBytes } from "@/lib/utils";

type SectionId =
  | "profile"
  | "workspace"
  | "brand"
  | "subscription"
  | "notifications"
  | "language"
  | "security"
  | "privacy";

const SECTIONS: { id: SectionId; label: string; icon: typeof UserRound }[] = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "workspace", label: "Workspace", icon: UsersRound },
  { id: "brand", label: "Brand", icon: Palette },
  { id: "subscription", label: "Subscription", icon: CreditCard },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "language", label: "Language", icon: Languages },
  { id: "security", label: "Security", icon: Lock },
  { id: "privacy", label: "Data & Privacy", icon: Globe },
];

interface Prefs {
  notifyRenderDone: boolean;
  notifyWeeklyDigest: boolean;
  notifyProductNews: boolean;
  language: string;
}

const DEFAULT_PREFS: Prefs = {
  notifyRenderDone: true,
  notifyWeeklyDigest: false,
  notifyProductNews: true,
  language: "English",
};

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-seam bg-surface/40 p-6">
      <h2 className="font-display text-lg font-medium tracking-tight text-ink">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-stone">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function SettingsView() {
  const searchParams = useSearchParams();
  const initial = (searchParams.get("section") as SectionId) || "profile";
  const [section, setSection] = React.useState<SectionId>(
    SECTIONS.some((s) => s.id === initial) ? initial : "profile",
  );

  return (
    <div className="container-page max-w-5xl space-y-8 py-8 lg:py-10">
      <PageHeader title="Settings" description="Your account, workspace and preferences." />
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1.5 overflow-x-auto lg:flex-col">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              aria-current={section === item.id ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                section === item.id
                  ? "bg-overlay text-ink"
                  : "text-stone hover:bg-raised hover:text-ink",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-6">
          {section === "profile" && <ProfileSection />}
          {section === "workspace" && <WorkspaceSection />}
          {section === "brand" && <BrandSection />}
          {section === "subscription" && <SubscriptionSection />}
          {section === "notifications" && <NotificationsSection />}
          {section === "language" && <LanguageSection />}
          {section === "security" && <SecuritySection />}
          {section === "privacy" && <PrivacySection />}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- profile --------------------------------- */

function ProfileSection() {
  const { session, updateUser } = useAuth();
  const { toast } = useToast();
  const [name, setName] = React.useState(session?.user.name ?? "");
  const [email, setEmail] = React.useState(session?.user.email ?? "");
  const [saving, setSaving] = React.useState(false);
  if (!session) return null;

  const dirty = name !== session.user.name || email !== session.user.email;

  return (
    <SectionCard title="Profile" description="How you appear across your workspace.">
      <div className="flex items-center gap-4">
        <Avatar name={session.user.name} size={52} />
        <div>
          <p className="text-sm font-medium text-ink">{session.user.name}</p>
          <p className="text-[12px] text-faint">
            Member since{" "}
            {new Date(session.user.createdAt).toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </div>
      <form
        className="mt-6 grid gap-5 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
            toast({ title: "Check your details", description: "Name and a valid email are required.", variant: "error" });
            return;
          }
          setSaving(true);
          await new Promise((resolve) => setTimeout(resolve, 500));
          updateUser({ name: name.trim(), email: email.trim().toLowerCase() });
          setSaving(false);
          toast({ title: "Profile updated" });
        }}
      >
        <Field label="Full name" htmlFor="profile-name">
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="profile-email">
          <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!dirty} loading={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/* -------------------------------- workspace -------------------------------- */

function WorkspaceSection() {
  const { session, updateWorkspace } = useAuth();
  const { toast } = useToast();
  const [name, setName] = React.useState(session?.workspace.name ?? "");
  const [invite, setInvite] = React.useState("");
  if (!session) return null;

  return (
    <>
      <SectionCard title="Workspace" description="Shared home for your team's projects and assets.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Workspace name" htmlFor="ws-name" className="min-w-56 flex-1">
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            disabled={name.trim() === session.workspace.name || name.trim().length < 2}
            onClick={() => {
              updateWorkspace({ name: name.trim() });
              toast({ title: "Workspace renamed" });
            }}
          >
            Save name
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Members" description="People with access to this workspace.">
        <ul className="divide-y divide-seam rounded-xl border border-seam">
          <li className="flex items-center gap-3 p-3.5">
            <Avatar name={session.user.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{session.user.name}</p>
              <p className="truncate text-[12px] text-faint">{session.user.email}</p>
            </div>
            <Badge variant="signal">Owner</Badge>
          </li>
        </ul>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!/^\S+@\S+\.\S+$/.test(invite)) {
              toast({ title: "Enter a valid email", variant: "error" });
              return;
            }
            setInvite("");
            toast({
              title: "Invite saved",
              description: "Team invitations send by email once delivery is connected at launch.",
            });
          }}
        >
          <Field label="Invite a teammate" htmlFor="ws-invite" className="min-w-56 flex-1">
            <Input
              id="ws-invite"
              type="email"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="colleague@company.com"
            />
          </Field>
          <Button type="submit" variant="outline">
            Send invite
          </Button>
        </form>
        <p className="mt-3 text-[12px] text-faint">
          Your Pro plan includes 3 seats. Need more? See Vizora for Business.
        </p>
      </SectionCard>
    </>
  );
}

/* ---------------------------------- brand ---------------------------------- */

function BrandSection() {
  const brandKit = useWorkspaceStore((state) => state.brandKit);
  return (
    <SectionCard title="Brand" description="Your brand kit is applied to every new project.">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-seam bg-raised p-4">
        <div>
          <p className="text-sm font-medium text-ink">
            {brandKit.brandName || "Brand kit not named yet"}
          </p>
          <p className="mt-0.5 text-[12px] text-faint">
            CTA “{brandKit.defaultCta}” · {brandKit.brandStyle} style
          </p>
        </div>
        <Link href="/app/brand">
          <Button variant="outline">
            Open Brand Kit
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </Link>
      </div>
    </SectionCard>
  );
}

/* ------------------------------- subscription ------------------------------- */

function SubscriptionSection() {
  const { session } = useAuth();
  const usage = useWorkspaceStore((state) => state.usage);
  const { toast } = useToast();
  if (!session) return null;
  const plan = planById(session.workspace.plan);

  return (
    <>
      <SectionCard title="Subscription" description="Plan, credits and renewals.">
        <div className="rounded-xl border border-seam bg-raised p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-display text-lg font-medium text-ink">{plan.name}</p>
              <p className="text-[12px] text-faint">{plan.audience}</p>
            </div>
            <p className="font-display text-xl font-medium text-ink">
              ${plan.monthlyUsd}
              <span className="text-sm text-stone"> / month</span>
            </p>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px] text-stone">
              <span>Video credits this month</span>
              <span className="font-mono">
                {usage.creditsUsed} / {usage.creditsIncluded}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-seam">
              <div
                className="h-full rounded-full bg-signal"
                style={{ width: `${Math.min(100, (usage.creditsUsed / usage.creditsIncluded) * 100)}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-[12px] text-stone">
              <span>Storage</span>
              <span className="font-mono">
                {formatBytes(usage.storageUsedBytes)} / {formatBytes(usage.storageIncludedBytes)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-seam">
              <div
                className="h-full rounded-full bg-stone"
                style={{
                  width: `${Math.min(100, (usage.storageUsedBytes / usage.storageIncludedBytes) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {PRICING_PLANS.map((p) => (
            <div
              key={p.id}
              className={cn(
                "rounded-xl border p-4",
                p.id === plan.id ? "border-signal bg-raised" : "border-seam bg-raised/50",
              )}
            >
              <p className="text-sm font-medium text-ink">{p.name}</p>
              <p className="mt-0.5 font-mono text-[12px] text-stone">${p.monthlyUsd}/mo</p>
              {p.id === plan.id ? (
                <Badge className="mt-3" variant="signal">
                  Current plan
                </Badge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    toast({
                      title: `Switch to ${p.name}`,
                      description: "Billing connects with the payment provider at launch.",
                    })
                  }
                >
                  {p.monthlyUsd > plan.monthlyUsd ? "Upgrade" : "Downgrade"}
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-faint">
          Payment processing connects at launch — plan changes are recorded but not billed.
        </p>
      </SectionCard>
    </>
  );
}

/* ------------------------------ notifications ------------------------------ */

function usePrefs() {
  const [prefs, setPrefs] = React.useState<Prefs>(() =>
    typeof window === "undefined" ? DEFAULT_PREFS : readJson("prefs", DEFAULT_PREFS),
  );
  const update = (patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writeJson("prefs", next);
      return next;
    });
  };
  return { prefs, update };
}

function NotificationsSection() {
  const { prefs, update } = usePrefs();
  const rows = [
    {
      key: "notifyRenderDone" as const,
      title: "Video ready",
      copy: "When a generation finishes or fails.",
    },
    {
      key: "notifyWeeklyDigest" as const,
      title: "Weekly digest",
      copy: "A summary of projects and credits every Monday.",
    },
    {
      key: "notifyProductNews" as const,
      title: "Product updates",
      copy: "New styles, templates and features.",
    },
  ];
  return (
    <SectionCard
      title="Notifications"
      description="Email delivery connects at launch; preferences apply from day one."
    >
      <ul className="space-y-4">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">{row.title}</p>
              <p className="text-[12px] text-stone">{row.copy}</p>
            </div>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={(checked) => update({ [row.key]: checked })}
              aria-label={row.title}
            />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* --------------------------------- language --------------------------------- */

function LanguageSection() {
  const { prefs, update } = usePrefs();
  return (
    <SectionCard title="Language" description="Interface language for your account.">
      <div className="max-w-xs">
        <Select value={prefs.language} onValueChange={(value) => update({ language: value })}>
          <SelectTrigger aria-label="Interface language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="English">English</SelectItem>
            <SelectItem value="Hebrew">עברית — coming soon</SelectItem>
            <SelectItem value="Spanish">Español — coming soon</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="mt-3 text-[12px] text-faint">
        Additional interface languages arrive with localization. Voiceover
        languages are configured per project in the studio.
      </p>
    </SectionCard>
  );
}

/* --------------------------------- security --------------------------------- */

function SecuritySection() {
  const { signOut } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  return (
    <>
      <SectionCard title="Change password" description="Use at least 8 characters.">
        <form
          className="grid max-w-md gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const next = String(data.get("new"));
            const confirm = String(data.get("confirm"));
            if (next.length < 8) {
              toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "error" });
              return;
            }
            if (next !== confirm) {
              toast({ title: "Passwords don't match", variant: "error" });
              return;
            }
            setSaving(true);
            await new Promise((resolve) => setTimeout(resolve, 600));
            setSaving(false);
            (event.target as HTMLFormElement).reset();
            toast({ title: "Password updated" });
          }}
        >
          <Field label="Current password" htmlFor="sec-current">
            <PasswordInput id="sec-current" name="current" autoComplete="current-password" />
          </Field>
          <Field label="New password" htmlFor="sec-new">
            <PasswordInput id="sec-new" name="new" autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" htmlFor="sec-confirm">
            <PasswordInput id="sec-confirm" name="confirm" autoComplete="new-password" />
          </Field>
          <div>
            <Button type="submit" loading={saving}>
              {saving ? "Updating…" : "Update password"}
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Sessions" description="Where you're signed in.">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-seam bg-raised p-4">
          <div>
            <p className="text-sm font-medium text-ink">This device</p>
            <p className="text-[12px] text-faint">Active now</p>
          </div>
          <Badge variant="success">Current</Badge>
        </div>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            signOut();
            router.push("/login");
          }}
        >
          Sign out everywhere
        </Button>
      </SectionCard>
    </>
  );
}

/* ---------------------------------- privacy --------------------------------- */

function PrivacySection() {
  const { session, signOut } = useAuth();
  const workspace = useWorkspaceStore();
  const { toast } = useToast();
  const router = useRouter();
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const exportData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      user: session?.user,
      workspace: session?.workspace,
      projects: workspace.projects,
      assets: workspace.assets.map(({ ...asset }) => asset),
      brandKit: workspace.brandKit,
      usage: workspace.usage,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "vizora-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export downloaded", description: "vizora-export.json contains your workspace data." });
  };

  return (
    <>
      <SectionCard
        title="Your data"
        description="Your project files stay in this browser's workspace — nothing is sent to external services in this preview build."
      >
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={exportData}>
            <Download className="size-4" aria-hidden />
            Export workspace data
          </Button>
          <Button variant="outline" onClick={() => setConfirmReset(true)}>
            <RefreshCcw className="size-4" aria-hidden />
            Reset demo content
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Danger zone" description="Irreversible actions.">
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-4" aria-hidden />
          Delete workspace
        </Button>
      </SectionCard>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset demo content?</DialogTitle>
            <DialogDescription>
              Restores the sample projects and assets. Your uploads and custom
              projects will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                workspace.resetWorkspace();
                setConfirmReset(false);
                toast({ title: "Workspace reset", description: "Sample content restored." });
              }}
            >
              Reset workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this workspace?</DialogTitle>
            <DialogDescription>
              Removes all projects, assets and your session from this browser.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep workspace
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                try {
                  window.localStorage.clear();
                } catch {
                  /* best-effort */
                }
                signOut();
                router.push("/");
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
