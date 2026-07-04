import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createMatch } from "@/lib/matches/service";
import { getMatchPage } from "@/lib/public/match-page";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("getMatchPage", () => {
  it("returns a published match with competitors (slot-ordered), event and videos", async () => {
    const s = await seed(ctx.db);
    const page = await getMatchPage(ctx.db, s.matches.superfight.id);
    if (!page) throw new Error("expected a page");
    expect(page.match.method).toBe("DECISION");
    expect(page.event.slug).toBe(s.event.slug);
    expect(page.competitors.map((c) => c.name)).toEqual(["Gordon Ryan", "Andre Galvao"]);
    expect(page.competitors[0]?.outcome).toBe("WON");
    expect(page.videos).toHaveLength(1);
    expect(page.videos[0]?.url).toContain("youtube.com");
  });

  it("returns null for a draft match", async () => {
    const s = await seed(ctx.db);
    const draft = await createMatch(ctx.db, {
      eventId: s.event.id, matchType: "SUPERFIGHT", method: "POINTS",
      competitors: [
        { athleteId: s.athletes.gordon.id, outcome: "WON" },
        { athleteId: s.athletes.galvao.id, outcome: "LOST" },
      ],
    });
    expect(await getMatchPage(ctx.db, draft.id)).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    await seed(ctx.db);
    expect(
      await getMatchPage(ctx.db, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});
