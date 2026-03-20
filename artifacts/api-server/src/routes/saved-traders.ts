import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { savedTradersTable, traderProfilesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authMiddleware, customerOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";

const router: IRouter = Router();

router.get("/saved-traders", authMiddleware, customerOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;

    const saved = await db
      .select({
        trader: traderProfilesTable,
      })
      .from(savedTradersTable)
      .innerJoin(traderProfilesTable, eq(savedTradersTable.traderId, traderProfilesTable.id))
      .where(eq(savedTradersTable.userId, userId));

    const traders = saved.map(({ trader: t }) => ({
      id: t.id,
      userId: t.userId,
      businessName: t.businessName,
      contactName: t.contactName,
      email: t.email,
      phone: t.phone,
      mainCategory: t.mainCategory,
      additionalServices: t.additionalServices || [],
      businessAddress: t.businessAddress,
      town: t.town,
      postcode: t.postcode,
      serviceAreas: t.serviceAreas || [],
      businessDescription: t.businessDescription,
      website: t.website,
      openingHours: t.openingHours,
      logoUrl: t.logoUrl,
      galleryUrls: t.galleryUrls || [],
      socialLinks: t.socialLinks,
      plan: t.plan,
      isFeatured: t.isFeatured,
      isActive: t.isActive,
      rating: t.rating,
      reviewCount: t.reviewCount,
      createdAt: t.createdAt.toISOString(),
    }));

    res.json({
      traders,
      total: traders.length,
      page: 1,
      limit: traders.length,
    });
  } catch (error) {
    req.log.error({ err: error }, "Get saved traders failed");
    res.status(500).json({ error: "Failed to get saved traders" });
  }
});

router.post("/saved-traders/:traderId", authMiddleware, customerOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const traderIdParam = Array.isArray(req.params.traderId) ? req.params.traderId[0] : req.params.traderId;
    const traderId = parseInt(traderIdParam);

    if (isNaN(traderId)) {
      res.status(400).json({ error: "Invalid trader ID" });
      return;
    }

    const existing = await db
      .select()
      .from(savedTradersTable)
      .where(and(eq(savedTradersTable.userId, userId), eq(savedTradersTable.traderId, traderId)))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(savedTradersTable).values({ userId, traderId });
    }

    res.json({ success: true, message: "Trader saved" });
  } catch (error) {
    req.log.error({ err: error }, "Save trader failed");
    res.status(500).json({ error: "Failed to save trader" });
  }
});

router.delete("/saved-traders/:traderId", authMiddleware, customerOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const traderIdParam = Array.isArray(req.params.traderId) ? req.params.traderId[0] : req.params.traderId;
    const traderId = parseInt(traderIdParam);

    if (isNaN(traderId)) {
      res.status(400).json({ error: "Invalid trader ID" });
      return;
    }

    await db
      .delete(savedTradersTable)
      .where(and(eq(savedTradersTable.userId, userId), eq(savedTradersTable.traderId, traderId)));

    res.json({ success: true, message: "Trader removed from saved" });
  } catch (error) {
    req.log.error({ err: error }, "Remove saved trader failed");
    res.status(500).json({ error: "Failed to remove saved trader" });
  }
});

export default router;
