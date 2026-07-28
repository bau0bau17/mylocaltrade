import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

// Prevent any real email dispatch from the admin completion route.
vi.mock("./email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email")>();
  return {
    ...actual,
    sendAccountDeletionCompletedEmail: vi.fn(async () => {}),
  };
});

import { db } from "@workspace/db";
import { usersTable, pushTokensTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import {
  findOrphanedPushTokens,
  cleanupOrphanedPushTokens,
} from "./cleanup-orphaned-push-tokens";

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `push-cleanup-test+${label}-${SUFFIX}@example.test`;
const tokenFor = (label: string) => `ExponentPushToken[cleanup-${label}-${SUFFIX}]`;

const createdUserIds: number[] = [];

async function createUser(
  label: string,
  overrides: Partial<typeof usersTable.$inferInsert> = {},
): Promise<{ id: number; tokenVersion: number }> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: overrides.email ?? emailFor(label),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Push Cleanup ${label}`,
      role: "customer",
      isActive: true,
      emailVerified: true,
      ...overrides,
    })
    .returning({ id: usersTable.id, tokenVersion: usersTable.tokenVersion });
  createdUserIds.push(u.id);
  return u;
}

async function addPushToken(userId: number, label: string): Promise<number> {
  const [t] = await db
    .insert(pushTokensTable)
    .values({ userId, token: tokenFor(label), platform: "ios" })
    .returning({ id: pushTokensTable.id });
  return t.id;
}

async function tokenCount(userId: number): Promise<number> {
  const rows = await db
    .select({ id: pushTokensTable.id })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.userId, userId));
  return rows.length;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    // push_tokens cascade with the user rows.
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("orphaned push token cleanup", () => {
  it("removes tokens of deleted/anonymised accounts, leaves active accounts untouched, and is idempotent", async () => {
    const active = await createUser("active");
    const completed = await createUser("completed", {
      email: `deleted-user-x-${SUFFIX}@deleted.mylocaltrade.invalid`,
      deletionStatus: "COMPLETED",
      deletedAt: new Date(),
      isActive: false,
    });
    const anonymised = await createUser("anon", {
      deletionStatus: "ANONYMISED",
      anonymisedAt: new Date(),
      isActive: false,
    });

    await addPushToken(active.id, "active");
    await addPushToken(completed.id, "completed");
    await addPushToken(anonymised.id, "anon");

    // Dry-run listing sees exactly the two orphans from this test.
    const orphans = await findOrphanedPushTokens();
    const ourOrphanUserIds = orphans
      .map((o) => o.userId)
      .filter((id) => createdUserIds.includes(id));
    expect(new Set(ourOrphanUserIds)).toEqual(new Set([completed.id, anonymised.id]));

    const removed = await cleanupOrphanedPushTokens();
    expect(removed).toBeGreaterThanOrEqual(2);

    expect(await tokenCount(active.id)).toBe(1); // untouched
    expect(await tokenCount(completed.id)).toBe(0);
    expect(await tokenCount(anonymised.id)).toBe(0);

    // Idempotent: a second run finds nothing of ours.
    const secondPass = await findOrphanedPushTokens();
    expect(secondPass.some((o) => createdUserIds.includes(o.userId))).toBe(false);
  });

  it("never matches an ACTIVE account even if its email uses a .invalid domain", async () => {
    const weird = await createUser("weird-active", {
      email: `weird-but-active-${SUFFIX}@example.invalid`,
      isActive: true,
    });
    await addPushToken(weird.id, "weird-active");

    const orphans = await findOrphanedPushTokens();
    expect(orphans.some((o) => o.userId === weird.id)).toBe(false);

    await cleanupOrphanedPushTokens();
    expect(await tokenCount(weird.id)).toBe(1);
  });

  it("future deletions purge tokens via the admin completion route", async () => {
    const [admin] = await db
      .insert(usersTable)
      .values({
        email: emailFor("admin"),
        passwordHash: "$2a$10$test.hash.not.used.for.login",
        fullName: "Push Cleanup Admin",
        role: "admin",
        isActive: true,
        emailVerified: true,
      })
      .returning({ id: usersTable.id, tokenVersion: usersTable.tokenVersion });
    createdUserIds.push(admin.id);
    const adminJwt = generateToken(admin.id, "admin", admin.tokenVersion);

    const requested = await createUser("requested", {
      deletionStatus: "REQUESTED",
      isActive: false,
    });
    await addPushToken(requested.id, "requested");
    expect(await tokenCount(requested.id)).toBe(1);

    const res = await request(app)
      .post(`/api/admin/account-deletions/${requested.id}/complete`)
      .set("Authorization", `Bearer ${adminJwt}`);
    expect(res.status).toBe(200);

    expect(await tokenCount(requested.id)).toBe(0);
  });
});
