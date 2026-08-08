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
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";

const router: IRouter = Router();

const CreateReportBody = z.object({
  reportedRole: z.enum(["trader", "customer"]),
  traderProfileId: z.number().int().positive().optional(),
  category: z.string().trim().min(1).max(48),
  detail: z.string().trim().max(2000).optional(),
  conversationId: z.number().int().positive().optional(),
});

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
    if (body.reportedRole !== expectedSubject) {
      res.status(400).json({ error: `A ${reporterRole} can only report a ${expectedSubject}` });
      return;
    }

    if (!isValidReportCategory(body.reportedRole, body.category)) {
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

    if (body.reportedRole === "trader") {
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

    await db.insert(userReportsTable).values({
      reporterUserId: userId,
      reporterRole,
      reportedUserId,
      reportedRole: body.reportedRole,
      reportedTraderProfileId,
      category: body.category,
      detail,
      conversationId,
      status: "OPEN",
    });

    res.status(201).json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid report", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Create user report failed");
    res.status(500).json({ error: "Failed to submit report" });
  }
});

export default router;
