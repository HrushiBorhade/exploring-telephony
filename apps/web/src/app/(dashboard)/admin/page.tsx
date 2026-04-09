"use client";

import { useRouter } from "next/navigation";
import { Users, PhoneCall, CheckCircle, Clock, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { useAdminStats } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useEffect } from "react";

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function StatCard({ title, value, icon, description }: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-heading">{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
            <CardContent><Skeleton className="h-8 w-16" /></CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: stats, isLoading } = useAdminStats();

  // Guard: redirect non-admin users
  useEffect(() => {
    if (session && (session.user as any)?.role !== "admin") {
      router.replace("/capture");
    }
  }, [session, router]);

  if (isLoading && !stats) return <DashboardSkeleton />;

  const s = stats ?? { totalUsers: 0, totalCaptures: 0, completedCaptures: 0, totalDuration: 0, thisWeek: 0 };

  return (
    <motion.div
      className="p-4 lg:p-6 space-y-6"
      initial="hidden"
      animate="visible"
      variants={pageStagger}
    >
      <motion.div variants={pageFadeUp}>
        <h1 className="text-xl font-semibold font-heading tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">Platform overview and management</p>
      </motion.div>

      <motion.div variants={pageFadeUp} className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={s.totalUsers}
          icon={<Users className="size-4" />}
        />
        <StatCard
          title="Total Captures"
          value={s.totalCaptures}
          icon={<PhoneCall className="size-4" />}
        />
        <StatCard
          title="Completed"
          value={s.completedCaptures}
          icon={<CheckCircle className="size-4" />}
          description={`${s.totalCaptures > 0 ? Math.round((s.completedCaptures / s.totalCaptures) * 100) : 0}% completion rate`}
        />
        <StatCard
          title="Total Duration"
          value={formatDuration(s.totalDuration)}
          icon={<Clock className="size-4" />}
          description={`${s.thisWeek} captures this week`}
        />
      </motion.div>

      <motion.div variants={pageFadeUp} className="grid gap-4 sm:grid-cols-2">
        <Card className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => router.push("/admin/users")}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="size-4" />
              User Management
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              View all users, manage roles, ban/unban, impersonate
            </p>
            <ArrowRight className="size-4 text-muted-foreground" />
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => router.push("/admin/captures")}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PhoneCall className="size-4" />
              All Captures
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Browse all captures across users, filter by status
            </p>
            <ArrowRight className="size-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
