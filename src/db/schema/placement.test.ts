import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { placements } from "@/db/schema/placement";

describe("placement schema", () => {
  it("defines medal columns and provenance, without an independent status", () => {
    const cols = Object.keys(getTableColumns(placements));
    for (const c of [
      "id", "eventId", "athleteId", "division", "place",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
    expect(cols).not.toContain("status");
  });
});
