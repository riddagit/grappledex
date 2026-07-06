import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { promotions } from "@/db/schema/promotion";
import { events } from "@/db/schema/event";
import { matches } from "@/db/schema/match";
import { slugify } from "@/lib/identity/normalize";
import { findAthleteDuplicates, createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import { classifyFormat, classifyMatchType, classifyMethod } from "./classify";
import type { BjjHeroesProfile } from "./parse";

export type Conflict = {
  kind: "ambiguous-athlete" | "unknown-format" | "self-opponent";
  detail: string;
  recordId: string | null;
};
export type LoadResult = {
  subjectAthleteId: string;
  created: { athletes: number; promotions: number; events: number; matches: number };
  matchedAthletes: number;
  skippedMatches: number;
  conflicts: Conflict[];
};

type Counters = { created: LoadResult["created"]; matchedAthletes: number };

// Reuse-or-create an athlete by name. Returns null when ambiguous (caller conflicts).
async function resolveAthlete(
  db: Db, name: string, counters: Counters,
  opts: { sourceUrl?: string } = {},
): Promise<string | null> {
  const candidates = await findAthleteDuplicates(db, name); // scored >=0.82, desc
  const exact = candidates.filter((c) => c.score === 1);
  if (exact.length === 1) { counters.matchedAthletes += 1; return exact[0]!.id; }
  if (exact.length > 1) return null;            // genuinely ambiguous
  if (candidates.length > 0) return null;       // near but not exact — don't guess
  const created = await createAthlete(db, { fullName: name, sourceUrl: opts.sourceUrl });
  counters.created.athletes += 1;
  return created.id;
}

async function resolvePromotion(db: Db, name: string, counters: Counters): Promise<string> {
  const slug = slugify(name) || "promotion";
  const existing = await db.select({ id: promotions.id }).from(promotions).where(eq(promotions.slug, slug));
  if (existing[0]) return existing[0].id;
  const created = await createPromotion(db, { name });
  counters.created.promotions += 1;
  return created.id;
}

async function resolveEvent(
  db: Db, promotionId: string, name: string, year: number, counters: Counters,
): Promise<string> {
  const slug = slugify(name) || "event";
  const existing = await db.select({ id: events.id }).from(events).where(eq(events.slug, slug));
  if (existing[0]) return existing[0].id;
  const created = await createEvent(db, {
    promotionId, name, startDate: `${year}-01-01`,
  });
  counters.created.events += 1;
  return created.id;
}

async function matchExists(db: Db, sourceRef: string): Promise<boolean> {
  const rows = await db.select({ id: matches.id }).from(matches).where(eq(matches.sourceRef, sourceRef));
  return rows.length > 0;
}

const invert = (o: "WON" | "LOST" | "DRAW"): "WON" | "LOST" | "DRAW" =>
  o === "WON" ? "LOST" : o === "LOST" ? "WON" : "DRAW";

export async function loadProfile(
  db: Db, profile: BjjHeroesProfile, sourceUrl: string,
): Promise<LoadResult> {
  const counters: Counters = {
    created: { athletes: 0, promotions: 0, events: 0, matches: 0 },
    matchedAthletes: 0,
  };
  const conflicts: Conflict[] = [];
  let skippedMatches = 0;

  const subjectId = await resolveAthlete(db, profile.fullName, counters, { sourceUrl });
  if (!subjectId) {
    // The profile's own name is ambiguous — nothing anchors the records.
    return {
      subjectAthleteId: "",
      created: counters.created, matchedAthletes: counters.matchedAthletes,
      skippedMatches, conflicts: [{ kind: "ambiguous-athlete", detail: profile.fullName, recordId: null }],
    };
  }

  for (const rec of profile.records) {
    const sourceRef = `bjjheroes:${rec.bjjHeroesId}`;
    if (await matchExists(db, sourceRef)) { skippedMatches += 1; continue; }

    const opponentId = await resolveAthlete(db, rec.opponentName, counters);
    if (!opponentId) {
      conflicts.push({ kind: "ambiguous-athlete", detail: rec.opponentName, recordId: rec.bjjHeroesId });
      continue; // don't mis-attribute the match
    }
    if (opponentId === subjectId) {
      // Opponent name resolved back to the subject: creating the match would insert
      // two competitor rows with the same (match_id, athlete_id) and violate the
      // unique constraint, aborting the whole profile. Route to review instead.
      conflicts.push({ kind: "self-opponent", detail: rec.opponentName, recordId: rec.bjjHeroesId });
      continue;
    }

    const format = classifyFormat(rec.competition);
    if (format === "unknown") {
      conflicts.push({ kind: "unknown-format", detail: rec.competition, recordId: rec.bjjHeroesId });
    }
    const { matchType, round } = classifyMatchType(rec.stage);
    const { method, methodDetail } = classifyMethod(rec.methodRaw);

    const promotionId = await resolvePromotion(db, rec.competition, counters);
    const eventId = await resolveEvent(db, promotionId, `${rec.competition} ${rec.year}`, rec.year, counters);

    await createMatch(db, {
      eventId, matchType, round: round ?? undefined,
      weightClass: rec.weightLabel ?? undefined,
      method, methodDetail: methodDetail ?? undefined,
      format, sourceRef, sourceUrl,
      competitors: [
        { athleteId: subjectId, outcome: rec.outcome, slotOrder: 1 },
        { athleteId: opponentId, outcome: invert(rec.outcome), slotOrder: 2 },
      ],
    });
    counters.created.matches += 1;
  }

  return {
    subjectAthleteId: subjectId,
    created: counters.created,
    matchedAthletes: counters.matchedAthletes,
    skippedMatches, conflicts,
  };
}
