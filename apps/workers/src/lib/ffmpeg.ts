import { execFile } from "child_process";

/** Run an ffmpeg/ffprobe command and return stdout */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd}: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

const MP3_OPTS = ["-c:a", "libmp3lame", "-q:a", "5", "-ar", "16000", "-ac", "1"];

/** Convert any audio file to MP3 (16kHz mono, good for speech) */
export function convertToMp3(input: string, output: string): Promise<void> {
  return run("ffmpeg", ["-y", "-i", input, ...MP3_OPTS, output]).then(() => {});
}

/** Slice a segment from an audio file to MP3 */
export function sliceToMp3(input: string, output: string, startSec: number, endSec: number): Promise<void> {
  const duration = endSec - startSec;
  return run("ffmpeg", [
    "-y", "-ss", String(startSec), "-t", String(duration), "-i", input, ...MP3_OPTS, output,
  ]).then(() => {});
}

/** Get audio duration in seconds using ffprobe */
export function getDuration(input: string): Promise<number> {
  return run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input,
  ]).then((stdout) => parseFloat(stdout.trim()));
}

/** Trim audio from the start -- skip `trimSec` seconds, keep the rest */
export function trimStart(input: string, output: string, trimSec: number): Promise<void> {
  return run("ffmpeg", ["-y", "-ss", String(trimSec), "-i", input, ...MP3_OPTS, output]).then(() => {});
}

/** Format seconds to human-readable string for filenames: 65.3 -> "01m05s" */
export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}
