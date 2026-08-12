import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  earlyAccessCampaignsTable,
  earlyAccessCampaignRecipientsTable,
  earlyAccessCampaignBatchesTable,
  earlyAccessCampaignEventsTable,
  EARLY_ACCESS_CAMPAIGN_TYPES,
  type EarlyAccessCampaign,
  type EarlyAccessCampaignType,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { authMiddleware, adminOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import {
  acquireQuotaLock,
  computeAudience,
  effectiveDailyCap,
  marketingSendsToday,
  marketingSendsThisPeriod,
  remainingDailyQuota,
  renderCampaignEmail,
  selectEligibleRegistrations,
  sendAllowanceModel,
  testSendDailyLimitGlobal,
  testSendsTodayForCampaign,
  testSendsTodayGlobal,
  TEST_SEND_DAILY_LIMIT_PER_CAMPAIGN,
  validateCampaignContent,
  validateCtaUrl,
} from "../lib/early-access-campaigns";
import {
  cleanupBatchLists,
  orphanedBrevoLists,
  runCampaignBatch,
} from "../lib/early-access-campaign-batch";
import { marketingSendingStatus } from "../lib/brevo-marketing";
import { sendEarlyAccessCampaignTestEmail } from "../lib/email";
import { buildUnsubscribeUrl } from "../lib/early-access-unsubscribe";

const router: IRouter = Router();

/**
 * Admin-only launch/marketing campaign management (Phase 2B).
 *
 * Everything that matters is enforced HERE, server-side:
 * - recipient eligibility and counts are recomputed from the local DB at
 *   queue time (a stale UI count → 409 with fresh numbers, never a send);
 * - the typed confirmation phrase must match the SERVER's eligible count;
 * - content rules (plain-text fields, HTTPS-only CTA) are validated again
 *   before test sends and queueing;
 * - state transitions are conditional UPDATEs, so double-clicks are no-ops.
 *
 * Audit events record actions and counts only — never recipient lists,
 * email bodies, keys or tokens.
 */

const c = earlyAccessCampaignsTable;
const r = earlyAccessCampaignRecipientsTable;
const b = earlyAccessCampaignBatchesTable;
const e = earlyAccessCampaignEventsTable;

router.use("/admin/early-access/campaigns", authMiddleware, adminOnly);

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Editable content fields from the request body (whitelist — never spread). */
function contentFieldsFromBody(body: Record<string, unknown>) {
  return {
    name: str(body.name, 120),
    subject: str(body.subject, 150),
    previewText: str(body.previewText, 200),
    heading: str(body.heading, 150),
    bodyText: typeof body.bodyText === "string" ? body.bodyText.trim().slice(0, 5000) : "",
    ctaLabel: str(body.ctaLabel, 60),
    ctaUrl: str(body.ctaUrl, 500),
  };
}

async function recipientCounts(campaignId: number) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      queued: sql<number>`count(*) filter (where ${r.status} = 'queued')::int`,
      sending: sql<number>`count(*) filter (where ${r.status} = 'sending')::int`,
      sent: sql<number>`count(*) filter (where ${r.status} = 'sent')::int`,
      delivered: sql<number>`count(*) filter (where ${r.status} = 'delivered')::int`,
      failed: sql<number>`count(*) filter (where ${r.status} = 'failed')::int`,
      bounced: sql<number>`count(*) filter (where ${r.status} = 'bounced')::int`,
      complained: sql<number>`count(*) filter (where ${r.status} = 'complained')::int`,
      unsubscribed: sql<number>`count(*) filter (where ${r.status} = 'unsubscribed')::int`,
      suppressed: sql<number>`count(*) filter (where ${r.status} = 'suppressed')::int`,
      cancelled: sql<number>`count(*) filter (where ${r.status} = 'cancelled')::int`,
    })
    .from(r)
    .where(eq(r.campaignId, campaignId));
  return row;
}

