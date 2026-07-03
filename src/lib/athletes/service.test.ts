import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  createAthlete, findAthleteDuplicates, searchAthletes,
} from "@/lib/athletes/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("createAthlete", () => {
  it("creates an athlete with a derived slug and stamps verification", async () => {
    const a = await createAthlete(ctx.db, {
      fullName: "Gordon Ryan",
      verifiedBy: "editor@grappledex",
      confidence: "CONFIRMED",
      sourceUrl: "https://adcombat.com/results",
    });
    expect(a.slug).toBe("gordon-ryan");
    expect(a.confidence).toBe("CONFIRMED");
    expect(a.verifiedAt).not.toBeNull();
  });

  it("disambiguates slug collisions", async () => {
    const a = await createAthlete(ctx.db, { fullName: "John Smith" });
    const b = await createAthlete(ctx.db, { fullName: "John Smith" });
    expect(a.slug).toBe("john-smith");
    expect(b.slug).toBe("john-smith-2");
  });

  it("stores provided aliases", async () => {
    await createAthlete(ctx.db, { fullName: "Nicky Rodriguez", aliases: ["Nicky Rod"] });
    const hits = await findAthleteDuplicates(ctx.db, "Nicky Rod");
    expect(hits[0]?.name).toBe("Nicky Rodriguez");
  });
});

describe("findAthleteDuplicates", () => {
  it("flags a near-duplicate before a second insert", async () => {
    await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const hits = await findAthleteDuplicates(ctx.db, "Gordon Ryann");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.score).toBeGreaterThan(0.82);
  });

  it("returns empty for a clearly new name", async () => {
    await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    expect(await findAthleteDuplicates(ctx.db, "Roger Gracie")).toEqual([]);
  });
});

describe("searchAthletes", () => {
  it("finds by case-insensitive substring", async () => {
    await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const rows = await searchAthletes(ctx.db, "gordon");
    expect(rows[0]?.slug).toBe("gordon-ryan");
  });
});
