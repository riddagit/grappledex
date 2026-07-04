CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"source_url" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"confidence" text DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_match_url_uq" UNIQUE("match_id","url")
);
--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "videos_match_id_idx" ON "videos" USING btree ("match_id");