import { pgTable, serial, integer, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

// Lightweight appointment/booking inside a hired conversation.
//
// Deliberately small state machine:
//   PROPOSED   — one party suggested a date/time; awaiting the other party.
//   CONFIRMED  — the other party confirmed; both sides see the same booking.
//   CANCELLED  — either party cancelled (recorded, with a system message).
//   SUPERSEDED — replaced by a newer proposal (reschedule = new PROPOSED row;
//                the old row is kept as history, never silently mutated).
//
// At most ONE live booking (PROPOSED or CONFIRMED) per conversation, enforced
// by a partial unique index (mirrors quotes_one_pending_per_conversation).
// startAt is a proper UTC timestamp; rendering in UK local time is the
// client's job. No cron/reminders — status changes are user-driven only.
export const bookingsTable = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id),
    // When the appointment is scheduled to start (UTC instant).
    startAt: timestamp("start_at").notNull(),
    note: varchar("note", { length: 300 }),
    status: varchar("status", { length: 16 }).notNull().default("PROPOSED"),
    // Who proposed this booking ("customer" | "trader") + their user id.
    proposedByRole: varchar("proposed_by_role", { length: 16 }).notNull(),
    proposedByUserId: integer("proposed_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    confirmedAt: timestamp("confirmed_at"),
    confirmedByUserId: integer("confirmed_by_user_id").references(() => usersTable.id),
    cancelledAt: timestamp("cancelled_at"),
    cancelledByRole: varchar("cancelled_by_role", { length: 16 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    conversationIdx: index("bookings_conversation_idx").on(t.conversationId, t.createdAt),
    // DB-level guarantee of "one live booking per conversation": two
    // concurrent proposals cannot both insert a live row.
    oneLivePerConversation: uniqueIndex("bookings_one_live_per_conversation")
      .on(t.conversationId)
      .where(sql`status IN ('PROPOSED', 'CONFIRMED')`),
  }),
);

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;

export const BOOKING_STATUSES = ["PROPOSED", "CONFIRMED", "CANCELLED", "SUPERSEDED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
