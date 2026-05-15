import { Router, type IRouter } from "express";
import { z } from "zod";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { ObjectStorageService } from "../lib/objectStorage";

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

export default router;
