import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { athletes, type Athlete } from "@/db/schema/athlete";
import { matches, matchCompetitors } from "@/db/schema/match";
import { events } from "@/db/schema/event";
import { placements } from "@/db/schema/placement";
import { athleteTeamMemberships } from "@/db/schema/membership";
import { teams } from "@/db/schema/team";
import { videos } from "@/db/schema/video";
import {
  listInstructionalsForAthlete,
} from "@/lib/instructionals/service";
import type { Instructional } from "@/db/schema/instructional";

type Outcome = "WON" | "LOST" | "DRAW" | "NC" | "DQ";

export type OpponentRef = { id: string; name: string; slug: string };

export type VideoRef = { id: string; url: string; title: string | null };

export type MatchHistoryEntry = {
  matchId: string;
  date: string;
  eventName: string;
  eventSlug: string;
  matchType: string;
  weightClass: string | null;
  method: string;
  methodDetail: string | null;
  outcome: Outcome;
  opponents: OpponentRef[];
  videos: VideoRef[];
};

export type AthleteRecord = {
  wins: number; losses: number; draws: number; noContests: number; dqs: number;
  submissionWins: number;
};

export type PlacementEntry = {
  division: string; place: number; eventName: string; eventSlug: string; date: string;
};

export type TeamTimelineEntry = {
  teamName: string; teamSlug: string; role: string | null;
  startDate: string; endDate: string | null;
};

export type Rivalry = { opponent: OpponentRef; meetings: number };

export type AthletePage = {
  athlete: Athlete;
  record: AthleteRecord;
  finishRate: number;
  submissionBreakdown: { type: string; count: number }[];
  matchHistory: MatchHistoryEntry[];
  placements: PlacementEntry[];
  teamTimeline: TeamTimelineEntry[];
  videos: VideoRef[];
  instructionals: Instructional[];
  rivalries: Rivalry[];
};

// Current membership (null endDate) first, then most recent start first.
function byRecencyCurrentFirst(
  a: { startDate: string; endDate: string | null },
  b: { startDate: string; endDate: string | null },
): number {
  if ((a.endDate === null) !== (b.endDate === null)) return a.endDate === null ? -1 : 1;
  return b.startDate.localeCompare(a.startDate);
}

