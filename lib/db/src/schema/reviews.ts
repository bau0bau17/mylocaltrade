import { pgTable, serial, integer, text, timestamp, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";
import { enquiriesTable } from "./enquiries";

export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED", "FLAGGED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const reviewsTable = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    traderId: integer("trader_id")
      .notNull()
      .references(() => traderProfilesTable.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    enquiryId: integer("enquiry_id").references(() => enquiriesTable.id, {
      onDelete: "set null",
    }),
    rating: integer("rating").notNull(),
    text: text("text").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    moderatedAt: timestamp("moderated_at"),
    moderatedBy: integer("moderated_by").references(() => usersTable.id),
    moderationNotes: text("moderation_notes"),
    traderReply: text("trader_reply"),
    traderReplyAt: timestamp("trader_reply_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    traderIdx: index("reviews_trader_idx").on(table.traderId),
    customerIdx: index("reviews_customer_idx").on(table.customerId),
    statusIdx: index("reviews_status_idx").on(table.status),
    enquiryUnique: uniqueIndex("reviews_enquiry_unique_idx").on(table.enquiryId),
  })
);

export type Review = typeof reviewsTable.$inferSelect;
export type InsertReview = typeof reviewsTable.$inferInsert;
