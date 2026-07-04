import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CreateMembershipSchema = z.object({
  athleteId: z.string().uuid(),
  teamId: z.string().uuid(),
  role: z.string().optional(),
  startDate: z.string().regex(ISO_DATE, "expected YYYY-MM-DD"),
  endDate: z.string().regex(ISO_DATE).optional(),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
});