export async function getAthletePage(
  db: Db,
  slug: string,
): Promise<AthletePage | null> {
  const athleteRows = await db
    .select()
    .from(athletes)
    .where(and(eq(athletes.slug, slug), eq(athletes.status, "published")));
  const athlete = athleteRows[0];
  if (!athlete) return null;

  // The athlete's own competitor rows on published matches, with event context.
  const own = await db
    .select({
      matchId: matches.id,
      outcome: matchCompetitors.outcome,
      matchType: matches.matchType,
      weightClass: matches.weightClass,
      method: matches.method,
      methodDetail: matches.methodDetail,
      eventName: events.name,
      eventSlug: events.slug,
      date: events.startDate,
    })
    .from(matchCompetitors)
    .innerJoin(
      matches,
      and(eq(matchCompetitors.matchId, matches.id), eq(matches.status, "published")),
    )
    .innerJoin(events, eq(matches.eventId, events.id))
    .where(eq(matchCompetitors.athleteId, athlete.id));

  // All opponents in those matches (every competitor that isn't this athlete).
  const matchIds = own.map((r) => r.matchId);
  const opponentRows = matchIds.length
    ? await db
        .select({
          matchId: matchCompetitors.matchId,
          id: athletes.id,
          name: athletes.fullName,
          slug: athletes.slug,
        })
        .from(matchCompetitors)
        .innerJoin(athletes, eq(matchCompetitors.athleteId, athletes.id))
        .where(inArray(matchCompetitors.matchId, matchIds))
    : [];
  const opponentsByMatch = new Map<string, OpponentRef[]>();
  for (const r of opponentRows) {
    if (r.id === athlete.id) continue;
    const list = opponentsByMatch.get(r.matchId) ?? [];
    list.push({ id: r.id, name: r.name, slug: r.slug });
    opponentsByMatch.set(r.matchId, list);
  }

  // Videos on those matches, grouped by match so each history row carries its own
  // watch links (and reused for the athlete's full video library below).
  const matchVideoRows = matchIds.length
    ? await db
        .select({ id: videos.id, matchId: videos.matchId, url: videos.url, title: videos.title })
        .from(videos)
        .where(inArray(videos.matchId, matchIds))
    : [];
  const videosByMatch = new Map<string, VideoRef[]>();
  for (const v of matchVideoRows) {
    const list = videosByMatch.get(v.matchId) ?? [];
    list.push({ id: v.id, url: v.url, title: v.title });
    videosByMatch.set(v.matchId, list);
  }

  const matchHistory: MatchHistoryEntry[] = own
    .map((r) => ({
      matchId: r.matchId,
      date: r.date,
      eventName: r.eventName,
      eventSlug: r.eventSlug,
      matchType: r.matchType,
      weightClass: r.weightClass,
      method: r.method,
      methodDetail: r.methodDetail,
      outcome: r.outcome as Outcome,
      opponents: opponentsByMatch.get(r.matchId) ?? [],
      videos: videosByMatch.get(r.matchId) ?? [],
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Derived stats over the published match history.
  const record: AthleteRecord = {
    wins: 0, losses: 0, draws: 0, noContests: 0, dqs: 0, submissionWins: 0,
  };
  const subCounts = new Map<string, number>();
  for (const m of matchHistory) {
    if (m.outcome === "WON") {
      record.wins += 1;
      if (m.method === "SUBMISSION") {
        record.submissionWins += 1;
        const key = m.methodDetail ?? "Submission";
        subCounts.set(key, (subCounts.get(key) ?? 0) + 1);
      }
    } else if (m.outcome === "LOST") record.losses += 1;
    else if (m.outcome === "DRAW") record.draws += 1;
    else if (m.outcome === "NC") record.noContests += 1;
    else if (m.outcome === "DQ") record.dqs += 1;
  }
  const finishRate = record.wins > 0 ? record.submissionWins / record.wins : 0;
  const submissionBreakdown = [...subCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Rivalries: opponents met 2+ times across published matches.
  const meetings = new Map<string, { opponent: OpponentRef; meetings: number }>();
  for (const m of matchHistory) {
    for (const o of m.opponents) {
      const entry = meetings.get(o.id) ?? { opponent: o, meetings: 0 };
      entry.meetings += 1;
      meetings.set(o.id, entry);
    }
  }
  const rivalries = [...meetings.values()]
    .filter((r) => r.meetings >= 2)
    .sort((a, b) => b.meetings - a.meetings);

  // Placements on published events.
  const placementRows = await db
    .select({
      division: placements.division,
      place: placements.place,
      eventName: events.name,
      eventSlug: events.slug,
      date: events.startDate,
    })
    .from(placements)
    .innerJoin(
      events,
      and(eq(placements.eventId, events.id), eq(events.status, "published")),
    )
    .where(eq(placements.athleteId, athlete.id));

  // Team timeline over published teams.
  const timelineRows = await db
    .select({
      teamName: teams.name,
      teamSlug: teams.slug,
      role: athleteTeamMemberships.role,
      startDate: athleteTeamMemberships.startDate,
      endDate: athleteTeamMemberships.endDate,
    })
    .from(athleteTeamMemberships)
    .innerJoin(
      teams,
      and(eq(athleteTeamMemberships.teamId, teams.id), eq(teams.status, "published")),
    )
    .where(eq(athleteTeamMemberships.athleteId, athlete.id));
  const teamTimeline = timelineRows.sort(byRecencyCurrentFirst);

  // Full video library = every video across the athlete's published matches
  // (already fetched above for the per-row watch links).
  const videoList: VideoRef[] = matchVideoRows.map((v) => ({
    id: v.id, url: v.url, title: v.title,
  }));

  const instructionals = await listInstructionalsForAthlete(db, athlete.id);

  return {
    athlete,
    record,
    finishRate,
    submissionBreakdown,
    matchHistory,
    placements: placementRows,
    teamTimeline,
    videos: videoList,
    instructionals,
    rivalries,
  };
}
