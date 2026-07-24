import { Router, type IRouter } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  subscriptionsTable,
  cancellationRequestsTable,
  promoCodesTable,
  promoRedemptionsTable,
  PLAN_PRICING_GBP,
  PLAN_CURRENCY,
} from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authMiddleware, traderOnly } from "../lib/auth";
import { CreateCheckoutSessionBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";
import { logAudit, TRADER_STATUS } from "../lib/trader-status";
import { getCoolingOffState } from "../lib/cooling-off";
import { sendAdminCancellationRequestEmail } from "../lib/email";
import { sendPushToUser } from "../lib/push-notifications";
import { claimPromoForUser } from "./promo";
import {
  listCustomerActiveEntitlements,
  listEntitlements,
} from "@replit/revenuecat-sdk";
import { getUncachableRevenueCatClient } from "../lib/revenueCatClient";

const router: IRouter = Router();

const IS_DEMO_MODE = !process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== "production";

// Subscription model: Basic (free, limited) + a single paid Premium tier,
// billed either Monthly or Yearly. Both premium cards map to the same stored
// plan id ("premium"); only the billing interval/price differ. Real prices on
// the native iOS app come from the App Store via RevenueCat — the fallback
// prices below come from the shared PLAN_PRICING_GBP constant in
// @workspace/db/schema (single source of truth; must mirror App Store
// Connect) and drive the informational pricing cards on web / Expo Go only.
// Genuine Premium differentiators only. Free capabilities (receiving customer
// enquiries, website/social links) belong to the Basic plan below, so the
// plan comparison stays truthful and never implies those are paid features.
const PREMIUM_FEATURES = [
  "Higher search ranking and priority placement",
  "Featured listing badge and home screen placement",
  "Unlimited gallery images",
];

const PLANS = [
  {
    id: "basic",
    name: "Basic",
    price: PLAN_PRICING_GBP.basic.monthly,
    currency: PLAN_CURRENCY,
    interval: "month",
    features: [
      "Free verified public listing",
      "Receive customer enquiries",
      "Website and social links on your profile",
      "Up to 3 gallery images",
      "Standard search visibility",
    ],
    isPopular: false,
  },
  {
    id: "premium",
    name: "Premium Monthly",
    price: PLAN_PRICING_GBP.premium.monthly,
    currency: PLAN_CURRENCY,
    interval: "month",
    features: PREMIUM_FEATURES,
    isPopular: true,
  },
  {
    id: "premium",
    name: "Premium Yearly",
    price: PLAN_PRICING_GBP.premium.yearly,
    currency: PLAN_CURRENCY,
    interval: "year",
    features: PREMIUM_FEATURES,
    isPopular: false,
  },
];

const STRIPE_PRICE_MAP: Record<string, string> = {
  premium: process.env.STRIPE_PRICE_PREMIUM || "",
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

    if (!["basic", "premium"].includes(planId)) {
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

    if (!planId || !["basic", "premium"].includes(planId)) {
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
          // Anchor the cooling-off window on the first purchase only; never reset.
          originalPurchaseAt: sub.originalPurchaseAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscriptionsTable.userId, userId));

      await tx
        .update(usersTable)
        .set({ plan: planId })
        .where(eq(usersTable.id, userId));

      await tx
        .update(traderProfilesTable)
        .set({
          plan: planId,
          isFeatured: planId === "premium",
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
// A valid RevenueCat entitlement (Apple IAP, monthly or yearly) grants the
// single paid tier: Premium. Storing "premium" (not "trader") is what makes
// premium entitlements — premium badge, featured placement, unlimited gallery,
// priority search — actually apply to native subscribers.
const RC_PLAN_ID = "premium";

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
      // RevenueCat reports no active entitlement. Self-heal the local record so
      // the app converges to Apple/RevenueCat's real state on focus and on
      // "Restore purchases" — but NEVER touch a Stripe-owned row (web Stripe is
      // the source of truth there). Only an active RC/demo row needs revoking.
      const [existing] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
        .limit(1);
      const existingStripeOwned =
        !!existing && (!!existing.stripeSubscriptionId || !!existing.stripeCustomerId);
      if (existing && !existingStripeOwned && existing.status === "active") {
        await downgradeExpiredSubscription(userId);
        await logAudit({
          userId,
          action: "SUBSCRIPTION_CANCELLED",
          details: { source: "revenuecat-sync", reason: "no_active_entitlement" },
        });
        void sendPushToUser(userId, {
          title: "Premium ended",
          body: "Your Premium subscription has ended. Your free Basic listing stays live.",
          data: { type: "subscription_update", status: "cancelled" },
        }).catch((err) => req.log.warn({ err }, "Failed to send subscription-ended push"));
      }
      res.json({ active: false });
      return;
    }

    const periodEnd = expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    let stripeOwned = false;
    let newlyActivated = false;

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
      // Only a genuine inactive -> active transition should notify, so the
      // routine focus/restore syncs don't re-announce an already-live plan.
      newlyActivated = !stripeOwned && (!existing || existing.status !== "active");

      if (existing && !stripeOwned) {
        await tx
          .update(subscriptionsTable)
          .set({
            status: "active",
            planId: RC_PLAN_ID,
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            // First-purchase anchor only; renewals must not reset cooling-off.
            originalPurchaseAt: existing.originalPurchaseAt ?? new Date(),
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
          originalPurchaseAt: new Date(),
        });
      }

      // Grant Premium perks. When Stripe owns the subscription row we leave it
      // entirely intact (web Stripe is the source of truth there). Public
      // listing is driven by verification, not subscription, so we never touch
      // isActive here — losing Premium must never unlist a verified trader.
      if (!stripeOwned) {
        await tx
          .update(usersTable)
          .set({ plan: RC_PLAN_ID })
          .where(eq(usersTable.id, userId));
        await tx
          .update(traderProfilesTable)
          .set({ plan: RC_PLAN_ID, isFeatured: true, updatedAt: new Date() })
          .where(eq(traderProfilesTable.userId, userId));
      }
    });

    await logAudit({
      userId,
      action: "SUBSCRIPTION_ACTIVATED",
      details: { plan: RC_PLAN_ID, source: "revenuecat", productId: entitlement?.product_identifier, stripeOwned },
    });
    await logAudit({ userId, action: "PROFILE_WENT_LIVE", details: { plan: RC_PLAN_ID, source: "revenuecat", stripeOwned } });

    if (newlyActivated) {
      void sendPushToUser(userId, {
        title: "Premium active",
        body: "Your Premium subscription is now active. Your premium perks are live.",
        data: { type: "subscription_update", status: "active" },
      }).catch((err) => req.log.warn({ err }, "Failed to send subscription-activated push"));
    }

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

    // Effective subscription state. The stored row can lag reality when a
    // downgrade webhook (EXPIRATION) is never delivered — common with the
    // RevenueCat sandbox / Apple Test Store. So for non-Stripe subscriptions we
    // honour the paid period at read time: once currentPeriodEnd has passed the
    // trader is no longer Premium, regardless of the stored status string. This
    // is what makes the in-app Billing & Plan screen match Apple exactly.
    // Stripe-owned rows are left untouched — Stripe's own webhooks are the
    // source of truth there.
    const isStripeOwned =
      !!sub && (!!sub.stripeSubscriptionId || !!sub.stripeCustomerId);
    const periodEndMs = sub?.currentPeriodEnd
      ? sub.currentPeriodEnd.getTime()
      : null;
    const periodLapsed =
      !!sub && !isStripeOwned && periodEndMs != null && periodEndMs <= Date.now();

    // Read-only cooling-off snapshot. Anchored on the FIRST purchase date
    // (never reset by renewals); falls back to createdAt for rows predating the
    // dedicated column. This only REPORTS eligibility — it never affects perks,
    // verification, listing or featured status, and never issues refunds.
    const coolingOff = getCoolingOffState(
      sub ? sub.originalPurchaseAt ?? sub.createdAt : null,
    );
    const coolingOffProvider = !sub
      ? null
      : isStripeOwned
        ? ("stripe" as const)
        : ("apple" as const);

    // IMPORTANT: this read path only REPORTS the effective (non-Premium) state
    // when the paid period has lapsed — it deliberately does NOT mutate the DB.
    // The destructive downgrade (revoking perks: plan, featured badge, ranking)
    // is performed only once the entitlement is confirmed gone provider-side,
    // via POST /subscriptions/revenuecat-sync (the app calls it on focus and on
    // "Restore purchases") and the EXPIRATION webhook. Revoking here on the date
    // alone would risk falsely downgrading a subscription that is still active
    // during an Apple billing-grace window whose extended expiry we simply
    // haven't re-synced yet.

    if (sub && isStripeOwned) {
      // Stripe path — unchanged; reconciled by Stripe webhooks.
      res.json({
        plan: sub.planId,
        status: sub.status,
        currentPeriodStart: sub.currentPeriodStart || null,
        currentPeriodEnd: sub.currentPeriodEnd || null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
        promoRedemption: promo,
        coolingOff: { ...coolingOff, provider: coolingOffProvider },
      });
      return;
    }

    if (sub) {
      // Non-Stripe (RevenueCat / demo). Premium only while the row is active AND
      // the paid period has not lapsed; a lapsed sub reports as expired/Basic.
      const stillPremium = sub.status === "active" && !periodLapsed;
      res.json({
        plan: stillPremium ? sub.planId : null,
        status: periodLapsed ? "expired" : stillPremium ? "active" : sub.status,
        currentPeriodStart: stillPremium ? sub.currentPeriodStart || null : null,
        currentPeriodEnd: stillPremium ? sub.currentPeriodEnd || null : null,
        cancelAtPeriodEnd: stillPremium ? sub.cancelAtPeriodEnd || false : false,
        promoRedemption: promo,
        coolingOff: { ...coolingOff, provider: coolingOffProvider },
      });
      return;
    }

    // No subscription row — a free verified trader (listing is driven by
    // verification, so this must report "none" and surface the upgrade CTA,
    // never "active").
    res.json({
      plan: user.plan,
      status: "none",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      promoRedemption: promo,
      coolingOff: { ...coolingOff, provider: coolingOffProvider },
    });
  } catch (error) {
    req.log.error({ err: error }, "Get subscription status failed");
    res.status(500).json({ error: "Failed to get subscription status" });
  }
});

