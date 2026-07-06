import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matches, matchCompetitors } from "@/db/schema/match";
import { events } from "@/db/schema/event";
import { promotions } from "@/db/schema/promotion";
import { athletes } from "@/db/schema/athlete";
import { blockedMatchIds, publishableMatchIds } from "./queries";

export type PublishResult = {
  matches: number; events: number; promotions: number; athletes: number; skippedBlocked: number;
};

const EMPTY: PublishResult = { matches: 0, events: 0, promotions: 0, athletes: 0, skippedBlocked: 0 };

// Flip draft -> published for the given ids on one table; return rows actually changed.
async function flip(
  tx: Db,
  table: typeof matches | typeof events | typeof promotions | typeof athletes,
  ids: string[],
): Promise<number> {
  if (!ids.length) return 0;
  // Drizzle cannot resolve `.set()` over a union of tables, so type the builder
  // loosely. All four tables share `id` + `status`; behaviour is covered by tests.
  const builder = tx.update(table) as unknown as {
    set: (v: { status: "published" }) => {
      where: (w: unknown) => { returning: (c: { id: unknown }) => Promise<unknown[]> };
    };
  };
  const changed = await builder
    .set({ status: "published" })
    .where(and(inArray(table.id, ids), eq(table.status, "draft")))
    .returning({ id: table.id });
  return changed.length;
}

// Cascade-publish a set of already-vetted publishable match ids, plus optionally
// force-publish a subject athlete (used by publishAthleteGraph for the 0-match case).
async function cascade(
  db: Db, targetMatchIds: string[], skippedBlocked: number, forceAthleteId?: string,
): Promise<PublishResult> {
  if (!targetMatchIds.length && !forceAthleteId) return { ...EMPTY, skippedBlocked };

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db; // tx is structurally compatible with Db (see commitBatch)

    const eventIds = targetMatchIds.length
      ? [...new Set((await tx
          .select({ id: matches.eventId }).from(matches)
          .where(inArray(matches.id, targetMatchIds))).map((r) => r.id))]
      : [];
    const promotionIds = eventIds.length
      ? [...new Set((await tx
          .select({ id: events.promotionId }).from(events)
          .where(inArray(events.id, eventIds))).map((r) => r.id))]
      : [];
    const athleteIdSet = new Set<string>();
    if (targetMatchIds.length) {
      const comps = await tx
        .select({ id: matchCompetitors.athleteId }).from(matchCompetitors)
        .where(inArray(matchCompetitors.matchId, targetMatchIds));
      for (const c of comps) athleteIdSet.add(c.id);
    }
    if (forceAthleteId) athleteIdSet.add(forceAthleteId);

    return {
      matches: await flip(tx, matches, targetMatchIds),
      events: await flip(tx, events, eventIds),
      promotions: await flip(tx, promotions, promotionIds),
      athletes: await flip(tx, athletes, [...athleteIdSet]),
      skippedBlocked,
    };
  });
}

export async function publishMatches(db: Db, matchIds: string[]): Promise<PublishResult> {
  if (!matchIds.length) return { ...EMPTY };
  const publishable = new Set(await publishableMatchIds(db));
  const blocked = new Set(await blockedMatchIds(db));
  const target = matchIds.filter((id) => publishable.has(id));
  const skippedBlocked = matchIds.filter((id) => blocked.has(id)).length;
  return cascade(db, target, skippedBlocked);
}

export async function publishAllPublishable(db: Db): Promise<PublishResult> {
  return cascade(db, await publishableMatchIds(db), 0);
}

export async function publishAthleteGraph(db: Db, athleteId: string): Promise<PublishResult> {
  const publishable = new Set(await publishableMatchIds(db));
  const blocked = new Set(await blockedMatchIds(db));
  const compRows = await db
    .select({ matchId: matchCompetitors.matchId })
    .from(matchCompetitors)
    .where(eq(matchCompetitors.athleteId, athleteId));
  const theirMatchIds = [...new Set(compRows.map((r) => r.matchId))];
  const target = theirMatchIds.filter((id) => publishable.has(id));
  const skippedBlocked = theirMatchIds.filter((id) => blocked.has(id)).length;
  return cascade(db, target, skippedBlocked, athleteId);
}
