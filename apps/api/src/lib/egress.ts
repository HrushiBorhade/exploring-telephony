import { egressClient } from "./livekit";
import { createS3FileOutput } from "./s3";
import { logger } from "../logger";
import * as dbq from "@repo/db";
import { egressSuccessTotal, egressFailureTotal } from "../metrics";
import type { Capture } from "@repo/types";

/**
 * Start all 3 egresses (mixed + caller_a + caller_b) for a capture room.
 * Idempotent: won't start if already starting or started.
 */
export async function startEgressForCapture(capture: Capture, roomName: string): Promise<void> {
  // Guard against double-start
  if (capture._egressStarting || capture._egressIds?.length) {
    logger.warn(`[EGRESS] Already started for ${roomName}`);
    return;
  }

  capture._egressStarting = true;
  capture._egressIds = [];

  try {
    const mixedOutput = createS3FileOutput(capture.id);
    const speakerAOutput = createS3FileOutput(capture.id, "caller_a");
    const speakerBOutput = createS3FileOutput(capture.id, "caller_b");

    // Start all 3 egresses concurrently for synchronized start times
    const [mixedEgress, egressA, egressB] = await Promise.all([
      egressClient.startRoomCompositeEgress(roomName, { file: mixedOutput }, { audioOnly: true }),
      egressClient.startParticipantEgress(roomName, "caller_a", { file: speakerAOutput }),
      egressClient.startParticipantEgress(roomName, "caller_b", { file: speakerBOutput }),
    ]);

    capture.egressId = mixedEgress.egressId;
    capture._egressIds = [mixedEgress.egressId, egressA.egressId, egressB.egressId];
    await dbq.updateCapture(capture.id, { egressId: capture.egressId })
      .catch((e) => logger.error({ captureId: capture.id }, "[DB] egressId update failed:", e.message));

    egressSuccessTotal.inc({ type: "mixed" });
    egressSuccessTotal.inc({ type: "caller_a" });
    egressSuccessTotal.inc({ type: "caller_b" });
    logger.info(`[EGRESS] All 3 egresses started for ${roomName}`);
  } catch (err: any) {
    capture.egressId = undefined;
    capture._egressStarting = false;
    capture._egressIds = [];
    egressFailureTotal.inc();
    logger.error(`[EGRESS] Failed to start egress for ${roomName}:`, err.message);
    throw err;
  }
}
