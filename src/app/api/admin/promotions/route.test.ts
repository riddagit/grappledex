import { describe, it, expect } from "vitest";
import { CreatePromotionSchema } from "@/app/api/admin/promotions/route";

describe("CreatePromotionSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = CreatePromotionSchema.parse({ name: "ADCC", shortName: "ADCC" });
    expect(parsed.name).toBe("ADCC");
  });
  it("rejects an empty name", () => {
    expect(() => CreatePromotionSchema.parse({ name: "" })).toThrow();
  });
});
