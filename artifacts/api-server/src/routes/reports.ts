import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { getActiveMembership } from "../lib/company-membership";
import {
  userReportsTable,
  traderProfilesTable,
  conversationsTable,
  REPORT_CATEGORIES,
  isValidReportCategory,
  type ReportSubject,
  reviewsTable,
  conversationReportsTable,
  reportAppealsTable,
  REPORT_OUTCOMES,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { logAudit } from "../lib/trader-status";
import {
  CONVERSATION_REPORT_APPEAL_WINDOW_MS,
  reopenConversationReportEvidenceHold,
} from "../lib/conversation-report-evidence";

const router: IRouter = Router();

const CreateReportBody = z.object({
  reportedRole: z.enum(["trader", "customer"]),
  traderProfileId: z.number().int().positive().optional(),
  category: z.string().trim().min(1).max(48),
  detail: z.string().trim().max(2000).optional(),
  conversationId: z.number().int().positive().optional(),
  reviewId: z.number().int().positive().optional(),
});

const AppealBody = z.object({ reason: z.string().trim().min(10).max(2000) });
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && (error as { code?: string }).code === "23505";
}

function canAppealReport(
  report: {
    status: string;
    outcome: string | null;
    outcomeAt: Date | null;
    cseaEscalatedAt: Date | null;
  },
  hasAppeal: boolean,
): boolean {
  return Boolean(
    !hasAppeal &&
    report.status !== "OPEN" &&
    report.outcome &&
    report.outcomeAt &&
    !report.cseaEscalatedAt &&
    Date.now() - report.outcomeAt.getTime() <= CONVERSATION_REPORT_APPEAL_WINDOW_MS,
  );
}

// GET /api/report-categories — public list of the predefined reasons, keyed by
// the subject being reported. Mobile renders the picker from this so the client
// never drifts from the server's accepted set.
router.get("/report-categories", (_req, res) => {
  res.json({ categories: REPORT_CATEGORIES });
});

