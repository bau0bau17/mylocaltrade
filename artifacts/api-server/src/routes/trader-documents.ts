import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { traderDocumentsTable, traderProfilesTable, TRADER_DOCUMENT_TYPES, type TraderDocumentType } from "@workspace/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware, traderOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { TRADER_STATUS, evaluateDocumentsComplete, logAudit } from "../lib/trader-status";
import { triggerAiVerification } from "../lib/trader-ai-verification";
import { triggerVatCheck } from "../lib/vat-check";
import { triggerDomainCheck } from "../lib/domain-check";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const RequestUploadBody = z.object({
  type: z.enum(TRADER_DOCUMENT_TYPES),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

const RegisterDocumentBody = z.object({
  type: z.enum(TRADER_DOCUMENT_TYPES),
  objectPath: z.string().min(1),
  originalFilename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  // Optional expiry date for time-bound documents (insurance, qualifications).
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable()
    .refine((v) => v == null || new Date(v).getTime() > Date.now(), {
      message: "Expiry date must be in the future",
    }),
});

function serializeDoc(d: typeof traderDocumentsTable.$inferSelect) {
  return {
    id: d.id,
    type: d.type as TraderDocumentType,
    originalFilename: d.originalFilename,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    status: d.status,
    rejectionReason: d.rejectionReason,
    expiresAt: d.expiresAt?.toISOString() ?? null,
    reviewedAt: d.reviewedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

export async function reconcileDocumentsState(userId: number) {
  const docs = await db
    .select()
    .from(traderDocumentsTable)
    .where(eq(traderDocumentsTable.userId, userId));

  const [profile] = await db
    .select()
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, userId))
    .limit(1);
  if (!profile) return evaluateDocumentsComplete(docs);

  const evaluation = evaluateDocumentsComplete(docs, {
    businessRole: profile.businessRole,
    authorisedRepresentative: profile.authorisedRepresentative,
  });

  const wasSubmitted = profile.documentsSubmitted;
  const stateChange: Record<string, unknown> = {};

  if (evaluation.complete && !wasSubmitted) {
    stateChange.documentsSubmitted = true;
    if (
      profile.businessProfileCompleted &&
      profile.verificationStatus === TRADER_STATUS.PENDING_DOCUMENTS
    ) {
      stateChange.verificationStatus = TRADER_STATUS.UNDER_REVIEW;
      stateChange.submittedForReviewAt = new Date();
    }
  } else if (!evaluation.complete && wasSubmitted) {
    stateChange.documentsSubmitted = false;
    if (profile.verificationStatus === TRADER_STATUS.UNDER_REVIEW) {
      stateChange.verificationStatus = TRADER_STATUS.PENDING_DOCUMENTS;
    }
  }

  // Phase 7: expired required document for a previously verified trader →
  // flip to EXPIRED_DOCUMENTS and hide the profile.
  if (
    profile.verificationStatus === TRADER_STATUS.VERIFIED &&
    evaluation.hasExpiredRequired
  ) {
    stateChange.verificationStatus = TRADER_STATUS.EXPIRED_DOCUMENTS;
    stateChange.isActive = false;
  }

  // If the trader has uploaded a fresh replacement and no required doc is
  // expired any more, queue them for re-review (admin must re-approve).
  if (
    profile.verificationStatus === TRADER_STATUS.EXPIRED_DOCUMENTS &&
    evaluation.complete &&
    !evaluation.hasExpiredRequired
  ) {
    stateChange.verificationStatus = TRADER_STATUS.UNDER_REVIEW;
    stateChange.submittedForReviewAt = new Date();
  }

  // If admin asked for more information and the trader has since supplied a
  // complete set of documents, queue them back for review and clear the note.
  if (
    profile.verificationStatus === TRADER_STATUS.NEEDS_MORE_INFO &&
    evaluation.complete
  ) {
    stateChange.verificationStatus = TRADER_STATUS.UNDER_REVIEW;
    stateChange.submittedForReviewAt = new Date();
    stateChange.needsMoreInfoReason = null;
  }

  if (Object.keys(stateChange).length > 0) {
    stateChange.updatedAt = new Date();
    await db
      .update(traderProfilesTable)
      .set(stateChange)
      .where(eq(traderProfilesTable.userId, userId));
    if (stateChange.verificationStatus === TRADER_STATUS.UNDER_REVIEW) {
      await logAudit({ userId, action: "TRADER_SUBMITTED_FOR_REVIEW" });
      // Fire-and-forget support-layer cross-checks. All are advisory and never
      // block approval; each is a no-op when its underlying field is absent
      // (e.g. sole traders with no company / VAT number).
      triggerAiVerification({
        userId: profile.userId,
        businessName: profile.businessName,
        businessAddress: profile.businessAddress,
        town: profile.town,
        postcode: profile.postcode,
        companyNumber: profile.companyNumber,
        businessRole: profile.businessRole,
      });
      triggerVatCheck({ userId: profile.userId, vatNumber: profile.vatNumber });
      triggerDomainCheck({
        userId: profile.userId,
        businessEmailDomain: profile.businessEmailDomain,
        website: profile.website,
      });
    }
    if (stateChange.verificationStatus === TRADER_STATUS.EXPIRED_DOCUMENTS) {
      await logAudit({ userId, action: "DOCUMENT_EXPIRED" });
    }
  }
  return evaluation;
}

// GET /api/trader/documents — list current user's documents + evaluation
router.get("/trader/documents", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const docs = await db
      .select()
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.userId, userId))
      .orderBy(desc(traderDocumentsTable.createdAt));
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    const evaluation = evaluateDocumentsComplete(docs, {
      businessRole: profile?.businessRole,
      authorisedRepresentative: profile?.authorisedRepresentative,
    });
    res.json({
      documents: docs.map(serializeDoc),
      evaluation,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_MIMES),
    });
  } catch (error) {
    req.log.error({ err: error }, "List documents failed");
    res.status(500).json({ error: "Failed to list documents" });
  }
});

