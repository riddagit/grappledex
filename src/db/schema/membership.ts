import {
  pgTable, uuid, text, date, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { athletes } from "./athlete";
import { teams } from "./team";

export const athleteTeamMemberships = pgTable(
  "athlete_team_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    role: text("role"),
    // Nullable: articles rarely state when an athlete joined a team. The unique
    // constraint below uses NULLS NOT DISTINCT so one unknown-date membership per
    // athlete+team still dedups (Postgres 15+).
    startDate: date("start_date"),
    endDate: date("end_date"),
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
    index("athlete_team_memberships_athlete_id_idx").on(t.athleteId),
    index("athlete_team_memberships_team_id_idx").on(t.teamId),
    unique("athlete_team_memberships_athlete_team_start_uq").on(
      t.athleteId, t.teamId, t.startDate,
    ).nullsNotDistinct(),
  ],
);

export type Membership = typeof athleteTeamMemberships.$inferSelect;
export type NewMembership = typeof athleteTeamMemberships.$inferInsert;
