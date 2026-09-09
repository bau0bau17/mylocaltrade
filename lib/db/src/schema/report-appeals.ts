import { pgTable, serial, integer, text, varchar, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { userReportsTable } from "./user-reports";
import { conversationReportsTable } from "./conversation-reports";

// Appeals attach to an existing moderation record; this is not a second report
// system. One appeal per reporter and original decision is enforced in code.
export const reportAppealsTable = pgTable("report_appeals", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").references(() => userReportsTable.id),
  conversationReportId: integer("conversation_report_id").references(() => conversationReportsTable.id),
  appellantUserId: integer("appellant_user_id").notNull().references(() => usersTable.id),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("OPEN"),
  resolution: varchar("resolution", { length: 24 }),
  resolutionNotes: text("resolution_notes"),
  resolvedByAdminId: integer("resolved_by_admin_id").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  queueIdx: index("report_appeal_queue_idx").on(t.status, t.createdAt),
  reportUnique: uniqueIndex("report_appeal_report_unique").on(t.reportId),
  conversationReportUnique: uniqueIndex("report_appeal_conversation_report_unique").on(t.conversationReportId),
  exactlyOneParent: check("report_appeal_exactly_one_parent", sql`(${t.reportId} IS NOT NULL) <> (${t.conversationReportId} IS NOT NULL)`),
}));

export const REPORT_APPEAL_STATUSES = ["OPEN", "RESOLVED", "DISMISSED"] as const;
export const REPORT_OUTCOMES = ["ACTION_TAKEN", "NO_VIOLATION", "INSUFFICIENT_EVIDENCE", "REFERRED_ESCALATED"] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];