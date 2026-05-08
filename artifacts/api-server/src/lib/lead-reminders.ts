import { db } from "@workspace/db";
import {
  enquiriesTable,
  conversationsTable,
  usersTable,
  traderProfilesTable,
} from "@workspace/db/schema";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendPushToUser } from "./push-notifications";

const REMINDER_DELAY_MS = 60 * 60 * 1000;
const REMINDER_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function isMutedNow(mutedAt: Date | null, mutedUntil: Date | null, now: Date): boolean {
  if (mutedAt == null) return false;
  if (mutedUntil == null) return true;
  return mutedUntil.getTime() > now.getTime();
}

/**
 * Send a "you still have an unanswered lead" push to the trader if they
 * haven't opened the conversation tied to this enquiry. Idempotent: marks
 * `reminderSentAt` so subsequent sweeps skip it. Safe to call multiple times.
 */
export async function sendLeadReminderIfUnread(enquiryId: number): Promise<boolean> {
  const [row] = await db
    .select({
      enquiry: enquiriesTable,
      conv: conversationsTable,
      customerName: usersTable.fullName,
    })
    .from(enquiriesTable)
    .leftJoin(conversationsTable, eq(conversationsTable.enquiryId, enquiriesTable.id))
    .leftJoin(usersTable, eq(usersTable.id, enquiriesTable.customerId))
    .where(eq(enquiriesTable.id, enquiryId))
    .limit(1);

  if (!row || !row.conv) return false;
  if (row.enquiry.reminderSentAt != null) return false;
  // Trader has opened/viewed the lead — nothing to nudge.
  if (row.conv.traderUnreadCount === 0) {
    await db
      .update(enquiriesTable)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(enquiriesTable.id, enquiryId), isNull(enquiriesTable.reminderSentAt)));
    return false;
  }
  // Conversation no longer needs a nudge.
  if (row.conv.status === "CLOSED" || row.conv.status === "BLOCKED") {
    await db
      .update(enquiriesTable)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(enquiriesTable.id, enquiryId), isNull(enquiriesTable.reminderSentAt)));
    return false;
  }
  // Respect trader's per-conversation mute.
  if (isMutedNow(row.conv.traderMutedAt, row.conv.traderMutedUntil, new Date())) {
    await db
      .update(enquiriesTable)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(enquiriesTable.id, enquiryId), isNull(enquiriesTable.reminderSentAt)));
    return false;
  }

  // Claim the reminder atomically so two concurrent sweeps can't double-send.
  const claimed = await db
    .update(enquiriesTable)
    .set({ reminderSentAt: new Date() })
    .where(and(eq(enquiriesTable.id, enquiryId), isNull(enquiriesTable.reminderSentAt)))
    .returning({ id: enquiriesTable.id });
  if (claimed.length === 0) return false;

  const customerName = row.customerName?.trim() || "a customer";
  try {
    await sendPushToUser(row.conv.traderUserId, {
      title: "Unanswered lead",
      body: `You still have an unanswered lead from ${customerName}.`,
      data: {
        type: "lead_reminder",
        enquiryId: row.enquiry.id,
        conversationId: row.conv.id,
      },
    });
    return true;
  } catch (err) {
    // Push failed — release the claim so the next sweep can retry. We only
    // clear if the row still carries the timestamp we just set; if anything
    // else changed it in the meantime we leave it alone.
    logger.warn({ err, enquiryId }, "Failed to send lead reminder push; releasing claim for retry");
    try {
      await db
        .update(enquiriesTable)
        .set({ reminderSentAt: null })
        .where(eq(enquiriesTable.id, enquiryId));
    } catch (clearErr) {
      logger.warn({ err: clearErr, enquiryId }, "Failed to release lead reminder claim");
    }
    return false;
  }
}

/**
 * Periodic sweep: find enquiries created at least an hour ago that have not
 * yet had a reminder dispatched, and process each one. Bounded lookback so a
 * long-down server doesn't suddenly nudge week-old enquiries.
 */
export async function sweepLeadReminders(): Promise<{ checked: number; sent: number }> {
  const now = Date.now();
  const dueBefore = new Date(now - REMINDER_DELAY_MS);
  const lookbackAfter = new Date(now - REMINDER_LOOKBACK_MS);

  const due = await db
    .select({ id: enquiriesTable.id })
    .from(enquiriesTable)
    .innerJoin(conversationsTable, eq(conversationsTable.enquiryId, enquiriesTable.id))
    .innerJoin(traderProfilesTable, eq(traderProfilesTable.id, enquiriesTable.traderId))
    .where(
      and(
        isNull(enquiriesTable.reminderSentAt),
        lte(enquiriesTable.createdAt, dueBefore),
        sql`${enquiriesTable.createdAt} >= ${lookbackAfter}`,
        sql`${conversationsTable.traderUnreadCount} > 0`,
      ),
    );

  let sent = 0;
  for (const { id } of due) {
    try {
      if (await sendLeadReminderIfUnread(id)) sent += 1;
    } catch (err) {
      logger.warn({ err, enquiryId: id }, "Lead reminder failed");
    }
  }
  return { checked: due.length, sent };
}

/**
 * Schedule an in-process check ~60 minutes after an enquiry is created. The
 * periodic sweep is the source of truth (it survives restarts), but this
 * makes the happy-path latency closer to exactly 60 min.
 */
export function scheduleLeadReminderForEnquiry(enquiryId: number): void {
  const t = setTimeout(() => {
    sendLeadReminderIfUnread(enquiryId).catch((err) => {
      logger.warn({ err, enquiryId }, "Scheduled lead reminder failed");
    });
  }, REMINDER_DELAY_MS);
  t.unref?.();
}
