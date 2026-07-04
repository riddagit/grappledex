import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, type Event } from "@/db/schema/event";
import { promotions } from "@/db/schema/promotion";
import { matches, matchCompetitors } from "@/db/schema/match";
import { athletes } from "@/db/schema/athlete";
import { placements } from "@/db/schema/placement";
import { listVideosForEvent } from "@/lib/videos/service";

export type VideoRef = { id: string; url: string; title: string | null };

export type EventResult = {
  matchId: string; matchType: string; round: string | null;
  weightClass: string | null; method: string; methodDetail: string | null;
  competitors: { id: string; name: string; slug: string; outcome: string }[];
  videos: VideoRef[];
};
export type EventPlacement = {
  division: string; place: number; athlete: { name: string; slug: string };
};
export type EventPage = {
  event: Event;
  promotion: { name: string; slug: string };
  results: EventResult[];
  placements: EventPlacement[];
};

export async function getEventPage(db: Db, slug: string): Promise<EventPage | null> {
  const rows = await db
    .select({ event: events, promoName: promotions.name, promoSlug: promotions.slug })
    .from(events)
    .innerJoin(promotions, eq(events.promotionId, promotions.id))
    .where(and(eq(events.slug, slug), eq(events.status, "published")));
  const row = rows[0];
  if (!row) return null;
  const event = row.event;

  const matchRows = await db
    .select({
      id: matches.id, matchType: matches.matchType, round: matches.round,
      weightClass: matches.weightClass, method: matches.method,
      methodDetail: matches.methodDetail,
    })
    .from(matches)
    .where(and(eq(matches.eventId, event.id), eq(matches.status, "published")));
  const matchIds = matchRows.map((m) => m.id);

  const competitorRows = matchIds.length
    ? await db
        .select({
          matchId: matchCompetitors.matchId,
          id: athletes.id, name: athletes.fullName, slug: athletes.slug,
          outcome: matchCompetitors.outcome, slotOrder: matchCompetitors.slotOrder,
        })
        .from(matchCompetitors)
        .innerJoin(athletes, eq(matchCompetitors.athleteId, athletes.id))
        .where(inArray(matchCompetitors.matchId, matchIds))
    : [];
  const compsByMatch = new Map<string, EventResult["competitors"]>();
  for (const c of [...competitorRows].sort(
    (a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0),
  )) {
    const list = compsByMatch.get(c.matchId) ?? [];
    list.push({ id: c.id, name: c.name, slug: c.slug, outcome: c.outcome });
    compsByMatch.set(c.matchId, list);
  }

  const eventVideos = await listVideosForEvent(db, event.id);
  const videosByMatch = new Map<string, VideoRef[]>();
  for (const v of eventVideos) {
    if (!v.matchId) continue;
    const list = videosByMatch.get(v.matchId) ?? [];
    list.push({ id: v.id, url: v.url, title: v.title });
    videosByMatch.set(v.matchId, list);
  }

  const results: EventResult[] = matchRows.map((m) => ({
    matchId: m.id, matchType: m.matchType, round: m.round,
    weightClass: m.weightClass, method: m.method, methodDetail: m.methodDetail,
    competitors: compsByMatch.get(m.id) ?? [],
    videos: videosByMatch.get(m.id) ?? [],
  }));

  const placementRows = await db
    .select({
      division: placements.division, place: placements.place,
      name: athletes.fullName, slug: athletes.slug,
    })
    .from(placements)
    .innerJoin(athletes, eq(placements.athleteId, athletes.id))
    .where(eq(placements.eventId, event.id));
  const placementList: EventPlacement[] = placementRows
    .map((p) => ({ division: p.division, place: p.place, athlete: { name: p.name, slug: p.slug } }))
    .sort((a, b) => a.place - b.place);

  return {
    event,
    promotion: { name: row.promoName, slug: row.promoSlug },
    results,
    placements: placementList,
  };
}
