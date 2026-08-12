import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
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
  BrevoApiError,
  BrevoMarketingDisabledError,
  classifyBrevoError,
  scrubBrevoMessage,
  type BrevoFailureKind,
  createBatchList,
  createCampaign,
  deleteCampaign,
  deleteList,
  getCampaignStatus,
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
  | { ok: false; code: "not_found" | "bad_status" | "in_progress" | "quota_exhausted" | "brevo_credits" | "brevo_rate_limited" | "brevo_auth" | "brevo_invalid" | "brevo_disabled" | "brevo_error" | "needs_recovery_review"; message: string; campaignStatus?: string };

/**
 * How each EXPLICIT Brevo refusal parks the campaign. In every case here
 * nothing was sent and the recipient queue is preserved — the statuses only
 * differ in what the admin must do next:
 * - waiting_quota:      wait for credit reset or upgrade the plan.
 * - waiting_rate_limit: API request throttling — retry shortly. NOT credits.
 * - needs_attention:    content/config or API-key problem — retrying without
 *   a fix cannot succeed, so the campaign is NOT left auto-retryable in a
 *   waiting state.
 * - queued:             transient/rebuildable (e.g. remote object vanished).
 */
const FAILURE_HANDLING: Record<
  Exclude<BrevoFailureKind, "ambiguous">,
  {
    campaignStatus: "queued" | "waiting_quota" | "waiting_rate_limit" | "needs_attention";
    code: "brevo_credits" | "brevo_rate_limited" | "brevo_auth" | "brevo_invalid" | "brevo_error";
    buildMessage: (brevoMessage: string, retryAfterSeconds: number | null) => string;
  }
> = {
  credits: {
    campaignStatus: "waiting_quota",
    code: "brevo_credits",
    buildMessage: () =>
      "Brevo rejected the send: not enough email credits. No email was sent and no recipient was marked sent — the queue is preserved. Retry after the daily/monthly allowance resets (or after upgrading the plan and raising the caps).",
  },
  rate_limit: {
    campaignStatus: "waiting_rate_limit",
    code: "brevo_rate_limited",
    buildMessage: (_msg, retryAfterSeconds) =>
      `Brevo's API rate limit was hit (HTTP 429). This is request throttling, NOT daily/monthly credit exhaustion. Nothing was sent; the queue is preserved. Retry ${
        retryAfterSeconds !== null
          ? `after about ${retryAfterSeconds} seconds`
          : "in a few minutes"
      } with "Send next batch".`,
  },
  auth: {
    campaignStatus: "needs_attention",
    code: "brevo_auth",
    buildMessage: (msg) =>
      `Brevo refused the request: the API key is invalid or lacks permission. Nothing was sent. Correct the Brevo API key (BREVO_API_KEY_MARKETING) or its permissions in the Brevo dashboard, then press "Send next batch". (${msg})`,
  },
  validation: {
    campaignStatus: "needs_attention",
    code: "brevo_invalid",
    buildMessage: (msg) =>
      `Brevo rejected the campaign content/configuration. Nothing was sent and retrying without a fix cannot succeed. Brevo's reason: ${msg}`,
  },
  missing: {
    campaignStatus: "queued",
    code: "brevo_error",
    buildMessage: (msg) =>
      `The Brevo list/campaign no longer exists (HTTP 404) — so it cannot have been sent. Recipients were returned to the queue; the next "Send next batch" safely rebuilds the Brevo objects. (${msg})`,
  },
  // Only reachable BEFORE a Brevo campaign exists (e.g. list-name clash):
  // nothing can be in flight, so releasing for a plain retry is safe. Once a
  // campaign exists, a 409 takes the ambiguous assumed-sent path instead.
  conflict: {
    campaignStatus: "queued",
    code: "brevo_error",
    buildMessage: (msg) =>
      `Brevo reported a conflict while preparing the batch (before any campaign existed) — nothing was sent. Recipients were returned to the queue; retry with "Send next batch". (${msg})`,
  },
};

/**
 * Send lease: a 'pending' batch WITHOUT a Brevo campaign id younger than
 * this is treated as an ACTIVE send by another worker — its recipients are
 * NOT released (releasing them while the other worker goes on to create and
 * send its Brevo campaign would double-send them). Recovery/release only
 * happens after the lease expires, i.e. after a proven crash. The remote
 * phase takes seconds; 15 minutes is deliberately conservative.
 */
