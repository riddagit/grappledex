import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createTeam } from "@/lib/teams/service";
import {
  addMembership, endMembership, listMembershipsForAthlete, teamRoster,
} from "@/lib/memberships/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

async function seed() {
  const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
  const dds = await createTeam(ctx.db, { name: "Danaher Death Squad", shortName: "DDS" });
  const newWave = await createTeam(ctx.db, { name: "New Wave Jiu-Jitsu", shortName: "New Wave" });
  return { gordon, dds, newWave };
}

describe("addMembership / teamRoster", () => {
  it("records a current membership that shows on the team's current roster", async () => {
    const { gordon, newWave } = await seed();
    const m = await addMembership(ctx.db, {
      athleteId: gordon.id, teamId: newWave.id, role: "competitor", startDate: "2021-06-01",
    });
    expect(m.endDate).toBeNull();

    const roster = await teamRoster(ctx.db, newWave.id);
    expect(roster.current).toHaveLength(1);
    expect(roster.current[0]?.fullName).toBe("Gordon Ryan");
    expect(roster.alumni).toHaveLength(0);
  });

  it("rejects a duplicate (athlete, team, startDate) membership", async () => {
    const { gordon, dds } = await seed();
    await addMembership(ctx.db, { athleteId: gordon.id, teamId: dds.id, startDate: "2015-01-01" });
    await expect(
      addMembership(ctx.db, { athleteId: gordon.id, teamId: dds.id, startDate: "2015-01-01" }),
    ).rejects.toThrow();
  });
});

describe("endMembership + team-history timeline", () => {
  it("models a transfer: old tenure ends (→ alumni), new tenure is current", async () => {
    const { gordon, dds, newWave } = await seed();
    const ddsStint = await addMembership(ctx.db, {
      athleteId: gordon.id, teamId: dds.id, role: "competitor", startDate: "2015-01-01",
    });
    // Transfer: close the DDS stint, open the New Wave stint.
    const ended = await endMembership(ctx.db, ddsStint.id, "2021-06-01");
    expect(ended.endDate).toBe("2021-06-01");
    await addMembership(ctx.db, {
      athleteId: gordon.id, teamId: newWave.id, role: "competitor", startDate: "2021-06-01",
    });

    // DDS now has Gordon only as alumni; New Wave has him current.
    const ddsRoster = await teamRoster(ctx.db, dds.id);
    expect(ddsRoster.current).toHaveLength(0);
    expect(ddsRoster.alumni[0]?.fullName).toBe("Gordon Ryan");

    // The athlete's timeline shows both, current (null endDate) first.
    const timeline = await listMembershipsForAthlete(ctx.db, gordon.id);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]?.teamName).toBe("New Wave Jiu-Jitsu");
    expect(timeline[0]?.endDate).toBeNull();
    expect(timeline[1]?.teamName).toBe("Danaher Death Squad");
    expect(timeline[1]?.endDate).toBe("2021-06-01");
  });

  it("throws when ending a membership that does not exist", async () => {
    await expect(
      endMembership(ctx.db, "00000000-0000-0000-0000-000000000000", "2021-06-01"),
    ).rejects.toThrow();
  });
});
