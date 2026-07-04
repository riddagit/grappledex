import { describe, it, expect } from "vitest";
import { CreateTeamSchema } from "@/app/api/admin/teams/validation";

describe("CreateTeamSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = CreateTeamSchema.parse({ name: "New Wave", shortName: "New Wave" });
    expect(parsed.name).toBe("New Wave");
  });
  it("rejects an empty name", () => {
    expect(() => CreateTeamSchema.parse({ name: "" })).toThrow();
  });
});
