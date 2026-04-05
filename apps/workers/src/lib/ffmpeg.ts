import { execFile } from "child_process";

/** Convert any audio file to MP3 (16kHz mono, good for speech) */
export function convertToMp3(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-i", input, "-c:a", "libmp3lame", "-q:a", "5", "-ar", "16000", "-ac", "1", output],
      (err, _stdout, stderr) => {
        if (err) reject(new Error(`ffmpeg convert: ${stderr || err.message}`));
        else resolve();
      },
    );
  });
}

/** Slice a segment from an audio file to MP3 */
export function sliceToMp3(input: string, output: string, startSec: number, endSec: number): Promise<void> {
  const duration = endSec - startSec;
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y",
        "-ss", String(startSec),
        "-t", String(duration),
        "-i", input,
        "-c:a", "libmp3lame",
        "-q:a", "5",
        "-ar", "16000",
        "-ac", "1",
        output,
      ],
      (err, _stdout, stderr) => {
        if (err) reject(new Error(`ffmpeg slice: ${stderr || err.message}`));
        else resolve();
      },
    );
  });
}

/** Format seconds to human-readable string for filenames: 65.3 → "01m05s" */
export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}
