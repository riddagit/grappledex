import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createAthlete } from "@/lib/athletes/service";
import { createMatch } from "@/lib/matches/service";
import { getAthletePage } from "@/lib/public/athlete-page";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("getAthletePage", () => {
  it("assembles record, derived stats, history and related lists for a published athlete", async () => {
    const s = await seed(ctx.db);
    const page = await getAthletePage(ctx.db, "gordon-ryan");
    if (!page) throw new Error("expected a page");

    // record over published matches: 2 wins (1 by submission), 0 losses
    expect(page.record.wins).toBe(2);
    expect(page.record.losses).toBe(0);
    expect(page.record.submissionWins).toBe(1);

    // finish rate = submission wins / wins
    expect(page.finishRate).toBeCloseTo(0.5);

    // match history: both matches, each with a named opponent
    expect(page.matchHistory).toHaveLength(2);
    const opponents = page.matchHistory.flatMap((m) => m.opponents.map((o) => o.name));
    expect(opponents).toContain("Andre Galvao");
    expect(opponents).toContain("Nicholas Meregali");

    // each match-history row carries its own watch links; the seeded superfight
    // (Gordon vs Galvao) has a video, the bracket final does not.
    const withVideo = page.matchHistory.filter((m) => m.videos.length > 0);
    expect(withVideo).toHaveLength(1);
    expect(withVideo[0]?.videos[0]?.url).toContain("youtube.com");

    // related lists
    expect(page.placements).toHaveLength(1);
    expect(page.teamTimeline).toHaveLength(1);
    expect(page.teamTimeline[0]?.teamName).toBe("New Wave Jiu-Jitsu");
    expect(page.videos).toHaveLength(1);
    expect(page.instructionals).toHaveLength(1);

    // no rivalries yet (each opponent faced once)
    expect(page.rivalries).toHaveLength(0);
    // seed handle sanity
    expect(page.athlete.id).toBe(s.athletes.gordon.id);
  });

  it("returns null for a draft (unpublished) athlete", async () => {
    const draft = await createAthlete(ctx.db, { fullName: "Hidden Person" });
    expect(draft.status).toBe("draft");
    expect(await getAthletePage(ctx.db, draft.slug)).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    await seed(ctx.db);
    expect(await getAthletePage(ctx.db, "no-such-athlete")).toBeNull();
  });

  it("excludes draft matches from history and record", async () => {
    const s = await seed(ctx.db);
    // a draft match (default status) must not leak into the public page
    await createMatch(ctx.db, {
      eventId: s.event.id,
      matchType: "SUPERFIGHT",
      method: "POINTS",
      competitors: [
        { athleteId: s.athletes.gordon.id, outcome: "WON" },
        { athleteId: s.athletes.galvao.id, outcome: "LOST" },
      ],
    });
    const page = await getAthletePage(ctx.db, "gordon-ryan");
    expect(page?.matchHistory).toHaveLength(2);
    expect(page?.record.wins).toBe(2);
  });

  it("detects a rivalry when an opponent is faced twice (published)", async () => {
    const s = await seed(ctx.db);
    await createMatch(ctx.db, {
      eventId: s.event.id,
      matchType: "SUPERFIGHT",
      method: "SUBMISSION",
      status: "published",
      competitors: [
        { athleteId: s.athletes.gordon.id, outcome: "WON" },
        { athleteId: s.athletes.galvao.id, outcome: "LOST" },
      ],
    });
    const page = await getAthletePage(ctx.db, "gordon-ryan");
    expect(page?.rivalries).toHaveLength(1);
    expect(page?.rivalries[0]?.opponent.name).toBe("Andre Galvao");
    expect(page?.rivalries[0]?.meetings).toBe(2);
  });
});
