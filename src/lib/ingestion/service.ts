import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  ingestionBatches, ingestionCandidates,
  type IngestionBatch, type IngestionCandidate,
} from "@/db/schema/ingestion";
import { placements } from "@/db/schema/placement";
import { videos } from "@/db/schema/video";
import { athleteTeamMemberships } from "@/db/schema/membership";
import { resolveCandidates } from "@/lib/ingestion/resolve";
import type { Extractor } from "@/lib/ingestion/extract";
import type {
  AthleteCandidate, PromotionCandidate, TeamCandidate, EventCandidate,
  MatchCandidate, PlacementCandidate, VideoCandidate, MembershipCandidate,
} from "@/lib/ingestion/schema";
import { createPromotion } from "@/lib/promotions/service";
import { createTeam } from "@/lib/teams/service";
import { createEvent } from "@/lib/events/service";
import { createAthlete } from "@/lib/athletes/service";
import { createMatch } from "@/lib/matches/service";
import { addPlacement } from "@/lib/placements/service";
import { addVideo } from "@/lib/videos/service";
import { addMembership } from "@/lib/memberships/service";

export async function createBatch(
  db: Db,
  input: { sourceText: string; sourceNote?: string; sourceUrl?: string; createdBy?: string },
): Promise<IngestionBatch> {
  const rows = await db
    .insert(ingestionBatches)
    .values({
      sourceText: input.sourceText,
      sourceNote: input.sourceNote ?? null,
      sourceUrl: input.sourceUrl ?? null,
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
): Promise<{ promotions: number; teams: number; events: number; athletes: number; matches: number; placements: number; videos: number; memberships: number }> {
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
    sourceUrl: batch.sourceUrl ?? batch.sourceNote ?? undefined,
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
  const matchRefs = committableRefs("match");
  const teamRefs = committableRefs("team");

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
  for (const c of byType("placement")) {
    const pl = c.payload as PlacementCandidate;
    if (!eventRefs.has(pl.eventRef)) {
      throw new Error(`commitBatch: placement ${pl.localRef} references uncommitted event ref ${pl.eventRef}`);
    }
    if (!athleteRefs.has(pl.athleteRef)) {
      throw new Error(`commitBatch: placement ${pl.localRef} references uncommitted athlete ref ${pl.athleteRef}`);
    }
  }
  for (const c of byType("video")) {
    const v = c.payload as VideoCandidate;
    if (!matchRefs.has(v.matchRef)) {
      throw new Error(`commitBatch: video ${v.localRef} references uncommitted match ref ${v.matchRef}`);
    }
  }
  for (const c of byType("membership")) {
    const mb = c.payload as MembershipCandidate;
    if (!athleteRefs.has(mb.athleteRef)) {
      throw new Error(`commitBatch: membership ${mb.localRef} references uncommitted athlete ref ${mb.athleteRef}`);
    }
    if (!teamRefs.has(mb.teamRef)) {
      throw new Error(`commitBatch: membership ${mb.localRef} references uncommitted team ref ${mb.teamRef}`);
    }
  }

  const counts = {
    promotions: 0, teams: 0, events: 0, athletes: 0,
    matches: 0, placements: 0, videos: 0, memberships: 0,
  };
  const promoMap = new Map<string, string>();
  const teamMap = new Map<string, string>();
  const eventMap = new Map<string, string>();
  const athleteMap = new Map<string, string>();
  const matchMap = new Map<string, string>();

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

    for (const c of byType("team")) {
      const t = c.payload as TeamCandidate;
      const id = await commitId(c, async () =>
        (await createTeam(stx, {
          name: t.name,
          shortName: t.shortName ?? undefined,
          ...provenance,
        })).id,
      );
      teamMap.set(c.localRef, id);
      if (c.decision !== "merge") counts.teams += 1;
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
      matchMap.set(c.localRef, created.id);
      await tx
        .update(ingestionCandidates)
        .set({ committedEntityId: created.id })
        .where(eq(ingestionCandidates.id, c.id));
      counts.matches += 1;
    }

    for (const c of byType("placement")) {
      const pl = c.payload as PlacementCandidate;
      const eventId = eventMap.get(pl.eventRef)!;
      const athleteId = athleteMap.get(pl.athleteRef)!;

      // Unique (event, athlete, division): skip an existing placement so a
      // re-ingest does not abort the whole transactional commit.
      const dup = await tx
        .select({ id: placements.id })
        .from(placements)
        .where(and(
          eq(placements.eventId, eventId),
          eq(placements.athleteId, athleteId),
          eq(placements.division, pl.division),
        ));
      const existingId = dup[0]?.id;

      const id = existingId ?? (await addPlacement(stx, {
        eventId,
        athleteId,
        division: pl.division,
        place: pl.place,
        confidence: provenance.confidence,
        verifiedBy: provenance.verifiedBy,
        sourceUrl: provenance.sourceUrl,
      })).id;

      await tx
        .update(ingestionCandidates)
        .set({ committedEntityId: id })
        .where(eq(ingestionCandidates.id, c.id));

      if (!existingId) counts.placements += 1;
    }

    for (const c of byType("video")) {
      const v = c.payload as VideoCandidate;
      const matchId = matchMap.get(v.matchRef)!;

      // Unique (match, url): skip an existing video so a re-ingest does not
      // abort the whole transactional commit.
      const dup = await tx
        .select({ id: videos.id })
        .from(videos)
        .where(and(eq(videos.matchId, matchId), eq(videos.url, v.url)));
      const existingId = dup[0]?.id;

      const id = existingId ?? (await addVideo(stx, {
        matchId,
        url: v.url,
        title: v.title ?? undefined,
        confidence: provenance.confidence,
        verifiedBy: provenance.verifiedBy,
        sourceUrl: provenance.sourceUrl,
      })).id;

      await tx
        .update(ingestionCandidates)
        .set({ committedEntityId: id })
        .where(eq(ingestionCandidates.id, c.id));

      if (!existingId) counts.videos += 1;
    }

    for (const c of byType("membership")) {
      const mb = c.payload as MembershipCandidate;
      const athleteId = athleteMap.get(mb.athleteRef)!;
      const teamId = teamMap.get(mb.teamRef)!;
      const startDate = mb.startDate ?? null;

      // Unique (athlete, team, start_date) NULLS NOT DISTINCT: skip an existing
      // membership so a re-ingest does not abort the whole transactional commit.
      const dup = await tx
        .select({ id: athleteTeamMemberships.id })
        .from(athleteTeamMemberships)
        .where(and(
          eq(athleteTeamMemberships.athleteId, athleteId),
          eq(athleteTeamMemberships.teamId, teamId),
          startDate === null
            ? isNull(athleteTeamMemberships.startDate)
            : eq(athleteTeamMemberships.startDate, startDate),
        ));
      const existingId = dup[0]?.id;

      const id = existingId ?? (await addMembership(stx, {
        athleteId,
        teamId,
        role: mb.role ?? undefined,
        startDate: startDate ?? undefined,
        endDate: mb.endDate ?? undefined,
        confidence: provenance.confidence,
        verifiedBy: provenance.verifiedBy,
        sourceUrl: provenance.sourceUrl,
      })).id;

      await tx
        .update(ingestionCandidates)
        .set({ committedEntityId: id })
        .where(eq(ingestionCandidates.id, c.id));

      if (!existingId) counts.memberships += 1;
    }

    await tx
      .update(ingestionBatches)
      .set({ status: "committed" })
      .where(eq(ingestionBatches.id, batchId));
  });

  return counts;
}
