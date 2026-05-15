import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  traderProfilesTable,
  usersTable,
  enquiriesTable,
  conversationsTable,
  messagesTable,
} from "@workspace/db/schema";
import type { TraderProfile } from "@workspace/db/schema";
import { eq, and, ilike, or, desc, asc, sql, inArray, isNull, gte } from "drizzle-orm";

const router: IRouter = Router();

// Statuses that should appear in customer-facing search results.
// VERIFIED traders are fully approved; UNDER_REVIEW and PENDING_DOCUMENTS
// are visible but flagged so customers can see where they are in the process.
const VISIBLE_STATUSES = ["VERIFIED", "UNDER_REVIEW", "PENDING_DOCUMENTS"] as const;

// Compute the median time (in minutes) between a customer's enquiry and the
// trader's first reply, over the last 90 days, for the given trader profile
// IDs. Returns a Map<traderProfileId, medianMinutes>. Traders with no
// qualifying samples are simply absent from the map (rendered as null on the
// wire).
async function computeResponseTimes(
  traderProfileIds: number[],
): Promise<Map<number, number>> {
  if (traderProfileIds.length === 0) return new Map();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // For each conversation tied to one of the given traders, find the customer's
  // initial message time (= conversation.createdAt is fine, but we use the
  // first customer message to be safe) and the trader's first reply, then the
  // delta in minutes. We only consider conversations where the trader actually
  // replied so non-responders don't artificially deflate the median.
  const rows = await db.execute<{
    trader_profile_id: number;
    minutes: number;
  }>(sql`
    SELECT
      c.trader_profile_id,
      EXTRACT(EPOCH FROM (trader_first.first_at - customer_first.first_at)) / 60.0 AS minutes
    FROM ${conversationsTable} c
    JOIN LATERAL (
      SELECT MIN(m.created_at) AS first_at
      FROM ${messagesTable} m
      WHERE m.conversation_id = c.id AND m.sender_role = 'customer'
    ) customer_first ON TRUE
    JOIN LATERAL (
      SELECT MIN(m.created_at) AS first_at
      FROM ${messagesTable} m
      WHERE m.conversation_id = c.id AND m.sender_role = 'trader'
    ) trader_first ON TRUE
    WHERE c.trader_profile_id IN (${sql.raw(traderProfileIds.map((id) => Number(id)).join(","))})
      AND c.created_at >= ${since}
      AND customer_first.first_at IS NOT NULL
      AND trader_first.first_at IS NOT NULL
      AND trader_first.first_at > customer_first.first_at
  `);

  const buckets = new Map<number, number[]>();
  for (const row of rows.rows ?? []) {
    const id = Number(row.trader_profile_id);
    const minutes = Number(row.minutes);
    if (!Number.isFinite(id) || !Number.isFinite(minutes) || minutes < 0) continue;
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id)!.push(minutes);
  }
  const result = new Map<number, number>();
  for (const [id, samples] of buckets) {
    if (samples.length < 2) continue; // need at least 2 samples to be meaningful
    samples.sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    const median =
      samples.length % 2 === 0
        ? (samples[mid - 1] + samples[mid]) / 2
        : samples[mid];
    result.set(id, Math.round(median));
  }
  return result;
}

router.get("/traders", async (req, res) => {
  try {
    const {
      category,
      location,
      featured,
      search,
      verified,
      plan,
      sort,
      page = "1",
      limit = "20",
    } = req.query;
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

    if (verified === "true") {
      conditions.push(eq(traderProfilesTable.verificationStatus, "VERIFIED"));
    }

    if (plan === "premium_plus") {
      conditions.push(inArray(traderProfilesTable.plan, ["premium", "elite"]));
    } else if (plan === "elite") {
      conditions.push(eq(traderProfilesTable.plan, "elite"));
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

    // Build ORDER BY based on requested sort. The default ("recommended")
    // preserves the previous behaviour: verified, then featured, then newest.
    const orderBy = (() => {
      switch (sort) {
        case "rating":
          return [
            sql`${traderProfilesTable.rating} DESC NULLS LAST`,
            desc(traderProfilesTable.reviewCount),
            desc(traderProfilesTable.createdAt),
          ];
        case "reviews":
          return [
            desc(traderProfilesTable.reviewCount),
            sql`${traderProfilesTable.rating} DESC NULLS LAST`,
            desc(traderProfilesTable.createdAt),
          ];
        case "newest":
          return [desc(traderProfilesTable.createdAt)];
        default:
          return [
            sql`case when ${traderProfilesTable.verificationStatus} = 'VERIFIED' then 0 else 1 end`,
            desc(traderProfilesTable.isFeatured),
            desc(traderProfilesTable.createdAt),
          ];
      }
    })();

    const traders = await db
      .select({
        profile: traderProfilesTable,
        emailVerified: usersTable.emailVerified,
      })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(where)
      .orderBy(...orderBy)
      .limit(limitNum)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(where);

    const total = countResult?.count || 0;

    const responseTimes = await computeResponseTimes(traders.map((r) => r.profile.id));

    res.json({
      traders: traders.map((r) =>
        formatTrader(r.profile, r.emailVerified, responseTimes.get(r.profile.id) ?? null),
      ),
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

    const responseTimes = await computeResponseTimes(traders.map((r) => r.profile.id));

    res.json({
      traders: traders.map((r) =>
        formatTrader(r.profile, r.emailVerified, responseTimes.get(r.profile.id) ?? null),
      ),
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

    const responseTimes = await computeResponseTimes([row.profile.id]);

    res.json(formatTrader(row.profile, row.emailVerified, responseTimes.get(row.profile.id) ?? null));
  } catch (error) {
    req.log.error({ err: error }, "Get trader failed");
    res.status(500).json({ error: "Failed to get trader" });
  }
});

function formatTrader(
  t: TraderProfile,
  emailVerified: boolean,
  responseTimeMinutes: number | null,
) {
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
    responseTimeMinutes,
    createdAt: t.createdAt.toISOString(),
  };
}

export default router;
