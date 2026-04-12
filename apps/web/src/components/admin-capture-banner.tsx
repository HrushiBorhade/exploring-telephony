"use client";

import { useRouter } from "next/navigation";
import { Eye, ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

/**
 * Shows a subtle banner when an admin is viewing a capture that belongs to a different user.
 * Does nothing if the viewer owns the capture or is not an admin.
 */
export function AdminCaptureBanner({ captureUserId, capturePhoneA }: {
  captureUserId?: string;
  capturePhoneA?: string;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  const isAdmin = (session?.user as any)?.role === "admin";
  const isOwnCapture = session?.user?.id === captureUserId;

  if (!isAdmin || isOwnCapture || !captureUserId) return null;

  return (
    <div className="flex items-center gap-2 px-3 sm:px-4 lg:px-6 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
      <Eye className="size-3.5 shrink-0" />
      <span>
        Admin view
        {capturePhoneA && (
          <> &middot; Capture by <span className="font-mono">{capturePhoneA}</span></>
        )}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-6 text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 px-2"
        onClick={() => router.push("/admin/captures")}
      >
        <ArrowLeft className="size-3 mr-1" />
        Back to Admin
      </Button>
    </div>
  );
}