const CreateCancellationRequestBody = z.object({
  note: z.string().trim().max(2000).optional(),
});

// POST /api/subscriptions/cancellation-request — file a cooling-off /
// cancellation request. This is a FILE-AND-RECORD action only: it stores a
// structured request, writes an audit entry and notifies support. It NEVER
// cancels the subscription, NEVER issues an Apple/Stripe refund, and NEVER
// touches plan, perks, verification, listing or featured status. Apple-owned
// subscriptions are cancelled/refunded by Apple; the app only hands off and
// records the request so support can assist.
router.post(
  "/subscriptions/cancellation-request",
  authMiddleware,
  traderOnly,
  async (req, res) => {
    try {
      const { userId } = req as AuthenticatedRequest;
      const body = CreateCancellationRequestBody.parse(req.body);

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
        .limit(1);
      if (!sub) {
        res.status(400).json({ error: "No subscription found to cancel." });
        return;
      }

      // Dedupe: one active request at a time. Return the existing one rather
      // than stacking duplicates in the support queue.
      const [openExisting] = await db
        .select()
        .from(cancellationRequestsTable)
        .where(
          and(
            eq(cancellationRequestsTable.userId, userId),
            inArray(cancellationRequestsTable.status, ["OPEN", "IN_PROGRESS"]),
          ),
        )
        .limit(1);
      if (openExisting) {
        res.json({
          ok: true,
          alreadyOpen: true,
          requestId: openExisting.id,
          withinCoolingOff: openExisting.withinCoolingOff,
          provider: openExisting.provider,
        });
        return;
      }

      const isStripeOwned =
        !!sub.stripeSubscriptionId || !!sub.stripeCustomerId;
      const provider: "apple" | "stripe" = isStripeOwned ? "stripe" : "apple";
      const anchor = sub.originalPurchaseAt ?? sub.createdAt;
      // Cooling-off eligibility is computed SERVER-SIDE — never trusted from the
      // client — from the first-purchase anchor.
      const cooling = getCoolingOffState(anchor);

      let created: { id: number };
      try {
        [created] = await db
          .insert(cancellationRequestsTable)
          .values({
            userId,
            subscriptionId: sub.id,
            provider,
            withinCoolingOff: cooling.isWithinWindow,
            originalPurchaseAt: anchor,
            coolingOffEndsAt: cooling.endsAt ? new Date(cooling.endsAt) : null,
            userNote: body.note ?? null,
            status: "OPEN",
          })
          .returning({ id: cancellationRequestsTable.id });
      } catch (insertErr: unknown) {
        // The partial unique index (one active request per user) closes the
        // race when two submissions slip past the SELECT above. Treat the
        // unique violation as "already open" rather than a server error.
        if (
          typeof insertErr === "object" &&
          insertErr !== null &&
          (insertErr as { code?: string }).code === "23505"
        ) {
          const [raced] = await db
            .select()
            .from(cancellationRequestsTable)
            .where(
              and(
                eq(cancellationRequestsTable.userId, userId),
                inArray(cancellationRequestsTable.status, ["OPEN", "IN_PROGRESS"]),
              ),
            )
            .limit(1);
          res.json({
            ok: true,
            alreadyOpen: true,
            requestId: raced?.id,
            withinCoolingOff: raced?.withinCoolingOff,
            provider: raced?.provider,
          });
          return;
        }
        throw insertErr;
      }

      await logAudit({
        userId,
        action: "COOLING_OFF_CANCELLATION_REQUESTED",
        details: {
          requestId: created.id,
          provider,
          withinCoolingOff: cooling.isWithinWindow,
        },
        notes: body.note,
      });

      // Best-effort support notification — never block the request on email.
      try {
        const [user] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        const [profile] = await db
          .select()
          .from(traderProfilesTable)
          .where(eq(traderProfilesTable.userId, userId))
          .limit(1);
        await sendAdminCancellationRequestEmail({
          traderEmail: user?.email ?? `user-${userId}`,
          traderName: user?.fullName ?? `User #${userId}`,
          businessName: profile?.businessName ?? null,
          provider,
          withinCoolingOff: cooling.isWithinWindow,
          note: body.note ?? null,
        });
      } catch (e) {
        req.log.error({ err: e }, "Cancellation request support email failed");
      }

      res.status(201).json({
        ok: true,
        requestId: created.id,
        withinCoolingOff: cooling.isWithinWindow,
        provider,
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request", details: error.issues });
        return;
      }
      req.log.error({ err: error }, "Create cancellation request failed");
      res.status(500).json({ error: "Failed to file cancellation request." });
    }
  },
);

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
        plan: planId,
      })
      .where(eq(usersTable.id, user.id));

    await tx
      .update(traderProfilesTable)
      .set({
        plan: planId,
        isFeatured: planId === "premium",
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
          // First-purchase anchor only; renewals/reactivations must not reset
          // the cooling-off window.
          originalPurchaseAt: existingSub[0].originalPurchaseAt ?? new Date(),
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
        originalPurchaseAt: new Date(),
      });
    }
  });
  if (activatedUserId) {
    await logAudit({ userId: activatedUserId, action: "SUBSCRIPTION_ACTIVATED", details: { plan: planId, stripe: true } });
    if (wentLive) {
      await logAudit({ userId: activatedUserId, action: "PROFILE_WENT_LIVE", details: { plan: planId } });
      // Best-effort; runs outside a request so there is no req.log to use.
      void sendPushToUser(activatedUserId, {
        title: "Premium active",
        body: "Your Premium subscription is now active. Your premium perks are live.",
        data: { type: "subscription_update", status: "active" },
      }).catch(() => {});
    }
  }
}

