import type { Capture } from "@repo/types";

/** Calculate call duration in seconds from startedAt timestamp */
export function calculateDuration(startedAt?: string | null): number {
  if (!startedAt) return 0;
  return Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);
}

/** Strip internal runtime fields before sending to client */
export function toApiCapture(c: any) {
  const { _joinedCallers, _egressStarting, ...safe } = c;
  return safe;
}
