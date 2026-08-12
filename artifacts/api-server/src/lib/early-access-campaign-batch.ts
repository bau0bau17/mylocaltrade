import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  earlyAccessRegistrationsTable,
  earlyAccessCampaignsTable,
  earlyAccessCampaignRecipientsTable,
  earlyAccessCampaignBatchesTable,
  earlyAccessCampaignEventsTable,
  type EarlyAccessCampaignType,
} from "@workspace/db/schema";
import {
  BREVO_LIST_NAMES,
  BrevoMarketingDisabledError,
  createBatchList,
  createCampaign,
  marketingSendingStatus,
  sendCampaignNow,
  upsertContactsIntoList,
} from "./brevo-marketing";
import {
  acquireQuotaLock,
  firstNameOf,
  remainingDailyQuota,
  renderCampaignEmail,
} from "./early-access-campaigns";
import { buildUnsubscribeToken } from "./early-access-unsubscribe";

/**
 * Daily batch engine (Phase 2B). One call = one "Send next batch" click.
 *
 * IDEMPOTENCY / RESTART SAFETY MODEL
 * - Recipients are reserved with a conditional queued→sending transition
 *   under FOR UPDATE SKIP LOCKED inside a transaction, so two concurrent
 *   clicks can never reserve the same recipient.
 * - The batch row stores the Brevo campaign id BEFORE sendNow is called.
 *   A crash therefore leaves one of two recoverable states:
 *     - pending batch WITHOUT brevoCampaignId → nothing could have been
 *       sent → recipients are released back to 'queued' (safe retry).
 *     - pending batch WITH brevoCampaignId → the send may or may not have
 *       fired → recipients are conservatively marked sent
 *       ('recovered_assumed_sent'). Never risks a duplicate email; worst
 *       case a recipient is skipped, which the delivery summary surfaces.
 * - Suppression/unsubscribe is RE-CHECKED against the live registration row
 *   inside the reservation transaction — the queue-time snapshot fixes WHO
 *   was eligible, never overrides a later opt-out.
 */

export type BatchRunResult =
  | { ok: true; batchNumber: number; attempted: number; sent: number; skipped: number; failed: number; remaining: number; campaignStatus: string }
  | { ok: false; code: "not_found" | "bad_status" | "quota_exhausted" | "brevo_disabled" | "brevo_error" | "needs_recovery_review"; message: string; campaignStatus?: string };

const c = earlyAccessCampaignsTable;
const r = earlyAccessCampaignRecipientsTable;
const b = earlyAccessCampaignBatchesTable;

async function audit(
  executor: Pick<typeof db, "insert">,
  campaignId: number,
  kind: string,
  performedBy: number | null,
  details: Record<string, unknown>,
): Promise<void> {
  await executor.insert(earlyAccessCampaignEventsTable).values({
    campaignId,
    kind,
    performedBy,
    details,
  });
}

/** Recover any crashed batch left in 'pending'. Runs inside the reserve tx. */
async function recoverPendingBatch(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  campaignId: number,
  performedBy: number,
): Promise<void> {
  const pending = await tx
    .select()
    .from(b)
    .where(and(eq(b.campaignId, campaignId), eq(b.status, "pending")));
  for (const batch of pending) {
    const now = new Date();
    if (batch.brevoCampaignId !== null) {
      // Send may have fired — NEVER retry (duplicate risk). Assume sent.
      await tx
        .update(r)
        .set({
          status: "sent",
          sentAt: now,
          statusDetail: "recovered_assumed_sent",
          updatedAt: now,
        })
        .where(
          and(
            eq(r.campaignId, campaignId),
            eq(r.batchNumber, batch.batchNumber),
            eq(r.status, "sending"),
          ),
        );
      await tx
        .update(b)
        .set({ status: "sent", sentAt: now, statusDetail: "recovered_assumed_sent" })
        .where(eq(b.id, batch.id));
      await audit(tx, campaignId, "BATCH_SENT", performedBy, {
        batchNumber: batch.batchNumber,
        recovered: "assumed_sent",
      });
    } else {
      // Brevo campaign was never created — releasing is provably safe.
      await tx
        .update(r)
        .set({ status: "queued", batchNumber: null, updatedAt: now })
        .where(
          and(
            eq(r.campaignId, campaignId),
            eq(r.batchNumber, batch.batchNumber),
            eq(r.status, "sending"),
          ),
        );
      await tx
        .update(b)
        .set({ status: "failed", statusDetail: "recovered_released" })
        .where(eq(b.id, batch.id));
    }
  }
}

