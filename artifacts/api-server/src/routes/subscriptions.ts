import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, traderProfilesTable, subscriptionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware, traderOnly } from "../lib/auth";
import { CreateCheckoutSessionBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";

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

    if (!["basic", "premium", "elite"].includes(planId)) {
      res.status(400).json({ error: "Invalid plan selected" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (IS_DEMO_MODE) {
      const demoSessionId = "demo_session_" + Date.now();
      const demoCustomerId = user.stripeCustomerId || "demo_cus_" + userId;

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
      });

      res.json({
        sessionId: demoSessionId,
        url: "DEMO_MODE",
        demoActivationUrl: `/api/subscriptions/demo-activate?sessionId=${demoSessionId}&planId=${planId}`,
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
    if (!IS_DEMO_MODE) {
      res.status(403).json({ error: "Demo activation is not available in production" });
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

    res.json({ success: true, plan: planId, status: "active" });
  } catch (error) {
    req.log.error({ err: error }, "Demo activation failed");
    res.status(500).json({ error: "Demo activation failed" });
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

    res.json({
      plan: user.plan,
      status: user.isActive ? "active" : "inactive",
      currentPeriodEnd: sub?.currentPeriodEnd || null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd || false,
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
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.stripeCustomerId, customerId))
      .limit(1);

    if (!user) return;

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

    if (existingSub.length > 0) {
      await tx
        .update(subscriptionsTable)
        .set({
          status: "active",
          planId: planId || existingSub[0].planId,
          stripeSubscriptionId: subscriptionId,
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
}

async function deactivateSubscription(customerId: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.stripeCustomerId, customerId))
      .limit(1);

    if (!user) return;

    await tx
      .update(usersTable)
      .set({ isActive: false, plan: null })
      .where(eq(usersTable.id, user.id));

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
      .set({ status: "canceled", updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, user.id));
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

export default router;
