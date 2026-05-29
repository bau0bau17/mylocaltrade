import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { traderProfilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware, traderOnly } from "../lib/auth";
import { UpdateTraderProfileBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";
import { TRADER_STATUS, evaluateBusinessProfileComplete, logAudit } from "../lib/trader-status";
import { ObjectStorageService } from "../lib/objectStorage";
import { reconcileDocumentsState } from "./trader-documents";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.get("/profile", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;

    const [trader] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);

    if (!trader) {
      res.status(404).json({ error: "Trader profile not found" });
      return;
    }

    res.json({
      id: trader.id,
      userId: trader.userId,
      businessName: trader.businessName,
      contactName: trader.contactName,
      email: trader.email,
      phone: trader.phone,
      mainCategory: trader.mainCategory,
      additionalServices: trader.additionalServices || [],
      businessAddress: trader.businessAddress,
      town: trader.town,
      postcode: trader.postcode,
      serviceAreas: trader.serviceAreas || [],
      businessDescription: trader.businessDescription,
      website: trader.website,
      openingHours: trader.openingHours,
      logoUrl: trader.logoUrl,
      galleryUrls: trader.galleryUrls || [],
      socialLinks: trader.socialLinks,
      businessRole: trader.businessRole,
      authorisedRepresentative: trader.authorisedRepresentative,
      businessEmailDomain: trader.businessEmailDomain,
      plan: trader.plan,
      isFeatured: trader.isFeatured,
      isActive: trader.isActive,
      rating: trader.rating,
      reviewCount: trader.reviewCount,
      createdAt: trader.createdAt.toISOString(),
    });
  } catch (error) {
    req.log.error({ err: error }, "Get profile failed");
    res.status(500).json({ error: "Failed to get profile" });
  }
});

router.put("/profile", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = UpdateTraderProfileBody.parse(req.body);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    const allowedFields = [
      "businessName", "contactName", "phone", "mainCategory",
      "additionalServices", "businessAddress", "town", "postcode",
      "serviceAreas", "businessDescription", "website", "openingHours",
      "logoUrl", "galleryUrls", "socialLinks",
      "businessRole", "authorisedRepresentative", "businessEmailDomain",
    ] as const;

    for (const field of allowedFields) {
      const value = (body as Record<string, unknown>)[field];
      if (value !== undefined) {
        updateData[field] = value;
      }
    }

    // If galleryUrls is being changed, verify each NEW path against the
    // customer-uploads namespace + actual stored object policy. Already-
    // persisted paths are trusted (they passed the same check on first save)
    // so re-saving the gallery doesn't re-fetch metadata for every image.
    if (Array.isArray(updateData.galleryUrls)) {
      const newUrls = updateData.galleryUrls as unknown[];
      if (newUrls.length > 999) {
        res.status(400).json({ error: "Too many gallery images." });
        return;
      }
      const [existing] = await db
        .select({ galleryUrls: traderProfilesTable.galleryUrls })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, userId));
      const existingSet = new Set<string>(existing?.galleryUrls ?? []);
      try {
        const verified: string[] = [];
        for (const raw of newUrls) {
          if (typeof raw !== "string" || !raw) continue;
          if (existingSet.has(raw)) {
            // Cheap re-check defends against payloads that smuggle in
            // strings the trader never owned (e.g. paths from other
            // features or other users) by replaying values that happen
            // to already sit in the gallery_urls array.
            if (!storage.isCustomerUploadPathFor(raw, userId)) {
              throw new Error("One of the gallery images does not belong to your account.");
            }
            verified.push(raw);
            continue;
          }
          const normalised = await storage.verifyCustomerUploadObject(raw, userId, {
            maxBytes: 8 * 1024 * 1024,
            allowedMimes: new Set([
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/heic",
              "image/heif",
            ]),
            label: "gallery image",
          });
          verified.push(normalised);
        }
        updateData.galleryUrls = verified;
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
    }

    const [updated] = await db
      .update(traderProfilesTable)
      .set(updateData)
      .where(eq(traderProfilesTable.userId, userId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Trader profile not found" });
      return;
    }

    // Re-evaluate business profile completion + transition status if needed.
    const evalResult = evaluateBusinessProfileComplete(updated);
    const wasCompleted = updated.businessProfileCompleted;
    const stateChange: Record<string, unknown> = {};
    if (evalResult.complete && !wasCompleted) {
      stateChange.businessProfileCompleted = true;
      if (updated.verificationStatus === TRADER_STATUS.PROFILE_INCOMPLETE) {
        stateChange.verificationStatus = TRADER_STATUS.PENDING_DOCUMENTS;
      }
    } else if (!evalResult.complete && wasCompleted) {
      stateChange.businessProfileCompleted = false;
      // Don't downgrade if already past documents stage; only revert if still in pending-docs.
      if (updated.verificationStatus === TRADER_STATUS.PENDING_DOCUMENTS) {
        stateChange.verificationStatus = TRADER_STATUS.PROFILE_INCOMPLETE;
      }
    }
    if (Object.keys(stateChange).length > 0) {
      stateChange.updatedAt = new Date();
      await db
        .update(traderProfilesTable)
        .set(stateChange)
        .where(eq(traderProfilesTable.userId, userId));
      Object.assign(updated, stateChange);
      if (stateChange.businessProfileCompleted === true) {
        logAudit({ userId, action: "BUSINESS_PROFILE_COMPLETED" });
      }
    }
    logAudit({ userId, action: "BUSINESS_PROFILE_UPDATED" });

    // If the admin asked for more information about profile details (rather than
    // documents), a profile update is the trader's resubmission. Reconcile so a
    // complete profile + document set returns them to UNDER_REVIEW and clears
    // the request note. Document-only resubmissions are reconciled on upload.
    if (updated.verificationStatus === TRADER_STATUS.NEEDS_MORE_INFO) {
      await reconcileDocumentsState(userId);
      const [refreshed] = await db
        .select()
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, userId))
        .limit(1);
      if (refreshed) Object.assign(updated, refreshed);
    }

    res.json({
      id: updated.id,
      userId: updated.userId,
      businessName: updated.businessName,
      contactName: updated.contactName,
      email: updated.email,
      phone: updated.phone,
      mainCategory: updated.mainCategory,
      additionalServices: updated.additionalServices || [],
      businessAddress: updated.businessAddress,
      town: updated.town,
      postcode: updated.postcode,
      serviceAreas: updated.serviceAreas || [],
      businessDescription: updated.businessDescription,
      website: updated.website,
      openingHours: updated.openingHours,
      businessRole: updated.businessRole,
      authorisedRepresentative: updated.authorisedRepresentative,
      businessEmailDomain: updated.businessEmailDomain,
      logoUrl: updated.logoUrl,
      galleryUrls: updated.galleryUrls || [],
      socialLinks: updated.socialLinks,
      plan: updated.plan,
      isFeatured: updated.isFeatured,
      isActive: updated.isActive,
      rating: updated.rating,
      reviewCount: updated.reviewCount,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid profile data" });
      return;
    }
    req.log.error({ err: error }, "Update profile failed");
    res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;
