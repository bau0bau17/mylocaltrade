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
  revenuecatEventsTable,
  PLAN_PRICING_GBP,
  PLAN_CURRENCY,
} from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authMiddleware, traderOnly } from "../lib/auth";
import { companyOwnerGate } from "../lib/company-membership";
import { reconcileCompanySeats } from "../lib/team-billing";
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
import {
  getOrCreateRevenueCatId,
  isAnonymousRevenueCatId,
  resolveRevenueCatAppUserId,
} from "../lib/revenuecat-identity";
import {
  downgradeExpiredSubscription,
  reconcileRevenueCatEntitlement,
} from "../lib/revenuecat-reconciliation";

const router: IRouter = Router();

// Company Teams: every billing surface is owner-only. Invited employees
// (role=trader, no owned profile) were previously blocked only incidentally —
// missing profile/subscription rows — which leaked generic errors instead of
// an explicit refusal, and GET /status wasn't blocked at all. The gate makes
// the rule explicit and future-proof: employees get 403 OWNER_ONLY on every
// subscription route, including via deep links. GET /plans stays public
// (static marketing data).
const subscriptionsOwnerGate = companyOwnerGate("subscriptions");

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

router.get("/subscriptions/plans", (_req, res) => {
  res.json({ plans: PLANS });
});

