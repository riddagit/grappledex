import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { FakeExtractor } from "@/lib/ingestion/extract";
import type { CandidateGraph } from "@/lib/ingestion/schema";
import {
  createBatch, runExtraction, getBatch, setDecision, commitBatch,
} from "@/lib/ingestion/service";
import { athletes } from "@/db/schema/athlete";
import { matches, matchCompetitors } from "@/db/schema/match";
import { createAthlete } from "@/lib/athletes/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

const graph: CandidateGraph = {
  athletes: [
    { localRef: "a1", fullName: "Gordon Ryan" },
    { localRef: "a2", fullName: "Andre Galvao" },
  ],
  promotions: [{ localRef: "p1", name: "ADCC", shortName: "ADCC" }],
  events: [
    { localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" },
  ],
  matches: [{
    localRef: "m1", eventRef: "e1", matchType: "SUPERFIGHT", method: "DECISION",
    competitors: [
      { athleteRef: "a1", outcome: "WON", slotOrder: 1 },
      { athleteRef: "a2", outcome: "LOST", slotOrder: 2 },
    ],
  }],
  placements: [],
};

async function extractAll() {
  const batch = await createBatch(ctx.db, { sourceText: "raw", createdBy: "editor@x" });
  await runExtraction(ctx.db, new FakeExtractor(graph), batch.id);
  return batch;
}

async function acceptAll(batchId: string) {
  const loaded = (await getBatch(ctx.db, batchId))!;
  for (const c of loaded.candidates) await setDecision(ctx.db, c.id, "accept");
}

describe("ingestion service", () => {
  it("runExtraction persists candidates and moves the batch to review", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    expect(loaded.batch.status).toBe("review");
    expect(loaded.candidates).toHaveLength(5); // 2 athletes, 1 promo, 1 event, 1 match
  });

  it("commitBatch writes draft/NEEDS_REVIEW rows and links match competitors", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    const counts = await commitBatch(ctx.db, batch.id);
    expect(counts).toEqual({ promotions: 1, events: 1, athletes: 2, matches: 1 });

    const athleteRows = await ctx.db.select().from(athletes);
    expect(athleteRows).toHaveLength(2);
    expect(athleteRows.every((a) => a.status === "draft" && a.confidence === "NEEDS_REVIEW")).toBe(true);

    const matchRows = await ctx.db.select().from(matches);
    expect(matchRows).toHaveLength(1);
    const comps = await ctx.db
      .select()
      .from(matchCompetitors)
      .where(eq(matchCompetitors.matchId, matchRows[0]!.id));
    expect(comps).toHaveLength(2);

    const after = (await getBatch(ctx.db, batch.id))!;
    expect(after.batch.status).toBe("committed");
    expect(after.candidates.every((c) => c.committedEntityId !== null)).toBe(true);
  });

  it("merge reuses the existing entity instead of creating a new one", async () => {
    const existing = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    for (const c of loaded.candidates) {
      const isGordon = c.entityType === "athlete" && (c.payload as { fullName: string }).fullName === "Gordon Ryan";
      await setDecision(ctx.db, c.id, isGordon ? "merge" : "accept");
    }
    const counts = await commitBatch(ctx.db, batch.id);
    expect(counts.athletes).toBe(1); // only Galvao created; Gordon merged

    const athleteRows = await ctx.db.select().from(athletes);
    expect(athleteRows).toHaveLength(2); // existing Gordon + new Galvao
    const comps = await ctx.db.select().from(matchCompetitors);
    expect(comps.some((c) => c.athleteId === existing.id)).toBe(true);
  });

  it("rejects the commit when a match references a rejected athlete", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    for (const c of loaded.candidates) {
      const isGalvao = c.entityType === "athlete" && (c.payload as { fullName: string }).fullName === "Andre Galvao";
      await setDecision(ctx.db, c.id, isGalvao ? "reject" : "accept");
    }
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(/uncommitted athlete ref/);
  });

  it("refuses to commit a batch that is not in review", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    await commitBatch(ctx.db, batch.id);
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(/not in review/);
  });
});
