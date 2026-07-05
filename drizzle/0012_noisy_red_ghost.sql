ALTER TABLE "athlete_team_memberships" DROP CONSTRAINT "athlete_team_memberships_athlete_team_start_uq";--> statement-breakpoint
ALTER TABLE "athlete_team_memberships" ALTER COLUMN "start_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "athlete_team_memberships" ADD CONSTRAINT "athlete_team_memberships_athlete_team_start_uq" UNIQUE NULLS NOT DISTINCT("athlete_id","team_id","start_date");