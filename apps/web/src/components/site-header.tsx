"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const routeConfig: Record<string, { label: string; parent?: { label: string; href: string } }> = {
  "/capture": { label: "Captures" },
  "/settings": { label: "Settings" },
  "/admin": { label: "Admin Dashboard" },
  "/admin/users": { label: "Users", parent: { label: "Admin", href: "/admin" } },
  "/admin/captures": { label: "All Captures", parent: { label: "Admin", href: "/admin" } },
  "/onboarding": { label: "Onboarding" },
};

export function SiteHeader() {
  const pathname = usePathname();

  // Match capture detail: /capture/{id}
  const captureDetailMatch = pathname.match(/^\/capture\/(.+)$/);
  const captureId = captureDetailMatch?.[1];

  // Resolve breadcrumb from route config or dynamic match
  const route = routeConfig[pathname];

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4" />
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList>
            {/* Parent breadcrumb (e.g., Admin → Users) */}
            {route?.parent && (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink href={route.parent.href}>{route.parent.label}</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </>
            )}

            {/* Capture detail: Captures → {id} */}
            {captureId ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/capture">Captures</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="font-mono text-xs max-w-[100px] sm:max-w-[160px] truncate">
                    {captureId.length > 10 ? `${captureId.slice(0, 10)}\u2026` : captureId}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbPage>{route?.label ?? "Dashboard"}</BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto shrink-0">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
