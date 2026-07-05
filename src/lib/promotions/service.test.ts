import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createPromotion, searchPromotions } from "@/lib/promotions/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("createPromotion", () => {
  it("creates a promotion with a derived slug and stamps verification", async () => {
    const p = await createPromotion(ctx.db, {
      name: "Abu Dhabi Combat Club",
      shortName: "ADCC",
      verifiedBy: "editor@rollvault",
      confidence: "CONFIRMED",
    });
    expect(p.slug).toBe("abu-dhabi-combat-club");
    expect(p.shortName).toBe("ADCC");
    expect(p.confidence).toBe("CONFIRMED");
    expect(p.verifiedAt).not.toBeNull();
    expect(p.status).toBe("draft");
  });

  it("disambiguates slug collisions", async () => {
    const a = await createPromotion(ctx.db, { name: "Polaris" });
    const b = await createPromotion(ctx.db, { name: "Polaris" });
    expect(a.slug).toBe("polaris");
    expect(b.slug).toBe("polaris-2");
  });
});

describe("searchPromotions", () => {
  it("finds by case-insensitive substring", async () => {
    await createPromotion(ctx.db, { name: "Who's Number One", shortName: "WNO" });
    const rows = await searchPromotions(ctx.db, "number");
    expect(rows[0]?.name).toBe("Who's Number One");
  });
});
