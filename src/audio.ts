import fs from "fs";
import path from "path";

const RECORDINGS_DIR = path.join(process.cwd(), "recordings");

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

export async function downloadRecording(url: string, filename: string): Promise<string> {
  const filePath = path.join(RECORDINGS_DIR, filename);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  console.log(`[AUDIO] Downloaded ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);
  return filePath;
}

export function getRecordingPath(filename: string): string {
  return path.join(RECORDINGS_DIR, filename);
}

export function recordingExists(filename: string): boolean {
  return fs.existsSync(path.join(RECORDINGS_DIR, filename));
}
