import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  enquiriesTable,
  reviewsTable,
  cancellationRequestsTable,
} from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";

/**
 * Integration tests for GET /api/admin/attention-counts (sidebar badges).
 *
 * Runs against the dev DATABASE_URL with scoped fixtures (unique email
 * suffix) which are torn down at the end. Counts are asserted as deltas
 * against a baseline snapshot so concurrent data never breaks the test.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `attention-test+${label}-${SUFFIX}@example.test`;

interface Counts {
  traders: number;
  expiringDocuments: number;
  reviews: number;
  conversationReports: number;
  userReports: number;
  cancellationRequests: number;
  accountDeletions: number;
}

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdEnquiryIds: number[] = [];
const createdReviewIds: number[] = [];
const createdCancellationIds: number[] = [];

let adminToken: string;
let customerToken: string;
let baseline: Counts;
let after: Counts;

async function createUser(
  role: "customer" | "trader" | "admin",
  label: string,
  extra: Partial<typeof usersTable.$inferInsert> = {},
): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Attention ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      ...extra,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function fetchCounts(token: string): Promise<Counts> {
  const res = await request(app)
    .get("/api/admin/attention-counts")
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as Counts;
}

beforeAll(async () => {
  const adminId = await createUser("admin", "mod");
  adminToken = generateToken(adminId, "admin", 1);
  const customerId = await createUser("customer", "buyer");
  customerToken = generateToken(customerId, "customer", 1);

  baseline = await fetchCounts(adminToken);

  // Trader awaiting verification review.
  const traderUserId = await createUser("trader", "pending");
  const [profile] = await db
    .insert(traderProfilesTable)
    .values({
      userId: traderUserId,
      businessName: `Attention Trades ${SUFFIX}`,
      contactName: "Pending Trader",
      email: emailFor("profile"),
      phone: "+447000000001",
      mainCategory: "plumbing",
      town: "London",
      postcode: "SW1A 1AA",
      isActive: true,
      businessProfileCompleted: true,
      verificationStatus: "UNDER_REVIEW",
    })
    .returning({ id: traderProfilesTable.id });
  createdProfileIds.push(profile.id);

  // Pending review awaiting moderation.
  const [enquiry] = await db
    .insert(enquiriesTable)
    .values({
      traderId: profile.id,
      customerId,
      message: "Attention counts fixture enquiry",
      serviceRequired: "Boiler service",
      status: "completed",
    })
    .returning({ id: enquiriesTable.id });
  createdEnquiryIds.push(enquiry.id);
  const [review] = await db
    .insert(reviewsTable)
    .values({
      traderId: profile.id,
      customerId,
      enquiryId: enquiry.id,
      rating: 4,
      text: "Attention counts fixture review",
      status: "PENDING",
    })
    .returning({ id: reviewsTable.id });
  createdReviewIds.push(review.id);

  // Open cancellation request.
  const [cancellation] = await db
    .insert(cancellationRequestsTable)
    .values({
      userId: traderUserId,
      provider: "apple",
      status: "OPEN",
    })
    .returning({ id: cancellationRequestsTable.id });
  createdCancellationIds.push(cancellation.id);

  // Account deletion awaiting admin action.
  await createUser("customer", "leaver", {
    deletionStatus: "REQUESTED",
    deletionRequestedAt: new Date(),
  });

  after = await fetchCounts(adminToken);
});

afterAll(async () => {
  if (createdReviewIds.length) await db.delete(reviewsTable).where(inArray(reviewsTable.id, createdReviewIds));
  if (createdCancellationIds.length)
    await db.delete(cancellationRequestsTable).where(inArray(cancellationRequestsTable.id, createdCancellationIds));
  if (createdEnquiryIds.length) await db.delete(enquiriesTable).where(inArray(enquiriesTable.id, createdEnquiryIds));
  if (createdProfileIds.length)
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, createdProfileIds));
  if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
});

describe("GET /api/admin/attention-counts", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/admin/attention-counts");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    const res = await request(app)
      .get("/api/admin/attention-counts")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it("counts traders awaiting verification review", () => {
    expect(after.traders).toBe(baseline.traders + 1);
  });

  it("counts reviews awaiting moderation", () => {
    expect(after.reviews).toBe(baseline.reviews + 1);
  });

  it("counts open cancellation requests", () => {
    expect(after.cancellationRequests).toBe(baseline.cancellationRequests + 1);
  });

  it("counts account deletion requests awaiting action", () => {
    expect(after.accountDeletions).toBe(baseline.accountDeletions + 1);
  });

  it("returns every badge key as a number", () => {
    for (const key of [
      "traders",
      "expiringDocuments",
      "reviews",
      "conversationReports",
      "userReports",
      "cancellationRequests",
      "accountDeletions",
    ] as const) {
      expect(typeof after[key]).toBe("number");
    }
  });
});
