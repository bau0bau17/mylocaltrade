import { pgTable, serial, integer, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { conversationReportsTable } from "./conversation-reports";
import { conversationsTable } from "./conversations";
import { messagesTable } from "./messages";
import { enquiriesTable } from "./enquiries";
import { usersTable } from "./users";

/**
 * Immutable references to the conversation state present when a report is
 * made. This deliberately stores identifiers and existing private object
 * paths, not copies of message content or media bytes.
 */
export const conversationReportEvidenceTable = pgTable(
  "conversation_report_evidence",
  {
    id: serial("id").primaryKey(),
    conversationReportId: integer("conversation_report_id")
      .notNull()
      .references(() => conversationReportsTable.id),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id),
    messageId: integer("message_id").references(() => messagesTable.id),
    enquiryId: integer("enquiry_id").references(() => enquiriesTable.id),
    ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id),
    kind: varchar("kind", { length: 32 }).notNull(),
    sourceRef: text("source_ref").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    // NULL means the report/appeal is actively holding the reference. A
    // terminal decision starts the enforced appeal window before release.
    holdUntil: timestamp("hold_until", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => ({
    reportIdx: index("conv_report_evidence_report_idx").on(t.conversationReportId),
    pathOwnerIdx: index("conv_report_evidence_path_owner_idx").on(t.ownerUserId, t.sourceRef),
    holdIdx: index("conv_report_evidence_hold_idx").on(t.releasedAt, t.holdUntil),
  }),
);

export type ConversationReportEvidence = typeof conversationReportEvidenceTable.$inferSelect;