export const BATCH_SEND_LEASE_MS = 15 * 60 * 1000;

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

/**
 * Recover any crashed batch left in 'pending'. Runs inside the reserve tx.
 * Returns true when a fresh no-id pending batch (within the send lease) was
 * found — the caller must abort instead of reserving on top of it.
 */
async function recoverPendingBatch(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  campaignId: number,
  performedBy: number,
): Promise<boolean> {
  const pending = await tx
    .select()
    .from(b)
    .where(and(eq(b.campaignId, campaignId), eq(b.status, "pending")));
  let activeSendInProgress = false;
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
    } else if (now.getTime() - batch.createdAt.getTime() < BATCH_SEND_LEASE_MS) {
      // No Brevo id YET — but the batch is fresh, so another worker may be
      // between committing its reservation and persisting the Brevo id.
      // Releasing now would let this run resend the same recipients while
      // the other worker's send goes out. Abort instead; release becomes
      // safe only once the lease has expired (proven crash).
      activeSendInProgress = true;
    } else {
      // Brevo campaign was never created and the lease has long expired —
      // releasing is provably safe.
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
  return activeSendInProgress;
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
        inArray(c.status, [
          "sending",
          "queued",
          "waiting_quota",
          "waiting_rate_limit",
          "needs_attention",
        ]),
      ),
    );
  await audit(tx, campaignId, "CAMPAIGN_COMPLETED", performedBy, {
    finalStatus: status,
    failedCount: counts?.failed ?? 0,
  });
  return status;
}

/**
 * Advisory-lock class for campaign sends. One send may run per campaign at a
 * time, enforced by a SESSION-level Postgres advisory lock held on a
 * dedicated connection across the ENTIRE run — including the remote Brevo
 * phase. Unlike the createdAt lease (which guards against zombie HTTP
 * requests from a worker whose DB session died), the lock is crash-sensitive:
 * it blocks a second runner for as long as the first worker's session is
 * alive, no matter how slow it is, and frees automatically the moment the
 * session dies.
 */
const EA_SEND_LOCK_CLASS = 741001;

export async function runCampaignBatch(
  campaignId: number,
  performedBy: number,
): Promise<BatchRunResult> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [EA_SEND_LOCK_CLASS, campaignId],
    );
    if (!rows[0]?.locked) {
      return {
        ok: false,
        code: "in_progress",
        message:
          "Another send for this campaign is running right now (its worker is still alive). Wait for it to finish, then press \"Send next batch\" again.",
        campaignStatus: "sending",
      };
    }
    try {
      return await runCampaignBatchLocked(campaignId, performedBy);
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1, $2)", [EA_SEND_LOCK_CLASS, campaignId])
        .catch(() => {
          /* session teardown releases it regardless */
        });
    }
  } finally {
    client.release();
  }
}

