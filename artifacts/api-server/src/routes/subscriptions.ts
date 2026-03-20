import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, traderProfilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware, traderOnly } from "../lib/auth";
import { CreateCheckoutSessionBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";

const router: IRouter = Router();

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

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      const demoSessionId = "demo_session_" + Date.now();
      const demoCustomerId = "demo_cus_" + userId;

      await db.transaction(async (tx) => {
        await tx
          .update(usersTable)
          .set({ stripeCustomerId: demoCustomerId, stripeSubscriptionId: demoSessionId })
          .where(eq(usersTable.id, userId));
      });

      res.json({
        sessionId: demoSessionId,
        url: "DEMO_MODE",
        demoActivationUrl: `/api/subscriptions/demo-activate?sessionId=${demoSessionId}&planId=${planId}`,
      });
      return;
    }

    res.json({
      sessionId: "stripe_session_placeholder",
      url: "https://checkout.stripe.com/placeholder",
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

router.get("/subscriptions/status", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      plan: user.plan,
      status: user.isActive ? "active" : "inactive",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  } catch (error) {
    req.log.error({ err: error }, "Get subscription status failed");
    res.status(500).json({ error: "Failed to get subscription status" });
  }
});

function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const timestamp = signature.split(",").find((s) => s.startsWith("t="))?.slice(2);
  const v1Sig = signature.split(",").find((s) => s.startsWith("v1="))?.slice(3);
  if (!timestamp || !v1Sig) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(v1Sig), Buffer.from(expectedSig));
}

async function activateSubscription(customerId: string, planId: string | null, subscriptionId: string | null) {
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        isActive: true,
        plan: planId,
      })
      .where(eq(usersTable.stripeCustomerId, customerId));

    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.stripeCustomerId, customerId))
      .limit(1);

    if (user) {
      await tx
        .update(traderProfilesTable)
        .set({
          plan: planId,
          isActive: true,
          isFeatured: planId === "elite",
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, user.id));
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

    await tx
      .update(usersTable)
      .set({ isActive: false, plan: null })
      .where(eq(usersTable.stripeCustomerId, customerId));

    if (user) {
      await tx
        .update(traderProfilesTable)
        .set({
          plan: null,
          isActive: false,
          isFeatured: false,
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, user.id));
    }
  });
}

router.post("/subscriptions/demo-activate", authMiddleware, traderOnly, async (req, res) => {
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      res.status(403).json({ error: "Demo activation is disabled when Stripe is configured" });
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

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user || user.stripeSubscriptionId !== sessionId) {
      res.status(400).json({ error: "Invalid session for this user" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ plan: planId, isActive: true })
        .where(eq(usersTable.id, userId));

      await tx
        .update(traderProfilesTable)
        .set({
          plan: planId,
          isActive: true,
          isFeatured: planId === "elite",
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

    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    const event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
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
