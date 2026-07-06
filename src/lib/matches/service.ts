import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matches, matchCompetitors, type Match } from "@/db/schema/match";

export type MatchCompetitorInput = {
  athleteId: string;
  outcome: "WON" | "LOST" | "DRAW" | "NC" | "DQ";
  slotOrder?: number;
};

export type CreateMatchInput = {
  eventId: string;
  matchType: "BRACKET" | "SUPERFIGHT" | "TRIAL" | "ALTERNATE";
  round?: string;
  weightClass?: string;
  ruleset?: string;
  method:
    | "SUBMISSION" | "POINTS" | "DECISION" | "DQ"
    | "OVERTIME" | "FORFEIT" | "NC" | "DRAW";
  methodDetail?: string;
  format?: "nogi" | "gi" | "unknown";
  sourceRef?: string;
  durationSeconds?: number;
  competitors: MatchCompetitorInput[];
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
  status?: "draft" | "published";
};

export async function createMatch(
  db: Db,
  input: CreateMatchInput,
): Promise<Match> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(matches)
      .values({
        eventId: input.eventId,
        matchType: input.matchType,
        round: input.round ?? null,
        weightClass: input.weightClass ?? null,
        ruleset: input.ruleset ?? null,
        method: input.method,
        methodDetail: input.methodDetail ?? null,
        format: input.format ?? "unknown",
        sourceRef: input.sourceRef ?? null,
        durationSeconds: input.durationSeconds ?? null,
        sourceUrl: input.sourceUrl ?? null,
        verifiedBy: input.verifiedBy ?? null,
        verifiedAt: input.verifiedBy ? new Date() : null,
        confidence: input.confidence ?? "NEEDS_REVIEW",
        status: input.status ?? "draft",
      })
      .returning();
    const match = rows[0];
    if (!match) throw new Error("createMatch: insert returned no rows");

    if (input.competitors.length) {
      await tx.insert(matchCompetitors).values(
        input.competitors.map((c) => ({
          matchId: match.id,
          athleteId: c.athleteId,
          outcome: c.outcome,
          slotOrder: c.slotOrder ?? null,
        })),
      );
    }
    return match;
  });
}

export async function listMatchesForEvent(
  db: Db,
  eventId: string,
): Promise<Match[]> {
  return db.select().from(matches).where(eq(matches.eventId, eventId));
}

export type AthleteRecord = {
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
  dqs: number;
  submissionWins: number;
};

export async function athleteRecord(
  db: Db,
  athleteId: string,
): Promise<AthleteRecord> {
  const rows = await db
    .select({ outcome: matchCompetitors.outcome, method: matches.method })
    .from(matchCompetitors)
    .innerJoin(matches, eq(matchCompetitors.matchId, matches.id))
    .where(eq(matchCompetitors.athleteId, athleteId));

  const rec: AthleteRecord = {
    wins: 0, losses: 0, draws: 0, noContests: 0, dqs: 0, submissionWins: 0,
  };
  for (const r of rows) {
    if (r.outcome === "WON") {
      rec.wins += 1;
      if (r.method === "SUBMISSION") rec.submissionWins += 1;
    } else if (r.outcome === "LOST") rec.losses += 1;
    else if (r.outcome === "DRAW") rec.draws += 1;
    else if (r.outcome === "NC") rec.noContests += 1;
    else if (r.outcome === "DQ") rec.dqs += 1;
  }
  return rec;
}
