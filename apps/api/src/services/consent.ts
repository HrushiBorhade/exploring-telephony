import { roomService } from "../lib/livekit";
import { logger } from "../logger";

/** Consent resolver: called by webhook or polling when consent is determined */
export const consentResolvers = new Map<string, (result: boolean) => void>();

/**
 * Wait for consent via webhook + polling fallback.
 * Webhook resolves instantly when available, but room_metadata_changed
 * delivery is unreliable — polling every 500ms is the reliable path.
 */
export function waitForConsent(roomName: string, timeoutMs = 50_000): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const done = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearInterval(poller);
      consentResolvers.delete(roomName);
      resolve(result);
    };

    const timer = setTimeout(() => {
      logger.warn({ roomName, timeoutMs }, "[CONSENT] Timed out waiting for consent");
      done(false);
    }, timeoutMs);

    // Fast path: webhook resolves instantly (if delivered)
    consentResolvers.set(roomName, done);

    // Reliable path: poll room metadata every 500ms
    const poller = setInterval(async () => {
      try {
        const rooms = await roomService.listRooms([roomName]);
        const room = rooms.find((r) => r.name === roomName);
        if (room?.metadata) {
          const parsed = JSON.parse(room.metadata);
          if (parsed.consent === true) {
            logger.info({ roomName }, "[CONSENT] Consent GRANTED (poll)");
            done(true);
          } else if (parsed.consent === false) {
            logger.info({ roomName }, "[CONSENT] Consent DENIED (poll)");
            done(false);
          }
        }
      } catch (err: any) {
        logger.debug({ roomName, error: err.message }, "[CONSENT] Poll error (will retry)");
      }
    }, 500);
  });
}
