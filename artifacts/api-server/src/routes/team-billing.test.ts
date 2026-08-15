import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  companyMembersTable,
  companyInvitesTable,
  companySeatExemptionsTable,
  subscriptionsTable,
  traderAuditLogTable,
  enquiriesTable,
  conversationsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import {
  resolveProductTier,
  getCompanyPlanContext,
  reconcileCompanySeats,
  sweepCompanySeatReconciliation,
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

/**
 * Phase C team products do not exist in App Store Connect yet, so no real
 * Team product id is hardcoded anywhere. Tests exercise the env-configured
 * placeholder path (TEAM_PRODUCT_SEAT_MAP) with an obviously-fake id.
 */
const FUTURE_TEAM5_PRODUCT = "test.placeholder.team5.awaiting-asc-confirmation";
const TEAM_MAP = { [FUTURE_TEAM5_PRODUCT]: 5 };

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdEnquiryIds: number[] = [];
const createdConversationIds: number[] = [];

const EXT_TEAMS = process.env["COMPANY_TEAMS_ENABLED"];
const EXT_BILLING = process.env["TEAM_BILLING_ENFORCED"];
const EXT_CAP = process.env["COMPANY_MAX_ACTIVE_MEMBERS"];
const EXT_TEAM_MAP = process.env["TEAM_PRODUCT_SEAT_MAP"];

function setFlags(opts: {
  teams?: boolean;
  billing?: boolean;
  cap?: number;
  teamMap?: Record<string, number>;
}) {
  if (opts.teams) process.env["COMPANY_TEAMS_ENABLED"] = "true";
  else delete process.env["COMPANY_TEAMS_ENABLED"];
  if (opts.billing) process.env["TEAM_BILLING_ENFORCED"] = "true";
  else delete process.env["TEAM_BILLING_ENFORCED"];
  if (opts.cap !== undefined)
    process.env["COMPANY_MAX_ACTIVE_MEMBERS"] = String(opts.cap);
  else delete process.env["COMPANY_MAX_ACTIVE_MEMBERS"];
  if (opts.teamMap !== undefined)
    process.env["TEAM_PRODUCT_SEAT_MAP"] = JSON.stringify(opts.teamMap);
  else delete process.env["TEAM_PRODUCT_SEAT_MAP"];
}

function restoreFlags() {
  for (const [key, val] of [
    ["COMPANY_TEAMS_ENABLED", EXT_TEAMS],
    ["TEAM_BILLING_ENFORCED", EXT_BILLING],
    ["COMPANY_MAX_ACTIVE_MEMBERS", EXT_CAP],
    ["TEAM_PRODUCT_SEAT_MAP", EXT_TEAM_MAP],
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
  await setSubscription(teamOwner.id, FUTURE_TEAM5_PRODUCT);
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
  if (createdConversationIds.length > 0) {
    await db
      .delete(conversationsTable)
      .where(inArray(conversationsTable.id, createdConversationIds));
  }
  if (createdEnquiryIds.length > 0) {
    await db
      .delete(enquiriesTable)
      .where(inArray(enquiriesTable.id, createdEnquiryIds));
  }
  if (createdProfileIds.length > 0) {
    await db
      .delete(companySeatExemptionsTable)
      .where(inArray(companySeatExemptionsTable.traderProfileId, createdProfileIds));
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
  it("maps the confirmed production Solo products", () => {
    expect(resolveProductTier("com.mylocaltrade.app.trader.monthly")).toEqual({
      tier: "premium_solo",
      seats: 0,
    });
    expect(resolveProductTier("com.mylocaltrade.app.trader.yearly")).toEqual({
      tier: "premium_solo",
      seats: 0,
    });
  });

  it("does NOT recognise any Team product id by default — no future ids are hardcoded", () => {
    delete process.env["TEAM_PRODUCT_SEAT_MAP"];
    for (const guess of [
      "com.mylocaltrade.app.team5.yearly",
      "com.mylocaltrade.app.team10.yearly",
      "com.mylocaltrade.app.team20.yearly",
    ]) {
      expect(resolveProductTier(guess)).toEqual({ tier: "premium_solo", seats: 0 });
    }
  });

  it("resolves env-configured Phase C placeholder products", () => {
    process.env["TEAM_PRODUCT_SEAT_MAP"] = JSON.stringify({
      [FUTURE_TEAM5_PRODUCT]: 5,
      "test.placeholder.team10": 10,
      "test.placeholder.team20": 20,
    });
    expect(resolveProductTier(FUTURE_TEAM5_PRODUCT)).toEqual({
      tier: "team_5",
      seats: 5,
    });
    expect(resolveProductTier("test.placeholder.team10")).toEqual({
      tier: "team_10",
      seats: 10,
    });
    expect(resolveProductTier("test.placeholder.team20")).toEqual({
      tier: "team_20",
      seats: 20,
    });
  });

  it("fails closed on malformed or disallowed TEAM_PRODUCT_SEAT_MAP entries", () => {
    process.env["TEAM_PRODUCT_SEAT_MAP"] = "not json";
    expect(resolveProductTier(FUTURE_TEAM5_PRODUCT)).toEqual({
      tier: "premium_solo",
      seats: 0,
    });
    process.env["TEAM_PRODUCT_SEAT_MAP"] = JSON.stringify({
      "test.placeholder.weird": 7,
      "test.placeholder.huge": 999,
    });
    expect(resolveProductTier("test.placeholder.weird").seats).toBe(0);
    expect(resolveProductTier("test.placeholder.huge").seats).toBe(0);
  });

  it("Test Store ids can NEVER be activated through TEAM_PRODUCT_SEAT_MAP — even in production", () => {
    const TEST_STORE_IDS = ["monthly", "yearly", "team5", "team10", "team20"];
    process.env["TEAM_PRODUCT_SEAT_MAP"] = JSON.stringify(
      Object.fromEntries(TEST_STORE_IDS.map((id) => [id, 5])),
    );
    const prevNodeEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      for (const id of TEST_STORE_IDS) {
        expect(resolveProductTier(id)).toEqual({ tier: "premium_solo", seats: 0 });
      }
    } finally {
      if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNodeEnv;
    }
    // Outside production the isolated Test Store map applies as normal — the
    // env-map entries are still rejected, so team5 resolves via its own map.
    expect(resolveProductTier("team5")).toEqual({ tier: "team_5", seats: 5 });
  });

  it("Test Store ids resolve outside production only", () => {
    // vitest runs with NODE_ENV=test → the isolated Test Store map applies.
    expect(resolveProductTier("monthly").tier).toBe("premium_solo");
    expect(resolveProductTier("team10").seats).toBe(10);
    // In production the same ids must grant NOTHING.
    const prevNodeEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      expect(resolveProductTier("team10")).toEqual({ tier: "premium_solo", seats: 0 });
      expect(resolveProductTier("team20")).toEqual({ tier: "premium_solo", seats: 0 });
    } finally {
      if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNodeEnv;
    }
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
    process.env["TEAM_PRODUCT_SEAT_MAP"] = JSON.stringify({
      "test.placeholder.team20": 20,
    });
    expect(resolveProductTier("test.placeholder.team20").seats)
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
    setFlags({ teamMap: TEAM_MAP });
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
    setFlags({ teams: true, billing: true, cap: 1, teamMap: TEAM_MAP });
    const plan = await getCompanyPlanContext(ctx.teamProfileId);
    expect(plan.employeeSeatLimit).toBe(1);
    // 1 active employee at a 1-seat ceiling is full but not over.
    expect(plan.overLimit).toBe(false);
    setFlags({ teams: true, billing: true, cap: 0, teamMap: TEAM_MAP });
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
    setFlags({ teams: true, billing: true, teamMap: TEAM_MAP });
    await setSubscription(ctx.teamOwner.id, FUTURE_TEAM5_PRODUCT, "cancelled");
    const res = await request(app)
      .post("/api/company/invites")
      .set("Authorization", `Bearer ${ctx.teamOwner.token}`)
      .send({ email: emailFor("inactive-invitee") });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TEAM_PLAN_REQUIRED");
    await setSubscription(ctx.teamOwner.id, FUTURE_TEAM5_PRODUCT);
  });

  it("kill-switch ceiling of 1 makes a team5 company with 1 employee full", async () => {
    setFlags({ teams: true, billing: true, cap: 1, teamMap: TEAM_MAP });
    const res = await request(app)
      .post("/api/company/invites")
      .set("Authorization", `Bearer ${ctx.teamOwner.token}`)
      .send({ email: emailFor("capped-invitee") });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MEMBER_LIMIT_REACHED");
  });

  it("team-context exposes plan tier, seat counts and gating booleans", async () => {
    setFlags({ teams: true, billing: true, teamMap: TEAM_MAP });
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
    setFlags({ teams: true, billing: true, teamMap: TEAM_MAP });
    const res = await request(app)
      .get("/api/company/team")
      .set("Authorization", `Bearer ${ctx.teamOwner.token}`);
    expect(res.status).toBe(200);
    // 1 active employee, 0 pending — the owner never occupies a seat.
    // Phase D: enforced mode exposes the full seat block for the owner UI.
    expect(res.body.seats).toEqual({
      used: 1,
      max: 5,
      plan: "team_5",
      planActive: true,
      allowance: 5,
      activeEmployees: 1,
      suspendedEmployees: 0,
      reservedInvites: 0,
      available: 4,
      overCapacity: false,
      exemption: null,
    });
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
        // Phase D: employees learn their own seat state — nothing else.
        seatSuspended: false,
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

// ---------------------------------------------------------------------------
// Phase C — confirmed App Store Connect products
// ---------------------------------------------------------------------------

/**
 * The five CONFIRMED App Store Connect products (subscription group
 * "Trader Subscription", confirmed Aug 2026). The Team ids are deployed via
 * TEAM_PRODUCT_SEAT_MAP in the environment — never hardcoded in the
 * resolver — so these tests pin the EXACT env value the deployment uses.
 */
const CONFIRMED_TEAM_SEAT_MAP: Record<string, number> = {
  "com.mylocaltrade.app.trader.team5.yearly": 5,
  "com.mylocaltrade.app.trader.team10.yearly": 10,
  "com.mylocaltrade.app.trader.team20.yearly": 20,
};

describe("Phase C confirmed products", () => {
  it("resolves all five confirmed products with the deployed seat map", () => {
    setFlags({ teamMap: CONFIRMED_TEAM_SEAT_MAP });
    expect(resolveProductTier("com.mylocaltrade.app.trader.monthly")).toEqual({
      tier: "premium_solo",
      seats: 0,
    });
    expect(resolveProductTier("com.mylocaltrade.app.trader.yearly")).toEqual({
      tier: "premium_solo",
      seats: 0,
    });
    expect(resolveProductTier("com.mylocaltrade.app.trader.team5.yearly")).toEqual({
      tier: "team_5",
      seats: 5,
    });
    expect(resolveProductTier("com.mylocaltrade.app.trader.team10.yearly")).toEqual({
      tier: "team_10",
      seats: 10,
    });
    expect(resolveProductTier("com.mylocaltrade.app.trader.team20.yearly")).toEqual({
      tier: "team_20",
      seats: 20,
    });
  });

  it("resolves the confirmed Team ids in production too (env map, not Test Store)", () => {
    setFlags({ teamMap: CONFIRMED_TEAM_SEAT_MAP });
    const prevNodeEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      expect(resolveProductTier("com.mylocaltrade.app.trader.team5.yearly").seats).toBe(5);
      expect(resolveProductTier("com.mylocaltrade.app.trader.team10.yearly").seats).toBe(10);
      expect(resolveProductTier("com.mylocaltrade.app.trader.team20.yearly").seats).toBe(20);
      expect(resolveProductTier("com.mylocaltrade.app.trader.monthly").tier).toBe("premium_solo");
      expect(resolveProductTier("com.mylocaltrade.app.trader.yearly").tier).toBe("premium_solo");
    } finally {
      if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNodeEnv;
    }
  });

  it("near-miss ids fail closed to solo/0 even with the confirmed map present", () => {
    setFlags({ teamMap: CONFIRMED_TEAM_SEAT_MAP });
    for (const guess of [
      "com.mylocaltrade.app.team5.yearly", // the old invented id (missing .trader.)
      "com.mylocaltrade.app.trader.team5.monthly",
      "com.mylocaltrade.app.trader.team15.yearly",
      "com.mylocaltrade.app.trader.team5.yearly.v2",
    ]) {
      expect(resolveProductTier(guess)).toEqual({ tier: "premium_solo", seats: 0 });
    }
  });

  it("pending invites reserve seats: team5 with 1 employee + 4 pending invites is full", async () => {
    setFlags({ teams: true, billing: true, teamMap: CONFIRMED_TEAM_SEAT_MAP });
    await setSubscription(ctx.teamOwner.id, "com.mylocaltrade.app.trader.team5.yearly");
    const inviteIds: number[] = [];
    try {
      for (let i = 0; i < 4; i++) {
        const rawToken = crypto.randomBytes(24).toString("hex");
        const [inv] = await db
          .insert(companyInvitesTable)
          .values({
            traderProfileId: ctx.teamProfileId,
            email: emailFor(`seat-reserving-${i}`),
            role: "EMPLOYEE",
            status: "PENDING",
            tokenHash: crypto.createHash("sha256").update(rawToken).digest("hex"),
            invitedByUserId: ctx.teamOwner.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          })
          .returning({ id: companyInvitesTable.id });
        inviteIds.push(inv.id);
      }

      // 1 active employee + 4 unexpired PENDING invites = all 5 seats taken.
      const context = await request(app)
        .get("/api/company/team-context")
        .set("Authorization", `Bearer ${ctx.teamOwner.token}`);
      expect(context.status).toBe(200);
      expect(context.body).toMatchObject({
        effectiveBusinessPlan: "team_5",
        employeeSeatLimit: 5,
        activeEmployeeCount: 1,
        pendingInviteCount: 4,
      });

      const res = await request(app)
        .post("/api/company/invites")
        .set("Authorization", `Bearer ${ctx.teamOwner.token}`)
        .send({ email: emailFor("fifth-seat-blocked") });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("MEMBER_LIMIT_REACHED");
    } finally {
      if (inviteIds.length > 0) {
        await db
          .delete(companyInvitesTable)
          .where(inArray(companyInvitesTable.id, inviteIds));
      }
      await setSubscription(ctx.teamOwner.id, FUTURE_TEAM5_PRODUCT);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase D — reconciliation, exemptions, owner seat routes, write gate
// ---------------------------------------------------------------------------

async function addEmployee(
  profileId: number,
  label: string,
  createdAt: Date,
  seat?: { suspendedAt: Date; source: "OWNER" | "SYSTEM" },
): Promise<{ userId: number; memberId: number; token: string }> {
  const emp = await createTrader(label);
  const [m] = await db
    .insert(companyMembersTable)
    .values({
      traderProfileId: profileId,
      userId: emp.id,
      role: "EMPLOYEE",
      status: "ACTIVE",
      createdAt,
      seatSuspendedAt: seat?.suspendedAt ?? null,
      seatSuspensionSource: seat?.source ?? null,
    })
    .returning({ id: companyMembersTable.id });
  return { userId: emp.id, memberId: m.id, token: emp.token };
}

async function grantExemptionRow(
  profileId: number,
  seatLimit: number,
  grantedBy: number,
): Promise<number> {
  const [row] = await db
    .insert(companySeatExemptionsTable)
    .values({
      traderProfileId: profileId,
      seatLimit,
      reason: `test grandfathering ${SUFFIX}`,
      createdByAdminId: grantedBy,
    })
    .returning({ id: companySeatExemptionsTable.id });
  return row.id;
}

async function memberSeatState(memberId: number) {
  const [row] = await db
    .select({
      seatSuspendedAt: companyMembersTable.seatSuspendedAt,
      seatSuspensionSource: companyMembersTable.seatSuspensionSource,
    })
    .from(companyMembersTable)
    .where(eq(companyMembersTable.id, memberId))
    .limit(1);
  return row;
}

describe("reconcileCompanySeats — deterministic suspension rule", () => {
  it("is a no-op (null) while TEAM_BILLING_ENFORCED is off", async () => {
    setFlags({ teams: true });
    expect(await reconcileCompanySeats(ctx.teamProfileId, "test:flag-off")).toBeNull();
  });

  it("suspends only the NEWEST seated employees beyond the allowance; reactivates longest-standing first; never auto-reactivates OWNER-suspended seats", async () => {
    setFlags({ teams: true, billing: true, teamMap: TEAM_MAP });
    const owner = await createTrader("rec-owner");
    const profileId = await createProfile(owner.id, "rec");
    // Inactive plan → 0 plan seats; allowance comes from the exemption (2).
    await setSubscription(owner.id, null, "cancelled");
    const exemptionId = await grantExemptionRow(profileId, 2, owner.id);

    const day = 24 * 60 * 60 * 1000;
    const e1 = await addEmployee(profileId, "rec-e1", new Date(Date.now() - 3 * day));
    const e2 = await addEmployee(profileId, "rec-e2", new Date(Date.now() - 2 * day));
    const e3 = await addEmployee(profileId, "rec-e3", new Date(Date.now() - 1 * day));

    // 3 seated > allowance 2 → exactly the newest (e3) is suspended.
    const first = await reconcileCompanySeats(profileId, "test:downgrade");
    expect(first).toMatchObject({
      changed: true,
      allowance: 2,
      suspendedMemberUserIds: [e3.userId],
      reactivatedMemberUserIds: [],
    });
    expect((await memberSeatState(e1.memberId)).seatSuspendedAt).toBeNull();
    expect((await memberSeatState(e2.memberId)).seatSuspendedAt).toBeNull();
    const e3State = await memberSeatState(e3.memberId);
    expect(e3State.seatSuspendedAt).not.toBeNull();
    expect(e3State.seatSuspensionSource).toBe("SYSTEM");

    // Deterministic and idempotent: a second run changes nothing.
    const second = await reconcileCompanySeats(profileId, "test:again");
    expect(second).toMatchObject({ changed: false, allowance: 2 });

    // Owner parks e2 manually; the allowance grows to 3. Reconciliation may
    // only reactivate SYSTEM-suspended seats (e3) — e2 stays down.
    await db
      .update(companyMembersTable)
      .set({ seatSuspendedAt: new Date(), seatSuspensionSource: "OWNER" })
      .where(eq(companyMembersTable.id, e2.memberId));
    await db
      .update(companySeatExemptionsTable)
      .set({ seatLimit: 3 })
      .where(eq(companySeatExemptionsTable.id, exemptionId));

    const third = await reconcileCompanySeats(profileId, "test:upgrade");
    expect(third).toMatchObject({
      changed: true,
      allowance: 3,
      suspendedMemberUserIds: [],
      reactivatedMemberUserIds: [e3.userId],
    });
    expect((await memberSeatState(e3.memberId)).seatSuspendedAt).toBeNull();
    const e2State = await memberSeatState(e2.memberId);
    expect(e2State.seatSuspendedAt).not.toBeNull();
    expect(e2State.seatSuspensionSource).toBe("OWNER");

    // Suspension never deletes anyone: all three memberships remain ACTIVE.
    const members = await db
      .select({ status: companyMembersTable.status })
      .from(companyMembersTable)
      .where(eq(companyMembersTable.traderProfileId, profileId));
    expect(members.filter((m) => m.status === "ACTIVE")).toHaveLength(3);

    // Audit trail: per-member suspension + the reconciliation summary.
    const audits = await db
      .select({ action: traderAuditLogTable.action })
      .from(traderAuditLogTable)
      .where(eq(traderAuditLogTable.userId, owner.id));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("MEMBER_SEAT_SUSPENDED");
    expect(actions).toContain("MEMBER_SEAT_REACTIVATED");
    expect(actions).toContain("COMPANY_SEATS_RECONCILED");
  });
});

describe("exemption expiry & the reconciliation sweep", () => {
  it("an expired exemption stops contributing to the allowance — reconcile suspends the over-allowance employee", async () => {
    setFlags({ teams: true, billing: true, teamMap: TEAM_MAP });
    const owner = await createTrader("expired-ex-owner");
    const profileId = await createProfile(owner.id, "expired-ex");
    await setSubscription(owner.id, null, "cancelled"); // no plan seats
    const emp = await addEmployee(profileId, "expired-ex-e1", new Date(Date.now() - 1000));

    // Live-but-time-bounded exemption whose window has already lapsed.
    await db.insert(companySeatExemptionsTable).values({
      traderProfileId: profileId,
      seatLimit: 1,
      reason: `expired grandfathering ${SUFFIX}`,
      createdByAdminId: owner.id,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const planCtx = await getCompanyPlanContext(profileId);
    expect(planCtx.effectiveSeatAllowance).toBe(0);

    // This is exactly what the hourly scheduler sweep runs per company —
    // no subscription event fires when an exemption merely times out.
    const result = await reconcileCompanySeats(profileId, "scheduler:seat-sweep");
    expect(result).toMatchObject({ changed: true, allowance: 0 });
    const seat = await memberSeatState(emp.memberId);
    expect(seat.seatSuspendedAt).not.toBeNull();
    expect(seat.seatSuspensionSource).toBe("SYSTEM");
  });

  it("the sweep is a hard no-op while either flag is off", async () => {
    setFlags({ teams: true }); // billing off
    expect(await sweepCompanySeatReconciliation()).toEqual({
      companies: 0,
      changed: 0,
      errors: 0,
    });
    setFlags({ billing: true, teamMap: TEAM_MAP }); // teams off
    expect(await sweepCompanySeatReconciliation()).toEqual({
      companies: 0,
      changed: 0,
      errors: 0,
    });
  });
});

describe("admin seat exemptions (grandfathering)", () => {
  let adminToken: string;

  beforeAll(async () => {
    const [admin] = await db
      .insert(usersTable)
      .values({
        email: emailFor("seat-admin"),
        passwordHash: "$2a$10$test.hash.not.used.for.login",
        fullName: "Seat Admin",
        role: "admin",
        isActive: true,
        emailVerified: true,
      })
      .returning({ id: usersTable.id });
    createdUserIds.push(admin.id);
    adminToken = generateToken(admin.id, "admin", 1);
  });

  it("is admin-only", async () => {
    const res = await request(app)
      .post("/api/admin/seat-exemptions")
      .set("Authorization", `Bearer ${ctx.teamOwner.token}`)
      .send({ traderProfileId: ctx.teamProfileId, seatLimit: 5, reason: "nope" });
    expect(res.status).toBe(403);
  });

  it("grant raises the effective allowance, duplicates are refused, revoke reconciles immediately", async () => {
    setFlags({ teams: true, billing: true, teamMap: TEAM_MAP });
    const owner = await createTrader("ex-owner");
    const profileId = await createProfile(owner.id, "ex");
    await setSubscription(owner.id, null, "cancelled"); // no plan seats
    const emp = await addEmployee(profileId, "ex-e1", new Date(Date.now() - 1000));

    const grant = await request(app)
      .post("/api/admin/seat-exemptions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        traderProfileId: profileId,
        seatLimit: 1,
        reason: `grandfathered: 1 employee at launch ${SUFFIX}`,
      });
    expect(grant.status).toBeLessThan(300);

    const planCtx = await getCompanyPlanContext(profileId);
    expect(planCtx.effectiveSeatAllowance).toBe(1);
    expect(planCtx.overLimit).toBe(false);

    // One live exemption per company.
    const dup = await request(app)
      .post("/api/admin/seat-exemptions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ traderProfileId: profileId, seatLimit: 2, reason: "second attempt" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("EXEMPTION_EXISTS");

    const [exemption] = await db
      .select({ id: companySeatExemptionsTable.id })
      .from(companySeatExemptionsTable)
      .where(
        and(
          eq(companySeatExemptionsTable.traderProfileId, profileId),
          eq(companySeatExemptionsTable.seatLimit, 1),
        ),
      )
      .limit(1);

    // Revoke → allowance drops to 0 → the employee is suspended right away
    // (read-only, reversible — the membership row stays ACTIVE).
    const revoke = await request(app)
      .post(`/api/admin/seat-exemptions/${exemption.id}/revoke`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(revoke.status).toBeLessThan(300);

    const seat = await memberSeatState(emp.memberId);
    expect(seat.seatSuspendedAt).not.toBeNull();
    expect(seat.seatSuspensionSource).toBe("SYSTEM");

    const audits = await db
      .select({ action: traderAuditLogTable.action })
      .from(traderAuditLogTable)
      .where(eq(traderAuditLogTable.userId, owner.id));
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("SEAT_EXEMPTION_GRANTED");
    expect(actions).toContain("SEAT_EXEMPTION_REVOKED");
  });
});

describe("owner seat-suspend / seat-reactivate routes", () => {
  it("404 while TEAM_BILLING_ENFORCED is off — suspensions cannot originate from a non-enforcement world", async () => {
    setFlags({ teams: true });
    const res = await request(app)
      .post("/api/company/members/1/seat-suspend")
      .set("Authorization", `Bearer ${ctx.teamOwner.token}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it("owner suspends (idempotent) and reactivates; reactivation refuses without a free seat", async () => {
    setFlags({ teams: true, billing: true, teamMap: TEAM_MAP });
    const owner = await createTrader("seatroute-owner");
    const profileId = await createProfile(owner.id, "seatroute");
    await setSubscription(owner.id, FUTURE_TEAM5_PRODUCT); // 5 seats
    const emp = await addEmployee(profileId, "seatroute-e1", new Date(Date.now() - 1000));

    // Employees cannot drive seat state — owner-only.
    const notOwner = await request(app)
      .post(`/api/company/members/${emp.memberId}/seat-suspend`)
      .set("Authorization", `Bearer ${emp.token}`)
      .send({});
    expect(notOwner.status).toBe(403);

    const suspend = await request(app)
      .post(`/api/company/members/${emp.memberId}/seat-suspend`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});
    expect(suspend.status).toBe(200);
    expect(suspend.body).toMatchObject({ ok: true, alreadySuspended: false });
    expect((await memberSeatState(emp.memberId)).seatSuspensionSource).toBe("OWNER");

    const again = await request(app)
      .post(`/api/company/members/${emp.memberId}/seat-suspend`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true, alreadySuspended: true });

    // Downgrade to Solo (0 seats): reactivation must refuse — no free seat.
    await setSubscription(owner.id, "com.mylocaltrade.app.trader.yearly");
    const refused = await request(app)
      .post(`/api/company/members/${emp.memberId}/seat-reactivate`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("NO_SEAT_AVAILABLE");

    // Back on the Team plan the same seat comes back up.
    await setSubscription(owner.id, FUTURE_TEAM5_PRODUCT);
    const reactivate = await request(app)
      .post(`/api/company/members/${emp.memberId}/seat-reactivate`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({});
    expect(reactivate.status).toBe(200);
    expect(reactivate.body).toMatchObject({ ok: true, alreadyActive: false });
    expect((await memberSeatState(emp.memberId)).seatSuspendedAt).toBeNull();
  });
});

describe("seat-suspended write gate", () => {
  it("blocks job actions with 403 SEAT_SUSPENDED even when enforcement is later switched off", async () => {
    // Deliberately: teams ON, billing OFF. A suspension that exists in the
    // database is act-blocking regardless of the enforcement flag (rollback
    // clears seats explicitly — see docs/team-billing-rollout.md).
    setFlags({ teams: true });
    const owner = await createTrader("gate-owner");
    const profileId = await createProfile(owner.id, "gate");
    const emp = await addEmployee(profileId, "gate-e1", new Date(Date.now() - 1000), {
      suspendedAt: new Date(),
      source: "SYSTEM",
    });

    const [customer] = await db
      .insert(usersTable)
      .values({
        email: emailFor("gate-customer"),
        passwordHash: "$2a$10$test.hash.not.used.for.login",
        fullName: "Gate Customer",
        role: "customer",
        isActive: true,
        emailVerified: true,
        phone: "+447000000032",
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
      })
      .returning({ id: usersTable.id });
    createdUserIds.push(customer.id);

    const [enquiry] = await db
      .insert(enquiriesTable)
      .values({
        traderId: profileId,
        customerId: customer.id,
        message: "Need a quote for boiler service",
        serviceRequired: "Boiler service",
        status: "pending",
      })
      .returning({ id: enquiriesTable.id });
    createdEnquiryIds.push(enquiry.id);

    const [conv] = await db
      .insert(conversationsTable)
      .values({
        customerId: customer.id,
        traderUserId: owner.id,
        traderProfileId: profileId,
        enquiryId: enquiry.id,
        serviceRequired: "Boiler service",
        status: "AWAITING_TRADER_REPLY",
        traderStatus: "NEW",
      })
      .returning({ id: conversationsTable.id });
    createdConversationIds.push(conv.id);

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set("Authorization", `Bearer ${emp.token}`)
      .send({ body: "Hello, I can help with that boiler." });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SEAT_SUSPENDED");
  });
});
