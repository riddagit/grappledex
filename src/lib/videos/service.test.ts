import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import {
  addVideo, listVideosForMatch, listVideosForEvent, listVideosForAthlete,
} from "@/lib/videos/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seedMatch() {
  const p = await createPromotion(ctx.db, { name: "ADCC" });
  const event = await createEvent(ctx.db, {
    promotionId: p.id, name: "ADCC 2022", startDate: "2022-09-17",
  });
  const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
  const andre = await createAthlete(ctx.db, { fullName: "Andre Galvao" });
  const match = await createMatch(ctx.db, {
    eventId: event.id,
    matchType: "SUPERFIGHT",
    method: "SUBMISSION",
    competitors: [
      { athleteId: gordon.id, outcome: "WON" },
      { athleteId: andre.id, outcome: "LOST" },
    ],
  });
  return { event, match, gordon, andre };
}

describe("addVideo", () => {
  it("attaches a youtube link to a match and lists it", async () => {
    const { match } = await seedMatch();
    const v = await addVideo(ctx.db, {
      matchId: match.id,
      url: "https://youtu.be/abc123",
      title: "Gordon vs Andre",
    });
    expect(v.url).toBe("https://youtu.be/abc123");
    const forMatch = await listVideosForMatch(ctx.db, match.id);
    expect(forMatch).toHaveLength(1);
  });

  it("rejects a duplicate (matchId, url) video", async () => {
    const { match } = await seedMatch();
    await addVideo(ctx.db, { matchId: match.id, url: "https://youtu.be/dup" });
    await expect(
      addVideo(ctx.db, { matchId: match.id, url: "https://youtu.be/dup" }),
    ).rejects.toThrow();
  });

  it("stamps verifiedAt when verifiedBy is supplied", async () => {
    const { match } = await seedMatch();
    const v = await addVideo(ctx.db, {
      matchId: match.id, url: "https://youtu.be/verified", verifiedBy: "editor",
    });
    expect(v.verifiedAt).toBeInstanceOf(Date);
  });
});

describe("listVideosForEvent", () => {
  it("returns videos for every match in the event", async () => {
    const { event, match } = await seedMatch();
    await addVideo(ctx.db, { matchId: match.id, url: "https://youtu.be/e1" });
    const forEvent = await listVideosForEvent(ctx.db, event.id);
    expect(forEvent).toHaveLength(1);
    expect(forEvent[0]?.matchId).toBe(match.id);
  });
});

describe("listVideosForAthlete", () => {
  it("returns a match's video for each competing athlete (video library)", async () => {
    const { match, gordon, andre } = await seedMatch();
    await addVideo(ctx.db, { matchId: match.id, url: "https://youtu.be/lib" });
    expect(await listVideosForAthlete(ctx.db, gordon.id)).toHaveLength(1);
    expect(await listVideosForAthlete(ctx.db, andre.id)).toHaveLength(1);
  });
});
