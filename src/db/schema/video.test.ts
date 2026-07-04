import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { videos } from "@/db/schema/video";

describe("video schema", () => {
  it("defines the youtube link + provenance columns, without an independent status", () => {
    const cols = Object.keys(getTableColumns(videos));
    for (const c of [
      "id", "matchId", "url", "title",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
    expect(cols).not.toContain("status");
  });
});
