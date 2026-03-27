import fs from "fs";
import path from "path";

const RECORDINGS_DIR = path.join(process.cwd(), "recordings");

// Ensure recordings directory exists
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

/**
 * Write raw mulaw/8kHz audio chunks to a WAV file.
 * WAV header format: RIFF header + fmt chunk (mulaw) + data chunk
 */
export function writeMulawWav(filename: string, chunks: Buffer[]): string {
  const filePath = path.join(RECORDINGS_DIR, filename);
  const audioData = Buffer.concat(chunks);
  const dataSize = audioData.length;

  // WAV header for mulaw encoding
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);                        // ChunkID
  header.writeUInt32LE(36 + dataSize, 4);          // ChunkSize
  header.write("WAVE", 8);                         // Format
  header.write("fmt ", 12);                        // Subchunk1ID
  header.writeUInt32LE(16, 16);                    // Subchunk1Size
  header.writeUInt16LE(7, 20);                     // AudioFormat (7 = mulaw)
  header.writeUInt16LE(1, 22);                     // NumChannels (mono)
  header.writeUInt32LE(8000, 24);                  // SampleRate
  header.writeUInt32LE(8000, 28);                  // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  header.writeUInt16LE(1, 32);                     // BlockAlign
  header.writeUInt16LE(8, 34);                     // BitsPerSample
  header.write("data", 36);                        // Subchunk2ID
  header.writeUInt32LE(dataSize, 40);              // Subchunk2Size

  fs.writeFileSync(filePath, Buffer.concat([header, audioData]));
  console.log(`[AUDIO] Saved ${filename} (${(dataSize / 1024).toFixed(1)}KB, ${(dataSize / 8000).toFixed(1)}s)`);
  return filePath;
}

/**
 * Get path to a recording file
 */
export function getRecordingPath(filename: string): string {
  return path.join(RECORDINGS_DIR, filename);
}

/**
 * Check if a recording file exists
 */
export function recordingExists(filename: string): boolean {
  return fs.existsSync(path.join(RECORDINGS_DIR, filename));
}
