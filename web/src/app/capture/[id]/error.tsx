"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function CaptureDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Capture detail error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="py-12 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
            <span className="text-destructive text-xl">!</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Failed to load capture</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {error.message || "This capture may not exist or the server is unavailable."}
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => window.location.href = "/capture"}>
              Back to Dashboard
            </Button>
            <Button onClick={reset}>
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
