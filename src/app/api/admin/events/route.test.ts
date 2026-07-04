import { describe, it, expect } from "vitest";
import { CreateEventSchema } from "@/app/api/admin/events/route";

describe("CreateEventSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = CreateEventSchema.parse({
      promotionId: "11111111-1111-4111-8111-111111111111",
      name: "ADCC 2022",
      startDate: "2022-09-17",
    });
    expect(parsed.name).toBe("ADCC 2022");
  });
  it("rejects a non-uuid promotionId", () => {
    expect(() =>
      CreateEventSchema.parse({ promotionId: "nope", name: "X", startDate: "2022-09-17" }),
    ).toThrow();
  });
  it("rejects a malformed date", () => {
    expect(() =>
      CreateEventSchema.parse({
        promotionId: "11111111-1111-4111-8111-111111111111",
        name: "X",
        startDate: "Sept 17",
      }),
    ).toThrow();
  });
});
