import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import * as dbq from "@repo/db";
import { getRecordingPath, recordingExists } from "../lib/audio";
import { logger } from "../logger";
import { env } from "../env";

const { S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_ENDPOINT } = env;
const router = Router();

// Proxy R2 recordings
router.get("/api/r2/:captureId/:filename", requireAuth, async (req: AuthRequest, res) => {
  const { captureId, filename } = req.params as { captureId: string; filename: string };
  const capture = await dbq.getCapture(captureId);
  if (!capture || capture.userId !== req.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const s3Key = `recordings/${filename}`;
  const localPath = getRecordingPath(filename);

  if (recordingExists(filename)) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(localPath);
    return;
  }

  const { execFile } = require("child_process");
  const execEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: S3_ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: S3_SECRET_KEY,
  };

  execFile(
    "aws",
    ["s3", "cp", `s3://${S3_BUCKET}/${s3Key}`, localPath, "--endpoint-url", S3_ENDPOINT!],
    { env: execEnv },
    (err: any) => {
      if (err) {
        logger.error("[R2] Download failed:", err.message);
        res.status(404).json({ error: "Recording not found in R2" });
        return;
      }
      logger.info(`[R2] Downloaded ${filename}`);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.sendFile(localPath);
    },
  );
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
