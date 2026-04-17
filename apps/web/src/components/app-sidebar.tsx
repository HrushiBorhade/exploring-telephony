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
  ShieldIcon,
  LayoutDashboardIcon,
  UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { useProfile } from "@/lib/api";
import { SidebarWelcomeBanner } from "@/components/sidebar-welcome-banner";
import { WelcomeModal } from "@/components/welcome-modal";

const navMain = [
  {
    title: "Home",
    url: "/dashboard",
    icon: <LayoutDashboardIcon />,
  },
  {
    title: "Tasks",
    url: "/dashboard/tasks",
    icon: <PhoneCallIcon />,
  },
];

const navAdmin = [
  {
    title: "Dashboard",
    url: "/admin",
    icon: <LayoutDashboardIcon />,
  },
  {
    title: "Users",
    url: "/admin/users",
    icon: <UsersIcon />,
  },
  {
    title: "All Captures",
    url: "/admin/captures",
    icon: <PhoneCallIcon />,
  },
  {
    title: "Theme Samples",
    url: "/admin/themes",
    icon: <AudioWaveformIcon />,
  },
];

const navSecondary = [
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: <SettingsIcon />,
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession();
  const { data: profileData } = useProfile();
  const router = useRouter();
  const [welcomeOpen, setWelcomeOpen] = React.useState(false);

  const isAdmin = (session?.user as any)?.role === "admin";
  const phoneNumber = String((session?.user as Record<string, unknown>)?.phoneNumber ?? "");
  const profileName = profileData?.profile?.name;
  const user = {
    name: profileName || phoneNumber || "User",
    email: phoneNumber && profileName ? phoneNumber : "",
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
                render={<a href="/dashboard" />}
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
                  router.push("/dashboard");
                }}
              >
                <PlusIcon className="size-4" />
                New Task
              </Button>
            </SidebarGroup>
          </motion.div>
          <motion.div variants={staggerChild}>
            <NavMain items={navMain} />
          </motion.div>
          {isAdmin && (
            <motion.div variants={staggerChild}>
              <NavMain items={navAdmin} label="Admin" />
            </motion.div>
          )}
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
          <SidebarWelcomeBanner onClick={() => setWelcomeOpen(true)} />
          <NavUser user={user} />
        </motion.div>
        <WelcomeModal
          open={welcomeOpen}
          onOpenChange={setWelcomeOpen}
          userName={profileName || undefined}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