// POST /api/reports — file a profile-level report (login required).
// Customers report traders; traders report customers.
router.post("/reports", authMiddleware, async (req, res) => {
  try {
    const body = CreateReportBody.parse(req.body);
    const { userId, userRole } = req as AuthenticatedRequest;

    const reporterRole = userRole === "trader" ? "trader" : userRole === "customer" ? "customer" : null;
    if (!reporterRole) {
      res.status(403).json({ error: "Only customers and traders can file reports" });
      return;
    }

    // Enforce the two supported directions: a customer reports a trader, a
    // trader reports a customer.
    const expectedSubject: ReportSubject = reporterRole === "customer" ? "trader" : "customer";
    const isReviewReport = body.reviewId != null;
    if (body.reportedRole !== expectedSubject && !isReviewReport) {
      res.status(400).json({ error: `A ${reporterRole} can only report a ${expectedSubject}` });
      return;
    }

    if (!isValidReportCategory(isReviewReport ? "customer" : body.reportedRole, body.category)) {
      res.status(400).json({ error: "Invalid report category" });
      return;
    }

    const detail = body.detail?.trim() || null;
    if (body.category === "OTHER" && (!detail || detail.length < 10)) {
      res.status(400).json({ error: "Please describe the issue (at least 10 characters)" });
      return;
    }

    // Resolve the reported party's user id (and trader profile id when
    // relevant). conversationId is only recorded when the reporter is genuinely
    // a participant, never trusted from the client.
    let reportedUserId: number;
    let reportedTraderProfileId: number | null = null;
    let conversationId: number | null = null;

    if (body.reviewId) {
      // A trader may report a customer-authored review on that trader's own
      // profile. Derive both customer and profile from the review; do not trust
      // client-supplied IDs for the relationship.
      const membership = reporterRole === "trader" ? await getActiveMembership(userId) : null;
      const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, body.reviewId)).limit(1);
      if (!review || !membership || review.traderId !== membership.traderProfileId) {
        res.status(403).json({ error: "You can only report a review on your own trader profile" });
        return;
      }
      reportedUserId = review.customerId;
      reportedTraderProfileId = review.traderId;
    } else if (body.reportedRole === "trader") {
      if (!body.traderProfileId) {
        res.status(400).json({ error: "traderProfileId is required when reporting a trader" });
        return;
      }
      const [profile] = await db
        .select({ id: traderProfilesTable.id, userId: traderProfilesTable.userId })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.id, body.traderProfileId))
        .limit(1);
      if (!profile) {
        res.status(404).json({ error: "Trader not found" });
        return;
      }
      reportedUserId = profile.userId;
      reportedTraderProfileId = profile.id;

      if (body.conversationId) {
        const [conv] = await db
          .select({ id: conversationsTable.id, customerId: conversationsTable.customerId })
          .from(conversationsTable)
          .where(eq(conversationsTable.id, body.conversationId))
          .limit(1);
        if (conv && conv.customerId === userId) conversationId = conv.id;
      }
    } else {
      // A trader reporting a customer. The customer is ALWAYS derived from the
      // shared conversation after verifying the reporter is its trader, so the
      // client can never supply (or spoof) an arbitrary customer user id.
      if (!body.conversationId) {
        res.status(400).json({ error: "A conversation is required to report a customer" });
        return;
      }
      const membership = await getActiveMembership(userId);
      const traderProfile = membership ? { id: membership.traderProfileId } : undefined;
      const [conv] = await db
        .select({
          id: conversationsTable.id,
          customerId: conversationsTable.customerId,
          traderProfileId: conversationsTable.traderProfileId,
        })
        .from(conversationsTable)
        .where(eq(conversationsTable.id, body.conversationId))
        .limit(1);
      if (!conv || !traderProfile || conv.traderProfileId !== traderProfile.id) {
        res.status(403).json({ error: "You are not a participant in this conversation" });
        return;
      }
      reportedUserId = conv.customerId;
      conversationId = conv.id;
    }

    if (reportedUserId === userId) {
      res.status(400).json({ error: "You cannot report yourself" });
      return;
    }
    if (body.reviewId) {
    }

    const [created] = await db.insert(userReportsTable).values({
      reporterUserId: userId,
      reporterRole,
      reportedUserId,
      reportedRole: body.reviewId ? "customer" : body.reportedRole,
      reportedTraderProfileId,
      category: body.category,
      detail,
      conversationId,
      status: "OPEN",
      reviewId: body.reviewId ?? null,
    }).returning({ id: userReportsTable.id });
    await logAudit({ userId: reportedUserId, action: "USER_REPORT_CREATED", performedBy: userId, details: { reportId: created.id, category: body.category } });

    res.status(201).json({ ok: true, reportId: created.id });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid report", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Create user report failed");
    res.status(500).json({ error: "Failed to submit report" });
  }
});

// Reporters receive only their own reports and a safe decision summary.
router.get("/reports", authMiddleware, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const reports = await db.select({
    id: userReportsTable.id, category: userReportsTable.category, status: userReportsTable.status,
    outcome: userReportsTable.outcome, outcomeAt: userReportsTable.outcomeAt,
    createdAt: userReportsTable.createdAt, cseaEscalatedAt: userReportsTable.cseaEscalatedAt,
  }).from(userReportsTable).where(eq(userReportsTable.reporterUserId, userId));
  const chatReports = await db.select({
    id: conversationReportsTable.id, category: conversationReportsTable.category,
    status: conversationReportsTable.status, outcome: conversationReportsTable.outcome,
    outcomeAt: conversationReportsTable.outcomeAt, createdAt: conversationReportsTable.createdAt,
    cseaEscalatedAt: conversationReportsTable.cseaEscalatedAt,
  }).from(conversationReportsTable).where(eq(conversationReportsTable.reportedByUserId, userId));
  const userAppeals = reports.length ? await db.select().from(reportAppealsTable).where(eq(reportAppealsTable.appellantUserId, userId)) : [];
  const chatAppeals = chatReports.length ? await db.select().from(reportAppealsTable).where(eq(reportAppealsTable.appellantUserId, userId)) : [];
  res.json({ reports: [
    ...reports.map((r) => {
      const appeal = userAppeals.find((a) => a.reportId === r.id);
      return {
        id: r.id,
        category: r.category,
        status: r.status,
        outcome: r.outcome,
        reportType: "user",
        outcomeAt: r.outcomeAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        appeal: appeal ? { id: appeal.id, status: appeal.status, outcome: appeal.resolution } : null,
        // This intentionally exposes only a safe action-state boolean. It
        // never reveals whether restricted safety handling is involved.
        appealEligible: canAppealReport(r, Boolean(appeal)),
      };
    }),
    ...chatReports.map((r) => {
      const appeal = chatAppeals.find((a) => a.conversationReportId === r.id);
      return {
        id: r.id,
        category: r.category,
        status: r.status,
        outcome: r.outcome,
        reportType: "conversation",
        outcomeAt: r.outcomeAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        appeal: appeal ? { id: appeal.id, status: appeal.status, outcome: appeal.resolution } : null,
        appealEligible: canAppealReport(r, Boolean(appeal)),
      };
    }),
  ] });
});

