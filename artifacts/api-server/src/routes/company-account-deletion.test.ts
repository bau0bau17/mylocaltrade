import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import request from "supertest";
import bcryptjs from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  companyMembersTable,
  conversationsTable,
  messagesTable,
  enquiriesTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";

vi.mock("../lib/push-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/push-notifications")>();
  return { ...actual, sendPushToUser: vi.fn(async () => true) };
});
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendAccountDeletionReceivedEmail: vi.fn(async () => {}),
    sendAccountDeletionCancelledEmail: vi.fn(async () => {}),
    sendAccountDeletionCompletedEmail: vi.fn(async () => {}),
    sendAdminAccountDeletionAlertEmail: vi.fn(async () => {}),
  };
});

import app from "../app";
import { generateToken } from "../lib/auth";
import { sendPushToUser } from "../lib/push-notifications";

/**
 * Company Teams — employee account deletion / deactivation safety.
 *
 * Contract under test:
 *  - POST /account/deletion-request by an EMPLOYEE locks the account, so all
 *    of their LIVE jobs move to the owner inside the SAME transaction (the
 *    Phase 3 handover). Completed/cancelled jobs keep their historical
 *    assignee. Customers on moved jobs get the standard handover system
 *    message; the owner gets ONE summary push (they did not initiate this).
 *  - Membership stays ACTIVE at request time so a cancelled request restores
 *    the member cleanly (jobs do NOT auto-return — the owner reassigns back
 *    manually if wanted).
 *  - The terminal admin routes (anonymise / complete) revoke the EMPLOYEE
 *    membership and re-run the handover as a safety net for crash gaps.
 *  - reassignJobTx refuses a target whose account is deletion-flagged or
 *    inactive (INVALID_ASSIGNEE) — a live job must never be handed to a
 *    locked-out account. Handover TO the owner is never blocked.
 *  - All of the above is flag-INDEPENDENT: COMPANY_TEAMS_ENABLED=false must
 *    not strand live jobs on a dead account either.
 *  - Employees keep full account essentials (deletion works with the same
 *    password + confirm flow as everyone) but stay blocked from billing.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `company-del+${label}-${SUFFIX}@example.test`;
const PASSWORD = "delete-me-123!";

const EXTERNAL_FLAG = process.env["COMPANY_TEAMS_ENABLED"];
function setFlag(on: boolean): void {
  if (on) process.env["COMPANY_TEAMS_ENABLED"] = "true";
  else delete process.env["COMPANY_TEAMS_ENABLED"];
}
function restoreFlag(): void {
  if (EXTERNAL_FLAG === undefined) delete process.env["COMPANY_TEAMS_ENABLED"];
  else process.env["COMPANY_TEAMS_ENABLED"] = EXTERNAL_FLAG;
}

const pushMock = vi.mocked(sendPushToUser);

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdEnquiryIds: number[] = [];
const createdConversationIds: number[] = [];

let passwordHash: string;

async function createUser(
  role: "customer" | "trader" | "admin",
  label: string,
  extras?: Partial<typeof usersTable.$inferInsert>,
): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash,
      fullName: `Del ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      phone: "+447000000041",
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      ...extras,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function createTraderProfile(
  userId: number,
  label: string,
  extras?: Partial<typeof traderProfilesTable.$inferInsert>,
): Promise<number> {
  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId,
      businessName: `Del Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000040",
      mainCategory: "plumbing",
      town: "London",
      postcode: "SW1A 1AA",
      isActive: true,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
      ...extras,
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

async function createConversation(opts: {
  profileId: number;
  ownerUserId: number;
  customerId: number;
  assignedTo: number | null;
  completed?: boolean;
}): Promise<number> {
  const [e] = await db
    .insert(enquiriesTable)
    .values({
      traderId: opts.profileId,
      customerId: opts.customerId,
      message: "Need help with a leaking boiler please",
      serviceRequired: "Boiler service",
      status: "pending",
    })
    .returning({ id: enquiriesTable.id });
  createdEnquiryIds.push(e.id);
  const [c] = await db
    .insert(conversationsTable)
    .values({
      customerId: opts.customerId,
      traderUserId: opts.ownerUserId,
      traderProfileId: opts.profileId,
      enquiryId: e.id,
      serviceRequired: "Boiler service",
      status: "AWAITING_TRADER_REPLY",
      traderStatus: "NEW",
      assignedTraderUserId: opts.assignedTo,
      assignedAt: opts.assignedTo != null ? new Date() : null,
      ...(opts.completed
        ? { customerAcceptedAt: new Date(), customerCompletedAt: new Date() }
        : {}),
    })
    .returning({ id: conversationsTable.id });
  createdConversationIds.push(c.id);
  return c.id;
}

async function assignedUserOf(convId: number): Promise<number | null> {
  const [row] = await db
    .select({ assigned: conversationsTable.assignedTraderUserId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId));
  return row.assigned;
}

async function membershipStatusOf(memberId: number) {
  const [row] = await db
    .select({
      status: companyMembersTable.status,
      revokedByUserId: companyMembersTable.revokedByUserId,
    })
    .from(companyMembersTable)
    .where(eq(companyMembersTable.id, memberId));
  return row;
}

function requestDeletion(token: string) {
  return request(app)
    .post("/api/account/deletion-request")
    .set("Authorization", `Bearer ${token}`)
    .send({ password: PASSWORD, confirm: true });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let ownerA: number;
let ownerAToken: string;
let profileA: number;
let customer: number;
let admin: number;
let adminToken: string;

let empOne: number;
let empOneToken: string;
let empOneMemberId: number;
let empTwo: number;
let empTwoToken: string;
let empTwoMemberId: number;
let empThree: number;
let empThreeMemberId: number;
let empFour: number;
let empFourMemberId: number;
let empFive: number;
let empFiveToken: string;
let empFiveMemberId: number;
let empSix: number;
let empSixToken: string;

let convLive: number;
let convDone: number;
let convOwner: number;
let convLive2: number;
let convLive3: number;
let convLive4: number;
let convLive5: number;

beforeAll(async () => {
  setFlag(true);
  passwordHash = await bcryptjs.hash(PASSWORD, 4);

  ownerA = await createUser("trader", "boss");
  profileA = await createTraderProfile(ownerA, "A");
  await insertMembership({ profileId: profileA, userId: ownerA, role: "OWNER" });
  customer = await createUser("customer", "buyer");
  admin = await createUser("admin", "ops");

  empOne = await createUser("trader", "one");
  empOneMemberId = await insertMembership({ profileId: profileA, userId: empOne });
  empTwo = await createUser("trader", "two");
  empTwoMemberId = await insertMembership({ profileId: profileA, userId: empTwo });
  empThree = await createUser("trader", "three");
  empThreeMemberId = await insertMembership({ profileId: profileA, userId: empThree });
  empFour = await createUser("trader", "four");
  empFourMemberId = await insertMembership({ profileId: profileA, userId: empFour });
  empFive = await createUser("trader", "five");
  empFiveMemberId = await insertMembership({ profileId: profileA, userId: empFive });
  empSix = await createUser("trader", "six");
  await insertMembership({ profileId: profileA, userId: empSix });

  ownerAToken = generateToken(ownerA, "trader");
  adminToken = generateToken(admin, "admin");
  empOneToken = generateToken(empOne, "trader");
  empTwoToken = generateToken(empTwo, "trader");
  empFiveToken = generateToken(empFive, "trader");
  empSixToken = generateToken(empSix, "trader");

  convLive = await createConversation({
    profileId: profileA,
    ownerUserId: ownerA,
    customerId: customer,
    assignedTo: empOne,
  });
  convDone = await createConversation({
    profileId: profileA,
    ownerUserId: ownerA,
    customerId: customer,
    assignedTo: empOne,
    completed: true,
  });
  convOwner = await createConversation({
    profileId: profileA,
    ownerUserId: ownerA,
    customerId: customer,
    assignedTo: ownerA,
  });
  convLive2 = await createConversation({
    profileId: profileA,
    ownerUserId: ownerA,
    customerId: customer,
    assignedTo: ownerA,
  });
  convLive3 = await createConversation({
    profileId: profileA,
    ownerUserId: ownerA,
    customerId: customer,
    assignedTo: empThree,
  });
  convLive4 = await createConversation({
    profileId: profileA,
    ownerUserId: ownerA,
    customerId: customer,
    assignedTo: empFour,
  });
  convLive5 = await createConversation({
    profileId: profileA,
    ownerUserId: ownerA,
    customerId: customer,
    assignedTo: empFive,
  });
});

afterAll(async () => {
  restoreFlag();
  if (createdConversationIds.length) {
    await db
      .delete(messagesTable)
      .where(inArray(messagesTable.conversationId, createdConversationIds));
    await db
      .delete(conversationsTable)
      .where(inArray(conversationsTable.id, createdConversationIds));
  }
  if (createdEnquiryIds.length) {
    await db.delete(enquiriesTable).where(inArray(enquiriesTable.id, createdEnquiryIds));
  }
  if (createdProfileIds.length) {
    await db
      .delete(companyMembersTable)
      .where(inArray(companyMembersTable.traderProfileId, createdProfileIds));
  }
  if (createdUserIds.length) {
    await db
      .delete(traderAuditLogTable)
      .where(
        or(
          inArray(traderAuditLogTable.userId, createdUserIds),
          inArray(traderAuditLogTable.performedBy, createdUserIds),
        ),
      );
  }
  if (createdProfileIds.length) {
    await db
      .delete(traderProfilesTable)
      .where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

beforeEach(() => {
  pushMock.mockClear();
});

// ---------------------------------------------------------------------------
// Deletion request → handover
// ---------------------------------------------------------------------------
describe("Employee deletion request — live jobs move to the owner", () => {
  let freshToken: string;

  it("hands live jobs to the owner and leaves finished jobs alone", async () => {
    const res = await requestDeletion(empOneToken);
    expect(res.status).toBe(200);
    expect(res.body.deletionStatus).toBe("REQUESTED");
    expect(typeof res.body.token).toBe("string");
    freshToken = res.body.token;

    // Live job moved; completed job keeps its historical assignee; the
    // owner's own job is untouched.
    expect(await assignedUserOf(convLive)).toBe(ownerA);
    expect(await assignedUserOf(convDone)).toBe(empOne);
    expect(await assignedUserOf(convOwner)).toBe(ownerA);

    // Membership stays ACTIVE at request time (cancel restores cleanly).
    expect((await membershipStatusOf(empOneMemberId)).status).toBe("ACTIVE");

    // Customer sees the standard handover system message on the moved job.
    await vi.waitFor(async () => {
      const msgs = await db
        .select({ body: messagesTable.body, senderRole: messagesTable.senderRole })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, convLive));
      const sys = msgs.find((m) => m.senderRole === "system");
      expect(sys?.body).toContain("Your job is now being handled by Del from");
    });

    // Customer push for the moved job + ONE summary push to the owner.
    await vi.waitFor(() => {
      const calls = pushMock.mock.calls;
      expect(
        calls.some(
          (c) =>
            c[0] === customer &&
            c[1].data?.type === "job_reassigned" &&
            c[1].data?.conversationId === convLive,
        ),
      ).toBe(true);
      expect(
        calls.some((c) => c[0] === ownerA && c[1].title === "Jobs handed to you"),
      ).toBe(true);
    });

    // One aggregate audit row, anchored to the owner, listing the moved job.
    await vi.waitFor(async () => {
      const rows = await db
        .select()
        .from(traderAuditLogTable)
        .where(
          and(
            eq(traderAuditLogTable.userId, ownerA),
            eq(traderAuditLogTable.action, "JOBS_HANDED_TO_OWNER_ON_ACCOUNT_DELETION"),
          ),
        );
      expect(rows.length).toBe(1);
      const details = rows[0].details as { conversationIds?: number[]; fromUserId?: number };
      expect(details.conversationIds).toEqual([convLive]);
      expect(details.fromUserId).toBe(empOne);
      expect(rows[0].performedBy).toBe(empOne);
    });
  });

  it("refuses a repeat request — the locked account only reaches the cancel flow", async () => {
    // deletion-request sits behind the strict authMiddleware, which refuses
    // deletion-flagged accounts outright (401). The fresh token is only
    // honoured by the allow-deletion routes (status/cancel). The handler's
    // own 409 ALREADY_REQUESTED guard covers the middleware-read race.
    const res = await requestDeletion(freshToken);
    expect(res.status).toBe(401);

    // At-most-once side effects: still exactly ONE handover audit row.
    const rows = await db
      .select()
      .from(traderAuditLogTable)
      .where(
        and(
          eq(traderAuditLogTable.userId, ownerA),
          eq(traderAuditLogTable.action, "JOBS_HANDED_TO_OWNER_ON_ACCOUNT_DELETION"),
        ),
      );
    expect(rows.length).toBe(1);
  });

  it("cancel restores the account but jobs stay with the owner", async () => {
    const res = await request(app)
      .post("/api/account/deletion-cancel")
      .set("Authorization", `Bearer ${freshToken}`)
      .send({ password: PASSWORD, confirm: true });
    expect(res.status).toBe(200);

    const [user] = await db
      .select({ deletionStatus: usersTable.deletionStatus, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.id, empOne));
    expect(user.deletionStatus).toBeNull();
    expect(user.isActive).toBe(true);
    expect((await membershipStatusOf(empOneMemberId)).status).toBe("ACTIVE");
    // No auto-return: the owner reassigns back manually if they want to.
    expect(await assignedUserOf(convLive)).toBe(ownerA);
  });
});

// ---------------------------------------------------------------------------
// Reassignment target availability
// ---------------------------------------------------------------------------
describe("Reassignment refuses unavailable targets", () => {
  it("owner cannot hand a live job to a deletion-pending member", async () => {
    const del = await requestDeletion(empTwoToken);
    expect(del.status).toBe(200);
    // empTwo had no live jobs, so nothing moved — but their membership is
    // still ACTIVE, which is exactly why the availability check must exist.
    expect((await membershipStatusOf(empTwoMemberId)).status).toBe("ACTIVE");

    const res = await request(app)
      .post(`/api/conversations/${convLive2}/reassign`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ toUserId: empTwo });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_ASSIGNEE");
    expect(await assignedUserOf(convLive2)).toBe(ownerA);
  });
});

// ---------------------------------------------------------------------------
// Terminal admin routes — membership revoke + safety-net sweep
// ---------------------------------------------------------------------------
describe("Admin finalisation revokes membership and sweeps stragglers", () => {
  it("anonymise revokes the EMPLOYEE membership and hands over a straggler job", async () => {
    // Simulate a crash gap: account flagged for deletion WITHOUT the
    // request-time handover having run (direct DB write, no API call).
    await db
      .update(usersTable)
      .set({ deletionStatus: "REQUESTED", deletionRequestedAt: new Date() })
      .where(eq(usersTable.id, empThree));

    const res = await request(app)
      .post(`/api/admin/account-deletions/${empThree}/anonymise`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);

    const membership = await membershipStatusOf(empThreeMemberId);
    expect(membership.status).toBe("REVOKED");
    expect(membership.revokedByUserId).toBe(admin);
    expect(await assignedUserOf(convLive3)).toBe(ownerA);

    // Roster audit explains WHY the member vanished.
    await vi.waitFor(async () => {
      const rows = await db
        .select()
        .from(traderAuditLogTable)
        .where(
          and(
            eq(traderAuditLogTable.userId, ownerA),
            eq(traderAuditLogTable.action, "MEMBER_REMOVED"),
            eq(traderAuditLogTable.performedBy, admin),
          ),
        );
      const mine = rows.filter(
        (r) => (r.details as { memberUserId?: number }).memberUserId === empThree,
      );
      expect(mine.length).toBe(1);
      expect((mine[0].details as { viaAccountDeletion?: boolean }).viaAccountDeletion).toBe(
        true,
      );
    });

    // Customer notified on the swept job.
    await vi.waitFor(async () => {
      const msgs = await db
        .select({ senderRole: messagesTable.senderRole, body: messagesTable.body })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, convLive3));
      expect(msgs.some((m) => m.senderRole === "system")).toBe(true);
    });
  });

  it("anonymise is idempotent for membership (second call is a 409 no-op)", async () => {
    const res = await request(app)
      .post(`/api/admin/account-deletions/${empThree}/anonymise`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect((await membershipStatusOf(empThreeMemberId)).status).toBe("REVOKED");
  });

  it("complete revokes membership when anonymise was skipped", async () => {
    await db
      .update(usersTable)
      .set({ deletionStatus: "REQUESTED", deletionRequestedAt: new Date() })
      .where(eq(usersTable.id, empFour));

    const res = await request(app)
      .post(`/api/admin/account-deletions/${empFour}/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);

    const membership = await membershipStatusOf(empFourMemberId);
    expect(membership.status).toBe("REVOKED");
    expect(membership.revokedByUserId).toBe(admin);
    expect(await assignedUserOf(convLive4)).toBe(ownerA);
  });
});

// ---------------------------------------------------------------------------
// Flag independence
// ---------------------------------------------------------------------------
describe("Handover safety is flag-independent", () => {
  it("sweeps live jobs even with COMPANY_TEAMS_ENABLED off", async () => {
    setFlag(false);
    try {
      const res = await requestDeletion(empFiveToken);
      expect(res.status).toBe(200);
      expect(await assignedUserOf(convLive5)).toBe(ownerA);
      expect((await membershipStatusOf(empFiveMemberId)).status).toBe("ACTIVE");
    } finally {
      setFlag(true);
    }
  });

  it("solo trader deletion is untouched by handover logic", async () => {
    const solo = await createUser("trader", "solo");
    const soloProfile = await createTraderProfile(solo, "Solo");
    const soloToken = generateToken(solo, "trader");

    const res = await requestDeletion(soloToken);
    expect(res.status).toBe(200);

    const [profile] = await db
      .select({ isActive: traderProfilesTable.isActive })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, soloProfile));
    expect(profile.isActive).toBe(false);

    const rows = await db
      .select()
      .from(traderAuditLogTable)
      .where(
        and(
          eq(traderAuditLogTable.userId, solo),
          eq(traderAuditLogTable.action, "JOBS_HANDED_TO_OWNER_ON_ACCOUNT_DELETION"),
        ),
      );
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Employee billing stays fail-closed
// ---------------------------------------------------------------------------
describe("Employees stay blocked from billing", () => {
  it("demo-activate refuses an employee (no owned VERIFIED profile)", async () => {
    const res = await request(app)
      .post("/api/subscriptions/demo-activate")
      .set("Authorization", `Bearer ${empSixToken}`)
      .send({ planId: "premium" });
    expect(res.status).toBe(403);
  });

  it("subscription cancel refuses an employee (no subscription of their own)", async () => {
    const res = await request(app)
      .post("/api/subscriptions/cancel")
      .set("Authorization", `Bearer ${empSixToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
