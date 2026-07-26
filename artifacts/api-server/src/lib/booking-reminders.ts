import { db } from "@workspace/db";
import {
  bookingsTable,
  conversationsTable,
  traderProfilesTable,
} from "@workspace/db/schema";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { sendPushToUser } from "./push-notifications";
import { formatBookingTime } from "./bookings";
import { logger } from "./logger";

const HOUR_MS = 60 * 60 * 1000;

// Reminder windows: a booking becomes eligible once we are within the window
// before startAt. The stamp columns (reminder_24_sent_at / reminder_1h_sent_at)
// dedupe: a conditional UPDATE ... WHERE <stamp> IS NULL claims the send, so
// overlapping sweeps (or multiple instances) can never double-notify. Bookings
// confirmed with less than 24h notice simply get the 1h reminder only — the
// 24h claim is stamped without sending when the window has already collapsed
// into the 1h one (avoids two near-simultaneous pushes).
const WINDOWS = [
  { column: bookingsTable.reminder24SentAt, key: "24h", beforeMs: 24 * HOUR_MS },
  { column: bookingsTable.reminder1hSentAt, key: "1h", beforeMs: 1 * HOUR_MS },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];

function reminderCopy(key: WindowKey, when: string, service: string | null): { title: string; body: string } {
  const suffix = service ? ` — ${service}` : "";
  if (key === "24h") {
    return {
      title: "Appointment tomorrow",
      body: `Reminder: your appointment is ${when}${suffix}.`,
    };
  }
  return {
    title: "Appointment coming up",
    body: `Starting soon: ${when}${suffix}.`,
  };
}

/**
 * Sweep CONFIRMED bookings whose reminder window has opened and push a
 * reminder to BOTH parties (customer + trader). Cancelled/superseded bookings
 * never match (status filter), and bookings on jobs that have since been
 * cancelled/completed/closed are stamped without sending.
 */
export async function sweepBookingReminders(now = new Date()): Promise<{ checked: number; sent: number }> {
  let checked = 0;
  let sent = 0;

  for (const window of WINDOWS) {
    const windowStart = new Date(now.getTime() + window.beforeMs);
    const rows = await db
      .select({
        booking: bookingsTable,
        conv: conversationsTable,
        traderUserId: traderProfilesTable.userId,
      })
      .from(bookingsTable)
      .innerJoin(conversationsTable, eq(bookingsTable.conversationId, conversationsTable.id))
      .innerJoin(traderProfilesTable, eq(conversationsTable.traderProfileId, traderProfilesTable.id))
      .where(
        and(
          eq(bookingsTable.status, "CONFIRMED"),
          isNull(window.column),
          lte(bookingsTable.startAt, windowStart),
          // Don't remind about appointments already in the past.
          gt(bookingsTable.startAt, now),
        ),
      )
      .limit(200);

    for (const row of rows) {
      checked += 1;
      // Claim the send: only the first sweep to stamp the column proceeds.
      // Pin on status so a concurrent cancel/supersede wins over the reminder.
      const [claimed] = await db
        .update(bookingsTable)
        .set({ [window.key === "24h" ? "reminder24SentAt" : "reminder1hSentAt"]: now, updatedAt: now })
        .where(
          and(
            eq(bookingsTable.id, row.booking.id),
            eq(bookingsTable.status, "CONFIRMED"),
            isNull(window.column),
          ),
        )
        .returning({ id: bookingsTable.id });
      if (!claimed) continue;

      // Job died since confirmation (cancelled/completed/closed): stamp only.
      const convDead =
        row.conv.cancelledAt != null ||
        row.conv.customerCompletedAt != null ||
        row.conv.status === "CLOSED" ||
        row.conv.status === "BLOCKED";
      if (convDead) continue;

      // 24h window already inside the 1h window (short-notice confirmation):
      // stamp the 24h column silently; the 1h pass handles the actual push.
      if (window.key === "24h" && row.booking.startAt.getTime() - now.getTime() <= 1 * HOUR_MS) {
        continue;
      }

      const when = formatBookingTime(row.booking.startAt);
      const payload = reminderCopy(window.key, when, row.conv.serviceRequired ?? null);
      const data = {
        type: "booking_reminder",
        conversationId: row.conv.id,
        bookingId: row.booking.id,
        window: window.key,
      };
      const results = await Promise.allSettled([
        sendPushToUser(row.conv.customerId, { ...payload, data }),
        sendPushToUser(row.traderUserId, { ...payload, data }),
      ]);
      for (const r of results) {
        if (r.status === "rejected") {
          logger.warn({ err: r.reason, bookingId: row.booking.id }, "Booking reminder push failed");
        }
      }
      sent += 1;
    }
  }

  return { checked, sent };
}
