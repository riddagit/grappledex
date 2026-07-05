import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { FakeExtractor } from "@/lib/ingestion/extract";
import type { CandidateGraph } from "@/lib/ingestion/schema";
import {
  createBatch, runExtraction, getBatch, setDecision, commitBatch,
} from "@/lib/ingestion/service";
import { athletes } from "@/db/schema/athlete";
import { matches, matchCompetitors } from "@/db/schema/match";
import { placements } from "@/db/schema/placement";
import { videos } from "@/db/schema/video";
import { teams } from "@/db/schema/team";
import { athleteTeamMemberships } from "@/db/schema/membership";
import { createAthlete } from "@/lib/athletes/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

const graph: CandidateGraph = {
  athletes: [
    { localRef: "a1", fullName: "Gordon Ryan" },
    { localRef: "a2", fullName: "Andre Galvao" },
  ],
  promotions: [{ localRef: "p1", name: "ADCC", shortName: "ADCC" }],
  teams: [{ localRef: "t1", name: "New Wave Jiu-Jitsu", shortName: "New Wave" }],
  events: [
    { localRef: "e1", promotionRef: "p1", name: "ADCC 2022", startDate: "2022-09-17" },
  ],
  matches: [{
    localRef: "m1", eventRef: "e1", matchType: "SUPERFIGHT", method: "DECISION",
    competitors: [
      { athleteRef: "a1", outcome: "WON", slotOrder: 1 },
      { athleteRef: "a2", outcome: "LOST", slotOrder: 2 },
    ],
  }],
  placements: [
    { localRef: "pl1", eventRef: "e1", athleteRef: "a1", division: "Absolute", place: 1 },
  ],
  videos: [
    { localRef: "v1", matchRef: "m1", url: "https://youtu.be/abc", title: "Ryan vs Galvao" },
  ],
  // No startDate: exercises the nullable start_date + NULLS NOT DISTINCT path.
  memberships: [
    { localRef: "mb1", athleteRef: "a1", teamRef: "t1", role: "black belt" },
  ],
};

async function extractAll() {
  const batch = await createBatch(ctx.db, { sourceText: "raw", createdBy: "editor@x" });
  await runExtraction(ctx.db, new FakeExtractor(graph), batch.id);
  return batch;
}

async function acceptAll(batchId: string) {
  const loaded = (await getBatch(ctx.db, batchId))!;
  for (const c of loaded.candidates) await setDecision(ctx.db, c.id, "accept");
}