// POST /api/subscriptions/demo-activate — development-only Premium demo
// activation. Live billing is Apple In-App Purchase via RevenueCat; this
// endpoint exists so local/dev environments (no App Store available) can flip
// a verified trader to Premium for testing. It writes a plain local
// subscription row — no external billing provider is involved.
router.post("/subscriptions/demo-activate", authMiddleware, traderOnly, subscriptionsOwnerGate, async (req, res) => {
  try {
    // Hard-block in production so this endpoint can never bypass payments.
    // Returns 404 to avoid leaking the existence of the demo path to live
    // clients. Evaluated per-request so tests can exercise the gate.
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const { userId } = req as AuthenticatedRequest;

    const body = z
      .object({
        planId: z.enum(["basic", "premium"]),
        promoCode: z.string().trim().min(1).max(50).optional(),
      })
      .parse(req.body ?? {});
    const planId = body.planId;

    // Mirror the live purchase gate: only verified traders may subscribe.
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile || profile.verificationStatus !== TRADER_STATUS.VERIFIED) {
      res.status(403).json({ error: "Your account must be verified before you can subscribe." });
      return;
    }

    // Optional promo claim happens inside the same transaction as the
    // activation so slot accounting stays consistent. Wrapper object keeps
    // TypeScript's control-flow analysis from narrowing the `let` to null
    // after the closure.
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

    await db
      .transaction(async (tx) => {
        const [existingSub] = await tx
          .select()
          .from(subscriptionsTable)
          .where(eq(subscriptionsTable.userId, userId))
          .limit(1);

        if (existingSub) {
          await tx
            .update(subscriptionsTable)
            .set({
              status: "active",
              planId,
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              cancelAtPeriodEnd: false,
              // Anchor the cooling-off window on the first purchase only;
              // never reset it on re-activation.
              originalPurchaseAt: existingSub.originalPurchaseAt ?? new Date(),
              updatedAt: new Date(),
            })
            .where(eq(subscriptionsTable.userId, userId));
        } else {
          await tx.insert(subscriptionsTable).values({
            userId,
            planId,
            status: "active",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            originalPurchaseAt: new Date(),
          });
        }

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

        if (body.promoCode) {
          const result = await claimPromoForUser(tx as unknown as typeof db, {
            userId,
            code: body.promoCode,
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
      })
      .catch((err) => {
        if (err instanceof Error && err.message === "PROMO_FAILED") return;
        throw err;
      });

    if (promoErrorMsg) {
      res.status(promoErrorStatus || 400).json({ error: promoErrorMsg });
      return;
    }

    await logAudit({ userId, action: "SUBSCRIPTION_ACTIVATED", details: { plan: planId, demo: true } });
    await logAudit({ userId, action: "PROFILE_WENT_LIVE", details: { plan: planId } });

    res.json({ success: true, plan: planId, status: "active", promo: promoState.result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid plan" });
      return;
    }
    req.log.error({ err: error }, "Demo activation failed");
    res.status(500).json({ error: "Demo activation failed" });
  }
});


// POST /api/subscriptions/revenuecat-sync — verify the trader's RevenueCat
// entitlement (Apple In-App Purchase on iOS) and, if active, take the profile
// live. This path only ever GRANTS based on a valid RevenueCat entitlement;
// the destructive downgrade happens once RevenueCat confirms the entitlement
// is gone (self-heal below) or via the EXPIRATION webhook.
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

router.post("/subscriptions/revenuecat-sync", authMiddleware, traderOnly, subscriptionsOwnerGate, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const rawWillRenew = (req.body as { willRenew?: unknown } | undefined)?.willRenew;
    const willRenew = typeof rawWillRenew === "boolean" ? rawWillRenew : undefined;
    const outcome = await reconcileRevenueCatEntitlement(userId, req.log, willRenew);

    if (outcome.status === "not_configured") {
      res.status(503).json({ error: "In-app purchases are not configured yet." });
      return;
    }
    if (outcome.status === "user_not_found") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (outcome.status === "not_verified") {
      res.status(403).json({ error: "Your account must be verified before you can subscribe." });
      return;
    }
    if (outcome.status === "provider_error") {
      res.status(502).json({ error: "Could not verify your subscription. Please try again." });
      return;
    }
    res.json({
      active: outcome.active,
      ...(outcome.active
        ? {
            plan: "premium",
            productId: outcome.productId,
            currentPeriodEnd: outcome.currentPeriodEnd,
          }
        : {}),
    });
  } catch (error) {
    req.log.error({ err: error }, "RevenueCat sync failed");
    res.status(500).json({ error: "Failed to sync subscription" });
  }
});

// POST /api/subscriptions/cancel — schedule cancellation at period end on the
// LOCAL record only. Apple-managed subscriptions are cancelled with Apple (the
// app hands off to the App Store); RevenueCat's CANCELLATION webhook mirrors
// that into the same cancelAtPeriodEnd flag. This endpoint serves demo subs.
router.post("/subscriptions/cancel", authMiddleware, traderOnly, subscriptionsOwnerGate, async (req, res) => {
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
router.post("/subscriptions/resume", authMiddleware, traderOnly, subscriptionsOwnerGate, async (req, res) => {
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

router.get("/subscriptions/status", authMiddleware, subscriptionsOwnerGate, async (req, res) => {
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
    // RevenueCat sandbox / Apple Test Store. So we honour the paid period at
    // read time: once currentPeriodEnd has passed the trader is no longer
    // Premium, regardless of the stored status string. This is what makes the
    // in-app Billing & Plan screen match Apple exactly.
    const periodEndMs = sub?.currentPeriodEnd
      ? sub.currentPeriodEnd.getTime()
      : null;
    const periodLapsed =
      !!sub && periodEndMs != null && periodEndMs <= Date.now();

    // Read-only cooling-off snapshot. Anchored on the FIRST purchase date
    // (never reset by renewals); falls back to createdAt for rows predating the
    // dedicated column. This only REPORTS eligibility — it never affects perks,
    // verification, listing or featured status, and never issues refunds.
    const coolingOff = getCoolingOffState(
      sub ? sub.originalPurchaseAt ?? sub.createdAt : null,
    );
    const coolingOffProvider = !sub ? null : ("apple" as const);

    // IMPORTANT: this read path only REPORTS the effective (non-Premium) state
    // when the paid period has lapsed — it deliberately does NOT mutate the DB.
    // The destructive downgrade (revoking perks: plan, featured badge, ranking)
    // is performed only once the entitlement is confirmed gone provider-side,
    // via POST /subscriptions/revenuecat-sync (the app calls it on focus and on
    // "Restore purchases") and the EXPIRATION webhook. Revoking here on the date
    // alone would risk falsely downgrading a subscription that is still active
    // during an Apple billing-grace window whose extended expiry we simply
    // haven't re-synced yet.

    if (sub) {
      // RevenueCat / demo. Premium only while the row is active AND the paid
      // period has not lapsed; a lapsed sub reports as expired/Basic.
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
// cancels the subscription, NEVER issues an Apple refund, and NEVER
// touches plan, perks, verification, listing or featured status. Apple-owned
// subscriptions are cancelled/refunded by Apple; the app only hands off and
// records the request so support can assist.
router.post(
  "/subscriptions/cancellation-request",
  authMiddleware,
  traderOnly,
  subscriptionsOwnerGate,
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

      // All live subscriptions are Apple-owned (RevenueCat / App Store).
      const provider = "apple" as const;
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
    // Payment failed but access continues (Apple grace/retry period). We only
    // RECORD it — revocation stays EXPIRATION's job, exactly per Apple's own
    // grace handling. The flag powers "check your payment method" messaging.
    const billingIssue = type === "BILLING_ISSUE";

    // TEST pings, TRANSFER, etc. — nothing to enforce.
    if (!grant && !scheduleCancel && !revoke && !billingIssue) {
      res.json({ success: true, ignored: "type" });
      return;
    }

    // Resolve the RevenueCat identity to a local account. Accepted forms:
    //   1. Canonical "rc_<32hex>" (users.revenuecat_id) — server-generated,
    //      opaque, set via Purchases.logIn from an authenticated response.
    //   2. DOCUMENTED MIGRATION ALIAS: all-digits numeric users.id — the
    //      pre-hardening App User ID, which also survives forever as
    //      original_app_user_id on transferred receipts.
    // Anonymous SDK ids ("$RCAnonymousID:...") cannot be mapped — ack and
    // skip, as before. Everything else FAILS CLOSED: no state mutation, a
    // 2xx ack (RevenueCat retries non-2xx indefinitely) and a structured
    // integrity alert in the logs for monitoring.
    const candidates = [event.app_user_id, event.original_app_user_id]
      .map((v) => (v == null ? "" : String(v)))
      .filter((v) => v.length > 0);
    let resolved: { userId: number; legacyAlias: boolean } | null = null;
    let resolvedAppUserId: string | null = null;
    let sawNonAnonymous = false;
    for (const candidate of candidates) {
      if (isAnonymousRevenueCatId(candidate)) continue;
      sawNonAnonymous = true;
      resolved = await resolveRevenueCatAppUserId(candidate);
      if (resolved) {
        resolvedAppUserId = candidate;
        break;
      }
    }
    if (!resolved || !resolvedAppUserId) {
      if (!sawNonAnonymous) {
        res.json({ success: true, ignored: "anonymous" });
        return;
      }
      req.log.error(
        {
          integrity: "revenuecat_webhook_unknown_app_user_id",
          eventId: typeof event.id === "string" ? event.id : null,
          eventType: type,
          // Truncated on purpose — enough to investigate, never a full
          // identity string or token.
          appUserIdPrefix: candidates[0]?.slice(0, 8) ?? null,
        },
        "RevenueCat webhook addressed an unknown app_user_id — failing closed",
      );
      res.json({ success: true, ignored: "unknown_app_user_id" });
      return;
    }
    const userId = resolved.userId;
    const appUserId = resolvedAppUserId;
    if (resolved.legacyAlias) {
      req.log.info(
        { userId, eventType: type },
        "RevenueCat webhook resolved via legacy numeric alias (pre-hardening customer)",
      );
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      // Unreachable in practice (the resolver just matched this id) unless
      // the row vanished in a race; treat as the same integrity condition.
      req.log.error(
        { integrity: "revenuecat_webhook_unknown_app_user_id", eventType: type },
        "RevenueCat webhook user row disappeared during resolution — failing closed",
      );
      res.json({ success: true, ignored: "unknown_app_user_id" });
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

    let applied = false;
    let newlyActivated = false;
    let newlyCancelled = false;
    let duplicate = false;
    let outOfOrder = false;
    let billingIssueRecorded = false;

    // Store product that triggered this event — persisted on grants so the
    // team tier can be derived server-side (PRODUCT_CHANGE updates it too).
    const eventProductId =
      typeof event.product_id === "string" && event.product_id.length > 0
        ? event.product_id
        : null;

    // RevenueCat event id (UUID) — the idempotency key — and the event's own
    // timestamp — the ordering authority (arrival order is meaningless under
    // retries).
    const eventId = typeof event.id === "string" && event.id.length > 0 ? event.id : null;
    const eventTsRaw = Number(event.event_timestamp_ms);
    const eventTsMs = Number.isFinite(eventTsRaw) && eventTsRaw > 0 ? eventTsRaw : null;

    await db.transaction(async (tx) => {
      // Idempotency: record the event id IN THE SAME TRANSACTION as the
      // mutation. A redelivery hits the unique index and is skipped; a crash
      // mid-processing rolls the ledger row back too, so the retry genuinely
      // reprocesses. Events without an id (never seen in practice) process
      // without dedupe rather than being dropped.
      if (eventId) {
        const inserted = await tx
          .insert(revenuecatEventsTable)
          .values({
            eventId,
            eventType: type,
            appUserId,
            productId: eventProductId,
            eventTimestampMs: eventTsMs,
          })
          .onConflictDoNothing({ target: revenuecatEventsTable.eventId })
          .returning({ id: revenuecatEventsTable.id });
        if (inserted.length === 0) {
          duplicate = true;
          return;
        }
      }

      const [existing] = await tx
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, userId))
        .limit(1);

      // Out-of-order guard: a delayed event older than the newest one already
      // applied must not mutate state (e.g. a late EXPIRATION arriving after
      // a newer re-subscribe grant would otherwise destroy it). The ledger
      // row above still commits, so the stale event is consumed for good.
      //
      // Equal-timestamp policy (deterministic — do not let arrival order pick
      // the final state): at an exact provider-timestamp tie, only a REVOKE
      // may apply; every non-revoke event at the tied timestamp is skipped.
      // Both delivery orders of a tied grant+revoke pair therefore converge
      // on "revoked" — the fail-safe state — and a genuinely active
      // entitlement self-heals on the next device sync, which reads live
      // RevenueCat state.
      if (
        existing &&
        eventTsMs !== null &&
        existing.lastProviderEventAtMs !== null &&
        (eventTsMs < existing.lastProviderEventAtMs ||
          (eventTsMs === existing.lastProviderEventAtMs && !revoke))
      ) {
        outOfOrder = true;
        return;
      }
      const eventClockPatch = eventTsMs !== null ? { lastProviderEventAtMs: eventTsMs } : {};

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
              productIdentifier: eventProductId ?? existing.productIdentifier ?? null,
              // A successful grant supersedes any earlier payment trouble.
              billingIssueDetectedAt: null,
              ...eventClockPatch,
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
            productIdentifier: eventProductId,
            lastProviderEventAtMs: eventTsMs,
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
            .set({ cancelAtPeriodEnd: true, ...eventClockPatch, updatedAt: new Date() })
            .where(eq(subscriptionsTable.userId, userId));
          applied = true;
        }
      } else if (billingIssue) {
        // Record only — no perk/status change, no push. Cleared by the next
        // successful grant (or when expiry finally revokes).
        if (existing) {
          await tx
            .update(subscriptionsTable)
            .set({
              billingIssueDetectedAt: eventTsMs !== null ? new Date(eventTsMs) : new Date(),
              ...eventClockPatch,
              updatedAt: new Date(),
            })
            .where(eq(subscriptionsTable.userId, userId));
          billingIssueRecorded = true;
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
            .set({
              status: "cancelled",
              cancelAtPeriodEnd: false,
              billingIssueDetectedAt: null,
              ...eventClockPatch,
              updatedAt: new Date(),
            })
            .where(eq(subscriptionsTable.userId, userId));
        }
        applied = true;
      }
    });

    if (duplicate) {
      res.json({ success: true, ignored: "duplicate" });
      return;
    }
    if (outOfOrder) {
      req.log.info(
        { type, userId, eventTsMs },
        "revenuecat webhook event arrived out of order — skipped",
      );
      res.json({ success: true, ignored: "out_of_order" });
      return;
    }

    // Seat allowance may have changed (grant/product change/expiry) — bring
    // seated employees in line. Post-commit and best-effort: a reconciliation
    // hiccup must not fail the webhook ack (the next lifecycle event or owner
    // action reconciles again).
    if (applied && (grant || revoke)) {
      try {
        const [ownerProfile] = await db
          .select({ id: traderProfilesTable.id })
          .from(traderProfilesTable)
          .where(eq(traderProfilesTable.userId, userId))
          .limit(1);
        if (ownerProfile) {
          await reconcileCompanySeats(ownerProfile.id, `webhook:${type}`);
        }
      } catch (err) {
        req.log.error({ err }, "seat reconciliation after webhook failed");
      }
    }

    if (applied) {
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

    res.json({ success: true, type, applied: applied || billingIssueRecorded });
  } catch (error) {
    req.log.error({ err: error }, "RevenueCat webhook failed");
    res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
});

export default router;
