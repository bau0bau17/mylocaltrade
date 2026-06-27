import {
  pgTable,
  serial,
  integer,
  varchar,
  boolean,
  timestamp,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { subscriptionsTable } from "./subscriptions";

// The statutory cooling-off window length (UK Consumer Contracts Regulations
// 2013). Kept here so the schema, backend and any future tooling agree.
export const COOLING_OFF_DAYS = 14;

export const CANCELLATION_REQUEST_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "DISMISSED",
] as const;
export type CancellationRequestStatus =
  (typeof CANCELLATION_REQUEST_STATUSES)[number];

// Which provider owns the underlying subscription. This drives how support
// actions the request: "apple" requests are cancelled/refunded by Apple (we
// only record and assist), "stripe" requests are processed by our team.
export const CANCELLATION_PROVIDERS = ["apple", "stripe", "demo"] as const;
export type CancellationProvider = (typeof CANCELLATION_PROVIDERS)[number];

// A structured record of a trader asking to cancel during (or around) their
// cooling-off period. Phase 1 is file-and-record only: creating a request never
// mutates the subscription, plan, perks or verification — support handles the
// actual cancellation/refund externally and records the outcome here.
export const cancellationRequestsTable = pgTable(
  "cancellation_requests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    subscriptionId: integer("subscription_id").references(
      () => subscriptionsTable.id,
    ),
    provider: varchar("provider", { length: 20 }).notNull(),
    // Snapshot, computed server-side at request time, of whether the trader was
    // still within their 14-day cooling-off window.
    withinCoolingOff: boolean("within_cooling_off").notNull().default(false),
    originalPurchaseAt: timestamp("original_purchase_at"),
    coolingOffEndsAt: timestamp("cooling_off_ends_at"),
    userNote: text("user_note"),
    status: varchar("status", { length: 20 }).notNull().default("OPEN"),
    resolutionNotes: text("resolution_notes"),
    handledByAdminId: integer("handled_by_admin_id").references(
      () => usersTable.id,
    ),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("cancellation_requests_status_idx").on(table.status),
    createdAtIdx: index("cancellation_requests_created_at_idx").on(
      table.createdAt,
    ),
    userIdx: index("cancellation_requests_user_idx").on(table.userId),
    // Enforce at most one ACTIVE (OPEN/IN_PROGRESS) request per user at the DB
    // level. The application also checks first, but this partial unique index
    // closes the SELECT-then-INSERT race under concurrent submissions.
    oneActivePerUser: uniqueIndex("cancellation_requests_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.status} in ('OPEN', 'IN_PROGRESS')`),
  }),
);

export type CancellationRequest = typeof cancellationRequestsTable.$inferSelect;
export type InsertCancellationRequest =
  typeof cancellationRequestsTable.$inferInsert;
