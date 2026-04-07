import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Capture } from "./types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * Rewrite an S3 URL to go through the API presigned-URL proxy.
 * DB stores canonical S3 URLs; the browser can't access them directly.
 * The proxy returns a 302 redirect to a short-lived presigned URL.
 *
 * Input:  https://bucket.s3.region.amazonaws.com/captures/{captureId}/participant-a/clips/001.mp3
 * Output: {API}/api/captures/{captureId}/audio/participant-a/clips/001.mp3
 */
export function proxyAudioUrl(s3Url: string, captureId: string): string {
  try {
    const parsed = new URL(s3Url);
    const prefix = `/captures/${captureId}/`;
    const idx = parsed.pathname.indexOf(prefix);
    if (idx === -1) return s3Url;
    const relativePath = parsed.pathname.slice(idx + prefix.length);
    return `${API}/api/captures/${captureId}/audio/${relativePath}`;
  } catch {
    return s3Url;
  }
}

// ── Query keys ──────────────────────────────────────────────────────

export const captureKeys = {
  all: ["captures"] as const,
  detail: (id: string) => ["captures", id] as const,
};

// ── Fetchers ────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Queries ─────────────────────────────────────────────────────────

export function useCaptures() {
  return useQuery({
    queryKey: captureKeys.all,
    queryFn: () => fetchJson<Capture[]>(`${API}/api/captures`),
    staleTime: 30_000,
  });
}

export function useCapture(id: string) {
  return useQuery({
    queryKey: captureKeys.detail(id),
    queryFn: () => fetchJson<Capture>(`${API}/api/captures/${id}`),
    refetchOnWindowFocus: false,
    // Poll faster when call is active; keep polling on "completed" until all recordings arrive
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5_000;
      if (data.status === "calling" || data.status === "active" || data.status === "processing") return 2_000;
      if (data.status === "ended") return data.startedAt ? 2_000 : false;
      if (data.status === "completed") {
        const allRecordings = data.recordingUrl && data.recordingUrlA && data.recordingUrlB;
        const allTranscripts = data.transcriptA && data.transcriptB;
        return (allRecordings && allTranscripts) ? false : 2_000;
      }
      return 5_000;
    },
  });
}

// ── Mutations ───────────────────────────────────────────────────────

export function useCreateCapture() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; phoneB: string; language: string }) =>
      postJson<Capture>(`${API}/api/captures`, data),
    onMutate: async (newCapture) => {
      await queryClient.cancelQueries({ queryKey: captureKeys.all });
      const prev = queryClient.getQueryData<Capture[]>(captureKeys.all);
      if (prev) {
        queryClient.setQueryData(captureKeys.all, [
          {
            id: `temp-${Date.now()}`,
            status: "created" as const,
            name: newCapture.name,
            phoneA: "",
            phoneB: newCapture.phoneB,
            language: newCapture.language,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
      return { prev };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureKeys.all });
    },
    onError: (err, _, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(captureKeys.all, ctx.prev);
      toast.error(err.message);
    },
  });
}

export function useStartCapture(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => postJson(`${API}/api/captures/${id}/start`),
    onMutate: async () => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: captureKeys.detail(id) });
      const prev = queryClient.getQueryData<Capture>(captureKeys.detail(id));
      if (prev) {
        queryClient.setQueryData(captureKeys.detail(id), { ...prev, status: "calling" as const });
      }
      return { prev };
    },
    onSuccess: () => {
      toast.success("Calling both phones...");
      queryClient.invalidateQueries({ queryKey: captureKeys.detail(id) });
    },
    onError: (err, _, ctx) => {
      // Revert optimistic update
      if (ctx?.prev) queryClient.setQueryData(captureKeys.detail(id), ctx.prev);
      toast.error(err.message);
    },
  });
}

export function useEndCapture(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => postJson(`${API}/api/captures/${id}/end`),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: captureKeys.detail(id) });
      const prev = queryClient.getQueryData<Capture>(captureKeys.detail(id));
      if (prev) {
        queryClient.setQueryData(captureKeys.detail(id), { ...prev, status: "ended" as const });
      }
      return { prev };
    },
    onSuccess: () => {
      toast.info("Call ended. Recording being processed...");
      queryClient.invalidateQueries({ queryKey: captureKeys.detail(id) });
    },
    onError: (err, _, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(captureKeys.detail(id), ctx.prev);
      toast.error(err.message);
    },
  });
}
