import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createAthlete } from "@/lib/athletes/service";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import { listPublicUrls } from "@/lib/public/sitemap";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("listPublicUrls", () => {
  it("lists the landing page plus every published entity and match", async () => {
    const s = await seed(ctx.db);
    const paths = (await listPublicUrls(ctx.db)).map((u) => u.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/athlete/gordon-ryan");
    expect(paths).toContain(`/event/${s.event.slug}`);
    expect(paths).toContain(`/promotion/${s.promotion.slug}`);
    expect(paths).toContain(`/team/${s.team.slug}`);
    expect(paths).toContain(`/match/${s.matches.superfight.id}`);
    expect(paths).toContain(`/match/${s.matches.final.id}`);
  });

  it("carries a lastModified for entity URLs", async () => {
    await seed(ctx.db);
    const gordon = (await listPublicUrls(ctx.db)).find((u) => u.path === "/athlete/gordon-ryan");
    expect(gordon?.lastModified).toBeInstanceOf(Date);
  });

  it("excludes draft entities", async () => {
    await seed(ctx.db);
    const draft = await createAthlete(ctx.db, { fullName: "Hidden Person" });
    const paths = (await listPublicUrls(ctx.db)).map((u) => u.path);
    expect(paths).not.toContain(`/athlete/${draft.slug}`);
  });

  it("excludes a published match whose event is draft", async () => {
    const s = await seed(ctx.db);
    const draftEvent = await createEvent(ctx.db, {
      promotionId: s.promotion.id, name: "Hidden Card", startDate: "2024-01-01",
    });
    const match = await createMatch(ctx.db, {
      eventId: draftEvent.id, matchType: "SUPERFIGHT", method: "POINTS",
      status: "published",
      competitors: [
        { athleteId: s.athletes.gordon.id, outcome: "WON" },
        { athleteId: s.athletes.galvao.id, outcome: "LOST" },
      ],
    });
    const paths = (await listPublicUrls(ctx.db)).map((u) => u.path);
    expect(paths).not.toContain(`/match/${match.id}`);
  });
});
