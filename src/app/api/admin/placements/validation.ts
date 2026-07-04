import { z } from "zod";

export const AddPlacementSchema = z.object({
  eventId: z.string().uuid(),
  athleteId: z.string().uuid(),
  division: z.string().min(1),
  place: z.number().int().min(1).max(3),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
});
