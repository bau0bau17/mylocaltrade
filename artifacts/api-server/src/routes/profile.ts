import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { traderProfilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware, traderOnly } from "../lib/auth";
import { UpdateTraderProfileBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";

const router: IRouter = Router();

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
    ] as const;

    for (const field of allowedFields) {
      const value = (body as Record<string, unknown>)[field];
      if (value !== undefined) {
        updateData[field] = value;
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