async function quotaInfo() {
  const model = sendAllowanceModel();
  return {
    dailyCap: effectiveDailyCap(),
    sentToday: await marketingSendsToday(db),
    remainingToday: await remainingDailyQuota(db),
    brevoSending: marketingSendingStatus(),
    /**
     * Allowance transparency for the dashboard. Every number here is a
     * LOCAL estimate of what THIS system sent — it cannot see transactional
     * traffic beyond the configured reserve, and Brevo exposes no reliable
     * live balance API on these plans.
     */
    allowance: {
      accountDailyCap: model.accountDailyCap, // null = no daily cap (paid plan)
      accountMonthlyCap: model.accountMonthlyCap, // null = no monthly cap
      monthlyResetDay: model.monthlyResetDay,
      marketingDailyCap: model.marketingDailyCap,
      transactionalDailyReserve: model.transactionalDailyReserve,
      transactionalMonthlyReserve: model.transactionalMonthlyReserve,
      sentThisPeriod:
        model.accountMonthlyCap !== null
          ? await marketingSendsThisPeriod(db)
          : null,
      configIssues: model.configIssues,
      source: "local_estimate" as const,
      sourceNote:
        "Local safety estimate — Brevo's dashboard remains the source of truth.",
    },
  };
}

// --------------------------- list + create ---------------------------------

router.get("/admin/early-access/campaigns", async (_req, res) => {
  const campaigns = await db.select().from(c).orderBy(desc(c.createdAt));
  const counts =
    campaigns.length > 0
      ? await db
          .select({
            campaignId: r.campaignId,
            total: sql<number>`count(*)::int`,
            sent: sql<number>`count(*) filter (where ${r.status} in ('sent','delivered'))::int`,
            queued: sql<number>`count(*) filter (where ${r.status} = 'queued')::int`,
          })
          .from(r)
          .where(inArray(r.campaignId, campaigns.map((row) => row.id)))
          .groupBy(r.campaignId)
      : [];
  const byId = new Map(counts.map((row) => [row.campaignId, row]));
  res.json({
    campaigns: campaigns.map((row) => ({
      ...row,
      progress: byId.get(row.id) ?? { total: 0, sent: 0, queued: 0 },
    })),
    quota: await quotaInfo(),
  });
});

router.post("/admin/early-access/campaigns", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const type = body.type;
  if (
    typeof type !== "string" ||
    !EARLY_ACCESS_CAMPAIGN_TYPES.includes(type as EarlyAccessCampaignType)
  ) {
    res.status(400).json({ error: "type must be 'launch' or 'marketing'." });
    return;
  }
  const fields = contentFieldsFromBody(body);
  if (!fields.name) {
    res.status(400).json({ error: "Internal name is required." });
    return;
  }
  if (fields.ctaUrl) {
    const urlError = validateCtaUrl(fields.ctaUrl);
    if (urlError) {
      res.status(400).json({ error: urlError });
      return;
    }
  }
  const [created] = await db
    .insert(c)
    .values({ ...fields, type, status: "draft", createdBy: authReq.userId })
    .returning();
  await db.insert(e).values({
    campaignId: created.id,
    kind: "CAMPAIGN_CREATED",
    performedBy: authReq.userId,
    details: { type },
  });
  res.status(201).json({ campaign: created });
});

// --------------------------- detail + edit ----------------------------------

async function loadCampaign(id: number): Promise<EarlyAccessCampaign | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db.select().from(c).where(eq(c.id, id));
  return row ?? null;
}

