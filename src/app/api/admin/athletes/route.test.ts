import { describe, it, expect } from "vitest";
import { CreateAthleteSchema } from "@/app/api/admin/athletes/validation";

describe("CreateAthleteSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = CreateAthleteSchema.parse({
      fullName: "Gordon Ryan",
      confidence: "CONFIRMED",
    });
    expect(parsed.fullName).toBe("Gordon Ryan");
  });
  it("rejects an empty name", () => {
    expect(() => CreateAthleteSchema.parse({ fullName: "" })).toThrow();
  });
  it("rejects an unknown confidence value", () => {
    expect(() =>
      CreateAthleteSchema.parse({ fullName: "X", confidence: "MAYBE" }),
    ).toThrow();
  });
});
