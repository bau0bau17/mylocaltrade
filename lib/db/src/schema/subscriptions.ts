import { pgTable, serial, integer, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id).unique(),
  planId: varchar("plan_id", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("inactive"),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  // The date of the trader's FIRST purchase, set once and never reset on
  // renewal. This is the legal anchor for the 14-day cooling-off window — a
  // renewal does not start a fresh right to cancel. Existing rows are backfilled
  // from createdAt; the read path falls back to createdAt when this is null.
  originalPurchaseAt: timestamp("original_purchase_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;
