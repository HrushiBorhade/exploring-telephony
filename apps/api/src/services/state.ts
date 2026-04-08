import type { Capture } from "@repo/types";

/** In-memory cache for active captures -- single source of truth during call lifecycle */
export const activeCaptures = new Map<string, Capture>();

/** Find a capture by its LiveKit room name */
export function findCaptureByRoom(roomName: string): Capture | undefined {
  for (const c of activeCaptures.values()) {
    if (c.roomName === roomName) return c;
  }
  return undefined;
}
