import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  traderDocumentsTable,
  traderAuditLogTable,
  subscriptionsTable,
  enquiriesTable,
  conversationsTable,
  messagesTable,
  conversationReportsTable,
  reviewsTable,
} from "@workspace/db/schema";
import { and, eq, ilike, or, desc, sql, inArray, gte, lte, isNotNull, isNull, asc } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware, adminOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import {
  TRADER_STATUS,
  evaluateDocumentsComplete,
  logAudit,
} from "../lib/trader-status";
import {
  getAttemptCountsByConversation,
  getConversationAttemptStats,
  listRecentAttemptsForConversation,
  CONTACT_BYPASS_THRESHOLD,
} from "../lib/contact-block-tracker";
import {
  sendDocumentApprovedEmail,
  sendDocumentRejectedEmail,
  sendTraderApprovedEmail,
  sendTraderRejectedEmail,
  sendTraderMoreInfoRequestedEmail,
  sendTraderSuspendedEmail,
} from "../lib/email";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const REVIEWABLE_STATUSES = [
  TRADER_STATUS.UNDER_REVIEW,
  TRADER_STATUS.PENDING_DOCUMENTS,
  TRADER_STATUS.PROFILE_INCOMPLETE,
  TRADER_STATUS.VERIFIED,
  TRADER_STATUS.REJECTED,
  TRADER_STATUS.SUSPENDED,
  TRADER_STATUS.EXPIRED_DOCUMENTS,
] as const;

