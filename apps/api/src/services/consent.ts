import { roomService } from "../lib/livekit";
import { logger } from "../logger";

/** Consent resolver: called when consent is determined (granted, denied, or cancelled) */
export const consentResolvers = new Map<string, (result: boolean) => void>();

/**
 * Map from consent room name → capture ID.
 * Used by participant_left webhook to find the paired consent room.
 */
export const consentRoomPairs = new Map<string, { captureId: string; roomA: string; roomB: string }>();

/**
 * Register a consent room pair so disconnect propagation can find the other room.
 */
export function registerConsentPair(captureId: string, roomA: string, roomB: string) {
  consentRoomPairs.set(roomA, { captureId, roomA, roomB });
  consentRoomPairs.set(roomB, { captureId, roomA, roomB });
}

/**
 * Cancel both consent rooms for a capture — called when one caller disconnects.
 * Resolves both consent promises as false and removes the remaining caller.
 */
export async function cancelConsentPair(triggeringRoom: string) {
  const pair = consentRoomPairs.get(triggeringRoom);
  if (!pair) return;

  const otherRoom = triggeringRoom === pair.roomA ? pair.roomB : pair.roomA;

  // Resolve both as false
  const resolverA = consentResolvers.get(pair.roomA);
  const resolverB = consentResolvers.get(pair.roomB);
  if (resolverA) resolverA(false);
  if (resolverB) resolverB(false);

  // Remove the remaining caller from the other room
  try {
    const otherIdentity = triggeringRoom === pair.roomA ? "caller_b" : "caller_a";
    await roomService.removeParticipant(otherRoom, otherIdentity);
    logger.info({ otherRoom, otherIdentity }, "[CONSENT] Removed other caller (partner disconnected)");
  } catch {
    // Other caller may have already left — that's fine
  }

  // Cleanup
  consentRoomPairs.delete(pair.roomA);
  consentRoomPairs.delete(pair.roomB);
}

/**
 * Wait for consent by polling room metadata directly.
 * Also kept in consentResolvers map for fast-resolve via webhook or cancellation.
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

    // Fast path: webhook or cancellation resolves instantly
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
