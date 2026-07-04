import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { teams } from "@/db/schema/team";

describe("team schema", () => {
  it("defines identity, provenance, and status columns", () => {
    const cols = Object.keys(getTableColumns(teams));
    for (const c of [
      "id", "slug", "name", "shortName", "status",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
  });
});
