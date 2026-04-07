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

export default function SettingsPage() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full max-w-lg" />
      </div>
    );
  }

  const user = session?.user;

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
        <div>
          <h2 className="text-lg font-semibold">Settings</h2>
          <p className="text-sm text-muted-foreground">
            Manage your account
          </p>
        </div>

        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <div className="px-6 pb-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm font-medium">
                {user?.name || "\u2014"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium font-mono">
                {user?.email || "\u2014"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Phone</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium font-mono">
                  {String(
                    (user as Record<string, unknown>)?.phoneNumber ?? "\u2014"
                  )}
                </span>
                {Boolean(
                  (user as Record<string, unknown>)?.phoneNumberVerified
                ) && (
                  <Badge
                    variant="outline"
                    className="text-xs bg-emerald-950 text-emerald-400 border-emerald-900"
                  >
                    Verified
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">User ID</span>
              <span className="text-xs font-mono text-muted-foreground">
                {user?.id || "\u2014"}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