async function deactivateSubscription(customerId: string) {
  let deactivatedUserId: number | null = null;
  let wasActive = false;
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.stripeCustomerId, customerId))
      .limit(1);

    if (!user) return;
    deactivatedUserId = user.id;

    // Downgrade only: the trader stays publicly listed (free Basic) and stays
    // logged in. We never set isActive=false or revoke sessions here — losing
    // Premium just removes the paid perks (plan label + featured placement).
    await tx
      .update(usersTable)
      .set({ plan: null })
      .where(eq(usersTable.id, user.id));

    await tx
      .update(traderProfilesTable)
      .set({
        plan: null,
        isFeatured: false,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, user.id));

    const [existingSub] = await tx
      .select({ status: subscriptionsTable.status })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, user.id))
      .limit(1);
    // Stripe can emit several terminal events (updated + deleted); only the
    // genuine active -> cancelled transition should notify, never the repeats.
    wasActive = existingSub?.status === "active";

    await tx
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, user.id));
  });
  if (deactivatedUserId) {
    await logAudit({ userId: deactivatedUserId, action: "SUBSCRIPTION_CANCELLED", details: { stripe: true } });
    if (wasActive) {
      // Best-effort; runs outside a request so there is no req.log to use.
      void sendPushToUser(deactivatedUserId, {
        title: "Premium ended",
        body: "Your Premium subscription has ended. Your free Basic listing stays live.",
        data: { type: "subscription_update", status: "cancelled" },
      }).catch(() => {});
    }
  }
}

