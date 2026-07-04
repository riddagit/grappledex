import type { Db } from "@/db/client";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import { addPlacement } from "@/lib/placements/service";
import { createTeam } from "@/lib/teams/service";
import { addMembership } from "@/lib/memberships/service";
import { addVideo } from "@/lib/videos/service";
import { addInstructional } from "@/lib/instructionals/service";

/**
 * Demo seed: a small, plausible published no-gi slice so public pages have something
 * to render and the read layer has a fixture to assert against. All rows are marked
 * `published` (public pages render only published entities). Facts are illustrative
 * demo data, not verified editorial records (confidence stays NEEDS_REVIEW).
 */
export async function seed(db: Db) {
  const pub = { status: "published" as const, confidence: "CONFIRMED" as const };

  const gordon = await createAthlete(db, {
    fullName: "Gordon Ryan", nationality: "USA",
    aliases: ["The King"], ...pub,
  });
  const galvao = await createAthlete(db, {
    fullName: "Andre Galvao", nationality: "Brazil", ...pub,
  });
  const meregali = await createAthlete(db, {
    fullName: "Nicholas Meregali", nationality: "Brazil", ...pub,
  });

  const adcc = await createPromotion(db, { name: "ADCC", shortName: "ADCC", ...pub });

  const event = await createEvent(db, {
    promotionId: adcc.id,
    name: "ADCC 2022 World Championship",
    startDate: "2022-09-17",
    endDate: "2022-09-18",
    venue: "T-Mobile Center",
    location: "Las Vegas, USA",
    ...pub,
  });

  const team = await createTeam(db, {
    name: "New Wave Jiu-Jitsu", shortName: "New Wave", ...pub,
  });
  await addMembership(db, {
    athleteId: gordon.id, teamId: team.id, role: "competitor",
    startDate: "2021-06-01", ...{ confidence: "CONFIRMED" as const },
  });

  // Superfight: Gordon def. Galvao by decision.
  const superfight = await createMatch(db, {
    eventId: event.id,
    matchType: "SUPERFIGHT",
    ruleset: "ADCC",
    method: "DECISION",
    competitors: [
      { athleteId: gordon.id, outcome: "WON", slotOrder: 1 },
      { athleteId: galvao.id, outcome: "LOST", slotOrder: 2 },
    ],
    ...pub,
  });

  // Bracket final: Gordon def. Meregali by submission.
  await createMatch(db, {
    eventId: event.id,
    matchType: "BRACKET",
    round: "Final",
    weightClass: "Absolute",
    ruleset: "ADCC",
    method: "SUBMISSION",
    methodDetail: "Rear Naked Choke",
    durationSeconds: 300,
    competitors: [
      { athleteId: gordon.id, outcome: "WON", slotOrder: 1 },
      { athleteId: meregali.id, outcome: "LOST", slotOrder: 2 },
    ],
    ...pub,
  });

  await addPlacement(db, {
    eventId: event.id, athleteId: gordon.id, division: "Absolute", place: 1,
    confidence: "CONFIRMED",
  });
  await addPlacement(db, {
    eventId: event.id, athleteId: meregali.id, division: "Absolute", place: 2,
    confidence: "CONFIRMED",
  });

  await addVideo(db, {
    matchId: superfight.id,
    url: "https://www.youtube.com/watch?v=example",
    title: "Gordon Ryan vs Andre Galvao — ADCC 2022 Superfight",
    confidence: "CONFIRMED",
  });

  await addInstructional(db, {
    athleteId: gordon.id,
    title: "Systematically Attacking the Guard",
    affiliateUrl: "https://bjjfanatics.com/products/systematically-attacking-the-guard",
    confidence: "CONFIRMED",
  });

  return {
    athletes: { gordon, galvao, meregali },
    promotion: adcc,
    event,
    team,
  };
}
