CREATE TABLE "feed_checks" (
	"id" serial PRIMARY KEY,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"items_found" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "irs_updates" (
	"id" serial PRIMARY KEY,
	"url" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"release_number" text,
	"release_date" text,
	"published_on" date,
	"summary" text DEFAULT '' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
