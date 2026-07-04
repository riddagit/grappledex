import { z } from "zod";

const CompetitorSchema = z.object({
  athleteId: z.string().uuid(),
  outcome: z.enum(["WON", "LOST", "DRAW", "NC", "DQ"]),
  slotOrder: z.number().int().optional(),
});

export const CreateMatchSchema = z.object({
  eventId: z.string().uuid(),
  matchType: z.enum(["BRACKET", "SUPERFIGHT", "TRIAL", "ALTERNATE"]),
  round: z.string().optional(),
  weightClass: z.string().optional(),
  ruleset: z.string().optional(),
  method: z.enum([
    "SUBMISSION", "POINTS", "DECISION", "DQ", "OVERTIME", "FORFEIT", "NC", "DRAW",
  ]),
  methodDetail: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  competitors: z.array(CompetitorSchema).min(2),
  sourceUrl: z.string().url().optional(),
  verifiedBy: z.string().optional(),
  confidence: z.enum(["CONFIRMED", "NEEDS_REVIEW"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});