// GET /api/admin/stats — live platform metrics for admin dashboard
router.get("/admin/stats", authMiddleware, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);

    const [
      usersByRole,
      newUsersToday,
      newUsersWeek,
      allTimeRegistered,
      deletedUsers,
      tradersByStatus,
      tradersActive,
      enquiriesByStatus,
      enquiriesToday,
      enquiriesWeek,
      conversationsByStatus,
      messagesToday,
      messagesWeek,
      messagesLive,
      reviewsByStatus,
      openReports,
      activeSubs,
    ] = await Promise.all([
      db
        .select({ role: usersTable.role, count: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(isNull(usersTable.deletedAt))
        .groupBy(usersTable.role),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(and(gte(usersTable.createdAt, startOfDay), isNull(usersTable.deletedAt))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(and(gte(usersTable.createdAt, sevenDaysAgo), isNull(usersTable.deletedAt))),
      // All-time registrations — includes soft-deleted accounts so the
      // historical signup total never goes down.
      db.select({ count: sql<number>`count(*)::int` }).from(usersTable),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(usersTable)
        .where(isNotNull(usersTable.deletedAt)),
      db
        .select({
          status: traderProfilesTable.verificationStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(traderProfilesTable)
        .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
        .where(eq(usersTable.role, "trader"))
        .groupBy(traderProfilesTable.verificationStatus),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.isActive, true)),
      db
        .select({ status: enquiriesTable.status, count: sql<number>`count(*)::int` })
        .from(enquiriesTable)
        .groupBy(enquiriesTable.status),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(enquiriesTable)
        .where(gte(enquiriesTable.createdAt, startOfDay)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(enquiriesTable)
        .where(gte(enquiriesTable.createdAt, sevenDaysAgo)),
      db
        .select({ status: conversationsTable.status, count: sql<number>`count(*)::int` })
        .from(conversationsTable)
        .groupBy(conversationsTable.status),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(messagesTable)
        .where(gte(messagesTable.createdAt, startOfDay)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(messagesTable)
        .where(gte(messagesTable.createdAt, sevenDaysAgo)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(messagesTable)
        .where(gte(messagesTable.createdAt, fifteenMinAgo)),
      db
        .select({ status: reviewsTable.status, count: sql<number>`count(*)::int` })
        .from(reviewsTable)
        .groupBy(reviewsTable.status),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationReportsTable)
        .where(eq(conversationReportsTable.status, "OPEN")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.status, "active")),
    ]);

    const sumByKey = (rows: { count: number }[]) =>
      rows.reduce((s, r) => s + (r.count ?? 0), 0);
    const mapRows = (rows: { count: number; status?: string | null; role?: string | null }[]) => {
      const out: Record<string, number> = {};
      for (const r of rows) {
        const k = (r.status ?? r.role ?? "UNKNOWN") || "UNKNOWN";
        out[k] = r.count ?? 0;
      }
      return out;
    };

    res.json({
      generatedAt: now.toISOString(),
      windows: {
        last30dStart: thirtyDaysAgo.toISOString(),
        last7dStart: sevenDaysAgo.toISOString(),
        startOfDay: startOfDay.toISOString(),
        last15minStart: fifteenMinAgo.toISOString(),
      },
      users: {
        total: sumByKey(usersByRole),
        byRole: mapRows(usersByRole),
        newToday: newUsersToday[0]?.count ?? 0,
        newLast7d: newUsersWeek[0]?.count ?? 0,
        allTimeRegistered: allTimeRegistered[0]?.count ?? 0,
        deleted: deletedUsers[0]?.count ?? 0,
      },
      traders: {
        byStatus: mapRows(tradersByStatus),
        activeOnPlatform: tradersActive[0]?.count ?? 0,
      },
      enquiries: {
        total: sumByKey(enquiriesByStatus),
        byStatus: mapRows(enquiriesByStatus),
        today: enquiriesToday[0]?.count ?? 0,
        last7d: enquiriesWeek[0]?.count ?? 0,
      },
      conversations: {
        total: sumByKey(conversationsByStatus),
        byStatus: mapRows(conversationsByStatus),
      },
      messages: {
        today: messagesToday[0]?.count ?? 0,
        last7d: messagesWeek[0]?.count ?? 0,
        last15min: messagesLive[0]?.count ?? 0,
      },
      reviews: {
        total: sumByKey(reviewsByStatus),
        byStatus: mapRows(reviewsByStatus),
      },
      moderation: {
        openConversationReports: openReports[0]?.count ?? 0,
      },
      subscriptions: {
        active: activeSubs[0]?.count ?? 0,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin stats failed");
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// GET /api/admin/traders?status=&q=&limit=
router.get("/admin/traders", authMiddleware, adminOnly, async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const conds = [eq(usersTable.role, "trader")];
    if (status && (REVIEWABLE_STATUSES as readonly string[]).includes(status)) {
      conds.push(eq(traderProfilesTable.verificationStatus, status));
    }
    if (q.length > 0) {
      const like = `%${q}%`;
      const search = or(
        ilike(traderProfilesTable.businessName, like),
        ilike(traderProfilesTable.contactName, like),
        ilike(usersTable.email, like),
        ilike(traderProfilesTable.town, like),
        ilike(traderProfilesTable.postcode, like),
      );
      if (search) conds.push(search);
    }

    const rows = await db
      .select({
        userId: usersTable.id,
        email: usersTable.email,
        emailVerified: usersTable.emailVerified,
        createdAt: usersTable.createdAt,
        businessName: traderProfilesTable.businessName,
        contactName: traderProfilesTable.contactName,
        phone: traderProfilesTable.phone,
        town: traderProfilesTable.town,
        postcode: traderProfilesTable.postcode,
        mainCategory: traderProfilesTable.mainCategory,
        verificationStatus: traderProfilesTable.verificationStatus,
        phoneVerified: traderProfilesTable.phoneVerified,
        businessProfileCompleted: traderProfilesTable.businessProfileCompleted,
        documentsSubmitted: traderProfilesTable.documentsSubmitted,
        submittedForReviewAt: traderProfilesTable.submittedForReviewAt,
        verifiedAt: traderProfilesTable.verifiedAt,
        rejectedAt: traderProfilesTable.rejectedAt,
      })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(and(...conds))
      .orderBy(desc(traderProfilesTable.submittedForReviewAt), desc(traderProfilesTable.updatedAt))
      .limit(limit);

    // Counts by status (for dashboard summary)
    const counts = await db
      .select({
        status: traderProfilesTable.verificationStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(eq(usersTable.role, "trader"))
      .groupBy(traderProfilesTable.verificationStatus);

    res.json({ traders: rows, counts });
  } catch (error) {
    req.log.error({ err: error }, "Admin list traders failed");
    res.status(500).json({ error: "Failed to list traders" });
  }
});

// GET /api/admin/traders/:userId
router.get("/admin/traders/:userId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const userId = Number.parseInt(String(req.params.userId), 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const [row] = await db
      .select({
        user: usersTable,
        profile: traderProfilesTable,
      })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(and(eq(traderProfilesTable.userId, userId), eq(usersTable.role, "trader")))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }

    const documents = await db
      .select()
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.userId, userId))
      .orderBy(desc(traderDocumentsTable.createdAt));

    const auditLog = await db
      .select()
      .from(traderAuditLogTable)
      .where(eq(traderAuditLogTable.userId, userId))
      .orderBy(desc(traderAuditLogTable.createdAt))
      .limit(50);

    // Strip secrets from user/profile before returning
    const { passwordHash, emailVerificationToken, emailVerificationExpiresAt, ...userSafe } =
      row.user as Record<string, unknown> & { passwordHash?: string; emailVerificationToken?: string | null; emailVerificationExpiresAt?: Date | null };
    const { phoneOtpHash, phoneOtpExpiresAt, ...profileSafe } =
      row.profile as Record<string, unknown> & { phoneOtpHash?: string | null; phoneOtpExpiresAt?: Date | null };

    res.json({
      user: userSafe,
      profile: profileSafe,
      documents,
      documentsEvaluation: evaluateDocumentsComplete(documents),
      auditLog,
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin get trader failed");
    res.status(500).json({ error: "Failed to load trader" });
  }
});

// GET /api/admin/documents/:id/view-url — short-lived signed URL for in-browser preview
router.get("/admin/documents/:id/view-url", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [doc] = await db
      .select()
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.id, id))
      .limit(1);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    try {
      const url = await storage.getObjectEntityReadURL(doc.objectPath, 300);
      res.json({ url, expiresInSec: 300, mimeType: doc.mimeType, filename: doc.originalFilename });
    } catch (e) {
      if (e instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "File missing from storage" });
        return;
      }
      throw e;
    }
  } catch (error) {
    req.log.error({ err: error }, "View URL failed");
    res.status(500).json({ error: "Failed to create view URL" });
  }
});

