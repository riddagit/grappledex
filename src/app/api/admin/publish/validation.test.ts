import { describe, it, expect } from "vitest";
import { PublishRequestSchema } from "@/app/api/admin/publish/validation";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("PublishRequestSchema", () => {
  it("accepts scope=all", () => {
    expect(PublishRequestSchema.parse({ scope: "all" }).scope).toBe("all");
  });
  it("accepts scope=athlete with a uuid", () => {
    const p = PublishRequestSchema.parse({ scope: "athlete", athleteId: uuid });
    expect(p).toEqual({ scope: "athlete", athleteId: uuid });
  });
  it("rejects scope=athlete without an athleteId", () => {
    expect(() => PublishRequestSchema.parse({ scope: "athlete" })).toThrow();
  });
  it("rejects an unknown scope", () => {
    expect(() => PublishRequestSchema.parse({ scope: "everything" })).toThrow();
  });
});
