import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  enquiriesTable,
  reviewsTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";

/**
 * Integration tests for the review-reply flow.
 *
 * These run against the dev DATABASE_URL but create their own scoped
 * fixtures (unique email prefix) and tear them down at the end so they
 * don't pollute seeded data.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `reviews-test+${label}-${SUFFIX}@example.test`;

interface Ctx {
  customerId: number;
  customerToken: string;
  traderUserId: number;
  traderProfileId: number;
  traderToken: string;
  otherTraderUserId: number;
  otherTraderProfileId: number;
  otherTraderToken: string;
  adminId: number;
  adminToken: string;
  approvedReviewId: number;
  approvedEnquiryId: number;
  pendingReviewId: number;
  pendingEnquiryId: number;
  rejectedReviewId: number;
  rejectedEnquiryId: number;
}

let ctx: Ctx;
const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdEnquiryIds: number[] = [];
const createdReviewIds: number[] = [];

async function createUser(role: "customer" | "trader" | "admin", label: string): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Test ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function createTraderProfile(userId: number, label: string): Promise<number> {
  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId,
      businessName: `Test Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000000",
      mainCategory: "plumbing",
      town: "London",
      postcode: "SW1A 1AA",
      isActive: true,
    })
    .returning({ id: traderProfilesTable.id });
  createdProfileIds.push(p.id);
  return p.id;
}

async function createEnquiry(traderId: number, customerId: number): Promise<number> {
  const [e] = await db
    .insert(enquiriesTable)
    .values({
      traderId,
      customerId,
      message: "Need a quote for boiler service",
      serviceRequired: "Boiler service",
      status: "completed",
    })
    .returning({ id: enquiriesTable.id });
  createdEnquiryIds.push(e.id);
  return e.id;
}

async function createReview(
  traderId: number,
  customerId: number,
  enquiryId: number,
  status: "PENDING" | "APPROVED" | "REJECTED" | "FLAGGED",
  rating = 5,
): Promise<number> {
  const [r] = await db
    .insert(reviewsTable)
    .values({
      traderId,
      customerId,
      enquiryId,
      rating,
      text: `Test review ${status}`,
      status,
    })
    .returning({ id: reviewsTable.id });
  createdReviewIds.push(r.id);
  return r.id;
}

beforeAll(async () => {
  const customerId = await createUser("customer", "buyer");
  const traderUserId = await createUser("trader", "alpha");
  const otherTraderUserId = await createUser("trader", "beta");
  const adminId = await createUser("admin", "mod");

  const traderProfileId = await createTraderProfile(traderUserId, "alpha");
  const otherTraderProfileId = await createTraderProfile(otherTraderUserId, "beta");

  const approvedEnquiryId = await createEnquiry(traderProfileId, customerId);
  const pendingEnquiryId = await createEnquiry(traderProfileId, customerId);
  const rejectedEnquiryId = await createEnquiry(traderProfileId, customerId);

  const approvedReviewId = await createReview(traderProfileId, customerId, approvedEnquiryId, "APPROVED", 5);
  const pendingReviewId = await createReview(traderProfileId, customerId, pendingEnquiryId, "PENDING", 4);
  const rejectedReviewId = await createReview(traderProfileId, customerId, rejectedEnquiryId, "REJECTED", 1);

  ctx = {
    customerId,
    customerToken: generateToken(customerId, "customer"),
    traderUserId,
    traderProfileId,
    traderToken: generateToken(traderUserId, "trader"),
    otherTraderUserId,
    otherTraderProfileId,
    otherTraderToken: generateToken(otherTraderUserId, "trader"),
    adminId,
    adminToken: generateToken(adminId, "admin"),
    approvedReviewId,
    approvedEnquiryId,
    pendingReviewId,
    pendingEnquiryId,
    rejectedReviewId,
    rejectedEnquiryId,
  };
});

afterAll(async () => {
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

describe("POST /api/trader/reviews/:id/reply", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post(`/api/trader/reviews/${ctx.approvedReviewId}/reply`)
      .send({ reply: "Thanks!" });
    expect(res.status).toBe(401);
  });

  it("rejects non-trader roles with 403", async () => {
    const res = await request(app)
      .post(`/api/trader/reviews/${ctx.approvedReviewId}/reply`)
      .set("Authorization", `Bearer ${ctx.customerToken}`)
      .send({ reply: "I am the customer, not the trader" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when a different trader tries to reply (ownership denied)", async () => {
    const res = await request(app)
      .post(`/api/trader/reviews/${ctx.approvedReviewId}/reply`)
      .set("Authorization", `Bearer ${ctx.otherTraderToken}`)
      .send({ reply: "Hijack attempt" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/your own profile/i);

    // And the review must remain untouched on disk.
    const [row] = await db
      .select({ traderReply: reviewsTable.traderReply })
      .from(reviewsTable)
      .where(eq(reviewsTable.id, ctx.approvedReviewId));
    expect(row.traderReply).toBeNull();
  });

  it("returns 404 for a non-existent review id", async () => {
    const res = await request(app)
      .post("/api/trader/reviews/999999999/reply")
      .set("Authorization", `Bearer ${ctx.traderToken}`)
      .send({ reply: "Where did this review go?" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid review id", async () => {
    const res = await request(app)
      .post("/api/trader/reviews/not-a-number/reply")
      .set("Authorization", `Bearer ${ctx.traderToken}`)
      .send({ reply: "Bad id" });
    expect(res.status).toBe(400);
  });

  it("rejects empty / whitespace-only replies with 400", async () => {
    const res = await request(app)
      .post(`/api/trader/reviews/${ctx.approvedReviewId}/reply`)
      .set("Authorization", `Bearer ${ctx.traderToken}`)
      .send({ reply: "   \n  " });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the review is PENDING (not APPROVED)", async () => {
    const res = await request(app)
      .post(`/api/trader/reviews/${ctx.pendingReviewId}/reply`)
      .set("Authorization", `Bearer ${ctx.traderToken}`)
      .send({ reply: "Replying too early" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/approved/i);
  });

  it("returns 409 when the review is REJECTED", async () => {
    const res = await request(app)
      .post(`/api/trader/reviews/${ctx.rejectedReviewId}/reply`)
      .set("Authorization", `Bearer ${ctx.traderToken}`)
      .send({ reply: "Replying to a rejected one" });
    expect(res.status).toBe(409);
  });

  it("allows the trader to reply to their own APPROVED review", async () => {
    const res = await request(app)
      .post(`/api/trader/reviews/${ctx.approvedReviewId}/reply`)
      .set("Authorization", `Bearer ${ctx.traderToken}`)
      .send({ reply: "Thank you for the kind words!" });
    expect(res.status).toBe(200);
    expect(res.body.traderReply).toBe("Thank you for the kind words!");
    expect(res.body.traderReplyAt).toBeTruthy();

    const [row] = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.id, ctx.approvedReviewId));
    expect(row.traderReply).toBe("Thank you for the kind words!");
    expect(row.status).toBe("APPROVED"); // moderation status untouched
  });

  it("allows the trader to update an existing reply", async () => {
    const res = await request(app)
      .post(`/api/trader/reviews/${ctx.approvedReviewId}/reply`)
      .set("Authorization", `Bearer ${ctx.traderToken}`)
      .send({ reply: "Edited reply — thanks again!" });
    expect(res.status).toBe(200);
    expect(res.body.traderReply).toBe("Edited reply — thanks again!");

    const [row] = await db
      .select({ reply: reviewsTable.traderReply })
      .from(reviewsTable)
      .where(eq(reviewsTable.id, ctx.approvedReviewId));
    expect(row.reply).toBe("Edited reply — thanks again!");
  });
});

describe("Public profile review visibility", () => {
  it("only returns APPROVED reviews and exposes trader replies", async () => {
    const res = await request(app).get(`/api/traders/${ctx.traderProfileId}/reviews`);
    expect(res.status).toBe(200);

    const reviewIds = res.body.reviews.map((r: { id: number }) => r.id);
    expect(reviewIds).toContain(ctx.approvedReviewId);
    expect(reviewIds).not.toContain(ctx.pendingReviewId);
    expect(reviewIds).not.toContain(ctx.rejectedReviewId);

    const approved = res.body.reviews.find((r: { id: number }) => r.id === ctx.approvedReviewId);
    expect(approved.traderReply).toBe("Edited reply — thanks again!");

    // Public DTO must not leak moderation context or customer ids.
    for (const r of res.body.reviews) {
      expect(r).not.toHaveProperty("customerId");
      expect(r).not.toHaveProperty("moderationNotes");
      expect(r).not.toHaveProperty("status");
    }
  });
});

describe("Admin moderation cannot be bypassed by reply endpoint", () => {
  it("trader reply does not change moderation status", async () => {
    // The reply endpoint above ran on an already-APPROVED review. Make sure
    // the trader cannot use it to flip a PENDING review to APPROVED via a
    // side channel — we already saw 409 above; double-check status on disk.
    const [row] = await db
      .select({ status: reviewsTable.status, moderatedBy: reviewsTable.moderatedBy })
      .from(reviewsTable)
      .where(eq(reviewsTable.id, ctx.pendingReviewId));
    expect(row.status).toBe("PENDING");
    expect(row.moderatedBy).toBeNull();
  });

  it("trader cannot call admin moderation endpoint", async () => {
    const res = await request(app)
      .post(`/api/admin/reviews/${ctx.pendingReviewId}/moderate`)
      .set("Authorization", `Bearer ${ctx.traderToken}`)
      .send({ action: "approve" });
    expect(res.status).toBe(403);
  });

  it("admin can moderate, and resulting status is reflected in DB", async () => {
    const res = await request(app)
      .post(`/api/admin/reviews/${ctx.pendingReviewId}/moderate`)
      .set("Authorization", `Bearer ${ctx.adminToken}`)
      .send({ action: "approve", notes: "Looks legit" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");

    const [row] = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.id, ctx.pendingReviewId));
    expect(row.status).toBe("APPROVED");
    expect(row.moderatedBy).toBe(ctx.adminId);
    expect(row.moderationNotes).toBe("Looks legit");
  });
});
