import {
  describe,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
  vi,
  type Mock,
} from "vitest";
import request from "supertest";

// Mock outbound RevenueCat API calls and push notifications BEFORE importing
// anything that pulls them in. These tests pin the Apple/RevenueCat Premium
// flow: /subscriptions/revenuecat-sync (grant path) and /webhooks/revenuecat
// (expiry enforcement) — no real network calls may fire.
vi.mock("../lib/revenueCatClient", () => ({
  getUncachableRevenueCatClient: vi.fn(async () => ({}) as unknown),
}));
vi.mock("@replit/revenuecat-sdk", () => ({
  listEntitlements: vi.fn(),
  listCustomerActiveEntitlements: vi.fn(),
}));
vi.mock("../lib/push-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/push-notifications")>();
  return { ...actual, sendPushToUser: vi.fn(async () => true) };
});

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
import {
  listEntitlements,
  listCustomerActiveEntitlements,
} from "@replit/revenuecat-sdk";
import * as pushModule from "../lib/push-notifications";

/**
 * Route tests for the Apple (RevenueCat) subscription lifecycle:
 *
 *   POST /api/subscriptions/revenuecat-sync
 *     - no existing subscription row  -> creates an active row, grants perks,
 *       sends the activation push exactly once
 *     - already-active row            -> refreshes data, does NOT re-notify
 *     - inactive/expired row          -> re-activates and notifies again
 *
 *   POST /api/webhooks/revenuecat
 *     - bad/missing Authorization secret rejected (401 / 403 when unset)
 *     - EXPIRATION downgrades exactly once; redelivery sends no duplicate push
 */

const ENTITLEMENT_KEY =
  process.env.REVENUECAT_ENTITLEMENT_ID || "trader_subscription";