async function runCampaignBatchLocked(
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
    if (
      !["queued", "waiting_quota", "waiting_rate_limit", "needs_attention", "sending"].includes(
        campaign.status,
      )
    ) {
      return { error: "bad_status" as const, status: campaign.status };
    }

    const activeSend = await recoverPendingBatch(tx, campaignId, performedBy);
    if (activeSend) return { error: "in_progress" as const };

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
  if (reserved.error === "in_progress")
    return {
      ok: false,
      code: "in_progress",
      message:
        "Another send for this campaign appears to be in progress. Wait for it to finish; if it crashed, retry after 15 minutes and it will recover safely.",
      campaignStatus: "sending",
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
  // Release is only ever called when NOTHING can have been sent (no Brevo
  // campaign, or an explicit 4xx sendNow rejection). The recipient queue is
  // preserved: rows go back to 'queued' for a safe retry.
  const release = async (
    detail: string,
    campaignStatus:
      | "queued"
      | "waiting_quota"
      | "waiting_rate_limit"
      | "needs_attention" = "queued",
  ): Promise<void> => {
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
        .set({ status: campaignStatus, updatedAt: now })
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
  let brevoListId: number | null = null;
  try {
    // One brand-new, never-reused list per batch: a concurrent batch (same
    // or other campaign) can never swap this batch's audience before send.
    const listId = await createBatchList(
      `${BREVO_LIST_NAMES[campaign.type as EarlyAccessCampaignType]} — c${campaignId} b${batchNumber}`,
    );
    brevoListId = listId;
    // Persist the list id IMMEDIATELY: if any later step fails, the cleanup
    // pass can still find and delete this remote list. Kept in memory only,
    // it would leak on Brevo forever.
    await db.update(b).set({ brevoListId: listId }).where(eq(b.id, batch.id));
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
    // Untrusted Brevo response text is scrubbed of any email addresses
    // BEFORE it is persisted or surfaced (validation errors can echo a
    // recipient address back).
    const message = scrubBrevoMessage(
      err instanceof BrevoMarketingDisabledError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Brevo request failed",
    );
    const { kind, retryAfterSeconds } = classifyBrevoError(err);

    // `conflict` (409/duplicate) can mean "already processing" — it MUST be
    // treated like an ambiguous outcome: never delete the draft, never
    // recreate, never resend. Same conservative path as network loss/5xx —
    // but only once a Brevo campaign exists; before creation nothing can be
    // in flight, so a conflict there is a plain safe-release retry.
    const ambiguousOutcome =
      kind === "ambiguous" || (kind === "conflict" && brevoCampaignId !== null);

    if (!ambiguousOutcome) {
      // Explicit refusal (or 404 = object provably gone): NOTHING was sent.
      // Clean up the never-sent draft campaign when one exists, release the
      // recipients back to the queue, and park the campaign in the status
      // that tells the admin exactly what to do next.
      let draftCleaned = false;
      if (brevoCampaignId !== null) {
        try {
          await deleteCampaign(brevoCampaignId);
          draftCleaned = true;
          if (brevoListId !== null) {
            await deleteList(brevoListId);
            await db
              .update(b)
              .set({ brevoListDeletedAt: new Date() })
              .where(eq(b.id, batch.id));
          }
        } catch {
          /* draft cleanup is retried by the orphan-cleanup pass */
        }
      }
      // kind !== "ambiguous" here: ambiguousOutcome is false.
      const failure = FAILURE_HANDLING[kind as Exclude<BrevoFailureKind, "ambiguous">];
      const status = err instanceof BrevoApiError ? err.status : null;
      const brevoCode = err instanceof BrevoApiError ? err.brevoCode : null;
      await release(
        `brevo_${kind}(${brevoCode ?? status ?? "error"}): ${message}`,
        failure.campaignStatus,
      );
      await audit(db, campaignId, "BATCH_REJECTED", performedBy, {
        batchNumber,
        classification: kind,
        brevoStatus: status,
        brevoCode,
        retryAfterSeconds,
        stage: brevoCampaignId === null ? "before_send" : "send_rejected",
        draftCleaned,
      });
      return {
        ok: false,
        code: failure.code,
        message: failure.buildMessage(message, retryAfterSeconds),
        campaignStatus: failure.campaignStatus,
      };
    }

    if (brevoCampaignId === null) {
      // Ambiguous failure BEFORE the Brevo campaign existed (list/contact
      // stage): nothing can have been sent — releasing is provably safe.
      await release(`brevo_error: ${message}`);
      return {
        ok: false,
        code: "brevo_error",
        message: `Brevo request failed before any email was sent; recipients were returned to the queue. (${message})`,
        campaignStatus: "queued",
      };
    }
    // Ambiguous failure AFTER the campaign existed (timeout/network/5xx on
    // sendNow, or a 409 conflict): the send may have fired. Batch stays
    // 'pending' with the Brevo id; the next run's recovery conservatively
    // marks it assumed-sent. Never auto-retried — a duplicate email is worse
    // than a skipped batch.
    return {
      ok: false,
      code: "needs_recovery_review",
      message:
        kind === "conflict"
          ? `Brevo reported a conflict (HTTP 409) — the campaign may already be processing on Brevo's side. The batch is held for manual verification; pressing "Send next batch" will mark it as assumed-sent (never resent). Check the campaign in the Brevo dashboard. (${message})`
          : `The send request to Brevo failed AFTER the campaign was created — it may still have gone out. The batch is held; pressing "Continue next batch" will mark it as assumed-sent (never resent). Verify in the Brevo dashboard. (${message})`,
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

  // Opportunistic, best-effort cleanup of EARLIER batches' temporary Brevo
  // lists (this batch's own list is still in use by the in-flight send and
  // is skipped by the active-send check). Failures never affect the batch.
  try {
    await cleanupBatchLists(campaignId, performedBy);
  } catch {
    /* surfaced via cleanupAttempts/orphanedBrevoLists, retried later */
  }

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

// ---------------------------------------------------------------------------
// Temporary Brevo list cleanup
// ---------------------------------------------------------------------------

/**
 * TEMPORARY LIST LIFECYCLE — Brevo's contact-list quota is finite, so the
 * one-list-per-batch design MUST NOT leak a list per batch forever.
 *
 * A batch's list is deleted only once ALL of these hold:
 *   1. the local immutable recipient snapshot is preserved (always — we
 *      never delete local rows),
 *   2. webhook matching does not need the list (webhooks are matched by
 *      recipient EMAIL against local rows, never by list id),
 *   3. deleting cannot affect an active send:
 *      - batch 'failed' (recipients released, nothing in flight), or
 *      - batch 'sent' AND Brevo reports the campaign status as
 *        'sent'/'archive' (or the campaign no longer exists).
 *
 * Cleanup state lives on the batch row (brevoListDeletedAt /
 * cleanupAttempts / cleanupLastError): it is idempotent (remote 404 counts
 * as deleted), retryable without EVER touching recipients or resending
 * anything, and repeated failures surface as an admin warning
 * (orphanedBrevoLists). The local campaign, recipients, consent evidence,
 * audit history and the brevoCampaignId reference are NEVER deleted.
 */
const BREVO_DELETABLE_CAMPAIGN_STATUSES = new Set(["sent", "archive", "archived"]);

/** Attempts >= this with no success ⇒ shown as orphaned in admin. */
export const CLEANUP_ORPHAN_ATTEMPT_THRESHOLD = 3;

export type ListCleanupResult = {
  checked: number;
  deleted: number;
  skippedStillActive: number;
  failed: number;
};

export async function cleanupBatchLists(
  campaignId: number,
  performedBy: number | null,
): Promise<ListCleanupResult> {
  const result: ListCleanupResult = {
    checked: 0,
    deleted: 0,
    skippedStillActive: 0,
    failed: 0,
  };
  // Without Brevo access there is nothing safe to do — never guess.
  if (!marketingSendingStatus().enabled) return result;

  const candidates = await db
    .select()
    .from(b)
    .where(
      and(
        eq(b.campaignId, campaignId),
        isNull(b.brevoListDeletedAt),
        sql`${b.brevoListId} is not null`,
        inArray(b.status, ["sent", "failed"]),
      ),
    );
  for (const batch of candidates) {
    result.checked += 1;
    try {
      if (batch.status === "sent" && batch.brevoCampaignId !== null) {
        const status = await getCampaignStatus(batch.brevoCampaignId);
        if (status !== null && !BREVO_DELETABLE_CAMPAIGN_STATUSES.has(status)) {
          // Still queued/inProcess on Brevo's side — deleting the list now
          // could affect the active send. Try again later.
          result.skippedStillActive += 1;
          continue;
        }
      }
      await deleteList(batch.brevoListId!);
      await db
        .update(b)
        .set({ brevoListDeletedAt: new Date(), cleanupLastError: null })
        .where(eq(b.id, batch.id));
      await audit(db, campaignId, "BREVO_CLEANUP", performedBy, {
        batchNumber: batch.batchNumber,
        brevoListId: batch.brevoListId,
      });
      result.deleted += 1;
    } catch (err) {
      result.failed += 1;
      const message =
        err instanceof Error ? err.message.slice(0, 200) : "cleanup failed";
      await db
        .update(b)
        .set({
          cleanupAttempts: sql`${b.cleanupAttempts} + 1`,
          cleanupLastError: message,
        })
        .where(eq(b.id, batch.id));
      await audit(db, campaignId, "BREVO_CLEANUP_FAILED", performedBy, {
        batchNumber: batch.batchNumber,
        brevoListId: batch.brevoListId,
        attempt: (batch.cleanupAttempts ?? 0) + 1,
      });
    }
  }
  return result;
}

/** Batches whose list cleanup failed repeatedly — admin warning surface. */
export async function orphanedBrevoLists(campaignId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(b)
    .where(
      and(
        eq(b.campaignId, campaignId),
        isNull(b.brevoListDeletedAt),
        sql`${b.brevoListId} is not null`,
        sql`${b.cleanupAttempts} >= ${CLEANUP_ORPHAN_ATTEMPT_THRESHOLD}`,
      ),
    );
  return row?.count ?? 0;
}
