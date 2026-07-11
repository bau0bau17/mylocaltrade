import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  varchar,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";

/**
 * Profile integrity: once an account is "established" (trader profile
 * submitted for review, or customer account email-verified), edits to
 * protected identity/contact fields no longer apply directly. Instead they
 * create a Profile Change Request that an admin must approve before the live
 * value is replaced. The current approved value stays active throughout.
 */

// Which fields are protected, per role. The backend intercepts edits to these
// once the account is established; everything else still saves directly.
export const PROTECTED_TRADER_FIELDS = [
  "businessName",
  "contactName",
  "phone",
  "website",
  "businessDescription",
] as const;
export type ProtectedTraderField = (typeof PROTECTED_TRADER_FIELDS)[number];

export const PROTECTED_CUSTOMER_FIELDS = ["fullName", "phone"] as const;
export type ProtectedCustomerField = (typeof PROTECTED_CUSTOMER_FIELDS)[number];

/**
 * Request lifecycle:
 *  - PENDING    : awaiting admin decision.
 *  - NEEDS_INFO : admin asked the user for more information; still active
 *                 (blocks a second request for the same field) until decided
 *                 or cancelled.
 *  - APPROVED   : admin applied the proposed value to the live record.
 *  - REJECTED   : current value kept; reason shown to the user.
 *  - CANCELLED  : user withdrew the request before a decision.
 */
export const PROFILE_CHANGE_STATUSES = [
  "PENDING",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export type ProfileChangeStatus = (typeof PROFILE_CHANGE_STATUSES)[number];

/** Statuses that count as "active" — at most one per (user, field). */
export const ACTIVE_PROFILE_CHANGE_STATUSES = ["PENDING", "NEEDS_INFO"] as const;

export const profileChangeRequestsTable = pgTable(
  "profile_change_requests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** "trader" | "customer" — denormalised so admin filtering is a plain WHERE. */
    role: varchar("role", { length: 20 }).notNull(),
    /** Set for trader requests so admin can deep-link to the trader profile. */
    traderProfileId: integer("trader_profile_id").references(
      () => traderProfilesTable.id,
      { onDelete: "set null" },
    ),
    /** Field name as used in the owning table (e.g. businessName, fullName). */
    field: varchar("field", { length: 40 }).notNull(),
    /** The approved value that stays live while the request is pending. */
    currentValue: text("current_value"),
    /** The proposed value; never exposed publicly until approved. */
    proposedValue: text("proposed_value"),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    /**
     * Phone changes only: the proposed number passed the Twilio Verify OTP
     * check before this request was created. Admin sees this flag.
     */
    phoneOtpVerified: boolean("phone_otp_verified").notNull().default(false),
    phoneOtpVerifiedAt: timestamp("phone_otp_verified_at"),
    /** Latest admin "more information required" message shown to the user. */
    adminInfoRequest: text("admin_info_request"),
    /** Admin decision reason (mandatory for rejections and sensitive fields). */
    decisionReason: text("decision_reason"),
    decidedByAdminId: integer("decided_by_admin_id").references(() => usersTable.id),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("pcr_user_idx").on(table.userId),
    statusIdx: index("pcr_status_idx").on(table.status),
    // DB-level guarantee: only one active (PENDING / NEEDS_INFO) request per
    // user+field, so conflicting concurrent submissions cannot both land.
    activeUniqueIdx: uniqueIndex("pcr_active_unique_idx")
      .on(table.userId, table.field)
      .where(sql`status in ('PENDING', 'NEEDS_INFO')`),
  }),
);

export type ProfileChangeRequest = typeof profileChangeRequestsTable.$inferSelect;
export type InsertProfileChangeRequest = typeof profileChangeRequestsTable.$inferInsert;

/** Immutable per-request audit trail (submission, info requests, decisions). */
export const PROFILE_CHANGE_EVENT_TYPES = [
  "SUBMITTED",
  "INFO_REQUESTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export type ProfileChangeEventType = (typeof PROFILE_CHANGE_EVENT_TYPES)[number];

export const profileChangeRequestEventsTable = pgTable(
  "profile_change_request_events",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => profileChangeRequestsTable.id, { onDelete: "cascade" }),
    actorUserId: integer("actor_user_id").references(() => usersTable.id),
    /** "trader" | "customer" | "admin" */
    actorRole: varchar("actor_role", { length: 20 }).notNull(),
    eventType: varchar("event_type", { length: 30 }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    requestIdx: index("pcr_events_request_idx").on(table.requestId),
  }),
);

export type ProfileChangeRequestEvent = typeof profileChangeRequestEventsTable.$inferSelect;

/**
 * OTP state for the phone-CHANGE flow (Part 3). One row per user, upserted on
 * each send. The proposed number must pass the Twilio Verify check BEFORE a
 * change request is created, and the live phone fields are never touched —
 * unlike onboarding verification, which writes to trader_profiles directly.
 */
export const phoneChangeVerificationsTable = pgTable(
  "phone_change_verifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .unique()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Proposed number, stored as E.164 when Twilio is configured. */
    phone: varchar("phone", { length: 50 }).notNull(),
    /** Local bcrypt hash for the email-fallback path; null when Twilio owns the code. */
    otpHash: text("otp_hash"),
    otpExpiresAt: timestamp("otp_expires_at"),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    otpLastSentAt: timestamp("otp_last_sent_at"),
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

export type PhoneChangeVerification = typeof phoneChangeVerificationsTable.$inferSelect;
