import type { Db } from "@/db/client";
import { ingestionCandidates } from "@/db/schema/ingestion";
import { chunk } from "@/lib/util/chunk";
import type { Conflict } from "./load";

// A full backfill produces tens of thousands of conflicts; a single multi-row
// insert overflows Drizzle's query builder, so write in bounded batches.
const INSERT_BATCH = 500;

// Persist each conflict as a pending ingestion candidate so the existing admin
// review queue resolves it. `localRef` is NOT NULL, so fall back to the conflict
// kind when a record id is absent (subject-name ambiguity).
export async function recordConflicts(
  db: Db, batchId: string, conflicts: Conflict[],
): Promise<void> {
  if (!conflicts.length) return;
  const rows = conflicts.map((c) => ({
    batchId,
    entityType: c.kind === "ambiguous-athlete" ? ("athlete" as const) : ("match" as const),
    payload: { reason: c.kind, detail: c.detail, bjjHeroesId: c.recordId },
    localRef: c.recordId ?? c.kind,
  }));
  for (const batch of chunk(rows, INSERT_BATCH)) {
    await db.insert(ingestionCandidates).values(batch);
  }
}
