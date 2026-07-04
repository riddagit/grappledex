import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { athleteTeamMemberships } from "@/db/schema/membership";

describe("athlete_team_membership schema", () => {
  it("defines the temporal link, role, and provenance columns without an independent status", () => {
    const cols = Object.keys(getTableColumns(athleteTeamMemberships));
    for (const c of [
      "id", "athleteId", "teamId", "role", "startDate", "endDate",
      "sourceUrl", "verifiedBy", "verifiedAt", "confidence",
    ]) {
      expect(cols).toContain(c);
    }
    expect(cols).not.toContain("status");
  });
});
