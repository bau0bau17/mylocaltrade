import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  traderDocumentsTable,
  traderAuditLogTable,
  subscriptionsTable,
  enquiriesTable,
} from "@workspace/db/schema";
import { and, eq, ilike, or, desc, sql, inArray, gte, lte, isNotNull, asc } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware, adminOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import {
  TRADER_STATUS,
  evaluateDocumentsComplete,
  logAudit,
} from "../lib/trader-status";

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
router.get("/admin/documents/:id/file", authMiddleware, adminOnly, async (req, res) => {
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
      const file = await storage.getObjectEntityFile(doc.objectPath);
      const [meta] = await file.getMetadata();
      res.setHeader("Content-Type", (meta.contentType as string) || doc.mimeType || "application/octet-stream");
      res.setHeader("Cache-Control", "private, max-age=0");
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

export default router;
