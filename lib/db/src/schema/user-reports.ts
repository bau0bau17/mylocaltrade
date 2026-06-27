import { pgTable, serial, integer, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";
import { conversationsTable } from "./conversations";

// Profile-level reports about a *person* (a trader or a customer), as opposed to
// `conversation_reports` which are about a specific chat thread. A customer can
// report a trader straight from their profile (no conversation required); a
// trader can report a customer they are in contact with. Login is required so
// every report has a traceable "who reported whom" for moderation.
export const userReportsTable = pgTable(
  "user_reports",
  {
    id: serial("id").primaryKey(),
    reporterUserId: integer("reporter_user_id").notNull().references(() => usersTable.id),
    reporterRole: varchar("reporter_role", { length: 16 }).notNull(),
    reportedUserId: integer("reported_user_id").notNull().references(() => usersTable.id),
    reportedRole: varchar("reported_role", { length: 16 }).notNull(),
    // Convenience pointer when the subject is a trader, so the admin queue can
    // join straight to the business name without re-deriving it.
    reportedTraderProfileId: integer("reported_trader_profile_id").references(() => traderProfilesTable.id),
    category: varchar("category", { length: 48 }).notNull(),
    detail: text("detail"),
    status: varchar("status", { length: 16 }).notNull().default("OPEN"),
    resolutionNotes: text("resolution_notes"),
    resolvedByAdminId: integer("resolved_by_admin_id").references(() => usersTable.id),
    resolvedAt: timestamp("resolved_at"),
    // Optional context if the report was raised from within a conversation.
    conversationId: integer("conversation_id").references(() => conversationsTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("user_report_status_idx").on(t.status, t.createdAt),
    reportedIdx: index("user_report_reported_idx").on(t.reportedUserId),
  }),
);

export const insertUserReportSchema = createInsertSchema(userReportsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUserReport = z.infer<typeof insertUserReportSchema>;
export type UserReport = typeof userReportsTable.$inferSelect;

export const USER_REPORT_STATUSES = ["OPEN", "RESOLVED", "DISMISSED"] as const;
export type UserReportStatus = (typeof USER_REPORT_STATUSES)[number];

// The party a report is *about*. Drives which category set applies.
export const REPORT_SUBJECTS = ["trader", "customer"] as const;
export type ReportSubject = (typeof REPORT_SUBJECTS)[number];

export interface ReportCategoryOption {
  value: string;
  label: string;
}

// Predefined, structured reasons so reports are consistent and moderation-friendly
// rather than free text only. "OTHER" always requires a written detail.
export const TRADER_REPORT_CATEGORIES: readonly ReportCategoryOption[] = [
  { value: "MISLEADING_PROFILE", label: "Misleading profile information" },
  { value: "FRAUD", label: "Suspected fraud or dishonesty" },
  { value: "UNSAFE_WORK", label: "Unsafe work or safety concern" },
  { value: "LAPSED_CREDENTIALS", label: "Lapsed insurance or qualifications" },
  { value: "ABUSIVE_BEHAVIOUR", label: "Abusive or threatening behaviour" },
  { value: "UNCERTIFIED_WORK", label: "Working without required certification" },
  { value: "OTHER", label: "Something else" },
] as const;

export const CUSTOMER_REPORT_CATEGORIES: readonly ReportCategoryOption[] = [
  { value: "ABUSIVE_BEHAVIOUR", label: "Abusive or threatening behaviour" },
  { value: "SPAM_TIMEWASTING", label: "Spam or time-wasting" },
  { value: "FRAUDULENT_ENQUIRY", label: "Fraudulent or scam enquiry" },
  { value: "INAPPROPRIATE_CONTENT", label: "Inappropriate content" },
  { value: "OTHER", label: "Something else" },
] as const;

// Keyed by the subject being reported.
export const REPORT_CATEGORIES: Record<ReportSubject, readonly ReportCategoryOption[]> = {
  trader: TRADER_REPORT_CATEGORIES,
  customer: CUSTOMER_REPORT_CATEGORIES,
};

export function reportCategoriesFor(subject: ReportSubject): readonly ReportCategoryOption[] {
  return REPORT_CATEGORIES[subject];
}

export function isValidReportCategory(subject: ReportSubject, category: string): boolean {
  return REPORT_CATEGORIES[subject].some((c) => c.value === category);
}
