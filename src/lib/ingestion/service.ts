import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  ingestionBatches, ingestionCandidates,
  type IngestionBatch, type IngestionCandidate,
} from "@/db/schema/ingestion";
import { resolveCandidates } from "@/lib/ingestion/resolve";
import type { Extractor } from "@/lib/ingestion/extract";
import type {
  AthleteCandidate, PromotionCandidate, EventCandidate, MatchCandidate,
} from "@/lib/ingestion/schema";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createAthlete } from "@/lib/athletes/service";
import { createMatch } from "@/lib/matches/service";

export async function createBatch(
  db: Db,
  input: { sourceText: string; sourceNote?: string; createdBy?: string },
): Promise<IngestionBatch> {
  const rows = await db
    .insert(ingestionBatches)
    .values({
      sourceText: input.sourceText,
      sourceNote: input.sourceNote ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  const batch = rows[0];
  if (!batch) throw new Error("createBatch: insert returned no rows");
  return batch;
}

export async function runExtraction(
  db: Db,
  extractor: Extractor,
  batchId: string,
): Promise<void> {
  const batch = (await db
    .select()
    .from(ingestionBatches)
    .where(eq(ingestionBatches.id, batchId)))[0];
  if (!batch) throw new Error(`runExtraction: batch ${batchId} not found`);

  try {
    const graph = await extractor.extract(batch.sourceText);
    const resolved = await resolveCandidates(db, graph);
    if (resolved.length) {
      await db.insert(ingestionCandidates).values(
        resolved.map((r) => ({
          batchId,
          entityType: r.entityType,
          payload: r.payload,
          localRef: r.localRef,
          resolvedEntityId: r.resolvedEntityId,
          resolvedEntityType: r.resolvedEntityType,
          matchScore: r.matchScore,
        })),
      );
    }
    await db
      .update(ingestionBatches)
      .set({ status: "review", model: process.env.INGEST_MODEL ?? "claude-opus-4-8" })
      .where(eq(ingestionBatches.id, batchId));
  } catch (err) {
    await db
      .update(ingestionBatches)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .where(eq(ingestionBatches.id, batchId));
    throw err;
  }
}

export async function getBatch(
  db: Db,
  batchId: string,
): Promise<{ batch: IngestionBatch; candidates: IngestionCandidate[] } | null> {
  const batch = (await db
    .select()
    .from(ingestionBatches)
    .where(eq(ingestionBatches.id, batchId)))[0];
  if (!batch) return null;
  const candidates = await db
    .select()
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.batchId, batchId));
  return { batch, candidates };
}

export async function setDecision(
  db: Db,
  candidateId: string,
  decision: "pending" | "accept" | "merge" | "reject",
): Promise<void> {
  await db
    .update(ingestionCandidates)
    .set({ decision })
    .where(eq(ingestionCandidates.id, candidateId));
}

