import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { instructionals } from "@/db/schema/instructional";

describe("instructional schema", () => {
  it("defines affiliate-card + provenance columns, without an independent status", () => {
    const cols = Object.keys(getTableColumns(instructionals));
    for (const c of [
      "id", "athleteId", "title", "affiliateUrl", "thumbnailUrl",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
    expect(cols).not.toContain("status");
  });
});
