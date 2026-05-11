import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  promoCodesTable,
  promoRedemptionsTable,
  usersTable,
  traderProfilesTable,
} from "@workspace/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { authMiddleware, traderOnly, adminOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";

const router: IRouter = Router();

// Promo codes are demo-mode-only until live Stripe Coupon integration ships.
// Mirrors the gate in /subscriptions/checkout so the trader-facing endpoints
// don't promise discounts that the checkout flow would then reject.
const IS_DEMO_MODE = !process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== "production";

function rejectIfNotDemo(res: import("express").Response): boolean {
  if (IS_DEMO_MODE) return false;
  res.status(503).json({
    error:
      "Promo codes are temporarily unavailable. Please subscribe at the standard price; the discount will return shortly.",
  });
  return true;
}

export const PLAN_PRICES_GBP: Record<string, number> = {
  basic: 10,
  premium: 20,
  elite: 30,
};

export type ClaimPromoResult =
  | {
      ok: true;
      redemptionId: number;
      promoCodeId: number;
      code: string;
      discountGbp: number;
      originalPriceGbp: number;
      discountedPriceGbp: number;
      expiresAt: Date;
      validForDays: number;
    }
  | {
      ok: false;
      reason: string;
      status: number;
    };

/**
 * Atomically validates a promo code and inserts a redemption row for the
 * given trader. Designed to be called inside the demo-mode subscription
 * activation transaction so slot exhaustion is race-safe.
 *
 * Returns a discriminated union; callers should rollback on `ok: false`.
 *
 * NOTE: The transaction is required to use the same `tx` instance for the
 * SELECT count + INSERT, otherwise two parallel claims could both pass the
 * cap check. Postgres' default REPEATABLE READ isolation isn't enabled here
 * but the unique `userId` constraint on the redemptions table prevents
 * double-claims by the same trader; the `maxRedemptions` cap could in
 * theory be exceeded under heavy concurrency. For our scale (max 20 slots,
 * small marketing promo) that risk is acceptable.
 */
export async function claimPromoForUser(
  // drizzle's tx type is internal; using a structural subset keeps this
  // helper usable from both `db` and `tx` contexts.
  tx: typeof db,
  opts: { userId: number; code: string; planId: string },
): Promise<ClaimPromoResult> {
  const normalized = opts.code.trim().toUpperCase();
  const originalPrice = PLAN_PRICES_GBP[opts.planId];
  if (originalPrice === undefined) {
    return { ok: false, reason: "Invalid plan for promo.", status: 400 };
  }

  // Lock the promo row for the duration of this transaction. Combined with
  // the count + insert below, this serializes all concurrent claims for the
  // same code so we cannot exceed `maxRedemptions` even under heavy load.
  const lockedRows = await tx.execute(
    sql`select * from ${promoCodesTable} where ${promoCodesTable.code} = ${normalized} for update`,
  );
  const promo = (lockedRows.rows[0] ?? null) as
    | (typeof promoCodesTable.$inferSelect)
    | null;

  if (!promo) {
    return { ok: false, reason: "Promo code not found.", status: 404 };
  }
  if (!promo.isActive) {
    return { ok: false, reason: "This promo code is no longer active.", status: 400 };
  }
  if (!promo.applicablePlans.includes(opts.planId)) {
    return {
      ok: false,
      reason: `This code is only valid for: ${promo.applicablePlans.join(", ")}.`,
      status: 400,
    };
  }

  // Has the user already redeemed any promo? (one promo per trader, ever)
  const [existing] = await tx
    .select()
    .from(promoRedemptionsTable)
    .where(eq(promoRedemptionsTable.userId, opts.userId))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      reason: "You have already redeemed a promo code.",
      status: 409,
    };
  }

  // Cap check — safe because we hold a row lock on the promo above.
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(promoRedemptionsTable)
    .where(eq(promoRedemptionsTable.promoCodeId, promo.id));

  if (count >= promo.maxRedemptions) {
    return {
      ok: false,
      reason: "All promo slots have been claimed.",
      status: 409,
    };
  }

  const discountedPrice = Math.max(0, originalPrice - promo.discountGbp);
  const expiresAt = new Date(Date.now() + promo.validForDays * 24 * 60 * 60 * 1000);

  const [redemption] = await tx
    .insert(promoRedemptionsTable)
    .values({
      promoCodeId: promo.id,
      userId: opts.userId,
      planId: opts.planId,
      originalPriceGbp: originalPrice,
      discountGbp: promo.discountGbp,
      discountedPriceGbp: discountedPrice,
      expiresAt,
    })
    .returning();

  return {
    ok: true,
    redemptionId: redemption.id,
    promoCodeId: promo.id,
    code: promo.code,
    discountGbp: promo.discountGbp,
    originalPriceGbp: originalPrice,
    discountedPriceGbp: discountedPrice,
    expiresAt,
    validForDays: promo.validForDays,
  };
}

