import { it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { loadProfile } from "./load";
import type { BjjHeroesProfile } from "./parse";
import { athletes } from "@/db/schema/athlete";
import { matches } from "@/db/schema/match";
import { createAthlete } from "@/lib/athletes/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

const profile: BjjHeroesProfile = {
  slug: "gordon-ryan", fullName: "Gordon Ryan",
  formalName: "Gordon F. Ryan", nickname: null,
  teamName: "New Wave Jiu-Jitsu", weightLabel: "Over 100 kg",
  records: [
    { bjjHeroesId: "8858", opponentName: "Felipe Pena", outcome: "WON",
      methodRaw: "Points", competition: "ADCC 2022", weightLabel: "ABS",
      stage: "F", year: 2022 },
  ],
};

it("creates athletes, event, and a match tagged with format + source_ref", async () => {
  const { db } = ctx;
  const result = await loadProfile(db, profile, "https://www.bjjheroes.com/bjj-fighters/gordon-ryan");
  expect(result.created.matches).toBe(1);
  const allAthletes = await db.select().from(athletes);
  expect(allAthletes.map((a) => a.fullName).sort()).toEqual(["Felipe Pena", "Gordon Ryan"]);
  const m = (await db.select().from(matches).where(eq(matches.sourceRef, "bjjheroes:8858")))[0];
  expect(m?.format).toBe("nogi");
  expect(m?.status).toBe("draft");
});

it("is idempotent — re-loading the same profile creates no duplicate match", async () => {
  const { db } = ctx;
  await loadProfile(db, profile, "https://x");
  const second = await loadProfile(db, profile, "https://x");
  expect(second.created.matches).toBe(0);
  expect(second.skippedMatches).toBe(1);
  expect((await db.select().from(matches)).length).toBe(1);
});

it("routes an ambiguous opponent to conflicts instead of guessing", async () => {
  const { db } = ctx;
  // Two existing near-name athletes make 'Felype Pena' ambiguous (near, not exact).
  await createAthlete(db, { fullName: "Felipe Pena" });
  await createAthlete(db, { fullName: "Felipe Penna" });
  const p = { ...profile, records: [{ ...profile.records[0]!, opponentName: "Felype Pena" }] };
  const result = await loadProfile(db, p, "https://x");
  expect(result.conflicts.some((c) => c.kind === "ambiguous-athlete")).toBe(true);
  expect(result.created.matches).toBe(0); // match skipped, not mis-attributed
});

it("routes a self-referential opponent to conflicts instead of crashing the profile", async () => {
  const { db } = ctx;
  // The opponent name resolves to the subject themselves (exact match). Creating a
  // match would insert two competitor rows with the same (match_id, athlete_id) and
  // violate the unique constraint, aborting the whole profile. It must be skipped.
  const p = {
    ...profile,
    records: [
      { ...profile.records[0]!, bjjHeroesId: "1", opponentName: "Gordon Ryan" }, // == subject
      { ...profile.records[0]!, bjjHeroesId: "2", opponentName: "Felipe Pena" }, // normal
    ],
  };
  const result = await loadProfile(db, p, "https://x");
  expect(result.conflicts.some((c) => c.kind === "self-opponent")).toBe(true);
  expect(result.created.matches).toBe(1); // self-match skipped; the normal one still lands
});
