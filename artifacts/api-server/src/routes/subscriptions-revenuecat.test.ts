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
  revenuecatEventsTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import { getOrCreateRevenueCatId } from "../lib/revenuecat-identity";
import {
  reconcileApprovedTraderSubscription,
  reconcileRevenueCatEntitlement,
} from "../lib/revenuecat-reconciliation";
import { resolveProductTier } from "../lib/team-billing";
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

function mockActiveEntitlement(
  expiresAtMs: number | null = Date.now() + 30 * 24 * 60 * 60 * 1000,
  productIdentifier = "premium_monthly",
) {
  mockListActive.mockResolvedValue({
    data: {
      items: [
        {
          entitlement_id: ENTITLEMENT_OBJECT_ID,
          expires_at: expiresAtMs,
          product_identifier: productIdentifier,
        },
      ],
    },
    error: undefined,
  });
}

async function createVerifiedTrader(
  label: string,
): Promise<{ id: number; token: string; rcId: string }> {
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
  // Webhook fixtures identify the customer by the canonical rc_ id — the
  // numeric users.id form is a narrow legacy alias (pre-existing subscribers
  // only) with its own dedicated tests below.
  const rcId = await getOrCreateRevenueCatId(u.id);
  return { id: u.id, token: generateToken(u.id, "trader", 1), rcId };
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
    it("notifies a mounted trader only after post-approval reconciliation succeeds", async () => {
      let finishReconciliation!: (result: Awaited<ReturnType<typeof reconcileRevenueCatEntitlement>>) => void;
      const pending = new Promise<Awaited<ReturnType<typeof reconcileRevenueCatEntitlement>>>(
        (resolve) => {
          finishReconciliation = resolve;
        },
      );
      const notify = vi.fn(async () => true);
      const log = { error: vi.fn(), warn: vi.fn() } as never;
      const completion = reconcileApprovedTraderSubscription(73, log, {
        reconcile: vi.fn(() => pending),
        notify,
      });
      expect(notify).not.toHaveBeenCalled();

      finishReconciliation({ status: "synced", active: true, productId: "premium_monthly" });
      await expect(completion).resolves.toMatchObject({ status: "synced", active: true });
      expect(notify).toHaveBeenCalledWith(
        73,
        expect.objectContaining({
          data: expect.objectContaining({ subscriptionSync: true }),
        }),
      );

      const unavailableNotify = vi.fn(async () => true);
      await reconcileApprovedTraderSubscription(73, log, {
        reconcile: vi.fn(async () => ({ status: "provider_error" as const })),
        notify: unavailableNotify,
      });
      expect(unavailableNotify).toHaveBeenCalledWith(
        73,
        expect.objectContaining({
          data: { type: "verification_update", status: "VERIFIED" },
        }),
      );
    });

    it("preserves an active Team 5 entitlement through reset, rejects sync while unverified, then reapproves and reconciles idempotently", async () => {
      const trader = await createVerifiedTrader("verification-reset-team5");
      const team5Product = "com.mylocaltrade.app.trader.team5.yearly";
      const savedTeamMap = process.env.TEAM_PRODUCT_SEAT_MAP;
      const originalPeriodStart = new Date("2026-01-05T12:00:00.000Z");
      process.env.TEAM_PRODUCT_SEAT_MAP = JSON.stringify({ [team5Product]: 5 });
      try {
        // This is the existing Apple/RevenueCat ownership that Reset
        // Verification must never delete or detach.
        await db.insert(subscriptionsTable).values({
          userId: trader.id,
          planId: "premium",
          status: "active",
          productIdentifier: team5Product,
          currentPeriodStart: originalPeriodStart,
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          originalPurchaseAt: new Date(),
        });
        mockActiveEntitlement(undefined, team5Product);

        await db
          .update(traderProfilesTable)
          .set({ verificationStatus: "UNDER_REVIEW" })
          .where(eq(traderProfilesTable.userId, trader.id));

        // The public route remains securely closed during the reset window.
        const rejected = await request(app)
          .post("/api/subscriptions/revenuecat-sync")
          .set("Authorization", `Bearer ${trader.token}`)
          .send({});
        expect(rejected.status).toBe(403);

        const [afterRejected] = await db
          .select({
            status: subscriptionsTable.status,
            productIdentifier: subscriptionsTable.productIdentifier,
          currentPeriodStart: subscriptionsTable.currentPeriodStart,
            revenuecatId: usersTable.revenuecatId,
          })
          .from(subscriptionsTable)
          .innerJoin(usersTable, eq(usersTable.id, subscriptionsTable.userId))
          .where(eq(subscriptionsTable.userId, trader.id))
          .limit(1);
        expect(afterRejected).toMatchObject({
          status: "active",
          productIdentifier: team5Product,
          currentPeriodStart: originalPeriodStart,
          revenuecatId: trader.rcId,
        });

        // This is the same shared service the admin approval path schedules
        // after it commits VERIFIED status.
        await db
          .update(traderProfilesTable)
          .set({ verificationStatus: "VERIFIED" })
          .where(eq(traderProfilesTable.userId, trader.id));
        const log = { error: vi.fn(), warn: vi.fn() } as never;
        await expect(reconcileRevenueCatEntitlement(trader.id, log)).resolves.toMatchObject({
          status: "synced",
          active: true,
          productId: team5Product,
        });
        await expect(reconcileRevenueCatEntitlement(trader.id, log)).resolves.toMatchObject({
          status: "synced",
          active: true,
          productId: team5Product,
        });

        const [reconciled] = await db
          .select({
            status: subscriptionsTable.status,
            productIdentifier: subscriptionsTable.productIdentifier,
          currentPeriodStart: subscriptionsTable.currentPeriodStart,
            revenuecatId: usersTable.revenuecatId,
          })
          .from(subscriptionsTable)
          .innerJoin(usersTable, eq(usersTable.id, subscriptionsTable.userId))
          .where(eq(subscriptionsTable.userId, trader.id))
          .limit(1);
        expect(reconciled).toMatchObject({
          status: "active",
          productIdentifier: team5Product,
          currentPeriodStart: originalPeriodStart,
          revenuecatId: trader.rcId,
        });
        expect(resolveProductTier(reconciled.productIdentifier)).toEqual({
          tier: "team_5",
          seats: 5,
        });
        const lifecycleAudits = await db
          .select()
          .from(traderAuditLogTable)
          .where(eq(traderAuditLogTable.userId, trader.id));
        expect(
          lifecycleAudits.filter((audit) => audit.action === "SUBSCRIPTION_ACTIVATED"),
        ).toHaveLength(0);

        // Retry after approval keeps the same server-authorized Team product.
        const retried = await request(app)
          .post("/api/subscriptions/revenuecat-sync")
          .set("Authorization", `Bearer ${trader.token}`)
          .send({});
        expect(retried.status).toBe(200);
        expect(retried.body).toMatchObject({ active: true, productId: team5Product });
      } finally {
        if (savedTeamMap === undefined) delete process.env.TEAM_PRODUCT_SEAT_MAP;
        else process.env.TEAM_PRODUCT_SEAT_MAP = savedTeamMap;
      }
    });

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
      // Phase B: the granting product is persisted (tier source of truth).
      expect(sub.productIdentifier).toBe("premium_monthly");

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

    it("records an App Store cancellation from device-reported willRenew=false and preserves it on later flag-less syncs", async () => {
      const trader = await createVerifiedTrader("cancelflag");
      mockActiveEntitlement();

      // Initial purchase sync — renewing.
      await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({ willRenew: true });
      await settle();

      // Device learns the user cancelled in the App Store sheet.
      const cancelRes = await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({ willRenew: false });
      await settle();
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.active).toBe(true); // perks stay until expiry

      let [sub] = await db
        .select({
          cancelAtPeriodEnd: subscriptionsTable.cancelAtPeriodEnd,
          status: subscriptionsTable.status,
        })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.status).toBe("active");
      expect(sub.cancelAtPeriodEnd).toBe(true);

      // Regression: a routine focus re-sync WITHOUT the flag must NOT clobber
      // the recorded cancellation back to "renewing".
      await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();

      [sub] = await db
        .select({
          cancelAtPeriodEnd: subscriptionsTable.cancelAtPeriodEnd,
          status: subscriptionsTable.status,
        })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.cancelAtPeriodEnd).toBe(true);

      // User re-enables auto-renew in the App Store — flag clears again.
      await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({ willRenew: true });
      await settle();

      [sub] = await db
        .select({
          cancelAtPeriodEnd: subscriptionsTable.cancelAtPeriodEnd,
          status: subscriptionsTable.status,
        })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.cancelAtPeriodEnd).toBe(false);

      // Cancellation state changes never re-send activation pushes.
      expect(activationPushes(trader.id)).toHaveLength(1);
    });

    it("preserves a webhook-scheduled cancellation across flag-less focus syncs", async () => {
      const trader = await createVerifiedTrader("webhookcancel");
      mockActiveEntitlement();

      await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();

      // Simulate the CANCELLATION webhook having marked the row.
      await db
        .update(subscriptionsTable)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(subscriptionsTable.userId, trader.id));

      // Old behavior reset this to false on every focus sync.
      await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();

      const [sub] = await db
        .select({ cancelAtPeriodEnd: subscriptionsTable.cancelAtPeriodEnd })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.cancelAtPeriodEnd).toBe(true);
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
          event: { type: "EXPIRATION", app_user_id: trader.rcId },
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
          app_user_id: trader.rcId,
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

    it("persists the granting product_id on webhook grants (Phase B tier source)", async () => {
      const trader = await createVerifiedTrader("wh-product-id");
      const res = await request(app)
        .post("/api/webhooks/revenuecat")
        .set("Authorization", WEBHOOK_SECRET)
        .send({
          event: {
            type: "INITIAL_PURCHASE",
            app_user_id: trader.rcId,
            entitlement_ids: [ENTITLEMENT_KEY],
            product_id: "com.mylocaltrade.app.trader.yearly",
            expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
            purchased_at_ms: Date.now(),
          },
        });
      await settle();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, applied: true });

      const [sub] = await db
        .select({ productIdentifier: subscriptionsTable.productIdentifier })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.productIdentifier).toBe("com.mylocaltrade.app.trader.yearly");
    });

    it("acknowledges and skips events for other entitlements", async () => {
      const trader = await createVerifiedTrader("wh-other-entl");
      const res = await request(app)
        .post("/api/webhooks/revenuecat")
        .set("Authorization", WEBHOOK_SECRET)
        .send({
          event: {
            type: "EXPIRATION",
            app_user_id: trader.rcId,
            entitlement_ids: ["some_other_entitlement"],
          },
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, ignored: "entitlement" });
    });
  });

  describe("POST /webhooks/revenuecat — hardening (Phase D)", () => {
    const sendEvent = (event: Record<string, unknown>) =>
      request(app)
        .post("/api/webhooks/revenuecat")
        .set("Authorization", WEBHOOK_SECRET)
        .send({ event });

    it("deduplicates by event id: a redelivered event is skipped entirely", async () => {
      const trader = await createVerifiedTrader("wh-dedupe");
      const now = Date.now();
      const grant = {
        id: `evt-dedupe-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: now + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: now,
        event_timestamp_ms: now,
      };

      const first = await sendEvent(grant);
      await settle();
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ success: true, applied: true });
      expect(activationPushes(trader.id)).toHaveLength(1);

      // Exact redelivery (same event id): consumed by the ledger, nothing
      // reprocessed — not even a second activation-side audit or push.
      const second = await sendEvent(grant);
      await settle();
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ success: true, ignored: "duplicate" });
      expect(activationPushes(trader.id)).toHaveLength(1);

      const events = await db
        .select()
        .from(revenuecatEventsTable)
        .where(eq(revenuecatEventsTable.eventId, grant.id));
      expect(events).toHaveLength(1);
    });

    it("rejects out-of-order events: a late older grant cannot resurrect a newer expiration", async () => {
      const trader = await createVerifiedTrader("wh-order");
      const tGrant = Date.now() - 120_000; // original purchase
      const t0 = Date.now() - 60_000; // old renewal timestamp
      const t1 = Date.now(); // newer expiration timestamp

      // Establish the subscription (and its event clock) first.
      const initial = await sendEvent({
        id: `evt-order-initial-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: tGrant + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: tGrant,
        event_timestamp_ms: tGrant,
      });
      await settle();
      expect(initial.body).toMatchObject({ success: true, applied: true });

      const expire = await sendEvent({
        id: `evt-order-expire-${SUFFIX}`,
        type: "EXPIRATION",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        expiration_at_ms: t1,
        event_timestamp_ms: t1,
      });
      await settle();
      expect(expire.status).toBe(200);

      // The RENEWAL that predates the expiration arrives late (retry queue).
      const lateRenewal = await sendEvent({
        id: `evt-order-renew-${SUFFIX}`,
        type: "RENEWAL",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: t0 + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: t0,
        event_timestamp_ms: t0,
      });
      await settle();
      expect(lateRenewal.status).toBe(200);
      expect(lateRenewal.body).toMatchObject({ success: true, ignored: "out_of_order" });

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.status).toBe("cancelled");

      // A genuinely NEWER re-subscribe still works (first event wins only
      // against OLDER timestamps, not against progress).
      const t2 = t1 + 60_000;
      const resub = await sendEvent({
        id: `evt-order-resub-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: t2 + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: t2,
        event_timestamp_ms: t2,
      });
      await settle();
      expect(resub.body).toMatchObject({ success: true, applied: true });
      const [sub2] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub2.status).toBe("active");
    });

    it("BILLING_ISSUE records the flag without revoking; the next grant clears it", async () => {
      const trader = await createVerifiedTrader("wh-billing-issue");
      const t0 = Date.now();
      await sendEvent({
        id: `evt-bi-grant-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: t0 + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: t0,
        event_timestamp_ms: t0,
      });
      await settle();
      mockSendPush.mockClear();

      const issue = await sendEvent({
        id: `evt-bi-issue-${SUFFIX}`,
        type: "BILLING_ISSUE",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        event_timestamp_ms: t0 + 1_000,
      });
      await settle();
      expect(issue.status).toBe(200);
      expect(issue.body).toMatchObject({ success: true, applied: true });

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      // Access continues (Apple grace/retry) — status untouched, flag set.
      expect(sub.status).toBe("active");
      expect(sub.billingIssueDetectedAt).not.toBeNull();
      // No status-change push for a billing issue.
      expect(mockSendPush).not.toHaveBeenCalled();

      // Payment recovered → RENEWAL clears the flag.
      const t1 = t0 + 2_000;
      await sendEvent({
        id: `evt-bi-renew-${SUFFIX}`,
        type: "RENEWAL",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: t1 + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: t1,
        event_timestamp_ms: t1,
      });
      await settle();
      const [after] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(after.status).toBe("active");
      expect(after.billingIssueDetectedAt).toBeNull();
    });

    it("equal-timestamp tie-break is deterministic: revoke wins, a tied grant is skipped", async () => {
      const trader = await createVerifiedTrader("wh-tie");
      const t0 = Date.now() - 120_000;
      await sendEvent({
        id: `evt-tie-grant0-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: t0 + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: t0,
        event_timestamp_ms: t0,
      });
      await settle();

      // EXPIRATION at t1 applies; a different grant event with the SAME
      // timestamp must be skipped — arrival order must not pick the state.
      const t1 = t0 + 60_000;
      const expire = await sendEvent({
        id: `evt-tie-expire-${SUFFIX}`,
        type: "EXPIRATION",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        event_timestamp_ms: t1,
      });
      await settle();
      expect(expire.body).toMatchObject({ success: true, applied: true });

      const tiedGrant = await sendEvent({
        id: `evt-tie-grant1-${SUFFIX}`,
        type: "RENEWAL",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: t1 + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: t1,
        event_timestamp_ms: t1, // exact tie with the expiration
      });
      await settle();
      expect(tiedGrant.body).toMatchObject({ success: true, ignored: "out_of_order" });
      const [afterTie] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(afterTie.status).toBe("cancelled");

      // Opposite order at a fresh tie: grant applies first, then a revoke
      // with the SAME timestamp still applies → both orders end revoked.
      const t2 = t1 + 60_000;
      const regrant = await sendEvent({
        id: `evt-tie-grant2-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: t2 + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: t2,
        event_timestamp_ms: t2,
      });
      await settle();
      expect(regrant.body).toMatchObject({ success: true, applied: true });

      const tiedRevoke = await sendEvent({
        id: `evt-tie-expire2-${SUFFIX}`,
        type: "EXPIRATION",
        app_user_id: trader.rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        event_timestamp_ms: t2, // exact tie with the grant
      });
      await settle();
      expect(tiedRevoke.body).toMatchObject({ success: true, applied: true });
      const [final] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(final.status).toBe("cancelled");
    });
  });

  describe("RevenueCat identity hardening (rc_ app user ids)", () => {
    const sendEvent = (event: Record<string, unknown>) =>
      request(app)
        .post("/api/webhooks/revenuecat")
        .set("Authorization", WEBHOOK_SECRET)
        .send({ event });

    it("sync lazily backfills a canonical rc_ id and queries RevenueCat with it (never the numeric user id)", async () => {
      const trader = await createVerifiedTrader("id-canonical-sync");
      mockActiveEntitlement();

      const res = await request(app)
        .post("/api/subscriptions/revenuecat-sync")
        .set("Authorization", `Bearer ${trader.token}`)
        .send({});
      await settle();
      expect(res.status).toBe(200);

      const [row] = await db
        .select({ revenuecatId: usersTable.revenuecatId })
        .from(usersTable)
        .where(eq(usersTable.id, trader.id))
        .limit(1);
      expect(row.revenuecatId).toMatch(/^rc_[0-9a-f]{32}$/);

      const call = mockListActive.mock.calls.at(-1)?.[0] as {
        path?: { customer_id?: string };
      };
      expect(call?.path?.customer_id).toBe(row.revenuecatId);
    });

    it("webhook resolves a canonical rc_ app_user_id to the right account", async () => {
      const trader = await createVerifiedTrader("id-canonical-wh");
      const rcId = await getOrCreateRevenueCatId(trader.id);
      const now = Date.now();

      const res = await sendEvent({
        id: `evt-id-canonical-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: now + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: now,
        event_timestamp_ms: now,
      });
      await settle();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, applied: true });

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.status).toBe("active");
    });

    it("webhook resolves via original_app_user_id when app_user_id is anonymous (receipt transfer)", async () => {
      const trader = await createVerifiedTrader("id-transfer");
      const rcId = await getOrCreateRevenueCatId(trader.id);
      const now = Date.now();

      const res = await sendEvent({
        id: `evt-id-transfer-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: "$RCAnonymousID:ffffffffffffffffffffffffffffffff",
        original_app_user_id: rcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: now + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: now,
        event_timestamp_ms: now,
      });
      await settle();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, applied: true });

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, trader.id))
        .limit(1);
      expect(sub.status).toBe("active");
    });

    it("fails closed on a forged/unknown rc_ id: 2xx ack, no state mutation", async () => {
      const before = await db.select().from(subscriptionsTable);
      const res = await sendEvent({
        id: `evt-id-forged-rc-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: "rc_00000000000000000000000000000000",
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: Date.now(),
        event_timestamp_ms: Date.now(),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, ignored: "unknown_app_user_id" });
      const after = await db.select().from(subscriptionsTable);
      expect(after.length).toBe(before.length);
    });

    it("fails closed on an unknown numeric id: 2xx ack, no state mutation", async () => {
      const res = await sendEvent({
        id: `evt-id-forged-num-${SUFFIX}`,
        type: "EXPIRATION",
        app_user_id: "999999999",
        entitlement_ids: [ENTITLEMENT_KEY],
        event_timestamp_ms: Date.now(),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, ignored: "unknown_app_user_id" });
    });

    it("legacy numeric alias resolves ONLY for accounts with pre-existing billing history", async () => {
      // A real user with NO subscription row: the guessable numeric id must
      // NOT attach new subscription state to them (the confused-deputy path
      // the rc_ hardening closes). Fails closed as unknown.
      const fresh = await createVerifiedTrader("id-legacy-fresh");
      const denied = await sendEvent({
        id: `evt-id-legacy-fresh-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: String(fresh.id),
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: Date.now(),
        event_timestamp_ms: Date.now(),
      });
      expect(denied.status).toBe(200);
      expect(denied.body).toMatchObject({ success: true, ignored: "unknown_app_user_id" });
      const rows = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, fresh.id));
      expect(rows).toHaveLength(0);

      // A pre-hardening subscriber (existing subscription row) still gets
      // their numeric-keyed webhook events applied — receipts created before
      // the hardening carry the numeric id as original_app_user_id forever.
      const legacy = await createVerifiedTrader("id-legacy-sub");
      const now = Date.now();
      await db.insert(subscriptionsTable).values({
        userId: legacy.id,
        planId: "premium",
        status: "active",
        currentPeriodStart: new Date(now - 15 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(now + 15 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        originalPurchaseAt: new Date(now - 15 * 24 * 60 * 60 * 1000),
      });
      const applied = await sendEvent({
        id: `evt-id-legacy-sub-${SUFFIX}`,
        type: "EXPIRATION",
        app_user_id: String(legacy.id),
        entitlement_ids: [ENTITLEMENT_KEY],
        event_timestamp_ms: now,
      });
      await settle();
      expect(applied.status).toBe(200);
      expect(applied.body).toMatchObject({ success: true, applied: true });
      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, legacy.id))
        .limit(1);
      expect(sub.status).toBe("cancelled");
    });

    it("acks anonymous-only events without touching anything", async () => {
      const res = await sendEvent({
        id: `evt-id-anon-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: "$RCAnonymousID:abcabcabcabcabcabcabcabcabcabcab",
        entitlement_ids: [ENTITLEMENT_KEY],
        event_timestamp_ms: Date.now(),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, ignored: "anonymous" });
    });

    it("a deleted account's released rc_ id can never grant to a new account (ids are unique per user row)", async () => {
      // Re-registration after deletion produces a NEW user row with a NEW
      // rc_ id; the old id stays bound to the tombstoned row. A late webhook
      // for the old id must therefore never leak Premium to the new account.
      const oldTrader = await createVerifiedTrader("id-deleted-old");
      const oldRcId = await getOrCreateRevenueCatId(oldTrader.id);
      const newTrader = await createVerifiedTrader("id-deleted-new");
      const newRcId = await getOrCreateRevenueCatId(newTrader.id);
      expect(newRcId).not.toBe(oldRcId);

      const now = Date.now();
      const res = await sendEvent({
        id: `evt-id-deleted-${SUFFIX}`,
        type: "INITIAL_PURCHASE",
        app_user_id: oldRcId,
        entitlement_ids: [ENTITLEMENT_KEY],
        product_id: "com.mylocaltrade.app.trader.yearly",
        expiration_at_ms: now + 30 * 24 * 60 * 60 * 1000,
        purchased_at_ms: now,
        event_timestamp_ms: now,
      });
      await settle();
      expect(res.status).toBe(200);

      // Whatever happens to the old row, the NEW account must have no
      // subscription.
      const subs = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, newTrader.id));
      expect(subs).toHaveLength(0);
    });
  });
});