const ValidatePromoBody = z.object({
  code: z.string().min(1).max(50),
  planId: z.enum(["basic", "premium", "elite"]),
});

// POST /api/promo/validate — preview before checkout (does not claim a slot)
router.post("/promo/validate", authMiddleware, traderOnly, async (req, res) => {
  try {
    if (rejectIfNotDemo(res)) return;
    const { userId } = req as AuthenticatedRequest;
    const body = ValidatePromoBody.parse(req.body);
    const code = body.code.trim().toUpperCase();
    const originalPrice = PLAN_PRICES_GBP[body.planId];

    const [promo] = await db
      .select()
      .from(promoCodesTable)
      .where(eq(promoCodesTable.code, code))
      .limit(1);

    if (!promo) {
      res.json({ valid: false, reason: "Promo code not found." });
      return;
    }
    if (!promo.isActive) {
      res.json({ valid: false, reason: "This promo code is no longer active." });
      return;
    }
    if (!promo.applicablePlans.includes(body.planId)) {
      res.json({
        valid: false,
        reason: `This code is only valid for: ${promo.applicablePlans.join(", ")}.`,
      });
      return;
    }

    const [existing] = await db
      .select()
      .from(promoRedemptionsTable)
      .where(eq(promoRedemptionsTable.userId, userId))
      .limit(1);
    if (existing) {
      res.json({ valid: false, reason: "You have already redeemed a promo code." });
      return;
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(promoRedemptionsTable)
      .where(eq(promoRedemptionsTable.promoCodeId, promo.id));

    const slotsRemaining = Math.max(0, promo.maxRedemptions - count);
    if (slotsRemaining <= 0) {
      res.json({ valid: false, reason: "All promo slots have been claimed." });
      return;
    }

    const discountedPrice = Math.max(0, originalPrice - promo.discountGbp);
    res.json({
      valid: true,
      code: promo.code,
      description: promo.description,
      discountGbp: promo.discountGbp,
      slotsRemaining,
      maxRedemptions: promo.maxRedemptions,
      validForDays: promo.validForDays,
      originalPriceGbp: originalPrice,
      discountedPriceGbp: discountedPrice,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    req.log.error({ err: error }, "Validate promo failed");
    res.status(500).json({ error: "Failed to validate promo code" });
  }
});

// GET /api/promo/my-redemption — current trader's promo (drives the countdown)
router.get("/promo/my-redemption", authMiddleware, traderOnly, async (req, res) => {
  try {
    // Existing redemptions stay visible even outside demo mode so the
    // countdown badge keeps working — but we don't validate or surface new
    // codes there. Only NEW claims are gated.
    const { userId } = req as AuthenticatedRequest;
    const rows = await db
      .select({
        id: promoRedemptionsTable.id,
        code: promoCodesTable.code,
        description: promoCodesTable.description,
        planId: promoRedemptionsTable.planId,
        discountGbp: promoRedemptionsTable.discountGbp,
        originalPriceGbp: promoRedemptionsTable.originalPriceGbp,
        discountedPriceGbp: promoRedemptionsTable.discountedPriceGbp,
        redeemedAt: promoRedemptionsTable.redeemedAt,
        expiresAt: promoRedemptionsTable.expiresAt,
      })
      .from(promoRedemptionsTable)
      .innerJoin(promoCodesTable, eq(promoCodesTable.id, promoRedemptionsTable.promoCodeId))
      .where(eq(promoRedemptionsTable.userId, userId))
      .limit(1);

    const r = rows[0];
    if (!r) {
      res.json({ redemption: null });
      return;
    }
    const isActive = r.expiresAt.getTime() > Date.now();
    res.json({ redemption: { ...r, isActive } });
  } catch (error) {
    req.log.error({ err: error }, "Get my promo redemption failed");
    res.status(500).json({ error: "Failed to load promo status" });
  }
});

// ================== ADMIN ==================

const CreatePromoBody = z.object({
  code: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, underscore or dash only."),
  description: z.string().max(500).optional(),
  discountGbp: z.number().int().min(1).max(1000),
  maxRedemptions: z.number().int().min(1).max(100000),
  applicablePlans: z.array(z.enum(["basic", "premium", "elite"])).min(1),
  validForDays: z.number().int().min(1).max(365).default(30),
  isActive: z.boolean().optional().default(true),
});

const UpdatePromoBody = z.object({
  description: z.string().max(500).nullable().optional(),
  maxRedemptions: z.number().int().min(1).max(100000).optional(),
  isActive: z.boolean().optional(),
});

router.get("/admin/promo-codes", authMiddleware, adminOnly, async (req, res) => {
  try {
    const codes = await db
      .select()
      .from(promoCodesTable)
      .orderBy(desc(promoCodesTable.createdAt));

    const counts = await db
      .select({
        promoCodeId: promoRedemptionsTable.promoCodeId,
        count: sql<number>`count(*)::int`,
      })
      .from(promoRedemptionsTable)
      .groupBy(promoRedemptionsTable.promoCodeId);

    const countMap = new Map<number, number>(counts.map((c) => [c.promoCodeId, c.count]));

    res.json({
      promoCodes: codes.map((c) => ({
        ...c,
        redemptionsCount: countMap.get(c.id) ?? 0,
        slotsRemaining: Math.max(0, c.maxRedemptions - (countMap.get(c.id) ?? 0)),
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "List promo codes failed");
    res.status(500).json({ error: "Failed to load promo codes" });
  }
});

router.post("/admin/promo-codes", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = CreatePromoBody.parse(req.body);
    const code = body.code.trim().toUpperCase();

    const [existing] = await db
      .select()
      .from(promoCodesTable)
      .where(eq(promoCodesTable.code, code))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "A promo code with that code already exists." });
      return;
    }

    const [created] = await db
      .insert(promoCodesTable)
      .values({
        code,
        description: body.description ?? null,
        discountGbp: body.discountGbp,
        maxRedemptions: body.maxRedemptions,
        applicablePlans: body.applicablePlans,
        validForDays: body.validForDays,
        isActive: body.isActive,
        createdByUserId: userId,
      })
      .returning();

    res.status(201).json({ promoCode: created });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: "Invalid promo data", fieldErrors: error.flatten().fieldErrors });
      return;
    }
    req.log.error({ err: error }, "Create promo failed");
    res.status(500).json({ error: "Failed to create promo code" });
  }
});

