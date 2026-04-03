import { execFile } from "child_process";
import { readFile, unlink, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";
import * as dbq from "@repo/db";
import { logger } from "../logger";
import { env } from "../env";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-3&utterances=true&smart_format=true&language=multi";

const { S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION, S3_ENDPOINT } = env;
const R2_PUBLIC_BASE = "https://pub-c4f497a2d9354081a36aee5f920fa419.r2.dev";

export interface Utterance {
  start: number;
  end: number;
  text: string;
  confidence: number;
  audioUrl: string;
}

/**
 * Transcribe a per-speaker recording via Deepgram Nova 3,
 * then slice each utterance into its own audio clip, upload to R2,
 * and store utterance + audio URL in the DB.
 */
export async function transcribeRecording(
  captureId: string,
  audioUrl: string,
  caller: "a" | "b",
): Promise<void> {
  if (!DEEPGRAM_API_KEY) {
    logger.warn("[TRANSCRIBE] DEEPGRAM_API_KEY not set, skipping");
    return;
  }

  logger.info({ captureId, caller, audioUrl }, "[TRANSCRIBE] Starting");

  // 1. Get utterances from Deepgram
  const res = await fetch(DEEPGRAM_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: audioUrl }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deepgram API error ${res.status}: ${body}`);
  }

  const data: any = await res.json();
  const rawUtterances = data?.results?.utterances ?? [];

  if (rawUtterances.length === 0) {
    logger.info({ captureId, caller }, "[TRANSCRIBE] No utterances found");
    const field = caller === "a" ? "transcriptA" : "transcriptB";
    await dbq.updateCapture(captureId, { [field]: JSON.stringify([]) });
    return;
  }

  // 2. Download full recording to temp dir
  const tmpDir = await mkdtemp(path.join(tmpdir(), "utterances-"));
  const fullAudioPath = path.join(tmpDir, "full.mp4");

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Download failed: ${audioRes.status}`);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  await require("fs").promises.writeFile(fullAudioPath, audioBuffer);

  // 3. Slice each utterance + upload to R2
  const utterances: Utterance[] = [];

  for (let i = 0; i < rawUtterances.length; i++) {
    const u = rawUtterances[i];
    const clipFilename = `${captureId}-caller_${caller}-utt-${i}.mp4`;
    const clipPath = path.join(tmpDir, clipFilename);
    const r2Key = `utterances/${clipFilename}`;

    try {
      // Slice with ffmpeg
      await ffmpegSlice(fullAudioPath, clipPath, u.start, u.end);

      // Upload to R2
      const clipData = await readFile(clipPath);
      await uploadToR2(r2Key, clipData, "audio/mp4");

      utterances.push({
        start: u.start,
        end: u.end,
        text: u.transcript,
        confidence: u.confidence,
        audioUrl: `${R2_PUBLIC_BASE}/${r2Key}`,
      });
    } catch (err: any) {
      logger.error({ captureId, caller, utterance: i, error: err.message }, "[TRANSCRIBE] Slice/upload failed");
      // Still include the utterance without audio
      utterances.push({
        start: u.start,
        end: u.end,
        text: u.transcript,
        confidence: u.confidence,
        audioUrl: "",
      });
    }
  }

  // 4. Save to DB
  const field = caller === "a" ? "transcriptA" : "transcriptB";
  await dbq.updateCapture(captureId, { [field]: JSON.stringify(utterances) });

  // 5. Cleanup temp files
  await rm(tmpDir, { recursive: true }).catch(() => {});

  logger.info({ captureId, caller, count: utterances.length }, "[TRANSCRIBE] Done");
}

/** Slice audio using ffmpeg — copy codec, no re-encode */
function ffmpegSlice(input: string, output: string, start: number, end: number): Promise<void> {
  const duration = end - start;
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", [
      "-y", "-ss", String(start), "-t", String(duration),
      "-i", input, "-c", "copy", output,
    ], (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg: ${stderr || err.message}`));
      else resolve();
    });
  });
}

/** Upload a file to R2 using S3v4 signed PUT */
async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<void> {
  const host = new URL(S3_ENDPOINT).host;
  const dateStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const shortDate = dateStamp.slice(0, 8);
  const region = S3_REGION || "auto";

  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");

  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${dateStamp}`,
  ].join("\n") + "\n";

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${S3_BUCKET}/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateStamp,
    scope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signingKey = [region, "s3", "aws4_request"].reduce(
    (key, msg) => crypto.createHmac("sha256", key).update(msg).digest(),
    crypto.createHmac("sha256", `AWS4${S3_SECRET_KEY}`).update(shortDate).digest(),
  );

  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`${S3_ENDPOINT}/${S3_BUCKET}/${key}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": dateStamp,
      Authorization: authorization,
    },
    body,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`R2 upload failed ${res.status}: ${errBody}`);
  }
}
