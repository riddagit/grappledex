import {
  pgTable, uuid, text, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { matches } from "./match";

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    url: text("url").notNull(),
    title: text("title"),
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
    index("videos_match_id_idx").on(t.matchId),
    unique("videos_match_url_uq").on(t.matchId, t.url),
  ],
);

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
