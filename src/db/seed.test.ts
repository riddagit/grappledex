import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { athletes } from "@/db/schema/athlete";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("seed", () => {
  it("inserts a published, queryable no-gi slice with handles", async () => {
    const s = await seed(ctx.db);

    // returns useful handles
    expect(s.athletes.gordon.slug).toBe("gordon-ryan");
    expect(s.event.slug).toBeTruthy();
    expect(s.team.slug).toBeTruthy();

    // athletes are published (public pages only render published)
    const rows = await ctx.db
      .select()
      .from(athletes)
      .where(eq(athletes.id, s.athletes.gordon.id));
    expect(rows[0]?.status).toBe("published");
  });

  it("is idempotent enough to run once per fresh db without throwing", async () => {
    await expect(seed(ctx.db)).resolves.toBeDefined();
  });
});
