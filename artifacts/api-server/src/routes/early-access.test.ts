import { describe, it, beforeEach, afterAll, expect, vi } from "vitest";
import request from "supertest";
import { db } from "@workspace/db";
import {
  earlyAccessRegistrationsTable,
  earlyAccessEventsTable,
} from "@workspace/db/schema";
import { eq, inArray, like, sql } from "drizzle-orm";

// Storage is the source of truth; email transport is mocked so tests never
// hold real transport creds and never produce real Brevo traffic.
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendEarlyAccessNotificationEmail: vi.fn(async () => "brevo" as const),
    sendEarlyAccessConfirmationEmail: vi.fn(async () => {}),
  };
});

import app from "../app";
import {
  sendEarlyAccessConfirmationEmail,
  sendEarlyAccessNotificationEmail,
} from "../lib/email";
import {
  LAUNCH_CONSENT_VERSION,
  MARKETING_CONSENT_VERSION,
} from "../lib/early-access-consent";

const notifyMock = vi.mocked(sendEarlyAccessNotificationEmail);
const confirmMock = vi.mocked(sendEarlyAccessConfirmationEmail);

// Unique suffix keeps fixtures isolated on the shared dev database.
const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `ea-${label}-${SUFFIX}@example.test`;

const VALID = {
  name: "Test Person",
  email: emailFor("main"),
  type: "customer",
  town: "MK44",
  message: "Looking forward to it",
  consent: true,
  _hp: "",
  _t: null,
};

function submit(body: Record<string, unknown>) {
  return request(app).post("/api/early-access").send(body);
}

async function getRegistration(email: string) {
  const [row] = await db
    .select()
    .from(earlyAccessRegistrationsTable)
    .where(
      eq(earlyAccessRegistrationsTable.emailNormalized, email.toLowerCase()),
    );
  return row;
}

async function getEvents(registrationId: number) {
  return db
    .select()
    .from(earlyAccessEventsTable)
    .where(eq(earlyAccessEventsTable.registrationId, registrationId))
    .orderBy(earlyAccessEventsTable.id);
}

async function cleanupFixtures() {
  const rows = await db
    .select({ id: earlyAccessRegistrationsTable.id })
    .from(earlyAccessRegistrationsTable)
    .where(
      like(earlyAccessRegistrationsTable.emailNormalized, `%${SUFFIX}%`),
    );
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db
      .delete(earlyAccessEventsTable)
      .where(inArray(earlyAccessEventsTable.registrationId, ids));
    await db
      .delete(earlyAccessRegistrationsTable)
      .where(inArray(earlyAccessRegistrationsTable.id, ids));
  }
}

