import {
  pgTable, uuid, text, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { athletes } from "./athlete";

export const instructionals = pgTable(
  "instructionals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id),
    title: text("title").notNull(),
    affiliateUrl: text("affiliate_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
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
    index("instructionals_athlete_id_idx").on(t.athleteId),
    unique("instructionals_athlete_affiliate_url_uq").on(t.athleteId, t.affiliateUrl),
  ],
);

export type Instructional = typeof instructionals.$inferSelect;
export type NewInstructional = typeof instructionals.$inferInsert;
