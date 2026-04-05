import { describe, it, expect } from "vitest";
import { generateDatasetCsv } from "../src/lib/csv";
import type { Segment } from "../src/lib/gemini";

describe("generateDatasetCsv", () => {
  const segA: Segment[] = [
    { startSeconds: 0.5, endSeconds: 2.3, content: "Hello how are you", language: "en", emotion: "neutral" },
    { startSeconds: 5.0, endSeconds: 8.1, content: "I'm calling about the order", language: "en", emotion: "neutral" },
  ];

  const segB: Segment[] = [
    { startSeconds: 1.0, endSeconds: 3.5, content: "I'm good thanks", language: "en", emotion: "happy" },
  ];

  it("generates valid CSV with headers", () => {
    const csv = generateDatasetCsv(
      "abc123",
      { segments: segA, clipUrls: ["https://s3/clip-a-0.mp3", "https://s3/clip-a-1.mp3"], trackUrl: "https://s3/a-full.mp3" },
      { segments: segB, clipUrls: ["https://s3/clip-b-0.mp3"], trackUrl: "https://s3/b-full.mp3" },
    );

    const lines = csv.trim().split("\n");

    // Header row
    expect(lines[0]).toContain("utterance_text");
    expect(lines[0]).toContain("audio_clip_url");
    expect(lines[0]).toContain("participant");
    expect(lines[0]).toContain("emotion");
    expect(lines[0]).toContain("capture_id");

    // 2 rows for participant A + 1 row for participant B = 3 data rows
    expect(lines.length).toBe(4); // 1 header + 3 data
  });

  it("includes correct participant tags", () => {
    const csv = generateDatasetCsv(
      "test1",
      { segments: segA, clipUrls: ["url1", "url2"], trackUrl: "trackA" },
      { segments: segB, clipUrls: ["url3"], trackUrl: "trackB" },
    );

    expect(csv).toContain("participant_a");
    expect(csv).toContain("participant_b");
  });

  it("formats timestamps as MM:SS", () => {
    const csv = generateDatasetCsv(
      "test2",
      { segments: segA, clipUrls: ["", ""], trackUrl: "" },
      { segments: segB, clipUrls: [""], trackUrl: "" },
    );

    // 0.5s → 00:00, 2.3s → 00:02
    expect(csv).toContain("00:00");
    expect(csv).toContain("00:02");
  });

  it("escapes commas in utterance text", () => {
    const segWithComma: Segment[] = [
      { startSeconds: 0, endSeconds: 1, content: "Hello, world", language: "en", emotion: "happy" },
    ];

    const csv = generateDatasetCsv(
      "test3",
      { segments: segWithComma, clipUrls: ["url"], trackUrl: "track" },
      { segments: [], clipUrls: [], trackUrl: "" },
    );

    // csv-stringify should quote the field
    expect(csv).toContain('"Hello, world"');
  });

  it("handles empty segments", () => {
    const csv = generateDatasetCsv(
      "empty",
      { segments: [], clipUrls: [], trackUrl: "" },
      { segments: [], clipUrls: [], trackUrl: "" },
    );

    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(1); // Header only
  });
});
