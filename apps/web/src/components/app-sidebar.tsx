"use client";

import * as React from "react";
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
} from "@/components/ui/sidebar";
import {
  PhoneCallIcon,
  SettingsIcon,
  CircleHelpIcon,
  AudioWaveformIcon,
} from "lucide-react";
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
    url: "#",
    icon: <SettingsIcon />,
  },
  {
    title: "Help",
    url: "#",
    icon: <CircleHelpIcon />,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession();

  const user = {
    name: session?.user?.name || "User",
    email: session?.user?.email || "",
    avatar: session?.user?.image || "",
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
              <span className="text-base font-semibold">Voice Capture</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
