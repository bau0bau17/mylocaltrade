import { describe, it, afterAll, expect } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken, revokeUserSessions } from "../lib/auth";

/**
 * Security regression tests for session revocation and account state.
 *
 * These verify that bearer tokens are immediately invalidated when:
 *  - an account is soft-deleted (deletedAt set)
 *  - an admin account is deactivated (isActive = false)
 *  - the tokenVersion is bumped (explicit session revocation)
 *
 * Each test creates its own scoped fixture and tears it down at the end.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `revocation-test+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];

async function createUser(
  role: "customer" | "trader" | "admin",
  label: string,
  overrides: Partial<{ isActive: boolean; deletedAt: Date | null }> = {},
): Promise<{ id: number; tokenVersion: number }> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Test ${role} ${label}`,
      role,
      isActive: overrides.isActive ?? true,
      emailVerified: true,
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning({ id: usersTable.id, tokenVersion: usersTable.tokenVersion });
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("Session revocation — deleted accounts", () => {
  it("rejects a valid JWT when the user account has been soft-deleted", async () => {
    const user = await createUser("customer", "soft-delete");
    const token = generateToken(user.id, "customer", user.tokenVersion);

    await db
      .update(usersTable)
      .set({ deletedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it("rejects an admin JWT after the admin account is soft-deleted", async () => {
    const user = await createUser("admin", "soft-delete-admin");
    const token = generateToken(user.id, "admin", user.tokenVersion);

    await db
      .update(usersTable)
      .set({ deletedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});

describe("Session revocation — deactivated admin accounts", () => {
  it("rejects an admin JWT when isActive is set to false", async () => {
    const user = await createUser("admin", "deactivated");
    const token = generateToken(user.id, "admin", user.tokenVersion);

    await db
      .update(usersTable)
      .set({ isActive: false })
      .where(eq(usersTable.id, user.id));

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it("allows a non-admin (trader) JWT through when isActive is false — subscription state", async () => {
    const user = await createUser("trader", "inactive-trader");
    const token = generateToken(user.id, "trader", user.tokenVersion);

    await db
      .update(usersTable)
      .set({ isActive: false })
      .where(eq(usersTable.id, user.id));

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it("allows a non-admin (customer) JWT through when isActive is false", async () => {
    const user = await createUser("customer", "inactive-customer");
    const token = generateToken(user.id, "customer", user.tokenVersion);

    await db
      .update(usersTable)
      .set({ isActive: false })
      .where(eq(usersTable.id, user.id));

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe("Session revocation — tokenVersion mismatch", () => {
  it("rejects a JWT whose tokenVersion is stale after revokeUserSessions()", async () => {
    const user = await createUser("customer", "version-bump");
    const staleToken = generateToken(user.id, "customer", user.tokenVersion);

    await revokeUserSessions(user.id);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${staleToken}`);

    expect(res.status).toBe(401);
  });

  it("rejects a stale admin JWT after revokeUserSessions()", async () => {
    const user = await createUser("admin", "version-bump-admin");
    const staleToken = generateToken(user.id, "admin", user.tokenVersion);

    await revokeUserSessions(user.id);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${staleToken}`);

    expect(res.status).toBe(401);
  });

  it("accepts a freshly issued token after revokeUserSessions() increments version", async () => {
    const user = await createUser("customer", "fresh-after-revoke");
    const staleToken = generateToken(user.id, "customer", user.tokenVersion);

    await revokeUserSessions(user.id);

    const [updated] = await db
      .select({ tokenVersion: usersTable.tokenVersion })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);

    const freshToken = generateToken(user.id, "customer", updated.tokenVersion);

    const staleRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${staleToken}`);
    expect(staleRes.status).toBe(401);

    const freshRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${freshToken}`);
    expect(freshRes.status).toBe(200);
  });

  it("rejects a token with tokenVersion=1 (old format) when DB version is 2", async () => {
    const user = await createUser("customer", "old-format-compat");

    await revokeUserSessions(user.id);

    const legacyToken = generateToken(user.id, "customer", 1);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${legacyToken}`);

    expect(res.status).toBe(401);
  });
});
