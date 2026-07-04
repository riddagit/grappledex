import { describe, it, expect } from "vitest";
import { CreateMatchSchema } from "@/app/api/admin/matches/validation";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("CreateMatchSchema", () => {
  it("accepts a valid two-competitor match", () => {
    const parsed = CreateMatchSchema.parse({
      eventId: uuid,
      matchType: "SUPERFIGHT",
      method: "SUBMISSION",
      methodDetail: "RNC",
      competitors: [
        { athleteId: uuid, outcome: "WON" },
        { athleteId: uuid, outcome: "LOST" },
      ],
    });
    expect(parsed.competitors).toHaveLength(2);
  });
  it("requires at least two competitors", () => {
    expect(() =>
      CreateMatchSchema.parse({
        eventId: uuid, matchType: "SUPERFIGHT", method: "POINTS",
        competitors: [{ athleteId: uuid, outcome: "WON" }],
      }),
    ).toThrow();
  });
  it("rejects an unknown method", () => {
    expect(() =>
      CreateMatchSchema.parse({
        eventId: uuid, matchType: "SUPERFIGHT", method: "MAGIC",
        competitors: [
          { athleteId: uuid, outcome: "WON" },
          { athleteId: uuid, outcome: "LOST" },
        ],
      }),
    ).toThrow();
  });
});
