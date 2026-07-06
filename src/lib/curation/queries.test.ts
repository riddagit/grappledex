import { it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createEvent } from "@/lib/events/service";
import { createMatch } from "@/lib/matches/service";
import {
  draftDashboard, blockedMatchIds, publishableMatchIds,
  blockedMatches, draftAthleteSummaries,
} from "./queries";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

// A draft event + promotion to hang matches on.
async function seedEvent() {
  const p = await createPromotion(ctx.db, { name: "ADCC" });
  return createEvent(ctx.db, { promotionId: p.id, name: "ADCC 2022", startDate: "2022-09-17" });
}

it("classifies a clean draft match as publishable and counts drafts", async () => {
  const { db } = ctx;
  const ev = await seedEvent();
  const a = await createAthlete(db, { fullName: "Gordon Ryan" });
  const b = await createAthlete(db, { fullName: "Felipe Pena" });
  await createMatch(db, {
    eventId: ev.id, matchType: "SUPERFIGHT", method: "SUBMISSION", format: "nogi",
    competitors: [
      { athleteId: a.id, outcome: "WON", slotOrder: 1 },
      { athleteId: b.id, outcome: "LOST", slotOrder: 2 },
    ],
  });

  expect((await publishableMatchIds(db)).length).toBe(1);
  expect((await blockedMatchIds(db)).length).toBe(0);

  const d = await draftDashboard(db);
  expect(d.draftAthletes).toBe(2);
  expect(d.draftPromotions).toBe(1);
  expect(d.draftEvents).toBe(1);
  expect(d.publishableMatches).toBe(1);
  expect(d.blockedMatches).toBe(0);
  expect(d.softFlaggedMatches).toBe(0); // format is nogi
});

it("blocks a match with an 'Unknown' opponent and soft-flags format=unknown", async () => {
  const { db } = ctx;
  const ev = await seedEvent();
  const real = await createAthlete(db, { fullName: "Gordon Ryan" });
  const unknown = await createAthlete(db, { fullName: "Unknown" });
  const other = await createAthlete(db, { fullName: "Andre Galvao" });

  // Blocked: competitor named "Unknown".
  await createMatch(db, {
    eventId: ev.id, matchType: "SUPERFIGHT", method: "POINTS", format: "nogi",
    competitors: [
      { athleteId: real.id, outcome: "WON", slotOrder: 1 },
      { athleteId: unknown.id, outcome: "LOST", slotOrder: 2 },
    ],
  });
  // Publishable but soft-flagged: format unknown, both real names.
  await createMatch(db, {
    eventId: ev.id, matchType: "SUPERFIGHT", method: "POINTS", format: "unknown",
    competitors: [
      { athleteId: real.id, outcome: "WON", slotOrder: 1 },
      { athleteId: other.id, outcome: "LOST", slotOrder: 2 },
    ],
  });

  const d = await draftDashboard(db);
  expect(d.blockedMatches).toBe(1);
  expect(d.publishableMatches).toBe(1);
  expect(d.softFlaggedMatches).toBe(1);

  const blocked = await blockedMatches(db);
  expect(blocked).toHaveLength(1);
  expect(blocked[0]!.reason.toLowerCase()).toContain("unknown");

  const summaries = await draftAthleteSummaries(db);
  const gordon = summaries.find((s) => s.fullName === "Gordon Ryan")!;
  expect(gordon.publishableMatches).toBe(1); // only the non-blocked match counts
});
