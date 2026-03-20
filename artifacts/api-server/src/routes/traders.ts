import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { traderProfilesTable } from "@workspace/db/schema";
import { eq, and, ilike, or, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/traders", async (req, res) => {
  try {
    const { category, location, featured, search, page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [eq(traderProfilesTable.isActive, true)];

    if (category && typeof category === "string") {
      conditions.push(ilike(traderProfilesTable.mainCategory, `%${category}%`));
    }

    if (location && typeof location === "string") {
      conditions.push(
        or(
          ilike(traderProfilesTable.town, `%${location}%`),
          ilike(traderProfilesTable.postcode, `%${location}%`),
        )!
      );
    }

    if (featured === "true") {
      conditions.push(eq(traderProfilesTable.isFeatured, true));
    }

    if (search && typeof search === "string") {
      conditions.push(
        or(
          ilike(traderProfilesTable.businessName, `%${search}%`),
          ilike(traderProfilesTable.mainCategory, `%${search}%`),
          ilike(traderProfilesTable.town, `%${search}%`),
          ilike(traderProfilesTable.businessDescription, `%${search}%`),
        )!
      );
    }

    const where = conditions.length > 1 ? and(...conditions) : conditions[0];

    const traders = await db
      .select()
      .from(traderProfilesTable)
      .where(where)
      .orderBy(desc(traderProfilesTable.isFeatured), desc(traderProfilesTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(traderProfilesTable)
      .where(where);

    const total = countResult?.count || 0;

    res.json({
      traders: traders.map(formatTrader),
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "List traders failed");
    res.status(500).json({ error: "Failed to list traders" });
  }
});

router.get("/traders/featured", async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));

    const traders = await db
      .select()
      .from(traderProfilesTable)
      .where(and(eq(traderProfilesTable.isActive, true), eq(traderProfilesTable.isFeatured, true)))
      .orderBy(desc(traderProfilesTable.createdAt))
      .limit(limit);

    res.json({
      traders: traders.map(formatTrader),
      total: traders.length,
      page: 1,
      limit,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "Get featured traders failed");
    res.status(500).json({ error: "Failed to get featured traders" });
  }
});

router.get("/traders/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid trader ID" });
      return;
    }

    const [trader] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, id))
      .limit(1);

    if (!trader) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }

    res.json(formatTrader(trader));
  } catch (error: any) {
    req.log.error({ err: error }, "Get trader failed");
    res.status(500).json({ error: "Failed to get trader" });
  }
});

function formatTrader(t: any) {
  return {
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
  };
}

export default router;
