import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matches, matchCompetitors, type Match } from "@/db/schema/match";
import { events } from "@/db/schema/event";
import { athletes } from "@/db/schema/athlete";
import { listVideosForMatch } from "@/lib/videos/service";

export type VideoRef = { id: string; url: string; title: string | null };

export type MatchCompetitorRef = {
  id: string; name: string; slug: string;
  outcome: "WON" | "LOST" | "DRAW" | "NC" | "DQ"; slotOrder: number | null;
};

export type MatchPage = {
  match: Match;
  event: { name: string; slug: string; startDate: string };
  competitors: MatchCompetitorRef[];
  videos: VideoRef[];
};

export async function getMatchPage(db: Db, id: string): Promise<MatchPage | null> {
  // Match must be published AND on a published event.
  const rows = await db
    .select({
      match: matches,
      eventName: events.name,
      eventSlug: events.slug,
      eventStartDate: events.startDate,
    })
    .from(matches)
    .innerJoin(
      events,
      and(eq(matches.eventId, events.id), eq(events.status, "published")),
    )
    .where(and(eq(matches.id, id), eq(matches.status, "published")));
  const row = rows[0];
  if (!row) return null;

  const competitorRows = await db
    .select({
      id: athletes.id, name: athletes.fullName, slug: athletes.slug,
      outcome: matchCompetitors.outcome, slotOrder: matchCompetitors.slotOrder,
    })
    .from(matchCompetitors)
    .innerJoin(athletes, eq(matchCompetitors.athleteId, athletes.id))
    .where(eq(matchCompetitors.matchId, id))
    .orderBy(asc(matchCompetitors.slotOrder));

  const videoRows = await listVideosForMatch(db, id);
  const videos: VideoRef[] = videoRows.map((v) => ({
    id: v.id, url: v.url, title: v.title,
  }));

  return {
    match: row.match,
    event: { name: row.eventName, slug: row.eventSlug, startDate: row.eventStartDate },
    competitors: competitorRows as MatchCompetitorRef[],
    videos,
  };
}