describe("POST /api/early-access", () => {
  beforeEach(async () => {
    notifyMock.mockClear();
    confirmMock.mockClear();
    await cleanupFixtures();
    // Each test submits from the same test IP; keep the per-IP limiter fresh.
    await db.execute(sql`DELETE FROM rate_limit_hits`);
  });

  afterAll(cleanupFixtures);

  it("stores the registration with launch consent (no marketing by default) and sends both emails", async () => {
    const res = await submit(VALID);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await getRegistration(VALID.email);
    expect(row).toBeDefined();
    expect(row.name).toBe("Test Person");
    expect(row.audienceType).toBe("customer");
    expect(row.town).toBe("MK44");
    expect(row.launchConsentAt).toBeInstanceOf(Date);
    expect(row.launchConsentVersion).toBe(LAUNCH_CONSENT_VERSION);
    // Marketing must NEVER be inferred from registration alone.
    expect(row.marketingConsentAt).toBeNull();
    expect(row.marketingConsentVersion).toBeNull();
    expect(row.unsubscribedAt).toBeNull();

    const events = await getEvents(row.id);
    expect(events.map((e) => e.kind)).toEqual(["REGISTERED", "LAUNCH_CONSENT"]);
    expect(events[1].wordingVersion).toBe(LAUNCH_CONSENT_VERSION);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it("records separate marketing consent with its own version when explicitly ticked", async () => {
    const res = await submit({
      ...VALID,
      email: emailFor("marketing"),
      marketingConsent: true,
    });
    expect(res.status).toBe(200);

    const row = await getRegistration(emailFor("marketing"));
    expect(row.marketingConsentAt).toBeInstanceOf(Date);
    expect(row.marketingConsentVersion).toBe(MARKETING_CONSENT_VERSION);
    const events = await getEvents(row.id);
    expect(events.map((e) => e.kind)).toEqual([
      "REGISTERED",
      "LAUNCH_CONSENT",
      "MARKETING_CONSENT",
    ]);
    expect(events[2].wordingVersion).toBe(MARKETING_CONSENT_VERSION);
  });

  it("treats non-boolean marketingConsent values as not consented", async () => {
    await submit({
      ...VALID,
      email: emailFor("truthy"),
      marketingConsent: "yes",
    });
    const row = await getRegistration(emailFor("truthy"));
    expect(row.marketingConsentAt).toBeNull();
  });

  it("deduplicates case-insensitively: repeat submission updates details, no second notification", async () => {
    const email = emailFor("dupe");
    await submit({ ...VALID, email });
    const res = await submit({
      ...VALID,
      email: email.toUpperCase(),
      name: "Updated Name",
      town: "Bedford",
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true); // identical response — no reveal

    const rows = await db
      .select()
      .from(earlyAccessRegistrationsTable)
      .where(
        eq(earlyAccessRegistrationsTable.emailNormalized, email.toLowerCase()),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Updated Name");
    expect(rows[0].town).toBe("Bedford");

    const events = await getEvents(rows[0].id);
    expect(events.map((e) => e.kind)).toContain("DETAILS_UPDATED");
    // Only the FIRST registration notifies the inbox / auto-replies.
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("never lifts an unsubscribe from the unauthenticated form (user or admin)", async () => {
    const email = emailFor("unsub");
    await submit({ ...VALID, email, marketingConsent: true });
    const row = await getRegistration(email);
    await db
      .update(earlyAccessRegistrationsTable)
      .set({ unsubscribedAt: new Date(), unsubscribeSource: "user" })
      .where(eq(earlyAccessRegistrationsTable.id, row.id));

    // Repeat WITHOUT ticking the box: must stay unsubscribed.
    await submit({ ...VALID, email });
    let after = await getRegistration(email);
    expect(after.unsubscribedAt).toBeInstanceOf(Date);

    // Repeat WITH a tick: the form is unauthenticated, so a third party who
    // knows the address must NOT be able to reverse an opt-out. Evidence is
    // recorded, the unsubscribe stays.
    await submit({ ...VALID, email, marketingConsent: true });
    after = await getRegistration(email);
    expect(after.unsubscribedAt).toBeInstanceOf(Date);
    expect(after.unsubscribeSource).toBe("user");
    expect(after.marketingConsentVersion).toBe(MARKETING_CONSENT_VERSION);
    const events = await getEvents(row.id);
    const lastMarketing = events
      .filter((e) => e.kind === "MARKETING_CONSENT")
      .pop();
    expect((lastMarketing?.details as any)?.unsubscribeRetained).toBe("user");
  });

  it("keeps ADMIN suppression even when the marketing box is re-ticked", async () => {
    const email = emailFor("suppressed");
    await submit({ ...VALID, email });
    const row = await getRegistration(email);
    await db
      .update(earlyAccessRegistrationsTable)
      .set({ unsubscribedAt: new Date(), unsubscribeSource: "admin" })
      .where(eq(earlyAccessRegistrationsTable.id, row.id));

    await submit({ ...VALID, email, marketingConsent: true });
    const after = await getRegistration(email);
    expect(after.unsubscribedAt).toBeInstanceOf(Date);
    expect(after.unsubscribeSource).toBe("admin");
    // The consent evidence itself IS recorded (for when an admin lifts it).
    expect(after.marketingConsentVersion).toBe(MARKETING_CONSENT_VERSION);
  });

  it("filled honeypot pretends success, stores nothing and sends nothing", async () => {
    const email = emailFor("bot");
    const res = await submit({ ...VALID, email, _hp: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(await getRegistration(email)).toBeUndefined();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("rejects missing consent, bad email and unknown type", async () => {
    for (const bad of [
      { ...VALID, consent: false },
      { ...VALID, email: "not-an-email" },
      { ...VALID, type: "alien" },
    ]) {
      const res = await submit(bad);
      expect(res.status).toBe(400);
    }
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("optional fields may be omitted", async () => {
    const email = emailFor("minimal");
    const res = await submit({
      name: "Minimal Person",
      email,
      type: "trader",
      consent: true,
    });
    expect(res.status).toBe(200);
    const row = await getRegistration(email);
    expect(row.town).toBeNull();
    expect(row.message).toBeNull();
  });
});
