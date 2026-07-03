import { describe, it, expect } from "vitest";
import { athletes, athleteAliases } from "@/db/schema/athlete";
import { getTableColumns } from "drizzle-orm";

describe("athlete schema", () => {
  it("defines the provenance and status columns on athletes", () => {
    const cols = Object.keys(getTableColumns(athletes));
    for (const c of [
      "id", "slug", "fullName", "status",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
  });

  it("links aliases to an athlete", () => {
    const cols = Object.keys(getTableColumns(athleteAliases));
    expect(cols).toContain("athleteId");
    expect(cols).toContain("alias");
  });
});
