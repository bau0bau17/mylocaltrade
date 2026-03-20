import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, traderProfilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authMiddleware, traderOnly } from "../lib/auth";
import { CreateCheckoutSessionBody } from "@workspace/api-zod";

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
    const userId = (req as any).userId;
    const body = CreateCheckoutSessionBody.parse(req.body);
    const planId = body.planId;

    if (!["basic", "premium", "elite"].includes(planId)) {
      res.status(400).json({ error: "Invalid plan selected" });
      return;
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      await db
        .update(usersTable)
        .set({ plan: planId, isActive: true })
        .where(eq(usersTable.id, userId));

      await db
        .update(traderProfilesTable)
        .set({
          plan: planId,
          isActive: true,
          isFeatured: planId === "elite",
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, userId));

      res.json({
        sessionId: "demo_session_" + Date.now(),
        url: "DEMO_MODE_ACTIVATED",
      });
      return;
    }

    res.json({
      sessionId: "stripe_session_placeholder",
      url: "https://checkout.stripe.com/placeholder",
    });
  } catch (error: any) {
    req.log.error({ err: error }, "Create checkout failed");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.get("/subscriptions/status", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
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
  } catch (error: any) {
    req.log.error({ err: error }, "Get subscription status failed");
    res.status(500).json({ error: "Failed to get subscription status" });
  }
});

router.post("/webhooks/stripe", async (req, res) => {
  try {
    const event = req.body;
    const eventType = event?.type;

    switch (eventType) {
      case "checkout.session.completed": {
        const session = event.data?.object;
        const customerId = session?.customer;
        const subscriptionId = session?.subscription;

        if (customerId) {
          await db
            .update(usersTable)
            .set({
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              isActive: true,
            })
            .where(eq(usersTable.stripeCustomerId, customerId));
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data?.object;
        const customerId = subscription?.customer;

        if (customerId) {
          await db
            .update(usersTable)
            .set({ isActive: false, plan: null })
            .where(eq(usersTable.stripeCustomerId, customerId));
        }
        break;
      }
    }

    res.json({ success: true, message: "Webhook processed" });
  } catch (error: any) {
    req.log.error({ err: error }, "Stripe webhook failed");
    res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
});

export default router;
