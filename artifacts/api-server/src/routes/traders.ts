import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  traderProfilesTable,
  usersTable,
  enquiriesTable,
  conversationsTable,
  messagesTable,
  subscriptionsTable,
} from "@workspace/db/schema";
import type { TraderProfile } from "@workspace/db/schema";
import { eq, and, ilike, or, desc, sql, inArray, type SQL } from "drizzle-orm";
import { computeResponseTimes } from "../lib/response-times";
import { expandServiceTerms } from "../lib/service-categories";
import { isTraderPubliclyListed, publicTraderSqlConditions } from "../lib/trader-status";
import { geocodeUkLocation } from "../lib/geocode";

const router: IRouter = Router();

router.get("/traders", async (req, res) => {
  try {
    const {
      category,
      location,
      featured,
      search,
      verified,
      plan,
      specialism,
      sort,
      radiusMiles,
      lat,
      lng,
      near,
      page = "1",
      limit = "20",
    } = req.query;
    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(limit)) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions: SQL[] = [
      ...publicTraderSqlConditions(),
      eq(traderProfilesTable.businessProfileCompleted, true),
    ];

    // Canonical category matching: a customer-facing label like "Electrical"
    // must find traders whose service is stored as "Electrician" (etc.). The
    // synonym expansion lives in ONE place (lib/service-categories.ts) and is
    // matched against BOTH mainCategory and the additionalServices array.
    // Unknown values keep the previous plain substring behaviour.
    const categoryTermsCondition = (value: string): SQL | null => {
      const terms = expandServiceTerms(value);
      if (!terms) return null;
      const perTerm = terms.map((term) => {
        const like = `%${term}%`;
        return or(
          ilike(traderProfilesTable.mainCategory, like),
          sql`EXISTS (
            SELECT 1 FROM json_array_elements_text(
              COALESCE(${traderProfilesTable.additionalServices}, '[]'::json)
            ) AS svc
            WHERE svc ILIKE ${like}
          )`,
        )!;
      });
      return or(...perTerm)!;
    };

    if (category && typeof category === "string") {
      conditions.push(
        categoryTermsCondition(category) ??
          ilike(traderProfilesTable.mainCategory, `%${category}%`),
      );
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

    if (plan === "premium") {
      // Any non-basic plan counts as Premium. `inArray` also covers legacy
      // "trader" rows that predate the unified "premium" plan id, so existing
      // paid traders remain discoverable until their plan is re-synced.
      // Additionally exclude traders whose non-Stripe subscription period has
      // already lapsed — the stored plan field can lag reality between the
      // expiry and the next revenuecat-sync/webhook downgrade.
      conditions.push(
        and(
          inArray(traderProfilesTable.plan, ["premium", "trader"]),
          sql`NOT (
            ${subscriptionsTable.stripeSubscriptionId} IS NULL
            AND ${subscriptionsTable.stripeCustomerId} IS NULL
            AND ${subscriptionsTable.currentPeriodEnd} IS NOT NULL
            AND ${subscriptionsTable.currentPeriodEnd} <= NOW()
          )`,
        )!,
      );
    }

    // Specialism filter: a free-text keyword (e.g. "solar", "heat pump") that
    // matches either the trader's main category or any entry of their
    // additionalServices array. Reuses the existing free-text services field
    // — no new column required.
    if (specialism && typeof specialism === "string" && specialism.trim()) {
      const specLike = `%${specialism.trim()}%`;
      conditions.push(
        or(
          ilike(traderProfilesTable.mainCategory, specLike),
          sql`EXISTS (
            SELECT 1 FROM json_array_elements_text(
              COALESCE(${traderProfilesTable.additionalServices}, '[]'::json)
            ) AS svc
            WHERE svc ILIKE ${specLike}
          )`,
        )!,
      );
    }

    if (search && typeof search === "string") {
      const searchLike = `%${search}%`;
      // When the search text is a known category/synonym (Home "Popular
      // categories" passes its display label here), widen the match with the
      // same canonical term expansion used for the category filter.
      const canonical = categoryTermsCondition(search);
      conditions.push(
        or(
          ilike(traderProfilesTable.businessName, `%${search}%`),
          ilike(traderProfilesTable.mainCategory, `%${search}%`),
          ilike(traderProfilesTable.businessDescription, `%${search}%`),
          ...(canonical ? [canonical] : []),
          sql`EXISTS (
            SELECT 1 FROM json_array_elements_text(
              COALESCE(${traderProfilesTable.serviceAreas}, '[]'::json)
            ) AS area
            WHERE area ILIKE ${searchLike}
          )`,
        )!
      );
    }

    // --- Search radius --------------------------------------------------
    // A pure FILTER, never a ranking factor: traders outside the radius are
    // excluded and the ordering logic below stays untouched. Anchor
    // precedence: explicit lat/lng from the app, else a geocodable `near`
    // string (place name / postcode / outcode). Traders without trusted
    // coords (geocodedPostcode must match their current postcode) are
    // excluded while a radius is active — their distance is unknowable. If
    // no anchor can be resolved (unknown place, geocoder down), the filter
    // is skipped entirely so results degrade to UK-wide rather than
    // returning a misleading empty list.
    const parseNum = (v: unknown): number | null => {
      if (typeof v !== "string" || v.trim() === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const radiusMilesNum = parseNum(radiusMiles);
    if (radiusMilesNum != null && radiusMilesNum > 0) {
      const clampedRadius = Math.min(500, Math.max(1, radiusMilesNum));
      let anchor: { latitude: number; longitude: number } | null = null;
      const latNum = parseNum(lat);
      const lngNum = parseNum(lng);
      if (latNum != null && lngNum != null && Math.abs(latNum) <= 90 && Math.abs(lngNum) <= 180) {
        anchor = { latitude: latNum, longitude: lngNum };
      } else if (typeof near === "string" && near.trim()) {
        anchor = await geocodeUkLocation(near);
      }
      if (anchor) {
        // Haversine great-circle distance in miles (Earth radius 3958.8 mi),
        // acos-clamped against floating-point drift.
        conditions.push(
          sql`(
            ${traderProfilesTable.latitude} IS NOT NULL
            AND ${traderProfilesTable.longitude} IS NOT NULL
            AND ${traderProfilesTable.geocodedPostcode} = ${traderProfilesTable.postcode}
            AND (3958.8 * acos(least(1.0, greatest(-1.0,
              cos(radians(${anchor.latitude})) * cos(radians(${traderProfilesTable.latitude}))
              * cos(radians(${traderProfilesTable.longitude}) - radians(${anchor.longitude}))
              + sin(radians(${anchor.latitude})) * sin(radians(${traderProfilesTable.latitude}))
            )))) <= ${clampedRadius}
          )`,
        );
      }
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
            // Use effective isFeatured: treat as false when the non-Stripe
            // subscription period has lapsed but the downgrade webhook hasn't
            // arrived yet (same logic as the premium plan filter above).
            sql`case when ${traderProfilesTable.isFeatured} = true AND NOT (
              ${subscriptionsTable.stripeSubscriptionId} IS NULL
              AND ${subscriptionsTable.stripeCustomerId} IS NULL
              AND ${subscriptionsTable.currentPeriodEnd} IS NOT NULL
              AND ${subscriptionsTable.currentPeriodEnd} <= NOW()
            ) then 1 else 0 end DESC`,
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
      .leftJoin(subscriptionsTable, eq(subscriptionsTable.userId, traderProfilesTable.userId))
      .where(where)
      .orderBy(...orderBy)
      .limit(limitNum)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .leftJoin(subscriptionsTable, eq(subscriptionsTable.userId, traderProfilesTable.userId))
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
      .leftJoin(subscriptionsTable, eq(subscriptionsTable.userId, traderProfilesTable.userId))
      .where(and(
        ...publicTraderSqlConditions({ verifiedOnly: true }),
        eq(traderProfilesTable.isFeatured, true),
        // Exclude traders whose non-Stripe subscription has lapsed but whose
        // isFeatured flag hasn't been cleared by a downgrade event yet.
        sql`NOT (
          ${subscriptionsTable.stripeSubscriptionId} IS NULL
          AND ${subscriptionsTable.stripeCustomerId} IS NULL
          AND ${subscriptionsTable.currentPeriodEnd} IS NOT NULL
          AND ${subscriptionsTable.currentPeriodEnd} <= NOW()
        )`,
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
      !isTraderPubliclyListed({
        isActive: row.profile.isActive,
        verificationStatus: row.profile.verificationStatus,
        revalidationOverdue: row.profile.revalidationOverdue,
        deletionStatus: row.deletionStatus,
        deletedAt: row.deletedAt,
      })
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
  // All verified traders (free Basic and paid Premium) get a full public
  // profile, including extra services and social links. Premium adds perks
  // elsewhere (featured placement, higher search ranking and unlimited
  // gallery images), not these profile fields.
  //
  // Contact integrity: direct contact routes (email, phone, website, social
  // links) are NEVER exposed on the public profile. They are only revealed
  // inside a conversation once the customer has accepted a quote / hired the
  // trader (see routes/conversations.ts). The values stay stored for
  // verification and admin use.
  return {
    id: t.id,
    userId: t.userId,
    businessName: t.businessName,
    contactName: t.contactName,
    email: null,
    phone: null,
    mainCategory: t.mainCategory,
    additionalServices: t.additionalServices || [],
    businessAddress: t.businessAddress,
    town: t.town,
    postcode: t.postcode,
    serviceAreas: t.serviceAreas || [],
    businessDescription: t.businessDescription,
    website: null,
    openingHours: t.openingHours,
    logoUrl: t.logoUrl,
    galleryUrls: t.galleryUrls || [],
    socialLinks: null,
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
