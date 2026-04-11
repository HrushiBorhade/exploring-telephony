import { describe, it, expect } from "vitest";
import { mergeChunkSegments } from "../src/lib/gemini";
import type { Segment } from "../src/lib/gemini";

const seg = (start: number, end: number, content: string): Segment => ({
  startSeconds: start,
  endSeconds: end,
  content,
  language: "en",
  emotion: "neutral",
});

describe("mergeChunkSegments", () => {
  it("returns segments unchanged for a single chunk", () => {
    const result = mergeChunkSegments([
      {
        offsetSeconds: 0,
        durationSeconds: 60,
        segments: [seg(2, 5, "hello"), seg(10, 15, "world")],
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].startSeconds).toBe(2);
    expect(result[1].startSeconds).toBe(10);
  });

  it("offsets timestamps by chunk offset", () => {
    const result = mergeChunkSegments([
      {
        offsetSeconds: 0,
        durationSeconds: 30,
        segments: [seg(5, 10, "first chunk")],
      },
      {
        offsetSeconds: 25,
        durationSeconds: 30,
        segments: [seg(8, 12, "second chunk")],
      },
    ]);

    expect(result[0].startSeconds).toBe(5);     // 0 + 5
    expect(result[0].content).toBe("first chunk");
    expect(result[1].startSeconds).toBe(33);    // 25 + 8
    expect(result[1].content).toBe("second chunk");
  });

  it("deduplicates segments in overlap region", () => {
    // Chunk 0: 0-30s, chunk 1: 25-55s → overlap 25-30s
    const result = mergeChunkSegments([
      {
        offsetSeconds: 0,
        durationSeconds: 30,
        segments: [seg(5, 8, "early"), seg(26, 29, "overlap from chunk 0")],
      },
      {
        offsetSeconds: 25,
        durationSeconds: 30,
        segments: [seg(1, 4, "overlap from chunk 1"), seg(10, 15, "after overlap")],
      },
    ]);

    // "early" at 5s — kept
    // "overlap from chunk 0" at 26s — kept (chunk 0 owns it)
    // "overlap from chunk 1" at 26s — dropped (26 < 30, inside overlap)
    // "after overlap" at 35s — kept (35 >= 30)
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("early");
    expect(result[1].content).toBe("overlap from chunk 0");
    expect(result[2].content).toBe("after overlap");
    expect(result[2].startSeconds).toBe(35);
  });

  it("sorts merged segments by startSeconds", () => {
    const result = mergeChunkSegments([
      {
        offsetSeconds: 0,
        durationSeconds: 30,
        segments: [seg(20, 25, "later"), seg(2, 5, "earlier")],
      },
    ]);

    expect(result[0].content).toBe("earlier");
    expect(result[1].content).toBe("later");
  });

  it("handles empty chunk results", () => {
    const result = mergeChunkSegments([
      { offsetSeconds: 0, durationSeconds: 30, segments: [] },
      { offsetSeconds: 25, durationSeconds: 30, segments: [] },
    ]);

    expect(result).toHaveLength(0);
  });

  it("handles three chunks with correct dedup", () => {
    // Chunk 0: 0-600s, chunk 1: 585-1200s, chunk 2: 1185-1800s
    const result = mergeChunkSegments([
      {
        offsetSeconds: 0,
        durationSeconds: 600,
        segments: [seg(10, 20, "start"), seg(590, 599, "end of chunk 0")],
      },
      {
        offsetSeconds: 585,
        durationSeconds: 615,
        segments: [seg(5, 14, "overlap with 0"), seg(20, 30, "middle"), seg(610, 614, "end of chunk 1")],
      },
      {
        offsetSeconds: 1185,
        durationSeconds: 615,
        segments: [seg(5, 14, "overlap with 1"), seg(20, 30, "final")],
      },
    ]);

    // chunk 0: "start" at 10, "end of chunk 0" at 590 — both kept
    // chunk 1: "overlap with 0" at 590 — dropped (590 < 600)
    //          "middle" at 605 — kept (605 >= 600)
    //          "end of chunk 1" at 1195 — kept
    // chunk 2: "overlap with 1" at 1190 — dropped (1190 < 1200)
    //          "final" at 1205 — kept (1205 >= 1200)
    expect(result).toHaveLength(5);
    expect(result.map((s) => s.content)).toEqual([
      "start",
      "end of chunk 0",
      "middle",
      "end of chunk 1",
      "final",
    ]);
  });
});
