import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  traderDocumentsTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { and, eq, ilike, or, desc, sql } from "drizzle-orm";
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
    const userId = Number.parseInt(req.params.userId, 10);
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
    const id = Number.parseInt(req.params.id, 10);
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
    const id = Number.parseInt(req.params.id, 10);
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
    const id = Number.parseInt(req.params.id, 10);
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
    const id = Number.parseInt(req.params.id, 10);
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
    const userId = Number.parseInt(req.params.userId, 10);
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

    const [updated] = await db
      .update(traderProfilesTable)
      .set({
        verificationStatus: TRADER_STATUS.VERIFIED,
        verifiedAt: new Date(),
        rejectedAt: null,
        rejectionReason: null,
        adminNotes: body.notes ?? profile.adminNotes,
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
    const userId = Number.parseInt(req.params.userId, 10);
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
    const userId = Number.parseInt(req.params.userId, 10);
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

// POST /api/admin/traders/:userId/suspend
router.post("/admin/traders/:userId/suspend", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId: adminId } = req as AuthenticatedRequest;
    const userId = Number.parseInt(req.params.userId, 10);
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

export default router;
