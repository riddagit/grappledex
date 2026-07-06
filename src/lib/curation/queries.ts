import { and, eq, inArray, count, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matches, matchCompetitors } from "@/db/schema/match";
import { athletes } from "@/db/schema/athlete";
import { events } from "@/db/schema/event";
import { promotions } from "@/db/schema/promotion";
import { chunk } from "@/lib/util/chunk";

// Keep single `inArray` statements under the query-builder's limit; a full
// backfill has ~40k draft match ids.
const ID_BATCH = 1000;

export type DraftDashboard = {
  draftAthletes: number; draftPromotions: number; draftEvents: number;
  publishableMatches: number; blockedMatches: number; softFlaggedMatches: number;
};
export type BlockedMatch = { matchId: string; eventName: string; reason: string };
export type DraftAthleteSummary = {
  athleteId: string; fullName: string; slug: string; publishableMatches: number;
};

// The one home of the blocked-identity rule: a junk/unnamed opponent row.
const NON_IDENTITY = sql`(trim(${athletes.fullName}) = '' or lower(trim(${athletes.fullName})) = 'unknown')`;

async function tableCount(
  db: Db, table: typeof athletes | typeof events | typeof promotions,
): Promise<number> {
  const rows = await db.select({ n: count() }).from(table).where(eq(table.status, "draft"));
  return rows[0]?.n ?? 0;
}

// Draft matches that have at least one non-identity competitor.
export async function blockedMatchIds(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: matches.id })
    .from(matches)
    .innerJoin(matchCompetitors, eq(matchCompetitors.matchId, matches.id))
    .innerJoin(athletes, eq(matchCompetitors.athleteId, athletes.id))
    .where(and(eq(matches.status, "draft"), NON_IDENTITY));
  return rows.map((r) => r.id);
}

// Draft matches that are NOT blocked.
export async function publishableMatchIds(db: Db): Promise<string[]> {
  const blocked = new Set(await blockedMatchIds(db));
  const rows = await db.select({ id: matches.id }).from(matches).where(eq(matches.status, "draft"));
  return rows.map((r) => r.id).filter((id) => !blocked.has(id));
}

export async function draftDashboard(db: Db): Promise<DraftDashboard> {
  const draftMatchRows = await db
    .select({ id: matches.id, format: matches.format })
    .from(matches)
    .where(eq(matches.status, "draft"));
  const blocked = new Set(await blockedMatchIds(db));

  let publishableMatches = 0, blockedMatches = 0, softFlaggedMatches = 0;
  for (const m of draftMatchRows) {
    if (blocked.has(m.id)) { blockedMatches += 1; continue; }
    publishableMatches += 1;
    if (m.format === "unknown") softFlaggedMatches += 1;
  }

  return {
    draftAthletes: await tableCount(db, athletes),
    draftPromotions: await tableCount(db, promotions),
    draftEvents: await tableCount(db, events),
    publishableMatches, blockedMatches, softFlaggedMatches,
  };
}

export async function blockedMatches(db: Db, limit = 100): Promise<BlockedMatch[]> {
  const rows = await db
    .selectDistinct({
      matchId: matches.id,
      eventName: events.name,
      offenderName: athletes.fullName,
    })
    .from(matches)
    .innerJoin(matchCompetitors, eq(matchCompetitors.matchId, matches.id))
    .innerJoin(athletes, eq(matchCompetitors.athleteId, athletes.id))
    .innerJoin(events, eq(matches.eventId, events.id))
    .where(and(eq(matches.status, "draft"), NON_IDENTITY))
    .limit(limit);
  return rows.map((r) => ({
    matchId: r.matchId,
    eventName: r.eventName,
    reason: `opponent '${r.offenderName || "(empty)"}'`,
  }));
}

export async function draftAthleteSummaries(db: Db, limit = 200): Promise<DraftAthleteSummary[]> {
  const publishable = await publishableMatchIds(db);
  const byAthlete = new Map<string, number>();
  for (const part of chunk(publishable, ID_BATCH)) {
    const comps = await db
      .select({ athleteId: matchCompetitors.athleteId, matchId: matchCompetitors.matchId })
      .from(matchCompetitors)
      .where(inArray(matchCompetitors.matchId, part));
    for (const c of comps) byAthlete.set(c.athleteId, (byAthlete.get(c.athleteId) ?? 0) + 1);
  }

  const draftAthletes = await db
    .select({ id: athletes.id, fullName: athletes.fullName, slug: athletes.slug })
    .from(athletes)
    .where(eq(athletes.status, "draft"));

  return draftAthletes
    .map((a) => ({
      athleteId: a.id, fullName: a.fullName, slug: a.slug,
      publishableMatches: byAthlete.get(a.id) ?? 0,
    }))
    .sort((a, b) => b.publishableMatches - a.publishableMatches)
    .slice(0, limit);
}
