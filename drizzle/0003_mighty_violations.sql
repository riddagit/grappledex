CREATE TABLE "match_competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"slot_order" smallint,
	CONSTRAINT "match_competitors_match_athlete_uq" UNIQUE("match_id","athlete_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"match_type" text NOT NULL,
	"round" text,
	"weight_class" text,
	"ruleset" text,
	"method" text NOT NULL,
	"method_detail" text,
	"duration_seconds" integer,
	"source_url" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"confidence" text DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_competitors" ADD CONSTRAINT "match_competitors_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_competitors" ADD CONSTRAINT "match_competitors_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_competitors_match_id_idx" ON "match_competitors" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_competitors_athlete_id_idx" ON "match_competitors" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "matches_event_id_idx" ON "matches" USING btree ("event_id");