// GET /api/admin/documents/:id/file — admin-scoped proxy stream
// Every access is recorded in the trader_audit_log table to satisfy the UK
// GDPR / ICO accountability principle (Article 5(2)). The admin can supply an
// optional `?reason=` (e.g. for an ICO/DSAR request) and `?mode=view|download`
// is recorded so we can distinguish in-app preview from a saved copy.
router.get("/admin/documents/:id/file", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId: adminId } = req as AuthenticatedRequest;
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [doc] = await db
      .select()
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.id, id))
      .limit(1);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const mode = String(req.query.mode ?? "view").toLowerCase() === "download" ? "download" : "view";
    const rawReason = typeof req.query.reason === "string" ? req.query.reason.trim() : "";
    const reason = rawReason.slice(0, 500) || null;
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;

    // Audit BEFORE streaming so we record the access intent even if the stream
    // later fails. Failure of logAudit itself is swallowed by the helper.
    await logAudit({
      userId: doc.userId,
      action: mode === "download" ? "ADMIN_DOWNLOADED_DOCUMENT" : "ADMIN_VIEWED_DOCUMENT",
      performedBy: adminId,
      notes: reason ?? undefined,
      details: {
        documentId: doc.id,
        documentType: doc.type,
        filename: doc.originalFilename,
        mode,
        ip,
        userAgent,
      },
    });

    try {
      const file = await storage.getObjectEntityFile(doc.objectPath);
      const [meta] = await file.getMetadata();
      // Use the MIME type recorded in the database (validated against the allowlist
      // at upload-registration time) rather than the value stored in object metadata,
      // which an attacker could have set to text/html or another executable type.
      const safeMime = doc.mimeType || "application/octet-stream";
      res.setHeader("Content-Type", safeMime);
      res.setHeader("Cache-Control", "private, no-store");
      const safeFilename = (doc.originalFilename || "document").replace(/[^\w.\-]/g, "_");
      // For the in-app preview the admin UI fetches the file as a blob and renders
      // it inside a sandboxed <img>/<iframe>, so `inline` is safe here — the
      // MIME type is already constrained to the upload allowlist (image/* or PDF).
      // The download button explicitly requests mode=download and we honour that
      // with an attachment disposition so the browser saves the file instead of
      // rendering it.
      const disposition = mode === "download" ? "attachment" : "inline";
      res.setHeader("Content-Disposition", `${disposition}; filename="${safeFilename}"`);
      if (meta.size) res.setHeader("Content-Length", String(meta.size));
      await new Promise<void>((resolve, reject) => {
        file.createReadStream().on("error", reject).on("end", resolve).pipe(res);
      });
    } catch (e) {
      if (e instanceof ObjectNotFoundError) {
        if (!res.headersSent) res.status(404).json({ error: "File missing from storage" });
        return;
      }
      throw e;
    }
  } catch (error) {
    req.log.error({ err: error }, "Admin download document failed");
    if (!res.headersSent) res.status(500).json({ error: "Failed to download document" });
  }
});

const ApproveDocumentBody = z.object({}).optional();
const RejectDocumentBody = z.object({
  reason: z.string().min(3, "Provide a clear reason").max(500),
});

// POST /api/admin/documents/:id/approve
router.post("/admin/documents/:id/approve", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId: adminId } = req as AuthenticatedRequest;
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    ApproveDocumentBody.parse(req.body);
    const [doc] = await db
      .update(traderDocumentsTable)
      .set({ status: "APPROVED", rejectionReason: null, reviewedAt: new Date(), reviewedBy: adminId })
      .where(eq(traderDocumentsTable.id, id))
      .returning();
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    await logAudit({
      userId: doc.userId,
      action: "DOCUMENT_APPROVED",
      performedBy: adminId,
      details: { documentId: doc.id, type: doc.type },
    });
    void (async () => {
      try {
        const [trader] = await db
          .select({ email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, doc.userId))
          .limit(1);
        if (trader?.email) {
          await sendDocumentApprovedEmail({
            toEmail: trader.email,
            toName: trader.fullName || "there",
            documentType: doc.type,
          });
        }
      } catch (notifyErr) {
        req.log.warn({ err: notifyErr, docId: doc.id }, "Failed to send document-approved email");
      }
    })();
    res.json({ document: doc });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Approve document failed");
    res.status(500).json({ error: "Failed to approve document" });
  }
});

// POST /api/admin/documents/:id/reject
router.post("/admin/documents/:id/reject", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId: adminId } = req as AuthenticatedRequest;
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const body = RejectDocumentBody.parse(req.body);
    const [doc] = await db
      .update(traderDocumentsTable)
      .set({ status: "REJECTED", rejectionReason: body.reason, reviewedAt: new Date(), reviewedBy: adminId })
      .where(eq(traderDocumentsTable.id, id))
      .returning();
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    await logAudit({
      userId: doc.userId,
      action: "DOCUMENT_REJECTED",
      performedBy: adminId,
      details: { documentId: doc.id, type: doc.type },
      notes: body.reason,
    });
    void (async () => {
      try {
        const [trader] = await db
          .select({ email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, doc.userId))
          .limit(1);
        if (trader?.email) {
          await sendDocumentRejectedEmail({
            toEmail: trader.email,
            toName: trader.fullName || "there",
            documentType: doc.type,
            reason: body.reason,
          });
        }
      } catch (notifyErr) {
        req.log.warn({ err: notifyErr, docId: doc.id }, "Failed to send document-rejected email");
      }
    })();
    res.json({ document: doc });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Reject document failed");
    res.status(500).json({ error: "Failed to reject document" });
  }
});

