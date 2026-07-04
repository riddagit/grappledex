import {
  pgTable, uuid, text, smallint, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { events } from "./event";
import { athletes } from "./athlete";

export const placements = pgTable(
  "placements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id),
    division: text("division").notNull(),
    place: smallint("place").notNull(),
    sourceUrl: text("source_url"),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    confidence: text("confidence", { enum: ["CONFIRMED", "NEEDS_REVIEW"] })
      .notNull()
      .default("NEEDS_REVIEW"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("placements_event_id_idx").on(t.eventId),
    index("placements_athlete_id_idx").on(t.athleteId),
    unique("placements_event_athlete_division_uq").on(
      t.eventId, t.athleteId, t.division,
    ),
  ],
);

export type Placement = typeof placements.$inferSelect;
export type NewPlacement = typeof placements.$inferInsert;
