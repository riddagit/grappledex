import { z } from "zod";

export const CreateAthleteSchema = z.object({
  fullName: z.string().min(1),
  nationality: z.string().optional(),
  aliases: z.array(z.string().min(1)).optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});
