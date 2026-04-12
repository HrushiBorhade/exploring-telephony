"use client";

import { useRouter } from "next/navigation";
import { Users, PhoneCall, CheckCircle, Clock, Target, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { useAdminStats, useThemeAvailability } from "@/lib/api";
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
  const { data: themeAvailability } = useThemeAvailability();

  useEffect(() => {
    if (session && (session.user as any)?.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [session, router]);

  if (isPending) return <DashboardSkeleton />;

  const s = stats ?? { totalUsers: 0, totalCaptures: 0, completedCaptures: 0, totalDuration: 0, thisWeek: 0 };

  const totalAvailable = themeAvailability?.reduce((sum, l) => sum + l.available, 0) ?? 0;
  const totalThemes = themeAvailability?.reduce((sum, l) => sum + l.total, 0) ?? 0;

  return (
    <motion.div
      className="p-4 lg:p-6 space-y-6"
      initial="hidden"
      animate="visible"
      variants={pageStagger}
    >
      {/* Stats grid */}
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

      {/* Theme pool card */}
      {themeAvailability && themeAvailability.length > 0 && (
        <motion.div variants={pageFadeUp}>
          <Card className="bg-gradient-to-t from-primary/5 to-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium text-muted-foreground">Theme Sample Pool</CardTitle>
                </div>
                <Badge variant="outline" className="text-xs">
                  {totalAvailable}/{totalThemes} available
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {themeAvailability.map((lang) => {
                  const usedPct = totalThemes > 0 ? Math.round(((lang.total - lang.available) / lang.total) * 100) : 0;
                  return (
                    <div key={lang.language} className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium capitalize">{lang.language}</p>
                        <p className="text-xs text-muted-foreground">{lang.available} available / {lang.total} total</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold font-heading tabular-nums">{usedPct}%</p>
                        <p className="text-[10px] text-muted-foreground">used</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Navigation cards */}
      <motion.div variants={pageFadeUp} className="grid gap-4 sm:grid-cols-3">
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
              Browse all captures, filter by type and status, verify quality
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-t from-primary/5 to-card cursor-pointer hover:from-primary/10 transition-colors" onClick={() => router.push("/admin/captures?type=themed")}>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Themed Captures</CardTitle>
            <div className="text-2xl font-bold font-heading flex items-center gap-2">
              <Target className="size-5" /> Themes
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              View themed captures, track sample usage per language
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
