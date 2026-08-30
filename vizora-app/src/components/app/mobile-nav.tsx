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
  Menu,
  Palette,
  Plus,
  Settings,
} from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, HelpDialog } from "@/components/app/app-sidebar";
import { useAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";

export function MobileTopBar() {
  const { session } = useAuth();
  if (!session) return null;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-seam bg-ground/90 px-4 backdrop-blur lg:hidden">
      <Link href="/app" aria-label="Vizora Studio home">
        <Wordmark markSize={24} />
      </Link>
      <MobileMoreSheet>
        <button
          aria-label="Open menu"
          className="flex items-center gap-2 rounded-full p-1 pe-2 transition-colors hover:bg-raised"
        >
          <Avatar name={session.user.name} size={28} />
          <Menu className="size-4 text-stone" aria-hidden />
        </button>
      </MobileMoreSheet>
    </header>
  );
}

function MobileMoreSheet({ children }: { children: React.ReactNode }) {
  const { session, signOut } = useAuth();
  const router = useRouter();
  const [helpOpen, setHelpOpen] = React.useState(false);

  const items = [
    { href: "/app/templates", label: "Templates", icon: LayoutTemplate },
    { href: "/app/brand", label: "Brand Kit", icon: Palette },
    { href: "/app/assets", label: "Assets", icon: Images },
    { href: "/app/settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>{children}</SheetTrigger>
        <SheetContent side="bottom" className="p-5 pb-8">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {session && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-seam bg-raised p-3">
              <Avatar name={session.user.name} size={36} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{session.user.name}</p>
                <p className="truncate text-[12px] text-faint">{session.workspace.name}</p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {items.map((item) => (
              <SheetClose asChild key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center gap-2.5 rounded-xl border border-seam bg-surface/60 px-4 py-3.5 text-sm font-medium text-ink-mid transition-colors hover:text-ink"
                >
                  <item.icon className="size-4" aria-hidden />
                  {item.label}
                </Link>
              </SheetClose>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <SheetClose asChild>
              <button
                onClick={() => setHelpOpen(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-seam px-4 py-3 text-sm text-stone transition-colors hover:text-ink"
              >
                <CircleHelp className="size-4" aria-hidden />
                Help
              </button>
            </SheetClose>
            <SheetClose asChild>
              <button
                onClick={() => {
                  signOut();
                  router.push("/");
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-seam px-4 py-3 text-sm text-stone transition-colors hover:text-ink"
              >
                <LogOut className="size-4" aria-hidden />
                Sign out
              </button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();

  const tabs: readonly {
    href: string;
    label: string;
    icon: typeof Home;
    exact?: boolean;
    primary?: boolean;
  }[] = [
    { href: "/app", label: "Home", icon: Home, exact: true },
    { href: "/app/create", label: "Create", icon: Plus, primary: true },
    { href: "/app/projects", label: "Projects", icon: FolderOpen },
  ];

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-seam bg-ground/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex h-16 max-w-md items-center justify-around px-6">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          if (tab.primary) {
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-label="Create video"
                className="flex size-12 -translate-y-3 items-center justify-center rounded-2xl bg-signal text-ivory shadow-pop transition-transform active:scale-95"
              >
                <tab.icon className="size-5" aria-hidden />
              </Link>
            );
          }
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 px-4 py-1.5 text-[11px] font-medium transition-colors",
                active ? "text-ink" : "text-faint hover:text-ink-mid",
              )}
            >
              <tab.icon className={cn("size-5", active && "text-signal-bright")} aria-hidden />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
