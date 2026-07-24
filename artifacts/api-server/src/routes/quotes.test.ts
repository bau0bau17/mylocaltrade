import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  enquiriesTable,
  conversationsTable,
  messagesTable,
  quotesTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";

/**
 * Integration tests for the structured-quote lifecycle.
 *
 * These run against the dev DATABASE_URL but create their own scoped
 * fixtures (unique email prefix) and tear them down at the end so they
 * don't pollute seeded data.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `quotes-test+${label}-${SUFFIX}@example.test`;

interface Ctx {
  customerId: number;
  customerToken: string;
  otherCustomerId: number;
  otherCustomerToken: string;
  traderUserId: number;
  traderProfileId: number;
  traderToken: string;
  otherTraderUserId: number;
  otherTraderProfileId: number;
  otherTraderToken: string;
}

let ctx: Ctx;
const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdEnquiryIds: number[] = [];
const createdConversationIds: number[] = [];

async function createUser(role: "customer" | "trader", label: string): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Test ${role} ${label}`,
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
      businessName: `Quote Trades ${label} ${SUFFIX}`,
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

async function createConversation(opts?: {
  customerId?: number;
  traderUserId?: number;
  traderProfileId?: number;
  enquiryId?: number;
}): Promise<number> {
  const enquiryId =
    opts?.enquiryId ??
    (await createEnquiry(opts?.traderProfileId ?? ctx.traderProfileId, opts?.customerId ?? ctx.customerId));
  const [c] = await db
    .insert(conversationsTable)
    .values({
      customerId: opts?.customerId ?? ctx.customerId,
      traderUserId: opts?.traderUserId ?? ctx.traderUserId,
      traderProfileId: opts?.traderProfileId ?? ctx.traderProfileId,
      enquiryId,
      serviceRequired: "Boiler service",
      status: "ACTIVE",
      traderStatus: "NEW",
    })
    .returning({ id: conversationsTable.id });
  createdConversationIds.push(c.id);
  return c.id;
}

const validQuote = {
  amountPence: 45_000,
  priceType: "FIXED",
  description: "Full boiler service including parts",
};

function asTrader(req: request.Test) {
  return req.set("Authorization", `Bearer ${ctx.traderToken}`);
}
function asCustomer(req: request.Test) {
  return req.set("Authorization", `Bearer ${ctx.customerToken}`);
}

beforeAll(async () => {
  const customerId = await createUser("customer", "buyer");
  const otherCustomerId = await createUser("customer", "other");
  const traderUserId = await createUser("trader", "alpha");
  const otherTraderUserId = await createUser("trader", "beta");
  const traderProfileId = await createTraderProfile(traderUserId, "alpha");
  const otherTraderProfileId = await createTraderProfile(otherTraderUserId, "beta");

  ctx = {
    customerId,
    customerToken: generateToken(customerId, "customer", 1),
    otherCustomerId,
    otherCustomerToken: generateToken(otherCustomerId, "customer", 1),
    traderUserId,
    traderProfileId,
    traderToken: generateToken(traderUserId, "trader", 1),
    otherTraderUserId,
    otherTraderProfileId,
    otherTraderToken: generateToken(otherTraderUserId, "trader", 1),
  };
});

afterAll(async () => {
  if (createdConversationIds.length) {
    await db.delete(quotesTable).where(inArray(quotesTable.conversationId, createdConversationIds));
    await db.delete(messagesTable).where(inArray(messagesTable.conversationId, createdConversationIds));
    await db.delete(conversationsTable).where(inArray(conversationsTable.id, createdConversationIds));
  }
  if (createdEnquiryIds.length) {
    await db.delete(enquiriesTable).where(inArray(enquiriesTable.id, createdEnquiryIds));
  }
  if (createdProfileIds.length) {
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("POST /api/conversations/:id/quotes", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const convId = await createConversation();
    const res = await request(app).post(`/api/conversations/${convId}/quotes`).send(validQuote);
    expect(res.status).toBe(401);
  });

  it("rejects customers with 403", async () => {
    const convId = await createConversation();
    const res = await asCustomer(
      request(app).post(`/api/conversations/${convId}/quotes`),
    ).send(validQuote);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a trader who does not own the conversation", async () => {
    const convId = await createConversation();
    const res = await request(app)
      .post(`/api/conversations/${convId}/quotes`)
      .set("Authorization", `Bearer ${ctx.otherTraderToken}`)
      .send(validQuote);
    expect(res.status).toBe(404);
  });

  it("rejects an invalid body with 400", async () => {
    const convId = await createConversation();
    const res = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send({
      amountPence: 0,
      priceType: "HOURLY",
      description: "x",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a validUntil in the past with 400", async () => {
    const convId = await createConversation();
    const res = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send({
      ...validQuote,
      validUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  it("creates a PENDING quote, marks the conversation QUOTED and posts a system message", async () => {
    const convId = await createConversation();
    const res = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    expect(res.status).toBe(201);
    expect(res.body.quote).toMatchObject({
      conversationId: convId,
      amountPence: 45_000,
      priceType: "FIXED",
      status: "PENDING",
    });

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId));
    expect(conv.traderStatus).toBe("QUOTED");
    if (conv.enquiryId) {
      const [enq] = await db
        .select()
        .from(enquiriesTable)
        .where(eq(enquiriesTable.id, conv.enquiryId));
      expect(enq.status).toBe("responded");
    }

    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, convId));
    expect(msgs.some((m) => m.systemMessage && /Quote sent/.test(m.body))).toBe(true);
  });

  it("blocks a second live quote in the same conversation with 409", async () => {
    const convId = await createConversation();
    const first = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    expect(first.status).toBe(201);
    const second = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    expect(second.status).toBe(409);
  });

  it("allows a fresh quote when the previous one has lapsed, finalising it as EXPIRED", async () => {
    const convId = await createConversation();
    const first = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send({
      ...validQuote,
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(first.status).toBe(201);
    // Simulate the quote lapsing without waiting.
    await db
      .update(quotesTable)
      .set({ validUntil: new Date(Date.now() - 60_000) })
      .where(eq(quotesTable.id, first.body.quote.id));

    const second = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    expect(second.status).toBe(201);

    const [old] = await db
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.id, first.body.quote.id));
    expect(old.status).toBe("EXPIRED");
  });

  it("never allows two live quotes even under concurrent create requests", async () => {
    const convId = await createConversation();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(validQuote),
      ),
    );
    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    expect(created.length).toBe(1);
    expect(conflicts.length).toBe(3);

    const pending = await db
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.conversationId, convId));
    expect(pending.filter((q) => q.status === "PENDING").length).toBe(1);
  });

  it("rejects quoting on a cancelled job with 409", async () => {
    const convId = await createConversation();
    await db
      .update(conversationsTable)
      .set({ cancelledAt: new Date(), cancelledByRole: "customer" })
      .where(eq(conversationsTable.id, convId));
    const res = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/quotes/:id/revise", () => {
  it("supersedes the old quote (REVISED) and links the new one", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    const res = await asTrader(request(app).post(`/api/quotes/${created.body.quote.id}/revise`)).send(
      { ...validQuote, amountPence: 40_000 },
    );
    expect(res.status).toBe(201);
    expect(res.body.quote).toMatchObject({
      amountPence: 40_000,
      status: "PENDING",
      revisionOfQuoteId: created.body.quote.id,
    });
    const [old] = await db
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.id, created.body.quote.id));
    expect(old.status).toBe("REVISED");
  });

  it("returns 404 for a different trader's quote", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    const res = await request(app)
      .post(`/api/quotes/${created.body.quote.id}/revise`)
      .set("Authorization", `Bearer ${ctx.otherTraderToken}`)
      .send(validQuote);
    expect(res.status).toBe(404);
  });

  it("rejects revising a non-pending quote with 409", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    await asTrader(request(app).post(`/api/quotes/${created.body.quote.id}/withdraw`)).send();
    const res = await asTrader(request(app).post(`/api/quotes/${created.body.quote.id}/revise`)).send(
      validQuote,
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/quotes/:id/withdraw", () => {
  it("withdraws a pending quote", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    const res = await asTrader(request(app).post(`/api/quotes/${created.body.quote.id}/withdraw`)).send();
    expect(res.status).toBe(200);
    expect(res.body.quote.status).toBe("WITHDRAWN");
    expect(res.body.quote.withdrawnAt).toBeTruthy();
  });
});

describe("POST /api/quotes/:id/accept", () => {
  it("accepts a pending quote and hires the trader (job reference + hired timestamps)", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    const res = await asCustomer(request(app).post(`/api/quotes/${created.body.quote.id}/accept`)).send();
    expect(res.status).toBe(200);
    expect(res.body.quote.status).toBe("ACCEPTED");
    expect(res.body.quote.acceptedAt).toBeTruthy();

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, convId));
    expect(conv.customerAcceptedAt).toBeTruthy();
    expect(conv.jobReference).toBeTruthy();
  });

  it("returns 404 when a different customer tries to accept", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    const res = await request(app)
      .post(`/api/quotes/${created.body.quote.id}/accept`)
      .set("Authorization", `Bearer ${ctx.otherCustomerToken}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("returns 404 when the trader tries to accept their own quote", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    const res = await asTrader(request(app).post(`/api/quotes/${created.body.quote.id}/accept`)).send();
    expect(res.status).toBe(404);
  });

  it("refuses to accept a lapsed quote (marks it EXPIRED) with 409", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send({
      ...validQuote,
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    await db
      .update(quotesTable)
      .set({ validUntil: new Date(Date.now() - 60_000) })
      .where(eq(quotesTable.id, created.body.quote.id));

    const res = await asCustomer(request(app).post(`/api/quotes/${created.body.quote.id}/accept`)).send();
    expect(res.status).toBe(409);
    const [row] = await db
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.id, created.body.quote.id));
    expect(row.status).toBe("EXPIRED");
  });

  it("refuses to accept a withdrawn quote with 409", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    await asTrader(request(app).post(`/api/quotes/${created.body.quote.id}/withdraw`)).send();
    const res = await asCustomer(request(app).post(`/api/quotes/${created.body.quote.id}/accept`)).send();
    expect(res.status).toBe(409);
  });
});

describe("POST /api/quotes/:id/decline", () => {
  it("declines a pending quote", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    const res = await asCustomer(request(app).post(`/api/quotes/${created.body.quote.id}/decline`)).send();
    expect(res.status).toBe(200);
    expect(res.body.quote.status).toBe("DECLINED");
  });

  it("allows the trader to send a new quote after a decline", async () => {
    const convId = await createConversation();
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    await asCustomer(request(app).post(`/api/quotes/${created.body.quote.id}/decline`)).send();
    const res = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send({
      ...validQuote,
      amountPence: 38_000,
    });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/enquiries/compare", () => {
  it("groups enquiries by requestGroupId and returns the latest quote per conversation", async () => {
    // Same customer, same service, two traders → the create-enquiry endpoint
    // assigns a shared requestGroupId. We go through the API for enquiries.
    // Letters only: long digit runs trip the contact-info filter.
    const service = `Compare test ${SUFFIX.replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;
    const enq1 = await asCustomer(request(app).post("/api/enquiries")).send({
      traderId: ctx.traderProfileId,
      message: "Please quote for the job",
      serviceRequired: service,
    });
    expect(enq1.status).toBe(201);
    const enq2 = await asCustomer(request(app).post("/api/enquiries")).send({
      traderId: ctx.otherTraderProfileId,
      message: "Please quote for the job",
      serviceRequired: service,
    });
    expect(enq2.status).toBe(201);
    const id1: number = enq1.body.enquiry?.id ?? enq1.body.id;
    const id2: number = enq2.body.enquiry?.id ?? enq2.body.id;
    createdEnquiryIds.push(id1, id2);

    const [row1] = await db.select().from(enquiriesTable).where(eq(enquiriesTable.id, id1));
    const [row2] = await db.select().from(enquiriesTable).where(eq(enquiriesTable.id, id2));
    expect(row1.requestGroupId).toBeTruthy();
    expect(row1.requestGroupId).toBe(row2.requestGroupId);

    // Creating an enquiry auto-creates its conversation; register both for
    // cleanup and quote through the one belonging to trader 1.
    const autoConvs = await db
      .select({ id: conversationsTable.id, enquiryId: conversationsTable.enquiryId })
      .from(conversationsTable)
      .where(inArray(conversationsTable.enquiryId, [id1, id2]));
    createdConversationIds.push(...autoConvs.map((c) => c.id));
    const convId = autoConvs.find((c) => c.enquiryId === id1)!.id;
    const created = await asTrader(request(app).post(`/api/conversations/${convId}/quotes`)).send(
      validQuote,
    );
    expect(created.status).toBe(201);

    const res = await asCustomer(request(app).get("/api/enquiries/compare"));
    expect(res.status).toBe(200);
    const group = (res.body.groups as Array<{ requestGroupId: string; offers: Array<Record<string, unknown>> }>).find(
      (g) => g.requestGroupId === row1.requestGroupId,
    );
    expect(group).toBeTruthy();
    expect(group!.offers.length).toBe(2);
    const withQuote = group!.offers.find((o) => o.enquiryId === id1);
    const withoutQuote = group!.offers.find((o) => o.enquiryId === id2);
    expect((withQuote!.quote as Record<string, unknown>).amountPence).toBe(45_000);
    expect(withoutQuote!.quote ?? null).toBeNull();
    // Quoted offers sort ahead of unanswered ones.
    expect(group!.offers[0].enquiryId).toBe(id1);
  });
});
