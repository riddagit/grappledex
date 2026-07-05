import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createTeam, searchTeams, getTeam } from "@/lib/teams/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("createTeam", () => {
  it("creates a team with a derived slug and stamps verification", async () => {
    const t = await createTeam(ctx.db, {
      name: "New Wave Jiu-Jitsu",
      shortName: "New Wave",
      verifiedBy: "editor@rollvault",
      confidence: "CONFIRMED",
    });
    expect(t.slug).toBe("new-wave-jiu-jitsu");
    expect(t.shortName).toBe("New Wave");
    expect(t.confidence).toBe("CONFIRMED");
    expect(t.verifiedAt).not.toBeNull();
    expect(t.status).toBe("draft");
  });

  it("disambiguates slug collisions", async () => {
    const a = await createTeam(ctx.db, { name: "Atos" });
    const b = await createTeam(ctx.db, { name: "Atos" });
    expect(a.slug).toBe("atos");
    expect(b.slug).toBe("atos-2");
  });
});

describe("searchTeams / getTeam", () => {
  it("finds by case-insensitive substring and fetches by id", async () => {
    const t = await createTeam(ctx.db, { name: "Danaher Death Squad", shortName: "DDS" });
    const rows = await searchTeams(ctx.db, "death");
    expect(rows[0]?.name).toBe("Danaher Death Squad");
    const fetched = await getTeam(ctx.db, t.id);
    expect(fetched?.name).toBe("Danaher Death Squad");
    expect(await getTeam(ctx.db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
