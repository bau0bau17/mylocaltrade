import { pgTable, serial, integer, text, timestamp, varchar, json, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const TRADER_AUDIT_ACTIONS = [
  "TRADER_ACCOUNT_CREATED",
  "EMAIL_VERIFIED",
  "EMAIL_VERIFICATION_RESENT",
  "PHONE_OTP_SENT",
  "PHONE_OTP_FAILED",
  "PHONE_VERIFIED",
  "BUSINESS_PROFILE_UPDATED",
  "BUSINESS_PROFILE_COMPLETED",
  "DOCUMENT_UPLOADED",
  "DOCUMENT_APPROVED",
  "DOCUMENT_REJECTED",
  "DOCUMENT_EXPIRED",
  "ADMIN_REQUESTED_INFO",
  "TRADER_SUBMITTED_FOR_REVIEW",
  "TRADER_APPROVED",
  "TRADER_REJECTED",
  "TRADER_SUSPENDED",
  "TRADER_UNSUSPENDED",
  "SUBSCRIPTION_ACTIVATED",
  "SUBSCRIPTION_CANCELLED",
  "PROFILE_WENT_LIVE",
  "PROFILE_HIDDEN",
  "REVIEW_SUBMITTED",
  "REVIEW_APPROVED",
  "REVIEW_REJECTED",
  "REVIEW_FLAGGED",
  "ADMIN_VIEWED_CONVERSATION",
  "ADMIN_VIEWED_DOCUMENT",
  "ADMIN_DOWNLOADED_DOCUMENT",
  "CONVERSATION_REPORT_RESOLVED",
  "AI_VERIFICATION_RAN",
  // --- Account deletion / GDPR lifecycle ---
  "ACCOUNT_DELETION_REQUESTED",
  "ACCOUNT_DELETION_CANCELLED",
  "ACCOUNT_ACCESS_DISABLED",
  "ACCOUNT_DELETION_RATE_LIMITED",
  "TRADER_PROFILE_HIDDEN_FOR_DELETION",
  "CUSTOMER_DATA_ANONYMISED",
  "ACCOUNT_RETENTION_APPLIED",
  "ACCOUNT_DELETION_COMPLETED",
  "ADMIN_VIEWED_DELETION_REQUEST",
  "ADMIN_APPROVED_DELETION_PROCESSING",
  "ADMIN_MARKED_RETENTION_REQUIRED",
] as const;
export type TraderAuditAction = (typeof TRADER_AUDIT_ACTIONS)[number];

export const traderAuditLogTable = pgTable(
  "trader_audit_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 60 }).notNull(),
    performedBy: integer("performed_by").references(() => usersTable.id),
    details: json("details").$type<Record<string, unknown>>(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("trader_audit_user_idx").on(table.userId),
    actionIdx: index("trader_audit_action_idx").on(table.action),
  })
);

export type TraderAuditLog = typeof traderAuditLogTable.$inferSelect;
export type InsertTraderAuditLog = typeof traderAuditLogTable.$inferInsert;