const ENTITLEMENT_OBJECT_ID = "entlTestRC117";

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `rc-sync+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];

const mockListEntitlements = listEntitlements as unknown as Mock;
const mockListActive = listCustomerActiveEntitlements as unknown as Mock;
const mockSendPush = pushModule.sendPushToUser as unknown as Mock;

function mockEntitlementCatalog() {
  mockListEntitlements.mockResolvedValue({
    data: {
      items: [
        {
          id: ENTITLEMENT_OBJECT_ID,
          lookup_key: ENTITLEMENT_KEY,
          display_name: "Trader Subscription",
        },
      ],
    },
  });
}

function mockActiveEntitlement(expiresAtMs: number | null = Date.now() + 30 * 24 * 60 * 60 * 1000) {
  mockListActive.mockResolvedValue({
    data: {
      items: [
        {
          entitlement_id: ENTITLEMENT_OBJECT_ID,
          expires_at: expiresAtMs,
          product_identifier: "premium_monthly",
        },
      ],
    },
    error: undefined,
  });
}

async function createVerifiedTrader(label: string): Promise<{ id: number; token: string }> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(label),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `RC Sync ${label}`,
      role: "trader",
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  await db.insert(traderProfilesTable).values({
    userId: u.id,
    businessName: `RC Sync Trades ${label} ${SUFFIX}`,
    contactName: `Trader ${label}`,
    email: emailFor(`profile-${label}`),
    phone: "+447000000002",
    mainCategory: `rc-sync-cat-${SUFFIX}`,
    town: "London",
    postcode: "SW1A 1AA",
    isActive: true,
    businessProfileCompleted: true,
    verificationStatus: "VERIFIED",
    revalidationOverdue: false,
  });
  return { id: u.id, token: generateToken(u.id, "trader", 1) };
}

// The push is fired void-and-forget; give the microtask queue a beat before
// asserting on the mock.
const settle = () => new Promise((r) => setTimeout(r, 25));

function activationPushes(userId: number) {
  return mockSendPush.mock.calls.filter(
    ([uid, msg]: [number, { data?: { status?: string } }]) =>
      uid === userId && msg?.data?.status === "active",
  );
}
function endedPushes(userId: number) {
  return mockSendPush.mock.calls.filter(
    ([uid, msg]: [number, { data?: { status?: string } }]) =>
      uid === userId && msg?.data?.status === "cancelled",
  );
}

const WEBHOOK_SECRET = `test-webhook-secret-${SUFFIX}`;
let originalWebhookAuth: string | undefined;

describe("RevenueCat subscription syncing", () => {
  beforeAll(async () => {
    originalWebhookAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
    process.env.REVENUECAT_WEBHOOK_AUTH = WEBHOOK_SECRET;
  });

  afterAll(async () => {
    if (originalWebhookAuth === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_AUTH;
    } else {
      process.env.REVENUECAT_WEBHOOK_AUTH = originalWebhookAuth;
    }
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

  beforeEach(() => {
    mockListEntitlements.mockReset();
    mockListActive.mockReset();
    mockSendPush.mockReset();
    mockSendPush.mockResolvedValue(true);
    mockEntitlementCatalog();
  });

  describe("POST /subscriptions/revenuecat-sync", () => {
    it("creates an active row, grants perks, and notifies exactly once when no row exists", async () => {
      const trader = await createVerifiedTrader("fresh");
      mockActiveEntitlement();

      const res = await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ active: true, plan: "premium" });
      expect(res.body.productId).toBe("premium_monthly");

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub).toBeDefined();
      expect(sub.status).toBe("active");
      expect(sub.planId).toBe("premium");
      expect(sub.cancelAtPeriodEnd).toBe(false);
      expect(sub.originalPurchaseAt).not.toBeNull();
      expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());

      const [user] = await db
        .select({ plan: usersTable.plan })
        .from(usersTable)
        .where(eq(usersTable.id, trader.id))
        .limit(1);
      expect(user.plan).toBe("premium");

      const [profile] = await db
        .select({
          plan: traderProfilesTable.plan,
          isFeatured: traderProfilesTable.isFeatured,
        })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, trader.id))
        .limit(1);
      expect(profile.plan).toBe("premium");
      expect(profile.isFeatured).toBe(true);

      // "Went live" notifications exactly once.
      expect(activationPushes(trader.id)).toHaveLength(1);

      const audits = await db
        .select()
        .from(traderAuditLogTable)
        .where(eq(traderAuditLogTable.userId, trader.id));
      expect(
        audits.filter((a) => a.action === "SUBSCRIPTION_ACTIVATED"),
      ).toHaveLength(1);
      expect(audits.some((a) => a.action === "PROFILE_WENT_LIVE")).toBe(true);
    });

    it("refreshes an already-active row without re-sending activation notifications", async () => {
      const trader = await createVerifiedTrader("active");
      mockActiveEntitlement();

      // First sync activates and notifies.
      await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();
      expect(activationPushes(trader.id)).toHaveLength(1);

      const [before] = await db
        .select({ originalPurchaseAt: subscriptionsTable.originalPurchaseAt })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);

      // Routine focus/restore re-sync: refresh data, no duplicate push.
      const res = await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();

      expect(res.status).toBe(200);
      expect(res.body.active).toBe(true);
      expect(activationPushes(trader.id)).toHaveLength(1);

      // First-purchase cooling-off anchor is never reset by re-syncs.
      const [after] = await db
        .select({
          originalPurchaseAt: subscriptionsTable.originalPurchaseAt,
          status: subscriptionsTable.status,
        })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(after.status).toBe("active");
      expect(after.originalPurchaseAt!.getTime()).toBe(
        before.originalPurchaseAt!.getTime(),
      );
    });

    it("re-activates an inactive/expired row and notifies again", async () => {
      const trader = await createVerifiedTrader("expired");
      // Seed a lapsed subscription row (downgraded perks).
      await db.insert(subscriptionsTable).values({
        userId: trader.id,
        planId: "premium",
        status: "cancelled",
        currentPeriodStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        originalPurchaseAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      });
      mockActiveEntitlement();

      const res = await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();

      expect(res.status).toBe(200);
      expect(res.body.active).toBe(true);

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.status).toBe("active");
      expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());

      const [profile] = await db
        .select({ isFeatured: traderProfilesTable.isFeatured })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, trader.id))
        .limit(1);
      expect(profile.isFeatured).toBe(true);

      // Genuine inactive -> active transition notifies again (exactly once).
      expect(activationPushes(trader.id)).toHaveLength(1);
    });

    it("self-heals: downgrades a locally-active row when RevenueCat reports no entitlement", async () => {
      const trader = await createVerifiedTrader("selfheal");
      mockActiveEntitlement();
      await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();
      mockSendPush.mockClear();

      // RevenueCat now reports no active entitlement.
      mockListActive.mockResolvedValue({ data: { items: [] }, error: undefined });

      const res = await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ active: false });

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.status).toBe("cancelled");

      const [profile] = await db
        .select({
          plan: traderProfilesTable.plan,
          isFeatured: traderProfilesTable.isFeatured,
          isActive: traderProfilesTable.isActive,
        })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, trader.id))
        .limit(1);
      expect(profile.plan).toBeNull();
      expect(profile.isFeatured).toBe(false);
      expect(profile.isActive).toBe(true);

      expect(endedPushes(trader.id)).toHaveLength(1);

      // A repeat sync with no entitlement stays quiet (row already inactive).
      await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();
      expect(endedPushes(trader.id)).toHaveLength(1);
    });
  });

  describe("POST /webhooks/revenuecat", () => {
    it("rejects a missing Authorization header with 401", async () => {
      const res = await request(app)
        .post("/api/webhooks/revenuecat")
        .send({ event: { type: "TEST" } });
      expect(res.status).toBe(401);
    });

    it("rejects a wrong Authorization secret with 401 and applies nothing", async () => {
      const trader = await createVerifiedTrader("wh-badauth");
      const res = await request(app)
        .post("/api/webhooks/revenuecat")
        .set("Authorization", "wrong-secret")
        .send({
          event: { type: "EXPIRATION", app_user_id: String(trader.id) },
        });
      expect(res.status).toBe(401);

      const subs = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id));
      expect(subs).toHaveLength(0);
    });

    it("rejects with 403 when the webhook secret is not configured", async () => {
      delete process.env.REVENUECAT_WEBHOOK_AUTH;
      try {
        const res = await request(app)
          .post("/api/webhooks/revenuecat")
          .set("Authorization", WEBHOOK_SECRET)
          .send({ event: { type: "TEST" } });
        expect(res.status).toBe(403);
      } finally {
        process.env.REVENUECAT_WEBHOOK_AUTH = WEBHOOK_SECRET;
      }
    });

    it("EXPIRATION downgrades exactly once; redelivery sends no duplicate notification", async () => {
      const trader = await createVerifiedTrader("wh-expire");
      // Start from a live Premium subscriber (as revenuecat-sync would leave it).
      mockActiveEntitlement();
      await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();
      mockSendPush.mockClear();

      const event = {
        event: {
          type: "EXPIRATION",
          app_user_id: String(trader.id),
          entitlement_ids: [ENTITLEMENT_KEY],
          expiration_at_ms: Date.now(),
        },
      };

      const first = await request(app)
        .post("/api/webhooks/revenuecat")
        .set("Authorization", WEBHOOK_SECRET)
        .send(event);
      await settle();

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ success: true, applied: true });

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.status).toBe("cancelled");

      const [user] = await db
        .select({ plan: usersTable.plan })
        .from(usersTable)
        .where(eq(usersTable.id, trader.id))
        .limit(1);
      expect(user.plan).toBeNull();

      const [profile] = await db
        .select({
          plan: traderProfilesTable.plan,
          isFeatured: traderProfilesTable.isFeatured,
          isActive: traderProfilesTable.isActive,
        })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, trader.id))
        .limit(1);
      expect(profile.plan).toBeNull();
      expect(profile.isFeatured).toBe(false);
      // Losing Premium must never unlist a verified trader.
      expect(profile.isActive).toBe(true);

      expect(endedPushes(trader.id)).toHaveLength(1);

      // Webhook redelivery: idempotent, no duplicate "Premium ended" push.
      const second = await request(app)
        .post("/api/webhooks/revenuecat")
        .set("Authorization", WEBHOOK_SECRET)
        .send(event);
      await settle();

      expect(second.status).toBe(200);
      expect(endedPushes(trader.id)).toHaveLength(1);
    });

    it("acknowledges and skips events for other entitlements", async () => {
      const trader = await createVerifiedTrader("wh-other-entl");
      const res = await request(app)
        .post("/api/webhooks/revenuecat")
        .set("Authorization", WEBHOOK_SECRET)
        .send({
          event: {
            type: "EXPIRATION",
            app_user_id: String(trader.id),
            entitlement_ids: ["some_other_entitlement"],
          },
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, ignored: "entitlement" });
    });
  });
});
