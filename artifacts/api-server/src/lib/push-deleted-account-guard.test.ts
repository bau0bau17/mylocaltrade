import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { db } from "@workspace/db";
import { usersTable, pushTokensTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import {
  sendPushToUser,
  isDeletedOrAnonymisedUser,
  registerPushToken,
} from "./push-notifications";

/**
 * Central push guard: deleted/anonymised accounts must never receive push
 * notifications, even when a stale push token survived a deletion path
 * (e.g. a late RevenueCat webhook or scheduled job firing post-deletion).
 * Mirrors the wiped-placeholder guard in the email dispatcher.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdUserIds: number[] = [];

async function createUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `push-guard-test+${createdUserIds.length}-${SUFFIX}@example.test`,
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: "Push Guard Test",
      role: "customer",
      isActive: true,
      emailVerified: true,
      pushNotificationsEnabled: true,
      ...overrides,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(pushTokensTable).where(inArray(pushTokensTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("isDeletedOrAnonymisedUser", () => {
  const base = { deletedAt: null, anonymisedAt: null, email: "jane@example.com" };

  it("flags soft-deleted accounts", () => {
    expect(isDeletedOrAnonymisedUser({ ...base, deletedAt: new Date() })).toBe(true);
  });

  it("flags anonymised accounts", () => {
    expect(isDeletedOrAnonymisedUser({ ...base, anonymisedAt: new Date() })).toBe(true);
  });

  it("flags wiped .invalid placeholder emails", () => {
    expect(
      isDeletedOrAnonymisedUser({
        ...base,
        email: "deleted-user-42@deleted.mylocaltrade.invalid",
      }),
    ).toBe(true);
    expect(
      isDeletedOrAnonymisedUser({
        ...base,
        email: "  Released-42-170@Released.MyLocalTrade.INVALID ",
      }),
    ).toBe(true);
  });

  it("does not flag normal active accounts", () => {
    expect(isDeletedOrAnonymisedUser(base)).toBe(false);
    expect(
      isDeletedOrAnonymisedUser({ ...base, email: "trader@my-invalid-business.co.uk" }),
    ).toBe(false);
  });
});

describe("sendPushToUser deleted-account guard", () => {
  function spyGuards() {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => {
      throw new Error("fetch must not be called for deleted accounts");
    });
    vi.stubGlobal("fetch", fetchSpy);
    return { warn, fetchSpy };
  }

  it("skips a soft-deleted user even when a stale token survived", async () => {
    const userId = await createUser({ deletedAt: new Date(), isActive: false });
    await registerPushToken(userId, `ExponentPushToken[guard-del-${SUFFIX}]`, "ios");
    const { warn, fetchSpy } = spyGuards();

    const result = await sendPushToUser(userId, { title: "t", body: "b" });

    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.some(([m]) => String(m).includes("skipped-deleted-account")),
    ).toBe(true);
  });

  it("skips an anonymised user with a placeholder email", async () => {
    const userId = await createUser({ anonymisedAt: new Date(), isActive: false });
    // Rewrite email to the wiped placeholder like the anonymise route does.
    const placeholder = `deleted-user-${userId}@deleted.mylocaltrade.invalid`;
    const { usersTable: users } = await import("@workspace/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ email: placeholder }).where(eq(users.id, userId));
    await registerPushToken(userId, `ExponentPushToken[guard-anon-${SUFFIX}]`, "ios");
    const { warn, fetchSpy } = spyGuards();

    const result = await sendPushToUser(userId, { title: "t", body: "b" });

    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.some(([m]) => String(m).includes("skipped-deleted-account")),
    ).toBe(true);
  });

  it("still sends for a live user (guard does not over-block)", async () => {
    const userId = await createUser();
    await registerPushToken(userId, `ExponentPushToken[guard-live-${SUFFIX}]`, "ios");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendPushToUser(userId, { title: "t", body: "b" });

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