const ApproveTraderBody = z.object({ notes: z.string().max(500).optional() });
const RejectTraderBody = z.object({ reason: z.string().min(5).max(500) });
const RequestInfoBody = z.object({ notes: z.string().min(5).max(500) });
const SuspendBody = z.object({ reason: z.string().min(5).max(500) });

async function getTraderProfile(userId: number) {
  const [profile] = await db
    .select()
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, userId))
    .limit(1);
  return profile;
}

// POST /api/admin/traders/:userId/approve
router.post("/admin/traders/:userId/approve", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId: adminId } = req as AuthenticatedRequest;
    const userId = Number.parseInt(String(req.params.userId), 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const body = ApproveTraderBody.parse(req.body);

    const profile = await getTraderProfile(userId);
    if (!profile) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }

    // Require all documents either APPROVED or PENDING_REVIEW (no outstanding REJECTED for required types).
    const docs = await db
      .select()
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.userId, userId));
    const evaluation = evaluateDocumentsComplete(docs);
    if (!evaluation.complete) {
      res.status(400).json({ error: "Trader has not submitted all required documents." });
      return;
    }

    // Auto-approve any PENDING_REVIEW documents during trader approval (admin attests they reviewed all).
    await db
      .update(traderDocumentsTable)
      .set({ status: "APPROVED", reviewedAt: new Date(), reviewedBy: adminId })
      .where(and(eq(traderDocumentsTable.userId, userId), eq(traderDocumentsTable.status, "PENDING_REVIEW")));

    // Phase 7: re-approving from EXPIRED_DOCUMENTS should restore visibility if the
    // trader still has an active subscription. Otherwise leave isActive untouched —
    // the subscription activation flow will flip it on when they next subscribe.
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);
    const restoreActive = sub?.status === "active";

    const [updated] = await db
      .update(traderProfilesTable)
      .set({
        verificationStatus: TRADER_STATUS.VERIFIED,
        verifiedAt: new Date(),
        rejectedAt: null,
        rejectionReason: null,
        adminNotes: body.notes ?? profile.adminNotes,
        ...(restoreActive ? { isActive: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, userId))
      .returning();

    await logAudit({
      userId,
      action: "TRADER_APPROVED",
      performedBy: adminId,
      notes: body.notes,
    });

    // Best-effort, non-blocking notification email to the trader.
    void (async () => {
      try {
        const [user] = await db
          .select({ email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (user?.email) {
          await sendTraderApprovedEmail({
            toEmail: user.email,
            toName: user.fullName,
            businessName: updated?.businessName ?? null,
          });
        }
      } catch (err) {
        req.log.warn({ err }, "Failed to send trader-approved email");
      }
    })();

    res.json({ profile: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Approve trader failed");
    res.status(500).json({ error: "Failed to approve trader" });
  }
});

// POST /api/admin/traders/:userId/reject
router.post("/admin/traders/:userId/reject", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId: adminId } = req as AuthenticatedRequest;
    const userId = Number.parseInt(String(req.params.userId), 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const body = RejectTraderBody.parse(req.body);
    const profile = await getTraderProfile(userId);
    if (!profile) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }
    const [updated] = await db
      .update(traderProfilesTable)
      .set({
        verificationStatus: TRADER_STATUS.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: body.reason,
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, userId))
      .returning();
    await logAudit({
      userId,
      action: "TRADER_REJECTED",
      performedBy: adminId,
      notes: body.reason,
    });

    // Best-effort, non-blocking notification email to the trader.
    // body.reason is a customer-facing reason intended to be shown to the trader.
    void (async () => {
      try {
        const [user] = await db
          .select({ email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (user?.email) {
          await sendTraderRejectedEmail({
            toEmail: user.email,
            toName: user.fullName,
            reason: body.reason,
          });
        }
      } catch (err) {
        req.log.warn({ err }, "Failed to send trader-rejected email");
      }
    })();

    res.json({ profile: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Reject trader failed");
    res.status(500).json({ error: "Failed to reject trader" });
  }
});

// POST /api/admin/traders/:userId/request-info
// Sends the trader back to PENDING_DOCUMENTS so they can upload again.
router.post("/admin/traders/:userId/request-info", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId: adminId } = req as AuthenticatedRequest;
    const userId = Number.parseInt(String(req.params.userId), 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const body = RequestInfoBody.parse(req.body);
    const profile = await getTraderProfile(userId);
    if (!profile) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }
    const [updated] = await db
      .update(traderProfilesTable)
      .set({
        verificationStatus: TRADER_STATUS.PENDING_DOCUMENTS,
        documentsSubmitted: false,
        adminNotes: body.notes,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, userId))
      .returning();
    await logAudit({
      userId,
      action: "ADMIN_REQUESTED_INFO",
      performedBy: adminId,
      notes: body.notes,
    });

    // Best-effort, non-blocking notification email to the trader.
    // body.notes describes what the admin needs from the trader and is intended to be shared.
    void (async () => {
      try {
        const [user] = await db
          .select({ email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (user?.email) {
          await sendTraderMoreInfoRequestedEmail({
            toEmail: user.email,
            toName: user.fullName,
            notes: body.notes,
          });
        }
      } catch (err) {
        req.log.warn({ err }, "Failed to send trader more-info email");
      }
    })();

    res.json({ profile: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Request info failed");
    res.status(500).json({ error: "Failed to send request" });
  }
});

// Phase 8: GET /api/admin/audit-report?from=&to=&action=&format=json|csv
router.get("/admin/audit-report", authMiddleware, adminOnly, async (req, res) => {
  try {
    const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
    const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;
    const actionFilter = typeof req.query.action === "string" ? req.query.action : undefined;
    const format = req.query.format === "csv" ? "csv" : "json";

    const from = fromRaw ? new Date(fromRaw) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = toRaw ? new Date(toRaw) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.status(400).json({ error: "Invalid from/to date." });
      return;
    }

    const conds = [
      sql`${traderAuditLogTable.createdAt} >= ${from}`,
      sql`${traderAuditLogTable.createdAt} <= ${to}`,
    ];
    if (actionFilter) conds.push(eq(traderAuditLogTable.action, actionFilter));

    const rows = await db
      .select({
        id: traderAuditLogTable.id,
        userId: traderAuditLogTable.userId,
        action: traderAuditLogTable.action,
        performedBy: traderAuditLogTable.performedBy,
        notes: traderAuditLogTable.notes,
        details: traderAuditLogTable.details,
        createdAt: traderAuditLogTable.createdAt,
        userEmail: usersTable.email,
        businessName: traderProfilesTable.businessName,
      })
      .from(traderAuditLogTable)
      .leftJoin(usersTable, eq(usersTable.id, traderAuditLogTable.userId))
      .leftJoin(traderProfilesTable, eq(traderProfilesTable.userId, traderAuditLogTable.userId))
      .where(and(...conds))
      .orderBy(desc(traderAuditLogTable.createdAt))
      .limit(5000);

    const counts = await db
      .select({
        action: traderAuditLogTable.action,
        count: sql<number>`count(*)::int`,
      })
      .from(traderAuditLogTable)
      .where(and(...conds))
      .groupBy(traderAuditLogTable.action)
      .orderBy(desc(sql`count(*)`));

    if (format === "csv") {
      const escape = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        const s = typeof v === "string" ? v : JSON.stringify(v);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const header = "id,createdAt,action,userId,userEmail,businessName,performedBy,notes,details";
      const lines = rows.map((r) =>
        [
          r.id,
          r.createdAt.toISOString(),
          r.action,
          r.userId,
          r.userEmail ?? "",
          r.businessName ?? "",
          r.performedBy ?? "",
          r.notes ?? "",
          r.details ? JSON.stringify(r.details) : "",
        ].map(escape).join(","),
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-report-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`,
      );
      res.send([header, ...lines].join("\n"));
      return;
    }

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      action: actionFilter ?? null,
      total: rows.length,
      counts,
      entries: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Audit report failed");
    res.status(500).json({ error: "Failed to build audit report" });
  }
});

// POST /api/admin/traders/:userId/suspend
router.post("/admin/traders/:userId/suspend", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId: adminId } = req as AuthenticatedRequest;
    const userId = Number.parseInt(String(req.params.userId), 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const body = SuspendBody.parse(req.body);
    const profile = await getTraderProfile(userId);
    if (!profile) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }
    const [updated] = await db
      .update(traderProfilesTable)
      .set({
        verificationStatus: TRADER_STATUS.SUSPENDED,
        isActive: false,
        adminNotes: body.reason,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, userId))
      .returning();
    await logAudit({
      userId,
      action: "TRADER_SUSPENDED",
      performedBy: adminId,
      notes: body.reason,
    });

    // Best-effort, non-blocking notification email to the trader.
    // body.reason is shown to the trader in the email so they understand why.
    void (async () => {
      try {
        const [user] = await db
          .select({ email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (user?.email) {
          await sendTraderSuspendedEmail({
            toEmail: user.email,
            toName: user.fullName,
            reason: body.reason,
          });
        }
      } catch (err) {
        req.log.warn({ err }, "Failed to send trader-suspended email");
      }
    })();

    res.json({ profile: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Suspend trader failed");
    res.status(500).json({ error: "Failed to suspend trader" });
  }
});

// POST /api/admin/traders/:userId/unsuspend — revert a suspended trader.
// New status is recomputed from current documents (UNDER_REVIEW if docs incomplete,
// EXPIRED_DOCUMENTS if any required doc is expired, otherwise VERIFIED).
router.post("/admin/traders/:userId/unsuspend", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId: adminId } = req as AuthenticatedRequest;
    const userId = Number.parseInt(String(req.params.userId), 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }
    if (profile.verificationStatus !== TRADER_STATUS.SUSPENDED) {
      res.status(400).json({ error: "Trader is not suspended" });
      return;
    }

    const docs = await db
      .select()
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.userId, userId));
    const evaluation = evaluateDocumentsComplete(docs);

    // Mirror approve()'s subscription-gating: only restore public visibility if
    // the trader currently holds an active subscription.
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);
    const subActive = sub?.status === "active";

    let nextStatus: string = TRADER_STATUS.UNDER_REVIEW;
    let nextActive = false;
    if (evaluation.hasExpiredRequired) {
      nextStatus = TRADER_STATUS.EXPIRED_DOCUMENTS;
    } else if (!evaluation.complete) {
      nextStatus = TRADER_STATUS.PENDING_DOCUMENTS;
    } else if (profile.verifiedAt) {
      nextStatus = TRADER_STATUS.VERIFIED;
      nextActive = subActive;
    } else {
      nextStatus = TRADER_STATUS.UNDER_REVIEW;
    }

    const [updated] = await db
      .update(traderProfilesTable)
      .set({
        verificationStatus: nextStatus,
        isActive: nextActive,
        adminNotes: null,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, userId))
      .returning();
    await logAudit({
      userId,
      action: "TRADER_UNSUSPENDED",
      performedBy: adminId,
      details: { newStatus: nextStatus },
    });
    res.json({ profile: updated });
  } catch (error) {
    req.log.error({ err: error }, "Unsuspend trader failed");
    res.status(500).json({ error: "Failed to unsuspend trader" });
  }
});

// GET /api/admin/dashboard — high-level operational summary
router.get("/admin/dashboard", authMiddleware, adminOnly, async (req, res) => {
  try {
    const [statusCounts, recentAudit, totals, expiringDocs, recentEnquiries] = await Promise.all([
      db
        .select({
          status: traderProfilesTable.verificationStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(traderProfilesTable)
        .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
        .where(eq(usersTable.role, "trader"))
        .groupBy(traderProfilesTable.verificationStatus),
      db
        .select({
          id: traderAuditLogTable.id,
          action: traderAuditLogTable.action,
          createdAt: traderAuditLogTable.createdAt,
          userId: traderAuditLogTable.userId,
          businessName: traderProfilesTable.businessName,
          userEmail: usersTable.email,
        })
        .from(traderAuditLogTable)
        .leftJoin(usersTable, eq(usersTable.id, traderAuditLogTable.userId))
        .leftJoin(traderProfilesTable, eq(traderProfilesTable.userId, traderAuditLogTable.userId))
        .orderBy(desc(traderAuditLogTable.createdAt))
        .limit(15),
      db
        .select({
          totalTraders: sql<number>`count(*) filter (where ${usersTable.role} = 'trader')::int`,
          totalCustomers: sql<number>`count(*) filter (where ${usersTable.role} = 'customer')::int`,
        })
        .from(usersTable),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(traderDocumentsTable)
        .where(
          and(
            isNotNull(traderDocumentsTable.expiresAt),
            lte(
              traderDocumentsTable.expiresAt,
              sql`now() + interval '30 days'`,
            ),
            sql`${traderDocumentsTable.expiresAt} > now()`,
            inArray(traderDocumentsTable.status, ["APPROVED", "PENDING_REVIEW"]),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(enquiriesTable)
        .where(gte(enquiriesTable.createdAt, sql`now() - interval '7 days'`)),
    ]);

    res.json({
      counts: statusCounts,
      totals: totals[0],
      expiringSoonCount: expiringDocs[0]?.count ?? 0,
      enquiriesLast7d: recentEnquiries[0]?.count ?? 0,
      recentActivity: recentAudit.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin dashboard failed");
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// GET /api/admin/expiring-documents?withinDays=30
router.get("/admin/expiring-documents", authMiddleware, adminOnly, async (req, res) => {
  try {
    const within = Math.min(Math.max(Number(req.query.withinDays) || 30, 1), 365);
    const rows = await db
      .select({
        documentId: traderDocumentsTable.id,
        userId: traderDocumentsTable.userId,
        type: traderDocumentsTable.type,
        status: traderDocumentsTable.status,
        expiresAt: traderDocumentsTable.expiresAt,
        originalFilename: traderDocumentsTable.originalFilename,
        businessName: traderProfilesTable.businessName,
        contactName: traderProfilesTable.contactName,
        userEmail: usersTable.email,
      })
      .from(traderDocumentsTable)
      .innerJoin(usersTable, eq(usersTable.id, traderDocumentsTable.userId))
      .innerJoin(traderProfilesTable, eq(traderProfilesTable.userId, traderDocumentsTable.userId))
      .where(
        and(
          isNotNull(traderDocumentsTable.expiresAt),
          lte(
            traderDocumentsTable.expiresAt,
            sql`now() + (${within} || ' days')::interval`,
          ),
          inArray(traderDocumentsTable.status, ["APPROVED", "PENDING_REVIEW", "EXPIRED"]),
        ),
      )
      .orderBy(asc(traderDocumentsTable.expiresAt));

    res.json({
      withinDays: within,
      documents: rows.map((r) => ({
        ...r,
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Expiring documents failed");
    res.status(500).json({ error: "Failed to load expiring documents" });
  }
});

// GET /api/admin/enquiries?limit=&q=
router.get("/admin/enquiries", authMiddleware, adminOnly, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const conds: ReturnType<typeof eq>[] = [];
    if (q.length > 0) {
      const like = `%${q}%`;
      const search = or(
        ilike(traderProfilesTable.businessName, like),
        ilike(usersTable.email, like),
        ilike(enquiriesTable.serviceRequired, like),
      );
      if (search) conds.push(search as ReturnType<typeof eq>);
    }

    const rows = await db
      .select({
        id: enquiriesTable.id,
        traderId: enquiriesTable.traderId,
        traderUserId: traderProfilesTable.userId,
        traderBusinessName: traderProfilesTable.businessName,
        customerId: enquiriesTable.customerId,
        customerEmail: usersTable.email,
        customerName: usersTable.fullName,
        message: enquiriesTable.message,
        serviceRequired: enquiriesTable.serviceRequired,
        preferredDate: enquiriesTable.preferredDate,
        phone: enquiriesTable.phone,
        status: enquiriesTable.status,
        createdAt: enquiriesTable.createdAt,
      })
      .from(enquiriesTable)
      .leftJoin(traderProfilesTable, eq(traderProfilesTable.id, enquiriesTable.traderId))
      .leftJoin(usersTable, eq(usersTable.id, enquiriesTable.customerId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(enquiriesTable.createdAt))
      .limit(limit);

    res.json({
      enquiries: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin enquiries failed");
    res.status(500).json({ error: "Failed to load enquiries" });
  }
});

// GET /api/admin/subscriptions — list active subscriptions joined with trader info
router.get("/admin/subscriptions", authMiddleware, adminOnly, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: subscriptionsTable.id,
        userId: subscriptionsTable.userId,
        plan: subscriptionsTable.planId,
        status: subscriptionsTable.status,
        currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptionsTable.cancelAtPeriodEnd,
        createdAt: subscriptionsTable.createdAt,
        updatedAt: subscriptionsTable.updatedAt,
        businessName: traderProfilesTable.businessName,
        contactName: traderProfilesTable.contactName,
        email: usersTable.email,
        verificationStatus: traderProfilesTable.verificationStatus,
        isActive: traderProfilesTable.isActive,
      })
      .from(subscriptionsTable)
      .leftJoin(usersTable, eq(usersTable.id, subscriptionsTable.userId))
      .leftJoin(traderProfilesTable, eq(traderProfilesTable.userId, subscriptionsTable.userId))
      .orderBy(desc(subscriptionsTable.updatedAt));

    res.json({
      subscriptions: rows.map((r) => ({
        ...r,
        currentPeriodEnd: r.currentPeriodEnd ? r.currentPeriodEnd.toISOString() : null,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
        updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin subscriptions failed");
    res.status(500).json({ error: "Failed to load subscriptions" });
  }
});

// === Phase 17: Conversation moderation ===

const ResolveReportBody = z.object({
  action: z.enum(["resolve", "dismiss", "block"]),
  notes: z.string().max(1000).optional(),
});

router.get("/admin/conversation-reports", authMiddleware, adminOnly, async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const where = status
      ? eq(conversationReportsTable.status, status)
      : isNotNull(conversationReportsTable.id);
    const rows = await db
      .select({
        report: conversationReportsTable,
        conv: conversationsTable,
        traderBusinessName: traderProfilesTable.businessName,
        customerFullName: usersTable.fullName,
      })
      .from(conversationReportsTable)
      .innerJoin(conversationsTable, eq(conversationReportsTable.conversationId, conversationsTable.id))
      .innerJoin(traderProfilesTable, eq(conversationsTable.traderProfileId, traderProfilesTable.id))
      .innerJoin(usersTable, eq(conversationsTable.customerId, usersTable.id))
      .where(where)
      .orderBy(desc(conversationReportsTable.createdAt));
    const attemptCounts = await getAttemptCountsByConversation(
      Array.from(new Set(rows.map((r) => r.conv.id))),
    );
    res.json({
      contactBypassThreshold: CONTACT_BYPASS_THRESHOLD,
      reports: rows.map(({ report, conv, traderBusinessName, customerFullName }) => {
        const counts = attemptCounts.get(conv.id) ?? { total: 0, recent: 0 };
        return {
          id: report.id,
          conversationId: report.conversationId,
          reportedByUserId: report.reportedByUserId,
          reportedByRole: report.reportedByRole,
          reason: report.reason,
          status: report.status,
          resolutionNotes: report.resolutionNotes,
          resolvedAt: report.resolvedAt?.toISOString() ?? null,
          createdAt: report.createdAt.toISOString(),
          traderBusinessName,
          customerFullName,
          conversationStatus: conv.status,
          contactBypassAttempts: counts.total,
          contactBypassAttemptsRecent: counts.recent,
        };
      }),
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin list conversation reports failed");
    res.status(500).json({ error: "Failed to list reports" });
  }
});

router.get("/admin/conversations/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db
      .select({
        conv: conversationsTable,
        customerName: usersTable.fullName,
        customerEmail: usersTable.email,
        traderBusinessName: traderProfilesTable.businessName,
      })
      .from(conversationsTable)
      .innerJoin(usersTable, eq(conversationsTable.customerId, usersTable.id))
      .innerJoin(traderProfilesTable, eq(conversationsTable.traderProfileId, traderProfilesTable.id))
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    // Admins may only read message bodies for ACTIVE moderation: the
    // conversation is currently REPORTED, or at least one OPEN report exists.
    // Historical (DISMISSED/RESOLVED) reports do NOT re-grant access.
    const [openReport] = await db
      .select({ id: conversationReportsTable.id })
      .from(conversationReportsTable)
      .where(
        and(
          eq(conversationReportsTable.conversationId, id),
          eq(conversationReportsTable.status, "OPEN"),
        ),
      )
      .limit(1);
    const canReadMessages = !!openReport || row.conv.status === "REPORTED";
    const messages = canReadMessages
      ? await db
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.conversationId, id))
          .orderBy(messagesTable.createdAt)
      : [];

    await logAudit({
      userId: row.conv.customerId,
      action: "ADMIN_VIEWED_CONVERSATION",
      performedBy: (req as AuthenticatedRequest).userId,
      details: { conversationId: id, messagesAccessed: canReadMessages },
    });

    const attemptStats = await getConversationAttemptStats(id);
    const recentAttempts = canReadMessages
      ? await listRecentAttemptsForConversation(id, 20)
      : [];

    res.json({
      conversation: {
        id: row.conv.id,
        customerId: row.conv.customerId,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        traderProfileId: row.conv.traderProfileId,
        traderBusinessName: row.traderBusinessName,
        status: row.conv.status,
        traderStatus: row.conv.traderStatus,
        createdAt: row.conv.createdAt.toISOString(),
        lastMessageAt: row.conv.lastMessageAt.toISOString(),
      },
      messagesAccessible: canReadMessages,
      contactBypass: {
        threshold: CONTACT_BYPASS_THRESHOLD,
        total: attemptStats.total,
        recent: attemptStats.recent,
        lastAt: attemptStats.lastAt,
        attempts: recentAttempts.map((a) => ({
          id: a.id,
          userId: a.userId,
          violationKind: a.violationKind,
          source: a.source,
          snippet: a.snippet,
          createdAt: a.createdAt.toISOString(),
        })),
      },
      messages: messages.map((m) => ({
        id: m.id,
        senderUserId: m.senderUserId,
        senderRole: m.senderRole,
        body: m.body,
        systemMessage: m.systemMessage,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin get conversation failed");
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

router.post("/admin/conversation-reports/:id/resolve", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const body = ResolveReportBody.parse(req.body);
    const adminId = (req as AuthenticatedRequest).userId;

    const [report] = await db
      .select()
      .from(conversationReportsTable)
      .where(eq(conversationReportsTable.id, id))
      .limit(1);
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    const newStatus = body.action === "dismiss" ? "DISMISSED" : "RESOLVED";
    await db
      .update(conversationReportsTable)
      .set({
        status: newStatus,
        resolutionNotes: body.notes ?? null,
        resolvedByAdminId: adminId,
        resolvedAt: new Date(),
      })
      .where(eq(conversationReportsTable.id, id));

    if (body.action === "block") {
      await db
        .update(conversationsTable)
        .set({ status: "BLOCKED", blockedAt: new Date(), updatedAt: new Date() })
        .where(eq(conversationsTable.id, report.conversationId));
    } else if (body.action === "resolve" || body.action === "dismiss") {
      // If there are no remaining OPEN reports AND the conversation is
      // currently REPORTED, restore it to the correct waiting state inferred
      // from the last message's sender. Never override CLOSED/BLOCKED, and
      // never reopen a conversation that wasn't put into REPORTED by the
      // moderation flow.
      const otherOpen = await db
        .select({ id: conversationReportsTable.id })
        .from(conversationReportsTable)
        .where(
          and(
            eq(conversationReportsTable.conversationId, report.conversationId),
            eq(conversationReportsTable.status, "OPEN"),
          ),
        )
        .limit(1);
      if (otherOpen.length === 0) {
        const [convRow] = await db
          .select({ status: conversationsTable.status })
          .from(conversationsTable)
          .where(eq(conversationsTable.id, report.conversationId))
          .limit(1);
        if (convRow && convRow.status === "REPORTED") {
          const [lastMsg] = await db
            .select({ senderRole: messagesTable.senderRole })
            .from(messagesTable)
            .where(eq(messagesTable.conversationId, report.conversationId))
            .orderBy(desc(messagesTable.createdAt))
            .limit(1);
          const restored =
            lastMsg?.senderRole === "trader" ? "AWAITING_CUSTOMER_REPLY" : "AWAITING_TRADER_REPLY";
          await db
            .update(conversationsTable)
            .set({ status: restored, updatedAt: new Date() })
            .where(eq(conversationsTable.id, report.conversationId));
        }
      }
    }

    const [conv] = await db
      .select({ customerId: conversationsTable.customerId })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, report.conversationId))
      .limit(1);
    if (conv) {
      await logAudit({
        userId: conv.customerId,
        action: "CONVERSATION_REPORT_RESOLVED",
        performedBy: adminId,
        details: {
          reportId: id,
          conversationId: report.conversationId,
          action: body.action,
        },
        notes: body.notes,
      });
    }

    res.json({ ok: true, status: newStatus, action: body.action });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid action", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Resolve conversation report failed");
    res.status(500).json({ error: "Failed to resolve report" });
  }
});

// POST /api/admin/traders/:userId/ai-verification/run — manually re-run AI cross-check
router.post("/admin/traders/:userId/ai-verification/run", authMiddleware, adminOnly, async (req, res) => {
  try {
    const userId = Number.parseInt(String(req.params.userId), 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const profile = await getTraderProfile(userId);
    if (!profile) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }
    const { userId: adminId } = req as AuthenticatedRequest;
    const { runAiVerification } = await import("../lib/trader-ai-verification");
    const result = await runAiVerification(
      {
        userId: profile.userId,
        businessName: profile.businessName,
        businessAddress: profile.businessAddress,
        town: profile.town,
        postcode: profile.postcode,
      },
      { source: "ADMIN_MANUAL", performedBy: adminId },
    );
    res.json({ result });
  } catch (error) {
    req.log.error({ err: error }, "Run AI verification failed");
    res.status(500).json({ error: "Failed to run AI verification" });
  }
});

export default router;
