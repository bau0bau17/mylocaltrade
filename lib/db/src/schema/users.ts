import { pgTable, serial, text, boolean, timestamp, varchar, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * GDPR / account-deletion lifecycle. Null means the account is in normal
 * use; otherwise the value drives both auth (the user is locked out) and
 * public visibility (trader profile is hidden from search and detail).
 *
 *  - REQUESTED                  : user submitted a deletion request. Sessions
 *                                 revoked, push tokens cleared, profile hidden.
 *  - DISABLED_PENDING_RETENTION : admin marked the account as needing legal
 *                                 retention (e.g. open dispute, fraud check).
 *                                 Still locked out; data preserved until the
 *                                 retention window expires.
 *  - ANONYMISED                 : PII has been wiped but the row is kept so
 *                                 historical records (reviews, audit) stay
 *                                 referentially intact. The user can never
 *                                 log in again.
 *  - COMPLETED                  : the account has been fully deactivated and
 *                                 the soft-delete timestamp has been set on
 *                                 `deletedAt`. Terminal state.
 */
export const ACCOUNT_DELETION_STATUSES = [
  "REQUESTED",
  "DISABLED_PENDING_RETENTION",
  "ANONYMISED",
  "COMPLETED",
] as const;
export type AccountDeletionStatus = (typeof ACCOUNT_DELETION_STATUSES)[number];

export const usersTable = pgTable(
  "users",
  {
  id: serial("id").primaryKey(),
  // NOT globally unique: admin-portal accounts (role "admin") are a separate
  // identity space from app accounts, so the same email may exist once in
  // each space. Uniqueness is enforced per-space by the two partial unique
  // indexes below (exact-case, matching the historical constraint — legacy
  // data contains case-variant duplicates, so no lower(email) index).
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  role: varchar("role", { length: 20 }).notNull().default("customer"),
  // Admin tier: super admins see audit logs and manage the admin team.
  // Regular admins ("normal users" in the console) handle day-to-day
  // verification/moderation but cannot view audit trails or manage staff.
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationSentAt: timestamp("email_verification_sent_at"),
  // In-app email verification code (6-digit OTP). Mirrors the trader phone
  // OTP fields. The link-based token above remains as a web fallback; both
  // paths verify the same account.
  emailOtpHash: text("email_otp_hash"),
  emailOtpExpiresAt: timestamp("email_otp_expires_at"),
  emailOtpAttempts: integer("email_otp_attempts").notNull().default(0),
  // Password reset code (6-digit OTP). Mirrors the email verification OTP
  // fields above. Used by the forgot-password / reset-password flow for all
  // account types (customer, trader, admin).
  passwordResetOtpHash: text("password_reset_otp_hash"),
  passwordResetOtpExpiresAt: timestamp("password_reset_otp_expires_at"),
  passwordResetOtpAttempts: integer("password_reset_otp_attempts").notNull().default(0),
  passwordResetSentAt: timestamp("password_reset_sent_at"),
  // Customer phone verification (SMS OTP). Mirrors the trader phone OTP
  // fields on trader_profiles; traders keep using those. Policy: a customer
  // must verify a UK mobile by SMS before first contacting a trader
  // (enquiry / accepting a quote or offer). phoneOtpHash null while a Twilio
  // Verify check is pending means Twilio owns the code (same convention as
  // the trader flow).
  phoneVerified: boolean("phone_verified").notNull().default(false),
  phoneVerifiedAt: timestamp("phone_verified_at"),
  phoneOtpHash: text("phone_otp_hash"),
  phoneOtpExpiresAt: timestamp("phone_otp_expires_at"),
  phoneOtpAttempts: integer("phone_otp_attempts").notNull().default(0),
  phoneOtpLastSentAt: timestamp("phone_otp_last_sent_at"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  plan: varchar("plan", { length: 20 }),
  pushNotificationsEnabled: boolean("push_notifications_enabled").notNull().default(true),
  // Stamped whenever at least one Expo push ticket comes back "ok" for this
  // user. Powers the admin notification-health view ("why didn't this user
  // get notified?"). Null = no successful delivery recorded yet.
  lastPushDeliveredAt: timestamp("last_push_delivered_at"),
  tokenVersion: integer("token_version").notNull().default(1),

  // --- GDPR / account deletion (Phase: account-deletion) ---
  deletionStatus: varchar("deletion_status", { length: 40 }),
  deletionRequestedAt: timestamp("deletion_requested_at"),
  deletionReason: text("deletion_reason"),
  deletionProcessedAt: timestamp("deletion_processed_at"),
  scheduledHardDeleteAt: timestamp("scheduled_hard_delete_at"),
  anonymisedAt: timestamp("anonymised_at"),
  retentionReason: text("retention_reason"),
  retentionUntil: timestamp("retention_until"),
  accountDisabledAt: timestamp("account_disabled_at"),
  marketingOptOutAt: timestamp("marketing_opt_out_at"),
  adminDeletionNotes: text("admin_deletion_notes"),
  processedByAdminId: integer("processed_by_admin_id"),

  // --- Admin moderation: account-level suspension ---
  // Set when an admin suspends the account from the moderation queue (e.g.
  // repeat contact-bypass offenders). While suspendedAt is non-null the user
  // cannot send messages or create enquiries. Cleared on unsuspend.
  suspendedAt: timestamp("suspended_at"),
  suspendedReason: text("suspended_reason"),
  suspendedByAdminId: integer("suspended_by_admin_id"),

  // --- Login lockout (per-account, DB-backed so it works across instances) ---
  // Counts consecutive failed password attempts since the last successful
  // login or lockout expiry. Reset to 0 on any successful login.
  loginFailedAttempts: integer("login_failed_attempts").notNull().default(0),
  // When non-null the account is locked out until this timestamp. The login
  // handler checks this before running bcrypt so locked accounts incur no
  // extra CPU cost regardless of which instance handles the request.
  loginLockedUntil: timestamp("login_locked_until"),

  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Per-identity-space email uniqueness (replaces the old global
    // users_email_unique constraint): one app account (customer/trader)
    // and one admin-portal account may share an email.
    appEmailUnique: uniqueIndex("users_email_app_unique")
      .on(t.email)
      .where(sql`role <> 'admin'`),
    adminEmailUnique: uniqueIndex("users_email_admin_unique")
      .on(t.email)
      .where(sql`role = 'admin'`),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
