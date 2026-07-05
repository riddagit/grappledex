CREATE TABLE "ingestion_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_text" text NOT NULL,
	"source_note" text,
	"created_by" text,
	"status" text DEFAULT 'extracting' NOT NULL,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"local_ref" text NOT NULL,
	"resolved_entity_id" uuid,
	"resolved_entity_type" text,
	"match_score" real,
	"decision" text DEFAULT 'pending' NOT NULL,
	"committed_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestion_candidates" ADD CONSTRAINT "ingestion_candidates_batch_id_ingestion_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingestion_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_candidates_batch_id_idx" ON "ingestion_candidates" USING btree ("batch_id");