import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { instructionals, type Instructional } from "@/db/schema/instructional";
import { athletes } from "@/db/schema/athlete";

export type AddInstructionalInput = {
  athleteId: string;
  title: string;
  affiliateUrl: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
};

export type InstructionalWithInstructor = Instructional & {
  instructorName: string;
  instructorSlug: string;
};

export async function addInstructional(
  db: Db,
  input: AddInstructionalInput,
): Promise<Instructional> {
  const rows = await db
    .insert(instructionals)
    .values({
      athleteId: input.athleteId,
      title: input.title,
      affiliateUrl: input.affiliateUrl,
      thumbnailUrl: input.thumbnailUrl ?? null,
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
    })
    .returning();
  const inst = rows[0];
  if (!inst) throw new Error("addInstructional: insert returned no rows");
  return inst;
}

export async function listInstructionalsForAthlete(
  db: Db,
  athleteId: string,
): Promise<Instructional[]> {
  return db
    .select()
    .from(instructionals)
    .where(eq(instructionals.athleteId, athleteId));
}

export async function listInstructionals(
  db: Db,
): Promise<InstructionalWithInstructor[]> {
  const rows = await db
    .select({
      instructional: instructionals,
      instructorName: athletes.fullName,
      instructorSlug: athletes.slug,
    })
    .from(instructionals)
    .innerJoin(athletes, eq(instructionals.athleteId, athletes.id));
  return rows.map((r) => ({
    ...r.instructional,
    instructorName: r.instructorName,
    instructorSlug: r.instructorSlug,
  }));
}