// POST /api/trader/documents/upload-url — request a presigned PUT URL
router.post("/trader/documents/upload-url", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = RequestUploadBody.parse(req.body);
    if (!ALLOWED_MIMES.has(body.mimeType)) {
      res.status(400).json({ error: "Unsupported file type. Use JPEG, PNG, WEBP, HEIC or PDF." });
      return;
    }
    // Scope uploads to the authenticated user so other traders cannot claim the upload.
    // Pass the declared mimeType so the presigned PUT URL is bound to that Content-Type —
    // GCS will reject any PUT request whose Content-Type header does not match.
    const { uploadURL, objectPath } = await storage.getObjectEntityUploadURL(
      `trader-documents/${userId}`,
      body.mimeType
    );
    res.json({ uploadURL, objectPath, method: "PUT", expectedHeaders: { "Content-Type": body.mimeType } });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Upload URL request failed");
    res.status(500).json({ error: "Failed to create upload URL" });
  }
});

// POST /api/trader/documents — register a successfully uploaded object
router.post("/trader/documents", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = RegisterDocumentBody.parse(req.body);
    if (!ALLOWED_MIMES.has(body.mimeType)) {
      res.status(400).json({ error: "Unsupported file type." });
      return;
    }
    const normalized = storage.normalizeObjectEntityPath(body.objectPath);
    const expectedPrefix = `/objects/trader-documents/${userId}/`;
    if (!normalized.startsWith(expectedPrefix)) {
      res.status(403).json({ error: "Object path does not belong to this account." });
      return;
    }
    // Verify the object exists and validate the size against what GCS actually has,
    // so the client cannot under-report size to bypass MAX_UPLOAD_BYTES.
    // Also verify the stored Content-Type matches the allowlist so a trader cannot
    // claim an allowed MIME type in the API request but upload HTML/JS bytes.
    let storedSize = 0;
    try {
      const file = await storage.getObjectEntityFile(normalized);
      const [meta] = await file.getMetadata();
      storedSize = typeof meta.size === "string" ? Number.parseInt(meta.size, 10) : Number(meta.size ?? 0);
      const storedContentType = (meta.contentType as string | undefined) ?? "";
      // Strip any parameters (e.g. "image/jpeg; charset=utf-8") before checking.
      const storedMime = storedContentType.split(";")[0].trim().toLowerCase();
      if (!storedMime || !ALLOWED_MIMES.has(storedMime)) {
        res.status(400).json({ error: "Uploaded file type is not permitted. Only JPEG, PNG, WEBP, HEIC and PDF are accepted." });
        return;
      }
      // Enforce that the stored Content-Type exactly matches what the client declared.
      // This catches any attempt to claim one allowed type while uploading another.
      const declaredMime = body.mimeType.split(";")[0].trim().toLowerCase();
      if (storedMime !== declaredMime) {
        res.status(400).json({ error: "Uploaded file type does not match the declared type." });
        return;
      }
    } catch (e) {
      if (e instanceof ObjectNotFoundError) {
        res.status(400).json({ error: "Uploaded file not found in storage. Please retry." });
        return;
      }
      throw e;
    }
    if (!Number.isFinite(storedSize) || storedSize <= 0 || storedSize > MAX_UPLOAD_BYTES) {
      res.status(400).json({ error: "Uploaded file is invalid or exceeds the size limit." });
      return;
    }

    const [created] = await db
      .insert(traderDocumentsTable)
      .values({
        userId,
        type: body.type,
        objectPath: normalized,
        originalFilename: body.originalFilename,
        mimeType: body.mimeType,
        sizeBytes: storedSize,
        status: "PENDING_REVIEW",
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      })
      .returning();

    await logAudit({
      userId,
      action: "DOCUMENT_UPLOADED",
      details: { type: body.type, documentId: created.id },
    });

    const evaluation = await reconcileDocumentsState(userId);

    res.status(201).json({ document: serializeDoc(created), evaluation });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid document data", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Register document failed");
    res.status(500).json({ error: "Failed to register document" });
  }
});

