import type { Db } from "@/db/client";
import { ingestionCandidates } from "@/db/schema/ingestion";
import type { Conflict } from "./load";

// Persist each conflict as a pending ingestion candidate so the existing admin
// review queue resolves it. `localRef` is NOT NULL, so fall back to the conflict
// kind when a record id is absent (subject-name ambiguity).
export async function recordConflicts(
  db: Db, batchId: string, conflicts: Conflict[],
): Promise<void> {
  if (!conflicts.length) return;
  await db.insert(ingestionCandidates).values(
    conflicts.map((c) => ({
      batchId,
      entityType: c.kind === "ambiguous-athlete" ? ("athlete" as const) : ("match" as const),
      payload: { reason: c.kind, detail: c.detail, bjjHeroesId: c.recordId },
      localRef: c.recordId ?? c.kind,
    })),
  );
}
