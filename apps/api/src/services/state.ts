import type { Capture } from "@repo/types";

/** In-memory cache for active captures — single source of truth during call lifecycle */
export const activeCaptures = new Map<string, Capture>();
