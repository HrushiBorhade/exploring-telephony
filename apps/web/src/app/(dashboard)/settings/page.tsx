"use client";

import { useSession } from "@/lib/auth-client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";

const fadeUp = pageFadeUp;
const stagger = pageStagger;

export default function SettingsPage() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-48 skeleton-shimmer" />
        <Skeleton className="h-24 w-full max-w-lg skeleton-shimmer" />
      </div>
    );
  }

  const user = session?.user;
  const phoneNumber = String((user as Record<string, unknown>)?.phoneNumber ?? "\u2014");
  const phoneVerified = Boolean((user as Record<string, unknown>)?.phoneNumberVerified);

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <motion.div
        className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <motion.div variants={fadeUp}>
          <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
          <p className="text-sm text-muted-foreground">
            Manage your account
          </p>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Your account information</CardDescription>
            </CardHeader>
            <div className="px-6 pb-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Phone</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium font-mono">
                    {phoneNumber}
                  </span>
                  {phoneVerified && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900"
                    >
                      Verified
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  );
}
