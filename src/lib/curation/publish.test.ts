import { it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import { matches } from "@/db/schema/match";
import { athletes } from "@/db/schema/athlete";
import { events } from "@/db/schema/event";
import { promotions } from "@/db/schema/promotion";
import { publishMatches, publishAllPublishable, publishAthleteGraph } from "./publish";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seedGraph(format: "nogi" | "unknown", oppName: string) {
  const { db } = ctx;
  const p = await createPromotion(db, { name: "ADCC" });
  const ev = await createEvent(db, { promotionId: p.id, name: "ADCC 2022", startDate: "2022-09-17" });
  const a = await createAthlete(db, { fullName: "Gordon Ryan" });
  const b = await createAthlete(db, { fullName: oppName });
  const m = await createMatch(db, {
    eventId: ev.id, matchType: "SUPERFIGHT", method: "SUBMISSION", format,
    competitors: [
      { athleteId: a.id, outcome: "WON", slotOrder: 1 },
      { athleteId: b.id, outcome: "LOST", slotOrder: 2 },
    ],
  });
  return { promotionId: p.id, eventId: ev.id, aId: a.id, bId: b.id, matchId: m.id };
}

it("publishes a clean match and cascades to event, promotion, and both athletes", async () => {
  const { db } = ctx;
  const g = await seedGraph("nogi", "Felipe Pena");

  const r = await publishMatches(db, [g.matchId]);
  expect(r).toEqual({ matches: 1, events: 1, promotions: 1, athletes: 2, skippedBlocked: 0 });

  const status = async (t: any, id: string) => (await db.select().from(t).where(eq(t.id, id)))[0]?.status;
  expect(await status(matches, g.matchId)).toBe("published");
  expect(await status(events, g.eventId)).toBe("published");
  expect(await status(promotions, g.promotionId)).toBe("published");
  expect(await status(athletes, g.aId)).toBe("published");
  expect(await status(athletes, g.bId)).toBe("published");
});

it("is idempotent — re-publishing flips nothing", async () => {
  const { db } = ctx;
  const g = await seedGraph("nogi", "Felipe Pena");
  await publishMatches(db, [g.matchId]);
  const second = await publishMatches(db, [g.matchId]);
  expect(second).toEqual({ matches: 0, events: 0, promotions: 0, athletes: 0, skippedBlocked: 0 });
});

it("skips a blocked (Unknown-opponent) match, publishing nothing", async () => {
  const { db } = ctx;
  const g = await seedGraph("nogi", "Unknown");
  const r = await publishMatches(db, [g.matchId]);
  expect(r.matches).toBe(0);
  expect(r.skippedBlocked).toBe(1);
  const row = (await db.select().from(matches).where(eq(matches.id, g.matchId)))[0];
  expect(row?.status).toBe("draft");
});

it("publishAllPublishable publishes clean and leaves blocked as draft", async () => {
  const { db } = ctx;
  await seedGraph("nogi", "Felipe Pena"); // publishable
  await seedGraph("unknown", "Unknown");  // blocked
  const r = await publishAllPublishable(db);
  expect(r.matches).toBe(1);
  const remainingDrafts = (await db.select().from(matches).where(eq(matches.status, "draft"))).length;
  expect(remainingDrafts).toBe(1); // the blocked one
});

it("publishAthleteGraph publishes the athlete + their publishable matches and skips blocked", async () => {
  const { db } = ctx;
  const clean = await seedGraph("nogi", "Felipe Pena");
  // Give the same subject a second, blocked match against 'Unknown'.
  const unknown = await createAthlete(db, { fullName: "Unknown" });
  await createMatch(db, {
    eventId: clean.eventId, matchType: "SUPERFIGHT", method: "POINTS", format: "nogi",
    competitors: [
      { athleteId: clean.aId, outcome: "WON", slotOrder: 1 },
      { athleteId: unknown.id, outcome: "LOST", slotOrder: 2 },
    ],
  });

  const r = await publishAthleteGraph(db, clean.aId);
  expect(r.matches).toBe(1);
  expect(r.skippedBlocked).toBe(1);
  const subj = (await db.select().from(athletes).where(eq(athletes.id, clean.aId)))[0];
  expect(subj?.status).toBe("published");
});