// DELETE /api/trader/documents/:id — remove a pending or rejected document
router.delete("/trader/documents/:id", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }
    const [doc] = await db
      .select()
      .from(traderDocumentsTable)
      .where(and(eq(traderDocumentsTable.id, id), eq(traderDocumentsTable.userId, userId)))
      .limit(1);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (doc.status === "APPROVED") {
      res.status(409).json({ error: "Approved documents cannot be deleted. Contact support." });
      return;
    }

    await db.delete(traderDocumentsTable).where(eq(traderDocumentsTable.id, id));

    // Best-effort delete from storage; do not fail the request if it errors.
    try {
      const file = await storage.getObjectEntityFile(doc.objectPath);
      await file.delete({ ignoreNotFound: true });
    } catch (e) {
      req.log.warn({ err: e, documentId: id }, "Failed to delete object from storage");
    }

    const evaluation = await reconcileDocumentsState(userId);
    res.json({ ok: true, evaluation });
  } catch (error) {
    req.log.error({ err: error }, "Delete document failed");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// GET /api/trader/documents/:id/file — proxy-download the file (auth required, owner only)
router.get("/trader/documents/:id/file", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }
    const [doc] = await db
      .select()
      .from(traderDocumentsTable)
      .where(and(eq(traderDocumentsTable.id, id), eq(traderDocumentsTable.userId, userId)))
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
      // Use a node stream so backpressure is honoured.
      await new Promise<void>((resolve, reject) => {
        file.createReadStream()
          .on("error", reject)
          .on("end", resolve)
          .pipe(res);
      });
    } catch (e) {
      if (e instanceof ObjectNotFoundError) {
        if (!res.headersSent) res.status(404).json({ error: "File missing from storage" });
        return;
      }
      throw e;
    }
  } catch (error) {
    req.log.error({ err: error }, "Download document failed");
    if (!res.headersSent) res.status(500).json({ error: "Failed to download document" });
  }
});

export default router;
