import { describe, it, afterAll, expect } from "vitest";
import request from "supertest";
import bcryptjs from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, traderProfilesTable, traderAuditLogTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";

/**
 * Regression tests for the trader email-verification trap (production
 * incident, Aug 2026): a freshly registered trader could never verify —
 * the mobile screen showed a stale "verified" success view while the server
 * row stayed unverified with an intact, unredeemed token.
 *
 * Server-side guarantees under test:
 *  - the link (GET /auth/verify-email) and code (POST /auth/verify-email-code)
 *    paths flip canonical state transactionally and idempotently;
 *  - a token can only ever verify the exact account row it was issued to;
 *  - tombstoned (anonymised/completed-deletion) rows can never be verified,
 *    re-armed, or used to interfere with a replacement account on the same
 *    email;
 *  - re-registration after deletion yields a fresh account that verifies and
 *    logs in normally;
 *  - reused/expired links fail safely without reverting state.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `verify-regression+${label}-${SUFFIX}@example.test`;
const PASSWORD = "Sup3rSecret!pass";
const CODE = "123456";

const createdUserIds: number[] = [];

type UserOverrides = Partial<{
  role: "customer" | "trader";
  emailVerified: boolean;
  isActive: boolean;
  emailVerificationToken: string | null;
  emailVerificationTokenExpiresAt: Date | null;
  emailOtpHash: string | null;
  emailOtpExpiresAt: Date | null;
  emailVerificationSentAt: Date | null;
  deletedAt: Date | null;
  deletionStatus: string | null;
  email: string;
}>;

async function createUser(label: string, overrides: UserOverrides = {}) {
  const email = overrides.email ?? emailFor(label);
  const [u] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: await bcryptjs.hash(PASSWORD, 10),
      fullName: `Test ${label}`,
      role: overrides.role ?? "trader",
      isActive: overrides.isActive ?? false,
      emailVerified: overrides.emailVerified ?? false,
      emailVerificationToken:
        overrides.emailVerificationToken === undefined
          ? `tok-${label}-${SUFFIX}`
          : overrides.emailVerificationToken,
      emailVerificationTokenExpiresAt:
        overrides.emailVerificationTokenExpiresAt === undefined
          ? new Date(Date.now() + 24 * 60 * 60 * 1000)
          : overrides.emailVerificationTokenExpiresAt,
      emailOtpHash:
        overrides.emailOtpHash === undefined
          ? await bcryptjs.hash(CODE, 10)
          : overrides.emailOtpHash,
      emailOtpExpiresAt:
        overrides.emailOtpExpiresAt === undefined
          ? new Date(Date.now() + 10 * 60 * 1000)
          : overrides.emailOtpExpiresAt,
      emailVerificationSentAt: overrides.emailVerificationSentAt ?? null,
      deletedAt: overrides.deletedAt ?? null,
      deletionStatus: (overrides.deletionStatus ?? null) as never,
    })
    .returning();
  createdUserIds.push(u.id);
  return u;
}

async function createTraderProfile(userId: number, label: string) {
  await db.insert(traderProfilesTable).values({
    userId,
    businessName: `Biz ${label}`,
    contactName: `Contact ${label}`,
    email: emailFor(`profile-${label}`),
    phone: "07000000000",
    mainCategory: "plumbing",
    town: "London",
    postcode: "SW1A 1AA",
    verificationStatus: "PENDING_EMAIL_VERIFICATION",
  });
}

async function getUser(id: number) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return row;
}

async function getProfile(userId: number) {
  const [row] = await db
    .select()
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, userId))
    .limit(1);
  return row;
}

afterAll(async () => {
  // Also sweep any rows created via the real registration endpoints.
  const endpointRows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.fullName, `Reg ${SUFFIX}`));
  const ids = [...new Set([...createdUserIds, ...endpointRows.map((r) => r.id)])];
  if (ids.length) {
    await db.delete(traderAuditLogTable).where(inArray(traderAuditLogTable.userId, ids));
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
  }
});

describe("GET /auth/verify-email — canonical state", () => {
  it("verifies a fresh trader via the link: flips emailVerified, clears credentials, advances the profile, unblocks login", async () => {
    const user = await createUser("trader-link");
    await createTraderProfile(user.id, "trader-link");

    // Login is blocked while unverified.
    const before = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });
    expect(before.status).toBe(403);
    expect(before.body.code).toBe("EMAIL_NOT_VERIFIED");

    const res = await request(app).get(
      `/api/auth/verify-email?token=${user.emailVerificationToken}`,
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain("Email Verified");

    const row = await getUser(user.id);
    expect(row.emailVerified).toBe(true);
    expect(row.emailVerificationToken).toBeNull();
    expect(row.emailOtpHash).toBeNull();
    // Traders stay inactive until subscription payment.
    expect(row.isActive).toBe(false);

    const profile = await getProfile(user.id);
    expect(profile.verificationStatus).toBe("PENDING_PHONE_VERIFICATION");

    // Verified state persists across sign-out/sign-in.
    const after = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });
    expect(after.status).toBe(200);
    expect(after.body.token).toBeTruthy();
  });

  it("verifies a customer via the link and activates the account", async () => {
    const user = await createUser("customer-link", { role: "customer" });
    const res = await request(app).get(
      `/api/auth/verify-email?token=${user.emailVerificationToken}`,
    );
    expect(res.status).toBe(200);

    const row = await getUser(user.id);
    expect(row.emailVerified).toBe(true);
    expect(row.isActive).toBe(true);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("re-opening an already-used link fails safely and never reverts verified state", async () => {
    const user = await createUser("trader-reuse");
    await createTraderProfile(user.id, "trader-reuse");
    const token = user.emailVerificationToken!;

    const first = await request(app).get(`/api/auth/verify-email?token=${token}`);
    expect(first.status).toBe(200);

    const second = await request(app).get(`/api/auth/verify-email?token=${token}`);
    expect(second.status).toBe(404); // token cleared on redemption

    const row = await getUser(user.id);
    expect(row.emailVerified).toBe(true); // no revert
    const profile = await getProfile(user.id);
    expect(profile.verificationStatus).toBe("PENDING_PHONE_VERIFICATION"); // no downgrade
  });

  it("still verifies an account in a PENDING deletion state (REQUESTED is not tombstoned)", async () => {
    const user = await createUser("trader-requested", { deletionStatus: "REQUESTED" });
    await createTraderProfile(user.id, "trader-requested");
    const res = await request(app).get(
      `/api/auth/verify-email?token=${user.emailVerificationToken}`,
    );
    expect(res.status).toBe(200);
    expect((await getUser(user.id)).emailVerified).toBe(true);
  });

  it("rejects an expired link without verifying", async () => {
    const user = await createUser("trader-expired", {
      emailVerificationTokenExpiresAt: new Date(Date.now() - 60 * 1000),
    });
    const res = await request(app).get(
      `/api/auth/verify-email?token=${user.emailVerificationToken}`,
    );
    expect(res.status).toBe(410);
    const row = await getUser(user.id);
    expect(row.emailVerified).toBe(false);
  });
});

describe("Tombstoned (deleted) accounts can never verify or interfere", () => {
  it("a leftover token on a COMPLETED-deletion row is rejected and the row stays unverified", async () => {
    const user = await createUser("tomb-completed", {
      deletionStatus: "COMPLETED",
      deletedAt: new Date(),
      email: `deleted-user-${SUFFIX}-a@deleted.mylocaltrade.invalid`,
    });
    const res = await request(app).get(
      `/api/auth/verify-email?token=${user.emailVerificationToken}`,
    );
    expect(res.status).toBe(404);
    const row = await getUser(user.id);
    expect(row.emailVerified).toBe(false);
  });

  it("a leftover token on an ANONYMISED verified row does not leak 'Already Verified'", async () => {
    const user = await createUser("tomb-anon", {
      emailVerified: true,
      deletionStatus: "ANONYMISED",
      deletedAt: new Date(),
      email: `deleted-user-${SUFFIX}-b@deleted.mylocaltrade.invalid`,
    });
    const res = await request(app).get(
      `/api/auth/verify-email?token=${user.emailVerificationToken}`,
    );
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("Already Verified");
  });

  it("the old account's token can never verify the replacement; each token only touches its own row", async () => {
    const sharedEmail = emailFor("reregistered");
    const oldUser = await createUser("old-account", {
      deletionStatus: "COMPLETED",
      deletedAt: new Date(),
      email: `deleted-user-${SUFFIX}-c@deleted.mylocaltrade.invalid`,
      emailVerificationToken: `tok-old-${SUFFIX}`,
    });
    const newUser = await createUser("new-account", {
      email: sharedEmail,
      emailVerificationToken: `tok-new-${SUFFIX}`,
    });
    await createTraderProfile(newUser.id, "new-account");

    // Old token: rejected, nothing changes anywhere.
    const oldRes = await request(app).get(`/api/auth/verify-email?token=tok-old-${SUFFIX}`);
    expect(oldRes.status).toBe(404);
    expect((await getUser(newUser.id)).emailVerified).toBe(false);
    expect((await getUser(oldUser.id)).emailVerified).toBe(false);

    // New token: verifies ONLY the new row.
    const newRes = await request(app).get(`/api/auth/verify-email?token=tok-new-${SUFFIX}`);
    expect(newRes.status).toBe(200);
    expect((await getUser(newUser.id)).emailVerified).toBe(true);
    const oldRow = await getUser(oldUser.id);
    expect(oldRow.emailVerified).toBe(false);
    expect(oldRow.deletionStatus).toBe("COMPLETED");
  });

  it("verify-email-code returns the generic 400 for a tombstoned row with a live OTP", async () => {
    const user = await createUser("tomb-otp", {
      deletionStatus: "ANONYMISED",
      deletedAt: new Date(),
      // Real (non-placeholder) email to exercise the lookup guard itself.
    });
    const res = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email: user.email, code: CODE });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CODE");
    expect((await getUser(user.id)).emailVerified).toBe(false);
  });

  it("resend-verification never re-arms credentials on a tombstoned row", async () => {
    const user = await createUser("tomb-resend", {
      deletionStatus: "ANONYMISED",
      deletedAt: new Date(),
      emailVerificationToken: null,
      emailOtpHash: null,
      emailOtpExpiresAt: null,
      emailVerificationSentAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const res = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: user.email });
    expect(res.status).toBe(200); // generic, no state leak
    const row = await getUser(user.id);
    expect(row.emailVerificationToken).toBeNull();
    expect(row.emailOtpHash).toBeNull();
  });
});

describe("Concurrent link + code redemption", () => {
  it("produces exactly one verified state, one profile transition and one audit entry", async () => {
    const user = await createUser("concurrent");
    await createTraderProfile(user.id, "concurrent");

    const [linkRes, codeRes] = await Promise.all([
      request(app).get(`/api/auth/verify-email?token=${user.emailVerificationToken}`),
      request(app).post("/api/auth/verify-email-code").send({ email: user.email, code: CODE }),
    ]);

    // Both must fail safely or succeed — never 5xx.
    expect(linkRes.status).toBeLessThan(500);
    expect(codeRes.status).toBeLessThan(500);
    // At least one path must have completed the verification.
    expect(
      linkRes.status === 200 || codeRes.status === 200,
    ).toBe(true);

    const row = await getUser(user.id);
    expect(row.emailVerified).toBe(true);
    expect(row.emailVerificationToken).toBeNull();
    expect(row.emailOtpHash).toBeNull();

    const profile = await getProfile(user.id);
    expect(profile.verificationStatus).toBe("PENDING_PHONE_VERIFICATION");

    const audits = await db
      .select()
      .from(traderAuditLogTable)
      .where(
        and(
          eq(traderAuditLogTable.userId, user.id),
          eq(traderAuditLogTable.action, "EMAIL_VERIFIED"),
        ),
      );
    expect(audits.length).toBe(1);
  });
});

describe("Re-registration after deletion (end-to-end via real endpoints)", () => {
  it("a customer can re-register on a released email, verify via the NEW link and log in", async () => {
    const email = emailFor("rereg-customer");

    // Old tombstoned account whose email was released (placeholder swap).
    await createUser("rereg-old", {
      deletionStatus: "COMPLETED",
      deletedAt: new Date(),
      email: `deleted-user-${SUFFIX}-d@deleted.mylocaltrade.invalid`,
      emailVerificationToken: `tok-rereg-old-${SUFFIX}`,
    });

    const reg = await request(app)
      .post("/api/auth/register/customer")
      .send({ email, password: PASSWORD, fullName: `Reg ${SUFFIX}` });
    expect(reg.status).toBe(201);
    expect(reg.body.pollToken).toBeTruthy();

    const [newRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);
    createdUserIds.push(newRow.id);
    expect(newRow.emailVerified).toBe(false);
    expect(newRow.emailVerificationToken).toBeTruthy();

    // Poll (what the app's verify screen does) reports unverified pre-link.
    const pollBefore = await request(app).get(
      `/api/auth/verification-status?token=${reg.body.pollToken}`,
    );
    expect(pollBefore.status).toBe(200);
    expect(pollBefore.body.verified).toBe(false);

    // The OLD account's stale token still cannot hijack anything.
    const hijack = await request(app).get(
      `/api/auth/verify-email?token=tok-rereg-old-${SUFFIX}`,
    );
    expect(hijack.status).toBe(404);
    expect((await getUser(newRow.id)).emailVerified).toBe(false);

    // The NEW link verifies the new account.
    const verify = await request(app).get(
      `/api/auth/verify-email?token=${newRow.emailVerificationToken}`,
    );
    expect(verify.status).toBe(200);

    const pollAfter = await request(app).get(
      `/api/auth/verification-status?token=${reg.body.pollToken}`,
    );
    expect(pollAfter.body.verified).toBe(true);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("a trader can re-register on a released email and verify via the in-app code", async () => {
    const email = emailFor("rereg-trader");

    const reg = await request(app)
      .post("/api/auth/register/trader")
      .send({
        email,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        termsAccepted: true,
        privacyAccepted: true,
        contactName: `Reg ${SUFFIX}`,
        businessName: `Reg Biz ${SUFFIX}`,
        phone: "07000000001",
        mainCategory: "plumbing",
        businessAddress: "1 Test Street",
        town: "London",
        postcode: "SW1A 1AA",
      });
    expect(reg.status).toBe(201);

    const [newRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);
    createdUserIds.push(newRow.id);

    // Simulate the in-app code path: overwrite the OTP hash with a known code
    // (the emailed value is not observable in tests).
    await db
      .update(usersTable)
      .set({ emailOtpHash: await bcryptjs.hash(CODE, 10), emailOtpAttempts: 0 })
      .where(eq(usersTable.id, newRow.id));

    const verify = await request(app)
      .post("/api/auth/verify-email-code")
      .send({ email, code: CODE });
    expect(verify.status).toBe(200);
    expect(verify.body.token).toBeTruthy();

    const row = await getUser(newRow.id);
    expect(row.emailVerified).toBe(true);
    const profile = await getProfile(newRow.id);
    expect(profile.verificationStatus).toBe("PENDING_PHONE_VERIFICATION");
  });
});
