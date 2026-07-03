CREATE TABLE "athlete_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athletes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"full_name" text NOT NULL,
	"nationality" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_url" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"confidence" text DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athletes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "athlete_aliases" ADD CONSTRAINT "athlete_aliases_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "athlete_aliases_athlete_id_idx" ON "athlete_aliases" USING btree ("athlete_id");