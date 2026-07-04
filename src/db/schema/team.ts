import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { tsvector } from "./tsvector";

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name"),
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
  searchVector: tsvector("search_vector").generatedAlwaysAs(
    (): SQL => sql`to_tsvector('simple', coalesce(${teams.name}, '') || ' ' || coalesce(${teams.shortName}, ''))`,
  ),
}, (t) => [index("teams_search_idx").using("gin", t.searchVector)]);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
