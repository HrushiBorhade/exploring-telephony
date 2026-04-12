import { Router } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import * as dbq from "@repo/db";
import { logger } from "../logger";
import { env } from "../env";
import { s3 } from "../lib/s3-client";
import type { Readable } from "stream";

const { S3_BUCKET } = env;

const router = Router();

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".csv": "text/csv",
  ".json": "application/json",
};

/**
 * Stream S3 objects for a capture through the API.
 * Browser hits same-origin URL → cookies sent automatically → no CORS issues.
 *
 * GET /api/captures/:captureId/audio/*key
 */
router.get("/api/captures/:captureId/audio/*key", requireAuth, async (req: AuthRequest, res) => {
  const { captureId } = req.params as { captureId: string };
  // Express 5 returns wildcard params as arrays
  const rawKey = req.params.key;
  const key = Array.isArray(rawKey) ? rawKey.join("/") : rawKey as string;

  if (!key || key.includes("..")) {
    res.status(400).json({ error: "Invalid key" });
    return;
  }

  const capture = await dbq.getCapture(captureId);
  if (!capture || (capture.userId !== req.userId && req.userRole !== "admin")) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const s3Key = `captures/${captureId}/${key}`;
  const ext = key.slice(key.lastIndexOf("."));

  try {
    // Pass Range header to S3 for byte-range requests (enables scrubbing)
    const rangeHeader = req.headers.range;
    const { Body, ContentLength, ContentRange } = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      ...(rangeHeader && { Range: rangeHeader }),
    }));

    if (!Body) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const contentType = MIME[ext] || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Accept-Ranges", "bytes");

    if (rangeHeader && ContentRange) {
      res.status(206);
      res.setHeader("Content-Range", ContentRange);
      if (ContentLength) res.setHeader("Content-Length", ContentLength);
    } else {
      if (ContentLength) res.setHeader("Content-Length", ContentLength);
    }

    // Pipe the S3 readable stream directly to the response
    const stream = Body as Readable;
    stream.pipe(res);
    stream.on("error", (err) => {
      logger.error({ error: err.message, key: s3Key }, "[S3] Stream error");
      if (!res.headersSent) res.status(500).json({ error: "Stream failed" });
    });
  } catch (err: any) {
    if (err.name === "NoSuchKey") {
      res.status(404).json({ error: "File not found" });
      return;
    }
    logger.error({ error: err.message, key: s3Key }, "[S3] Download failed");
    res.status(500).json({ error: "Failed to fetch audio" });
  }
});

export default router;
