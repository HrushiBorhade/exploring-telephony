import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { convertToMp3, sliceMp3, formatTimestamp, splitIntoChunks } from "../src/lib/ffmpeg";

const execFileAsync = promisify(execFile);

let tmpDir: string;

// Generate a silent WAV for testing (hardcoded args, no user input)
async function createTestWav(filePath: string, durationSec: number): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
    "-t", String(durationSec), "-c:a", "pcm_s16le", filePath,
  ]);
}

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "ffmpeg-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true }).catch(() => {});
});

describe("formatTimestamp", () => {
  it("formats 0 seconds", () => {
    expect(formatTimestamp(0)).toBe("00m00s");
  });

  it("formats seconds < 60", () => {
    expect(formatTimestamp(5.3)).toBe("00m05s");
    expect(formatTimestamp(45)).toBe("00m45s");
  });

  it("formats minutes + seconds", () => {
    expect(formatTimestamp(65)).toBe("01m05s");
    expect(formatTimestamp(125.7)).toBe("02m05s");
  });
});

describe("convertToMp3", () => {
  it("converts WAV to MP3", async () => {
    const wavPath = path.join(tmpDir, "test.wav");
    const mp3Path = path.join(tmpDir, "test.mp3");

    await createTestWav(wavPath, 2);
    await convertToMp3(wavPath, mp3Path);

    const mp3Data = await readFile(mp3Path);
    expect(mp3Data.length).toBeGreaterThan(0);

    // Verify MP3 header (ID3 tag or MPEG sync byte)
    const header = mp3Data.subarray(0, 3).toString("ascii");
    expect(header === "ID3" || mp3Data[0] === 0xff).toBe(true);
  });
});

describe("sliceMp3", () => {
  it("slices a segment from MP3 with -c copy", async () => {
    const wavPath = path.join(tmpDir, "full-for-slice.wav");
    const mp3Path = path.join(tmpDir, "full.mp3");
    const clipPath = path.join(tmpDir, "clip.mp3");

    await createTestWav(wavPath, 5);
    await convertToMp3(wavPath, mp3Path);
    await sliceMp3(mp3Path, clipPath, 1, 3);

    const clipData = await readFile(clipPath);
    expect(clipData.length).toBeGreaterThan(0);
  });
});

describe("splitIntoChunks", () => {
  it("returns single chunk for short audio", async () => {
    const wavPath = path.join(tmpDir, "short.wav");
    await createTestWav(wavPath, 30);

    const chunks = await splitIntoChunks(wavPath, tmpDir, {
      chunkDuration: 600,
      overlapDuration: 15,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].offsetSeconds).toBe(0);
    expect(chunks[0].filePath).toBe(wavPath);
  });

  it("splits long audio into overlapping chunks", async () => {
    const wavPath = path.join(tmpDir, "long.wav");
    const mp3Path = path.join(tmpDir, "long.mp3");
    await createTestWav(wavPath, 65);
    await convertToMp3(wavPath, mp3Path);

    const chunks = await splitIntoChunks(mp3Path, tmpDir, {
      chunkDuration: 30,
      overlapDuration: 5,
    });

    // 65s with 30s chunks, 5s overlap (step=25):
    // chunk 0: 0-30s, chunk 1: 25-55s, chunk 2: 50-65s
    expect(chunks).toHaveLength(3);
    expect(chunks[0].offsetSeconds).toBe(0);
    expect(chunks[1].offsetSeconds).toBe(25);
    expect(chunks[2].offsetSeconds).toBe(50);

    for (const chunk of chunks) {
      const data = await readFile(chunk.filePath);
      expect(data.length).toBeGreaterThan(0);
    }
  });

  it("handles audio exactly at chunk boundary", async () => {
    const wavPath = path.join(tmpDir, "exact.wav");
    await createTestWav(wavPath, 30);

    const chunks = await splitIntoChunks(wavPath, tmpDir, {
      chunkDuration: 30,
      overlapDuration: 5,
    });

    expect(chunks).toHaveLength(1);
  });
});
