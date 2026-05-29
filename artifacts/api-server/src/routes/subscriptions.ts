import { Router, type IRouter } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  subscriptionsTable,
  promoCodesTable,
  promoRedemptionsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware, traderOnly, revokeUserSessions } from "../lib/auth";
import { CreateCheckoutSessionBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";
import { logAudit, TRADER_STATUS } from "../lib/trader-status";
import { claimPromoForUser } from "./promo";
import {
  listCustomerActiveEntitlements,
  listEntitlements,
} from "@replit/revenuecat-sdk";
import { getUncachableRevenueCatClient } from "../lib/revenueCatClient";

const router: IRouter = Router();

const IS_DEMO_MODE = !process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== "production";

const PLANS = [
  {
    id: "basic",
    name: "Basic Plan",
    price: 10,
    currency: "GBP",
    interval: "month",
    features: [
      "Business listing",
      "Basic profile page",
      "Contact details displayed",
      "Up to 3 gallery images",
      "Standard search visibility",
    ],
    isPopular: false,
  },
  {
    id: "premium",
    name: "Premium Plan",
    price: 20,
    currency: "GBP",
    interval: "month",
    features: [
      "Everything in Basic",
      "Enhanced profile page",
      "Up to 10 gallery images",
      "Priority search placement",
      "Social media links",
      "Service area coverage display",
      "Premium badge on listing",
    ],
    isPopular: true,
  },
  {
    id: "elite",
    name: "Elite Plan",
    price: 30,
    currency: "GBP",
    interval: "month",
    features: [
      "Everything in Premium",
      "Featured trader placement",
      "Top search visibility",
      "Unlimited gallery images",
      "Featured badge with star",
      "Homepage featured section",
      "Priority customer leads",
      "Business website link",
    ],
    isPopular: false,
  },
];

const STRIPE_PRICE_MAP: Record<string, string> = {
  basic: process.env.STRIPE_PRICE_BASIC || "",
  premium: process.env.STRIPE_PRICE_PREMIUM || "",
  elite: process.env.STRIPE_PRICE_ELITE || "",
};

router.get("/subscriptions/plans", (_req, res) => {
  res.json({ plans: PLANS });
});

router.post("/subscriptions/checkout", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = CreateCheckoutSessionBody.parse(req.body);
    const planId = body.planId;

    // Optional promo code piggy-backed on the same request body. Not part of
    // CreateCheckoutSessionBody yet (would require an OpenAPI/codegen
    // change) so we parse it separately.
    const promoCodeRaw = z
      .string()
      .trim()
      .min(1)
      .max(50)
      .optional()
      .parse((req.body as { promoCode?: unknown })?.promoCode);

    if (!["basic", "premium", "elite"].includes(planId)) {
      res.status(400).json({ error: "Invalid plan selected" });
      return;
    }

    // Promo codes are demo-mode only for now — the live Stripe Coupon flow
    // is intentionally out of scope until Stripe is configured properly.
    if (promoCodeRaw && !IS_DEMO_MODE) {
      res.status(400).json({
        error:
          "Promo codes are temporarily unavailable. Please subscribe at the standard price; the discount will return shortly.",
      });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Phase 6: only verified traders may subscribe.
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile || profile.verificationStatus !== TRADER_STATUS.VERIFIED) {
      res.status(403).json({ error: "Your account must be verified before you can subscribe." });
      return;
    }

    if (IS_DEMO_MODE) {
      const demoSessionId = "demo_session_" + Date.now();
      const demoCustomerId = user.stripeCustomerId || "demo_cus_" + userId;

      // Claim the promo (if supplied) inside the same transaction that
      // marks the subscription pending — keeps slot accounting consistent.
      // We use a wrapper object so TypeScript's control-flow analysis doesn't
      // narrow this `let` to `null` after the closure (assignments inside
      // the transaction callback aren't tracked otherwise).
      const promoState: {
        result: {
          code: string;
          discountGbp: number;
          originalPriceGbp: number;
          discountedPriceGbp: number;
          expiresAt: Date;
          validForDays: number;
        } | null;
      } = { result: null };
      let promoErrorStatus = 0;
      let promoErrorMsg: string | null = null;

      await db.transaction(async (tx) => {
        await tx
          .update(usersTable)
          .set({ stripeCustomerId: demoCustomerId, stripeSubscriptionId: demoSessionId })
          .where(eq(usersTable.id, userId));

        const existingSub = await tx
          .select()
          .from(subscriptionsTable)
          .where(eq(subscriptionsTable.userId, userId))
          .limit(1);

        if (existingSub.length > 0) {
          await tx
            .update(subscriptionsTable)
            .set({
              planId,
              status: "pending",
              stripeCustomerId: demoCustomerId,
              stripeSubscriptionId: demoSessionId,
              updatedAt: new Date(),
            })
            .where(eq(subscriptionsTable.userId, userId));
        } else {
          await tx.insert(subscriptionsTable).values({
            userId,
            planId,
            status: "pending",
            stripeCustomerId: demoCustomerId,
            stripeSubscriptionId: demoSessionId,
          });
        }

        if (promoCodeRaw) {
          const result = await claimPromoForUser(tx as unknown as typeof db, {
            userId,
            code: promoCodeRaw,
            planId,
          });
          if (!result.ok) {
            promoErrorStatus = result.status;
            promoErrorMsg = result.reason;
            // Abort the transaction — the trader explicitly tried to use a
            // promo, so failing silently would be misleading.
            throw new Error("PROMO_FAILED");
          }
          promoState.result = {
            code: result.code,
            discountGbp: result.discountGbp,
            originalPriceGbp: result.originalPriceGbp,
            discountedPriceGbp: result.discountedPriceGbp,
            expiresAt: result.expiresAt,
            validForDays: result.validForDays,
          };
        }
      }).catch((err) => {
        if (err instanceof Error && err.message === "PROMO_FAILED") return;
        throw err;
      });

      if (promoErrorMsg) {
        res.status(promoErrorStatus || 400).json({ error: promoErrorMsg });
        return;
      }

      res.json({
        sessionId: demoSessionId,
        url: "DEMO_MODE",
        demoActivationUrl: `/api/subscriptions/demo-activate?sessionId=${demoSessionId}&planId=${planId}`,
        promo: promoState.result,
      });
      return;
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeSecretKey!);

    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.fullName,
        metadata: { userId: String(userId) },
      });
      stripeCustomerId = customer.id;
      await db.update(usersTable).set({ stripeCustomerId }).where(eq(usersTable.id, userId));
    }

    const priceId = STRIPE_PRICE_MAP[planId];
    if (!priceId) {
      res.status(400).json({ error: "Stripe price not configured for this plan" });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { planId, userId: String(userId) },
      subscription_data: { metadata: { planId, userId: String(userId) } },
      success_url: `${process.env.APP_URL || "https://mylocaltrade.co.uk"}/subscription/success`,
      cancel_url: `${process.env.APP_URL || "https://mylocaltrade.co.uk"}/pricing`,
    });

    await db.transaction(async (tx) => {
      const existingSub = await tx
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
        .limit(1);

      if (existingSub.length > 0) {
        await tx
          .update(subscriptionsTable)
          .set({
            planId,
            status: "pending",
            stripeCustomerId,
            updatedAt: new Date(),
          })
          .where(eq(subscriptionsTable.userId, userId));
      } else {
        await tx.insert(subscriptionsTable).values({
          userId,
          planId,
          status: "pending",
          stripeCustomerId,
        });
      }
    });

    res.json({
      sessionId: session.id,
      url: session.url || "",
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid checkout data" });
      return;
    }
    req.log.error({ err: error }, "Create checkout failed");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.post("/subscriptions/demo-activate", authMiddleware, traderOnly, async (req, res) => {
  try {
    // Hard-block in production regardless of STRIPE_SECRET_KEY presence so this
    // endpoint cannot be used to bypass payments. Returns 404 to avoid leaking
    // the existence of the demo path to live clients.
    if (process.env.NODE_ENV === "production" || !IS_DEMO_MODE) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const { userId } = req as AuthenticatedRequest;
    const planId = req.query.planId as string;
    const sessionId = req.query.sessionId as string;

    if (!planId || !["basic", "premium", "elite"].includes(planId)) {
      res.status(400).json({ error: "Invalid plan" });
      return;
    }

    if (!sessionId) {
      res.status(400).json({ error: "Missing session ID" });
      return;
    }

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    if (!sub || sub.stripeSubscriptionId !== sessionId || sub.status !== "pending") {
      res.status(400).json({ error: "Invalid or already processed session" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(subscriptionsTable)
        .set({
          status: "active",
          planId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(subscriptionsTable.userId, userId));

      await tx
        .update(usersTable)
        .set({ plan: planId, isActive: true })
        .where(eq(usersTable.id, userId));

      await tx
        .update(traderProfilesTable)
        .set({
          plan: planId,
          isActive: true,
          isFeatured: planId === "premium" || planId === "elite",
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, userId));
    });

    await logAudit({ userId, action: "SUBSCRIPTION_ACTIVATED", details: { plan: planId, demo: true } });
    await logAudit({ userId, action: "PROFILE_WENT_LIVE", details: { plan: planId } });

    res.json({ success: true, plan: planId, status: "active" });
  } catch (error) {
    req.log.error({ err: error }, "Demo activation failed");
    res.status(500).json({ error: "Demo activation failed" });
  }
});

// POST /api/subscriptions/revenuecat-sync — verify the trader's RevenueCat
// entitlement (Apple In-App Purchase on iOS) and, if active, take the profile
// live. This path is SEPARATE from web Stripe: it only ever ACTIVATES based on
// a valid RevenueCat entitlement and never deactivates an existing subscription
// (so a web Stripe subscriber who opens the iOS app is never clobbered).
// Expiry / cancellation handling is a follow-up via RevenueCat webhooks.
const REVENUECAT_ENTITLEMENT_ID =
  process.env.REVENUECAT_ENTITLEMENT_ID || "trader_subscription";
const REVENUECAT_PROJECT_ID = process.env.REVENUECAT_PROJECT_ID;
const RC_PLAN_ID = "trader";

// Entitlement lookup keys differ between display names ("Trader Subscription")
// and identifiers ("trader_subscription"). Normalise both sides before
// comparing so either form resolves to the same entitlement.
function normalizeEntitlementKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

interface RevenueCatActiveEntitlement {
  entitlement_id?: string;
  expires_at?: number | null;
  product_identifier?: string;
}

router.post("/subscriptions/revenuecat-sync", authMiddleware, traderOnly, async (req, res) => {
  try {
    if (!REVENUECAT_PROJECT_ID) {
      res.status(503).json({ error: "In-app purchases are not configured yet." });
      return;
    }

    const { userId } = req as AuthenticatedRequest;

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Mirror the subscribe gate: only verified traders may go live.
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile || profile.verificationStatus !== TRADER_STATUS.VERIFIED) {
      res.status(403).json({ error: "Your account must be verified before you can subscribe." });
      return;
    }

    // RevenueCat uses our app user id as the customer id (set via logIn on the
    // client). Query the v2 Developer API (via the Replit connector) to confirm
    // the active entitlement server-side.
    const wanted = normalizeEntitlementKey(REVENUECAT_ENTITLEMENT_ID);
    let activeEntitlements: RevenueCatActiveEntitlement[];
    // The v2 active_entitlements list identifies entitlements by their object id
    // (e.g. "entl..."), NOT by lookup key/display name. Resolve our configured
    // key to that object id (and its lookup key) so we can match reliably.
    let targetEntitlementId: string | null = null;
    let targetLookupKey: string | null = null;
    try {
      const client = await getUncachableRevenueCatClient();

      const { data: entlData } = await listEntitlements({
        client,
        path: { project_id: REVENUECAT_PROJECT_ID },
      });
      const target = (entlData?.items ?? []).find(
        (e) =>
          e.id === REVENUECAT_ENTITLEMENT_ID ||
          (!!e.lookup_key && normalizeEntitlementKey(e.lookup_key) === wanted) ||
          (!!e.display_name && normalizeEntitlementKey(e.display_name) === wanted),
      );
      targetEntitlementId = target?.id ?? null;
      targetLookupKey = target?.lookup_key ?? null;

      const { data, error } = await listCustomerActiveEntitlements({
        client,
        path: { project_id: REVENUECAT_PROJECT_ID, customer_id: String(userId) },
      });
      if (error) {
        req.log.error({ err: error }, "RevenueCat lookup failed");
        res.status(502).json({ error: "Could not verify your subscription. Please try again." });
        return;
      }
      activeEntitlements = (data?.items ?? []) as RevenueCatActiveEntitlement[];
    } catch (e) {
      req.log.error({ err: e }, "RevenueCat request error");
      res.status(502).json({ error: "Could not verify your subscription. Please try again." });
      return;
    }

    const entitlement = activeEntitlements.find((e) => {
      if (!e.entitlement_id) return false;
      // Primary: match against the resolved entitlement object id.
      if (targetEntitlementId && e.entitlement_id === targetEntitlementId) return true;
      const norm = normalizeEntitlementKey(e.entitlement_id);
      // Fallbacks: some payloads may surface the lookup key/display name instead.
      if (targetLookupKey && norm === normalizeEntitlementKey(targetLookupKey)) return true;
      return norm === wanted;
    });
    // The v2 active_entitlements endpoint only returns currently-active grants,
    // so presence implies active. expires_at is epoch milliseconds (or null for
    // a lifetime / non-expiring grant).
    const expiresAt = entitlement?.expires_at ? new Date(entitlement.expires_at) : null;
    const isActive = !!entitlement;

    if (!isActive) {
      // Never deactivate here — that would risk clobbering a web Stripe sub.
      res.json({ active: false });
      return;
    }

    const periodEnd = expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    let stripeOwned = false;

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
        .limit(1);

      // If a Stripe-managed subscription already owns this row, never touch it:
      // overwriting plan/period/cancel fields would clobber the web Stripe state.
      // We still make sure the profile is live below (it normally already is).
      stripeOwned =
        !!existing && (!!existing.stripeSubscriptionId || !!existing.stripeCustomerId);

      if (existing && !stripeOwned) {
        await tx
          .update(subscriptionsTable)
          .set({
            status: "active",
            planId: RC_PLAN_ID,
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            updatedAt: new Date(),
          })
          .where(eq(subscriptionsTable.userId, userId));
      } else if (!existing) {
        await tx.insert(subscriptionsTable).values({
          userId,
          planId: RC_PLAN_ID,
          status: "active",
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
        });
      }

      // Ensure the profile is live. When Stripe owns the subscription row we
      // leave its plan label intact and only guarantee the account is active.
      if (stripeOwned) {
        await tx
          .update(usersTable)
          .set({ isActive: true })
          .where(eq(usersTable.id, userId));
        await tx
          .update(traderProfilesTable)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(traderProfilesTable.userId, userId));
      } else {
        await tx
          .update(usersTable)
          .set({ plan: RC_PLAN_ID, isActive: true })
          .where(eq(usersTable.id, userId));
        await tx
          .update(traderProfilesTable)
          .set({ plan: RC_PLAN_ID, isActive: true, updatedAt: new Date() })
          .where(eq(traderProfilesTable.userId, userId));
      }
    });

    await logAudit({
      userId,
      action: "SUBSCRIPTION_ACTIVATED",
      details: { plan: RC_PLAN_ID, source: "revenuecat", productId: entitlement?.product_identifier, stripeOwned },
    });
    await logAudit({ userId, action: "PROFILE_WENT_LIVE", details: { plan: RC_PLAN_ID, source: "revenuecat", stripeOwned } });

    res.json({
      active: true,
      plan: RC_PLAN_ID,
      productId: entitlement?.product_identifier ?? null,
      currentPeriodEnd: stripeOwned ? null : periodEnd.toISOString(),
      stripeOwned,
    });
  } catch (error) {
    req.log.error({ err: error }, "RevenueCat sync failed");
    res.status(500).json({ error: "Failed to sync subscription" });
  }
});

