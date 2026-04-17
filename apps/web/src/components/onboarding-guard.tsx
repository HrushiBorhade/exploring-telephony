"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useProfile } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { WelcomeModal } from "@/components/welcome-modal";

const WELCOME_KEY = "annote-welcome-seen";

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: profile, isPending, isError } = useProfile();

  // Initialize from localStorage — lazy initializer runs once on mount
  const [welcomeOpen, setWelcomeOpen] = useState(() =>
    typeof window !== "undefined" ? !localStorage.getItem(WELCOME_KEY) : false
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth session type
  const isImpersonating = !!(session as any)?.session?.impersonatedBy;

  useEffect(() => {
    if (isImpersonating) return;
    if (isError) { router.replace("/login"); return; }
    if (isPending || !profile) return;
    if (!profile.onboardingCompleted) { router.replace("/onboarding"); }
  }, [isPending, isError, profile, router, isImpersonating]);

  // Only show if onboarding is complete
  const showModal = welcomeOpen && !isPending && !!profile?.onboardingCompleted && !isImpersonating;

  function closeWelcome() {
    setWelcomeOpen(false);
    localStorage.setItem(WELCOME_KEY, "true");
  }

  if (isImpersonating) return <>{children}</>;

  if (isPending) {
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

  return (
    <>
      {children}
      <WelcomeModal
        open={showModal}
        onOpenChange={(open) => { if (!open) closeWelcome(); }}
        userName={profile?.profile?.name || undefined}
      />
    </>
  );
}
