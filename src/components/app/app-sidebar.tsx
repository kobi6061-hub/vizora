"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CircleHelp,
  FolderOpen,
  Home,
  Images,
  LayoutTemplate,
  LogOut,
  Palette,
  Plus,
  Settings,
  UserRound,
} from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth/auth-context";
import { planById } from "@/lib/data/pricing";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { cn } from "@/lib/utils";

const MAIN_NAV = [
  { href: "/app", label: "Home", icon: Home, exact: true },
  { href: "/app/create", label: "Create", icon: Plus },
  { href: "/app/projects", label: "Projects", icon: FolderOpen },
  { href: "/app/templates", label: "Templates", icon: LayoutTemplate },
] as const;

const LIBRARY_NAV = [
  { href: "/app/brand", label: "Brand Kit", icon: Palette },
  { href: "/app/assets", label: "Assets", icon: Images },
] as const;

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-overlay text-[12px] font-semibold text-ink-mid"
    >
      {initials || "V"}
    </span>
  );
}

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Getting the most from Vizora</DialogTitle>
          <DialogDescription>Three habits that make videos noticeably better.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-4">
          {[
            {
              title: "Lead with your strongest image",
              copy: "The first scene sets the tone — an exterior or hero render works best.",
            },
            {
              title: "Direct in plain language",
              copy: "“Calm and luxurious, focus on the sea view” beats any settings panel.",
            },
            {
              title: "Set your brand kit once",
              copy: "Logo, contact and end card apply to every video automatically.",
            },
          ].map((tip, index) => (
            <li key={tip.title} className="flex gap-3.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-overlay font-mono text-[11px] text-ink-mid">
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{tip.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-stone">{tip.copy}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[12px] text-faint">
          Need more? In-app support connects at launch — for now, explore the
          sample projects on your dashboard.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  exact,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-overlay text-ink" : "text-stone hover:bg-raised hover:text-ink",
      )}
    >
      <Icon className={cn("size-4", active ? "text-signal-bright" : "")} aria-hidden />
      {label}
    </Link>
  );
}

export function AppSidebar() {
  const { session, signOut } = useAuth();
  const usage = useWorkspaceStore((state) => state.usage);
  const router = useRouter();
  const [helpOpen, setHelpOpen] = React.useState(false);

  if (!session) return null;
  const plan = planById(session.workspace.plan);
  const creditsLeft = Math.max(0, usage.creditsIncluded - usage.creditsUsed);

  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-seam bg-surface/40 lg:flex">
      <div className="px-5 py-5">
        <Link href="/app" aria-label="Vizora Studio home">
          <Wordmark markSize={26} />
        </Link>
      </div>

      <nav aria-label="Studio" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {MAIN_NAV.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
        <div className="mx-3 my-3 h-px bg-seam" role="separator" />
        {LIBRARY_NAV.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
        <div className="mx-3 my-3 h-px bg-seam" role="separator" />
        <button
          onClick={() => setHelpOpen(true)}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-stone transition-colors hover:bg-raised hover:text-ink"
        >
          <CircleHelp className="size-4" aria-hidden />
          Help
        </button>
      </nav>

      {/* Workspace footer */}
      <div className="border-t border-seam p-3">
        <div className="rounded-xl border border-seam bg-raised p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-ink-mid">{plan.name} plan</p>
            <Link href="/app/settings?section=subscription" className="text-[11px] text-signal-bright hover:underline">
              Manage
            </Link>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-seam">
            <div
              className="h-full rounded-full bg-signal"
              style={{ width: `${Math.min(100, (usage.creditsUsed / usage.creditsIncluded) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-faint">
            {creditsLeft} of {usage.creditsIncluded} video credits left
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="mt-2 flex w-full items-center gap-3 rounded-xl p-2 text-start transition-colors hover:bg-raised">
              <Avatar name={session.user.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">
                  {session.user.name}
                </span>
                <span className="block truncate text-[11px] text-faint">
                  {session.workspace.name}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>{session.user.email}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => router.push("/app/settings")}>
              <UserRound className="size-4" aria-hidden />
              Profile & settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/app/settings?section=workspace")}>
              <Settings className="size-4" aria-hidden />
              Workspace
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                signOut();
                router.push("/");
              }}
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </aside>
  );
}
