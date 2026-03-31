import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Capture } from "./types";

const API = process.env.NEXT_PUBLIC_API_URL || "";

// ── Query keys ──────────────────────────────────────────────────────

export const captureKeys = {
  all: ["captures"] as const,
  detail: (id: string) => ["captures", id] as const,
};

// ── Fetchers ────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
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
  });
}

export function useCapture(id: string) {
  return useQuery({
    queryKey: captureKeys.detail(id),
    queryFn: () => fetchJson<Capture>(`${API}/api/captures/${id}`),
    // Poll faster when call is active
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "calling" || status === "active" || status === "ended") return 2_000;
      if (status === "completed") return false; // stop polling
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureKeys.all });
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
