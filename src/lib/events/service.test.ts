import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent, searchEvents, getEvent } from "@/lib/events/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seedPromotion() {
  return createPromotion(ctx.db, { name: "Abu Dhabi Combat Club", shortName: "ADCC" });
}

describe("createEvent", () => {
  it("creates an event linked to a promotion with a derived slug", async () => {
    const p = await seedPromotion();
    const e = await createEvent(ctx.db, {
      promotionId: p.id,
      name: "ADCC 2022 World Championship",
      startDate: "2022-09-17",
      endDate: "2022-09-18",
      location: "Las Vegas, NV, USA",
    });
    expect(e.slug).toBe("adcc-2022-world-championship");
    expect(e.promotionId).toBe(p.id);
    expect(e.startDate).toBe("2022-09-17");
    expect(e.status).toBe("draft");
  });

  it("disambiguates slug collisions", async () => {
    const p = await seedPromotion();
    const a = await createEvent(ctx.db, { promotionId: p.id, name: "Trials", startDate: "2024-01-01" });
    const b = await createEvent(ctx.db, { promotionId: p.id, name: "Trials", startDate: "2024-06-01" });
    expect(a.slug).toBe("trials");
    expect(b.slug).toBe("trials-2");
  });
});

describe("searchEvents / getEvent", () => {
  it("finds by substring and fetches by id", async () => {
    const p = await seedPromotion();
    const e = await createEvent(ctx.db, { promotionId: p.id, name: "ADCC 2024 Worlds", startDate: "2024-08-17" });
    const rows = await searchEvents(ctx.db, "2024");
    expect(rows[0]?.id).toBe(e.id);
    const fetched = await getEvent(ctx.db, e.id);
    expect(fetched?.name).toBe("ADCC 2024 Worlds");
    expect(await getEvent(ctx.db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
