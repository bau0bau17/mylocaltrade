import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  enquiriesTable,
  conversationsTable,
  messagesTable,
  bookingsTable,
  traderAuditLogTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";

/**
 * Integration tests for the appointment/booking lifecycle.
 *
 * These run against the dev DATABASE_URL but create their own scoped
 * fixtures (unique email prefix) and tear them down at the end so they
 * don't pollute seeded data.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `bookings-test+${label}-${SUFFIX}@example.test`;

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
      businessName: `Booking Trades ${label} ${SUFFIX}`,
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
      message: "Need a boiler service appointment",
      serviceRequired: "Boiler service",
      status: "pending",
    })
    .returning({ id: enquiriesTable.id });
  createdEnquiryIds.push(e.id);
  return e.id;
}

// Bookings require a HIRED job: customerAcceptedAt set and the job still live.
async function createHiredConversation(opts?: {
  hired?: boolean;
}): Promise<number> {
  const enquiryId = await createEnquiry(ctx.traderProfileId, ctx.customerId);
  const [c] = await db
    .insert(conversationsTable)
    .values({
      customerId: ctx.customerId,
      traderUserId: ctx.traderUserId,
      traderProfileId: ctx.traderProfileId,
      enquiryId,
      serviceRequired: "Boiler service",
      status: "ACTIVE",
      traderStatus: "NEW",
      customerAcceptedAt: opts?.hired === false ? null : new Date(),
    })
    .returning({ id: conversationsTable.id });
  createdConversationIds.push(c.id);
  return c.id;
}

// Each call returns a DIFFERENT future slot (spaced 2h apart). The server now
// enforces cross-conversation conflict protection for a trader's confirmed
// bookings, so tests must not all share one identical start instant.
// Generic slots start 30 days out so they can never collide with the fixed
// near-term dates used by the conflict-protection tests below.
let slotCounter = 0;
const futureStart = () =>
  new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000 + slotCounter++ * 2 * 60 * 60 * 1000,
  ).toISOString();

function asTrader(req: request.Test) {
  return req.set("Authorization", `Bearer ${ctx.traderToken}`);
}
function asCustomer(req: request.Test) {
  return req.set("Authorization", `Bearer ${ctx.customerToken}`);
}

async function propose(convId: number, as: "trader" | "customer" = "trader", startAt?: string) {
  const req = request(app)
    .post(`/api/conversations/${convId}/bookings`)
    .set(
      "Authorization",
      `Bearer ${as === "trader" ? ctx.traderToken : ctx.customerToken}`,
    );
  return req.send({ startAt: startAt ?? futureStart() });
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
    await db
      .delete(bookingsTable)
      .where(inArray(bookingsTable.conversationId, createdConversationIds));
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
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length) {
    // Booking mutations write trader audit rows (performed_by FK) — clear
    // them first or the user cleanup hits a foreign-key violation.
    await db
      .delete(traderAuditLogTable)
      .where(inArray(traderAuditLogTable.performedBy, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("POST /api/conversations/:id/bookings (propose)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const convId = await createHiredConversation();
    const res = await request(app)
      .post(`/api/conversations/${convId}/bookings`)
      .send({ startAt: futureStart() });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-participants (other customer and other trader)", async () => {
    const convId = await createHiredConversation();
    const asOtherCustomer = await request(app)
      .post(`/api/conversations/${convId}/bookings`)
      .set("Authorization", `Bearer ${ctx.otherCustomerToken}`)
      .send({ startAt: futureStart() });
    expect(asOtherCustomer.status).toBe(404);

    const asOtherTrader = await request(app)
      .post(`/api/conversations/${convId}/bookings`)
      .set("Authorization", `Bearer ${ctx.otherTraderToken}`)
      .send({ startAt: futureStart() });
    expect(asOtherTrader.status).toBe(404);
  });

  it("rejects a startAt in the past with 400", async () => {
    const convId = await createHiredConversation();
    const res = await propose(convId, "trader", new Date(Date.now() - 60_000).toISOString());
    expect(res.status).toBe(400);
  });

  it("rejects proposing before the trader is hired with 409", async () => {
    const convId = await createHiredConversation({ hired: false });
    const res = await propose(convId);
    expect(res.status).toBe(409);
  });

  it("lets the trader propose: creates a PROPOSED booking and posts a system message", async () => {
    const convId = await createHiredConversation();
    const res = await propose(convId, "trader");
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({
      conversationId: convId,
      status: "PROPOSED",
      proposedByRole: "trader",
    });

    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, convId));
    expect(msgs.some((m) => m.systemMessage && /proposed an appointment/.test(m.body))).toBe(true);
  });

  it("lets the customer propose too", async () => {
    const convId = await createHiredConversation();
    const res = await propose(convId, "customer");
    expect(res.status).toBe(201);
    expect(res.body.booking.proposedByRole).toBe("customer");
  });

  it("never allows two live bookings under concurrent proposals (partial unique index)", async () => {
    const convId = await createHiredConversation();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => propose(convId, "trader")),
    );
    const created = results.filter((r) => r.status === 201);
    // Losers either hit 23505 → 409, or arrived after a winner committed and
    // superseded it (also a valid serialization). What matters is the DB
    // invariant below: exactly one live row survives.
    expect(created.length).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.conversationId, convId));
    const live = rows.filter((b) => b.status === "PROPOSED" || b.status === "CONFIRMED");
    expect(live.length).toBe(1);
  });
});

describe("durations + cross-conversation conflict protection", () => {
  // A UK-local date far enough out to be all-future, formatted YYYY-MM-DD.
  const ukDateStr = (daysAhead: number) => {
    const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    return parts; // en-CA gives YYYY-MM-DD
  };
  const at = (daysAhead: number, hourUtc: number, min = 0) => {
    const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    d.setUTCHours(hourUtc, min, 0, 0);
    return d.toISOString();
  };

  it("rejects an invalid duration with 400 and defaults omitted duration to 60", async () => {
    const convId = await createHiredConversation();
    const bad = await asTrader(request(app).post(`/api/conversations/${convId}/bookings`)).send({
      startAt: futureStart(),
      durationMinutes: 45,
    });
    expect(bad.status).toBe(400);

    const ok = await propose(convId);
    expect(ok.status).toBe(201);
    expect(ok.body.booking.durationMinutes).toBe(60);
    expect(new Date(ok.body.booking.endAt).getTime()).toBe(
      new Date(ok.body.booking.startAt).getTime() + 60 * 60000,
    );
  });

  it("blocks proposing a slot that overlaps another conversation's CONFIRMED booking", async () => {
    const convA = await createHiredConversation();
    const convB = await createHiredConversation();
    const start = at(3, 10);

    const pa = await asTrader(request(app).post(`/api/conversations/${convA}/bookings`)).send({
      startAt: start,
      durationMinutes: 120,
    });
    expect(pa.status).toBe(201);
    const ca = await asCustomer(
      request(app).post(`/api/bookings/${pa.body.booking.id}/confirm`),
    ).send({});
    expect(ca.status).toBe(200);

    // Overlapping start (one hour into the 2h confirmed job) → 409.
    const pb = await asTrader(request(app).post(`/api/conversations/${convB}/bookings`)).send({
      startAt: at(3, 11),
      durationMinutes: 60,
    });
    expect(pb.status).toBe(409);
    expect(pb.body.code).toBe("SLOT_TAKEN");

    // Back-to-back (starts exactly when the confirmed one ends) is allowed.
    const pb2 = await asTrader(request(app).post(`/api/conversations/${convB}/bookings`)).send({
      startAt: at(3, 12),
      durationMinutes: 60,
    });
    expect(pb2.status).toBe(201);
  });

  it("re-checks the slot at confirmation time (another job took it since the proposal)", async () => {
    const convA = await createHiredConversation();
    const convB = await createHiredConversation();
    const start = at(4, 9);

    // B proposes first (PROPOSED never blocks others).
    const pb = await asTrader(request(app).post(`/api/conversations/${convB}/bookings`)).send({
      startAt: start,
      durationMinutes: 60,
    });
    expect(pb.status).toBe(201);

    // A proposes AND confirms the same slot.
    const pa = await asTrader(request(app).post(`/api/conversations/${convA}/bookings`)).send({
      startAt: start,
      durationMinutes: 60,
    });
    expect(pa.status).toBe(201);
    const ca = await asCustomer(
      request(app).post(`/api/bookings/${pa.body.booking.id}/confirm`),
    ).send({});
    expect(ca.status).toBe(200);

    // Now confirming B's stale proposal must fail with the friendly 409.
    const cb = await asCustomer(
      request(app).post(`/api/bookings/${pb.body.booking.id}/confirm`),
    ).send({});
    expect(cb.status).toBe(409);
    expect(cb.body.code).toBe("SLOT_TAKEN");
  });

  it("keeps the old confirmed slot blocked while a reschedule proposal is pending", async () => {
    const convA = await createHiredConversation();
    const convB = await createHiredConversation();
    const oldStart = at(5, 10);

    const pa = await asTrader(request(app).post(`/api/conversations/${convA}/bookings`)).send({
      startAt: oldStart,
      durationMinutes: 60,
    });
    const ca = await asCustomer(
      request(app).post(`/api/bookings/${pa.body.booking.id}/confirm`),
    ).send({});
    expect(ca.status).toBe(200);

    // Reschedule: propose a new time in the same conversation → old confirmed
    // row becomes SUPERSEDED but must STILL block until the new one resolves.
    const resched = await asTrader(request(app).post(`/api/conversations/${convA}/bookings`)).send({
      startAt: at(5, 14),
      durationMinutes: 60,
    });
    expect(resched.status).toBe(201);

    const pb = await asTrader(request(app).post(`/api/conversations/${convB}/bookings`)).send({
      startAt: oldStart,
      durationMinutes: 60,
    });
    expect(pb.status).toBe(409);
  });

  it("GET booking-slots: participant-only, excludes conflicting starts", async () => {
    const convA = await createHiredConversation();
    const convB = await createHiredConversation();
    const dateStr = ukDateStr(6);

    // Confirm a 10:00–12:00 UK booking in conv A on that date.
    const startIso = new Date(`${dateStr}T10:00:00Z`); // approx UK time; offset ≤1h
    const pa = await asTrader(request(app).post(`/api/conversations/${convA}/bookings`)).send({
      startAt: startIso.toISOString(),
      durationMinutes: 120,
    });
    expect(pa.status).toBe(201);
    await asCustomer(request(app).post(`/api/bookings/${pa.body.booking.id}/confirm`)).send({});

    const res = await asCustomer(
      request(app).get(
        `/api/conversations/${convB}/booking-slots?date=${dateStr}&durationMinutes=60`,
      ),
    );
    expect(res.status).toBe(200);
    expect(res.body.hasWorkingHours).toBe(false);
    expect(Array.isArray(res.body.slots)).toBe(true);
    // No returned slot may overlap the confirmed 2h interval.
    const busyStart = startIso.getTime();
    const busyEnd = busyStart + 120 * 60000;
    for (const iso of res.body.slots as string[]) {
      const s = new Date(iso).getTime();
      expect(s + 60 * 60000 <= busyStart || s >= busyEnd).toBe(true);
    }

    // Non-participants get a 404, same as the other booking routes.
    const stranger = await request(app)
      .get(`/api/conversations/${convB}/booking-slots?date=${dateStr}&durationMinutes=60`)
      .set("Authorization", `Bearer ${ctx.otherCustomerToken}`);
    expect(stranger.status).toBe(404);
  });
});

describe("POST /api/bookings/:id/confirm", () => {
  it("only the other party may confirm: proposer gets 403", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    const res = await asTrader(
      request(app).post(`/api/bookings/${created.body.booking.id}/confirm`),
    ).send();
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-participants", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    const res = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/confirm`)
      .set("Authorization", `Bearer ${ctx.otherCustomerToken}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("customer confirms a trader proposal (happy path) and a system message is posted", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    const res = await asCustomer(
      request(app).post(`/api/bookings/${created.body.booking.id}/confirm`),
    ).send();
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe("CONFIRMED");
    expect(res.body.booking.confirmedAt).toBeTruthy();

    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, convId));
    expect(msgs.some((m) => m.systemMessage && /Appointment confirmed/.test(m.body))).toBe(true);
  });

  it("trader confirms a customer proposal", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "customer");
    const res = await asTrader(
      request(app).post(`/api/bookings/${created.body.booking.id}/confirm`),
    ).send();
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe("CONFIRMED");
  });

  it("refuses to confirm a booking that is no longer PROPOSED with 409", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    await asCustomer(request(app).post(`/api/bookings/${created.body.booking.id}/confirm`)).send();
    const again = await asCustomer(
      request(app).post(`/api/bookings/${created.body.booking.id}/confirm`),
    ).send();
    expect(again.status).toBe(409);
  });

  it("blocks confirming after the job is cancelled with 409", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    await db
      .update(conversationsTable)
      .set({ cancelledAt: new Date(), cancelledByRole: "customer" })
      .where(eq(conversationsTable.id, convId));
    const res = await asCustomer(
      request(app).post(`/api/bookings/${created.body.booking.id}/confirm`),
    ).send();
    expect(res.status).toBe(409);
  });
});

describe("POST /api/bookings/:id/cancel", () => {
  it("either party may cancel a live booking (happy path)", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    const res = await asCustomer(
      request(app).post(`/api/bookings/${created.body.booking.id}/cancel`),
    ).send();
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe("CANCELLED");
    expect(res.body.booking.cancelledByRole).toBe("customer");

    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, convId));
    expect(msgs.some((m) => m.systemMessage && /cancelled the appointment/.test(m.body))).toBe(
      true,
    );
  });

  it("the proposer can cancel their own confirmed booking", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    await asCustomer(request(app).post(`/api/bookings/${created.body.booking.id}/confirm`)).send();
    const res = await asTrader(
      request(app).post(`/api/bookings/${created.body.booking.id}/cancel`),
    ).send();
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe("CANCELLED");
    expect(res.body.booking.cancelledByRole).toBe("trader");
  });

  it("returns 404 for non-participants", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    const res = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set("Authorization", `Bearer ${ctx.otherTraderToken}`)
      .send();
    expect(res.status).toBe(404);
  });

  it("refuses to cancel an already-cancelled booking with 409", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    await asCustomer(request(app).post(`/api/bookings/${created.body.booking.id}/cancel`)).send();
    const again = await asTrader(
      request(app).post(`/api/bookings/${created.body.booking.id}/cancel`),
    ).send();
    expect(again.status).toBe(409);
  });
});

describe("bookingClosedReason gate — cancelled/completed/closed jobs", () => {
  it("blocks proposing after the job is cancelled with 409", async () => {
    const convId = await createHiredConversation();
    await db
      .update(conversationsTable)
      .set({ cancelledAt: new Date(), cancelledByRole: "customer" })
      .where(eq(conversationsTable.id, convId));
    const res = await propose(convId);
    expect(res.status).toBe(409);
  });

  it("blocks proposing after the job is completed with 409", async () => {
    const convId = await createHiredConversation();
    await db
      .update(conversationsTable)
      .set({ customerCompletedAt: new Date() })
      .where(eq(conversationsTable.id, convId));
    const res = await propose(convId);
    expect(res.status).toBe(409);
  });

  it("blocks proposing after the conversation is closed with 409", async () => {
    const convId = await createHiredConversation();
    await db
      .update(conversationsTable)
      .set({ status: "CLOSED" })
      .where(eq(conversationsTable.id, convId));
    const res = await propose(convId);
    expect(res.status).toBe(409);
  });

  it("blocks cancelling a booking after the job is completed with 409 (booking stays live)", async () => {
    const convId = await createHiredConversation();
    const created = await propose(convId, "trader");
    await asCustomer(request(app).post(`/api/bookings/${created.body.booking.id}/confirm`)).send();
    await db
      .update(conversationsTable)
      .set({ customerCompletedAt: new Date() })
      .where(eq(conversationsTable.id, convId));

    const res = await asCustomer(
      request(app).post(`/api/bookings/${created.body.booking.id}/cancel`),
    ).send();
    expect(res.status).toBe(409);

    const [row] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, created.body.booking.id));
    expect(row.status).toBe("CONFIRMED");
  });
});

describe("GET /api/admin/conversations/:id includes the live booking", () => {
  let adminSeq = 0;
  async function createAdmin(): Promise<string> {
    const [u] = await db
      .insert(usersTable)
      .values({
        email: emailFor(`admin-mod-${adminSeq++}`),
        passwordHash: "$2a$10$test.hash.not.used.for.login",
        fullName: "Test Admin",
        role: "admin",
        isActive: true,
        emailVerified: true,
      })
      .returning({ id: usersTable.id });
    createdUserIds.push(u.id);
    return generateToken(u.id, "admin", 1);
  }

  it("returns the live booking with the note gated by moderation access", async () => {
    const adminToken = await createAdmin();
    const convId = await createHiredConversation();
    const proposed = await propose(convId, "trader");
    expect(proposed.status).toBe(201);
    await db
      .update(bookingsTable)
      .set({ note: "Gate code 1234" })
      .where(eq(bookingsTable.id, proposed.body.booking.id));

    // No active report: scheduling facts visible, free-text note withheld.
    const res = await request(app)
      .get(`/api/admin/conversations/${convId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.booking).toBeTruthy();
    expect(res.body.booking.id).toBe(proposed.body.booking.id);
    expect(res.body.booking.status).toBe("PROPOSED");
    expect(res.body.booking.proposedByRole).toBe("trader");
    expect(res.body.booking.startAt).toBe(proposed.body.booking.startAt);
    expect(res.body.booking.note).toBeNull();
  });

  it("returns booking: null when the conversation has no live booking", async () => {
    const adminToken = await createAdmin();
    const convId = await createHiredConversation();
    const res = await request(app)
      .get(`/api/admin/conversations/${convId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.booking).toBeNull();
  });
});

describe("reschedule (new proposal supersedes the live booking)", () => {
  it("a new proposal supersedes a CONFIRMED booking and needs fresh confirmation", async () => {
    const convId = await createHiredConversation();
    const first = await propose(convId, "trader");
    await asCustomer(request(app).post(`/api/bookings/${first.body.booking.id}/confirm`)).send();

    const second = await propose(convId, "customer");
    expect(second.status).toBe(201);
    expect(second.body.booking.status).toBe("PROPOSED");
    expect(second.body.booking.id).not.toBe(first.body.booking.id);

    const [oldRow] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, first.body.booking.id));
    expect(oldRow.status).toBe("SUPERSEDED");

    // The reschedule is spelled out in a system message ("replaces ...").
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, convId));
    expect(msgs.some((m) => m.systemMessage && /replaces/.test(m.body))).toBe(true);

    // And the new proposal still needs the other party's confirmation.
    const confirm = await asTrader(
      request(app).post(`/api/bookings/${second.body.booking.id}/confirm`),
    ).send();
    expect(confirm.status).toBe(200);
    expect(confirm.body.booking.status).toBe("CONFIRMED");
  });

  it("a new proposal also supersedes a still-PROPOSED booking", async () => {
    const convId = await createHiredConversation();
    const first = await propose(convId, "trader");
    const second = await propose(convId, "trader");
    expect(second.status).toBe(201);

    const [oldRow] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, first.body.booking.id));
    expect(oldRow.status).toBe("SUPERSEDED");

    const rows = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.conversationId, convId));
    expect(rows.filter((b) => b.status === "PROPOSED" || b.status === "CONFIRMED").length).toBe(1);
  });
});
