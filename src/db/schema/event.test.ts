import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { events } from "@/db/schema/event";

describe("event schema", () => {
  it("defines identity, promotion link, dates, and provenance columns", () => {
    const cols = Object.keys(getTableColumns(events));
    for (const c of [
      "id", "slug", "promotionId", "name", "startDate", "endDate",
      "venue", "location", "status", "sourceUrl", "verifiedBy",
      "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
  });
});
