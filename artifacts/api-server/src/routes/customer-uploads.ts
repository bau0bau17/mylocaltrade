import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { traderProfilesTable, usersTable, conversationsTable } from "@workspace/db/schema";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { publicTraderSqlConditions } from "../lib/trader-status";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB per photo
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const RequestUploadBody = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

// POST /api/customer/uploads/upload-url
// Authenticated customers (or traders uploading their own gallery) request a
// presigned PUT URL for a single image. The object is scoped under
// customer-uploads/<userId>/ so other accounts cannot claim ownership.
router.post(
  "/customer/uploads/upload-url",
  authMiddleware,
  async (req, res) => {
    try {
      const { userId } = req as AuthenticatedRequest;
      const body = RequestUploadBody.parse(req.body);
      if (!ALLOWED_MIMES.has(body.mimeType)) {
        res.status(400).json({
          error: "Unsupported image type. Use JPEG, PNG, WEBP or HEIC.",
        });
        return;
      }
      const { uploadURL, objectPath } = await storage.getObjectEntityUploadURL(
        `customer-uploads/${userId}`,
        body.mimeType,
        MAX_UPLOAD_BYTES,
      );
      res.json({
        uploadURL,
        objectPath,
        method: "PUT",
        expectedHeaders: { "Content-Type": body.mimeType },
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request", details: error.issues });
        return;
      }
      req.log.error({ err: error }, "Customer upload URL request failed");
      res.status(500).json({ error: "Failed to create upload URL" });
    }
  },
);

// GET /api/customer/uploads/gallery-file?path=/objects/customer-uploads/...
// Public, unauthenticated endpoint that streams a gallery image so it can be
// rendered by React Native <Image> (which cannot load a bare /objects/... path
// and has no access to the private object bucket). To avoid exposing arbitrary
// private customer uploads, we only serve a path that is actually referenced in
// some trader's published galleryUrls — i.e. an image the trader chose to make
// public. Anything else (documents, un-published uploads) returns 404.
const GalleryFileQuery = z.object({
  path: z.string().min(1).max(512),
});

router.get("/customer/uploads/gallery-file", async (req, res) => {
  try {
    const parsed = GalleryFileQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    const normalized = storage.normalizeObjectEntityPath(parsed.data.path);
    if (!normalized.startsWith("/objects/customer-uploads/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Only serve images published by a trader who is CURRENTLY publicly
    // listed: either a gallery image (gallery_urls JSON array membership via
    // jsonb containment) or the business logo (logo_url). Joining users and
    // applying publicTraderSqlConditions (the same single-source rule as
    // public trader pages) means images stop being served the moment the
    // owning trader is hidden, suspended, reset, deleted or unapproved —
    // path membership alone is NOT enough.
    const referenced = await db
      .select({ id: traderProfilesTable.id })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(
        and(
          sql`(${traderProfilesTable.galleryUrls}::jsonb @> ${JSON.stringify([
            normalized,
          ])}::jsonb OR ${traderProfilesTable.logoUrl} = ${normalized})`,
          ...publicTraderSqlConditions(),
        ),
      )
      .limit(1);
    if (referenced.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const file = await storage.getObjectEntityFile(normalized);
    const [meta] = await file.getMetadata();
    res.setHeader(
      "Content-Type",
      (meta.contentType as string) || "application/octet-stream",
    );
    // Short public cache: gallery images must stop being served promptly once
    // the owning trader is hidden, so don't let intermediaries hold them for
    // a day like before.
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (meta.size) res.setHeader("Content-Length", String(meta.size));
    await new Promise<void>((resolve, reject) => {
      file
        .createReadStream()
        .on("error", reject)
        .on("end", resolve)
        .pipe(res);
    });
  } catch (error: unknown) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    req.log.error({ err: error }, "Gallery file serve failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to load image" });
    }
  }
});

// GET /api/customer/uploads/avatar-file?path=/objects/customer-uploads/...
// AUTHENTICATED endpoint that streams a personal profile photo (headshot).
// Unlike gallery images, avatars are not tied to a public trader listing —
// they are only shown in private, membership-scoped contexts. A caller may
// load an avatar only when:
//   (a) it is their OWN avatar, or
//   (b) it belongs to a user they share a conversation with (either side).
// Anything else returns 404 so paths cannot be probed.
router.get("/customer/uploads/avatar-file", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const parsed = GalleryFileQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    const normalized = storage.normalizeObjectEntityPath(parsed.data.path);
    if (!normalized.startsWith("/objects/customer-uploads/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Find the user whose CURRENT avatar this path is. Only live avatar
    // values are servable — removed/replaced photos stop being served
    // immediately, and terminally deleted accounts never match because
    // their avatarUrl is cleared on deletion of the row's public fields.
    const [owner] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.avatarUrl, normalized))
      .limit(1);
    if (!owner) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (owner.id !== userId) {
      // Membership check: the caller must share at least one conversation
      // with the avatar's owner, in either direction.
      const [shared] = await db
        .select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(
          sql`(${conversationsTable.customerId} = ${userId} AND ${conversationsTable.traderUserId} = ${owner.id})
           OR (${conversationsTable.customerId} = ${owner.id} AND ${conversationsTable.traderUserId} = ${userId})`,
        )
        .limit(1);
      if (!shared) {
        res.status(404).json({ error: "Not found" });
        return;
      }
    }

    const file = await storage.getObjectEntityFile(normalized);
    const [meta] = await file.getMetadata();
    res.setHeader(
      "Content-Type",
      (meta.contentType as string) || "application/octet-stream",
    );
    // Private cache only: the response is authorised per-caller.
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (meta.size) res.setHeader("Content-Length", String(meta.size));
    await new Promise<void>((resolve, reject) => {
      file
        .createReadStream()
        .on("error", reject)
        .on("end", resolve)
        .pipe(res);
    });
  } catch (error: unknown) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    req.log.error({ err: error }, "Avatar file serve failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to load image" });
    }
  }
});

export default router;
