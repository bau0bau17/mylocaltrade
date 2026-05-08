import { db } from "@workspace/db";
import {
  enquiriesTable,
  conversationsTable,
  usersTable,
  traderProfilesTable,
} from "@workspace/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendPushToUser } from "./push-notifications";
import { sendLeadReminderEmail } from "./email";
import { generateUnsubscribeToken } from "./auth";

/** Default delay used when a trader has not picked a value (`leadReminderMinutes IS NULL`). */
export const DEFAULT_REMINDER_MINUTES = 60;
/** Allowed delay values exposed to traders. `0` means "off". */
export const ALLOWED_REMINDER_MINUTES = [0, 30, 60, 180] as const;
const REMINDER_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function isMutedNow(mutedAt: Date | null, mutedUntil: Date | null, now: Date): boolean {
  if (mutedAt == null) return false;
  if (mutedUntil == null) return true;
  return mutedUntil.getTime() > now.getTime();
}

/** Resolve a trader's effective reminder delay in minutes, or `null` if disabled. */
function effectiveDelayMinutes(raw: number | null | undefined): number | null {
  if (raw == null) return DEFAULT_REMINDER_MINUTES;
  if (raw === 0) return null;
  return raw;
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
      traderReminderMinutes: traderProfilesTable.leadReminderMinutes,
      traderProfileId: traderProfilesTable.id,
      traderEmail: traderProfilesTable.email,
      traderContactName: traderProfilesTable.contactName,
      traderBusinessName: traderProfilesTable.businessName,
      traderEmailEnabled: traderProfilesTable.leadReminderEmailEnabled,
    })
    .from(enquiriesTable)
    .leftJoin(conversationsTable, eq(conversationsTable.enquiryId, enquiriesTable.id))
    .leftJoin(usersTable, eq(usersTable.id, enquiriesTable.customerId))
    .leftJoin(traderProfilesTable, eq(traderProfilesTable.id, enquiriesTable.traderId))
    .where(eq(enquiriesTable.id, enquiryId))
    .limit(1);

  if (!row || !row.conv) return false;
  if (row.enquiry.reminderSentAt != null) return false;

  const delayMinutes = effectiveDelayMinutes(row.traderReminderMinutes);

  // Trader has turned reminders off — record so we don't re-check forever.
  if (delayMinutes == null) {
    await db
      .update(enquiriesTable)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(enquiriesTable.id, enquiryId), isNull(enquiriesTable.reminderSentAt)));
    return false;
  }

  // Not enough time has elapsed yet under the trader's chosen delay. Leave
  // `reminderSentAt` null so a later sweep will pick it up.
  const dueAt = row.enquiry.createdAt.getTime() + delayMinutes * 60 * 1000;
  if (Date.now() < dueAt) return false;

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
  const claimedAt = new Date();
  const claimed = await db
    .update(enquiriesTable)
    .set({ reminderSentAt: claimedAt })
    .where(and(eq(enquiriesTable.id, enquiryId), isNull(enquiriesTable.reminderSentAt)))
    .returning({ id: enquiriesTable.id });
  if (claimed.length === 0) return false;

  const customerName = row.customerName?.trim() || "a customer";

  // Fan out to push + email in parallel. Both share the single
  // `reminderSentAt` claim above, so neither channel double-sends.
  let pushOk = false;
  let emailOk = false;

  const pushPromise = (async () => {
    try {
      pushOk = await sendPushToUser(row.conv!.traderUserId, {
        title: "Unanswered lead",
        body: `You still have an unanswered lead from ${customerName}.`,
        data: {
          type: "lead_reminder",
          enquiryId: row.enquiry.id,
          conversationId: row.conv!.id,
        },
      });
    } catch (err) {
      logger.warn({ err, enquiryId }, "Failed to send lead reminder push");
    }
  })();

  const emailPromise = (async () => {
    if (!row.traderEmail) return;
    if (row.traderEmailEnabled === false) return;
    if (row.traderProfileId == null) return;
    try {
      const apiBase = (process.env.API_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost:8080"}`).replace(/\/$/, "");
      const token = generateUnsubscribeToken(row.traderProfileId, "lead_reminder");
      const unsubscribeUrl = `${apiBase}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
      emailOk = await sendLeadReminderEmail({
        toEmail: row.traderEmail,
        toName: row.traderContactName?.trim() || row.traderBusinessName?.trim() || "there",
        customerName,
        serviceRequired: row.enquiry.serviceRequired,
        unsubscribeUrl,
      });
    } catch (err) {
      logger.warn({ err, enquiryId }, "Failed to send lead reminder email");
    }
  })();

  await Promise.all([pushPromise, emailPromise]);

  if (pushOk || emailOk) return true;

  // Both channels failed to actually deliver anything — release the claim so
  // the next sweep can retry. Only clear if the row still carries the exact
  // timestamp we just set; if anything else updated it in the meantime we
  // leave it alone to avoid clobbering a concurrent successful send.
  try {
    await db
      .update(enquiriesTable)
      .set({ reminderSentAt: null })
      .where(and(eq(enquiriesTable.id, enquiryId), eq(enquiriesTable.reminderSentAt, claimedAt)));
  } catch (clearErr) {
    logger.warn({ err: clearErr, enquiryId }, "Failed to release lead reminder claim");
  }
  return false;
}

/**
 * Periodic sweep: find enquiries whose per-trader reminder window has elapsed
 * and that have not yet had a reminder dispatched. Bounded lookback so a
 * long-down server doesn't suddenly nudge week-old enquiries.
 */
export async function sweepLeadReminders(): Promise<{ checked: number; sent: number }> {
  const lookbackAfter = new Date(Date.now() - REMINDER_LOOKBACK_MS);

  // Effective delay (minutes) = COALESCE(trader.lead_reminder_minutes, 60).
  // A value of 0 means "off" — exclude those rows.
  const due = await db
    .select({ id: enquiriesTable.id })
    .from(enquiriesTable)
    .innerJoin(conversationsTable, eq(conversationsTable.enquiryId, enquiriesTable.id))
    .innerJoin(traderProfilesTable, eq(traderProfilesTable.id, enquiriesTable.traderId))
    .where(
      and(
        isNull(enquiriesTable.reminderSentAt),
        sql`${enquiriesTable.createdAt} >= ${lookbackAfter}`,
        sql`COALESCE(${traderProfilesTable.leadReminderMinutes}, ${DEFAULT_REMINDER_MINUTES}) > 0`,
        sql`${enquiriesTable.createdAt} + (COALESCE(${traderProfilesTable.leadReminderMinutes}, ${DEFAULT_REMINDER_MINUTES}) * interval '1 minute') <= now()`,
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
 * Schedule an in-process check after the trader's chosen delay. The periodic
 * sweep is the source of truth (it survives restarts); this just makes the
 * happy-path latency closer to exactly the chosen window.
 *
 * Pass `delayMinutes` as the trader's current setting (null/undefined → use
 * default; 0 → skip scheduling entirely).
 */
export function scheduleLeadReminderForEnquiry(
  enquiryId: number,
  delayMinutes: number | null | undefined,
): void {
  const minutes = effectiveDelayMinutes(delayMinutes);
  if (minutes == null) return;
  const t = setTimeout(() => {
    sendLeadReminderIfUnread(enquiryId).catch((err) => {
      logger.warn({ err, enquiryId }, "Scheduled lead reminder failed");
    });
  }, minutes * 60 * 1000);
  t.unref?.();
}
