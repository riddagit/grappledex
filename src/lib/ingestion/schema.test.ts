import { describe, it, expect } from "vitest";
import { ExtractionSchema } from "@/lib/ingestion/schema";

const sample = {
  athletes: [
    { localRef: "a1", fullName: "Gordon Ryan", aliases: ["The King"] },
    { localRef: "a2", fullName: "Andre Galvao" },
  ],
  promotions: [{ localRef: "p1", name: "ADCC", shortName: "ADCC" }],
  teams: [{ localRef: "t1", name: "New Wave Jiu-Jitsu", shortName: "New Wave" }],
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
  videos: [
    { localRef: "v1", matchRef: "m1", url: "https://youtu.be/abc", title: "Ryan vs Galvao" },
  ],
  memberships: [
    { localRef: "mb1", athleteRef: "a1", teamRef: "t1", role: "black belt", startDate: "2021-01-01" },
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

  it("parses videos referencing a match", () => {
    const parsed = ExtractionSchema.parse(sample);
    expect(parsed.videos[0]?.matchRef).toBe("m1");
    expect(parsed.videos[0]?.url).toBe("https://youtu.be/abc");
  });

  it("rejects a video with an empty url", () => {
    const bad = structuredClone(sample);
    bad.videos[0]!.url = "";
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it("parses teams and memberships referencing an athlete and team", () => {
    const parsed = ExtractionSchema.parse(sample);
    expect(parsed.teams[0]?.name).toBe("New Wave Jiu-Jitsu");
    expect(parsed.memberships[0]?.athleteRef).toBe("a1");
    expect(parsed.memberships[0]?.teamRef).toBe("t1");
  });

  it("parses a membership with an omitted start date", () => {
    const parsed = ExtractionSchema.parse({
      ...sample,
      memberships: [{ localRef: "mb1", athleteRef: "a1", teamRef: "t1" }],
    });
    expect(parsed.memberships[0]?.startDate).toBeUndefined();
  });
});
