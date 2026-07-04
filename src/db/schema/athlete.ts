import {
  pgTable, uuid, text, timestamp, index,
} from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { tsvector } from "./tsvector";

export const athletes = pgTable("athletes", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  fullName: text("full_name").notNull(),
  nationality: text("nationality"),
  // Provision for imagery (v1 links, never re-hosts): URL of an official/external
  // portrait. Nullable — the page degrades to a text-first header when absent.
  imageUrl: text("image_url"),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
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
  searchVector: tsvector("search_vector").generatedAlwaysAs(
    (): SQL => sql`to_tsvector('simple', coalesce(${athletes.fullName}, ''))`,
  ),
}, (t) => [index("athletes_search_idx").using("gin", t.searchVector)]);

export const athleteAliases = pgTable(
  "athlete_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('simple', coalesce(${athleteAliases.alias}, ''))`,
    ),
  },
  (t) => [
    index("athlete_aliases_athlete_id_idx").on(t.athleteId),
    index("athlete_aliases_search_idx").using("gin", t.searchVector),
  ],
);

export type Athlete = typeof athletes.$inferSelect;
export type NewAthlete = typeof athletes.$inferInsert;
export type AthleteAlias = typeof athleteAliases.$inferSelect;
