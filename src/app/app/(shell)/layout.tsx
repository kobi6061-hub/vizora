import { AppSidebar } from "@/components/app/app-sidebar";
import { MobileBottomNav, MobileTopBar } from "@/components/app/mobile-nav";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ground">
      <AppSidebar />
      <MobileTopBar />
      <main className="pb-24 lg:ms-60 lg:pb-10">{children}</main>
      <MobileBottomNav />
    </div>
  );
}
