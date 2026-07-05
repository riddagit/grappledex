import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import { createPromotion } from "@/lib/promotions/service";
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
  events: [],
  matches: [],
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
});
