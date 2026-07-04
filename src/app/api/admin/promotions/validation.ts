import { z } from "zod";

export const CreatePromotionSchema = z.object({
  name: z.string().min(1),
  shortName: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});
