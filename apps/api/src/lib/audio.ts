import fs from "fs";
import { writeFile } from "fs/promises";
import path from "path";

const RECORDINGS_DIR = path.resolve(__dirname, "..", "recordings");

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

function safePath(filename: string): string {
  const resolved = path.resolve(RECORDINGS_DIR, path.basename(filename));
  if (!resolved.startsWith(RECORDINGS_DIR)) {
    throw new Error("Invalid filename");
  }
  return resolved;
}

export async function downloadRecording(url: string, filename: string): Promise<string> {
  const filePath = safePath(filename);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);
  console.log(`[AUDIO] Downloaded ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);
  return filePath;
}

export function getRecordingPath(filename: string): string {
  return safePath(filename);
}

export function recordingExists(filename: string): boolean {
  try {
    return fs.existsSync(safePath(filename));
  } catch {
    return false;
  }
}
