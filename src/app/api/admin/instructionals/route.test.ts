import { describe, it, expect } from "vitest";
import { AddInstructionalSchema } from "@/app/api/admin/instructionals/validation";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("AddInstructionalSchema", () => {
  it("accepts a valid instructional", () => {
    const parsed = AddInstructionalSchema.parse({
      athleteId: uuid,
      title: "Systematically Attacking the Guard",
      affiliateUrl: "https://bjjfanatics.com/products/x",
    });
    expect(parsed.title).toBe("Systematically Attacking the Guard");
  });
  it("rejects an empty title", () => {
    expect(() =>
      AddInstructionalSchema.parse({
        athleteId: uuid, title: "", affiliateUrl: "https://bjjfanatics.com/products/x",
      }),
    ).toThrow();
  });
  it("rejects a malformed affiliateUrl", () => {
    expect(() =>
      AddInstructionalSchema.parse({ athleteId: uuid, title: "X", affiliateUrl: "nope" }),
    ).toThrow();
  });
  it("rejects a non-uuid athleteId", () => {
    expect(() =>
      AddInstructionalSchema.parse({
        athleteId: "nope", title: "X", affiliateUrl: "https://bjjfanatics.com/products/x",
      }),
    ).toThrow();
  });
});
