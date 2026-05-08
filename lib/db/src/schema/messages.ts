import { pgTable, serial, integer, text, varchar, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id),
    senderUserId: integer("sender_user_id").references(() => usersTable.id),
    senderRole: varchar("sender_role", { length: 16 }).notNull(),
    body: text("body").notNull(),
    systemMessage: boolean("system_message").notNull().default(false),
    readAt: timestamp("read_at"),
    editedAt: timestamp("edited_at"),
    deletedAt: timestamp("deleted_at"),
    attachmentUrl: varchar("attachment_url", { length: 500 }),
    aiSafetyFlag: varchar("ai_safety_flag", { length: 32 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    convIdx: index("msg_conv_idx").on(t.conversationId, t.createdAt),
  }),
);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;

export const MESSAGE_SENDER_ROLES = ["customer", "trader", "admin", "system"] as const;
