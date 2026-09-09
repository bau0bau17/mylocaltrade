import { pgTable, serial, integer, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";
import { messagesTable } from "./messages";

export const CONVERSATION_REPORT_CATEGORIES = [
  "SUSPECTED_ILLEGAL_CONTENT",
  "HARASSMENT_ABUSE",
  "FRAUD_SCAM",
  "UNSAFE_CONTENT_CONDUCT",
  "OTHER",
] as const;
export type ConversationReportCategory = (typeof CONVERSATION_REPORT_CATEGORIES)[number];

export const conversationReportsTable = pgTable(
  "conversation_reports",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id),
    messageId: integer("message_id").references(() => messagesTable.id),
    reportedByUserId: integer("reported_by_user_id").notNull().references(() => usersTable.id),
    reportedByRole: varchar("reported_by_role", { length: 16 }).notNull(),
    reason: text("reason").notNull(),
    category: varchar("category", { length: 48 }).notNull().default("OTHER"),
    detail: text("detail"),
    status: varchar("status", { length: 16 }).notNull().default("OPEN"),
    resolutionNotes: text("resolution_notes"),
    resolvedByAdminId: integer("resolved_by_admin_id").references(() => usersTable.id),
    resolvedAt: timestamp("resolved_at"),
    outcome: varchar("outcome", { length: 24 }),
    outcomeAt: timestamp("outcome_at"),
    cseaEscalatedAt: timestamp("csea_escalated_at"),
    cseaEscalatedByAdminId: integer("csea_escalated_by_admin_id").references(() => usersTable.id),
    cseaHandledAt: timestamp("csea_handled_at"),
    cseaHandledByAdminId: integer("csea_handled_by_admin_id").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("conv_report_status_idx").on(t.status, t.createdAt),
    convIdx: index("conv_report_conv_idx").on(t.conversationId),
  }),
);

export const insertConversationReportSchema = createInsertSchema(conversationReportsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertConversationReport = z.infer<typeof insertConversationReportSchema>;
export type ConversationReport = typeof conversationReportsTable.$inferSelect;

export const CONVERSATION_REPORT_STATUSES = ["OPEN", "RESOLVED", "DISMISSED"] as const;
