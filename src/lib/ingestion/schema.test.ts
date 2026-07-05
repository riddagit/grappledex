import { describe, it, expect } from "vitest";
import { ExtractionSchema } from "@/lib/ingestion/schema";

const sample = {
  athletes: [
    { localRef: "a1", fullName: "Gordon Ryan", aliases: ["The King"] },
    { localRef: "a2", fullName: "Andre Galvao" },
  ],
  promotions: [{ localRef: "p1", name: "ADCC", shortName: "ADCC" }],
  events: [
    { localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" },
  ],
  matches: [
    {
      localRef: "m1", eventRef: "e1", matchType: "SUPERFIGHT", method: "DECISION",
      competitors: [
        { athleteRef: "a1", outcome: "WON", slotOrder: 1 },
        { athleteRef: "a2", outcome: "LOST", slotOrder: 2 },
      ],
    },
  ],
  placements: [
    { localRef: "pl1", eventRef: "e1", athleteRef: "a1", division: "Absolute", place: 1 },
  ],
};

describe("ExtractionSchema", () => {
  it("parses a valid candidate graph with refs", () => {
    const parsed = ExtractionSchema.parse(sample);
    expect(parsed.matches[0]?.competitors[0]?.athleteRef).toBe("a1");
    expect(parsed.events[0]?.promotionRef).toBe("p1");
  });

  it("rejects a match with an invalid method", () => {
    const bad = structuredClone(sample);
    // @ts-expect-error deliberately invalid enum
    bad.matches[0].method = "KIMURA";
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a candidate missing localRef", () => {
    const bad = structuredClone(sample);
    // @ts-expect-error deliberately missing required field
    delete bad.athletes[0].localRef;
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it("parses placements referencing event and athlete", () => {
    const parsed = ExtractionSchema.parse(sample);
    expect(parsed.placements[0]?.athleteRef).toBe("a1");
    expect(parsed.placements[0]?.place).toBe(1);
  });

  it("rejects a placement with a non-positive place", () => {
    const bad = structuredClone(sample);
    bad.placements[0]!.place = 0;
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
  });
});
