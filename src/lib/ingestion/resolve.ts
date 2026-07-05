import type { Db } from "@/db/client";
import { promotions } from "@/db/schema/promotion";
import { teams } from "@/db/schema/team";
import { events } from "@/db/schema/event";
import { findAthleteDuplicates } from "@/lib/athletes/service";
import { normalizeName } from "@/lib/identity/normalize";
import type { CandidateGraph } from "@/lib/ingestion/schema";

export type ResolvedCandidate = {
  entityType:
    | "athlete" | "promotion" | "team" | "event" | "match"
    | "placement" | "video" | "membership";
  localRef: string;
  payload: unknown;
  resolvedEntityId: string | null;
  resolvedEntityType: string | null;
  matchScore: number | null;
};

export async function resolveCandidates(
  db: Db,
  graph: CandidateGraph,
): Promise<ResolvedCandidate[]> {
  const out: ResolvedCandidate[] = [];

  // Athletes: fuzzy name/alias match against existing athletes.
  for (const a of graph.athletes) {
    const dups = await findAthleteDuplicates(db, a.fullName);
    const best = dups[0];
    out.push({
      entityType: "athlete",
      localRef: a.localRef,
      payload: a,
      resolvedEntityId: best?.id ?? null,
      resolvedEntityType: best ? "athlete" : null,
      matchScore: best?.score ?? null,
    });
  }

  // Promotions: exact normalized-name match.
  const promoRows = await db
    .select({ id: promotions.id, name: promotions.name })
    .from(promotions);
  for (const p of graph.promotions) {
    const target = normalizeName(p.name);
    const hit = promoRows.find((r) => normalizeName(r.name) === target);
    out.push({
      entityType: "promotion",
      localRef: p.localRef,
      payload: p,
      resolvedEntityId: hit?.id ?? null,
      resolvedEntityType: hit ? "promotion" : null,
      matchScore: hit ? 1 : null,
    });
  }

  // Teams: exact normalized-name match.
  const teamRows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams);
  for (const t of graph.teams) {
    const target = normalizeName(t.name);
    const hit = teamRows.find((r) => normalizeName(r.name) === target);
    out.push({
      entityType: "team",
      localRef: t.localRef,
      payload: t,
      resolvedEntityId: hit?.id ?? null,
      resolvedEntityType: hit ? "team" : null,
      matchScore: hit ? 1 : null,
    });
  }

  // Events: exact normalized-name match.
  const eventRows = await db
    .select({ id: events.id, name: events.name })
    .from(events);
  for (const e of graph.events) {
    const target = normalizeName(e.name);
    const hit = eventRows.find((r) => normalizeName(r.name) === target);
    out.push({
      entityType: "event",
      localRef: e.localRef,
      payload: e,
      resolvedEntityId: hit?.id ?? null,
      resolvedEntityType: hit ? "event" : null,
      matchScore: hit ? 1 : null,
    });
  }

  // Matches: no resolution proposal in v1.
  for (const m of graph.matches) {
    out.push({
      entityType: "match",
      localRef: m.localRef,
      payload: m,
      resolvedEntityId: null,
      resolvedEntityType: null,
      matchScore: null,
    });
  }

  // Placements: edges like matches — no resolution proposal in v1.
  for (const pl of graph.placements) {
    out.push({
      entityType: "placement",
      localRef: pl.localRef,
      payload: pl,
      resolvedEntityId: null,
      resolvedEntityType: null,
      matchScore: null,
    });
  }

  // Videos: edges attached to a match — no resolution proposal in v1.
  for (const v of graph.videos) {
    out.push({
      entityType: "video",
      localRef: v.localRef,
      payload: v,
      resolvedEntityId: null,
      resolvedEntityType: null,
      matchScore: null,
    });
  }

  // Memberships: athlete↔team edges — no resolution proposal in v1.
  for (const mb of graph.memberships) {
    out.push({
      entityType: "membership",
      localRef: mb.localRef,
      payload: mb,
      resolvedEntityId: null,
      resolvedEntityType: null,
      matchScore: null,
    });
  }

  return out;
}
