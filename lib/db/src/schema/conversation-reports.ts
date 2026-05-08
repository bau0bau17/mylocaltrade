import { pgTable, serial, integer, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

export const conversationReportsTable = pgTable(
  "conversation_reports",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id),
    reportedByUserId: integer("reported_by_user_id").notNull().references(() => usersTable.id),
    reportedByRole: varchar("reported_by_role", { length: 16 }).notNull(),
    reason: text("reason").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("OPEN"),
    resolutionNotes: text("resolution_notes"),
    resolvedByAdminId: integer("resolved_by_admin_id").references(() => usersTable.id),
    resolvedAt: timestamp("resolved_at"),
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
