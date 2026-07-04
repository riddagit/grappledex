CREATE TABLE "instructionals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"title" text NOT NULL,
	"affiliate_url" text NOT NULL,
	"thumbnail_url" text,
	"source_url" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"confidence" text DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructionals_athlete_affiliate_url_uq" UNIQUE("athlete_id","affiliate_url")
);
--> statement-breakpoint
ALTER TABLE "instructionals" ADD CONSTRAINT "instructionals_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instructionals_athlete_id_idx" ON "instructionals" USING btree ("athlete_id");