import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import { getEventPage } from "@/lib/public/event-page";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("getEventPage", () => {
  it("returns the event, promotion, published results and placements", async () => {
    const s = await seed(ctx.db);
    const page = await getEventPage(ctx.db, s.event.slug);
    if (!page) throw new Error("expected a page");
    expect(page.promotion.name).toBe("ADCC");
    expect(page.results).toHaveLength(2); // superfight + bracket final
    const sub = page.results.find((r) => r.method === "SUBMISSION");
    expect(sub?.round).toBe("Final");
    expect(sub?.competitors.map((c) => c.name)).toContain("Nicholas Meregali");
    const sf = page.results.find((r) => r.matchType === "SUPERFIGHT");
    expect(sf?.videos).toHaveLength(1);
    expect(page.placements).toHaveLength(2);
    expect(page.placements.find((p) => p.place === 1)?.athlete.name).toBe("Gordon Ryan");
  });

  it("excludes draft matches from results", async () => {
    const s = await seed(ctx.db);
    await createMatch(ctx.db, {
      eventId: s.event.id, matchType: "SUPERFIGHT", method: "POINTS",
      competitors: [
        { athleteId: s.athletes.gordon.id, outcome: "WON" },
        { athleteId: s.athletes.meregali.id, outcome: "LOST" },
      ],
    }); // draft
    const page = await getEventPage(ctx.db, s.event.slug);
    expect(page?.results).toHaveLength(2);
  });

  it("returns null for a draft event and unknown slug", async () => {
    const s = await seed(ctx.db);
    const draft = await createEvent(ctx.db, {
      promotionId: s.promotion.id, name: "Hidden", startDate: "2024-01-01",
    });
    expect(await getEventPage(ctx.db, draft.slug)).toBeNull();
    expect(await getEventPage(ctx.db, "no-such-event")).toBeNull();
  });
});
