import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch, listMatchesForEvent, athleteRecord } from "@/lib/matches/service";
import { matches } from "@/db/schema/match";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seedEvent() {
  const p = await createPromotion(ctx.db, { name: "ADCC" });
  return createEvent(ctx.db, { promotionId: p.id, name: "ADCC 2022", startDate: "2022-09-17" });
}

describe("createMatch", () => {
  it("inserts a match and its two competitors atomically", async () => {
    const event = await seedEvent();
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const andre = await createAthlete(ctx.db, { fullName: "Andre Galvao" });

    const match = await createMatch(ctx.db, {
      eventId: event.id,
      matchType: "SUPERFIGHT",
      weightClass: "Absolute",
      ruleset: "ADCC",
      method: "SUBMISSION",
      methodDetail: "RNC",
      durationSeconds: 400,
      competitors: [
        { athleteId: gordon.id, outcome: "WON", slotOrder: 1 },
        { athleteId: andre.id, outcome: "LOST", slotOrder: 2 },
      ],
    });

    expect(match.method).toBe("SUBMISSION");
    const forEvent = await listMatchesForEvent(ctx.db, event.id);
    expect(forEvent).toHaveLength(1);
  });

  it("persists format and a unique source_ref", async () => {
    const event = await seedEvent();
    const a = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const b = await createAthlete(ctx.db, { fullName: "Felipe Pena" });

    const m = await createMatch(ctx.db, {
      eventId: event.id, matchType: "SUPERFIGHT", method: "SUBMISSION",
      format: "nogi", sourceRef: "bjjheroes:8858",
      competitors: [
        { athleteId: a.id, outcome: "WON", slotOrder: 1 },
        { athleteId: b.id, outcome: "LOST", slotOrder: 2 },
      ],
    });

    const row = (await ctx.db.select().from(matches).where(eq(matches.id, m.id)))[0];
    expect(row?.format).toBe("nogi");
    expect(row?.sourceRef).toBe("bjjheroes:8858");
  });

  it("rolls back the match when a competitor insert fails", async () => {
    const event = await seedEvent();
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });

    await expect(
      createMatch(ctx.db, {
        eventId: event.id,
        matchType: "SUPERFIGHT",
        method: "POINTS",
        competitors: [
          { athleteId: gordon.id, outcome: "WON" },
          // Non-existent athlete → FK violation → whole tx rolls back.
          { athleteId: "00000000-0000-0000-0000-000000000000", outcome: "LOST" },
        ],
      }),
    ).rejects.toThrow();

    const all = await ctx.db.select().from(matches);
    expect(all).toHaveLength(0); // no orphan match row
  });
});

describe("athleteRecord", () => {
  it("computes W-L-D and submission wins across matches", async () => {
    const event = await seedEvent();
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const opp = await createAthlete(ctx.db, { fullName: "Opponent" });

    // Win by submission
    await createMatch(ctx.db, {
      eventId: event.id, matchType: "SUPERFIGHT", method: "SUBMISSION",
      competitors: [
        { athleteId: gordon.id, outcome: "WON" },
        { athleteId: opp.id, outcome: "LOST" },
      ],
    });
    // Win by points
    await createMatch(ctx.db, {
      eventId: event.id, matchType: "SUPERFIGHT", method: "POINTS",
      competitors: [
        { athleteId: gordon.id, outcome: "WON" },
        { athleteId: opp.id, outcome: "LOST" },
      ],
    });
    // Loss
    await createMatch(ctx.db, {
      eventId: event.id, matchType: "SUPERFIGHT", method: "DECISION",
      competitors: [
        { athleteId: gordon.id, outcome: "LOST" },
        { athleteId: opp.id, outcome: "WON" },
      ],
    });

    const rec = await athleteRecord(ctx.db, gordon.id);
    expect(rec.wins).toBe(2);
    expect(rec.losses).toBe(1);
    expect(rec.submissionWins).toBe(1);
  });
});
