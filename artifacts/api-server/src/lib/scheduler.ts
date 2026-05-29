import { db } from "@workspace/db";
import {
  traderProfilesTable,
  traderDocumentsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { TRADER_STATUS, evaluateDocumentsComplete, logAudit } from "./trader-status";
import { sweepLeadReminders } from "./lead-reminders";
import { sweepExpiredMutes } from "./mute-sweep";

const HOUR_MS = 60 * 60 * 1000;
const LEAD_REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const MUTE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Phase 8: periodic sweep that flips VERIFIED traders to EXPIRED_DOCUMENTS once
 * a required document expires. Without this, traders are only re-evaluated on
 * upload/delete (see reconcileDocumentsState in trader-documents.ts).
 */
export async function reconcileExpiredDocuments(): Promise<{ checked: number; flipped: number }> {
  const verified = await db
    .select()
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.verificationStatus, TRADER_STATUS.VERIFIED));

  let flipped = 0;
  for (const profile of verified) {
    const docs = await db
      .select()
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.userId, profile.userId));
    const evaluation = evaluateDocumentsComplete(docs, {
      businessRole: profile.businessRole,
      authorisedRepresentative: profile.authorisedRepresentative,
    });
    if (!evaluation.hasExpiredRequired) continue;

    await db
      .update(traderProfilesTable)
      .set({
        verificationStatus: TRADER_STATUS.EXPIRED_DOCUMENTS,
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, profile.userId));

    await logAudit({
      userId: profile.userId,
      action: "DOCUMENT_EXPIRED",
      details: {
        source: "scheduler",
        expiredTypes: evaluation.byType.filter((b) => b.required && b.expired).map((b) => b.type),
      },
    });
    flipped += 1;
  }

  return { checked: verified.length, flipped };
}

let scheduledTimer: NodeJS.Timeout | null = null;
let leadReminderTimer: NodeJS.Timeout | null = null;
let muteSweepTimer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (scheduledTimer) return;
  // Run shortly after boot so we catch anything that expired while down,
  // then every hour. Keep it simple — no external job runner.
  const initialDelayMs = 30 * 1000;
  setTimeout(async () => {
    try {
      const result = await reconcileExpiredDocuments();
      logger.info({ ...result }, "Expired-documents sweep (initial)");
    } catch (err) {
      logger.error({ err }, "Expired-documents sweep (initial) failed");
    }
  }, initialDelayMs);

  scheduledTimer = setInterval(async () => {
    try {
      const result = await reconcileExpiredDocuments();
      logger.info({ ...result }, "Expired-documents sweep");
    } catch (err) {
      logger.error({ err }, "Expired-documents sweep failed");
    }
  }, HOUR_MS);
  // Don't keep the event loop alive just for this timer.
  scheduledTimer.unref?.();

  // Lead-reminder sweep: nudge traders who haven't opened a new enquiry
  // within an hour. Runs frequently so the latency stays close to ~60 min.
  leadReminderTimer = setInterval(async () => {
    try {
      const result = await sweepLeadReminders();
      if (result.sent > 0) {
        logger.info({ ...result }, "Lead-reminder sweep");
      }
    } catch (err) {
      logger.error({ err }, "Lead-reminder sweep failed");
    }
  }, LEAD_REMINDER_INTERVAL_MS);
  leadReminderTimer.unref?.();

  // Mute-sweep: null out timed mute rows whose `mutedUntil` has elapsed so
  // the table doesn't accumulate stale `muted_until` values forever (the
  // existing per-message opportunistic clear only fires when a new message
  // arrives in the conversation).
  muteSweepTimer = setInterval(async () => {
    try {
      const result = await sweepExpiredMutes();
      if (result.customerCleared > 0 || result.traderCleared > 0) {
        logger.info({ ...result }, "Expired-mutes sweep");
      }
    } catch (err) {
      logger.error({ err }, "Expired-mutes sweep failed");
    }
  }, MUTE_SWEEP_INTERVAL_MS);
  muteSweepTimer.unref?.();
}

export function stopScheduler(): void {
  if (scheduledTimer) {
    clearInterval(scheduledTimer);
    scheduledTimer = null;
  }
  if (leadReminderTimer) {
    clearInterval(leadReminderTimer);
    leadReminderTimer = null;
  }
  if (muteSweepTimer) {
    clearInterval(muteSweepTimer);
    muteSweepTimer = null;
  }
}
