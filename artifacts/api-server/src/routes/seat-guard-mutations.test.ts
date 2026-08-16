import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  companyMembersTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";

/**
 * Seat-suspension mutation guard (requireActiveSeat) — permission matrix.
 *
 * Contract under test: a seat-suspended ACTIVE EMPLOYEE is refused with
 * 403 SEAT_SUSPENDED on every company-acting trader mutation that does NOT
 * pass through the job-claim path, namely:
 *
 *   PATCH /api/conversations/:id/mute
 *   POST  /api/conversations/:id/report
 *   POST  /api/trader/reviews/:id/reply
 *   PUT   /api/profile
 *   POST  /api/profile/revalidate
 *   POST  /api/profile/business-email/send
 *
 * The guard fires BEFORE any resource lookup, so the matrix can probe with
 * nonexistent ids: the suspended employee must get SEAT_SUSPENDED even for a
 * missing conversation, while every other persona must get anything BUT
 * SEAT_SUSPENDED (404/400/403-other — the point is the seat guard stays out
 * of their way; deeper authz belongs to other suites).
 *
 * Personas: ACTIVE employee (no suspension), SEAT-SUSPENDED employee,
 * REVOKED employee whose stale row still carries seatSuspendedAt (must NOT
 * trip the guard — only ACTIVE memberships count), owner, and customer
 * (mixed-audience conversation routes must skip the guard without a DB hit).
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `sg-test+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];

async function createUser(
  label: string,
  role: "trader" | "customer",
): Promise<{ id: number; token: string }> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(label),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `SG Test ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      phone: "+447000000061",
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return { id: u.id, token: generateToken(u.id, role) };
}

async function createProfile(userId: number, label: string): Promise<number> {
  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId,
      businessName: `SG Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000060",
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

async function addEmployee(
  profileId: number,
  label: string,
  opts: { status: "ACTIVE" | "REVOKED"; seatSuspended: boolean },
): Promise<{ id: number; token: string }> {
  const emp = await createUser(label, "trader");
  await db.insert(companyMembersTable).values({
    traderProfileId: profileId,
    userId: emp.id,
    role: "EMPLOYEE",
    status: opts.status,
    seatSuspendedAt: opts.seatSuspended ? new Date() : null,
    seatSuspensionSource: opts.seatSuspended ? "SYSTEM" : null,
    ...(opts.status === "REVOKED" ? { revokedAt: new Date() } : {}),
  });
  return emp;
}

interface Ctx {
  owner: { id: number; token: string };
  profileId: number;
  activeEmployee: { id: number; token: string };
  suspendedEmployee: { id: number; token: string };
  revokedEmployee: { id: number; token: string };
  customer: { id: number; token: string };
}

let ctx: Ctx;

beforeAll(async () => {
  const owner = await createUser("owner", "trader");
  const profileId = await createProfile(owner.id, "owner");
  const activeEmployee = await addEmployee(profileId, "emp-active", {
    status: "ACTIVE",
    seatSuspended: false,
  });
  const suspendedEmployee = await addEmployee(profileId, "emp-suspended", {
    status: "ACTIVE",
    seatSuspended: true,
  });
  // Stale suspension marker on a REVOKED row: must be invisible to the guard.
  const revokedEmployee = await addEmployee(profileId, "emp-revoked", {
    status: "REVOKED",
    seatSuspended: true,
  });
  const customer = await createUser("customer", "customer");
  ctx = { owner, profileId, activeEmployee, suspendedEmployee, revokedEmployee, customer };
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db
      .delete(companyMembersTable)
      .where(inArray(companyMembersTable.userId, createdUserIds));
  }
  for (const id of createdProfileIds) {
    await db.delete(traderProfilesTable).where(eq(traderProfilesTable.id, id));
  }
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

/** Probe every gated route with the given token; nonexistent ids are fine
 * because the guard runs before resource resolution. */
async function probeAll(token: string) {
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  return {
    mute: await auth(
      request(app).patch("/api/conversations/999999999/mute").send({ muted: true }),
    ),
    report: await auth(
      request(app)
        .post("/api/conversations/999999999/report")
        .send({ reason: "SPAM", details: "matrix probe" }),
    ),
    reviewReply: await auth(
      request(app).post("/api/trader/reviews/999999999/reply").send({ reply: "Thanks!" }),
    ),
    profilePut: await auth(
      request(app).put("/api/profile").send({ businessDescription: "matrix probe" }),
    ),
    revalidate: await auth(request(app).post("/api/profile/revalidate").send({})),
    businessEmailSend: await auth(
      request(app).post("/api/profile/business-email/send").send({}),
    ),
  };
}

function expectSeatSuspended(res: request.Response) {
  expect(res.status).toBe(403);
  expect(res.body.code).toBe("SEAT_SUSPENDED");
}

function expectNotSeatBlocked(res: request.Response) {
  // Any outcome is acceptable except the seat guard's own refusal.
  expect(res.body?.code).not.toBe("SEAT_SUSPENDED");
}

describe("requireActiveSeat mutation matrix", () => {
  it("refuses a seat-suspended ACTIVE employee on every gated mutation", async () => {
    const results = await probeAll(ctx.suspendedEmployee.token);
    for (const res of Object.values(results)) {
      expectSeatSuspended(res);
    }
  });

  it("does not block an ACTIVE employee with a live seat", async () => {
    const results = await probeAll(ctx.activeEmployee.token);
    for (const res of Object.values(results)) {
      expectNotSeatBlocked(res);
    }
  });

  it("ignores a stale suspension marker on a REVOKED membership", async () => {
    const results = await probeAll(ctx.revokedEmployee.token);
    for (const res of Object.values(results)) {
      expectNotSeatBlocked(res);
    }
  });

  it("never blocks the owner (owners hold no seat)", async () => {
    const results = await probeAll(ctx.owner.token);
    for (const res of Object.values(results)) {
      expectNotSeatBlocked(res);
    }
  });

  it("skips customers entirely on the mixed-audience conversation routes", async () => {
    const auth = (r: request.Test) =>
      r.set("Authorization", `Bearer ${ctx.customer.token}`);
    const mute = await auth(
      request(app).patch("/api/conversations/999999999/mute").send({ muted: true }),
    );
    const report = await auth(
      request(app)
        .post("/api/conversations/999999999/report")
        .send({ reason: "SPAM", details: "matrix probe" }),
    );
    expectNotSeatBlocked(mute);
    expectNotSeatBlocked(report);
  });
});
