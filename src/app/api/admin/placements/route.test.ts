import { describe, it, expect } from "vitest";
import { AddPlacementSchema } from "@/app/api/admin/placements/validation";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("AddPlacementSchema", () => {
  it("accepts a valid placement", () => {
    const parsed = AddPlacementSchema.parse({
      eventId: uuid, athleteId: uuid, division: "Absolute", place: 1,
    });
    expect(parsed.place).toBe(1);
  });
  it("rejects place outside 1..3", () => {
    expect(() =>
      AddPlacementSchema.parse({ eventId: uuid, athleteId: uuid, division: "Absolute", place: 4 }),
    ).toThrow();
  });
});