// POST /api/subscriptions/cancel — schedule cancellation at period end (mock + Stripe-ready)
router.post("/subscriptions/cancel", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);
    if (!sub || sub.status !== "active") {
      res.status(400).json({ error: "No active subscription to cancel." });
      return;
    }
    if (sub.cancelAtPeriodEnd) {
      res.json({ success: true, alreadyScheduled: true, cancelAtPeriodEnd: true, currentPeriodEnd: sub.currentPeriodEnd });
      return;
    }

    if (!IS_DEMO_MODE && sub.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      try {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
      } catch (e) {
        req.log.error({ err: e }, "Stripe cancel failed");
        res.status(502).json({ error: "Failed to cancel with payment provider." });
        return;
      }
    }

    await db
      .update(subscriptionsTable)
      .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, userId));

    await logAudit({ userId, action: "SUBSCRIPTION_CANCELLED", details: { scheduled: true, periodEnd: sub.currentPeriodEnd } });

    res.json({ success: true, cancelAtPeriodEnd: true, currentPeriodEnd: sub.currentPeriodEnd });
  } catch (error) {
    req.log.error({ err: error }, "Cancel subscription failed");
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// POST /api/subscriptions/resume — undo a scheduled cancellation
router.post("/subscriptions/resume", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);
    if (!sub || sub.status !== "active" || !sub.cancelAtPeriodEnd) {
      res.status(400).json({ error: "No scheduled cancellation to resume." });
      return;
    }

    if (!IS_DEMO_MODE && sub.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      try {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: false });
      } catch (e) {
        req.log.error({ err: e }, "Stripe resume failed");
        res.status(502).json({ error: "Failed to resume with payment provider." });
        return;
      }
    }

    await db
      .update(subscriptionsTable)
      .set({ cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, userId));

    res.json({ success: true, cancelAtPeriodEnd: false });
  } catch (error) {
    req.log.error({ err: error }, "Resume subscription failed");
    res.status(500).json({ error: "Failed to resume subscription" });
  }
});

