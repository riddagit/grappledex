import { z } from "zod";

export const IngestSchema = z
  .object({
    sourceText: z.string().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    sourceNote: z.string().optional(),
  })
  .refine(
    (v) => (v.sourceText === undefined) !== (v.sourceUrl === undefined),
    { message: "Provide exactly one of sourceText or sourceUrl" },
  );

export const DecisionSchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(["pending", "accept", "merge", "reject"]),
});
