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

  // WAV header for mulaw encoding (non-PCM requires cbSize extension field)
  const headerSize = 46; // 44 + 2 bytes for cbSize
  const header = Buffer.alloc(headerSize);
  header.write("RIFF", 0);                        // ChunkID
  header.writeUInt32LE(headerSize - 8 + dataSize, 4); // ChunkSize
  header.write("WAVE", 8);                         // Format
  header.write("fmt ", 12);                        // Subchunk1ID
  header.writeUInt32LE(18, 16);                    // Subchunk1Size (18 for non-PCM: 16 + cbSize)
  header.writeUInt16LE(7, 20);                     // AudioFormat (7 = mulaw)
  header.writeUInt16LE(1, 22);                     // NumChannels (mono)
  header.writeUInt32LE(8000, 24);                  // SampleRate
  header.writeUInt32LE(8000, 28);                  // ByteRate
  header.writeUInt16LE(1, 32);                     // BlockAlign
  header.writeUInt16LE(8, 34);                     // BitsPerSample
  header.writeUInt16LE(0, 36);                     // cbSize (no extension data)
  header.write("data", 38);                        // Subchunk2ID
  header.writeUInt32LE(dataSize, 42);              // Subchunk2Size

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
