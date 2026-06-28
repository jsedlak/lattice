import { describe, expect, it } from "vitest";
import { approxTokens, chunkText } from "./chunk";

describe("chunkText", () => {
  it("returns no chunks for empty/whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps a small document as a single chunk", () => {
    const chunks = chunkText("A short note.\n\nWith two paragraphs.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.ordinal).toBe(0);
    expect(chunks[0]!.content).toContain("short note");
  });

  it("splits a long document into multiple ordered chunks", () => {
    const para = "word ".repeat(200).trim(); // ~1000 chars
    const text = Array.from({ length: 6 }, () => para).join("\n\n");
    const chunks = chunkText(text, { targetTokens: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i));
  });

  it("hard-splits a single oversized block", () => {
    const huge = "x".repeat(10_000);
    const chunks = chunkText(huge, { targetTokens: 100 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("approxTokens scales with length", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("a".repeat(400))).toBe(100);
  });
});
