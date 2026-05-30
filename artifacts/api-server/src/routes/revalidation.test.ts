import { describe, it, beforeAll, afterAll, beforeEach, expect, vi, type Mock } from "vitest";
import request from "supertest";

// Mock outbound notifications BEFORE importing anything that pulls them in.
// The re-validation sweep sends a trader email, a push, and an ADMIN alert to a
// real support inbox — these must never fire during tests. The mocks also let
// us assert that the "due"/"overdue" stages notify as required.
vi.mock("../lib/push-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/push-notifications")>();
  return { ...actual, sendPushToUser: vi.fn(async () => true) };
});
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendTraderRevalidationDueEmail: vi.fn(async () => {}),
    sendTraderRevalidationOverdueEmail: vi.fn(async () => {}),
    sendAdminRevalidationAlertEmail: vi.fn(async () => {}),
  };
});

import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  enquiriesTable,
  reviewsTable,
  savedTradersTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import { sweepRevalidations } from "../lib/scheduler";
import { REVALIDATION_GRACE_MS } from "../lib/trader-status";
import * as emailModule from "../lib/email";
import * as pushModule from "../lib/push-notifications";

/**
 * Integration tests for the periodic re-validation flow (Task #41 regression
 * cover). They run against the dev DATABASE_URL but create their own scoped
 * fixtures (unique email/category prefix) and tear them down afterwards so they
 * don't pollute seeded data.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `reval-test+${label}-${SUFFIX}@example.test`;
// Unique category so list-endpoint assertions don't collide with seeded data.
const TEST_CATEGORY = `reval-cat-${SUFFIX}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdEnquiryIds: number[] = [];
const createdReviewIds: number[] = [];

const flushAsync = () => new Promise((r) => setTimeout(r, 150));

async function createUser(label: string): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(label),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Test ${label}`,
      role: label.startsWith("customer") ? "customer" : "trader",
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

interface TraderOpts {
  featured?: boolean;
  status?: "VERIFIED" | "UNDER_REVIEW" | "PENDING_DOCUMENTS";
  revalidationDueAt?: Date | null;
  revalidationRemindedAt?: Date | null;
  revalidationOverdue?: boolean;
}

interface TraderFixture {
  userId: number;
  profileId: number;
  token: string;
}

async function createTrader(label: string, opts: TraderOpts = {}): Promise<TraderFixture> {
  const userId = await createUser(`trader-${label}`);
  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId,
      businessName: `Test Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000000",
      mainCategory: TEST_CATEGORY,
      town: "London",
      postcode: "SW1A 1AA",
      isActive: true,
      businessProfileCompleted: true,
      isFeatured: opts.featured ?? false,
      verificationStatus: opts.status ?? "VERIFIED",
      revalidationDueAt: opts.revalidationDueAt ?? null,
      revalidationRemindedAt: opts.revalidationRemindedAt ?? null,
      revalidationOverdue: opts.revalidationOverdue ?? false,
    })
    .returning({ id: traderProfilesTable.id });
  createdProfileIds.push(p.id);
  return { userId, profileId: p.id, token: generateToken(userId, "trader", 1) };
}

async function createApprovedReview(traderProfileId: number, customerId: number): Promise<number> {
  const [e] = await db
    .insert(enquiriesTable)
    .values({
      traderId: traderProfileId,
      customerId,
      message: "Need a quote",
      serviceRequired: "Boiler service",
      status: "completed",
    })
    .returning({ id: enquiriesTable.id });
  createdEnquiryIds.push(e.id);

  const [r] = await db
    .insert(reviewsTable)
    .values({
      traderId: traderProfileId,
      customerId,
      enquiryId: e.id,
      rating: 5,
      text: "Great work",
      status: "APPROVED",
    })
    .returning({ id: reviewsTable.id });
  createdReviewIds.push(r.id);
  return r.id;
}

async function getProfile(profileId: number) {
  const [row] = await db
    .select()
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.id, profileId))
    .limit(1);
  return row;
}

async function countAudit(userId: number, action: string): Promise<number> {
  const rows = await db
    .select({ id: traderAuditLogTable.id })
    .from(traderAuditLogTable)
    .where(and(eq(traderAuditLogTable.userId, userId), eq(traderAuditLogTable.action, action)));
  return rows.length;
}

// Shared fixtures for the public-visibility suite.
let customerId: number;
let customerToken: string;
let visibleTrader: TraderFixture;
let overdueTrader: TraderFixture;
let visibleReviewId: number;
let overdueReviewId: number;

beforeAll(async () => {
  customerId = await createUser("customer-buyer");
  customerToken = generateToken(customerId, "customer", 1);

  visibleTrader = await createTrader("visible", {
    featured: true,
    revalidationDueAt: new Date(Date.now() + 300 * DAY_MS),
  });
  overdueTrader = await createTrader("overdue", {
    featured: true,
    revalidationDueAt: new Date(Date.now() - 40 * DAY_MS),
    revalidationRemindedAt: new Date(Date.now() - 35 * DAY_MS),
    revalidationOverdue: true,
  });

  visibleReviewId = await createApprovedReview(visibleTrader.profileId, customerId);
  overdueReviewId = await createApprovedReview(overdueTrader.profileId, customerId);

  // Customer saves both traders so the saved-traders filter can be exercised.
  await db.insert(savedTradersTable).values([
    { userId: customerId, traderId: visibleTrader.profileId },
    { userId: customerId, traderId: overdueTrader.profileId },
  ]);
});

afterAll(async () => {
  await db.delete(savedTradersTable).where(eq(savedTradersTable.userId, customerId));
  if (createdReviewIds.length) {
    await db.delete(reviewsTable).where(inArray(reviewsTable.id, createdReviewIds));
  }
  if (createdEnquiryIds.length) {
    await db.delete(enquiriesTable).where(inArray(enquiriesTable.id, createdEnquiryIds));
  }
  if (createdProfileIds.length) {
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("Public discovery hides re-validation-overdue traders", () => {
  it("GET /traders excludes the overdue trader (and includes the visible one)", async () => {
    const res = await request(app).get(`/api/traders?category=${TEST_CATEGORY}&limit=50`);
    expect(res.status).toBe(200);
    const ids = res.body.traders.map((t: { id: number }) => t.id);
    expect(ids).toContain(visibleTrader.profileId);
    expect(ids).not.toContain(overdueTrader.profileId);
  });

  it("GET /traders/featured excludes the overdue trader", async () => {
    const res = await request(app).get("/api/traders/featured");
    expect(res.status).toBe(200);
    const ids = res.body.traders.map((t: { id: number }) => t.id);
    expect(ids).toContain(visibleTrader.profileId);
    expect(ids).not.toContain(overdueTrader.profileId);
  });

  it("GET /traders/:id returns the visible trader but 404s the overdue one", async () => {
    const ok = await request(app).get(`/api/traders/${visibleTrader.profileId}`);
    expect(ok.status).toBe(200);

    const hidden = await request(app).get(`/api/traders/${overdueTrader.profileId}`);
    expect(hidden.status).toBe(404);
  });

  it("GET /saved-traders excludes the overdue trader", async () => {
    const res = await request(app)
      .get("/api/saved-traders")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.traders.map((t: { id: number }) => t.id);
    expect(ids).toContain(visibleTrader.profileId);
    expect(ids).not.toContain(overdueTrader.profileId);
  });

  it("GET /traders/:id/reviews serves the visible trader but 404s the overdue one", async () => {
    const ok = await request(app).get(`/api/traders/${visibleTrader.profileId}/reviews`);
    expect(ok.status).toBe(200);
    const ids = ok.body.reviews.map((r: { id: number }) => r.id);
    expect(ids).toContain(visibleReviewId);

    const hidden = await request(app).get(`/api/traders/${overdueTrader.profileId}/reviews`);
    expect(hidden.status).toBe(404);
    expect(overdueReviewId).toBeGreaterThan(0); // referenced so lint sees it used
  });
});

describe("sweepRevalidations two-stage flow", () => {
  beforeEach(() => {
    (emailModule.sendTraderRevalidationDueEmail as Mock).mockClear();
    (emailModule.sendTraderRevalidationOverdueEmail as Mock).mockClear();
    (emailModule.sendAdminRevalidationAlertEmail as Mock).mockClear();
    (pushModule.sendPushToUser as Mock).mockClear();
  });

  it("does nothing for a trader whose due date is still in the future", async () => {
    const future = await createTrader("sweep-future", {
      revalidationDueAt: new Date(Date.now() + 100 * DAY_MS),
    });
    await sweepRevalidations();
    await flushAsync();

    const row = await getProfile(future.profileId);
    expect(row.revalidationRemindedAt).toBeNull();
    expect(row.revalidationOverdue).toBe(false);
    expect(await countAudit(future.userId, "REVALIDATION_DUE")).toBe(0);
  });

  it("stage 1: when due, stamps the reminder, notifies, and audits DUE (without hiding)", async () => {
    const dueTrader = await createTrader("sweep-due", {
      revalidationDueAt: new Date(Date.now() - 1 * DAY_MS),
    });

    await sweepRevalidations();
    await flushAsync();

    const row = await getProfile(dueTrader.profileId);
    expect(row.revalidationRemindedAt).not.toBeNull();
    expect(row.revalidationOverdue).toBe(false); // grace clock just started

    expect(await countAudit(dueTrader.userId, "REVALIDATION_DUE")).toBe(1);
    expect(emailModule.sendTraderRevalidationDueEmail as Mock).toHaveBeenCalled();
    expect(emailModule.sendAdminRevalidationAlertEmail as Mock).toHaveBeenCalled();
    expect(pushModule.sendPushToUser as Mock).toHaveBeenCalled();

    // Stage 2: once the grace period has elapsed, the same trader gets hidden.
    await db
      .update(traderProfilesTable)
      .set({ revalidationRemindedAt: new Date(Date.now() - REVALIDATION_GRACE_MS - DAY_MS) })
      .where(eq(traderProfilesTable.id, dueTrader.profileId));

    await sweepRevalidations();
    await flushAsync();

    const hidden = await getProfile(dueTrader.profileId);
    expect(hidden.revalidationOverdue).toBe(true);
    expect(await countAudit(dueTrader.userId, "REVALIDATION_OVERDUE")).toBe(1);
    expect(emailModule.sendTraderRevalidationOverdueEmail as Mock).toHaveBeenCalled();
  });

  it("is idempotent: a second sweep does not re-prompt an already-reminded trader", async () => {
    const t = await createTrader("sweep-idempotent", {
      revalidationDueAt: new Date(Date.now() - 1 * DAY_MS),
    });
    await sweepRevalidations();
    await flushAsync();
    await sweepRevalidations();
    await flushAsync();
    expect(await countAudit(t.userId, "REVALIDATION_DUE")).toBe(1);
  });
});

/**
 * Wrap a drizzle query builder in a Proxy that runs `onTerminal` exactly once,
 * just before the underlying query is actually awaited (its `.then` fires).
 * Method chaining (`.set().where().returning()`) is preserved by re-wrapping
 * whatever each method returns. This lets a test slip a concurrent operation
 * into the gap between a read and a write inside production code.
 */
