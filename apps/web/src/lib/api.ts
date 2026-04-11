import { useInfiniteQuery, useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Capture, CaptureStats, PaginatedResponse, ProfileResponse } from "./types";

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
  // Local dev: S3 bucket is private, route through API proxy at localhost:8080
  // Production: S3 bucket has public-read on captures/*, use S3 URL directly
  if (!API.includes("localhost")) return s3Url;

  const marker = `captures/${captureId}/`;
  const idx = s3Url.indexOf(marker);
  if (idx === -1) return s3Url;
  const key = s3Url.slice(idx + marker.length);
  return `${API}/api/captures/${captureId}/audio/${key}`;
}

// ── Query keys ──────────────────────────────────────────────────────

export const captureKeys = {
  all: ["captures"] as const,
  stats: ["captures", "stats"] as const,
  detail: (id: string) => ["captures", id] as const,
};

export const profileKeys = {
  profile: ["profile"] as const,
  onboardingStatus: ["profile", "onboarding-status"] as const,
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

async function postJson<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
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

const CAPTURES_PAGE_SIZE = 20;

export function useCaptures() {
  return useInfiniteQuery({
    queryKey: captureKeys.all,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(CAPTURES_PAGE_SIZE) });
      if (pageParam) params.set("cursor", pageParam);
      return fetchJson<PaginatedResponse<Capture>>(`${API}/api/captures?${params}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useCaptureStats() {
  return useQuery({
    queryKey: captureKeys.stats,
    queryFn: () => fetchJson<CaptureStats>(`${API}/api/captures/stats`),
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

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.profile,
    queryFn: () => fetchJson<ProfileResponse>(`${API}/api/profile`),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; age: number; gender: string; city: string; state: string }) =>
      postJson<{ success: boolean }>(`${API}/api/profile`, data, "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.profile });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

export function useUpdateLanguages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { languages: { languageCode: string; languageName: string; isPrimary: boolean; dialects: string[] }[] }) =>
      postJson<{ success: boolean }>(`${API}/api/profile/languages`, data, "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.profile });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

// ── Mutations ───────────────────────────────────────────────────────

export function useCreateCapture() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; phoneB: string; language: string }) =>
      postJson<Capture>(`${API}/api/captures`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureKeys.all });
      queryClient.invalidateQueries({ queryKey: captureKeys.stats });
    },
    onError: (err) => {
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

// ── Admin ───────────────────────────────────────────────────────────

export const adminKeys = {
  users: (params?: Record<string, unknown>) => ["admin", "users", params ?? {}] as const,
  stats: ["admin", "stats"] as const,
  captures: (params?: Record<string, unknown>) => ["admin", "captures", params ?? {}] as const,
};

export function useAdminStats() {
  return useQuery({
    queryKey: adminKeys.stats,
    queryFn: () => fetchJson<{
      totalUsers: number;
      totalCaptures: number;
      completedCaptures: number;
      totalDuration: number;
      thisWeek: number;
    }>(`${API}/api/admin/stats`),
  });
}

export function useAdminCaptures(opts?: { cursor?: string; limit?: number }) {
  return useInfiniteQuery({
    queryKey: adminKeys.captures(opts),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", String(opts?.limit ?? 20));
      return fetchJson<PaginatedResponse<Capture>>(`${API}/api/admin/captures?${params}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

// ── Transcript ──────────────────────────────────────────────────────

export function useUpdateTranscript(captureId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      participant: "a" | "b";
      index: number;
      text?: string;
      action?: "edit" | "delete";
    }) =>
      postJson(`${API}/api/captures/${captureId}/transcript`, data, "PATCH"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureKeys.detail(captureId) });
    },
    onError: (err) => {
      toast.error(`Failed to update: ${err.message}`);
    },
  });
}

export function useVerifyCapture(captureId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => postJson(`${API}/api/captures/${captureId}/verify`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureKeys.detail(captureId) });
      toast.success("Capture verified");
    },
    onError: (err) => {
      toast.error(`Failed to verify: ${err.message}`);
    },
  });
}
