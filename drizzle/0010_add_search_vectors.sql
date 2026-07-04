ALTER TABLE "athlete_aliases" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("athlete_aliases"."alias", ''))) STORED;--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("athletes"."full_name", ''))) STORED;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("promotions"."name", '') || ' ' || coalesce("promotions"."short_name", ''))) STORED;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("events"."name", ''))) STORED;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("teams"."name", '') || ' ' || coalesce("teams"."short_name", ''))) STORED;--> statement-breakpoint
CREATE INDEX "athlete_aliases_search_idx" ON "athlete_aliases" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "athletes_search_idx" ON "athletes" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "promotions_search_idx" ON "promotions" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "events_search_idx" ON "events" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "teams_search_idx" ON "teams" USING gin ("search_vector");