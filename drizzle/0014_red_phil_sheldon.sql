ALTER TABLE "matches" ADD COLUMN "format" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_source_ref_uq" UNIQUE("source_ref");