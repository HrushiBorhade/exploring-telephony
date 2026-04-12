import { execFile } from "child_process";
import path from "path";

/** Run an ffmpeg/ffprobe command and return stdout */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd}: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

const MP3_OPTS = ["-c:a", "libmp3lame", "-q:a", "5", "-ar", "16000", "-ac", "1"];

/** Convert any audio file (MP4/AAC, WAV, etc.) to MP3 16kHz mono */
export function convertToMp3(input: string, output: string): Promise<void> {
  return run("ffmpeg", ["-y", "-i", input, ...MP3_OPTS, output]).then(() => {});
}

/**
 * Slice a segment from an MP3 file using -c copy (no re-encoding).
 * Cuts at MP3 frame boundaries (~26ms granularity) — no encoder delay, no artifacts.
 */
export function sliceMp3(input: string, output: string, startSec: number, endSec: number): Promise<void> {
  const duration = endSec - startSec;
  return run("ffmpeg", [
    "-y", "-ss", String(startSec), "-t", String(duration), "-i", input, "-c", "copy", output,
  ]).then(() => {});
}

/** Get audio duration in seconds using ffprobe */
export function getDuration(input: string): Promise<number> {
  return run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input,
  ]).then((s) => parseFloat(s.trim()));
}

/** Trim audio from the start — re-encodes to MP3 (needed for alignment) */
export function trimStart(input: string, output: string, trimSec: number): Promise<void> {
  return run("ffmpeg", ["-y", "-ss", String(trimSec), "-i", input, ...MP3_OPTS, output]).then(() => {});
}

/** Format seconds for filenames: 65.3 -> "01m05s" */
export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

export interface AudioChunk {
  filePath: string;
  offsetSeconds: number;
  durationSeconds: number;
}

export interface ChunkOptions {
  chunkDuration: number;
  overlapDuration: number;
}

/**
 * Split audio into overlapping chunks for transcription.
 * Returns the original file as a single chunk if shorter than chunkDuration.
 */
export async function splitIntoChunks(
  input: string,
  outputDir: string,
  opts: ChunkOptions,
): Promise<AudioChunk[]> {
  const totalDuration = await getDuration(input);

  if (totalDuration <= opts.chunkDuration) {
    return [{ filePath: input, offsetSeconds: 0, durationSeconds: totalDuration }];
  }

  const step = opts.chunkDuration - opts.overlapDuration;
  const chunks: AudioChunk[] = [];

  for (let offset = 0; offset < totalDuration; offset += step) {
    const remaining = totalDuration - offset;
    const chunkLen = Math.min(opts.chunkDuration, remaining);
    if (chunkLen < 2) break;

    const chunkPath = path.join(outputDir, `chunk-${chunks.length}.mp3`);
    await run("ffmpeg", [
      "-y", "-ss", String(offset), "-t", String(chunkLen), "-i", input, "-c", "copy", chunkPath,
    ]);
    chunks.push({ filePath: chunkPath, offsetSeconds: offset, durationSeconds: chunkLen });
  }

  return chunks;
}
