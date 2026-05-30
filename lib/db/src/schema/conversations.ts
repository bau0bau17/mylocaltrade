import { pgTable, serial, integer, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";
import { enquiriesTable } from "./enquiries";

export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").notNull().references(() => usersTable.id),
    traderUserId: integer("trader_user_id").notNull().references(() => usersTable.id),
    traderProfileId: integer("trader_profile_id").notNull().references(() => traderProfilesTable.id),
    enquiryId: integer("enquiry_id").references(() => enquiriesTable.id),
    serviceRequired: varchar("service_required", { length: 255 }),
    postcode: varchar("postcode", { length: 16 }),
    status: varchar("status", { length: 32 }).notNull().default("AWAITING_TRADER_REPLY"),
    traderStatus: varchar("trader_status", { length: 32 }).notNull().default("NEW"),
    customerUnreadCount: integer("customer_unread_count").notNull().default(0),
    traderUnreadCount: integer("trader_unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
    lastMessagePreview: varchar("last_message_preview", { length: 200 }),
    aiSummary: text("ai_summary"),
    closedAt: timestamp("closed_at"),
    closedByRole: varchar("closed_by_role", { length: 16 }),
    blockedAt: timestamp("blocked_at"),
    customerMutedAt: timestamp("customer_muted_at"),
    customerMutedUntil: timestamp("customer_muted_until"),
    traderMutedAt: timestamp("trader_muted_at"),
    traderMutedUntil: timestamp("trader_muted_until"),
    traderViewedAt: timestamp("trader_viewed_at"),
    // Customer-driven job lifecycle. customerAcceptedAt = hiredAt (customer
    // accepted the trader's offer). customerCompletedAt = customerConfirmedDoneAt
    // (customer confirmed the job is done). Review eligibility requires
    // customerCompletedAt set AND cancelledAt null.
    customerAcceptedAt: timestamp("customer_accepted_at"),
    customerCompletedAt: timestamp("customer_completed_at"),
    // Trader can signal they finished the work. This ONLY notifies the customer
    // to confirm — it never finalises the job or unlocks the review on its own.
    traderMarkedDoneAt: timestamp("trader_marked_done_at"),
    // Cancellation audit trail. Either party may cancel before completion, with
    // a short reason. Cancelled jobs are never review-eligible.
    cancelledAt: timestamp("cancelled_at"),
    cancelledByRole: varchar("cancelled_by_role", { length: 16 }),
    cancellationReason: varchar("cancellation_reason", { length: 500 }),
    // Stamped when the customer confirms completion (mirrors customerCompletedAt)
    // — the single moment that unlocks review submission.
    reviewUnlockedAt: timestamp("review_unlocked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    customerIdx: index("conv_customer_idx").on(t.customerId, t.lastMessageAt),
    traderIdx: index("conv_trader_idx").on(t.traderProfileId, t.lastMessageAt),
    statusIdx: index("conv_status_idx").on(t.status),
  }),
);

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;

export const CONVERSATION_STATUSES = [
  "AWAITING_TRADER_REPLY",
  "AWAITING_CUSTOMER_REPLY",
  "CLOSED",
  "BLOCKED",
  "REPORTED",
] as const;

export const CONVERSATION_TRADER_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUOTED",
  "COMPLETED",
] as const;
