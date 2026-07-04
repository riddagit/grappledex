import { describe, it, expect } from "vitest";
import { CreateMembershipSchema } from "@/app/api/admin/memberships/validation";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("CreateMembershipSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = CreateMembershipSchema.parse({
      athleteId: UUID,
      teamId: UUID,
      startDate: "2021-06-01",
    });
    expect(parsed.startDate).toBe("2021-06-01");
  });
  it("rejects a non-uuid athleteId", () => {
    expect(() =>
      CreateMembershipSchema.parse({ athleteId: "nope", teamId: UUID, startDate: "2021-06-01" }),
    ).toThrow();
  });
  it("rejects a malformed startDate", () => {
    expect(() =>
      CreateMembershipSchema.parse({ athleteId: UUID, teamId: UUID, startDate: "June 2021" }),
    ).toThrow();
  });
});