export async function commitBatch(
  db: Db,
  batchId: string,
): Promise<{ promotions: number; events: number; athletes: number; matches: number }> {
  const loaded = await getBatch(db, batchId);
  if (!loaded) throw new Error(`commitBatch: batch ${batchId} not found`);
  if (loaded.batch.status !== "review") {
    throw new Error(
      `commitBatch: batch ${batchId} is not in review (status=${loaded.batch.status})`,
    );
  }

  const { batch, candidates } = loaded;
  const provenance = {
    status: "draft" as const,
    confidence: "NEEDS_REVIEW" as const,
    verifiedBy: batch.createdBy ?? undefined,
    sourceUrl: batch.sourceNote ?? undefined,
  };

  const committable = (c: IngestionCandidate) =>
    c.decision === "accept" || c.decision === "merge";

  const byType = (t: IngestionCandidate["entityType"]) =>
    candidates.filter((c) => c.entityType === t && committable(c));

  // Pre-validate refs: every ref an accepted/merged entity depends on must
  // itself be committable, so no partial graph is written.
  const committableRefs = (t: IngestionCandidate["entityType"]) =>
    new Set(byType(t).map((c) => c.localRef));
  const promoRefs = committableRefs("promotion");
  const eventRefs = committableRefs("event");
  const athleteRefs = committableRefs("athlete");

  for (const c of byType("event")) {
    const p = c.payload as EventCandidate;
    if (!promoRefs.has(p.promotionRef)) {
      throw new Error(`commitBatch: event "${p.name}" references uncommitted promotion ref ${p.promotionRef}`);
    }
  }
  for (const c of byType("match")) {
    const m = c.payload as MatchCandidate;
    if (!eventRefs.has(m.eventRef)) {
      throw new Error(`commitBatch: match ${m.localRef} references uncommitted event ref ${m.eventRef}`);
    }
    for (const comp of m.competitors) {
      if (!athleteRefs.has(comp.athleteRef)) {
        throw new Error(`commitBatch: match ${m.localRef} references uncommitted athlete ref ${comp.athleteRef}`);
      }
    }
  }

  const counts = { promotions: 0, events: 0, athletes: 0, matches: 0 };
  const promoMap = new Map<string, string>();
  const eventMap = new Map<string, string>();
  const athleteMap = new Map<string, string>();

  await db.transaction(async (tx) => {
    // The shared `Db` type does not model Drizzle transaction objects, though a
    // tx is structurally compatible with what the create* services use. Alias it
    // so the services run inside this transaction (atomic commit).
    const stx = tx as unknown as Db;

    const commitId = async (
      c: IngestionCandidate,
      make: () => Promise<string>,
    ): Promise<string> => {
      const id = c.decision === "merge" && c.resolvedEntityId
        ? c.resolvedEntityId
        : await make();
      await tx
        .update(ingestionCandidates)
        .set({ committedEntityId: id })
        .where(eq(ingestionCandidates.id, c.id));
      return id;
    };

    for (const c of byType("promotion")) {
      const p = c.payload as PromotionCandidate;
      const id = await commitId(c, async () =>
        (await createPromotion(stx, {
          name: p.name,
          shortName: p.shortName ?? undefined,
          ...provenance,
        })).id,
      );
      promoMap.set(c.localRef, id);
      if (c.decision !== "merge") counts.promotions += 1;
    }

    for (const c of byType("event")) {
      const e = c.payload as EventCandidate;
      const id = await commitId(c, async () =>
        (await createEvent(stx, {
          promotionId: promoMap.get(e.promotionRef)!,
          name: e.name,
          startDate: e.startDate,
          endDate: e.endDate ?? undefined,
          venue: e.venue ?? undefined,
          location: e.location ?? undefined,
          ...provenance,
        })).id,
      );
      eventMap.set(c.localRef, id);
      if (c.decision !== "merge") counts.events += 1;
    }

    for (const c of byType("athlete")) {
      const a = c.payload as AthleteCandidate;
      const id = await commitId(c, async () =>
        (await createAthlete(stx, {
          fullName: a.fullName,
          nationality: a.nationality ?? undefined,
          aliases: a.aliases,
          ...provenance,
        })).id,
      );
      athleteMap.set(c.localRef, id);
      if (c.decision !== "merge") counts.athletes += 1;
    }

    for (const c of byType("match")) {
      const m = c.payload as MatchCandidate;
      const created = await createMatch(stx, {
        eventId: eventMap.get(m.eventRef)!,
        matchType: m.matchType,
        round: m.round ?? undefined,
        weightClass: m.weightClass ?? undefined,
        ruleset: m.ruleset ?? undefined,
        method: m.method,
        methodDetail: m.methodDetail ?? undefined,
        durationSeconds: m.durationSeconds ?? undefined,
        competitors: m.competitors.map((comp) => ({
          athleteId: athleteMap.get(comp.athleteRef)!,
          outcome: comp.outcome,
          slotOrder: comp.slotOrder ?? undefined,
        })),
        ...provenance,
      });
      await tx
        .update(ingestionCandidates)
        .set({ committedEntityId: created.id })
        .where(eq(ingestionCandidates.id, c.id));
      counts.matches += 1;
    }

    await tx
      .update(ingestionBatches)
      .set({ status: "committed" })
      .where(eq(ingestionBatches.id, batchId));
  });

  return counts;
}
