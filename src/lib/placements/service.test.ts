import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { addPlacement, listPlacementsForEvent } from "@/lib/placements/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seedEventAndAthlete() {
  const p = await createPromotion(ctx.db, { name: "ADCC" });
  const event = await createEvent(ctx.db, { promotionId: p.id, name: "ADCC 2022", startDate: "2022-09-17" });
  const athlete = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
  return { event, athlete };
}

describe("addPlacement", () => {
  it("records a podium finish for a division", async () => {
    const { event, athlete } = await seedEventAndAthlete();
    const pl = await addPlacement(ctx.db, {
      eventId: event.id, athleteId: athlete.id, division: "Absolute", place: 1,
    });
    expect(pl.place).toBe(1);
    const forEvent = await listPlacementsForEvent(ctx.db, event.id);
    expect(forEvent).toHaveLength(1);
  });

  it("rejects a duplicate (event, athlete, division) placement", async () => {
    const { event, athlete } = await seedEventAndAthlete();
    await addPlacement(ctx.db, { eventId: event.id, athleteId: athlete.id, division: "Absolute", place: 1 });
    await expect(
      addPlacement(ctx.db, { eventId: event.id, athleteId: athlete.id, division: "Absolute", place: 2 }),
    ).rejects.toThrow();
  });
});