describe("ingestion service", () => {
  it("runExtraction persists candidates and moves the batch to review", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    expect(loaded.batch.status).toBe("review");
    // 2 athletes, 1 promo, 1 team, 1 event, 1 match, 1 placement, 1 video, 1 membership
    expect(loaded.candidates).toHaveLength(9);
  });

  it("commitBatch writes draft/NEEDS_REVIEW rows and links match competitors", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    const counts = await commitBatch(ctx.db, batch.id);
    expect(counts).toEqual({
      promotions: 1, teams: 1, events: 1, athletes: 2,
      matches: 1, placements: 1, videos: 1, memberships: 1,
    });

    const athleteRows = await ctx.db.select().from(athletes);
    expect(athleteRows).toHaveLength(2);
    expect(athleteRows.every((a) => a.status === "draft" && a.confidence === "NEEDS_REVIEW")).toBe(true);

    const matchRows = await ctx.db.select().from(matches);
    expect(matchRows).toHaveLength(1);
    const comps = await ctx.db
      .select()
      .from(matchCompetitors)
      .where(eq(matchCompetitors.matchId, matchRows[0]!.id));
    expect(comps).toHaveLength(2);

    const after = (await getBatch(ctx.db, batch.id))!;
    expect(after.batch.status).toBe("committed");
    expect(after.candidates.every((c) => c.committedEntityId !== null)).toBe(true);
  });

  it("merge reuses the existing entity instead of creating a new one", async () => {
    const existing = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    for (const c of loaded.candidates) {
      const isGordon = c.entityType === "athlete" && (c.payload as { fullName: string }).fullName === "Gordon Ryan";
      await setDecision(ctx.db, c.id, isGordon ? "merge" : "accept");
    }
    const counts = await commitBatch(ctx.db, batch.id);
    expect(counts.athletes).toBe(1); // only Galvao created; Gordon merged

    const athleteRows = await ctx.db.select().from(athletes);
    expect(athleteRows).toHaveLength(2); // existing Gordon + new Galvao
    const comps = await ctx.db.select().from(matchCompetitors);
    expect(comps.some((c) => c.athleteId === existing.id)).toBe(true);
  });

  it("rejects the commit when a match references a rejected athlete", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    for (const c of loaded.candidates) {
      const isGalvao = c.entityType === "athlete" && (c.payload as { fullName: string }).fullName === "Andre Galvao";
      await setDecision(ctx.db, c.id, isGalvao ? "reject" : "accept");
    }
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(/uncommitted athlete ref/);
  });

  it("refuses to commit a batch that is not in review", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    await commitBatch(ctx.db, batch.id);
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(/not in review/);
  });

  it("commits placements linked to the resolved event and athlete", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    await commitBatch(ctx.db, batch.id);

    const placementRows = await ctx.db.select().from(placements);
    expect(placementRows).toHaveLength(1);
    expect(placementRows[0]!.division).toBe("Absolute");
    expect(placementRows[0]!.place).toBe(1);
    expect(placementRows[0]!.confidence).toBe("NEEDS_REVIEW");

    const athleteRows = await ctx.db.select().from(athletes);
    const gordon = athleteRows.find((a) => a.fullName === "Gordon Ryan")!;
    expect(placementRows[0]!.athleteId).toBe(gordon.id);
  });

  it("rejects the commit when a placement references a rejected event", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    // Reject the event AND the match (the match also references the event, so
    // rejecting it keeps the match out of validation and isolates the placement
    // ref-check as the failing path).
    for (const c of loaded.candidates) {
      const reject = c.entityType === "event" || c.entityType === "match";
      await setDecision(ctx.db, c.id, reject ? "reject" : "accept");
    }
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(
      /placement pl1 references uncommitted event ref/,
    );
  });

  it("skips a duplicate placement instead of aborting the commit", async () => {
    // First batch commits the placement.
    const first = await extractAll();
    await acceptAll(first.id);
    await commitBatch(ctx.db, first.id);

    // Re-ingest: merge every entity that resolves to an existing row, so the
    // placement points at the same event+athlete+division. The duplicate must
    // be skipped (count 0) rather than aborting the whole transactional commit.
    const second = await extractAll();
    const loaded = (await getBatch(ctx.db, second.id))!;
    for (const c of loaded.candidates) {
      await setDecision(ctx.db, c.id, c.resolvedEntityId ? "merge" : "accept");
    }
    const counts = await commitBatch(ctx.db, second.id);
    expect(counts.placements).toBe(0);

    const placementRows = await ctx.db.select().from(placements);
    expect(placementRows).toHaveLength(1);
  });

  it("commits videos linked to the resolved match", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    await commitBatch(ctx.db, batch.id);

    const videoRows = await ctx.db.select().from(videos);
    expect(videoRows).toHaveLength(1);
    expect(videoRows[0]!.url).toBe("https://youtu.be/abc");
    expect(videoRows[0]!.title).toBe("Ryan vs Galvao");
    expect(videoRows[0]!.confidence).toBe("NEEDS_REVIEW");

    const matchRows = await ctx.db.select().from(matches);
    expect(videoRows[0]!.matchId).toBe(matchRows[0]!.id);
  });

  it("rejects the commit when a video references a rejected match", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    for (const c of loaded.candidates) {
      await setDecision(ctx.db, c.id, c.entityType === "match" ? "reject" : "accept");
    }
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(
      /video v1 references uncommitted match ref/,
    );
  });

  it("skips a duplicate video (same match + url) instead of aborting the commit", async () => {
    // Two videos on the same match with the same url collide on the
    // (match_id, url) unique constraint; the second must be skipped.
    const dupGraph: CandidateGraph = {
      ...graph,
      videos: [
        { localRef: "v1", matchRef: "m1", url: "https://youtu.be/abc" },
        { localRef: "v2", matchRef: "m1", url: "https://youtu.be/abc" },
      ],
    };
    const batch = await createBatch(ctx.db, { sourceText: "raw" });
    await runExtraction(ctx.db, new FakeExtractor(dupGraph), batch.id);
    await acceptAll(batch.id);

    const counts = await commitBatch(ctx.db, batch.id);
    expect(counts.videos).toBe(1);

    const videoRows = await ctx.db.select().from(videos);
    expect(videoRows).toHaveLength(1);
  });

  it("commits a team and a membership linking the athlete and team (null start date)", async () => {
    const batch = await extractAll();
    await acceptAll(batch.id);
    await commitBatch(ctx.db, batch.id);

    const teamRows = await ctx.db.select().from(teams);
    expect(teamRows).toHaveLength(1);
    expect(teamRows[0]!.name).toBe("New Wave Jiu-Jitsu");

    const membershipRows = await ctx.db.select().from(athleteTeamMemberships);
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0]!.startDate).toBeNull();
    expect(membershipRows[0]!.role).toBe("black belt");
    expect(membershipRows[0]!.teamId).toBe(teamRows[0]!.id);

    const athleteRows = await ctx.db.select().from(athletes);
    const gordon = athleteRows.find((a) => a.fullName === "Gordon Ryan")!;
    expect(membershipRows[0]!.athleteId).toBe(gordon.id);
  });

  it("rejects the commit when a membership references a rejected team", async () => {
    const batch = await extractAll();
    const loaded = (await getBatch(ctx.db, batch.id))!;
    for (const c of loaded.candidates) {
      await setDecision(ctx.db, c.id, c.entityType === "team" ? "reject" : "accept");
    }
    await expect(commitBatch(ctx.db, batch.id)).rejects.toThrow(
      /membership mb1 references uncommitted team ref/,
    );
  });

  it("skips a duplicate dateless membership instead of aborting the commit", async () => {
    // First batch commits the membership (athlete + team + null start date).
    const first = await extractAll();
    await acceptAll(first.id);
    await commitBatch(ctx.db, first.id);

    // Re-ingest: merge every entity that resolves to an existing row, so the
    // membership points at the same athlete + team + null start date. The
    // (athlete, team, start_date) NULLS NOT DISTINCT unique must skip it.
    const second = await extractAll();
    const loaded = (await getBatch(ctx.db, second.id))!;
    for (const c of loaded.candidates) {
      await setDecision(ctx.db, c.id, c.resolvedEntityId ? "merge" : "accept");
    }
    const counts = await commitBatch(ctx.db, second.id);
    expect(counts.memberships).toBe(0);

    const membershipRows = await ctx.db.select().from(athleteTeamMemberships);
    expect(membershipRows).toHaveLength(1);
  });
});
