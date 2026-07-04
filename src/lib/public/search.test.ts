import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createAthlete } from "@/lib/athletes/service";
import { search } from "@/lib/public/search";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("search", () => {
  it("matches athletes by name prefix", async () => {
    await seed(ctx.db);
    const r = await search(ctx.db, "gord");
    expect(r.athletes.map((h) => h.title)).toContain("Gordon Ryan");
    expect(r.athletes[0]?.path).toBe("/athlete/gordon-ryan");
  });

  it("matches an athlete by alias and de-dupes", async () => {
    await seed(ctx.db); // Gordon has alias "The King"
    const r = await search(ctx.db, "king");
    const gordon = r.athletes.filter((h) => h.title === "Gordon Ryan");
    expect(gordon).toHaveLength(1);
  });

  it("matches events, teams and promotions", async () => {
    await seed(ctx.db);
    expect((await search(ctx.db, "adcc")).promotions.map((h) => h.title)).toContain("ADCC");
    expect((await search(ctx.db, "adcc")).events.length).toBeGreaterThan(0);
    expect((await search(ctx.db, "new wave")).teams.map((h) => h.title)).toContain("New Wave Jiu-Jitsu");
  });

  it("excludes draft entities", async () => {
    await seed(ctx.db);
    await createAthlete(ctx.db, { fullName: "Zzdraft Person" });
    const r = await search(ctx.db, "zzdraft");
    expect(r.athletes).toHaveLength(0);
  });

  it("returns all-empty groups for a blank query without hitting search", async () => {
    await seed(ctx.db);
    const r = await search(ctx.db, "   ");
    expect(r).toEqual({ athletes: [], events: [], teams: [], promotions: [] });
  });

  it("respects the per-group limit", async () => {
    await seed(ctx.db);
    const r = await search(ctx.db, "a", 1); // 'a:*' matches several athletes
    expect(r.athletes.length).toBeLessThanOrEqual(1);
  });
});
