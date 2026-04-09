import { AppSidebar } from "@/components/app-sidebar";
import { OnboardingGuard } from "@/components/onboarding-guard";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { SiteHeader } from "@/components/site-header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <ImpersonationBanner />
        <SiteHeader />
        <OnboardingGuard>
          <div className="flex flex-1 flex-col">
            {children}
          </div>
        </OnboardingGuard>
      </SidebarInset>
    </SidebarProvider>
  );
}
