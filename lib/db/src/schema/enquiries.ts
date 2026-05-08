import { pgTable, serial, integer, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";

export const enquiriesTable = pgTable("enquiries", {
  id: serial("id").primaryKey(),
  traderId: integer("trader_id").notNull().references(() => traderProfilesTable.id),
  customerId: integer("customer_id").notNull().references(() => usersTable.id),
  message: text("message").notNull(),
  serviceRequired: varchar("service_required", { length: 255 }).notNull(),
  preferredDate: varchar("preferred_date", { length: 100 }),
  phone: varchar("phone", { length: 50 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reminderSentAt: timestamp("reminder_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEnquirySchema = createInsertSchema(enquiriesTable).omit({ id: true, createdAt: true });
export type InsertEnquiry = z.infer<typeof insertEnquirySchema>;
export type Enquiry = typeof enquiriesTable.$inferSelect;
