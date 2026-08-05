import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";

import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  subscriptionsTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";

/**
 * Covers POST /api/subscriptions/demo-activate — the development-only demo
 * activation flow that replaced the removed Stripe checkout. Live billing is
 * Apple In-App Purchase via RevenueCat; this endpoint must:
 *   - be hard-blocked (404) in production,
 *   - require a VERIFIED trader,
 *   - activate a plain local subscription row (no Stripe columns written),
 *   - roll the whole transaction back when a promo claim fails.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `demo-act+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];

async function createUser(
  label: string,
  role: "customer" | "trader",
): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(label),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Demo Act ${label}`,
      role,
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function createTraderProfile(
  label: string,
  userId: number,
  overrides: Partial<typeof traderProfilesTable.$inferInsert> = {},
): Promise<void> {
  await db.insert(traderProfilesTable).values({
    userId,
    businessName: `Demo Act Trades ${label} ${SUFFIX}`,
    contactName: `Trader ${label}`,
    email: emailFor(`profile-${label}`),
    phone: "+447000000001",
    mainCategory: `demo-act-cat-${SUFFIX}`,
    town: "London",
    postcode: "SW1A 1AA",
    isActive: true,
    businessProfileCompleted: true,
    verificationStatus: "VERIFIED",
    revalidationOverdue: false,
    ...overrides,
  });
}

let verifiedTraderId: number;
let verifiedTraderToken: string;
let unverifiedTraderId: number;
let unverifiedTraderToken: string;
let promoTraderId: number;
let promoTraderToken: string;
let customerId: number;
let customerToken: string;

describe("POST /subscriptions/demo-activate", () => {
  beforeAll(async () => {
    verifiedTraderId = await createUser("verified", "trader");
    verifiedTraderToken = generateToken(verifiedTraderId, "trader", 1);
    await createTraderProfile("verified", verifiedTraderId);

    unverifiedTraderId = await createUser("unverified", "trader");
    unverifiedTraderToken = generateToken(unverifiedTraderId, "trader", 1);
    await createTraderProfile("unverified", unverifiedTraderId, {
      verificationStatus: "UNDER_REVIEW",
    });

    promoTraderId = await createUser("promo", "trader");
    promoTraderToken = generateToken(promoTraderId, "trader", 1);
    await createTraderProfile("promo", promoTraderId);

    customerId = await createUser("customer", "customer");
    customerToken = generateToken(customerId, "customer", 1);
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await db
        .delete(subscriptionsTable)
        .where(inArray(subscriptionsTable.userId, createdUserIds));
      await db
        .delete(traderAuditLogTable)
        .where(inArray(traderAuditLogTable.userId, createdUserIds));
      await db
        .delete(traderProfilesTable)
        .where(inArray(traderProfilesTable.userId, createdUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  });

  it("returns 404 when NODE_ENV=production (payment bypass hard-block)", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app)
        .post("/api/subscriptions/demo-activate")
        .set("Authorization", `Bearer ${verifiedTraderToken}`)
        .send({ planId: "premium" });
      expect(res.status).toBe(404);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("rejects customers (trader-only)", async () => {
    const res = await request(app)
      .post("/api/subscriptions/demo-activate")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ planId: "premium" });
    expect(res.status).toBe(403);
  });

  it("rejects traders who are not yet verified", async () => {
    const res = await request(app)
      .post("/api/subscriptions/demo-activate")
      .set("Authorization", `Bearer ${unverifiedTraderToken}`)
      .send({ planId: "premium" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verified/i);
  });

  it("rejects an invalid plan id with 400", async () => {
    const res = await request(app)
      .post("/api/subscriptions/demo-activate")
      .set("Authorization", `Bearer ${verifiedTraderToken}`)
      .send({ planId: "enterprise" });
    expect(res.status).toBe(400);
  });

  it("activates premium for a verified trader without touching Stripe columns", async () => {
    const res = await request(app)
      .post("/api/subscriptions/demo-activate")
      .set("Authorization", `Bearer ${verifiedTraderToken}`)
      .send({ planId: "premium" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      plan: "premium",
      status: "active",
      promo: null,
    });

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, verifiedTraderId))
      .limit(1);
    expect(sub).toBeDefined();
    expect(sub.status).toBe("active");
    expect(sub.planId).toBe("premium");
    expect(sub.cancelAtPeriodEnd).toBe(false);
    expect(sub.originalPurchaseAt).not.toBeNull();
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    // Legacy columns from the removed Stripe integration must stay untouched.
    expect(sub.stripeSubscriptionId).toBeNull();
    expect(sub.stripeCustomerId).toBeNull();

    const [user] = await db
      .select({ plan: usersTable.plan })
      .from(usersTable)
      .where(eq(usersTable.id, verifiedTraderId))
      .limit(1);
    expect(user.plan).toBe("premium");

    const [profile] = await db
      .select({
        plan: traderProfilesTable.plan,
        isFeatured: traderProfilesTable.isFeatured,
      })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, verifiedTraderId))
      .limit(1);
    expect(profile.plan).toBe("premium");
    expect(profile.isFeatured).toBe(true);

    const audits = await db
      .select()
      .from(traderAuditLogTable)
      .where(eq(traderAuditLogTable.userId, verifiedTraderId));
    const activation = audits.find((a) => a.action === "SUBSCRIPTION_ACTIVATED");
    expect(activation).toBeDefined();
    expect((activation!.details as { demo?: boolean }).demo).toBe(true);
  });

  it("re-activation preserves the original purchase anchor", async () => {
    const [before] = await db
      .select({ originalPurchaseAt: subscriptionsTable.originalPurchaseAt })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, verifiedTraderId))
      .limit(1);

    const res = await request(app)
      .post("/api/subscriptions/demo-activate")
      .set("Authorization", `Bearer ${verifiedTraderToken}`)
      .send({ planId: "premium" });
    expect(res.status).toBe(200);

    const [after] = await db
      .select({ originalPurchaseAt: subscriptionsTable.originalPurchaseAt })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, verifiedTraderId))
      .limit(1);
    expect(after.originalPurchaseAt!.getTime()).toBe(
      before.originalPurchaseAt!.getTime(),
    );
  });

  it("rolls back the whole activation when the promo claim fails", async () => {
    const res = await request(app)
      .post("/api/subscriptions/demo-activate")
      .set("Authorization", `Bearer ${promoTraderToken}`)
      .send({ planId: "premium", promoCode: `NO-SUCH-CODE-${SUFFIX}` });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBeTruthy();

    // Transaction aborted: no subscription row may exist for this trader.
    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, promoTraderId));
    expect(subs).toHaveLength(0);
  });
});
