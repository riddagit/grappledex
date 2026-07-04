CREATE TABLE "athlete_team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"role" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"source_url" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"confidence" text DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athlete_team_memberships_athlete_team_start_uq" UNIQUE("athlete_id","team_id","start_date")
);
--> statement-breakpoint
ALTER TABLE "athlete_team_memberships" ADD CONSTRAINT "athlete_team_memberships_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_team_memberships" ADD CONSTRAINT "athlete_team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "athlete_team_memberships_athlete_id_idx" ON "athlete_team_memberships" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "athlete_team_memberships_team_id_idx" ON "athlete_team_memberships" USING btree ("team_id");