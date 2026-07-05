import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
import { createTeam } from "@/lib/teams/service";
import { resolveCandidates } from "@/lib/ingestion/resolve";
import type { CandidateGraph } from "@/lib/ingestion/schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

const graph: CandidateGraph = {
  athletes: [
    { localRef: "a1", fullName: "Gordon Ryan" },
    { localRef: "a2", fullName: "Totally New Person" },
  ],
  promotions: [{ localRef: "p1", name: "ADCC" }],
  teams: [
    { localRef: "t1", name: "New Wave Jiu-Jitsu" },
    { localRef: "t2", name: "Brand New Gym" },
  ],
  events: [
    { localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" },
  ],
  matches: [{
    localRef: "m1", eventRef: "e1", matchType: "SUPERFIGHT", method: "DECISION",
    competitors: [{ athleteRef: "a1", outcome: "WON" }],
  }],
  placements: [
    { localRef: "pl1", eventRef: "e1", athleteRef: "a1", division: "Absolute", place: 1 },
  ],
  videos: [
    { localRef: "v1", matchRef: "m1", url: "https://youtu.be/abc" },
  ],
  memberships: [
    { localRef: "mb1", athleteRef: "a1", teamRef: "t1" },
  ],
};

describe("resolveCandidates", () => {
  it("proposes existing athletes/promotions and leaves genuinely new ones unresolved", async () => {
    await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    await createPromotion(ctx.db, { name: "ADCC" });

    const resolved = await resolveCandidates(ctx.db, graph);
    const gordon = resolved.find((r) => r.localRef === "a1")!;
    const newbie = resolved.find((r) => r.localRef === "a2")!;
    const adcc = resolved.find((r) => r.localRef === "p1")!;

    expect(gordon.resolvedEntityId).not.toBeNull();
    expect(gordon.matchScore!).toBeGreaterThanOrEqual(0.82);
    expect(newbie.resolvedEntityId).toBeNull();
    expect(adcc.resolvedEntityId).not.toBeNull();
  });

  it("emits placement candidates with no resolution proposal", async () => {
    const resolved = await resolveCandidates(ctx.db, graph);
    const placement = resolved.find((r) => r.entityType === "placement");
    expect(placement).toBeDefined();
    expect(placement!.localRef).toBe("pl1");
    expect(placement!.resolvedEntityId).toBeNull();
    expect(placement!.matchScore).toBeNull();
  });

  it("emits video candidates with no resolution proposal", async () => {
    const resolved = await resolveCandidates(ctx.db, graph);
    const video = resolved.find((r) => r.entityType === "video");
    expect(video).toBeDefined();
    expect(video!.localRef).toBe("v1");
    expect(video!.resolvedEntityId).toBeNull();
    expect(video!.matchScore).toBeNull();
  });

  it("proposes an existing team by exact name and leaves a new one unresolved", async () => {
    await createTeam(ctx.db, { name: "New Wave Jiu-Jitsu" });

    const resolved = await resolveCandidates(ctx.db, graph);
    const known = resolved.find((r) => r.localRef === "t1")!;
    const fresh = resolved.find((r) => r.localRef === "t2")!;

    expect(known.entityType).toBe("team");
    expect(known.resolvedEntityId).not.toBeNull();
    expect(fresh.resolvedEntityId).toBeNull();
  });

  it("emits membership candidates with no resolution proposal", async () => {
    const resolved = await resolveCandidates(ctx.db, graph);
    const membership = resolved.find((r) => r.entityType === "membership");
    expect(membership).toBeDefined();
    expect(membership!.localRef).toBe("mb1");
    expect(membership!.resolvedEntityId).toBeNull();
    expect(membership!.matchScore).toBeNull();
  });
});
