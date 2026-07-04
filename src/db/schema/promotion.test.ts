import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { promotions } from "@/db/schema/promotion";

describe("promotion schema", () => {
  it("defines identity, provenance, and status columns", () => {
    const cols = Object.keys(getTableColumns(promotions));
    for (const c of [
      "id", "slug", "name", "shortName", "status",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
  });
});
