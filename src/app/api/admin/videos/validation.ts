import { z } from "zod";

export const AddVideoSchema = z.object({
  matchId: z.string().uuid(),
  url: z.string().url(),
  title: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
});
