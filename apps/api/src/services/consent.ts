import { logger } from "../logger";

/** Webhook-driven consent resolution — resolvers are called by room_metadata_changed webhook */
export const consentResolvers = new Map<string, (result: boolean) => void>();

export function waitForConsent(roomName: string, timeoutMs = 50_000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      consentResolvers.delete(roomName);
      logger.warn({ roomName, timeoutMs }, "[CONSENT] Timed out waiting for consent");
      resolve(false);
    }, timeoutMs);
    consentResolvers.set(roomName, (result) => {
      clearTimeout(timer);
      consentResolvers.delete(roomName);
      resolve(result);
    });
  });
}