function wrapBuilderWithBarrier<T extends object>(builder: T, onTerminal: () => Promise<void>): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === "then") {
        return (
          resolve?: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) =>
          Promise.resolve()
            .then(() => onTerminal())
            .then(
              () => (target as PromiseLike<unknown>).then(resolve, reject),
              reject,
            );
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (result === target) return receiver;
          if (result !== null && typeof result === "object") {
            return wrapBuilderWithBarrier(result, onTerminal);
          }
          return result;
        };
      }
      return value;
    },
  });
}

describe("re-validation reset vs sweep (concurrency guard)", () => {
  it("a trader who already re-confirmed is not selected by a later sweep", async () => {
    // Sequential baseline: the trader re-confirms (due date pushed to the
    // future) BEFORE the sweep even reads, so they fall outside the sweep's
    // `revalidationDueAt <= now` selection entirely.
    const racing = await createTrader("race-sequential", {
      revalidationDueAt: new Date(Date.now() - 40 * DAY_MS),
      revalidationRemindedAt: new Date(Date.now() - REVALIDATION_GRACE_MS - DAY_MS),
      revalidationOverdue: false,
    });

    const reval = await request(app)
      .post("/api/profile/revalidate")
      .set("Authorization", `Bearer ${racing.token}`);
    expect(reval.status).toBe(200);
    expect(reval.body.revalidationOverdue).toBe(false);

    await sweepRevalidations();
    await flushAsync();

    const row = await getProfile(racing.profileId);
    expect(row.revalidationOverdue).toBe(false);
    expect(row.revalidationRemindedAt).toBeNull();
    expect(row.revalidationDueAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await countAudit(racing.userId, "REVALIDATION_OVERDUE")).toBe(0);
    expect(await countAudit(racing.userId, "REVALIDATION_CONFIRMED")).toBe(1);
  });

  it("revalidate landing BETWEEN the sweep's read and its overdue write is not clobbered", async () => {
    // The true read/write race. The trader is eligible to be hidden at the
    // moment the sweep takes its snapshot (past due, past grace, not yet
    // overdue) — so they ARE in the sweep's selection. We then force a
    // /profile/revalidate to complete in the gap between that read and the
    // stage-2 CAS write, and assert the trader is NOT wrongly hidden.
    const racing = await createTrader("race-true", {
      revalidationDueAt: new Date(Date.now() - 40 * DAY_MS),
      revalidationRemindedAt: new Date(Date.now() - REVALIDATION_GRACE_MS - DAY_MS),
      revalidationOverdue: false,
    });

    // Clear notification spies so we can assert the overdue path never fires.
    (emailModule.sendTraderRevalidationOverdueEmail as Mock).mockClear();

    let raceTriggered = false;
    const runRevalidateOnce = async () => {
      if (raceTriggered) return;
      raceTriggered = true;
      const reval = await request(app)
        .post("/api/profile/revalidate")
        .set("Authorization", `Bearer ${racing.token}`);
      expect(reval.status).toBe(200);
    };

    // Intercept the sweep's UPDATE: the first time it is awaited, run the
    // concurrent revalidate to completion FIRST, then let the real CAS write
    // execute. Because revalidate reset revalidationRemindedAt to null and
    // pushed revalidationDueAt forward, the stage-2 CAS predicate (pinned to the
    // old reminder timestamp + dueAt <= now) no longer matches and claims
    // nothing.
    const realUpdate = db.update.bind(db);
    const updateSpy = vi
      .spyOn(db, "update")
      .mockImplementation(((table: Parameters<typeof realUpdate>[0]) =>
        wrapBuilderWithBarrier(realUpdate(table), runRevalidateOnce)) as typeof db.update);

    try {
      await sweepRevalidations();
    } finally {
      updateSpy.mockRestore();
    }
    await flushAsync();

    // The race must actually have been exercised.
    expect(raceTriggered).toBe(true);

    const row = await getProfile(racing.profileId);
    expect(row.revalidationOverdue).toBe(false);
    expect(row.revalidationRemindedAt).toBeNull();
    expect(row.revalidationDueAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await countAudit(racing.userId, "REVALIDATION_OVERDUE")).toBe(0);
    expect(await countAudit(racing.userId, "REVALIDATION_CONFIRMED")).toBe(1);
    expect(emailModule.sendTraderRevalidationOverdueEmail as Mock).not.toHaveBeenCalled();
  });
});
