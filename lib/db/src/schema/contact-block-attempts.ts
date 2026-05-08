import { pgTable, serial, integer, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

export const CONTACT_VIOLATION_KINDS = ["email", "phone", "url"] as const;
export type ContactViolationKind = (typeof CONTACT_VIOLATION_KINDS)[number];

export const CONTACT_BLOCK_SOURCES = ["conversation_message", "enquiry"] as const;
export type ContactBlockSource = (typeof CONTACT_BLOCK_SOURCES)[number];

export const contactBlockAttemptsTable = pgTable(
  "contact_block_attempts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id").references(() => conversationsTable.id, {
      onDelete: "cascade",
    }),
    violationKind: varchar("violation_kind", { length: 16 }).notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    snippet: text("snippet").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("contact_block_user_idx").on(t.userId, t.createdAt),
    convIdx: index("contact_block_conv_idx").on(t.conversationId, t.createdAt),
  }),
);

export type ContactBlockAttempt = typeof contactBlockAttemptsTable.$inferSelect;
export type InsertContactBlockAttempt = typeof contactBlockAttemptsTable.$inferInsert;
