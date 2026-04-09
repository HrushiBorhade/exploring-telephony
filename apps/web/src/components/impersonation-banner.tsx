"use client";

import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession, authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";

export function ImpersonationBanner() {
  const { data: session } = useSession();
  const router = useRouter();

  const isImpersonating = !!(session as any)?.session?.impersonatedBy;

  async function stopImpersonating() {
    try {
      await authClient.admin.stopImpersonating();
      // Full page reload — session reverts to admin, all caches must clear
      window.location.href = "/admin/users";
    } catch {
      toast.error("Failed to stop impersonating");
    }
  }

  return (
    <AnimatePresence>
      {isImpersonating && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="bg-amber-500 dark:bg-amber-600 text-white overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2 text-sm">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4" />
              <span className="font-medium">
                Impersonating {session?.user?.name || session?.user?.email}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 bg-white/20 border-white/30 text-white hover:bg-white/30"
              onClick={stopImpersonating}
            >
              Stop Impersonating
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
