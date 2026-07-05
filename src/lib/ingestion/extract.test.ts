import { describe, it, expect } from "vitest";
import { FakeExtractor, EXTRACTION_SYSTEM_PROMPT, type Extractor } from "@/lib/ingestion/extract";
import { ExtractionSchema, type CandidateGraph } from "@/lib/ingestion/schema";

const graph: CandidateGraph = {
  athletes: [{ localRef: "a1", fullName: "Gordon Ryan" }],
  promotions: [{ localRef: "p1", name: "ADCC" }],
  events: [{ localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" }],
  matches: [{
    localRef: "m1", eventRef: "e1", matchType: "SUPERFIGHT", method: "DECISION",
    competitors: [{ athleteRef: "a1", outcome: "WON" }],
  }],
  placements: [],
};

describe("FakeExtractor", () => {
  it("returns the preset graph and satisfies the Extractor interface", async () => {
    const extractor: Extractor = new FakeExtractor(graph);
    const out = await extractor.extract("ignored text");
    expect(ExtractionSchema.parse(out)).toEqual(graph);
  });
});

describe("EXTRACTION_SYSTEM_PROMPT", () => {
  it("instructs the model to emit placements", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/placement/i);
  });
});
