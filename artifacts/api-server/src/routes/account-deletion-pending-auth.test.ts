import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import request from "supertest";
import bcryptjs from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/push-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/push-notifications")>();
  return { ...actual, sendPushToUser: vi.fn(async () => true) };
});

import app from "../app";
import { generateToken } from "../lib/auth";

/**
 * Pending-deletion auth lifecycle (WS3 hardening).
 *
 * Contract under test:
 *  - A user with a CANCELLABLE deletion request (REQUESTED /
 *    DISABLED_PENDING_RETENTION) is locked out of the app with
 *    403 ACCOUNT_DELETION_PENDING — deliberately NOT 401, because the mobile
 *    client treats 401 as a dead session and strips the very token the user
 *    needs to reach the cancel endpoint.
 *  - The dedicated deletion-status / deletion-cancel endpoints stay reachable
 *    with that same token.
 *  - Cancelling restores the trader profile's public visibility flag
 *    (isActive=true) — the mirror of the request path that hid it.
 *  - Terminal states (ANONYMISED) behave like a deleted account: plain 401.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `adp-test+${label}-${SUFFIX}@example.test`;
const PASSWORD = "cancel-me-123!";

const createdUserIds: number[] = [];
let passwordHash: string;

async function createPendingTrader(
  label: string,
  deletionStatus: string,
): Promise<{ id: number; token: string; profileId: number }> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(label),
      passwordHash,
      fullName: `ADP Test ${label}`,
      role: "trader",
      isActive: true,
      emailVerified: true,
      deletionStatus,
      deletionRequestedAt: new Date(),
      accountDisabledAt: new Date(),
      marketingOptOutAt: new Date(),
    })
    .returning({ id: usersTable.id, tokenVersion: usersTable.tokenVersion });
  createdUserIds.push(u.id);
  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId: u.id,
      businessName: `ADP Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000070",
      mainCategory: "plumbing",
      town: "London",
      postcode: "SW1A 1AA",
      // The deletion request hid the profile; cancel must restore it.
      isActive: false,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
    })
    .returning({ id: traderProfilesTable.id });
  return {
    id: u.id,
    token: generateToken(u.id, "trader", u.tokenVersion ?? 1),
    profileId: p.id,
  };
}

beforeAll(async () => {
  passwordHash = await bcryptjs.hash(PASSWORD, 4);
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db
      .delete(traderAuditLogTable)
      .where(inArray(traderAuditLogTable.userId, createdUserIds));
    await db
      .delete(traderProfilesTable)
      .where(inArray(traderProfilesTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("pending-deletion auth lifecycle", () => {
  it("locks a REQUESTED account out of normal routes with 403 ACCOUNT_DELETION_PENDING (never 401)", async () => {
    const t = await createPendingTrader("locked", "REQUESTED");
    // A regular authMiddleware route — locked with the distinct 403 code.
    const res = await request(app)
      .get("/api/conversations")
      .set("Authorization", `Bearer ${t.token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_DELETION_PENDING");

    // /auth/me stays reachable (authMiddlewareAllowDeletion) and reports the
    // deletionStatus the mobile client uses to route to the cancel screen.
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${t.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user?.deletionStatus ?? me.body.deletionStatus).toBe("REQUESTED");
  });

  it("keeps deletion-status reachable with the same token", async () => {
    const t = await createPendingTrader("status", "DISABLED_PENDING_RETENTION");
    const res = await request(app)
      .get("/api/account/deletion-status")
      .set("Authorization", `Bearer ${t.token}`);
    expect(res.status).toBe(200);
    expect(res.body.deletionStatus).toBe("DISABLED_PENDING_RETENTION");
  });

  it("cancel restores the account AND the trader profile's isActive flag", async () => {
    const t = await createPendingTrader("cancel", "REQUESTED");

    const cancel = await request(app)
      .post("/api/account/deletion-cancel")
      .set("Authorization", `Bearer ${t.token}`)
      .send({ password: PASSWORD, confirm: true });
    expect(cancel.status).toBe(200);

    const [user] = await db
      .select({ deletionStatus: usersTable.deletionStatus })
      .from(usersTable)
      .where(eq(usersTable.id, t.id))
      .limit(1);
    expect(user.deletionStatus).toBeNull();

    const [profile] = await db
      .select({ isActive: traderProfilesTable.isActive })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, t.profileId))
      .limit(1);
    expect(profile.isActive).toBe(true);

    // Same token works again — normal app access restored.
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${t.token}`);
    expect(me.status).toBe(200);
  });

  it("terminal ANONYMISED accounts get a plain 401 everywhere", async () => {
    const t = await createPendingTrader("terminal", "ANONYMISED");
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${t.token}`);
    expect(me.status).toBe(401);
    const status = await request(app)
      .get("/api/account/deletion-status")
      .set("Authorization", `Bearer ${t.token}`);
    expect(status.status).toBe(401);
  });
});
