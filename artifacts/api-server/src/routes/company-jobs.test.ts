import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { Readable } from "stream";
import crypto from "node:crypto";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  companyMembersTable,
  companyInvitesTable,
  conversationsTable,
  messagesTable,
  quotesTable,
  enquiriesTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { eq, inArray, or, and } from "drizzle-orm";

vi.mock("../lib/push-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/push-notifications")>();
  return { ...actual, sendPushToUser: vi.fn(async () => true) };
});
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendNewEnquiryEmail: vi.fn(async () => {}),
    sendEnquirySentToCustomerEmail: vi.fn(async () => {}),
  };
});

import app from "../app";
import { generateToken } from "../lib/auth";
import { sendPushToUser } from "../lib/push-notifications";
import { sendNewEnquiryEmail } from "../lib/email";
import { ObjectStorageService } from "../lib/objectStorage";

/**
 * Company Teams Phase 2 — shared leads, atomic claiming, identity &
 * notification routing.
 *
 * Contract under test (flag ON):
 *  - A new company lead is UNASSIGNED; the first member to message or quote
 *    claims it atomically inside the same transaction as their write. Losers
 *    of a race get 409 JOB_CLAIMED_BY_OTHER and their write never persists.
 *  - Viewing, customer messages and cancelling an unclaimed lead never claim.
 *  - A claimed job is read-only for every other member INCLUDING the owner
 *    (until Phase 3 reassignment): message/quote/close/cancel/mark-done/
 *    booking actions all 409 with the assignee's name.
 *  - Notifications: unclaimed → all ACTIVE members; claimed → assignee +
 *    owner (deduped); new-enquiry email stays owner-only while push fans out.
 *  - Customer-facing identity: business logo pre-claim, personal name +
 *    avatar post-claim; viewerCanAct steers the trader-side read-only UI.
 *
 * Flag OFF: conversations are born assigned to the owner at creation, no 409s
 * exist, and the serialized payload matches the legacy shape.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `company-jobs+${label}-${SUFFIX}@example.test`;

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
const newEnquiryEmailMock = vi.mocked(sendNewEnquiryEmail);

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdEnquiryIds: number[] = [];
const createdConversationIds: number[] = [];
const createdInviteIds: number[] = [];

async function createUser(
  role: "customer" | "trader",
  label: string,
  extras?: Partial<typeof usersTable.$inferInsert>,
): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Jobs ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      phone: "+447000000031",
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
      businessName: `Jobs Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000030",
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
}): Promise<void> {
  await db.insert(companyMembersTable).values({
    traderProfileId: opts.profileId,
    userId: opts.userId,
    role: opts.role ?? "EMPLOYEE",
    status: opts.status ?? "ACTIVE",
  });
}

// ---------------------------------------------------------------------------
// Fixture identities
// ---------------------------------------------------------------------------
let ownerA: number;
let ownerAToken: string;
let profileA: number;
let empOne: number;
let empOneToken: string;
let empOneName: string;
let empTwo: number;
let empTwoToken: string;
let removedEmp: number;
let removedEmpToken: string;
let ownerB: number;
let ownerBToken: string;
let profileB: number;
let empB: number;
let empBToken: string;
let customer: number;
let customerToken: string;
let customerTwo: number;
let customerTwoToken: string;

const LOGO_PATH = () => `/objects/customer-uploads/${ownerA}/logo-company-a`;
const EMP_ONE_AVATAR = () => `/objects/customer-uploads/${empOne}/avatar-empone`;
const CUSTOMER_AVATAR = () => `/objects/customer-uploads/${customer}/avatar-buyer`;

async function seedLead(opts?: {
  customerId?: number;
  company?: "A" | "B";
  assignedTo?: number | null;
  hired?: boolean;
}): Promise<number> {
  const profileId = opts?.company === "B" ? profileB : profileA;
  const ownerUserId = opts?.company === "B" ? ownerB : ownerA;
  const custId = opts?.customerId ?? customer;
  const [e] = await db
    .insert(enquiriesTable)
    .values({
      traderId: profileId,
      customerId: custId,
      message: "Need help with a leaking boiler please",
      serviceRequired: "Boiler service",
      status: "pending",
    })
    .returning({ id: enquiriesTable.id });
  createdEnquiryIds.push(e.id);
  const assignedTo = opts?.assignedTo ?? null;
  const [c] = await db
    .insert(conversationsTable)
    .values({
      customerId: custId,
      traderUserId: ownerUserId,
      traderProfileId: profileId,
      enquiryId: e.id,
      serviceRequired: "Boiler service",
      status: "AWAITING_TRADER_REPLY",
      traderStatus: "NEW",
      assignedTraderUserId: assignedTo,
      assignedAt: assignedTo != null ? new Date() : null,
      ...(opts?.hired ? { customerAcceptedAt: new Date() } : {}),
    })
    .returning({ id: conversationsTable.id });
  createdConversationIds.push(c.id);
  return c.id;
}

function sendMsg(convId: number, token: string, body = "Thanks for getting in touch, happy to help") {
  return request(app)
    .post(`/api/conversations/${convId}/messages`)
    .set("Authorization", `Bearer ${token}`)
    .send({ body });
}

const validQuote = {
  amountPence: 45_000,
  priceType: "FIXED",
  description: "Full boiler service including parts",
};

function sendQuote(convId: number, token: string) {
  return request(app)
    .post(`/api/conversations/${convId}/quotes`)
    .set("Authorization", `Bearer ${token}`)
    .send(validQuote);
}

function getDetail(convId: number, token: string) {
  return request(app)
    .get(`/api/conversations/${convId}`)
    .set("Authorization", `Bearer ${token}`);
}

async function getConv(convId: number) {
  const [row] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);
  return row;
}

async function traderMessagesCount(convId: number): Promise<number> {
  const rows = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(
      and(eq(messagesTable.conversationId, convId), eq(messagesTable.senderRole, "trader")),
    );
  return rows.length;
}

async function quotesCount(convId: number): Promise<number> {
  const rows = await db
    .select({ id: quotesTable.id })
    .from(quotesTable)
    .where(eq(quotesTable.conversationId, convId));
  return rows.length;
}

type AuditRow = typeof traderAuditLogTable.$inferSelect;

async function auditsFor(convId: number, action: string): Promise<AuditRow[]> {
  const rows = await db
    .select()
    .from(traderAuditLogTable)
    .where(
      and(
        eq(traderAuditLogTable.action, action),
        inArray(traderAuditLogTable.userId, createdUserIds),
      ),
    );
  return rows.filter(
    (r) => (r.details as Record<string, unknown> | null)?.["conversationId"] === convId,
  );
}

/** Claim audits are fire-and-forget post-commit — poll briefly, then settle. */
async function waitForAudits(convId: number, action: string, expectAtLeast = 1): Promise<AuditRow[]> {
  const deadline = Date.now() + 4000;
  for (;;) {
    const rows = await auditsFor(convId, action);
    if (rows.length >= expectAtLeast || Date.now() > deadline) {
      if (rows.length >= expectAtLeast) {
        // Settle window so a duplicate write (the bug we test against) would land.
        await new Promise((r) => setTimeout(r, 250));
        return auditsFor(convId, action);
      }
      return rows;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function pushedUserIds(filter?: (payload: Record<string, unknown>) => boolean): number[] {
  return pushMock.mock.calls
    .filter((c) => (filter ? filter(c[1] as unknown as Record<string, unknown>) : true))
    .map((c) => c[0] as number);
}

/**
 * Notification fan-out is fire-and-forget (the route responds before pushes
 * land), so poll until the expected number of pushes arrived, then allow a
 * settle window to catch over-delivery before returning the recipient list.
 */
/** Filter pushes down to the ones fired for one specific message. */
const forMessage =
  (messageId: number) =>
  (p: Record<string, unknown>): boolean =>
    (p["data"] as Record<string, unknown> | undefined)?.["messageId"] === messageId;

async function waitForPushes(
  expectedCount: number,
  filter?: (payload: Record<string, unknown>) => boolean,
): Promise<number[]> {
  const deadline = Date.now() + 4000;
  for (;;) {
    const ids = pushedUserIds(filter);
    if (ids.length >= expectedCount || Date.now() > deadline) {
      await new Promise((r) => setTimeout(r, 250));
      return pushedUserIds(filter);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  // Company A: owner + two active employees + one removed employee.
  ownerA = await createUser("trader", "ownerA");
  profileA = await createTraderProfile(ownerA, "alpha", { logoUrl: undefined });
  // Logo path depends on ownerA's id, set it after creation.
  await db
    .update(traderProfilesTable)
    .set({ logoUrl: LOGO_PATH() })
    .where(eq(traderProfilesTable.id, profileA));
  empOne = await createUser("trader", "empOne");
  await db.update(usersTable).set({ avatarUrl: EMP_ONE_AVATAR() }).where(eq(usersTable.id, empOne));
  empTwo = await createUser("trader", "empTwo");
  removedEmp = await createUser("trader", "removed");
  await insertMembership({ profileId: profileA, userId: ownerA, role: "OWNER" });
  await insertMembership({ profileId: profileA, userId: empOne });
  await insertMembership({ profileId: profileA, userId: empTwo });
  await insertMembership({ profileId: profileA, userId: removedEmp, status: "REVOKED" });

  // Company B: separate firm to prove cross-company isolation.
  ownerB = await createUser("trader", "ownerB");
  profileB = await createTraderProfile(ownerB, "beta");
  empB = await createUser("trader", "empB");
  await insertMembership({ profileId: profileB, userId: ownerB, role: "OWNER" });
  await insertMembership({ profileId: profileB, userId: empB });

  customer = await createUser("customer", "buyer");
  customerTwo = await createUser("customer", "second");

  ownerAToken = generateToken(ownerA, "trader");
  empOneToken = generateToken(empOne, "trader");
  empTwoToken = generateToken(empTwo, "trader");
  removedEmpToken = generateToken(removedEmp, "trader");
  ownerBToken = generateToken(ownerB, "trader");
  empBToken = generateToken(empB, "trader");
  customerToken = generateToken(customer, "customer");
  customerTwoToken = generateToken(customerTwo, "customer");

  const [empOneRow] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, empOne))
    .limit(1);
  empOneName = empOneRow.fullName;
});

afterAll(async () => {
  restoreFlag();
  if (createdConversationIds.length) {
    await db.delete(quotesTable).where(inArray(quotesTable.conversationId, createdConversationIds));
    await db.delete(messagesTable).where(inArray(messagesTable.conversationId, createdConversationIds));
    await db.delete(conversationsTable).where(inArray(conversationsTable.id, createdConversationIds));
  }
  if (createdEnquiryIds.length) {
    await db.delete(enquiriesTable).where(inArray(enquiriesTable.id, createdEnquiryIds));
  }
  if (createdInviteIds.length) {
    await db.delete(companyInvitesTable).where(inArray(companyInvitesTable.id, createdInviteIds));
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
      .delete(companyMembersTable)
      .where(inArray(companyMembersTable.traderProfileId, createdProfileIds));
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

beforeEach(() => {
  setFlag(true);
  pushMock.mockClear();
  newEnquiryEmailMock.mockClear();
});

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------
describe("job claiming (flag ON)", () => {
  it("first trader message claims the job for that member", async () => {
    const convId = await seedLead();
    const res = await sendMsg(convId, empOneToken);
    expect(res.status).toBe(201);

    const conv = await getConv(convId);
    expect(conv.assignedTraderUserId).toBe(empOne);
    expect(conv.assignedAt).not.toBeNull();

    const audits = await waitForAudits(convId, "JOB_CLAIMED");
    expect(audits.length).toBe(1);
    expect(audits[0].performedBy).toBe(empOne);
    expect((audits[0].details as Record<string, unknown>)["via"]).toBe("message");

    const detail = await getDetail(convId, empOneToken);
    expect(detail.status).toBe(200);
    expect(detail.body.conversation.viewerCanAct).toBe(true);
  });

  it("first quote claims the job and records the member-quote audit", async () => {
    const convId = await seedLead();
    const res = await sendQuote(convId, empTwoToken);
    expect(res.status).toBeLessThan(300);

    const conv = await getConv(convId);
    expect(conv.assignedTraderUserId).toBe(empTwo);
    expect(await quotesCount(convId)).toBe(1);

    const claims = await waitForAudits(convId, "JOB_CLAIMED");
    expect(claims.length).toBe(1);
    expect((claims[0].details as Record<string, unknown>)["via"]).toBe("quote");

    const memberQuotes = await waitForAudits(convId, "QUOTE_SUBMITTED_BY_MEMBER");
    expect(memberQuotes.length).toBe(1);
    expect(memberQuotes[0].performedBy).toBe(empTwo);
  });

  it("viewing a lead never claims it", async () => {
    const convId = await seedLead();
    const asEmpOne = await getDetail(convId, empOneToken);
    expect(asEmpOne.status).toBe(200);
    expect(asEmpOne.body.conversation.viewerCanAct).toBe(true); // unclaimed → anyone may act

    const list = await request(app)
      .get(`/api/conversations`)
      .set("Authorization", `Bearer ${empTwoToken}`);
    expect(list.status).toBe(200);

    const conv = await getConv(convId);
    expect(conv.assignedTraderUserId).toBeNull();
  });

  it("customer messages never claim the job", async () => {
    const convId = await seedLead();
    const res = await sendMsg(convId, customerToken, "Just checking you got my enquiry");
    expect(res.status).toBe(201);
    const conv = await getConv(convId);
    expect(conv.assignedTraderUserId).toBeNull();
  });

  it("cancelling an UNCLAIMED lead is allowed for any member and does not claim", async () => {
    const convId = await seedLead();
    const res = await request(app)
      .post(`/api/conversations/${convId}/cancel`)
      .set("Authorization", `Bearer ${empTwoToken}`)
      .send({ reason: "Customer no longer needs the work" });
    expect(res.status).toBeLessThan(300);
    const conv = await getConv(convId);
    expect(conv.assignedTraderUserId).toBeNull();
    expect(conv.cancelledAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Races — exactly one winner, loser's write never persists
// ---------------------------------------------------------------------------
describe("claim races (flag ON)", () => {
  it("message vs message: one winner, loser 409 and no second message", async () => {
    const convId = await seedLead();
    const [a, b] = await Promise.all([
      sendMsg(convId, empOneToken, "I can take this job on for you"),
      sendMsg(convId, empTwoToken, "Happy to come round and take a look"),
    ]);
    const results = [a, b];
    const winners = results.filter((r) => r.status === 201);
    const losers = results.filter((r) => r.status === 409);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0].body.code).toBe("JOB_CLAIMED_BY_OTHER");

    const conv = await getConv(convId);
    expect([empOne, empTwo]).toContain(conv.assignedTraderUserId);
    const winnerName = (
      await db.select({ n: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, conv.assignedTraderUserId!)).limit(1)
    )[0].n;
    expect(losers[0].body.assignedName).toBe(winnerName);

    expect(await traderMessagesCount(convId)).toBe(1);
    const audits = await waitForAudits(convId, "JOB_CLAIMED");
    expect(audits.length).toBe(1);
  });

  it("quote vs quote: one winner, loser 409 and no second quote", async () => {
    const convId = await seedLead();
    const [a, b] = await Promise.all([
      sendQuote(convId, empOneToken),
      sendQuote(convId, empTwoToken),
    ]);
    const results = [a, b];
    const winners = results.filter((r) => r.status < 300);
    const losers = results.filter((r) => r.status === 409);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0].body.code).toBe("JOB_CLAIMED_BY_OTHER");

    expect(await quotesCount(convId)).toBe(1);
    const audits = await waitForAudits(convId, "JOB_CLAIMED");
    expect(audits.length).toBe(1);
  });

  it("message vs quote: exactly one artifact persists overall", async () => {
    const convId = await seedLead();
    const [msgRes, quoteRes] = await Promise.all([
      sendMsg(convId, empOneToken, "I will send a quote over shortly"),
      sendQuote(convId, empTwoToken),
    ]);
    const statuses = [msgRes.status, quoteRes.status].sort();
    expect(statuses.filter((s) => s === 409).length).toBe(1);
    expect(statuses.filter((s) => s < 300).length).toBe(1);

    const msgCount = await traderMessagesCount(convId);
    const qCount = await quotesCount(convId);
    // Whichever lost must have left nothing behind.
    expect(msgCount + qCount).toBe(1);

    const conv = await getConv(convId);
    expect(conv.assignedTraderUserId).toBe(msgRes.status === 201 ? empOne : empTwo);

    const audits = await waitForAudits(convId, "JOB_CLAIMED");
    expect(audits.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Read-only enforcement once claimed
// ---------------------------------------------------------------------------
describe("claimed jobs are read-only for other members (flag ON)", () => {
  it("other members and the owner get 409 with the assignee's name on every action", async () => {
    const convId = await seedLead({ assignedTo: undefined });
    // empOne claims properly (via API) so the audit trail mirrors reality.
    const claim = await sendMsg(convId, empOneToken);
    expect(claim.status).toBe(201);

    const attempts = [
      sendMsg(convId, empTwoToken, "Let me pick this one up instead"),
      sendQuote(convId, empTwoToken),
      request(app)
        .post(`/api/conversations/${convId}/close`)
        .set("Authorization", `Bearer ${empTwoToken}`)
        .send({}),
      request(app)
        .post(`/api/conversations/${convId}/cancel`)
        .set("Authorization", `Bearer ${empTwoToken}`)
        .send({ reason: "Trying to cancel a colleagues job" }),
      // Owner is read-only too until Phase 3.
      sendMsg(convId, ownerAToken, "Owner checking in on this job"),
    ];
    for (const attempt of await Promise.all(attempts)) {
      expect(attempt.status).toBe(409);
      expect(attempt.body.code).toBe("JOB_CLAIMED_BY_OTHER");
      expect(attempt.body.assignedName).toBe(empOneName);
    }

    // The assignee keeps full control.
    const assigneeMsg = await sendMsg(convId, empOneToken, "Following up with more details");
    expect(assigneeMsg.status).toBe(201);
  });

  it("mark-done and booking actions are assignee-only on hired jobs", async () => {
    const convId = await seedLead({ assignedTo: undefined });
    const claim = await sendMsg(convId, empOneToken);
    expect(claim.status).toBe(201);
    await db
      .update(conversationsTable)
      .set({ customerAcceptedAt: new Date() })
      .where(eq(conversationsTable.id, convId));

    const futureSlot = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    futureSlot.setUTCMinutes(0, 0, 0);

    const markDone = await request(app)
      .post(`/api/conversations/${convId}/trader-mark-done`)
      .set("Authorization", `Bearer ${empTwoToken}`)
      .send({});
    expect(markDone.status).toBe(409);
    expect(markDone.body.code).toBe("JOB_CLAIMED_BY_OTHER");

    const proposeAsEmpTwo = await request(app)
      .post(`/api/conversations/${convId}/bookings`)
      .set("Authorization", `Bearer ${empTwoToken}`)
      .send({ startAt: futureSlot.toISOString() });
    expect(proposeAsEmpTwo.status).toBe(409);
    expect(proposeAsEmpTwo.body.code).toBe("JOB_CLAIMED_BY_OTHER");

    const proposeAsOwner = await request(app)
      .post(`/api/conversations/${convId}/bookings`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ startAt: futureSlot.toISOString() });
    expect(proposeAsOwner.status).toBe(409);

    // Assignee can mark done.
    const markDoneAsAssignee = await request(app)
      .post(`/api/conversations/${convId}/trader-mark-done`)
      .set("Authorization", `Bearer ${empOneToken}`)
      .send({});
    expect(markDoneAsAssignee.status).toBeLessThan(300);
  });

  it("company one-pending-quote holds: the assignee cannot double-quote", async () => {
    const convId = await seedLead();
    const first = await sendQuote(convId, empOneToken);
    expect(first.status).toBeLessThan(300);

    const second = await sendQuote(convId, empOneToken);
    expect(second.status).toBe(409);
    expect(second.body.code).not.toBe("JOB_CLAIMED_BY_OTHER");
    expect(await quotesCount(convId)).toBe(1);

    const asEmpTwo = await sendQuote(convId, empTwoToken);
    expect(asEmpTwo.status).toBe(409);
    expect(asEmpTwo.body.code).toBe("JOB_CLAIMED_BY_OTHER");
  });

  it("quote revise/withdraw are assignee-only; revoked and cross-company callers get 404", async () => {
    const convId = await seedLead();
    const created = await sendQuote(convId, empOneToken);
    expect(created.status).toBeLessThan(300);
    const quoteId = created.body.quote.id as number;

    const revision = {
      ...validQuote,
      amountPence: 52_000,
      description: "Updated parts pricing for the boiler service",
    };
    const reviseAsOwner = await request(app)
      .post(`/api/quotes/${quoteId}/revise`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send(revision);
    expect(reviseAsOwner.status).toBe(409);
    expect(reviseAsOwner.body.code).toBe("JOB_CLAIMED_BY_OTHER");
    expect(reviseAsOwner.body.assignedName).toBe(empOneName);

    const withdrawAsEmpTwo = await request(app)
      .post(`/api/quotes/${quoteId}/withdraw`)
      .set("Authorization", `Bearer ${empTwoToken}`)
      .send({});
    expect(withdrawAsEmpTwo.status).toBe(409);
    expect(withdrawAsEmpTwo.body.code).toBe("JOB_CLAIMED_BY_OTHER");

    // Revoked members and other companies must not even learn the quote exists.
    const withdrawAsRemoved = await request(app)
      .post(`/api/quotes/${quoteId}/withdraw`)
      .set("Authorization", `Bearer ${removedEmpToken}`)
      .send({});
    expect(withdrawAsRemoved.status).toBe(404);
    const reviseAsOtherCompany = await request(app)
      .post(`/api/quotes/${quoteId}/revise`)
      .set("Authorization", `Bearer ${empBToken}`)
      .send(revision);
    expect(reviseAsOtherCompany.status).toBe(404);

    // No rejected attempt touched the quote…
    expect(await quotesCount(convId)).toBe(1);

    // …and the assignee keeps full control end-to-end.
    const reviseAsAssignee = await request(app)
      .post(`/api/quotes/${quoteId}/revise`)
      .set("Authorization", `Bearer ${empOneToken}`)
      .send(revision);
    expect(reviseAsAssignee.status).toBe(201);
    const withdrawAsAssignee = await request(app)
      .post(`/api/quotes/${reviseAsAssignee.body.quote.id as number}/withdraw`)
      .set("Authorization", `Bearer ${empOneToken}`)
      .send({});
    expect(withdrawAsAssignee.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Cross-company and removed members
// ---------------------------------------------------------------------------
describe("company boundaries (flag ON)", () => {
  it("members of another company cannot touch the lead", async () => {
    const convId = await seedLead();
    const res = await sendMsg(convId, empBToken, "Hello from a different company");
    expect([403, 404]).toContain(res.status);
    const conv = await getConv(convId);
    expect(conv.assignedTraderUserId).toBeNull();
  });

  it("removed members lose access entirely", async () => {
    const convId = await seedLead();
    const res = await sendMsg(convId, removedEmpToken, "I used to work here");
    expect(res.status).toBeGreaterThanOrEqual(403);
    const conv = await getConv(convId);
    expect(conv.assignedTraderUserId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Notification routing
// ---------------------------------------------------------------------------
describe("notification routing (flag ON)", () => {
  it("customer message on an UNCLAIMED lead pushes every active member", async () => {
    const convId = await seedLead();
    pushMock.mockClear();
    const res = await sendMsg(convId, customerToken, "Could someone get back to me please");
    expect(res.status).toBe(201);
    const recipients = new Set(await waitForPushes(3, forMessage(res.body.id)));
    expect(recipients).toEqual(new Set([ownerA, empOne, empTwo]));
  });

  it("customer message on a CLAIMED lead pushes assignee + owner only", async () => {
    const convId = await seedLead({ assignedTo: empOne });
    pushMock.mockClear();
    const res = await sendMsg(convId, customerToken, "Thanks for the update yesterday");
    expect(res.status).toBe(201);
    const recipients = new Set(await waitForPushes(2, forMessage(res.body.id)));
    expect(recipients).toEqual(new Set([empOne, ownerA]));
  });

  it("owner-claimed lead pushes the owner once", async () => {
    const convId = await seedLead({ assignedTo: ownerA });
    pushMock.mockClear();
    const res = await sendMsg(convId, customerToken, "Are you still able to come round");
    expect(res.status).toBe(201);
    expect(await waitForPushes(1, forMessage(res.body.id))).toEqual([ownerA]);
  });

  it("new enquiry pushes all members but emails the owner only", async () => {
    pushMock.mockClear();
    newEnquiryEmailMock.mockClear();
    const res = await request(app)
      .post(`/api/enquiries`)
      .set("Authorization", `Bearer ${customerTwoToken}`)
      .send({
        traderId: profileA,
        message: "Please could you service our boiler soon",
        serviceRequired: "Boiler service",
      });
    expect(res.status).toBeLessThan(300);
    createdEnquiryIds.push(res.body.id);
    if (res.body.conversationId) createdConversationIds.push(res.body.conversationId);

    const enquiryPushes = new Set(
      await waitForPushes(3, (p) => (p["data"] as Record<string, unknown> | undefined)?.["type"] === "new_enquiry"),
    );
    expect(enquiryPushes).toEqual(new Set([ownerA, empOne, empTwo]));
    expect(newEnquiryEmailMock).toHaveBeenCalledTimes(1);

    // Flag ON: the conversation is born UNASSIGNED.
    const conv = await getConv(res.body.conversationId);
    expect(conv.assignedTraderUserId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Customer-facing identity + viewerCanAct
// ---------------------------------------------------------------------------
describe("assigned-person identity (flag ON)", () => {
  it("pre-claim: business identity (logo), no personal name or avatar", async () => {
    const convId = await seedLead();
    const detail = await getDetail(convId, customerToken);
    expect(detail.status).toBe(200);
    const conv = detail.body.conversation;
    expect(conv.assignedTraderUserId).toBeNull();
    expect(conv.assignedTraderName).toBeNull();
    expect(conv.traderAvatarUrl).toBeNull();
    expect(conv.traderLogoUrl).toBe(LOGO_PATH());
    expect(conv.viewerCanAct == null).toBe(true);
  });

  it("post-claim: personal identity of the assignee, viewerCanAct steers members", async () => {
    const convId = await seedLead();
    const claim = await sendMsg(convId, empOneToken);
    expect(claim.status).toBe(201);

    const asCustomer = (await getDetail(convId, customerToken)).body.conversation;
    expect(asCustomer.assignedTraderUserId).toBe(empOne);
    expect(asCustomer.assignedTraderName).toBe(empOneName);
    expect(asCustomer.traderAvatarUrl).toBe(EMP_ONE_AVATAR());
    expect(asCustomer.viewerCanAct == null).toBe(true);

    const asAssignee = (await getDetail(convId, empOneToken)).body.conversation;
    expect(asAssignee.viewerCanAct).toBe(true);
    const asColleague = (await getDetail(convId, empTwoToken)).body.conversation;
    expect(asColleague.viewerCanAct).toBe(false);
    const asOwner = (await getDetail(convId, ownerAToken)).body.conversation;
    expect(asOwner.viewerCanAct).toBe(false);
  });

  it("trader leads list exposes assigned member id + name", async () => {
    const claimedConv = await seedLead({ assignedTo: empOne });
    const unclaimedConv = await seedLead();
    const res = await request(app)
      .get(`/api/enquiries`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    const items: Array<Record<string, unknown>> = res.body.enquiries;
    const claimed = items.find((i) => i["conversationId"] === claimedConv);
    const unclaimed = items.find((i) => i["conversationId"] === unclaimedConv);
    expect(claimed).toBeDefined();
    expect(claimed!["assignedTraderUserId"]).toBe(empOne);
    expect(claimed!["assignedTraderName"]).toBe(empOneName);
    expect(unclaimed!["assignedTraderUserId"]).toBeNull();
    expect(unclaimed!["assignedTraderName"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Avatar-file authorisation follows assignment
// ---------------------------------------------------------------------------
describe("avatar-file access follows assignment (flag ON)", () => {
  it("customer and the assigned member can load each other's avatars; strangers cannot", async () => {
    await db
      .update(usersTable)
      .set({ avatarUrl: CUSTOMER_AVATAR() })
      .where(eq(usersTable.id, customer));
    await seedLead({ assignedTo: empOne });

    const FAKE_BYTES = Buffer.from("fake avatar bytes for company jobs test");
    const spy = vi
      .spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
      .mockImplementation(
        async () =>
          ({
            getMetadata: async () => [
              { contentType: "image/jpeg", size: FAKE_BYTES.length },
            ],
            createReadStream: () => Readable.from([FAKE_BYTES]),
          }) as never,
      );
    try {
      // Customer loads the ASSIGNED employee's headshot (the employee is not
      // the conversation's legacy traderUserId — only the widened predicate
      // allows this).
      const asCustomer = await request(app)
        .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(EMP_ONE_AVATAR())}`)
        .set("Authorization", `Bearer ${customerToken}`);
      expect(asCustomer.status).toBe(200);

      // The assigned employee loads the customer's avatar.
      const asAssignee = await request(app)
        .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(CUSTOMER_AVATAR())}`)
        .set("Authorization", `Bearer ${empOneToken}`);
      expect(asAssignee.status).toBe(200);

      // A member of an unrelated company still gets a 404.
      const asStranger = await request(app)
        .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(CUSTOMER_AVATAR())}`)
        .set("Authorization", `Bearer ${empBToken}`);
      expect(asStranger.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Flag OFF — legacy behaviour is bit-for-bit preserved
// ---------------------------------------------------------------------------
describe("flag OFF regression", () => {
  beforeEach(() => {
    setFlag(false);
  });

  it("a new enquiry's conversation is born assigned to the owner", async () => {
    const res = await request(app)
      .post(`/api/enquiries`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        traderId: profileB,
        message: "Could you help with a bathroom refit please",
        serviceRequired: "Bathroom fitting",
      });
    expect(res.status).toBeLessThan(300);
    createdEnquiryIds.push(res.body.id);
    if (res.body.conversationId) createdConversationIds.push(res.body.conversationId);

    const conv = await getConv(res.body.conversationId);
    expect(conv.assignedTraderUserId).toBe(ownerB);
    expect(conv.assignedAt).not.toBeNull();

    // Owner acts freely — claiming logic never fires, no audit is written.
    const msg = await sendMsg(res.body.conversationId, ownerBToken, "Yes of course, when suits");
    expect(msg.status).toBe(201);
    expect(await auditsFor(res.body.conversationId, "JOB_CLAIMED")).toHaveLength(0);

    // Push targets exactly the owner, like before Company Teams existed.
    pushMock.mockClear();
    const custMsg = await sendMsg(res.body.conversationId, customerToken, "Weekday mornings suit best");
    expect(custMsg.status).toBe(201);
    expect(await waitForPushes(1, forMessage(custMsg.body.id))).toEqual([ownerB]);
  });

  it("serialized payload keeps the legacy shape", async () => {
    const convId = await seedLead({ company: "B", assignedTo: ownerB });
    const res = await getDetail(convId, customerToken);
    expect(res.status).toBe(200);
    const asCustomer = res.body.conversation;
    expect(asCustomer.assignedTraderUserId).toBe(ownerB);
    expect(asCustomer.assignedTraderName).toBeNull();
    expect(asCustomer.traderLogoUrl).toBeNull();
    expect(asCustomer.viewerCanAct == null).toBe(true);

    const asOwner = (await getDetail(convId, ownerBToken)).body.conversation;
    expect(asOwner.viewerCanAct).toBe(true);
  });
});

// ===========================================================================
// Phase 3 — owner reassignment, safe member removal with job handover
// ===========================================================================

function reassign(convId: number, token: string, toUserId: number) {
  return request(app)
    .post(`/api/conversations/${convId}/reassign`)
    .set("Authorization", `Bearer ${token}`)
    .send({ toUserId });
}

function removeMember(memberId: number, token: string) {
  return request(app)
    .post(`/api/company/members/${memberId}/remove`)
    .set("Authorization", `Bearer ${token}`)
    .send({});
}

async function systemMessages(convId: number) {
  return db
    .select()
    .from(messagesTable)
    .where(
      and(eq(messagesTable.conversationId, convId), eq(messagesTable.senderRole, "system")),
    );
}

/** Only the reassignment/handover system messages (quote/hire milestones share the table). */
async function handoverMessages(convId: number) {
  const all = await systemMessages(convId);
  return all.filter((m) => m.body.startsWith("Your job is now being handled by"));
}

const forReassign =
  (convId: number) =>
  (p: Record<string, unknown>): boolean => {
    const d = p["data"] as Record<string, unknown> | undefined;
    return d?.["type"] === "job_reassigned" && d?.["conversationId"] === convId;
  };

async function membershipIdOf(profileId: number, userId: number): Promise<number> {
  const [row] = await db
    .select({ id: companyMembersTable.id })
    .from(companyMembersTable)
    .where(
      and(
        eq(companyMembersTable.traderProfileId, profileId),
        eq(companyMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return row.id;
}

async function fullNameOf(userId: number): Promise<string> {
  const [row] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row.fullName;
}

async function businessNameOf(profileId: number): Promise<string> {
  const [row] = await db
    .select({ businessName: traderProfilesTable.businessName })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.id, profileId))
    .limit(1);
  return row.businessName;
}

/** The aggregate handover audit stores conversationIds as an ARRAY — auditsFor can't see it. */
async function handoverAuditsFor(convId: number): Promise<AuditRow[]> {
  const rows = await db
    .select()
    .from(traderAuditLogTable)
    .where(
      and(
        eq(traderAuditLogTable.action, "JOBS_HANDED_TO_OWNER_ON_MEMBER_REMOVAL"),
        inArray(traderAuditLogTable.userId, createdUserIds),
      ),
    );
  return rows.filter((r) =>
    (
      (r.details as Record<string, unknown> | null)?.["conversationIds"] as number[] | undefined
    )?.includes(convId),
  );
}

async function waitForHandoverAudits(convId: number, expectAtLeast = 1): Promise<AuditRow[]> {
  const deadline = Date.now() + 4000;
  for (;;) {
    const rows = await handoverAuditsFor(convId);
    if (rows.length >= expectAtLeast || Date.now() > deadline) {
      if (rows.length >= expectAtLeast) {
        // Settle window so a duplicate write (the bug we test against) would land.
        await new Promise((r) => setTimeout(r, 250));
        return handoverAuditsFor(convId);
      }
      return rows;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------------------
// Owner reassignment
// ---------------------------------------------------------------------------
describe("owner reassignment (flag ON)", () => {
  it("happy path: job moves, all state preserved, one sysmsg, right pushes, one audit", async () => {
    const convId = await seedLead();
    // Realistic history: empOne claims via API and quotes.
    expect((await sendMsg(convId, empOneToken)).status).toBe(201);
    expect((await sendQuote(convId, empOneToken)).status).toBeLessThan(300);
    const before = await getConv(convId);

    pushMock.mockClear();
    const res = await reassign(convId, ownerAToken, empTwo);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, assignedTraderUserId: empTwo });

    const after = await getConv(convId);
    expect(after.assignedTraderUserId).toBe(empTwo);
    expect(after.assignedAt).not.toBeNull();
    // Everything the customer already has is untouched.
    expect(after.customerId).toBe(before.customerId);
    expect(after.enquiryId).toBe(before.enquiryId);
    expect(after.status).toBe(before.status);
    expect(after.customerAcceptedAt).toEqual(before.customerAcceptedAt);
    expect(after.cancelledAt).toBeNull();
    expect(await quotesCount(convId)).toBe(1);
    expect(await traderMessagesCount(convId)).toBe(1);
    // Authorship of past messages does not change hands.
    const traderMsgs = await db
      .select()
      .from(messagesTable)
      .where(
        and(eq(messagesTable.conversationId, convId), eq(messagesTable.senderRole, "trader")),
      );
    expect(traderMsgs[0].senderUserId).toBe(empOne);

    // Exactly ONE customer-facing system message: first name + company name.
    const empTwoFirst = (await fullNameOf(empTwo)).trim().split(/\s+/)[0];
    const sys = await handoverMessages(convId);
    expect(sys).toHaveLength(1);
    expect(sys[0].body).toBe(
      `Your job is now being handled by ${empTwoFirst} from ${await businessNameOf(profileA)}.`,
    );
    expect(after.customerUnreadCount).toBe(before.customerUnreadCount + 1);

    // Pushes: customer + new assignee + previous assignee — never the actor.
    const recipients = await waitForPushes(3, forReassign(convId));
    expect(new Set(recipients)).toEqual(new Set([customer, empTwo, empOne]));
    expect(recipients).toHaveLength(3);

    // Exactly one audit row, anchored to the owner, from → to recorded.
    const audits = await waitForAudits(convId, "JOB_REASSIGNED");
    expect(audits).toHaveLength(1);
    expect(audits[0].userId).toBe(ownerA);
    expect(audits[0].performedBy).toBe(ownerA);
    const d = audits[0].details as Record<string, unknown>;
    expect(d["fromUserId"]).toBe(empOne);
    expect(d["toUserId"]).toBe(empTwo);

    // Permission flip is immediate: previous assignee is read-only, new one acts.
    const asPrev = await sendMsg(convId, empOneToken, "Just checking back in on this one");
    expect(asPrev.status).toBe(409);
    expect(asPrev.body.code).toBe("JOB_CLAIMED_BY_OTHER");
    expect((await sendMsg(convId, empTwoToken, "Hi, I'm taking over this job now")).status).toBe(
      201,
    );
  });

  it("owner takes a job over themselves: prev assignee informed, no self-push", async () => {
    const convId = await seedLead({ assignedTo: empOne });
    pushMock.mockClear();
    expect((await reassign(convId, ownerAToken, ownerA)).status).toBe(200);
    expect((await getConv(convId)).assignedTraderUserId).toBe(ownerA);

    const recipients = await waitForPushes(2, forReassign(convId));
    expect(new Set(recipients)).toEqual(new Set([customer, empOne]));
    expect(recipients).toHaveLength(2);

    // The owner now acts freely; the previous assignee is read-only.
    expect((await sendMsg(convId, ownerAToken, "Hello, the owner here taking over")).status).toBe(
      201,
    );
    expect((await sendMsg(convId, empOneToken, "Wait, this was my job")).status).toBe(409);
  });

  it("an unclaimed lead can be handed straight to a member (from unassigned)", async () => {
    const convId = await seedLead();
    pushMock.mockClear();
    expect((await reassign(convId, ownerAToken, empOne)).status).toBe(200);
    expect((await getConv(convId)).assignedTraderUserId).toBe(empOne);

    // No previous assignee: exactly customer + new assignee are told.
    const recipients = await waitForPushes(2, forReassign(convId));
    expect(new Set(recipients)).toEqual(new Set([customer, empOne]));
    const audits = await waitForAudits(convId, "JOB_REASSIGNED");
    expect((audits[0].details as Record<string, unknown>)["fromUserId"]).toBeNull();
  });

  it("employees (even the assignee) and customers can never reassign", async () => {
    const convId = await seedLead({ assignedTo: empOne });
    for (const [token, who] of [
      [empOneToken, "assignee"],
      [empTwoToken, "colleague"],
      [customerToken, "customer"],
    ] as const) {
      const res = await reassign(convId, token, empTwo);
      expect(res.status, `403 expected for ${who}`).toBe(403);
      expect(res.body.code).toBe("OWNER_ONLY");
    }
    // Zero side effects from any rejected attempt.
    expect((await getConv(convId)).assignedTraderUserId).toBe(empOne);
    expect(await handoverMessages(convId)).toHaveLength(0);
    expect(await auditsFor(convId, "JOB_REASSIGNED")).toHaveLength(0);
  });

  it("pending/removed/other-company/arbitrary targets are all INVALID_ASSIGNEE", async () => {
    const convId = await seedLead({ assignedTo: empOne });
    for (const target of [removedEmp, empB, customer, 99999999]) {
      const res = await reassign(convId, ownerAToken, target);
      expect(res.status, `target ${target}`).toBe(400);
      expect(res.body.code).toBe("INVALID_ASSIGNEE");
    }
    const malformed = await request(app)
      .post(`/api/conversations/${convId}/reassign`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ toUserId: "not-a-number" });
    expect(malformed.status).toBe(400);

    expect((await getConv(convId)).assignedTraderUserId).toBe(empOne);
    expect(await handoverMessages(convId)).toHaveLength(0);
    expect(await auditsFor(convId, "JOB_REASSIGNED")).toHaveLength(0);
  });

  it("other companies' jobs and unknown ids are indistinguishable 404s", async () => {
    const convB = await seedLead({ company: "B", assignedTo: empB });
    expect((await reassign(convB, ownerAToken, empTwo)).status).toBe(404);
    expect((await reassign(99999999, ownerAToken, empTwo)).status).toBe(404);
    expect((await getConv(convB)).assignedTraderUserId).toBe(empB);
  });

  it("completed, cancelled and closed jobs cannot change hands", async () => {
    const done = await seedLead({ assignedTo: empOne, hired: true });
    await db
      .update(conversationsTable)
      .set({ customerCompletedAt: new Date() })
      .where(eq(conversationsTable.id, done));
    const cancelled = await seedLead({ assignedTo: empOne });
    await db
      .update(conversationsTable)
      .set({ cancelledAt: new Date() })
      .where(eq(conversationsTable.id, cancelled));
    const closed = await seedLead({ assignedTo: empOne });
    await db
      .update(conversationsTable)
      .set({ status: "CLOSED" })
      .where(eq(conversationsTable.id, closed));

    for (const convId of [done, cancelled, closed]) {
      const res = await reassign(convId, ownerAToken, empTwo);
      expect(res.status, `conversation ${convId}`).toBe(409);
      expect(res.body.code).toBe("JOB_NOT_ACTIVE");
      expect((await getConv(convId)).assignedTraderUserId).toBe(empOne);
      expect(await handoverMessages(convId)).toHaveLength(0);
    }
  });

  it("same-target retry / double-tap is a side-effect-free 409", async () => {
    const convId = await seedLead({ assignedTo: empOne });
    expect((await reassign(convId, ownerAToken, empTwo)).status).toBe(200);

    const retry = await reassign(convId, ownerAToken, empTwo);
    expect(retry.status).toBe(409);
    expect(retry.body.code).toBe("ALREADY_ASSIGNED");

    expect((await getConv(convId)).assignedTraderUserId).toBe(empTwo);
    expect(await handoverMessages(convId)).toHaveLength(1);
    expect(await waitForAudits(convId, "JOB_REASSIGNED")).toHaveLength(1);
  });

  it("viewerCanReassign: owner-only, live+assigned-only, absent for customers", async () => {
    const convId = await seedLead({ assignedTo: empOne });
    expect((await getDetail(convId, ownerAToken)).body.conversation.viewerCanReassign).toBe(true);
    expect((await getDetail(convId, empOneToken)).body.conversation.viewerCanReassign).toBe(false);
    expect((await getDetail(convId, empTwoToken)).body.conversation.viewerCanReassign).toBe(false);
    expect(
      (await getDetail(convId, customerToken)).body.conversation.viewerCanReassign == null,
    ).toBe(true);

    const unclaimed = await seedLead();
    expect((await getDetail(unclaimed, ownerAToken)).body.conversation.viewerCanReassign).toBe(
      false,
    );

    const done = await seedLead({ assignedTo: empOne, hired: true });
    await db
      .update(conversationsTable)
      .set({ customerCompletedAt: new Date() })
      .where(eq(conversationsTable.id, done));
    expect((await getDetail(done, ownerAToken)).body.conversation.viewerCanReassign).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reassignment races — first commit wins, losers leave nothing behind
// ---------------------------------------------------------------------------
describe("reassignment races (flag ON)", () => {
  it("parallel double-tap: one winner, one 409, one sysmsg, one audit", async () => {
    const convId = await seedLead({ assignedTo: empOne });
    const [a, b] = await Promise.all([
      reassign(convId, ownerAToken, empTwo),
      reassign(convId, ownerAToken, empTwo),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe("ALREADY_ASSIGNED");

    expect((await getConv(convId)).assignedTraderUserId).toBe(empTwo);
    expect(await handoverMessages(convId)).toHaveLength(1);
    expect(await waitForAudits(convId, "JOB_REASSIGNED")).toHaveLength(1);
  });

  it("reassign vs the assignee's message: consistent outcome either way", async () => {
    const convId = await seedLead({ assignedTo: empOne });
    const [re, msg] = await Promise.all([
      reassign(convId, ownerAToken, empTwo),
      sendMsg(convId, empOneToken, "Racing my own reassignment here"),
    ]);
    // The reassignment always lands (a message never blocks it)...
    expect(re.status).toBe(200);
    expect((await getConv(convId)).assignedTraderUserId).toBe(empTwo);
    // ...and the message either genuinely won (persisted) or cleanly lost (nothing).
    expect([201, 409]).toContain(msg.status);
    expect(await traderMessagesCount(convId)).toBe(msg.status === 201 ? 1 : 0);
  });

  it("reassign vs cancel: first commit wins, the loser rolls back cleanly", async () => {
    const convId = await seedLead({ assignedTo: empOne });
    const [re, ca] = await Promise.all([
      reassign(convId, ownerAToken, empTwo),
      request(app)
        .post(`/api/conversations/${convId}/cancel`)
        .set("Authorization", `Bearer ${empOneToken}`)
        .send({ reason: "No longer available for this work" }),
    ]);
    const conv = await getConv(convId);
    if (re.status === 200) {
      // Reassignment won — the ex-assignee's cancel must have been rejected.
      expect(ca.status).toBe(409);
      expect(conv.assignedTraderUserId).toBe(empTwo);
      expect(conv.cancelledAt).toBeNull();
    } else {
      // Cancel won — the reassignment saw a dead job.
      expect(re.status).toBe(409);
      expect(re.body.code).toBe("JOB_NOT_ACTIVE");
      expect(ca.status).toBeLessThan(300);
      expect(conv.cancelledAt).not.toBeNull();
      expect(conv.assignedTraderUserId).toBe(empOne);
    }
  });
});

// ---------------------------------------------------------------------------
// Member removal hands live jobs to the owner
// ---------------------------------------------------------------------------
describe("member removal hands live jobs to the owner (flag ON)", () => {
  it("live jobs move atomically; finished jobs keep history; customers are told once each", async () => {
    // Disposable employee so the shared fixtures survive this test.
    const tempEmp = await createUser("trader", "tempHandover", { fullName: "Tamsin Handover" });
    await insertMembership({ profileId: profileA, userId: tempEmp });
    const tempToken = generateToken(tempEmp, "trader");
    const memberId = await membershipIdOf(profileA, tempEmp);

    // Live claimed lead + live hired job → must move. Completed + cancelled → must not.
    const liveLead = await seedLead();
    expect((await sendMsg(liveLead, tempToken)).status).toBe(201);
    const hiredJob = await seedLead({ customerId: customerTwo, assignedTo: tempEmp, hired: true });
    const doneJob = await seedLead({ assignedTo: tempEmp, hired: true });
    await db
      .update(conversationsTable)
      .set({ customerCompletedAt: new Date() })
      .where(eq(conversationsTable.id, doneJob));
    const cancelledJob = await seedLead({ assignedTo: tempEmp });
    await db
      .update(conversationsTable)
      .set({ cancelledAt: new Date() })
      .where(eq(conversationsTable.id, cancelledJob));

    pushMock.mockClear();
    expect((await removeMember(memberId, ownerAToken)).status).toBe(200);

    expect((await getConv(liveLead)).assignedTraderUserId).toBe(ownerA);
    expect((await getConv(hiredJob)).assignedTraderUserId).toBe(ownerA);
    expect((await getConv(doneJob)).assignedTraderUserId).toBe(tempEmp);
    expect((await getConv(cancelledJob)).assignedTraderUserId).toBe(tempEmp);

    // Authorship of the removed member's messages is untouched.
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(
        and(eq(messagesTable.conversationId, liveLead), eq(messagesTable.senderRole, "trader")),
      );
    expect(msgs[0].senderUserId).toBe(tempEmp);

    // One push per affected customer; neither the owner (actor) nor the removed
    // member. Waiting on the pushes also settles the fire-and-forget loop that
    // posts each customer message BEFORE its push.
    const recipients = await waitForPushes(
      2,
      (p) => (p["data"] as Record<string, unknown> | undefined)?.["type"] === "job_reassigned",
    );
    expect(new Set(recipients)).toEqual(new Set([customer, customerTwo]));
    expect(recipients).toHaveLength(2);

    // One customer system message per LIVE job, none for finished ones.
    const ownerFirst = (await fullNameOf(ownerA)).trim().split(/\s+/)[0];
    const bizName = await businessNameOf(profileA);
    for (const convId of [liveLead, hiredJob]) {
      const sys = await handoverMessages(convId);
      expect(sys, `conversation ${convId}`).toHaveLength(1);
      expect(sys[0].body).toBe(`Your job is now being handled by ${ownerFirst} from ${bizName}.`);
    }
    expect(await handoverMessages(doneJob)).toHaveLength(0);
    expect(await handoverMessages(cancelledJob)).toHaveLength(0);

    // ONE aggregate audit row for the whole removal, listing exactly the moved jobs.
    const handovers = await waitForHandoverAudits(liveLead);
    expect(handovers).toHaveLength(1);
    const details = handovers[0].details as Record<string, unknown>;
    expect(new Set(details["conversationIds"] as number[])).toEqual(
      new Set([liveLead, hiredJob]),
    );
    expect(details["fromUserId"]).toBe(tempEmp);
    expect(details["toUserId"]).toBe(ownerA);

    // The removed member is locked out immediately.
    expect((await sendMsg(liveLead, tempToken, "Am I still on this job")).status,
    ).toBeGreaterThanOrEqual(403);

    // Removing again: clean 409, no duplicate handover side effects.
    expect((await removeMember(memberId, ownerAToken)).status).toBe(409);
    expect(await handoverAuditsFor(liveLead)).toHaveLength(1);
    expect(await handoverMessages(liveLead)).toHaveLength(1);
  });

  it("removal with no live jobs: no handover audit, no messages, no pushes", async () => {
    const tempEmp = await createUser("trader", "tempQuiet", { fullName: "Quinn Quiet" });
    await insertMembership({ profileId: profileA, userId: tempEmp });
    const memberId = await membershipIdOf(profileA, tempEmp);
    const doneJob = await seedLead({ assignedTo: tempEmp, hired: true });
    await db
      .update(conversationsTable)
      .set({ customerCompletedAt: new Date() })
      .where(eq(conversationsTable.id, doneJob));

    pushMock.mockClear();
    expect((await removeMember(memberId, ownerAToken)).status).toBe(200);

    expect((await getConv(doneJob)).assignedTraderUserId).toBe(tempEmp);
    expect(await handoverMessages(doneJob)).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 400));
    expect(
      pushedUserIds(
        (p) => (p["data"] as Record<string, unknown> | undefined)?.["type"] === "job_reassigned",
      ),
    ).toHaveLength(0);
    expect(await handoverAuditsFor(doneJob)).toHaveLength(0);
  });

  it("removal racing the departing member's write never corrupts the job", async () => {
    const tempEmp = await createUser("trader", "tempRace", { fullName: "Riley Race" });
    await insertMembership({ profileId: profileA, userId: tempEmp });
    const tempToken = generateToken(tempEmp, "trader");
    const memberId = await membershipIdOf(profileA, tempEmp);
    const convId = await seedLead({ assignedTo: tempEmp });

    const [rem, msg] = await Promise.all([
      removeMember(memberId, ownerAToken),
      sendMsg(convId, tempToken, "Sending one last update before I go"),
    ]);
    expect(rem.status).toBe(200);
    expect([201, 403, 404, 409]).toContain(msg.status);
    // Whatever the interleaving: the job ends with the owner…
    expect((await getConv(convId)).assignedTraderUserId).toBe(ownerA);
    // …and a message exists only if it genuinely won the race.
    expect(await traderMessagesCount(convId)).toBe(msg.status === 201 ? 1 : 0);
  });

  it("reassign racing the target's removal never leaves the job with a revoked member", async () => {
    const tempEmp = await createUser("trader", "tempReassignRace", { fullName: "Sasha Swap" });
    await insertMembership({ profileId: profileA, userId: tempEmp });
    const memberId = await membershipIdOf(profileA, tempEmp);
    const convId = await seedLead({ assignedTo: empOne });

    const [rem, rea] = await Promise.all([
      removeMember(memberId, ownerAToken),
      reassign(convId, ownerAToken, tempEmp),
    ]);
    expect(rem.status).toBe(200);
    // The reassign either won — in which case the removal's handover (which
    // runs strictly after its membership flip) swept the job on to the owner
    // — or it lost the in-transaction membership re-check (400). Under no
    // interleaving may a live job end up assigned to the revoked member.
    expect([200, 400]).toContain(rea.status);
    const conv = await getConv(convId);
    expect(conv.assignedTraderUserId).toBe(rea.status === 200 ? ownerA : empOne);
    expect(conv.assignedTraderUserId).not.toBe(tempEmp);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 flag OFF — fail closed
// ---------------------------------------------------------------------------
describe("Phase 3 flag OFF — fail closed", () => {
  beforeEach(() => {
    setFlag(false);
  });

  it("reassign 404s and the detail payload exposes no reassign affordance", async () => {
    const convId = await seedLead({ company: "B", assignedTo: ownerB });
    expect((await reassign(convId, ownerBToken, ownerB)).status).toBe(404);
    const detail = (await getDetail(convId, ownerBToken)).body.conversation;
    expect(detail.viewerCanReassign ?? false).toBe(false);
    expect(await handoverMessages(convId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end regression: the full company lifecycle in 12 steps
// ---------------------------------------------------------------------------
describe("end-to-end regression (flag ON)", () => {
  it("invite → accept → claim → quote → hire → reassign ×2 → finish → immutable → remove", async () => {
    // 1. Owner B invites a brand-new employee through the real endpoint.
    const email = emailFor("e2e-newstarter");
    const invited = await request(app)
      .post("/api/company/invites")
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ email });
    expect(invited.status).toBeLessThan(300);
    const [inviteRow] = await db
      .select()
      .from(companyInvitesTable)
      .where(
        and(
          eq(companyInvitesTable.traderProfileId, profileB),
          eq(companyInvitesTable.email, email.toLowerCase()),
        ),
      )
      .limit(1);
    expect(inviteRow).toBeDefined();
    createdInviteIds.push(inviteRow.id);

    // 2. Accept via the real endpoint. The raw token normally only exists in
    //    the email, so plant a known one on the real invite row first.
    const raw = `e2e-raw-token-${SUFFIX}`;
    await db
      .update(companyInvitesTable)
      .set({ tokenHash: crypto.createHash("sha256").update(raw).digest("hex") })
      .where(eq(companyInvitesTable.id, inviteRow.id));
    const accepted = await request(app)
      .post("/api/company/invites/accept")
      .send({ token: raw, fullName: "Ellis Newstarter", password: "Password123!" });
    expect(accepted.status).toBe(201);
    const empNew = accepted.body.user.id as number;
    createdUserIds.push(empNew);
    const empNewToken = accepted.body.token as string;

    // 3. A customer enquiry creates an UNASSIGNED company lead.
    const enq = await request(app)
      .post("/api/enquiries")
      .set("Authorization", `Bearer ${customerTwoToken}`)
      .send({
        traderId: profileB,
        message: "Please quote for a full bathroom refit",
        serviceRequired: "Bathroom fitting",
      });
    expect(enq.status).toBeLessThan(300);
    createdEnquiryIds.push(enq.body.id);
    const convId = enq.body.conversationId as number;
    createdConversationIds.push(convId);
    expect((await getConv(convId)).assignedTraderUserId).toBeNull();

    // 4. The new employee's first reply claims the job.
    expect((await sendMsg(convId, empNewToken)).status).toBe(201);
    expect((await getConv(convId)).assignedTraderUserId).toBe(empNew);

    // 5. They quote through the normal endpoint.
    const quoted = await sendQuote(convId, empNewToken);
    expect(quoted.status).toBeLessThan(300);
    const quoteId = quoted.body.quote.id as number;

    // 6. The customer accepts the quote — the job is hired.
    const hire = await request(app)
      .post(`/api/quotes/${quoteId}/accept`)
      .set("Authorization", `Bearer ${customerTwoToken}`)
      .send({});
    expect(hire.status).toBeLessThan(300);
    expect((await getConv(convId)).customerAcceptedAt).not.toBeNull();

    // 7. Owner pulls the HIRED job to themselves — hire state + quote untouched.
    expect((await reassign(convId, ownerBToken, ownerB)).status).toBe(200);
    const midway = await getConv(convId);
    expect(midway.assignedTraderUserId).toBe(ownerB);
    expect(midway.customerAcceptedAt).not.toBeNull();
    expect(await quotesCount(convId)).toBe(1);

    // 8. …and hands it back to the employee.
    expect((await reassign(convId, ownerBToken, empNew)).status).toBe(200);
    expect((await getConv(convId)).assignedTraderUserId).toBe(empNew);

    // 9. The employee finishes the work.
    expect(
      (
        await request(app)
          .post(`/api/conversations/${convId}/trader-mark-done`)
          .set("Authorization", `Bearer ${empNewToken}`)
          .send({})
      ).status,
    ).toBeLessThan(300);

    // 10. The customer confirms completion.
    expect(
      (
        await request(app)
          .post(`/api/conversations/${convId}/complete`)
          .set("Authorization", `Bearer ${customerTwoToken}`)
          .send({})
      ).status,
    ).toBeLessThan(300);
    expect((await getConv(convId)).customerCompletedAt).not.toBeNull();

    // 11. Finished jobs are immutable — no more reassignment.
    const late = await reassign(convId, ownerBToken, ownerB);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("JOB_NOT_ACTIVE");

    // 12. Removing the employee keeps the finished job's history intact.
    const memberId = await membershipIdOf(profileB, empNew);
    expect((await removeMember(memberId, ownerBToken)).status).toBe(200);
    expect((await getConv(convId)).assignedTraderUserId).toBe(empNew);
    expect(await handoverAuditsFor(convId)).toHaveLength(0);
    expect(
      (await sendMsg(convId, empNewToken, "Checking in after removal")).status,
    ).toBeGreaterThanOrEqual(403);

    // Two reassignments → exactly two customer messages + two audit rows.
    expect(await handoverMessages(convId)).toHaveLength(2);
    expect(await waitForAudits(convId, "JOB_REASSIGNED", 2)).toHaveLength(2);
  });
});
