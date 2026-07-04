import { z } from "zod";

export const AddInstructionalSchema = z.object({
  athleteId: z.string().uuid(),
  title: z.string().min(1),
  affiliateUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
});
