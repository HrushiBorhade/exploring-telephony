"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useProfile } from "@/lib/api";
import { LoaderCircle } from "lucide-react";

export default function AuthCallbackPage() {
  const router = useRouter();
  const { data: profile, isLoading, isError } = useProfile();

  useEffect(() => {
    if (isError) {
      router.replace("/login");
      return;
    }
    if (isLoading || !profile) return;
    router.replace(profile.onboardingCompleted ? "/dashboard" : "/onboarding");
  }, [isLoading, isError, profile, router]);

  return (
    <div className="flex min-h-svh items-center justify-center">
      <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