// Revoke Premium perks for a non-Stripe (RevenueCat / demo) subscriber and mark
// the row ended. Mirrors the EXPIRATION webhook's revoke branch so the read-time
// expiry guard and the focus/restore sync path converge on the same end state:
// the verified free listing stays live, only the paid perks are removed.
// NEVER call this for a Stripe-owned row — web Stripe is the source of truth.
async function downgradeExpiredSubscription(userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ plan: null })
      .where(eq(usersTable.id, userId));
    await tx
      .update(traderProfilesTable)
      .set({ plan: null, isFeatured: false, updatedAt: new Date() })
      .where(eq(traderProfilesTable.userId, userId));
    await tx
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, userId));
  });
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

// Constant-time comparison of the webhook Authorization header against the
// configured shared secret, avoiding length/timing leaks.
function authHeaderMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// POST /api/webhooks/revenuecat — Apple (RevenueCat) subscription lifecycle.
// RevenueCat owns native iOS In-App Purchases; this endpoint enforces expiry
// and cancellation server-side (the /revenuecat-sync endpoint only ever grants).
// Authenticated via a shared secret sent in the Authorization header, which is
// configured in the RevenueCat dashboard. Losing Premium NEVER unlists a
// verified trader or logs them out — it only removes the paid perks.
router.post("/webhooks/revenuecat", async (req, res) => {
  try {
    const authSecret = process.env.REVENUECAT_WEBHOOK_AUTH;
    if (!authSecret) {
      req.log.warn("REVENUECAT_WEBHOOK_AUTH not set, rejecting webhook");
      res.status(403).json({ error: "Webhook endpoint not configured" });
      return;
    }

    const provided = req.headers["authorization"];
    if (typeof provided !== "string" || !authHeaderMatches(provided, authSecret)) {
      res.status(401).json({ error: "Invalid webhook authorization" });
      return;
    }

    const raw = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});
    let payload: { event?: Record<string, unknown> };
    try {
      payload = JSON.parse(raw);
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    const event = (payload?.event ?? {}) as Record<string, unknown>;
    const type = String(event.type ?? "");

    // Only enforce events that concern our trader entitlement. Some event types
    // omit entitlement ids; when present and non-matching, acknowledge and skip.
    const entitlementIds: string[] = Array.isArray(event.entitlement_ids)
      ? (event.entitlement_ids as string[])
      : event.entitlement_id
        ? [String(event.entitlement_id)]
        : [];
    if (entitlementIds.length > 0) {
      const wanted = normalizeEntitlementKey(REVENUECAT_ENTITLEMENT_ID);
      const matches = entitlementIds.some(
        (e) => normalizeEntitlementKey(String(e)) === wanted,
      );
      if (!matches) {
        res.json({ success: true, ignored: "entitlement" });
        return;
      }
    }

    const grant =
      type === "INITIAL_PURCHASE" ||
      type === "RENEWAL" ||
      type === "PRODUCT_CHANGE" ||
      type === "UNCANCELLATION";
    const scheduleCancel = type === "CANCELLATION";
    const revoke = type === "EXPIRATION" || type === "SUBSCRIPTION_PAUSED";

    // TEST pings, BILLING_ISSUE, TRANSFER, etc. — nothing to enforce.
    if (!grant && !scheduleCancel && !revoke) {
      res.json({ success: true, ignored: "type" });
      return;
    }

    // app_user_id is our numeric user id (set via RevenueCat logIn). Anonymous
    // ids ("$RCAnonymousID:...") cannot be mapped to an account — ack and skip.
    const appUserId = String(event.app_user_id ?? event.original_app_user_id ?? "");
    const userId = Number(appUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.json({ success: true, ignored: "anonymous" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      res.json({ success: true, ignored: "unknown_user" });
      return;
    }

    const expiresAtMs = Number(event.expiration_at_ms);
    const periodEnd =
      Number.isFinite(expiresAtMs) && expiresAtMs > 0
        ? new Date(expiresAtMs)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Original-purchase anchor for cooling-off. Prefer the event's purchase
    // timestamp (accurate for INITIAL_PURCHASE); set once and never reset on a
    // RENEWAL — an existing anchor always wins.
    const purchasedAtMs = Number(event.purchased_at_ms);
    const originalAnchor =
      Number.isFinite(purchasedAtMs) && purchasedAtMs > 0
        ? new Date(purchasedAtMs)
        : new Date();

    let stripeOwned = false;
    let applied = false;
    let newlyActivated = false;
    let newlyCancelled = false;

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
        .limit(1);

      // Never let an Apple (RevenueCat) event mutate a Stripe-owned row — web
      // Stripe is the source of truth for those subscribers.
      stripeOwned =
        !!existing && (!!existing.stripeSubscriptionId || !!existing.stripeCustomerId);
      if (stripeOwned) return;

      if (grant) {
        // Notify only on a real inactive -> active transition (skip renewals).
        newlyActivated = !existing || existing.status !== "active";
        if (existing) {
          await tx
            .update(subscriptionsTable)
            .set({
              status: "active",
              planId: RC_PLAN_ID,
              currentPeriodStart: new Date(),
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: false,
              originalPurchaseAt: existing.originalPurchaseAt ?? originalAnchor,
              updatedAt: new Date(),
            })
            .where(eq(subscriptionsTable.userId, userId));
        } else {
          await tx.insert(subscriptionsTable).values({
            userId,
            planId: RC_PLAN_ID,
            status: "active",
            currentPeriodStart: new Date(),
            currentPeriodEnd: periodEnd,
            originalPurchaseAt: originalAnchor,
          });
        }
        await tx
          .update(usersTable)
          .set({ plan: RC_PLAN_ID })
          .where(eq(usersTable.id, userId));
        await tx
          .update(traderProfilesTable)
          .set({ plan: RC_PLAN_ID, isFeatured: true, updatedAt: new Date() })
          .where(eq(traderProfilesTable.userId, userId));
        applied = true;
      } else if (scheduleCancel) {
        // Auto-renew turned off; Premium continues until expiry. Keep perks.
        if (existing) {
          await tx
            .update(subscriptionsTable)
            .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
            .where(eq(subscriptionsTable.userId, userId));
          applied = true;
        }
      } else if (revoke) {
        // Notify only on a real active -> cancelled transition (skip repeats).
        newlyCancelled = !!existing && existing.status === "active";
        // Access ended — remove Premium perks. The free verified listing stays
        // live and the trader stays logged in.
        await tx
          .update(usersTable)
          .set({ plan: null })
          .where(eq(usersTable.id, userId));
        await tx
          .update(traderProfilesTable)
          .set({ plan: null, isFeatured: false, updatedAt: new Date() })
          .where(eq(traderProfilesTable.userId, userId));
        if (existing) {
          await tx
            .update(subscriptionsTable)
            .set({ status: "cancelled", cancelAtPeriodEnd: false, updatedAt: new Date() })
            .where(eq(subscriptionsTable.userId, userId));
        }
        applied = true;
      }
    });

    if (applied && !stripeOwned) {
      await logAudit({
        userId,
        action: grant ? "SUBSCRIPTION_ACTIVATED" : "SUBSCRIPTION_CANCELLED",
        details: { source: "revenuecat-webhook", type },
      });
      if (newlyActivated) {
        void sendPushToUser(userId, {
          title: "Premium active",
          body: "Your Premium subscription is now active. Your premium perks are live.",
          data: { type: "subscription_update", status: "active" },
        }).catch((err) => req.log.warn({ err }, "Failed to send subscription-activated push"));
      } else if (newlyCancelled) {
        void sendPushToUser(userId, {
          title: "Premium ended",
          body: "Your Premium subscription has ended. Your free Basic listing stays live.",
          data: { type: "subscription_update", status: "cancelled" },
        }).catch((err) => req.log.warn({ err }, "Failed to send subscription-ended push"));
      }
    }

    res.json({ success: true, type, applied, stripeOwned });
  } catch (error) {
    req.log.error({ err: error }, "RevenueCat webhook failed");
    res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
});

export default router;
