import { describe, expect, it } from "vitest";
import { ExtractionSchema, buildExtractPrompt } from "./extract";

describe("buildExtractPrompt", () => {
  it("numbers each chunk and includes its content", () => {
    const prompt = buildExtractPrompt([{ content: "alpha" }, { content: "beta" }]);
    expect(prompt).toContain("chunk 1");
    expect(prompt).toContain("alpha");
    expect(prompt).toContain("chunk 2");
    expect(prompt).toContain("beta");
  });
});

describe("ExtractionSchema", () => {
  it("accepts a well-formed extraction", () => {
    const parsed = ExtractionSchema.safeParse({
      entities: [{ name: "Neon", type: "organization", description: "serverless pg" }],
      relationships: [{ from: "Neon", to: "Postgres", relation: "is a kind of" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown entity type", () => {
    const parsed = ExtractionSchema.safeParse({
      entities: [{ name: "X", type: "spaceship" }],
      relationships: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("requires the entities and relationships arrays", () => {
    expect(ExtractionSchema.safeParse({}).success).toBe(false);
  });
});
