import { describe, it, expect } from "vitest";
import { IngestSchema, DecisionSchema } from "./validation";

describe("ingest validation", () => {
  it("accepts exactly one of sourceText or sourceUrl", () => {
    expect(IngestSchema.safeParse({ sourceText: "hi" }).success).toBe(true);
    expect(IngestSchema.safeParse({ sourceUrl: "https://example.com/a" }).success).toBe(true);
    expect(IngestSchema.safeParse({ sourceText: "" }).success).toBe(false);
    expect(IngestSchema.safeParse({ sourceUrl: "not-a-url" }).success).toBe(false);
    expect(IngestSchema.safeParse({}).success).toBe(false);
    expect(
      IngestSchema.safeParse({ sourceText: "hi", sourceUrl: "https://example.com/a" }).success,
    ).toBe(false);
  });

  it("validates a decision payload", () => {
    expect(DecisionSchema.safeParse({
      candidateId: "00000000-0000-0000-0000-000000000000", decision: "accept",
    }).success).toBe(true);
    expect(DecisionSchema.safeParse({ candidateId: "x", decision: "accept" }).success).toBe(false);
    expect(DecisionSchema.safeParse({
      candidateId: "00000000-0000-0000-0000-000000000000", decision: "publish",
    }).success).toBe(false);
  });
});
