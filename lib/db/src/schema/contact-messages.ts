import { pgTable, serial, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

export const contactMessagesTable = pgTable("contact_messages", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  subject: varchar("subject", { length: 200 }).notNull(),
  message: text("message").notNull(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (table) => [
  index("contact_messages_email_sent_at_idx").on(table.email, table.sentAt),
]);

export type ContactMessage = typeof contactMessagesTable.$inferSelect;
