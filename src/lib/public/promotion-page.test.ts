import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { getPromotionPage } from "@/lib/public/promotion-page";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("getPromotionPage", () => {
  it("returns the promotion with its published events", async () => {
    const s = await seed(ctx.db);
    const page = await getPromotionPage(ctx.db, s.promotion.slug);
    if (!page) throw new Error("expected a page");
    expect(page.promotion.name).toBe("ADCC");
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.name).toBe("ADCC 2022 World Championship");
  });

  it("excludes draft events", async () => {
    const s = await seed(ctx.db);
    await createEvent(ctx.db, {
      promotionId: s.promotion.id, name: "Hidden Event", startDate: "2023-01-01",
    }); // default status draft
    const page = await getPromotionPage(ctx.db, s.promotion.slug);
    expect(page?.events).toHaveLength(1);
  });

  it("returns null for a draft promotion and for an unknown slug", async () => {
    const draft = await createPromotion(ctx.db, { name: "Hidden Promo" });
    expect(await getPromotionPage(ctx.db, draft.slug)).toBeNull();
    expect(await getPromotionPage(ctx.db, "no-such-promo")).toBeNull();
  });
});