/** Terminal-state bookkeeping once no queued recipients remain. */
async function finalizeIfDone(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  campaignId: number,
  performedBy: number | null,
): Promise<string | null> {
  const [counts] = await tx
    .select({
      queued: sql<number>`count(*) filter (where ${r.status} in ('queued','sending'))::int`,
      failed: sql<number>`count(*) filter (where ${r.status} = 'failed')::int`,
    })
    .from(r)
    .where(eq(r.campaignId, campaignId));
  if ((counts?.queued ?? 0) > 0) return null;
  const status = (counts?.failed ?? 0) > 0 ? "partially_failed" : "completed";
  const now = new Date();
  await tx
    .update(c)
    .set({ status, completedAt: now, updatedAt: now })
    .where(
      and(
        eq(c.id, campaignId),
        inArray(c.status, ["sending", "queued", "waiting_quota"]),
      ),
    );
  await audit(tx, campaignId, "CAMPAIGN_COMPLETED", performedBy, {
    finalStatus: status,
    failedCount: counts?.failed ?? 0,
  });
  return status;
}

export async function runCampaignBatch(
  campaignId: number,
  performedBy: number,
): Promise<BatchRunResult> {
  // ---- Phase 1: reservation transaction -----------------------------------
  const reserved = await db.transaction(async (tx) => {
    // Serialize quota check-and-reserve across ALL campaigns and test sends
    // (two concurrent reservations must never both spend the same quota).
    await acquireQuotaLock(tx);
    const [campaign] = await tx
      .select()
      .from(c)
      .where(eq(c.id, campaignId))
      .for("update");
    if (!campaign) return { error: "not_found" as const };
    if (!["queued", "waiting_quota", "sending"].includes(campaign.status)) {
      return { error: "bad_status" as const, status: campaign.status };
    }

    await recoverPendingBatch(tx, campaignId, performedBy);

    // Campaign may already be finished after recovery.
    const finished = await finalizeIfDone(tx, campaignId, performedBy);
    if (finished) return { error: "done" as const, status: finished };

    const quota = await remainingDailyQuota(tx);
    if (quota <= 0) {
      await tx
        .update(c)
        .set({ status: "waiting_quota", updatedAt: new Date() })
        .where(eq(c.id, campaignId));
      return { error: "quota" as const };
    }

    // Reserve up to `quota` queued recipients (SKIP LOCKED = concurrency-safe).
    const [{ maxBatch }] = await tx
      .select({ maxBatch: sql<number>`coalesce(max(${b.batchNumber}), 0)::int` })
      .from(b)
      .where(eq(b.campaignId, campaignId));
    const batchNumber = maxBatch + 1;
    const now = new Date();
    const reservedRows = await tx
      .update(r)
      .set({ status: "sending", batchNumber, updatedAt: now })
      .where(
        inArray(
          r.id,
          tx
            .select({ id: r.id })
            .from(r)
            .where(and(eq(r.campaignId, campaignId), eq(r.status, "queued")))
            .orderBy(asc(r.id))
            .limit(quota)
            .for("update", { skipLocked: true }),
        ),
      )
      .returning({
        id: r.id,
        registrationId: r.registrationId,
        emailNormalized: r.emailNormalized,
        name: r.name,
      });

    if (reservedRows.length === 0) {
      const finalStatus = await finalizeIfDone(tx, campaignId, performedBy);
      return { error: "done" as const, status: finalStatus ?? campaign.status };
    }

    // RE-CHECK live consent/suppression for every reserved recipient — the
    // snapshot never overrides an opt-out that happened after queueing.
    const regs = await tx
      .select({
        id: earlyAccessRegistrationsTable.id,
        unsubscribedAt: earlyAccessRegistrationsTable.unsubscribedAt,
        emailSuppressedAt: earlyAccessRegistrationsTable.emailSuppressedAt,
      })
      .from(earlyAccessRegistrationsTable)
      .where(
        inArray(
          earlyAccessRegistrationsTable.id,
          reservedRows.map((row) => row.registrationId),
        ),
      );
    const regById = new Map(regs.map((reg) => [reg.id, reg]));
    const skippedIds: number[] = [];
    const unsubscribedIds: number[] = [];
    const toSend: typeof reservedRows = [];
    for (const row of reservedRows) {
      const reg = regById.get(row.registrationId);
      if (!reg) {
        skippedIds.push(row.id); // registration deleted since snapshot
      } else if (reg.unsubscribedAt !== null) {
        unsubscribedIds.push(row.id);
      } else if (reg.emailSuppressedAt !== null) {
        skippedIds.push(row.id);
      } else {
        toSend.push(row);
      }
    }
    if (unsubscribedIds.length > 0) {
      await tx
        .update(r)
        .set({ status: "unsubscribed", statusDetail: "batch_recheck", updatedAt: now })
        .where(inArray(r.id, unsubscribedIds));
    }
    if (skippedIds.length > 0) {
      await tx
        .update(r)
        .set({ status: "suppressed", statusDetail: "batch_recheck", updatedAt: now })
        .where(inArray(r.id, skippedIds));
    }

    const [batch] = await tx
      .insert(earlyAccessCampaignBatchesTable)
      .values({
        campaignId,
        batchNumber,
        recipientCount: toSend.length,
        status: "pending",
        createdBy: performedBy,
      })
      .returning();
    await tx
      .update(c)
      .set({ status: "sending", updatedAt: now })
      .where(eq(c.id, campaignId));

    return {
      error: null,
      campaign,
      batch,
      batchNumber,
      toSend,
      attempted: reservedRows.length,
      skipped: skippedIds.length + unsubscribedIds.length,
    };
  });

  if (reserved.error === "not_found")
    return { ok: false, code: "not_found", message: "Campaign not found." };
  if (reserved.error === "bad_status")
    return {
      ok: false,
      code: "bad_status",
      message: `Campaign is ${reserved.status} — batches can only run while queued, waiting for quota, or recovering.`,
      campaignStatus: reserved.status,
    };
  if (reserved.error === "quota")
    return {
      ok: false,
      code: "quota_exhausted",
      message: "Daily send quota is exhausted. Continue tomorrow.",
      campaignStatus: "waiting_quota",
    };
  if (reserved.error === "done")
    return {
      ok: true,
      batchNumber: 0,
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      remaining: 0,
      campaignStatus: reserved.status ?? "completed",
    };

  const { campaign, batch, batchNumber, toSend, attempted, skipped } = reserved;

  // ---- Phase 2: everything after this point talks to Brevo ----------------
  const release = async (detail: string): Promise<void> => {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(r)
        .set({ status: "queued", batchNumber: null, updatedAt: now })
        .where(
          and(
            eq(r.campaignId, campaignId),
            eq(r.batchNumber, batchNumber),
            eq(r.status, "sending"),
          ),
        );
      await tx
        .update(b)
        .set({ status: "failed", statusDetail: detail.slice(0, 200) })
        .where(eq(b.id, batch.id));
      await tx
        .update(c)
        .set({ status: "queued", updatedAt: now })
        .where(and(eq(c.id, campaignId), eq(c.status, "sending")));
    });
  };

  if (toSend.length === 0) {
    // Whole batch was skipped by the re-check; nothing to send.
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(b)
        .set({ status: "sent", sentAt: now, statusDetail: "all_recipients_skipped" })
        .where(eq(b.id, batch.id));
      await audit(tx, campaignId, "BATCH_SENT", performedBy, {
        batchNumber,
        attempted,
        sent: 0,
        skipped,
        failed: 0,
      });
      const finalStatus = await finalizeIfDone(tx, campaignId, performedBy);
      if (!finalStatus) {
        await tx
          .update(c)
          .set({ status: "queued", updatedAt: now })
          .where(and(eq(c.id, campaignId), eq(c.status, "sending")));
      }
    });
    const remaining = await remainingQueued(campaignId);
    return {
      ok: true,
      batchNumber,
      attempted,
      sent: 0,
      skipped,
      failed: 0,
      remaining,
      campaignStatus: remaining > 0 ? "queued" : "completed",
    };
  }

  const enabled = marketingSendingStatus();
  if (!enabled.enabled) {
    await release(`brevo_disabled: ${enabled.reason}`);
    return {
      ok: false,
      code: "brevo_disabled",
      message: `Sending is disabled (${enabled.reason}). No emails were sent; recipients were returned to the queue.`,
      campaignStatus: "queued",
    };
  }

  let brevoCampaignId: number | null = null;
  try {
    // One brand-new, never-reused list per batch: a concurrent batch (same
    // or other campaign) can never swap this batch's audience before send.
    const listId = await createBatchList(
      `${BREVO_LIST_NAMES[campaign.type as EarlyAccessCampaignType]} — c${campaignId} b${batchNumber}`,
    );
    await upsertContactsIntoList(
      listId,
      toSend.map((row) => ({
        email: row.emailNormalized,
        firstName: firstNameOf(row.name),
        unsubscribeToken: buildUnsubscribeToken(row.registrationId),
      })),
    );
    const { html } = renderCampaignEmail(campaign, { brevoMergeTags: true });
    brevoCampaignId = await createCampaign({
      name: `${campaign.name} — batch ${batchNumber}`,
      subject: campaign.subject,
      previewText: campaign.previewText,
      htmlContent: html,
      listId,
    });
    // Persist the Brevo id BEFORE sendNow — the crash-recovery contract.
    await db
      .update(b)
      .set({ brevoListId: listId, brevoCampaignId })
      .where(eq(b.id, batch.id));
    await sendCampaignNow(brevoCampaignId);
  } catch (err) {
    const message = err instanceof BrevoMarketingDisabledError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Brevo request failed";
    if (brevoCampaignId === null) {
      // Nothing could have been sent yet — safe to release and retry.
      await release(`brevo_error: ${message}`);
      return {
        ok: false,
        code: "brevo_error",
        message: `Brevo request failed before any email was sent; recipients were returned to the queue. (${message})`,
        campaignStatus: "queued",
      };
    }
    // sendNow was reached: the batch stays 'pending' with the Brevo id, and
    // the NEXT run's recovery conservatively marks it assumed-sent. Never
    // auto-retried — duplicates are worse than a skipped batch.
    return {
      ok: false,
      code: "needs_recovery_review",
      message: `The send request to Brevo failed AFTER the campaign was created — it may still have gone out. The batch is held; pressing "Continue next batch" will mark it as assumed-sent (never resent). Verify in the Brevo dashboard. (${message})`,
      campaignStatus: "sending",
    };
  }

  // ---- Phase 3: finalize ---------------------------------------------------
  const now = new Date();
  let campaignStatus = "waiting_quota";
  await db.transaction(async (tx) => {
    await tx
      .update(r)
      .set({ status: "sent", sentAt: now, statusDetail: null, updatedAt: now })
      .where(
        and(
          eq(r.campaignId, campaignId),
          eq(r.batchNumber, batchNumber),
          eq(r.status, "sending"),
        ),
      );
    await tx
      .update(b)
      .set({ status: "sent", sentAt: now })
      .where(eq(b.id, batch.id));
    await audit(tx, campaignId, "BATCH_SENT", performedBy, {
      batchNumber,
      attempted,
      sent: toSend.length,
      skipped,
      failed: 0,
      brevoCampaignId,
    });
    const finalStatus = await finalizeIfDone(tx, campaignId, performedBy);
    if (finalStatus) {
      campaignStatus = finalStatus;
    } else {
      const quotaLeft = await remainingDailyQuota(tx);
      campaignStatus = quotaLeft > 0 ? "queued" : "waiting_quota";
      await tx
        .update(c)
        .set({ status: campaignStatus, updatedAt: now })
        .where(and(eq(c.id, campaignId), eq(c.status, "sending")));
    }
  });

  const remaining = await remainingQueued(campaignId);
  return {
    ok: true,
    batchNumber,
    attempted,
    sent: toSend.length,
    skipped,
    failed: 0,
    remaining,
    campaignStatus,
  };
}

async function remainingQueued(campaignId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(r)
    .where(and(eq(r.campaignId, campaignId), eq(r.status, "queued")));
  return row?.count ?? 0;
}
