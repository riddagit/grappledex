import {
  pgTable, uuid, text, integer, smallint, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { events } from "./event";
import { athletes } from "./athlete";

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    matchType: text("match_type", {
      enum: ["BRACKET", "SUPERFIGHT", "TRIAL", "ALTERNATE"],
    }).notNull(),
    round: text("round"),
    weightClass: text("weight_class"),
    ruleset: text("ruleset"),
    method: text("method", {
      enum: ["SUBMISSION", "POINTS", "DECISION", "DQ", "OVERTIME", "FORFEIT", "NC", "DRAW"],
    }).notNull(),
    methodDetail: text("method_detail"),
    format: text("format", { enum: ["nogi", "gi", "unknown"] })
      .notNull()
      .default("unknown"),
    sourceRef: text("source_ref"),
    durationSeconds: integer("duration_seconds"),
    sourceUrl: text("source_url"),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    confidence: text("confidence", { enum: ["CONFIRMED", "NEEDS_REVIEW"] })
      .notNull()
      .default("NEEDS_REVIEW"),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("matches_event_id_idx").on(t.eventId),
    unique("matches_source_ref_uq").on(t.sourceRef),
  ],
);

export const matchCompetitors = pgTable(
  "match_competitors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id),
    outcome: text("outcome", {
      enum: ["WON", "LOST", "DRAW", "NC", "DQ"],
    }).notNull(),
    slotOrder: smallint("slot_order"),
  },
  (t) => [
    index("match_competitors_match_id_idx").on(t.matchId),
    index("match_competitors_athlete_id_idx").on(t.athleteId),
    unique("match_competitors_match_athlete_uq").on(t.matchId, t.athleteId),
  ],
);

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type MatchCompetitor = typeof matchCompetitors.$inferSelect;
