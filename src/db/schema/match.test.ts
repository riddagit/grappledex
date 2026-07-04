import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { matches, matchCompetitors } from "@/db/schema/match";

describe("match schema", () => {
  it("defines shared match facts and provenance", () => {
    const cols = Object.keys(getTableColumns(matches));
    for (const c of [
      "id", "eventId", "matchType", "round", "weightClass", "ruleset",
      "method", "methodDetail", "durationSeconds", "status",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
  });

  it("defines the competitor join columns", () => {
    const cols = Object.keys(getTableColumns(matchCompetitors));
    for (const c of ["id", "matchId", "athleteId", "outcome", "slotOrder"]) {
      expect(cols).toContain(c);
    }
  });
});
