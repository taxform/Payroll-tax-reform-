import { pgTable, serial, text, timestamp, integer, date } from "drizzle-orm/pg-core";

// Official IRS news releases collected from irs.gov. Headlines and links only.
export const irsUpdates = pgTable("irs_updates", {
  id: serial().primaryKey(),
  url: text().notNull().unique(),
  title: text().notNull(),
  releaseNumber: text("release_number"),
  releaseDate: text("release_date"),
  publishedOn: date("published_on"),
  summary: text().notNull().default(""),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per attempt to check the IRS newsroom, successful or not.
export const feedChecks = pgTable("feed_checks", {
  id: serial().primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  status: text().notNull(),
  itemsFound: integer("items_found").notNull().default(0),
  error: text(),
});
