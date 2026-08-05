import { describe, it, afterAll, expect } from "vitest";
import request from "supertest";
import bcryptjs from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, traderProfilesTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";

/**
 * Tests for the in-app email verification code flow (POST /auth/verify-email-code)
 * and its parity with the web-link flow (GET /auth/verify-email).
 *
 * Security focus: the code endpoint is unauthenticated, so it must NOT leak
 * whether an email is registered or already verified. Every non-lockout failure
 * (unknown email, already verified, missing/expired code, wrong code) must
 * return the same generic 400.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `verify-code-test+${label}-${SUFFIX}@example.test`;
const CODE = "123456";

const createdUserIds: number[] = [];

async function createUnverifiedUser(
  role: "customer" | "trader",
  label: string,
  overrides: Partial<{
    emailVerified: boolean;
    emailOtpHash: string | null;
    emailOtpExpiresAt: Date | null;
    emailOtpAttempts: number;
    isActive: boolean;
  }> = {},
): Promise<{ id: number; email: string }> {
  const email = emailFor(`${role}-${label}`);
  const [u] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Test ${role} ${label}`,
      role,
      isActive: overrides.isActive ?? false,
      emailVerified: overrides.emailVerified ?? false,
      emailOtpHash:
        overrides.emailOtpHash === undefined
          ? await bcryptjs.hash(CODE, 10)
          : overrides.emailOtpHash,
      emailOtpExpiresAt:
        overrides.emailOtpExpiresAt === undefined
          ? new Date(Date.now() + 10 * 60 * 1000)
          : overrides.emailOtpExpiresAt,
      emailOtpAttempts: overrides.emailOtpAttempts ?? 0,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  createdUserIds.push(u.id);
  return u;
}

async function createTraderProfile(userId: number, label: string): Promise<void> {
  await db.insert(traderProfilesTable).values({
    userId,
    businessName: `Biz ${label}`,
    contactName: `Contact ${label}`,
    email: emailFor(`profile-${label}`),
    phone: "07000000000",
    mainCategory: "plumbing",
    town: "London",
    postcode: "SW1A 1AA",
  });
}

afterAll(async () => {
  if (createdUserIds.length) {
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("POST /auth/verify-email-code — success", () => {
  it("verifies a customer, activates them, issues a session, and clears the OTP", async () => {
    const user = await createUnverifiedUser("customer", "ok");

    const res = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email: user.email, code: CODE });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.isActive).toBe(true);
    expect(res.body.user.role).toBe("customer");

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    expect(row.emailVerified).toBe(true);
    expect(row.isActive).toBe(true);
    expect(row.emailOtpHash).toBeNull();
    expect(row.emailOtpExpiresAt).toBeNull();
    expect(row.emailVerificationToken).toBeNull();
  });

  it("verifies a trader, keeps them inactive, and transitions to PENDING_PHONE_VERIFICATION", async () => {
    const user = await createUnverifiedUser("trader", "ok");
    await createTraderProfile(user.id, "ok");

    const res = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email: user.email, code: CODE });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.isActive).toBe(false);

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    expect(row.emailVerified).toBe(true);
    expect(row.isActive).toBe(false);

    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, user.id))
      .limit(1);
    expect(profile.verificationStatus).toBe("PENDING_PHONE_VERIFICATION");
  });
});

describe("POST /auth/verify-email-code — failures are uniform (no enumeration)", () => {
  it("returns a generic 400 for a wrong code and increments the attempt counter", async () => {
    const user = await createUnverifiedUser("customer", "wrong");

    const res = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email: user.email, code: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CODE");
    expect(res.body.attemptsRemaining).toBeUndefined();

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    expect(row.emailOtpAttempts).toBe(1);
    expect(row.emailVerified).toBe(false);
  });

  it("returns 429 once the attempt limit is reached", async () => {
    const user = await createUnverifiedUser("customer", "lockout", { emailOtpAttempts: 4 });

    const res = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email: user.email, code: "000000" });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("returns a generic 400 for an expired code (not a distinct expiry message)", async () => {
    const user = await createUnverifiedUser("customer", "expired", {
      emailOtpExpiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email: user.email, code: CODE });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CODE");
  });

  it("returns a generic 400 for an unknown email", async () => {
    const res = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email: emailFor("does-not-exist"), code: CODE });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CODE");
  });

  it("returns a generic 400 for an already-verified email (does not reveal verified state)", async () => {
    const user = await createUnverifiedUser("customer", "already", {
      emailVerified: true,
      emailOtpHash: null,
      emailOtpExpiresAt: null,
      isActive: true,
    });

    const res = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email: user.email, code: CODE });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CODE");
  });

  it("rejects a non 6-digit code with a 400", async () => {
    const user = await createUnverifiedUser("customer", "format");

    const res = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email: user.email, code: "12" });

    expect(res.status).toBe(400);
  });
});

describe("Link/code parity — GET /auth/verify-email shares finalize", () => {
  it("the web-link path also transitions a trader to PENDING_PHONE_VERIFICATION", async () => {
    const token = `verify-token-${SUFFIX}-parity`;
    const user = await createUnverifiedUser("trader", "parity", {
      emailOtpHash: null,
      emailOtpExpiresAt: null,
    });
    await db
      .update(usersTable)
      .set({
        emailVerificationToken: token,
        emailVerificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .where(eq(usersTable.id, user.id));
    await createTraderProfile(user.id, "parity");

    const res = await request(app).get(`/api/auth/verify-email?token=${token}`);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    expect(row.emailVerified).toBe(true);
    expect(row.isActive).toBe(false);

    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, user.id))
      .limit(1);
    expect(profile.verificationStatus).toBe("PENDING_PHONE_VERIFICATION");
  });
});