router.get("/subscriptions/status", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    // Enrich with promo redemption (if any) — drives the "£X OFF expires
    // in Yd Zh" countdown badge in the trader dashboard.
    const promoRows = await db
      .select({
        id: promoRedemptionsTable.id,
        code: promoCodesTable.code,
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

    const promo = promoRows[0]
      ? {
          ...promoRows[0],
          isActive: promoRows[0].expiresAt.getTime() > Date.now(),
        }
      : null;

    res.json({
      plan: sub?.planId ?? user.plan,
      status: sub?.status ?? (user.isActive ? "active" : "inactive"),
      currentPeriodStart: sub?.currentPeriodStart || null,
      currentPeriodEnd: sub?.currentPeriodEnd || null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd || false,
      promoRedemption: promo,
    });
  } catch (error) {
    req.log.error({ err: error }, "Get subscription status failed");
    res.status(500).json({ error: "Failed to get subscription status" });
  }
});

const WEBHOOK_TOLERANCE_SECONDS = 300;

function verifyWebhookSignature(payload: Buffer, signature: string, secret: string): boolean {
  const parts = signature.split(",");
  const timestamp = parts.find((s) => s.startsWith("t="))?.slice(2);
  const v1Sig = parts.find((s) => s.startsWith("v1="))?.slice(3);
  if (!timestamp || !v1Sig) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - ts;
  if (ageSeconds > WEBHOOK_TOLERANCE_SECONDS || ageSeconds < -WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const signedPayload = `${timestamp}.${payload.toString("utf8")}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");

  let v1Buf: Buffer;
  try {
    v1Buf = Buffer.from(v1Sig, "hex");
  } catch {
    return false;
  }

  if (v1Buf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(v1Buf, expectedBuf);
}

async function activateSubscription(customerId: string, planId: string | null, subscriptionId: string | null) {
  let activatedUserId: number | null = null;
  let wentLive = false;
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.stripeCustomerId, customerId))
      .limit(1);

    if (!user) return;
    activatedUserId = user.id;

    await tx
      .update(usersTable)
      .set({
        stripeSubscriptionId: subscriptionId,
        isActive: true,
        plan: planId,
      })
      .where(eq(usersTable.id, user.id));

    await tx
      .update(traderProfilesTable)
      .set({
        plan: planId,
        isActive: true,
        isFeatured: planId === "premium" || planId === "elite",
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, user.id));

    const existingSub = await tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, user.id))
      .limit(1);

    wentLive = existingSub.length === 0 || existingSub[0].status !== "active";

    if (existingSub.length > 0) {
      await tx
        .update(subscriptionsTable)
        .set({
          status: "active",
          planId: planId || existingSub[0].planId,
          stripeSubscriptionId: subscriptionId,
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionsTable.userId, user.id));
    } else {
      await tx.insert(subscriptionsTable).values({
        userId: user.id,
        planId: planId || "basic",
        status: "active",
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      });
    }
  });
  if (activatedUserId) {
    await logAudit({ userId: activatedUserId, action: "SUBSCRIPTION_ACTIVATED", details: { plan: planId, stripe: true } });
    if (wentLive) {
      await logAudit({ userId: activatedUserId, action: "PROFILE_WENT_LIVE", details: { plan: planId } });
    }
  }
}

async function deactivateSubscription(customerId: string) {
  let deactivatedUserId: number | null = null;
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.stripeCustomerId, customerId))
      .limit(1);

    if (!user) return;
    deactivatedUserId = user.id;

    await tx
      .update(usersTable)
      .set({ isActive: false, plan: null })
      .where(eq(usersTable.id, user.id));

    await revokeUserSessions(user.id, tx as unknown as typeof db);

    await tx
      .update(traderProfilesTable)
      .set({
        plan: null,
        isActive: false,
        isFeatured: false,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, user.id));

    await tx
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, user.id));
  });
  if (deactivatedUserId) {
    await logAudit({ userId: deactivatedUserId, action: "SUBSCRIPTION_CANCELLED", details: { stripe: true } });
  }
}

router.post("/webhooks/stripe", async (req, res) => {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      req.log.warn("STRIPE_WEBHOOK_SECRET not set, rejecting webhook");
      res.status(403).json({ error: "Webhook endpoint not configured" });
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      res.status(400).json({ error: "Missing Stripe signature" });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const eventType: string = event?.type ?? "";

    switch (eventType) {
      case "checkout.session.completed": {
        const session = event.data?.object;
        const customerId: string | undefined = session?.customer;
        const subscriptionId: string | undefined = session?.subscription;
        const planId: string | null = session?.metadata?.planId ?? null;

        if (customerId) {
          await activateSubscription(customerId, planId, subscriptionId ?? null);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data?.object;
        const customerId: string | undefined = subscription?.customer;
        const status: string | undefined = subscription?.status;

        if (customerId && status === "active") {
          const planId: string | null = subscription?.metadata?.planId ?? null;
          await activateSubscription(customerId, planId, subscription?.id ?? null);
        } else if (customerId && (status === "canceled" || status === "unpaid" || status === "past_due")) {
          await deactivateSubscription(customerId);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data?.object;
        const customerId: string | undefined = subscription?.customer;

        if (customerId) {
          await deactivateSubscription(customerId);
        }
        break;
      }
    }

    res.json({ success: true, message: "Webhook processed" });
  } catch (error) {
    req.log.error({ err: error }, "Stripe webhook failed");
    res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
});

export default router;
