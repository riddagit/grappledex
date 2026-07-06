import { z } from "zod";

export const PublishRequestSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("athlete"), athleteId: z.string().uuid() }),
]);

export type PublishRequest = z.infer<typeof PublishRequestSchema>;
