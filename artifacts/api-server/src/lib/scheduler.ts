import { db } from "@workspace/db";
import {
  traderProfilesTable,
  traderDocumentsTable,
  usersTable,
} from "@workspace/db/schema";
import { and, eq, isNull, lte } from "drizzle-orm";
import { logger } from "./logger";
import {
  TRADER_STATUS,
  evaluateDocumentsComplete,
  logAudit,
  REVALIDATION_GRACE_MS,
} from "./trader-status";
import { sweepLeadReminders } from "./lead-reminders";
import { sweepExpiredMutes } from "./mute-sweep";
import { sendPushToUser } from "./push-notifications";
import {
  sendTraderRevalidationDueEmail,
  sendTraderRevalidationOverdueEmail,
  sendAdminRevalidationAlertEmail,
} from "./email";

const HOUR_MS = 60 * 60 * 1000;
const LEAD_REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const MUTE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const REVALIDATION_SWEEP_INTERVAL_MS = 6 * HOUR_MS;
const REVALIDATION_GRACE_DAYS = Math.round(REVALIDATION_GRACE_MS / (24 * 60 * 60 * 1000));

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

/**
 * Periodic re-validation sweep. Keeps the "Documents reviewed" trust signal
 * current by prompting verified traders to re-confirm their key documents when
 * `revalidationDueAt` elapses, and hiding those who let the grace period lapse.
 *
 * Two stages, both idempotent (guarded by the columns they set):
 *  1. DUE   — first time past the due date: stamp `revalidationRemindedAt`,
 *             email + push the trader, alert admins. Starts the grace clock.
 *  2. OVERDUE — grace period elapsed without a re-confirm: set
 *             `revalidationOverdue` (hides the profile), email + push, alert admins.
 */
export async function sweepRevalidations(): Promise<{
  checked: number;
  prompted: number;
  hidden: number;
}> {
  const now = new Date();
  const due = await db
    .select({
      userId: traderProfilesTable.userId,
      businessName: traderProfilesTable.businessName,
      contactName: traderProfilesTable.contactName,
      remindedAt: traderProfilesTable.revalidationRemindedAt,
      overdue: traderProfilesTable.revalidationOverdue,
      email: usersTable.email,
      fullName: usersTable.fullName,
    })
    .from(traderProfilesTable)
    .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
    .where(
      and(
        eq(traderProfilesTable.verificationStatus, TRADER_STATUS.VERIFIED),
        lte(traderProfilesTable.revalidationDueAt, now),
      ),
    );

  let prompted = 0;
  let hidden = 0;

  for (const row of due) {
    const toName = row.contactName ?? row.fullName ?? "there";
    const businessName = row.businessName ?? null;

    // Stage 1: first prompt — has not been reminded yet.
    if (row.remindedAt == null) {
      // Compare-and-set with the full eligibility predicate so two overlapping
      // sweeps can't double-prompt AND a concurrent /profile/revalidate (which
      // pushes revalidationDueAt into the future) can't be clobbered by this
      // stale read.
      const [claimed] = await db
        .update(traderProfilesTable)
        .set({ revalidationRemindedAt: now, updatedAt: now })
        .where(
          and(
            eq(traderProfilesTable.userId, row.userId),
            eq(traderProfilesTable.verificationStatus, TRADER_STATUS.VERIFIED),
            isNull(traderProfilesTable.revalidationRemindedAt),
            lte(traderProfilesTable.revalidationDueAt, now),
          ),
        )
        .returning({ userId: traderProfilesTable.userId });
      if (!claimed) continue;

      await logAudit({
        userId: row.userId,
        action: "REVALIDATION_DUE",
        details: { source: "scheduler" },
      });

      void (async () => {
        try {
          if (row.email) {
            await sendTraderRevalidationDueEmail({
              toEmail: row.email,
              toName,
              businessName,
              graceDays: REVALIDATION_GRACE_DAYS,
            });
          }
          await sendPushToUser(row.userId, {
            title: "Time to re-confirm your details",
            body: "Please confirm your key documents are still valid to keep your profile verified.",
            data: { type: "revalidation_due" },
          });
          if (row.email) {
            await sendAdminRevalidationAlertEmail({
              traderEmail: row.email,
              traderName: toName,
              businessName,
              stage: "due",
            });
          }
        } catch (err) {
          logger.warn({ err, userId: row.userId }, "Revalidation due notification failed");
        }
      })();

      prompted += 1;
      continue;
    }

    // Stage 2: grace period elapsed and not yet hidden.
    const graceEnded = row.remindedAt.getTime() + REVALIDATION_GRACE_MS <= now.getTime();
    if (!row.overdue && graceEnded) {
      // CAS pinned to the exact reminder timestamp we read. If the trader
      // re-confirmed in the meantime, revalidationRemindedAt is reset to null
      // (and revalidationDueAt pushed forward), so this predicate no longer
      // matches and we won't wrongly hide a freshly re-validated profile.
      const [claimed] = await db
        .update(traderProfilesTable)
        .set({ revalidationOverdue: true, updatedAt: now })
        .where(
          and(
            eq(traderProfilesTable.userId, row.userId),
            eq(traderProfilesTable.verificationStatus, TRADER_STATUS.VERIFIED),
            eq(traderProfilesTable.revalidationOverdue, false),
            eq(traderProfilesTable.revalidationRemindedAt, row.remindedAt),
            lte(traderProfilesTable.revalidationDueAt, now),
          ),
        )
        .returning({ userId: traderProfilesTable.userId });
      if (!claimed) continue;

      await logAudit({
        userId: row.userId,
        action: "REVALIDATION_OVERDUE",
        details: { source: "scheduler" },
      });

      void (async () => {
        try {
          if (row.email) {
            await sendTraderRevalidationOverdueEmail({
              toEmail: row.email,
              toName,
              businessName,
            });
          }
          await sendPushToUser(row.userId, {
            title: "Your profile is hidden",
            body: "Re-confirm your details in the app to restore your profile in search.",
            data: { type: "revalidation_overdue" },
          });
          if (row.email) {
            await sendAdminRevalidationAlertEmail({
              traderEmail: row.email,
              traderName: toName,
              businessName,
              stage: "overdue",
            });
          }
        } catch (err) {
          logger.warn({ err, userId: row.userId }, "Revalidation overdue notification failed");
        }
      })();

      hidden += 1;
    }
  }

  return { checked: due.length, prompted, hidden };
}

let scheduledTimer: NodeJS.Timeout | null = null;
let leadReminderTimer: NodeJS.Timeout | null = null;
let muteSweepTimer: NodeJS.Timeout | null = null;
let revalidationTimer: NodeJS.Timeout | null = null;

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

  // Re-validation sweep: prompt verified traders to re-confirm their key
  // documents when due, and hide those who lapse past the grace period.
  setTimeout(async () => {
    try {
      const result = await sweepRevalidations();
      logger.info({ ...result }, "Re-validation sweep (initial)");
    } catch (err) {
      logger.error({ err }, "Re-validation sweep (initial) failed");
    }
  }, initialDelayMs);

  revalidationTimer = setInterval(async () => {
    try {
      const result = await sweepRevalidations();
      if (result.prompted > 0 || result.hidden > 0) {
        logger.info({ ...result }, "Re-validation sweep");
      }
    } catch (err) {
      logger.error({ err }, "Re-validation sweep failed");
    }
  }, REVALIDATION_SWEEP_INTERVAL_MS);
  revalidationTimer.unref?.();
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
  if (revalidationTimer) {
    clearInterval(revalidationTimer);
    revalidationTimer = null;
  }
}
