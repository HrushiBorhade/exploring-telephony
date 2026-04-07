"use client";

import { useSession } from "@/lib/auth-client";
import { useProfile } from "@/lib/api";
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
  const { data: session, isPending: sessionPending } = useSession();
  const { data: profileData, isLoading: profileLoading } = useProfile();

  if (sessionPending || profileLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-48 skeleton-shimmer" />
        <Skeleton className="h-48 w-full max-w-lg skeleton-shimmer" />
      </div>
    );
  }

  const user = session?.user;
  const phoneNumber = String((user as Record<string, unknown>)?.phoneNumber ?? "\u2014");
  const phoneVerified = Boolean((user as Record<string, unknown>)?.phoneNumberVerified);
  const profile = profileData?.profile;
  const languages = profileData?.languages ?? [];

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <motion.div
        className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <motion.div variants={fadeUp}>
          <h2 className="text-lg font-semibold tracking-tight font-heading">Settings</h2>
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
            <div className="px-6 pb-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm font-medium">{profile?.name ?? "\u2014"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Phone</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium font-mono">{phoneNumber}</span>
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
              {profile && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Age</span>
                    <span className="text-sm font-medium">{profile.age}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Gender</span>
                    <span className="text-sm font-medium capitalize">{profile.gender.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Location</span>
                    <span className="text-sm font-medium">{profile.city}, {profile.state}</span>
                  </div>
                </>
              )}
              {languages.length > 0 && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-sm text-muted-foreground shrink-0 mt-0.5">Languages</span>
                  <div className="flex flex-wrap justify-end gap-1">
                    {languages.map((l) => (
                      <Badge key={l.languageCode} variant="secondary" className="text-xs">
                        {l.languageName}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  );
}
