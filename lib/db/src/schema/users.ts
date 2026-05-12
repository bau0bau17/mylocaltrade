import { pgTable, serial, text, boolean, timestamp, varchar, integer } from "drizzle-orm/pg-core";
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

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  role: varchar("role", { length: 20 }).notNull().default("customer"),
  isActive: boolean("is_active").notNull().default(true),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationSentAt: timestamp("email_verification_sent_at"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  plan: varchar("plan", { length: 20 }),
  pushNotificationsEnabled: boolean("push_notifications_enabled").notNull().default(true),
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

  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