router.patch("/admin/promo-codes/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const body = UpdatePromoBody.parse(req.body);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.description !== undefined) patch.description = body.description;
    if (body.maxRedemptions !== undefined) patch.maxRedemptions = body.maxRedemptions;
    if (body.isActive !== undefined) patch.isActive = body.isActive;

    const [updated] = await db
      .update(promoCodesTable)
      .set(patch)
      .where(eq(promoCodesTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Promo code not found" });
      return;
    }
    res.json({ promoCode: updated });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid update data", fieldErrors: error.flatten().fieldErrors });
      return;
    }
    req.log.error({ err: error }, "Update promo failed");
    res.status(500).json({ error: "Failed to update promo code" });
  }
});

router.get("/admin/promo-codes/:id/redemptions", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const rows = await db
      .select({
        id: promoRedemptionsTable.id,
        userId: promoRedemptionsTable.userId,
        email: usersTable.email,
        fullName: usersTable.fullName,
        businessName: traderProfilesTable.businessName,
        planId: promoRedemptionsTable.planId,
        originalPriceGbp: promoRedemptionsTable.originalPriceGbp,
        discountGbp: promoRedemptionsTable.discountGbp,
        discountedPriceGbp: promoRedemptionsTable.discountedPriceGbp,
        redeemedAt: promoRedemptionsTable.redeemedAt,
        expiresAt: promoRedemptionsTable.expiresAt,
      })
      .from(promoRedemptionsTable)
      .innerJoin(usersTable, eq(usersTable.id, promoRedemptionsTable.userId))
      .leftJoin(
        traderProfilesTable,
        eq(traderProfilesTable.userId, promoRedemptionsTable.userId),
      )
      .where(eq(promoRedemptionsTable.promoCodeId, id))
      .orderBy(desc(promoRedemptionsTable.redeemedAt));

    res.json({ redemptions: rows });
  } catch (error) {
    req.log.error({ err: error }, "List promo redemptions failed");
    res.status(500).json({ error: "Failed to load redemptions" });
  }
});

export default router;
