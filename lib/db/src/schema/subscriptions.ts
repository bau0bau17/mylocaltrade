import { pgTable, serial, integer, varchar, boolean, timestamp, bigint } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id).unique(),
  planId: varchar("plan_id", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("inactive"),
  // LEGACY: web (Stripe) billing was removed before ever launching. These
  // columns are intentionally kept (always NULL in production) until a future
  // dedicated database cleanup migration drops them. Do not write to them.
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  // The store product that granted the current access (e.g.
  // "com.mylocaltrade.app.trader.yearly"), persisted by revenuecat-sync and
  // the RevenueCat webhook on every grant. Source of truth for deriving the
  // business tier (solo vs team seat plans) — never derived client-side.
  // NULL for legacy rows and demo activations (treated as solo tier).
  productIdentifier: varchar("product_identifier", { length: 255 }),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  // The date of the trader's FIRST purchase, set once and never reset on
  // renewal. This is the legal anchor for the 14-day cooling-off window — a
  // renewal does not start a fresh right to cancel. Existing rows are backfilled
  // from createdAt; the read path falls back to createdAt when this is null.
  originalPurchaseAt: timestamp("original_purchase_at"),
  // Timestamp (ms) of the newest RevenueCat webhook event applied to this
  // row. Ordering guard: an arriving event whose event timestamp is OLDER
  // than this value must not mutate state (late/out-of-order delivery —
  // e.g. a delayed EXPIRATION after a newer re-subscribe grant). NULL for
  // rows that predate the guard: first event wins and sets it.
  lastProviderEventAtMs: bigint("last_provider_event_at_ms", { mode: "number" }),
  // Set when RevenueCat reports a BILLING_ISSUE for the current period and
  // cleared by the next successful grant (renewal/uncancellation/purchase).
  // Access is NOT revoked here — Apple's own grace handling decides that via
  // expiration; this only powers user-facing "check your payment method"
  // messaging.
  billingIssueDetectedAt: timestamp("billing_issue_detected_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;
