"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { staggerContainer, staggerChild } from "@/lib/motion";
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
            <motion.div
              initial="enter"
              animate="center"
              variants={staggerChild}
            >
              <SidebarMenuButton
                className="data-[slot=sidebar-menu-button]:p-1.5!"
                render={<a href="/capture" />}
              >
                <AudioWaveformIcon className="size-5!" />
                <span className="text-base font-semibold font-heading">Annote ASR</span>
              </SidebarMenuButton>
            </motion.div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <motion.div
          initial="enter"
          animate="center"
          variants={staggerContainer}
        >
          <motion.div variants={staggerChild}>
            <SidebarGroup>
              <Button
                size="sm"
                className="w-full gap-1.5"
                onClick={() => {
                  router.push("/capture");
                  window.dispatchEvent(new CustomEvent("open-new-capture"));
                }}
              >
                <PlusIcon className="size-4" />
                New Capture
              </Button>
            </SidebarGroup>
          </motion.div>
          <motion.div variants={staggerChild}>
            <NavMain items={navMain} />
          </motion.div>
          <motion.div variants={staggerChild} className="mt-auto">
            <NavSecondary items={navSecondary} />
          </motion.div>
        </motion.div>
      </SidebarContent>
      <SidebarFooter>
        <motion.div
          initial="enter"
          animate="center"
          variants={staggerChild}
        >
          <NavUser user={user} />
        </motion.div>
      </SidebarFooter>
    </Sidebar>
  );
}
