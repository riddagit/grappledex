import { describe, it, expect } from "vitest";
import { IngestSchema, DecisionSchema } from "./validation";

describe("ingest validation", () => {
  it("accepts a paste with text and rejects empty text", () => {
    expect(IngestSchema.safeParse({ sourceText: "hi" }).success).toBe(true);
    expect(IngestSchema.safeParse({ sourceText: "" }).success).toBe(false);
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
