"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useProfile } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: profile, isLoading, isError } = useProfile();

  useEffect(() => {
    if (isError) {
      router.replace("/login");
      return;
    }
    if (isLoading || !profile) return;
    if (!profile.onboardingCompleted) {
      router.replace("/onboarding");
    }
  }, [isLoading, isError, profile, router]);

  // Show skeleton while loading, erroring, or redirecting
  if (isLoading || isError || (profile && !profile.onboardingCompleted)) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return <>{children}</>;
}
