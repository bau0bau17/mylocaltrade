import { describe, it, beforeAll, afterAll, afterEach, beforeEach, expect } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  companyMembersTable,
  enquiriesTable,
  conversationsTable,
} from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import {
  getActiveMembership,
  companyTeamsEnabled,
  maxActiveMembersPerCompany,
} from "../lib/company-membership";
import { ensureCompanyTeamsBackfill } from "../lib/company-backfill";

/**
 * Company Teams Phase 0 — membership resolver, schema invariants, backfill
 * and fail-closed behaviour.
 *
 * The core contract under test:
 *  - Flag OFF (default): getActiveMembership() === the legacy owned-profile
 *    lookup, reported as OWNER. Existing users/flows are unchanged.
 *  - Flag ON: ACTIVE membership rows grant EMPLOYEE access to the company's
 *    shared surfaces; owner-only surfaces (which resolve by OWNED profile)
 *    stay closed to employees; revoked members lose everything.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `company-test+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdEnquiryIds: number[] = [];
const createdConversationIds: number[] = [];

// The whole suite runs in a single fork, so this file must not leak flag
// changes into other test files: capture whatever the run was started with
// (e.g. COMPANY_TEAMS_ENABLED=true equivalence runs) and restore it after
// every test.
const EXTERNAL_FLAG = process.env["COMPANY_TEAMS_ENABLED"];

function setFlag(on: boolean): void {
  if (on) process.env["COMPANY_TEAMS_ENABLED"] = "true";
  else delete process.env["COMPANY_TEAMS_ENABLED"];
}

function restoreFlag(): void {
  if (EXTERNAL_FLAG === undefined) delete process.env["COMPANY_TEAMS_ENABLED"];
  else process.env["COMPANY_TEAMS_ENABLED"] = EXTERNAL_FLAG;
}

async function createUser(role: "customer" | "trader", label: string): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Company Test ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      phone: "+447000000001",
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
      businessName: `Company Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000000",
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

async function createEnquiry(traderId: number, customerId: number): Promise<number> {
  const [e] = await db
    .insert(enquiriesTable)
    .values({
      traderId,
      customerId,
      message: "Need a quote for boiler service",
      serviceRequired: "Boiler service",
      status: "pending",
    })
    .returning({ id: enquiriesTable.id });
  createdEnquiryIds.push(e.id);
  return e.id;
}

async function createConversation(opts: {
  customerId: number;
  traderUserId: number;
  traderProfileId: number;
}): Promise<number> {
  const enquiryId = await createEnquiry(opts.traderProfileId, opts.customerId);
  const [c] = await db
    .insert(conversationsTable)
    .values({
      customerId: opts.customerId,
      traderUserId: opts.traderUserId,
      traderProfileId: opts.traderProfileId,
      enquiryId,
      serviceRequired: "Boiler service",
      status: "AWAITING_TRADER_REPLY",
      traderStatus: "NEW",
    })
    .returning({ id: conversationsTable.id });
  createdConversationIds.push(c.id);
  return c.id;
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
}

let ctx: Ctx;

beforeAll(async () => {
  const ownerUserId = await createUser("trader", "owner");
  const companyProfileId = await createTraderProfile(ownerUserId, "main");
  // Employee: role=trader but NO owned trader profile (invite-created users
  // will look exactly like this in a later phase).
  const employeeUserId = await createUser("trader", "employee");
  const otherOwnerUserId = await createUser("trader", "other-owner");
  const otherProfileId = await createTraderProfile(otherOwnerUserId, "other");
  const customerId = await createUser("customer", "customer");

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
  };
});

afterEach(restoreFlag);

afterAll(async () => {
  restoreFlag();
  if (createdConversationIds.length > 0) {
    await db.delete(conversationsTable).where(inArray(conversationsTable.id, createdConversationIds));
  }
  if (createdEnquiryIds.length > 0) {
    await db.delete(enquiriesTable).where(inArray(enquiriesTable.id, createdEnquiryIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.userId, createdUserIds));
  }
  if (createdProfileIds.length > 0) {
    await db.delete(companyMembersTable).where(inArray(companyMembersTable.traderProfileId, createdProfileIds));
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

async function insertMembership(opts: {
  traderProfileId: number;
  userId: number;
  role?: "OWNER" | "EMPLOYEE";
  status?: "ACTIVE" | "REVOKED";
}) {
  return db
    .insert(companyMembersTable)
    .values({
      traderProfileId: opts.traderProfileId,
      userId: opts.userId,
      role: opts.role ?? "EMPLOYEE",
      status: opts.status ?? "ACTIVE",
    })
    .returning();
}

async function deleteMembership(userId: number) {
  await db.delete(companyMembersTable).where(eq(companyMembersTable.userId, userId));
}

function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  return (
    e?.code === "23505" ||
    e?.cause?.code === "23505" ||
    /duplicate key/i.test(String((e as Error)?.message ?? e))
  );
}

describe("company membership resolver — flag OFF (default)", () => {
  beforeEach(() => setFlag(false));

  it.skipIf(EXTERNAL_FLAG === "true")("flag defaults to off", () => {
    expect(companyTeamsEnabled()).toBe(false);
  });

  it("resolves a profile owner as OWNER of their own profile", async () => {
    const m = await getActiveMembership(ctx.ownerUserId);
    expect(m).not.toBeNull();
    expect(m!.role).toBe("OWNER");
    expect(m!.traderProfileId).toBe(ctx.companyProfileId);
    expect(m!.profile.userId).toBe(ctx.ownerUserId);
  });

  it("resolves null for a customer and for a trader-role user without a profile", async () => {
    expect(await getActiveMembership(ctx.customerId)).toBeNull();
    expect(await getActiveMembership(ctx.employeeUserId)).toBeNull();
  });

  it("IGNORES membership rows while the flag is off (behaviour identical to pre-teams)", async () => {
    await insertMembership({ traderProfileId: ctx.companyProfileId, userId: ctx.employeeUserId });
    try {
      expect(await getActiveMembership(ctx.employeeUserId)).toBeNull();
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });
});

describe("company membership resolver — flag ON", () => {
  it("profile owner WITHOUT a membership row still resolves as OWNER (backfill safety)", async () => {
    await db.delete(companyMembersTable).where(
      and(
        eq(companyMembersTable.userId, ctx.ownerUserId),
        eq(companyMembersTable.traderProfileId, ctx.companyProfileId),
      ),
    );
    setFlag(true);
    const m = await getActiveMembership(ctx.ownerUserId);
    expect(m).not.toBeNull();
    expect(m!.role).toBe("OWNER");
    expect(m!.traderProfileId).toBe(ctx.companyProfileId);
  });

  it("ACTIVE employee resolves to the company profile with EMPLOYEE role", async () => {
    await insertMembership({ traderProfileId: ctx.companyProfileId, userId: ctx.employeeUserId });
    try {
      setFlag(true);
      const m = await getActiveMembership(ctx.employeeUserId);
      expect(m).not.toBeNull();
      expect(m!.role).toBe("EMPLOYEE");
      expect(m!.traderProfileId).toBe(ctx.companyProfileId);
      // The membership's profile is the COMPANY's, not one they own.
      expect(m!.profile.userId).toBe(ctx.ownerUserId);
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });

  it("REVOKED employee resolves to null (fail closed)", async () => {
    await insertMembership({
      traderProfileId: ctx.companyProfileId,
      userId: ctx.employeeUserId,
      status: "REVOKED",
    });
    try {
      setFlag(true);
      expect(await getActiveMembership(ctx.employeeUserId)).toBeNull();
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });

  it("a forged OWNER membership for someone else's profile fails closed", async () => {
    // The one-active-owner index blocks this while the legitimate owner row
    // exists; simulate the corrupt state by removing that row first.
    await db
      .delete(companyMembersTable)
      .where(eq(companyMembersTable.traderProfileId, ctx.companyProfileId));
    await insertMembership({
      traderProfileId: ctx.companyProfileId,
      userId: ctx.employeeUserId,
      role: "OWNER",
    });
    try {
      setFlag(true);
      expect(await getActiveMembership(ctx.employeeUserId)).toBeNull();
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });
});

describe("schema invariants", () => {
  it("rejects a duplicate (company, user) membership row", async () => {
    await insertMembership({ traderProfileId: ctx.companyProfileId, userId: ctx.employeeUserId });
    try {
      await expect(
        insertMembership({
          traderProfileId: ctx.companyProfileId,
          userId: ctx.employeeUserId,
          status: "REVOKED",
        }),
      ).rejects.toSatisfy(isDuplicateKeyError);
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });

  it("rejects a second ACTIVE membership for the same user (one company per user)", async () => {
    await insertMembership({ traderProfileId: ctx.companyProfileId, userId: ctx.employeeUserId });
    try {
      await expect(
        insertMembership({ traderProfileId: ctx.otherProfileId, userId: ctx.employeeUserId }),
      ).rejects.toSatisfy(isDuplicateKeyError);
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });

  it("rejects a second ACTIVE OWNER for the same company", async () => {
    await insertMembership({
      traderProfileId: ctx.companyProfileId,
      userId: ctx.ownerUserId,
      role: "OWNER",
    });
    try {
      await expect(
        insertMembership({
          traderProfileId: ctx.companyProfileId,
          userId: ctx.employeeUserId,
          role: "OWNER",
        }),
      ).rejects.toSatisfy(isDuplicateKeyError);
    } finally {
      await deleteMembership(ctx.ownerUserId);
      await deleteMembership(ctx.employeeUserId);
    }
  });

  it("member cap is configurable with a safe default", () => {
    const external = process.env["COMPANY_MAX_ACTIVE_MEMBERS"];
    try {
      delete process.env["COMPANY_MAX_ACTIVE_MEMBERS"];
      expect(maxActiveMembersPerCompany()).toBe(10);
      process.env["COMPANY_MAX_ACTIVE_MEMBERS"] = "25";
      expect(maxActiveMembersPerCompany()).toBe(25);
      process.env["COMPANY_MAX_ACTIVE_MEMBERS"] = "garbage";
      expect(maxActiveMembersPerCompany()).toBe(10);
    } finally {
      if (external === undefined) delete process.env["COMPANY_MAX_ACTIVE_MEMBERS"];
      else process.env["COMPANY_MAX_ACTIVE_MEMBERS"] = external;
    }
  });
});

describe("boot backfill", () => {
  it("creates OWNER memberships idempotently and never resurrects revocations", async () => {
    await db.delete(companyMembersTable).where(eq(companyMembersTable.traderProfileId, ctx.companyProfileId));
    await ensureCompanyTeamsBackfill();
    await ensureCompanyTeamsBackfill();
    const rows = await db
      .select()
      .from(companyMembersTable)
      .where(eq(companyMembersTable.traderProfileId, ctx.companyProfileId));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ctx.ownerUserId);
    expect(rows[0].role).toBe("OWNER");
    expect(rows[0].status).toBe("ACTIVE");

    // A revoked owner row must NOT be flipped back by a re-run (ON CONFLICT
    // DO NOTHING never updates existing rows).
    await db
      .update(companyMembersTable)
      .set({ status: "REVOKED" })
      .where(eq(companyMembersTable.id, rows[0].id));
    await ensureCompanyTeamsBackfill();
    const [after] = await db
      .select()
      .from(companyMembersTable)
      .where(eq(companyMembersTable.id, rows[0].id));
    expect(after.status).toBe("REVOKED");
    await db
      .update(companyMembersTable)
      .set({ status: "ACTIVE" })
      .where(eq(companyMembersTable.id, rows[0].id));
  });

  it("mirrors conversation assignment from traderUserId while the flag is OFF", async () => {
    const convId = await createConversation({
      customerId: ctx.customerId,
      traderUserId: ctx.ownerUserId,
      traderProfileId: ctx.companyProfileId,
    });
    setFlag(false);
    await ensureCompanyTeamsBackfill();
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId));
    expect(conv.assignedTraderUserId).toBe(ctx.ownerUserId);
    expect(conv.assignedAt).not.toBeNull();
  });

  it("does NOT auto-assign conversations while the flag is ON (unclaimed = legitimate)", async () => {
    const convId = await createConversation({
      customerId: ctx.customerId,
      traderUserId: ctx.ownerUserId,
      traderProfileId: ctx.companyProfileId,
    });
    setFlag(true);
    await ensureCompanyTeamsBackfill();
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId));
    expect(conv.assignedTraderUserId).toBeNull();
  });
});

describe("endpoint behaviour with flag ON (employee access boundaries)", () => {
  it("employee READS the company profile via GET /api/profile", async () => {
    await insertMembership({ traderProfileId: ctx.companyProfileId, userId: ctx.employeeUserId });
    try {
      setFlag(true);
      const res = await request(app)
        .get("/api/profile")
        .set("Authorization", `Bearer ${ctx.employeeToken}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(ctx.companyProfileId);
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });

  it("employee sees the company's shared leads via GET /api/enquiries", async () => {
    await createEnquiry(ctx.companyProfileId, ctx.customerId);
    await insertMembership({ traderProfileId: ctx.companyProfileId, userId: ctx.employeeUserId });
    try {
      setFlag(true);
      const res = await request(app)
        .get("/api/enquiries")
        .set("Authorization", `Bearer ${ctx.employeeToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.enquiries)).toBe(true);
      expect(res.body.enquiries.length).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });

  it("employee CANNOT edit the business profile (PUT /api/profile fails closed)", async () => {
    await insertMembership({ traderProfileId: ctx.companyProfileId, userId: ctx.employeeUserId });
    try {
      setFlag(true);
      const res = await request(app)
        .put("/api/profile")
        .set("Authorization", `Bearer ${ctx.employeeToken}`)
        .send({ businessName: "Hijacked Ltd" });
      expect(res.status).toBe(404); // owned-profile lookup: employees have none
      const [profile] = await db
        .select({ businessName: traderProfilesTable.businessName })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.id, ctx.companyProfileId));
      expect(profile.businessName).not.toBe("Hijacked Ltd");
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });

  it("employee CANNOT touch the business phone (owner-only, fails closed)", async () => {
    await insertMembership({ traderProfileId: ctx.companyProfileId, userId: ctx.employeeUserId });
    try {
      setFlag(true);
      const res = await request(app)
        .post("/api/trader/phone/send-otp")
        .set("Authorization", `Bearer ${ctx.employeeToken}`)
        .send({});
      expect(res.status).toBe(403);
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });

  it("a member of another company gets NO access to this company's surfaces", async () => {
    const convId = await createConversation({
      customerId: ctx.customerId,
      traderUserId: ctx.ownerUserId,
      traderProfileId: ctx.companyProfileId,
    });
    setFlag(true);
    const res = await request(app)
      .get(`/api/conversations/${convId}`)
      .set("Authorization", `Bearer ${ctx.otherOwnerToken}`);
    expect([403, 404]).toContain(res.status);
  });

  it("revoked employee loses shared-surface access entirely", async () => {
    await insertMembership({
      traderProfileId: ctx.companyProfileId,
      userId: ctx.employeeUserId,
      status: "REVOKED",
    });
    try {
      setFlag(true);
      const res = await request(app)
        .get("/api/profile")
        .set("Authorization", `Bearer ${ctx.employeeToken}`);
      expect(res.status).toBe(404);
    } finally {
      await deleteMembership(ctx.employeeUserId);
    }
  });
});
