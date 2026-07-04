import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { videos, type Video } from "@/db/schema/video";
import { matches, matchCompetitors } from "@/db/schema/match";

export type AddVideoInput = {
  matchId: string;
  url: string;
  title?: string;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
};

export async function addVideo(db: Db, input: AddVideoInput): Promise<Video> {
  const rows = await db
    .insert(videos)
    .values({
      matchId: input.matchId,
      url: input.url,
      title: input.title ?? null,
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
    })
    .returning();
  const video = rows[0];
  if (!video) throw new Error("addVideo: insert returned no rows");
  return video;
}

export async function listVideosForMatch(
  db: Db,
  matchId: string,
): Promise<Video[]> {
  return db.select().from(videos).where(eq(videos.matchId, matchId));
}

export async function listVideosForEvent(
  db: Db,
  eventId: string,
): Promise<Video[]> {
  const rows = await db
    .select({ video: videos })
    .from(videos)
    .innerJoin(matches, eq(videos.matchId, matches.id))
    .where(eq(matches.eventId, eventId));
  return rows.map((r) => r.video);
}

// The per-athlete match video library: every video whose match the athlete competed in.
export async function listVideosForAthlete(
  db: Db,
  athleteId: string,
): Promise<Video[]> {
  const rows = await db
    .select({ video: videos })
    .from(videos)
    .innerJoin(matchCompetitors, eq(videos.matchId, matchCompetitors.matchId))
    .where(eq(matchCompetitors.athleteId, athleteId));
  return rows.map((r) => r.video);
}
