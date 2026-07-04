import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { placements, type Placement } from "@/db/schema/placement";

export type AddPlacementInput = {
  eventId: string;
  athleteId: string;
  division: string;
  place: number;
  sourceUrl?: string;
  verifiedBy?: string;
  confidence?: "CONFIRMED" | "NEEDS_REVIEW";
};

export async function addPlacement(
  db: Db,
  input: AddPlacementInput,
): Promise<Placement> {
  const rows = await db
    .insert(placements)
    .values({
      eventId: input.eventId,
      athleteId: input.athleteId,
      division: input.division,
      place: input.place,
      sourceUrl: input.sourceUrl ?? null,
      verifiedBy: input.verifiedBy ?? null,
      verifiedAt: input.verifiedBy ? new Date() : null,
      confidence: input.confidence ?? "NEEDS_REVIEW",
    })
    .returning();
  const placement = rows[0];
  if (!placement) throw new Error("addPlacement: insert returned no rows");
  return placement;
}

export async function listPlacementsForEvent(
  db: Db,
  eventId: string,
): Promise<Placement[]> {
  return db.select().from(placements).where(eq(placements.eventId, eventId));
}
