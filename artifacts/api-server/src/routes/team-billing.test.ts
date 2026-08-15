import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  companyMembersTable,
  companyInvitesTable,
  subscriptionsTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { eq, inArray, or } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import {
  resolveProductTier,
  getCompanyPlanContext,
  ABSOLUTE_MAX_EMPLOYEE_SEATS,
} from "../lib/team-billing";

/**
 * Team billing Phase B — dormant seat-limit plumbing.
 *
 * Contract under test:
 *  - TEAM_BILLING_ENFORCED off (default): invites use the legacy env cap,
 *    solo owners can invite, team-context reports the legacy limit —
 *    today's behaviour, unchanged.
 *  - Flag ON: the owner's subscriptions.product_identifier decides seats;
 *    solo/inactive plans get 403 TEAM_PLAN_REQUIRED on invite; team tiers
 *    cap at their seat count; COMPANY_MAX_ACTIVE_MEMBERS acts as a
 *    kill-switch ceiling when explicitly set.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `tb-test+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];

const EXT_TEAMS = process.env["COMPANY_TEAMS_ENABLED"];
const EXT_BILLING = process.env["TEAM_BILLING_ENFORCED"];
const EXT_CAP = process.env["COMPANY_MAX_ACTIVE_MEMBERS"];

function setFlags(opts: { teams?: boolean; billing?: boolean; cap?: number }) {
  if (opts.teams) process.env["COMPANY_TEAMS_ENABLED"] = "true";
  else delete process.env["COMPANY_TEAMS_ENABLED"];
  if (opts.billing) process.env["TEAM_BILLING_ENFORCED"] = "true";
  else delete process.env["TEAM_BILLING_ENFORCED"];
  if (opts.cap !== undefined)
    process.env["COMPANY_MAX_ACTIVE_MEMBERS"] = String(opts.cap);
  else delete process.env["COMPANY_MAX_ACTIVE_MEMBERS"];
}

function restoreFlags() {
  for (const [key, val] of [
    ["COMPANY_TEAMS_ENABLED", EXT_TEAMS],
    ["TEAM_BILLING_ENFORCED", EXT_BILLING],
    ["COMPANY_MAX_ACTIVE_MEMBERS", EXT_CAP],
  ] as const) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
}

async function createTrader(label: string): Promise<{ id: number; token: string }> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(label),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `TB Test ${label}`,
      role: "trader",
      isActive: true,
      emailVerified: true,
      phone: "+447000000031",
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return { id: u.id, token: generateToken(u.id, "trader") };
}

async function createProfile(userId: number, label: string): Promise<number> {
  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId,
      businessName: `TB Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000030",
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

async function setSubscription(
  userId: number,
  productIdentifier: string | null,
  status: "active" | "cancelled" = "active",
) {
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.userId, userId));
  await db.insert(subscriptionsTable).values({
    userId,
    planId: "premium",
    status,
    productIdentifier,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    originalPurchaseAt: new Date(),
  });
}

interface Ctx {
  soloOwner: { id: number; token: string };
  soloProfileId: number;
  teamOwner: { id: number; token: string };
  teamProfileId: number;
}

let ctx: Ctx;

beforeAll(async () => {
  const soloOwner = await createTrader("solo-owner");
  const soloProfileId = await createProfile(soloOwner.id, "solo");
  await setSubscription(soloOwner.id, "com.mylocaltrade.app.trader.yearly");

  const teamOwner = await createTrader("team-owner");
  const teamProfileId = await createProfile(teamOwner.id, "team");
  await setSubscription(teamOwner.id, "com.mylocaltrade.app.team5.yearly");
  // One active employee on the team company.
  const employee = await createTrader("team-employee");
  await db.insert(companyMembersTable).values({
    traderProfileId: teamProfileId,
    userId: employee.id,
    role: "EMPLOYEE",
    status: "ACTIVE",
  });

  ctx = { soloOwner, soloProfileId, teamOwner, teamProfileId };
});

afterEach(() => {
  restoreFlags();
});

afterAll(async () => {
  restoreFlags();
  if (createdUserIds.length > 0) {
    await db
      .delete(traderAuditLogTable)
      .where(
        or(
          inArray(traderAuditLogTable.userId, createdUserIds),
          inArray(traderAuditLogTable.performedBy, createdUserIds),
        ),
      );
    await db
      .delete(subscriptionsTable)
      .where(inArray(subscriptionsTable.userId, createdUserIds));
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
    await db
      .delete(traderProfilesTable)
      .where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

// ---------------------------------------------------------------------------
// Tier map (unit)
// ---------------------------------------------------------------------------

describe("resolveProductTier", () => {
  it("maps known products to their tiers", () => {
    expect(resolveProductTier("com.mylocaltrade.app.trader.monthly")).toEqual({
      tier: "premium_solo",
      seats: 0,
    });
    expect(resolveProductTier("com.mylocaltrade.app.trader.yearly")).toEqual({
      tier: "premium_solo",
      seats: 0,
    });
    expect(resolveProductTier("com.mylocaltrade.app.team5.yearly")).toEqual({
      tier: "team_5",
      seats: 5,
    });
    expect(resolveProductTier("com.mylocaltrade.app.team10.yearly")).toEqual({
      tier: "team_10",
      seats: 10,
    });
    expect(resolveProductTier("com.mylocaltrade.app.team20.yearly")).toEqual({
      tier: "team_20",
      seats: 20,
    });
    // Test Store equivalents
    expect(resolveProductTier("monthly").tier).toBe("premium_solo");
    expect(resolveProductTier("team10").seats).toBe(10);
  });

  it("fails closed: null and unknown products are solo with 0 seats", () => {
    expect(resolveProductTier(null)).toEqual({ tier: "premium_solo", seats: 0 });
    expect(resolveProductTier("com.mylocaltrade.app.team999.yearly")).toEqual({
      tier: "premium_solo",
      seats: 0,
    });
  });

  it("never exceeds the absolute seat ceiling", () => {
    expect(ABSOLUTE_MAX_EMPLOYEE_SEATS).toBe(20);
    expect(resolveProductTier("com.mylocaltrade.app.team20.yearly").seats)
      .toBeLessThanOrEqual(ABSOLUTE_MAX_EMPLOYEE_SEATS);
  });
});

// ---------------------------------------------------------------------------
// Plan context (choke point)
// ---------------------------------------------------------------------------

describe("getCompanyPlanContext", () => {
  it("solo owner: solo tier, 0 seats, active", async () => {
    const plan = await getCompanyPlanContext(ctx.soloProfileId);
    expect(plan).toMatchObject({
      effectiveBusinessPlan: "premium_solo",
      active: true,
      employeeSeatLimit: 0,
      activeEmployeeCount: 0,
      pendingInviteCount: 0,
      overLimit: false,
    });
  });

  it("team5 owner with one employee: 5 seats, counts, not over limit", async () => {
    const plan = await getCompanyPlanContext(ctx.teamProfileId);
    expect(plan).toMatchObject({
      effectiveBusinessPlan: "team_5",
      active: true,
      employeeSeatLimit: 5,
      activeEmployeeCount: 1,
      overLimit: false,
    });
  });

  it("explicit COMPANY_MAX_ACTIVE_MEMBERS acts as a kill-switch ceiling", async () => {
    setFlags({ teams: true, billing: true, cap: 1 });
    const plan = await getCompanyPlanContext(ctx.teamProfileId);
    expect(plan.employeeSeatLimit).toBe(1);
    // 1 active employee at a 1-seat ceiling is full but not over.
    expect(plan.overLimit).toBe(false);
    setFlags({ teams: true, billing: true, cap: 0 });
  });

  it("inactive subscription reports active:false", async () => {
    await setSubscription(ctx.soloOwner.id, "com.mylocaltrade.app.trader.yearly", "cancelled");
    const plan = await getCompanyPlanContext(ctx.soloProfileId);
    expect(plan.active).toBe(false);
    await setSubscription(ctx.soloOwner.id, "com.mylocaltrade.app.trader.yearly");
  });
});

// ---------------------------------------------------------------------------
// Flag OFF — legacy behaviour untouched
// ---------------------------------------------------------------------------

describe("TEAM_BILLING_ENFORCED off (default)", () => {
  it("solo owner can still create an invite under the legacy cap", async () => {
    setFlags({ teams: true, billing: false });
    const res = await request(app)
      .post("/api/company/invites")
      .set("Authorization", `Bearer ${ctx.soloOwner.token}`)
      .send({ email: emailFor("legacy-invitee") });
    // 201 (email send is mocked/captured in tests) or 502 if the email layer
    // refuses — but NEVER a plan-based 403.
    expect(res.status).not.toBe(403);
    expect(res.body.code).not.toBe("TEAM_PLAN_REQUIRED");
    if (res.status === 201) {
      await db
        .delete(companyInvitesTable)
        .where(eq(companyInvitesTable.id, res.body.invite.id));
    }
  });

  it("team-context keeps the EXACT legacy shape — no plan fields leak", async () => {
    setFlags({ teams: true, billing: false });
    const res = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${ctx.soloOwner.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, role: "OWNER" });
  });
});

// ---------------------------------------------------------------------------
// Flag ON — plan-derived seats
// ---------------------------------------------------------------------------

describe("TEAM_BILLING_ENFORCED on", () => {
  it("solo plan cannot invite: 403 TEAM_PLAN_REQUIRED", async () => {
    setFlags({ teams: true, billing: true });
    const res = await request(app)
      .post("/api/company/invites")
      .set("Authorization", `Bearer ${ctx.soloOwner.token}`)
      .send({ email: emailFor("blocked-invitee") });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TEAM_PLAN_REQUIRED");
  });

  it("inactive team plan cannot invite either", async () => {
    setFlags({ teams: true, billing: true });
    await setSubscription(ctx.teamOwner.id, "com.mylocaltrade.app.team5.yearly", "cancelled");
    const res = await request(app)
      .post("/api/company/invites")
      .set("Authorization", `Bearer ${ctx.teamOwner.token}`)
      .send({ email: emailFor("inactive-invitee") });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TEAM_PLAN_REQUIRED");
    await setSubscription(ctx.teamOwner.id, "com.mylocaltrade.app.team5.yearly");
  });

  it("kill-switch ceiling of 1 makes a team5 company with 1 employee full", async () => {
    setFlags({ teams: true, billing: true, cap: 1 });
    const res = await request(app)
      .post("/api/company/invites")
      .set("Authorization", `Bearer ${ctx.teamOwner.token}`)
      .send({ email: emailFor("capped-invitee") });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MEMBER_LIMIT_REACHED");
  });

  it("team-context exposes plan tier, seat counts and gating booleans", async () => {
    setFlags({ teams: true, billing: true });
    const owner = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${ctx.teamOwner.token}`);
    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({
      enabled: true,
      role: "OWNER",
      viewerRole: "OWNER",
      effectiveBusinessPlan: "team_5",
      employeeSeatLimit: 5,
      activeEmployeeCount: 1,
      pendingInviteCount: 0,
      viewerCanManageBilling: true,
      viewerCanManageTeam: true,
      viewerCanInvite: true,
    });

    const solo = await request(app)
      .get("/api/company/team-context")
      .set("Authorization", `Bearer ${ctx.soloOwner.token}`);
    expect(solo.body).toMatchObject({
      effectiveBusinessPlan: "premium_solo",
      employeeSeatLimit: 0,
      viewerCanInvite: false,
    });
  });

  it("GET /company/team shows EMPLOYEE-only seat usage against the plan limit", async () => {
    setFlags({ teams: true, billing: true });
    const res = await request(app)
      .get("/api/company/team")
      .set("Authorization", `Bearer ${ctx.teamOwner.token}`);
    expect(res.status).toBe(200);
    // 1 active employee, 0 pending — the owner never occupies a seat.
    expect(res.body.seats).toEqual({ used: 1, max: 5 });
  });

  it("employees get gating booleans only — no billing tier or seat counts", async () => {
    setFlags({ teams: true, billing: true });
    const employee = await createTrader("ctx-employee");
    await db.insert(companyMembersTable).values({
      traderProfileId: ctx.teamProfileId,
      userId: employee.id,
      role: "EMPLOYEE",
      status: "ACTIVE",
    });
    try {
      const res = await request(app)
        .get("/api/company/team-context")
        .set("Authorization", `Bearer ${employee.token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        enabled: true,
        role: "EMPLOYEE",
        viewerRole: "EMPLOYEE",
        viewerCanManageBilling: false,
        viewerCanManageTeam: false,
        viewerCanInvite: false,
      });
    } finally {
      await db
        .delete(companyMembersTable)
        .where(eq(companyMembersTable.userId, employee.id));
    }
  });

  it("resend of an EXPIRED invite re-checks the plan (solo → TEAM_PLAN_REQUIRED)", async () => {
    setFlags({ teams: true, billing: true });
    const rawToken = crypto.randomBytes(24).toString("hex");
    const [invite] = await db
      .insert(companyInvitesTable)
      .values({
        traderProfileId: ctx.soloProfileId,
        email: emailFor("expired-invitee"),
        role: "EMPLOYEE",
        status: "PENDING",
        tokenHash: crypto.createHash("sha256").update(rawToken).digest("hex"),
        invitedByUserId: ctx.soloOwner.id,
        expiresAt: new Date(Date.now() - 60 * 1000),
      })
      .returning({ id: companyInvitesTable.id });
    const res = await request(app)
      .post(`/api/company/invites/${invite.id}/resend`)
      .set("Authorization", `Bearer ${ctx.soloOwner.token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TEAM_PLAN_REQUIRED");
    await db.delete(companyInvitesTable).where(eq(companyInvitesTable.id, invite.id));
  });
});
