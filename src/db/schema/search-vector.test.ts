import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("search_vector generated columns", () => {
  it("populate and match via to_tsquery on pglite", async () => {
    await seed(ctx.db);
    const res = await ctx.db.execute(
      sql`SELECT full_name FROM athletes
          WHERE search_vector @@ to_tsquery('simple', 'gord:*')`,
    );
    const rows = (res as unknown as { rows: { full_name: string }[] }).rows;
    expect(rows.map((r) => r.full_name)).toContain("Gordon Ryan");
  });
});
