import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createTeam } from "@/lib/teams/service";
import { addMembership } from "@/lib/memberships/service";
import { getTeamPage } from "@/lib/public/team-page";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("getTeamPage", () => {
  it("returns current roster and alumni split by membership end date", async () => {
    const s = await seed(ctx.db); // Gordon is a current New Wave member (no endDate)
    // add a past (alumni) membership for Galvao
    await addMembership(ctx.db, {
      athleteId: s.athletes.galvao.id, teamId: s.team.id, role: "competitor",
      startDate: "2010-01-01", endDate: "2020-12-31", confidence: "CONFIRMED",
    });
    const page = await getTeamPage(ctx.db, s.team.slug);
    if (!page) throw new Error("expected a page");
    expect(page.team.name).toBe("New Wave Jiu-Jitsu");
    expect(page.current.map((m) => m.name)).toEqual(["Gordon Ryan"]);
    expect(page.alumni.map((m) => m.name)).toEqual(["Andre Galvao"]);
  });

  it("returns null for a draft team and unknown slug", async () => {
    const draft = await createTeam(ctx.db, { name: "Hidden Team" });
    expect(await getTeamPage(ctx.db, draft.slug)).toBeNull();
    expect(await getTeamPage(ctx.db, "no-such-team")).toBeNull();
  });
});