router.post("/conversation-reports/:id/appeal", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    const body = AppealBody.parse(req.body);
    const { userId } = req as AuthenticatedRequest;
    const [report] = await db.select().from(conversationReportsTable)
      .where(and(eq(conversationReportsTable.id, id), eq(conversationReportsTable.reportedByUserId, userId))).limit(1);
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }
    if (!report.outcome || report.status === "OPEN" || report.cseaEscalatedAt) { res.status(409).json({ error: "This report has not received a final decision" }); return; }
    if (
      !report.outcomeAt ||
      Date.now() - report.outcomeAt.getTime() > CONVERSATION_REPORT_APPEAL_WINDOW_MS
    ) {
      res.status(409).json({ error: "The appeal period for this report has ended" });
      return;
    }
    const existing = await db.select({ id: reportAppealsTable.id }).from(reportAppealsTable)
      .where(and(eq(reportAppealsTable.conversationReportId, id), eq(reportAppealsTable.appellantUserId, userId))).limit(1);
    if (existing.length) { res.status(409).json({ error: "Only one appeal is permitted for a report" }); return; }
    const appeal = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(reportAppealsTable)
        .values({ conversationReportId: id, appellantUserId: userId, reason: body.reason })
        .returning({ id: reportAppealsTable.id });
      await reopenConversationReportEvidenceHold(tx, id);
      return created;
    });
    await logAudit({ userId, action: "REPORT_APPEAL_CREATED", performedBy: userId, details: { conversationReportId: id, appealId: appeal.id } });
    res.status(201).json({ appealId: appeal.id, status: "OPEN" });
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: "Only one appeal is permitted for this report" }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid appeal", details: error.issues }); return; }
    req.log.error({ err: error }, "Create conversation report appeal failed"); res.status(500).json({ error: "Failed to create appeal" });
  }
});

router.post("/reports/:id/appeal", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    const body = AppealBody.parse(req.body);
    const { userId } = req as AuthenticatedRequest;
    const [report] = await db.select().from(userReportsTable).where(and(eq(userReportsTable.id, id), eq(userReportsTable.reporterUserId, userId))).limit(1);
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }
    if (!report.outcome || report.status === "OPEN" || report.cseaEscalatedAt) { res.status(409).json({ error: "This report has not received a final decision" }); return; }
    if (
      !report.outcomeAt ||
      Date.now() - report.outcomeAt.getTime() > CONVERSATION_REPORT_APPEAL_WINDOW_MS
    ) {
      res.status(409).json({ error: "The appeal period for this report has ended" });
      return;
    }
    const existing = await db.select({ id: reportAppealsTable.id }).from(reportAppealsTable).where(and(eq(reportAppealsTable.reportId, id), eq(reportAppealsTable.appellantUserId, userId))).limit(1);
    if (existing.length) { res.status(409).json({ error: "Only one appeal is permitted for a report" }); return; }
    const [appeal] = await db.insert(reportAppealsTable).values({ reportId: id, appellantUserId: userId, reason: body.reason }).returning({ id: reportAppealsTable.id });
    await logAudit({ userId, action: "REPORT_APPEAL_CREATED", performedBy: userId, details: { reportId: id, appealId: appeal.id } });
    res.status(201).json({ appealId: appeal.id, status: "OPEN" });
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: "Only one appeal is permitted for this report" }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid appeal", details: error.issues }); return; }
    req.log.error({ err: error }, "Create report appeal failed"); res.status(500).json({ error: "Failed to create appeal" });
  }
});

export default router;
