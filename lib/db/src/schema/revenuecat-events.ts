import { pgTable, serial, varchar, bigint, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// --- RevenueCat webhook event ledger ---
//
// One row per webhook event we have ACCEPTED for processing, keyed by
// RevenueCat's event id. Two jobs:
//   1. Idempotency: RevenueCat retries deliveries until it sees a 2xx — a
//      redelivered event id hits the unique index and is skipped (200,
//      no state mutation).
//   2. Forensics: what arrived, when, and with which event timestamp —
//      needed to reason about out-of-order handling after the fact.
// Rows are append-only and never updated. Events REJECTED before processing
// (bad auth, unknown entitlement, anonymous user) are not recorded.

export const revenuecatEventsTable = pgTable(
  "revenuecat_events",
  {
    id: serial("id").primaryKey(),
    // RevenueCat event UUID. Unique — the dedupe key.
    eventId: varchar("event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    // RevenueCat app_user_id the event addressed (our numeric user id as a
    // string; kept as text verbatim for forensics).
    appUserId: varchar("app_user_id", { length: 255 }),
    productId: varchar("product_id", { length: 255 }),
    // RevenueCat's event timestamp (ms) — the ORDERING authority, not our
    // arrival time.
    eventTimestampMs: bigint("event_timestamp_ms", { mode: "number" }),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
  },
  (t) => ({
    eventIdUnique: uniqueIndex("revenuecat_events_event_id_unique_idx").on(t.eventId),
    appUserIdx: index("revenuecat_events_app_user_idx").on(t.appUserId),
  }),
);

export type RevenuecatEvent = typeof revenuecatEventsTable.$inferSelect;
