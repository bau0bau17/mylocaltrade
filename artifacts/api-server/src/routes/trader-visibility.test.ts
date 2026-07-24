import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";

import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  savedTradersTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import {
  isTraderPubliclyListed,
  type PublicListingRow,
} from "../lib/trader-status";

/**
 * Regression cover for the centralized public-visibility rule (Task #46
 * follow-up). Unit tests pin down every hide condition in
 * isTraderPubliclyListed; the route test proves GET /saved-traders excludes
 * traders whose account is in the deletion lifecycle (the gap the
 * centralization fixed).
 */

// ---------------------------------------------------------------------------
// Unit tests: isTraderPubliclyListed
// ---------------------------------------------------------------------------

function row(overrides: Partial<PublicListingRow> = {}): PublicListingRow {
  return {
    isActive: true,
    verificationStatus: "VERIFIED",
    revalidationOverdue: false,
    deletionStatus: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("isTraderPubliclyListed", () => {
  it("lists an active, verified trader with no hide conditions", () => {
    expect(isTraderPubliclyListed(row())).toBe(true);
  });

  it("hides an inactive profile", () => {
    expect(isTraderPubliclyListed(row({ isActive: false }))).toBe(false);
  });

  it("hides a trader whose re-validation is overdue", () => {
    expect(isTraderPubliclyListed(row({ revalidationOverdue: true }))).toBe(false);
  });

  it.each(["PENDING_DELETION", "GRACE_PERIOD", "ANONYMISED"])(
    "hides a trader whose account deletionStatus is %s",
    (deletionStatus) => {
      expect(isTraderPubliclyListed(row({ deletionStatus }))).toBe(false);
    },
  );

  it("hides a soft-deleted trader (deletedAt set)", () => {
    expect(isTraderPubliclyListed(row({ deletedAt: new Date() }))).toBe(false);
  });

  it.each([
    "REJECTED",
    "SUSPENDED",
    "NEEDS_MORE_INFO",
    "EXPIRED_DOCUMENTS",
    "PROFILE_INCOMPLETE",
    "PENDING_EMAIL_VERIFICATION",
    "PENDING_PHONE_VERIFICATION",
  ])("hides non-allow-list status %s", (verificationStatus) => {
    expect(isTraderPubliclyListed(row({ verificationStatus }))).toBe(false);
  });

  it.each(["VERIFIED", "UNDER_REVIEW", "PENDING_DOCUMENTS"])(
    "lists allow-list status %s in the default (broad) mode",
    (verificationStatus) => {
      expect(isTraderPubliclyListed(row({ verificationStatus }))).toBe(true);
    },
  );

  it("verifiedOnly: lists VERIFIED but hides in-progress statuses", () => {
    expect(isTraderPubliclyListed(row(), { verifiedOnly: true })).toBe(true);
    expect(
      isTraderPubliclyListed(row({ verificationStatus: "UNDER_REVIEW" }), {
        verifiedOnly: true,
      }),
    ).toBe(false);
    expect(
      isTraderPubliclyListed(row({ verificationStatus: "PENDING_DOCUMENTS" }), {
        verifiedOnly: true,
      }),
    ).toBe(false);
  });

  it("verifiedOnly still respects the other hide conditions", () => {
    expect(
      isTraderPubliclyListed(row({ isActive: false }), { verifiedOnly: true }),
    ).toBe(false);
    expect(
      isTraderPubliclyListed(row({ deletionStatus: "PENDING_DELETION" }), {
        verifiedOnly: true,
      }),
    ).toBe(false);
    expect(
      isTraderPubliclyListed(row({ deletedAt: new Date() }), {
        verifiedOnly: true,
      }),
    ).toBe(false);
    expect(
      isTraderPubliclyListed(row({ revalidationOverdue: true }), {
        verifiedOnly: true,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Route test: GET /saved-traders excludes deletion-lifecycle traders
// ---------------------------------------------------------------------------

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `vis-test+${label}-${SUFFIX}@example.test`;
const TEST_CATEGORY = `vis-cat-${SUFFIX}`;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];

async function createUser(
  label: string,
  role: "customer" | "trader",
  overrides: Partial<typeof usersTable.$inferInsert> = {},
): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(label),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Test ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      ...overrides,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function createTraderProfile(
  label: string,
  userId: number,
  overrides: Partial<typeof traderProfilesTable.$inferInsert> = {},
): Promise<number> {
  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId,
      businessName: `Vis Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000000",
      mainCategory: TEST_CATEGORY,
      town: "London",
      postcode: "SW1A 1AA",
      isActive: true,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
      revalidationOverdue: false,
      ...overrides,
    })
    .returning({ id: traderProfilesTable.id });
  createdProfileIds.push(p.id);
  return p.id;
}

describe("GET /saved-traders hides deletion-lifecycle traders", () => {
  let customerId: number;
  let customerToken: string;
  let visibleProfileId: number;
  let pendingDeletionProfileId: number;
  let softDeletedProfileId: number;

  beforeAll(async () => {
    customerId = await createUser("customer", "customer");
    customerToken = generateToken(customerId, "customer", 1);

    const visibleUserId = await createUser("trader-visible", "trader");
    visibleProfileId = await createTraderProfile("visible", visibleUserId);

    const pendingUserId = await createUser("trader-pending-del", "trader", {
      deletionStatus: "PENDING_DELETION",
    });
    pendingDeletionProfileId = await createTraderProfile(
      "pending-del",
      pendingUserId,
    );

    const deletedUserId = await createUser("trader-deleted", "trader", {
      deletedAt: new Date(),
    });
    softDeletedProfileId = await createTraderProfile("deleted", deletedUserId);

    await db.insert(savedTradersTable).values([
      { userId: customerId, traderId: visibleProfileId },
      { userId: customerId, traderId: pendingDeletionProfileId },
      { userId: customerId, traderId: softDeletedProfileId },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(savedTradersTable)
      .where(eq(savedTradersTable.userId, customerId));
    if (createdProfileIds.length) {
      await db
        .delete(traderProfilesTable)
        .where(inArray(traderProfilesTable.id, createdProfileIds));
    }
    if (createdUserIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  });

  it("returns only the visible trader, excluding pending-deletion and soft-deleted", async () => {
    const res = await request(app)
      .get("/api/saved-traders")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    const ids = (res.body.traders as { id: number }[]).map((t) => t.id);
    expect(ids).toContain(visibleProfileId);
    expect(ids).not.toContain(pendingDeletionProfileId);
    expect(ids).not.toContain(softDeletedProfileId);
  });
});
