import {
  pgTable, uuid, text, real, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";

export const ingestionBatches = pgTable("ingestion_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceText: text("source_text").notNull(),
  sourceNote: text("source_note"),
  createdBy: text("created_by"),
  status: text("status", {
    enum: ["extracting", "review", "committed", "failed"],
  })
    .notNull()
    .default("extracting"),
  model: text("model"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ingestionCandidates = pgTable(
  "ingestion_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => ingestionBatches.id, { onDelete: "cascade" }),
    entityType: text("entity_type", {
      enum: ["athlete", "promotion", "event", "match", "placement"],
    }).notNull(),
    payload: jsonb("payload").notNull(),
    localRef: text("local_ref").notNull(),
    resolvedEntityId: uuid("resolved_entity_id"),
    resolvedEntityType: text("resolved_entity_type"),
    matchScore: real("match_score"),
    decision: text("decision", {
      enum: ["pending", "accept", "merge", "reject"],
    })
      .notNull()
      .default("pending"),
    committedEntityId: uuid("committed_entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ingestion_candidates_batch_id_idx").on(t.batchId)],
);

export type IngestionBatch = typeof ingestionBatches.$inferSelect;
export type NewIngestionBatch = typeof ingestionBatches.$inferInsert;
export type IngestionCandidate = typeof ingestionCandidates.$inferSelect;
export type NewIngestionCandidate = typeof ingestionCandidates.$inferInsert;
