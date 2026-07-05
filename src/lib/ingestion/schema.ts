import { z } from "zod";

export const AthleteCandidateSchema = z.object({
  localRef: z.string().min(1),
  fullName: z.string().min(1),
  nationality: z.string().nullable().optional(),
  aliases: z.array(z.string().min(1)).optional(),
});

export const PromotionCandidateSchema = z.object({
  localRef: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().nullable().optional(),
});

export const TeamCandidateSchema = z.object({
  localRef: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().nullable().optional(),
});

export const EventCandidateSchema = z.object({
  localRef: z.string().min(1),
  promotionRef: z.string().min(1),
  name: z.string().min(1),
  startDate: z.string().min(1), // YYYY-MM-DD
  endDate: z.string().nullable().optional(),
  venue: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
});

export const MatchCompetitorCandidateSchema = z.object({
  athleteRef: z.string().min(1),
  outcome: z.enum(["WON", "LOST", "DRAW", "NC", "DQ"]),
  slotOrder: z.number().int().nullable().optional(),
});

export const MatchCandidateSchema = z.object({
  localRef: z.string().min(1),
  eventRef: z.string().min(1),
  matchType: z.enum(["BRACKET", "SUPERFIGHT", "TRIAL", "ALTERNATE"]),
  round: z.string().nullable().optional(),
  weightClass: z.string().nullable().optional(),
  ruleset: z.string().nullable().optional(),
  method: z.enum([
    "SUBMISSION", "POINTS", "DECISION", "DQ",
    "OVERTIME", "FORFEIT", "NC", "DRAW",
  ]),
  methodDetail: z.string().nullable().optional(),
  durationSeconds: z.number().int().nullable().optional(),
  competitors: z.array(MatchCompetitorCandidateSchema),
});

export const PlacementCandidateSchema = z.object({
  localRef: z.string().min(1),
  eventRef: z.string().min(1),
  athleteRef: z.string().min(1),
  division: z.string().min(1),
  place: z.number().int().positive(),
});

export const VideoCandidateSchema = z.object({
  localRef: z.string().min(1),
  matchRef: z.string().min(1),
  url: z.string().min(1),
  title: z.string().nullable().optional(),
});

export const MembershipCandidateSchema = z.object({
  localRef: z.string().min(1),
  athleteRef: z.string().min(1),
  teamRef: z.string().min(1),
  role: z.string().nullable().optional(),
  startDate: z.string().min(1).nullable().optional(), // YYYY-MM-DD or omitted
  endDate: z.string().min(1).nullable().optional(),
});

export const ExtractionSchema = z.object({
  athletes: z.array(AthleteCandidateSchema),
  promotions: z.array(PromotionCandidateSchema),
  teams: z.array(TeamCandidateSchema),
  events: z.array(EventCandidateSchema),
  matches: z.array(MatchCandidateSchema),
  placements: z.array(PlacementCandidateSchema),
  videos: z.array(VideoCandidateSchema),
  memberships: z.array(MembershipCandidateSchema),
});

export type CandidateGraph = z.infer<typeof ExtractionSchema>;
export type AthleteCandidate = z.infer<typeof AthleteCandidateSchema>;
export type PromotionCandidate = z.infer<typeof PromotionCandidateSchema>;
export type TeamCandidate = z.infer<typeof TeamCandidateSchema>;
export type MembershipCandidate = z.infer<typeof MembershipCandidateSchema>;
export type EventCandidate = z.infer<typeof EventCandidateSchema>;
export type MatchCandidate = z.infer<typeof MatchCandidateSchema>;
export type PlacementCandidate = z.infer<typeof PlacementCandidateSchema>;
export type VideoCandidate = z.infer<typeof VideoCandidateSchema>;
