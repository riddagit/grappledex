CREATE TABLE "placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"division" text NOT NULL,
	"place" smallint NOT NULL,
	"source_url" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"confidence" text DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placements_event_athlete_division_uq" UNIQUE("event_id","athlete_id","division")
);
--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "placements_event_id_idx" ON "placements" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "placements_athlete_id_idx" ON "placements" USING btree ("athlete_id");