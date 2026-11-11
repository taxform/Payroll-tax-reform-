CREATE TABLE "orders" (
	"id" serial PRIMARY KEY,
	"customer_email" text NOT NULL,
	"amount" numeric(12,2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
