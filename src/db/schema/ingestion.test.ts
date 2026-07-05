import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { ingestionBatches, ingestionCandidates } from "@/db/schema/ingestion";
import { eq } from "drizzle-orm";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("ingestion schema", () => {
  it("inserts a batch and a candidate and reads them back", async () => {
    const [batch] = await ctx.db
      .insert(ingestionBatches)
      .values({ sourceText: "some pasted text" })
      .returning();
    expect(batch?.status).toBe("extracting");

    const [cand] = await ctx.db
      .insert(ingestionCandidates)
      .values({
        batchId: batch!.id,
        entityType: "athlete",
        payload: { fullName: "Gordon Ryan" },
        localRef: "a1",
      })
      .returning();
    expect(cand?.decision).toBe("pending");

    const rows = await ctx.db
      .select()
      .from(ingestionCandidates)
      .where(eq(ingestionCandidates.batchId, batch!.id));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { fullName: string }).fullName).toBe("Gordon Ryan");
  });
});
