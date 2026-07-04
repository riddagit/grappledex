import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { createAthlete } from "@/lib/athletes/service";
import {
  addInstructional, listInstructionalsForAthlete, listInstructionals,
} from "@/lib/instructionals/service";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => { ctx = await createTestDb(); });
afterEach(async () => { await ctx.close(); });

describe("addInstructional", () => {
  it("attaches an affiliate card to an instructor and lists it", async () => {
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const inst = await addInstructional(ctx.db, {
      athleteId: gordon.id,
      title: "Systematically Attacking the Guard",
      affiliateUrl: "https://bjjfanatics.com/products/systematically-attacking",
      thumbnailUrl: "https://cdn.example.com/thumb.jpg",
    });
    expect(inst.title).toBe("Systematically Attacking the Guard");
    const forAthlete = await listInstructionalsForAthlete(ctx.db, gordon.id);
    expect(forAthlete).toHaveLength(1);
  });

  it("rejects a duplicate (athleteId, affiliateUrl) instructional", async () => {
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    await addInstructional(ctx.db, {
      athleteId: gordon.id, title: "A", affiliateUrl: "https://bjjfanatics.com/p/dup",
    });
    await expect(
      addInstructional(ctx.db, {
        athleteId: gordon.id, title: "A (again)", affiliateUrl: "https://bjjfanatics.com/p/dup",
      }),
    ).rejects.toThrow();
  });

  it("stamps verifiedAt when verifiedBy is supplied", async () => {
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    const inst = await addInstructional(ctx.db, {
      athleteId: gordon.id, title: "V", affiliateUrl: "https://bjjfanatics.com/p/v",
      verifiedBy: "editor",
    });
    expect(inst.verifiedAt).toBeInstanceOf(Date);
  });
});

describe("listInstructionals (global browse)", () => {
  it("returns every instructional joined to its instructor name + slug", async () => {
    const gordon = await createAthlete(ctx.db, { fullName: "Gordon Ryan" });
    await addInstructional(ctx.db, {
      athleteId: gordon.id, title: "G1", affiliateUrl: "https://bjjfanatics.com/p/g1",
    });
    const all = await listInstructionals(ctx.db);
    expect(all).toHaveLength(1);
    expect(all[0]?.instructorName).toBe("Gordon Ryan");
    expect(all[0]?.instructorSlug).toBe("gordon-ryan");
  });
});
