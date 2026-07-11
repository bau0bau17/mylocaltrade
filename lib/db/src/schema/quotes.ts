import { pgTable, serial, integer, text, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";
import { conversationsTable } from "./conversations";
import { enquiriesTable } from "./enquiries";

// Structured quotes sent by a trader within an existing conversation.
//
// Lifecycle:
//   PENDING  — live quote awaiting the customer's decision.
//   ACCEPTED — customer accepted; immutable historical record. At most one per
//              conversation chain; acceptance also triggers the existing hire
//              flow (customerAcceptedAt + jobReference) when not already hired.
//   DECLINED — customer declined; immutable.
//   WITHDRAWN — trader withdrew before a decision; immutable.
//   REVISED  — superseded by a newer revision (revisionOfQuoteId on the new
//              row points back here); immutable.
//   EXPIRED  — validUntil passed while PENDING. Stored rows may still say
//              PENDING; the API computes the effective status at read time and
//              refuses acceptance, so no background sweep is required.
//
// Prices are integer pence (minor units) — never floats.
export const quotesTable = pgTable(
  "quotes",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id),
    enquiryId: integer("enquiry_id").references(() => enquiriesTable.id),
    traderProfileId: integer("trader_profile_id")
      .notNull()
      .references(() => traderProfilesTable.id),
    traderUserId: integer("trader_user_id")
      .notNull()
      .references(() => usersTable.id),
    customerId: integer("customer_id")
      .notNull()
      .references(() => usersTable.id),
    amountPence: integer("amount_pence").notNull(),
    priceType: varchar("price_type", { length: 16 }).notNull(), // FIXED | ESTIMATE
    description: text("description").notNull(),
    notes: text("notes"),
    validUntil: timestamp("valid_until"),
    status: varchar("status", { length: 16 }).notNull().default("PENDING"),
    // Revision chain: set on the NEW row, pointing at the quote it replaces.
    revisionOfQuoteId: integer("revision_of_quote_id"),
    acceptedAt: timestamp("accepted_at"),
    declinedAt: timestamp("declined_at"),
    withdrawnAt: timestamp("withdrawn_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    conversationIdx: index("quotes_conversation_idx").on(t.conversationId, t.createdAt),
    customerIdx: index("quotes_customer_idx").on(t.customerId, t.status),
    traderIdx: index("quotes_trader_idx").on(t.traderProfileId, t.status),
    // DB-level guarantee of "one live quote per conversation": two concurrent
    // create/revise requests cannot both insert a PENDING row.
    onePendingPerConversation: uniqueIndex("quotes_one_pending_per_conversation")
      .on(t.conversationId)
      .where(sql`status = 'PENDING'`),
  }),
);

export const insertQuoteSchema = createInsertSchema(quotesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotesTable.$inferSelect;

export const QUOTE_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
  "REVISED",
  "EXPIRED",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_PRICE_TYPES = ["FIXED", "ESTIMATE"] as const;
export type QuotePriceType = (typeof QUOTE_PRICE_TYPES)[number];
