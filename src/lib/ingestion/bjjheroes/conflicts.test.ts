import { it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { createBatch } from "@/lib/ingestion/service";
import { recordConflicts } from "./conflicts";
import { ingestionCandidates } from "@/db/schema/ingestion";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

it("writes conflicts as ingestion candidates on the batch", async () => {
  const { db } = ctx;
  const batch = await createBatch(db, { sourceText: "BJJ Heroes backfill", sourceNote: "backfill" });
  await recordConflicts(db, batch.id, [
    { kind: "ambiguous-athlete", detail: "Felype Pena", recordId: "8858" },
    { kind: "unknown-format", detail: "Studio 540 SPF", recordId: "9000" },
  ]);
  const rows = await db.select().from(ingestionCandidates).where(eq(ingestionCandidates.batchId, batch.id));
  expect(rows.length).toBe(2);
});

it("tolerates a null recordId (subject-name ambiguity) without violating not-null", async () => {
  const { db } = ctx;
  const batch = await createBatch(db, { sourceText: "BJJ Heroes backfill", sourceNote: "backfill" });
  await recordConflicts(db, batch.id, [
    { kind: "ambiguous-athlete", detail: "Ambiguous Subject", recordId: null },
  ]);
  const rows = await db.select().from(ingestionCandidates).where(eq(ingestionCandidates.batchId, batch.id));
  expect(rows.length).toBe(1);
  expect(rows[0]!.localRef.length).toBeGreaterThan(0);
});