router.get("/admin/early-access/campaigns/:id", async (req, res) => {
  const campaign = await loadCampaign(Number(req.params.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  const [batches, events, counts] = await Promise.all([
    db
      .select()
      .from(b)
      .where(eq(b.campaignId, campaign.id))
      .orderBy(desc(b.batchNumber)),
    db
      .select()
      .from(e)
      .where(eq(e.campaignId, campaign.id))
      .orderBy(desc(e.createdAt))
      .limit(50),
    recipientCounts(campaign.id),
  ]);
  res.json({
    campaign,
    recipients: counts,
    batches,
    events,
    contentErrors: validateCampaignContent(campaign),
    // Live audience preview only matters before the snapshot exists.
    ...(campaign.status === "draft"
      ? { audience: await computeAudience(campaign.type as EarlyAccessCampaignType) }
      : {}),
    quota: await quotaInfo(),
    testSendsToday: await testSendsTodayForCampaign(db, campaign.id),
    testSendDailyLimit: TEST_SEND_DAILY_LIMIT_PER_CAMPAIGN,
    testSendsTodayGlobal: await testSendsTodayGlobal(db),
    testSendDailyLimitGlobal: testSendDailyLimitGlobal(),
    /** Batches whose temporary Brevo list cleanup keeps failing. */
    orphanedBrevoLists: await orphanedBrevoLists(campaign.id),
  });
});

/**
 * Retry temporary Brevo list cleanup for this campaign's batches. Safe to
 * call any time: it is idempotent, only deletes remote lists whose send can
 * no longer be affected, and NEVER touches local recipients, consent
 * evidence, audit rows or the Brevo campaign reference — so it can never
 * cause a resend.
 */
router.post("/admin/early-access/campaigns/:id/cleanup", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const campaign = await loadCampaign(Number(req.params.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  if (!marketingSendingStatus().enabled) {
    res.status(409).json({
      error: "Brevo sending is disabled — cleanup needs Brevo API access.",
    });
    return;
  }
  const result = await cleanupBatchLists(campaign.id, authReq.userId);
  res.json({
    ...result,
    orphanedBrevoLists: await orphanedBrevoLists(campaign.id),
  });
});

router.patch("/admin/early-access/campaigns/:id", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const campaign = await loadCampaign(Number(req.params.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  if (campaign.status !== "draft") {
    res.status(409).json({
      error: "Only draft campaigns can be edited — content is immutable once queued.",
    });
    return;
  }
  const fields = contentFieldsFromBody((req.body ?? {}) as Record<string, unknown>);
  if (!fields.name) {
    res.status(400).json({ error: "Internal name is required." });
    return;
  }
  if (fields.ctaUrl) {
    const urlError = validateCtaUrl(fields.ctaUrl);
    if (urlError) {
      res.status(400).json({ error: urlError });
      return;
    }
  }
  const [updated] = await db
    .update(c)
    .set({ ...fields, updatedAt: new Date() })
    // Conditional on status: a concurrent queue wins, the edit is rejected.
    .where(and(eq(c.id, campaign.id), eq(c.status, "draft")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Campaign was queued while you were editing." });
    return;
  }
  await db.insert(e).values({
    campaignId: campaign.id,
    kind: "CAMPAIGN_UPDATED",
    performedBy: authReq.userId,
    details: {},
  });
  res.json({ campaign: updated });
});

// --------------------------- preview + test send ----------------------------

router.get("/admin/early-access/campaigns/:id/preview", async (req, res) => {
  const campaign = await loadCampaign(Number(req.params.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  const { html, text } = renderCampaignEmail(campaign, {
    greetingName: "Alex",
    unsubscribeUrl: "https://mylocaltrade.co.uk/unsubscribe",
  });
  res.json({ html, text, contentErrors: validateCampaignContent(campaign) });
});

router.post("/admin/early-access/campaigns/:id/test-send", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const campaign = await loadCampaign(Number(req.params.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  const contentErrors = validateCampaignContent(campaign);
  if (contentErrors.length > 0) {
    res.status(400).json({ error: contentErrors[0], contentErrors });
    return;
  }
  const [admin] = await db
    .select({ email: usersTable.email, name: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, authReq.userId));
  if (!admin) {
    res.status(400).json({ error: "Admin account not found." });
    return;
  }
  // Test emails consume real Brevo credits: check the per-campaign limit
  // AND the shared daily quota, and consume the quota (provisional
  // TEST_SENT event) inside ONE quota-locked transaction so a concurrent
  // batch reservation can never double-spend the same remaining quota.
  const gate = await db.transaction(async (tx) => {
    await acquireQuotaLock(tx);
    if (
      (await testSendsTodayForCampaign(tx, campaign.id)) >=
      TEST_SEND_DAILY_LIMIT_PER_CAMPAIGN
    ) {
      return { error: "limit" as const };
    }
    // Brevo's test-email allowance is GLOBAL per account/day — enforce a
    // global cross-campaign, cross-admin limit under the same lock.
    if ((await testSendsTodayGlobal(tx)) >= testSendDailyLimitGlobal()) {
      return { error: "global_limit" as const };
    }
    if ((await remainingDailyQuota(tx)) <= 0) {
      return { error: "quota" as const };
    }
    const [event] = await tx
      .insert(e)
      .values({
        campaignId: campaign.id,
        kind: "TEST_SENT",
        performedBy: authReq.userId,
        // Provisional ok:true reserves the quota; downgraded below if the
        // dispatch fails (over-counting is the safe direction).
        details: { channel: "pending", ok: true },
      })
      .returning({ id: e.id });
    return { error: null, eventId: event.id };
  });
  if (gate.error === "limit") {
    res.status(429).json({
      error: `Test-send limit reached for this campaign (${TEST_SEND_DAILY_LIMIT_PER_CAMPAIGN}/day).`,
    });
    return;
  }
  if (gate.error === "global_limit") {
    res.status(429).json({
      error: `Global test-send limit reached for today (${testSendDailyLimitGlobal()} across all campaigns and admins).`,
    });
    return;
  }
  if (gate.error === "quota") {
    res.status(429).json({ error: "Daily send quota is exhausted." });
    return;
  }
  // Test copy goes ONLY to the requesting admin — never a client-supplied
  // address (that would make this a free bulk-send endpoint).
  const { html, text } = renderCampaignEmail(campaign, {
    greetingName: admin.name.split(/\s+/)[0] || "there",
    unsubscribeUrl: "https://mylocaltrade.co.uk/unsubscribe",
    isTest: true,
  });
  let channel = "failed";
  try {
    channel = await sendEarlyAccessCampaignTestEmail({
      toEmail: admin.email,
      toName: admin.name,
      subject: campaign.subject,
      html,
      text,
    });
  } catch (err) {
    req.log.error({ err }, "Campaign test send failed");
  }
  const ok = channel === "brevo" || channel === "smtp";
  await db
    .update(e)
    .set({ details: { channel, ok } })
    .where(eq(e.id, gate.eventId));
  if (!ok) {
    res.status(502).json({ error: "Test email could not be delivered.", channel });
    return;
  }
  res.json({ success: true, channel });
});

// --------------------------- audience + queue -------------------------------

router.get("/admin/early-access/campaigns/:id/audience", async (req, res) => {
  const campaign = await loadCampaign(Number(req.params.id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  const audience = await computeAudience(
    campaign.type as EarlyAccessCampaignType,
  );
  const cap = effectiveDailyCap();
  res.json({
    audience,
    dailyCap: cap,
    estimatedDays: cap > 0 ? Math.ceil(audience.eligible / cap) : null,
    confirmationPhrase: `SEND TO ${audience.eligible} PEOPLE`,
    quota: await quotaInfo(),
  });
});

router.post("/admin/early-access/campaigns/:id/queue", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const id = Number(req.params.id);
  const confirmation = (req.body as Record<string, unknown>)?.confirmation;
  const result = await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(c).where(eq(c.id, id)).for("update");
    if (!campaign) return { status: 404 as const, error: "Campaign not found." };
    if (campaign.status !== "draft") {
      return {
        status: 409 as const,
        error: `Campaign is already ${campaign.status}.`,
      };
    }
    const contentErrors = validateCampaignContent(campaign);
    if (contentErrors.length > 0) {
      return { status: 400 as const, error: contentErrors[0], contentErrors };
    }
    // The eligible set is recomputed HERE, at queue time, under the campaign
    // row lock. The typed phrase must match the server's count exactly.
    const eligible = await selectEligibleRegistrations(
      tx,
      campaign.type as EarlyAccessCampaignType,
    );
    const expectedPhrase = `SEND TO ${eligible.length} PEOPLE`;
    if (confirmation !== expectedPhrase) {
      return {
        status: 409 as const,
        error:
          "Confirmation phrase does not match the current audience. Re-check the numbers and type it again.",
        expectedCount: eligible.length,
      };
    }
    if (eligible.length === 0) {
      return { status: 400 as const, error: "No eligible recipients." };
    }
    const now = new Date();
    // Immutable snapshot: WHO gets this campaign is fixed now; later
    // opt-outs are honoured by the per-batch re-check, never by widening.
    for (let i = 0; i < eligible.length; i += 500) {
      await tx.insert(r).values(
        eligible.slice(i, i + 500).map((reg) => ({
          campaignId: campaign.id,
          registrationId: reg.id,
          emailNormalized: reg.emailNormalized,
          name: reg.name,
          status: "queued",
        })),
      );
    }
    await tx
      .update(c)
      .set({
        status: "queued",
        queuedAt: now,
        queuedBy: authReq.userId,
        snapshotCount: eligible.length,
        updatedAt: now,
      })
      .where(eq(c.id, campaign.id));
    await tx.insert(e).values({
      campaignId: campaign.id,
      kind: "CAMPAIGN_QUEUED",
      performedBy: authReq.userId,
      details: { snapshotCount: eligible.length, confirmed: true },
    });
    return { status: 200 as const, snapshotCount: eligible.length };
  });
  if (result.status !== 200) {
    res.status(result.status).json(result);
    return;
  }
  res.json({ success: true, snapshotCount: result.snapshotCount });
});

// --------------------------- batch + lifecycle ------------------------------

router.post("/admin/early-access/campaigns/:id/send-batch", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  const result = await runCampaignBatch(id, authReq.userId);
  if (!result.ok) {
    const status =
      result.code === "not_found"
        ? 404
        : result.code === "quota_exhausted" ||
            result.code === "brevo_credits" ||
            result.code === "brevo_rate_limited"
          ? 429
          : result.code === "brevo_invalid" || result.code === "brevo_auth"
            ? 422
            : result.code === "brevo_error" || result.code === "needs_recovery_review"
              ? 502
              : 409;
    res.status(status).json(result);
    return;
  }
  res.json(result);
});

async function transition(opts: {
  id: number;
  from: string[];
  to: string;
  kind: string;
  performedBy: number;
}): Promise<EarlyAccessCampaign | null> {
  const [updated] = await db
    .update(c)
    .set({ status: opts.to, updatedAt: new Date() })
    .where(and(eq(c.id, opts.id), inArray(c.status, opts.from)))
    .returning();
  if (updated) {
    await db.insert(e).values({
      campaignId: opts.id,
      kind: opts.kind,
      performedBy: opts.performedBy,
      details: {},
    });
  }
  return updated ?? null;
}

router.post("/admin/early-access/campaigns/:id/pause", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const updated = await transition({
    id: Number(req.params.id),
    from: ["queued", "waiting_quota", "waiting_rate_limit", "needs_attention"],
    to: "paused",
    kind: "CAMPAIGN_PAUSED",
    performedBy: authReq.userId,
  });
  if (!updated) {
    res.status(409).json({
      error: "Only queued or waiting campaigns can be paused (batches in flight always finish).",
    });
    return;
  }
  res.json({ campaign: updated });
});

router.post("/admin/early-access/campaigns/:id/resume", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const updated = await transition({
    id: Number(req.params.id),
    from: ["paused"],
    to: "queued",
    kind: "CAMPAIGN_RESUMED",
    performedBy: authReq.userId,
  });
  if (!updated) {
    res.status(409).json({ error: "Only paused campaigns can be resumed." });
    return;
  }
  res.json({ campaign: updated });
});

router.post("/admin/early-access/campaigns/:id/cancel", async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const id = Number(req.params.id);
  const result = await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(c).where(eq(c.id, id)).for("update");
    if (!campaign) return { status: 404 as const, error: "Campaign not found." };
    if (
      ![
        "draft",
        "queued",
        "waiting_quota",
        "waiting_rate_limit",
        "needs_attention",
        "paused",
      ].includes(campaign.status)
    ) {
      return {
        status: 409 as const,
        error: `Campaign is ${campaign.status} and can no longer be cancelled.`,
      };
    }
    const now = new Date();
    const cancelledRecipients = await tx
      .update(r)
      .set({ status: "cancelled", statusDetail: "campaign_cancelled", updatedAt: now })
      .where(and(eq(r.campaignId, id), eq(r.status, "queued")))
      .returning({ id: r.id });
    await tx
      .update(c)
      .set({ status: "cancelled", completedAt: now, updatedAt: now })
      .where(eq(c.id, id));
    await tx.insert(e).values({
      campaignId: id,
      kind: "CAMPAIGN_CANCELLED",
      performedBy: authReq.userId,
      details: { cancelledRecipients: cancelledRecipients.length },
    });
    return { status: 200 as const, cancelledRecipients: cancelledRecipients.length };
  });
  if (result.status !== 200) {
    res.status(result.status).json(result);
    return;
  }
  res.json({ success: true, cancelledRecipients: result.cancelledRecipients });
});

export default router;
