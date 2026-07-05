import { z } from "zod";

export const IngestSchema = z.object({
  sourceText: z.string().min(1),
  sourceNote: z.string().optional(),
});

export const DecisionSchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(["pending", "accept", "merge", "reject"]),
});
