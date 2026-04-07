"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
} from "@/components/ui/sidebar";
import {
  PhoneCallIcon,
  SettingsIcon,
  AudioWaveformIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

const navMain = [
  {
    title: "Captures",
    url: "/capture",
    icon: <PhoneCallIcon />,
  },
];

const navSecondary = [
  {
    title: "Settings",
    url: "/settings",
    icon: <SettingsIcon />,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession();
  const router = useRouter();

  const phoneNumber = String((session?.user as Record<string, unknown>)?.phoneNumber ?? "");
  const user = {
    name: phoneNumber || session?.user?.name || "User",
    email: "",
    avatar: "",
  };

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="/capture" />}
            >
              <AudioWaveformIcon className="size-5!" />
              <span className="text-base font-semibold font-heading">Annote ASR</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <Button
            size="sm"
            className="w-full gap-1.5"
            onClick={() => {
              router.push("/capture");
              // Dispatch a custom event that the capture page listens for
              window.dispatchEvent(new CustomEvent("open-new-capture"));
            }}
          >
            <PlusIcon className="size-4" />
            New Capture
          </Button>
        </SidebarGroup>
        <NavMain items={navMain} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
