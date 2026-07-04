import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CreateEventSchema = z.object({
  promotionId: z.string().uuid(),
  name: z.string().min(1),
  startDate: z.string().regex(ISO_DATE, "expected YYYY-MM-DD"),
  endDate: z.string().regex(ISO_DATE).optional(),
  venue: z.string().optional(),
  location: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});
