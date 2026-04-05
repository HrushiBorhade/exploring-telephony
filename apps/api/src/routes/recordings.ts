import { Router } from "express";
import { writeFile } from "fs/promises";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import * as dbq from "@repo/db";
import { getRecordingPath, recordingExists } from "../lib/audio";
import { logger } from "../logger";
import { env } from "../env";

const { S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION, S3_ENDPOINT } = env;
const router = Router();

// Proxy S3 recordings — downloads to local cache on first access
router.get("/api/r2/:captureId/:filename", requireAuth, async (req: AuthRequest, res) => {
  const { captureId, filename } = req.params as { captureId: string; filename: string };
  const capture = await dbq.getCapture(captureId);
  if (!capture || capture.userId !== req.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const localPath = getRecordingPath(filename);

  if (recordingExists(filename)) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(localPath);
    return;
  }

  // Download from S3 using fetch with SigV4-compatible presigned URL approach
  const s3Key = `recordings/${filename}`;
  const s3Url = S3_ENDPOINT
    ? `${S3_ENDPOINT}/${S3_BUCKET}/${s3Key}`
    : `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3Key}`;

  try {
    const response = await fetch(s3Url);
    if (!response.ok) {
      logger.error({ status: response.status, key: s3Key }, "[S3] Download failed");
      res.status(404).json({ error: "Recording not found in S3" });
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(localPath, buffer);
    logger.info({ filename, sizeKB: (buffer.length / 1024).toFixed(1) }, "[S3] Downloaded recording");
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(localPath);
  } catch (err: any) {
    logger.error({ error: err.message, key: s3Key }, "[S3] Download error");
    res.status(500).json({ error: "Failed to fetch recording" });
  }
});

// Serve local recordings
router.get("/api/recordings/:filename", requireAuth, async (req: AuthRequest, res) => {
  const { filename } = req.params as { filename: string };
  const match = filename.match(/^([a-f0-9]+)-(mixed|caller_a|caller_b)\.[a-z0-9]+$/);
  if (!match) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const captureId = match[1];
  const capture = await dbq.getCapture(captureId);
  if (!capture || capture.userId !== req.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!recordingExists(filename)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(getRecordingPath(filename));
});

export default router;
