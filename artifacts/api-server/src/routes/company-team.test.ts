import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  companyMembersTable,
  companyInvitesTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { eq, inArray, and, or } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import { ensureCompanyTeamsBackfill } from "../lib/company-backfill";

/**
 * Company Teams Phase 1 — invitations & team management.
 *
 * Contract under test:
 *  - Flag OFF (default): every /company/* management + public invite route
 *    404s (fail closed); team-context reports {enabled:false}.
 *  - Flag ON: owner-only management (employees/customers rejected), strict
 *    brand-new-email invites, seat cap incl. pending invites, single-use
 *    hashed tokens with atomic acceptance, immediate access loss on removal,
 *    audit events for all five lifecycle actions.
 *
 * NOTE on rate limits: /company/invites/lookup + /accept share a Postgres
 * rate limiter (20 req / 15 min per IP). test-setup truncates rate_limit_hits
 * at run start; this file keeps its combined lookup+accept call count well
 * under the budget.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `team-test+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdInviteIds: number[] = [];

const EXTERNAL_FLAG = process.env["COMPANY_TEAMS_ENABLED"];

function setFlag(on: boolean): void {
  if (on) process.env["COMPANY_TEAMS_ENABLED"] = "true";
  else delete process.env["COMPANY_TEAMS_ENABLED"];
}

function restoreFlag(): void {
  if (EXTERNAL_FLAG === undefined) delete process.env["COMPANY_TEAMS_ENABLED"];
  else process.env["COMPANY_TEAMS_ENABLED"] = EXTERNAL_FLAG;
}

function sha256Hex(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function createUser(
  role: "customer" | "trader",
  label: string,
  emailOverride?: string,
): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailOverride ?? emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Team Test ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      phone: "+447000000021",
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
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
      businessName: `Team Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000020",
      mainCategory: "plumbing",
      town: "London",
      postcode: "SW1A 1AA",
      isActive: true,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
    })
    .returning({ id: traderProfilesTable.id });
  createdProfileIds.push(p.id);
  return p.id;
}

async function insertMembership(opts: {
  profileId: number;
  userId: number;
  role?: "OWNER" | "EMPLOYEE";
  status?: "ACTIVE" | "REVOKED";
}): Promise<number> {
  const [m] = await db
    .insert(companyMembersTable)
    .values({
      traderProfileId: opts.profileId,
      userId: opts.userId,
      role: opts.role ?? "EMPLOYEE",
      status: opts.status ?? "ACTIVE",
    })
    .returning({ id: companyMembersTable.id });
  return m.id;
}

async function insertInvite(opts: {
  profileId: number;
  email: string;
  rawToken: string;
  invitedBy: number;
  status?: "PENDING" | "ACCEPTED" | "CANCELLED" | "EXPIRED";
  expiresAt?: Date;
}): Promise<number> {
  const [row] = await db
    .insert(companyInvitesTable)
    .values({
      traderProfileId: opts.profileId,
      email: opts.email.toLowerCase(),
      role: "EMPLOYEE",
      status: opts.status ?? "PENDING",
      tokenHash: sha256Hex(opts.rawToken),
      invitedByUserId: opts.invitedBy,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: companyInvitesTable.id });
  createdInviteIds.push(row.id);
  return row.id;
}

async function getInvite(id: number) {
  const [row] = await db
    .select()
    .from(companyInvitesTable)
    .where(eq(companyInvitesTable.id, id))
    .limit(1);
  return row;
}

async function auditRows(action: string, ownerUserId: number) {
  return db
    .select()
    .from(traderAuditLogTable)
    .where(
      and(eq(traderAuditLogTable.action, action), eq(traderAuditLogTable.userId, ownerUserId)),
    );
}

interface Ctx {
  ownerUserId: number;
  ownerToken: string;
  companyProfileId: number;
  employeeUserId: number;
  employeeToken: string;
  otherOwnerUserId: number;
  otherProfileId: number;
  otherOwnerToken: string;
  customerId: number;
  customerToken: string;
  customerEmail: string;
  bareTraderToken: string;
}

let ctx: Ctx;

beforeAll(async () => {
  const ownerUserId = await createUser("trader", "owner");
  const companyProfileId = await createTraderProfile(ownerUserId, "main");
  const employeeUserId = await createUser("trader", "employee");
  await insertMembership({ profileId: companyProfileId, userId: employeeUserId });
  const otherOwnerUserId = await createUser("trader", "other-owner");
  const otherProfileId = await createTraderProfile(otherOwnerUserId, "other");
  const customerEmail = emailFor("customer-existing");
  const customerId = await createUser("customer", "existing", customerEmail);
  const bareTraderId = await createUser("trader", "bare");

  ctx = {
    ownerUserId,
    ownerToken: generateToken(ownerUserId, "trader"),
    companyProfileId,
    employeeUserId,
    employeeToken: generateToken(employeeUserId, "trader"),
    otherOwnerUserId,
    otherProfileId,
    otherOwnerToken: generateToken(otherOwnerUserId, "trader"),
    customerId,
    customerToken: generateToken(customerId, "customer"),
    customerEmail,
    bareTraderToken: generateToken(bareTraderId, "trader"),
  };
});

afterEach(() => {
  restoreFlag();
  delete process.env["COMPANY_MAX_ACTIVE_MEMBERS"];
});

afterAll(async () => {
  restoreFlag();
  delete process.env["COMPANY_MAX_ACTIVE_MEMBERS"];
  // Order matters: audit + invites reference users; memberships reference both.
  if (createdUserIds.length > 0) {
    await db
      .delete(traderAuditLogTable)
      .where(
        or(
          inArray(traderAuditLogTable.userId, createdUserIds),
          inArray(traderAuditLogTable.performedBy, createdUserIds),
        ),
      );
  }
  if (createdProfileIds.length > 0) {
    await db
      .delete(companyInvitesTable)
      .where(inArray(companyInvitesTable.traderProfileId, createdProfileIds));
    await db
      .delete(companyMembersTable)
      .where(inArray(companyMembersTable.traderProfileId, createdProfileIds));
  }
  if (createdUserIds.length > 0) {
    await db
      .delete(companyMembersTable)
      .where(inArray(companyMembersTable.userId, createdUserIds));
  }
  if (createdProfileIds.length > 0) {
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

// ---------------------------------------------------------------------------
// Flag OFF — everything fails closed
// ---------------------------------------------------------------------------

describe("flag OFF (default)", () => {
  it("team-context reports disabled", async () => {
    setFlag(false);
    const res = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, role: null });
  });

  it("management routes 404", async () => {
    setFlag(false);
    const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect((await auth(request(app).get("/api/company/team"))).status).toBe(404);
    expect(
      (await auth(request(app).post("/api/company/invites").send({ email: "x@y.com" }))).status,
    ).toBe(404);
    expect((await auth(request(app).post("/api/company/invites/1/resend"))).status).toBe(404);
    expect((await auth(request(app).post("/api/company/invites/1/cancel"))).status).toBe(404);
    expect((await auth(request(app).post("/api/company/members/1/remove"))).status).toBe(404);
  });

  it("public lookup and accept 404", async () => {
    setFlag(false);
    const lookup = await request(app)
      .post("/api/company/invites/lookup")
      .send({ token: "definitely-not-a-real-token-123" });
    expect(lookup.status).toBe(404);
    const accept = await request(app)
      .post("/api/company/invites/accept")
      .send({ token: "definitely-not-a-real-token-123", fullName: "X", password: "Password123!" });
    expect(accept.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// team-context (flag ON)
// ---------------------------------------------------------------------------

describe("team-context (flag ON)", () => {
  it("owner → OWNER, employee → EMPLOYEE, profile-less trader → null", async () => {
    setFlag(true);
    const owner = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(owner.body).toEqual({ enabled: true, role: "OWNER" });

    const employee = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${ctx.employeeToken}`);
    expect(employee.body).toEqual({ enabled: true, role: "EMPLOYEE" });

    const bare = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${ctx.bareTraderToken}`);
    expect(bare.body).toEqual({ enabled: true, role: null });
  });

  it("customers cannot use it", async () => {
    setFlag(true);
    const res = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${ctx.customerToken}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /company/team
// ---------------------------------------------------------------------------

describe("GET /company/team", () => {
  it("requires auth and OWNER role", async () => {
    setFlag(true);
    expect((await request(app).get("/api/company/team")).status).toBe(401);
    const emp = await request(app)
      .get("/api/company/team")
      .set("Authorization", `Bearer ${ctx.employeeToken}`);
    expect(emp.status).toBe(403);
    expect(emp.body.code).toBe("OWNER_ONLY");
  });

  it("lists owner (self-healed row) + employee with seat usage", async () => {
    setFlag(true);
    const res = await request(app)
      .get("/api/company/team")
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(2);
    // Owner first (ordered), even though their membership row was only
    // created on demand (post-boot registration self-heal).
    expect(res.body.members[0].role).toBe("OWNER");
    expect(res.body.members[0].userId).toBe(ctx.ownerUserId);
    expect(res.body.members[1].role).toBe("EMPLOYEE");
    expect(res.body.members[1].email).toContain("team-test+trader-employee");
    expect(res.body.invites).toEqual([]);
    expect(res.body.seats).toEqual({ used: 2, max: 10 });
  });
});

// ---------------------------------------------------------------------------
// POST /company/invites
// ---------------------------------------------------------------------------

describe("POST /company/invites", () => {
  const invite = (token: string, email: string) =>
    request(app)
      .post("/api/company/invites")
      .set("Authorization", `Bearer ${token}`)
      .send({ email });

  it("rejects invalid email", async () => {
    setFlag(true);
    expect((await invite(ctx.ownerToken, "not-an-email")).status).toBe(400);
  });

  it("rejects any existing account email, case-insensitively", async () => {
    setFlag(true);
    const exact = await invite(ctx.ownerToken, ctx.customerEmail);
    expect(exact.status).toBe(409);
    expect(exact.body.code).toBe("EMAIL_IN_USE");
    const upper = await invite(ctx.ownerToken, ctx.customerEmail.toUpperCase());
    expect(upper.status).toBe(409);
    expect(upper.body.code).toBe("EMAIL_IN_USE");
  });

  it("enforces the seat cap counting active members + pending invites", async () => {
    setFlag(true);
    // 2 active members (owner + employee), 0 pending at this point.
    process.env["COMPANY_MAX_ACTIVE_MEMBERS"] = "2";
    const res = await invite(ctx.ownerToken, emailFor("capped"));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MEMBER_LIMIT_REACHED");
  });

  it("creates a pending invite with hashed token and audit event", async () => {
    setFlag(true);
    const email = emailFor("first-invitee");
    const res = await invite(ctx.ownerToken, `  ${email.toUpperCase()}  `);
    expect(res.status).toBe(201);
    expect(res.body.invite.email).toBe(email.toLowerCase());
    expect(res.body.invite.status).toBe("PENDING");

    const row = await getInvite(res.body.invite.id);
    createdInviteIds.push(row.id);
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.invitedByUserId).toBe(ctx.ownerUserId);
    const expiresInMs = row.expiresAt.getTime() - Date.now();
    expect(expiresInMs).toBeGreaterThan(6.5 * 24 * 60 * 60 * 1000);
    expect(expiresInMs).toBeLessThan(7.5 * 24 * 60 * 60 * 1000);

    const audits = await auditRows("MEMBER_INVITED", ctx.ownerUserId);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits.at(-1)!.performedBy).toBe(ctx.ownerUserId);

    // Same email again → dedupe.
    const dup = await invite(ctx.ownerToken, email);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("INVITE_EXISTS");

    // …but a DIFFERENT company may invite the same address.
    const other = await invite(ctx.otherOwnerToken, email);
    expect(other.status).toBe(201);
    createdInviteIds.push(other.body.invite.id);
  });

  it("rejects employees", async () => {
    setFlag(true);
    const res = await invite(ctx.employeeToken, emailFor("nope"));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_ONLY");
  });
});

// ---------------------------------------------------------------------------
// POST /company/invites/lookup (public)
// ---------------------------------------------------------------------------

describe("POST /company/invites/lookup", () => {
  const lookup = (token: string) =>
    request(app).post("/api/company/invites/lookup").send({ token });

  it("returns company name + email for a valid pending invite", async () => {
    setFlag(true);
    const raw = `lookup-valid-${SUFFIX}-0000`;
    await insertInvite({
      profileId: ctx.companyProfileId,
      email: emailFor("lookup-valid"),
      rawToken: raw,
      invitedBy: ctx.ownerUserId,
    });
    const res = await lookup(raw);
    expect(res.status).toBe(200);
    expect(res.body.companyName).toContain("Team Trades main");
    expect(res.body.email).toBe(emailFor("lookup-valid").toLowerCase());
  });

  it("expired, cancelled and garbage tokens all get the same generic 404", async () => {
    setFlag(true);
    const expiredRaw = `lookup-expired-${SUFFIX}-0000`;
    await insertInvite({
      profileId: ctx.companyProfileId,
      email: emailFor("lookup-expired"),
      rawToken: expiredRaw,
      invitedBy: ctx.ownerUserId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const cancelledRaw = `lookup-cancelled-${SUFFIX}-0000`;
    await insertInvite({
      profileId: ctx.companyProfileId,
      email: emailFor("lookup-cancelled"),
      rawToken: cancelledRaw,
      invitedBy: ctx.ownerUserId,
      status: "CANCELLED",
    });

    const expired = await lookup(expiredRaw);
    const cancelled = await lookup(cancelledRaw);
    const garbage = await lookup("garbage-token-that-matches-nothing");
    expect(expired.status).toBe(404);
    expect(cancelled.status).toBe(404);
    expect(garbage.status).toBe(404);
    // Indistinguishable bodies — the endpoint is not a state oracle.
    expect(expired.body).toEqual(garbage.body);
    expect(cancelled.body).toEqual(garbage.body);
  });
});

// ---------------------------------------------------------------------------
// POST /company/invites/accept (public)
// ---------------------------------------------------------------------------

describe("POST /company/invites/accept", () => {
  const accept = (token: string, fullName = "Alex Employee", password = "Password123!") =>
    request(app).post("/api/company/invites/accept").send({ token, fullName, password });

  it("creates the account + membership atomically and the session works", async () => {
    setFlag(true);
    const raw = `accept-happy-${SUFFIX}-0000`;
    const email = emailFor("accept-happy");
    const inviteId = await insertInvite({
      profileId: ctx.companyProfileId,
      email,
      rawToken: raw,
      invitedBy: ctx.ownerUserId,
    });

    const res = await accept(raw, "Sam Newstarter");
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.email).toBe(email.toLowerCase());
    expect(res.body.user.role).toBe("trader");
    expect(res.body.company.name).toContain("Team Trades main");
    createdUserIds.push(res.body.user.id);

    const [userRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, res.body.user.id));
    expect(userRow.emailVerified).toBe(true);
    expect(userRow.isActive).toBe(true);

    const [memberRow] = await db
      .select()
      .from(companyMembersTable)
      .where(eq(companyMembersTable.userId, res.body.user.id));
    expect(memberRow.traderProfileId).toBe(ctx.companyProfileId);
    expect(memberRow.role).toBe("EMPLOYEE");
    expect(memberRow.status).toBe("ACTIVE");
    expect(memberRow.invitedByUserId).toBe(ctx.ownerUserId);

    const inviteRow = await getInvite(inviteId);
    expect(inviteRow.status).toBe("ACCEPTED");
    expect(inviteRow.acceptedByUserId).toBe(res.body.user.id);
    expect(inviteRow.acceptedAt).not.toBeNull();

    const audits = await auditRows("MEMBER_INVITE_ACCEPTED", ctx.ownerUserId);
    expect(audits.length).toBeGreaterThanOrEqual(1);

    // The issued session is immediately usable — and scoped as EMPLOYEE.
    const meCtx = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${res.body.token}`);
    expect(meCtx.body).toEqual({ enabled: true, role: "EMPLOYEE" });

    // Single use: the same token again fails generically.
    const again = await accept(raw);
    expect(again.status).toBe(400);
    expect(again.body).toEqual({ error: "This invitation is no longer valid." });
  });

  it("exactly one of two concurrent accepts wins", async () => {
    setFlag(true);
    const raw = `accept-race-${SUFFIX}-0000`;
    const email = emailFor("accept-race");
    await insertInvite({
      profileId: ctx.companyProfileId,
      email,
      rawToken: raw,
      invitedBy: ctx.ownerUserId,
    });

    const [a, b] = await Promise.all([accept(raw, "Racer One"), accept(raw, "Racer Two")]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);
    const winner = a.status === 201 ? a : b;
    createdUserIds.push(winner.body.user.id);

    const users = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()));
    expect(users).toHaveLength(1);
  });

  it("cancelled and expired invites cannot be accepted", async () => {
    setFlag(true);
    const cancelRaw = `accept-cancelled-${SUFFIX}-0000`;
    const cancelId = await insertInvite({
      profileId: ctx.companyProfileId,
      email: emailFor("accept-cancelled"),
      rawToken: cancelRaw,
      invitedBy: ctx.ownerUserId,
    });
    // Owner cancels through the API (covers the cancel happy path + audit)…
    const cancelRes = await request(app)
      .post(`/api/company/invites/${cancelId}/cancel`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(cancelRes.status).toBe(200);
    expect((await getInvite(cancelId)).status).toBe("CANCELLED");
    expect(
      (await auditRows("MEMBER_INVITE_CANCELLED", ctx.ownerUserId)).length,
    ).toBeGreaterThanOrEqual(1);
    // …then acceptance fails generically.
    expect((await accept(cancelRaw)).status).toBe(400);

    const expiredRaw = `accept-expired-${SUFFIX}-0000`;
    await insertInvite({
      profileId: ctx.companyProfileId,
      email: emailFor("accept-expired"),
      rawToken: expiredRaw,
      invitedBy: ctx.ownerUserId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect((await accept(expiredRaw)).status).toBe(400);
  });

  it("rolls back fully when the email gained an account since the invite", async () => {
    setFlag(true);
    const raw = `accept-email-taken-${SUFFIX}-0000`;
    const email = emailFor("accept-email-taken");
    const inviteId = await insertInvite({
      profileId: ctx.companyProfileId,
      email,
      rawToken: raw,
      invitedBy: ctx.ownerUserId,
    });
    // Someone registers this address after the invite went out.
    await createUser("customer", "email-taken", email);

    const res = await accept(raw);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "This invitation is no longer valid." });

    // Rollback left the invite PENDING (owner can still see + cancel it), and
    // no duplicate user was created.
    expect((await getInvite(inviteId)).status).toBe("PENDING");
    const users = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()));
    expect(users).toHaveLength(1);
  });

  it("validation failures don't burn the token", async () => {
    setFlag(true);
    const raw = `accept-weak-pw-${SUFFIX}-0000`;
    const inviteId = await insertInvite({
      profileId: ctx.companyProfileId,
      email: emailFor("accept-weak-pw"),
      rawToken: raw,
      invitedBy: ctx.ownerUserId,
    });
    const weak = await accept(raw, "Sam Short", "short");
    expect(weak.status).toBe(400);
    expect(weak.body.error).toContain("at least 8 characters");
    expect((await getInvite(inviteId)).status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// POST /company/invites/:id/resend
// ---------------------------------------------------------------------------

describe("POST /company/invites/:id/resend", () => {
  it("rotates the token — the old link dies", async () => {
    setFlag(true);
    const raw = `resend-rotate-${SUFFIX}-0000`;
    const inviteId = await insertInvite({
      profileId: ctx.companyProfileId,
      email: emailFor("resend-rotate"),
      rawToken: raw,
      invitedBy: ctx.ownerUserId,
    });
    const before = await getInvite(inviteId);

    const res = await request(app)
      .post(`/api/company/invites/${inviteId}/resend`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.invite.status).toBe("PENDING");

    const after = await getInvite(inviteId);
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());

    // Old token no longer resolves.
    const oldLookup = await request(app)
      .post("/api/company/invites/lookup")
      .send({ token: raw });
    expect(oldLookup.status).toBe(404);

    expect(
      (await auditRows("MEMBER_INVITE_RESENT", ctx.ownerUserId)).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("re-arming an expired invite re-checks the seat cap", async () => {
    setFlag(true);
    const inviteId = await insertInvite({
      profileId: ctx.companyProfileId,
      email: emailFor("resend-expired-cap"),
      rawToken: `resend-expired-${SUFFIX}-0000`,
      invitedBy: ctx.ownerUserId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    // Freeze the cap at the CURRENT usage — re-arming must then overflow.
    const team = await request(app)
      .get("/api/company/team")
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    process.env["COMPANY_MAX_ACTIVE_MEMBERS"] = String(team.body.seats.used);

    const blocked = await request(app)
      .post(`/api/company/invites/${inviteId}/resend`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("MEMBER_LIMIT_REACHED");

    // With headroom the same resend succeeds (recovery path for expiry).
    delete process.env["COMPANY_MAX_ACTIVE_MEMBERS"];
    const ok = await request(app)
      .post(`/api/company/invites/${inviteId}/resend`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body.invite.status).toBe("PENDING");
  });

  it("cancelled invites can't be resent; other companies can't touch them", async () => {
    setFlag(true);
    const inviteId = await insertInvite({
      profileId: ctx.companyProfileId,
      email: emailFor("resend-cancelled"),
      rawToken: `resend-cancelled-${SUFFIX}-0000`,
      invitedBy: ctx.ownerUserId,
      status: "CANCELLED",
    });
    const cancelled = await request(app)
      .post(`/api/company/invites/${inviteId}/resend`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(cancelled.status).toBe(409);

    const crossCompany = await request(app)
      .post(`/api/company/invites/${inviteId}/resend`)
      .set("Authorization", `Bearer ${ctx.otherOwnerToken}`);
    expect(crossCompany.status).toBe(404);

    const doubleCancel = await request(app)
      .post(`/api/company/invites/${inviteId}/cancel`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(doubleCancel.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /company/members/:id/remove
// ---------------------------------------------------------------------------

describe("POST /company/members/:id/remove", () => {
  it("revokes an employee and kills their access immediately (existing session)", async () => {
    setFlag(true);
    const removeeId = await createUser("trader", "removee");
    const memberId = await insertMembership({
      profileId: ctx.companyProfileId,
      userId: removeeId,
    });
    const removeeToken = generateToken(removeeId, "trader");

    // Sanity: the employee currently HAS access with this exact token.
    const beforeCtx = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${removeeToken}`);
    expect(beforeCtx.body).toEqual({ enabled: true, role: "EMPLOYEE" });

    const res = await request(app)
      .post(`/api/company/members/${memberId}/remove`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(companyMembersTable)
      .where(eq(companyMembersTable.id, memberId));
    expect(row.status).toBe("REVOKED");
    expect(row.revokedByUserId).toBe(ctx.ownerUserId);
    expect(row.revokedAt).not.toBeNull();

    // Same session token, next request: no company access left.
    const afterCtx = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${removeeToken}`);
    expect(afterCtx.body).toEqual({ enabled: true, role: null });

    expect((await auditRows("MEMBER_REMOVED", ctx.ownerUserId)).length).toBeGreaterThanOrEqual(1);

    // Double-remove fails.
    const again = await request(app)
      .post(`/api/company/members/${memberId}/remove`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(again.status).toBe(409);

    // The startup backfill must never resurrect a revoked member.
    await ensureCompanyTeamsBackfill();
    const [postBackfill] = await db
      .select()
      .from(companyMembersTable)
      .where(eq(companyMembersTable.id, memberId));
    expect(postBackfill.status).toBe("REVOKED");
  });

  it("the owner cannot be removed (not even by themselves)", async () => {
    setFlag(true);
    const team = await request(app)
      .get("/api/company/team")
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    const ownerRow = team.body.members.find((m: { role: string }) => m.role === "OWNER");
    const res = await request(app)
      .post(`/api/company/members/${ownerRow.id}/remove`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OWNER_IMMUTABLE");
  });

  it("cross-company and employee attempts are rejected", async () => {
    setFlag(true);
    const team = await request(app)
      .get("/api/company/team")
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    const employeeRow = team.body.members.find(
      (m: { userId: number }) => m.userId === ctx.employeeUserId,
    );

    const cross = await request(app)
      .post(`/api/company/members/${employeeRow.id}/remove`)
      .set("Authorization", `Bearer ${ctx.otherOwnerToken}`);
    expect(cross.status).toBe(404);

    const byEmployee = await request(app)
      .post(`/api/company/members/${employeeRow.id}/remove`)
      .set("Authorization", `Bearer ${ctx.employeeToken}`);
    expect(byEmployee.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Owner-only userId-keyed surfaces stay closed to employees (documents gate)
// ---------------------------------------------------------------------------

describe("verification documents are owner-only", () => {
  it("active employees are rejected regardless of the feature flag", async () => {
    setFlag(true);
    const on = await request(app)
      .get("/api/trader/documents")
      .set("Authorization", `Bearer ${ctx.employeeToken}`);
    expect(on.status).toBe(403);
    expect(on.body.code).toBe("OWNER_ONLY");

    const uploadUrl = await request(app)
      .post("/api/trader/documents/upload-url")
      .set("Authorization", `Bearer ${ctx.employeeToken}`)
      .send({});
    expect(uploadUrl.status).toBe(403);

    setFlag(false);
    const off = await request(app)
      .get("/api/trader/documents")
      .set("Authorization", `Bearer ${ctx.employeeToken}`);
    expect(off.status).toBe(403);
  });

  it("a REVOKED employee's existing session stays locked out, flag on or off", async () => {
    const revokedId = await createUser("trader", "docs-revoked");
    await insertMembership({
      profileId: ctx.companyProfileId,
      userId: revokedId,
      status: "REVOKED",
    });
    const revokedToken = generateToken(revokedId, "trader");

    setFlag(true);
    const on = await request(app)
      .get("/api/trader/documents")
      .set("Authorization", `Bearer ${revokedToken}`);
    expect(on.status).toBe(403);

    setFlag(false);
    const off = await request(app)
      .post("/api/trader/documents/upload-url")
      .set("Authorization", `Bearer ${revokedToken}`)
      .send({});
    expect(off.status).toBe(403);
  });

  it("profile owners and brand-new pre-onboarding traders keep access", async () => {
    setFlag(true);
    const owner = await request(app)
      .get("/api/trader/documents")
      .set("Authorization", `Bearer ${ctx.ownerToken}`);
    expect(owner.status).toBe(200);

    // No owned profile AND no membership rows = mid-onboarding trader: the
    // legacy behaviour is preserved exactly.
    const bare = await request(app)
      .get("/api/trader/documents")
      .set("Authorization", `Bearer ${ctx.bareTraderToken}`);
    expect(bare.status).toBe(200);
  });
});
