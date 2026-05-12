import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { traderProfilesTable, usersTable } from "@workspace/db/schema";
import type { TraderProfile } from "@workspace/db/schema";
import { eq, and, ilike, or, desc, sql, inArray, isNull } from "drizzle-orm";

const router: IRouter = Router();

// Statuses that should appear in customer-facing search results.
// VERIFIED traders are fully approved; UNDER_REVIEW and PENDING_DOCUMENTS
// are visible but flagged so customers can see where they are in the process.
const VISIBLE_STATUSES = ["VERIFIED", "UNDER_REVIEW", "PENDING_DOCUMENTS"] as const;

router.get("/traders", async (req, res) => {
  try {
    const { category, location, featured, search, page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(limit)) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [
      eq(traderProfilesTable.isActive, true),
      inArray(traderProfilesTable.verificationStatus, VISIBLE_STATUSES as unknown as string[]),
      eq(traderProfilesTable.businessProfileCompleted, true),
      // GDPR: hide any trader account in the deletion lifecycle.
      isNull(usersTable.deletionStatus),
      isNull(usersTable.deletedAt),
    ];

    if (category && typeof category === "string") {
      conditions.push(ilike(traderProfilesTable.mainCategory, `%${category}%`));
    }

    if (location && typeof location === "string") {
      // Search by the trader's declared service areas (the locations they
      // chose during signup / business profile), NOT by their company
      // address — a trader can serve areas they're not based in.
      const locLike = `%${location}%`;
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM json_array_elements_text(
            COALESCE(${traderProfilesTable.serviceAreas}, '[]'::json)
          ) AS area
          WHERE area ILIKE ${locLike}
        )`
      );
    }

    if (featured === "true") {
      conditions.push(eq(traderProfilesTable.isFeatured, true));
    }

    if (search && typeof search === "string") {
      const searchLike = `%${search}%`;
      conditions.push(
        or(
          ilike(traderProfilesTable.businessName, `%${search}%`),
          ilike(traderProfilesTable.mainCategory, `%${search}%`),
          ilike(traderProfilesTable.businessDescription, `%${search}%`),
          sql`EXISTS (
            SELECT 1 FROM json_array_elements_text(
              COALESCE(${traderProfilesTable.serviceAreas}, '[]'::json)
            ) AS area
            WHERE area ILIKE ${searchLike}
          )`,
        )!
      );
    }

    const where = conditions.length > 1 ? and(...conditions) : conditions[0];

    const traders = await db
      .select({
        profile: traderProfilesTable,
        emailVerified: usersTable.emailVerified,
      })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(where)
      .orderBy(
        // Verified traders first, then featured, then newest.
        sql`case when ${traderProfilesTable.verificationStatus} = 'VERIFIED' then 0 else 1 end`,
        desc(traderProfilesTable.isFeatured),
        desc(traderProfilesTable.createdAt),
      )
      .limit(limitNum)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(where);

    const total = countResult?.count || 0;

    res.json({
      traders: traders.map((r) => formatTrader(r.profile, r.emailVerified)),
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    req.log.error({ err: error }, "List traders failed");
    res.status(500).json({ error: "Failed to list traders" });
  }
});

router.get("/traders/featured", async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit)) || 10));

    const traders = await db
      .select({
        profile: traderProfilesTable,
        emailVerified: usersTable.emailVerified,
      })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(and(
        eq(traderProfilesTable.isActive, true),
        eq(traderProfilesTable.verificationStatus, "VERIFIED"),
        eq(traderProfilesTable.isFeatured, true),
        isNull(usersTable.deletionStatus),
        isNull(usersTable.deletedAt),
      ))
      .orderBy(desc(traderProfilesTable.createdAt))
      .limit(limit);

    res.json({
      traders: traders.map((r) => formatTrader(r.profile, r.emailVerified)),
      total: traders.length,
      page: 1,
      limit,
    });
  } catch (error) {
    req.log.error({ err: error }, "Get featured traders failed");
    res.status(500).json({ error: "Failed to get featured traders" });
  }
});

router.get("/traders/:id", async (req, res) => {
  try {
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(idParam);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid trader ID" });
      return;
    }

    const [row] = await db
      .select({
        profile: traderProfilesTable,
        emailVerified: usersTable.emailVerified,
        deletionStatus: usersTable.deletionStatus,
        deletedAt: usersTable.deletedAt,
      })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(eq(traderProfilesTable.id, id))
      .limit(1);

    if (
      !row ||
      !row.profile.isActive ||
      row.deletionStatus ||
      row.deletedAt ||
      !(VISIBLE_STATUSES as readonly string[]).includes(row.profile.verificationStatus)
    ) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }

    res.json(formatTrader(row.profile, row.emailVerified));
  } catch (error) {
    req.log.error({ err: error }, "Get trader failed");
    res.status(500).json({ error: "Failed to get trader" });
  }
});

function formatTrader(t: TraderProfile, emailVerified: boolean) {
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
    isVerified: t.verificationStatus === "VERIFIED",
    verificationStatus: t.verificationStatus,
    emailVerified,
    phoneVerified: t.phoneVerified,
    businessProfileCompleted: t.businessProfileCompleted,
    documentsSubmitted: t.documentsSubmitted,
    verifiedAt: t.verifiedAt ? t.verifiedAt.toISOString() : null,
    rating: t.rating,
    reviewCount: t.reviewCount,
    createdAt: t.createdAt.toISOString(),
  };
}

export default router;
