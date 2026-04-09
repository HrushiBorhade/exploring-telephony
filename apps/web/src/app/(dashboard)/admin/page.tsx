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
    <Card className="bg-gradient-to-t from-primary/5 to-card">
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
  const { data: stats, isPending } = useAdminStats();

  // Guard: redirect non-admin users
  useEffect(() => {
    if (session && (session.user as any)?.role !== "admin") {
      router.replace("/capture");
    }
  }, [session, router]);

  if (isPending) return <DashboardSkeleton />;

  const s = stats ?? { totalUsers: 0, totalCaptures: 0, completedCaptures: 0, totalDuration: 0, thisWeek: 0 };

  return (
    <motion.div
      className="p-4 lg:p-6 space-y-6"
      initial="hidden"
      animate="visible"
      variants={pageStagger}
    >
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
        <Card className="bg-gradient-to-t from-primary/5 to-card cursor-pointer hover:from-primary/10 transition-colors" onClick={() => router.push("/admin/users")}>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">User Management</CardTitle>
            <div className="text-2xl font-bold font-heading flex items-center gap-2">
              <Users className="size-5" /> Users
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              View all users, manage roles, ban/unban, impersonate
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-t from-primary/5 to-card cursor-pointer hover:from-primary/10 transition-colors" onClick={() => router.push("/admin/captures")}>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">All Captures</CardTitle>
            <div className="text-2xl font-bold font-heading flex items-center gap-2">
              <PhoneCall className="size-5" /> Captures
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Browse all captures across users, filter by status
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
