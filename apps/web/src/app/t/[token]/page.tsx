"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, AlertCircle, Globe } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

const LANG_LABELS: Record<string, string> = {
  hindi: "\u0939\u093F\u0902\u0926\u0940",
  telugu: "\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41",
  english: "English",
  tamil: "\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD",
  kannada: "\u0C95\u0CA8\u0CCD\u0CA8\u0CA1",
  malayalam: "\u0D2E\u0D32\u0D2F\u0D3E\u0D33\u0D02",
  bengali: "\u09AC\u09BE\u0982\u09B2\u09BE",
  marathi: "\u092E\u0930\u093E\u0920\u0940",
  gujarati: "\u0A97\u0AC1\u0A9C\u0AB0\u0ABE\u0AA4\u0AC0",
  punjabi: "\u0A2A\u0A70\u0A1C\u0A3E\u0A2C\u0A40",
};

const CATEGORY_LABELS: Record<string, string> = {
  alphanumeric: "Alphanumeric",
  healthcare: "Healthcare",
  short_utterances: "Short Utterances",
  banking: "Banking",
  ecommerce: "E-Commerce",
  travel: "Travel",
  education: "Education",
};

interface ThemeResponse {
  category: string;
  language: string;
  data: Record<string, string>;
}

async function fetchTheme(token: string): Promise<ThemeResponse> {
  const res = await fetch(`${API_URL}/api/theme/${token}`);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("NOT_FOUND");
    }
    throw new Error("FETCH_ERROR");
  }
  return res.json();
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PublicThemePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["public-theme", token],
    queryFn: () => fetchTheme(token),
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <LoaderCircle className="size-8 animate-spin" />
          <p className="text-sm">Loading task details...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    const isNotFound =
      error instanceof Error && error.message === "NOT_FOUND";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-5" />
              <CardTitle>
                {isNotFound ? "Link Not Found" : "Something Went Wrong"}
              </CardTitle>
            </div>
            <CardDescription>
              {isNotFound
                ? "This link may have expired or is invalid. Please ask the task creator for a new link."
                : "We couldn't load the task details. Please try again later."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const categoryLabel =
    CATEGORY_LABELS[data.category] ?? formatFieldLabel(data.category);
  const languageLabel = LANG_LABELS[data.language] ?? data.language;
  const fieldEntries = Object.entries(data.data);

  return (
    <div className="flex min-h-screen flex-col bg-background px-4 py-8">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Voice Data Collection Task
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{categoryLabel}</Badge>
            <Badge variant="outline">
              <Globe className="size-3" />
              {languageLabel}
            </Badge>
          </div>
        </div>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Your Role: Participant B</CardTitle>
            <CardDescription>
              You will be reading the values shown below during the voice call.
              Please review them before the session begins.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1.5 text-sm text-muted-foreground">
              <li>Read each value clearly and at a natural pace</li>
              <li>Wait for Participant A to confirm before moving on</li>
              <li>If asked, spell out or repeat any value</li>
            </ul>
          </CardContent>
        </Card>

        {/* Values */}
        <Card>
          <CardHeader>
            <CardTitle>Form Values</CardTitle>
            <CardDescription>
              Read these values aloud during the call
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fieldEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No values to display.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {fieldEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {formatFieldLabel(key)}
                    </span>
                    <span className="text-base font-medium break-all">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="flex flex-col items-center gap-2 pb-4 pt-2 text-center text-xs text-muted-foreground">
          <p>
            Please speak in{" "}
            <span className="font-medium text-foreground">
              {languageLabel}
            </span>{" "}
            during the call
          </p>
          <p className="opacity-60">Powered by Annote</p>
        </footer>
      </div>
    </div>
  );
}
